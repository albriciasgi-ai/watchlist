#!/usr/bin/env python
"""Vuelve a verificar los días ya bajados contra las velas oficiales de 1 minuto y los clasifica.

Uso:
    C:\\Python314\\python.exe -I reverificar.py BTCUSDT
    C:\\Python314\\python.exe -I reverificar.py BTCUSDT --desde 2021-10-01 --hasta 2021-12-31
    C:\\Python314\\python.exe -I reverificar.py BTCUSDT --forzar
    C:\\Python314\\python.exe -I reverificar.py BTCUSDT --datos D:\\copia\\OrderFlowData

Lee manifest\\SIMBOLO.jsonl y los tapes, y consulta las velas de api.bybit.com. No cambia la
descarga, su manifest, control.json ni queue.txt: escribe manifest\\SIMBOLO.verificacion.jsonl,
una línea por día. Se puede cerrar en cualquier momento: al volver a correrlo sigue con los días
que falten. Conviene correrlo con la descarga terminada; si corre antes, verifica los días que ya
están en el manifest.

Usa read_tape() y klines() de tools\\ingest.py de la carpeta de datos. Sin --datos, la carpeta es
la que contiene este archivo si está en tools, o C:\\Users\\inven\\OrderFlowData.

Estados:
    ok          el volumen de cada minuto coincide con la vela oficial. Se aceptan dos diferencias
                inofensivas. Borde: la vela cuenta en el minuto vecino trades de los primeros o
                últimos 20 ms de un minuto. Cierre suelto: con el volumen exacto, la vela cierra
                con un precio negociado en el último segundo del minuto.
    incompleto  la vela oficial tiene más volumen que el archivo: faltan trades.
    revisar     el archivo tiene más volumen que la vela en algún minuto, un cierre que no se
                explica o trades en minutos sin vela.
    sin_velas   no se pudieron consultar las velas: se reintenta en la próxima corrida.
    sin_tape    falta el archivo .tape o no se pudo leer: se reintenta en la próxima corrida.
    error       falla inesperada, con el mensaje en el campo error.
"""
import argparse, datetime as dt, json, msvcrt, os, site, sys, time, zlib
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.append(site.getusersitepackages())
import numpy as np

VERSION = 1            # subir si cambia la regla: obliga a verificar de nuevo todos los días
MINUTE = 600000        # un minuto en unidades del tape (1e-4 s)
EDGE = 200             # 20 ms: el reloj de las velas va unos milisegundos detrás o delante del archivo
LAST = 10000           # 1 s: ventana para un cierre negociado justo antes del final del minuto
PREFETCH = 3           # días cuyas velas se piden por adelantado
DEFAULT_DATA = r'C:\Users\inven\OrderFlowData'
FINAL = ('ok', 'incompleto', 'revisar')


def default_data():
    here = Path(__file__).resolve().parent
    return here.parent if (here / 'ingest.py').exists() else Path(DEFAULT_DATA)


def load_ingest(data):
    tools = data / 'tools'
    if not (tools / 'ingest.py').exists():
        sys.exit(f'No encuentro {tools / "ingest.py"}')
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(tools))
    import ingest
    return ingest


def hhmm(m):
    return dt.datetime.fromtimestamp(m * 60, dt.timezone.utc).strftime('%H:%M')


def dias(n):
    return f"{n} día{'s' if n != 1 else ''}"


def subset_sum(qs, x):
    """True si alguna parte de qs suma exactamente x (x > 0).

    No exige que sean los primeros en orden de hora: el reloj de la vela no conserva el orden del
    archivo dentro de esos milisegundos (2021-10-16 12:51)."""
    if x <= 0:
        return False
    mask = (1 << (x + 1)) - 1
    r = 1
    for q in qs:
        r |= (r << int(q)) & mask
        if r >> x & 1:
            return True
    return False


