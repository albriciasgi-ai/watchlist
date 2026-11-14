# Pruebas sin conexion de la suma al final del dia (append_tape, 13/11/2026):
#   - el archivo queda byte a byte igual al de la union completa de antes (leer, unir, ordenar y write_tape);
#   - planos que crecen, horas iguales en el borde, trades nuevos desordenados, sin trades nuevos y cierre del dia;
#   - un trade anterior al ultimo guardado no se suma al final: se une todo como antes;
#   - con el archivo real de BTC del dia (si esta en este PC), el mismo resultado y cuanta memoria usa cada forma.
# Uso, desde 5.Order_flow/cloud_collector:  python -B tests/tape_append_checks.py
import shutil
import sys
import tempfile
import tracemalloc
from array import array
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import tape_recorder as tr  # noqa: E402
from tape_format import append_tape, read_meta, read_tape, write_tape  # noqa: E402

results = []
rng = np.random.default_rng(7)
TMP = Path(tempfile.mkdtemp(prefix="tape_append_"))
META = dict(symbol="BTCUSDT", date="2026-11-13", price_scale=10, qty_scale=1000, source="bybit-ws-collector",
            ts_decimals=3, covered_from=1, saved_at=2, gaps=[], complete=False, final=False, inexact=0)


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


def trades(n, t_start, p_start, dt_max=50, dp_max=5, q_max=1000):
    t = (t_start + np.cumsum(rng.integers(0, dt_max + 1, n))).astype(np.int64)
    p = (p_start + np.cumsum(rng.integers(-dp_max, dp_max + 1, n))).astype(np.int64)
    q = rng.integers(1, q_max + 1, n).astype(np.int64)
    side = np.where(rng.random(n) < 0.5, 1, -1).astype(np.int8)
    rpi = (rng.random(n) < 0.1).astype(np.int8)
    return t, p, q, side, rpi


def as_buffer(cols):
    """Como los arreglos que entrega DayBuffer.take()."""
    t, p, q, side, rpi = cols
    return array('q', t.tolist()), array('q', p.tolist()), array('q', q.tolist()), array('b', side.tolist()), array('b', rpi.tolist())


def old_way(path, meta, new, level):
    """La union completa de antes del 13/11: leer el dia, unir, ordenar y reescribir con write_tape."""
    t, p, q, side, rpi = (np.frombuffer(a, dtype=np.int64 if a.typecode == 'q' else np.int8) for a in new)
    _, t0, p0, q0, s0, r0 = read_tape(path)
    t = np.concatenate([t0, t]); p = np.concatenate([p0, p]); q = np.concatenate([q0, q])
    side = np.concatenate([s0.astype(np.int8), side]); rpi = np.concatenate([r0.astype(np.int8), rpi])
    del t0, p0, q0, s0, r0
    order = np.argsort(t, kind="stable")
    write_tape(path, meta, t[order], p[order], q[order], side[order], rpi[order], level=level)
    return len(t)


def same_as_before(name, old_cols, new_cols, level=6, meta2=None):
    d = Path(tempfile.mkdtemp(dir=TMP))
    a, b = d / "nuevo.tape", d / "antes.tape"
    write_tape(a, META, *old_cols, level=6)
    shutil.copy(a, b)
    meta2 = meta2 or dict(META, saved_at=3)
    rec = tr.TapeRecorder(["BTCUSDT"], d)
    n = rec._merge_write(a, meta2, as_buffer(new_cols), level)
    n_old = old_way(b, meta2, as_buffer(new_cols), level)
    check(name, a.read_bytes() == b.read_bytes() and n == n_old == len(old_cols[0]) + len(new_cols[0]),
          f"n={n} antes={n_old} bytes {a.stat().st_size} vs {b.stat().st_size}")


