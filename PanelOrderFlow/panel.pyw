#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Panel Order Flow: descargas de trades de Bybit y estado del collector de App 9.

Pestaña "Descargas de Bybit"
    Maneja las herramientas de OrderFlowData\\tools sin cambiarlas: ingest.py (baja y
    compacta los trades diarios), build_store.py (almacén de App 1) y queue_runner.py
    (cola de monedas). Pausa, reanuda y detiene con control.json, como dice LEEME.txt:
    cada día se verifica y se anota en manifest, así que ninguno se pierde ni se repite.

Pestaña "Collector de App 9"
    Solo lee: collector en la nube (Northflank), backend local de App 9 (puerto 11000)
    y el archivo de footprints que App 9 guarda en su carpeta de datos.

El panel no guarda estado propio: todo sale de los archivos y de los procesos en marcha.
Cerrar la ventana no detiene ninguna descarga.

Abrir: doble clic en "Abrir panel.bat".
Pruebas: --datos CARPETA usa otra copia de OrderFlowData; --solo-lectura desactiva los botones.
"""
import ctypes
import datetime as dt
import gzip
import hashlib
import http.client
import json
import msvcrt
import os
import queue
import re
import shutil
import ssl
import subprocess
import sys
import threading
import time
import traceback
import urllib.parse
from collections import deque
from ctypes import wintypes as wt
from pathlib import Path

import tkinter as tk
import tkinter.font as tkfont
from tkinter import messagebox, ttk

DEFAULT_DATA = r'C:\Users\inven\OrderFlowData'
CLOUD_URL = os.environ.get('PANEL_NUBE_URL', 'https://p01--altagracia--rxv8nrbhxln9.code.run').rstrip('/')
BACKEND_URL = os.environ.get('PANEL_BACKEND_URL', 'http://127.0.0.1:11000').rstrip('/')
BYBIT_TRADES = 'https://public.bybit.com/trading/'
USER_AGENT = 'PanelOrderFlow/1.0'
CONTROL_DEFAULTS = {'limit_rate': '500K', 'pause': False, 'stop': False}
RATES = [('250 KB/s', '250K'), ('500 KB/s', '500K'), ('1 MB/s', '1M'), ('2 MB/s', '2M'), ('Sin límite', '0')]
CURL_CODES = {
    6: 'sin internet o sin DNS', 7: 'no se pudo conectar', 18: 'archivo incompleto',
    22: 'Bybit respondió con error', 23: 'no se pudo escribir en disco', 28: 'tiempo agotado o muy lenta',
    35: 'falló la conexión segura', 52: 'el servidor no respondió', 56: 'conexión cortada',
}
REFRESH_S = 2.0
LOCAL_EVERY_S = 15
ROOT_EVERY_S = 60
LATEST_EVERY_S = 120
GAP_HOURS = 6
SYMBOL_RE = re.compile(r'^[A-Z0-9]{2,30}$')
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
WORK_FILE_RE = re.compile(r'^([A-Z0-9]+?)(\d{4}-\d\d-\d\d)\.csv\.gz(\.part)?$')

HELP = """Descargas de Bybit

• Descargar ahora: baja los días de la moneda que publica Bybit, del más nuevo al más viejo. Si ya estaba completa, solo baja los días nuevos.
• Pausar: termina el archivo en curso y espera. Reanudar sigue con el día siguiente.
• Detener: termina el archivo en curso y se cierra. También detiene la cola.
• Detener ya: corta en el acto. Solo se pierde el archivo a medias, que se vuelve a bajar la próxima vez.
• Ningún día se pierde ni se repite: cada día se verifica contra el original y queda anotado en manifest antes de borrar el archivo crudo.
• Cerrar este panel no detiene nada. Apagar el PC tampoco daña lo ya descargado.
• Cola: baja las monedas de queue.txt una tras otra y salta las que terminaron su última descarga, aunque haya sido con Desde. Detener cola deja terminar la moneda actual.
• Almacén de App 1: arma store\\ con los días bajados. App 1 los ve sin reiniciar.
• Velocidad máxima: rige desde el siguiente archivo. Pausar, Detener y la velocidad valen para todas las descargas a la vez.

Collector de App 9

