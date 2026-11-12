# Pruebas sin conexion del servicio VWAP del backend de la Watchlist (App 2 y App 7).
# No llama a Bybit: las velas salen de una funcion falsa que reemplaza a _fetch_klines.
# Se corren con run_checks.py, que las lanza sobre una copia temporal del backend.
import asyncio
import os
import sys
import time
from pathlib import Path

TEST_DIR = Path(sys.argv[1]).resolve()
os.chdir(TEST_DIR)
sys.path.insert(0, str(TEST_DIR))
(TEST_DIR / "config").mkdir(exist_ok=True)

import vwap_service as vs  # noqa: E402

assert Path(vs.CONFIG_DIR).resolve() == TEST_DIR / "config", f"config fuera de la copia de prueba: {vs.CONFIG_DIR}"

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


def step_ms(interval):
    return {"D": 86_400_000, "W": 604_800_000}.get(interval) or int(interval) * 60_000


def make_candles(interval, count, last_open):
    step = step_ms(interval)
    out = []
    for i in range(count):
        ts = last_open - (count - 1 - i) * step
        base = 100 + (i % 50) * 0.3 + (i // 50) * 0.1
        out.append({"timestamp": ts, "open": base, "high": base + 1.0 + (i % 3) * 0.2, "low": base - 0.8,
                    "close": base + 0.3, "volume": 10 + (i % 11), "turnover": 1000.0})
    return out


async def main():
    svc = vs.get_vwap_service()
    fetches = []

    async def fake_fetch(symbol, interval, total_needed=None, stop_at_ts=None, first_limit=None, max_pages=None):
        fetches.append({"symbol": symbol, "interval": interval, "total": total_needed, "stop": stop_at_ts})
        step = step_ms(interval)
        last_closed = (int(time.time() * 1000) // step) * step - step
        if total_needed is not None:
            return make_candles(interval, total_needed, last_closed), True
        count = max(0, (last_closed - stop_at_ts) // step)
        return make_candles(interval, int(count), last_closed), True

    svc._fetch_klines = fake_fetch

    def spacing(points):
        return {points[i + 1]["timestamp"] - points[i]["timestamp"] for i in range(len(points) - 1)}

    # 1. Cada moneda y timeframe con su propio estado
    p15 = await svc.ensure_vwap_data("BTCUSDT", "15", days=1)
    p60 = await svc.ensure_vwap_data("BTCUSDT", "60", days=1)
    check("15m: un dia son 96 puntos cada 15 minutos", len(p15) == 96 and spacing(p15) == {900_000}, f"{len(p15)} {spacing(p15)}")
    check("60m pedido despues de 15m devuelve puntos de 60m", len(p60) == 24 and spacing(p60) == {3_600_000}, f"{len(p60)} {spacing(p60)}")
    again15 = svc.get_vwap_data("BTCUSDT", "15")
    check("15m sigue con sus puntos despues de pedir 60m", len(again15) == 96 and spacing(again15) == {900_000})
    check("cada punto trae vwap y bandas", all(p.get("vwap") and "bands" in p for p in p15[-5:]))

    # 2. No se recarga lo que ya esta cargado
    before = len([f for f in fetches if f["total"] is not None])
    await svc.ensure_vwap_data("BTCUSDT", "15", days=1)
    await svc.ensure_vwap_data("BTCUSDT", "60", days=1)
    after = len([f for f in fetches if f["total"] is not None])
    check("pedir de nuevo la misma clave no repite la carga completa", before == after == 2, f"{before} -> {after}")
    await svc.ensure_vwap_data("BTCUSDT", "15", days=3)
    full = [f for f in fetches if f["total"] is not None]
    check("pedir mas dias si recarga esa clave", len(full) == 3 and full[-1]["interval"] == "15" and full[-1]["total"] == 288, str(full[-1]))
    check("y la clave queda con los 3 dias", len(svc.get_vwap_data("BTCUSDT", "15")) == 288)

    # 3. Otra moneda no toca a la primera
    eth = await svc.ensure_vwap_data("ETHUSDT", "15", days=1)
    check("otra moneda tiene su propio estado", len(eth) == 96 and len(svc.get_vwap_data("BTCUSDT", "15")) == 288)

    # 4. Ultimo punto por clave
    latest15 = svc.get_latest_vwap("BTCUSDT", "15")
    latest60 = svc.get_latest_vwap("BTCUSDT", "60")
    check("ultimo punto por timeframe",
          latest15 and latest60
          and latest15["timestamp"] == svc.get_vwap_data("BTCUSDT", "15")[-1]["timestamp"]
          and latest60["timestamp"] == svc.get_vwap_data("BTCUSDT", "60")[-1]["timestamp"])
    check("clave que no existe: sin datos", svc.get_latest_vwap("DOGEUSDT", "15") is None and svc.get_vwap_data("DOGEUSDT", "15") == [])

    # 5. Tipo de VWAP por clave
    await svc.ensure_vwap_data("BTCUSDT", "60", days=1, vwap_type="rolling", rolling_period=20)
    info60 = svc.get_key_info("BTCUSDT", "60") or {}
    info15 = svc.get_key_info("BTCUSDT", "15") or {}
    check("cambiar el tipo de VWAP afecta solo a esa clave",
          info60.get("vwapType") == "rolling" and info15.get("vwapType") != "rolling", f"{info60.get('vwapType')} / {info15.get('vwapType')}")

    # 6. Intervalo invalido
    try:
        await svc.ensure_vwap_data("BTCUSDT", "[object Promise]", days=1)
        rejected = False
    except ValueError:
        rejected = True
    check("intervalo invalido: rechazado", rejected)

    # 7. Una carga grande no detiene al resto del backend
    lag = {"max": 0.0}
    stop = asyncio.Event()

    async def ticker():
        last = time.perf_counter()
        while not stop.is_set():
            await asyncio.sleep(0.01)
            now = time.perf_counter()
            lag["max"] = max(lag["max"], now - last - 0.01)
            last = now

    task = asyncio.create_task(ticker())
    t0 = time.perf_counter()
    big = await svc.ensure_vwap_data("SOLUSDT", "1", days=7)
    elapsed = time.perf_counter() - t0
    stop.set()
    await task
    check("1m con 7 dias: 10,080 puntos", len(big) == 10_080, str(len(big)))
    check("1m con 7 dias tarda menos de 5 s", elapsed < 5.0, f"{elapsed:.2f}s")
    check("mientras calcula, el resto del backend no espera mas de 0.5 s", lag["max"] < 0.5, f"{lag['max']:.3f}s")
    print(f"      (1m con 7 dias: {elapsed:.2f} s; espera maxima del resto: {lag['max']:.3f} s)")


asyncio.run(main())
failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} de {len(results)} pruebas pasan")
sys.exit(1 if failed else 0)