def check_day(day, tp, ks):
    """Compara un día del tape (lo que entrega read_tape) con sus velas oficiales de 1 minuto (lista de la API de Bybit)."""
    meta, T, P, Q = tp[:4]
    ps, qs = int(meta['price_scale']), int(meta['qty_scale'])
    pdec, dec = len(str(ps)) - 1, len(str(qs)) - 1
    d0 = int(dt.datetime.fromisoformat(day + 'T00:00:00+00:00').timestamp()) // 60
    KV, KC = {}, {}
    for r in ks:
        m = int(r[0]) // 60000
        if d0 <= m < d0 + 1440:
            KV[m] = round(float(r[5]) * qs)
            KC[m] = round(float(r[4]) * ps)
    minute = T // MINUTE
    st = np.r_[0, np.nonzero(np.diff(minute))[0] + 1]
    en = np.r_[st[1:], len(T)]
    mins = minute[st].tolist()
    V = dict(zip(mins, np.add.reduceat(Q, st).tolist()))
    first = dict(zip(mins, st.tolist()))
    last = dict(zip(mins, en.tolist()))

    sin_vela = [m for m in mins if m not in KV]
    diff = {}
    for m in KV:
        dv = int(V.get(m, 0)) - KV[m]
        if dv:
            diff[m] = dv

    # Borde: lo que sobra de un lado del límite entre m y m+1 falta del otro, y sale de los trades
    # pegados a ese límite. Si la vela tiene más en m, son los primeros trades de m+1; si tiene
    # más en m+1, son los últimos de m.
    paired, bordes = set(), []
    for m in sorted(diff):
        if m in paired:
            continue
        dv, dn = diff[m], diff.get(m + 1)
        if dn is None or dn != -dv:
            continue
        b = (m + 1) * MINUTE
        if dv < 0:
            a, z = int(np.searchsorted(T, b, 'left')), int(np.searchsorted(T, b + EDGE, 'left'))
        else:
            a, z = int(np.searchsorted(T, b - EDGE, 'left')), int(np.searchsorted(T, b, 'left'))
        if subset_sum(Q[a:z].tolist(), abs(dv)):
            paired.update((m, m + 1))
            bordes.append(m)
    falta = {m: -v for m, v in diff.items() if v < 0 and m not in paired}
    sobra = {m: v for m, v in diff.items() if v > 0 and m not in paired}

    emp = suelto = cfalta = malo = 0
    ejemplos = []
    for m in mins:
        if m not in KC:
            continue
        z = last[m]
        c, kc = int(P[z - 1]), KC[m]
        if c == kc:
            continue
        g = int(np.searchsorted(T, T[z - 1], 'left'))
        if kc in set(P[g:z].tolist()):
            emp += 1          # varios trades con la misma hora: el archivo no revela cuál fue el último
            continue
        if m in falta:
            cfalta += 1       # el último trade del minuto puede ser uno de los que faltan
            continue
        # Con el volumen explicado, la vela pudo cerrar con un trade del último segundo. En un minuto
        # con borde, si la vela se llevó los últimos trades al minuto siguiente, su cierre es el
        # trade anterior a ellos, que puede quedar más atrás: ahí vale cualquier precio del minuto.
        b = (m + 1) * MINUTE
        lo = first[m] if m in paired else max(first[m], int(np.searchsorted(T, b - LAST, 'left')))
        hi = int(np.searchsorted(T, b + EDGE, 'left'))
        if m not in sobra and kc in set(P[lo:hi].tolist()):
            suelto += 1
            continue
        malo += 1
        if len(ejemplos) < 4:
            ejemplos.append(f'{hhmm(m)} cierre {c / ps:.{pdec}f} y la vela {kc / ps:.{pdec}f}')
    for m in sorted(sobra)[:4]:
        ejemplos.append(f'{hhmm(m)} sobran {sobra[m] / qs:.{dec}f}')
    for m in sin_vela[:4]:
        ejemplos.append(f'{hhmm(m)} trades sin vela')

    if sin_vela or sobra:
        estado = 'revisar'
    elif falta:
        estado = 'incompleto'
    elif malo:
        estado = 'revisar'
    else:
        estado = 'ok'
    vol_t, vol_k, f_tot = int(Q.sum()), sum(KV.values()), sum(falta.values())
    rec = dict(date=day, estado=estado, version=VERSION, vol=round(vol_t / qs, dec), vol_oficial=round(vol_k / qs, dec),
               falta=round(f_tot / qs, dec), falta_pct=round(100 * f_tot / vol_k, 3) if vol_k else None,
               min_falta=len(falta), min_sin_trades=sum(1 for m in falta if m not in V),
               sobra=round(sum(sobra.values()) / qs, dec), min_sobra=len(sobra), min_sin_vela=len(sin_vela),
               borde=len(bordes), cierre_empate=emp, cierre_suelto=suelto, cierre_falta=cfalta, cierre_malo=malo,
               minutos=len(mins), velas=len(KV))
    if falta:
        w = max(falta, key=falta.get)
        rec.update(primer_falta=hhmm(min(falta)), ultimo_falta=hhmm(max(falta)), peor_min=hhmm(w), peor_falta=round(falta[w] / qs, dec))
    if bordes:
        rec['bordes'] = [hhmm(m) for m in bordes[:10]]
    if ejemplos:
        rec['ejemplos'] = ejemplos
    return rec


