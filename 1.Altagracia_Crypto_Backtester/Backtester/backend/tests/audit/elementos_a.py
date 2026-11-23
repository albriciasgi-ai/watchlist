"""Oráculo A de los elementos de velas del probador de reglas (App 1, backtesting global).

Escrito solo con la documentación, sin ver cómo los calcula la app:

- ``CHEQUEO_PRUEBAS_REGLAS.xlsx``, hojas "Elementos" y "Opciones";
- ``CLAUDE.md`` del Backtester: "PROBADOR DE REGLAS DEL OBSERVADOR" (VH, "Patrones de rechazo como
  elementos", "Volumen de Respuesta como elementos", "Impulso, IM", "FV y SP"), "VOLUMEN DE
  RESPUESTA" y "REJECTION PATTERNS: REGLA CORREGIDA";
- ``GUIA_PRUEBAS_REGLAS.pdf``: secciones 1 y 3, y las confusiones 8 y 39 de la sección 12.

No importa ni copia nada del backend ni del frontend. Donde la documentación no decide, la elección
va marcada con ``AMBIGUO`` en el comentario de su línea.

Elementos: FV (FVG nuevo), IM (Impulso), SP (Swing), VH (Volumen alto), RF (Flecha de volumen) y
HM, EN y DJ (martillo o estrella fugaz, envolvente y doji libélula o lápida).

Uso::

    evs = events("FV", bars, 240)                                   # parámetros de fábrica
    evs = events("IM", bars, 240, {"bars": 3, "atr": 2.0, "range": 1.5})
    evs = events("RF", bars, 240, {"rv": {"arrow": "against"}})     # también con el grupo de la regla
    evs = events("HM", bars, 60, {"pat": {"trend": False}}, detail=True)

Velas: ``[{"t": ms de apertura, "o", "h", "l", "c", "vol"}]``, cerradas, en orden y todas del marco
``tf`` (minutos). También se acepta ``"v"`` o ``"volume"`` en lugar de ``"vol"``.

Cada evento: ``{"code", "dir", "t", "known", "lo", "hi"}``:

- ``dir``: +1 alcista, -1 bajista;
- ``t``: hora de apertura de la vela del elemento;
- ``known``: el cierre de la vela con que se sabe (su ``t`` + ``tf``);
- ``lo``, ``hi``: la zona.

Con ``detail=True`` cada evento suma ``i`` (índice de la vela del elemento), ``known_i`` (índice de
la vela con que se sabe) e ``info`` (lo medido). Los eventos salen ordenados por ``(t, dir)``.

Parámetros comunes, en ``params`` (además de los de cada elemento, ver ``DEFAULTS``):

- ``atrSource``: "wilder" (de fábrica), "sma" (media simple de los últimos N rangos verdaderos),
  "sma_hl" (media simple de los últimos N máximo - mínimo), un número (ATR fijo) o una lista con el
  ATR de cada vela (para darle al oráculo el mismo ATR que usa la app);
- ``atrPeriod``: N de esos promedios, 14;
- ``hourKey``: qué es "su misma hora" para VH y RF: "slot" (de fábrica, la misma hora de apertura del
  día UTC) u "hour" (la misma hora UTC, con todas sus velas).
"""

import bisect
import math
import statistics

MINUTE_MS = 60_000
HOUR_MS = 60 * MINUTE_MS
DAY_MS = 24 * HOUR_MS

CODES = ("FV", "IM", "SP", "VH", "RF", "HM", "EN", "DJ")

# Grupo de la regla en que la app guarda los parámetros de cada elemento (hoja "Opciones"):
# fv.minAtr, im.{bars, atr, range}, sp.{bars, minZ}, rv.{leg, spike, arrow} y
# pat.{trend, trendBars, minZ, wick}. VH no tiene ajustes en la app ("Sin ajustes"); los suyos de
# aquí van en "vh".
GROUP = {"FV": "fv", "IM": "im", "SP": "sp", "VH": "vh", "RF": "rv",
         "HM": "pat", "EN": "pat", "DJ": "pat"}

