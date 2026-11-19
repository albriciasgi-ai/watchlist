# settings.py - Configuracion del servidor de la suite: rutas y puertos, nunca en el codigo.
#
# Orden: valores de fabrica < config/suite.json < variables de entorno (SUITE_*).
# El servidor se construye como si ya fuera el servidor 24/7: escucha en 127.0.0.1 por defecto,
# arranca sin ventana y nada que opere depende del navegador.
import json
import os
from pathlib import Path

SUITE_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = SUITE_DIR.parent

DEFAULTS = {
    "host": "127.0.0.1",
    "port": 13000,
    # Bot (3.TradingBot_Python): sigue siendo su propio proceso; la suite lo lee y lo maneja por su API
    "bot_url": "http://127.0.0.1:5000",
    # Almacen de order flow: oficial (store/), nube y PC (live/store, que arma el backend 11000)
    "orderflow_data": r"C:\Users\inven\OrderFlowData",
    # Backend de App 1: sus lectores (footprint_store, liq_store) son la pieza compartida
    "app1_backend": str(REPO_DIR / "1.Altagracia_Crypto_Backtester" / "Backtester" / "backend"),
    "data_dir": str(SUITE_DIR / "data"),
    "bybit_url": "https://api.bybit.com",
    # Paginas que pueden usar la API (el frontend de desarrollo y el servido por este mismo servidor)
    "allowed_origin_hosts": ["localhost", "127.0.0.1"],
    # Alpaca (acciones de EE. UU., alpaca_data.py): las claves van en config/suite.json (no va a git) o en
    # SUITE_ALPACA_KEY_ID / SUITE_ALPACA_SECRET_KEY. Sirven las de una cuenta paper. feed: sip (todos los exchanges,
    # gratis salvo los ultimos 15 minutos) o iex (un exchange, en tiempo real)
    "alpaca_key_id": "",
    "alpaca_secret_key": "",
    "alpaca_feed": "sip",
    "alpaca_data_url": "https://data.alpaca.markets",
    "alpaca_trading_url": "https://paper-api.alpaca.markets",
}


def load() -> dict:
    cfg = dict(DEFAULTS)
    path = Path(os.environ.get("SUITE_CONFIG", SUITE_DIR / "config" / "suite.json"))
    if path.exists():
        try:
            cfg.update(json.loads(path.read_text(encoding="utf-8")))
        except Exception as e:
            print(f"[SUITE] config ilegible ({path}): {e}; se usan los valores de fabrica")
    for key in DEFAULTS:
        env = os.environ.get("SUITE_" + key.upper())
        if env is not None:
            cfg[key] = int(env) if isinstance(DEFAULTS[key], int) else env
    return cfg


CONFIG = load()
