# tape_format.py - Formato compacto de trades (OFT1), el mismo de OrderFlowData/tools/ingest.py
#
# Copia exacta de write_tape/read_tape de ingest.py (solo se agrego el nivel de compresion, que
# no cambia el formato), sin sus dependencias de Windows, para que
# el collector en la nube grabe archivos que build_store.py y build_flow.py leen igual que los
# que se bajan de public.bybit.com. Si cambia el formato en ingest.py, hay que cambiarlo aqui.
#
# Columnas por trade:
#   t: hora en unidades de 1e-4 s (ms * 10)
#   p: precio entero (precio * price_scale)
#   q: cantidad entera (cantidad * qty_scale)
#   side: +1 compra agresiva, -1 venta agresiva
#   rpi: marca RPI de Bybit
import json
import os
import struct
import zlib

import numpy as np

MAGIC = b'OFT1'


def planes_encode(a):
    mx = int(a.max()) if len(a) else 0
    n = max(1, (mx.bit_length() + 7) // 8)
    v = np.ascontiguousarray(a, dtype='<u8').view(np.uint8).reshape(-1, 8)[:, :n]
    return n, np.ascontiguousarray(v.T).tobytes()


def planes_decode(b, n, count):
    out = np.zeros((count, 8), np.uint8)
    out[:, :n] = np.frombuffer(b, np.uint8).reshape(n, count).T
    return out.view('<u8').reshape(-1)


def zig(d):
    return ((d << 1) ^ (d >> 63)).view(np.uint64)


def unzig(z):
    z = z.astype(np.uint64)
    return (z >> np.uint64(1)).astype(np.int64) ^ -(z & np.uint64(1)).astype(np.int64)


def write_tape(path, meta, t, p, q, side, rpi, level=9):
    n = len(t)
    dt_ = np.diff(t, prepend=t[0]).astype(np.uint64)
    dp = zig(np.diff(p, prepend=p[0]).astype(np.int64))
    secs = []
    blobs = []
    for name, arr in (('dt', dt_), ('dp', dp), ('q', q.astype(np.uint64))):
        k, b = planes_encode(arr)
        z = zlib.compress(b, level); secs.append({'name': name, 'planes': k, 'zlen': len(z)}); blobs.append(z)
    for name, arr in (('side', side > 0), ('rpi', rpi > 0)):
        z = zlib.compress(np.packbits(arr).tobytes(), level); secs.append({'name': name, 'planes': 0, 'zlen': len(z)}); blobs.append(z)
    meta = dict(meta, n=n, t0=int(t[0]), p0=int(p[0]), sections=secs, t_unit='1e-4s')
    head = json.dumps(meta, separators=(',', ':')).encode()
    tmp = str(path) + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(MAGIC + struct.pack('<I', len(head)) + head)
        for b in blobs:
            f.write(b)
    os.replace(tmp, path)


def _sum_planes(raw, k, n):
    """Suma de los n valores guardados en k planos de bytes, sin armarlos (13/11/2026)."""
    return sum(int(np.frombuffer(raw, np.uint8, count=n, offset=j * n).sum(dtype=np.uint64)) << (8 * j) for j in range(k))


def _sum_unzig(raw, k, n, chunk=1 << 18):
    """Suma de los n valores zigzag guardados en k planos, de a tramos para no ocupar memoria (13/11/2026)."""
    total = 0
    for a in range(0, n, chunk):
        b = min(n, a + chunk)
        out = np.zeros((b - a, 8), np.uint8)
        for j in range(k):
            out[:, j] = np.frombuffer(raw, np.uint8, count=b - a, offset=j * n + a)
        total += int(unzig(out.view('<u8').reshape(-1)).sum())
    return total


def append_tape(path, meta, t, p, q, side, rpi, level=9):
    """Suma trades al final de un dia ya guardado sin decodificarlo entero (13/11/2026).

    No esta en ingest.py y no cambia el formato: el archivo queda byte a byte igual al que daria write_tape
    con todos los trades. write_tape necesita el dia entero en memoria, varias veces (BTC: 2.7 millones de
    trades, unos 250 MB), y el collector de la nube, con 512 MB, se reiniciaba por falta de memoria. Aqui
    se unen los planos de bytes de cada columna: unos 40 MB con BTC.
    t, p, q, side y rpi son los trades nuevos ya ordenados por hora. Devuelve el total de trades, o None si
    el primero es anterior al ultimo guardado: entonces hay que unir y ordenar todo con write_tape."""
    b = open(path, 'rb').read()
    assert b[:4] == MAGIC
    hl = struct.unpack_from('<I', b, 4)[0]
    old = json.loads(b[8:8 + hl]); o = 8 + hl; n = old['n']; m = len(t)
    raw = {}
    for s in old['sections']:
        raw[s['name']] = (zlib.decompress(b[o:o + s['zlen']]), s['planes']); o += s['zlen']
    del b
    t_last = old['t0'] + _sum_planes(*raw['dt'], n)
    if m and int(t[0]) < t_last:
        return None
    p_last = old['p0'] + _sum_unzig(*raw['dp'], n) if m else old['p0']
    secs = []
    blobs = []
    new_cols = (('dt', np.diff(t, prepend=t_last).astype(np.uint64)),
                ('dp', zig(np.diff(p, prepend=p_last).astype(np.int64))),
                ('q', q.astype(np.uint64)))
    for name, arr in new_cols:
        data, k_old = raw.pop(name)
        k_new, new_planes = planes_encode(arr)
        k = max(k_old, k_new)
        merged = bytearray(k * (n + m))
        for j in range(k):
            base = j * (n + m)
            if j < k_old:
                merged[base:base + n] = data[j * n:(j + 1) * n]
            if j < k_new:
                merged[base + n:base + n + m] = new_planes[j * m:(j + 1) * m]
        del data
        z = zlib.compress(merged, level); secs.append({'name': name, 'planes': k, 'zlen': len(z)}); blobs.append(z)
        del merged
    for name, arr in (('side', side > 0), ('rpi', rpi > 0)):
        data, _ = raw.pop(name)
        bits = np.concatenate([np.unpackbits(np.frombuffer(data, np.uint8))[:n].astype(bool), np.asarray(arr, bool)])
        z = zlib.compress(np.packbits(bits).tobytes(), level); secs.append({'name': name, 'planes': 0, 'zlen': len(z)}); blobs.append(z)
    meta = dict(meta, n=n + m, t0=int(old['t0']), p0=int(old['p0']), sections=secs, t_unit='1e-4s')
    head = json.dumps(meta, separators=(',', ':')).encode()
    tmp = str(path) + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(MAGIC + struct.pack('<I', len(head)) + head)
        for z in blobs:
            f.write(z)
    os.replace(tmp, path)
    return n + m


def read_meta(path):
    """Solo la cabecera (rapido: no descomprime los trades)."""
    with open(path, 'rb') as f:
        b = f.read(8)
        assert b[:4] == MAGIC
        hl = struct.unpack_from('<I', b, 4)[0]
        return json.loads(f.read(hl))


def read_tape(path):
    b = open(path, 'rb').read()
    assert b[:4] == MAGIC
    hl = struct.unpack_from('<I', b, 4)[0]
    meta = json.loads(b[8:8 + hl]); o = 8 + hl; n = meta['n']; cols = {}
    for s in meta['sections']:
        raw = zlib.decompress(b[o:o + s['zlen']]); o += s['zlen']
        if s['planes']:
            cols[s['name']] = planes_decode(raw, s['planes'], n)
        else:
            cols[s['name']] = np.unpackbits(np.frombuffer(raw, np.uint8))[:n].astype(bool)
    t = np.cumsum(cols['dt'].astype(np.int64)) + meta['t0']
    p = np.cumsum(unzig(cols['dp'])) + meta['p0']
    return meta, t, p, cols['q'].astype(np.int64), np.where(cols['side'], 1, -1).astype(np.int8), cols['rpi']
