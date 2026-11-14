# -*- coding: utf-8 -*-
"""
Sensibilidad del carry y del desvío lateral a cada dato de lanzamiento,
y precisión de sensor necesaria para ±2-3 yd.

Derivadas por diferencias centrales con el simulador (modelo final de
trayectoria.py). Se repite con las dos variantes de la dependencia de Re
para ver si los requisitos cambian con el modelo.

Uso:  python sensibilidad.py   (escribe resultados/sensibilidad.md)
"""
import math
import os

from comun import escenarios_atmosfera, tabla_md, Atmosfera
import trayectoria as T

DIR_RES = T.DIR_RES

# Golpes nominales. Los de "aficionado" son ILUSTRATIVOS (supuesto, sin fuente):
# sirven para ver cómo escalan las derivadas con un jugador más lento.
GOLPES = {
    "Driver PGA (TM 2024)": dict(vb=171.0, vla=10.4, spin=2545.0),
    "Hierro 7 PGA (TM 2024)": dict(vb=123.0, vla=16.1, spin=7124.0),
    "Driver aficionado (supuesto)": dict(vb=135.0, vla=13.0, spin=3000.0),
    "Hierro 7 aficionado (supuesto)": dict(vb=100.0, vla=19.0, spin=6000.0),
}
PASOS = dict(vb=1.0, vla=0.5, spin=100.0, hla=1.0, eje=1.0)
CORTO = {"mar_isa": "Nivel del mar", "bog_calida": "Bogotá"}

# Especificaciones publicadas (fuentes secundarias, ver notas). None = no dada.
# No se sabe si el "±" es 1σ, 95% o máximo: se tratan como 1σ (optimista).
SPECS = {
    "Mevo+ (reseña): ±1 mph, ±0.5°, ±150 rpm": dict(vb=1.0, vla=0.5, spin=150.0),
    "SkyTrak (afirmación antigua): ±1 mph, ±1°": dict(vb=1.0, vla=1.0, spin=None),
    "TrackMan 4 (tabla secundaria): ±1 mph, ±50 rpm": dict(vb=1.0, vla=None, spin=50.0),
    "Bushnell Launch Pro (ficha): ±2 mph": dict(vb=2.0, vla=None, spin=None),
}


def sim(g, modelo, atm, **cambios):
    p = dict(vb=g["vb"], vla=g["vla"], spin=g["spin"], hla=0.0, eje=0.0)
    p.update(cambios)
    return T.simular(p["vb"], p["vla"], p["spin"], hla_deg=p["hla"], eje_deg=p["eje"],
                     atm=atm, modelo=modelo)


def derivadas(g, modelo, atm):
    """Derivadas centrales: yd/mph, yd/°, yd/100 rpm, yd/° de HLA y de eje."""
    d = {}
    base = sim(g, modelo, atm)
    d["base"] = base
    for k in ("vb", "vla", "spin"):
        h = PASOS[k]
        mas = sim(g, modelo, atm, **{k: g[k] + h})
        menos = sim(g, modelo, atm, **{k: g[k] - h})
        d["carry_" + k] = (mas["carry_yd"] - menos["carry_yd"]) / (2 * h)
        d["hmax_" + k] = (mas["hmax_yd"] - menos["hmax_yd"]) / (2 * h)
    d["carry_spin"] *= 100.0          # por 100 rpm
    d["hmax_spin"] *= 100.0
    mas = sim(g, modelo, atm, hla=1.0)
    menos = sim(g, modelo, atm, hla=-1.0)
    d["off_hla"] = (mas["offline_yd"] - menos["offline_yd"]) / 2.0
    mas = sim(g, modelo, atm, eje=1.0)
    menos = sim(g, modelo, atm, eje=-1.0)
    d["curva_eje"] = (mas["curva_yd"] - menos["curva_yd"]) / 2.0
    d["off_eje"] = (mas["offline_yd"] - menos["offline_yd"]) / 2.0
    # linealidad: 5° de eje y 5° de HLA
    d["curva_eje5"] = sim(g, modelo, atm, eje=5.0)["curva_yd"] / 5.0
    d["carry_eje5"] = sim(g, modelo, atm, eje=5.0)["carry_yd"] - base["carry_yd"]
    d["off_hla5"] = sim(g, modelo, atm, hla=5.0)["offline_yd"] / 5.0
    return d


