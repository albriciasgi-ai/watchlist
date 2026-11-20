"""
Almacén de order flow de acciones de EE. UU. (Alpaca), en el mismo formato que el de las monedas (19/11/2026).

Pedido del usuario: llevar las acciones de la NYSE y el NASDAQ a App 1 para backtesting. Los trades salen del
conector de la suite (12.AltagraciaTradingSuite/server/alpaca_data.py, importado sin copiarlo): SIP con el lado
del agresor deducido (regla del tick de fábrica, Lee-Ready opcional) y sin las condiciones que no son agresión.

Solo la sesión regular (09:30 a 16:00 de Nueva York). Cada día UTC queda en:
  OrderFlowData/alpaca/trades/<SIM>/<día>_<método>.npz   trades crudos del día completo (los guarda el conector)
  OrderFlowData/alpaca/store/<SIM>/<AAAA>/<SIM>_<día>.npz  minuto × precio, como tools/build_store.py
  OrderFlowData/alpaca/flow/<SIM>/<AAAA>/<SIM>_<día>.npz   delta dentro del minuto y órdenes, como build_flow.py
Nunca escribe en el almacén de las monedas. footprint_store y of_elements leen estas carpetas para los
símbolos de acciones (sin USDT).

Formato: precio con 4 decimales (ps 10,000; hay trades a fracciones de centavo), celda de 0.01 USD (ticks 100),
cantidad con 2 decimales (qs 100; hay fracciones de acción). Un trade sin lado (el primero del día con la regla
del tick) va mitad y mitad, como en el conector.

Órdenes: en acciones, un barrido toca varios mercados con horas distintas (microsegundos), así que una orden son
los trades seguidos del mismo lado separados por ORDER_GAP_US o menos. Se guardan las que cruzan 3 precios o más
con SWEEP_USD o más, y las de BIG_USD o más.

Uso (claves de Alpaca en el config/suite.json de la suite, o SUITE_CONFIG con su ruta):
  python -B alpaca_store.py AAPL,SPY,NVDA 2026-10-07 2026-11-18 [tick|lee_ready] [--rebuild]
"""
import asyncio
import datetime as dt
import os
import sys
import time
from pathlib import Path

import numpy as np

DATA = Path(os.environ.get("ORDERFLOW_DATA", r"C:\Users\inven\OrderFlowData"))
ROOT = DATA / "alpaca"
STORE_DIR = Path(os.environ.get("ALPACA_STORE", str(ROOT / "store")))
FLOW_DIR = Path(os.environ.get("ALPACA_FLOW", str(ROOT / "flow")))

PRICE_SCALE = 10_000
QTY_SCALE = 100
CELL_TICKS = 100  # 0.01 USD
ORDER_GAP_US = 1_000  # trades del mismo lado a 1 ms o menos: una orden
SWEEP_PRICES = 3
SWEEP_USD = 100_000
BIG_USD = 500_000
TS_DECIMALS = 6  # microsegundos


def _suite():
    """El conector de la suite, con sus datos crudos en OrderFlowData/alpaca (no en la carpeta de la suite)."""
    server = Path(__file__).resolve().parents[3] / "12.AltagraciaTradingSuite" / "server"
    os.environ.setdefault("SUITE_DATA_DIR", str(DATA))
    if str(server) not in sys.path:
        sys.path.insert(0, str(server))
    import alpaca_data  # noqa: E402
    return alpaca_data


