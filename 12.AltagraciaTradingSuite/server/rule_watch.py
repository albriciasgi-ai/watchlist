# rule_watch.py - Reglas en vivo (24/11/2026): Impulso, FVG nuevo y B1 del probador de App 1, registradas en vivo con el
# codigo del probador y sin enviar nada. El plan, fijado antes de registrar: docs/PLAN_REGLAS_EN_VIVO.md.
#
# Al cierre de cada vela de 4 horas pide a Bybit las velas de cada moneda y suma las cerradas que faltan a lo ya visto
# (las de Bybit estan completas: si la suite estuvo cerrada, se pone al dia y el registro queda igual). Despues corre
# rule_tester.run de App 1 con cada regla, desde que arranco el registro en esa moneda (since), y anota lo nuevo:
#   - la senal, su entrada a mercado en la apertura siguiente y su salida con el R del probador;
#   - las senales que no entran por tener una posicion abierta y las que no se operan.
# Lo anotado como final no se reescribe: si al repetir la regla una orden da otro resultado, queda una revision, una vez.
# B1 usa el OI y el funding de App 1 (OrderFlowData/oi y /funding): se ponen al dia antes de evaluar y, si el dato de una
# moneda no llega al cierre de la vela, B1 de esa moneda espera.
#
#   GET  /api/rules/status   estado y, por regla, trades, R por trade y posiciones abiertas
#   GET  /api/rules/report   por regla: R con su margen por semanas, por lado y las lecturas a los 3, 6 y 12 meses
#   GET  /api/rules/log      lo anotado, lo mas nuevo primero (?record=, ?symbol=, ?limit=)
#   GET  /api/rules/config   POST /api/rules/config {"enabled": bool}
#
# Nunca envia nada. Datos en data/rules: config.json, span/{moneda}.json.gz (las velas vistas), orders/{regla}/{moneda}.json,
# log/AAAA-MM-DD.jsonl y detector.lock. SUITE_RULES=0 lo apaga; sin esa variable vale SUITE_SWING, que las pruebas ponen en 0.
import asyncio
import gzip
import json
import logging
import math
import os
import re
import threading
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

import rule_tester as rt       # App 1 (su backend esta en sys.path)
import swing_watch

logger = logging.getLogger("suite.rules")

TF = 240
STEP = TF * 60_000
DAY = 86_400_000
MONTH = 30 * DAY
WEEK = 7 * DAY
INTERVAL = "240"
WARM_BARS = 1000           # la primera vez: 166 dias de velas para el ATR, la EMA y el volumen por hora
KEEP_WARM = 900            # velas anteriores a since que se conservan
CHECK_DELAY_MS = 90_000    # tras el cierre: Bybit ya da la vela cerrada
FLOW_RETRY_MS = 10 * 60_000
LOG_MEMORY = 3000
CHECKPOINTS = (3, 6, 12)
FINAL = ("cerrada", "no entra", "no se opera", "anulada")
SYMBOL_RE = re.compile(r"^[A-Z0-9]{2,20}USDT$")
STEPS = {("esperando", "abierta"): ("entrada",), ("esperando", "cerrada"): ("entrada", "salida"),
         ("abierta", "cerrada"): ("salida",), ("esperando", "no entra"): ("no entra",),
         ("esperando", "no se opera"): ("no se opera",)}

