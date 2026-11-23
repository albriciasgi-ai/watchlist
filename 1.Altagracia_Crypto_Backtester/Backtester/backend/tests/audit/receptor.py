"""
Receptor local del protocolo de pruebas (21/11/2026): la página aislada (9301) le envía lo leído de la pantalla (capa B)
y las capturas ampliadas de cada trade (capa C), y él las guarda en la carpeta de evidencia. Solo escucha en 127.0.0.1
y solo acepta pedidos de la página aislada.

    POST /json?carpeta=R01_ARBUSDT_f1&nombre=capa_b     cuerpo JSON      -> carpeta/nombre.json
    POST /img?carpeta=R01_ARBUSDT_f1&nombre=trade_001   cuerpo data URL  -> carpeta/nombre.jpg
"""
import base64
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\pantalla")
ALLOWED = {"http://127.0.0.1:9301", "http://localhost:9301"}
SAFE = re.compile(r"^[A-Za-z0-9_.\-]{1,80}$")


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        origin = self.headers.get("Origin")
        if origin in ALLOWED:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if urlparse(self.path).path == "/helper.js":
            # El ayudante de las capas B y C, para que la página lo cargue con import() tras cada recarga
            body = (Path(__file__).resolve().parent / "capa_bc.js").read_bytes()
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "text/javascript; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(200)
        self._cors()
        self.end_headers()
        self.wfile.write(b"receptor del protocolo: listo")

    def do_POST(self):
        if self.headers.get("Origin") not in ALLOWED:
            self.send_response(403)
            self.end_headers()
            return
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        folder, name = q.get("carpeta", ""), q.get("nombre", "")
        if not SAFE.match(folder) or not SAFE.match(name):
            self.send_response(400)
            self._cors()
            self.end_headers()
            return
        size = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(size)
        target = ROOT / folder
        target.mkdir(parents=True, exist_ok=True)
        if url.path == "/json":
            data = json.loads(body.decode("utf-8"))
            (target / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        elif url.path == "/img":
            text = body.decode("ascii")
            payload = text.split(",", 1)[1] if text.startswith("data:") else text
            (target / f"{name}.jpg").write_bytes(base64.b64decode(payload))
        else:
            self.send_response(404)
            self._cors()
            self.end_headers()
            return
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, fmt, *args):  # Silencio: miles de pedidos
        pass


if __name__ == "__main__":
    ROOT.mkdir(parents=True, exist_ok=True)
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9399
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
