"""
Protocolo (25/11/2026), galería 4 (order flow). El usuario pidió revisar qué capturas no traían los indicadores que hacen
falta para juzgar cada elemento, y corregirlas todas. En las del order flow faltaba casi todo:
- el footprint se dibujaba con unos 10 niveles por vela y sin cifras, y los elementos se calculan con el step de análisis
  (of_elements.analysis_step: de 1 a 10 USD en BTC 15m, según el precio): la celda que nombra el elemento no se veía;
- la tabla de la vela (delta, Máx Δ, Mín Δ, Δ/Vol) y el volumen quedaban fuera del recorte;
- y no se sabía cuánto daba el elemento contra su umbral relativo.

Con "cola" arma la cola de captura de la página 4 (evidencia/etapa7/cola_of.json): por caso, el step de análisis de su
vela y la zona del elemento, con los Elementos OF solo de ese código, los desequilibrios del elemento en los que los
usan y la imagen de cerca en los elementos de celdas (capa_bc.js: opts.of, closeUp).
Con "cifras", después de capturar, escribe G_<clave>/cifras.json: el valor del elemento contra su umbral (o el volumen
de la vela contra la mediana de las 20 anteriores, en los de vela de mucho volumen) y las celdas del footprint, con un
aviso si el servidor las dibujó más grandes (una vela de la vista pasaría de 200 niveles).

Solo lee el almacén y las corridas de la copia aislada (ORDERFLOW_OBSERVER).
Uso (desde backend/, con el python del .venv de App 1): python -B tests/audit/galeria_of.py cola|cifras [códigos]
"""
import datetime as dt
import json
import os
import re
import statistics
import sys
from pathlib import Path

os.environ["ORDERFLOW_OBSERVER"] = r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado"
os.environ["TESTER_AUTO_UPDATE"] = "0"
BACKEND = Path(__file__).resolve().parents[2]
os.chdir(BACKEND)
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import galeria_html as g  # noqa: E402
import of_elements as oe  # noqa: E402
import rule_tester as rt  # noqa: E402

MS = 15 * 60000
CODES = next(codes for slug, _, codes, _ in g.PAGES if slug == "4_orderflow")
# Los elementos de celdas: la imagen de cerca, con la zona del elemento ampliada para leer las cifras de cada celda
CLOSE_UP = ("RL", "EX", "ZP", "DT", "RS", "IV", "AD", "SW", "VL", "SQ", "ST", "IR", "RD", "VD", "TP", "RX",
            # 26/11: el barrido real y la orden grande, en velas de cientos de celdas, solo se leen de cerca ("no se ve el
            # footprint", galería 4)
            "BR", "GR")
# Los que se leen con los desequilibrios: el footprint los marca (diagonal de 4 a 1, apilados de 3); en los demás, no
IMBALANCES = ("ST", "VI", "IR", "RD", "IV")
VOLUME = tuple(oe.VOLUME_FILTERED)
SIGNAL = {"until": "signal", "before": 5, "after": 2, "longBars": 1000000000, "panels": True, "maxWidth": 170, "minBars": 8,
          "settle": 4000}
QUEUE = g.RUNS.parent / "cola_of.json"
# 26/11 (galería 4, motor 8): los elementos que cambiaron se corren otra vez (galeria_corridas_m8.py) y se capturan en
# G8_<código>, con la cola cola_of_m8.json
RUNS_M8 = g.RUNS.with_name("galeria_corridas_m8.json")
QUEUE_M8 = g.RUNS.parent / "cola_of_m8.json"


def chosen(code):
    """Los casos a la vista en la página (galeria_html.pick sobre los capturados)."""
    folder = g.SHOTS / f"G_{code}"
    files = sorted({folder / re.sub(r"_paneles(?=[.]jpg$)", "", f.name) for f in folder.glob("trade_[0-9][0-9][0-9][0-9]*.jpg")
                    if re.fullmatch(r"trade_[0-9]{4}(_paneles)?[.]jpg", f.name)})
    items = []
    for i, img in enumerate(files, 1):
        meta_path = img.with_suffix(".json")
        meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        items.append({"i": i, "side": g.caption(meta)[1], "n": int(img.stem.split("_")[1])})
    return [it["n"] for it in g.pick(items, g.PER_ELEMENT)]


