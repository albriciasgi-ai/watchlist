# coin_history.py - La historia de trades de Bybit de cada moneda, para su almacen (23/11/2026, docs/PLAN_MONEDAS.md).
#
# Usa las herramientas del panel de Order Flow (OrderFlowData/tools) sin cambiarlas:
#   - ingest.py MONEDA baja los dias que faltan, del mas nuevo al mas viejo. Tiene su candado por moneda
#     (work/MONEDA.lock) y escribe su avance en status_MONEDA.json tras cada dia. Se lanza aparte, como desde el panel:
#     sigue aunque se cierre la suite, y al volver la suite la encuentra por su candado.
#   - build_store.py MONEDA arma store/ y flow/ de los dias que faltan. No tiene candado.
# Reglas:
#   - una descarga a la vez, como en el panel: si baja otra (del panel, de su cola o de la suite), la pedida espera;
#   - al terminar una descarga, de quien sea, se arma el almacen de la moneda si le faltan dias y lo tiene encendido.
#     No se arma si alguien escribio en su store/ o flow/ en los ultimos 90 s, si su descarga termino hace menos de
#     3 min (el panel arma el suyo en ese tiempo) ni mientras corre official.py. Un armado que no completa la moneda
#     no se repite antes de 6 h;
#   - "Detener" escribe stop en control.json, como el panel: la descarga termina el dia en curso y se cierra, y las que
#     esperaban se cancelan. Despues se vuelve a dejar stop en false, para que la cola del panel y official.py sigan;
#   - lo pedido queda en data/coins.json (coins.py) y se retoma al arrancar.
# Todas las rutas de las herramientas salen de la carpeta de ingest.py (su ROOT), como en la herramienta misma.
import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable, Dict, Optional

logger = logging.getLogger("suite.coin_history")

TICK_S = 20
QUIET_S = 90                 # nadie escribio en store/ ni flow/ de la moneda en este tiempo: nadie lo esta armando
AFTER_DOWNLOAD_S = 180       # el panel arma su almacen hasta 120 s despues de que termina la descarga
BUILD_TIMEOUT_S = 4 * 3600
BUILD_POLL_S = 1.0           # cada cuanto se mira si termino el armado
RETRY_BUILD_S = 6 * 3600     # un armado que no completo la moneda no se repite antes
LISTING_TTL_S = 6 * 3600
LISTING_URL = "https://public.bybit.com/trading/{sym}/"
MIN_FREE_GB = 6              # ingest.py se detiene con menos de 5 GB libres
LOG_MAX = 1_000_000
RATE_WINDOW_S = 30 * 60
NEAR_COMPLETE = 2            # faltan a lo sumo 2 dias de Bybit: los pone al dia official.py
STABLE_S = 5                 # una carpeta que cambio hace menos no se guarda en la cache
SYM_RE = re.compile(r"^[A-Z0-9]{2,20}USDT$")
DAY_RE = {ext: re.compile(r"_(\d{4}-\d{2}-\d{2})\." + ext + "$") for ext in ("tape", "npz")}

CREATE_NEW_PROCESS_GROUP = 0x00000200
CREATE_NO_WINDOW = 0x08000000
CREATE_BREAKAWAY_FROM_JOB = 0x01000000


def lock_busy(path: Path) -> bool:
    """El candado de ingest.py y de la cola del panel (el primer byte del archivo): True si otro proceso lo tiene."""
    if not path.exists():
        return False
    try:
        fh = open(path, "r+b")
    except OSError:
        return True
    try:
        if os.name == "nt":
            import msvcrt
            try:
                msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError:
                return True
            msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
            return False
        import fcntl
        try:
            fcntl.lockf(fh, fcntl.LOCK_EX | fcntl.LOCK_NB, 1)
        except OSError:
            return True
        fcntl.lockf(fh, fcntl.LOCK_UN, 1)
        return False
    finally:
        fh.close()


def read_control(root: Path) -> dict:
    out = {"limit_rate": "500K", "pause": False, "stop": False}
    try:
        out.update(json.loads((root / "control.json").read_text(encoding="utf-8")))
    except Exception:
        pass
    return out


