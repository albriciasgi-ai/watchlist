"""
Protocolo (22/11/2026), etapa 7, prueba adicional 1: la galería de TODOS los elementos del probador (pedido del usuario:
los va a combinar en recetas nuevas y necesita que todos funcionen). Junta las capturas de cada elemento
(evidencia/pantalla/G_<clave>/) en 5 páginas por familia, con la definición de cada elemento tal como la calcula la app
y, en cada caso, "Sí, es lo que entiendo", "No" o "No sé" y una nota. Un botón copia las marcas para pegarlas en el chat.
Las imágenes van dentro de cada página (reducidas): se abren con doble clic, sin servidor.

Uso (desde backend/): python -B tests/audit/galeria_html.py CARPETA_DE_SALIDA
"""
import base64
import html
import io
import json
import re
import sys
from pathlib import Path

from PIL import Image

SHOTS = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\pantalla")
RUNS = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\etapa7\galeria_corridas.json")
H4, M15 = "BTC · 4h", "BTC · 15m"

# clave: (título, marco, cómo lo calcula la app, qué mirar en la captura)
E = {
    # Velas, patrones y cajas
    "FV": ("FVG nuevo", H4, "Un hueco entre la primera y la tercera de tres velas seguidas: en un alza, el mínimo de la tercera queda por encima del máximo de la primera (en una baja, al revés). Solo huecos de 0.3 ATR o más. Se conoce al cerrar la tercera.", "la caja clara del hueco y que la vela resaltada sea la tercera de las tres."),
    "IM": ("Impulso", H4, "El cierre avanza al menos 2 ATR respecto del cierre de 3 velas antes. La señal es la primera vela que lo cumple (la anterior no lo cumplía); su zona va del mínimo al máximo de esas velas.", "el avance de las últimas 3 velas hasta la vela resaltada."),
    "SP": ("Swing", H4, "Un máximo (o mínimo) que es el único extremo de 5 velas a cada lado. Se conoce 5 velas después. Un mínimo es alcista y un máximo, bajista.", "el extremo marcado y que la vela resaltada sea la quinta después de él."),
    "VH": ("Volumen alto para su hora", H4, "Una vela con el doble del volumen medio de su misma hora en los 30 días anteriores. Su lado es su color.", "el volumen de la vela resaltada contra el de las demás."),
    "RF": ("Flecha del volumen de respuesta", H4, "Una vela con el doble o más del volumen mediano de su misma hora en los 30 días anteriores, que va a favor del tramo en curso (tramos que giran con 2 ATR). Su lado es el color de la vela.", "el volumen de la vela resaltada y que vaya en la dirección del tramo."),
    "RBg": ("Rombo del volumen de respuesta, como giro", H4, "Después de un tramo en que dominó el volumen de la tendencia, el volumen de la respuesta lo iguala (el equilibrio del indicador Volumen de Respuesta). Como giro, se opera contra el tramo, con la zona del cierre al extremo del tramo.", "el tramo previo y que la vela resaltada sea donde la respuesta iguala; el trade va contra el tramo."),
    "RBs": ("Rombo del volumen de respuesta, siguiendo el tramo", H4, "El mismo rombo, operado a favor del tramo, con la vela como zona.", "lo mismo que el rombo como giro, pero el trade va a favor del tramo."),
    "HM": ("Martillo o estrella fugaz", H4, "Martillo (alcista): cuerpo arriba y una mecha de abajo larga (2 cuerpos o más) después de una caída de 5 velas. Estrella fugaz (bajista), al revés. Es la regla del indicador Rejection Patterns.", "la forma de la vela resaltada y la tendencia de las 5 velas anteriores."),
    "EN": ("Envolvente", H4, "Una vela cuyo cuerpo envuelve el cuerpo de la anterior, de color contrario, después de una tendencia de 5 velas en contra. Es la regla del indicador Rejection Patterns.", "los cuerpos de la vela resaltada y de la anterior."),
    "DJ": ("Doji", H4, "Doji libélula (alcista) o lápida (bajista): cuerpo casi nulo y una mecha larga hacia un lado, después de una tendencia de 5 velas en contra.", "la forma de la vela resaltada (la caja clara la cubre: mira su mecha) y las 5 velas anteriores."),
    "GC": ("Gaussian Channel", H4, "Una vela cierra fuera de la banda del canal gaussiano (periodo 144, 4 polos, ancho 1.414) y la anterior no, con la línea central a favor: arriba es largo y abajo, corto. Sale al cerrar de vuelta dentro de la banda.", "las bandas del canal y que la vela resaltada cierre afuera."),
    "BX": ("Ruptura de caja", H4, "La vela que cierra fuera de una caja (una congestión que encuentra el detector de eficiencia con caja), del lado de la ruptura. Solo cajas de hasta 5.5 ATR de alto.", "la caja (rectángulo con su centro punteado) y que la vela resaltada cierre fuera de ella."),
    "BE": ("Borde de caja, hacia el centro", H4, "La llegada del precio al borde de una caja vigente, para ir hacia su centro (con los filtros de cuerpo y cierre de fábrica). Una llegada por tramo.", "la caja y que la vela resaltada llegue a su borde."),
    "CP": ("Compresión", H4, "La vela en que se detecta una caja. No tiene dirección: pone dos órdenes stop por fuera de la caja y entra la que se llena primero.", "la caja recién detectada y por qué lado salió el precio."),
    "CC": ("Cambio de carácter", H4, "Una tendencia de swings crecientes (2 tramos, swing de 3 velas) y una vela que cierra bajo su último mínimo abre un corto; al revés, un largo. La estructura va en velas de 4h.", "los swings de la tendencia, el swing roto y que la vela resaltada cierre más allá."),
    # VPA
    "QA": ("Esfuerzo sin resultado (VPA)", H4, "Una vela con mucho volumen para su hora y poco rango (grado de 50% o más). Se opera contra el color de la vela.", "el volumen alto con una vela de poco recorrido."),
    "QB": ("Ruptura con volumen (VPA)", H4, "El primer cierre a más de 0.1 ATR fuera del máximo o mínimo de las 20 velas anteriores (con el cierre anterior adentro), si ese rango mide hasta 6 ATR, con volumen alto para su hora.", "el nivel roto (borde del rango), que la vela resaltada cierre más allá y su volumen."),
    "QF": ("Ruptura sin volumen (VPA)", H4, "La misma ruptura del rango de 20 velas, pero con volumen bajo para su hora. Se opera contra la ruptura.", "el nivel roto y el poco volumen de la vela resaltada."),
    "QR": ("Retroceso sin volumen tras la ruptura (VPA)", H4, "Después de una ruptura con volumen, en 8 velas el precio vuelve a ½ ATR del nivel con volumen medio bajo y cierra a favor de la ruptura.", "la ruptura previa, el regreso al nivel y el volumen bajo del retroceso."),
    "QT": ("Prueba de poco volumen (VPA)", H4, "Una vela de poco volumen que entra al precio de una vela de las 20 anteriores con volumen alto y del color contrario, y la rechaza con la mecha: hacia abajo es alcista (prueba de oferta) y hacia arriba, bajista.", "la vela de volumen alto anterior y la mecha de la vela resaltada."),
    "QS": ("Frenado o techo (VPA)", H4, "En un tramo de al menos 2 ATR, 2 de las 3 últimas velas tienen mecha contra el tramo, cierre en su mitad de ese lado y volumen alto. Se opera contra el tramo, una vez por tramo.", "las mechas y el volumen de las velas resaltadas al final del tramo."),
    "QC": ("Clímax de volumen (VPA)", H4, "2 o más velas con volumen muy alto y mecha contra el tramo, en 6 velas y a menos de 1 ATR entre sí. Se opera contra el tramo, una vez por tramo.", "las velas de volumen muy alto al final del tramo."),
    "QE": ("El medidor VPA cruza el umbral", H4, "El medidor de fuerza y debilidad del Lector VPA cruza su umbral: hacia arriba es largo y hacia abajo, corto.", "el medidor en el panel del Lector VPA (si está a la vista) en la vela resaltada."),
    # Williams y SMC
    "WD": ("Barra divergente (1.er sabio)", H4, "Largo: una vela que hace un mínimo más bajo que la anterior, cierra en su mitad de arriba y queda entera bajo las tres líneas del Alligator, que se van abriendo; con el AO en rojo. Corto, al revés.", "la vela resaltada, dónde cierra dentro de su rango y las líneas del Alligator."),
    "WA": ("AO tres barras (2.º sabio)", H4, "Tres barras seguidas del AO del mismo color después de una de color contrario: verdes para un largo, rojas para un corto.", "las barras del AO en su panel (si está a la vista) y la vela resaltada, que es la tercera."),
    "WF": ("Ruptura de fractal (3.er sabio)", H4, "El precio pasa el último fractal (un máximo con dos velas más bajas a cada lado, o un mínimo al revés), del lado correcto de los dientes del Alligator. A mercado, la señal es la vela que lo pasa.", "el fractal y que la vela resaltada lo pase."),
    "BS": ("Ruptura de estructura (SMC)", H4, "La vela que cierra más allá del último swing de la estructura (BOS si sigue la tendencia, CHoCH si la cambia). La zona va del nivel roto al cierre.", "el nivel roto de la estructura y la vela que cierra más allá."),
    "OB": ("Order block (SMC)", H4, "La última vela contraria antes del movimiento que rompe la estructura. Nace con la ruptura; la señal es el regreso del precio a esa zona.", "la caja del order block y que el precio regrese a ella."),
    "BK": ("Breaker (SMC)", H4, "Un order block que el precio rompió: queda del lado contrario, como zona de regreso.", "el order block roto y el regreso del precio a él."),
    "EQ": ("Barrido de iguales (SMC)", H4, "Dos máximos (o mínimos) casi iguales y una vela que los pasa: barrer los máximos es bajista y los mínimos, alcista.", "los iguales marcados y la vela que los pasa."),
    # Order flow
    "VA": ("VA abandonada", M15, "La vela siguiente no entra en el área de valor de la vela (el 70% de su volumen, por niveles).", "el área de valor de la vela y que la siguiente no la toque."),
    "OG": ("Orderflows Gap", M15, "Las áreas de valor de dos velas seguidas no se tocan, con un hueco de al menos el umbral relativo en ATR.", "el hueco entre las dos áreas de valor."),
    "AP": ("POC alineado", M15, "El mismo POC (precio de más volumen) en dos velas seguidas.", "los POC de las dos velas al mismo precio."),
    "SL": ("POC Slingshot", M15, "Dos velas del mismo color con el POC de la segunda hacia atrás del de la primera.", "los POC de las dos velas."),
    "RL": ("Absorción (propuesta propia)", M15, "Un nivel con volumen en el percentil 99.5 de 30 días y al menos 40% pasivo. No es una regla del libro.", "la celda con mucho volumen pasivo."),
    "EX": ("Exhaustion Print", M15, "En el extremo de la vela, el lado pasivo casi en cero (bajo el umbral relativo).", "la celda del extremo con casi nada del lado pasivo."),
    "ZP": ("Zero Print", M15, "Un 0 en una de las dos celdas del inicio de la vela (el mínimo de una verde, el máximo de una roja).", "las celdas del inicio y el 0."),
    "DT": ("Delta Tail", M15, "El delta del extremo de inicio va contra el color de la vela y el del resto, a favor.", "el delta de la celda del extremo contra el de las demás."),
    "RS": ("Retail Suck", M15, "El lado pasivo del extremo decrece en tres niveles seguidos, con tamaño relativo.", "las tres celdas del extremo, de mayor a menor."),
    "DD": ("Delta Divergence", M15, "Un extremo de 5 velas con el delta a favor del color de la vela.", "el extremo nuevo y el delta de la vela."),
    "PD": ("Price Action Divergence", M15, "El delta va contra el color de la vela, con tamaño relativo.", "el color de la vela contra su delta."),
    "IV": ("Inverse Imbalance", M15, "Dos desequilibrios contrarios seguidos en la mitad lejana de la vela (diagonal 4 a 1).", "los dos desequilibrios contrarios."),
    "AD": ("Acumulación/Distribución", M15, "La celda de más volumen está del lado contrario y en el tercio del inicio de la vela.", "dónde cae la celda mayor."),
    "SW": ("Market Sweep", M15, "Una racha de 3 o más niveles sin contrapartida (el agresor barre sin que nadie le compre o venda).", "la racha de celdas con un lado en cero."),
    "VL": ("Vertical Liquidity", M15, "Una racha de 3 o más niveles con el agresor en el percentil 90 de 30 días.", "la racha de celdas con mucho agresor."),
    "SQ": ("Orderflows Sequencing", M15, "Una racha de 4 o más niveles con el agresor creciente.", "el agresor que crece nivel a nivel."),
    "DB": ("Delta Breakout", M15, "Un salto de delta entre dos velas del mismo color, sobre el volumen típico.", "el delta de las dos velas."),
    "PW": ("POC Wave", M15, "Tres velas con sus POC en ola, como el libro.", "los POC de las tres velas."),
    "DV": ("Delta/Volumen extremo", M15, "La razón delta/volumen a favor del color en o sobre el umbral relativo.", "el delta de la vela comparado con su volumen."),
    "ST": ("Desequilibrios apilados", M15, "Tres o más desequilibrios diagonales de 4 a 1 seguidos, a favor del color de la vela, en una vela con 2 o más veces el volumen mediano de las 20 anteriores.", "la franja del apilado en la vela resaltada y las celdas en el footprint."),
    "VI": ("Volume Imbalance", M15, "Tres o más desequilibrios a favor del color, seguidos o no, en una vela de mucho volumen.", "los desequilibrios a favor en el footprint."),
    "IR": ("Imbalance Reversal", M15, "Un desequilibrio contrario en uno de los dos precios del inicio, en una vela de mucho volumen.", "el desequilibrio contrario en el extremo de inicio."),
    "RD": ("Imbalance Reload", M15, "Un desequilibrio al mismo precio en dos velas seguidas del mismo color, de mucho volumen.", "los dos desequilibrios al mismo precio."),
    "VD": ("Volume Decline", M15, "El volumen pasivo crece del 1.º al 3.º precio desde el inicio, en una vela de mucho volumen.", "las tres celdas del inicio."),
    "TP": ("Thin Print", M15, "Un nivel interior con contrapartida 0 (hasta 3 por vela), en una vela de mucho volumen.", "las celdas interiores con un lado en cero."),
    "OP": ("Open POC", M15, "El POC de la vela queda fuera del rango de las 5 velas anteriores por al menos 0.25 ATR, en una vela de mucho volumen.", "el POC de la vela y el rango de las 5 anteriores."),
    "RX": ("Ratio de extremos", M15, "En el lado pasivo, el 2.º precio dividido por el extremo da menos de 0.70 o más de 30, en una vela de mucho volumen.", "las dos celdas del extremo."),
    "XD": ("Extreme Delta", M15, "El delta cierra en el 95% o más de su máximo (o mínimo) exacto dentro de la vela, con la razón delta/volumen sobre el umbral relativo.", "la tabla de la vela (delta, máx. y mín.)."),
    "SM": ("Small Min/Max Delta", M15, "El lado contrario al color apenas movió el delta: un mínimo de delta pequeño en una verde, un máximo pequeño en una roja.", "la tabla de la vela (mín. o máx. del delta)."),
    "BR": ("Barrido real", M15, "La mayor orden agresiva de la vela que cruzó 3 precios o más, con USD sobre el umbral relativo.", "la franja de la orden."),
    "GR": ("Orden grande", M15, "La mayor orden agresiva de la vela, con USD sobre el umbral relativo.", "la franja de la orden."),
    # Perfil por sesión y liquidaciones
    "VR": ("Regreso al valor de la sesión anterior", M15, "La sesión (un día, en UTC) abre fuera del área de valor de la anterior y 30 minutos de cierres seguidos quedan dentro: va al borde contrario. Una vez por sesión.", "el valor de la sesión anterior (POC, VAH y VAL) y el regreso del precio."),
    "VF": ("Fallo fuera del valor de la sesión anterior", M15, "Con el cierre anterior dentro del valor, una vela pasa el VAH o el VAL y en 3 velas una cierra de vuelta dentro: va al POC.", "el borde pasado y el cierre de vuelta dentro."),
    "VX": ("Aceptación fuera del valor de la sesión anterior", M15, "30 minutos de cierres seguidos fuera del valor del mismo lado: sigue la salida. Una vez por lado y sesión.", "los cierres fuera del valor anterior."),
    "VE": ("Extremo del valor de la sesión anterior", M15, "La sesión abre dentro del área de valor de la anterior y el precio llega a un borde: en el VAL compra y en el VAH vende, con el objetivo en el POC.", "las líneas del valor anterior y que la vela resaltada toque el borde."),
    "LIQz": ("Barrido de la zona de liquidaciones", M15, "El precio estuvo entero de un lado de una zona de liquidaciones a la vista y una vela pasa su borde contrario: bajar a través de la zona es alcista (barrió esas liquidaciones) y subir, bajista.", "la zona barrida (resaltada entre las demás) y que la vela resaltada la atraviese."),
    "LIQs": ("Barrido de un swing en una zona de liquidaciones", M15, "El precio pasa un swing (5 velas a cada lado) que cae dentro de una zona de liquidaciones a la vista: barrer un mínimo es alcista y un máximo, bajista.", "el swing pasado, la zona donde cae y la vela que lo pasa."),
}

