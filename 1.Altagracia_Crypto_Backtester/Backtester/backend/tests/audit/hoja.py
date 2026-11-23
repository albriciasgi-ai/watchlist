"""
Protocolo (21/11/2026), capa C: hoja de contactos con las capturas guardadas de varios trades, para la revisión visual
de cada uno en una sola imagen. Cada miniatura lleva el número del trade y, si la comprobación automática dejó un ⚠,
un borde rojo.

Uso: python -B tests/audit/hoja.py <carpeta de la regla en evidencia/pantalla> <desde> <hasta> [columnas] [ancho]
Escribe evidencia/pantalla/<carpeta>/hoja_<desde>_<hasta>.jpg y dice su ruta.
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\pantalla")


def main(folder, first, last, cols=4, width=480):
    base = ROOT / folder
    tiles = []
    for n in range(first, last + 1):
        img = base / f"trade_{n:04d}.jpg"
        if not img.exists():
            continue
        meta = {}
        js = base / f"trade_{n:04d}.json"
        if js.exists():
            try:
                meta = json.loads(js.read_text(encoding="utf-8"))
            except ValueError:
                meta = {}
        warn = "⚠" in json.dumps(meta, ensure_ascii=False)
        im = Image.open(img).convert("RGB")
        h = round(im.height * width / im.width)
        tiles.append((n, im.resize((width, h)), warn))
    if not tiles:
        print("sin capturas")
        return
    th = max(t[1].height for t in tiles)
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * width, rows * th), "white")
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("arialbd.ttf", 22)
    except OSError:
        font = ImageFont.load_default()
    for k, (n, im, warn) in enumerate(tiles):
        x, y = (k % cols) * width, (k // cols) * th
        sheet.paste(im, (x, y))
        draw.rectangle([x, y, x + 58, y + 28], fill=(255, 235, 59) if not warn else (229, 57, 53))
        draw.text((x + 4, y + 2), f"#{n}", fill="black", font=font)
        draw.rectangle([x, y, x + width - 1, y + th - 1], outline=(229, 57, 53) if warn else (120, 120, 120), width=3 if warn else 1)
    out = base / f"hoja_{first:04d}_{last:04d}.jpg"
    sheet.save(out, quality=80)
    print(out)


if __name__ == "__main__":
    a = sys.argv[1:]
    main(a[0], int(a[1]), int(a[2]), int(a[3]) if len(a) > 3 else 4, int(a[4]) if len(a) > 4 else 480)
