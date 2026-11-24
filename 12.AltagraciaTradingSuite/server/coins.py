# coins.py - Registro central de monedas de la suite (23/11/2026, fase 1 de docs/PLAN_MONEDAS.md).
#
# Un solo lugar, el modulo "Monedas" de la pagina, para elegir moneda por moneda lo que se guarda de ella:
#   - en la suite: data/symbols.json, como siempre (Watchlist, grafico, "Mis monedas" del scanner, sabios y SMC);
#   - grabar en el PC: los trades (cinta y footprints recientes), el libro completo y Hyperliquid, cada uno aparte;
#   - el almacen: bajar su historia de trades de Bybit y tenerla al dia (coin_history.py y official.py).
# La nube, App 1, DX, el bot y el Swing se muestran como estan. El Swing se cambia con su propia ruta (/api/swing/config).
#
# data/coins.json guarda solo lo elegido. Una moneda sin entrada graba todo, como antes del registro, y su almacen se pone
# al dia si ya tiene historia: el primer dia no cambia nada. Encender una grabacion vale al instante; apagarla, al
# reiniciar la suite (los grabadores del libro y de Hyperliquid son copias exactas de los del collector y no se tocan).
# Quitar una moneda o apagar algo nunca borra lo guardado. Un coins.json ilegible no se pisa: se graba todo, como antes,
# y no se puede cambiar nada hasta arreglarlo o quitarlo.
import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, List, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request

import book_recorder
import coin_history
import hl_recorder
import recorder
from symbols import SYMBOL_RE

logger = logging.getLogger("suite.coins")

RECORD = ("trades", "book", "hl")
OPTIONS = RECORD + ("store",)
LABELS = {"trades": "los trades", "book": "el libro", "hl": "Hyperliquid", "store": "el almacen"}
SIZES_TTL_S = 15 * 60
CLOUD_TTL_S = 30 * 60
BOT_TTL_S = 60
MB = 1024 * 1024
LIVE_FOLDERS = ("book", "book_cloud", "store", "flow", "tape", "local/tape", "cloud/tape")
HISTORY_FOLDERS = ("tape", "store", "flow")
PER_DAY_DAYS = 3


class RegistryError(Exception):
    """data/coins.json (o data/symbols.json) no se puede leer: no se pisa."""


class BybitError(Exception):
    """No se pudo consultar Bybit."""


class NotFound(Exception):
    """La moneda no es un perpetuo USDT que cotice en Bybit."""


