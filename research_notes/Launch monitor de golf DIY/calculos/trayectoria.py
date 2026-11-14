# -*- coding: utf-8 -*-
"""
Simulador 3D del vuelo de la bola de golf.

Fuerzas: gravedad, arrastre, sustentación Magnus con eje de giro inclinado,
y decaimiento del giro. Coeficientes del modelo de Smits & Smith (1994),
"A new aerodynamic model of a golf ball in flight", Science and Golf II,
tal como lo resume la patente US 6,186,002:

    CD = 0.24 + 0.18·S + 0.06·sin(π·(Re − 90 000)/200 000)
    CL = 0.54·S^0.4
    dω/dt = −R1·(V/r)·ω,  R1 = 2e-5   (V en m/s, r radio de la bola)

con S = r·ω/V (parámetro de giro) y Re = ρ·V·D/μ.
Rango medido por Smits & Smith: 40 000 < Re < 250 000.

El modelo publicado (bolas de 1994) no reproduce los promedios de TrackMan
(driver ~26-29 yd corto, hierros largos): main() documenta el re-ajuste de
4 constantes (cd2, cd3, cl1, p) con validación cruzada.

Ejes: x hacia el objetivo, y hacia la IZQUIERDA, z hacia arriba.
Convenciones de TrackMan: HLA (launch direction) positivo = a la derecha;
eje de giro (spin axis) positivo = la bola curva a la derecha.

Uso:  python trayectoria.py   (escribe resultados/trayectoria.md y
      resultados/modelo_ajustado.json)
"""
import json
import math
import os

import numpy as np
from scipy.integrate import solve_ivp
from scipy.optimize import least_squares

from comun import (MPH, YD, RPM, G0, M_BOLA, D_BOLA, R_BOLA, A_BOLA,
                   escenarios_atmosfera, tabla_md)

DIR = os.path.dirname(os.path.abspath(__file__))
DIR_RES = os.path.join(DIR, "resultados")


# ---------------------------------------------------------------------------
# Modelo aerodinámico
# ---------------------------------------------------------------------------
class ModeloAero:
    """Forma funcional de Smits & Smith (1994) con sus constantes explícitas.

        CD = k_cd·[cd1 + cd2·S + cd3·sin(π·(Re − a1)/a2)]
        CL = k_cl·cl1·S^p
        dω/dt = −r1·(V/r)·ω

    Valores publicados: cd1=0.24, cd2=0.18, cd3=0.06, a1=90 000,
    a2=200 000, cl1=0.54, p=0.4, r1=2e-5 (k_cd = k_cl = 1).
    """

    RE_MIN, RE_MAX = 4.0e4, 2.5e5   # rango medido; fuera se satura
    PUBLICADO = dict(cd1=0.24, cd2=0.18, cd3=0.06, a1=9.0e4, a2=2.0e5,
                     cl1=0.54, p=0.4, r1=2.0e-5, k_cd=1.0, k_cl=1.0)

    def __init__(self, nombre="Smits & Smith 1994 (publicado)", **constantes):
        self.nombre = nombre
        self.c = dict(self.PUBLICADO)
        self.c.update(constantes)

    def cd(self, s, re):
        c = self.c
        re_c = min(max(re, self.RE_MIN), self.RE_MAX)
        base = c["cd1"] + c["cd2"] * s + c["cd3"] * math.sin(math.pi * (re_c - c["a1"]) / c["a2"])
        return c["k_cd"] * base

    def cl(self, s):
        c = self.c
        return c["k_cl"] * c["cl1"] * max(s, 0.0) ** c["p"]

    def tasa_decaimiento(self, v):
        """Fracción del giro que se pierde por segundo (1/s) a velocidad v."""
        return self.c["r1"] * v / R_BOLA

    def describir(self):
        c = self.c
        cambiados = [k for k in c if abs(c[k] - self.PUBLICADO[k]) > 1e-12]
        if not cambiados:
            return "constantes publicadas"
        return ", ".join(f"{k}={c[k]:.4g} (publ. {self.PUBLICADO[k]:.4g})" for k in cambiados)

    def como_dict(self):
        return {"nombre": self.nombre, "constantes": self.c}

    @classmethod
    def desde_dict(cls, d):
        return cls(d["nombre"], **d["constantes"])


