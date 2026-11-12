# Pruebas sin conexion de la proteccion del backend de la Watchlist (App 2 y App 7): Origin, Host, simbolos,
# dibujos y alertas de prueba. Usa el cliente de pruebas de FastAPI sin arrancar los servicios.
# Se corren con run_checks.py, que las lanza sobre una copia temporal del backend.
import json
import os
import sys
from pathlib import Path

TEST_DIR = Path(sys.argv[1]).resolve()
os.chdir(TEST_DIR)
sys.path.insert(0, str(TEST_DIR))
(TEST_DIR / "config").mkdir(exist_ok=True)

import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

assert Path(main.DRAWINGS_DIR).resolve() == TEST_DIR / "drawings", f"dibujos fuera de la copia de prueba: {main.DRAWINGS_DIR}"

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


# Sin "with": no corre el arranque del backend (no abre el WebSocket ni llama a Bybit)
client = TestClient(main.app, base_url="http://localhost:8000")
PATH = "/api/drawings/BTCUSDT"

# --- Origin
r = client.get(PATH)
check("programa local sin Origin: pasa", r.status_code == 200, str(r.status_code))
r = client.get(PATH, headers={"Origin": "http://localhost:5173"})
check("App 7 en desarrollo (localhost:5173): pasa y recibe la cabecera CORS",
      r.status_code == 200 and r.headers.get("access-control-allow-origin") == "http://localhost:5173",
      f"{r.status_code} {r.headers.get('access-control-allow-origin')}")
r = client.get(PATH, headers={"Origin": "null"})
check("App 7 empaquetada (Origin null): pasa", r.status_code == 200, str(r.status_code))
r = client.get(PATH, headers={"Origin": "file://"})
check("App 7 empaquetada (file://): pasa", r.status_code == 200, str(r.status_code))
r = client.get(PATH, headers={"Origin": "https://pagina-ajena.example"})
check("pagina ajena: 403", r.status_code == 403, str(r.status_code))
r = client.post("/api/swing/config", content='{"enabled": false}',
                headers={"Origin": "https://pagina-ajena.example", "Content-Type": "text/plain"})
check("POST de texto plano desde una pagina ajena: 403, no llega al Swing", r.status_code == 403, str(r.status_code))
r = client.get(PATH, headers={"Origin": "http://localhost.pagina-ajena.example"})
check("dominio que empieza por 'localhost.': 403", r.status_code == 403, str(r.status_code))
r = client.options(PATH, headers={"Origin": "https://pagina-ajena.example", "Access-Control-Request-Method": "POST"})
check("consulta previa (OPTIONS) desde una pagina ajena: rechazada", r.status_code == 400, str(r.status_code))
r = client.options(PATH, headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})
check("consulta previa (OPTIONS) desde App 7: aceptada", r.status_code == 200, str(r.status_code))

# --- Host
r = client.get(PATH, headers={"Host": "pagina-ajena.example"})
check("Host ajeno (dominio apuntado a 127.0.0.1): 400", r.status_code == 400, str(r.status_code))
r = client.get(PATH, headers={"Host": "127.0.0.1:8000"})
check("Host 127.0.0.1: pasa", r.status_code == 200, str(r.status_code))

# --- Dibujos
drawings = TEST_DIR / "drawings"
outside = TEST_DIR / "fuera.json"
outside.write_text('{"secreto": true}', encoding="utf-8")
r = client.get("/api/drawings/..%5Cfuera")
check("simbolo con '..\\': 400 al leer", r.status_code == 400, str(r.status_code))
r = client.post("/api/drawings/..%5Cfuera", json={"shapes": []})
check("simbolo con '..\\': 400 al guardar, y el archivo de afuera sigue igual",
      r.status_code == 400 and json.loads(outside.read_text(encoding="utf-8")) == {"secreto": True}, str(r.status_code))
r = client.delete("/api/drawings/..%5Cfuera")
check("simbolo con '..\\': 400 al borrar, y el archivo de afuera existe", r.status_code == 400 and outside.exists(), str(r.status_code))

shape = {"type": "tpsl", "id": "tpsl_1_0.1", "entryPrice": 100, "slPrice": 99, "tpPrice": 102, "time": 1, "widthTime": 1}
r = client.post(PATH, json={"shapes": [shape]})
saved = json.loads((drawings / "BTCUSDT.json").read_text(encoding="utf-8"))
check("guardar dibujos: queda el archivo, sin temporal",
      r.json().get("success") is True and saved["shapes"] == [shape] and not list(drawings.glob("*.tmp")))
r = client.get(PATH)
check("leer dibujos: devuelve lo guardado", r.status_code == 200 and r.json()["shapes"] == [shape])
r = client.post(PATH, json={"shapes": {"no": "lista"}})
check("shapes que no es una lista: no se guarda",
      r.json().get("success") is False and json.loads((drawings / "BTCUSDT.json").read_text(encoding="utf-8"))["shapes"] == [shape])
(drawings / "ETHUSDT.json").write_text("{ esto no es json", encoding="utf-8")
r = client.get("/api/drawings/ETHUSDT")
check("archivo de dibujos ilegible: error 500, no una lista vacia",
      r.status_code == 500 and "shapes" not in r.json(), f"{r.status_code} {list(r.json().keys())}")
r = client.get("/api/drawings/btcusdt")
check("simbolo en minusculas: se normaliza", r.status_code == 200 and r.json()["shapes"] == [shape])

# --- Alertas de prueba
r = client.post("/api/test-alert")
check("alerta de prueba sin confirmar: no se envia", r.json().get("success") is False and "confirm" in r.json().get("error", ""))
r = client.post("/api/test-alert-batch")
check("lote de alertas de prueba sin confirmar: no se envia", r.json().get("success") is False)
stray = [route for route in main.app.routes
         if getattr(route, "path", "") == "/api/clear-cache" and getattr(route, "endpoint", None) is main.send_test_alert]
check("/api/clear-cache ya no esta enlazado a la alerta de prueba", stray == [], str(stray))

# --- Nombres de archivo del cache
check("cache: un nombre con '..' no se usa", main.load_cache("..\\x", "15", "vwap") is None)
main.save_cache("BTCUSDT", "..\\..\\x", "vwap", {"a": 1})
check("cache: guardar con un nombre invalido no escribe fuera", not (TEST_DIR / "x_vwap.json").exists()
      and not list(TEST_DIR.parent.glob("x_vwap.json")))

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} de {len(results)} pruebas pasan")
sys.exit(1 if failed else 0)