PAGES = [
    ("1_velas", "Velas, patrones y cajas", ["FV", "IM", "SP", "VH", "RF", "RBg", "RBs", "HM", "EN", "DJ", "GC", "BX", "BE", "CP", "CC"],
     ""),
    ("2_vpa", "Lector VPA", ["QA", "QB", "QF", "QR", "QT", "QS", "QC", "QE"],
     "Volumen y rango de cada vela se miden contra lo normal de su misma hora en los 30 días anteriores. Cada lectura es un grado de 0 a 100% y cuenta desde 50%."),
    ("3_williams_smc", "Williams y SMC", ["WD", "WA", "WF", "BS", "OB", "BK", "EQ"], ""),
    ("4_orderflow", "Order flow (footprint)", ["VA", "OG", "AP", "SL", "RL", "EX", "ZP", "DT", "RS", "DD", "PD", "IV", "AD", "SW", "VL", "SQ", "DB", "PW", "DV",
                                               "ST", "VI", "IR", "RD", "VD", "TP", "OP", "RX", "XD", "SM", "BR", "GR"],
     "Con los trades reales del almacén. El «inicio» de una vela es su mínimo si es verde y su máximo si es roja. «Agresor a favor» son las compras en una verde y las ventas en una roja; «pasivo», el lado contrario. Los umbrales «relativos» salen de los 30 días anteriores, para que cada elemento marque cerca del 5% de las velas. «Vela de mucho volumen»: 2 o más veces la mediana de las 20 anteriores. El footprint va encendido en estas capturas."),
    ("5_perfil_liq", "Perfil por sesión y liquidaciones", ["VR", "VF", "VX", "VE", "LIQz", "LIQs"],
     "El perfil es el de la sesión anterior ya cerrada (un día, en UTC), con el volumen real del almacén. Las zonas de liquidaciones son las del indicador Liquidaciones a la vista en esa vela."),
]


