# book_reading.py - Medidas del libro de cada orden del Observador (14/11/2026).
#
# Pedido del usuario: las 9 medidas del libro que tiene el journal de la suite, tambien en el Observador de App 1.
# Usa book_measures.py de la suite (12.AltagraciaTradingSuite/server) por import, sin copiarlo, con el libro que la
# suite graba en OrderFlowData/live/book (y baja de la nube). Ese libro existe desde el 13/11/2026: una orden simulada
# en una fecha anterior queda sin estas medidas ("—"), igual que en el journal. Sin la suite o sin libro, nada cambia.
# Las medidas no anticipan nada: van a la tabla de la orden y al informe de ganadoras contra perdedoras.
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional

SUITE_SERVER = Path(__file__).resolve().parents[3] / "12.AltagraciaTradingSuite" / "server"
BOOK_SINCE_MS = 1_794_578_400_000          # 13/11/2026 14:00 UTC: antes no hay libro grabado
_module = None
_tried = False
_cache: Dict[tuple, Dict[str, Optional[float]]] = {}


def _book_measures():
    """El modulo de la suite, o None si no esta. Se agrega al final del path: los modulos de App 1 mandan."""
    global _module, _tried
    if _tried:
        return _module
    _tried = True
    if not (SUITE_SERVER / "book_measures.py").exists():
        return None
    if str(SUITE_SERVER) not in sys.path:
        sys.path.append(str(SUITE_SERVER))
    try:
        import book_measures  # noqa: E402
        _module = book_measures
    except Exception:
        _module = None
    return _module


def _data_dir() -> Path:
    if os.environ.get("ORDERFLOW_DATA"):
        return Path(os.environ["ORDERFLOW_DATA"])
    import footprint_store
    return Path(footprint_store.STORE_DIR).parent


def catalog() -> List[Dict[str, str]]:
    """Las medidas del libro para la tabla del Observador (grupo "Libro"), o [] sin la suite."""
    bm = _book_measures()
    if bm is None:
        return []
    return [{"key": key, "label": label, "group": bm.GROUP} for key, label in bm.CATALOG]


def keys() -> List[str]:
    bm = _book_measures()
    return [key for key, _ in bm.CATALOG] if bm is not None else []


def compute(trade: dict) -> Dict[str, Optional[float]]:
    """Las medidas del libro de una orden del Observador. {} sin la suite o si la orden es anterior al libro."""
    bm = _book_measures()
    at = trade.get("time")
    if bm is None or not at or int(at) < BOOK_SINCE_MS or not trade.get("symbol"):
        return {}
    key = (trade.get("id"), trade.get("status"), trade.get("fill_time"))
    if key[0] and key in _cache:
        return _cache[key]
    journal_trade = {
        "symbol": trade["symbol"], "side": "Buy" if trade.get("side") == "long" else "Sell",
        "decision": {"at": int(at)}, "entry": trade.get("entry"), "initial_stop_loss": trade.get("stop"),
        "opened_at": trade.get("fill_time"),
    }
    try:
        base = bm.book_store.sources(_data_dir())
        out = bm.compute(journal_trade, base=base)
    except Exception:
        out = {}
    if key[0]:
        if len(_cache) > 500:
            _cache.clear()
        _cache[key] = out
    return out
