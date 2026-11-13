"""
trade_journal.py - Journal de trades reales del bot (paso 4 de la integracion, 12/11/2026).

El usuario pidio que el journal de la app en tiempo real sea el Observador de App 1 con trades reales. Esta es la
base: los hechos de cada trade, tomados de Bybit, para que la suite los muestre y les sume analisis.

- Apertura: la ve el WebSocket privado (posicion nueva): moneda, lado, tamano, entrada, SL y TP, apalancamiento,
  cuenta y origen (la orden del historial del bot que la abrio: Swing, panel, etc.; si no hay, "externa").
- Cierre: el P&L cerrado de Bybit (/v5/position/closed-pnl): cantidad, entrada y salida promedio y resultado neto
  (con comisiones). Un trade puede tener varios cierres parciales.
- Notas del usuario.

Archivo de eventos que solo se agregan (JSONL): una linea cortada a mitad por un apagon se salta al leer, y nada
se reescribe. Los trades se arman al pedirlos.
"""
import json
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

TRADE_ID_RE = re.compile(r"^[A-Za-z0-9:._-]{1,160}$")


def _num(value) -> Optional[float]:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if f == f else None


def _price(value) -> Optional[float]:
    f = _num(value)
    return f if f and f > 0 else None


def now_ms() -> int:
    return int(time.time() * 1000)


