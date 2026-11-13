# book_store.py - Formato y lectura del libro de Bybit que graba la suite (book_recorder.py), desde el 13/11/2026.
#
# Un archivo por moneda, dia UTC y tipo, en OrderFlowData/live/book/{SIMBOLO}/{AAAA}/:
#   {SIMBOLO}_{AAAA-MM-DD}.bks  cada segundo: lo que habia en cubos finos (~0.01% del precio) hasta +-0.8%
#   {SIMBOLO}_{AAAA-MM-DD}.bkm  cada minuto: profundidad ponderada por tiempo y minima del minuto, en cubos
#                               gruesos (~0.03%, como el step del footprint de 15m) hasta +-5%
# Las cantidades van en la moneda (BTC, ETH...), no en USD: USD = cantidad x precio del cubo.
#
# Cada archivo es una serie de bloques de un minuto, uno tras otro:
#   b"BK" + version (1 byte) + minuto (int64, ms UTC) + largo (uint32) + zlib(contenido)
#   contenido = largo del encabezado (uint32) + encabezado JSON + arreglos float32
# Un bloque cortado al final (un corte de luz) se ignora. Cubo k = [k*step, (k+1)*step) en ticks del precio.
#   Compras: indice i = cubo kmid - i.  Ventas: indice i = cubo kmid + i.  kmid = cubo del precio medio al abrir el minuto.
# En .bks las filas de cada segundo van con XOR contra la fila anterior: sin perdida, y lo que no cambia casi no ocupa.
import json
import os
import struct
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Iterator, List, Optional, Tuple

import numpy as np

MAGIC = b"BK"
VERSION = 1
PREFIX = struct.Struct("<2sBqI")  # magic, version, minuto (ms), largo del contenido comprimido
MINUTE = 60000
KINDS = ("bks", "bkm")


# ---------- rutas ----------
# Dos fuentes en el PC: lo que graba la suite (live/book) y lo que se baja de la nube para tapar sus huecos
# (live/book_cloud, ver book_cloud.py). Los lectores aceptan una carpeta o una lista y, si un minuto esta en las dos,
# toman el bloque con mas cobertura. El collector de la nube usa una copia exacta de este archivo.
def root(data_dir) -> Path:
    return Path(data_dir) / "live" / "book"


def cloud_root(data_dir) -> Path:
    return Path(data_dir) / "live" / "book_cloud"


def sources(data_dir) -> List[Path]:
    return [root(data_dir), cloud_root(data_dir)]


def day_of(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def day_path(base: Path, symbol: str, day: str, kind: str) -> Path:
    return Path(base) / symbol / day[:4] / f"{symbol}_{day}.{kind}"


def days_between(start_ms: int, end_ms: int) -> List[str]:
    start = datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc).date()
    end = datetime.fromtimestamp(max(start_ms, end_ms - 1) / 1000, tz=timezone.utc).date()
    out, d = [], start
    while d <= end:
        out.append(d.strftime("%Y-%m-%d"))
        d += timedelta(days=1)
    return out


# ---------- bloques ----------
def xor_rows(rows: np.ndarray) -> np.ndarray:
    """Cada fila con XOR contra la anterior, sobre los bits de float32: se deshace exacto con unxor_rows."""
    u = np.ascontiguousarray(rows, dtype=np.float32).view(np.uint32)
    out = u.copy()
    out[1:] ^= u[:-1]
    return out.view(np.float32)


def unxor_rows(rows: np.ndarray) -> np.ndarray:
    u = np.ascontiguousarray(rows, dtype=np.float32).view(np.uint32).copy()
    if len(u):
        np.bitwise_xor.accumulate(u, axis=0, out=u)
    return u.view(np.float32)


def encode_block(minute_ms: int, header: dict, arrays: List[np.ndarray], level: int = 6) -> bytes:
    hb = json.dumps(header, separators=(",", ":")).encode("utf-8")
    body = struct.pack("<I", len(hb)) + hb + b"".join(np.ascontiguousarray(a, dtype=np.float32).tobytes() for a in arrays)
    z = zlib.compress(body, level)
    return PREFIX.pack(MAGIC, VERSION, int(minute_ms), len(z)) + z