def picture(path, width=1000, quality=68):
    img = Image.open(path).convert("RGB")
    if img.width > width:
        img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality, optimize=True)
    # Con su tamaño en la etiqueta, la página no se corre mientras cargan las imágenes (los enlaces a cada elemento)
    uri = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    return f'src="{uri}" width="{img.width}" height="{img.height}"'


def caption(meta):
    detail = (meta or {}).get("detail") or ""
    head = detail.split("\n")[0]
    side = "largo" if "Largo" in head else ("corto" if "Corto" in head else "")
    m = re.search(r"Señal ([^·]+)", detail)
    return (m.group(1).strip() if m else "", side)


def build_page(slug, title, codes, note, runs, nav_pages):
    parts, nav, total, missing = [], [], 0, []
    for code in codes:
        name, market, definition, look = E[code]
        folder = SHOTS / f"G_{code}"
        files = sorted(folder.glob("trade_[0-9][0-9][0-9][0-9].jpg")) if folder.exists() else []
        if not files:
            missing.append(code)
            continue
        nav.append(f'<a href="#{code}">{html.escape(name)}</a>')
        cases = []
        for i, img in enumerate(files, 1):
            meta_path = img.with_suffix(".json")
            meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
            when, side = caption(meta)
            n = int(img.stem.split("_")[1])
            key = f"{code}-{i}"
            cases.append(
                f'<figure class="case" id="{key}"><img loading="lazy" {picture(img)} alt="{html.escape(name)}, caso {i}">'
                f'<figcaption><b>Caso {i}</b> · señal {html.escape(when)} (hora de Colombia) · {side} · trade {n} de la corrida'
                f'<div class="marks" data-key="{key}">'
                f'<label><input type="radio" name="{key}" value="Sí"> Sí, es lo que entiendo</label>'
                f'<label><input type="radio" name="{key}" value="No"> No</label>'
                f'<label><input type="radio" name="{key}" value="No sé"> No sé</label>'
                f'<input type="text" class="note" placeholder="Nota (opcional): qué ves distinto"></div></figcaption></figure>')
            total += 1
        info = runs.get(code) or {}
        trades = info.get("trades")
        parts.append(
            f'<section id="{code}"><h2>{html.escape(name)} <small>{market} · fase 1 · {len(files)} casos de {trades} trades</small></h2>'
            f'<p class="def"><b>Cómo lo calcula la app:</b> {html.escape(definition)}</p>'
            f'<p class="look"><b>Qué mirar:</b> {html.escape(look)}</p>'
            f'<p class="run">Corrida {html.escape(info.get("run", ""))}</p><div class="grid">{"".join(cases)}</div></section>')
    pages = " · ".join(f'<a href="GALERIA_{s}.html"{" class=here" if s == slug else ""}>{html.escape(t)}</a>' for s, t in nav_pages)
    page = (TEMPLATE.replace("{{TITLE}}", html.escape(title)).replace("{{PAGES}}", pages).replace("{{NOTE}}", html.escape(note))
            .replace("{{NAV}}", " · ".join(nav)).replace("{{SECTIONS}}", "".join(parts)).replace("{{TOTAL}}", str(total))
            .replace("{{KEY}}", f"galeria_etapa7_{slug}"))
    return page, total, missing


