# Pruebas sin conexion del grabador de Hyperliquid (hl_recorder.py, 21/11/2026), con respuestas armadas a mano.
# Uso, desde 12.AltagraciaTradingSuite/server:  python -B tests/hl_checks.py
import asyncio
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import hl_recorder as hl  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


# ---------- monedas ----------
check("BTCUSDT es BTC", hl.hl_coin("BTCUSDT") == "BTC")
check("1000PEPEUSDT es kPEPE", hl.hl_coin("1000PEPEUSDT") == "kPEPE")
check("SHIB1000USDT es kSHIB", hl.hl_coin("SHIB1000USDT") == "kSHIB")

# ---------- estado por moneda ----------
META = [{"universe": [{"name": "BTC"}, {"name": "ETH"}, {"name": "DOGE"}]},
        [{"markPx": "60000", "openInterest": "100", "funding": "0.0001", "oraclePx": "60010", "premium": "-0.0002", "dayNtlVlm": "5e9"},
         {"markPx": "3000", "openInterest": "1000", "funding": "-0.00005", "oraclePx": "3001", "premium": "0", "dayNtlVlm": "1e9"},
         {"markPx": "0.2", "openInterest": "1", "funding": "0", "oraclePx": "0.2", "premium": "0", "dayNtlVlm": "1"}]]
ctx = hl.parse_ctx(META, {"BTC", "ETH"})
check("solo las monedas pedidas", set(ctx) == {"BTC", "ETH"})
check("OI en USD", ctx["BTC"]["oi_usd"] == 6_000_000.0 and ctx["ETH"]["funding"] == -0.00005)

# ---------- ballenas ----------
def lb(address, value, vol):
    return {"ethAddress": address, "accountValue": value, "windowPerformances": [["day", {"vlm": "1"}], ["month", {"vlm": vol}]]}


ROWS = [lb("0xAAA", "100", "9e9"), lb("0xbbb", "5000", "1"), lb("x", "9e9", "9e12"), lb("0xccc", "0", "9e12"), lb("0xddd", "300", "5")]
w = hl.top_wallets(ROWS, 2, 1)
check("las de más capital y las más activas, en minúsculas y sin direcciones malas",
      [x[0] for x in w] == ["0xbbb", "0xddd", "0xaaa"], w)
check("sin repetir", len(hl.top_wallets(ROWS, 5, 5)) == 3)

# ---------- posiciones ----------
STATE = {"assetPositions": [
    {"position": {"coin": "BTC", "szi": "-2", "entryPx": "61000", "liquidationPx": "66000", "leverage": {"value": 10}, "positionValue": "120000"}},
    {"position": {"coin": "ETH", "szi": "10", "entryPx": "2900", "liquidationPx": "2600", "leverage": {"value": 5}, "positionValue": "30000"}},
    {"position": {"coin": "SOL", "szi": "10", "entryPx": "100", "liquidationPx": "80", "leverage": {"value": 5}, "positionValue": "1000"}},
    {"position": {"coin": "BTC", "szi": "0", "entryPx": "1", "liquidationPx": None, "leverage": {"value": 1}, "positionValue": "0"}}]}
pos = hl.parse_positions("0xbbb", STATE, {"BTC", "ETH"})
check("solo monedas de la suite y tamaños distintos de cero", [p[1] for p in pos] == ["BTC", "ETH"], pos)
check("fila completa", pos[0] == ["0xbbb", "BTC", -2.0, 61000.0, 66000.0, 10.0, 120000.0], pos[0])

# ---------- mapa de liquidaciones ----------
P = [["a", "BTC", -2.0, 61000.0, 66000.0, 10.0, 120000.0],   # corto: se liquida arriba (+10%)
     ["b", "BTC", 1.0, 60000.0, 57000.0, 20.0, 60000.0],     # largo: abajo (-5%)
     ["c", "BTC", 1.0, 60000.0, 57050.0, 20.0, 40000.0],     # largo, misma franja de 0.25%
     ["d", "BTC", 1.0, 60000.0, 30000.0, 2.0, 99000.0],      # a -50%: fuera de la banda
     ["e", "BTC", 1.0, 60000.0, None, 1.0, 5000.0]]          # sin liquidación (cruzada sin riesgo)
m = hl.liq_map(P, 60000.0, 0.25)
check("largos abajo y cortos arriba", m["longs_usd"] == 100000.0 and m["shorts_usd"] == 120000.0, m)
below = [b for b in m["buckets"] if b["hi"] <= 60000]
check("las dos largas en la misma franja", len(below) == 1 and below[0]["long_usd"] == 100000.0 and below[0]["wallets"] == 2, below)
check("la franja contiene su precio", all(b["lo"] <= 57000 < b["hi"] for b in below))
check("sin precio, mapa vacío", hl.liq_map(P, None)["buckets"] == [])