def facts(code, result, trade):
    """El elemento en la vela de la señal, con of_elements.detect: su step de análisis, sus eventos (valor y umbral) y el
    volumen de la vela contra la mediana de las 20 anteriores."""
    rule = result["rule"]
    T = trade["signal"]
    got = oe.detect(result["symbol"], rule["tf"], T - 21 * MS, T + 3 * MS, T + 3 * MS, rule["target"], 0, rule["volFilter"])
    bars = got["bars"]
    k = next(i for i, b in enumerate(bars) if b["t"] == T)
    prev = [b["vol"] for b in bars[max(0, k - oe.VOLUME_BARS):k]]
    events = [e for e in got["events"] if e["code"] == code and e["known"] == trade["known"]]
    bar = bars[k]
    return {"step": bar["step"], "levels": (bar["h"] - bar["l"]) / bar["step"], "events": events, "bar": bar,
            "rel": bar["vol"] / statistics.median(prev) if len(prev) == oe.VOLUME_BARS else None}


def shared_rows(symbol, tf, t_ms):
    """Las celdas de la recarga: desequilibrios al mismo precio en la vela de la señal y en la anterior, como detect."""
    day = dt.datetime.fromtimestamp(t_ms / 1000, dt.timezone.utc).date()
    bars = oe._load_bars(symbol, tf, day - dt.timedelta(days=1), 10 ** 12) + oe._load_bars(symbol, tf, day, 10 ** 12)
    k = next(i for i, b in enumerate(bars) if b["t"] == t_ms)
    f, p = bars[k], bars[k - 1]
    mine = {oe._row_price(f, i) for i in f.get("imb_rows", [])}
    return sorted(mine & {oe._row_price(p, i) for i in p.get("imb_rows", [])})


def targets(only, m8=False):
    """(código, corrida, casos, carpeta) de lo que se captura: las corridas de la página (G_<código>) o, con m8, las del
    motor 8 (G8_<código>, con sus casos de galeria_corridas_m8.py)."""
    if m8:
        runs8 = json.loads(RUNS_M8.read_text(encoding="utf-8"))
        return [(code, info["run"], info["chosen"], f"G8_{code}") for code, info in runs8.items() if not only or code in only]
    runs = json.loads(g.RUNS.read_text(encoding="utf-8"))
    return [(code, runs[code]["run"], chosen(code), f"G_{code}") for code in CODES if not only or code in only]


def queue(only, m8=False):
    out = []
    for code, run_id, picked, folder in targets(only, m8):
        result = rt.load_run(run_id)
        trades = {t["n"]: t for t in result["trades"]}
        steps, zones, befores = {}, {}, {}
        for n in picked:
            f = facts(code, result, trades[n])
            steps[n] = f["step"]
            lo, hi = trades[n].get("zone") or [None, None]
            if lo is None and f["events"]:
                lo, hi = min(e["lo"] for e in f["events"]), max(e["hi"] for e in f["events"])
            zones[n] = [float(lo), float(hi)]
            # 26/11 (galería 4): el Thin Print marca cada celda suya y la recarga, cada celda que comparte con la vela anterior;
            # el marco de antes iba del primer al último y tomaba celdas parejas de en medio (TP 3823, RD 593 y 2072)
            if code == "TP" and f["events"]:
                zones[n] = [[float(e["lo"]), float(e["hi"])] for e in f["events"]]
            elif code == "RD":
                zones[n] = [[float(a), float(b)] for a, b in shared_rows(result["symbol"], result["rule"]["tf"], trades[n]["signal"])] or zones[n]
            elif code == "RL" and f["events"]:
                # La absorción del motor 8: el marco en la celda de cada intento, en su vela, y la imagen de cerca desde el
                # primero (capa_bc.js: la hora de cada zona y closeBefores)
                e = f["events"][0]
                zones[n] = [[float(e["lo"]), float(e["hi"]), int(e["t0"])], [float(e["lo"]), float(e["hi"])]]
                befores[n] = max(2, round((trades[n]["signal"] - e["t0"]) / MS) + 1)
            print(code, n, "celdas de", f["step"], "zona", zones[n], f"({(hi - lo) / f['step']:.0f} celdas)", flush=True)
        opts = {**SIGNAL, "of": {"codes": [code], "steps": steps, "zones": zones, "closeUp": code in CLOSE_UP,
                                 "imbalances": code in IMBALANCES, "levels": 26}}
        if befores:
            opts["before"] = max(SIGNAL["before"], max(befores.values()) + 3)
            opts["of"]["closeBefores"] = befores
            opts["of"]["closeWidth"] = 220
        out.append({"name": folder, "run": run_id, "only": sorted(steps), "linesName": "lineas_of", "opts": opts})
    path = QUEUE_M8 if m8 else QUEUE
    path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print("cola:", path, len(out), "elementos,", sum(len(x["only"]) for x in out), "casos")