# ---------------------------------------------------------------------------
# Simulación
# ---------------------------------------------------------------------------
def vectores_lanzamiento(vla_deg, hla_deg, eje_deg):
    """Dirección de salida y dirección del eje de giro (fija en el espacio)."""
    th, ph, al = map(math.radians, (vla_deg, hla_deg, eje_deg))
    ev = np.array([math.cos(th) * math.cos(ph), -math.cos(th) * math.sin(ph), math.sin(th)])
    er = np.cross(ev, [0.0, 0.0, 1.0])          # horizontal, hacia la derecha
    er /= np.linalg.norm(er)
    eu = np.cross(er, ev)                        # perpendicular a la salida, "arriba"
    w_hat = math.cos(al) * er - math.sin(al) * eu
    return ev, w_hat


def simular(vb_mph, vla_deg, spin_rpm, hla_deg=0.0, eje_deg=0.0, atm=None,
            modelo=None, traza=False):
    """Simula un golpe y devuelve un diccionario con los resultados.

    Entradas en las unidades de un launch monitor (mph, grados, rpm).
    Salidas: carry, altura máxima, ángulo de llegada, desvío lateral total
    (offline, + derecha), curva respecto a la línea de salida (+ derecha),
    tiempo de vuelo y giro al aterrizar.
    """
    if atm is None:
        atm = escenarios_atmosfera()["mar_isa"]
    if modelo is None:
        modelo = ModeloAero()
    rho, mu = atm.rho, atm.mu
    k = rho * A_BOLA / (2.0 * M_BOLA)
    ev, w_hat = vectores_lanzamiento(vla_deg, hla_deg, eje_deg)
    v0 = vb_mph * MPH
    y0 = np.concatenate([[0.0, 0.0, 0.0], v0 * ev, [spin_rpm * RPM]])

    def f(t, y):
        vel = y[3:6]
        v = math.sqrt(vel[0] ** 2 + vel[1] ** 2 + vel[2] ** 2)
        vhat = vel / v
        c = np.cross(w_hat, vhat)
        sc = math.sqrt(c[0] ** 2 + c[1] ** 2 + c[2] ** 2)
        w = y[6]
        s = R_BOLA * w * sc / v
        re = rho * v * D_BOLA / mu
        acc = -k * modelo.cd(s, re) * v * vel
        if sc > 1e-12:
            acc = acc + k * modelo.cl(s) * v * v * (c / sc)
        acc[2] -= G0
        dw = -modelo.tasa_decaimiento(v) * w
        return [vel[0], vel[1], vel[2], acc[0], acc[1], acc[2], dw]

    def aterriza(t, y):
        return y[2]
    aterriza.terminal = True
    aterriza.direction = -1

    def apice(t, y):
        return y[5]
    apice.terminal = False
    apice.direction = -1

    sol = solve_ivp(f, (0.0, 30.0), y0, method="DOP853", rtol=1e-9, atol=1e-9,
                    events=(aterriza, apice), max_step=0.05, dense_output=traza)
    if sol.t_events[0].size == 0:
        raise RuntimeError("La bola no aterrizó en 30 s")
    ya = sol.y_events[0][0]
    t_vuelo = float(sol.t_events[0][0])
    z_max = float(sol.y_events[1][0][2]) if sol.t_events[1].size else 0.0
    vx, vy, vz = ya[3:6]
    vh = math.hypot(vx, vy)
    carry = math.hypot(ya[0], ya[1])
    offline = -ya[1]                                     # + derecha
    # curva: distancia (con signo) desde la línea de salida horizontal
    ph = math.radians(hla_deg)
    d_sal = np.array([math.cos(ph), -math.sin(ph)])      # dirección de salida en el plano
    n_der = np.array([-math.sin(ph), -math.cos(ph)])     # normal a la derecha
    curva = float(np.dot(ya[0:2], n_der))
    res = {
        "carry_yd": carry / YD,
        "hmax_yd": z_max / YD,
        "land_deg": math.degrees(math.atan2(-vz, vh)),
        "offline_yd": offline / YD,
        "curva_yd": curva / YD,
        "t_vuelo_s": t_vuelo,
        "spin_final_rpm": ya[6] / RPM,
        "v_final_mph": math.sqrt(vx * vx + vy * vy + vz * vz) / MPH,
    }
    if traza:
        res["sol"] = sol
    return res


# ---------------------------------------------------------------------------
# Datos de validación (promedios del PGA Tour medidos con TrackMan)
# ---------------------------------------------------------------------------
# Tabla clásica "PGA TOUR AVERAGES" de TrackMan (PDF de 2019, también en
# support.trackmangolf.com). Tiene carry, altura máxima y ángulo de llegada.
TRACKMAN_CLASICO = {
    "Driver":   dict(vb=167.0, vla=10.9, spin=2686.0, carry=275.0, hmax=32.0, land=38.0),
    "Hierro 7": dict(vb=120.0, vla=16.3, spin=7097.0, carry=172.0, hmax=32.0, land=50.0),
    "PW":       dict(vb=102.0, vla=24.2, spin=9304.0, carry=136.0, hmax=29.0, land=52.0),
}
# Promedios actualizados de TrackMan (mayo 2024, temporada 2023). Solo los
# campos confirmados en la búsqueda; None = no confirmado.
TRACKMAN_2024 = {
    "Driver":   dict(vb=171.0, vla=10.4, spin=2545.0, carry=282.0, hmax=35.0, land=None),
    "Hierro 7": dict(vb=123.0, vla=16.1, spin=7124.0, carry=176.0, hmax=None, land=51.0),
}

