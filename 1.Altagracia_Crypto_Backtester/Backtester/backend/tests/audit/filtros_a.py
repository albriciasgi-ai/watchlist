"""Oráculo A de los filtros del probador de reglas (backtesting global de App 1).

Escrito solo con la documentación (`Backtester/CLAUDE.md`, la hoja "Opciones" de
`CHEQUEO_PRUEBAS_REGLAS.xlsx` y `GUIA_PRUEBAS_REGLAS.pdf`) y los datos crudos de
`OrderFlowData`, que solo se leen. No mira cómo los calcula la app: si la app y este
oráculo no coinciden, se investiga quién tiene razón.

Forma común de cada filtro:

    filtro_x(moneda, tf, velas, k, lado, <parámetros como los guarda la regla>) -> Veredicto

- moneda: "BTCUSDT", "ETHUSDT", ...
- tf: minutos de la vela de la regla (5, 15, 30, 60, 240 o 1440).
- velas: las velas cerradas de la regla, en orden y desde la primera vela de la fase
  (cada fase corre sola: sus VWAP, EMA y CVD empiezan de cero):
  [{"t": ms de apertura, "o", "h", "l", "c", "vol", "delta"}],
  con delta = compra agresiva − venta agresiva de la vela (None sin almacén: se estima).
- k: índice de la vela de la señal. La regla decide al cerrarla; nunca se mira después de k.
- lado: +1 largo, −1 corto.

Veredicto(pasa, valor): pasa es True o False, o None si falta un dato (en la app, una
señal sin dato no pasa); valor es lo que mira el filtro y `motivo` explica un None.
Se desarma como tupla: `pasa, valor = filtro_cvd(...)`.

Los datos salen de `OrderFlowData` (variable `AUDIT_ORDERFLOWDATA` para otra carpeta),
o de una serie que se pase a mano (`Serie`, o el dict de Coin Metrics), como en las pruebas.

Las decisiones que la documentación no toma van marcadas `# AMBIGUO:`.
"""

from __future__ import annotations

import bisect
import csv
import json
import math
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

DATOS = Path(os.environ.get("AUDIT_ORDERFLOWDATA", r"C:\Users\inven\OrderFlowData"))

MINUTO = 60_000
HORA = 60 * MINUTO
DIA = 24 * HORA
PASO_4H = 4 * HORA
PASO_5MIN = 5 * MINUTO

PENDIENTE_VELAS = 5            # "la línea va a favor en 5 velas"
TF_OI_4H = (240, 1440)         # "con la de 4 horas el filtro solo vale en 4h y 1D"
Z_CONFLUENCIA = 20             # "en z de 20 velas"
UMBRAL_MULTITUD = 0.0001       # 0.01 % por 8 horas, en fracción (como el archivo de funding)
LAG_ONCHAIN = DIA + 6 * HORA   # el dato del día D se usa desde D + 1 día + 6 horas
VIEJO_ONCHAIN = 3 * DIA        # "sin datos nuevos en 3 días, la vela no pasa"
Z_DIAS = 365                   # z-score contra los 365 días anteriores...
Z_MINIMO = 180                 # ...con al menos 180


# ------------------------------------------------------------------------- piezas comunes

@dataclass
class Veredicto:
    pasa: Optional[bool]
    valor: Any = None
    motivo: str = ""

    def __iter__(self):
        yield self.pasa
        yield self.valor


def _sin_dato(motivo, valor=None):
    return Veredicto(None, valor, motivo)


def _apagado(x):
    """Un filtro sin pedir: None, 0, "", False, {} o "none"/"off"."""
    if isinstance(x, str):
        return x.strip().lower() in ("", "none", "off", "no")
    return not x


def _juntar(partes):
    """False si alguna parte falla; None si a alguna le falta el dato; True si pasan todas."""
    if any(p is False for p in partes):
        return False
    if any(p is None for p in partes):
        return None
    return True


def cierre(vela, tf):
    """Hora de cierre de la vela: cuando la regla decide."""
    # AMBIGUO: la vela cierra en t + tf, el borde exacto. Un dato fechado justo en ese instante
    # (el OI de las 04:00 en la vela de 00:00 a 04:00, un cobro de funding, las 06:00 del
    # on-chain) ya se conoce al cierre.
    return int(vela["t"]) + int(tf) * MINUTO


def _vol(vela):
    v = vela.get("vol", vela.get("v"))
    return float(v or 0.0)


