# make_icon.py - Arma el icono de la app (desktop/icon.ico, desktop/icon.png y web/public/icon.svg).
#
# Elegido por el usuario el 12/11/2026: el perfil de volumen azul y oro sobre fondo blanco ("P1"):
# barras azules fuera del area de valor, doradas dentro y la linea del POC.
# Antes, el mismo dia, habia elegido el monograma "A" verde con una vela; queda como diseno "a".
#
# Uso:  python -B make_icon.py            perfil (el elegido)
#       python -B make_icon.py a          monograma A verde
# Necesita Pillow (ya esta en el Python del PC). Dibuja a 8 veces el tamano y reduce: bordes suaves.
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
RADIUS = 18

# ---------- perfil de volumen (P1) ----------
P_BG, P_BORDER, P_OUT, P_VA, P_POC = "#FFFFFF", "#C9CDD6", "#85B7EB", "#C4A23B", "#131722"
# (y, ancho, color) en una caja de 100 x 100, barras desde x = 14
P_BARS = [(18, 20, P_OUT), (28, 34, P_OUT), (38, 52, P_VA), (48, 70, P_VA), (58, 44, P_VA), (68, 26, P_OUT), (78, 14, P_OUT)]
P_BAR_H, P_POC_Y, P_POC_W, P_BORDER_W = 7, 51.5, 2, 2
# En 16 a 24 px las barras finas se pierden: menos barras, mas gruesas, y borde mas marcado
P_BARS_SMALL = [(12, 30, P_OUT), (29, 58, P_VA), (46, 78, P_VA), (63, 46, P_VA), (80, 24, P_OUT)]
P_BAR_H_SMALL, P_POC_Y_SMALL, P_POC_W_SMALL, P_BORDER_W_SMALL = 12, 52, 5, 6

# ---------- monograma A (primera eleccion) ----------
A_BG, A_FG, A_CANDLE = "#0F6E56", "#FFFFFF", "#F7C1C1"
A_OUTER = [(50, 16), (80, 84), (66, 84), (59, 66), (41, 66), (34, 84), (20, 84)]
A_HOLE = [(45, 54), (55, 54), (50, 40)]
A_CANDLE_RECT = (47, 70, 53, 84)


def _tile(d, big, k, bg, border=None, border_w=2):
    if border:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=RADIUS * k, fill=border)
        inset = border_w * k
        d.rounded_rectangle([inset, inset, big - 1 - inset, big - 1 - inset], radius=max(1, RADIUS * k - inset), fill=bg)
    else:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=RADIUS * k, fill=bg)


def render_profile(size):
    big = size * 8
    k = big / 100
    small = size <= 24
    bars, bar_h = (P_BARS_SMALL, P_BAR_H_SMALL) if small else (P_BARS, P_BAR_H)
    poc_y, poc_w = (P_POC_Y_SMALL, P_POC_W_SMALL) if small else (P_POC_Y, P_POC_W)
    im = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    _tile(d, big, k, P_BG, P_BORDER, P_BORDER_W_SMALL if small else P_BORDER_W)
    for y, w, color in bars:
        d.rounded_rectangle([14 * k, y * k, (14 + w) * k, (y + bar_h) * k], radius=2 * k, fill=color)
    d.rectangle([10 * k, (poc_y - poc_w / 2) * k, 90 * k, (poc_y + poc_w / 2) * k], fill=P_POC)
    return im.resize((size, size), Image.LANCZOS)


def svg_profile():
    bars = "".join(f'<rect x="14" y="{y}" width="{w}" height="{P_BAR_H}" rx="2" fill="{c}"/>' for y, w, c in P_BARS)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
            f'<rect x="1" y="1" width="98" height="98" rx="{RADIUS}" fill="{P_BG}" stroke="{P_BORDER}" stroke-width="{P_BORDER_W}"/>'
            f'{bars}<line x1="10" y1="{P_POC_Y}" x2="90" y2="{P_POC_Y}" stroke="{P_POC}" stroke-width="{P_POC_W}"/></svg>\n')


def render_a(size):
    big = size * 8
    k = big / 100
    im = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    _tile(d, big, k, A_BG)
    d.polygon([(x * k, y * k) for x, y in A_OUTER], fill=A_FG)
    d.polygon([(x * k, y * k) for x, y in A_HOLE], fill=A_BG)
    x0, y0, x1, y1 = A_CANDLE_RECT
    d.rectangle([x0 * k, y0 * k, x1 * k, y1 * k], fill=A_CANDLE)
    return im.resize((size, size), Image.LANCZOS)


def svg_a():
    pts = " ".join(f"L{x} {y}" for x, y in A_OUTER[1:])
    hole = " ".join(f"L{x} {y}" for x, y in A_HOLE[1:])
    x0, y0, x1, y1 = A_CANDLE_RECT
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
            f'<rect x="1" y="1" width="98" height="98" rx="{RADIUS}" fill="{A_BG}"/>'
            f'<path d="M{A_OUTER[0][0]} {A_OUTER[0][1]} {pts} Z M{A_HOLE[0][0]} {A_HOLE[0][1]} {hole} Z" fill="{A_FG}"/>'
            f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" fill="{A_CANDLE}"/></svg>\n')


DESIGNS = {"perfil": (render_profile, svg_profile), "a": (render_a, svg_a)}


def main():
    name = sys.argv[1].lower() if len(sys.argv) > 1 else "perfil"
    if name not in DESIGNS:
        sys.exit(f"diseno desconocido: {name} (perfil o a)")
    render, svg = DESIGNS[name]
    images = [render(s) for s in SIZES]
    images[-1].save(HERE / "icon.ico", format="ICO", sizes=[(s, s) for s in SIZES], append_images=images[:-1])
    images[-1].save(HERE / "icon.png", format="PNG")
    public = HERE.parent / "web" / "public"
    public.mkdir(exist_ok=True)
    (public / "icon.svg").write_text(svg(), encoding="utf-8")
    print(f"icono listo: {name}")


if __name__ == "__main__":
    main()