TOLERANCIAS = {"carry": 2.0, "hmax": 1.0, "land": 1.0}   # pesos del ajuste


def errores(modelo, datos, atm):
    """Errores simulado − TrackMan por palo y métrica."""
    out = {}
    for palo, d in datos.items():
        r = simular(d["vb"], d["vla"], d["spin"], atm=atm, modelo=modelo)
        e = {"sim": r}
        for m, clave in (("carry", "carry_yd"), ("hmax", "hmax_yd"), ("land", "land_deg")):
            if d.get(m) is not None:
                e[m] = r[clave] - d[m]
        out[palo] = e
    return out


ESCALA = {"a1": 1e5, "a2": 1e5, "r1": 1e-5}
LIMITES = {"cd1": (0.10, 0.40), "cd2": (-0.5, 1.5), "cd3": (-0.15, 0.15),
           "a1": (-0.5e5, 2.5e5), "cl1": (0.2, 1.2), "p": (0.1, 1.2),
           "r1": (2e-6, 8e-5), "k_cd": (0.5, 1.5), "k_cl": (0.5, 1.5)}


def ajustar(datos, atm, libres, nombre, fijos=None):
    """Mínimos cuadrados ponderados (TOLERANCIAS) sobre las constantes libres.

    fijos: constantes que se fijan en otro valor distinto del publicado.
    """
    esc = [ESCALA.get(n, 1.0) for n in libres]
    fijos = dict(fijos or {})

    def armar(x):
        c = dict(fijos)
        c.update({n: xi * e for n, xi, e in zip(libres, x, esc)})
        return ModeloAero(nombre, **c)

    def fun(x):
        res = []
        for e in errores(armar(x), datos, atm).values():
            for m in ("carry", "hmax", "land"):
                if m in e:
                    res.append(e[m] / TOLERANCIAS[m])
        return np.array(res)

    x0 = [ModeloAero.PUBLICADO[n] / e for n, e in zip(libres, esc)]
    lo = [LIMITES[n][0] / e for n, e in zip(libres, esc)]
    hi = [LIMITES[n][1] / e for n, e in zip(libres, esc)]
    sol = least_squares(fun, x0, bounds=(lo, hi), diff_step=1e-3)
    return armar(sol.x), sol


def tabla_validacion(modelo, datos, atm, titulo):
    errs = errores(modelo, datos, atm)
    filas = []
    for palo, d in datos.items():
        r = errs[palo]["sim"]
        def celda(m, clave, fmt):
            if d.get(m) is None:
                return f"{r[clave]:{fmt}} (s/d)"
            return f"{r[clave]:{fmt}} vs {d[m]:{fmt}} ({errs[palo][m]:+{fmt}})"
        filas.append([palo, f"{d['vb']:.0f} / {d['vla']:.1f} / {d['spin']:.0f}",
                      celda("carry", "carry_yd", ".1f"), celda("hmax", "hmax_yd", ".1f"),
                      celda("land", "land_deg", ".1f"), f"{r['t_vuelo_s']:.2f}",
                      f"{r['spin_final_rpm']:.0f}"])
    enc = ["Palo", "Bola mph / VLA° / rpm", "Carry yd sim vs TM (err)",
           "Altura máx yd sim vs TM (err)", "Ángulo llegada ° sim vs TM (err)",
           "Vuelo s", "Giro al aterrizar rpm"]
    return f"**{titulo}** — {modelo.nombre}: {modelo.describir()}; aire: {atm}\n\n" + \
        tabla_md(enc, filas)


def rms_errores(modelo, datos, atm):
    errs = errores(modelo, datos, atm)
    acum = {"carry": [], "hmax": [], "land": []}
    for e in errs.values():
        for m in acum:
            if m in e:
                acum[m].append(e[m])
    return {m: (math.sqrt(np.mean(np.square(v))) if v else float("nan")) for m, v in acum.items()}