def rth_mask(t_us):
    """Sesión regular de Nueva York, con la regla del conector (horario de verano incluido)."""
    return _suite().session_mask(np.asarray(t_us, dtype=np.int64) // 1000, "rth")


def _sides(q, side):
    """Compra y venta de cada trade, en unidades de qs. Sin lado, mitad y mitad sin perder volumen."""
    half = q // 2
    buy = np.where(side > 0, q, np.where(side == 0, half, 0))
    return buy, q - buy


def build_store_day(t_us, p, s, side):
    """Arrays del almacén de un día (los de build_store.py), o None sin trades."""
    if len(t_us) == 0:
        return None
    t_us = np.asarray(t_us, dtype=np.int64)
    P = np.round(np.asarray(p, dtype=np.float64) * PRICE_SCALE).astype(np.int64)
    Q = np.round(np.asarray(s, dtype=np.float64) * QTY_SCALE).astype(np.int64)
    side = np.asarray(side, dtype=np.int8)
    buy_q, sell_q = _sides(Q, side)
    minute = t_us // 60_000_000
    st = np.r_[0, np.nonzero(np.diff(minute))[0] + 1]
    en = np.r_[st[1:], len(t_us)]
    level = P // CELL_TICKS
    lo = int(level.min())
    span = int(level.max()) - lo + 1
    row = np.repeat(np.arange(len(st)), en - st)
    key = row.astype(np.int64) * span + (level - lo)
    uniq, inv = np.unique(key, return_inverse=True)
    return dict(
        m=minute[st].astype(np.int64),
        o=P[st], h=np.maximum.reduceat(P, st), l=np.minimum.reduceat(P, st), c=P[en - 1],
        buy=np.add.reduceat(buy_q, st), sell=np.add.reduceat(sell_q, st), n=(en - st).astype(np.int32),
        cr=(uniq // span).astype(np.int32),
        cl=((uniq % span) + lo).astype(np.int64),
        cb=np.bincount(inv, weights=buy_q).astype(np.int64),
        cs=np.bincount(inv, weights=sell_q).astype(np.int64),
        cn=np.bincount(inv).astype(np.int32),
        info=np.array([PRICE_SCALE, QTY_SCALE, CELL_TICKS], dtype=np.int64),
    )


def build_flow_day(t_us, p, s, side):
    """Arrays del flujo de un día (los de build_flow.py), o None sin trades."""
    if len(t_us) == 0:
        return None
    t_us = np.asarray(t_us, dtype=np.int64)
    P = np.round(np.asarray(p, dtype=np.float64) * PRICE_SCALE).astype(np.int64)
    Q = np.round(np.asarray(s, dtype=np.float64) * QTY_SCALE).astype(np.int64)
    side = np.asarray(side, dtype=np.int8)
    buy_q, sell_q = _sides(Q, side)
    minute = t_us // 60_000_000
    st = np.r_[0, np.nonzero(np.diff(minute))[0] + 1]
    signed = buy_q - sell_q
    cum = np.cumsum(signed)
    base = np.r_[0, cum[st[1:] - 1]]
    within = cum - np.repeat(base, np.diff(np.r_[st, len(t_us)]))
    dmx = np.maximum(np.maximum.reduceat(within, st), 0)
    dmn = np.minimum(np.minimum.reduceat(within, st), 0)

    # Órdenes: trades con lado, seguidos, del mismo lado y a ORDER_GAP_US o menos del anterior
    ot = op0 = op1 = oq = on = osd = np.zeros(0, np.int64)
    k = np.nonzero(side != 0)[0]
    if len(k):
        tk, pk, qk, sk = t_us[k], P[k], Q[k], side[k]
        brk = np.r_[True, (np.diff(tk) > ORDER_GAP_US) | (np.diff(sk) != 0)]
        gs = np.nonzero(brk)[0]
        gq = np.add.reduceat(qk, gs)
        pmin = np.minimum.reduceat(pk, gs)
        pmax = np.maximum.reduceat(pk, gs)
        changes = np.r_[0, (np.diff(pk) != 0) & ~brk[1:]]
        nprices = np.add.reduceat(changes, gs) + 1
        usd = gq / QTY_SCALE * (pmin + pmax) / 2 / PRICE_SCALE
        keep = ((nprices >= SWEEP_PRICES) & (usd >= SWEEP_USD)) | (usd >= BIG_USD)
        ot = (tk[gs][keep] // 1000).astype(np.int64)  # milisegundos, como build_flow.py
        osd = sk[gs][keep].astype(np.int8)
        oq = gq[keep].astype(np.int64)
        op0 = pmin[keep].astype(np.int64)
        op1 = pmax[keep].astype(np.int64)
        on = nprices[keep].astype(np.int32)
    return dict(
        m=minute[st].astype(np.int64), dmx=dmx.astype(np.int64), dmn=dmn.astype(np.int64),
        ot=ot, os=osd, oq=oq, op0=op0, op1=op1, on=on,
        info=np.array([PRICE_SCALE, QTY_SCALE, 1, TS_DECIMALS], dtype=np.int64),
    )


def _path(root, symbol, day):
    return Path(root) / symbol / day[:4] / f"{symbol}_{day}.npz"


def _save(path, arrays):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.stem + ".tmp.npz")
    np.savez_compressed(tmp, **arrays)
    os.replace(tmp, path)


def write_day(symbol, day, trades, store_root=None, flow_root=None):
    """Escribe almacén y flujo de la sesión regular de un día. Devuelve los trades de la sesión."""
    t, p, s, side = trades["t"], trades["p"], trades["s"], trades["side"]
    keep = rth_mask(t) if len(t) else np.zeros(0, bool)
    t, p, s, side = t[keep], p[keep], s[keep], side[keep]
    store = build_store_day(t, p, s, side)
    if store is None:
        return 0
    _save(_path(store_root or STORE_DIR, symbol, day), store)
    _save(_path(flow_root or FLOW_DIR, symbol, day), build_flow_day(t, p, s, side))
    return int(len(t))


def weekdays(start, end):
    day = dt.date.fromisoformat(start)
    last = dt.date.fromisoformat(end)
    while day <= last:
        if day.weekday() < 5:
            yield day.isoformat()
        day += dt.timedelta(days=1)


async def run(symbols, start, end, method="tick", rebuild=False, workers=8):
    ad = _suite()
    if not ad.configured():
        raise SystemExit("Faltan las claves de Alpaca: config/suite.json de la suite o SUITE_CONFIG con su ruta.")
    jobs = [(sym, day) for sym in symbols for day in weekdays(start, end)
            if rebuild or not _path(STORE_DIR, sym, day).exists()]
    queue = asyncio.Queue()
    for job in jobs:
        queue.put_nowait(job)
    stats = {}
    t0 = time.time()

    async def worker():
        while not queue.empty():
            sym, day = queue.get_nowait()
            t1 = time.time()
            try:
                data = await ad.get_day(sym, day, method)
            except ad.AlpacaError as e:
                print(f"{sym} {day}: error de Alpaca {e.status}: {e}", flush=True)
                continue
            if not data["complete"]:
                print(f"{sym} {day}: el día aún no termina, se deja", flush=True)
                continue
            n = await asyncio.to_thread(write_day, sym, day, data)
            st = stats.setdefault(sym, {"days": 0, "trades": 0, "empty": 0})
            if n:
                st["days"] += 1
                st["trades"] += n
            else:
                st["empty"] += 1
            print(f"{sym} {day}: {n:,} trades en sesión ({len(data['t']):,} del día) en {time.time() - t1:.1f} s",
                  flush=True)

    await asyncio.gather(*(worker() for _ in range(max(1, workers))))
    print(f"Total: {round(time.time() - t0, 1)} s", flush=True)
    for sym, st in stats.items():
        size = lambda root: sum(f.stat().st_size for f in (Path(root) / sym).rglob("*.npz"))  # noqa: E731
        raw = sum(f.stat().st_size for f in (ROOT / "trades" / sym).glob("*.npz")) if (ROOT / "trades" / sym).exists() else 0
        print(f"{sym}: {st['days']} días, {st['trades']:,} trades, {st['empty']} sin sesión; "
              f"almacén {size(STORE_DIR) / 1e6:.1f} MB, flujo {size(FLOW_DIR) / 1e6:.1f} MB, crudo {raw / 1e6:.1f} MB",
              flush=True)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) < 3:
        raise SystemExit(__doc__)
    symbols = [x.strip().upper() for x in args[0].split(",") if x.strip()]
    method = args[3] if len(args) > 3 else "tick"
    if method not in ("tick", "lee_ready"):
        raise SystemExit("Método: tick o lee_ready")
    asyncio.run(run(symbols, args[1], args[2], method, "--rebuild" in sys.argv))


if __name__ == "__main__":
    main()