_STOP3 = {"type": "atr", "atr": 1.5, "buffer": 0.1, "maxAtr": 6}
# Las reglas exactas del registro del usuario y de la busqueda B (docs/PLAN_REGLAS_EN_VIVO.md). No se cambian
RECORDS = {
    "impulso": {"name": "Impulso, 3R",
                "rule": {"name": "Impulso 2 ATR en 3, stop 1.5 ATR, 3R", "tf": TF, "recipe": {"slots": [{"codes": ["IM"]}]},
                         "im": {"bars": 3, "atr": 2.0}, "stop": _STOP3, "exit": {"targetR": 3}}},
    "fvg": {"name": "FVG nuevo, 3R",
            "rule": {"name": "FVG nuevo 0.3 ATR, stop 1.5 ATR, 3R", "tf": TF, "recipe": {"slots": [{"codes": ["FV"]}]},
                     "fv": {"minAtr": 0.3}, "stop": _STOP3, "exit": {"targetR": 3}}},
    "b1": {"name": "B1: FVG + volumen alto",
           "rule": {"name": "B1 (busqueda B)", "tf": TF,
                    "recipe": {"mode": "strict", "window": 2, "slots": [{"codes": ["FV"]}, {"codes": ["VH"]}]},
                    "fv": {"minAtr": 0.6}, "lines": [{"type": "ema", "period": 50, "mode": "side", "slope": True}],
                    "flow": {"oi": "noconf", "crowd": "nocon"}, "entry": {"type": "market"},
                    "stop": {"type": "atr", "atr": 1.0, "buffer": 0.1, "maxAtr": 8},
                    "exit": {"targetR": 2, "trail": "atr", "trailAtr": 4.0, "trailStart": 1.0, "horizon": 96}}},
}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _env_off() -> bool:
    return os.environ.get("SUITE_RULES", os.environ.get("SUITE_SWING", "1")) == "0"


