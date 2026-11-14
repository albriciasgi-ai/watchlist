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
    """Smits & Smith (1994) con factores de ajuste explícitos.

    k_cd, k_cl: multiplican CD y CL (1.0 = modelo publicado).
    r1: constante del decaimiento del giro (2e-5 = publicado).
    """

    RE_MIN, RE_MAX = 4.0e4, 2.5e5   # rango medido; fuera se satura

    def __init__(self, k_cd=1.0, k_cl=1.0, r1=2.0e-5, nombre="Smits & Smith 1994"):
        self.k_cd = k_cd
        self.k_cl = k_cl
        self.r1 = r1
        self.nombre = nombre

    def cd(self, s, re):
        re_c = min(max(re, self.RE_MIN), self.RE_MAX)
        base = 0.24 + 0.18 * s + 0.06 * math.sin(math.pi * (re_c - 9.0e4) / 2.0e5)
        return self.k_cd * base

    def cl(self, s):
        return self.k_cl * 0.54 * max(s, 0.0) ** 0.4

    def tasa_decaimiento(self, v):
        """Fracción del giro que se pierde por segundo (1/s) a velocidad v."""
        return self.r1 * v / R_BOLA

    def como_dict(self):
        return {"nombre": self.nombre, "k_cd": self.k_cd, "k_cl": self.k_cl, "r1": self.r1}


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


def residuos(params, datos, atm):
    k_cd, k_cl, r1_rel = params
    mod = ModeloAero(k_cd, k_cl, 2.0e-5 * r1_rel)
    res = []
    for palo, e in errores(mod, datos, atm).items():
        for m in ("carry", "hmax", "land"):
            if m in e:
                res.append(e[m] / TOLERANCIAS[m])
    return np.array(res)


def ajustar(datos, atm, libres=("k_cd", "k_cl", "r1")):
    """Mínimos cuadrados ponderados sobre los factores indicados."""
    x0 = np.array([1.0, 1.0, 1.0])
    mascara = np.array([n in libres for n in ("k_cd", "k_cl", "r1")])

    def fun(xl):
        x = x0.copy()
        x[mascara] = xl
        return residuos(x, datos, atm)

    lo = np.array([0.5, 0.5, 0.25])[mascara]
    hi = np.array([1.5, 1.5, 4.0])[mascara]
    sol = least_squares(fun, x0[mascara], bounds=(lo, hi), diff_step=1e-3)
    x = x0.copy()
    x[mascara] = sol.x
    return ModeloAero(x[0], x[1], 2.0e-5 * x[2], nombre="Smits & Smith 1994 ajustado"), sol


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
    return f"**{titulo}** — {modelo.nombre}: k_cd={modelo.k_cd:.3f}, k_cl={modelo.k_cl:.3f}, " \
           f"R1={modelo.r1:.2e}; aire: {atm}\n\n" + tabla_md(enc, filas)


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