def _revisar_k(velas, k):
    if not 0 <= k < len(velas):
        raise IndexError(f"k = {k} fuera de las {len(velas)} velas")


class Serie:
    """Puntos (ms, valor) ordenados por hora. `paso` es la separación normal entre puntos."""

    def __init__(self, puntos, paso=None):
        pares = sorted((int(t), float(v)) for t, v in puntos if v is not None)
        self.t = [t for t, _ in pares]
        self.v = [v for _, v in pares]
        self.paso = paso

    def __len__(self):
        return len(self.t)

    def indice_al(self, t):
        """Índice del último punto con hora <= t, o -1."""
        return bisect.bisect_right(self.t, t) - 1

    def al(self, t):
        """Valor conocido en t: el último punto con hora <= t."""
        i = self.indice_al(t)
        if i < 0:
            return None
        # AMBIGUO: el punto tiene que estar a menos de un paso de la serie (en la de 4 horas, el
        # de las 04:00 para una vela que cierra a las 04:00); si falta, la vela no tiene OI.
        if self.paso is not None and t - self.t[i] >= self.paso:
            return None
        return self.v[i]


# ------------------------------------------------------------------------- datos crudos

@lru_cache(maxsize=None)
def serie_oi_4h(moneda):
    """OI de 4 horas de Bybit: OrderFlowData/oi/{moneda}_4h.json, [[ms, oi], ...]."""
    ruta = DATOS / "oi" / f"{moneda}_4h.json"
    if not ruta.is_file():
        return None
    with open(ruta, encoding="utf-8") as f:
        return Serie(json.load(f), PASO_4H)


@lru_cache(maxsize=None)
def serie_oi_5min(moneda):
    """OI de 5 minutos (solo BTC): OrderFlowData/oi/{moneda}_5min.csv, de lo nuevo a lo viejo."""
    ruta = DATOS / "oi" / f"{moneda}_5min.csv"
    if not ruta.is_file():
        return None
    with open(ruta, newline="", encoding="utf-8") as f:
        filas = csv.reader(f)
        next(filas, None)
        return Serie(((int(r[0]), float(r[1])) for r in filas if r and r[0]), PASO_5MIN)


@lru_cache(maxsize=None)
def serie_funding(moneda):
    """Funding de Bybit: OrderFlowData/funding/{moneda}.json, [[ms, tasa en fracción], ...]."""
    ruta = DATOS / "funding" / f"{moneda}.json"
    if not ruta.is_file():
        return None
    with open(ruta, encoding="utf-8") as f:
        return Serie(json.load(f))


@lru_cache(maxsize=None)
def datos_onchain():
    """Coin Metrics: {"btc"|"eth": {FlowInExNtv, FlowOutExNtv, SplyExNtv}, "usdt"|"usdc": {SplyCur}},
    cada uno [[ms del día a las 00:00 UTC, valor], ...]."""
    ruta = DATOS / "onchain" / "coinmetrics.json"
    if not ruta.is_file():
        return None
    with open(ruta, encoding="utf-8") as f:
        return json.load(f)


# ------------------------------------------------------------------------- líneas: VWAP y EMA

def precio_tipico(vela):
    return (vela["h"] + vela["l"] + vela["c"]) / 3.0


def vwap_y_desviacion(velas, k, n):
    """(VWAP, desviación) de las n velas que terminan en k, con k incluida.

    VWAP: precio típico por volumen. Desviación: la del precio típico alrededor del VWAP,
    pesada por volumen, en las mismas velas (la de las bandas del VWAP en modo rolling).
    None si hay menos de n velas o su volumen suma 0.
    """
    if n < 1 or k - n + 1 < 0:
        return None
    tramo = velas[k - n + 1:k + 1]
    vols = [_vol(b) for b in tramo]
    total = sum(vols)
    if total <= 0:
        return None
    tipicos = [precio_tipico(b) for b in tramo]
    vwap = sum(tp * v for tp, v in zip(tipicos, vols)) / total
    # AMBIGUO: desviación poblacional (÷ la suma del volumen, no ÷ n − 1).
    var = sum(v * (tp - vwap) ** 2 for tp, v in zip(tipicos, vols)) / total
    return vwap, math.sqrt(max(var, 0.0))


def vwap_movil(velas, k, n):
    r = vwap_y_desviacion(velas, k, n)
    return None if r is None else r[0]