def write_control(root: Path, **changes):
    """Cambia control.json como el panel: conserva lo demas (el limite de velocidad) y escribe con temporal."""
    path = root / "control.json"
    current = {}
    try:
        current = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        current = {"limit_rate": "500K", "pause": False, "stop": False}
    current.update(changes)
    tmp = path.with_name(path.name + ".suite.tmp")
    tmp.write_text(json.dumps(current, indent=1), encoding="utf-8")
    os.replace(tmp, path)


def launch(args, cwd: Path, log_path: Path) -> subprocess.Popen:
    """Lanza un proceso sin ventana que sigue vivo aunque se cierre la suite (como launch() del panel)."""
    log_path.parent.mkdir(parents=True, exist_ok=True)
    mode = "ab" if log_path.exists() and log_path.stat().st_size < LOG_MAX else "wb"
    f = open(log_path, mode)
    try:
        f.write(f"\n--- {time.strftime('%Y-%m-%d %H:%M:%S')} {subprocess.list2cmdline(args)}\n".encode("utf-8"))
        f.flush()
        if os.name != "nt":
            return subprocess.Popen(args, cwd=str(cwd), stdin=subprocess.DEVNULL, stdout=f, stderr=f, start_new_session=True)
        last = None
        for extra in (CREATE_BREAKAWAY_FROM_JOB, 0):
            try:
                return subprocess.Popen(args, cwd=str(cwd), stdin=subprocess.DEVNULL, stdout=f, stderr=f,
                                        creationflags=CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | extra, close_fds=True)
            except OSError as e:
                last = e
        raise last
    finally:
        f.close()


def tail(path: Path, chars: int = 400) -> str:
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - chars * 4))
            return f.read().decode("utf-8", "replace").strip()[-chars:]
    except OSError:
        return ""


def parse_listing(html: str, sym: str) -> list:
    return sorted(set(re.findall(re.escape(sym) + r"(\d{4}-\d{2}-\d{2})\.csv\.gz", html)))