def decode_payload(payload: bytes) -> Tuple[dict, np.ndarray]:
    body = zlib.decompress(payload)
    hl = struct.unpack_from("<I", body, 0)[0]
    header = json.loads(body[4:4 + hl].decode("utf-8"))
    arr = np.frombuffer(body, dtype=np.float32, offset=4 + hl)
    return header, arr


def seconds_block(minute_ms, header, bids_rows, asks_rows) -> bytes:
    """Bloque .bks: filas (segundos x n) de compras y de ventas."""
    return encode_block(minute_ms, header, [xor_rows(bids_rows), xor_rows(asks_rows)])


def minute_block(minute_ms, header, twa_b, twa_a, min_b, min_a) -> bytes:
    return encode_block(minute_ms, header, [twa_b, twa_a, min_b, min_a])


def split_seconds(header: dict, arr: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    s, n = len(header["ts"]), int(header["n"])
    bids = unxor_rows(arr[:s * n].reshape(s, n)) if s else np.zeros((0, n), np.float32)
    asks = unxor_rows(arr[s * n:2 * s * n].reshape(s, n)) if s else np.zeros((0, n), np.float32)
    return bids, asks


def split_minute(header: dict, arr: np.ndarray) -> Dict[str, np.ndarray]:
    n = int(header["n"])
    parts = arr[:4 * n].reshape(4, n)
    return {"twa_b": parts[0], "twa_a": parts[1], "min_b": parts[2], "min_a": parts[3]}


# ---------- indice de cada archivo (minuto -> lugar), se amplia solo al crecer el archivo ----------
_index: Dict[str, dict] = {}


def index(path: Path) -> List[Tuple[int, int, int]]:
    """[(minuto, inicio del contenido, largo)] de los bloques completos del archivo."""
    key = str(path)
    try:
        size = os.path.getsize(path)
    except OSError:
        _index.pop(key, None)
        return []
    entry = _index.get(key)
    if entry is None or size < entry["size"]:
        entry = {"size": 0, "end": 0, "items": []}
    if size > entry["size"]:
        with open(path, "rb") as fh:
            pos = entry["end"]
            fh.seek(pos)
            while pos + PREFIX.size <= size:
                head = fh.read(PREFIX.size)
                if len(head) < PREFIX.size:
                    break
                magic, version, minute, length = PREFIX.unpack(head)
                if magic != MAGIC or version != VERSION:
                    break  # archivo de otra version o danado desde aqui: no se lee mas alla
                if pos + PREFIX.size + length > size:
                    break  # bloque a medio escribir: se lee cuando termine
                entry["items"].append((minute, pos + PREFIX.size, length))
                pos += PREFIX.size + length
                fh.seek(pos)
            entry["end"] = pos
        entry["size"] = size
        _index[key] = entry
    return entry["items"]


def _bases(base) -> List[Path]:
    return [Path(b) for b in base] if isinstance(base, (list, tuple)) else [Path(base)]


def blocks(base, symbol: str, kind: str, start_ms: int, end_ms: int) -> Iterator[Tuple[dict, np.ndarray]]:
    """Bloques de minutos que empiezan en [start_ms - 59.999 s, end_ms), en orden dentro de cada carpeta.
    kind: 'bks' o 'bkm'. base: una carpeta o una lista (pueden repetirse minutos entre ellas)."""
    first = start_ms - start_ms % MINUTE
    for b in _bases(base):
        for day in days_between(first, end_ms):
            path = day_path(b, symbol, day, kind)
            items = [it for it in index(path) if first <= it[0] < end_ms]
            if not items:
                continue
            with open(path, "rb") as fh:
                for minute, start, length in sorted(items):
                    fh.seek(start)
                    try:
                        yield decode_payload(fh.read(length))
                    except (zlib.error, ValueError, struct.error):
                        continue  # un bloque ilegible no tapa los demas


def minute_columns(base, symbol: str, start_ms: int, end_ms: int) -> List[Tuple[dict, Dict[str, np.ndarray]]]:
    """Columnas de cada minuto. Si un minuto tiene dos bloques (corte y vuelta, o PC y nube), queda el de mas cobertura."""
    best: Dict[int, Tuple[dict, Dict[str, np.ndarray]]] = {}
    for header, arr in blocks(base, symbol, "bkm", start_ms, end_ms):
        t = int(header["t"])
        if t not in best or header.get("cov", 0) > best[t][0].get("cov", 0):
            best[t] = (header, split_minute(header, arr))
    return [best[t] for t in sorted(best)]


def second_rows(base, symbol: str, start_ms: int, end_ms: int) -> List[Tuple[dict, np.ndarray, np.ndarray]]:
    """Bloques de segundos con sus filas de compras y ventas ya armadas, uno por minuto (el de mas tomas)."""
    best: Dict[int, Tuple[dict, np.ndarray]] = {}
    for header, arr in blocks(base, symbol, "bks", start_ms, end_ms):
        t = int(header["t"])
        if t not in best or len(header.get("ts") or []) > len(best[t][0].get("ts") or []):
            best[t] = (header, arr)
    out = []
    for t in sorted(best):
        header, arr = best[t]
        bids, asks = split_seconds(header, arr)
        out.append((header, bids, asks))
    return out


# ---------- copiar bloques entre la nube y el PC ----------
def minutes_in(path: Path) -> List[int]:
    """Minutos con bloque completo en un archivo."""
    return sorted({minute for minute, _, _ in index(path)})


def ranges(minutes: List[int]) -> List[List[int]]:
    """Minutos seguidos como tramos [inicio, fin) en ms."""
    out: List[List[int]] = []
    for m in sorted(set(minutes)):
        if out and out[-1][1] == m:
            out[-1][1] = m + MINUTE
        else:
            out.append([m, m + MINUTE])
    return out


def raw_blocks(path: Path, start_ms: int, end_ms: int, limit_bytes: int = 8 << 20) -> bytes:
    """Los bloques tal cual (prefijo y contenido) de los minutos en [start_ms, end_ms), hasta limit_bytes."""
    items = sorted(it for it in index(path) if start_ms <= it[0] < end_ms)
    out, size = [], 0
    if not items:
        return b""
    with open(path, "rb") as fh:
        for minute, start, length in items:
            if size and size + PREFIX.size + length > limit_bytes:
                break
            fh.seek(start - PREFIX.size)
            data = fh.read(PREFIX.size + length)
            out.append(data)
            size += len(data)
    return b"".join(out)


def split_raw(data: bytes) -> List[Tuple[int, bytes]]:
    """[(minuto, bloque)] de bloques completos y legibles; lo demas se descarta."""
    out, pos = [], 0
    while pos + PREFIX.size <= len(data):
        magic, version, minute, length = PREFIX.unpack_from(data, pos)
        end = pos + PREFIX.size + length
        if magic != MAGIC or version != VERSION or end > len(data):
            break
        try:
            zlib.decompress(data[pos + PREFIX.size:end])
        except zlib.error:
            break
        out.append((minute, data[pos:end]))
        pos = end
    return out


def append_blocks(path: Path, items: List[Tuple[int, bytes]]) -> int:
    """Suma bloques al final del archivo, sin repetir minutos que ya tiene. Devuelve cuantos sumo."""
    have = set(minutes_in(path)) if Path(path).exists() else set()
    new = [data for minute, data in items if minute not in have]
    if not new:
        return 0
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "ab") as fh:
        fh.write(b"".join(new))
    return len(new)


