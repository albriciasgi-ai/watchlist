# make_icon.py - Arma el icono de la app (desktop/icon.ico y web/public/icon.svg) desde un solo diseno.
#
# Diseno elegido por el usuario el 12/11/2026: el monograma "A" de Altagracia con una vela entre las patas.
# Para otro color: python -B make_icon.py <fondo> <letra> <vela> [borde]   (colores en #RRGGBB)
# Sin argumentos usa el verde elegido. Necesita Pillow (ya esta en el Python del PC).
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
DEFAULT = ("#0F6E56", "#FFFFFF", "#F7C1C1", None)

# Coordenadas en una caja de 100 x 100 (las mismas del SVG)
A_OUTER = [(50, 16), (80, 84), (66, 84), (59, 66), (41, 66), (34, 84), (20, 84)]
A_HOLE = [(45, 54), (55, 54), (50, 40)]
CANDLE = (47, 70, 53, 84)
RADIUS = 18


def svg(bg, fg, candle, border=None):
    stroke = f' stroke="{border}" stroke-width="2"' if border else ""
    pts = " ".join(f"L{x} {y}" for x, y in A_OUTER[1:])
    hole = " ".join(f"L{x} {y}" for x, y in A_HOLE[1:])
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
            f'<rect x="1" y="1" width="98" height="98" rx="{RADIUS}" fill="{bg}"{stroke}/>'
            f'<path d="M{A_OUTER[0][0]} {A_OUTER[0][1]} {pts} Z M{A_HOLE[0][0]} {A_HOLE[0][1]} {hole} Z" fill="{fg}"/>'
            f'<rect x="{CANDLE[0]}" y="{CANDLE[1]}" width="{CANDLE[2] - CANDLE[0]}" height="{CANDLE[3] - CANDLE[1]}" fill="{candle}"/>'
            f'</svg>\n')


def render(size, bg, fg, candle, border=None):
    """Dibuja a 8 veces el tamano y reduce: bordes suaves sin depender de un lector de SVG."""
    big = size * 8
    k = big / 100
    im = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if border:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=RADIUS * k, fill=border)
        inset = max(2 * k, 8)
        d.rounded_rectangle([inset, inset, big - 1 - inset, big - 1 - inset], radius=RADIUS * k - inset, fill=bg)
    else:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=RADIUS * k, fill=bg)
    d.polygon([(x * k, y * k) for x, y in A_OUTER], fill=fg)
    d.polygon([(x * k, y * k) for x, y in A_HOLE], fill=bg)
    d.rectangle([CANDLE[0] * k, CANDLE[1] * k, CANDLE[2] * k, CANDLE[3] * k], fill=candle)
    return im.resize((size, size), Image.LANCZOS)


def main():
    bg, fg, candle, border = (sys.argv[1:5] + [None] * 4)[:4] if len(sys.argv) > 3 else DEFAULT
    images = [render(s, bg, fg, candle, border) for s in SIZES]
    images[-1].save(HERE / "icon.ico", format="ICO", sizes=[(s, s) for s in SIZES], append_images=images[:-1])
    images[-1].save(HERE / "icon.png", format="PNG")
    public = HERE.parent / "web" / "public"
    public.mkdir(exist_ok=True)
    (public / "icon.svg").write_text(svg(bg, fg, candle, border), encoding="utf-8")
    print(f"icono listo: fondo {bg}, letra {fg}, vela {candle}" + (f", borde {border}" if border else ""))


if __name__ == "__main__":
    main()