class HistoryManager:
    """registry: coins.CoinRegistry. http(): el cliente httpx de la suite. official_busy(): algo verdadero mientras
    official.py pone al dia el almacen (la moneda que baja). store_on(sym, facts) -> bool: si la moneda tiene el almacen
    encendido."""

    def __init__(self, data: Path, out_dir: Path, registry, http: Callable = None, official_busy: Callable = None,
                 store_on: Callable = None, tools: Path = None, now: Callable = time.time, python: str = sys.executable,
                 fetch_listing: Callable = None):
        self.data = Path(data)
        self.tools = Path(tools or os.environ.get("ORDERFLOW_TOOLS") or self.data / "tools")
        self.root = self.tools.parent           # el ROOT de ingest.py: tape/, store/, work/, manifest/, control.json
        self.out = Path(out_dir)
        self.registry = registry
        self._http = http or (lambda: None)
        self.official_busy = official_busy or (lambda: None)
        self.store_on = store_on or (lambda sym, facts: True)
        self.now = now
        self.python = python
        self._fetch_listing = fetch_listing
        # Como los grabadores: una copia de prueba con SUITE_RECORD=0 solo mira (no baja ni arma nada)
        self.enabled = os.environ.get("SUITE_COIN_HISTORY", os.environ.get("SUITE_RECORD", "1")) != "0"
        self.proc = None                  # (moneda, Popen) de la descarga que lanzo esta suite
        self.proc_result = {}             # moneda -> {"at", "code", "detail"} de la ultima que lanzo
        self.building: Optional[str] = None
        self.build_result: Dict[str, dict] = {}
        self.facts: Dict[str, dict] = {}
        self.listings: Dict[str, tuple] = {}   # moneda -> (hora, dias de Bybit o None si no se pudo leer)
        self.samples: Dict[str, list] = {}     # moneda -> [(hora, dias hechos)] para la velocidad
        self.ended: Dict[str, float] = {}      # moneda -> hora en que se vio terminar su descarga
        self._running = None
        self.stop_requested = False
        self.last_tick = None
        self.last_error = None
        self._dirs = {}
        self._manifests = {}
        self._task = None
        self._build_task = None
        self._wake = None

    # ---------- disponibilidad ----------
    def tools_ok(self) -> bool:
        return (self.tools / "ingest.py").exists() and (self.tools / "build_store.py").exists()

    def available(self) -> dict:
        if not self.enabled:
            return {"ok": False, "why": "apagada en este servidor (SUITE_COIN_HISTORY=0 o SUITE_RECORD=0): solo se mira"}
        if not self.tools_ok():
            return {"ok": False, "why": f"no estan las herramientas del almacen en {self.tools}"}
        return {"ok": True}

    # ---------- lo que hay en el disco ----------
    def _days(self, folder: Path, ext: str) -> tuple:
        """(dias, hora del ultimo cambio) de folder/AAAA/MONEDA_AAAA-MM-DD.ext. Se vuelve a leer solo si cambio una
        carpeta de ano: crear o reemplazar un archivo cambia la hora de su carpeta."""
        try:
            years = sorted((e.name, e.stat().st_mtime_ns) for e in os.scandir(folder) if e.is_dir())
        except OSError:
            return set(), None
        sig = tuple(years)
        key = str(folder)
        hit = self._dirs.get(key)
        if hit and hit[0] == sig:
            return hit[1], hit[2]
        days, rx = set(), DAY_RE[ext]
        for name, _ in years:
            try:
                for e in os.scandir(folder / name):
                    m = rx.search(e.name)
                    if m:
                        days.add(m.group(1))
            except OSError:
                pass
        changed = max((t for _, t in years), default=None)
        changed = changed / 1e9 if changed else None
        # La hora de una carpeta avanza de a ~16 ms en Windows: dos archivos nuevos en el mismo instante la dejan igual.
        # Una carpeta que cambio en los ultimos STABLE_S segundos se vuelve a leer la vez siguiente
        if changed is None or time.time() - changed >= STABLE_S:
            self._dirs[key] = (sig, days, changed)
        else:
            self._dirs.pop(key, None)
        return days, changed

    def _manifest(self, sym: str) -> tuple:
        """(dias hechos, dias a revisar) del manifiesto de ingest.py, leido de nuevo solo si cambio."""
        path = self.root / "manifest" / f"{sym}.jsonl"
        try:
            st = path.stat()
        except OSError:
            return set(), 0
        sig = (st.st_mtime_ns, st.st_size)
        hit = self._manifests.get(sym)
        if hit and hit[0] == sig:
            return hit[1], hit[2]
        done, review = {}, 0
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                try:
                    r = json.loads(line)
                    done[r["date"]] = r.get("status")
                except Exception:
                    pass
        except OSError:
            return set(), 0
        review = sum(1 for s in done.values() if s != "ok")
        self._manifests[sym] = (sig, set(done), review)
        return set(done), review

    def _status(self, sym: str) -> Optional[dict]:
        try:
            return json.loads((self.root / f"status_{sym}.json").read_text(encoding="utf-8"))
        except Exception:
            return None

    def symbols_on_disk(self) -> set:
        """Las monedas con historia (tape/, store/), con su avance (status_MONEDA.json) o con candado de descarga en
        work/: una descarga del panel que recien empieza solo tiene su candado."""
        out = set()
        for sub in ("tape", "store"):
            try:
                out |= {e.name for e in os.scandir(self.root / sub) if e.is_dir() and SYM_RE.match(e.name)}
            except OSError:
                pass
        try:
            out |= {p.name[7:-5] for p in self.root.glob("status_*.json") if SYM_RE.match(p.name[7:-5])}
            out |= {p.stem for p in (self.root / "work").glob("*.lock") if SYM_RE.match(p.stem)}
        except OSError:
            pass
        return out

    def scan(self, extra=()) -> Dict[str, dict]:
        """Lo que hay de cada moneda con historia o pedida (en otro hilo: lee carpetas)."""
        out = {}
        work = self.root / "work"
        for sym in sorted(self.symbols_on_disk() | set(extra)):
            tape, _ = self._days(self.root / "tape" / sym, "tape")
            store, store_t = self._days(self.root / "store" / sym, "npz")
            flow, flow_t = self._days(self.root / "flow" / sym, "npz")
            done, review = self._manifest(sym)
            changed = max([t for t in (store_t, flow_t) if t], default=None)
            out[sym] = {
                "lock": lock_busy(work / f"{sym}.lock"),
                "tape_days": len(tape), "first_day": min(tape) if tape else None, "last_day": max(tape) if tape else None,
                "store_days": len(store), "store_last": max(store) if store else None,
                "missing_store": len(tape - store), "missing_flow": len(tape - flow) if store else len(tape),
                "manifest_days": len(done), "review": review, "status": self._status(sym), "changed_at": changed,
                "_done": done,
            }
        return out

    # ---------- lo que publica Bybit ----------
    async def listing(self, sym: str, fresh: bool = False):
        """Dias que Bybit publica de la moneda (su carpeta de public.bybit.com/trading). [] si no publica ninguno,
        None si no se pudo leer. Se guarda 6 horas."""
        hit = self.listings.get(sym)
        if hit and not fresh and self.now() - hit[0] < LISTING_TTL_S and hit[1] is not None:
            return hit[1]
        days = None
        try:
            if self._fetch_listing:
                days = await self._fetch_listing(sym)
            else:
                http = self._http()
                if http is None:
                    return hit[1] if hit else None
                r = await http.get(LISTING_URL.format(sym=sym), timeout=30)
                if r.status_code == 404:
                    days = []
                else:
                    r.raise_for_status()
                    days = parse_listing(r.text, sym)
        except Exception as e:
            logger.warning(f"[COINS] sin la lista de dias de Bybit de {sym}: {type(e).__name__}")
            days = None
        if days is None:
            # no se pudo leer: se vuelve a intentar en 30 min, y mientras tanto queda la ultima conocida
            self.listings[sym] = (self.now() - LISTING_TTL_S + 1800, hit[1] if hit else None)
            return hit[1] if hit else None
        self.listings[sym] = (self.now(), days)
        return days

    # ---------- pedidos ----------
    def requests(self, coins: dict = None) -> list:
        """[(hora del pedido, moneda, pedido)] en orden de llegada."""
        coins = self.registry.load() if coins is None else coins
        out = []
        for sym, entry in coins.items():
            h = (entry or {}).get("history")
            if isinstance(h, dict) and h.get("requested_at"):
                out.append((h["requested_at"], sym, h))
        return sorted(out)

    async def request(self, sym: str) -> dict:
        """Pide bajar la historia de la moneda. Se baja cuando no baje otra."""
        ok = self.available()
        if not ok["ok"]:
            raise ValueError(f"no se puede bajar la historia: {ok['why']}")
        days = await self.listing(sym, fresh=True)
        if days is None:
            raise RuntimeError(f"no se pudo leer en Bybit la lista de dias de {sym}")
        if not days:
            raise ValueError(f"Bybit no publica trades diarios de {sym}")
        done, _ = self._manifest(sym)
        missing = [d for d in days if d not in done]
        if not missing:
            raise ValueError(f"{sym} ya tiene todos los dias que publica Bybit ({len(days)})")
        coins = self.registry.load()
        entry = dict(coins.get(sym) or {})
        entry["store"] = True
        if not (isinstance(entry.get("history"), dict) and entry["history"].get("requested_at")):
            entry["history"] = {"requested_at": int(self.now() * 1000)}
        coins[sym] = entry
        self.registry.save(coins)
        self.wake()
        # first y last: el tramo de lo que falta (lo que se va a bajar), no todo lo que publica Bybit
        return {"days": len(days), "missing": len(missing), "first": missing[0], "last": missing[-1],
                "listed_first": days[0], "listed_last": days[-1]}

    def cancel(self, sym: str, quiet: bool = False) -> bool:
        """Saca la moneda de la espera. La que ya baja se detiene con stop() (quiet: sin error, la deja seguir)."""
        coins = self.registry.load()
        entry = dict(coins.get(sym) or {})
        h = entry.get("history")
        if not isinstance(h, dict):
            return False
        if h.get("started_at") and (self.facts.get(sym) or {}).get("lock"):
            if quiet:
                return False
            raise ValueError(f"{sym} ya se esta bajando: se detiene con «Detener»")
        entry.pop("history", None)
        coins[sym] = entry
        self.registry.save(coins)
        return True

    def stop(self) -> dict:
        """Como "Detener" del panel: la descarga en curso termina el dia que baja y se cierra. Las pedidas que esperan
        se cancelan, para que no empiece otra."""
        if not self.enabled:
            raise ValueError(self.available()["why"])
        running = sorted(s for s, f in self.facts.items() if f.get("lock"))
        if self.proc and self.proc[1].poll() is None and self.proc[0] not in running:
            running.append(self.proc[0])
        if not running:
            raise ValueError("no hay ninguna descarga en curso")
        write_control(self.root, stop=True)
        self.stop_requested = True
        coins = self.registry.load()
        cancelled = []
        for _, sym, h in self.requests(coins):
            if not h.get("started_at"):
                entry = dict(coins[sym])
                entry.pop("history", None)
                coins[sym] = entry
                cancelled.append(sym)
        if cancelled:
            self.registry.save(coins)
        self.wake()
        return {"stopping": running, "cancelled": cancelled}

    # ---------- la vuelta ----------
    def wake(self):
        if self._wake is not None:
            self._wake.set()

    def start(self):
        """La vuelta corre siempre: apagada (enabled False) solo lee lo que hay en el disco."""
        if self._task is None:
            self._task = asyncio.create_task(self._loop())

    async def stop_loop(self):
        for task in (self._task, self._build_task):
            if task:
                task.cancel()
        self._task = None
        self._build_task = None

    async def _loop(self):
        self._wake = asyncio.Event()
        while True:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self.last_error = f"{type(e).__name__}: {e}"[:300]
                logger.error(f"[COINS] {e}")
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=TICK_S)
            except asyncio.TimeoutError:
                pass
            self._wake.clear()

    def busy(self) -> set:
        """Monedas que baja alguien o arma esta suite: official.py no las toca en esa vuelta."""
        out = {s for s, f in self.facts.items() if f.get("lock")}
        if self.proc and self.proc[1].poll() is None:
            out.add(self.proc[0])
        if self.building:
            out.add(self.building)
        return out

    async def tick(self):
        self.last_error = None
        if not self.tools_ok():
            self.facts = {}
            return
        try:
            asked = [s for _, s, _ in self.requests()]
        except Exception:
            asked = []
        facts = await asyncio.to_thread(self.scan, asked)
        now = self.now()
        running = {s for s, f in facts.items() if f["lock"]}
        if self.proc is not None:
            sym, proc = self.proc
            code = proc.poll()
            if code is None:
                running.add(sym)
            else:
                self.proc = None
                self.proc_result[sym] = {"at": int(now * 1000), "code": code,
                                         "detail": tail(self.out / f"{sym}_descarga.txt", 300) if code else ""}
        if self._running is not None:
            for sym in self._running - running:
                self.ended[sym] = now
        self._running = running
        for sym in running:
            done = ((facts.get(sym) or {}).get("status") or {}).get("hechos")
            if isinstance(done, int):
                rows = self.samples.setdefault(sym, [])
                if not rows or rows[-1][1] != done:
                    rows.append((now, done))
                self.samples[sym] = [r for r in rows if now - r[0] <= RATE_WINDOW_S] or rows[-1:]
        self.facts = facts
        self.last_tick = int(now * 1000)
        # El registro se lee despues de la espera de arriba y se guarda sin esperar nada en medio: un cambio de una ruta
        # no se pierde
        try:
            coins = self.registry.load()
        except Exception as e:
            self.last_error = str(e)[:300]
            return
        if not self.enabled:
            return
        pending = self.requests(coins)

        # Pedidos que ya empezaron y terminaron (aqui o mientras la suite estaba cerrada): se cumplieron
        changed = False
        for _, sym, h in pending:
            if h.get("started_at") and sym not in running:
                entry = dict(coins[sym])
                entry.pop("history", None)
                coins[sym] = entry
                changed = True
        if changed:
            self.registry.save(coins)
            pending = self.requests(coins)

        queue_busy = lock_busy(self.root / "work" / "cola.lock")
        if self.stop_requested and not running:
            if read_control(self.root).get("stop"):
                write_control(self.root, stop=False)
            self.stop_requested = False

        # Una descarga a la vez: la primera pedida, cuando no baja ninguna y la cola del panel no esta activa
        waiting = [sym for _, sym, h in pending if not h.get("started_at")]
        if waiting and not running and not queue_busy and self.building is None and not self.stop_requested:
            self._start_download(waiting[0])

        # Armar el almacen que le falta a una moneda, de a una
        if self.building is None and not (self._build_task and not self._build_task.done()):
            for sym, f in facts.items():
                if self._should_build(sym, f, running, now):
                    self._build_task = asyncio.create_task(self._build(sym, f))
                    break

        # La lista de dias de Bybit de las que tienen almacen o se bajan, una por vuelta
        for sym, f in facts.items():
            if not self.store_on(sym, f) and sym not in running:
                continue
            hit = self.listings.get(sym)
            if hit is None or now - hit[0] >= LISTING_TTL_S:
                await self.listing(sym)
                break

    def _start_download(self, sym: str):
        """Lanza ingest.py de la moneda y anota en el registro que empezo. Sin esperas: el registro se lee y se guarda
        de una vez."""
        try:
            free_gb = shutil.disk_usage(self.root).free / 1e9
        except OSError:
            free_gb = None
        if free_gb is not None and free_gb < MIN_FREE_GB:
            self.proc_result[sym] = {"at": int(self.now() * 1000), "code": None,
                                     "detail": f"queda poco espacio en el disco ({free_gb:.1f} GB): ingest.py se detiene con menos de 5"}
            return
        control = read_control(self.root)
        if control.get("stop") or control.get("pause"):
            write_control(self.root, stop=False, pause=False)   # como el panel al lanzar una descarga
        args = [self.python, "-I", str(self.tools / "ingest.py"), sym]
        try:
            proc = launch(args, self.tools, self.out / f"{sym}_descarga.txt")
        except Exception as e:
            proc = None
            self.proc_result[sym] = {"at": int(self.now() * 1000), "code": None, "detail": f"no se pudo lanzar: {e}"[:300]}
        coins = self.registry.load()
        entry = dict(coins.get(sym) or {})
        if proc is None:
            entry.pop("history", None)
            coins[sym] = entry
            self.registry.save(coins)
            return
        self.proc = (sym, proc)
        self.proc_result.pop(sym, None)
        h = dict(entry.get("history") or {})
        h["started_at"] = int(self.now() * 1000)
        entry["history"] = h
        coins[sym] = entry
        self.registry.save(coins)
        logger.info(f"[COINS] bajando la historia de {sym} (proceso {proc.pid})")
        print(f"[SUITE] Monedas: bajando la historia de {sym} con ingest.py (proceso {proc.pid})", flush=True)

    def _should_build(self, sym: str, f: dict, running: set, now: float) -> bool:
        if sym in running or not f["tape_days"]:
            return False
        if f["missing_store"] <= 0 and f["missing_flow"] <= 0:
            return False
        if not self.store_on(sym, f):
            return False
        if self.official_busy():
            return False   # official.py arma lo suyo sin candado: se espera a que termine su vuelta
        if f["changed_at"] and now - f["changed_at"] < QUIET_S:
            return False
        ended = self.ended.get(sym)
        if ended and now - ended < AFTER_DOWNLOAD_S:
            return False
        last = self.build_result.get(sym)
        if last and not last["ok"] and now - last["at"] / 1000 < RETRY_BUILD_S:
            return False
        if last and last["ok"] and last.get("missing_after", 0) > 0 and now - last["at"] / 1000 < RETRY_BUILD_S \
                and last.get("tape_days") == f["tape_days"]:
            return False   # ya se armo con estos mismos dias y le siguen faltando: no se insiste
        return True

    async def _build(self, sym: str, before: dict):
        """Arma el almacen de la moneda con build_store.py. Se lanza aparte, como la descarga: si la suite se cierra a
        medias, termina igual (y la suite que vuelve espera a que deje de escribir)."""
        self.building = sym
        began = self.now()
        detail, ok, code = "", False, None
        log = self.out / f"{sym}_almacen.txt"
        try:
            proc = launch([self.python, "-B", str(self.tools / "build_store.py"), sym], self.tools, log)
            while proc.poll() is None:
                if self.now() - began > BUILD_TIMEOUT_S:
                    proc.kill()
                    break
                await asyncio.sleep(BUILD_POLL_S)
            code = proc.wait()
            detail = tail(log, 400)
            ok = code == 0
        except asyncio.CancelledError:
            raise
        except Exception as e:
            detail = f"no se pudo armar: {e}"[:400]
        finally:
            self.building = None
        after = (await asyncio.to_thread(self.scan, [sym])).get(sym) or before
        self.facts[sym] = after
        missing_before = before["missing_store"] + before["missing_flow"]
        missing_after = after["missing_store"] + after["missing_flow"]
        self.build_result[sym] = {"at": int(self.now() * 1000), "ok": ok, "code": code, "seconds": round(self.now() - began, 1),
                                  "detail": detail[-300:], "missing_before": missing_before,
                                  "missing_after": missing_after, "tape_days": after["tape_days"]}
        logger.info(f"[COINS] almacen de {sym}: {'armado' if ok else 'fallo'} (faltaban {missing_before}, faltan {missing_after})")
        print(f"[SUITE] Monedas: almacen de {sym} {'armado' if ok else 'no se pudo armar'} en {round(self.now() - began)} s "
              f"(faltaban {before['missing_store']} dias, faltan {after['missing_store']})", flush=True)

    # ---------- lo que ve la pagina ----------
    def progress(self, sym: str) -> Optional[dict]:
        """Avance de la descarga en curso, de status_MONEDA.json, con la velocidad de los ultimos 30 min."""
        f = self.facts.get(sym) or {}
        st = f.get("status") or {}
        done, left = st.get("hechos"), st.get("pendientes")
        if not isinstance(done, int) or not isinstance(left, int):
            return None
        out = {"done": done, "left": left, "pct": round(100 * done / (done + left), 1) if done + left else None,
               "updated": st.get("actualizado"), "day": st.get("ultimo_dia"), "mb_s": st.get("mb_s"), "eta_h": None,
               "per_hour": None}
        rows = self.samples.get(sym) or []
        if len(rows) >= 2 and rows[-1][0] - rows[0][0] >= 300:
            rate = (rows[-1][1] - rows[0][1]) / ((rows[-1][0] - rows[0][0]) / 3600)
            if rate > 0:
                out["per_hour"] = round(rate)
                out["eta_h"] = round(left / rate, 1)
        return out

    def waiting(self, coins: dict) -> list:
        """Las pedidas que esperan su turno, en orden."""
        return [s for _, s, h in self.requests(coins) if not h.get("started_at")]

    def state(self, sym: str, store_on: bool, coins: dict, waiting: list) -> dict:
        """El almacen de una moneda para su fila: en que esta y que se puede hacer. coins: el registro ya leido;
        waiting: waiting(coins)."""
        f = self.facts.get(sym)
        h = ((coins.get(sym) or {}).get("history")) or {}
        listing = (self.listings.get(sym) or (None, None))[1]
        out = {"state": None, "store_on": store_on, "tape_days": 0, "store_days": 0, "store_last": None, "first_day": None,
               "missing_store": 0, "missing_flow": 0, "remote_days": len(listing) if listing is not None else None,
               "missing_remote": None, "progress": None, "queue_position": None, "building": self.building == sym,
               "build": self.build_result.get(sym), "launch": self.proc_result.get(sym), "review": 0}
        if f:
            out.update({k: f[k] for k in ("tape_days", "store_days", "store_last", "first_day", "missing_store",
                                          "missing_flow", "review")})
            if listing is not None:
                out["missing_remote"] = len([d for d in listing if d not in f["_done"]])
        running = bool(f and f["lock"]) or bool(self.proc and self.proc[0] == sym and self.proc[1].poll() is None)
        if running:
            out["state"] = "bajando"
            out["progress"] = self.progress(sym)
        elif sym in waiting:
            out["state"] = "en_espera"
            out["queue_position"] = waiting.index(sym) + 1
        elif self.building == sym:
            out["state"] = "armando"
        elif not f or (not f["tape_days"] and not f["store_days"]):
            out["state"] = "sin_historia"
        elif out["missing_remote"] is not None and out["missing_remote"] > NEAR_COMPLETE:
            out["state"] = "a_medias"
        elif out["missing_remote"] is None and isinstance((f.get("status") or {}).get("pendientes"), int) \
                and f["status"]["pendientes"] > 0:
            out["state"] = "a_medias"
        elif f["missing_store"] > 0 or f["missing_flow"] > 0:
            out["state"] = "por_armar"
        else:
            out["state"] = "al_dia"
        if h.get("requested_at") and not h.get("started_at"):
            out["requested_at"] = h["requested_at"]
        return out

    def summary(self) -> dict:
        running = sorted(s for s, f in self.facts.items() if f.get("lock"))
        if self.proc and self.proc[1].poll() is None and self.proc[0] not in running:
            running.append(self.proc[0])
        try:
            waiting = [s for _, s, h in self.requests() if not h.get("started_at")]
        except Exception:
            waiting = []
        return {"available": self.available(), "running": running, "waiting": waiting, "building": self.building,
                "queue_busy": lock_busy(self.root / "work" / "cola.lock") if self.tools_ok() else False,
                "control": read_control(self.root) if self.tools_ok() else None, "stopping": self.stop_requested,
                "ours": self.proc[0] if self.proc and self.proc[1].poll() is None else None,
                "last_tick": self.last_tick, "error": self.last_error, "tools": str(self.tools)}