def serie_ema(velas, n, hasta):
    """EMA del cierre desde la vela 0 hasta `hasta`, con alfa = 2 / (n + 1)."""
    # AMBIGUO: arranca con el cierre de la primera vela de la lista ("EMA del cierre, que arranca
    # con la primera vela de la fase"), no con la media de las n primeras.
    a = 2.0 / (n + 1)
    out = []
    e = None
    for i in range(hasta + 1):
        c = float(velas[i]["c"])
        e = c if e is None else a * c + (1.0 - a) * e
        out.append(e)
    return out


def ema(velas, k, n):
    """EMA de n velas en k, o None mientras haya menos de n velas (todavía sin línea)."""
    if n < 1 or k < n - 1:
        return None
    return serie_ema(velas, n, k)[k]


def _linea_en(tipo, velas, n, i, emas):
    if i < 0:
        return None
    if tipo == "vwap":
        return vwap_movil(velas, i, n)
    return emas[i] if i >= n - 1 else None


def _emas(velas, n, k, cache):
    """La EMA hasta k. Con `cache` (un dict por lista de velas, que no cambie mientras se use)
    se calcula una vez para toda la lista: el valor en i solo depende de las velas hasta i."""
    if cache is None:
        return serie_ema(velas, n, k)
    clave = ("ema", n)
    s = cache.get(clave)
    if s is None or len(s) < k + 1:
        s = serie_ema(velas, n, len(velas) - 1)
        cache[clave] = s
    return s


def filtro_linea(moneda, tf, velas, k, lado, linea, cache=None):
    """Un filtro de `lines`: {type: "vwap"|"ema", period, mode: "side"|"touch", slope, maxDev}.

    Se mira en la vela de la señal y a favor del trade. side: cierra del lado de la línea;
    touch: además su mecha la toca; slope: la línea va a favor en 5 velas; maxDev (solo
    VWAP): no pasa si la vela de la señal abrió a más de maxDev desviaciones del VWAP, del
    lado del trade. Sin modo no filtra nada. Sin línea todavía (menos de N velas): None.

    valor: {"tipo", "periodo", "linea", "cierre"} y, si se piden, "toca", "pendiente",
    "desv", "tope" y "apertura". `cache`: ver `_emas`.
    """
    _revisar_k(velas, k)
    tipo = str(linea.get("type", "")).lower()
    if tipo not in ("vwap", "ema"):
        raise ValueError(f"línea desconocida: {linea.get('type')!r}")
    n = int(linea.get("period") or 0)
    if n < 1:
        raise ValueError(f"periodo de línea inválido: {linea.get('period')!r}")
    modo = linea.get("mode")
    if _apagado(modo):
        return Veredicto(True, None, "sin filtro")
    modo = str(modo).lower()
    if modo not in ("side", "touch"):
        raise ValueError(f"modo de línea desconocido: {modo!r}")

    v = velas[k]
    emas = _emas(velas, n, k, cache) if tipo == "ema" else None
    val = _linea_en(tipo, velas, n, k, emas)
    valor = {"tipo": tipo, "periodo": n, "linea": val, "cierre": v["c"]}
    if val is None:
        return _sin_dato(f"menos de {n} velas: todavía no hay línea", valor)

    # AMBIGUO: "cierra del lado de la línea" es estricto: un cierre igual a la línea no pasa.
    partes = [(v["c"] - val) * lado > 0]
    if modo == "touch":
        # AMBIGUO: la mecha toca si llega a la línea o la pasa (mínimo <= línea en un largo,
        # máximo >= línea en un corto).
        toca = v["l"] <= val if lado > 0 else v["h"] >= val
        valor["toca"] = toca
        partes.append(toca)
    if linea.get("slope"):
        # AMBIGUO: "a favor en 5 velas" compara la línea en k con la de k − 5, estricto. Sin
        # línea en k − 5 la pendiente no tiene dato.
        antes = _linea_en(tipo, velas, n, k - PENDIENTE_VELAS, emas)
        if antes is None:
            partes.append(None)
        else:
            valor["pendiente"] = val - antes
            partes.append((val - antes) * lado > 0)
    max_dev = linea.get("maxDev")
    if tipo == "vwap" and max_dev:
        _, dev = vwap_y_desviacion(velas, k, n)
        tope = val + lado * float(max_dev) * dev
        valor.update(desv=dev, tope=tope, apertura=v["o"])
        # AMBIGUO: abrir justo en la banda pasa ("a no más de X desviaciones"); abrir del otro
        # lado del VWAP también.
        partes.append((v["o"] - tope) * lado <= 0)
    pasa = _juntar(partes)
    return Veredicto(pasa, valor, "" if pasa is not None else "sin línea 5 velas antes")