def main():
    os.makedirs(DIR_RES, exist_ok=True)
    esc = escenarios_atmosfera()
    atm = esc["mar_isa"]
    partes = ["# Resultados del simulador de trayectoria\n",
              "Escenarios de aire:\n"]
    for a in esc.values():
        partes.append(f"- {a}")
    partes.append("")

    base = ModeloAero()
    partes.append(tabla_validacion(base, TRACKMAN_CLASICO, atm,
                                   "Validación SIN ajuste — tabla clásica TrackMan"))
    partes.append("")
    partes.append(tabla_validacion(base, TRACKMAN_2024, atm,
                                   "Validación SIN ajuste — promedios TrackMan 2024"))
    partes.append("")
    # también a 25 °C, por si los promedios corresponden a un día cálido
    partes.append(tabla_validacion(base, TRACKMAN_CLASICO, esc["mar_25c"],
                                   "SIN ajuste, aire a 25 °C — tabla clásica"))
    partes.append("")

    # Ajuste de 2 parámetros (CD y CL) y de 3 (CD, CL y decaimiento)
    resumen = []
    modelos = {}
    for etiqueta, libres in (("CD+CL", ("k_cd", "k_cl")), ("CD+CL+R1", ("k_cd", "k_cl", "r1"))):
        mod, sol = ajustar(TRACKMAN_CLASICO, atm, libres)
        modelos[etiqueta] = mod
        rms_in = rms_errores(mod, TRACKMAN_CLASICO, atm)
        rms_out = rms_errores(mod, TRACKMAN_2024, atm)
        resumen.append([etiqueta, f"{mod.k_cd:.3f}", f"{mod.k_cl:.3f}", f"{mod.r1:.2e}",
                        f"{rms_in['carry']:.1f} / {rms_in['hmax']:.1f} / {rms_in['land']:.1f}",
                        f"{rms_out['carry']:.1f} / {rms_out['hmax']:.1f} / {rms_out['land']:.1f}"])
        partes.append(tabla_validacion(mod, TRACKMAN_CLASICO, atm,
                                       f"Validación CON ajuste {etiqueta} — tabla clásica (ajuste)"))
        partes.append("")
        partes.append(tabla_validacion(mod, TRACKMAN_2024, atm,
                                       f"CON ajuste {etiqueta} — TrackMan 2024 (fuera del ajuste)"))
        partes.append("")
    rms_b_in = rms_errores(base, TRACKMAN_CLASICO, atm)
    rms_b_out = rms_errores(base, TRACKMAN_2024, atm)
    resumen.insert(0, ["Sin ajuste", "1.000", "1.000", "2.00e-05",
                       f"{rms_b_in['carry']:.1f} / {rms_b_in['hmax']:.1f} / {rms_b_in['land']:.1f}",
                       f"{rms_b_out['carry']:.1f} / {rms_b_out['hmax']:.1f} / {rms_b_out['land']:.1f}"])
    partes.append("**Resumen del ajuste (RMS de errores: carry yd / altura yd / llegada °)**\n")
    partes.append(tabla_md(["Modelo", "k_cd", "k_cl", "R1", "RMS tabla clásica (ajuste)",
                            "RMS TM 2024 (validación)"], resumen))
    partes.append("")

    # Modelo elegido para el resto de los cálculos
    elegido = modelos["CD+CL"]
    with open(os.path.join(DIR_RES, "modelo_ajustado.json"), "w", encoding="utf-8") as fh:
        json.dump({"elegido": elegido.como_dict(),
                   "alternativo_3p": modelos["CD+CL+R1"].como_dict()}, fh, indent=2)

    partes.append("**Carry según la altitud (modelo ajustado CD+CL)**\n")
    partes.append(tabla_altitud(elegido, esc))
    partes.append("")
    partes.append("**Carry según la altitud (modelo SIN ajuste, para comparar)**\n")
    partes.append(tabla_altitud(base, esc))
    partes.append("")

    # Coeficientes a lo largo del vuelo del driver (diagnóstico)
    r = simular(171, 10.4, 2545, atm=atm, modelo=elegido, traza=True)
    sol = r["sol"]
    filas = []
    for t in (0.0, 1.0, 2.0, 3.0, 4.0, 5.0, r["t_vuelo_s"]):
        y = sol.sol(min(t, r["t_vuelo_s"]))
        v = float(np.linalg.norm(y[3:6]))
        s = R_BOLA * y[6] / v
        re = atm.rho * v * D_BOLA / atm.mu
        filas.append([f"{t:.2f}", f"{v:.1f}", f"{y[6]/RPM:.0f}", f"{s:.3f}", f"{re/1e3:.0f}k",
                      f"{elegido.cd(s, re):.3f}", f"{elegido.cl(s):.3f}"])
    partes.append("**Driver TM 2024 a lo largo del vuelo (modelo ajustado)**\n")
    partes.append(tabla_md(["t s", "V m/s", "giro rpm", "S", "Re", "CD", "CL"], filas))
    texto = "\n".join(partes)
    with open(os.path.join(DIR_RES, "trayectoria.md"), "w", encoding="utf-8") as fh:
        fh.write(texto + "\n")
    print(texto)


if __name__ == "__main__":
    main()
