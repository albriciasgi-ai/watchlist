# verificar.py - Comprobar una lectura del entrenamiento con los datos reales (solo lectura).
#
# Lo usa el skill /entrenar: dada una moneda, un marco y la hora de una vela (hora de Colombia), dice lo que de verdad
# tuvo esa vela (delta, volumen, POC, imbalances, stacked), los Elementos OF que marcó (con AB, BL y LD del libro si
# hay libro grabado) y, si se pide, lo que hizo el precio en las velas siguientes. No escribe nada.
#
# Uso, desde la raíz del repositorio:
#   python -B .claude/skills/entrenar/verificar.py BTCUSDT 15 "2026-11-14 10:15" [--despues 3] [--nivel 65500]
#   (la hora es la de apertura de la vela, en hora de Colombia; también acepta milisegundos UTC)
import argparse
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
APP1 = ROOT / "1.Altagracia_Crypto_Backtester" / "Backtester" / "backend"
SUITE = ROOT / "12.AltagraciaTradingSuite" / "server"
COL = timezone(timedelta(hours=-5))
MIN = 60000

sys.path.insert(0, str(APP1))
os.chdir(APP1)   # los lectores de App 1 usan rutas relativas
import footprint_store  # noqa: E402
import of_elements  # noqa: E402


def parse_time(text):
    if text.isdigit():
        return int(text)
    dt = datetime.strptime(text, "%Y-%m-%d %H:%M").replace(tzinfo=COL)
    return int(dt.timestamp() * 1000)


def col(ms):
    return datetime.fromtimestamp(ms / 1000, COL).strftime("%Y-%m-%d %H:%M")


def book_events(symbol, frame, start, end, known):
    """AB, BL y LD de la suite, si hay libro grabado en esas horas. [] si no."""
    try:
        sys.path.append(str(SUITE))
        import book_events as be
        import book_store
        base = book_store.sources(Path(footprint_store.STORE_DIR).parent)
        return be.detect(base, symbol, frame, start, end, known)
    except Exception as e:  # sin la suite o sin libro
        return [{"code": "?", "error": str(e)[:120]}]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("symbol")
    ap.add_argument("interval", type=int, help="minutos: 1, 5, 15, 60, 240")
    ap.add_argument("time", help='"AAAA-MM-DD HH:MM" hora de Colombia, o ms UTC')
    ap.add_argument("--despues", type=int, default=0, help="velas siguientes a mostrar")
    ap.add_argument("--nivel", type=float, default=None, help="precio a vigilar en las velas siguientes")
    a = ap.parse_args()

    frame = a.interval * MIN
    t = parse_time(a.time)
    t -= t % frame
    now = int(datetime.now(timezone.utc).timestamp() * 1000)
    end = t + frame * (a.despues + 1)
    res = footprint_store.footprints(a.symbol.upper(), a.interval, t, end - 1, known_until_ms=now, live=True)
    fps = {f["candle_timestamp"]: f for f in res.get("footprints", [])}
    f = fps.get(t)
    if not f:
        print(f"Sin footprint para {a.symbol} {a.interval}m a las {col(t)} (¿fuera del almacén o vela sin cerrar?)")
        return 1
    o, h, l, c = f["candle_open"], f["candle_high"], f["candle_low"], f["candle_close"]
    vol, delta = f["total_volume"], f["total_delta"]
    color = "verde" if c > o else "roja" if c < o else "doji"
    side = "compra" if delta > 0 else "venta" if delta < 0 else "empate"
    rng = (h - l) or 1
    poc_pos = (f["poc_price"] - l) / rng
    poc_txt = "arriba" if poc_pos > 2 / 3 else "abajo" if poc_pos < 1 / 3 else "en el medio"
    imb = f.get("imbalances") or []
    buy_imb = sum(1 for i in imb if (i.get("type") or i.get("side") or "").lower() in ("buy", "ask", "compra"))
    stacked = f.get("stacked_imbalances") or []
    print(f"{a.symbol} {a.interval}m · vela de las {col(t)} (Colombia) · {'parcial' if f.get('gap') or not f.get('complete', True) else 'completa'}")
    print(f"  O {o}  H {h}  L {l}  C {c}  ·  vela {color}")
    print(f"  Delta {delta:+.3f} ({side} ganó) · volumen {vol:.3f} · delta/volumen {100 * delta / vol if vol else 0:+.1f}%"
          + ("  · DELTA CONTRA EL COLOR" if (c > o and delta < 0) or (c < o and delta > 0) else ""))
    print(f"  POC {f['poc_price']} ({poc_txt} de la vela) · step {f['step_size']} · {f['num_levels']} niveles")
    print(f"  Imbalances: {len(imb)} (de compra {buy_imb}, de venta {len(imb) - buy_imb}) · stacked: {len(stacked)}")
    for s in stacked[:5]:
        print(f"    stacked {s}")

    el = of_elements.detect(a.symbol.upper(), a.interval, t, t + frame, now, live=True)
    codes = [e for e in el.get("events", []) if e.get("t") == t]
    codes += [e for e in book_events(a.symbol.upper(), a.interval, t, t + frame, now) if e.get("t") == t or e.get("code") == "?"]
    if codes:
        print("  Elementos OF en esta vela:")
        for e in codes:
            if e.get("code") == "?":
                print(f"    (libro no disponible: {e['error']})")
                continue
            name = of_elements.CATALOG.get(e["code"], [e["code"]])[0] if hasattr(of_elements, "CATALOG") else e["code"]
            d = "alcista" if e.get("dir", 0) > 0 else "bajista" if e.get("dir", 0) < 0 else ""
            zone = f" {e['lo']}–{e['hi']}" if e.get("lo") is not None else ""
            print(f"    {e['code']} {name} {d}{zone}")
    else:
        print("  Elementos OF en esta vela: ninguno")

    if a.despues:
        print(f"  Después ({a.despues} velas):")
        hi, lo = h, l
        for k in range(1, a.despues + 1):
            g = fps.get(t + k * frame)
            if not g:
                print(f"    +{k}: sin datos")
                continue
            hi, lo = max(hi, g["candle_high"]), min(lo, g["candle_low"])
            touch = ""
            if a.nivel is not None and g["candle_low"] <= a.nivel <= g["candle_high"]:
                touch = f"  · tocó {a.nivel}"
            print(f"    +{k} {col(g['candle_timestamp'])}: C {g['candle_close']} ({100 * (g['candle_close'] - c) / c:+.2f}% desde el cierre) "
                  f"· delta {g['total_delta']:+.2f}{touch}")
        print(f"    Máximo {hi} ({100 * (hi - c) / c:+.2f}%) · mínimo {lo} ({100 * (lo - c) / c:+.2f}%)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
