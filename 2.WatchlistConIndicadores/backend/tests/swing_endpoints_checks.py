# Pruebas sin conexion de los endpoints del Swing en main.py del backend de la Watchlist (App 2 y App 7).
# No arranca el servidor ni sus servicios: llama a las funciones de los endpoints directamente.
# Se corren con run_checks.py, que las lanza sobre una copia temporal del backend.
import asyncio
import json
import os
import sys
import time
from pathlib import Path

TEST_DIR = Path(sys.argv[1]).resolve()
os.chdir(TEST_DIR)
sys.path.insert(0, str(TEST_DIR))

CONFIG_DIR = TEST_DIR / "config"
CONFIG_DIR.mkdir(exist_ok=True)
for name in ("swing_cooldowns.json", "swing_config.json"):
    p = CONFIG_DIR / name
    if p.exists():
        p.unlink()
(CONFIG_DIR / "swing_config.json").write_text(json.dumps({
    "enabled": True, "symbols": ["BTCUSDT", "ETHUSDT"], "interval": "15", "days": 5,
    "swingBars": 5, "cooldownMinutes": 5, "alertsEnabled": True, "symbolConfigs": {},
}), encoding="utf-8")

import main  # noqa: E402
import swing_service as ss  # noqa: E402

assert Path(ss.CONFIG_DIR).resolve() == CONFIG_DIR

M15 = 15 * 60 * 1000
H1 = 60 * 60 * 1000
results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


class Req:
    def __init__(self, body):
        self._body = body

    async def json(self):
        return json.loads(json.dumps(self._body))


