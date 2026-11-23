# mobile_events.py - Vigilante del bot para el celular y envio de avisos push (puerta movil, 21/11/2026).
#
# Cada pocos segundos lee el bot (journal de trades, estado y avisos criticos; el bot los tiene al dia por su
# WebSocket privado: no se consulta Bybit) y convierte los cambios en eventos:
#   trade_open     el bot abrio una posicion
#   trade_close    una posicion se cerro (con su P&L neto y su R)
#   critical       aviso critico del bot (posicion sin stop, orden con resultado desconocido...)
#   paused/resumed pausa o reanudacion del trading
#   bot_down/bot_up  el bot dejo de responder o volvio
# Cada evento queda en data/mobile/events.jsonl (la app los lee al abrir) y, si hay celulares con avisos, sale
# por Firebase (FCM). Solo lee: nunca envia nada al bot.
#
# Cada evento lleva "broker" (hoy siempre bybit): cuando exista el trading de Alpaca, sus eventos entran igual.
import asyncio
import json
import time
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional

POLL_SECONDS = 5
FRESH_MS = 15 * 60_000      # un cambio visto mas tarde que esto (la suite estaba cerrada) se anota sin aviso
DOWN_AFTER = 6              # lecturas fallidas seguidas (30 s) antes de avisar que el bot no responde
KEEP_EVENTS = 500
KEEP_SEEN = 3000
FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"


def now_ms() -> int:
    return int(time.time() * 1000)


def _fmt(value, digits: int = 2) -> str:
    try:
        return f"{float(value):,.{digits}f}"
    except (TypeError, ValueError):
        return "—"


def _price(value) -> str:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return "—"
    return f"{v:,.2f}" if abs(v) >= 100 else f"{v:.6g}"


def _side(side) -> str:
    return "Long" if str(side).lower() in ("buy", "long") else "Short"


def describe(kind: str, t: Dict[str, Any]) -> Dict[str, str]:
    """Titulo y texto del aviso de un trade."""
    head = f"{_side(t.get('side'))} {t.get('symbol')}"
    account = f" · {t['account']}" if t.get("account") else ""
    if kind == "trade_open":
        sl = _price(t.get("stop_loss")) if t.get("stop_loss") else "SIN STOP"
        tp = _price(t.get("take_profit")) if t.get("take_profit") else "sin TP"
        origin = " · ".join(str(x) for x in (t.get("origin"), t.get("pattern")) if x)
        return {"title": f"Abierta: {head}",
                "body": f"Entrada {_price(t.get('entry'))} · SL {sl} · TP {tp}" + (f" · {origin}" if origin else "") + account}
    pnl = t.get("pnl")
    sign = "+" if (pnl or 0) >= 0 else ""
    r = f" ({'+' if t['r'] >= 0 else ''}{t['r']:.2f} R)" if isinstance(t.get("r"), (int, float)) else ""
    approx = " ≈" if t.get("pnl_estimated") else ""
    return {"title": f"Cerrada: {head}",
            "body": f"P&L {sign}{_fmt(pnl)} USD{r}{approx} · salida {_price(t.get('exit'))}" + account}