def pct(x):
    return f"{x * 100:.1f}%"


def small_pct(x):
    """En %, con dos cifras significativas si es menos de 1% (el Small Min/Max Delta queda cerca de 0)."""
    v = x * 100
    return "0%" if v == 0 else (f"{v:.1f}%" if abs(v) >= 1 else f"{v:.2g}%")


def num(x):
    """Dos decimales, o dos cifras significativas si es chico (el pasivo del extremo va de 0.001 a 0.01)."""
    return f"{x:.2g}" if abs(x) < 0.1 else f"{x:.2f}"


def usd(x):
    return f"{x / 1e6:.2f} M USD" if x >= 1e6 else f"{x / 1e3:.0f} K USD"


def text(code, f):
    """Lo que decide el elemento, en palabras: su valor contra su umbral relativo, o lo que pide."""
    e = f["events"][0] if f["events"] else {}
    v, thr = e.get("value"), e.get("thr")
    vol = f"volumen de la vela: {f['rel']:.1f} veces la mediana de las 20 anteriores (pide 2)" if f["rel"] is not None else ""
    if code == "VI":
        return f"{int(v)} desequilibrios a favor (pide 3) · {vol}"
    if code == "TP":
        return f"{len(f['events'])} {'celda interior' if len(f['events']) == 1 else 'celdas interiores'} sin contrapartida · {vol}"
    if code in VOLUME:
        return vol
    b = f.get("bar") or {}
    rng = (b.get("h", 0) - b.get("l", 0)) or None
    if code == "DT" and rng:
        # Motor 8: la mecha donde empieza la vela, al menos la mitad de su rango
        wick = (min(b["o"], b["c"]) - b["l"]) if b["c"] > b["o"] else (b["h"] - max(b["o"], b["c"]))
        return f"mecha donde empieza la vela: {wick / rng:.0%} de su rango (pide la mitad o más), con delta en contra"
    green = b.get("c", 0) > b.get("o", 0)
    if code == "IV" and rng:
        # Motor 8 (of_elements._closes_toward): el cierre en la mitad de su rango hacia su color
        return (f"cierra al {(b['c'] - b['l']) / rng:.0%} de su rango desde el mínimo: en la mitad de "
                f"{'arriba, la de una verde' if green else 'abajo, la de una roja'}")
    if code == "DD" and rng:
        # Sin valor ni umbral: el extremo de 5 velas y el delta de su color; desde el motor 8, sin hacer los dos extremos
        return (f"hace el {'mínimo' if green else 'máximo'} de 5 velas (y no el {'máximo' if green else 'mínimo'}), con delta "
                f"{b['delta']:+.1f} BTC, del lado de su color")
    if v is None or thr is None:
        return ""
    # La absorción: las velas entre el primer intento y el segundo
    gap = round((b["t"] - e["t0"]) / MS) if code == "RL" and e.get("t0") and b.get("t") else None
    return {
        "DV": lambda: f"Δ/Vol a favor del color: {pct(v)} (umbral {pct(thr)})",
        "PD": lambda: f"el delta va contra el color: |Δ|/Vol {pct(v)} (umbral {pct(thr)})",
        "DB": lambda: f"salto de delta entre las dos velas: {v:.2f} veces el volumen mediano de 30 días (umbral {thr:.2f})",
        "OG": lambda: f"hueco entre las áreas de valor: {v:.2f} ATR (umbral {thr:.2f} ATR)",
        "XD": lambda: f"el delta cierra en su extremo, con |Δ|/Vol {pct(v)} (umbral {pct(thr)})",
        "SM": lambda: (f"el delta nunca pasó al lado contrario al color: su Mín Δ (Máx Δ en una roja) quedó en 0 (umbral: a lo "
                       f"sumo {small_pct(thr)} del volumen)" if v <= 0 else
                       f"el lado contrario al color movió el delta {small_pct(v)} del volumen hacia su lado (umbral: a lo sumo "
                       f"{small_pct(thr)})"),
        "BR": lambda: f"orden de {usd(v)} que cruzó 3 precios o más (umbral {usd(thr)})",
        "GR": lambda: f"orden de {usd(v)} (umbral {usd(thr)})",
        "EX": lambda: (f"en el extremo hacia donde fue el precio, el lado que se agota: {num(v)} veces el volumen medio de los "
                       f"niveles (umbral: a lo sumo {num(thr)})"),
        "RS": lambda: f"lado pasivo del extremo: {num(v)} veces el medio de los niveles, decreciendo en los 3 primeros (umbral {num(thr)})",
        "SQ": lambda: f"{int(v)} niveles seguidos con el agresor creciente y ganándole al otro lado (pide al menos {int(thr)})",
        "SW": lambda: f"{int(v)} niveles seguidos sin contrapartida (pide al menos {int(thr)})",
        "VL": lambda: (f"{int(v)} niveles seguidos con el agresor en el percentil 90 de 30 días y ganándole al otro lado "
                       f"(pide al menos {int(thr)})"),
        "AD": lambda: (f"la celda mayor, del lado contrario: {num(v)} veces el medio de los niveles (umbral {num(thr)}), con el "
                       f"lado contrario al menos el doble del agresor en ella"),
        "RL": lambda: (f"segundo intento contra el nivel: {num(v)} BTC agresivos en su celda (umbral, el 5% mayor de 30 días: "
                       f"{num(thr)}), {gap} {'vela' if gap == 1 else 'velas'} después del primero"),
    }.get(code, lambda: "")()


