# Pruebas sin conexion del servicio Swing del backend de Order Flow.
# No abre sockets ni llama a Bybit ni al bot: todo va con objetos falsos.
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
BASE_CONFIG = {
    "enabled": True,
    "symbols": ["BTCUSDT", "ETHUSDT"],
    "interval": "15",
    "days": 5,
    "swingBars": 5,
    "cooldownMinutes": 5,
    "alertsEnabled": True,
    "symbolConfigs": {"BTCUSDT": {"cooldownMinutes": 20}},
}


def reset_files(config=None):
    for name in ("swing_cooldowns.json", "swing_config.json", "swing_config.json.tmp", "swing_cooldowns.json.tmp"):
        p = CONFIG_DIR / name
        if p.exists():
            p.unlink()
    (CONFIG_DIR / "swing_config.json").write_text(json.dumps(config or BASE_CONFIG), encoding="utf-8")


reset_files()

import swing_service as ss  # noqa: E402
import websocket_manager as wm  # noqa: E402

assert Path(ss.CONFIG_DIR).resolve() == CONFIG_DIR, f"config fuera de la copia de prueba: {ss.CONFIG_DIR}"

M15 = 15 * 60 * 1000
results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


def make_service(config=None):
    reset_files(config)
    svc = ss.SwingService()
    svc.running = True
    svc._service_start_time = time.time() - 10_000
    sent = []

    async def fake_send(signal):
        sent.append(signal)
        return True

    svc._send_alert = fake_send
    return svc, sent


def signal(symbol="BTCUSDT", age_ms=5 * M15, direction="LONG"):
    return ss.SwingSignal(
        signal_type="SWING_LOW" if direction == "LONG" else "SWING_HIGH",
        timestamp=int(time.time() * 1000) - age_ms,
        price=100.0,
        volume_zscore=2.0,
        direction=direction,
        symbol=symbol,
        interval="15",
    )


class FakeWS:
    def __init__(self, candles):
        self.candles = candles
        self.subscribed = []

    def get_candles(self, symbol, interval, limit=None):
        return list(self.candles)

    async def add_subscriptions(self, symbols, intervals):
        self.subscribed.append((tuple(symbols), tuple(intervals)))

    def preload_historical(self, *a, **k):
        pass


class FakeDetector:
    def __init__(self, signals):
        self.signals = signals
        self.calls = []

    def detect(self, **kwargs):
        self.calls.append(kwargs)
        return list(self.signals)


def candle_series(count, last_ts, step=M15, forming_extra=False, drop_index=None):
    out = []
    for i in range(count):
        ts = last_ts - (count - 1 - i) * step
        out.append({"timestamp": ts, "open": 100 + i, "high": 101 + i, "low": 99 + i, "close": 100.5 + i,
                    "volume": 10 + (i % 7), "turnover": 1000.0, "confirm": True})
    if drop_index is not None:
        del out[drop_index]
    if forming_extra:
        out.append({"timestamp": last_ts + step, "open": 1, "high": 1, "low": 1, "close": 1, "volume": 1,
                    "turnover": 1.0, "confirm": False})
    return out


class Closed:
    def __init__(self, ts):
        self.timestamp = ts
        self.close = 100.0


