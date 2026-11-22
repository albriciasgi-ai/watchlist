# dx_watch.py - DX en vivo (22/11/2026): la hipotesis de los apilados desplazados de Trader Dale, registrada en vivo con
# la regla y el codigo del probador de App 1, sin enviar nada. Es el paso 4 de docs/PLAN_ESTRATEGIAS_BYKO_DALE.md
# ("DX en vivo", fijado antes de registrar).
#
# Al cierre de cada vela de 30 minutos, cuando el almacen en vivo ya la tiene, pide a of_elements de App 1 (live=True) las
# velas y los desequilibrios apilados nuevos de cada moneda y los suma a lo ya visto. Cada vela se guarda tal como se vio
# y no se vuelve a calcular: el registro es lo que se sabia en ese momento. Despues corre rule_tester.run de App 1 con la
# regla DX de las fases 2 y 3, desde que arranco el registro en esa moneda (since), y anota lo nuevo. Desde since no se salta
# ninguna vela: una que todavia no esta completa (toca un hueco de la grabacion, como el que deja un reinicio de la suite, o
# pasa del ultimo guardado) se espera hasta que la nube o el dia oficial la completen, y las siguientes esperan con ella:
#   - la orden armada (limit, stop, objetivo y hasta cuando vale);
#   - su entrada y su salida, con el R de la cuenta del probador (entrada maker, salidas taker);
#   - las que vencen sin llenarse, las que se llenan con otra posicion abierta y las que no se operan.
# Con la cinta (OrderFlowData/tape o live/tape) mide la ejecucion: cuando se lleno la limit y, en cada salida, el precio de
# una orden a mercado disparada en el nivel: el peor entre el primer trade que lo toca y el promedio, pesado por cantidad,
# de los trades a mercado del lado de la salida en los 100 ms siguientes. Con ese precio, el R con la ejecucion medida.
#
#   GET  /api/dx/status   estado del registro y, por moneda, las ordenes que esperan y la posicion abierta
#   GET  /api/dx/report   trades, R por trade con su margen (cuenta del probador y ejecucion medida), por moneda y lado,
#                         deslizamiento y las lecturas a los 3, 6 y 12 meses del plan
#   GET  /api/dx/log      lo anotado, lo mas nuevo primero (?symbol=, ?limit=, ?day=AAAA-MM-DD)
#   GET  /api/dx/config   POST /api/dx/config {"enabled": bool}
#
# Nunca envia nada: ni al bot ni a otro lado. Datos en data/dx: config.json, span/{moneda}.json.gz (lo visto),
# orders/{moneda}.json (cada orden con su estado), log/AAAA-MM-DD.jsonl y detector.lock (un solo proceso registra por
# carpeta). SUITE_DX=0 lo apaga; sin esa variable vale SUITE_SWING, que las pruebas ponen en 0. Las rutas siguen.
import asyncio
import gzip
import importlib.util
import json
import logging
import math
import os
import re
import threading
import time
from collections import OrderedDict, deque
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

import footprint_store as fs   # App 1 (su backend esta en sys.path)
import of_elements as oe       # App 1
import rule_tester as rt       # App 1
import swing_watch

logger = logging.getLogger("suite.dx")

TF = 30
STEP = TF * 60_000
DAY = 86_400_000
MONTH = 30 * DAY
# Las 7 monedas con almacen de trades de la hipotesis (las del plan)
SYMBOLS = ("BTCUSDT", "ETHUSDT", "SOLUSDT", "ARBUSDT", "GALAUSDT", "SUIUSDT", "XRPUSDT")
# La regla de las fases 2 y 3, la de OrderFlowData/research/dale/2026-11-22/dx.py, sin cambiar nada
RULE_RAW = {"name": "Dale: apilados desplazados con regreso 30m", "tf": TF,
            "recipe": {"slots": [{"codes": ["DX"]}], "mode": "strict", "window": 1},
            "entry": {"type": "limit", "at": "near", "expiry": 200}, "stop": {"type": "zone", "buffer": 0, "maxAtr": 20},
            "exit": {"targetR": 2}, "oneAtATime": True, "cooldown": 0, "volFilter": 0}
RULE = rt.clean_rule(RULE_RAW)
WARM_DAYS = 20             # velas antes del arranque: el ATR diario de 14 dias y zonas que nacen hasta 200 velas antes
CHECK_DELAY_MS = 75_000    # tras el cierre: el almacen en vivo se arma cada minuto
RETRY_MS = 30_000          # si el almacen va detras, se vuelve a mirar
MAX_WAIT_MS = 10 * 60_000  # y hasta aqui; despues, en la vuelta siguiente
# Una vela que en dos dias no se completa (ni la nube ni el dia oficial la traen) se salta, con un evento "hueco" en el
# registro. El 22/11, el reinicio de la suite dejo 65 s sin grabar, y la vela de las 21:00 UTC se salto sin esperar
MISSING_MAX_MS = 2 * DAY
CHUNK_DAYS = 60            # of_elements no acepta mas de 70 dias por pedido
LOG_MEMORY = 2000
# La orden a mercado: el peor entre el trade del disparo y el promedio de los trades del lado de la salida en los 100 ms
# siguientes. Con medio segundo, en una mecha de BTC del 15/11 (960 trades, de 65,549 a 65,417) el promedio tomaba precios
# de despues de la vuelta, que una orden a mercado no consigue: 13 de 89 stops salian a favor
FILL_MS = 100
CROSS_MS = 60_000          # una limit en el objetivo se llena si el precio lo pasa en el minuto siguiente
CHECKPOINTS = (3, 6, 12)   # lecturas del plan, en meses
NEAR_PENDING = 3           # ordenes que esperan que muestra el estado por moneda: las mas cerca del precio
ZONE_PENDING = 2           # y las que van a la defensa de zona, de cada lado
FINAL = ("cerrada", "vencida", "no entra", "no se opera", "anulada")
ARM_FIELDS = ("key", "symbol", "dir", "armed_at", "born", "zone", "stop_day", "shift_atr", "limit", "stop", "risk", "target",
              "expires_at", "order")