def minute_cov(path: Path) -> Dict[int, int]:
    """Cobertura (ms) de cada minuto de un archivo .bkm."""
    out: Dict[int, int] = {}
    items = index(path)
    if not items:
        return out
    with open(path, "rb") as fh:
        for minute, start, length in items:
            fh.seek(start)
            try:
                header, _ = decode_payload(fh.read(length))
            except (zlib.error, ValueError, struct.error):
                continue
            out[minute] = max(out.get(minute, 0), int(header.get("cov") or 0))
    return out


def cleanup_days(base: Path, keep_days: int, now_ms: int) -> int:
    """Borra los dias de mas de keep_days (por la fecha del nombre). Devuelve cuantos archivos borro."""
    cutoff = day_of(now_ms - keep_days * 86400000)
    deleted = 0
    base = Path(base)
    if not base.exists():
        return 0
    for f in base.rglob("*.bk[sm]"):
        day = f.stem.rsplit("_", 1)[-1]
        if len(day) == 10 and day < cutoff:
            try:
                f.unlink()
                _index.pop(str(f), None)
                deleted += 1
            except OSError:
                pass
    return deleted


def oldest_days(base: Path) -> List[Tuple[str, List[Path]]]:
    """Dias grabados, del mas viejo al mas nuevo, con sus archivos (para liberar espacio)."""
    days: Dict[str, List[Path]] = {}
    base = Path(base)
    if base.exists():
        for f in base.rglob("*.bk[sm]"):
            days.setdefault(f.stem.rsplit("_", 1)[-1], []).append(f)
    return sorted(days.items())