# ---------- el grabador, con un HTTP falso ----------
class Resp:
    def __init__(self, data):
        self.data = data
        self.content = json.dumps(data).encode()

    def raise_for_status(self):
        pass

    def json(self):
        return self.data


class FakeHttp:
    def __init__(self):
        self.posts = []

    async def post(self, url, json=None, timeout=None):
        self.posts.append(json)
        if json["type"] == "metaAndAssetCtxs":
            return Resp(META)
        if json["user"] == "0xbad":
            raise RuntimeError("caída")
        return Resp(STATE)

    async def get(self, url, timeout=None):
        return Resp({"leaderboardRows": ROWS + [lb("0xBAD", "200", "7")]})


async def no_sleep(_):
    return None


async def run():
    with tempfile.TemporaryDirectory() as tmp:
        http = FakeHttp()
        clock = [1_795_000_000.0]
        rec = hl.HlRecorder(["BTCUSDT", "ETHUSDT"], Path(tmp), http, now=lambda: clock[0], sleep=no_sleep)
        await rec.ctx_once()
        day = hl.day_of(int(clock[0] * 1000))
        lines = (Path(tmp) / "live" / "hyperliquid" / "ctx" / f"{day}.jsonl").read_text().splitlines()
        check("estado anotado por día", len(lines) == 1 and set(json.loads(lines[0])["coins"]) == {"BTC", "ETH"})
        await rec.positions_once()
        check("sin ballenas no pide posiciones", len(http.posts) == 1)
        await rec.wallets_once()
        t, users = rec.wallets()
        check("ballenas guardadas", users[:2] == ["0xbbb", "0xddd"] and "0xbad" in users and "0xaaa" in users, users)
        await rec.positions_once()
        row = hl.last_line(Path(tmp) / "live" / "hyperliquid" / "positions" / f"{day}.jsonl")
        check("una cuenta caída no corta la vuelta", row["failed"] == 1 and row["wallets"] == len(users) - 1, row)
        check("posiciones de todas las que respondieron", len(row["positions"]) == 2 * (len(users) - 1))
        check("solo lectura: nada más que pedidos info", all(p["type"] in ("metaAndAssetCtxs", "clearinghouseState") for p in http.posts))
        st = rec.status()
        check("estado del grabador", st["positions"]["wallets_seen"] == len(users) - 1 and st["bytes"] > 0, st)
        # Vuelta rápida: solo las cuentas con alguna liquidación a menos de 10% del precio
        near = rec.near_wallets()
        check("cercanas: el corto de BTC a +10% entra", set(near) == set(rec.by_wallet), near)
        check("cercanas: con banda de 5% ninguna", rec.near_wallets(5.0) == [])
        before = len(rec.latest_positions)
        clock[0] += 60
        await rec.fast_once()
        fast = hl.last_line(Path(tmp) / "live" / "hyperliquid" / "fast" / f"{day}.jsonl")
        check("vuelta rápida anotada aparte", fast and fast["wallets"] == len(near), fast)
        check("la vista junta las dos sin repetir", len(rec.latest_positions) == before)
        check("gana la consulta más reciente", all(t == int(clock[0] * 1000) for t, _ in rec.by_wallet.values()))
        # Una vuelta completa posterior no borra lo que la rápida consultó después de que empezó
        rec.by_wallet["0xbbb"] = (int(clock[0] * 1000) + 999_999, [["0xbbb", "BTC", 1.0, 1.0, 59000.0, 50.0, 7.0]])
        await rec.positions_once()
        check("lo más reciente sobrevive a la vuelta completa", rec.by_wallet["0xbbb"][1][0][6] == 7.0)
        # Sin lista de cuentas, la vuelta vuelve a mirar en 30 s y no duerme los 15 minutos
        waits = []

        async def record_sleep(sec):
            waits.append(sec)
            if len(waits) >= 2:
                raise asyncio.CancelledError

        empty = hl.HlRecorder(["BTCUSDT"], Path(tmp) / "otra", http, now=lambda: clock[0], sleep=record_sleep)
        try:
            await empty._loop("positions", hl.POS_SECONDS, empty.positions_once)
        except asyncio.CancelledError:
            pass
        check("sin cuentas todavía, reintenta en 30 s", waits[-1] == 30.0, waits)
        rec.add("SOLUSDT")
        check("moneda agregada", "SOL" in rec.coins)
        # Un grabador nuevo retoma la última vuelta del día
        rec2 = hl.HlRecorder(["BTCUSDT"], Path(tmp), http, now=lambda: clock[0], sleep=no_sleep)
        await rec2.start()
        check("al arrancar retoma las posiciones de hoy", len(rec2.latest_positions) == len(row["positions"]))
        await rec2.stop()


asyncio.run(run())

bad = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(bad)} de {len(results)} pruebas pasaron")
sys.exit(1 if bad else 0)
