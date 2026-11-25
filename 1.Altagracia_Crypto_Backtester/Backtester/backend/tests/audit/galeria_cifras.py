"""
Protocolo (23/11/2026), galería de elementos: el número que va al pie de cada caso de los elementos de volumen, para
juzgar sin adivinar a ojo cuánto volumen tuvo la vela de la señal (pedido del usuario: "las del volumen alto no tiene
graficado el volumen entonces no puedo saber si es real o no").

- Volumen alto (VH): se calcula aparte, con las velas de la corrida: el volumen de la vela contra el medio de las velas
  de su misma hora en los 30 días anteriores (la regla de liq_sweeps._volume_events). Avisa si no llega a 2.
- Flecha (RF): las veces el volumen mediano de su hora que guardó el trade (`rv.times`).
- VPA: lo que guardó el trade de su elemento (`elements`): volumen y rango contra la mediana de su hora, medidor y grado.

Escribe evidencia/pantalla/G_<clave>/cifras.json ({número de trade: texto}), que lee galeria_html.py. Solo lee la copia
aislada (ORDERFLOW_OBSERVER), sin tocar el registro del usuario.

24/11 (galería 2 con el motor 7, O-37: en las capturas no se leía lo que decide el lector): con el argumento "m7", las
cifras de los casos nuevos del lector VPA, en G7_<clave>/cifras.json, sacadas de sus velas con vpa.compute: el volumen
contra su hora y contra las 20 velas anteriores, el rango, el medidor en la vela anterior y en la de la señal y lo propio
de cada elemento (las velas del frenado o del clímax, la ruptura del retroceso, el frenado o clímax y la caja de la
prueba, y el pico del medidor que gira).

Uso (desde backend/, con el python del .venv de App 1): python -B tests/audit/galeria_cifras.py [m7]
"""
import json
import os
import sys
from pathlib import Path

os.environ["ORDERFLOW_OBSERVER"] = r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado"
os.environ["TESTER_AUTO_UPDATE"] = "0"
BACKEND = Path(__file__).resolve().parents[2]
os.chdir(BACKEND)  # CANDLE_DIR es relativa al backend
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import galeria_html as g  # noqa: E402
import liq_sweeps  # noqa: E402
import rule_tester as rt  # noqa: E402
import vpa  # noqa: E402

CODES = ("VH", "RF", "QA", "QB", "QF", "QR", "QT", "QS", "QC", "QE")


def chosen_numbers(code):
    files = sorted((g.SHOTS / f"G_{code}").glob("trade_[0-9][0-9][0-9][0-9].jpg"))
    items = []
    for i, img in enumerate(files, 1):
        meta_path = img.with_suffix(".json")
        meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        items.append({"i": i, "side": g.caption(meta)[1], "n": int(img.stem.split("_")[1])})
    return [it["n"] for it in g.pick(items, g.PER_ELEMENT)]