def filtro_lineas(moneda, tf, velas, k, lado, lines, cache=None):
    """Las líneas de la regla (hasta dos): pasan si pasan todas. valor: el Veredicto de cada una."""
    res = [filtro_linea(moneda, tf, velas, k, lado, ln, cache) for ln in (lines or [])]
    return Veredicto(_juntar([r.pasa for r in res]), res)


# ------------------------------------------------------------------------- CVD

def delta_estimada(vela):
    """Delta de una vela sin almacén, por dónde cerró."""
    # AMBIGUO: "se estima por dónde cerró cada vela" leído como el volumen por la posición del
    # cierre en el rango, de −1 (en el mínimo) a +1 (en el máximo); sin rango da 0.
    rango = vela["h"] - vela["l"]
    if rango <= 0:
        return 0.0
    return _vol(vela) * ((vela["c"] - vela["l"]) - (vela["h"] - vela["c"])) / rango


def filtro_cvd(moneda, tf, velas, k, lado, cvd, estimar=None):
    """`flow.cvd` = N: la delta de las últimas N velas, con la de la señal, sobre su volumen,
    va a favor del trade.

    Delta real si la vela la trae; sin ella, o en 1D (`estimar` None decide por el marco),
    estimada. valor: Σ delta ÷ Σ volumen.
    """
    _revisar_k(velas, k)
    n = int(cvd)
    if estimar is None:
        estimar = int(tf) >= 1440
    if n < 1 or k - n + 1 < 0:
        return _sin_dato(f"menos de {n} velas en la fase")
    tramo = velas[k - n + 1:k + 1]
    # AMBIGUO: si a una vela le falta la delta, solo esa se estima.
    deltas = [delta_estimada(b) if estimar or b.get("delta") is None else float(b["delta"])
              for b in tramo]
    total = sum(_vol(b) for b in tramo)
    if total <= 0:
        return _sin_dato("volumen 0 en las velas del CVD")
    razon = sum(deltas) / total
    # AMBIGUO: "va a favor" es estricto: una delta neta de 0 no pasa a ningún lado.
    return Veredicto(razon * lado > 0, razon)


# ------------------------------------------------------------------------- OI

def serie_oi(moneda, tf, fuente="auto"):
    """(serie, motivo) para el filtro de OI.

    auto (lo que dice la documentación): BTC con su serie de 5 minutos y las demás con la de
    4 horas, que solo vale en 4h y 1D. "4h" o "5min" fuerzan una serie.
    """
    fuente = (fuente or "auto").lower()
    if fuente == "auto":
        # AMBIGUO: el pedido de este oráculo dice "el OI de 4 horas", pero la documentación dice
        # que BTC usa su serie de 5 minutos (que hoy llega hasta el 05/11/2026 20:30). Con
        # fuente="4h" BTC usa la de 4 horas: en 4h y 1D dan lo mismo (13,707 de 13,708 puntos
        # iguales) mientras haya serie de 5 minutos.
        fuente = "5min" if moneda.upper() == "BTCUSDT" and serie_oi_5min(moneda) is not None else "4h"
    if fuente == "5min":
        s = serie_oi_5min(moneda)
        return (s, "") if s is not None else (None, f"{moneda} no tiene OI de 5 minutos")
    if fuente == "4h":
        if int(tf) not in TF_OI_4H:
            return None, "con el OI de 4 horas el filtro solo vale en 4h y 1D"
        s = serie_oi_4h(moneda)
        return (s, "") if s is not None else (None, f"{moneda} no tiene OI de 4 horas")
    raise ValueError(f"fuente de OI desconocida: {fuente!r}")


def volumen_con_signo(vela):
    """El volumen con el signo de la vela."""
    # AMBIGUO: "volumen con signo" leído como el color de la vela: verde suma, roja resta y una
    # vela sin cuerpo da 0 (no la delta).
    if vela["c"] > vela["o"]:
        return _vol(vela)
    if vela["c"] < vela["o"]:
        return -_vol(vela)
    return 0.0


def z_ultimo(valores):
    """z del último valor contra la ventana que lo incluye (desviación poblacional)."""
    n = len(valores)
    m = sum(valores) / n
    var = sum((x - m) ** 2 for x in valores) / n
    # AMBIGUO: una ventana sin variación da z = 0 (ni a favor ni en contra).
    if var <= 0:
        return 0.0
    return (valores[-1] - m) / math.sqrt(var)


