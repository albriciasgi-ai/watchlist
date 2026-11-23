"""Oráculo A de los filtros de Williams y del horario del probador de reglas (backtesting global de App 1).

Escrito solo con la documentación, sin ver cómo los calcula la app (ni `backend/williams.py` ni las partes de
`rule_tester.py` que aplican estos filtros):
- `Backtester/CLAUDE.md`, "SMART MONEY CONCEPTS E INDICADORES DE BILL WILLIAMS (20/11/2026)" ("Filtros nuevos" y
  "Después (21/11): AO, AC, Gator y MFI como filtros") y, en "PROBADOR DE REGLAS DEL OBSERVADOR", "Horario (18/11)";
- el encabezado de `frontend/src/components/indicators/williams.js` (las reglas de cada indicador) y los números de
  su `defaultWilliamsConfig`;
- `pruebas_backtesting/DEFECTOS.md`, H13 (Williams mide con el ATR de Wilder) y H2 (arranque en frío).
Si la app y este oráculo no coinciden, se investiga quién tiene razón.

Forma común de cada filtro:

    filtro_x(velas, k, lado, modo, w=None, opciones=None) -> Veredicto

- velas: las velas cerradas de la regla, en orden y desde la primera vela de la fase (cada fase corre sola: las medias
  arrancan con su primera vela): [{"t": ms de apertura, "o", "h", "l", "c", "vol"}].
- k: índice de la vela de la señal. La regla decide al cerrarla; nunca se mira después de k.
- lado: +1 largo, −1 corto.
- w: las series de Williams de esas velas (`series()`), para no calcularlas en cada señal.
- opciones: lo que la documentación no decide (ver `OPCIONES`); sin ellas, la lectura más natural (`FABRICA`).

Veredicto(pasa, valor, motivo): pasa es True o False, o None si falta un dato (en la app, "una vela sin el dato que
pide el filtro no pasa"); valor es lo que mira el filtro y `motivo` explica un None. Se desarma como tupla.

Las decisiones que la documentación no toma van marcadas `# AMBIGUO:`.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Any, Optional

MINUTO = 60_000
DIA = 24 * 60 * MINUTO

# Los números de fábrica de `defaultWilliamsConfig` (williams.js). La regla no trae otros: `bwf` solo dice el modo.
CONFIG = {
    "jaw": (13, 8),     # mandíbula: SMMA de 13 del precio medio, desplazada 8
    "teeth": (8, 5),    # dientes: SMMA de 8, desplazados 5
    "lips": (5, 3),     # labios: SMMA de 5, desplazados 3
    "sleepAtr": 0.5,    # abertura mínima, en ATR de 14, para decir que está despierto
    "atr": 14,
    "aoFast": 5,        # AO: media simple de 5 del precio medio...
    "aoSlow": 34,       # ...menos la de 34
    "acSignal": 5,      # AC: el AO menos su media de 5
}

# Lo que la documentación no decide. La primera de cada lista es la lectura más natural (la de fábrica del oráculo);
# las otras se cuentan aparte en la comparación con el motor.
OPCIONES = {
    # El ATR de 14 con que se mide la abertura del Alligator (H13: Williams usa el de Wilder).
    #   sma: Wilder sembrado con la media simple de los 14 primeros rangos verdaderos (el de la primera vela, sin cierre
    #        anterior, es su máximo − mínimo), como la SMMA del Alligator; primero en la vela 13.
    #   sma1: igual, sin la primera vela (siembra con los rangos 1 a 14); primero en la vela 14.
    #   primera: Wilder desde la primera vela (ATR_0 = su rango), como dice H2 del ATR del FVG nuevo y del Impulso.
    #   simple: media simple de los últimos 14 rangos verdaderos.
    #   rango: media simple de los últimos 14 máximo − mínimo (la "media simple de 14 rangos" de H13).
    # Visto después (comparar_filtros2.py, series del motor como caja negra, 22/11): el motor usa "primera", igual a
    # 1e-15 en BTC y ARB 4h f1. En las señales del FVG 0.3 las tres de Wilder dan lo mismo; "simple" y "rango", no.
    "atr": ("sma", "sma1", "primera", "simple", "rango"),
    # La siembra de las SMMA del Alligator: con la media simple de las n primeras (lo que dice el encabezado) o con el
    # primer valor (desde la primera vela).
    "smma": ("media", "primera"),
    # La abertura del Alligator despierto: de los labios a la mandíbula (total) o la menor de las dos distancias
    # entre líneas vecinas (minima).
    "abertura": ("total", "minima"),
    # Los dientes que mira "side": como se dibujan en la vela (desplazados 5) o la SMMA de 8 de esa vela.
    "dientes": ("desplazados", "sin_desplazar"),
    # El dato que pide "side": solo los dientes, o el Alligator entero (también la mandíbula y los labios).
    "side_pide": ("dientes", "alligator"),
    # Un empate en el AO, el AC, el Gator y el MFI: conserva el color o la dirección anterior (lo que dice el
    # encabezado para el AO y el MFI), o no tiene color (estricto).
    "empate": ("conserva", "estricto"),
    # El Gator: pide sus dos barras, o le basta la que ya existe (al principio la de abajo llega antes).
    "gator_pide": ("las_dos", "la_que_hay"),
    # Los bordes del horario: "from" y "to", incluidos o no.
    "desde": ("incluido", "excluido"),
    "hasta": ("incluido", "excluido"),
    # La hora que mira el horario: la del cierre de la vela de la señal (lo que dice la documentación) o su apertura.
    "hora": ("cierre", "apertura"),
}
FABRICA = {clave: valores[0] for clave, valores in OPCIONES.items()}

SUBE, BAJA = 1, -1
MFI_TIPOS = {(SUBE, SUBE): "green", (BAJA, BAJA): "fade", (SUBE, BAJA): "fake", (BAJA, SUBE): "squat"}

ALLIGATOR_MODOS = ("awake", "side", "sleeping")
MOMENTO_MODOS = ("color", "zero", "both")
GATOR_MODOS = ("eating", "open", "sleeping")
# Los tipos de vela del MFI que deja pasar cada modo ("no mira el lado")
MFI_MODOS = {"green": {"green"}, "squat": {"squat"}, "volume": {"green", "squat"}, "notFake": {"green", "fade", "squat"}}


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
        return x.strip().lower() in ("", "none", "off", "no", "false")
    return not x


def _juntar(partes):
    """False si alguna parte falla; None si a alguna le falta el dato; True si pasan todas."""
    if any(p is False for p in partes):
        return False
    if any(p is None for p in partes):
        return None
    return True


def _revisar_k(velas, k):
    if not 0 <= k < len(velas):
        raise IndexError(f"k = {k} fuera de las {len(velas)} velas")


def _opciones(opciones):
    o = dict(FABRICA)
    for clave, valor in (opciones or {}).items():
        if clave not in OPCIONES:
            raise ValueError(f"opción desconocida: {clave!r}")
        if valor not in OPCIONES[clave]:
            raise ValueError(f"valor desconocido para {clave}: {valor!r}")
        o[clave] = valor
    return o


def _vol(vela):
    v = vela.get("vol", vela.get("v"))
    return None if v is None else float(v)


# ------------------------------------------------------------------------- series

def _sma(xs, n):
    """Media simple de n en cada vela, con la vela incluida; None mientras falten valores."""
    out = [None] * len(xs)
    for i in range(n - 1, len(xs)):
        tramo = xs[i - n + 1:i + 1]
        if any(x is None for x in tramo):
            continue
        out[i] = sum(tramo) / n
    return out


def _smma(xs, n, siembra="media"):
    """SMMA de Wilder sembrada con la media simple: el primer valor, en la vela n − 1, es la media de las n primeras;
    después s_i = (s_{i−1}·(n − 1) + x_i) / n. Con siembra "primera" (lectura alternativa) arranca en la vela 0 con
    s_0 = x_0, y desde la vela n − 1."""
    out = [None] * len(xs)
    if n < 1 or len(xs) < n:
        return out
    if siembra == "primera":
        s = xs[0]
        for i in range(1, len(xs)):
            s = (s * (n - 1) + xs[i]) / n
            if i >= n - 1:
                out[i] = s
        if n == 1:
            out[0] = s
        return out
    s = sum(xs[:n]) / n
    out[n - 1] = s
    for i in range(n, len(xs)):
        s = (s * (n - 1) + xs[i]) / n
        out[i] = s
    return out


def _desplazar(serie, d):
    """El desplazamiento lleva el valor de una vela pasada a una posterior: el de la vela i es el de i − d."""
    return [serie[i - d] if i - d >= 0 else None for i in range(len(serie))]


def precio_medio(vela):
    """(máximo + mínimo) / 2: el texto del libro dice (H − L)/2 por error; su código usa (H + L)/2."""
    return (float(vela["h"]) + float(vela["l"])) / 2.0


def rangos_verdaderos(velas):
    """Rango verdadero de cada vela: máx(H − L, |H − C anterior|, |L − C anterior|); la primera, H − L."""
    out = []
    for i, v in enumerate(velas):
        h, l = float(v["h"]), float(v["l"])
        if i == 0:
            out.append(h - l)
        else:
            pc = float(velas[i - 1]["c"])
            out.append(max(h - l, abs(h - pc), abs(l - pc)))
    return out


def atr_serie(velas, n=14, forma="sma"):
    """El ATR de n de cada vela, en la forma de `OPCIONES["atr"]`; None mientras no exista."""
    tr = rangos_verdaderos(velas)
    if forma == "sma":
        # AMBIGUO: el ATR de Wilder "sembrado con la media simple", como la SMMA del Alligator (la documentación no
        # dice cómo arranca el de Williams).
        return _smma(tr, n)
    if forma == "sma1":
        return [None] + _smma(tr[1:], n)
    if forma == "primera":
        out, a = [], None
        for x in tr:
            a = x if a is None else (a * (n - 1) + x) / n
            out.append(a)
        return out
    if forma == "simple":
        return _sma(tr, n)
    if forma == "rango":
        return _sma([float(v["h"]) - float(v["l"]) for v in velas], n)
    raise ValueError(f"forma de ATR desconocida: {forma!r}")


def direcciones(serie, empate="conserva"):
    """+1 si el valor sube respecto del de la vela anterior, −1 si baja. Un empate conserva la dirección anterior
    ("conserva", lo que dice el encabezado de williams.js del AO y del MFI) o no tiene dirección ("estricto").
    None sin el valor, sin el anterior, o en un empate sin dirección anterior."""
    out = [None] * len(serie)
    previa = None
    for i in range(1, len(serie)):
        a, b = serie[i - 1], serie[i]
        if a is None or b is None:
            previa = None
            continue
        if b > a:
            d = SUBE
        elif b < a:
            d = BAJA
        else:
            d = previa if empate == "conserva" else None
        out[i] = d
        previa = d
    return out


def estado_alligator(labios, dientes, mandibula, atr, sleep_atr=CONFIG["sleepAtr"], abertura="total"):
    """(estado, abertura): +1 despierto al alza (labios > dientes > mandíbula y una abertura de al menos sleep_atr
    ATR), −1 a la baja (al revés), 0 dormido. (None, None) sin una línea o sin ATR."""
    if labios is None or dientes is None or mandibula is None or atr is None:
        return None, None
    if abertura == "total":
        # AMBIGUO: la abertura de la boca es de los labios a la mandíbula (las dos líneas de los extremos).
        ab = abs(labios - mandibula)
    elif abertura == "minima":
        ab = min(abs(labios - dientes), abs(dientes - mandibula))
    else:
        raise ValueError(f"abertura desconocida: {abertura!r}")
    umbral = sleep_atr * atr
    # AMBIGUO: el orden es estricto ("labios > dientes > mandíbula") y "una abertura de al menos" llega justo (>=).
    if labios > dientes > mandibula and ab >= umbral:
        return SUBE, ab
    if labios < dientes < mandibula and ab >= umbral:
        return BAJA, ab
    return 0, ab


def gator_desde_lineas(mandibula, dientes, labios, empate="conserva"):
    """Las barras del Gator con las líneas como se dibujan en la vela: arriba |mandíbula − dientes| y abajo
    −|dientes − labios| (aquí, su tamaño |dientes − labios|). Cada barra es verde (+1) si crece y roja (−1) si se
    achica: (arriba, abajo, color de arriba, color de abajo)."""
    arriba = [abs(m - d) if m is not None and d is not None else None for m, d in zip(mandibula, dientes)]
    abajo = [abs(d - lb) if d is not None and lb is not None else None for d, lb in zip(dientes, labios)]
    # AMBIGUO: un empate conserva el color, como el AO (el encabezado no lo dice del Gator).
    return arriba, abajo, direcciones(arriba, empate), direcciones(abajo, empate)


def tipos_mfi(velas, empate="conserva"):
    """MFI = (máximo − mínimo) ÷ volumen y el tipo de cada vela: green (suben el MFI y el volumen), fade (bajan los
    dos), fake (sube el MFI y baja el volumen) o squat (baja el MFI y sube el volumen).
    (mfi, dirección del MFI, dirección del volumen, tipo); None sin volumen o sin la vela anterior."""
    vols = [_vol(v) for v in velas]
    # AMBIGUO: con volumen 0 (o sin volumen) la vela no tiene MFI.
    mfi = [(float(v["h"]) - float(v["l"])) / x if x is not None and x > 0 else None for v, x in zip(velas, vols)]
    # AMBIGUO: "un empate conserva la dirección anterior" vale para las dos direcciones, la del MFI y la del volumen.
    d_mfi = direcciones(mfi, empate)
    d_vol = direcciones([x if x is not None and x > 0 else None for x in vols], empate)
    tipo = [MFI_TIPOS.get((a, b)) if a is not None and b is not None and m is not None else None
            for a, b, m in zip(d_mfi, d_vol, mfi)]
    return mfi, d_mfi, d_vol, tipo


class SeriesWilliams:
    """Las series de Williams de una lista de velas (desde su primera vela), con unas opciones."""

    def __init__(self, velas, opciones=None, config=None):
        o = _opciones(opciones)
        c = {**CONFIG, **(config or {})}
        self.opciones = o
        self.config = c
        mp = [precio_medio(v) for v in velas]
        self.medio = mp
        (nj, dj), (nt, dt_), (nl, dl) = c["jaw"], c["teeth"], c["lips"]
        self.mandibula_sin = _smma(mp, nj, o["smma"])
        self.dientes_sin = _smma(mp, nt, o["smma"])
        self.labios_sin = _smma(mp, nl, o["smma"])
        self.mandibula = _desplazar(self.mandibula_sin, dj)
        self.dientes = _desplazar(self.dientes_sin, dt_)
        self.labios = _desplazar(self.labios_sin, dl)
        self.atr = atr_serie(velas, c["atr"], o["atr"])
        rapida, lenta = _sma(mp, c["aoFast"]), _sma(mp, c["aoSlow"])
        self.ao = [a - b if a is not None and b is not None else None for a, b in zip(rapida, lenta)]
        senal = _sma(self.ao, c["acSignal"])
        self.ac = [a - b if a is not None and b is not None else None for a, b in zip(self.ao, senal)]
        self.color_ao = direcciones(self.ao, o["empate"])
        self.color_ac = direcciones(self.ac, o["empate"])
        (self.gator_arriba, self.gator_abajo,
         self.color_arriba, self.color_abajo) = gator_desde_lineas(self.mandibula, self.dientes, self.labios, o["empate"])
        self.mfi, self.dir_mfi, self.dir_vol, self.tipo_mfi = tipos_mfi(velas, o["empate"])
        self.cierre = [float(v["c"]) for v in velas]

    def estado(self, k):
        return estado_alligator(self.labios[k], self.dientes[k], self.mandibula[k], self.atr[k],
                                self.config["sleepAtr"], self.opciones["abertura"])

    def zona(self, k):
        """+1 verde (el AO y el AC suben), −1 roja (los dos bajan), 0 gris; None sin el color de alguno."""
        a, b = self.color_ao[k], self.color_ac[k]
        if a is None or b is None:
            return None
        # AMBIGUO: "subiendo" es el color de su barra (con el empate que conserva el color); con "estricto", un
        # empate no tiene color y la zona no se sabe.
        if a == SUBE and b == SUBE:
            return SUBE
        if a == BAJA and b == BAJA:
            return BAJA
        return 0


def series(velas, cache=None, opciones=None):
    """Las series de Williams de `velas`. Con `cache` (un dict, mientras la lista no cambie) se calculan una vez por
    lista y por opciones: el valor en i solo depende de las velas hasta i."""
    o = _opciones(opciones)
    if cache is None:
        return SeriesWilliams(velas, o)
    clave = ("williams", id(velas), len(velas), tuple(sorted(o.items())))
    w = cache.get(clave)
    if w is None:
        w = SeriesWilliams(velas, o)
        cache[clave] = w
    return w


# ------------------------------------------------------------------------- filtros de Williams

def filtro_alligator(velas, k, lado, modo, w=None, opciones=None):
    """`bwf.alligator`: "awake" (despierto a favor), "side" (el cierre del lado de los dientes a favor) o "sleeping"
    (dormido, para operar rangos; no mira el lado).
    valor: {"mandibula", "dientes", "labios", "atr", "abertura", "umbral", "estado", "cierre"}."""
    _revisar_k(velas, k)
    modo = str(modo)
    if modo not in ALLIGATOR_MODOS:
        raise ValueError(f"modo del Alligator desconocido: {modo!r}")
    w = w or SeriesWilliams(velas, opciones)
    o = w.opciones
    c = w.cierre[k]
    valor = {"mandibula": w.mandibula[k], "dientes": w.dientes[k], "labios": w.labios[k], "atr": w.atr[k], "cierre": c}
    if modo == "side":
        dientes = w.dientes[k] if o["dientes"] == "desplazados" else w.dientes_sin[k]
        valor["dientes_mirados"] = dientes
        if o["side_pide"] == "alligator" and (w.mandibula[k] is None or w.labios[k] is None):
            return _sin_dato("todavía no hay Alligator entero", valor)
        if dientes is None:
            return _sin_dato("todavía no hay dientes", valor)
        # AMBIGUO: "del lado de los dientes" es estricto: un cierre igual a los dientes no pasa a ningún lado.
        return Veredicto((c - dientes) * lado > 0, valor)
    estado, ab = w.estado(k)
    valor.update(abertura=ab, umbral=None if w.atr[k] is None else w.config["sleepAtr"] * w.atr[k], estado=estado)
    if estado is None:
        # Visto después (comparar_filtros2.py, 22/11): el motor da el estado 0 (dormido) en las velas 0 a 19 de la fase,
        # sin mandíbula todavía, y deja pasar ahí "sleeping".
        return _sin_dato("todavía no hay Alligator o ATR", valor)
    if modo == "awake":
        return Veredicto(estado == lado, valor)
    return Veredicto(estado == 0, valor)


def filtro_zona(velas, k, lado, w=None, opciones=None):
    """`bwf.zone`: la zona de Williams a favor (verde en un largo, roja en un corto).
    valor: {"ao", "ao_ant", "ac", "ac_ant", "color_ao", "color_ac", "zona"}."""
    _revisar_k(velas, k)
    w = w or SeriesWilliams(velas, opciones)
    z = w.zona(k)
    valor = {"ao": w.ao[k], "ao_ant": w.ao[k - 1] if k else None, "ac": w.ac[k], "ac_ant": w.ac[k - 1] if k else None,
             "color_ao": w.color_ao[k], "color_ac": w.color_ac[k], "zona": z}
    if z is None:
        return _sin_dato("sin el color del AO o del AC", valor)
    return Veredicto(z == lado, valor)


def filtro_momento(velas, k, lado, cual, modo, w=None, opciones=None):
    """`bwf.ao` o `bwf.ac` (cual = "ao" o "ac"): "color" (su barra a favor: verde, sube, en un largo; roja en un
    corto), "zero" (del lado del cero a favor) o "both" (las dos).
    valor: {cual, cual_ant, "color"}."""
    _revisar_k(velas, k)
    if cual not in ("ao", "ac"):
        raise ValueError(f"indicador desconocido: {cual!r}")
    modo = str(modo)
    if modo not in MOMENTO_MODOS:
        raise ValueError(f"modo del {cual.upper()} desconocido: {modo!r}")
    w = w or SeriesWilliams(velas, opciones)
    serie = w.ao if cual == "ao" else w.ac
    color = (w.color_ao if cual == "ao" else w.color_ac)[k]
    x = serie[k]
    valor = {cual: x, f"{cual}_ant": serie[k - 1] if k else None, "color": color}
    partes = []
    if modo in ("color", "both"):
        partes.append(None if color is None else color == lado)
    if modo in ("zero", "both"):
        # AMBIGUO: "del lado del cero" es estricto: un valor de 0 justo no pasa a ningún lado.
        partes.append(None if x is None else x * lado > 0)
    pasa = _juntar(partes)
    return Veredicto(pasa, valor, "" if pasa is not None else f"sin {cual.upper()} o sin su color")


def filtro_ao(velas, k, lado, modo, w=None, opciones=None):
    return filtro_momento(velas, k, lado, "ao", modo, w, opciones)


def filtro_ac(velas, k, lado, modo, w=None, opciones=None):
    return filtro_momento(velas, k, lado, "ac", modo, w, opciones)


def veredicto_gator(color_arriba, color_abajo, modo, pide="las_dos", valor=None):
    """"eating": las dos barras crecen (la boca se abre); "open": al menos una crece; "sleeping": las dos se
    achican. No mira el lado."""
    modo = str(modo)
    if modo not in GATOR_MODOS:
        raise ValueError(f"modo del Gator desconocido: {modo!r}")
    colores = [color_arriba, color_abajo]
    if pide == "las_dos" and (color_arriba is None or color_abajo is None):
        return _sin_dato("sin el color de una de las barras del Gator", valor)
    hay = [x for x in colores if x is not None]
    if not hay:
        return _sin_dato("sin las barras del Gator", valor)
    if modo == "eating":
        return Veredicto(len(hay) == 2 and all(x == SUBE for x in hay), valor)
    if modo == "open":
        return Veredicto(any(x == SUBE for x in hay), valor)
    return Veredicto(len(hay) == 2 and all(x == BAJA for x in hay), valor)


def filtro_gator(velas, k, lado, modo, w=None, opciones=None):
    """`bwf.gator`: "eating", "open" o "sleeping" (ver `veredicto_gator`).
    valor: {"arriba", "arriba_ant", "abajo", "abajo_ant", "color_arriba", "color_abajo"}."""
    _revisar_k(velas, k)
    w = w or SeriesWilliams(velas, opciones)
    valor = {"arriba": w.gator_arriba[k], "arriba_ant": w.gator_arriba[k - 1] if k else None,
             "abajo": w.gator_abajo[k], "abajo_ant": w.gator_abajo[k - 1] if k else None,
             "color_arriba": w.color_arriba[k], "color_abajo": w.color_abajo[k]}
    # AMBIGUO: el Gator entero es el dato que pide el filtro: sin el color de una barra no pasa ("las_dos").
    return veredicto_gator(w.color_arriba[k], w.color_abajo[k], modo, w.opciones["gator_pide"], valor)


def filtro_mfi(velas, k, lado, modo, w=None, opciones=None):
    """`bwf.mfi`: el tipo de vela del MFI: "green", "squat", "volume" (verde o squat: sube el volumen) o "notFake"
    (todo menos fake). No mira el lado.
    valor: {"mfi", "mfi_ant", "vol", "vol_ant", "dir_mfi", "dir_vol", "tipo"}."""
    _revisar_k(velas, k)
    modo = str(modo)
    if modo not in MFI_MODOS:
        raise ValueError(f"modo del MFI desconocido: {modo!r}")
    w = w or SeriesWilliams(velas, opciones)
    tipo = w.tipo_mfi[k]
    valor = {"mfi": w.mfi[k], "mfi_ant": w.mfi[k - 1] if k else None, "vol": _vol(velas[k]),
             "vol_ant": _vol(velas[k - 1]) if k else None, "dir_mfi": w.dir_mfi[k], "dir_vol": w.dir_vol[k], "tipo": tipo}
    if tipo is None:
        return _sin_dato("sin el tipo de vela del MFI", valor)
    return Veredicto(tipo in MFI_MODOS[modo], valor)


# ------------------------------------------------------------------------- horario

def _horario_pedido(hours):
    if _apagado(hours):
        return False
    if isinstance(hours, dict) and "on" in hours and _apagado(hours.get("on")):
        return False
    return True


def filtro_horario(tf, velas, k, lado, hours, opciones=None):
    """`hours` = {from, to, weekdays} en minutos del día UTC, sobre la hora en que se conoce la señal (el cierre de su
    vela, que es cuando se entra). Un horario que cruza la medianoche (from > to) también vale; con weekdays, solo de
    lunes a viernes. No mira el lado.
    valor: {"hora" (ISO UTC), "minuto", "dia" (0 = lunes), "desde", "hasta", "en_horas", "habil"}."""
    _revisar_k(velas, k)
    if not _horario_pedido(hours):
        return Veredicto(True, None, "sin filtro")
    o = _opciones(opciones)
    t = int(velas[k]["t"]) + (int(tf) * MINUTO if o["hora"] == "cierre" else 0)
    minuto = (t % DIA) // MINUTO
    # AMBIGUO: sin "from" o "to" el horario es el día entero (0 a 1439).
    desde = int(hours.get("from", 0))
    hasta = int(hours.get("to", 1439))
    # AMBIGUO: los dos bordes van incluidos ("de 17:30 a 21:30" en el CC medido toma las velas de 4 h que cierran a
    # las 17:30 y a las 21:30, y "solo de lunes a viernes" va de 0 a 1439).
    desde_el_inicio = (minuto >= desde) if o["desde"] == "incluido" else (minuto > desde)
    antes_del_fin = (minuto <= hasta) if o["hasta"] == "incluido" else (minuto < hasta)
    if desde <= hasta:
        en_horas = desde_el_inicio and antes_del_fin
    else:
        en_horas = desde_el_inicio or antes_del_fin
    momento = dt.datetime.fromtimestamp(t / 1000, dt.timezone.utc)
    dia = momento.weekday()
    # AMBIGUO: el día de la semana es el de esa misma hora en UTC (una vela de 4 h que abre el viernes a las 20:00
    # cierra el sábado a las 00:00: no es de lunes a viernes).
    habil = dia < 5
    pasa = en_horas and (habil or not hours.get("weekdays"))
    return Veredicto(pasa, {"hora": momento.strftime("%Y-%m-%d %H:%M"), "minuto": minuto, "dia": dia,
                            "desde": desde, "hasta": hasta, "en_horas": en_horas, "habil": habil})


# ------------------------------------------------------------------------- todos los de una regla

def evaluar_filtros(moneda, tf, velas, k, lado, regla, cache=None, opciones=None):
    """Los filtros de `regla["bwf"]` y `regla["hours"]` en la vela k.

    Devuelve (pasan_todos, {nombre: Veredicto}). pasan_todos es True solo si todos dan True: en la app un filtro sin
    dato no deja pasar. `cache`: ver `series()`. `moneda` no cambia nada: está por la forma común con filtros_a.py.
    """
    _revisar_k(velas, k)
    out = {}
    bwf = regla.get("bwf") or {}
    w = None

    def ws():
        nonlocal w
        if w is None:
            w = series(velas, cache, opciones)
        return w

    if not _apagado(bwf.get("alligator")):
        out["alligator"] = filtro_alligator(velas, k, lado, bwf["alligator"], ws())
    if not _apagado(bwf.get("zone")):
        out["zona"] = filtro_zona(velas, k, lado, ws())
    if not _apagado(bwf.get("ao")):
        out["ao"] = filtro_ao(velas, k, lado, bwf["ao"], ws())
    if not _apagado(bwf.get("ac")):
        out["ac"] = filtro_ac(velas, k, lado, bwf["ac"], ws())
    if not _apagado(bwf.get("gator")):
        out["gator"] = filtro_gator(velas, k, lado, bwf["gator"], ws())
    if not _apagado(bwf.get("mfi")):
        out["mfi"] = filtro_mfi(velas, k, lado, bwf["mfi"], ws())
    if _horario_pedido(regla.get("hours")):
        out["horario"] = filtro_horario(tf, velas, k, lado, regla["hours"], opciones)
    return all(v.pasa is True for v in out.values()), out