• Nube: el collector de Northflank. Recoge trades de Bybit todo el día y guarda footprints de 1 minuto. El último footprint incluye lo que aún tiene en memoria (escribe a disco cada 10 velas).
• Backend local: 5.Order_flow\\backend en el puerto 11000, el que usa App 9. Solo recoge mientras está abierto.
• Archivo de App 9: la copia que App 9 baja de la nube mientras está abierta.
• Buscar huecos: cuenta los minutos sin footprint en las últimas 6 horas. En monedas de poco volumen un minuto sin trades también cuenta."""

CREATE_NEW_PROCESS_GROUP = 0x00000200
CREATE_NO_WINDOW = 0x08000000
CREATE_BREAKAWAY_FROM_JOB = 0x01000000
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
TH32CS_SNAPPROCESS = 0x00000002


# ---------------------------------------------------------------- rutas

class Paths:
    def __init__(self, data):
        self.data = Path(data)
        self.tools = self.data / 'tools'
        self.control = self.data / 'control.json'
        self.queue = self.data / 'queue.txt'
        self.manifest = self.data / 'manifest'
        self.logs = self.data / 'logs'
        self.work = self.data / 'work'
        self.tape = self.data / 'tape'
        self.store = self.data / 'store'
        self.repo = Path(__file__).resolve().parent.parent
        backend = self.repo / '5.Order_flow' / 'backend'
        self.app9_cache = backend / 'footprint_cache'
        self.app9_config = backend / 'config' / 'orderflow_config.json'
        appdata = os.environ.get('APPDATA') or str(Path.home() / 'AppData' / 'Roaming')
        self.app9_archive = Path(appdata) / 'orderflow-desktop' / 'footprint_archive'
        local = os.environ.get('LOCALAPPDATA') or str(Path.home() / 'AppData' / 'Local')
        self.out = Path(os.environ.get('PANEL_SALIDAS') or (Path(local) / 'PanelOrderFlow'))
        self.outputs = self.out / 'salidas'


def find_python():
    for c in (os.environ.get('PANEL_PYTHON'), r'C:\Python314\python.exe', str(Path(sys.executable).with_name('python.exe'))):
        if c and Path(c).exists():
            return c
    return 'python'


PYTHON = find_python()


# ---------------------------------------------------------------- formato

def fmt_int(n):
    return '' if n is None else f'{n:,}'


def fmt_gb(b):
    if not b:
        return ''
    if b >= 1e9:
        return f'{b / 1e9:.2f} GB'
    return f'{b / 1e6:.0f} MB' if b >= 1e7 else f'{b / 1e6:.1f} MB'


def fmt_mb(b):
    return f'{b / 1e6:.1f} MB'


def fmt_clock(t):
    if not t:
        return ''
    d = dt.datetime.fromtimestamp(t)
    return d.strftime('%H:%M') if d.date() == dt.date.today() else d.strftime('%d/%m %H:%M')


def fmt_ago(sec):
    if sec is None:
        return ''
    sec = max(0, sec)
    if sec < 90:
        return f'hace {int(sec)} s'
    if sec < 5400:
        return f'hace {int(sec // 60)} min'
    if sec < 48 * 3600:
        return f'hace {sec / 3600:.1f} h'
    return f'hace {int(sec // 86400)} d'


def fmt_hours(h):
    if h is None:
        return ''
    if h < 1:
        return f'≈ {max(1, int(round(h * 60)))} min'
    if h < 48:
        return f'≈ {h:.1f} h'
    return f'≈ {h / 24:.1f} días'


def valid_date(s):
    if not DATE_RE.match(s):
        return False
    try:
        dt.date.fromisoformat(s)
        return True
    except ValueError:
        return False


class HttpStatusError(Exception):
    def __init__(self, code):
        super().__init__(f'HTTP {code}')
        self.code = code


def short_error(e):
    if isinstance(e, HttpStatusError):
        return f'HTTP {e.code}'
    if isinstance(e, ConnectionRefusedError):
        return 'conexión rechazada'
    if isinstance(e, TimeoutError):
        return 'tiempo agotado'
    if isinstance(e, http.client.IncompleteRead):
        return 'la respuesta llegó cortada'
    if isinstance(e, ssl.SSLError):
        return 'falló la conexión segura'
    if isinstance(e, OSError) and getattr(e, 'winerror', None) in (11001, 11002):
        return 'sin internet o sin DNS'
    return f'{type(e).__name__}: {e}'[:160]


# ---------------------------------------------------------------- red

_SSL = ssl.create_default_context()


def http_get(url, timeout=30, local=False, method='GET'):
    """GET o HEAD de un solo pedido.

    No usa urllib: urllib manda "Connection: close", y con eso el proxy de Northflank
    corta las respuestas lentas a la mitad. Pide gzip: la consulta de huecos de BTC
    baja de 257 KB a 32 KB."""
    u = urllib.parse.urlsplit(url)
    path = (u.path or '/') + ('?' + u.query if u.query else '')
    if u.scheme == 'https':
        conn = http.client.HTTPSConnection(u.hostname, u.port or 443, timeout=timeout, context=_SSL)
    else:
        conn = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=timeout)
    headers = {'User-Agent': USER_AGENT}
    if method == 'GET':
        headers['Accept-Encoding'] = 'gzip'
    try:
        conn.request(method, path, headers=headers)
        r = conn.getresponse()
        body = r.read() if method == 'GET' else b''
        if r.status >= 400:
            raise HttpStatusError(r.status)
        if body and (r.getheader('Content-Encoding') or '').lower() == 'gzip':
            body = gzip.decompress(body)
        return r.status, r.headers, body
    finally:
        conn.close()


def http_json(url, timeout=30, local=False):
    return json.loads(http_get(url, timeout, local)[2].decode('utf-8', 'replace'))


# ---------------------------------------------------------------- archivos de control

def read_control(path):
    c = dict(CONTROL_DEFAULTS)
    try:
        c.update(json.loads(path.read_text(encoding='utf-8')))
        return c, None
    except FileNotFoundError:
        return c, None
    except Exception as e:
        return c, short_error(e)


def atomic_write(path, text):
    tmp = path.with_name(path.name + '.panel.tmp')
    tmp.write_text(text, encoding='utf-8')
    for i in range(40):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            time.sleep(0.05)
    try:
        tmp.unlink()
    except OSError:
        pass
    raise PermissionError(f'no se pudo escribir {path.name}: otro programa lo tiene abierto')


def write_control(path, **updates):
    try:
        c = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(c, dict):
            c = dict(CONTROL_DEFAULTS)
    except Exception:
        c = dict(CONTROL_DEFAULTS)
    c.update(updates)
    atomic_write(path, json.dumps(c, indent=1) + '\n')


def read_queue(path):
    """Monedas de queue.txt en orden, con las líneas de comentario para conservarlas."""
    try:
        lines = path.read_text(encoding='utf-8').splitlines()
    except FileNotFoundError:
        lines = []
    head, syms, original = [], [], {}
    for line in lines:
        sym = line.split('#')[0].strip().upper()
        if not sym:
            head.append(line)
        elif sym not in original:
            syms.append(sym)
            original[sym] = line
    return {'head': head, 'syms': syms, 'lines': original}


def write_queue(path, q, syms):
    head = q['head'] or ['# Orden de descarga, una moneda a la vez. Se puede editar mientras corre.']
    body = [q['lines'].get(s, s) for s in syms]
    atomic_write(path, '\n'.join(head + body) + '\n')


# ---------------------------------------------------------------- procesos de Windows

class _ProcessEntry(ctypes.Structure):
    _fields_ = [
        ('dwSize', wt.DWORD), ('cntUsage', wt.DWORD), ('th32ProcessID', wt.DWORD),
        ('th32DefaultHeapID', ctypes.c_size_t), ('th32ModuleID', wt.DWORD), ('cntThreads', wt.DWORD),
        ('th32ParentProcessID', wt.DWORD), ('pcPriClassBase', ctypes.c_long), ('dwFlags', wt.DWORD),
        ('szExeFile', ctypes.c_wchar * 260),
    ]


class _UnicodeString(ctypes.Structure):
    _fields_ = [('Length', ctypes.c_ushort), ('MaximumLength', ctypes.c_ushort), ('Buffer', ctypes.c_void_p)]


_k32 = ctypes.WinDLL('kernel32', use_last_error=True)
_ntdll = ctypes.WinDLL('ntdll')
_shell32 = ctypes.WinDLL('shell32')
_k32.CreateToolhelp32Snapshot.argtypes = [wt.DWORD, wt.DWORD]
_k32.CreateToolhelp32Snapshot.restype = ctypes.c_void_p
_k32.Process32FirstW.argtypes = [ctypes.c_void_p, ctypes.POINTER(_ProcessEntry)]
_k32.Process32FirstW.restype = wt.BOOL
_k32.Process32NextW.argtypes = [ctypes.c_void_p, ctypes.POINTER(_ProcessEntry)]
_k32.Process32NextW.restype = wt.BOOL
_k32.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
_k32.OpenProcess.restype = ctypes.c_void_p
_k32.CloseHandle.argtypes = [ctypes.c_void_p]
_k32.CloseHandle.restype = wt.BOOL
_k32.GetProcessTimes.argtypes = [ctypes.c_void_p] + [ctypes.POINTER(wt.FILETIME)] * 4
_k32.GetProcessTimes.restype = wt.BOOL
_k32.LocalFree.argtypes = [ctypes.c_void_p]
_k32.LocalFree.restype = ctypes.c_void_p
_ntdll.NtQueryInformationProcess.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong)]
_ntdll.NtQueryInformationProcess.restype = ctypes.c_long
_shell32.CommandLineToArgvW.argtypes = [wt.LPCWSTR, ctypes.POINTER(ctypes.c_int)]
_shell32.CommandLineToArgvW.restype = ctypes.POINTER(wt.LPWSTR)
_INVALID_HANDLE = ctypes.c_void_p(-1).value


def _process_details(pid):
    """Línea de comandos y hora de inicio de un proceso del mismo usuario."""
    h = _k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not h:
        return '', None
    try:
        cmd = ''
        need = ctypes.c_ulong(0)
        buf = ctypes.create_string_buffer(4096)
        st = _ntdll.NtQueryInformationProcess(h, 60, buf, len(buf), ctypes.byref(need))
        if st != 0 and need.value > len(buf):
            buf = ctypes.create_string_buffer(need.value + 16)
            st = _ntdll.NtQueryInformationProcess(h, 60, buf, len(buf), ctypes.byref(need))
        if st == 0:
            us = _UnicodeString.from_buffer(buf)
            if us.Buffer and us.Length:
                cmd = ctypes.wstring_at(us.Buffer, us.Length // 2)
        times = [wt.FILETIME() for _ in range(4)]
        created = None
        if _k32.GetProcessTimes(h, *[ctypes.byref(t) for t in times]):
            v = (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime
            created = v / 1e7 - 11644473600
        return cmd, created
    finally:
        _k32.CloseHandle(h)


def list_processes(names=('python.exe', 'pythonw.exe', 'curl.exe')):
    snap = _k32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if not snap or snap == _INVALID_HANDLE:
        raise OSError('no se pudo leer la lista de procesos')
    found = []
    try:
        pe = _ProcessEntry()
        pe.dwSize = ctypes.sizeof(_ProcessEntry)
        ok = _k32.Process32FirstW(snap, ctypes.byref(pe))
        while ok:
            name = pe.szExeFile.lower()
            if name in names:
                found.append({'pid': pe.th32ProcessID, 'ppid': pe.th32ParentProcessID, 'exe': name})
            ok = _k32.Process32NextW(snap, ctypes.byref(pe))
    finally:
        _k32.CloseHandle(snap)
    for p in found:
        p['cmd'], p['created'] = _process_details(p['pid'])
    return found


def split_args(cmd):
    if not cmd:
        return []
    n = ctypes.c_int(0)
    arr = _shell32.CommandLineToArgvW(cmd, ctypes.byref(n))
    if not arr:
        return cmd.split()
    try:
        return [arr[i] for i in range(n.value)]
    finally:
        _k32.LocalFree(ctypes.cast(arr, ctypes.c_void_p))


def _value_after(args, flag):
    for i, a in enumerate(args[:-1]):
        if a == flag:
            return args[i + 1]
    return None


def scan_tools(paths):
    """Procesos de ingest.py, build_store.py y queue_runner.py de esta carpeta de datos."""
    procs = list_processes()
    tools = os.path.normcase(os.path.abspath(str(paths.tools)))
    found = {'ingest': [], 'build': [], 'queue': []}
    curls = []
    for p in procs:
        if p['exe'] == 'curl.exe':
            curls.append(p)
            continue
        args = split_args(p['cmd'])
        for i, a in enumerate(args):
            base = os.path.basename(a).lower()
            if base not in ('ingest.py', 'build_store.py', 'queue_runner.py'):
                continue
            if os.path.isabs(a) and os.path.normcase(os.path.dirname(os.path.abspath(a))) != tools:
                break
            rest = args[i + 1:]
            item = {'pid': p['pid'], 'ppid': p['ppid'], 'pids': {p['pid']}, 'created': p['created'], 'args': rest}
            if base == 'ingest.py':
                item['sym'] = rest[0].upper() if rest and not rest[0].startswith('-') else '?'
                item['desde'] = _value_after(rest, '--desde')
                item['hasta'] = _value_after(rest, '--hasta')
                found['ingest'].append(item)
            elif base == 'build_store.py':
                item['sym'] = rest[0].upper() if rest else 'BTCUSDT'
                found['build'].append(item)
            else:
                found['queue'].append(item)
            break
    # Un python de venv lanza otro con la misma línea: se cuentan como uno
    for kind, items in found.items():
        keep = []
        for it in items:
            parent = next((o for o in items if o['pid'] == it['ppid'] and o['args'] == it['args']), None)
            if parent:
                parent['pids'].add(it['pid'])
            else:
                keep.append(it)
        found[kind] = keep
    for ing in found['ingest']:
        ing['curl'] = None
        for c in curls:
            if c['ppid'] in ing['pids']:
                args = split_args(c['cmd'])
                part = _value_after(args, '-o')
                m = re.search(r'(\d{4}-\d\d-\d\d)\.csv\.gz\.part$', part or '')
                ing['curl'] = {'pid': c['pid'], 'part': part, 'day': m.group(1) if m else None,
                               'rate': _value_after(args, '--limit-rate')}
                if m:
                    break
    return found


def kill_process(pid, tree):
    args = ['taskkill', '/PID', str(pid), '/F'] + (['/T'] if tree else [])
    r = subprocess.run(args, capture_output=True, creationflags=CREATE_NO_WINDOW)
    return r.returncode == 0


def launch(args, cwd, log_path, stdout_too):
    """Lanza un proceso sin ventana que sigue vivo aunque se cierre el panel."""
    log_path.parent.mkdir(parents=True, exist_ok=True)
    mode = 'ab' if log_path.exists() and log_path.stat().st_size < 1_000_000 else 'wb'
    f = open(log_path, mode)
    try:
        f.write(('\n--- %s %s\n' % (time.strftime('%Y-%m-%d %H:%M:%S'), subprocess.list2cmdline(args))).encode('utf-8'))
        f.flush()
        last = None
        for extra in (CREATE_BREAKAWAY_FROM_JOB, 0):
            try:
                return subprocess.Popen(args, cwd=str(cwd), stdin=subprocess.DEVNULL,
                                        stdout=f if stdout_too else subprocess.DEVNULL, stderr=f,
                                        creationflags=CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | extra,
                                        close_fds=True)
            except OSError as e:
                last = e
        raise last
    finally:
        f.close()


# ---------------------------------------------------------------- lectura incremental

class AppendReader:
    """Lee un archivo que solo crece, desde donde quedó la vez anterior."""

    def __init__(self, path, on_line, first_read_max=None):
        self.path, self.on_line, self.first_read_max = path, on_line, first_read_max
        self.pos, self.rest, self.version = 0, b'', 0

    def refresh(self):
        try:
            size = os.path.getsize(self.path)
        except OSError:
            return False
        if size < self.pos:
            self.pos, self.rest = 0, b''
        if size == self.pos:
            return False
        if self.pos == 0 and self.first_read_max and size > self.first_read_max:
            self.pos = size - self.first_read_max
        with open(self.path, 'rb') as f:
            f.seek(self.pos)
            chunk = f.read(size - self.pos)
        self.pos += len(chunk)
        lines = (self.rest + chunk).split(b'\n')
        self.rest = lines.pop()
        for line in lines:
            self.on_line(line.rstrip(b'\r'))
        self.version += 1
        return True


DAY_LINE = re.compile(r'^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) (\d{4}-\d\d-\d\d) (ok|revisar) ')
PROBLEM_LINE = re.compile(r'reintento descarga|fallo descarga|ERROR|sin tamano|disco casi lleno|Ya hay otra|Traceback')


def _local_ts(s):
    try:
        return time.mktime(time.strptime(s, '%Y-%m-%d %H:%M:%S'))
    except (ValueError, OverflowError):
        return None


def revisar_reason(r):
    v = r.get('velas')
    if not v:
        return 'no se pudieron consultar las velas oficiales'
    m = v.get('minutos') or 0
    if not m:
        return 'Bybit no dio velas oficiales para comparar'
    out = []
    c = m - (v.get('cierre') or 0) - (v.get('cierre_empate') or 0)
    if c:
        out.append(f'cierre distinto en {c} minuto' + ('s' if c != 1 else ''))
    vol = m - (v.get('volumen') or 0)
    if vol:
        out.append(f'volumen distinto en {vol} minuto' + ('s' if vol != 1 else ''))
    return ', '.join(out) or 'revisar'


def _scan_days(folder, sym, ext):
    out = set()
    pre = sym + '_'
    try:
        years = [y.path for y in os.scandir(folder) if y.is_dir()]
    except OSError:
        return out
    for y in years:
        try:
            for f in os.scandir(y):
                n = f.name
                if n.startswith(pre) and n.endswith(ext) and '.tmp' not in n:
                    out.add(n[len(pre):len(pre) + 10])
        except OSError:
            pass
    return out


class Coin:
    def __init__(self, paths, sym):
        self.p, self.sym = paths, sym
        self.days = {}
        self.manifest = AppendReader(paths.manifest / f'{sym}.jsonl', self._manifest_line)
        self.errors = []
        self.errors_reader = AppendReader(paths.manifest / f'{sym}.errors.jsonl', self._error_line)
        self.tail = deque(maxlen=300)
        self.problems = deque(maxlen=200)
        self.problems_total = 0
        self.fallos = 0
        self.day_times = deque(maxlen=80)
        self.inicio = None
        self.log = AppendReader(paths.logs / f'{sym}.log', self._log_line, first_read_max=20_000_000)
        self.status, self.status_mtime = None, None
        self.sizes, self.sizes_mtime = {}, None
        self.tape_days, self.store_days = set(), set()
        self.counted_at, self.counted_done = 0, -1
        self.agg_version, self.agg = -1, None

    def _manifest_line(self, line):
        try:
            r = json.loads(line)
            if r.get('date'):
                self.days[r['date']] = r
        except ValueError:
            pass

    def _error_line(self, line):
        try:
            self.errors.append(json.loads(line))
        except ValueError:
            pass

    def _log_line(self, raw):
        line = raw.decode('utf-8', 'replace')
        if not line:
            return
        self.tail.append(line)
        m = DAY_LINE.match(line)
        if m:
            t = _local_ts(m.group(1))
            if t:
                self.day_times.append(t)
        elif ' inicio ' in line:
            self.inicio = line
        if PROBLEM_LINE.search(line):
            self.problems.append(line)
            self.problems_total += 1
            if 'fallo descarga' in line:
                self.fallos += 1

    def refresh(self, now, building):
        self.manifest.refresh()
        self.errors_reader.refresh()
        self.log.refresh()
        st_path = self.p.data / f'status_{self.sym}.json'
        try:
            m = st_path.stat().st_mtime
            if m != self.status_mtime:
                self.status = json.loads(st_path.read_text(encoding='utf-8'))
                self.status_mtime = m
        except (OSError, ValueError):
            pass
        sz_path = self.p.manifest / f'{self.sym}.sizes.json'
        try:
            m = sz_path.stat().st_mtime
            if m != self.sizes_mtime:
                self.sizes = json.loads(sz_path.read_text(encoding='utf-8'))
                self.sizes_mtime = m
        except (OSError, ValueError):
            pass
        every = 5 if building else 30
        if len(self.days) != self.counted_done or now - self.counted_at > every:
            self.tape_days = _scan_days(self.p.tape / self.sym, self.sym, '.tape')
            self.store_days = _scan_days(self.p.store / self.sym, self.sym, '.npz')
            self.counted_at, self.counted_done = now, len(self.days)
        if self.manifest.version != self.agg_version:
            rows = self.days.values()
            self.agg = {
                'done': len(self.days),
                'oldest': min(self.days) if self.days else None,
                'newest': max(self.days) if self.days else None,
                'revisar': sorted(((d, revisar_reason(r)) for d, r in self.days.items() if r.get('status') != 'ok'), reverse=True),
                'tape_bytes': sum(r.get('tape') or 0 for r in rows),
            }
            self.agg_version = self.manifest.version

    def rate_days_per_hour(self):
        if len(self.day_times) < 5:
            return None
        last = self.day_times[-1]
        recent = [t for t in self.day_times if last - t <= 7200]
        if len(recent) < 5 or recent[-1] - recent[0] < 600:
            return None
        return (len(recent) - 1) / ((recent[-1] - recent[0]) / 3600)


# ---------------------------------------------------------------- estado de las descargas

def _continuous(done, newest, remote_days):
    """Primer día del tramo sin huecos que termina en el día más nuevo, y cuántos días bajados quedan antes."""
    if not newest:
        return None, 0
    first = newest
    if remote_days:
        i = len(remote_days) - 1
        while i >= 0 and remote_days[i] > newest:
            i -= 1
        while i - 1 >= 0 and remote_days[i - 1] in done:
            i -= 1
        if i >= 0:
            first = remote_days[i]
    else:
        d = dt.date.fromisoformat(newest)
        while (d - dt.timedelta(days=1)).isoformat() in done:
            d -= dt.timedelta(days=1)
        first = d.isoformat()
    return first, sum(1 for x in done if x < first)


class DataReader:
    def __init__(self, paths, remote):
        self.p, self.remote = paths, remote
        self.coins = {}
        self.extra = set()
        self.extra_lock = threading.Lock()
        self.parts = {}
        self.disk, self.disk_at = None, 0

    def add_symbol(self, sym):
        with self.extra_lock:
            self.extra.add(sym)

    def _symbols(self, queue_syms, procs):
        with self.extra_lock:
            syms = set(queue_syms) | self.extra
        try:
            for f in os.scandir(self.p.manifest):
                n = f.name
                if n.endswith('.jsonl') and not n.endswith('.errors.jsonl'):
                    syms.add(n[:-6].upper())
        except OSError:
            pass
        try:
            for f in os.scandir(self.p.data):
                n = f.name
                if n.startswith('status_') and n.endswith('.json'):
                    syms.add(n[7:-5].upper())
        except OSError:
            pass
        for kind in ('ingest', 'build'):
            for it in procs[kind]:
                if SYMBOL_RE.match(it.get('sym') or ''):
                    syms.add(it['sym'])
        return {s for s in syms if SYMBOL_RE.match(s)}

    def _work(self, now):
        parts, pending = {}, {}
        try:
            entries = list(os.scandir(self.p.work))
        except OSError:
            entries = []
        seen = set()
        for e in entries:
            m = WORK_FILE_RE.match(e.name)
            if not m:
                continue
            sym, day, is_part = m.group(1), m.group(2), bool(m.group(3))
            try:
                st = e.stat()
            except OSError:
                continue
            if is_part:
                key = e.path
                seen.add(key)
                prev = self.parts.get(key)
                speed = None
                if prev and st.st_size >= prev[0] and now > prev[1]:
                    inst = (st.st_size - prev[0]) / (now - prev[1])
                    speed = inst if prev[2] is None else 0.6 * prev[2] + 0.4 * inst
                self.parts[key] = (st.st_size, now, speed)
                growing = bool(prev and st.st_size > prev[0])
                old = parts.get(sym)
                if old is None or st.st_mtime > old['mtime']:
                    parts[sym] = {'day': day, 'size': st.st_size, 'speed': speed, 'mtime': st.st_mtime, 'growing': growing}
            elif now - st.st_mtime < 300:
                pending[sym] = day
        for k in list(self.parts):
            if k not in seen:
                del self.parts[k]
        try:
            fallidos = [e.name for e in os.scandir(self.p.work / 'fallidos')]
        except OSError:
            fallidos = []
        return parts, pending, fallidos

    def refresh(self, selected):
        now = time.time()
        snap = {'at': now, 'scan_error': None}
        try:
            procs = scan_tools(self.p)
        except Exception as e:
            procs = {'ingest': [], 'build': [], 'queue': []}
            snap['scan_error'] = short_error(e)
        snap['procs'] = procs
        snap['control'], snap['control_error'] = read_control(self.p.control)
        q = read_queue(self.p.queue)
        snap['queue'] = q['syms']
        if now - self.disk_at > 30:
            try:
                self.disk = shutil.disk_usage(self.p.data).free
            except OSError:
                self.disk = None
            self.disk_at = now
        snap['disk_free'] = self.disk
        parts, pending, fallidos = self._work(now)
        building = {b['sym'] for b in procs['build']}
        running = {i['sym']: i for i in procs['ingest']}
        coins = {}
        snap['coin_errors'] = {}
        for sym in sorted(self._symbols(q['syms'], procs)):
            try:
                coins[sym] = self._coin_info(sym, now, building, running, parts, pending)
            except Exception as e:
                # Una moneda con datos raros no debe tapar a las demás
                snap['coin_errors'][sym] = short_error(e)
        snap['coins'] = coins
        snap['fallidos'] = fallidos
        if selected and selected in self.coins and selected in coins:
            c = self.coins[selected]
            out = self.p.outputs / f'{selected}_descarga.txt'
            salida = []
            try:
                salida = [l for l in out.read_text(encoding='utf-8', errors='replace').splitlines()[-40:] if l.strip()]
            except OSError:
                pass
            snap['selected'] = {
                'sym': selected, 'tail': list(c.tail), 'problems': list(c.problems), 'errors': list(c.errors[-50:]),
                'problems_total': c.problems_total, 'errors_total': len(c.errors), 'fallos': c.fallos,
                'log_version': c.log.version, 'salida': salida,
                'fallidos': [f for f in fallidos if f.startswith(selected)],
            }
        return snap

    def _coin_info(self, sym, now, building, running, parts, pending):
        c = self.coins.get(sym)
        if c is None:
            c = self.coins[sym] = Coin(self.p, sym)
        c.refresh(now, sym in building)
        a = c.agg
        lst = self.remote.listing(sym)
        remote_days = lst.get('days') if lst and not lst.get('error') else None
        info = dict(a)
        info.update({
            'status': c.status, 'errors_n': len(c.errors), 'fallos_n': c.fallos,
            'tape_n': len(c.tape_days), 'store_n': len(c.store_days),
            'store_missing': len(c.tape_days - c.store_days),
            'part': parts.get(sym), 'pending_day': pending.get(sym),
            'remote_n': len(remote_days) if remote_days is not None else None,
            'remote_first': remote_days[0] if remote_days else None,
            'remote_last': remote_days[-1] if remote_days else None,
            'remote_missing': None, 'run_missing': None, 'next_day': None, 'only_new_missing': False,
            'rate': c.rate_days_per_hour(),
        })
        info['cont_first'], info['loose'] = _continuous(c.days, a['newest'], remote_days)
        if remote_days is not None:
            missing = [d for d in remote_days if d not in c.days]
            info['remote_missing'] = len(missing)
            info['only_new_missing'] = bool(missing) and bool(a['newest']) and all(d > a['newest'] for d in missing)
            ing = running.get(sym)
            if ing:
                run = [d for d in missing if (not ing.get('desde') or d >= ing['desde']) and (not ing.get('hasta') or d <= ing['hasta'])]
                info['run_missing'] = len(run)
                # Baja de lo nuevo a lo viejo: sigue con el más nuevo de los que quedan antes del último que hizo
                st = c.status or {}
                upd = _local_ts((st.get('actualizado') or '').replace('T', ' ')) if st else None
                last = st.get('ultimo_dia') if upd and ing.get('created') and upd >= ing['created'] - 5 else None
                older = [d for d in run if last and d < last]
                info['next_day'] = max(older) if older else (max(run) if run else None)
        if info['part']:
            size = c.sizes.get(info['part']['day']) or self.remote.head_size(sym, info['part']['day'])
            info['part'] = dict(info['part'], total=size)
        return info


# ---------------------------------------------------------------- consultas a Bybit

class Remote:
    def __init__(self, post):
        self.post = post
        self.lock = threading.Lock()
        self.listings = {}
        self.heads = {}
        self.symbols = None
        self.tasks = deque()
        self.pending = set()
        self.event = threading.Event()
        self.closing = False

    def listing(self, sym):
        with self.lock:
            return self.listings.get(sym)

    def head_size(self, sym, day):
        with self.lock:
            size = self.heads.get((sym, day))
        if size is None:
            self._add(('head', sym, day), urgent=True)
        return size or None

    def want_listing(self, sym, urgent=False, max_age=6 * 3600):
        info = self.listing(sym)
        if info and time.time() - info['at'] < (600 if info.get('error') else max_age):
            return
        self._add(('list', sym), urgent)

    def want_symbols(self):
        self._add(('symbols',), False)

    def _add(self, key, urgent):
        with self.lock:
            if key in self.pending:
                if urgent:
                    try:
                        self.tasks.remove(key)
                        self.tasks.appendleft(key)
                    except ValueError:
                        pass
                return
            self.pending.add(key)
            (self.tasks.appendleft if urgent else self.tasks.append)(key)
        self.event.set()

    def fetch_listing(self, sym):
        try:
            _, _, body = http_get(BYBIT_TRADES + sym + '/', 40)
            html = body.decode('utf-8', 'replace')
            days = sorted(set(re.findall(re.escape(sym) + r'(\d{4}-\d{2}-\d{2})\.csv\.gz', html)))
            res = {'days': days, 'error': None, 'at': time.time()}
        except HttpStatusError as e:
            if e.code == 404:
                res = {'days': [], 'error': None, 'missing': True, 'at': time.time()}
            else:
                res = {'days': None, 'error': short_error(e), 'at': time.time()}
        except Exception as e:
            res = {'days': None, 'error': short_error(e), 'at': time.time()}
        with self.lock:
            self.listings[sym] = res
        return res

    def run(self):
        while not self.closing:
            with self.lock:
                key = self.tasks.popleft() if self.tasks else None
            if key is None:
                self.event.wait(5)
                self.event.clear()
                continue
            try:
                if key[0] == 'list':
                    self.fetch_listing(key[1])
                    self.post('remote', key[1])
                elif key[0] == 'head':
                    size = 0
                    try:
                        _, headers, _ = http_get(f'{BYBIT_TRADES}{key[1]}/{key[1]}{key[2]}.csv.gz', 25, method='HEAD')
                        size = int(headers.get('Content-Length') or 0)
                    except Exception:
                        pass
                    with self.lock:
                        self.heads[(key[1], key[2])] = size
                elif key[0] == 'symbols':
                    try:
                        _, _, body = http_get(BYBIT_TRADES, 40)
                        syms = sorted(set(re.findall(r'href="([A-Z0-9]+)/"', body.decode('utf-8', 'replace'))))
                        with self.lock:
                            self.symbols = syms
                        self.post('symbols', syms)
                    except Exception:
                        pass
            finally:
                with self.lock:
                    self.pending.discard(key)
            time.sleep(0.4)


# ---------------------------------------------------------------- collector de App 9

class Collector:
    def __init__(self, paths, post):
        self.p, self.post = paths, post
        self.lock = threading.Lock()
        self.cloud = {'ok': None, 'symbols': [], 'error': None, 'at': None, 'fail_since': None}
        self.latest = {}
        self.latest_progress = None
        self.gaps = {}
        self.gaps_progress = None
        self.gaps_at = None
        self.local = {'ok': None}
        self.cache, self.config_symbols, self.archive, self.archive_error = {}, [], {}, None
        self.force_local = threading.Event()
        self.force_cloud = threading.Event()
        self.want_gaps = False
        self.closing = False

    def state(self):
        with self.lock:
            return {
                'cloud': dict(self.cloud), 'latest': {k: dict(v) for k, v in self.latest.items()},
                'latest_progress': self.latest_progress, 'gaps': {k: dict(v) for k, v in self.gaps.items()},
                'gaps_progress': self.gaps_progress, 'gaps_at': self.gaps_at, 'local': dict(self.local),
                'cache': dict(self.cache), 'config_symbols': list(self.config_symbols),
                'archive': dict(self.archive), 'archive_error': self.archive_error,
            }

    def refresh_now(self):
        self.force_local.set()
        self.force_cloud.set()

    def request_gaps(self):
        self.want_gaps = True
        self.force_cloud.set()

    # backend local y archivos: cada 15 s
    def run_local(self):
        while not self.closing:
            self._poll_local()
            self._poll_files()
            self.post('col')
            self.force_local.wait(LOCAL_EVERY_S)
            self.force_local.clear()

    def _poll_local(self):
        now = time.time()
        try:
            d = http_json(BACKEND_URL + '/api/orderflow/status', 4, local=True)
            res = {'ok': True, 'running': bool(d.get('running')), 'enabled': d.get('enabled'),
                   'ws': bool(d.get('websocket_connected')), 'symbols': d.get('symbols') or [],
                   'trades': d.get('trades_received'), 'fps': d.get('footprints_completed'),
                   'uptime': d.get('uptime_seconds'), 'error': d.get('error') if d.get('success') is False else None, 'at': now}
        except ConnectionRefusedError:
            res = {'ok': False, 'off': True, 'error': 'apagado', 'at': now}
        except Exception as e:
            res = {'ok': False, 'off': False, 'error': short_error(e), 'at': now}
        with self.lock:
            self.local = res

    def _poll_files(self):
        cache = {}
        try:
            for e in os.scandir(self.p.app9_cache):
                m = re.match(r'^([A-Z0-9]+)_(1|5)\.json$', e.name)
                if m:
                    cache.setdefault(m.group(1), {})[m.group(2)] = e.stat().st_mtime
        except OSError:
            pass
        try:
            cfg = json.loads(self.p.app9_config.read_text(encoding='utf-8'))
            syms = [s.upper() for s in cfg.get('symbols') or []]
        except (OSError, ValueError):
            syms = []
        archive, err = {}, None
        try:
            for e in os.scandir(self.p.app9_archive):
                m = re.match(r'^([A-Z0-9]+)_1\.json$', e.name)
                if m:
                    st = e.stat()
                    archive[m.group(1)] = {'mtime': st.st_mtime, 'size': st.st_size}
        except FileNotFoundError:
            err = 'App 9 todavía no ha creado su archivo'
        except OSError as e:
            err = short_error(e)
        with self.lock:
            self.cache, self.config_symbols, self.archive, self.archive_error = cache, syms, archive, err

    # nube: raíz cada 60 s, último footprint cada 2 min, huecos a pedido
    def run_cloud(self):
        next_root = next_latest = 0
        while not self.closing:
            now = time.time()
            if self.force_cloud.is_set():
                self.force_cloud.clear()
                if not self.want_gaps:
                    next_root = next_latest = 0
            if now >= next_root:
                self._poll_root()
                next_root = time.time() + ROOT_EVERY_S
                self.post('col')
            if now >= next_latest and self.cloud.get('symbols'):
                self._poll_latest()
                next_latest = time.time() + LATEST_EVERY_S
            if self.want_gaps:
                self.want_gaps = False
                self._poll_gaps()
            self.force_cloud.wait(5)

    def _poll_root(self):
        now = time.time()
        try:
            d = http_json(CLOUD_URL + '/', 25)
            syms = [s.upper() for s in d.get('symbols') or []]
            with self.lock:
                self.cloud.update(ok=d.get('status') == 'running', symbols=syms, error=None if d.get('status') == 'running' else f"estado {d.get('status')}",
                                  at=now, fail_since=None, interval=d.get('interval'))
        except Exception as e:
            with self.lock:
                self.cloud.update(ok=False, error=short_error(e), at=now, fail_since=self.cloud.get('fail_since') or now)

    def _poll_latest(self):
        syms = list(self.cloud.get('symbols') or [])
        for i, sym in enumerate(syms):
            if self.closing:
                return
            with self.lock:
                self.latest_progress = (i, len(syms))
            now = time.time()
            try:
                d = http_json(f'{CLOUD_URL}/api/footprints/{sym}/latest', 30)
                fp = d.get('footprint')
                res = {'at': now, 'error': None, 'ts': None}
                if fp:
                    res.update(ts=fp.get('candle_timestamp'), step=fp.get('step_size'), levels=fp.get('num_levels'),
                               trades=fp.get('trade_count'), close=fp.get('candle_close'))
            except Exception as e:
                old = self.latest.get(sym) or {}
                res = dict(old, at=now, error=short_error(e))
            with self.lock:
                self.latest[sym] = res
            self.post('col')
            time.sleep(0.3)
        with self.lock:
            self.latest_progress = None
        self.post('col')

    def _poll_gaps(self):
        syms = list(self.cloud.get('symbols') or [])
        for i, sym in enumerate(syms):
            if self.closing:
                return
            with self.lock:
                self.gaps_progress = (i, len(syms))
            self.post('col')
            now = time.time()
            try:
                d = http_json(f'{CLOUD_URL}/api/footprints/{sym}?hours={GAP_HOURS}&interval=1', 120)
                have = {int(fp['candle_timestamp']) // 60000 for fp in d.get('footprints') or [] if fp.get('candle_timestamp')}
                cur = int(now // 60)
                expected = range(cur - GAP_HOURS * 60 + 5, cur - 1)
                missing = [m for m in expected if m not in have]
                res = {'at': now, 'error': None, 'missing': missing, 'expected': len(expected), 'runs': _runs(missing)}
            except Exception as e:
                res = {'at': now, 'error': short_error(e)}
            with self.lock:
                self.gaps[sym] = res
            time.sleep(0.5)
        with self.lock:
            self.gaps_progress = None
            self.gaps_at = time.time()
        self.post('col')


def _runs(minutes):
    """Agrupa minutos seguidos: [(primer minuto, cantidad)]."""
    runs = []
    for m in minutes:
        if runs and m == runs[-1][0] + runs[-1][1]:
            runs[-1][1] += 1
        else:
            runs.append([m, 1])
    return [tuple(r) for r in runs]


def fmt_runs(runs, limit=3):
    parts = []
    for start, n in sorted(runs, key=lambda r: -r[1])[:limit]:
        a = dt.datetime.fromtimestamp(start * 60).strftime('%H:%M')
        parts.append(a if n == 1 else f"{a}–{dt.datetime.fromtimestamp((start + n - 1) * 60).strftime('%H:%M')}")
    return ', '.join(parts)


# ---------------------------------------------------------------- ventana

class App:
    def __init__(self, root, paths, readonly):
        self.root, self.p, self.readonly = root, paths, readonly
        self.q = queue.Queue()
        self.remote = Remote(self.post)
        self.reader = DataReader(paths, self.remote)
        self.col = Collector(paths, self.post)
        self.selected = None
        self.snap = None
        self.children = []
        self.stop_requested = False
        self.reset_stop_when_idle = False
        self.autobuild = {}
        self.prev_ingest = None
        self.text_keys = {}
        self.action_busy = False
        self.note_text, self.note_at = '', 0
        self.all_symbols = []
        self.wake = threading.Event()
        self.closing = False
        self._fonts()
        self._build()
        for target in (self._data_loop, self.remote.run, self.col.run_local, self.col.run_cloud):
            threading.Thread(target=target, daemon=True).start()
        self.remote.want_symbols()
        root.protocol('WM_DELETE_WINDOW', self.on_close)
        root.after(200, self._drain)

    # ---------- utilidades de la ventana
    def post(self, kind, payload=None):
        self.q.put((kind, payload))

    def _fonts(self):
        for name in ('TkDefaultFont', 'TkTextFont', 'TkMenuFont', 'TkHeadingFont'):
            try:
                tkfont.nametofont(name).configure(family='Segoe UI', size=10)
            except tk.TclError:
                pass
        self.f_big = tkfont.Font(family='Segoe UI Semibold', size=11)
        self.f_bold = tkfont.Font(family='Segoe UI Semibold', size=10)
        self.f_small = tkfont.Font(family='Segoe UI', size=9)
        self.f_mono = tkfont.Font(family='Consolas', size=9)
        style = ttk.Style()
        style.configure('Treeview', rowheight=22)
        style.configure('Treeview.Heading', font=self.f_bold)

    def _text(self, parent, height, wrap='none'):
        fr = ttk.Frame(parent)
        t = tk.Text(fr, height=height, wrap=wrap, font=self.f_mono, state='disabled', relief='flat',
                    background='#fbfbfb', borderwidth=0, padx=4, pady=2)
        sy = ttk.Scrollbar(fr, orient='vertical', command=t.yview)
        sx = ttk.Scrollbar(fr, orient='horizontal', command=t.xview)
        t.configure(yscrollcommand=sy.set, xscrollcommand=sx.set)
        t.grid(row=0, column=0, sticky='nsew')
        sy.grid(row=0, column=1, sticky='ns')
        sx.grid(row=1, column=0, sticky='ew')
        fr.rowconfigure(0, weight=1)
        fr.columnconfigure(0, weight=1)
        t.tag_configure('err', foreground='#b00020')
        t.tag_configure('warn', foreground='#9a5200')
        t.tag_configure('ok', foreground='#1b6e2a')
        t.tag_configure('info', foreground='#555555')
        t.tag_configure('head', font=self.f_bold)
        return t

    def _set_text(self, t, chunks, follow_end):
        at_end = t.yview()[1] >= 0.999
        top = t.yview()[0]
        t.configure(state='normal')
        t.delete('1.0', 'end')
        for s, tag in chunks:
            t.insert('end', s, tag) if tag else t.insert('end', s)
        t.configure(state='disabled')
        if follow_end and at_end:
            t.see('end')
        else:
            t.yview_moveto(top)

    def _tree(self, parent, cols, height):
        fr = ttk.Frame(parent)
        tree = ttk.Treeview(fr, columns=[c[0] for c in cols], show='headings', height=height, selectmode='browse')
        for key, title, width, anchor in cols:
            tree.heading(key, text=title, anchor=anchor)
            tree.column(key, width=width, minwidth=40, anchor=anchor, stretch=key == cols[1][0])
        sb = ttk.Scrollbar(fr, orient='vertical', command=tree.yview)
        tree.configure(yscrollcommand=sb.set)
        tree.pack(side='left', fill='both', expand=True)
        sb.pack(side='right', fill='y')
        for tag, color in (('run', '#0b6e2e'), ('pause', '#9a5200'), ('done', '#4a4a4a'), ('idle', '#000000'),
                           ('bad', '#b00020'), ('late', '#9a5200'), ('ok', '#0b6e2e'), ('gray', '#777777')):
            tree.tag_configure(tag, foreground=color)
        return fr, tree

    @staticmethod
    def _enable(widget, on):
        widget.state(['!disabled'] if on else ['disabled'])

    def _bg(self, work, done):
        def run():
            try:
                res = work()
                err = None
            except Exception as e:
                res, err = None, e
            self.post('call', (done, res, err))
        threading.Thread(target=run, daemon=True).start()

    def note(self, text):
        self.note_text, self.note_at = text, time.time()
        self._render_bar()

    # ---------- armado de la ventana
    def _build(self):
        r = self.root
        r.title('Panel Order Flow · descargas y collector' + ('  (solo lectura)' if self.readonly else ''))
        w = min(1180, r.winfo_screenwidth() - 40)
        h = min(800, r.winfo_screenheight() - 90)
        r.geometry(f'{w}x{h}+20+10')
        r.minsize(min(1000, w), min(620, h))
        # La barra va primero para que nunca quede fuera en pantallas bajas
        self.bar = ttk.Label(r, text='Leyendo…', anchor='w', font=self.f_small, foreground='#555555')
        self.bar.pack(side='bottom', fill='x', padx=10, pady=(3, 6))
        nb = ttk.Notebook(r)
        nb.pack(fill='both', expand=True, padx=8, pady=(8, 0))
        t1, t2 = ttk.Frame(nb, padding=6), ttk.Frame(nb, padding=6)
        nb.add(t1, text='   Descargas de Bybit   ')
        nb.add(t2, text='   Collector de App 9   ')
        self.nb = nb
        self._build_downloads(t1)
        self._build_collector(t2)

    def _build_downloads(self, f):
        now = ttk.LabelFrame(f, text=' Ahora ', padding=(10, 4))
        now.pack(fill='x')
        self.lbl_now = tk.Label(now, text='Leyendo…', font=self.f_big, anchor='w', justify='left', wraplength=1120)
        self.lbl_now.pack(fill='x')
        self.lbl_now2 = ttk.Label(now, text='', anchor='w', justify='left', foreground='#444444', wraplength=1120)
        self.lbl_now2.pack(fill='x', pady=(1, 5))
        row = ttk.Frame(now)
        row.pack(fill='x', pady=(0, 2))
        self.b_pause = ttk.Button(row, text='Pausar', command=self.act_pause)
        self.b_resume = ttk.Button(row, text='Reanudar', command=self.act_resume)
        self.b_stop = ttk.Button(row, text='Detener', command=self.act_stop)
        self.b_kill = ttk.Button(row, text='Detener ya', command=self.act_stop_now)
        for b in (self.b_pause, self.b_resume, self.b_stop, self.b_kill):
            b.pack(side='left', padx=(0, 6))
        ttk.Label(row, text='Velocidad máxima:').pack(side='left', padx=(20, 4))
        self.cb_rate = ttk.Combobox(row, state='readonly', width=14, values=[l for l, _ in RATES])
        self.cb_rate.bind('<<ComboboxSelected>>', self.act_rate)
        self.cb_rate.pack(side='left')
        ttk.Button(row, text='Cómo funciona', command=lambda: messagebox.showinfo('Cómo funciona', HELP, parent=self.root)).pack(side='right')

        tbl = ttk.LabelFrame(f, text=' Monedas ', padding=(6, 4))
        tbl.pack(fill='both', expand=True, pady=(6, 0))
        cols = [('sym', 'Moneda', 110, 'w'), ('estado', 'Estado', 150, 'w'), ('dias', 'Días bajados', 130, 'e'),
                ('faltan', 'Faltan', 70, 'e'), ('rango', 'Del → al', 190, 'center'), ('tape', 'Tape', 75, 'e'),
                ('revisar', 'Revisar', 62, 'e'), ('errores', 'Errores', 62, 'e'), ('almacen', 'Almacén App 1', 130, 'e'),
                ('cola', 'Cola', 50, 'center')]
        fr, self.tree = self._tree(tbl, cols, 8)
        fr.pack(fill='both', expand=True)
        self.tree.bind('<<TreeviewSelect>>', self.on_tree_select)

        act = ttk.LabelFrame(f, text=' Moneda elegida ', padding=(10, 4))
        act.pack(fill='x', pady=(6, 0))
        r1 = ttk.Frame(act)
        r1.pack(fill='x')
        ttk.Label(r1, text='Moneda:').pack(side='left')
        self.cb_sym = ttk.Combobox(r1, width=16)
        self.cb_sym.pack(side='left', padx=(4, 14))
        self.cb_sym.bind('<<ComboboxSelected>>', lambda e: self.choose(self.cb_sym.get(), from_tree=False))
        self.cb_sym.bind('<Return>', lambda e: self.choose(self.cb_sym.get(), from_tree=False))
        self.cb_sym.bind('<FocusOut>', lambda e: self.choose(self.cb_sym.get(), from_tree=False))
        self.cb_sym.bind('<KeyRelease>', self.on_sym_key)
        ttk.Label(r1, text='Desde (opcional):').pack(side='left')
        self.e_desde = ttk.Entry(r1, width=12)
        self.e_desde.pack(side='left', padx=(4, 4))
        ttk.Label(r1, text='AAAA-MM-DD, el día más viejo que quieres', foreground='#777777', font=self.f_small).pack(side='left', padx=(0, 14))
        self.v_auto = tk.BooleanVar(value=not self.readonly)
        ttk.Checkbutton(r1, text='Armar el almacén de App 1 al terminar', variable=self.v_auto).pack(side='left')
        r2 = ttk.Frame(act)
        r2.pack(fill='x', pady=(6, 2))
        self.b_down = ttk.Button(r2, text='Descargar ahora', command=self.act_download)
        self.b_build = ttk.Button(r2, text='Armar almacén de App 1', command=self.act_build)
        self.b_down.pack(side='left', padx=(0, 6))
        self.b_build.pack(side='left', padx=(0, 6))
        ttk.Separator(r2, orient='vertical').pack(side='left', fill='y', padx=10)
        ttk.Label(r2, text='Cola:').pack(side='left', padx=(0, 4))
        self.b_qadd = ttk.Button(r2, text='Agregar', command=self.act_queue_add)
        self.b_qdel = ttk.Button(r2, text='Quitar', command=self.act_queue_remove)
        self.b_qup = ttk.Button(r2, text='▲', width=3, command=lambda: self.act_queue_move(-1))
        self.b_qdown = ttk.Button(r2, text='▼', width=3, command=lambda: self.act_queue_move(1))
        self.b_qstart = ttk.Button(r2, text='Iniciar cola', command=self.act_queue_start)
        self.b_qstop = ttk.Button(r2, text='Detener cola', command=self.act_queue_stop)
        for b in (self.b_qadd, self.b_qdel, self.b_qup, self.b_qdown, self.b_qstart, self.b_qstop):
            b.pack(side='left', padx=(0, 4))
        ttk.Button(r2, text='Abrir carpeta', command=self.act_open_folder).pack(side='right')
        ttk.Button(r2, text='Abrir registro', command=self.act_open_log).pack(side='right', padx=(0, 6))
        self.lbl_info = ttk.Label(act, text='', foreground='#333333', wraplength=1120, justify='left')
        self.lbl_info.pack(fill='x', pady=(2, 2))

        bottom = ttk.Notebook(f)
        bottom.pack(fill='both', expand=True, pady=(6, 0))
        self.txt_log = self._text(bottom, 7)
        self.txt_err = self._text(bottom, 7, wrap='word')
        bottom.add(self.txt_log.master, text=' Registro ')
        bottom.add(self.txt_err.master, text=' Errores y días para revisar ')
        self.bottom_nb = bottom

    def _build_collector(self, f):
        src = ttk.LabelFrame(f, text=' Fuentes ', padding=(10, 4))
        src.pack(fill='x')
        self.src_rows = {}
        for key, title in (('cloud', 'Nube (Northflank)'), ('local', 'Backend local de App 9 (puerto 11000)'), ('archive', 'Archivo de App 9')):
            row = ttk.Frame(src)
            row.pack(fill='x', pady=1)
            dot = tk.Label(row, text='●', font=self.f_big, foreground='#999999', width=2)
            dot.pack(side='left')
            ttk.Label(row, text=title + ':', font=self.f_bold, width=36).pack(side='left')
            txt = ttk.Label(row, text='consultando…', anchor='w', justify='left', wraplength=760)
            txt.pack(side='left', fill='x', expand=True)
            self.src_rows[key] = (dot, txt)
        row = ttk.Frame(src)
        row.pack(fill='x', pady=(5, 2))
        self.b_col_now = ttk.Button(row, text='Revisar ahora', command=self.act_col_now)
        self.b_gaps = ttk.Button(row, text=f'Buscar huecos (últimas {GAP_HOURS} h)', command=self.act_gaps)
        self.b_col_now.pack(side='left', padx=(0, 6))
        self.b_gaps.pack(side='left', padx=(0, 10))
        self.lbl_col_prog = ttk.Label(row, text='', foreground='#555555')
        self.lbl_col_prog.pack(side='left')

        tbl = ttk.LabelFrame(f, text=' Por moneda ', padding=(6, 4))
        tbl.pack(fill='both', expand=True, pady=(6, 0))
        cols = [('sym', 'Moneda', 110, 'w'), ('nube', 'Nube: último footprint', 160, 'w'), ('hace', 'Hace', 95, 'e'),
                ('step', 'Step', 70, 'e'), ('celdas', 'Celdas', 60, 'e'), ('huecos', f'Huecos {GAP_HOURS} h', 170, 'w'),
                ('local', 'Backend local: escribió', 160, 'w'), ('archivo', 'Archivo App 9', 150, 'w')]
        fr, self.ctree = self._tree(tbl, cols, 10)
        fr.pack(fill='both', expand=True)

        warn = ttk.LabelFrame(f, text=' Avisos ', padding=(6, 4))
        warn.pack(fill='both', expand=False, pady=(6, 0))
        self.txt_warn = self._text(warn, 6, wrap='word')
        self.txt_warn.master.pack(fill='both', expand=True)
        ttk.Label(f, foreground='#666666', font=self.f_small, wraplength=1120, justify='left',
                  text='La nube guarda en disco cada 10 velas: el último footprint incluye lo que aún tiene en memoria. '
                       'El panel solo consulta: no cambia nada del collector ni de App 9.').pack(fill='x', pady=(4, 0))

    # ---------- hilos
    def _data_loop(self):
        while not self.closing:
            try:
                snap = self.reader.refresh(self.selected)
            except Exception:
                snap = {'fatal': traceback.format_exc(), 'at': time.time()}
            self.post('snap', snap)
            self.wake.wait(REFRESH_S)
            self.wake.clear()

    def _drain(self):
        if self.closing:
            return
        col_dirty = False
        try:
            for _ in range(200):
                kind, payload = self.q.get_nowait()
                if kind == 'snap':
                    self._apply_snapshot(payload)
                elif kind == 'col':
                    col_dirty = True
                elif kind == 'remote':
                    if payload == self.selected and self.snap:
                        self._render_selected(self.snap)
                elif kind == 'symbols':
                    self.all_symbols = payload
                    self._update_sym_values()
                elif kind == 'call':
                    done, res, err = payload
                    done(res, err)
        except queue.Empty:
            pass
        except Exception:
            self._log_exception()
        if col_dirty:
            try:
                self._render_collector()
            except Exception:
                self._log_exception()
        self.root.after(250, self._drain)

    def _log_exception(self, *exc):
        text = ''.join(traceback.format_exception(*exc)) if len(exc) == 3 else traceback.format_exc()
        try:
            self.p.out.mkdir(parents=True, exist_ok=True)
            with open(self.p.out / 'panel_errores.txt', 'a', encoding='utf-8') as f:
                f.write(time.strftime('%Y-%m-%d %H:%M:%S ') + text + '\n')
        except OSError:
            pass
        self.note('Error interno del panel: detalle en ' + str(self.p.out / 'panel_errores.txt'))

    def on_close(self):
        self.closing = True
        self.remote.closing = True
        self.col.closing = True
        self.wake.set()
        self.remote.event.set()
        self.col.force_local.set()
        self.col.force_cloud.set()
        self.root.destroy()

    # ---------- elegir moneda
    def choose(self, text, from_tree):
        sym = (text or '').strip().upper()
        if not sym or sym == self.selected:
            return
        if not SYMBOL_RE.match(sym):
            return
        self.selected = sym
        if self.cb_sym.get() != sym:
            self.cb_sym.set(sym)
        if not from_tree:
            if self.tree.exists(sym):
                self.tree.selection_set(sym)
                self.tree.see(sym)
            else:
                self.tree.selection_remove(self.tree.selection())
        self.remote.want_listing(sym, urgent=True)
        self.text_keys.clear()
        if self.snap and 'coins' in self.snap:
            self._render_selected(self.snap)
            self._render_buttons(self.snap)
        self.wake.set()

    def on_tree_select(self, event):
        sel = self.tree.selection()
        if sel:
            self.choose(sel[0], from_tree=True)

    def on_sym_key(self, event):
        if event.keysym in ('Up', 'Down', 'Return', 'Escape', 'Tab'):
            return
        text = self.cb_sym.get()
        up = text.upper()
        if up != text:
            pos = self.cb_sym.index('insert')
            self.cb_sym.set(up)
            self.cb_sym.icursor(pos)
        self._update_sym_values(up)

    def _update_sym_values(self, prefix=None):
        known = list(self.snap['coins']) if self.snap and 'coins' in self.snap else []
        prefix = prefix if prefix is not None else ''
        rest = [s for s in self.all_symbols if s.startswith(prefix) and s not in known][:400]
        self.cb_sym.configure(values=[s for s in known if s.startswith(prefix)] + rest)

    # ---------- estado de las descargas
    def _apply_snapshot(self, s):
        if 'fatal' in s:
            self.lbl_now.configure(text='No se pudo leer el estado', foreground='#b00020')
            self.lbl_now2.configure(text=s['fatal'].strip().splitlines()[-1][:300])
            return
        first = self.snap is None
        self.snap = s
        self.children = [p for p in self.children if p.poll() is None]
        for sym in s['coins']:
            self.remote.want_listing(sym)
        start = None
        if first:
            ing = s['procs']['ingest']
            start = ing[0]['sym'] if ing else (s['queue'][0] if s['queue'] else (sorted(s['coins'])[0] if s['coins'] else None))
            self._update_sym_values()
        self._transitions(s)
        self._render_now(s)
        self._render_table(s)
        if start:
            self.choose(start, from_tree=False)
        self._render_selected(s)
        self._render_buttons(s)
        self._render_bar()

    def _ingest_phase(self, it, c, ctl):
        curl = it.get('curl') or {}
        downloading = bool(curl.get('day'))
        processing = bool(c.get('pending_day'))
        busy = downloading or processing
        if ctl.get('stop'):
            return ('Deteniendo' if busy else 'Cerrando'), 'pause', busy
        if ctl.get('pause'):
            return ('Pausando' if busy else 'En pausa'), 'pause', busy
        if busy:
            return 'Descargando', 'run', busy
        return ('Consultando Bybit' if curl else 'Preparando'), 'run', busy

    def _render_now(self, s):
        ctl, procs, coins = s['control'], s['procs'], s['coins']
        lines, color = [], '#333333'
        for it in procs['ingest']:
            sym = it['sym']
            c = coins.get(sym) or {}
            phase, tag, busy = self._ingest_phase(it, c, ctl)
            color = '#0b6e2e' if tag == 'run' else '#9a5200'
            bits = []
            part = c.get('part')
            curl = it.get('curl') or {}
            if curl.get('day') and part and part['day'] == curl['day']:
                total = part.get('total')
                txt = f"día {part['day']}: {fmt_mb(part['size'])}"
                if total:
                    txt += f" de {fmt_mb(total)} ({min(100, part['size'] * 100 // max(1, total))}%)"
                if part.get('speed'):
                    txt += f" · {part['speed'] / 1e6:.2f} MB/s"
                bits.append(txt)
            elif curl.get('day'):
                bits.append(f"día {curl['day']}")
            if c.get('pending_day'):
                bits.append(f"verificando el día {c['pending_day']}")
            if phase == 'En pausa' and c.get('next_day'):
                bits.append(f"al reanudar sigue con el día {c['next_day']}")
            if phase in ('Pausando', 'Deteniendo'):
                bits.append('termina este archivo y ' + ('espera' if phase == 'Pausando' else 'se cierra'))
            # status_SYM.json vale solo si lo escribió esta misma corrida
            st = c.get('status') or {}
            upd = _local_ts((st.get('actualizado') or '').replace('T', ' ')) if st else None
            fresh = bool(upd and it.get('created') and upd >= it['created'] - 5)
            left = st.get('pendientes') if fresh else c.get('run_missing')
            if left is not None:
                eta = None
                if phase == 'Descargando' and left:
                    if fresh and st.get('eta_horas'):
                        eta = st['eta_horas']
                    elif c.get('rate'):
                        eta = left / c['rate']
                bits.append(f"faltan {fmt_int(left)} días en esta descarga" + (f" ({fmt_hours(eta)})" if eta else ''))
            if it.get('created'):
                bits.append(f"corriendo desde {fmt_clock(it['created'])}")
            lines.append(f"{phase} {sym} · " + ' · '.join(bits) if bits else f'{phase} {sym}')
        if not procs['ingest']:
            lines.append('Sin descargas en curso.')
            color = '#333333'
        building = procs['build']
        for b in building:
            c = coins.get(b['sym']) or {}
            lines.append(f"Armando el almacén de App 1 para {b['sym']}: {fmt_int(c.get('store_n'))} de {fmt_int(c.get('tape_n'))} días")
        self.lbl_now.configure(text='\n'.join(lines), foreground=color)

        info = []
        if procs['queue']:
            # Misma regla que queue_runner.py: salta la moneda cuyo status dice 0 pendientes
            nxt = next((q for q in s['queue'] if q not in {i['sym'] for i in procs['ingest']}
                        and not ((coins.get(q) or {}).get('status') or {'pendientes': 1}).get('pendientes', 1) == 0), None)
            info.append('Cola: activa' + (f', después sigue {nxt}' if nxt else ''))
        else:
            info.append('Cola: detenida')
        rate = ctl.get('limit_rate')
        info.append('Velocidad máxima: ' + next((l for l, v in RATES if v == str(rate)), str(rate)))
        if s.get('disk_free') is not None:
            free = s['disk_free'] / 1e9
            info.append(f'Disco libre: {free:,.0f} GB' + (' (la descarga se detiene sola bajo 5 GB)' if free < 20 else ''))
        if ctl.get('pause') and not procs['ingest']:
            info.append('La pausa quedó puesta: la próxima descarga empieza en pausa salvo que la inicies desde aquí')
        if ctl.get('stop') and not procs['ingest'] and not procs['queue']:
            info.append('control.json tiene "stop": la próxima descarga desde este panel lo quita')
        if procs['queue'] and not procs['ingest']:
            info.append('con la cola activa, agrega monedas a la cola o detén la cola para bajar otra a mano')
        if s.get('control_error'):
            info.append(f"control.json no se pudo leer ({s['control_error']})")
        if s.get('scan_error'):
            info.append(f"no se pudo leer la lista de procesos ({s['scan_error']})")
        for sym, err in (s.get('coin_errors') or {}).items():
            info.append(f'no se pudieron leer los datos de {sym} ({err})')
        self.lbl_now2.configure(text=' · '.join(info))
        label = next((l for l, v in RATES if v == str(rate)), None)
        if label is None:
            label = f'{rate} (actual)'
            self.cb_rate.configure(values=[l for l, _ in RATES] + [label])
        if self.cb_rate.get() != label:
            self.cb_rate.set(label)

    @staticmethod
    def _complete(c):
        if not c:
            return False
        if c.get('remote_missing') is not None:
            return c['remote_missing'] == 0
        st = c.get('status') or {}
        return c.get('done', 0) > 0 and st.get('pendientes') == 0

    def _coin_state(self, sym, c, s):
        procs, ctl = s['procs'], s['control']
        ing = next((i for i in procs['ingest'] if i['sym'] == sym), None)
        building = any(b['sym'] == sym for b in procs['build'])
        if ing:
            phase, tag, _ = self._ingest_phase(ing, c, ctl)
            return phase + (' · almacén' if building else ''), tag
        if building:
            return 'Armando almacén', 'run'
        lst = self.remote.listing(sym)
        if lst and lst.get('missing'):
            return 'No existe en Bybit', 'bad'
        if not c.get('done'):
            return 'Sin empezar', 'idle'
        if c.get('remote_missing') is not None:
            if c['remote_missing'] == 0:
                return 'Completa', 'done'
            if c.get('only_new_missing'):
                return 'Faltan días nuevos', 'idle'
            return 'Detenida', 'idle'
        if self._complete(c):
            return 'Completa', 'done'
        return 'Detenida', 'idle'

    def _render_table(self, s):
        coins, qs = s['coins'], s['queue']
        running = [i['sym'] for i in s['procs']['ingest']]

        def order(sym):
            if sym in running:
                return (0, running.index(sym), sym)
            if sym in qs:
                return (1, qs.index(sym), sym)
            return (2, 0, sym)
        syms = sorted(coins, key=order)
        for iid in self.tree.get_children():
            if iid not in coins:
                self.tree.delete(iid)
        for idx, sym in enumerate(syms):
            c = coins[sym]
            state, tag = self._coin_state(sym, c, s)
            dias = fmt_int(c['done']) if c['done'] else ''
            if c.get('remote_n'):
                dias = f"{fmt_int(c['done'])} de {fmt_int(c['remote_n'])}"
            faltan = c.get('remote_missing')
            if faltan is None and c.get('status') and sym in running:
                faltan = c['status'].get('pendientes')
            rango = ''
            if c['done']:
                rango = f"{c['cont_first']} → {c['newest']}" + (f" +{c['loose']}" if c['loose'] else '')
            almacen = f"{fmt_int(c['store_n'])} de {fmt_int(c['tape_n'])}" if c['tape_n'] else ''
            errores = c['errors_n'] + c['fallos_n']
            vals = (sym, state, dias, fmt_int(faltan) if faltan else ('0' if faltan == 0 else ''), rango, fmt_gb(c['tape_bytes']),
                    len(c['revisar']) or '', errores or '', almacen, qs.index(sym) + 1 if sym in qs else '')
            if self.tree.exists(sym):
                self.tree.item(sym, values=vals, tags=(tag,))
                if self.tree.index(sym) != idx:
                    self.tree.move(sym, '', idx)
            else:
                self.tree.insert('', idx, iid=sym, values=vals, tags=(tag,))
        if self.selected and self.tree.exists(self.selected) and self.tree.selection() != (self.selected,):
            self.tree.selection_set(self.selected)

    def _render_selected(self, s):
        sym = self.selected
        if not sym:
            self.lbl_info.configure(text='Elige una moneda de la tabla o escribe su nombre, por ejemplo SOLUSDT.')
            return
        c = s['coins'].get(sym)
        lst = self.remote.listing(sym)
        parts = []
        if lst is None:
            parts.append(f'{sym}: consultando Bybit…')
        elif lst.get('error'):
            parts.append(f"{sym}: no se pudo consultar Bybit ({lst['error']}).")
        elif not lst.get('days'):
            parts.append(f'{sym}: Bybit no publica trades diarios de esta moneda.')
        else:
            parts.append(f"{sym} en Bybit: {fmt_int(len(lst['days']))} días, del {lst['days'][0]} al {lst['days'][-1]}.")
        if c and c['done']:
            txt = f"Bajados {fmt_int(c['done'])}: sin huecos del {c['cont_first']} al {c['newest']}"
            if c['loose']:
                txt += f" y {fmt_int(c['loose'])} días sueltos más viejos"
            txt += f" ({fmt_gb(c['tape_bytes'])})"
            if c.get('remote_missing'):
                txt += f", faltan {fmt_int(c['remote_missing'])}"
            parts.append(txt + '.')
        if c and c['tape_n']:
            miss = c['store_missing']
            parts.append(f"Almacén de App 1: {fmt_int(c['store_n'])} de {fmt_int(c['tape_n'])} días" + (f' (faltan {fmt_int(miss)}).' if miss else ' (completo).'))
        if c and c['revisar']:
            parts.append(f"{len(c['revisar'])} día(s) para revisar.")
        if self.snap and sym in self.snap['queue']:
            parts.append(f"En la cola, puesto {self.snap['queue'].index(sym) + 1}.")
        self.lbl_info.configure(text=' '.join(parts))
        sel = s.get('selected')
        if not sel or sel.get('sym') != sym:
            if c is None and self.text_keys.get('log') != ('vacío', sym):
                self.text_keys['log'] = self.text_keys['err'] = ('vacío', sym)
                self._set_text(self.txt_log, [(f'{sym} todavía no tiene registro: aparece al bajar su primer día.\n', 'info')], follow_end=False)
                self._set_text(self.txt_err, [(f'{sym} todavía no tiene errores ni días para revisar.\n', 'info')], follow_end=False)
                self.bottom_nb.tab(1, text=' Errores y días para revisar ')
            return
        key = (sym, sel['log_version'])
        if self.text_keys.get('log') != key:
            new_coin = self.text_keys.get('log_sym') != sym
            self.text_keys['log'], self.text_keys['log_sym'] = key, sym
            chunks = []
            for line in sel['tail']:
                tag = 'err' if ('ERROR' in line or 'fallo' in line or 'Traceback' in line) else ('warn' if ('reintento' in line or ' revisar ' in line or 'sin tamano' in line) else None)
                chunks.append((line + '\n', tag))
            if not chunks:
                chunks = [('Todavía no hay registro de esta moneda.\n', 'info')]
            self._set_text(self.txt_log, chunks, follow_end=True)
            if new_coin:
                self.txt_log.see('end')
        key = (sym, sel['problems_total'], sel['errors_total'], len(c['revisar']) if c else 0, len(sel['salida']), len(sel['fallidos']))
        if self.text_keys.get('err') != key:
            self.text_keys['err'] = key
            self._set_text(self.txt_err, self._error_chunks(sym, c, sel), follow_end=False)
            n = (len(c['revisar']) if c else 0) + sel['errors_total'] + sel['fallos'] + len(sel['fallidos'])
            self.bottom_nb.tab(1, text=f' Errores y días para revisar ({n}) ' if n else ' Errores y días para revisar ')

    def _error_chunks(self, sym, c, sel):
        out = [(f'{sym}\n', 'head')]
        out.append(('\nDías para revisar (lo guardado está completo, pero no coincide con las velas oficiales):\n', 'head'))
        if c and c['revisar']:
            for d, why in c['revisar']:
                out.append((f'  {d}: {why}\n', 'warn'))
        else:
            out.append(('  ninguno\n', 'ok'))
        out.append((f'\nErrores al procesar (manifest\\{sym}.errors.jsonl):\n', 'head'))
        if sel['errors']:
            for e in sel['errors']:
                out.append((f"  {e.get('cuando', '')}  {e.get('date', '')}  {e.get('error', '')}\n", 'err'))
        else:
            out.append(('  ninguno\n', 'ok'))
        out.append((f'\nReintentos y fallos de descarga (logs\\{sym}.log):\n', 'head'))
        if sel['problems']:
            for line in sel['problems']:
                m = re.search(r'codigo (\d+)', line)
                why = CURL_CODES.get(int(m.group(1))) if m else None
                tag = 'err' if ('fallo' in line or 'ERROR' in line or 'Traceback' in line) else 'warn'
                out.append((f'  {line}' + (f'  → {why}' if why else '') + '\n', tag))
        else:
            out.append(('  ninguno\n', 'ok'))
        if sel['fallidos']:
            out.append(('\nArchivos apartados en work\\fallidos (no se procesaron):\n', 'head'))
            for name in sel['fallidos']:
                out.append((f'  {name}\n', 'err'))
        out.append(('\nSalida de errores de la última descarga lanzada desde el panel:\n', 'head'))
        lines = [l for l in sel['salida'] if not l.startswith('---')]
        if lines:
            for line in lines[-30:]:
                out.append((f'  {line}\n', 'err'))
        else:
            out.append(('  vacía\n', 'ok'))
        return out

    def _render_buttons(self, s):
        if self.readonly:
            for b in (self.b_pause, self.b_resume, self.b_stop, self.b_kill, self.b_down, self.b_build, self.b_qadd,
                      self.b_qdel, self.b_qup, self.b_qdown, self.b_qstart, self.b_qstop):
                self._enable(b, False)
            self.cb_rate.state(['disabled'])
            return
        procs, ctl, qs = s['procs'], s['control'], s['queue']
        ing, qr = procs['ingest'], procs['queue']
        sym = self.selected
        c = s['coins'].get(sym) if sym else None
        valid = bool(sym and SYMBOL_RE.match(sym))
        in_q = bool(sym and sym in qs)
        pos = qs.index(sym) if in_q else -1
        self._enable(self.b_pause, bool(ing) and not ctl.get('pause') and not ctl.get('stop'))
        self._enable(self.b_resume, bool(ctl.get('pause')))
        self._enable(self.b_stop, bool(ing or qr) and not ctl.get('stop'))
        self._enable(self.b_kill, bool(ing))
        self._enable(self.b_down, valid and not ing and not qr and not self.action_busy)
        self._enable(self.b_build, bool(c and c['tape_n']) and not any(b['sym'] == sym for b in procs['build']))
        self._enable(self.b_qadd, valid and not in_q)
        self._enable(self.b_qdel, in_q)
        self._enable(self.b_qup, in_q and pos > 0)
        self._enable(self.b_qdown, in_q and pos < len(qs) - 1)
        self._enable(self.b_qstart, not qr and bool(qs))
        self._enable(self.b_qstop, bool(qr))

    def _render_bar(self):
        bits = []
        if self.note_text and time.time() - self.note_at < 120:
            bits.append(self.note_text)
        if self.snap and 'at' in self.snap:
            bits.append('Actualizado ' + time.strftime('%H:%M:%S', time.localtime(self.snap['at'])))
        bits.append(f'Datos: {self.p.data}')
        if self.readonly:
            bits.append('SOLO LECTURA')
        self.bar.configure(text='   ·   '.join(bits))

    def _transitions(self, s):
        procs = s['procs']
        cur = {i['sym'] for i in procs['ingest']}
        if self.prev_ingest is not None and not self.readonly:
            for sym in self.prev_ingest - cur:
                if self.v_auto.get() and not self.stop_requested:
                    self.autobuild[sym] = time.time() + 120
        self.prev_ingest = cur
        building = {b['sym'] for b in procs['build']}
        for sym, deadline in list(self.autobuild.items()):
            c = s['coins'].get(sym)
            if sym in cur or time.time() > deadline:
                self.autobuild.pop(sym, None)
            elif sym in building:
                self.autobuild.pop(sym, None)
            elif c and c['store_missing'] > 0:
                self.autobuild.pop(sym, None)
                self._launch_build(sym, auto=True)
        if self.reset_stop_when_idle and not procs['ingest'] and not procs['queue']:
            self.reset_stop_when_idle = False
            if s['control'].get('stop'):
                try:
                    write_control(self.p.control, stop=False)
                    self.note('Descarga detenida. Ya se puede empezar otra.')
                except Exception as e:
                    self.note(f'No se pudo quitar "stop" de control.json: {short_error(e)}')
                self.wake.set()

    # ---------- acciones de descarga
    def _control(self, **upd):
        try:
            write_control(self.p.control, **upd)
            self.wake.set()
            return True
        except Exception as e:
            messagebox.showerror('No se pudo cambiar control.json', short_error(e), parent=self.root)
            return False

    def act_pause(self):
        if self._control(pause=True):
            self.note('Pausa pedida: la descarga termina el archivo en curso y espera.')

    def act_resume(self):
        if self._control(pause=False):
            if self.snap and not self.snap['procs']['ingest']:
                self.note('Pausa quitada. No hay descargas corriendo: elige una moneda y pulsa Descargar ahora, o Iniciar cola.')
            else:
                self.note('Reanudando: sigue en menos de 20 segundos.')

    def act_stop(self):
        if not messagebox.askyesno('Detener la descarga',
                                   'La descarga termina el archivo que está bajando y se cierra.\n'
                                   'La cola también se detiene.\n\n¿Detener?', parent=self.root):
            return
        self.stop_requested = True
        if self._control(stop=True):
            self.reset_stop_when_idle = True
            self.note('Deteniendo: termina el archivo en curso y se cierra.')

    def act_stop_now(self):
        ing = self.snap['procs']['ingest'] if self.snap else []
        if not ing:
            return
        names = ', '.join(i['sym'] for i in ing)
        if not messagebox.askyesno('Detener ya',
                                   f'Se corta {names} en este momento.\n\n'
                                   'Solo se pierde el archivo que se está bajando: la próxima vez se vuelve a bajar.\n'
                                   'Los días ya verificados quedan guardados.\n\n¿Cortar ahora?', icon='warning', parent=self.root):
            return
        self.stop_requested = True
        if not self._control(stop=True):
            return
        self.reset_stop_when_idle = True
        failed = [i['sym'] for i in ing if not kill_process(i['pid'], tree=True)]
        self.note('Descarga cortada.' if not failed else f"No se pudo cortar {', '.join(failed)}.")
        self.wake.set()

    def act_rate(self, event=None):
        label = self.cb_rate.get()
        value = next((v for l, v in RATES if l == label), None)
        if value and self._control(limit_rate=value):
            self.note(f'Velocidad máxima {label}: rige desde el siguiente archivo.')

    def _chosen_symbol(self):
        sym = (self.cb_sym.get() or '').strip().upper()
        if not SYMBOL_RE.match(sym):
            messagebox.showwarning('Moneda', 'Escribe el nombre de la moneda como en Bybit, por ejemplo SOLUSDT.', parent=self.root)
            return None
        if sym != self.selected:
            self.choose(sym, from_tree=False)
        return sym

    def act_download(self):
        sym = self._chosen_symbol()
        if not sym or not self.snap:
            return
        desde = self.e_desde.get().strip()
        if desde and not valid_date(desde):
            messagebox.showwarning('Desde', 'La fecha va como AAAA-MM-DD, por ejemplo 2024-01-01. Déjala vacía para bajar todo.', parent=self.root)
            return
        procs = self.snap['procs']
        if procs['ingest']:
            messagebox.showinfo('Descarga en curso', f"Ya se está bajando {procs['ingest'][0]['sym']}. Detenla o agrega {sym} a la cola.", parent=self.root)
            return
        if procs['queue']:
            messagebox.showinfo('Cola activa', 'La cola está activa y empezaría otra moneda en paralelo. Agrega la moneda a la cola o detén la cola primero.', parent=self.root)
            return
        self.action_busy = True
        self._render_buttons(self.snap)
        self.note(f'Consultando {sym} en Bybit…')

        def done(res, err):
            self.action_busy = False
            try:
                if err or not res or res.get('error'):
                    messagebox.showerror('Bybit', f"No se pudo consultar {sym}: {short_error(err) if err else (res or {}).get('error')}", parent=self.root)
                    return
                if not res['days']:
                    messagebox.showwarning('Bybit', f'Bybit no publica trades diarios de {sym}. Revisa el nombre.', parent=self.root)
                    return
                coin = self.reader.coins.get(sym)
                have = set(coin.days) if coin else set()
                todo = [d for d in res['days'] if d not in have and (not desde or d >= desde)]
                if not todo:
                    messagebox.showinfo('Nada que bajar', f'{sym} ya tiene todos los días' + (f' desde {desde}' if desde else '') + '. Bybit publica el día anterior cerca de las 01:10 UTC.', parent=self.root)
                    return
                cur = self.snap['procs']
                if cur['ingest'] or cur['queue']:
                    messagebox.showinfo('Descarga en curso', 'Mientras tanto empezó otra descarga.', parent=self.root)
                    return
                write_control(self.p.control, pause=False, stop=False)
                args = [PYTHON, '-I', str(self.p.tools / 'ingest.py'), sym] + (['--desde', desde] if desde else [])
                self.children.append(launch(args, self.p.tools, self.p.outputs / f'{sym}_descarga.txt', stdout_too=False))
                self.reader.add_symbol(sym)
                self.stop_requested = False
                self.reset_stop_when_idle = False
                self.note(f"Descarga de {sym} iniciada: {fmt_int(len(todo))} días por bajar, del {todo[-1]} hacia el {todo[0]}.")
            except Exception as e:
                messagebox.showerror('No se pudo iniciar', short_error(e), parent=self.root)
            finally:
                if self.snap:
                    self._render_buttons(self.snap)
                self.wake.set()
        self._bg(lambda: self.remote.fetch_listing(sym), done)

    def act_build(self):
        sym = self.selected
        if sym:
            self._launch_build(sym, auto=False)

    def _launch_build(self, sym, auto):
        if self.readonly or not self.snap:
            return
        if any(b['sym'] == sym for b in self.snap['procs']['build']):
            return
        # build_store.py no tiene candado: dos copias de la misma moneda escribirían el mismo archivo
        if any(getattr(p, 'panel_build', None) == sym and p.poll() is None for p in self.children):
            return
        try:
            args = [PYTHON, '-B', str(self.p.tools / 'build_store.py'), sym]
            proc = launch(args, self.p.tools, self.p.outputs / f'{sym}_almacen.txt', stdout_too=True)
            proc.panel_build = sym
            self.children.append(proc)
            self.note(('Armando solo ' if auto else 'Armando ') + f'el almacén de App 1 para {sym}. App 1 verá los días nuevos sin reiniciar.')
        except Exception as e:
            messagebox.showerror('No se pudo armar el almacén', short_error(e), parent=self.root)
        self.wake.set()

    def _queue_edit(self, change):
        try:
            q = read_queue(self.p.queue)
            syms = change(list(q['syms']))
            if syms is not None and syms != q['syms']:
                write_queue(self.p.queue, q, syms)
        except Exception as e:
            messagebox.showerror('No se pudo cambiar queue.txt', short_error(e), parent=self.root)
        self.wake.set()

    def act_queue_add(self):
        sym = self._chosen_symbol()
        if sym:
            self.reader.add_symbol(sym)
            self._queue_edit(lambda syms: syms if sym in syms else syms + [sym])

    def act_queue_remove(self):
        sym = self.selected
        if sym:
            self._queue_edit(lambda syms: [x for x in syms if x != sym])

    def act_queue_move(self, delta):
        sym = self.selected

        def move(syms):
            if sym not in syms:
                return None
            i = syms.index(sym)
            j = i + delta
            if not 0 <= j < len(syms):
                return None
            syms[i], syms[j] = syms[j], syms[i]
            return syms
        if sym:
            self._queue_edit(move)

    def act_queue_start(self):
        if not self.snap or self.snap['procs']['queue']:
            return
        try:
            write_control(self.p.control, pause=False, stop=False)
            args = [PYTHON, '-I', str(self.p.tools / 'queue_runner.py')]
            self.children.append(launch(args, self.p.tools, self.p.outputs / 'cola.txt', stdout_too=False))
            self.stop_requested = False
            self.reset_stop_when_idle = False
            self.note('Cola iniciada: baja las monedas de la lista en orden y salta las completas.')
        except Exception as e:
            messagebox.showerror('No se pudo iniciar la cola', short_error(e), parent=self.root)
        self.wake.set()

    def act_queue_stop(self):
        qr = self.snap['procs']['queue'] if self.snap else []
        if not qr:
            return
        if not messagebox.askyesno('Detener cola', 'La moneda que se está bajando sigue hasta terminar. Después no empieza otra.\n\n¿Detener la cola?', parent=self.root):
            return
        # Solo el proceso de la cola: la descarga que lanzó sigue viva
        failed = [str(pid) for q in qr for pid in sorted(q['pids']) if not kill_process(pid, tree=False)]
        self.note('Cola detenida.' if not failed else 'No se pudo detener la cola.')
        self.wake.set()

    def act_open_folder(self):
        try:
            os.startfile(str(self.p.data))
        except OSError as e:
            messagebox.showerror('Abrir carpeta', short_error(e), parent=self.root)

    def act_open_log(self):
        sym = self.selected
        path = self.p.logs / f'{sym}.log' if sym else None
        if not path or not path.exists():
            messagebox.showinfo('Registro', 'Esta moneda todavía no tiene registro.', parent=self.root)
            return
        try:
            os.startfile(str(path))
        except OSError as e:
            messagebox.showerror('Abrir registro', short_error(e), parent=self.root)

    # ---------- collector
    def act_col_now(self):
        self.col.refresh_now()
        self.note('Revisando el collector…')

    def act_gaps(self):
        if not self.col.cloud.get('symbols'):
            messagebox.showinfo('Buscar huecos', 'Primero tiene que responder la nube.', parent=self.root)
            return
        self.col.request_gaps()
        self.note(f'Buscando huecos de las últimas {GAP_HOURS} h en la nube: tarda cerca de un minuto.')

    def _render_collector(self):
        st = self.col.state()
        now = time.time()
        cloud, latest, gaps, local = st['cloud'], st['latest'], st['gaps'], st['local']
        dot, txt = self.src_rows['cloud']
        if cloud.get('ok') is None:
            dot.configure(foreground='#999999')
            txt.configure(text='consultando…')
        elif cloud.get('ok'):
            # Un footprint de 1 minuto queda completo al cerrar su vela
            fresh = [now - v['ts'] / 1000 - 60 for v in latest.values() if v.get('ts')]
            best = min(fresh) if fresh else None
            dot.configure(foreground='#0b9e3a' if best is None or best < 600 else '#d07a00')
            t = f"responde · recoge {len(cloud['symbols'])} monedas"
            if best is not None:
                t += f' · footprint más reciente {fmt_ago(best)}'
            t += f" · revisado {fmt_clock(cloud['at'])}"
            txt.configure(text=t)
        else:
            dot.configure(foreground='#c62828')
            txt.configure(text=f"no responde ({cloud.get('error')}) desde {fmt_clock(cloud.get('fail_since'))} · último intento {fmt_clock(cloud.get('at'))}")

        dot, txt = self.src_rows['local']
        cache = st['cache']
        last_write = max((m for v in cache.values() for m in v.values()), default=None)
        if local.get('ok') is None:
            dot.configure(foreground='#999999')
            txt.configure(text='consultando…')
        elif local.get('ok'):
            good = local.get('running') and local.get('ws')
            dot.configure(foreground='#0b9e3a' if good else '#c62828')
            t = ('corriendo' if local.get('running') else 'abierto pero el servicio Order Flow está detenido')
            t += ' · WebSocket ' + ('conectado' if local.get('ws') else 'desconectado')
            t += f" · recoge {len(local.get('symbols') or [])} monedas"
            if local.get('uptime'):
                t += f" · encendido {fmt_ago(local['uptime'])}"
            if local.get('trades') is not None:
                t += f" · {fmt_int(local['trades'])} trades"
            if last_write:
                t += f' · escribió {fmt_ago(now - last_write)}'
            txt.configure(text=t)
        else:
            dot.configure(foreground='#999999' if local.get('off') else '#c62828')
            t = 'apagado' if local.get('off') else f"no responde ({local.get('error')})"
            if last_write:
                t += f' · escribió por última vez {fmt_clock(last_write)} ({fmt_ago(now - last_write)})'
            if st['config_symbols']:
                t += f" · configurado para {len(st['config_symbols'])} monedas"
            txt.configure(text=t)

        dot, txt = self.src_rows['archive']
        arch = st['archive']
        if arch:
            newest = max(v['mtime'] for v in arch.values())
            dot.configure(foreground='#0b9e3a' if now - newest < 24 * 3600 else '#d07a00')
            txt.configure(text=f"{len(arch)} monedas · última descarga {fmt_clock(newest)} ({fmt_ago(now - newest)}) · App 9 lo renueva mientras está abierta")
        else:
            dot.configure(foreground='#999999')
            txt.configure(text=st['archive_error'] or 'sin archivos')

        prog = []
        if st['latest_progress']:
            i, n = st['latest_progress']
            prog.append(f'leyendo el último footprint {i + 1} de {n}')
        if st['gaps_progress']:
            i, n = st['gaps_progress']
            prog.append(f'buscando huecos {i + 1} de {n}')
        elif st['gaps_at']:
            prog.append(f"huecos revisados a las {fmt_clock(st['gaps_at'])}")
        self.lbl_col_prog.configure(text=' · '.join(prog))
        self._enable(self.b_gaps, not st['gaps_progress'] and bool(cloud.get('ok')))

        syms = list(cloud.get('symbols') or [])
        for extra in list(st['config_symbols']) + sorted(cache) + sorted(st['archive']):
            if extra not in syms:
                syms.append(extra)
        for iid in self.ctree.get_children():
            if iid not in syms:
                self.ctree.delete(iid)
        for idx, sym in enumerate(syms):
            v = latest.get(sym)
            tag = 'gray'
            nube = hace = step = celdas = ''
            if sym not in (cloud.get('symbols') or []):
                nube = 'no lo recoge'
            elif v is None:
                nube = 'consultando…'
            elif v.get('error') and not v.get('ts'):
                nube, tag = f"error: {v['error']}", 'bad'
            elif not v.get('ts'):
                nube, tag = 'sin footprints en la última hora', 'bad'
            else:
                age = now - v['ts'] / 1000 - 60
                nube = 'vela de las ' + fmt_clock(v['ts'] / 1000)
                hace = fmt_ago(age)
                tag = 'ok' if age < 300 else ('late' if age < 900 else 'bad')
                step = f"{v['step']:g}" if v.get('step') is not None else ''
                celdas = v.get('levels') or ''
                if v.get('step') and v.get('close') and v['step'] / v['close'] >= 0.01:
                    step += ' ⚠'
            g = gaps.get(sym)
            huecos = ''
            if g:
                if g.get('error'):
                    huecos = f"error: {g['error']}"
                elif not g['missing']:
                    huecos = 'ninguno'
                else:
                    longest = max(n for _, n in g['runs'])
                    huecos = f"{len(g['missing'])} min" + (f' (máx {longest} seguidos)' if longest > 1 else '')
            lc = cache.get(sym, {}).get('1')
            local_txt = fmt_clock(lc) if lc else ''
            a = st['archive'].get(sym)
            arch_txt = fmt_clock(a['mtime']) if a else ''
            vals = (sym, nube, hace, step, celdas, huecos, local_txt, arch_txt)
            if self.ctree.exists(sym):
                self.ctree.item(sym, values=vals, tags=(tag,))
                if self.ctree.index(sym) != idx:
                    self.ctree.move(sym, '', idx)
            else:
                self.ctree.insert('', idx, iid=sym, values=vals, tags=(tag,))

        warnings = self._collector_warnings(st, now)
        key = tuple(warnings)
        if self.text_keys.get('warn') != key:
            self.text_keys['warn'] = key
            chunks = [(t + '\n', tag) for tag, t in warnings] or [('Sin avisos.\n', 'ok')]
            self._set_text(self.txt_warn, chunks, follow_end=False)

    def _collector_warnings(self, st, now):
        w = []
        cloud, latest, gaps, local = st['cloud'], st['latest'], st['gaps'], st['local']
        if cloud.get('ok') is False:
            w.append(('err', f"La nube no responde desde {fmt_clock(cloud.get('fail_since'))}: {cloud.get('error')}. App 9 no recibe historia nueva mientras tanto."))
        ages = {s: now - v['ts'] / 1000 - 60 for s, v in latest.items() if v.get('ts')}
        if cloud.get('ok') and ages and min(ages.values()) > 600:
            w.append(('err', 'Ninguna moneda tiene footprints de los últimos 10 minutos: el collector no está recibiendo trades.'))
        for s in cloud.get('symbols') or []:
            v = latest.get(s)
            if v and not v.get('ts') and not v.get('error'):
                w.append(('warn', f'{s}: la nube no tiene footprints de la última hora. Si el contrato cerró en Bybit, ya no habrá más.'))
            elif v and v.get('error'):
                w.append(('warn', f"{s}: no se pudo leer el último footprint ({v['error']})."))
        big = []
        for s, v in sorted(latest.items()):
            if v.get('step') and v.get('close') and v['step'] / v['close'] >= 0.01:
                big.append(f"{s} (step {v['step']:g}, precio {v['close']:g})")
        if big:
            quien = '1 moneda tiene' if len(big) == 1 else f'{len(big)} monedas tienen'
            w.append(('warn', f'{quien} un step de 1% del precio o más: cada vela queda en una o dos celdas y el footprint no se puede leer. '
                              'El collector usa step 1 para las monedas que no están en su lista: ' + ', '.join(big) + '.'))
        if gaps:
            checked = [s for s, g in gaps.items() if not g.get('error')]
            for s in ('BTCUSDT', 'ETHUSDT'):
                g = gaps.get(s)
                if g and not g.get('error') and g['missing']:
                    w.append(('err', f"{s} siempre tiene trades y le faltan {len(g['missing'])} minutos en las últimas {GAP_HOURS} h ({fmt_runs(g['runs'])}): el collector se cortó."))
            if len(checked) >= 5:
                count = {}
                for s in checked:
                    for m in gaps[s]['missing']:
                        count[m] = count.get(m, 0) + 1
                common = sorted(m for m, n in count.items() if n >= 0.8 * len(checked))
                if common:
                    w.append(('err', f'{len(common)} minutos faltan en casi todas las monedas a la vez ({fmt_runs(_runs(common))}): corte del collector.'))
        if local.get('ok') is False and local.get('off'):
            w.append(('info', 'El backend local de App 9 está apagado. App 9 solo tendrá lo que baje de la nube hasta que lo abras.'))
        elif local.get('ok') and not local.get('ws'):
            w.append(('err', 'El backend local de App 9 está abierto pero sin WebSocket: no está recogiendo trades.'))
        elif local.get('ok') and local.get('running'):
            last_write = max((m for v in st['cache'].values() for m in v.values()), default=None)
            if last_write and now - last_write > 180 and (local.get('uptime') or 0) > 180:
                w.append(('warn', f'El backend local está corriendo pero no escribe footprint_cache desde {fmt_clock(last_write)}.'))
        elif local.get('ok') is False:
            w.append(('err', f"El backend local de App 9 no responde bien: {local.get('error')}."))
        if st['archive']:
            newest = max(v['mtime'] for v in st['archive'].values())
            if now - newest > 24 * 3600:
                w.append(('info', f'El archivo de App 9 es de {fmt_clock(newest)}: App 9 lo renueva desde la nube cuando está abierta.'))
        return w


def single_instance(paths):
    paths.out.mkdir(parents=True, exist_ok=True)
    key = hashlib.md5(str(paths.data).lower().encode('utf-8')).hexdigest()[:8]
    f = open(paths.out / f'panel_{key}.lock', 'w')
    try:
        msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        return f
    except OSError:
        f.close()
        return None


def parse_args(argv):
    cfg = {'datos': os.environ.get('ORDERFLOW_DATA') or DEFAULT_DATA, 'solo_lectura': False}
    i = 0
    while i < len(argv):
        if argv[i] == '--datos' and i + 1 < len(argv):
            cfg['datos'] = argv[i + 1]
            i += 2
            continue
        if argv[i] == '--solo-lectura':
            cfg['solo_lectura'] = True
        i += 1
    return cfg


def main():
    cfg = parse_args(sys.argv[1:])
    paths = Paths(cfg['datos'])
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        pass
    lock = single_instance(paths)
    root = tk.Tk()
    try:
        root.iconbitmap(default=str(Path(__file__).with_name('panel.ico')))
    except Exception:
        pass
    if lock is None:
        root.withdraw()
        messagebox.showinfo('Panel Order Flow', 'El panel ya está abierto en otra ventana.')
        root.destroy()
        return
    if not paths.tools.exists():
        root.withdraw()
        messagebox.showerror('Panel Order Flow', f'No encuentro {paths.tools}.\nRevisa que exista la carpeta de datos.')
        root.destroy()
        return
    app = App(root, paths, cfg['solo_lectura'])
    root.report_callback_exception = app._log_exception
    root.mainloop()


if __name__ == '__main__':
    main()