class FcmSender:
    """Avisos por Firebase Cloud Messaging (HTTP v1). Necesita el archivo de la cuenta de servicio del proyecto de
    Firebase (mobile_fcm_credentials en config/suite.json) y el paquete google-auth. Sin ellos no envia: los eventos
    quedan igual para cuando la app abra."""

    def __init__(self, credentials_path: str, http_source: Callable[[], Any]):
        self.path = Path(credentials_path) if credentials_path else None
        self.http_source = http_source
        self._creds = None
        self._project = None
        self.error: Optional[str] = None
        self.sent = 0
        self.failed = 0
        self.last_at: Optional[int] = None

    def status(self) -> Dict[str, Any]:
        return {"configured": self.ready(), "error": self.error, "sent": self.sent, "failed": self.failed, "last_at": self.last_at}

    def ready(self) -> bool:
        if self._creds is not None:
            return True
        if not self.path:
            self.error = "sin cuenta de servicio de Firebase (mobile_fcm_credentials)"
            return False
        if not self.path.is_file():
            self.error = "no existe el archivo de la cuenta de servicio de Firebase"
            return False
        try:
            from google.oauth2 import service_account  # paquete google-auth
        except ImportError:
            self.error = "falta el paquete google-auth (pip install google-auth)"
            return False
        try:
            self._creds = service_account.Credentials.from_service_account_file(str(self.path), scopes=[FCM_SCOPE])
            self._project = json.loads(self.path.read_text(encoding="utf-8"))["project_id"]
            self.error = None
            return True
        except Exception as e:
            self.error = f"cuenta de servicio de Firebase ilegible: {type(e).__name__}"
            return False

    def _token(self) -> str:
        if not self._creds.valid:
            from google.auth.transport.requests import Request  # usa requests, que instala google-auth[requests]
            self._creds.refresh(Request())
        return self._creds.token

    async def send(self, tokens: List[str], event: Dict[str, Any]) -> List[str]:
        """Envia el evento a cada token. Devuelve los tokens que Firebase ya no reconoce."""
        if not tokens or not self.ready():
            return []
        try:
            bearer = await asyncio.to_thread(self._token)
        except Exception as e:
            self.error = f"Firebase no dio acceso: {type(e).__name__}"
            self.failed += len(tokens)
            return []
        url = f"https://fcm.googleapis.com/v1/projects/{self._project}/messages:send"
        data = {k: str(v) for k, v in {"event_id": event["id"], "type": event["type"], "trade_id": event.get("trade_id"),
                                       "symbol": event.get("symbol"), "broker": event.get("broker")}.items() if v is not None}
        dead = []
        for token in tokens:
            message = {"message": {"token": token, "notification": {"title": event["title"], "body": event["body"]}, "data": data,
                                   "android": {"priority": "high", "notification": {
                                       "channel_id": "critical" if event["type"] in ("critical", "bot_down") else "trades"}}}}
            try:
                r = await self.http_source().post(url, json=message, headers={"Authorization": f"Bearer {bearer}"}, timeout=10)
                if r.status_code == 200:
                    self.sent += 1
                    self.last_at = now_ms()
                    self.error = None
                else:
                    self.failed += 1
                    self.error = f"Firebase respondio {r.status_code}"
                    if r.status_code == 404 or "UNREGISTERED" in r.text:
                        dead.append(token)
            except Exception as e:
                self.failed += 1
                self.error = f"sin respuesta de Firebase: {type(e).__name__}"
        return dead