def read_jsonl(path):
    out = {}
    try:
        with open(path, encoding='utf-8') as f:
            for line in f:
                try:
                    r = json.loads(line)
                except ValueError:
                    continue      # línea a medio escribir
                if isinstance(r, dict) and r.get('date'):
                    out[r['date']] = r
    except FileNotFoundError:
        pass
    return out


def still_valid(prev, row):
    return prev is not None and prev.get('version') == VERSION and prev.get('tape') == row.get('tape') and prev.get('estado') in FINAL


def reason(r):
    e = r['estado']
    if e == 'sin_velas':
        return 'no se pudieron consultar las velas oficiales'
    if e in ('sin_tape', 'error'):
        return r.get('error', '')
    out = []
    for k, txt in (('min_sobra', 'sobra volumen en {} minuto'), ('cierre_malo', 'cierre distinto en {} minuto'), ('min_sin_vela', 'trades en {} minuto')):
        n = r.get(k) or 0
        if n:
            s = txt.format(n) + ('s' if n != 1 else '')
            out.append(s + (' sin vela' if k == 'min_sin_vela' else ''))
    if r.get('falta'):
        out.append(f"falta {r['falta']} ({r['falta_pct']}%)")
    return ', '.join(out) + (' | ' + '; '.join(r['ejemplos']) if r.get('ejemplos') else '')


def summary(recs, days):
    sel = [recs[d] for d in days if d in recs]
    c = Counter(r['estado'] for r in sel)
    print(f'\nResumen de {dias(len(sel))}:', ', '.join(f'{k} {c[k]}' for k in ('ok', 'incompleto', 'revisar', 'sin_velas', 'sin_tape', 'error') if c[k]))
    ok = [r for r in sel if r['estado'] == 'ok']
    if ok:
        print(f"  ok con borde: {dias(sum(1 for r in ok if r['borde']))}; con cierre suelto: {dias(sum(1 for r in ok if r['cierre_suelto']))}")
    runs = []
    for r in sel:
        if r['estado'] != 'incompleto':
            continue
        d = dt.date.fromisoformat(r['date'])
        if runs and d - runs[-1][1] == dt.timedelta(days=1):
            runs[-1][1] = d
            runs[-1][2].append(r)
        else:
            runs.append([d, d, [r]])
    if runs:
        f_all = sum(x['falta'] for _, _, rs in runs for x in rs)
        v_all = sum(x['vol_oficial'] for _, _, rs in runs for x in rs)
        print(f'  incompletos: faltan {f_all:,.3f} de {v_all:,.3f} ({100 * f_all / v_all:.2f}%), por tramo:')
        for a, b, rs in runs:
            f = sum(x['falta'] for x in rs)
            v = sum(x['vol_oficial'] for x in rs)
            hasta = rs[-1].get('ultimo_falta', '') if a == b else f"{b} {rs[-1].get('ultimo_falta', '')}"
            print(f"    {a} {rs[0].get('primer_falta', '')} a {hasta}: {dias(len(rs))}, "
                  f"falta {f:,.3f} de {v:,.3f} ({100 * f / v:.3f}%), peor día {max(rs, key=lambda x: x['falta_pct'])['date']}")
    for r in sel:
        if r['estado'] not in ('ok', 'incompleto'):
            print('  ', r['date'], r['estado'] + ':', reason(r))


