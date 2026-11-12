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
