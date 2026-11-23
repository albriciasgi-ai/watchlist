"""
Protocolo (22/11/2026), etapa 7, prueba adicional 1, segunda parte: el usuario pidió la galería con TODOS los elementos
del probador (los va a combinar en recetas nuevas). Corre en la copia aislada la regla de prueba de un elemento de cada
uno que faltaba (BTC, fase 1), una tras otra, y suma su corrida a evidencia/etapa7/galeria_corridas.json.

Uso (desde backend/): python -B tests/audit/galeria_corridas2.py
"""
import copy
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import galeria_corridas as g  # noqa: E402
import reglas_prueba as rp  # noqa: E402

# (clave, regla de prueba, título, cambios a la regla)
MORE = [
    ("HM", "E-HM", "Martillo o estrella fugaz", None), ("EN", "E-EN", "Envolvente", None),
    ("RBg", "R19b", "Rombo de volumen de respuesta, como giro", None),
    ("RBs", "R19b", "Rombo de volumen de respuesta, siguiendo el tramo", {"rv": {"rombo": "follow"}}),
    ("GC", "E-GC", "Gaussian Channel", None), ("BE", "E-BE", "Borde de caja, hacia el centro", None),
    ("CP", "E-CP", "Compresión", None), ("CC", "E-CC", "Cambio de carácter", None),
    ("QA", "E-QA", "Esfuerzo sin resultado (VPA)", None), ("QF", "E-QF", "Ruptura sin volumen (VPA)", None),
    ("QR", "E-QR", "Retroceso sin volumen tras la ruptura (VPA)", None), ("QT", "E-QT", "Prueba de poco volumen (VPA)", None),
    ("QS", "E-QS", "Frenado o techo (VPA)", None), ("QC", "E-QC", "Clímax de volumen (VPA)", None),
    ("QE", "E-QE", "El medidor VPA cruza el umbral", None),
    ("BS", "E-BS", "Ruptura de estructura (SMC)", None), ("OB", "E-OB", "Order block (SMC)", None),
    ("BK", "E-BK", "Breaker (SMC)", None), ("EQ", "E-EQ", "Barrido de iguales (SMC)", None),
    ("VR", "E-VR", "Regreso al valor de la sesión anterior", None),
    ("VF", "E-VF", "Fallo fuera del valor de la sesión anterior", None),
    ("VX", "E-VX", "Aceptación fuera del valor de la sesión anterior", None),
] + [(code, f"E-{code}", name, None) for code, name in (
    ("VA", "VA abandonada"), ("OG", "Orderflows Gap"), ("AP", "POC alineado"), ("SL", "POC Slingshot"),
    ("RL", "Absorción (propuesta propia)"), ("EX", "Exhaustion Print"), ("ZP", "Zero Print"), ("DT", "Delta Tail"),
    ("RS", "Retail Suck"), ("DD", "Delta Divergence"), ("PD", "Price Action Divergence"), ("IV", "Inverse Imbalance"),
    ("AD", "Acumulación/Distribución"), ("SW", "Market Sweep"), ("VL", "Vertical Liquidity"), ("SQ", "Orderflows Sequencing"),
    ("DB", "Delta Breakout"), ("PW", "POC Wave"), ("DV", "Delta/Volumen extremo"), ("VI", "Volume Imbalance"),
    ("IR", "Imbalance Reversal"), ("RD", "Imbalance Reload"), ("VD", "Volume Decline"), ("TP", "Thin Print"),
    ("OP", "Open POC"), ("RX", "Ratio de extremos"), ("XD", "Extreme Delta"), ("SM", "Small Min/Max Delta"),
    ("BR", "Barrido real"), ("GR", "Orden grande"))]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    path = g.OUT / "galeria_corridas.json"
    out = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    for key, name, title, change in MORE:
        if out.get(key, {}).get("run"):
            continue
        rule = copy.deepcopy(rp.RULES[name])
        for field, value in (change or {}).items():
            rule[field] = {**(rule.get(field) or {}), **value}
        if change:
            rule["name"] = f"{rule['name']} · {title}"
        t0 = time.time()
        try:
            res = g.call("POST", "/api/tester/run/BTCUSDT", {"rule": rule, "phase": 1, "confirm": True})
            run = res.get("run")
            if res.get("job"):
                while True:
                    time.sleep(4)
                    j = (g.call("GET", f"/api/tester/job/{res['job']}").get("job") or {})
                    if j.get("state") not in ("running", None):
                        break
                run = j.get("run")
                if j.get("state") != "done":
                    print(key, "falló:", j.get("error"), flush=True)
            if not run:
                print(key, "sin corrida:", res.get("message"), flush=True)
                continue
            detail = g.call("GET", f"/api/tester/result/{run}")
            result = detail.get("result") or detail
            s = result.get("summary") or {}
            out[key] = {"rule": name, "title": title, "run": run, "tf": rule["tf"], "trades": s.get("n"),
                        "skipped": result.get("skipped"), "signals": result.get("signals")}
            print(key, name, run, s.get("n"), "trades", f"{time.time() - t0:.0f} s", flush=True)
        except Exception as error:  # noqa: BLE001 (una que falla no detiene las demás)
            print(key, "error:", error, flush=True)
        path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