_PAT = {"trend": True, "trendBars": 5, "minZ": None, "wick": 2.0}
DEFAULTS = {
    "FV": {"minAtr": 0.3},
    "IM": {"bars": 3, "atr": 2.0, "range": None},
    "SP": {"bars": 5, "minZ": None},
    "VH": {"mult": 2.0, "days": 30, "minDays": 10},
    "RF": {"leg": 2.0, "spike": 2.0, "arrow": "with", "days": 30, "minDays": 5},
    "HM": _PAT, "EN": _PAT, "DJ": _PAT,
}
COMMON = {"atrSource": "wilder", "atrPeriod": 14, "hourKey": "slot"}

# Formas de los patrones ("REJECTION PATTERNS: REGLA CORREGIDA"), en partes del rango de la vela.
DOJI_BODY = 0.05            # doji: cuerpo de hasta 5% del rango
DOJI_WICK = 0.10            # libélula: mecha de arriba de hasta 10%; lápida: la de abajo
HAMMER_BODY = 0.33          # AMBIGUO: "hasta 33%" se toma como 0.33 del rango, no como 1/3
HAMMER_OTHER_WICK = 0.10    # martillo: mecha de arriba de hasta 10% (estrella: la de abajo)
ENGULF_PREV_BODY = 0.10     # envolvente: la anterior con cuerpo de al menos 10% de su rango
ENGULF_BODY = 0.30          # envolvente: la actual con al menos 30% del suyo
Z_BARS = 20                 # z del volumen "contra las 20 anteriores", sin la vela

_ARROW = {
    "with": "with", "favor": "with", "a favor": "with", "a favor del tramo": "with",
    "vela a favor del tramo": "with",
    "against": "against", "contra": "against", "en contra": "against",
    "en contra del tramo": "against", "contra el tramo": "against",
    "vela contra el tramo": "against",
    "any": "any", "cualquiera": "any", "cualquier vela": "any",
}


# ------------------------------------------------------------------------------------ datos

def _num(x, what):
    try:
        v = float(x)
    except (TypeError, ValueError):
        raise ValueError(f"vela con {what} no numérico: {x!r}") from None
    if not math.isfinite(v):
        raise ValueError(f"vela con {what} no finito: {x!r}")
    return v


def _vol(b):
    for k in ("vol", "v", "volume"):
        if k in b and b[k] is not None:
            return _num(b[k], k)
    return 0.0


def _pos(x):
    """Un ATR utilizable: número finito y positivo; si no, None (AMBIGUO: un ATR de 0 no mide)."""
    if x is None or isinstance(x, bool):
        return None
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) and v > 0 else None


class _Velas:
    """Las velas en columnas. ``tf`` en minutos solo se usa para la hora en que se conoce cada una."""

    def __init__(self, bars, tf=1):
        tf = int(tf)
        if tf <= 0:
            raise ValueError("tf debe ser positivo (minutos)")
        self.tf_ms = tf * MINUTE_MS
        self.n = len(bars)
        self.t = [int(b["t"]) for b in bars]
        self.o = [_num(b["o"], "o") for b in bars]
        self.h = [_num(b["h"], "h") for b in bars]
        self.l = [_num(b["l"], "l") for b in bars]
        self.c = [_num(b["c"], "c") for b in bars]
        self.v = [_vol(b) for b in bars]
        for j in range(1, self.n):
            if self.t[j] <= self.t[j - 1]:
                raise ValueError("las velas deben venir en orden y sin horas repetidas")

    def known(self, j):
        """Cierre de la vela j: la hora en que se conoce todo lo que depende de ella."""
        return self.t[j] + self.tf_ms

    def color(self, j):
        """+1 verde (c > o), -1 roja (c < o), 0 sin color (c == o)."""
        d = self.c[j] - self.o[j]
        return 1 if d > 0 else (-1 if d < 0 else 0)


def _velas(bars, tf=1):
    return bars if isinstance(bars, _Velas) else _Velas(bars, tf)


def _ev(code, d, v, i, ki, lo, hi, detail, info):
    e = {"code": code, "dir": int(d), "t": v.t[i], "known": v.known(ki),
         "lo": float(lo), "hi": float(hi)}
    if detail:
        e["i"] = i
        e["known_i"] = ki
        e["info"] = info
    return e