def main(out_dir):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    runs = json.loads(RUNS.read_text(encoding="utf-8"))
    nav_pages = [(s, t) for s, t, _, _ in PAGES]
    for slug, title, codes, note in PAGES:
        page, total, missing = build_page(slug, title, codes, note, runs, nav_pages)
        path = out_dir / f"GALERIA_{slug}.html"
        path.write_text(page, encoding="utf-8")
        print(f"{path.name}: {total} casos" + (f" · sin capturas: {', '.join(missing)}" if missing else "") + f" ({path.stat().st_size / 1e6:.1f} MB)")


TEMPLATE = """<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Galería · {{TITLE}}</title>
<style>
:root { --bg: #f6f7f9; --card: #ffffff; --ink: #1d2433; --muted: #5b6576; --line: #d9dee6; --accent: #2f6fde; --ok: #157f3b; --bad: #b42318; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 "Segoe UI", system-ui, sans-serif; }
header { position: sticky; top: 0; z-index: 5; background: var(--card); border-bottom: 1px solid var(--line); padding: 10px 20px; }
header h1 { margin: 0 0 2px; font-size: 19px; }
header p { margin: 3px 0; color: var(--muted); max-width: 1150px; font-size: 14px; }
.pages a { color: var(--accent); text-decoration: none; font-size: 14px; }
.pages a.here { color: var(--ink); font-weight: 600; }
.bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 6px; }
button { background: var(--accent); color: #fff; border: 0; border-radius: 6px; padding: 7px 13px; font: inherit; cursor: pointer; }
button.alt { background: #e8edf5; color: var(--ink); }
#count { color: var(--muted); font-size: 14px; }
nav { padding: 10px 20px; font-size: 14px; }
nav a { color: var(--accent); text-decoration: none; }
section { padding: 6px 20px 22px; scroll-margin-top: 190px; }
.case { scroll-margin-top: 190px; }
h2 { font-size: 18px; margin: 16px 0 6px; }
h2 small { color: var(--muted); font-weight: 400; font-size: 13px; }
.def, .look { max-width: 1150px; margin: 4px 0; }
.note-page { padding: 0 20px; color: var(--muted); max-width: 1150px; }
.run { color: var(--muted); font-size: 12px; margin: 2px 0 10px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 520px), 1fr)); gap: 14px; }
.case { margin: 0; background: var(--card); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.case img { width: 100%; height: auto; display: block; cursor: zoom-in; }
figcaption { padding: 8px 10px 10px; font-size: 13px; color: var(--muted); }
figcaption b { color: var(--ink); }
.marks { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 6px; color: var(--ink); }
.marks .note { flex: 1 1 100%; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; font: inherit; }
.case.si { border-color: var(--ok); }
.case.no { border-color: var(--bad); box-shadow: 0 0 0 2px rgba(180,35,24,.15); }
#zoom { position: fixed; inset: 0; background: rgba(10,14,22,.92); display: none; align-items: center; justify-content: center; z-index: 10; cursor: zoom-out; }
#zoom img { max-width: 98vw; max-height: 96vh; }
</style></head>
<body>
<header>
<h1>Galería de elementos · {{TITLE}}</h1>
<div class="pages">{{PAGES}}</div>
<p>Cada caso es una señal real del probador (motor 6, copia aislada, BTC fase 1), elegida a lo largo de la fase. Marca si
lo que la app llama así es lo que tú entiendes por ese elemento. No importa si el trade ganó o perdió. La franja vertical
azul es la vela de la señal (cuando la regla decide) y el cuadro dice qué se cumplía; las marcas y cajas claras son el
elemento; la caja verde y roja es el trade. Si el trade fue largo, la captura termina unas velas después de la señal,
para que el elemento se vea grande. Un clic en la imagen la agranda.</p>
<div class="bar"><button id="copy">Copiar mis marcas de esta página</button><button class="alt" id="clear">Borrar mis marcas</button>
<span id="count"></span></div>
</header>
<p class="note-page">{{NOTE}}</p>
<nav>{{NAV}}</nav>
{{SECTIONS}}
<div id="zoom"><img alt=""></div>
<script>
const KEY = '{{KEY}}';
let store = {};
try { store = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { store = {}; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} };
const total = {{TOTAL}};
function paint() {
  let si = 0, no = 0, duda = 0;
  document.querySelectorAll('.marks').forEach(m => {
    const k = m.dataset.key, v = store[k] || {};
    m.querySelectorAll('input[type=radio]').forEach(r => { r.checked = r.value === v.mark; });
    m.querySelector('.note').value = v.note || '';
    const fig = m.closest('.case');
    fig.classList.toggle('si', v.mark === 'Sí');
    fig.classList.toggle('no', v.mark === 'No');
    if (v.mark === 'Sí') si++; else if (v.mark === 'No') no++; else if (v.mark === 'No sé') duda++;
  });
  document.getElementById('count').textContent = `Sí ${si} · No ${no} · No sé ${duda} · sin marcar ${total - si - no - duda} de ${total}`;
}
document.addEventListener('change', e => {
  const m = e.target.closest('.marks'); if (!m) return;
  const k = m.dataset.key; store[k] = store[k] || {};
  if (e.target.type === 'radio') store[k].mark = e.target.value;
  if (e.target.classList.contains('note')) store[k].note = e.target.value;
  save(); paint();
});
document.addEventListener('input', e => {
  if (!e.target.classList.contains('note')) return;
  const k = e.target.closest('.marks').dataset.key; store[k] = store[k] || {}; store[k].note = e.target.value; save();
});
document.getElementById('copy').onclick = async () => {
  const lines = ['Galería · {{TITLE}}: ' + document.getElementById('count').textContent];
  document.querySelectorAll('section').forEach(s => {
    const title = s.querySelector('h2').childNodes[0].textContent.trim();
    const rows = [...s.querySelectorAll('.marks')].map((m, i) => {
      const v = store[m.dataset.key] || {};
      return (v.mark && v.mark !== 'Sí') || v.note ? `caso ${i + 1}: ${v.mark || 'sin marcar'}${v.note ? ' (' + v.note + ')' : ''}` : null;
    }).filter(Boolean);
    const marked = [...s.querySelectorAll('.marks')].filter(m => (store[m.dataset.key] || {}).mark).length;
    lines.push(`${title}: ${marked} marcados` + (rows.length ? ' · ' + rows.join('; ') : (marked ? ' · todos "Sí"' : '')));
  });
  const text = lines.join('\\n');
  try { await navigator.clipboard.writeText(text); alert('Copiado. Pégalo en el chat.'); }
  catch (e) { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); alert('Copiado. Pégalo en el chat.'); }
};
document.getElementById('clear').onclick = () => { if (confirm('¿Borrar todas tus marcas de esta página?')) { store = {}; save(); paint(); } };
const zoom = document.getElementById('zoom');
document.addEventListener('click', e => {
  if (e.target.matches('.case img')) { zoom.querySelector('img').src = e.target.src; zoom.style.display = 'flex'; }
  else if (e.target.closest('#zoom')) zoom.style.display = 'none';
});
paint();
</script>
</body></html>
"""

if __name__ == "__main__":
    main(sys.argv[1])
