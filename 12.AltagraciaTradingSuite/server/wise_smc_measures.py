# wise_smc_measures.py - Medidas de Williams y de la estructura SMC para cada trade del journal (20/11/2026), en el grupo
# "Williams y SMC" del detalle y del informe de ganadoras contra perdedoras.
#
# Usan williams.py y smc.py de App 1 (sin copiarlos) con las velas de 1h y 4h que ya pide journal_measures, cortadas en
# la ultima vela cerrada antes de decidir: nada de lo posterior. Todas se leen desde el lado del trade:
#   - Alligator (13/8, 8/5 y 5/3 del precio medio): 1 despierto a favor, -1 despierto en contra, 0 dormido;
#   - zona de Williams (AO y AC): 1 a favor, -1 en contra, 0 ninguna;
#   - AO a favor, en ATR de 14 velas;
#   - estructura mayor SMC (pivotes de 50 velas): 1 su ultima ruptura va a favor, -1 en contra, 0 sin ruptura;
#   - lugar en el rango mayor SMC: 0 en el extremo a favor (discount en un largo, premium en un corto) y 1 en el otro;
#   - distancia al order block vivo mas cercano del lado del trade (uno alcista bajo la entrada en un largo), en ATR, 0
#     si la entrada cae dentro. Sin ninguno, vacio.
# Ninguna esta validada contra el azar: el probador de App 1 no encontro ventaja en los sabios ni en los order blocks.
import math
from typing import Any, Dict, List, Optional

import numpy as np

import smc       # App 1 (su backend esta en sys.path)
import williams  # App 1

GROUP = "Williams y SMC"
STEP = {"1h": 3_600_000, "4h": 14_400_000}
SMC_CFG = {"internal": 5, "swing": 50}
MIN_BARS = 60
CATALOG = []
for _tag in ("4h", "1h"):
    CATALOG += [
        (f"bw_alligator_{_tag}", f"Alligator {_tag} (1 despierto a favor, −1 en contra, 0 dormido)"),
        (f"bw_zone_{_tag}", f"Zona de Williams {_tag} (1 a favor, −1 en contra, 0 ninguna)"),
        (f"bw_ao_{_tag}", f"AO {_tag} a favor, en ATR"),
        (f"smc_bias_{_tag}", f"Estructura mayor SMC {_tag} (1 a favor, −1 en contra)"),
        (f"smc_place_{_tag}", f"Lugar en el rango mayor SMC {_tag} (0 en el extremo a favor, 1 en el otro)"),
        (f"smc_ob_atr_{_tag}", f"Distancia al order block a favor más cercano {_tag}, en ATR (0 dentro)"),
    ]


def catalog() -> List[Dict[str, str]]:
    return [{"key": key, "label": label, "group": GROUP} for key, label in CATALOG]


def _finite(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def _ob_distance(r: dict, k: int, side: int, price: float, atr: float) -> Optional[float]:
    best = None
    for ob in r["obs"]:
        if ob["dir"] != side or ob["known"] > k or (ob["broken"] is not None and ob["broken"] <= k):
            continue
        top, bottom = ob["top"], ob["bottom"]
        if bottom <= price <= top:
            d = 0.0
        elif side > 0 and price > top:
            d = price - top
        elif side < 0 and price < bottom:
            d = bottom - price
        else:
            continue  # del otro lado de la entrada: ya no espera al precio
        best = d if best is None else min(best, d)
    return None if best is None or not atr > 0 else round(best / atr, 3)


def frame_measures(f: Dict[str, np.ndarray], tag: str, at: int, side: int, entry: Optional[float]) -> Dict[str, Any]:
    """Las medidas de un marco con sus velas cerradas en `at` o antes (arreglos como journal_measures.frame)."""
    out = {key: None for key, _ in CATALOG if key.endswith("_" + tag)}
    ts = f["ts"]
    n = int(np.searchsorted(ts + STEP[tag], at, side="right"))
    if n < MIN_BARS:
        return out
    o, h, l, c = (f[key][:n].tolist() for key in ("open", "high", "low", "close"))
    k = n - 1
    s = williams.compute(h, l, c)
    out[f"bw_alligator_{tag}"] = s["state"][k] * side
    zone = s["zone"][k]
    out[f"bw_zone_{tag}"] = zone * side if _finite(zone) else None
    ao, atr = s["ao"][k], s["atr"][k]
    out[f"bw_ao_{tag}"] = round(ao / atr * side, 3) if _finite(ao) and _finite(atr) and atr > 0 else None
    r = smc.compute(o, h, l, c, SMC_CFG)
    out[f"smc_bias_{tag}"] = r["bias"][k] * side
    price = float(entry) if _finite(entry) and entry > 0 else c[k]
    top, bottom = r["top"][k], r["bottom"][k]
    if _finite(top) and _finite(bottom) and top > bottom:
        place = (price - bottom) / (top - bottom)
        out[f"smc_place_{tag}"] = round(place if side > 0 else 1 - place, 3)
    out[f"smc_ob_atr_{tag}"] = _ob_distance(r, k, side, price, atr if _finite(atr) else 0.0)
    return out


def compute(frames: Dict[str, Dict[str, np.ndarray]], at: int, side: int, entry: Optional[float]) -> Dict[str, Any]:
    out = {}
    for tag in ("4h", "1h"):
        if tag in frames:
            out.update(frame_measures(frames[tag], tag, int(at), side, entry))
    return out