class CoinRegistry:
    """data/coins.json: {"version": 1, "coins": {"RUNEUSDT": {"book": false, "history": {"requested_at": ms}}}}.
    Solo lo elegido: una opcion que falta toma su valor de fabrica (resolve)."""

    def __init__(self, data_dir):
        self.path = Path(data_dir) / "coins.json"

    def load(self) -> Dict[str, dict]:
        if not self.path.exists():
            return {}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            raise RegistryError(f"data/coins.json ilegible ({type(e).__name__}: {e}): no se pisa; arreglalo o quitalo") from e
        coins = data.get("coins") if isinstance(data, dict) else None
        if not isinstance(coins, dict):
            raise RegistryError("data/coins.json no trae la lista de monedas: no se pisa; arreglalo o quitalo")
        return {str(k).upper(): (v if isinstance(v, dict) else {}) for k, v in coins.items()}

    def save(self, coins: Dict[str, dict]):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        body = {"version": 1, "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "coins": {k: coins[k] for k in sorted(coins)}}
        tmp = self.path.with_name(self.path.name + ".tmp")
        tmp.write_text(json.dumps(body, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, self.path)

    @staticmethod
    def resolve(entry: Optional[dict], has_history: bool) -> dict:
        """Las cuatro opciones de una moneda: lo elegido y, si no, lo de fabrica (grabar todo; el almacen, si ya tiene
        historia)."""
        entry = entry or {}
        out = {k: entry[k] if isinstance(entry.get(k), bool) else True for k in RECORD}
        out["store"] = entry["store"] if isinstance(entry.get("store"), bool) else bool(has_history)
        return out

    def set_options(self, symbol: str, changes: dict) -> dict:
        clean_options(changes, OPTIONS)
        coins = self.load()
        entry = dict(coins.get(symbol) or {})
        entry.update(changes)
        coins[symbol] = entry
        self.save(coins)
        return entry


def clean_options(changes, allowed) -> dict:
    if not isinstance(changes, dict) or not changes:
        raise ValueError("se necesita al menos una opcion: " + ", ".join(allowed))
    bad = sorted(set(changes) - set(allowed))
    if bad:
        raise ValueError(f"opciones desconocidas: {', '.join(bad)} (se puede {', '.join(allowed)})")
    for k, v in changes.items():
        if not isinstance(v, bool):
            raise ValueError(f"{k} debe ser true o false")
    return changes


def recording_lists(registry: CoinRegistry, suite: List[str], quiet: bool = False) -> Dict[str, List[str]]:
    """Las monedas de la suite que graba cada grabador al arrancar. Con el registro ilegible, todas, como antes."""
    try:
        coins = registry.load()
    except Exception as e:
        if not quiet:
            print(f"[SUITE] {e}: se graban todas las monedas de la suite", flush=True)
        coins = {}
    return {k: [s for s in suite if CoinRegistry.resolve(coins.get(s), False)[k]] for k in RECORD}


async def start_recording(symbol: str, opts: dict):
    """Empieza al instante lo encendido de una moneda (lo mismo que al agregarla). Cada grabador ignora una moneda que
    ya graba."""
    if opts.get("trades"):
        await recorder.add_symbol(symbol)
    if opts.get("book"):
        await book_recorder.add_symbol(symbol)
    if opts.get("hl"):
        hl_recorder.add_symbol(symbol)


def recording_now() -> Dict[str, Optional[set]]:
    """Lo que graba ahora este proceso, por grabador. None: no corre aqui (apagado, otro proceso o esperando).
    "closed": las que el grabador del libro no graba porque Bybit no las da como "Trading"."""
    out = {"trades": None, "book": None, "hl": None, "closed": set()}
    try:
        now = recorder.symbols_now()
        out["trades"] = set(now) if now is not None else None
    except Exception:
        pass
    rec = book_recorder.get_recorder()
    if rec is not None:
        out["closed"] = set(rec.closed)
        out["book"] = {s for s in rec.books if s not in rec.closed}
    rec = getattr(hl_recorder, "_recorder", None)
    if rec is not None:
        out["hl"] = set(rec.symbols)
    return out


def recording_state(now_rec: dict, key: str, sym: str) -> Optional[str]:
    """"on", "off", "closed" (el libro de una moneda que Bybit cerro) o None (el grabador no corre aqui)."""
    if now_rec[key] is None:
        return None
    if key == "book" and sym in now_rec["closed"]:
        return "closed"
    return "on" if sym in now_rec[key] else "off"


def recorders_brief() -> Dict[str, dict]:
    """Si cada grabador corre en este proceso, y si no, por que."""
    out = {}
    st = recorder.status()
    if not st.get("enabled"):
        out["trades"] = {"running": False, "why": "apagado en este servidor (SUITE_RECORD=0)"}
    elif st.get("other_process_records"):
        out["trades"] = {"running": False, "why": "los graba otro proceso (el backend 11000 u otra copia de la suite)"}
    elif not st.get("records"):
        out["trades"] = {"running": False, "why": "esperando para empezar (sin red o sin respuesta de Bybit)"}
    else:
        out["trades"] = {"running": True}
    for key, mod, env in (("book", book_recorder, "SUITE_BOOK"), ("hl", hl_recorder, "SUITE_HL")):
        b = mod.brief()
        if not b.get("enabled"):
            out[key] = {"running": False, "why": f"apagado en este servidor ({env}=0)"}
        elif b.get("other_process_records"):
            out[key] = {"running": False, "why": "lo graba otro proceso con esta carpeta de datos"}
        elif not b.get("running"):
            out[key] = {"running": False, "why": "esperando para empezar"}
        else:
            out[key] = {"running": True}
    return out


# ---------- lo que ocupa cada moneda ----------
def dir_size(path: Path) -> int:
    total, stack = 0, [str(path)]
    while stack:
        here = stack.pop()
        try:
            with os.scandir(here) as it:
                for e in it:
                    try:
                        if e.is_dir(follow_symlinks=False):
                            stack.append(e.path)
                        else:
                            total += e.stat(follow_symlinks=False).st_size
                    except OSError:
                        pass
        except OSError:
            pass
    return total


def day_sizes(folder: Path, exts) -> Dict[str, int]:
    """Bytes por dia de folder/AAAA/MONEDA_AAAA-MM-DD.ext, sumando las extensiones (el libro: .bkm y .bks)."""
    out = {}
    try:
        years = [e.path for e in os.scandir(folder) if e.is_dir()]
    except OSError:
        return out
    for year in years:
        try:
            for e in os.scandir(year):
                name = e.name
                for ext in exts:
                    if name.endswith(ext) and len(name) > len(ext) + 10:
                        day = name[-len(ext) - 10:-len(ext)]
                        try:
                            out[day] = out.get(day, 0) + e.stat().st_size
                        except OSError:
                            pass
        except OSError:
            pass
    return out


def per_day(data: Path, sym: str, now_s: float) -> Optional[dict]:
    """Lo que escribe por dia la grabacion de la moneda en este PC (el libro y la cinta): el promedio de sus ultimos
    3 dias UTC completos. Sin un dia completo, lo de hoy llevado al dia entero (estimate)."""
    today = datetime.fromtimestamp(now_s, timezone.utc).strftime("%Y-%m-%d")
    book = day_sizes(data / "live" / "book" / sym, (".bkm", ".bks"))
    tape = day_sizes(data / "live" / "local" / "tape" / sym, (".tape",))
    days = sorted(d for d in set(book) | set(tape) if d < today)[-PER_DAY_DAYS:]
    if days:
        b = sum(book.get(d, 0) for d in days) / len(days)
        t = sum(tape.get(d, 0) for d in days) / len(days)
        return {"book_mb": round(b / MB, 2), "trades_mb": round(t / MB, 2), "total_mb": round((b + t) / MB, 2),
                "days": len(days), "estimate": False}
    if today not in book and today not in tape:
        return None
    midnight = datetime.strptime(today, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()
    frac = (now_s - midnight) / 86400
    if frac < 0.05:
        return None
    b, t = book.get(today, 0) / frac, tape.get(today, 0) / frac
    return {"book_mb": round(b / MB, 2), "trades_mb": round(t / MB, 2), "total_mb": round((b + t) / MB, 2),
            "days": 0, "estimate": True}


def disk_and_rates(data: Path, root: Path, names, now_s: float) -> Dict[str, dict]:
    """Por moneda: lo que ocupa su almacen (historia) y su grabacion en vivo, y lo que escribe por dia. En otro hilo."""
    out = {}
    for s in names:
        hist = sum(dir_size(root / d / s) for d in HISTORY_FOLDERS)
        live = sum(dir_size(data / "live" / d / s) for d in LIVE_FOLDERS)
        out[s] = {"history_mb": round(hist / MB, 1), "live_mb": round(live / MB, 1), "per_day": per_day(data, s, now_s)}
    return out


def app1_group(app1_backend: Optional[Path], data: Path, sym: str) -> Optional[str]:
    """El grupo de la moneda en el probador de App 1: "base" (las de siempre), "nueva" (las 43 nuevas) o None."""
    if app1_backend and (app1_backend / "backtesting_cache" / f"{sym}_backtesting_data.json.gz").exists():
        return "base"
    if (data / "candles" / f"{sym}.json.gz").exists():
        return "nueva"
    return None


class Coins:
    """El modulo "Monedas": el registro, la historia del almacen y lo que se muestra de cada moneda.
    symbols: SymbolList de la suite. bot(method, path): el bot por su API. http(): el cliente httpx de la suite.
    instrument(sym): coroutine, True si es un perpetuo USDT que cotiza en Bybit. official_busy(): official.py corre."""

    def __init__(self, data_dir, orderflow_data, symbols, swing=None, wsmc=None, dx_symbols=(), bot=None, http=None,
                 instrument=None, cloud_url=None, app1_backend=None, official_busy=None, now=time.time, tools=None,
                 fetch_cloud=None, fetch_listing=None):
        self.data = Path(orderflow_data)
        self.registry = CoinRegistry(data_dir)
        self.symbols = symbols
        self.swing, self.wsmc, self.dx_symbols = swing, wsmc, tuple(dx_symbols or ())
        self._bot = bot
        self._http = http or (lambda: None)
        self._instrument = instrument
        self.cloud_url = (cloud_url or "").rstrip("/")
        self.app1_backend = Path(app1_backend) if app1_backend else None
        self.now = now
        self._fetch_cloud = fetch_cloud
        self.history = coin_history.HistoryManager(
            self.data, Path(data_dir) / "coins" / "salidas", self.registry, http=self._http,
            official_busy=official_busy, store_on=self.store_on, tools=tools, now=now, fetch_listing=fetch_listing)
        self._slots = {}
        self._sizes = None
        self._sizes_at = None
        self._sizes_task = None

    # ---------- arranque ----------
    def start(self):
        self.history.start()

    async def stop(self):
        await self.history.stop_loop()

    # ---------- opciones ----------
    def _has_history(self, sym: str) -> bool:
        f = self.history.facts.get(sym)
        if f is not None:
            return bool(f["tape_days"] or f["store_days"])
        root = self.history.root
        return (root / "tape" / sym).is_dir() or (root / "store" / sym).is_dir()

    def options(self, sym: str, coins: dict = None) -> dict:
        if coins is None:
            try:
                coins = self.registry.load()
            except Exception:
                coins = {}
        return CoinRegistry.resolve(coins.get(sym), self._has_history(sym))

    def store_on(self, sym: str, facts: dict = None) -> bool:
        try:
            coins = self.registry.load()
        except Exception:
            return False   # ilegible: la suite no arma ni pide nada hasta arreglarlo
        has = bool(facts["tape_days"] or facts["store_days"]) if facts else self._has_history(sym)
        return CoinRegistry.resolve(coins.get(sym), has)["store"]

    def recording_options(self, sym: str) -> dict:
        """Lo que se graba de una moneda al agregarla a la suite: lo elegido antes o, si no, todo."""
        return {k: v for k, v in self.options(sym).items() if k in RECORD}

    def store_symbols(self) -> List[str]:
        """Las monedas cuyo almacen pone al dia official.py: las que lo tienen encendido, salvo las que baja alguien o
        arma esta suite en ese momento. official.py salta por su cuenta las que todavia no tienen almacen."""
        try:
            coins = self.registry.load()
        except Exception:
            coins = {}
        names = set(coins) | self.history.symbols_on_disk()
        busy = self.history.busy()
        return sorted(s for s in names if s not in busy and CoinRegistry.resolve(coins.get(s), self._has_history(s))["store"])

    # ---------- lo que se muestra ----------
    async def _cached(self, key: str, ttl: float, fetch, wait: float, keep_last: bool):
        """Lo ultimo que se supo de algo de afuera (la nube, el bot), pedido aparte para no frenar la pagina. La primera
        vez espera hasta `wait` s. keep_last: si falla, queda lo ultimo conocido."""
        slot = self._slots.setdefault(key, {"at": None, "value": None, "task": None})
        stale = slot["at"] is None or self.now() - slot["at"] >= ttl
        if stale and (slot["task"] is None or slot["task"].done()):
            async def run():
                try:
                    value = await fetch()
                except Exception as e:
                    logger.warning(f"[COINS] sin {key}: {type(e).__name__}")
                    value = None
                if value is not None or not keep_last:
                    slot["value"] = value
                slot["at"] = self.now()

            slot["task"] = asyncio.create_task(run())
        if slot["at"] is None and slot["task"] is not None:
            try:
                await asyncio.wait_for(asyncio.shield(slot["task"]), timeout=wait)
            except asyncio.TimeoutError:
                pass
        return slot["value"]

    async def _get_cloud(self):
        if self._fetch_cloud:
            return await self._fetch_cloud()
        if not self.cloud_url or self._http() is None:
            return None
        r = await self._http().get(self.cloud_url + "/api/symbols", timeout=20)
        r.raise_for_status()
        return [str(s).upper() for s in (r.json().get("symbols") or [])]

    async def _get_bot(self):
        if self._bot is None:
            return None
        d = await self._bot("GET", "/api/config")
        return [str(c.get("symbol", "")).upper() for c in (d.get("coins") or []) if isinstance(c, dict)]

    async def cloud_symbols(self) -> Optional[list]:
        """Las monedas que graba la nube (su /api/symbols), cada 30 min. None si nunca respondio."""
        return await self._cached("la lista de la nube", CLOUD_TTL_S, self._get_cloud, 2, keep_last=True)

    async def bot_symbols(self) -> Optional[list]:
        """Las monedas configuradas en el bot, cada minuto. None con el bot apagado."""
        return await self._cached("las monedas del bot", BOT_TTL_S, self._get_bot, 2, keep_last=False)

    async def sizes(self, names) -> Optional[dict]:
        """Lo que ocupa cada moneda (cada 15 min, en otro hilo). La primera vez espera hasta 3 s; despues responde con lo
        ultimo mientras calcula."""
        fresh = self._sizes is not None and self.now() - self._sizes_at < SIZES_TTL_S and set(names) <= set(self._sizes)
        if fresh:
            return self._sizes
        if self._sizes_task is None or self._sizes_task.done():
            names = sorted(names)
            when = self.now()

            async def run():
                got = await asyncio.to_thread(disk_and_rates, self.data, self.history.root, names, when)
                self._sizes, self._sizes_at = got, self.now()

            self._sizes_task = asyncio.create_task(run())
        if self._sizes is None:
            try:
                await asyncio.wait_for(asyncio.shield(self._sizes_task), timeout=3)
            except asyncio.TimeoutError:
                pass
            except Exception as e:
                logger.warning(f"[COINS] no se pudo medir el disco: {e}")
        return self._sizes

    async def inventory(self) -> dict:
        errors = {}
        try:
            suite = self.symbols.load()
        except Exception as e:
            suite, errors["symbols"] = [], f"data/symbols.json ilegible: {e}"
        try:
            coins = self.registry.load()
        except RegistryError as e:
            coins, errors["registry"] = {}, f"{e}. Mientras tanto se graba todo, como antes, y no se puede cambiar nada aqui."
        cloud, bot = await asyncio.gather(self.cloud_symbols(), self.bot_symbols())
        swing_cfg = getattr(self.swing, "config", None) or {}
        swing = set(swing_cfg.get("symbols") or [])
        try:
            wsmc = set(self.wsmc.symbols()) if self.wsmc is not None else set()
        except Exception:
            wsmc = set()
        on_disk = self.history.symbols_on_disk()
        others = (set(coins) | on_disk | set(cloud or []) | swing | set(self.dx_symbols) | set(bot or [])) - set(suite)
        names = list(suite) + sorted(s for s in others if SYMBOL_RE.match(s))
        sizes = await self.sizes(names) or {}
        now_rec = recording_now()
        waiting = self.history.waiting(coins)
        rows = []
        for s in names:
            opts = CoinRegistry.resolve(coins.get(s), self._has_history(s))
            rec = {k: recording_state(now_rec, k, s) for k in RECORD}
            size = sizes.get(s) or {}
            rows.append({
                "symbol": s, "suite": s in suite, "options": opts,
                "chosen": {k: coins.get(s, {}).get(k) for k in OPTIONS if isinstance(coins.get(s, {}).get(k), bool)},
                "recording": rec,
                "restart": [k for k in RECORD if not opts[k] and rec[k] == "on"],
                "store": self.history.state(s, opts["store"], coins, waiting),
                "swing": s in swing, "wsmc": s in wsmc, "dx": s in self.dx_symbols,
                "bot": (s in bot) if bot is not None else None,
                "cloud": (s in cloud) if cloud is not None else None,
                "app1": app1_group(self.app1_backend, self.data, s),
                "history_mb": size.get("history_mb"), "live_mb": size.get("live_mb"), "per_day": size.get("per_day"),
            })
        recording = {k: sum(1 for r in rows if r["recording"][k] == "on") for k in RECORD}
        per_day_total = round(sum((r["per_day"] or {}).get("total_mb", 0) for r in rows if r["suite"]), 1)
        return {"now": int(self.now() * 1000), "rows": rows, "suite_count": len(suite), "recording": recording,
                "recorders": recorders_brief(), "per_day_mb": per_day_total, "history": self.history.summary(),
                "sizes_at": int(self._sizes_at * 1000) if self._sizes_at else None, "cloud_url": self.cloud_url,
                "swing_interval": swing_cfg.get("interval"), "errors": errors}

    # ---------- acciones ----------
    async def add(self, symbol: str, opts: dict, history: bool) -> dict:
        """Agrega una moneda a la suite con lo elegido, y pide su historia si se quiere."""
        if not SYMBOL_RE.match(symbol):
            raise ValueError("escribe una moneda como LINKUSDT")
        clean_options(opts, RECORD)
        coins = self.registry.load()           # ilegible: no se agrega (RegistryError)
        try:
            current = self.symbols.load()
        except Exception as e:
            raise RegistryError(f"data/symbols.json ilegible ({e}): no se pisa") from e
        if symbol not in current:
            try:
                ok = await self._instrument(symbol) if self._instrument else True
            except (httpx.HTTPError, ValueError) as e:
                raise BybitError(f"no se pudo consultar Bybit: {type(e).__name__}") from e
            if not ok:
                raise NotFound(f"{symbol} no es un perpetuo USDT que cotice en Bybit")
        symbols = self.symbols.add(symbol)      # ValueError: el tope de monedas
        coins = self.registry.load()           # otra vez: mientras se consultaba Bybit pudo cambiar
        entry = dict(coins.get(symbol) or {})
        entry.update(opts)
        coins[symbol] = entry
        self.registry.save(coins)
        await start_recording(symbol, opts)
        out = {"symbols": symbols, "history": None, "history_error": None}
        if history:
            try:
                out["history"] = await self.history.request(symbol)
            except (ValueError, RuntimeError) as e:
                out["history_error"] = str(e)
        return out

    async def set_options(self, symbol: str, changes: dict) -> dict:
        """Cambia lo que se guarda de una moneda. Encender una grabacion de una moneda de la suite vale al instante;
        apagarla, al reiniciar."""
        clean_options(changes, OPTIONS)
        if changes.get("store") is False:
            self.history.cancel(symbol, quiet=True)   # una pedida que esperaba ya no se baja (la que baja sigue)
        entry = self.registry.set_options(symbol, changes)
        try:
            in_suite = symbol in self.symbols.load()
        except Exception:
            in_suite = False
        on = {k: True for k in RECORD if changes.get(k) is True}
        if in_suite and on:
            await start_recording(symbol, on)
        if changes.get("store") is True:
            self.history.wake()
        return {"chosen": entry, "in_suite": in_suite}


def make_router(svc: Coins) -> APIRouter:
    r = APIRouter(prefix="/api/coins")

    def sym_of(symbol: str) -> str:
        symbol = (symbol or "").strip().upper()
        if not SYMBOL_RE.match(symbol):
            raise HTTPException(status_code=400, detail="moneda invalida (como LINKUSDT)")
        return symbol

    async def body_of(request: Request) -> dict:
        try:
            body = await request.json()
        except ValueError:
            raise HTTPException(status_code=400, detail="el cuerpo debe ser JSON")
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="el cuerpo debe ser un objeto")
        return body

    async def guarded(work, conflict: bool = False):
        """Cada error con su codigo: el registro ilegible 500, Bybit sin respuesta 503, la moneda que no existe 404 y un
        pedido que no se puede hacer 400 (409 si choca con lo que esta pasando)."""
        try:
            return await work()
        except RegistryError as e:
            raise HTTPException(status_code=500, detail=str(e))
        except (BybitError, RuntimeError) as e:
            raise HTTPException(status_code=503, detail=str(e))
        except NotFound as e:
            raise HTTPException(status_code=404, detail=str(e))
        except ValueError as e:
            raise HTTPException(status_code=409 if conflict else 400, detail=str(e))
        except OSError as e:
            raise HTTPException(status_code=500, detail=f"no se pudo guardar: {e}")

    @r.get("")
    async def coins_list():
        return {"success": True, **(await svc.inventory())}

    @r.post("")
    async def coins_add(request: Request):
        body = await body_of(request)
        symbol = str(body.get("symbol") or "").strip().upper()
        opts = {k: body.get(k, True) for k in RECORD}
        history = body.get("history", True)
        if not isinstance(history, bool):
            raise HTTPException(status_code=400, detail="history debe ser true o false")

        async def work():
            return {"success": True, **(await svc.add(symbol, opts, history))}
        return await guarded(work)

    @r.post("/history/stop")
    async def coins_history_stop():
        async def work():
            return {"success": True, **svc.history.stop()}
        return await guarded(work, conflict=True)

    @r.post("/{symbol}")
    async def coins_set(symbol: str, request: Request):
        symbol = sym_of(symbol)
        body = await body_of(request)

        async def work():
            return {"success": True, **(await svc.set_options(symbol, body))}
        return await guarded(work)

    @r.post("/{symbol}/history")
    async def coins_history(symbol: str):
        symbol = sym_of(symbol)

        async def work():
            return {"success": True, **(await svc.history.request(symbol))}
        return await guarded(work)

    @r.delete("/{symbol}/history")
    async def coins_history_cancel(symbol: str):
        symbol = sym_of(symbol)

        async def work():
            return {"success": True, "cancelled": svc.history.cancel(symbol)}
        return await guarded(work, conflict=True)

    return r