def confluencia_oi_volumen(velas, k, tf, serie, n=Z_CONFLUENCIA):
    """(z del volumen con signo, z del cambio del OI) en la vela k, o None sin datos.

    El cambio del OI de una vela es el OI a su cierre menos el del cierre de la vela anterior.
    """
    # AMBIGUO: el z de "20 velas" usa la ventana de las 20 velas que terminan en la de la señal,
    # con ella incluida. El signo del z es el mismo que el de comparar el valor con la media de
    # las 19 anteriores; con las 20 anteriores podría cambiar cuando pesa la vela 20 atrás.
    # AMBIGUO: el cambio del OI va por índice de vela, así que hace falta la vela k − 20.
    if k - n < 0:
        return None
    ois = [serie.al(cierre(velas[i], tf)) for i in range(k - n, k + 1)]
    if any(x is None for x in ois):
        return None
    cambios = [ois[j] - ois[j - 1] for j in range(1, n + 1)]
    con_signo = [volumen_con_signo(velas[i]) for i in range(k - n + 1, k + 1)]
    return z_ultimo(con_signo), z_ultimo(cambios)


def filtro_oi(moneda, tf, velas, k, lado, oi, oiPct=2.0, oiBars=6, serie=None, fuente="auto"):
    """`flow.oi`: "rise" (sube más de oiPct % en oiBars velas), "fall" (baja más de oiPct %),
    "conf" (confluencia OI-volumen a favor) o "noconf" (sin confluencia en contra).

    El OI es el conocido al cierre de cada vela. Una vela sin OI no pasa. `serie` deja pasar
    una Serie a mano; con una de 4 horas, solo en 4h y 1D, como la de los archivos.
    valor: el cambio en % (rise y fall) o {"zVol", "zOi"} (conf y noconf).
    """
    _revisar_k(velas, k)
    if _apagado(oi):
        return Veredicto(True, None, "sin filtro")
    modo = str(oi).lower()
    if modo not in ("rise", "fall", "conf", "noconf"):
        raise ValueError(f"modo de OI desconocido: {oi!r}")
    if serie is None:
        serie, motivo = serie_oi(moneda, tf, fuente)
        if serie is None:
            return _sin_dato(motivo)
    elif serie.paso is not None and serie.paso >= PASO_4H and int(tf) not in TF_OI_4H:
        return _sin_dato("con el OI de 4 horas el filtro solo vale en 4h y 1D")

    if modo in ("rise", "fall"):
        nb = int(oiBars)
        if k - nb < 0:
            return _sin_dato(f"menos de {nb} velas antes de la señal")
        # AMBIGUO: el cambio va contra el OI al cierre de la vela k − oiBars (por índice de vela,
        # no por hora), en % del de entonces.
        antes = serie.al(cierre(velas[k - nb], tf))
        ahora = serie.al(cierre(velas[k], tf))
        if antes is None or ahora is None or antes <= 0:
            return _sin_dato("sin OI al cierre de una de las velas", {"antes": antes, "ahora": ahora})
        pct = (ahora - antes) / antes * 100.0
        # "más de X %": estricto.
        pasa = pct > float(oiPct) if modo == "rise" else pct < -float(oiPct)
        return Veredicto(pasa, pct)

    z = confluencia_oi_volumen(velas, k, tf, serie)
    if z is None:
        return _sin_dato(f"faltan velas u OI para el z de {Z_CONFLUENCIA} velas")
    z_vol, z_oi = z
    # AMBIGUO: "los dos a favor" es lado × z > 0 en los dos, sin el umbral de 0.5 del producto
    # que usa el indicador "OI-Volume Confluence" del navegador. En un corto, a favor es el
    # volumen vendedor y el OI bajando, como la "confluencia bajista" del indicador.
    favor = z_vol * lado > 0 and z_oi * lado > 0
    contra = z_vol * lado < 0 and z_oi * lado < 0
    return Veredicto(favor if modo == "conf" else not contra, {"zVol": z_vol, "zOi": z_oi})


# ------------------------------------------------------------------------- multitud (funding)

def funding_3d(serie, t):
    """Funding de los 3 días anteriores a t: la suma ÷ 9, en equivalente por 8 horas aunque la
    moneda cobre cada 4 u 1 hora. None sin cobros en esos días."""
    # AMBIGUO: los 3 días son (t − 72 h, t]: un cobro justo al cierre cuenta y uno justo 72 h
    # antes no. Con cobros cada 8 h entran 9.
    i0 = bisect.bisect_right(serie.t, t - 3 * DIA)
    i1 = bisect.bisect_right(serie.t, t)
    if i1 <= i0:
        return None
    # AMBIGUO: con los 3 días a medias (al empezar la serie, o con un hueco) se suma lo que hay.
    return sum(serie.v[i0:i1]) / 9.0


