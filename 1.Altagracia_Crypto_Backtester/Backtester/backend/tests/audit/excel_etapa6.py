"""
Protocolo (22/11/2026), etapa 6: pasa al Excel de chequeo (`CHEQUEO_PRUEBAS_REGLAS.xlsx` del worktree) el resultado de
los 100 pasos (hoja Chequeo: Estado, Fecha y Notas) y de las 43 confusiones (hoja Confusiones: Estado y Notas), desde
`evidencia/etapa6/pasos_pantalla.json` y `confusiones_pantalla.json`. Las columnas se buscan por su encabezado; solo
se escriben esas celdas.

Uso: python -B tests/audit/excel_etapa6.py [--probar]   (--probar: dice qué escribiría, sin guardar)
"""
import datetime as dt
import json
import sys
from pathlib import Path

import openpyxl

HERE = Path(__file__).resolve().parent
XLSX = HERE.parents[2] / "CHEQUEO_PRUEBAS_REGLAS.xlsx"
EV = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\etapa6")


def columns(ws):
    """La fila del encabezado (la que empieza con '#') y la columna de cada título."""
    for row in ws.iter_rows(min_row=1, max_row=5):
        if row[0].value == "#":
            return row[0].row, {str(c.value).strip(): c.column for c in row if c.value}
    raise ValueError(f"sin encabezado en {ws.title}")


# Los estados que deja la validación de cada hoja: Chequeo "OK, Falla, Pendiente"; Confusiones "Confirmado en el
# código, Confirmado en la prueba, No pasa, Por comprobar". Lo anotado en la etapa se traduce a esas opciones; una
# confusión que "cambió" se anota "No pasa" salvo que una parte siga pasando (31 y 34: la nota dice qué cambió).
STATES = {"Chequeo": {"Pasa": "OK", "Cambió": "OK", "Falla": "Falla", "Pendiente": "Pendiente"},
          "Confusiones": {"Confirmada": "Confirmado en la prueba", "Cambió": "No pasa", "No pasa": "No pasa"}}
STILL_TRUE = {"31", "34"}


def fill(ws, results, fields, today):
    head, cols = columns(ws)
    done = 0
    for r in range(head + 1, ws.max_row + 1):
        n = ws.cell(r, 1).value
        got = results.get(str(n))
        if not got:
            continue
        for name, key in fields:
            if name in cols and got.get(key) is not None:
                value = got[key]
                if name == "Estado":
                    value = ("Confirmado en la prueba" if ws.title == "Confusiones" and str(n) in STILL_TRUE
                             else STATES.get(ws.title, {}).get(value, value))
                ws.cell(r, cols[name]).value = value
        if "Fecha" in cols:
            ws.cell(r, cols["Fecha"]).value = today
        done += 1
    return done


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    probe = "--probar" in sys.argv
    pasos = json.loads((EV / "pasos_pantalla.json").read_text(encoding="utf-8")) if (EV / "pasos_pantalla.json").exists() else {}
    confs = json.loads((EV / "confusiones_pantalla.json").read_text(encoding="utf-8")) if (EV / "confusiones_pantalla.json").exists() else {}
    wb = openpyxl.load_workbook(XLSX)
    today = dt.date.today().isoformat()
    a = fill(wb["Chequeo"], pasos, [("Estado", "estado"), ("Notas", "notas")], today)
    b = fill(wb["Confusiones"], confs, [("Estado", "estado"), ("Notas", "notas")], None)
    print(f"Chequeo: {a} pasos; Confusiones: {b}")
    if not probe:
        wb.save(XLSX)
        print("guardado:", XLSX)


if __name__ == "__main__":
    main()
