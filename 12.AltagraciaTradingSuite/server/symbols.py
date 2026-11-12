# symbols.py - Monedas de la suite: las de fabrica mas las que el usuario agrega desde la pagina.
# Se guardan en data/symbols.json (con temporal y reemplazo). Una moneda nueva se comprueba en Bybit
# (perpetuo lineal en USDT que cotiza) antes de agregarla.
import json
import os
import re
from pathlib import Path

DEFAULT_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT", "TRXUSDT", "PAXGUSDT", "GALAUSDT", "SUIUSDT", "TRBUSDT",
    "DOGEUSDT", "AAVEUSDT", "AVAXUSDT", "ARBUSDT", "BNBUSDT", "INJUSDT", "KASUSDT", "SHIB1000USDT", "UNIUSDT", "LPTUSDT",
]
SYMBOL_RE = re.compile(r"^[A-Z0-9]{2,20}USDT$")
MAX_SYMBOLS = 60


class SymbolList:
    def __init__(self, data_dir: Path):
        self.path = Path(data_dir) / "symbols.json"

    def load(self) -> list:
        if not self.path.exists():
            return list(DEFAULT_SYMBOLS)
        data = json.loads(self.path.read_text(encoding="utf-8"))  # un archivo danado es un error, no una lista vacia
        symbols = [s for s in data.get("symbols", []) if isinstance(s, str) and SYMBOL_RE.match(s)]
        return symbols or list(DEFAULT_SYMBOLS)

    def save(self, symbols: list):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"symbols": symbols}, indent=1), encoding="utf-8")
        os.replace(tmp, self.path)

    def add(self, symbol: str) -> list:
        symbols = self.load()
        if symbol not in symbols:
            if len(symbols) >= MAX_SYMBOLS:
                raise ValueError(f"maximo {MAX_SYMBOLS} monedas")
            symbols.append(symbol)
            self.save(symbols)
        return symbols

    def remove(self, symbol: str) -> list:
        symbols = [s for s in self.load() if s != symbol]
        if not symbols:
            raise ValueError("debe quedar al menos una moneda")
        self.save(symbols)
        return symbols