try:
    old = trades(1000, 10_000_000, 700_000)
    same_as_before("1000 guardados y 200 nuevos: igual byte a byte", old, trades(200, int(old[0][-1]) + 3, int(old[1][-1])))
    old = trades(1001, 10_000_000, 700_000)
    same_as_before("guardados que no son multiplo de 8 (bits de compra/venta): igual", old, trades(7, int(old[0][-1]) + 1, int(old[1][-1])))
    old = trades(500, 10_000_000, 700_000, dt_max=200)
    new = trades(50, int(old[0][-1]) + 70_000, int(old[1][-1]))
    same_as_before("hora: los nuevos necesitan mas planos (salto de 7 s): igual", old, new)
    old = trades(500, 10_000_000, 700_000, dp_max=3)
    same_as_before("precio: los nuevos se mueven mucho mas (mas planos): igual", old,
                   trades(50, int(old[0][-1]) + 5, int(old[1][-1]) + 40_000, dp_max=30_000))
    old = trades(500, 10_000_000, 700_000, q_max=200)
    same_as_before("cantidad: los nuevos son mucho mayores (mas planos): igual", old,
                   trades(50, int(old[0][-1]) + 5, int(old[1][-1]), q_max=5_000_000))
    old = trades(300, 10_000_000, 700_000)
    new = trades(40, int(old[0][-1]), int(old[1][-1]))
    new[0][:3] = old[0][-1]
    same_as_before("el primer nuevo a la misma hora que el ultimo guardado: igual", old, new)
    old = trades(300, 10_000_000, 700_000)
    new = trades(60, int(old[0][-1]) + 2, int(old[1][-1]), dt_max=3)
    perm = rng.permutation(60)
    same_as_before("nuevos desordenados entre ellos (y con horas repetidas): igual", old, tuple(c[perm] for c in new))
    old = trades(1, 10_000_000, 700_000)
    same_as_before("un solo trade guardado: igual", old, trades(5, int(old[0][-1]) + 1, int(old[1][-1])))
    old = trades(400, 10_000_000, 700_000)
    empty = tuple(np.zeros(0, c.dtype) for c in old)
    same_as_before("sin trades nuevos, cierre del dia (otra cabecera y compresion 9): igual", old, empty, level=9,
                   meta2=dict(META, saved_at=4, final=True, complete=True))

    # un trade anterior al ultimo guardado: no se suma al final y el archivo no se toca
    old = trades(300, 10_000_000, 700_000)
    d = Path(tempfile.mkdtemp(dir=TMP))
    path = d / "x.tape"
    write_tape(path, META, *old, level=6)
    before = path.read_bytes()
    late = trades(10, int(old[0][-1]) - 500, int(old[1][-1]))
    order = np.argsort(late[0], kind="stable")
    r = append_tape(path, META, *(c[order] for c in late), level=6)
    check("un trade anterior al ultimo guardado no se suma al final (y el archivo no cambia)",
          r is None and path.read_bytes() == before, str(r))
    same_as_before("ese caso se une y se ordena todo, como antes: igual", old, late)

    # el archivo real de BTC de hoy bajado de la nube (si esta en este PC)
    real = sorted(Path.home().joinpath("OrderFlowData", "live", "cloud", "tape", "BTCUSDT").rglob("BTCUSDT_*.tape"))
    if real:
        src = real[-1]
        meta0 = read_meta(src)
        d = Path(tempfile.mkdtemp(dir=TMP))
        a, b = d / "nuevo.tape", d / "antes.tape"
        shutil.copy(src, a); shutil.copy(src, b)
        # 5 minutos de trades nuevos despues del ultimo guardado
        _, t0, p0, _, _, _ = read_tape(src)
        t_last, p_last = int(t0[-1]), int(p0[-1])
        del t0, p0
        new = as_buffer(trades(25_000, t_last + 10, p_last, dt_max=24))
        meta2 = dict(META, symbol="BTCUSDT", date=meta0.get("date"), saved_at=5)
        rec = tr.TapeRecorder(["BTCUSDT"], d)
        tracemalloc.start()
        tracemalloc.reset_peak()
        n = rec._merge_write(a, meta2, new, 6)
        peak_new = tracemalloc.get_traced_memory()[1]
        tracemalloc.reset_peak()
        n_old = old_way(b, meta2, new, 6)
        peak_old = tracemalloc.get_traced_memory()[1]
        tracemalloc.stop()
        print(f"      {src.name}: {meta0['n']:,} trades guardados; memoria: suma al final {peak_new / 2**20:.0f} MB,"
              f" union completa {peak_old / 2**20:.0f} MB")
        check("con el archivo real de BTC del dia: igual byte a byte", a.read_bytes() == b.read_bytes() and n == n_old, f"{n} vs {n_old}")
        check("con el archivo real de BTC: la suma al final usa menos de un tercio de la memoria", peak_new * 3 < peak_old,
              f"{peak_new / 2**20:.0f} vs {peak_old / 2**20:.0f} MB")
    else:
        print("      (sin el archivo de BTC de la nube en este PC: se salta la prueba con el dia real)")
finally:
    shutil.rmtree(TMP, ignore_errors=True)

ok = sum(1 for _, passed in results if passed)
print(f"\n{ok} de {len(results)} pruebas pasan")
sys.exit(0 if ok == len(results) else 1)