def requisito(objetivo_yd, deriv, n_fuentes):
    """Sigma admisible de un dato para que el total (RSS) sea objetivo_yd.

    n_fuentes = 1: el dato es la única fuente de error.
    n_fuentes = k: reparto igual entre k fuentes independientes.
    """
    return objetivo_yd / math.sqrt(n_fuentes) / max(abs(deriv), 1e-9)


def fmt_req(valor, tope, fmt, unidad):
    """Si la derivada es casi cero el requisito no limita: se muestra '> tope'."""
    return f"> {tope:{fmt}}{unidad}" if valor > tope else f"{valor:{fmt}}{unidad}"


def main():
    esc = escenarios_atmosfera()
    modelo = T.modelo_final()
    partes = ["# Sensibilidad y precisión necesaria\n"]
    filas = []
    resultados = {}
    for atm_clave in ("mar_isa", "bog_calida"):
        atm = esc[atm_clave]
        for nombre, g in GOLPES.items():
            d = derivadas(g, modelo, atm)
            resultados[(atm_clave, nombre)] = d
            b = d["base"]
            filas.append([f"{nombre} · {CORTO[atm_clave]}",
                          f"{b['carry_yd']:.1f}",
                          f"{d['carry_vb']:.2f}",
                          f"{d['carry_vla']:+.2f}",
                          f"{d['carry_spin']:+.2f}",
                          f"{d['off_hla']:.2f} ({d['off_hla5']:.2f})",
                          f"{d['curva_eje']:.2f} ({d['curva_eje5']:.2f})",
                          f"{d['off_eje']:.2f}",
                          f"{d['carry_eje5']:+.1f}"])
    partes.append("**Derivadas (modelo final)** — diferencias centrales con pasos de "
                  "±1 mph, ±0.5°, ±100 rpm, ±1° (entre paréntesis, promedio para 5°)\n")
    partes.append(tabla_md(["Golpe · aire", "Carry yd", "dCarry/dV yd/mph",
                            "dCarry/dVLA yd/°", "dCarry/dSpin yd/100 rpm",
                            "Offline/HLA yd/° (5°)", "Curva/eje yd/° (5°)",
                            "Offline/eje yd/°", "ΔCarry con eje 5° yd"], filas))
    partes.append("")

    # Robustez frente a la variante del modelo (solo nivel del mar, golpes PGA)
    filas = []
    for clave, etiqueta in (("final", "A) final"), ("variante_sin_re", "B) cd3=0"),
                            ("variante_re_publicado", "C) cd3=+0.06")):
        mod = T.modelo_final(clave)
        for nombre in ("Driver PGA (TM 2024)", "Hierro 7 PGA (TM 2024)"):
            d = derivadas(GOLPES[nombre], mod, esc["mar_isa"])
            filas.append([f"{etiqueta} · {nombre}", f"{d['base']['carry_yd']:.1f}",
                          f"{d['carry_vb']:.2f}", f"{d['carry_vla']:+.2f}",
                          f"{d['carry_spin']:+.2f}", f"{d['off_hla']:.2f}",
                          f"{d['curva_eje']:.2f}"])
    partes.append("**¿Cambian las derivadas con la variante del modelo?** (nivel del mar)\n")
    partes.append(tabla_md(["Variante · golpe", "Carry yd", "yd/mph", "yd/° VLA",
                            "yd/100 rpm", "yd/° HLA", "yd/° eje"], filas))
    partes.append("")

    # Requisitos de precisión (1 sigma), nivel del mar y Bogotá
    for objetivo in (2.0, 3.0):
        filas = []
        for (atm_clave, nombre), d in resultados.items():
            vb = GOLPES[nombre]["vb"]
            r_v1 = requisito(objetivo, d["carry_vb"], 1)
            r_v3 = requisito(objetivo, d["carry_vb"], 3)
            filas.append([
                f"{nombre} · {CORTO[atm_clave]}",
                f"{r_v1:.2f} / {r_v3:.2f} mph ({100*r_v3/vb:.2f}%)",
                fmt_req(requisito(objetivo, d['carry_vla'], 1), 5.0, ".2f", "°") + " / " +
                fmt_req(requisito(objetivo, d['carry_vla'], 3), 5.0, ".2f", "°"),
                fmt_req(100*requisito(objetivo, d['carry_spin'], 1), 3000, ".0f", " rpm") + " / " +
                fmt_req(100*requisito(objetivo, d['carry_spin'], 3), 3000, ".0f", " rpm"),
                f"{requisito(objetivo, d['off_hla'], 1):.2f} / "
                f"{requisito(objetivo, d['off_hla'], 2):.2f}°",
                f"{requisito(objetivo, d['off_eje'], 1):.2f} / "
                f"{requisito(objetivo, d['off_eje'], 2):.2f}°",
            ])
        partes.append(f"**Precisión necesaria (1σ) para ±{objetivo:.0f} yd** — "
                      "'sola / repartida': sola = única fuente de error; repartida = "
                      "reparto igual entre velocidad, VLA y giro (carry) o entre HLA y eje "
                      "(offline), sumadas en cuadratura\n")
        partes.append(tabla_md(["Golpe · aire", "Velocidad de bola", "VLA", "Giro",
                                "HLA (offline)", "Eje de giro (offline)"], filas))
        partes.append("")

    # Error de carry que implican las especificaciones comerciales publicadas
    filas = []
    for spec, e in SPECS.items():
        fila = [spec]
        for nombre in ("Driver PGA (TM 2024)", "Hierro 7 PGA (TM 2024)",
                       "Driver aficionado (supuesto)"):
            d = resultados[("mar_isa", nombre)]
            comp = []
            if e["vb"] is not None:
                comp.append(d["carry_vb"] * e["vb"])
            if e["vla"] is not None:
                comp.append(d["carry_vla"] * e["vla"])
            if e["spin"] is not None:
                comp.append(d["carry_spin"] * e["spin"] / 100.0)
            fila.append(f"{math.sqrt(sum(c*c for c in comp)):.1f}")
        filas.append(fila)
    partes.append("**Error de carry (1σ, yd, nivel del mar) que implican las especificaciones "
                  "publicadas** (solo los datos que cada ficha declara)\n")
    partes.append(tabla_md(["Especificación", "Driver PGA", "Hierro 7 PGA",
                            "Driver aficionado (supuesto)"], filas))
    partes.append("")

    # Sensibilidad a la densidad del aire, con las tres variantes del modelo
    filas = []
    for clave, etiqueta in (("final", "A) final"), ("variante_sin_re", "B) cd3=0"),
                            ("variante_re_publicado", "C) cd3=+0.06")):
        mod = T.modelo_final(clave)
        for nombre in ("Driver PGA (TM 2024)", "Hierro 7 PGA (TM 2024)"):
            g = GOLPES[nombre]
            fila = [f"{etiqueta} · {nombre}"]
            for atm_clave in ("mar_isa", "bog_calida"):
                a = esc[atm_clave]
                c0 = sim(g, mod, a)["carry_yd"]
                c1 = sim(g, mod, Atmosfera("+1%", a.p * 1.01, a.t))["carry_yd"]
                fila.append(f"{c1-c0:+.2f}")
            c_isa = sim(g, mod, esc["bog_isa_tloc"])["carry_yd"]
            fila.append(f"{c_isa - sim(g, mod, esc['bog_calida'])['carry_yd']:+.2f}")
            filas.append(fila)
    partes.append("**Efecto de la densidad del aire** (ΔCarry por +1% de densidad; y error en "
                  "Bogotá si se usa la presión ISA en vez de la columna cálida, −1.8% de "
                  "densidad)\n")
    partes.append(tabla_md(["Variante · golpe", "Nivel del mar yd/1%", "Bogotá yd/1%",
                            "Bogotá con p ISA (yd)"], filas))
    texto = "\n".join(partes)
    with open(os.path.join(DIR_RES, "sensibilidad.md"), "w", encoding="utf-8") as fh:
        fh.write(texto + "\n")
    print(texto)


if __name__ == "__main__":
    main()