def _sorted(evs):
    return sorted(evs, key=lambda e: (e["t"], e["dir"]))


# ------------------------------------------------------------------------------------ ATR

def true_ranges(bars):
    """Rango verdadero: máx(h - l, |h - c anterior|, |l - c anterior|).

    AMBIGUO: la primera vela, sin cierre anterior, usa h - l.
    """
    v = _velas(bars)
    out = []
    for j in range(v.n):
        r = v.h[j] - v.l[j]
        if j > 0:
            pc = v.c[j - 1]
            r = max(r, abs(v.h[j] - pc), abs(v.l[j] - pc))
        out.append(r)
    return out


def atr_series(bars, source="wilder", period=14):
    """El ATR de cada vela, con la vela incluida; None mientras no hay con qué calcularlo.

    AMBIGUO: la guía (confusión 39) dice que el ATR del stop es "la media de 14 velas" ("la media
    de los últimos 14 rangos") y que el del Impulso, el FVG nuevo y las cajas "es otro", sin decir
    cuál; el ATR con que gira el tramo de la flecha tampoco se dice. De fábrica se usa el ATR de
    Wilder de 14: media móvil de Wilder del rango verdadero, que arranca en la vela 13 con la media
    simple de los 14 primeros rangos. "sma" es la media simple de los últimos N rangos verdaderos y
    "sma_hl" la de los últimos N máximo - mínimo (las dos lecturas del ATR del stop). Un número es
    un ATR fijo, y una lista se usa tal cual (del largo de las velas).
    """
    v = _velas(bars)
    n = v.n
    if isinstance(source, bool):
        raise ValueError("atrSource no puede ser True o False")
    if isinstance(source, (int, float)):
        a = _pos(source)
        return [a] * n
    if isinstance(source, (list, tuple)):
        if len(source) != n:
            raise ValueError(f"la lista de ATR tiene {len(source)} valores y hay {n} velas")
        return [_pos(x) for x in source]
    period = int(period)
    if period < 1:
        raise ValueError("atrPeriod debe ser 1 o más")
    src = str(source or "wilder").lower()
    if src == "sma_hl":
        tr = [v.h[j] - v.l[j] for j in range(n)]
    elif src in ("sma", "wilder"):
        tr = true_ranges(v)
    else:
        raise ValueError(f"atrSource desconocido: {source!r}")
    out = [None] * n
    if src in ("sma", "sma_hl"):
        for j in range(period - 1, n):
            out[j] = sum(tr[j - period + 1:j + 1]) / period
    elif n >= period:
        a = sum(tr[:period]) / period
        out[period - 1] = a
        for j in range(period, n):
            a = (a * (period - 1) + tr[j]) / period
            out[j] = a
    return [_pos(x) for x in out]


def _atr(v, source, period):
    if source is None:
        source = COMMON["atrSource"]
    return atr_series(v, source, COMMON["atrPeriod"] if period is None else period)


# ------------------------------------------------------------------------------------ ayudas

def _zscore(vals, i, n=Z_BARS):
    """z del volumen de la vela i contra las n anteriores, sin ella.

    AMBIGUO: desviación poblacional (dividida por n, no por n - 1); con menos de n velas antes, o
    con todas iguales (desviación 0), no hay z y el filtro no deja pasar.
    """
    if i < n:
        return None
    ref = vals[i - n:i]
    m = sum(ref) / n
    var = sum((x - m) ** 2 for x in ref) / n
    if var <= 0:
        return None
    return (vals[i] - m) / math.sqrt(var)