def multitud(funding, lado):
    """"contra", "con" o "neutral" para el lado del trade."""
    # AMBIGUO: las dos comparaciones son estrictas: un funding de 0.01 % justo, o de 0, es neutro.
    # Ojo: con la tasa base de Bybit (0.01 % en cada cobro) el promedio cae justo en el borde;
    # aquí sale 0.0001 exacto (neutro), pero otra suma puede dar un ulp más.
    if (lado < 0 and funding > UMBRAL_MULTITUD) or (lado > 0 and funding < 0):
        return "contra"
    if (lado > 0 and funding > UMBRAL_MULTITUD) or (lado < 0 and funding < 0):
        return "con"
    return "neutral"


def filtro_multitud(moneda, tf, velas, k, lado, crowd, serie=None):
    """`flow.crowd`: "nocon" deja todo menos ir con la multitud; "contra", solo contra ella.

    Contra la multitud: un corto con funding > 0.01 % por 8 h o un largo con funding < 0; con
    ella, al revés. Sin funding no pasa. valor: {"funding" (fracción), "multitud"}.
    """
    _revisar_k(velas, k)
    if _apagado(crowd):
        return Veredicto(True, None, "sin filtro")
    modo = str(crowd).lower()
    if modo not in ("nocon", "contra"):
        raise ValueError(f"modo de multitud desconocido: {crowd!r}")
    if serie is None:
        serie = serie_funding(moneda)
        if serie is None:
            return _sin_dato(f"{moneda} no tiene funding")
    f = funding_3d(serie, cierre(velas[k], tf))
    if f is None:
        return _sin_dato("sin funding en los 3 días anteriores")
    clase = multitud(f, lado)
    pasa = clase != "con" if modo == "nocon" else clase == "contra"
    return Veredicto(pasa, {"funding": f, "multitud": clase})


# ------------------------------------------------------------------------- OI sostenido

def filtro_oi_sostenido(moneda, tf, velas, k, lado, steadyDays=14, steadyMin=0.52, serie=None):
    """`flow.steady`: el OI de 4 horas subió en steadyMin o más de sus pasos de los últimos
    steadyDays días. Siempre con la serie de 4 horas (también en BTC) y en cualquier marco.
    Con huecos (menos del 80% de los pasos) no pasa. No depende del lado.
    valor: la parte de los pasos que subieron.
    """
    _revisar_k(velas, k)
    dias = int(steadyDays)
    minimo = float(steadyMin)
    # AMBIGUO: la regla guarda 0.52 y la ventana lo muestra como 52 %: un valor mayor que 1 se
    # lee en %.
    if minimo > 1:
        minimo /= 100.0
    if serie is None:
        serie = serie_oi_4h(moneda)
        if serie is None:
            return _sin_dato(f"{moneda} no tiene OI de 4 horas")
    t = cierre(velas[k], tf)
    i = serie.indice_al(t)
    # AMBIGUO: los días se cuentan hacia atrás desde el último punto de 4 h conocido al cierre,
    # que tiene que estar a menos de 4 h de él (en 15m, el de las 08:00 para la vela que cierra
    # a las 10:15). Así se esperan steadyDays × 6 pasos.
    if i < 0 or t - serie.t[i] >= PASO_4H:
        return _sin_dato("sin OI de 4 horas al cierre")
    ancla = serie.t[i]
    j0 = bisect.bisect_left(serie.t, ancla - dias * DIA)
    pasos = subidas = 0
    for j in range(j0 + 1, i + 1):
        # AMBIGUO: solo cuentan los pasos de 4 h justas; el salto sobre un hueco no es un paso.
        if serie.t[j] - serie.t[j - 1] != PASO_4H:
            continue
        pasos += 1
        # AMBIGUO: subir es estricto: un paso que queda igual no sube.
        if serie.v[j] > serie.v[j - 1]:
            subidas += 1
    esperados = dias * 6
    if pasos < 0.8 * esperados:
        return _sin_dato(f"huecos en el OI: {pasos} de {esperados} pasos")
    # AMBIGUO: la parte es sobre los pasos que hay, no sobre los esperados.
    parte = subidas / pasos
    # "sube en X % o más de los pasos": >=.
    return Veredicto(parte >= minimo, parte, f"{subidas} de {pasos} pasos")


