# archivo: alert_server.py
from flask import Flask, request, jsonify
import datetime
import threading
import logging

app = Flask(__name__)

# ===== CONFIGURACIÓN =====
PORT = 5000
LOG_FILE = "alert_log.txt"

# Silenciar logs de Flask (werkzeug)
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)  # ERROR solo mostrará fallos graves (no peticiones normales)

def log_alert(data):
    """Guarda la alerta en un archivo con fecha y hora."""
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(f"[{datetime.datetime.now()}] {data}\n")

def notify_console(data):
    """Notificación visual o sonora en la consola."""
    print(f"\n🚨 ALERTA RECIBIDA ({datetime.datetime.now()}):")
    print(f"{data}")
    print("-" * 50)

@app.route('/alert', methods=['POST'])
def receive_alert():
    """Ruta para recibir alertas."""
    try:
        data = request.json or {}
        # Notificar en consola
        notify_console(data)
        # Guardar en archivo
        threading.Thread(target=log_alert, args=(data,)).start()
        return jsonify({"status": "ok", "message": "alerta recibida"}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


if __name__ == '__main__':
    print(f"🚀 Servidor de alertas escuchando en el puerto {PORT}...")
    print(f"(no se mostrará nada hasta que llegue una alerta)")
    app.run(host='0.0.0.0', port=PORT)