async def run():
    svc = main.get_swing_service()
    reanalyzed = []

    async def fake_reanalyze():
        reanalyzed.append(time.time())

    svc.reanalyze_historical = fake_reanalyze

    # --- monedas vigiladas
    r = await main.update_swing_symbol_config("DOGEUSDT", Req({"days": 3}))
    check("guardar la config de una moneda no vigilada no la agrega a las alertas",
          r["success"] and "DOGEUSDT" not in svc.config.symbols and r.get("monitored") is False)
    check("ni dispara un re-analisis", len(reanalyzed) == 0)
    check("pero si guarda sus dias", svc.config.symbolConfigs["DOGEUSDT"]["days"] == 3)

    r = await main.update_swing_symbol_config("DOGEUSDT", Req({"monitor": True}))
    check("monitor true la agrega y re-analiza", r["success"] and "DOGEUSDT" in svc.config.symbols and len(reanalyzed) == 1)
    check("monitor no queda guardado como ajuste de la moneda", "monitor" not in svc.config.symbolConfigs["DOGEUSDT"])

    r = await main.update_swing_symbol_config("DOGEUSDT", Req({"days": 3}))
    check("guardar el mismo valor no re-analiza", r["success"] and len(reanalyzed) == 1)
    r = await main.update_swing_symbol_config("DOGEUSDT", Req({"days": 4}))
    check("cambiar los dias de una moneda vigilada si re-analiza", r["success"] and len(reanalyzed) == 2)
    r = await main.update_swing_symbol_config("DOGEUSDT", Req({"cooldownMinutes": 20}))
    check("cambiar el cooldown no re-analiza", r["success"] and len(reanalyzed) == 2
          and svc.config.get_symbol_config("DOGEUSDT")["cooldownMinutes"] == 20)

    r = await main.update_swing_symbol_config("DOGEUSDT", Req({"monitor": False}))
    check("monitor false la quita y re-analiza", r["success"] and "DOGEUSDT" not in svc.config.symbols and len(reanalyzed) == 3)
    disk = json.loads((CONFIG_DIR / "swing_config.json").read_text(encoding="utf-8"))
    check("el archivo refleja la lista de monedas", disk["symbols"] == ["BTCUSDT", "ETHUSDT"])

    r = await main.update_swing_symbol_config("..\\x", Req({"monitor": True}))
    check("simbolo invalido: rechazado", r["success"] is False and len(svc.config.symbols) == 2)
    r = await main.update_swing_symbol_config("btcusdt", Req({"swingBars": 5}))
    check("simbolo en minusculas se normaliza", r["success"] and "BTCUSDT" in svc.config.symbolConfigs
          and "btcusdt" not in svc.config.symbolConfigs)

    # --- senales
    svc._recent_signals = {"BTCUSDT": [
        {"type": "SWING_LOW", "timestamp": 1000, "price": 1.0, "interval": "15"},
        {"type": "SWING_HIGH", "timestamp": 2000, "price": 2.0, "interval": "15"},
    ]}
    hist_calls = []
    now_ms = int(time.time() * 1000)

    async def fake_historical(symbol, interval="15", days=30, since_timestamp=None):
        hist_calls.append((symbol, interval, days))
        step = H1 if interval == "60" else 60_000
        last = (now_ms // step) * step
        data = []
        for i in range(120):
            ts = last - (119 - i) * step
            data.append({"timestamp": ts, "open": 100, "high": 101 + (i % 9), "low": 99 - (i % 5),
                         "close": 100.5, "volume": 10 + i, "in_progress": ts == last})
        return {"success": True, "data": data}

    main.get_historical = fake_historical
    seen_candles = []
    original_compute = svc.compute_display_signals

    def spy_compute(symbol, interval, candles):
        seen_candles.append(list(candles))
        return original_compute(symbol, interval, candles)

    svc.compute_display_signals = spy_compute

    svc.running = True
    r = await main.get_swing_signals("BTCUSDT", interval="15", days=5)
    check("mismo timeframe, moneda vigilada y servicio activo: senales del servicio",
          r["success"] and r["displayOnly"] is False and r["count"] == 2 and r["alertsInterval"] == "15" and not hist_calls)
    r = await main.get_swing_signals("BTCUSDT")
    check("sin interval (cliente viejo): se comporta como antes", r["success"] and r["count"] == 2 and r["displayOnly"] is False)
    r = await main.get_swing_signals("BTCUSDT", since=1500, interval="15", days=5)
    check("since filtra las senales del servicio", r["count"] == 1)

    cfg_before = json.dumps(ss.asdict(svc.config), sort_keys=True)
    r = await main.get_swing_signals("BTCUSDT", interval="60", days=30)
    check("otro timeframe: senales solo para dibujar",
          r["success"] and r["displayOnly"] is True and r["monitored"] is True and r["alertsInterval"] == "15"
          and all(s.get("displayOnly") for s in r["signals"]))
    check("pide el historico del timeframe del grafico", hist_calls == [("BTCUSDT", "60", 30)], str(hist_calls))
    check("no usa la vela en curso", seen_candles and len(seen_candles[0]) == 119 and not any(c.get("in_progress") for c in seen_candles[0]))
    check("no cambia la config ni las senales del servicio",
          json.dumps(ss.asdict(svc.config), sort_keys=True) == cfg_before and len(svc._recent_signals["BTCUSDT"]) == 2)
    r = await main.get_swing_signals("BTCUSDT", interval="60", days=30)
    check("segunda consulta en 60 s: usa la cache, sin pedir de nuevo", len(hist_calls) == 1 and r["displayOnly"] is True)

    r = await main.get_swing_signals("SOLUSDT", interval="15", days=5)
    check("moneda no vigilada en el timeframe de las alertas: solo para dibujar",
          r["success"] and r["displayOnly"] is True and r["monitored"] is False)
    r = await main.get_swing_signals("BTCUSDT", interval="1", days=90)
    check("1m con 90 dias: se limita al tope del servicio", hist_calls[-1] == ("BTCUSDT", "1", ss.validate_days_for_interval(90, "1")),
          str(hist_calls[-1]))
    r = await main.get_swing_signals("BTCUSDT", interval="[object Promise]", days=5)
    check("intervalo invalido: rechazado sin pedir historico", r["success"] is False and len(hist_calls) == 3)
    r = await main.get_swing_signals("BTC/../X", interval="60", days=5)
    check("simbolo invalido en senales: rechazado", r["success"] is False)

    svc.running = False
    r = await main.get_swing_signals("BTCUSDT", interval="15", days=5)
    check("servicio detenido: senales solo para dibujar", r["success"] and r["displayOnly"] is True)


asyncio.run(run())
failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} de {len(results)} pruebas pasan")
sys.exit(1 if failed else 0)