class TradeJournal:
    def __init__(self, path: Path):
        self.path = Path(path)
        self._events: Optional[List[Dict[str, Any]]] = None
        self._close_ids: set = set()

    # ---------- archivo ----------
    def _load(self) -> List[Dict[str, Any]]:
        if self._events is None:
            events = []
            if self.path.exists():
                for line in self.path.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        event = json.loads(line)
                    except ValueError:
                        continue  # linea cortada por un apagon: se salta, no tumba el journal
                    if isinstance(event, dict) and event.get("type"):
                        events.append(event)
            self._events = events
            self._close_ids = {e.get("close_id") for e in events if e.get("type") == "close"}
        return self._events

    def _append(self, event: Dict[str, Any]) -> None:
        self._load()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
            f.flush()
        self._events.append(event)

    # ---------- apertura ----------
    def open_trades(self, symbol: str, side: str, account: Optional[str]) -> List[Dict[str, Any]]:
        """Trades abiertos (con cantidad sin cerrar) de esa moneda, lado y cuenta, mas nuevos primero."""
        built = self._build()
        return sorted([t for t in built.values() if t["status"] == "open" and t["symbol"] == symbol and t["side"] == side
                       and t.get("account_id") == account and t.get("opened_at")],
                      key=lambda t: t["opened_at"], reverse=True)

    def record_open(self, p: Dict[str, Any], *, origin: Optional[str], source: Optional[str], pattern: Optional[str],
                    account: Optional[Dict[str, Any]], pre_existing: bool, at: Optional[int] = None,
                    order_id: Optional[str] = None, order_link_id: Optional[str] = None) -> str:
        """order_id / order_link_id: la orden de Bybit que abrio la posicion (su ejecucion), si se sabe."""
        opened_at = at or now_ms()
        trade_id = f"{p.get('symbol')}-{p.get('side')}-{opened_at}"
        self._append({
            "type": "open", "trade_id": trade_id, "symbol": p.get("symbol"), "side": p.get("side"),
            "size": _num(p.get("size")), "entry": _price(p.get("entryPrice")), "stop_loss": _price(p.get("stopLoss")),
            "take_profit": _price(p.get("takeProfit")), "leverage": _num(p.get("leverage")), "position_idx": p.get("positionIdx"),
            "opened_at": opened_at, "pre_existing": bool(pre_existing),
            "origin": origin or ("anterior" if pre_existing else "externa"), "source": source, "pattern": pattern,
            "account_id": (account or {}).get("id"), "account": (account or {}).get("name"), "mode": (account or {}).get("mode"),
            "open_order_id": order_id or None, "open_order_link_id": order_link_id or None,
        })
        return trade_id

    def record_link(self, trade_id: str, link: Dict[str, Any]) -> bool:
        """
        La orden que abrio el trade, sabida despues de anotar la apertura: la ejecucion llego por el WebSocket
        despues que la posicion. Trae el origen si la orden es del bot (una Limit del panel llenada mas tarde).
        """
        data = {k: link.get(k) for k in ("origin", "source", "pattern", "order_id", "order_link_id", "exact") if link.get(k)}
        if not any(k in data for k in ("origin", "order_id", "order_link_id")):
            return False
        self._append({"type": "link", "trade_id": trade_id, "at": now_ms(), **data})
        return True

    @staticmethod
    def snapshot(p: Dict[str, Any]) -> Dict[str, Any]:
        """Lo que se sigue de una posicion abierta para anotar sus cambios."""
        return {"size": _num(p.get("size")), "entry": _price(p.get("entryPrice")),
                "stop_loss": _price(p.get("stopLoss")), "take_profit": _price(p.get("takeProfit"))}

    def record_update(self, trade_id: str, p: Dict[str, Any], last: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """SL, TP, tamano o entrada distintos de lo ultimo anotado: se agrega un cambio. Devuelve lo anotado."""
        now = self.snapshot(p)
        changed = {k: v for k, v in now.items() if v != last.get(k)}
        if not changed:
            return None
        self._append({"type": "update", "trade_id": trade_id, "at": now_ms(), **changed})
        return now

    # ---------- cierre ----------
    def record_close(self, row: Dict[str, Any], account: Optional[Dict[str, Any]]) -> bool:
        """Un registro de /v5/position/closed-pnl. Su `side` es el de la orden que cerro: la posicion es la contraria."""
        close_id = f"{row.get('orderId')}:{row.get('updatedTime')}"
        self._load()
        if close_id in self._close_ids:
            return False
        side = "Sell" if row.get("side") == "Buy" else "Buy"
        closed_at = int(_num(row.get("updatedTime")) or now_ms())
        account_id = (account or {}).get("id")
        trade_id = None
        for t in self.open_trades(row.get("symbol"), side, account_id):
            if t["opened_at"] <= closed_at + 5000:
                trade_id = t["trade_id"]
                break
        self._append({
            "type": "close", "close_id": close_id, "trade_id": trade_id, "symbol": row.get("symbol"), "side": side,
            "qty": _num(row.get("closedSize")) or _num(row.get("qty")), "entry": _price(row.get("avgEntryPrice")),
            "exit": _price(row.get("avgExitPrice")), "pnl": _num(row.get("closedPnl")), "order_type": row.get("orderType"),
            "exec_type": row.get("execType"), "fills": _num(row.get("fillCount")), "leverage": _num(row.get("leverage")),
            "closed_at": closed_at, "account_id": account_id, "account": (account or {}).get("name"),
        })
        self._close_ids.add(close_id)
        return True

    # ---------- notas ----------
    def exists(self, trade_id: str) -> bool:
        return trade_id in self._build()

    def add_note(self, trade_id: str, text: str) -> None:
        self._append({"type": "note", "trade_id": trade_id, "text": text, "at": now_ms()})

    # ---------- lectura ----------
    def _build(self) -> Dict[str, Dict[str, Any]]:
        trades: Dict[str, Dict[str, Any]] = {}
        events = self._load()
        for e in events:
            if e["type"] == "open":
                trades[e["trade_id"]] = {
                    **{k: e.get(k) for k in ("trade_id", "symbol", "side", "size", "entry", "stop_loss", "take_profit", "leverage",
                                            "opened_at", "pre_existing", "origin", "source", "pattern", "account_id", "account", "mode",
                                            "open_order_id", "open_order_link_id")},
                    "initial_stop_loss": e.get("stop_loss"), "initial_take_profit": e.get("take_profit"),
                    "closes": [], "notes": [], "changes": [],
                }
        for e in events:
            t = trades.get(e.get("trade_id") or "")
            if e["type"] == "link" and t:
                # La orden que abrio el trade. Su origen reemplaza a "externa" (no se sabia cual era) y, si salio de
                # esa misma orden (exact), tambien al de la regla de los 10 minutos, que pudo tomar otra orden
                if e.get("order_id"):
                    t["open_order_id"] = e["order_id"]
                if e.get("order_link_id"):
                    t["open_order_link_id"] = e["order_link_id"]
                if e.get("origin") and (e.get("exact") or t.get("origin") == "externa"):
                    t["origin"], t["source"], t["pattern"] = e["origin"], e.get("source"), e.get("pattern")
            elif e["type"] == "update" and t:
                for key in ("size", "entry", "stop_loss", "take_profit"):
                    if key in e:
                        t[key] = e[key]
                if t["initial_stop_loss"] is None and e.get("stop_loss"):
                    t["initial_stop_loss"] = e["stop_loss"]  # el SL secuencial llega uno o dos segundos despues
                if t["initial_take_profit"] is None and e.get("take_profit"):
                    t["initial_take_profit"] = e["take_profit"]
                t["changes"].append({k: e[k] for k in e if k not in ("type", "trade_id")})
            elif e["type"] == "close":
                if not t:
                    # Cierre sin apertura anotada (abierto antes del journal o con el bot apagado)
                    tid = f"close:{e['close_id']}"
                    t = trades[tid] = {
                        "trade_id": tid, "symbol": e.get("symbol"), "side": e.get("side"), "size": e.get("qty"), "entry": e.get("entry"),
                        "stop_loss": None, "take_profit": None, "leverage": e.get("leverage"), "opened_at": None, "pre_existing": True,
                        "origin": "sin apertura", "source": None, "pattern": None, "account_id": e.get("account_id"),
                        "account": e.get("account"), "mode": None, "initial_stop_loss": None, "initial_take_profit": None,
                        "closes": [], "notes": [], "changes": [],
                    }
                t["closes"].append({k: e.get(k) for k in ("close_id", "qty", "entry", "exit", "pnl", "order_type", "exec_type", "fills", "closed_at")})
            elif e["type"] == "note":
                t = trades.get(e.get("trade_id") or "")
                if t:
                    t["notes"].append({"text": e.get("text"), "at": e.get("at")})
        for t in trades.values():
            closes = t["closes"]
            closed_qty = sum(c.get("qty") or 0 for c in closes)
            size = t.get("size") or 0
            t["closed_qty"] = closed_qty
            t["status"] = "closed" if closes and closed_qty >= size * 0.999 else "open"
            t["pnl"] = round(sum(c.get("pnl") or 0 for c in closes), 6) if closes else None
            t["exit"] = (sum((c.get("exit") or 0) * (c.get("qty") or 0) for c in closes) / closed_qty) if closed_qty else None
            t["closed_at"] = max((c.get("closed_at") or 0) for c in closes) if closes else None
            if t.get("entry") is None and closes:
                t["entry"] = closes[0].get("entry")
            start = t.get("opened_at")
            # De una posicion "anterior" solo se sabe cuando la vio el bot, no cuando abrio: sin duracion
            t["duration_min"] = (round((t["closed_at"] - start) / 60000, 1)
                                 if t["closed_at"] and start and not t.get("pre_existing") else None)
            # R: resultado neto sobre lo que se arriesgaba con el SL inicial (si lo hubo), por la cantidad cerrada
            sl, entry = t.get("initial_stop_loss"), t.get("entry")
            risk = abs(entry - sl) * closed_qty if sl and entry and closed_qty else None
            t["risk"] = round(risk, 6) if risk else None
            t["r"] = round(t["pnl"] / risk, 3) if risk and t["pnl"] is not None else None
        return trades

    def trades(self, days: int = 30, symbol: Optional[str] = None, account: Optional[str] = None) -> List[Dict[str, Any]]:
        since = now_ms() - days * 86400000
        out = []
        for t in self._build().values():
            last = t.get("closed_at") or t.get("opened_at") or 0
            if t["status"] == "closed" and last < since:
                continue
            if symbol and t["symbol"] != symbol:
                continue
            if account and t.get("account_id") != account:
                continue
            out.append(t)
        return sorted(out, key=lambda t: (t["status"] != "open", -(t.get("closed_at") or t.get("opened_at") or 0)))
