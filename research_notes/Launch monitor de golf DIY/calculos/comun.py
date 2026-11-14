# -*- coding: utf-8 -*-
"""
Constantes y utilidades comunes para los cálculos del launch monitor DIY.

Todo en unidades SI salvo que el nombre diga otra cosa.
Fuentes de cada dato en calculos_de_ingenieria.md (sección correspondiente).
"""
import math

# ---------------------------------------------------------------------------
# Conversión de unidades (definiciones exactas)
# ---------------------------------------------------------------------------
MPH = 0.44704              # m/s por mph
YD = 0.9144                # m por yarda
FT = 0.3048                # m por pie
RPM = 2.0 * math.pi / 60.0 # rad/s por rpm

# ---------------------------------------------------------------------------
# Constantes físicas (CODATA / valores estándar)
# ---------------------------------------------------------------------------
C_LUZ = 299_792_458.0          # m/s (exacta)
H_PLANCK = 6.626_070_15e-34    # J·s (exacta)
G0 = 9.80665                   # m/s², gravedad estándar
R_AIRE = 287.05                # J/(kg·K), constante del aire seco
R_VAPOR = 461.495              # J/(kg·K), vapor de agua
GAMMA_AIRE = 1.4               # cociente de calores específicos del aire

# ---------------------------------------------------------------------------
# Bola de golf: límites de las Reglas de Golf (masa <= 45.93 g,
# diámetro >= 42.67 mm). Se usa la bola "de reglamento".
# ---------------------------------------------------------------------------
M_BOLA = 0.04593               # kg
D_BOLA = 0.04267               # m
R_BOLA = D_BOLA / 2.0          # m
A_BOLA = math.pi * R_BOLA ** 2 # m², área frontal


# ---------------------------------------------------------------------------
# Atmósfera
# ---------------------------------------------------------------------------
def atmosfera_isa(h_m):
    """Atmósfera estándar internacional (troposfera, gradiente 6.5 K/km).

    Devuelve (T en K, p en Pa) a la altitud geopotencial h_m.
    """
    t0, p0, lapse = 288.15, 101_325.0, 0.0065
    t = t0 - lapse * h_m
    p = p0 * (t / t0) ** (G0 / (R_AIRE * lapse))
    return t, p


def presion_columna_calida(h_m, t_local_k, p0=101_325.0, lapse=0.0065):
    """Presión con la ecuación hipsométrica para una columna más cálida
    que la ISA: temperatura local medida en la estación y gradiente de
    6.5 K/km hacia el nivel del mar (supuesto, ver notas).

    Sirve para estimar cuánto se aparta una ciudad tropical de la ISA.
    """
    t_mar = t_local_k + lapse * h_m
    t_media = 0.5 * (t_mar + t_local_k)
    return p0 * math.exp(-G0 * h_m / (R_AIRE * t_media))


def presion_vapor_saturacion(t_k):
    """Ecuación de Buck (1996), en Pa, sobre agua líquida."""
    tc = t_k - 273.15
    return 611.21 * math.exp((18.678 - tc / 234.5) * (tc / (257.14 + tc)))


def densidad_aire(p_pa, t_k, hr=0.0):
    """Densidad del aire húmedo (kg/m³) como mezcla de aire seco y vapor."""
    e = hr * presion_vapor_saturacion(t_k)
    return (p_pa - e) / (R_AIRE * t_k) + e / (R_VAPOR * t_k)


def viscosidad_aire(t_k):
    """Viscosidad dinámica (Pa·s), ley de Sutherland."""
    return 1.458e-6 * t_k ** 1.5 / (t_k + 110.4)


def velocidad_sonido(t_k):
    """Velocidad del sonido en aire seco (m/s)."""
    return math.sqrt(GAMMA_AIRE * R_AIRE * t_k)


class Atmosfera:
    """Condiciones del aire para la simulación."""

    def __init__(self, nombre, p_pa, t_k, hr=0.0):
        self.nombre = nombre
        self.p = p_pa
        self.t = t_k
        self.hr = hr
        self.rho = densidad_aire(p_pa, t_k, hr)
        self.mu = viscosidad_aire(t_k)

    def __repr__(self):
        return (f"{self.nombre}: p={self.p/1000:.2f} kPa, "
                f"T={self.t-273.15:.1f} °C, HR={self.hr*100:.0f}%, "
                f"rho={self.rho:.4f} kg/m³")


def escenarios_atmosfera():
    """Escenarios usados en el informe.

    - Nivel del mar ISA (15 °C): referencia de la validación.
    - Nivel del mar 25 °C: para ver cuánto cambia la validación si los
      promedios de TrackMan correspondieran a un día cálido.
    - Medellín (~1,495 m) y Bogotá (~2,640 m): ISA pura, presión ISA con
      la temperatura media local, y columna cálida (supuesto) con la
      temperatura media local.
    """
    esc = {}
    t, p = atmosfera_isa(0.0)
    esc["mar_isa"] = Atmosfera("Nivel del mar, ISA 15 °C", p, t)
    esc["mar_25c"] = Atmosfera("Nivel del mar, 25 °C", p, 298.15)
    for clave, nombre, h, t_local_c in (("med", "Medellín 1,495 m", 1495.0, 22.0),
                                        ("bog", "Bogotá 2,640 m", 2640.0, 14.0)):
        t_isa, p_isa = atmosfera_isa(h)
        t_loc = t_local_c + 273.15
        esc[clave + "_isa"] = Atmosfera(f"{nombre}, ISA ({t_isa-273.15:.1f} °C)",
                                        p_isa, t_isa)
        esc[clave + "_isa_tloc"] = Atmosfera(f"{nombre}, p ISA + {t_local_c:.0f} °C",
                                             p_isa, t_loc)
        p_cal = presion_columna_calida(h, t_loc)
        esc[clave + "_calida"] = Atmosfera(f"{nombre}, columna cálida + {t_local_c:.0f} °C",
                                           p_cal, t_loc)
    return esc


def tabla_md(encabezados, filas, alineacion=None):
    """Arma una tabla Markdown a partir de listas."""
    if alineacion is None:
        alineacion = ["---:"] * len(encabezados)
        alineacion[0] = ":---"
    lineas = ["| " + " | ".join(str(e) for e in encabezados) + " |",
              "| " + " | ".join(alineacion) + " |"]
    for f in filas:
        lineas.append("| " + " | ".join(str(c) for c in f) + " |")
    return "\n".join(lineas)


if __name__ == "__main__":
    for k, a in escenarios_atmosfera().items():
        print(f"{k:14s} {a}  mu={a.mu:.3e}  c_sonido={velocidad_sonido(a.t):.1f} m/s")