def tabla_altitud(modelo, esc):
    palos = {"Driver (TM 2024)": TRACKMAN_2024["Driver"],
             "Hierro 7 (TM 2024)": TRACKMAN_2024["Hierro 7"],
             "PW (TM clásico)": TRACKMAN_CLASICO["PW"]}
    claves = ["mar_isa", "med_isa", "med_isa_tloc", "med_calida",
              "bog_isa", "bog_isa_tloc", "bog_calida"]
    filas = []
    base = {p: simular(d["vb"], d["vla"], d["spin"], atm=esc["mar_isa"], modelo=modelo)
            for p, d in palos.items()}
    for c in claves:
        a = esc[c]
        fila = [a.nombre, f"{a.p/1000:.1f}", f"{a.rho:.3f}"]
        for p, d in palos.items():
            r = simular(d["vb"], d["vla"], d["spin"], atm=a, modelo=modelo)
            gan = 100.0 * (r["carry_yd"] / base[p]["carry_yd"] - 1.0)
            fila.append(f"{r['carry_yd']:.1f} ({gan:+.1f}%) · h {r['hmax_yd']:.1f} · "
                        f"{r['land_deg']:.0f}°")
        filas.append(fila)
    enc = ["Aire", "p kPa", "ρ kg/m³"] + [f"{p}: carry yd (Δ%) · altura yd · llegada" for p in palos]
    return tabla_md(enc, filas)


TODOS = {**{f"{k} (clásico)": v for k, v in TRACKMAN_CLASICO.items()},
         **{f"{k} (2024)": v for k, v in TRACKMAN_2024.items()}}
LIBRES_FINAL = ("cd2", "cd3", "cl1", "p")
RUTA_MODELO = os.path.join(DIR_RES, "modelo_ajustado.json")


def modelo_final(clave="final"):
    """Modelo ajustado que usan los demás scripts (lo calcula si no existe).

    clave: "final", "variante_sin_re", "variante_re_publicado", "publicado"...
    """
    if os.path.exists(RUTA_MODELO):
        with open(RUTA_MODELO, encoding="utf-8") as fh:
            return ModeloAero.desde_dict(json.load(fh)[clave])
    mod, _ = ajustar(TODOS, escenarios_atmosfera()["mar_isa"], LIBRES_FINAL,
                     "Smits & Smith 1994 re-ajustado a TrackMan")
    return mod