# ------------------------------------------------------------------------- flujos on-chain

def _por_dia(pares):
    return {int(t): float(v) for t, v in pares if v is not None}


def medidas_neto(datos, activo, dias):
    """{día: medida} del flujo neto a los exchanges de `activo` en `dias` días, en % del saldo
    en exchanges al empezar, con el signo cambiado: salir de los exchanges es positivo."""
    a = datos[activo]
    entra = _por_dia(a["FlowInExNtv"])
    sale = _por_dia(a["FlowOutExNtv"])
    saldo = _por_dia(a["SplyExNtv"])
    out = {}
    for d in sorted(saldo):
        # AMBIGUO: el saldo "al empezar" es el del cierre del día anterior a la ventana
        # (SplyExNtv de d − días), que más los flujos de la ventana da el de d: en los datos de
        # BTC, SplyExNtv(d) − SplyExNtv(d − 1) = entrada − salida del día d.
        s0 = saldo.get(d - dias * DIA)
        if not s0 or s0 <= 0:
            continue
        neto = 0.0
        completo = True
        for j in range(dias - 1, -1, -1):           # días d − dias + 1 .. d
            dj = d - j * DIA
            if dj not in entra or dj not in sale:
                completo = False
                break
            neto += entra[dj] - sale[dj]
        if completo:
            out[d] = -neto / s0 * 100.0
    return out


def medidas_emision(datos, dias, en="pct"):
    """{día: medida} del crecimiento de USDT + USDC en `dias` días. Cada stablecoin cuenta
    solo con dato al empezar la ventana y al terminarla."""
    series = [_por_dia(datos[c]["SplyCur"]) for c in ("usdt", "usdc") if c in datos]
    todos = sorted(set().union(*series)) if series else []
    out = {}
    for d in todos:
        ini = d - dias * DIA
        num = den = 0.0
        for s in series:
            # AMBIGUO: "cuenta desde que tiene dato" = un valor mayor que 0 al empezar la ventana
            # (USDC trae 38 días en 0 desde el 03/08/2018).
            if s.get(ini, 0.0) > 0 and d in s:
                num += s[d]
                den += s[ini]
        if den <= 0:
            continue
        # AMBIGUO: el crecimiento va en % del total al empezar, como el flujo neto; en="abs" da la
        # diferencia en dólares.
        out[d] = (num - den) / den * 100.0 if en == "pct" else num - den
    return out


def z_del_dia(medidas, d):
    """z de la medida del día d contra los 365 días anteriores (sin d), con al menos 180."""
    x = medidas.get(d)
    if x is None:
        return None
    # AMBIGUO: "los 365 días anteriores" no incluyen el día d; los 180 se cuentan entre los
    # días de esos 365 que tienen medida.
    hist = [medidas[d - j * DIA] for j in range(1, Z_DIAS + 1) if (d - j * DIA) in medidas]
    if len(hist) < Z_MINIMO:
        return None
    m = sum(hist) / len(hist)
    # AMBIGUO: desviación poblacional; un año sin variación no da z.
    var = sum((h - m) ** 2 for h in hist) / len(hist)
    if var <= 0:
        return None
    return (x - m) / math.sqrt(var)


class _Medidas:
    def __init__(self, medidas):
        self.m = medidas
        self.dias = sorted(medidas)


def medidas_onchain(datos, metrica, activo, dias, en="pct"):
    if metrica == "net":
        return medidas_neto(datos, activo, dias)
    if metrica == "stable":
        return medidas_emision(datos, dias, en)
    raise ValueError(f"medida on-chain desconocida: {metrica!r}")


@lru_cache(maxsize=None)
def _medidas_del_archivo(metrica, activo, dias, en):
    datos = datos_onchain()
    return None if datos is None else _Medidas(medidas_onchain(datos, metrica, activo, dias, en))


def activo_de(moneda):
    """asset "auto": ETH para las monedas de ETH y BTC para las demás."""
    # AMBIGUO: "las monedas de ETH" leído como el símbolo cuya base es ETH (ETHUSDT); las demás,
    # también las del ecosistema de Ethereum, van con BTC.
    base = moneda.upper()
    for q in ("USDT", "USDC", "PERP", "USD"):
        if base.endswith(q) and len(base) > len(q):
            base = base[:-len(q)]
            break
    return "eth" if base == "ETH" else "btc"