def hour_ratio(bars, t, tf_ms):
    """El volumen de la vela t contra el medio de las de su misma hora en los 30 días anteriores (y cuántas son)."""
    slot = (t % liq_sweeps.DAY_MS) // tf_ms
    here = next(b for b in bars if b["t"] == t)
    past = [b["vol"] for b in bars
            if (b["t"] % liq_sweeps.DAY_MS) // tf_ms == slot and t - liq_sweeps.LOOKBACK_DAYS * liq_sweeps.DAY_MS <= b["t"] < t]
    return (here["vol"] / (sum(past) / len(past)) if past else None), len(past)


def vpa_text(e):
    parts = []
    if e.get("rv") is not None:
        parts.append(f"volumen {e['rv']:.1f} veces la mediana de su hora")
    if e.get("rr") is not None:
        parts.append(f"rango {e['rr']:.1f} veces")
    if e.get("meter") is not None:
        parts.append(f"medidor {e['meter']:+.2f}")
    if e.get("grade") is not None:
        parts.append(f"grado {round(e['grade'] * 100)}%")
    return " · ".join(parts)


def main():
    runs = json.loads(g.RUNS.read_text(encoding="utf-8"))
    for code in CODES:
        result = rt.load_run(runs[code]["run"])
        trades = {t["n"]: t for t in result["trades"]}
        tf_ms = result["rule"]["tf"] * 60000
        bars = None
        out = {}
        for n in chosen_numbers(code):
            t = trades[n]
            if code == "VH":
                if bars is None:
                    bars = rt._replay(result)["span"]["bars"]
                ratio, count = hour_ratio(bars, t["signal"], tf_ms)
                out[str(n)] = f"volumen {ratio:.1f} veces el medio de su hora ({count} velas de 30 días)"
                if ratio < liq_sweeps.VOLUME_TIMES:
                    print(f"  ⚠ {code} trade {n}: {ratio:.2f} < {liq_sweeps.VOLUME_TIMES}")
            elif code == "RF":
                out[str(n)] = f"volumen {t['rv']['times']:.1f} veces la mediana de su hora"
            else:
                e = next((x for x in t.get("elements") or [] if x.get("code") == code), None)
                if e:
                    out[str(n)] = vpa_text(e)
        (g.SHOTS / f"G_{code}" / "cifras.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        print(code, json.dumps(out, ensure_ascii=False))


CO = -5 * 3600000  # Hora de Colombia, como el pie de cada caso


def when(t):
    import datetime
    d = datetime.datetime.fromtimestamp((t + CO) / 1000, datetime.timezone.utc)
    return d.strftime("%d/%m/%y %H:%M")


def times(x, near):
    """Volumen (o rango) contra su hora y contra las 20 velas anteriores."""
    out = f"{x:.1f} veces su hora" if x == x else "sin su hora"
    return out + (f" y {near:.1f} veces las 20 velas anteriores" if near == near else "")


def vpa_m7(code, t, ctx, s, k):
    """Lo que decide el lector en la vela k de la señal, en palabras (motor 7)."""
    T, H, L = ctx["T"], ctx["H"], ctx["L"]
    cfg = vpa._cfg(rt._vpa_cfg(t.get("_rule") or {}))
    meter = f"medidor {s['meter'][k - 1]:+.2f} → {s['meter'][k]:+.2f}"
    e = next((x for x in t.get("elements") or [] if x.get("code") == code), {})
    grade = f"grado {round(e['grade'] * 100)}%" if e.get("grade") is not None else ""
    vol = f"volumen {times(s['rv'][k], s['rvn'][k])}"
    if code in ("QA", "QV"):
        prev = s["wide"][k - 1]
        extra = f"rango {times(s['rr'][k], s['rrn'][k])}"
        if code == "QA":
            extra += f" · la vela anterior, ancha {round(prev * 100)}%" if prev == prev else ""
        return " · ".join(x for x in (vol, extra, grade, meter) if x)
    if code == "QB":
        return " · ".join(x for x in (vol, f"nivel roto {e.get('level')}", grade, meter) if x)
    if code == "QR":
        b = e.get("breakout")
        kb = T.index(b) if b in T else None
        brk = f"ruptura {when(b)} (volumen {times(s['rv'][kb], s['rvn'][kb])})" if kb is not None else ""
        return " · ".join(x for x in (brk, f"volumen medio del retroceso {e.get('rv', float('nan')):.2f} veces su hora", grade, meter) if x)
    if code == "QT":
        turn = e.get("turn")
        box = f"caja {s['boxLow'][k]:.1f}–{s['boxHigh'][k]:.1f}" if s["boxLow"][k] == s["boxLow"][k] else ""
        return " · ".join(x for x in (vol, f"tras el frenado o clímax del {when(turn)}" if turn else "", box, grade, meter) if x)
    if code in ("QS", "QC"):
        g_ = e.get("leg") or (-t["dir"])
        span = range(k - int(cfg["stopBars"]) + 1, k + 1) if code == "QS" else range(max(0, k - int(cfg["climaxBars"]) + 1), k + 1)
        parts = []
        for j in span:
            wick = s["lower"][j] if g_ < 0 else s["upper"][j]
            if code == "QS":
                loc = s["closeLoc"][j]
                side_loc = loc if g_ < 0 else 1 - loc
                ok = min(vpa.up(wick, *cfg["stopWick"]), vpa.up(side_loc, 0.45, 0.55), vpa.up(s["rvHi"][j], *cfg["volHigh"])) >= cfg["fire"]
            else:
                ok = min(vpa.up(s["rvHi"][j], *cfg["volUltra"]), vpa.up(wick, 0.25, 0.4)) >= cfg["fire"]
            if ok:
                parts.append(f"{when(T[j])}: mecha {round(wick * 100)}% de la vela, volumen {times(s['rv'][j], s['rvn'][j])}")
        return " · ".join([("velas del frenado o techo " if code == "QS" else "velas del clímax ") + "; ".join(parts), meter])
    if code == "QG":
        return f"el medidor llegó a {e.get('peak', float('nan')):+.2f} y cruzó el cero: {meter}"
    if code == "QE":
        return f"{meter}: cruza el umbral de ±{cfg['meter']:g}"
    return " · ".join(x for x in (vol, grade, meter) if x)


def main_m7():
    runs = json.loads(g.RUNS_M7.read_text(encoding="utf-8"))
    # El cruce del medidor: hasta el medidor que lee la vela ancha (wideMeter) eran sus 4 casos de siempre, recapturados
    # con el panel alto en G_QE (O-37); desde entonces tiene su corrida del motor 7
    if "QE" not in runs:
        runs["QE"] = {"run": json.loads(g.RUNS.read_text(encoding="utf-8"))["QE"]["run"], "chosen": [13, 75, 88, 125], "folder": "G_QE"}
    for code in ("QA", "QV", "QB", "QR", "QT", "QS", "QC", "QG", "QE"):
        if code not in runs:
            continue
        result = rt.load_run(runs[code]["run"])
        ctx = rt._replay(result)["ctx"]
        rule = rt.saved_rule(result)
        T = ctx["T"]
        s = vpa.compute(T, ctx["O"], ctx["H"], ctx["L"], ctx["C"], ctx["V"], ctx["tf"], rt._vpa_cfg(rule))
        trades = {t["n"]: t for t in result["trades"]}
        out = {}
        for n in runs[code]["chosen"]:
            t = {**trades[n], "_rule": rule}
            k = T.index(t["signal"])
            out[str(n)] = vpa_m7(code, t, ctx, s, k)
        folder = g.SHOTS / runs[code].get("folder", f"G7_{code}")
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "cifras.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        print(code, json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main_m7() if sys.argv[1:] == ["m7"] else main()