async def main():
    # 1. Cooldown propio de la moneda
    svc, sent = make_service()
    now = time.time()
    svc._cooldowns = {"BTCUSDT_LONG": now - 600, "ETHUSDT_LONG": now - 600}
    await svc._process_signal(signal("BTCUSDT"))
    check("cooldown de la moneda (BTC 20 min) bloquea a los 10 min", len(sent) == 0)
    await svc._process_signal(signal("ETHUSDT"))
    check("cooldown global (5 min) deja pasar a los 10 min", len(sent) == 1 and sent[0].symbol == "ETHUSDT")

    # 2. Cooldowns guardados y recuperados
    saved = json.loads((CONFIG_DIR / "swing_cooldowns.json").read_text(encoding="utf-8"))
    check("el cooldown queda guardado en disco", "ETHUSDT_LONG" in saved and abs(saved["ETHUSDT_LONG"] - time.time()) < 5)
    check("no queda archivo temporal", not list(CONFIG_DIR.glob("*.tmp")))
    saved["VIEJO_LONG"] = time.time() - 90_000
    (CONFIG_DIR / "swing_cooldowns.json").write_text(json.dumps(saved), encoding="utf-8")
    svc2 = ss.SwingService()
    check("al reiniciar se recupera el cooldown reciente", "ETHUSDT_LONG" in svc2._cooldowns)
    check("al reiniciar se descarta el de mas de un dia", "VIEJO_LONG" not in svc2._cooldowns)

    # 3. Senales viejas
    svc, sent = make_service()
    await svc._process_signal(signal("ETHUSDT", age_ms=(5 + 3) * M15 + 60_000))
    check("senal mas vieja que swingBars+3 velas no va al bot (BLOCKED_STALE)", len(sent) == 0)
    await svc._process_signal(signal("ETHUSDT", age_ms=(5 + 3) * M15 - 60_000))
    check("senal dentro del margen si va al bot", len(sent) == 1)

    # 4. Periodo de arranque (propio del backend de Order Flow)
    svc, sent = make_service()
    svc._service_start_time = time.time()
    await svc._process_signal(signal("ETHUSDT"))
    check("durante el arranque no se manda nada (BLOCKED_WARMUP)", len(sent) == 0)

    # 5. Cierre de vela: indice por la hora, hueco y vela siguiente ya en el buffer
    last_ts = (int(time.time() * 1000) // M15) * M15 - M15

    async def run_close(candles, vwap_enabled=False, vwap_points=None):
        cfg = json.loads(json.dumps(BASE_CONFIG))
        if vwap_enabled:
            cfg["symbolConfigs"]["BTCUSDT"]["vwapFilter"] = {"enabled": True}
        svc, _ = make_service(cfg)
        svc.ws_manager = FakeWS(candles)
        swing_ts = last_ts - 5 * M15
        det = FakeDetector([ss.SwingSignal("SWING_LOW", swing_ts, 100.0, 2.0, "LONG", "BTCUSDT", "15")])
        svc.detector = det
        processed = []

        async def fake_process(sig):
            processed.append(sig)

        svc._process_signal = fake_process
        asked = []

        class FakeVwap:
            async def ensure_vwap_data(self, symbol, interval=None, days=None, **kwargs):
                asked.append((symbol, interval, days))
                return vwap_points or []

        original = ss.get_vwap_service
        ss.get_vwap_service = lambda: FakeVwap()
        try:
            await svc._on_candle_close("BTCUSDT", "15", Closed(last_ts))
        finally:
            ss.get_vwap_service = original
        det.vwap_asked = asked
        return processed, det

    processed, _ = await run_close(candle_series(40, last_ts))
    check("cierre normal: se procesa el swing recien confirmado", len(processed) == 1)
    processed, _ = await run_close(candle_series(40, last_ts, forming_extra=True))
    check("con la vela siguiente ya en el buffer se ubica el mismo swing", len(processed) == 1)
    processed, _ = await run_close(candle_series(40, last_ts, drop_index=36))
    check("con un hueco entre el swing y el cierre no se manda (BLOCKED_GAP)", len(processed) == 0)

    # 6. Filtro VWAP
    processed, det = await run_close(candle_series(40, last_ts), vwap_enabled=True, vwap_points=[])
    check("filtro VWAP activo y sin VWAP: no se detecta ni se manda (BLOCKED_NO_VWAP)",
          len(processed) == 0 and len(det.calls) == 0)
    pts = [{"timestamp": last_ts, "vwap": 100.0, "bands": {}}]
    processed, det = await run_close(candle_series(40, last_ts), vwap_enabled=True, vwap_points=pts)
    check("filtro VWAP activo con VWAP: el detector recibe ese VWAP",
          len(det.calls) == 1 and det.calls[0].get("vwap_data") == pts)
    check("el Swing pide el VWAP de su propio timeframe, con al menos 3 dias",
          det.vwap_asked == [("BTCUSDT", "15", ss.VWAP_FILTER_MIN_DAYS)] and ss.VWAP_FILTER_MIN_DAYS >= 3,
          str(det.vwap_asked))
    processed, det = await run_close(candle_series(40, last_ts))
    check("filtro VWAP apagado: el detector no recibe VWAP ni se pide",
          len(det.calls) == 1 and det.calls[0].get("vwap_data") is None and det.vwap_asked == [])

    # 8. Intervalo invalido
    svc, _ = make_service()
    reanalyze_calls = []

    async def fake_reanalyze():
        reanalyze_calls.append(1)

    svc.reanalyze_historical = fake_reanalyze
    ok = svc.update_config({"interval": "[object Promise]", "cooldownMinutes": 7})
    await asyncio.sleep(0)
    check("intervalo invalido: no se guarda y el resto si",
          ok and svc.config.interval == "15" and svc.config.cooldownMinutes == 7 and not reanalyze_calls)
    disk = json.loads((CONFIG_DIR / "swing_config.json").read_text(encoding="utf-8"))
    check("intervalo invalido: el archivo conserva el intervalo anterior", disk["interval"] == "15")
    ok = svc.update_config({"interval": 60})
    await asyncio.sleep(0)
    check("intervalo valido: se guarda como texto y re-analiza", ok and svc.config.interval == "60" and len(reanalyze_calls) == 1)
    check("guardado atomico: sin temporales y JSON valido",
          not list(CONFIG_DIR.glob("*.tmp")) and json.loads((CONFIG_DIR / "swing_config.json").read_text(encoding="utf-8"))["interval"] == "60")

    # 9. Alerta: origen y hora de envio
    reset_files()
    svc = ss.SwingService()

    class Resp:
        status_code = 200

    class Client:
        def __init__(self):
            self.calls = []

        async def post(self, url, json=None):
            self.calls.append((url, json))
            return Resp()

    svc._http_client = Client()
    sent_ok = await svc._send_alert(signal("ETHUSDT"))
    url, payload = svc._http_client.calls[0]
    check("la alerta sale con origen ORDERFLOW y sent_at",
          sent_ok and payload["origin"] == "ORDERFLOW" and abs(payload["sent_at"] - time.time() * 1000) < 3000
          and payload["symbol"] == "ETHUSDT" and payload["interval"] == "15")
    svc.config.alertsEnabled = False
    sent_ok = await svc._send_alert(signal("ETHUSDT"))
    check("con las alertas apagadas no se manda", sent_ok is False and len(svc._http_client.calls) == 1)

    # 10. Un re-analisis a la vez
    svc, _ = make_service()
    svc.running = False
    state = {"active": 0, "max": 0, "runs": 0}

    async def slow_analyze(delay_seconds=0):
        state["active"] += 1
        state["max"] = max(state["max"], state["active"])
        state["runs"] += 1
        await asyncio.sleep(0.05)
        state["active"] -= 1

    svc._analyze_historical = slow_analyze
    await asyncio.gather(svc.reanalyze_historical(), svc.reanalyze_historical(), svc.reanalyze_historical())
    check("re-analisis: uno a la vez y una sola repeticion", state["max"] == 1 and state["runs"] == 2, str(state))

    # 11. Senales solo para dibujar
    svc, sent = make_service()
    svc.detector = FakeDetector([ss.SwingSignal("SWING_HIGH", last_ts - 10 * M15, 105.0, 1.0, "SHORT", "BTCUSDT", "60")])
    before_cfg = json.dumps(ss.asdict(svc.config), sort_keys=True)
    shown = svc.compute_display_signals("BTCUSDT", "60", candle_series(60, last_ts))
    check("senales para dibujar: marcadas displayOnly",
          len(shown) == 1 and shown[0]["displayOnly"] is True and shown[0]["interval"] == "60")
    check("senales para dibujar: no guardan ni cambian la config ni mandan",
          svc._recent_signals == {} and json.dumps(ss.asdict(svc.config), sort_keys=True) == before_cfg and not sent)
    check("interval_to_ms", ss.interval_to_ms("15") == M15 and ss.interval_to_ms("D") == 86_400_000 and ss.interval_to_ms("x") == 0)

    # 12. Buffer de velas del WebSocket
    buf = wm.CandleBuffer()

    def c(ts, confirm=True):
        return wm.Candle(timestamp=ts, open=1, high=2, low=0.5, close=1.5, volume=3, turnover=4, confirm=confirm)

    r1 = buf.add_or_update(c(2 * M15))
    r2 = buf.add_or_update(c(3 * M15))
    r_old = buf.add_or_update(c(1 * M15))
    check("buffer: una vela vieja entra en orden y no cuenta como cierre",
          r1 is True and r2 is True and r_old is False and [k.timestamp for k in buf.candles] == [M15, 2 * M15, 3 * M15])
    r_open = buf.add_or_update(c(4 * M15, confirm=False))
    r_close = buf.add_or_update(c(4 * M15, confirm=True))
    check("buffer: el cierre de la vela en curso se avisa una vez", r_open is False and r_close is True)
    buf2 = wm.CandleBuffer()
    buf2.preload_candles([c(i * M15) for i in range(1, 2000)])
    buf2.preload_candles([c(i * M15) for i in range(1500, 2100)])
    stamps = [k.timestamp for k in buf2.candles]
    check("buffer: precarga sin duplicados y en orden", stamps == sorted(set(stamps)))

    mgr = wm.WebSocketManager()
    now_ms = int(time.time() * 1000)
    current = (now_ms // M15) * M15
    mgr.preload_historical("BTCUSDT", "15", [
        {"timestamp": current - 2 * M15, "open": 1, "high": 2, "low": 1, "close": 1, "volume": 1},
        {"timestamp": current - M15, "open": 1, "high": 2, "low": 1, "close": 1, "volume": 1},
        {"timestamp": current, "open": 1, "high": 2, "low": 1, "close": 1, "volume": 1},
    ])
    loaded = mgr.get_candles("BTCUSDT", "15")
    check("precarga: la vela en curso no queda marcada como cerrada",
          [k["confirm"] for k in loaded] == [True, True, False], str([k["confirm"] for k in loaded]))


asyncio.run(main())
failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} de {len(results)} pruebas pasan")
sys.exit(1 if failed else 0)