class EventWatch:
    def __init__(self, base_dir, bot: Callable[..., Awaitable[Any]], devices, sender=None, clock=now_ms):
        self.base = Path(base_dir)
        self.events_file = self.base / "events.jsonl"
        self.state_file = self.base / "watch_state.json"
        self.bot, self.devices, self.sender, self.clock = bot, devices, sender, clock
        self.events: List[Dict[str, Any]] = []
        self.state: Optional[Dict[str, Any]] = None
        self._task: Optional[asyncio.Task] = None
        self._counter = 0
        self._fails = 0
        self._down = False
        self.last_ok: Optional[int] = None
        self.last_error: Optional[str] = None
        self._load()

    # ---------- disco ----------
    def _load(self) -> None:
        if self.events_file.exists():
            for line in self.events_file.read_text(encoding="utf-8").splitlines()[-KEEP_EVENTS:]:
                try:
                    self.events.append(json.loads(line))
                except ValueError:
                    pass  # una linea cortada al final se ignora
        if self.state_file.exists():
            try:
                self.state = json.loads(self.state_file.read_text(encoding="utf-8"))
            except ValueError:
                self.state = None  # se toma una linea de base nueva, sin avisos

    def _save_state(self) -> None:
        self.base.mkdir(parents=True, exist_ok=True)
        tmp = self.state_file.with_name(self.state_file.name + ".tmp")
        tmp.write_text(json.dumps(self.state), encoding="utf-8")
        tmp.replace(self.state_file)

    def _emit(self, kind: str, title: str, body: str, *, at: Optional[int] = None, push: bool = True, **extra) -> Dict[str, Any]:
        now = self.clock()
        self._counter = (self._counter + 1) % 1000
        event = {"id": f"{now}-{self._counter:03d}", "type": kind, "at": at or now, "seen_at": now, "title": title, "body": body,
                 "broker": "bybit", "push": push, **{k: v for k, v in extra.items() if v is not None}}
        self.events.append(event)
        del self.events[:-KEEP_EVENTS]
        self.base.mkdir(parents=True, exist_ok=True)
        with self.events_file.open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
        return event

    def since(self, after: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
        """Eventos posteriores a un id (o los ultimos), del mas viejo al mas nuevo."""
        items = self.events
        if after:
            items = [e for e in items if e["id"] > after]
        return items[-max(1, min(limit, KEEP_EVENTS)):]

    # ---------- una vuelta ----------
    async def poll(self) -> List[Dict[str, Any]]:
        """Lee el bot una vez y devuelve los eventos nuevos (ya anotados). Los avisos salen aparte, en deliver()."""
        try:
            status, journal, critical = await asyncio.gather(
                self.bot("GET", "/api/status"), self.bot("GET", "/api/journal/trades", params={"days": 3}),
                self.bot("GET", "/api/alerts/critical", params={"limit": 20}))
        except Exception as e:
            self._fails += 1
            self.last_error = getattr(e, "detail", None) or type(e).__name__
            if self._fails == DOWN_AFTER and self.state is not None and not self._down:
                self._down = True
                return [self._emit("bot_down", "El bot no responde",
                                   "La suite lleva 30 s sin poder leer el bot. Las posiciones siguen en Bybit con su stop.")]
            return []
        new: List[Dict[str, Any]] = []
        self._fails, self.last_ok, self.last_error = 0, self.clock(), None
        if self._down:
            self._down = False
            new.append(self._emit("bot_up", "El bot volvio a responder", "La suite ya lee el bot otra vez."))

        trades = {t["trade_id"]: t for t in (journal.get("trades") or []) if isinstance(t, dict) and t.get("trade_id")}
        alerts = [json.dumps(a, sort_keys=True, default=str) for a in (critical.get("alerts") or []) if isinstance(a, dict)]
        paused = bool(status.get("trading_paused"))
        first = self.state is None
        if first:
            # Primera vez: lo que ya hay es la linea de base. Nada de eso se avisa
            self.state = {"trades": {}, "alerts": [], "paused": paused}
        seen: Dict[str, str] = self.state["trades"]
        now = self.clock()
        changed = False

        for tid, t in trades.items():
            before, status_now = seen.get(tid), t.get("status")
            if before == status_now:
                continue
            seen[tid], changed = status_now, True
            if first:
                continue
            common = {"trade_id": tid, "symbol": t.get("symbol"), "side": t.get("side"), "account": t.get("account"), "mode": t.get("mode")}
            if before is None and not t.get("pre_existing") and t.get("opened_at"):
                # Abierto (y quiza ya cerrado, si la suite no miro entre medio): la apertura se anota siempre
                fresh = now - t["opened_at"] <= FRESH_MS
                new.append(self._emit("trade_open", **describe("trade_open", t), at=t["opened_at"], push=fresh, **common))
            if status_now == "closed":
                fresh = now - (t.get("closed_at") or 0) <= FRESH_MS
                new.append(self._emit("trade_close", **describe("trade_close", t), at=t.get("closed_at"), push=fresh,
                                      pnl=t.get("pnl"), r=t.get("r"), **common))
        if len(seen) > KEEP_SEEN:  # los cerrados que el bot ya no lista (mas de 3 dias) salen
            for tid in [k for k in seen if k not in trades][: len(seen) - KEEP_SEEN]:
                del seen[tid]

        known = set(self.state["alerts"])
        for key in alerts:
            if key in known:
                continue
            self.state["alerts"].append(key)
            changed = True
            if first:
                continue
            a = json.loads(key)
            new.append(self._emit("critical", f"Aviso critico: {a.get('symbol') or 'bot'}",
                                  str(a.get("message") or a.get("type") or "Revisa el bot")[:300], symbol=a.get("symbol"),
                                  alert_type=a.get("type")))
        del self.state["alerts"][:-200]

        if not first and paused != self.state.get("paused"):
            new.append(self._emit("paused", "Trading en pausa", "El bot no abrira operaciones nuevas.") if paused
                       else self._emit("resumed", "Trading reanudado", "El bot vuelve a operar."))
        self.state["paused"] = paused
        if first or changed or new:
            self._save_state()
        return new

    async def deliver(self, events: List[Dict[str, Any]]) -> None:
        if not self.sender:
            return
        for event in events:
            if not event.get("push"):
                continue
            try:
                for token in await self.sender.send(self.devices.push_tokens(), event):
                    self.devices.drop_push_token(token)
            except Exception as e:  # un aviso que falla nunca detiene al vigilante
                self.last_error = f"aviso: {type(e).__name__}"

    async def _loop(self) -> None:
        while True:
            try:
                await self.deliver(await self.poll())
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self.last_error = f"{type(e).__name__}: {e}"[:200]
            await asyncio.sleep(POLL_SECONDS)

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    def status(self) -> Dict[str, Any]:
        return {"running": self._task is not None, "last_ok": self.last_ok, "last_error": self.last_error, "bot_down": self._down,
                "events": len(self.events), "baseline": self.state is not None,
                "push": self.sender.status() if self.sender else {"configured": False}}
