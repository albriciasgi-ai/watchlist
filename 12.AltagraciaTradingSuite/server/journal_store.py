# journal_store.py - Lo que la suite suma al journal del bot (paso 4): el Observador de App 1 con trades reales.
#
# El bot anota los hechos de cada trade (apertura, cierres de Bybit, notas). La suite guarda aqui lo que solo ella ve:
# - Contexto de decision (panel de trading, al confirmar la orden): imagen del grafico, niveles y marcas elegidos con su
#   papel y nota, la nota del usuario y la orden propuesta.
# - Imagenes de apertura y de cierre: las toma la pagina al ver abrirse o cerrarse una posicion de la moneda a la vista.
# - Medidas al decidir (cache de journal_measures.py) y lectura de la regla del laboratorio (de journal_reading.py).
#
# Todo en data/journal (SUITE_DATA_DIR), en archivos que solo se agregan. Se une a los trades del bot al leerlos:
# misma moneda y lado; la decision por su orden de Bybit si se sabe, si no por hora (merge).
import json
import re
import secrets
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

SYMBOL_RE = re.compile(r"^[A-Z0-9]{2,20}$")
SESSION_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
FILE_RE = re.compile(r"^[A-Za-z0-9_.-]{1,96}$")
IMAGE_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}/[A-Za-z0-9_.-]{1,96}$")
TRADE_ID_RE = re.compile(r"^[A-Za-z0-9:._-]{1,160}$")
ORDER_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
OUTCOMES = {"placed", "unknown"}
# "after" (12/11/2026): la imagen 10 velas despues del cierre, como la de cierre de App 1. Su `at` es la hora del cierre
# (se une al trade como la de cierre) y `until`, el final de lo que muestra
KINDS = {"decision", "open", "close", "after"}
MAX_IMAGE_BYTES = 12 * 1024 * 1024
MINUTE = 60000
# Ventanas para unir un contexto con su trade (respecto de la apertura o el cierre que anota el bot)
DECISION_BEFORE, DECISION_AFTER = 15 * MINUTE, 2 * MINUTE
OPEN_BEFORE, OPEN_AFTER = 1 * MINUTE, 5 * MINUTE
CLOSE_BEFORE, CLOSE_AFTER = 2 * MINUTE, 15 * MINUTE


def _num(value) -> Optional[float]:
    if isinstance(value, bool):
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if f == f and abs(f) != float("inf") else None


def _text(value, limit: int) -> Optional[str]:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value[:limit] if value else None