# ---------- lectura de un cubo o una zona ----------
def bucket_bounds(header: dict, side: str, i: int) -> Tuple[float, float]:
    """Precio de abajo y de arriba del cubo i de ese lado ('b' compras, 'a' ventas)."""
    k = header["kmid"] - i if side == "b" else header["kmid"] + i
    width = header["step"] * header["tick"]
    return k * width, (k + 1) * width


def zone_indices(header: dict, side: str, low: float, high: float) -> np.ndarray:
    """Indices de los cubos de ese lado cuyo centro cae en [low, high]."""
    width = header["step"] * header["tick"]
    i = np.arange(int(header["n"]))
    k = header["kmid"] - i if side == "b" else header["kmid"] + i
    center = (k + 0.5) * width
    return i[(center >= low) & (center <= high)]


def zone_depth(header: dict, row: np.ndarray, side: str, low: float, high: float) -> Tuple[float, float]:
    """(cantidad, USD) de ese lado en [low, high], con los cubos de una fila o columna."""
    idx = zone_indices(header, side, low, high)
    if not len(idx):
        return 0.0, 0.0
    width = header["step"] * header["tick"]
    k = header["kmid"] - idx if side == "b" else header["kmid"] + idx
    qty = np.maximum(row[idx].astype(np.float64), 0.0)
    return float(qty.sum()), float((qty * (k + 0.5) * width).sum())


def covers(header: dict, side: str, low: float, high: float) -> bool:
    """El bloque alcanza toda la zona: si no, lo que falta no se sabe (no es cero)."""
    n = int(header["n"])
    lo0, hi0 = bucket_bounds(header, side, n - 1 if side == "b" else 0)
    lo1, hi1 = bucket_bounds(header, side, 0 if side == "b" else n - 1)
    return min(lo0, lo1) <= low and max(hi0, hi1) >= high


def disk_usage(base: Path, day: Optional[str] = None) -> Dict[str, int]:
    """Bytes por moneda (de un dia o de todo)."""
    out: Dict[str, int] = {}
    base = Path(base)
    if not base.exists():
        return out
    for sym_dir in base.iterdir():
        if not sym_dir.is_dir():
            continue
        total = 0
        for f in sym_dir.rglob("*.bk[sm]"):
            if day is None or f.name.endswith(f"_{day}.bks") or f.name.endswith(f"_{day}.bkm"):
                try:
                    total += f.stat().st_size
                except OSError:
                    pass
        out[sym_dir.name] = total
    return out