def _iso(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if ms else None


def _day(ms) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def _price(x) -> str:
    if x is None or not isinstance(x, (int, float)) or not math.isfinite(x):
        return "-"
    size = abs(x)
    decimals = 1 if size >= 1000 else 2 if size >= 100 else max(2, min(8, 3 - int(math.floor(math.log10(size))))) if size > 0 else 2
    return f"{x:,.{decimals}f}"


def stats(trades) -> dict:
    """Trades, acierto y R por trade con su margen al 95%, con los trades agrupados por la semana de su salida (como el
    motor 6 del probador: las monedas se mueven juntas). trades: [(r, exit_t)]."""
    rows = [(float(r), int(t)) for r, t in trades if r is not None and t]
    n = len(rows)
    if not n:
        return {"n": 0}
    mean = sum(r for r, _ in rows) / n
    out = {"n": n, "wins": sum(1 for r, _ in rows if r > 0), "winRate": round(sum(1 for r, _ in rows if r > 0) / n, 4),
           "avgR": round(mean, 4), "totalR": round(sum(r for r, _ in rows), 3)}
    if n > 1:
        sd = math.sqrt(sum((r - mean) ** 2 for r, _ in rows) / (n - 1))
        groups = {}
        for r, t in rows:
            cell = groups.setdefault(t // WEEK, [0, 0.0])
            cell[0] += 1
            cell[1] += r
        se = rt.clustered_se(groups, mean, n, sd / math.sqrt(n))
        out.update(seR=round(se, 4), low=round(mean - 1.96 * se, 4), high=round(mean + 1.96 * se, 4), weeks=len(groups))
    return out


def default_symbols() -> list:
    """Las 50 monedas del probador: las 7 de siempre y las 43 nuevas."""
    return [s for s in rt.candle_symbols("all") if SYMBOL_RE.match(s)]


def refresh_flow(symbol):
    """Pone al dia el OI y el funding de una moneda en los archivos de App 1 (los que lee el filtro de B1)."""
    import flow_filters
    import funding_update
    import oi_update
    oi_update.update(symbol)   # el OI de 4 horas de Bybit: el que usa el filtro en las fechas nuevas, tambien en BTC
    with funding_update.httpx.Client(timeout=30, headers={"User-Agent": "suite-rules"}) as client:
        funding_update.update(symbol, client)
    return flow_filters


def flow_ready(symbol, bars) -> bool:
    """Si el OI y el funding llegan al cierre de la ultima vela. Una moneda sin serie de OI no espera: en el probador
    tampoco da senales con ese filtro."""
    import flow_filters
    if flow_filters.source(symbol) is None:
        return True
    oi = flow_filters.oi_at_close(symbol, bars[-3:], TF)
    funding = flow_filters.funding_3d(symbol, bars[-3:], TF)
    return bool(oi is not None and math.isfinite(float(oi[-1])) and math.isfinite(float(funding[-1])))


class RuleWatch:
    """Varias reglas de velas de 4 horas registradas en vivo sobre las mismas velas."""

    def __init__(self, folder: Path, symbols_source=None, fetch_recent=None, refresh=None, ready=None, now=None, records=None):
        self.folder = Path(folder)
        self.records = records or RECORDS
        self.rules = {rid: rt.clean_rule(rec["rule"]) for rid, rec in self.records.items()}
        for rid, rule in self.rules.items():
            if rule is None or rule["tf"] != TF:
                raise ValueError(f"la regla {rid} tiene que ser de 4 horas y con elementos conocidos")
        self._symbols_source = symbols_source or default_symbols
        self._fetch_recent = fetch_recent or swing_watch.bybit_recent
        self._refresh = refresh or refresh_flow
        self._ready = ready or flow_ready
        self._now = now or _now_ms
        self._lock = threading.RLock()
        self.config_error = None
        self.config = self._load_config()
        self._spans = {}
        self._orders = {}       # (regla, moneda) -> {clave: orden}
        self._state = {}        # moneda -> estado
        self._flow_at = {}      # moneda -> ultima puesta al dia del OI y el funding
        self._recent = deque(maxlen=LOG_MEMORY)
        self._lock_fh = None
        self._task = None
        self._wake = None
        self.other_process = False
        self.round = None
        self._symbols = None
        self._load_recent()

    def symbols(self) -> list:
        if self._symbols is None:
            self._symbols = list(self._symbols_source())
        return self._symbols

    # --- configuracion ---
    def _load_config(self) -> dict:
        path = self.folder / "config.json"
        if path.exists():
            try:
                saved = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(saved.get("enabled"), bool):
                    raise ValueError("enabled es true o false")
                return {"enabled": saved["enabled"]}
            except (ValueError, OSError, AttributeError) as e:
                self.config_error = f"config.json ilegible: {e}"[:200]
                return {"enabled": False}
        return {"enabled": True}

    def set_config(self, body: dict) -> dict:
        if not isinstance(body, dict) or set(body) - {"enabled"} or not isinstance(body.get("enabled"), bool):
            raise ValueError('la configuracion es {"enabled": true o false}: las reglas no se cambian (son las del plan)')
        swing_watch._write_atomic(self.folder / "config.json", json.dumps({"enabled": body["enabled"]}))
        self.config, self.config_error = {"enabled": body["enabled"]}, None
        if self._wake is not None:
            self._wake.set()
        return self.config

    # --- las velas vistas ---
    def _span_path(self, symbol) -> Path:
        return self.folder / "span" / f"{symbol}.json.gz"

    def _span(self, symbol):
        if symbol not in self._spans:
            path = self._span_path(symbol)
            span = None
            if path.exists():
                with gzip.open(path, "rt", encoding="utf-8") as fh:
                    raw = json.load(fh)
                span = {"since": int(raw["since"]),
                        "bars": [dict(t=int(t), o=o, h=h, l=l, c=c, delta=0.0, vol=v) for t, o, h, l, c, v in raw["bars"]]}
            self._spans[symbol] = span
        return self._spans[symbol]

    def _save_span(self, symbol, span):
        path = self._span_path(symbol)
        path.parent.mkdir(parents=True, exist_ok=True)
        raw = {"since": span["since"], "bars": [[b["t"], b["o"], b["h"], b["l"], b["c"], b["vol"]] for b in span["bars"]]}
        tmp = path.with_name(path.name + ".tmp")
        with gzip.open(tmp, "wt", encoding="utf-8") as fh:
            json.dump(raw, fh, separators=(",", ":"))
        os.replace(tmp, path)

    # --- ordenes ---
    def _orders_path(self, record, symbol) -> Path:
        return self.folder / "orders" / record / f"{symbol}.json"

    def _book(self, record, symbol) -> dict:
        key = (record, symbol)
        if key not in self._orders:
            path = self._orders_path(record, symbol)
            book = {}
            if path.exists():
                try:
                    book = {o["key"]: o for o in json.loads(path.read_text(encoding="utf-8"))}
                except (ValueError, OSError, KeyError, TypeError):
                    # Un archivo danado no se pisa: queda copiado aparte
                    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
                    path.with_name(f"{symbol}.danado-{stamp}.json").write_bytes(path.read_bytes())
            self._orders[key] = book
        return self._orders[key]

    def _save_orders(self, record, symbol):
        rows = sorted(self._book(record, symbol).values(), key=lambda o: (o["armed_at"], o["dir"]))
        swing_watch._write_atomic(self._orders_path(record, symbol), json.dumps(rows, separators=(",", ":"), ensure_ascii=False))

    def _load_all_orders(self):
        base = self.folder / "orders"
        for record in self.records:
            for path in (base / record).glob("*.json") if (base / record).is_dir() else []:
                if SYMBOL_RE.match(path.stem):
                    self._book(record, path.stem)

    # --- un solo proceso registra por carpeta ---
    def _take_lock(self) -> bool:
        if self._lock_fh is not None:
            return True
        path = self.folder / "detector.lock"
        path.parent.mkdir(parents=True, exist_ok=True)
        fh = open(path, "a+b")
        try:
            fh.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            fh.close()
            return False
        self._lock_fh = fh
        with self._lock:
            self._orders, self._spans = {}, {}
        self._load_recent()
        return True

    def _release_lock(self):
        if self._lock_fh is not None:
            try:
                if os.name == "nt":
                    import msvcrt
                    self._lock_fh.seek(0)
                    msvcrt.locking(self._lock_fh.fileno(), msvcrt.LK_UNLCK, 1)
            except OSError:
                pass
            self._lock_fh.close()
            self._lock_fh = None

    # --- una moneda ---
    async def check_symbol(self, symbol: str, now: int = None) -> bool:
        """Suma las velas cerradas que faltan, corre cada regla y anota lo que cambio. Devuelve si alguna regla quedo
        esperando el OI o el funding."""
        now = self._now() if now is None else now
        with self._lock:
            st = self._state.setdefault(symbol, {"checks": 0, "errors": 0, "error": None, "note": None})
        try:
            span = self._span(symbol)
            last = span["bars"][-1]["t"] if span and span["bars"] else None
            missing = WARM_BARS if last is None else int((now - last) // STEP) + 2
            rows = await self._fetch_recent(symbol, INTERVAL, max(3, min(1000, missing)))
            closed = [r for r in rows if r["timestamp"] + STEP <= now and r["high"] >= r["low"] > 0]
            if not closed:
                raise RuntimeError("Bybit no dio velas cerradas")
            fresh = [dict(t=int(r["timestamp"]), o=r["open"], h=r["high"], l=r["low"], c=r["close"], delta=0.0, vol=r["volume"])
                     for r in closed if last is None or r["timestamp"] > last]
            if any(b["t"] - a["t"] != STEP for a, b in zip(fresh, fresh[1:])):
                raise RuntimeError("faltan velas entre las que da Bybit: se espera a que esten todas")
            changed = False
            if span is None:
                # Arranca el registro de esta moneda: desde el cierre de su ultima vela cerrada
                span = {"since": closed[-1]["timestamp"] + STEP, "bars": fresh}
                changed = True
            elif fresh:
                if fresh[0]["t"] != last + STEP:
                    raise RuntimeError("faltan velas entre lo visto y lo que da Bybit (mas de 1,000 velas sin abrir la suite)")
                span["bars"] += fresh
                changed = True
            if changed:
                first = span["since"] - KEEP_WARM * STEP
                span["bars"] = [b for b in span["bars"] if b["t"] >= first]
                with self._lock:
                    self._spans[symbol] = span
                await run_in_threadpool(self._save_span, symbol, span)
            cut = span["bars"][-1]["t"] + STEP
            waiting = []
            for record, rule in self.rules.items():
                key = (record, symbol)
                done = st.setdefault("done", {})
                if done.get(record) == cut:
                    continue
                if rule.get("flow") and not await self._flow_ok(symbol, span["bars"], now):
                    waiting.append(record)
                    continue
                await run_in_threadpool(self._evaluate, record, symbol, span, now)
                done[record] = cut
            with self._lock:
                st.update(checks=st["checks"] + 1, last_check=now, cut=cut, since=span["since"], error=None, bars=len(span["bars"]),
                          last_close=span["bars"][-1]["c"], waiting=waiting,
                          note=f"{', '.join(waiting)}: espera el OI o el funding de esta vela" if waiting else None)
            return bool(waiting)
        except Exception as e:
            with self._lock:
                st.update(errors=st["errors"] + 1, error=f"{type(e).__name__}: {e}"[:200], last_check=now)
            logger.warning(f"[REGLAS] {symbol}: {st['error']}")
            return False

    async def _flow_ok(self, symbol, bars, now) -> bool:
        if await run_in_threadpool(self._ready, symbol, bars):
            return True
        if now - self._flow_at.get(symbol, 0) >= FLOW_RETRY_MS:
            self._flow_at[symbol] = now
            try:
                await run_in_threadpool(self._refresh, symbol)
            except Exception as e:  # sin el dato, la regla espera
                logger.warning(f"[REGLAS] {symbol}: no se pudo poner al dia el OI o el funding: {type(e).__name__}: {e}")
            return await run_in_threadpool(self._ready, symbol, bars)
        return False

    def _evaluate(self, record, symbol, span, now):
        if len(span["bars"]) < 100:
            return
        rule = self.rules[record]
        cut = span["bars"][-1]["t"] + STEP
        trace = {}
        phase = {"phase": 0, "from": _iso(span["bars"][0]["t"]), "to": _iso(cut - 1)}
        res = rt.run(symbol, rule, {"bars": span["bars"], "events": []}, phase, None, base=False, trace=trace,
                     since=span["since"], minutes=lambda *a, **k: None)
        if not res.get("success"):
            raise RuntimeError(res.get("message") or "la regla no corrio")
        self._apply(record, symbol, self._snapshot(record, symbol, res, trace), now)

    def _snapshot(self, record, symbol, res, trace) -> dict:
        """El estado de cada senal de la regla desde since, segun esta corrida."""
        T, C = trace["ctx"]["T"], trace["ctx"]["C"]
        closed = {(t["known"], t["dir"]): t for t in res["trades"]}
        opened = {(t["known"], t["dir"]): t for t in res.get("openTrades") or []}
        out = {}
        for item in trace["signals"]:
            k, side = item["k"], item["dir"]
            known = T[k] + STEP
            rec = {"key": f"{symbol}|{known}|{side}", "record": record, "symbol": symbol, "dir": side, "armed_at": known}
            what = item.get("what")
            trade = closed.get((known, side)) if what == "trade" else opened.get((known, side)) if what == "abierta al final de la fase" else None
            if trade is not None:
                rec.update(entry_t=trade["entry_t"], entry=trade["entry"], stop=trade["stop"], target=trade.get("target"), risk=trade["risk"])
                if what == "trade":
                    rec.update(status="cerrada", exit_t=trade["exit_t"], exit=trade["exit"], reason=trade["reason"], r=trade["r"],
                               gross=trade.get("gross"), bars=trade.get("bars"), mfe=trade.get("mfe"), mae=trade.get("mae"))
                else:
                    rec.update(status="abierta", last=C[-1], open_r=round((C[-1] - trade["entry"]) * side / trade["risk"], 3))
            elif what == "posición abierta":
                rec["status"] = "no entra"
            elif what == "sin vela siguiente":
                rec["status"] = "esperando"
            else:
                rec.update(status="no se opera", why=what)
            out[rec["key"]] = rec
        return out

    def _apply(self, record, symbol, snap, now):
        """Compara con lo anotado: lo nuevo y cada cambio de estado van al registro. Lo final no se reescribe."""
        events, changed = [], False
        with self._lock:
            book = self._book(record, symbol)
            for key, rec in sorted(snap.items(), key=lambda kv: kv[1]["armed_at"]):
                old = book.get(key)
                if old is None:
                    old = {k: rec[k] for k in ("key", "record", "symbol", "dir", "armed_at")}
                    old.update(status="esperando", detected={"senal": now})
                    book[key] = old
                    events.append(self._event("senal", old, old["armed_at"], now))
                    changed = True
                if rec["status"] == old["status"]:
                    if old["status"] == "abierta":
                        old.update(last=rec.get("last"), open_r=rec.get("open_r"))
                        changed = True
                    elif old["status"] == "cerrada" and rec.get("r") != old.get("r"):
                        changed = self._revise(old, rec, now, events) or changed
                    continue
                path = STEPS.get((old["status"], rec["status"]))
                if path is None:
                    changed = self._revise(old, rec, now, events) or changed
                    if old["status"] in FINAL:
                        continue          # lo anotado como final se queda: es lo que se supo en vivo
                    path = ()
                for kind in path:
                    if kind == "entrada":
                        old.update({k: rec[k] for k in ("entry_t", "entry", "stop", "target", "risk") if k in rec})
                        old["status"] = "abierta"
                    elif kind == "salida":
                        old.update({k: rec.get(k) for k in ("exit_t", "exit", "reason", "r", "gross", "bars", "mfe", "mae")})
                        old.pop("last", None)
                        old.pop("open_r", None)
                    old.setdefault("detected", {})[kind] = now
                    if kind != "entrada":
                        old["status"] = rec["status"]
                    if rec.get("why"):
                        old["why"] = rec["why"]
                    at = {"entrada": old.get("entry_t"), "salida": old.get("exit_t")}.get(kind) or now
                    events.append(self._event(kind, old, at, now))
                old["status"] = rec["status"]
                if old["status"] == "abierta":
                    old.update(last=rec.get("last"), open_r=rec.get("open_r"))
                changed = True
            # Lo anotado que ya no sale en la corrida (las velas no cambian, asi que no deberia pasar): lo que no era final se
            # anula; lo final se queda, con una revision
            for key, old in book.items():
                if key in snap or old["status"] == "anulada" or old.get("gone"):
                    continue
                if old["status"] in FINAL:
                    old["gone"] = now
                    events.append(self._revision(old, {"status": "sin señal", "r": None, "exit_t": None}, now))
                else:
                    old["status"] = "anulada"
                    old.setdefault("detected", {})["anulada"] = now
                    events.append(self._event("anulada", old, now, now))
                changed = True
            if changed:
                self._save_orders(record, symbol)
        for entry in events:
            self._append_log(entry)

    def _revise(self, old, rec, now, events) -> bool:
        """La misma diferencia se anota una sola vez (lo final se queda, asi que volveria a salir en cada vela)."""
        mark = [rec.get("status"), rec.get("r"), rec.get("exit_t")]
        if old.get("revised") == mark:
            return False
        old["revised"] = mark
        events.append(self._revision(old, rec, now))
        return True

    def _event(self, kind, rec, at, now) -> dict:
        return {"type": kind, "record": rec["record"], "symbol": rec["symbol"], "key": rec["key"], "dir": rec["dir"], "at": int(at),
                "detected_at": now, "status": rec["status"], "r": rec.get("r") if kind == "salida" else None,
                "text": describe(kind, rec, self.records[rec["record"]]["name"])}

    def _revision(self, old, rec, now) -> dict:
        return {"type": "revision", "record": old["record"], "symbol": old["symbol"], "key": old["key"], "dir": old["dir"], "at": now,
                "detected_at": now, "status": old["status"], "was": {k: old.get(k) for k in ("status", "r", "exit_t")},
                "now": {k: rec.get(k) for k in ("status", "r", "exit_t")},
                "text": f"Revision: {old['status']} → {rec['status']} (lo anotado se queda)"}

    # --- registro ---
    def _append_log(self, entry: dict):
        path = self.folder / "log" / f"{_day(entry['detected_at'])}.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False, separators=(",", ":")) + "\n")
        with self._lock:
            self._recent.append(entry)

    def _load_recent(self):
        folder = self.folder / "log"
        found = []
        for path in sorted(folder.glob("*.jsonl"))[-10:] if folder.is_dir() else []:
            try:
                for line in path.read_text(encoding="utf-8").splitlines():
                    if line.strip():
                        found.append(json.loads(line))
            except (ValueError, OSError):
                continue
        with self._lock:
            self._recent.clear()
            self._recent.extend(found[-LOG_MEMORY:])

    def log(self, record=None, symbol=None, limit=200) -> list:
        with self._lock:
            entries = list(self._recent)
        entries = [x for x in entries if record in (None, x.get("record")) and symbol in (None, x.get("symbol"))]
        entries.sort(key=lambda x: (x.get("detected_at") or 0, x.get("at") or 0), reverse=True)
        return entries[:max(1, min(int(limit), 5000))]

    # --- lectura ---
    def orders(self, record=None, symbol=None) -> list:
        with self._lock:
            return [dict(o) for (r, s), book in self._orders.items() if record in (None, r) and symbol in (None, s) for o in book.values()]

    def since(self):
        with self._lock:
            found = [span["since"] for span in self._spans.values() if span]
        return min(found) if found else None

    def report(self, now: int = None) -> dict:
        now = self._now() if now is None else now
        since = self.since()
        out = {"success": True, "sends": False, "since": since, "now": now, "symbols": len(self.symbols()), "records": {},
               "plan": "docs/PLAN_REGLAS_EN_VIVO.md"}
        for record, info in self.records.items():
            rows = self.orders(record)
            closed = sorted((o for o in rows if o["status"] == "cerrada"), key=lambda o: o["exit_t"])
            counts = {}
            for o in rows:
                counts[o["status"]] = counts.get(o["status"], 0) + 1
            entry = {"name": info["name"], "counts": counts, "book": stats((o["r"], o["exit_t"]) for o in closed),
                     "coins": len({o["symbol"] for o in closed}),
                     "bySide": {name: stats((o["r"], o["exit_t"]) for o in closed if o["dir"] == d) for name, d in (("largos", 1), ("cortos", -1))}}
            marks = []
            for months in CHECKPOINTS:
                at = since + months * MONTH if since else None
                mark = {"months": months, "at": at, "due": bool(at and at <= now)}
                if mark["due"]:
                    s = stats((o["r"], o["exit_t"]) for o in closed if o["exit_t"] <= at)
                    mark["stats"] = s
                    low, high = s.get("low"), s.get("high")
                    if months < 12:
                        mark["verdict"] = "descartada" if high is not None and high < 0 else "sigue"
                    else:
                        mark["verdict"] = "pasa" if low is not None and low > 0 else "no pasa"
                marks.append(mark)
            entry["checkpoints"] = marks
            out["records"][record] = entry
        return out

    def status(self) -> dict:
        with self._lock:
            states = {s: dict(st) for s, st in self._state.items()}
        records = {}
        for record, info in self.records.items():
            rows = self.orders(record)
            records[record] = {"name": info["name"], "closed": sum(1 for o in rows if o["status"] == "cerrada"),
                               "open": sorted((o for o in rows if o["status"] == "abierta"), key=lambda o: o.get("entry_t") or 0)}
        errors = {s: st["error"] for s, st in states.items() if st.get("error")}
        waiting = {s: st["waiting"] for s, st in states.items() if st.get("waiting")}
        return {"success": True, "sends": False, "enabled": self.config["enabled"], "env_off": _env_off(),
                "detecting": bool(self._task is not None and self._lock_fh is not None and self.config["enabled"]),
                "other_process": self.other_process, "tf": "4h", "symbols": len(self.symbols()), "checked": len(states),
                "since": self.since(), "round": self.round, "config_error": self.config_error, "records": records,
                "errors": errors, "waiting": waiting, "plan": "docs/PLAN_REGLAS_EN_VIVO.md"}

    def brief(self) -> dict:
        rows = self.orders()
        with self._lock:
            errors = sum(1 for st in self._state.values() if st.get("error"))
        return {"detecting": bool(self._task is not None and self._lock_fh is not None and self.config["enabled"]),
                "enabled": self.config["enabled"], "closed": sum(1 for o in rows if o["status"] == "cerrada"),
                "open": sum(1 for o in rows if o["status"] == "abierta"), "errors": errors, "other_process": self.other_process}

    # --- bucle ---
    async def start(self):
        if _env_off() or self._task is not None:
            return
        self._wake = asyncio.Event()
        self.other_process = not self._take_lock()
        self._task = asyncio.create_task(self._run())

    async def stop(self):
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None
        self._release_lock()

    async def _run(self):
        first = True
        retry_at = None
        while True:
            try:
                now = self._now()
                # Al arrancar, enseguida (pone al dia lo que paso con la suite cerrada). Despues, tras cada cierre de 4 horas,
                # o antes si alguna regla quedo esperando el OI o el funding
                wake_at = now + 20_000 if first else (now - CHECK_DELAY_MS) // STEP * STEP + STEP + CHECK_DELAY_MS
                if retry_at is not None:
                    wake_at = min(wake_at, retry_at)
                first = False
                try:
                    await asyncio.wait_for(self._wake.wait(), timeout=max(0.05, (wake_at - now) / 1000))
                    self._wake.clear()
                except asyncio.TimeoutError:
                    pass
                if not self._take_lock():
                    self.other_process = True
                    continue
                self.other_process = False
                if self.config["enabled"]:
                    behind = await self.check_all()
                    retry_at = self._now() + FLOW_RETRY_MS if behind else None
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(f"[REGLAS] vuelta fallida: {e}")
                await asyncio.sleep(5)

    async def check_all(self) -> list:
        began = time.time()
        self._load_all_orders()
        behind = []
        for symbol in self.symbols():
            if await self.check_symbol(symbol):
                behind.append(symbol)
        self.round = {"at": self._now(), "seconds": round(time.time() - began, 2), "symbols": len(self.symbols()), "behind": len(behind)}
        return behind


def _when(ms) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%d/%m %H:%M")


def describe(kind, o, name="") -> str:
    """El evento de una orden en una linea, para el panel."""
    what = "compra" if o["dir"] > 0 else "venta"
    head = f"{name}: {what}"
    if kind in ("senal", "esperando"):
        return f"{head}, señal al cierre de las {_when(o['armed_at'])} UTC; entra en la apertura siguiente"
    if kind in ("entrada", "abierta"):
        return f"{head} en {_price(o.get('entry'))} · stop {_price(o.get('stop'))} · objetivo {_price(o.get('target'))}"
    if kind in ("salida", "cerrada"):
        r = o.get("r")
        return f"{head}: salio por {o.get('reason', '?')} en {_price(o.get('exit'))}" + (f" · {r:+.2f} R" if r is not None else "")
    if kind == "no entra":
        return f"{head} · ya habia una posicion abierta: no cuenta"
    if kind == "no se opera":
        return f"{head} · no se opera ({o.get('why')})"
    if kind == "anulada":
        return f"{head} · anulada"
    return head


def make_router(watch: RuleWatch, prefix: str = "/api/rules") -> APIRouter:
    router = APIRouter()

    @router.get(f"{prefix}/status")
    async def rules_status():
        return watch.status()

    @router.get(f"{prefix}/report")
    async def rules_report():
        return watch.report()

    @router.get(f"{prefix}/config")
    async def rules_config():
        return {"success": True, "config": watch.config, "sends": False,
                "records": {rid: {"name": rec["name"], "rule": rec["rule"]} for rid, rec in watch.records.items()}}

    @router.post(f"{prefix}/config")
    async def rules_set_config(request: Request):
        try:
            body = await request.json()
        except ValueError:
            raise HTTPException(400, "el cuerpo debe ser JSON")
        try:
            return {"success": True, "config": watch.set_config(body)}
        except ValueError as e:
            raise HTTPException(400, str(e))

    @router.get(f"{prefix}/log")
    async def rules_log(record: str = None, symbol: str = None, limit: int = 200):
        if record is not None and record not in watch.records:
            raise HTTPException(400, "regla desconocida")
        if symbol is not None and not SYMBOL_RE.match(symbol):
            raise HTTPException(400, "moneda invalida")
        return {"success": True, "events": watch.log(record, symbol, limit)}

    return router