class JournalStore:
    def __init__(self, base_dir):
        self.base = Path(base_dir)
        self.images = self.base / "images"
        self.contexts_file = self.base / "contexts.jsonl"
        self.measures_dir = self.base / "measures"
        self.readings_dir = self.base / "readings"
        self._cache: Optional[List[Dict[str, Any]]] = None
        self._cache_key = None

    # ---------- imagenes ----------
    def save_image(self, session: str, content: bytes) -> str:
        if not SESSION_RE.match(session or ""):
            raise ValueError("sesion invalida")
        if not content or len(content) > MAX_IMAGE_BYTES or not content.startswith(b"\x89PNG"):
            raise ValueError("la imagen debe ser un PNG de hasta 12 MB")
        folder = self.images / session
        folder.mkdir(parents=True, exist_ok=True)
        name = f"img_{int(time.time() * 1000)}_{secrets.token_hex(3)}.png"
        tmp = folder / (name + ".tmp")
        tmp.write_bytes(content)
        tmp.replace(folder / name)
        return f"{session}/{name}"

    def image_path(self, session: str, filename: str) -> Optional[Path]:
        if not SESSION_RE.match(session or "") or not FILE_RE.match(filename or "") or ".." in filename:
            return None
        path = self.images / session / filename
        return path if path.is_file() else None

    # ---------- contextos ----------
    @staticmethod
    def clean_context(body: Dict[str, Any]) -> Dict[str, Any]:
        """Solo lo esperado y acotado: lo escribe una pagina, pero queda en disco para siempre."""
        if not isinstance(body, dict):
            raise ValueError("cuerpo invalido")
        kind = body.get("kind")
        if kind not in KINDS:
            raise ValueError("kind debe ser decision, open, close o after")
        symbol = str(body.get("symbol") or "").upper()
        if not SYMBOL_RE.match(symbol):
            raise ValueError("simbolo invalido")
        side = body.get("side")
        if side not in ("Buy", "Sell"):
            raise ValueError("side debe ser Buy o Sell")
        at = _num(body.get("at"))
        now = time.time() * 1000
        if at is None or at < now - 400 * 86400000 or at > now + 60000:
            raise ValueError("hora invalida")
        event: Dict[str, Any] = {"kind": kind, "symbol": symbol, "side": side, "at": int(at), "saved_at": int(now)}
        image = body.get("image")
        if image is not None:
            if not isinstance(image, str) or not IMAGE_RE.match(image) or ".." in image:
                raise ValueError("imagen invalida")
            event["image"] = image
        frame = _text(body.get("frame"), 8)
        if frame:
            event["frame"] = frame
        if kind == "after":
            until = _num(body.get("until"))
            if until is None or until < at or until > now + 60000:
                raise ValueError("until invalido: el final de la imagen va despues del cierre y no en el futuro")
            event["until"] = int(until)
        note = _text(body.get("note"), 4000)
        if note:
            event["note"] = note
        levels = body.get("levels")
        if isinstance(levels, list):
            clean = []
            for item in levels[:60]:
                if not isinstance(item, dict):
                    continue
                level = {k: _text(item.get(k), 300) for k in ("id", "kind", "label", "source", "note")}
                role = item.get("role")
                if isinstance(role, str):
                    level["role"] = role.strip()[:40]  # "" es "solo marca": se guarda tal cual
                for k in ("price", "time", "low", "high", "selectedAt"):
                    v = _num(item.get(k))
                    if v is not None:
                        level[k] = v
                level["mark"] = bool(item.get("mark"))
                clean.append({k: v for k, v in level.items() if v is not None})
            event["levels"] = clean
        order = body.get("order")
        if isinstance(order, dict):
            event["order"] = {k: v for k, v in {
                "type": _text(order.get("type"), 16), "qty": _num(order.get("qty")), "entry": _num(order.get("entry")),
                "stop": _num(order.get("stop")), "target": _num(order.get("target")), "risk": _num(order.get("risk")),
            }.items() if v is not None}
        # La orden de Bybit de esta decision (12/11/2026): une la decision con el trade que abra, aunque una Limit se
        # llene horas despues. outcome: "placed" (la orden quedo en Bybit) o "unknown" (no se supo la respuesta)
        if kind == "decision":
            for key in ("order_id", "order_link_id"):
                value = body.get(key)
                if value is not None:
                    if not isinstance(value, str) or not ORDER_ID_RE.match(value):
                        raise ValueError(f"{key} invalido")
                    event[key] = value
            if body.get("outcome") in OUTCOMES:
                event["outcome"] = body["outcome"]
        return event

    def decision_for(self, order_id: Optional[str] = None, order_link_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """La decision guardada de esa orden de Bybit (la mas reciente), o None."""
        if not order_id and not order_link_id:
            return None
        found = None
        for e in self.contexts():
            if e["kind"] != "decision":
                continue
            if (order_id and e.get("order_id") == order_id) or (order_link_id and e.get("order_link_id") == order_link_id):
                if found is None or e["at"] >= found["at"]:
                    found = e
        return found

    def add_context(self, body: Dict[str, Any]) -> Dict[str, Any]:
        event = self.clean_context(body)
        self.base.mkdir(parents=True, exist_ok=True)
        with open(self.contexts_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
        self._cache = None
        return event

    def contexts(self) -> List[Dict[str, Any]]:
        key = self.contexts_file.stat().st_mtime_ns if self.contexts_file.exists() else None
        if self._cache is not None and key == self._cache_key:
            return self._cache
        events = []
        if key is not None:
            for line in self.contexts_file.read_text(encoding="utf-8").splitlines():
                try:
                    event = json.loads(line)
                except ValueError:
                    continue  # linea cortada por un apagon
                if isinstance(event, dict) and event.get("kind") in KINDS:
                    events.append(event)
        self._cache, self._cache_key = events, key
        return events

    # ---------- union con los trades del bot ----------
    def merge(self, trades: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Suma a cada trade su contexto de decision y sus imagenes (misma moneda y lado).
        La decision es la de la orden que abrio el trade (open_order_id del bot), a cualquier hora: una Limit puede
        llenarse horas despues. Sin esa, por hora como antes (la mas reciente de 15 minutos antes a 2 despues de la
        apertura), nunca la de otra orden conocida: la de una Limit cancelada no pasa al trade que la reemplazo.
        """
        by_key: Dict[tuple, List[Dict[str, Any]]] = {}
        for event in self.contexts():
            by_key.setdefault((event["symbol"], event["side"]), []).append(event)
        for t in trades:
            events = by_key.get((t.get("symbol"), t.get("side")), [])
            opened, closed = t.get("opened_at"), t.get("closed_at")
            order_id, link_id = t.get("open_order_id"), t.get("open_order_link_id")
            decision, by_time, images = None, None, []
            for e in events:
                at = e["at"]
                if e["kind"] == "decision":
                    if (order_id and e.get("order_id") == order_id) or (link_id and e.get("order_link_id") == link_id):
                        if decision is None or at > decision["at"]:
                            decision = e
                        continue
                    other_order = (order_id or link_id) and (e.get("order_id") or e.get("order_link_id"))
                    if (not other_order and opened and not t.get("pre_existing")
                            and opened - DECISION_BEFORE <= at <= opened + DECISION_AFTER):
                        if by_time is None or at > by_time["at"]:
                            by_time = e
                elif e["kind"] == "open" and opened and not t.get("pre_existing") and opened - OPEN_BEFORE <= at <= opened + OPEN_AFTER:
                    images.append({"kind": "open", "image": e.get("image"), "at": at, "frame": e.get("frame")})
                elif e["kind"] in ("close", "after") and closed and closed - CLOSE_BEFORE <= at <= closed + CLOSE_AFTER:
                    shot = {"kind": e["kind"], "image": e.get("image"), "at": at, "frame": e.get("frame")}
                    if e.get("until"):
                        shot["until"] = e["until"]
                    images.append(shot)
            decision = decision or by_time
            if decision and decision.get("image"):
                images.insert(0, {"kind": "decision", "image": decision["image"], "at": decision["at"], "frame": decision.get("frame")})
            t["decision"] = decision
            t["images"] = [i for i in images if i.get("image")]
        return trades

    # ---------- medidas y lecturas de la regla (cache por trade, un archivo cada uno) ----------
    def _cache_file(self, folder: Path, trade_id: str) -> Optional[Path]:
        if not TRADE_ID_RE.match(trade_id or ""):
            return None
        return folder / (re.sub(r"[^A-Za-z0-9_.-]", "_", trade_id) + ".json")

    def _cache_get(self, folder: Path, trade_id: str) -> Optional[Dict[str, Any]]:
        path = self._cache_file(folder, trade_id)
        if not path or not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except ValueError:
            return None

    def _cache_put(self, folder: Path, trade_id: str, data: Dict[str, Any]) -> None:
        path = self._cache_file(folder, trade_id)
        if not path:
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)

    def measures_get(self, trade_id: str) -> Optional[Dict[str, Any]]:
        return self._cache_get(self.measures_dir, trade_id)

    def measures_put(self, trade_id: str, data: Dict[str, Any]) -> None:
        self._cache_put(self.measures_dir, trade_id, data)

    # La lectura de la regla del laboratorio (journal_reading.py, 13/11/2026)
    def readings_get(self, trade_id: str) -> Optional[Dict[str, Any]]:
        return self._cache_get(self.readings_dir, trade_id)

    def readings_put(self, trade_id: str, data: Dict[str, Any]) -> None:
        self._cache_put(self.readings_dir, trade_id, data)