SYMBOL_RE = re.compile(r"^[A-Z0-9]{2,20}USDT$")
STEPS = {  # eventos que llevan de un estado al otro; lo que no esta aqui es una revision
    ("esperando", "abierta"): ("entrada",), ("esperando", "cerrada"): ("entrada", "salida"),
    ("abierta", "cerrada"): ("salida",), ("esperando", "vencida"): ("vencida",),
    ("esperando", "no entra"): ("no entra",), ("esperando", "no se opera"): ("no se opera",),
}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _env_off() -> bool:
    return os.environ.get("SUITE_DX", os.environ.get("SUITE_SWING", "1")) == "0"


def _iso(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if ms else None


def _day(ms) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def _price(x) -> str:
    """Un precio con los decimales que pide su tamano (como wise_smc_watch)."""
    if x is None or not isinstance(x, (int, float)) or not math.isfinite(x):
        return "-"
    size = abs(x)
    decimals = 1 if size >= 1000 else 2 if size >= 100 else max(2, min(8, 3 - int(math.floor(math.log10(size))))) if size > 0 else 2
    return f"{x:,.{decimals}f}"


def stats(values) -> dict:
    """Trades, acierto, R por trade y su margen al 95% (como el probador: media +- 1.96 errores estandar)."""
    v = [float(x) for x in values if x is not None]
    n = len(v)
    if not n:
        return {"n": 0}
    mean = sum(v) / n
    sd = math.sqrt(sum((x - mean) ** 2 for x in v) / (n - 1)) if n > 1 else 0.0
    se = sd / math.sqrt(n) if n > 1 else None
    out = {"n": n, "wins": sum(1 for x in v if x > 0), "winRate": round(sum(1 for x in v if x > 0) / n, 4),
           "avgR": round(mean, 4), "totalR": round(sum(v), 3)}
    if se is not None:
        out.update(seR=round(se, 4), low=round(mean - 1.96 * se, 4), high=round(mean + 1.96 * se, 4))
    return out


def _detect_live(symbol, start, end, known_until, rule=RULE):
    """Velas y elementos de of_elements de App 1, con los dias oficiales y, donde faltan, la nube y el PC."""
    return oe.detect(symbol, TF, start, end - 1, known_until, rule["target"], 0, rule["volFilter"], live=True)


def _minutes_live(symbol, start_min, end_min):
    return fs.minutes(symbol, start_min, end_min, live=True)


class DxWatch:
    """Un registro en vivo de una regla de 30 minutos con los apilados del almacen. Hoy, DX tal cual; una version
    refinada (otra hipotesis, fijada antes) seria otro registro con su regla y su carpeta, sin tocar este."""

    def __init__(self, folder: Path, data_dir: Path, store_until=None, detect=None, minutes=None, read_tape=None,
                 now=None, symbols=SYMBOLS, rule_raw=RULE_RAW):
        self.folder = Path(folder)
        self.data = Path(data_dir)
        self.symbols = list(symbols)
        self.rule_raw = rule_raw
        self.rule = rt.clean_rule(rule_raw)
        if self.rule["tf"] != TF:
            raise ValueError("el registro en vivo es de reglas de 30 minutos")
        self._store_until = store_until
        self._detect = detect or (lambda symbol, start, end, known_until: _detect_live(symbol, start, end, known_until, self.rule))
        self._minutes = minutes or _minutes_live
        self._read_tape = read_tape
        self._now = now or _now_ms
        self._lock = threading.RLock()
        self.config_error = None
        self.config = self._load_config()
        self._spans = {}
        self._orders = {s: self._load_orders(s) for s in self.symbols}
        self._state = {}
        self._tapes = OrderedDict()
        self._recent = deque(maxlen=LOG_MEMORY)
        self._lock_fh = None
        self._task = None
        self._wake = None
        self.other_process = False
        self.round = None
        self._load_recent()

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
            raise ValueError('la configuracion es {"enabled": true o false}: la regla no se cambia (es la del plan)')
        swing_watch._write_atomic(self.folder / "config.json", json.dumps({"enabled": body["enabled"]}))
        self.config, self.config_error = {"enabled": body["enabled"]}, None
        if self._wake is not None:
            self._wake.set()
        return self.config

    # --- lo visto ---
    def _span_path(self, symbol) -> Path:
        return self.folder / "span" / f"{symbol}.json.gz"

    def _load_span(self, symbol):
        path = self._span_path(symbol)
        if not path.exists():
            return None
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            raw = json.load(fh)
        return {"since": int(raw["since"]), "cut": int(raw["cut"]), "first_check": raw.get("first_check"),
                "bars": [dict(t=int(t), o=o, h=h, l=l, c=c, delta=d, vol=v) for t, o, h, l, c, d, v in raw["bars"]],
                "events": [dict(code=code, dir=int(d), t=int(t), known=int(k), lo=lo, hi=hi) for code, d, t, k, lo, hi in raw["events"]],
                "skipped": [int(t) for t in raw.get("skipped") or []]}

    def _save_span(self, symbol, span):
        path = self._span_path(symbol)
        path.parent.mkdir(parents=True, exist_ok=True)
        raw = {"since": span["since"], "cut": span["cut"], "first_check": span.get("first_check"),
               "bars": [[b["t"], b["o"], b["h"], b["l"], b["c"], b["delta"], b["vol"]] for b in span["bars"]],
               "events": [[e["code"], e["dir"], e["t"], e["known"], e["lo"], e["hi"]] for e in span["events"]],
               "skipped": span.get("skipped") or []}
        tmp = path.with_name(path.name + ".tmp")
        with gzip.open(tmp, "wt", encoding="utf-8") as fh:
            json.dump(raw, fh, separators=(",", ":"))
        os.replace(tmp, path)

    def _span(self, symbol):
        if symbol not in self._spans:
            self._spans[symbol] = self._load_span(symbol)
        return self._spans[symbol]

    # --- ordenes ---
    def _orders_path(self, symbol) -> Path:
        return self.folder / "orders" / f"{symbol}.json"

    def _load_orders(self, symbol) -> dict:
        path = self._orders_path(symbol)
        if not path.exists():
            return {}
        try:
            return {o["key"]: o for o in json.loads(path.read_text(encoding="utf-8"))}
        except (ValueError, OSError, KeyError, TypeError):
            # Un archivo danado no se pisa: queda copiado aparte y el registro de esa moneda sigue desde lo que se lea
            stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            path.with_name(f"{symbol}.danado-{stamp}.json").write_bytes(path.read_bytes())
            return {}

    def _save_orders(self, symbol):
        rows = sorted(self._orders.get(symbol, {}).values(), key=lambda o: (o["armed_at"], o["dir"]))
        swing_watch._write_atomic(self._orders_path(symbol), json.dumps(rows, separators=(",", ":"), ensure_ascii=False))

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
        # Lo que anoto el proceso anterior: sus ordenes y lo visto se vuelven a leer
        with self._lock:
            self._orders = {s: self._load_orders(s) for s in self.symbols}
            self._spans = {}
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
    def _fetch(self, symbol, start, end):
        """Velas cerradas y desequilibrios apilados (ST) de [start, end), conocidos hasta end, por tramos."""
        bars, events = [], []
        a = start
        while a < end:
            b = min(end, a + CHUNK_DAYS * DAY)
            part = self._detect(symbol, a, b, end)
            bars += [dict(t=int(x["t"]), o=float(x["o"]), h=float(x["h"]), l=float(x["l"]), c=float(x["c"]),
                          delta=float(x.get("delta") or 0.0), vol=float(x.get("vol") or 0.0))
                     for x in part.get("bars", []) if a <= x["t"] < b and x["t"] + STEP <= end]
            events += [dict(code="ST", dir=int(e["dir"]), t=int(e["t"]), known=int(e["known"]), lo=float(e["lo"]), hi=float(e["hi"]))
                       for e in part.get("events", []) if e["code"] == "ST" and a <= e["t"] < b and e["known"] <= end]
            a = b
        return bars, events

    @staticmethod
    def _reach(cut, usable, have, closed_at):
        """Hasta donde llegan, sin saltar ninguna, las velas desde cut: la primera que falta detiene todo, salvo que en
        MISSING_MAX_MS no haya llegado (esa se salta). Devuelve el corte nuevo y las velas saltadas."""
        t, skipped = cut, []
        while t < usable:
            if t in have:
                t += STEP
            elif closed_at - (t + STEP) >= MISSING_MAX_MS:
                skipped.append(t)
                t += STEP
            else:
                break
        return t, skipped

    def _heal(self, symbol, span):
        """Lo registrado no salta velas. Si falta una (asi quedo la de las 21:00 UTC del 22/11, antes de este arreglo),
        se vuelve a leer desde ella: lo de despues se calcula otra vez con la vela que faltaba."""
        if span["cut"] <= span["since"]:
            return
        have = {b["t"] for b in span["bars"]} | set(span.get("skipped") or [])
        t = span["since"]
        while t < span["cut"] and t in have:
            t += STEP
        if t < span["cut"]:
            logger.warning(f"[DX] {symbol}: faltaba la vela de las {_when(t)} UTC; se vuelve a leer desde ahi")
            span["bars"] = [b for b in span["bars"] if b["t"] < t]
            span["events"] = [e for e in span["events"] if e["t"] < t]
            span["cut"] = t
            self._save_span(symbol, span)

    def check_symbol(self, symbol: str, now: int = None) -> bool:
        """Suma lo nuevo, corre la regla y anota lo que cambio. Devuelve si falta alguna vela ya cerrada."""
        now = self._now() if now is None else now
        closed_at = now // STEP * STEP
        with self._lock:
            st = self._state.setdefault(symbol, {"checks": 0, "errors": 0, "error": None, "note": None})
        try:
            stored = self._store_until(symbol, now) if self._store_until else now
            if stored is None:
                raise RuntimeError("sin almacen en vivo de esta moneda")
            usable = min(now, stored) // STEP * STEP
            span = self._span(symbol)
            if span is None:
                # Arranca el registro de esta moneda: desde este cierre, con WARM_DAYS de velas antes para el ATR
                span = {"since": usable, "cut": usable - WARM_DAYS * DAY, "first_check": now, "bars": [], "events": [],
                        "skipped": []}
            else:
                self._heal(symbol, span)
            reach, waiting = span["cut"], None
            if usable > span["cut"]:
                bars, events = self._fetch(symbol, span["cut"], usable)
                reach, skipped = usable, []
                if span["cut"] >= span["since"]:
                    # Desde since, ninguna vela se salta: la que falta se espera, y las siguientes con ella
                    reach, skipped = self._reach(span["cut"], usable, {b["t"] for b in bars}, closed_at)
                    if reach < usable:
                        waiting = reach
                if reach > span["cut"]:
                    last = span["bars"][-1]["t"] if span["bars"] else None
                    span["bars"] += [b for b in sorted(bars, key=lambda b: b["t"])
                                     if b["t"] < reach and (last is None or b["t"] > last)]
                    seen = {(e["t"], e["dir"], e["lo"], e["hi"]) for e in span["events"][-500:]}
                    span["events"] += [e for e in events if e["t"] < reach and e["known"] <= reach
                                       and (e["t"], e["dir"], e["lo"], e["hi"]) not in seen]
                    span.setdefault("skipped", []).extend(skipped)
                    span["cut"] = reach
                    self._spans[symbol] = span
                    self._save_span(symbol, span)
                    for t in skipped:
                        self._append_log(self._gap_event(symbol, t, now))
                    self._evaluate(symbol, span, now)
            with self._lock:
                note = st.get("note")
                if waiting is not None:
                    note = f"espera la vela de las {_when(waiting)} UTC: toca un hueco de la grabacion o aun no esta guardada"
                elif note and note.startswith("espera la vela"):
                    note = None
                st.update(checks=st["checks"] + 1, last_check=now, cut=span["cut"], since=span["since"], error=None,
                          note=note, waiting_for=waiting, bars=len(span["bars"]), lagging=reach < closed_at,
                          last_close=span["bars"][-1]["c"] if span["bars"] else None)
            return reach < closed_at
        except Exception as e:
            with self._lock:
                st.update(errors=st["errors"] + 1, error=f"{type(e).__name__}: {e}"[:200], last_check=now)
            logger.warning(f"[DX] {symbol}: {st['error']}")
            return False

    def _evaluate(self, symbol, span, now):
        if len(span["bars"]) < 100:
            with self._lock:
                self._state[symbol]["note"] = "pocas velas todavia"
            return
        trace = {}
        phase = {"phase": 0, "from": _iso(span["since"]), "to": _iso(span["cut"] - 1)}
        res = rt.run(symbol, self.rule, {"bars": span["bars"], "events": span["events"]}, phase, None, base=False,
                     trace=trace, since=span["since"], minutes=self._minutes)
        if not res.get("success"):
            with self._lock:
                self._state[symbol]["note"] = res.get("message")
            return
        snap = self._snapshot(symbol, res, trace)
        self._apply(symbol, snap, now)

    def _snapshot(self, symbol, res, trace) -> dict:
        """El estado de cada orden segun esta corrida: el de cada senal de la regla desde since."""
        ctx = trace["ctx"]
        T, C = ctx["T"], ctx["C"]
        n = len(T)
        expiry = self.rule["entry"]["expiry"]
        target_r = self.rule["exit"]["targetR"]
        zones = {}
        for e in trace["events"]:
            if e["code"] == "DX":
                zones.setdefault((e["known"], e["dir"]), []).append(e)
        closed = {(t["known"], t["dir"]): t for t in res["trades"]}
        opened = {(t["known"], t["dir"]): t for t in res.get("openTrades") or []}
        out = {}
        for item in trace["signals"]:
            k, side = item["k"], item["dir"]
            known = T[k] + STEP
            evs = zones.get((known, side))
            if not evs:
                continue
            lo, hi = min(e["lo"] for e in evs), max(e["hi"] for e in evs)
            limit, stop = (hi, lo) if side > 0 else (lo, hi)
            risk = abs(limit - stop)
            info = evs[0].get("info") or {}
            rec = {"key": f"{symbol}|{known}|{side}", "symbol": symbol, "dir": side, "armed_at": known,
                   "born": min(int((e.get("info") or {}).get("born", known)) for e in evs),
                   "zone": info.get("zone"), "stop_day": info.get("stopDay"), "shift_atr": info.get("shiftAtr"),
                   "limit": limit, "stop": stop, "risk": risk, "target": limit + side * target_r * risk,
                   "expires_at": known + expiry * STEP, "order": "limit"}
            what = item.get("what")
            trade = closed.get((known, side)) if what == "trade" else opened.get((known, side)) if what == "abierta al final de la fase" else None
            if trade is not None:
                rec.update(entry_t=trade["entry_t"], entry=trade["entry"], stop=trade["stop"], target=trade["target"],
                           risk=trade["risk"], order=trade.get("order", "limit"))
                if what == "trade":
                    rec.update(status="cerrada", exit_t=trade["exit_t"], exit=trade["exit"], reason=trade["reason"],
                               r=trade["r"], gross=trade.get("gross"), bars=trade.get("bars"), mfe=trade.get("mfe"), mae=trade.get("mae"))
                else:
                    rec.update(status="abierta", last=C[-1], open_r=round((C[-1] - trade["entry"]) * side / trade["risk"], 3))
            elif what == "posición abierta":
                rec["status"] = "no entra"          # se lleno con otra posicion abierta en la moneda
            elif what == "limit sin llenar":
                rec["status"] = "esperando" if k + 1 + expiry > n else "vencida"
            elif what == "sin vela siguiente":
                rec["status"] = "esperando"          # se armo en la ultima vela cerrada
            else:
                rec.update(status="no se opera", why=what)
            out[rec["key"]] = rec
        return out

    def _apply(self, symbol, snap, now):
        """Compara con lo anotado: lo nuevo y cada cambio de estado van al registro. Lo final no se reescribe."""
        events, changed = [], False
        with self._lock:
            book = self._orders.setdefault(symbol, {})
            for key, rec in sorted(snap.items(), key=lambda kv: kv[1]["armed_at"]):
                old = book.get(key)
                if old is None:
                    # Lo que se sabe al armarse; la entrada y la salida llegan con sus pasos
                    old = {k: rec[k] for k in ARM_FIELDS if k in rec}
                    old.update(status="esperando", detected={"armada": now})
                    book[key] = old
                    events.append(self._event("armada", old, old["armed_at"], now))
                    changed = True
                if rec["status"] == old["status"]:
                    if old["status"] == "abierta":
                        old.update(last=rec.get("last"), open_r=rec.get("open_r"))
                    elif old["status"] == "cerrada" and rec.get("r") != old.get("r"):
                        events.append(self._revision(old, rec, now))
                        changed = True
                    continue
                path = STEPS.get((old["status"], rec["status"]))
                if path is None:
                    events.append(self._revision(old, rec, now))
                    changed = True
                    if old["status"] in FINAL:
                        continue          # lo anotado como final se queda: es lo que se supo en vivo
                    path = ()
                for kind in path:
                    if kind == "entrada":
                        old.update({k: rec[k] for k in ("entry_t", "entry", "stop", "target", "risk", "order") if k in rec})
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
                    if kind in ("entrada", "salida"):
                        self._measure(old)
                    at = {"entrada": old.get("entry_t"), "salida": old.get("exit_t"), "vencida": old["expires_at"]}.get(kind) or now
                    events.append(self._event(kind, old, at, now))
                old["status"] = rec["status"]
                if old["status"] == "abierta":
                    old.update(last=rec.get("last"), open_r=rec.get("open_r"))
                changed = True
            # Lo anotado que ya no sale en la corrida. Solo pasa al volver a leer una vela que faltaba (_heal): la orden se
            # armo con velas incompletas y con la vela completa no existe. La que esperaba o estaba abierta se anula; lo
            # final se queda, con una revision
            for key, old in book.items():
                if key in snap or old["status"] == "anulada" or old.get("gone"):
                    continue
                if old["status"] in FINAL:
                    old["gone"] = now
                    events.append(self._revision(old, {"status": "sin señal", "r": None, "exit_t": None}, now))
                else:
                    old["status"] = "anulada"
                    old.pop("last", None)
                    old.pop("open_r", None)
                    old.setdefault("detected", {})["anulada"] = now
                    events.append(self._event("anulada", old, now, now))
                changed = True
            if changed:
                self._save_orders(symbol)
        for entry in events:
            self._append_log(entry)

    def _event(self, kind, rec, at, now) -> dict:
        return {"type": kind, "symbol": rec["symbol"], "key": rec["key"], "dir": rec["dir"], "at": int(at), "detected_at": now,
                "delay_ms": now - int(at), "status": rec["status"], "text": describe(kind, rec),
                **{k: rec.get(k) for k in ("limit", "stop", "target", "entry", "exit", "reason", "r", "r_exec", "why") if rec.get(k) is not None}}

    def _gap_event(self, symbol, t, now) -> dict:
        return {"type": "hueco", "symbol": symbol, "key": f"{symbol}|{t}|hueco", "dir": 0, "at": int(t), "detected_at": now,
                "delay_ms": now - int(t), "status": "sin datos",
                "text": f"La vela de las {_when(t)} UTC no se completo en dos dias: se salta"}

    def _revision(self, old, rec, now) -> dict:
        return {"type": "revision", "symbol": old["symbol"], "key": old["key"], "dir": old["dir"], "at": now, "detected_at": now,
                "delay_ms": 0, "status": old["status"], "was": {k: old.get(k) for k in ("status", "r", "exit_t")},
                "now": {k: rec.get(k) for k in ("status", "r", "exit_t")},
                "text": f"Revision: {old['status']} → {rec['status']} (lo anotado se queda)"}

    # --- la ejecucion, con la cinta ---
    def _reader(self):
        if self._read_tape is None:
            path = self.data / "tools" / "ingest.py"
            if not path.exists():
                self._read_tape = False
            else:
                spec = importlib.util.spec_from_file_location("ingest_dx", str(path))
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                self._read_tape = mod.read_tape
        return self._read_tape or None

    def _tape(self, symbol, day):
        """Trades de un dia: (ms, precio, cantidad, lado), del archivo oficial o, si falta, de la nube y el PC."""
        for root in (self.data / "tape", self.data / "live" / "tape"):
            path = root / symbol / day[:4] / f"{symbol}_{day}.tape"
            try:
                stamp = (str(path), path.stat().st_mtime)
            except OSError:
                continue
            hit = self._tapes.get((symbol, day))
            if hit is not None and hit[0] == stamp:
                return hit[1]
            reader = self._reader()
            if reader is None:
                return None
            meta, t, p, q, s, _ = reader(path)
            arr = (np.asarray(t, np.int64) // 10, np.asarray(p, float) / float(meta["price_scale"]),
                   np.asarray(q, float) / float(meta["qty_scale"]), np.asarray(s, np.int8))
            self._tapes[(symbol, day)] = (stamp, arr)
            while len(self._tapes) > 3:
                self._tapes.popitem(last=False)
            return arr
        return None

    def _first(self, symbol, start, end, toward, level, strict):
        """Primer trade desde start hasta end que pasa `level` hacia `toward` (-1: hacia abajo). None si no hay o si falta
        la cinta de un dia del tramo (no se sabria si fue antes)."""
        day = start // DAY * DAY
        while day <= end:
            arr = self._tape(symbol, _day(day))
            if arr is None:
                return None
            t, p = arr[0], arr[1]
            a, b = int(np.searchsorted(t, start)), int(np.searchsorted(t, end, side="right"))
            if b > a:
                seg = p[a:b]
                mask = (seg < level if strict else seg <= level) if toward < 0 else (seg > level if strict else seg >= level)
                i = int(np.argmax(mask))
                if mask[i]:
                    return arr, a + i
            day += DAY
        return None

    def _measure(self, rec):
        """Cuando se lleno la limit y, en la salida, el precio de una orden a mercado disparada en el nivel."""
        try:
            self._measure_inner(rec)
        except Exception as e:
            rec.setdefault("exec", {})["error"] = f"{type(e).__name__}: {e}"[:160]

    def _measure_inner(self, rec):
        side, symbol = rec["dir"], rec["symbol"]
        ex = rec.setdefault("exec", {})
        if rec.get("entry_t") is None:
            return
        if "fill_ms" not in ex:
            if rec.get("order") == "limit":
                until = rec["entry_t"] + STEP
                fill = self._first(symbol, rec["armed_at"], until, -side, rec["entry"], strict=True)
                touch = self._first(symbol, rec["armed_at"], until, -side, rec["entry"], strict=False)
                ex["fill_ms"] = int(fill[0][0][fill[1]]) if fill else None
                ex["touch_ms"] = int(touch[0][0][touch[1]]) if touch else None
            else:
                ex["fill_ms"] = int(rec["entry_t"])
        if rec.get("status") != "cerrada" or rec.get("exit_t") is None or "exit_fill" in ex or not ex.get("fill_ms"):
            return
        start, end = ex["fill_ms"], rec["exit_t"] + STEP + 3_600_000
        stop_hit = self._first(symbol, start, end, -side, rec["stop"], strict=False)
        goal_hit = self._first(symbol, start, end, side, rec["target"], strict=False)
        times = {"stop": stop_hit and int(stop_hit[0][0][stop_hit[1]]), "objetivo": goal_hit and int(goal_hit[0][0][goal_hit[1]])}
        found = [k for k in ("stop", "objetivo") if times[k]]
        if found:
            ex["first"] = min(found, key=lambda k: times[k])   # lo que toco antes la cinta, que puede no ser el minuto
        reason = rec.get("reason")
        if reason not in ("stop", "objetivo"):
            rec["r_exec"] = rec.get("r")
            return
        hit = stop_hit if reason == "stop" else goal_hit
        if not hit:
            return
        arr, i = hit
        t, p, q, s = arr
        j = int(np.searchsorted(t, t[i] + FILL_MS, side="right"))
        mask = s[i:j] == -side                     # al salir de un largo se vende a mercado: los trades de venta
        fill = float((p[i:j][mask] * q[i:j][mask]).sum() / q[i:j][mask].sum()) if mask.any() and q[i:j][mask].sum() > 0 else float(p[i])
        fill = min(fill, float(p[i])) if side > 0 else max(fill, float(p[i]))   # el peor de los dos: vender mas bajo, comprar mas alto
        level = rec["stop"] if reason == "stop" else rec["target"]
        ex.update(kind=reason, trigger_ms=int(t[i]), trigger_price=float(p[i]), exit_fill=fill,
                  slip_pct=round(side * (level - fill) / level * 100, 5))
        if reason == "objetivo":
            k = int(np.searchsorted(t, t[i] + CROSS_MS, side="right"))
            seg = p[i:k]
            ex["crossed"] = bool((seg > level).any() if side > 0 else (seg < level).any())
        fee_in = rt.MAKER_FEE if rec.get("order") == "limit" else rt.TAKER_FEE
        rec["r_exec"] = round(((fill - rec["entry"]) * side - (fee_in * rec["entry"] + rt.TAKER_FEE * fill)) / rec["risk"], 4)

    # --- registro ---
    def _log_file(self, ms) -> Path:
        return self.folder / "log" / f"{_day(ms)}.jsonl"

    def _append_log(self, entry):
        path = self._log_file(entry["at"])
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, separators=(",", ":"), ensure_ascii=False) + "\n")
        with self._lock:
            self._recent.append(entry)

    def _load_recent(self):
        folder = self.folder / "log"
        files = sorted(folder.glob("*.jsonl"))[-3:] if folder.exists() else []
        entries = []
        for path in files:
            for line in path.read_text(encoding="utf-8").splitlines():
                try:
                    entries.append(json.loads(line))
                except ValueError:
                    continue   # una linea cortada no detiene la lectura
        entries.sort(key=lambda x: (x.get("detected_at") or 0, x.get("at") or 0))
        with self._lock:
            self._recent = deque(entries[-LOG_MEMORY:], maxlen=LOG_MEMORY)

    def log(self, symbol: str = None, limit: int = 200, day: str = None) -> list:
        if day:
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", day):
                raise ValueError("day es AAAA-MM-DD")
            path = self.folder / "log" / f"{day}.jsonl"
            entries = []
            if path.exists():
                for line in path.read_text(encoding="utf-8").splitlines():
                    try:
                        entries.append(json.loads(line))
                    except ValueError:
                        continue
        else:
            with self._lock:
                entries = list(self._recent)
        if symbol:
            entries = [x for x in entries if x.get("symbol") == symbol]
        entries.sort(key=lambda x: (x.get("detected_at") or 0, x.get("at") or 0), reverse=True)
        return entries[:max(1, min(int(limit), 5000))]

    # --- lectura ---
    def orders(self, symbol=None) -> list:
        with self._lock:
            return [dict(o) for s, book in self._orders.items() if symbol in (None, s) for o in book.values()]

    def since(self):
        with self._lock:
            found = [st.get("since") for st in self._state.values() if st.get("since")]
        found += [span["since"] for span in self._spans.values() if span]
        return min(found) if found else None

    def report(self, now: int = None) -> dict:
        now = self._now() if now is None else now
        rows = self.orders()
        closed = sorted((o for o in rows if o["status"] == "cerrada"), key=lambda o: o["exit_t"])
        counts = {}
        for o in rows:
            counts[o["status"]] = counts.get(o["status"], 0) + 1
        out = {"success": True, "sends": False, "rule": self.rule_raw, "symbols": self.symbols, "since": self.since(), "now": now,
               "counts": counts, "book": stats(o["r"] for o in closed),
               "exec": stats(o.get("r_exec", o["r"]) for o in closed),
               "measured": sum(1 for o in closed if o.get("r_exec") is not None),
               "bySymbol": {s: {"book": stats(o["r"] for o in closed if o["symbol"] == s),
                                "exec": stats(o.get("r_exec", o["r"]) for o in closed if o["symbol"] == s)} for s in self.symbols},
               "bySide": {name: stats(o.get("r_exec", o["r"]) for o in closed if o["dir"] == d) for name, d in (("largos", 1), ("cortos", -1))}}
        slips = sorted(o["exec"]["slip_pct"] for o in closed if (o.get("exec") or {}).get("kind") == "stop" and o["exec"].get("slip_pct") is not None)
        goals = [o["exec"].get("crossed") for o in closed if (o.get("exec") or {}).get("kind") == "objetivo"]
        out["slippage"] = {"stops": len(slips), "medianPct": slips[len(slips) // 2] if slips else None,
                           "p90Pct": slips[min(len(slips) - 1, int(len(slips) * 0.9))] if slips else None,
                           "targets": len(goals), "crossed": sum(1 for g in goals if g),
                           "minuteDisagree": sum(1 for o in closed if (o.get("exec") or {}).get("first") and o["exec"]["first"] != o.get("reason") and o.get("reason") in ("stop", "objetivo"))}
        since = out["since"]
        marks = []
        for months in CHECKPOINTS:
            at = since + months * MONTH if since else None
            mark = {"months": months, "at": at, "due": bool(at and at <= now)}
            if mark["due"]:
                s = stats(o.get("r_exec", o["r"]) for o in closed if o["exit_t"] <= at)
                mark["stats"] = s
                low, high = s.get("low"), s.get("high")
                if months < 12:
                    mark["verdict"] = "descartada" if high is not None and high < 0 else "sigue"
                else:
                    mark["verdict"] = "pasa" if low is not None and low > 0 else "no pasa"
            marks.append(mark)
        out["checkpoints"] = marks
        return out

    def status(self) -> dict:
        rows = self.orders()
        with self._lock:
            states = {s: dict(st) for s, st in self._state.items()}
        by_symbol = {}
        for s in self.symbols:
            mine = [o for o in rows if o["symbol"] == s]
            st = states.get(s, {})
            last = max(mine, key=lambda o: max((o.get("detected") or {}).values() or [0]), default=None)
            waiting = [o for o in mine if o["status"] == "esperando"]
            by_symbol[s] = {"since": st.get("since"), "cut": st.get("cut"), "last_check": st.get("last_check"),
                            "error": st.get("error"), "note": st.get("note"), "lagging": st.get("lagging"),
                            "waiting_for": st.get("waiting_for"),
                            "bars": st.get("bars"), "lastClose": st.get("last_close"),
                            "closed": sum(1 for o in mine if o["status"] == "cerrada"),
                            # Hay muchas a la vez (en la repeticion del 15 al 22/11, unas 40 por moneda): las mas cerca del precio
                            "pending": self._nearest(waiting, st.get("last_close"), NEAR_PENDING), "pendingCount": len(waiting),
                            "open": [o for o in mine if o["status"] == "abierta"],
                            "last": {"text": describe(last["status"], last), "status": last["status"]} if last else None}
        return {"success": True, "sends": False, "enabled": self.config["enabled"], "env_off": _env_off(),
                "detecting": bool(self._task is not None and self._lock_fh is not None and self.config["enabled"]),
                "other_process": self.other_process, "tf": "30m", "symbols": self.symbols, "since": self.since(),
                "round": self.round, "config_error": self.config_error, "by_symbol": by_symbol,
                "plan": "docs/PLAN_ESTRATEGIAS_BYKO_DALE.md, «DX en vivo»"}

    def brief(self) -> dict:
        rows = self.orders()
        with self._lock:
            errors = sum(1 for st in self._state.values() if st.get("error"))
        return {"detecting": bool(self._task is not None and self._lock_fh is not None and self.config["enabled"]),
                "enabled": self.config["enabled"], "closed": sum(1 for o in rows if o["status"] == "cerrada"),
                "open": sum(1 for o in rows if o["status"] == "abierta"),
                "pending": sum(1 for o in rows if o["status"] == "esperando"), "errors": errors, "other_process": self.other_process}

    @staticmethod
    def _nearest(orders, price, count):
        """Las `count` ordenes con la limit mas cerca del precio; sin precio, las ultimas armadas."""
        if price:
            return sorted(orders, key=lambda o: abs(o["limit"] - price))[:count]
        return sorted(orders, key=lambda o: o["armed_at"])[-count:]

    def zones(self, symbol, start, end) -> list:
        """Las limit de DX como zonas de la defensa de la pestana Mapa: el libro en el precio donde espera cada orden. De
        las que esperan, las ZONE_PENDING mas cerca del precio de cada lado; ademas, las que se llenaron."""
        rows = self.orders(symbol)
        with self._lock:
            price = (self._state.get(symbol) or {}).get("last_close")
        waiting = [o for o in rows if o["status"] == "esperando"]
        chosen = (self._nearest([o for o in waiting if o["dir"] > 0], price, ZONE_PENDING)
                  + self._nearest([o for o in waiting if o["dir"] < 0], price, ZONE_PENDING)
                  + [o for o in rows if o["status"] in ("abierta", "cerrada") and o.get("entry_t")])
        out = []
        for o in chosen:
            until = o.get("exit_t") or o["expires_at"]
            if o["status"] in ("abierta", "cerrada") and o.get("entry_t"):
                until = min(until, o["entry_t"] + 2 * STEP)    # la visita que la llena, y un rato despues
            lo, hi = o["limit"] * (1 - 0.0005), o["limit"] * (1 + 0.0005)
            if until > start and o["armed_at"] < end:
                out.append({"kind": "dx", "label": f"DX {'compra' if o['dir'] > 0 else 'venta'} {_price(o['limit'])}",
                            "id": f"dx:{o['key']}", "lo": lo, "hi": hi, "from": max(o["armed_at"], start), "to": min(until, end)})
        return out

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
        while True:
            try:
                now = self._now()
                # Al arrancar, enseguida: pone al dia lo que paso con la suite cerrada. Despues, tras cada cierre
                wake_at = now if first else (now - CHECK_DELAY_MS) // STEP * STEP + STEP + CHECK_DELAY_MS
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
                    await self.check_all()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(f"[DX] vuelta fallida: {e}")
                await asyncio.sleep(5)

    async def check_all(self):
        began = time.time()
        waiting = list(self.symbols)
        deadline = self._now() + MAX_WAIT_MS
        while waiting:
            behind = []
            for symbol in waiting:
                if await run_in_threadpool(self.check_symbol, symbol):
                    behind.append(symbol)
            waiting = behind
            if waiting and self._now() + RETRY_MS < deadline:
                await asyncio.sleep(RETRY_MS / 1000)
            else:
                break
        self.round = {"at": self._now(), "seconds": round(time.time() - began, 2), "symbols": len(self.symbols), "behind": waiting}


def _when(ms) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%d/%m %H:%M")


def describe(kind, o) -> str:
    """El evento o el estado de una orden en una linea, para el panel."""
    up = o["dir"] > 0
    what = "compra" if up else "venta"
    head = f"DX {what} limit {_price(o.get('limit'))} · stop {_price(o.get('stop'))} · objetivo {_price(o.get('target'))}"
    if kind in ("armada", "esperando"):
        return f"{head} · vale hasta {datetime.fromtimestamp(o['expires_at'] / 1000, tz=timezone.utc).strftime('%d/%m %H:%M')} UTC"
    if kind in ("entrada", "abierta"):
        extra = f" · {o['open_r']:+.2f} R" if o.get("open_r") is not None and kind == "abierta" else ""
        return f"DX {what} en {_price(o.get('entry'))} · stop {_price(o.get('stop'))} · objetivo {_price(o.get('target'))}{extra}"
    if kind in ("salida", "cerrada"):
        r = o.get("r")
        rx = o.get("r_exec")
        tail = f" · {r:+.2f} R" if r is not None else ""
        if rx is not None and r is not None and abs(rx - r) >= 0.005:
            tail += f" ({rx:+.2f} con la ejecucion medida)"
        return f"DX {what}: salio por {o.get('reason', '?')} en {_price(o.get('exit'))}{tail}"
    if kind == "vencida":
        return f"{head} · vencio sin llenarse"
    if kind == "no entra":
        return f"{head} · se lleno con otra posicion abierta: no cuenta"
    if kind == "no se opera":
        return f"{head} · no se opera ({o.get('why')})"
    if kind == "anulada":
        return f"{head} · anulada: con la vela que faltaba, esta orden no se arma"
    return head


def make_router(watch: DxWatch, prefix: str = "/api/dx") -> APIRouter:
    router = APIRouter()

    @router.get(f"{prefix}/status")
    async def dx_status():
        return watch.status()

    @router.get(f"{prefix}/report")
    async def dx_report():
        return watch.report()

    @router.get(f"{prefix}/config")
    async def dx_config():
        return {"success": True, "config": watch.config, "rule": watch.rule_raw, "symbols": watch.symbols, "sends": False}

    @router.post(f"{prefix}/config")
    async def dx_set_config(request: Request):
        try:
            body = await request.json()
        except ValueError:
            raise HTTPException(400, "el cuerpo debe ser JSON")
        try:
            return {"success": True, "config": watch.set_config(body)}
        except ValueError as e:
            raise HTTPException(400, str(e))

    @router.get(f"{prefix}/log")
    async def dx_log(symbol: str = None, limit: int = 200, day: str = None):
        if symbol is not None and not SYMBOL_RE.match(symbol):
            raise HTTPException(400, "moneda invalida")
        try:
            return {"success": True, "events": watch.log(symbol, limit, day)}
        except ValueError as e:
            raise HTTPException(400, str(e))

    return router