def cells(f, line):
    """Las celdas del footprint: las del elemento, o las que dibujó el servidor si la vela de la señal pasaba de 200
    niveles con ellas (lo dice la línea de la captura: capa_bc.js, footprintCheck). Desde el 25/11 las capturas van con
    el tope por vela (stepPerCandle): una vela ancha vecina ya no agranda las celdas de la señal."""
    step, line = f"{f['step']:g}", line or ""
    view = re.search(r"Elementos OF: [^·]*· ⚠ el footprint dibuja celdas de ([\d.]+)", line)
    close = re.search(r"de cerca: ⚠ el footprint dibuja celdas de ([\d.]+)", line)
    if not view and not close:
        return f"celdas de {step} USD, como el elemento"
    if close or "de cerca" not in line:
        shown = float((close or view).group(1))
        return (f"el elemento usa celdas de {step} USD; con ellas esta vela pasaría de 200 celdas, y el footprint la dibuja"
                f" con celdas de {shown:g}")
    return f"de cerca, celdas de {step} USD, como el elemento; la vista las dibuja de {float(view.group(1)):g} (la vela pasa de 200 celdas)"


def figures(only, m8=False):
    for code, run_id, picked, folder in targets(only, m8):
        result = rt.load_run(run_id)
        trades = {t["n"]: t for t in result["trades"]}
        lines_path = g.SHOTS / folder / "lineas_of.json"
        lines = json.loads(lines_path.read_text(encoding="utf-8"))["lines"] if lines_path.exists() else []
        out = {}
        for n in picked:
            f = facts(code, result, trades[n])
            line = next((x for x in lines if x.startswith(f"#{n} ")), "")
            out[str(n)] = " · ".join(x for x in (text(code, f), cells(f, line)) if x)
            if not f["events"]:
                print(f"  ⚠ {code} trade {n}: sin el evento en la vela de la señal")
        (g.SHOTS / folder / "cifras.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        print(code, json.dumps(out, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    mode, only = (sys.argv[1] if len(sys.argv) > 1 else "cola"), set(sys.argv[2:])
    # cola8 y cifras8: las corridas del motor 8 (galeria_corridas_m8.py), en G8_<código>
    m8 = mode.endswith("8")
    queue(only, m8) if mode.startswith("cola") else figures(only, m8)