def main():
    os.makedirs(DIR_RES, exist_ok=True)
    esc = escenarios_atmosfera()
    atm = esc["mar_isa"]
    partes = ["# Resultados del simulador de trayectoria\n", "Escenarios de aire:\n"]
    partes += [f"- {a}" for a in esc.values()]
    partes.append("")

    def bloque(mod, titulo):
        partes.append(tabla_validacion(mod, TRACKMAN_CLASICO, atm, titulo + " — tabla clásica"))
        partes.append("")
        partes.append(tabla_validacion(mod, TRACKMAN_2024, atm, titulo + " — TrackMan 2024"))
        partes.append("")

    base = ModeloAero()
    bloque(base, "1) Modelo publicado, SIN ajuste")
    partes.append(tabla_validacion(base, TRACKMAN_CLASICO, esc["mar_25c"],
                                   "1b) Publicado, aire a 25 °C — tabla clásica"))
    partes.append("")

    escala, _ = ajustar(TODOS, atm, ("k_cd", "k_cl"), "Publicado con CD y CL escalados")
    bloque(escala, "2) Solo escalar CD y CL (2 factores, ajuste con ambas tablas)")

    cruz, _ = ajustar(TRACKMAN_CLASICO, atm, LIBRES_FINAL, "Re-ajuste solo con la tabla clásica")
    bloque(cruz, "3) Validación cruzada: 4 constantes ajustadas SOLO con la tabla clásica")

    final, sol = ajustar(TODOS, atm, LIBRES_FINAL, "Smits & Smith 1994 re-ajustado a TrackMan")
    bloque(final, "4) MODELO FINAL: 4 constantes ajustadas con ambas tablas")

    resumen = []
    for etiqueta, mod in (("1) publicado", base), ("2) escalar CD y CL", escala),
                          ("3) 4 const., tabla clásica", cruz), ("4) final, ambas tablas", final)):
        a = rms_errores(mod, TRACKMAN_CLASICO, atm)
        b = rms_errores(mod, TRACKMAN_2024, atm)
        resumen.append([etiqueta, mod.describir(),
                        f"{a['carry']:.1f} / {a['hmax']:.1f} / {a['land']:.1f}",
                        f"{b['carry']:.1f} / {b['hmax']:.1f} / {b['land']:.1f}"])
    partes.append("**Resumen (RMS de errores: carry yd / altura yd / ángulo de llegada °)**\n")
    partes.append(tabla_md(["Variante", "Constantes cambiadas", "RMS tabla clásica",
                            "RMS TrackMan 2024"], resumen))
    partes.append("")

    # Variantes con otra dependencia de Re que ajustan casi igual a nivel del mar
    sin_re, _ = ajustar(TODOS, atm, ("cd1", "cd2", "cl1", "p"),
                        "Variante: CD sin dependencia de Re (cd3=0)", fijos={"cd3": 0.0})
    re_publ, _ = ajustar(TODOS, atm, ("cd1", "cd2", "cl1", "p"),
                         "Variante: término de Re como el publicado (cd3=+0.06)")
    variantes = (("A) final (cd3 ajustado)", final), ("B) cd3 = 0", sin_re),
                 ("C) cd3 = +0.06 (publicado)", re_publ))
    filas = []
    palos = (("Driver", TRACKMAN_2024["Driver"]), ("Hierro 7", TRACKMAN_2024["Hierro 7"]),
             ("PW", TRACKMAN_CLASICO["PW"]))
    for etiqueta, mod in variantes:
        a = rms_errores(mod, TRACKMAN_CLASICO, atm)
        b = rms_errores(mod, TRACKMAN_2024, atm)
        fila = [etiqueta, mod.describir(),
                f"{a['carry']:.1f}/{a['hmax']:.1f}/{a['land']:.1f} · "
                f"{b['carry']:.1f}/{b['hmax']:.1f}/{b['land']:.1f}"]
        for _, d in palos:
            c0 = simular(d["vb"], d["vla"], d["spin"], atm=atm, modelo=mod)["carry_yd"]
            celdas = []
            for c in ("med_calida", "bog_calida"):
                c1 = simular(d["vb"], d["vla"], d["spin"], atm=esc[c], modelo=mod)["carry_yd"]
                celdas.append(f"{c1:.0f} ({100*(c1/c0-1):+.1f}%)")
            fila.append(f"{c0:.0f} → " + " / ".join(celdas))
        filas.append(fila)
    partes.append("**Banda de incertidumbre de la altitud: tres variantes que ajustan casi igual "
                  "a nivel del mar** (carry a nivel del mar → Medellín / Bogotá, columna cálida "
                  "con 22 °C y 14 °C)\n")
    partes.append(tabla_md(["Variante", "Constantes", "RMS clásica · 2024 (yd/yd/°)"] +
                           [f"{n} yd" for n, _ in palos], filas))
    partes.append("")

    with open(RUTA_MODELO, "w", encoding="utf-8") as fh:
        json.dump({"final": final.como_dict(), "publicado": base.como_dict(),
                   "escalado": escala.como_dict(), "validacion_cruzada": cruz.como_dict(),
                   "variante_sin_re": sin_re.como_dict(), "variante_re_publicado": re_publ.como_dict(),
                   "tolerancias_ajuste": TOLERANCIAS}, fh, indent=2, ensure_ascii=False)

    partes.append("**Carry según la altitud (modelo final)**\n")
    partes.append(tabla_altitud(final, esc))
    partes.append("")
    partes.append("**Carry según la altitud (modelo publicado, para comparar)**\n")
    partes.append(tabla_altitud(base, esc))
    partes.append("")

    for palo, d in (("Driver TM 2024", TRACKMAN_2024["Driver"]),
                    ("Hierro 7 TM 2024", TRACKMAN_2024["Hierro 7"])):
        r = simular(d["vb"], d["vla"], d["spin"], atm=atm, modelo=final, traza=True)
        sol_t = r["sol"]
        filas = []
        for t in (0.0, 1.0, 2.0, 3.0, 4.0, 5.0, r["t_vuelo_s"]):
            y = sol_t.sol(min(t, r["t_vuelo_s"]))
            v = float(np.linalg.norm(y[3:6]))
            s_ = R_BOLA * y[6] / v
            re = atm.rho * v * D_BOLA / atm.mu
            filas.append([f"{t:.2f}", f"{v:.1f}", f"{y[6]/RPM:.0f}", f"{s_:.3f}",
                          f"{re/1e3:.0f}k", f"{final.cd(s_, re):.3f}", f"{final.cl(s_):.3f}"])
        partes.append(f"**{palo} a lo largo del vuelo (modelo final)**\n")
        partes.append(tabla_md(["t s", "V m/s", "giro rpm", "S", "Re", "CD", "CL"], filas))
        partes.append("")
    texto = "\n".join(partes)
    with open(os.path.join(DIR_RES, "trayectoria.md"), "w", encoding="utf-8") as fh:
        fh.write(texto + "\n")
    print(texto)


if __name__ == "__main__":
    main()