def main():
    ap = argparse.ArgumentParser(description='Verifica los días ya bajados contra las velas oficiales de 1 minuto.')
    ap.add_argument('symbol')
    ap.add_argument('--datos', help='carpeta de datos (por defecto ' + DEFAULT_DATA + ')')
    ap.add_argument('--desde')
    ap.add_argument('--hasta')
    ap.add_argument('--solo', help='fechas separadas por coma')
    ap.add_argument('--forzar', action='store_true', help='verifica de nuevo los días que ya tienen resultado')
    a = ap.parse_args()
    sym = a.symbol.upper()
    data = Path(a.datos) if a.datos else default_data()
    ing = load_ingest(data)
    man = data / 'manifest' / f'{sym}.jsonl'
    out = data / 'manifest' / f'{sym}.verificacion.jsonl'
    if not man.exists():
        sys.exit(f'No existe {man}')
    (data / 'work').mkdir(exist_ok=True)
    lock = open(data / 'work' / f'{sym}.verificacion.lock', 'w')
    try:
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        sys.exit(f'Ya hay otra verificación de {sym} corriendo')

    rows = read_jsonl(man)
    recs = read_jsonl(out)
    days = sorted(rows)
    if a.solo:
        days = [d for d in days if d in set(a.solo.split(','))]
    if a.desde:
        days = [d for d in days if d >= a.desde]
    if a.hasta:
        days = [d for d in days if d <= a.hasta]
    todo = [d for d in days if a.forzar or not still_valid(recs.get(d), rows[d])]
    rango = f', {dias(len(days))} en el rango' if len(days) != len(rows) else ''
    print(f'{sym}: {dias(len(rows))} en el manifest{rango}, {len(todo)} por verificar. Resultado en {out}', flush=True)

    ex = ThreadPoolExecutor(max_workers=PREFETCH)
    futs = {}
    t_all = time.time()
    try:
        with open(out, 'a', encoding='utf-8') as f:
            for i, day in enumerate(todo):
                for d2 in todo[i:i + PREFETCH + 1]:
                    if d2 not in futs:
                        futs[d2] = ex.submit(ing.klines, sym, d2)
                t0 = time.perf_counter()
                row = rows[day]
                tape = data / 'tape' / sym / day[:4] / f'{sym}_{day}.tape'
                base = dict(date=day, version=VERSION, ingest=row.get('status'), tape=row.get('tape'))
                try:
                    ks = futs.pop(day).result()
                    tp = None
                    if not tape.exists():
                        rec = dict(base, estado='sin_tape', error=f'no existe {tape.name}')
                    elif ks is None:
                        rec = dict(base, estado='sin_velas')
                    else:
                        try:
                            tp = ing.read_tape(tape)
                        except (OSError, AssertionError, ValueError, KeyError, zlib.error) as e:
                            rec = dict(base, estado='sin_tape', error=f'no se pudo leer {tape.name}: {e!r}')
                    if tp is not None:
                        rec = dict(check_day(day, tp, ks), ingest=base['ingest'], tape=base['tape'])
                except Exception as e:
                    rec = dict(base, estado='error', error=repr(e))
                rec['seg'] = round(time.perf_counter() - t0, 2)
                f.write(json.dumps(rec, separators=(',', ':')) + '\n')
                f.flush()
                recs[day] = rec
                left = len(todo) - i - 1
                eta = (time.time() - t_all) / (i + 1) * left / 60
                extra = f" falta {rec['falta']} ({rec['falta_pct']}%) en {rec['min_falta']} min" if rec['estado'] == 'incompleto' else ''
                if rec['estado'] == 'ok' and (rec.get('borde') or rec.get('cierre_suelto')):
                    extra = ''.join(f' {txt} {rec[k]}' for k, txt in (('borde', 'borde'), ('cierre_suelto', 'cierre suelto')) if rec[k])
                elif rec['estado'] not in ('ok', 'incompleto'):
                    extra = ' ' + reason(rec)
                print(f"{day} {rec['estado']}{extra} | {i + 1}/{len(todo)}, quedan {eta:.0f} min", flush=True)
    except KeyboardInterrupt:
        print('Detenido: lo verificado queda guardado y la próxima corrida sigue desde ahí.', flush=True)
    finally:
        ex.shutdown(wait=False, cancel_futures=True)
        tmp = out.with_name(out.name + '.tmp')
        with open(tmp, 'w', encoding='utf-8') as f:
            for d in sorted(recs):
                f.write(json.dumps(recs[d], separators=(',', ':')) + '\n')
        os.replace(tmp, out)
    summary(recs, days)


if __name__ == '__main__':
    main()