def dia_usable(dias_ordenados, t):
    """El último día cuyo dato ya se usa en t: el del día D vale desde D + 1 día + 6 horas."""
    i = bisect.bisect_right(dias_ordenados, t - LAG_ONCHAIN) - 1
    return dias_ordenados[i] if i >= 0 else None


def filtro_onchain(moneda, tf, velas, k, lado, chain, datos=None, emision_en="pct"):
    """`flow.chain` = {metric: "net"|"stable", days, z, mode: "favor"|"nocontra", asset}.

    La medida va en z-score contra los 365 días anteriores (al menos 180). favor: z × lado >= z;
    nocontra: z × lado > −z. El dato del día D vale desde D + 30 h; sin datos nuevos en 3 días
    no pasa. `datos` deja pasar el dict de Coin Metrics a mano.
    valor: {"dia" (ms), "medida", "z"}.
    """
    _revisar_k(velas, k)
    if _apagado(chain):
        return Veredicto(True, None, "sin filtro")
    metrica = str(chain.get("metric", "")).lower()
    dias = int(chain.get("days", 7))
    z_min = float(chain.get("z", 0.5))
    modo = str(chain.get("mode", "favor")).lower()
    if modo not in ("favor", "nocontra"):
        raise ValueError(f"modo on-chain desconocido: {modo!r}")
    activo = str(chain.get("asset", "auto")).lower()
    if activo == "auto":
        activo = activo_de(moneda)
    if datos is None:
        med = _medidas_del_archivo(metrica, activo, dias, emision_en)
        if med is None:
            return _sin_dato("no está OrderFlowData/onchain/coinmetrics.json")
    else:
        med = _Medidas(medidas_onchain(datos, metrica, activo, dias, emision_en))

    t = cierre(velas[k], tf)
    d = dia_usable(med.dias, t)
    if d is None:
        return _sin_dato("ningún dato publicado todavía")
    # AMBIGUO: "sin datos nuevos en 3 días" se cuenta desde que el último dato se pudo usar
    # (D + 30 h), no desde el día D.
    if t - (d + LAG_ONCHAIN) > VIEJO_ONCHAIN:
        return _sin_dato("sin datos nuevos en 3 días", {"dia": d, "medida": med.m[d], "z": None})
    z = z_del_dia(med.m, d)
    valor = {"dia": d, "medida": med.m[d], "z": z}
    if z is None:
        return _sin_dato("menos de 180 días para el z, o un año sin variación", valor)
    s = z * lado
    pasa = s >= z_min if modo == "favor" else s > -z_min
    return Veredicto(pasa, valor)


# ------------------------------------------------------------------------- todos los de una regla

def evaluar_filtros(moneda, tf, velas, k, lado, regla, oi=None, oi_4h=None, funding=None,
                    onchain=None, fuente_oi="auto", cache=None):
    """Los filtros de `regla["lines"]` y `regla["flow"]` en la vela k.

    Devuelve (pasan_todos, {nombre: Veredicto}). pasan_todos es True solo si todos dan True:
    en la app un filtro sin dato no deja pasar. `oi`, `oi_4h`, `funding` y `onchain` dejan
    pasar los datos a mano (si no, se leen de OrderFlowData). `cache`: ver `_emas`.
    """
    out = {}
    for i, ln in enumerate(regla.get("lines") or []):
        out[f"linea{i + 1}"] = filtro_linea(moneda, tf, velas, k, lado, ln, cache)
    flow = regla.get("flow") or {}
    if not _apagado(flow.get("cvd")):
        out["cvd"] = filtro_cvd(moneda, tf, velas, k, lado, flow["cvd"])
    if not _apagado(flow.get("oi")):
        out["oi"] = filtro_oi(moneda, tf, velas, k, lado, flow["oi"], flow.get("oiPct", 2.0),
                              flow.get("oiBars", 6), serie=oi, fuente=fuente_oi)
    if not _apagado(flow.get("crowd")):
        out["multitud"] = filtro_multitud(moneda, tf, velas, k, lado, flow["crowd"], serie=funding)
    if flow.get("steady"):
        out["sostenido"] = filtro_oi_sostenido(moneda, tf, velas, k, lado,
                                               flow.get("steadyDays", 14),
                                               flow.get("steadyMin", 0.52), serie=oi_4h)
    if not _apagado(flow.get("chain")):
        out["onchain"] = filtro_onchain(moneda, tf, velas, k, lado, flow["chain"], datos=onchain)
    return all(v.pasa is True for v in out.values()), out