def _misma_hora(v, days, key):
    """Para cada vela: (volúmenes de su misma hora en los ``days`` días anteriores, días que aportan).

    AMBIGUO, qué es "su misma hora": con "slot" (de fábrica) son las velas que abrieron a la misma
    hora del día UTC (t módulo 24 h), en los ``days`` días anteriores: de t - days·24 h, incluida,
    hasta t, sin la vela. Cada día aporta a lo sumo una vela, así que los días son las velas. Con
    "hour" son todas las velas de la misma hora UTC de los ``days`` días UTC anteriores, sin las del
    mismo día (en marcos de menos de 1 hora, varias por día). En 1h, 4h y 1D las dos dan lo mismo.
    AMBIGUO: "N días de historia" se cuenta como N días con una vela de esa hora en la ventana, no
    como N días desde la primera vela.
    """
    days = int(days)
    hist = {}
    out = []
    for i in range(v.n):
        t = v.t[i]
        if key == "slot":
            marks, vols = hist.setdefault(t % DAY_MS, ([], []))
            j0 = bisect.bisect_left(marks, t - days * DAY_MS)
            vals = vols[j0:]
            out.append((vals, len(vals)))
            marks.append(t)
        elif key == "hour":
            dia = t // DAY_MS
            marks, vols = hist.setdefault((t // HOUR_MS) % 24, ([], []))
            j0 = bisect.bisect_left(marks, dia - days)
            j1 = bisect.bisect_left(marks, dia)
            out.append((vols[j0:j1], len(set(marks[j0:j1]))))
            marks.append(dia)
        else:
            raise ValueError(f"hourKey desconocido: {key!r}")
        vols.append(v.v[i])
    return out


# ------------------------------------------------------------------------------------ FV

def fvg_nuevo(bars, tf, min_atr=0.3, atr=None, atr_period=None, detail=False):
    """FV, FVG nuevo.

    Hoja "Elementos": alcista si el mínimo de la vela queda sobre el máximo de dos velas antes;
    bajista al revés. CLAUDE.md: "la vela deja un hueco con la de dos antes (la regla del indicador
    FVG), de al menos fv.minAtr ATR (0.3); la zona es el hueco". La vela del elemento es la que deja
    el hueco (i) y se conoce al cerrarla.

    Alcista en i: hueco = l[i] - h[i-2] > 0, zona [h[i-2], l[i]].
    Bajista en i: hueco = l[i-2] - h[i] > 0, zona [h[i], l[i-2]].
    """
    v = _velas(bars, tf)
    a = _atr(v, atr, atr_period)
    min_atr = float(min_atr or 0.0)
    out = []
    for i in range(2, v.n):
        lados = ((1, v.l[i] - v.h[i - 2], v.h[i - 2], v.l[i]),
                 (-1, v.l[i - 2] - v.h[i], v.h[i], v.l[i - 2]))
        for d, gap, lo, hi in lados:
            if gap <= 0:        # AMBIGUO: "queda sobre" es estricto: un hueco de 0 no es FVG
                continue
            if min_atr > 0:
                # AMBIGUO: el ATR es el de la vela i (la que deja el hueco); sin ATR no hay evento.
                # "de al menos": el hueco igual a min_atr·ATR cuenta.
                if a[i] is None or gap < min_atr * a[i]:
                    continue
            # AMBIGUO: con min_atr = 0 ("acepta cualquier hueco") no hace falta ATR.
            # AMBIGUO: "nuevo" es el hueco en la vela que lo forma; no se pide nada más: ni el
            # color de la vela del medio, ni que no se solape con huecos anteriores.
            out.append(_ev("FV", d, v, i, i, lo, hi, detail, {"gap": gap, "atr": a[i]}))
    return _sorted(out)


# ------------------------------------------------------------------------------------ IM

def impulso(bars, tf, n=3, mult=2.0, rng=None, atr=None, atr_period=None, detail=False):
    """IM, Impulso.

    Hoja "Elementos" y "Opciones": "El cierre avanza X ATR o más contra el de N velas antes; un
    evento al empezar el impulso", "y la vela anterior no lo cumplía". Con ``rng`` (im.range), "la
    vela de la señal mide al menos eso". La zona va "del mínimo al máximo de las velas del impulso".
    Lado: hacia donde se mueve el precio. Se conoce al cerrar la vela i.
    """
    v = _velas(bars, tf)
    a = _atr(v, atr, atr_period)
    n = int(n)
    if n < 1:
        raise ValueError("im.bars debe ser 1 o más")
    mult = float(mult)
    rng = None if rng in (None, False, 0) else float(rng)

    def lado(i):
        # AMBIGUO: una vela sin N velas antes, o sin ATR, no cumple (vale también para "la vela
        # anterior": la primera que se puede medir puede ser comienzo). El ATR es el de la vela i.
        if i < n or a[i] is None:
            return 0
        d = v.c[i] - v.c[i - n]
        if d >= mult * a[i]:
            return 1
        if d <= -mult * a[i]:
            return -1
        return 0

    out = []
    for i in range(v.n):
        s = lado(i)
        if s == 0:
            continue
        # AMBIGUO: "la vela anterior no lo cumplía" se lee en el mismo sentido: si la anterior
        # cumplía el impulso contrario, esta es el comienzo de uno nuevo.
        if i > 0 and lado(i - 1) == s:
            continue
        # AMBIGUO: el alto mínimo se pide a la vela del comienzo (h - l ≥ range·ATR); si no lo
        # cumple, ese impulso no da evento aunque una vela posterior lo cumpla.
        if rng is not None and (v.h[i] - v.l[i]) < rng * a[i]:
            continue
        # AMBIGUO: "las velas del impulso" son las N velas en que avanzó el cierre (i-N+1 a i),
        # sin la de referencia (i-N).
        j0 = i - n + 1
        lo, hi = min(v.l[j0:i + 1]), max(v.h[j0:i + 1])
        # AMBIGUO: la vela del elemento (t) es la del comienzo (i), no la primera de las N velas.
        out.append(_ev("IM", s, v, i, i, lo, hi, detail,
                       {"move": v.c[i] - v.c[i - n], "atr": a[i]}))
    return _sorted(out)


# ------------------------------------------------------------------------------------ SP

def swing(bars, tf, n=5, min_z=None, detail=False):
    """SP, Swing.

    "Un mínimo o máximo único de sp.bars velas por lado (5), como el indicador Swing, con volumen
    z ≥ sp.minZ si se pide; se conoce al cerrar la última vela de su derecha, a favor del giro; la
    zona es su vela." Mínimo: alcista; máximo: bajista. La vela del elemento es la del swing (p) y se
    conoce al cerrar la vela p + N ("la entrada a mercado queda N + 1 velas después del swing").
    """
    v = _velas(bars, tf)
    n = int(n)
    if n < 1:
        raise ValueError("sp.bars debe ser 1 o más")
    out = []
    # AMBIGUO: la ventana tiene que estar entera a los dos lados (N velas antes y N después), y se
    # cuentan velas de la lista aunque haya huecos de tiempo entre ellas.
    for p in range(n, v.n - n):
        vecinas = [q for q in range(p - n, p + n + 1) if q != p]
        # "único": empatar con una vecina no cuenta. AMBIGUO: una vela puede ser a la vez mínimo y
        # máximo de su ventana y da los dos eventos.
        lados = ((1, all(v.l[p] < v.l[q] for q in vecinas)),
                 (-1, all(v.h[p] > v.h[q] for q in vecinas)))
        for d, ok in lados:
            if not ok:
                continue
            z = None
            if min_z is not None:
                z = _zscore(v.v, p)
                if z is None or z < float(min_z):
                    continue
            # AMBIGUO: t es la vela del swing (p). La guía (confusión 15) dice que el stop "extremo
            # de la vela del elemento" empieza en la vela que confirma el swing: si la app fecha el
            # voto en p + N, comparar con known, no con t.
            out.append(_ev("SP", d, v, p, p + n, v.l[p], v.h[p], detail, {"z": z}))
    return _sorted(out)


# ------------------------------------------------------------------------------------ VH

def volumen_alto(bars, tf, mult=2.0, days=30, min_days=10, hour_key="slot", detail=False):
    """VH, Volumen alto.

    "Vela con el doble del volumen medio de su misma hora en los 30 días anteriores, hacia su color."
    Hoja "Elementos": "con 10 días o más de historia. Un doji no cuenta." Guía, confusión 39:
    "compara con la media de su hora (10 días o más)". La zona es la vela; se conoce al cerrarla.
    """
    v = _velas(bars, tf)
    ref = _misma_hora(v, days, hour_key)
    out = []
    for i in range(v.n):
        d = v.color(i)
        if d == 0:              # AMBIGUO: "un doji no cuenta" se lee como vela sin color (c == o)
            continue
        vals, ndays = ref[i]
        if ndays < int(min_days):
            continue
        m = sum(vals) / len(vals)
        if m <= 0:              # AMBIGUO: sin volumen de referencia no hay comparación
            continue
        if v.v[i] < float(mult) * m:    # AMBIGUO: "el doble" cuenta con igualdad (≥)
            continue
        out.append(_ev("VH", d, v, i, i, v.l[i], v.h[i], detail,
                       {"ratio": v.v[i] / m, "mean": m, "days": ndays}))
    return _sorted(out)


# ------------------------------------------------------------------------------------ RF

def tramo(bars, leg=2.0, atr=None, atr_period=None):
    """Dirección del tramo en curso al cierre de cada vela: +1, -1 o 0 si todavía no hay tramo.

    "VOLUMEN DE RESPUESTA": "El tramo gira cuando un cierre se aleja 2 ATR del extremo".
    AMBIGUO, todo lo que sigue:
    - el extremo de un tramo alcista es el máximo de sus velas, y el de uno bajista, el mínimo; gira
      cuando el cierre queda a leg·ATR o más de él (con igualdad), con el ATR de esa vela;
    - al empezar no hay tramo: se siguen el máximo y el mínimo desde la primera vela, y el primer
      tramo es el del primer cierre que se aleja leg·ATR de uno de ellos (si se aleja de los dos,
      gana el extremo más reciente);
    - al girar, el extremo del tramo nuevo se toma de la vela siguiente al extremo anterior hasta la
      vela que gira (o solo esta, si el extremo anterior es ella misma);
    - lo que vale para una vela es el tramo después de su cierre: una vela que hace girar el tramo
      ya está en el tramo nuevo;
    - una vela sin ATR no hace girar nada, pero mueve el extremo.
    """
    v = _velas(bars)
    a = _atr(v, atr, atr_period)
    return _tramo(v, float(leg), a)


def _extremo(serie, desde, j, f):
    k0 = desde + 1 if desde < j else j
    vals = serie[k0:j + 1]
    x = f(vals)
    return x, k0 + vals.index(x)


def _tramo(v, leg, a):
    out = [0] * v.n
    d = 0
    hi = lo = ext = None
    hi_i = lo_i = ext_i = None
    for j in range(v.n):
        if d == 0:
            if hi is None or v.h[j] > hi:
                hi, hi_i = v.h[j], j
            if lo is None or v.l[j] < lo:
                lo, lo_i = v.l[j], j
            if a[j] is not None:
                baja = v.c[j] <= hi - leg * a[j]
                sube = v.c[j] >= lo + leg * a[j]
                if baja and sube:
                    baja = hi_i >= lo_i
                    sube = not baja
                if baja:
                    d = -1
                    ext, ext_i = _extremo(v.l, hi_i, j, min)
                elif sube:
                    d = 1
                    ext, ext_i = _extremo(v.h, lo_i, j, max)
        elif d == 1:
            if v.h[j] > ext:
                ext, ext_i = v.h[j], j
            if a[j] is not None and v.c[j] <= ext - leg * a[j]:
                d = -1
                ext, ext_i = _extremo(v.l, ext_i, j, min)
        else:
            if v.l[j] < ext:
                ext, ext_i = v.l[j], j
            if a[j] is not None and v.c[j] >= ext + leg * a[j]:
                d = 1
                ext, ext_i = _extremo(v.h, ext_i, j, max)
        out[j] = d
    return out


def flecha_volumen(bars, tf, leg=2.0, spike=2.0, arrow="with", days=30, min_days=5,
                   hour_key="slot", atr=None, atr_period=None, detail=False):
    """RF, Flecha de volumen.

    "Vela con rv.spike veces (2) la mediana del volumen de su hora en 30 días. Su lado es el color
    de la vela. rv.arrow: with (de fábrica, la vela va a favor del tramo), against o any. La zona es
    la vela." "Las primeras velas de cada fase no dan flechas: el volumen por hora pide 5 días
    previos". "rv.leg (2): ATR con que gira el tramo". Se conoce al cerrar la vela.
    """
    mode = _ARROW.get(str(arrow).strip().lower())
    if mode is None:
        raise ValueError(f"rv.arrow desconocido: {arrow!r}")
    v = _velas(bars, tf)
    a = _atr(v, atr, atr_period)
    legs = _tramo(v, float(leg), a)
    ref = _misma_hora(v, days, hour_key)
    out = []
    for i in range(v.n):
        d = v.color(i)
        if d == 0:              # AMBIGUO: una vela sin color (c == o) no tiene lado: no da flecha
            continue
        vals, ndays = ref[i]
        if ndays < int(min_days):
            continue
        med = statistics.median(vals)   # AMBIGUO: con un número par, la media de las dos del medio
        if med <= 0:
            continue
        if v.v[i] < float(spike) * med:     # AMBIGUO: "2 veces o más" cuenta con igualdad
            continue
        # AMBIGUO: sin tramo todavía (0), ni "a favor" ni "en contra" dan flecha; "cualquiera" sí.
        if mode == "with" and legs[i] != d:
            continue
        if mode == "against" and legs[i] != -d:
            continue
        out.append(_ev("RF", d, v, i, i, v.l[i], v.h[i], detail,
                       {"ratio": v.v[i] / med, "median": med, "days": ndays, "leg": legs[i]}))
    return _sorted(out)


# ------------------------------------------------------------------------------------ HM, EN, DJ

def _forma(v, i, wick):
    """El patrón de la vela i por su forma, o None: (código, dir, nombre).

    "Una vela tiene a lo sumo un patrón: doji, si no envolvente, si no martillo o estrella."
    """
    o, h, l, c = v.o[i], v.h[i], v.l[i], v.c[i]
    rng = h - l
    if rng <= 0:                # AMBIGUO: una vela sin rango no tiene patrón
        return None
    body = abs(c - o)
    up = h - max(o, c)
    low = min(o, c) - l
    # Doji: cuerpo de hasta 5% del rango; libélula con la mecha de arriba de hasta 10%, lápida con la
    # de abajo de hasta 10%. Los bordes cuentan ("hasta").
    if body <= DOJI_BODY * rng:
        if up <= DOJI_WICK * rng:
            return "DJ", 1, "doji libélula"
        if low <= DOJI_WICK * rng:
            return "DJ", -1, "doji lápida"
        # Un doji de mechas largas no es libélula ni lápida: no da patrón. Tampoco podría ser
        # envolvente (cuerpo ≥ 30%) ni martillo o estrella (pide una mecha de hasta 10%).
        return None
    # Envolvente: colores opuestos, la anterior con cuerpo de al menos 10% de su rango, la actual con
    # al menos 30% del suyo, el cuerpo más grande y cubriendo el anterior (un empate en un borde vale).
    if i >= 1:
        po, ph, pl, pc = v.o[i - 1], v.h[i - 1], v.l[i - 1], v.c[i - 1]
        prng = ph - pl
        pbody = abs(pc - po)
        # AMBIGUO: "el cuerpo más grande" es estricto.
        if prng > 0 and pbody >= ENGULF_PREV_BODY * prng and body >= ENGULF_BODY * rng \
                and body > pbody:
            if c > o and pc < po and o <= pc and c >= po:
                return "EN", 1, "envolvente alcista"
            if c < o and pc > po and o >= pc and c <= po:
                return "EN", -1, "envolvente bajista"
    # Martillo: cuerpo de hasta 33% del rango, mecha de abajo de al menos `wick` cuerpos y mecha de
    # arriba de hasta 10% del rango. La estrella fugaz, al revés.
    if body <= HAMMER_BODY * rng:
        if low >= wick * body and up <= HAMMER_OTHER_WICK * rng:
            return "HM", 1, "martillo"
        if up >= wick * body and low <= HAMMER_OTHER_WICK * rng:
            return "HM", -1, "estrella fugaz"
    return None


def _tendencia(v, i, d, n):
    """Tendencia previa: "los alcistas piden que el cierre anterior esté bajo el de 5 velas antes,
    y los bajistas, sobre él".

    AMBIGUO: "5 velas antes" se cuenta desde el cierre anterior: c[i-1] contra c[i-1-N], con
    desigualdad estricta. Sin esa vela (menos de N + 1 velas antes) el patrón no pasa.
    """
    j = i - 1 - n
    if j < 0:
        return False
    if d > 0:
        return v.c[i - 1] < v.c[j]
    return v.c[i - 1] > v.c[j]


def patrones(bars, tf, trend=True, trend_bars=5, min_z=None, wick=2.0, detail=False):
    """HM, EN y DJ juntos ("REJECTION PATTERNS: REGLA CORREGIDA", "Patrones de rechazo como
    elementos").

    HM: martillo (alcista) o estrella fugaz (bajista); EN: envolvente alcista o bajista; DJ: doji
    libélula (alcista) o lápida (bajista). La zona es la vela; se conoce al cerrarla. Se calculan
    los tres juntos, aunque la regla use uno (guía, confusiones 8 y 36): un martillo que también es
    envolvente es envolvente, y una regla solo con "Martillo o estrella" no lo ve.
    """
    v = _velas(bars, tf)
    trend_bars = int(trend_bars)
    wick = float(wick)
    out = []
    for i in range(v.n):
        f = _forma(v, i, wick)
        if f is None:
            continue
        code, d, name = f
        # AMBIGUO: la prioridad de la forma va antes que la tendencia: si la vela es envolvente
        # por su forma y no pasa la tendencia, no se mira si sería martillo o estrella (aunque la
        # estrella vaya del otro lado y sí la pasara).
        if trend and not _tendencia(v, i, d, trend_bars):
            continue
        z = None
        if min_z is not None:
            z = _zscore(v.v, i)
            if z is None or z < float(min_z):
                continue
        out.append(_ev(code, d, v, i, i, v.l[i], v.h[i], detail, {"name": name, "z": z}))
    return _sorted(out)


def martillo(bars, tf, **kw):
    return [e for e in patrones(bars, tf, **kw) if e["code"] == "HM"]


def envolvente(bars, tf, **kw):
    return [e for e in patrones(bars, tf, **kw) if e["code"] == "EN"]


def doji(bars, tf, **kw):
    return [e for e in patrones(bars, tf, **kw) if e["code"] == "DJ"]


# ------------------------------------------------------------------------------------ despacho

def element_params(code, params=None):
    """Los parámetros de un elemento: los de fábrica, los comunes, los sueltos de ``params`` y,
    encima, los del grupo de la regla (``params["im"]``, ``params["pat"]``...). Lo que no se usa se
    ignora, así se puede pasar la regla entera."""
    code = str(code).upper()
    if code not in CODES:
        raise ValueError(f"elemento desconocido: {code!r} (vale: {', '.join(CODES)})")
    p = dict(COMMON)
    p.update(DEFAULTS[code])
    if params:
        if not isinstance(params, dict):
            raise TypeError("params debe ser un dict")
        for k, val in params.items():
            if k in p:
                p[k] = val
        sub = params.get(GROUP[code])
        if isinstance(sub, dict):
            for k, val in sub.items():
                if k in p:
                    p[k] = val
    return code, p


def events(code, bars, tf, params=None, detail=False):
    """Los eventos del elemento ``code`` en ``bars`` (velas cerradas de ``tf`` minutos)."""
    code, p = element_params(code, params)
    atr, per = p["atrSource"], p["atrPeriod"]
    if code == "FV":
        return fvg_nuevo(bars, tf, p["minAtr"], atr, per, detail)
    if code == "IM":
        return impulso(bars, tf, p["bars"], p["atr"], p["range"], atr, per, detail)
    if code == "SP":
        return swing(bars, tf, p["bars"], p["minZ"], detail)
    if code == "VH":
        return volumen_alto(bars, tf, p["mult"], p["days"], p["minDays"], p["hourKey"], detail)
    if code == "RF":
        return flecha_volumen(bars, tf, p["leg"], p["spike"], p["arrow"], p["days"],
                              p["minDays"], p["hourKey"], atr, per, detail)
    evs = patrones(bars, tf, p["trend"], p["trendBars"], p["minZ"], p["wick"], detail)
    return [e for e in evs if e["code"] == code]
