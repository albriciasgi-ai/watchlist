// Detectores de horizontalidad: regimeDetectors.js contra backend/regime_detectors.py, con velas reales.
// Python (BACKEND_PYTHON o el .venv de la copia principal, con cwd en backend/) lee el caché de velas de App 1, corre
// cada detector con los valores afinados, los de fábrica y otras variantes, y devuelve las velas y lo que dio cada uno.
// Aquí se corre lo mismo y se compara: el estado vela por vela; las zonas con start, detected y end exactos y low y
// high con 1e-9 relativo; el rango mayor sobre las cajas de er_box; y, al bit, las piezas (sumas de numpy, SMA, ATR,
// Bollinger y el perfil de volumen con su forma). Al final, lo que tarda cada detector en JS.
// Uso: node tests/regimedetectors.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import * as rd from '../src/components/indicators/regimeDetectors.js';

const log = console.log;
const BACKEND = fileURLToPath(new URL('../../backend/', import.meta.url));
const MAIN_PYTHON = 'C:\\Users\\inven\\OneDrive\\Documentos\\GitHub\\watchlist\\1.Altagracia_Crypto_Backtester\\Backtester\\backend\\.venv\\Scripts\\python.exe';
const LOCAL_PYTHON = fileURLToPath(new URL(process.platform === 'win32' ? '../../backend/.venv/Scripts/python.exe' : '../../backend/.venv/bin/python', import.meta.url));

// Velas reales del caché de App 1: las últimas cerradas de cada marco. GALA es la moneda más chica de la carpeta
const DATASETS = [
  { symbol: 'BTCUSDT', key: '4h', tf: 240, count: 3000 },
  { symbol: 'BTCUSDT', key: '1h', tf: 60, count: 3000 },
  { symbol: 'BTCUSDT', key: '15m', tf: 15, count: 3000 },
  { symbol: 'BTCUSDT', key: '15m', tf: 15, count: 10000 },
  { symbol: 'GALAUSDT', key: '4h', tf: 240, count: 3000 },
  { symbol: 'GALAUSDT', key: '15m', tf: 15, count: 3000 }
];

// Cada detector con los afinados y los de fábrica de PARAMS (Python usa los suyos) y con variantes que pasan por
// los demás caminos del código: valores de la función, varias velas seguidas, la caja como referencia, sin P/b...
const VARIANTS = {
  er_box: [{}, { n: 14, below: 0.25, buffer: 0.25, exit_er: null, min_bars: 3 }],
  er: [{ n: 10, below: 0.35 }, { n: 20, below: 1.5 }],
  adx: [{ n: 10, below: 25 }],
  ttm: [{ n: 20, bb_k: 2.0, kc_k: 1.5, min_bars: 4 }],
  bbwp: [{ n: 14, lookback: 60, below: 30 }],
  atr_range: [{ length: 10, atr_len: 30, mult: 1.5, max_out: 2 }],
  vwap_bw: [{ threshold: 1.2, min_bars: 5 }, { threshold: 3.0, min_bars: 1 }],
  vp_prog: [
    { min_c: 20, range_pct: 99, range_atr: 5, min_d: 45, close_out: 3, ref: 'zone' },
    { min_c: 25, range_pct: 3, min_d: 50, close_out: 2, pb: false },
    { min_c: 20, range_atr: 4, min_d: 30, close_out: 1, bins: 30 }
  ]
};
const describe = (params) => Object.entries(params).map(([k, v]) => `${k} ${v}`).join(', ') || 'valores de la función';
const CASES = [];
for (const [detector, entry] of Object.entries(rd.PARAMS)) {
  CASES.push({ detector, set: 'params', label: `${detector} afinados` });
  if (entry.original) CASES.push({ detector, set: 'original', label: `${detector} de fábrica` });
  for (const params of VARIANTS[detector] || []) CASES.push({ detector, params, label: `${detector} (${describe(params)})` });
}
const MAJORS = [
  { max_atr: 8.0, buffer: 0.5, closes_out: 1 },
  { max_atr: 8.0, buffer: 0.5, closes_out: 6 },
  { max_atr: 4.0, buffer: 0.25, closes_out: 3 }
];
// _clean_params de Python contra cleanParams
const CLEAN = [
  ['er_box', null],
  ['er_box', { below: 0.25, otro: 3 }],
  ['vp_prog', { range_atr: null, min_c: 25 }],
  ['vp_prog', { range_atr: '', range_pct: '2.5' }],
  ['vwap_bw', { threshold: 1.9, min_bars: 4 }],
  ['adx', { n: '10', below: 'x' }],
  ['atr_range', { mult: '1.5', length: 25.0, max_out: 3 }],
  ['ttm', { kc_k: 1.5, min_bars: 2 }]
];

const SCRIPT = String.raw`
import gc, gzip, json, math, os, sys, time
sys.path.insert(0, sys.argv[1])
import numpy as np
import regime
import regime_detectors as rd

req = json.loads(sys.stdin.read())


def num(x):
    x = float(x)
    return x if math.isfinite(x) else None  # NaN e infinitos no caben en JSON


def nums(xs):
    return [num(x) for x in xs]


def plain(z):
    out = {}
    for k, val in z.items():
        if isinstance(val, (bool, np.bool_)):
            out[k] = bool(val)
        elif isinstance(val, (int, np.integer)):
            out[k] = int(val)
        elif isinstance(val, (float, np.floating)):
            out[k] = num(val)
        else:
            out[k] = val
    return out


def bits(state):
    return "".join("1" if s else "0" for s in state)


def frames_of(symbol):
    path = os.path.join("backtesting_cache", symbol + "_backtesting_data.json.gz")
    for attempt in range(4):
        try:
            with gzip.open(path, "rb") as fh:
                return json.loads(fh.read())["timeframes"]
        except (EOFError, OSError, ValueError):
            if attempt == 3:
                raise
            time.sleep(3)  # App 1 reescribe el caché sin archivo temporal: leído a mitad, se espera y se repite


def detect(case, a, tf):
    name = case["detector"]
    if "set" in case:
        params = rd._clean_params(name, rd.PARAMS[name][case["set"]])
        return params, rd.run_detector(name, a, tf, params)
    params = case["params"]
    return params, (rd.DETECTORS[name](a, tf, **params) if name == "vwap_bw" else rd.DETECTORS[name](a, **params))


now = time.time() * 1000
out = {"params": rd.PARAMS, "detectors": list(rd.DETECTORS), "clean": [rd._clean_params(name, raw) for name, raw in req["clean"]],
       "datasets": [], "sums": []}
# Primero las velas de cada conjunto, leyendo cada caché una vez; después se suelta, para que su recolección de
# basura no caiga dentro de los tiempos de los detectores
arrays = []
for symbol in dict.fromkeys(ds["symbol"] for ds in req["datasets"]):
    frames = frames_of(symbol)
    for k, ds in enumerate(req["datasets"]):
        if ds["symbol"] != symbol:
            continue
        step = ds["tf"] * 60000
        # Velas cerradas, como rule_tester.candle_bars: sin la vela en curso y con máximo >= mínimo > 0
        rows = [r for r in ((frames.get(ds["key"]) or {}).get("main") or [])
                if int(r["timestamp"]) + step <= now and r["high"] >= r["low"] > 0][-ds["count"]:]
        a = {"t": np.array([int(r["timestamp"]) for r in rows], dtype=np.int64)}
        for key, src in (("o", "open"), ("h", "high"), ("l", "low"), ("c", "close"), ("v", "volume")):
            a[key] = np.array([float(r.get(src) or 0) for r in rows], dtype=float)
        arrays.append((k, a))
    frames = None
    gc.collect()
arrays = [a for _, a in sorted(arrays, key=lambda item: item[0])]
for ds, a in zip(req["datasets"], arrays):
    step = ds["tf"] * 60000
    entry = {"symbol": ds["symbol"], "key": ds["key"], "tf": ds["tf"], "bars": {k: a[k].tolist() for k in a}, "cases": [], "major": []}
    for case in req["cases"]:
        start = time.perf_counter()
        params, res = detect(case, a, ds["tf"])
        item = {"params": params, "ms": (time.perf_counter() - start) * 1000, "state": bits(res["state"]),
                "zones": [plain(z) for z in res["zones"]]}
        if "value" in res:
            item["value"] = nums(res["value"])
        entry["cases"].append(item)
    # El rango mayor sobre las cajas de er_box, armado como en view(): cada caja en la vela en que se supo
    box = rd.run_detector("er_box", a, ds["tf"], rd._clean_params("er_box", rd.PARAMS["er_box"]["params"]))
    t = a["t"]
    parts = [{"i": int(np.searchsorted(t + step, t[z["detected"]] + step, side="left")), "low": z["low"], "high": z["high"],
              "startT": int(t[z["start"]])} for z in box["zones"]]
    for m in req["major"]:
        start = time.perf_counter()
        res = rd.major(a, parts, m["max_atr"], m["buffer"], m["closes_out"])
        entry["major"].append({"ms": (time.perf_counter() - start) * 1000, "state": bits(res["state"]),
                               "zones": [plain(z) for z in res["zones"]]})
    # Piezas que tienen que dar lo mismo al bit
    h, l, c, v = a["h"], a["l"], a["c"], a["v"]
    mid, up, lo = rd.bollinger(c, 20, 2.0)
    entry["pieces"] = {"sma": nums(rd.sma(c, 20)), "tr": nums(rd.true_range(h, l, c)), "atr": nums(regime.atr(h, l, c)),
                       "bbMid": nums(mid), "bbUp": nums(up), "bbLo": nums(lo)}
    profiles = []
    for s in range(0, len(c) - 80, max(53, len(c) // 60)):
        for size in (20, 30, 57, 80):
            p = rd.volume_profile(h[s:s + size], l[s:s + size], v[s:s + size], 50)
            if p is None:
                profiles.append({"s": s, "size": size, "none": True})
                continue
            kind, d = rd.shape(p)
            profiles.append({"s": s, "size": size, "vol": nums(p["vol"]), "edges": nums(p["edges"]), "poc": int(p["poc"]),
                             "val": num(p["val"]), "vah": num(p["vah"]), "low": num(p["low"]), "high": num(p["high"]),
                             "total": num(p["total"]), "shape": kind, "d": int(d)})
    entry["profiles"] = profiles
    out["datasets"].append(entry)
rng = np.random.default_rng(11)
for n in list(range(0, 300)) + [383, 512, 1000, 1440, 4097]:
    x = rng.standard_normal(n) * 10.0 ** rng.uniform(-3, 6, n)
    out["sums"].append({"x": x.tolist(), "sum": float(x.sum()), "std": float(x.std()) if n else None})
sys.stdout.write(json.dumps(out))
`;

function backendPython() {
  if (process.env.BACKEND_PYTHON) return process.env.BACKEND_PYTHON;
  if (existsSync(MAIN_PYTHON)) return MAIN_PYTHON;
  if (existsSync(LOCAL_PYTHON)) return LOCAL_PYTHON;
  throw new Error('No encuentro el Python del backend: indícalo en BACKEND_PYTHON');
}

function runPython() {
  const python = backendPython();
  const request = {
    datasets: DATASETS.map(({ symbol, key, tf, count }) => ({ symbol, key, tf, count })),
    cases: CASES.map(({ detector, set, params }) => (set ? { detector, set } : { detector, params })),
    major: MAJORS,
    clean: CLEAN
  };
  const started = performance.now();
  try {
    const raw = execFileSync(python, ['-B', '-c', SCRIPT, BACKEND], {
      cwd: BACKEND, input: JSON.stringify(request), encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe']
    });
    log(`Python (${python}): ${((performance.now() - started) / 1000).toFixed(1)} s`);
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`No pude correr backend/regime_detectors.py con ${python}: ${String(error.stderr || error.message).trim().split('\n').slice(-3).join(' | ')}`);
  }
}

const py = runPython();
const datasets = py.datasets.map((entry, k) => ({
  ...entry,
  name: `${entry.symbol} ${entry.key} (${entry.bars.c.length.toLocaleString('es')} velas)`,
  count: DATASETS[k].count,
  arrays: Object.fromEntries(Object.entries(entry.bars).map(([key, values]) => [key, Float64Array.from(values)]))
}));

// ---- Comparación

const tests = [];
const test = (name, run) => tests.push([name, run]);
const totals = { cases: 0, passed: 0, zones: 0, prices: 0, exact: 0 };
const MAX_REPORT = 6;

const close = (a, b) => a === b || Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b));
const bitsOf = (state) => Array.from(state, s => (s ? '1' : '0')).join('');
// Lo de Python viene con null en lugar de NaN
const sameValue = (js, pyValue) => (pyValue === null ? Number.isNaN(js) : js === pyValue);

function compareArrays(label, js, pyValues, problems) {
  if (js.length !== pyValues.length) {
    problems.push(`${label}: largo ${js.length} contra ${pyValues.length}`);
    return;
  }
  let first = -1, count = 0;
  for (let i = 0; i < js.length; i++) {
    if (!sameValue(js[i], pyValues[i])) {
      count++;
      if (first < 0) first = i;
    }
  }
  if (count) problems.push(`${label}: ${count} valores distintos al bit, el primero en la vela ${first} (${js[first]} contra ${pyValues[first]})`);
}

function compareRun(label, js, pyRun, problems) {
  const state = bitsOf(js.state);
  if (state !== pyRun.state) {
    let first = 0, count = 0;
    while (first < state.length && state[first] === pyRun.state[first]) first++;
    for (let i = 0; i < Math.max(state.length, pyRun.state.length); i++) if (state[i] !== pyRun.state[i]) count++;
    problems.push(`${label}: estado distinto en ${count} velas, la primera en ${first} (JS ${state[first]}, Python ${pyRun.state[first]})`);
  }
  if (js.zones.length !== pyRun.zones.length) problems.push(`${label}: ${js.zones.length} zonas en JS contra ${pyRun.zones.length} en Python`);
  for (let k = 0; k < Math.min(js.zones.length, pyRun.zones.length); k++) {
    const a = js.zones[k], b = pyRun.zones[k];
    const keys = Object.keys(b);
    if (Object.keys(a).sort().join() !== [...keys].sort().join()) {
      problems.push(`${label}: zona ${k} con campos ${Object.keys(a).join(', ')} contra ${keys.join(', ')}`);
      continue;
    }
    totals.zones++;
    for (const key of keys) {
      if (key === 'low' || key === 'high') {
        totals.prices++;
        if (a[key] === b[key]) totals.exact++;
        else if (!close(a[key], b[key])) problems.push(`${label}: zona ${k} (velas ${b.start}-${b.end}), ${key} ${a[key]} contra ${b[key]}`);
      } else if (a[key] !== b[key]) {
        problems.push(`${label}: zona ${k}, ${key} ${a[key]} contra ${b[key]}`);
      }
    }
  }
  if (pyRun.value) compareArrays(`${label}, value`, js.value, pyRun.value, problems);
}

// Una comparación por conjunto de velas: cuenta como un caso y junta sus diferencias
function check(problems, label, run) {
  totals.cases++;
  const mine = [];
  try {
    run(mine);
  } catch (error) {
    mine.push(`${label}: ${error.message}`);
  }
  if (!mine.length) totals.passed++;
  problems.push(...mine);
}

function finish(problems) {
  if (problems.length) {
    const more = problems.length > MAX_REPORT ? `\n… y ${problems.length - MAX_REPORT} más` : '';
    throw new Error(problems.slice(0, MAX_REPORT).join('\n') + more);
  }
}

function runCase(entry, arrays, tf) {
  if (entry.set) return rd.runDetector(entry.detector, arrays, tf, rd.PARAMS[entry.detector][entry.set]);
  const detector = rd.DETECTORS[entry.detector];
  return entry.detector === 'vwap_bw' ? detector(arrays, tf, entry.params) : detector(arrays, entry.params);
}

test('las velas llegan completas y en orden', () => {
  for (const ds of datasets) {
    const { t } = ds.arrays;
    assert.equal(t.length, ds.count, `${ds.name}: faltan velas en el caché`);
    for (let i = 1; i < t.length; i++) assert.ok(t[i] > t[i - 1], `${ds.name}: vela ${i} fuera de orden`);
  }
});

test('valores, etiquetas y detectores iguales a regime_detectors.PARAMS', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(rd.PARAMS)), py.params);
  assert.deepEqual(Object.keys(rd.PARAMS), Object.keys(py.params), 'mismo orden del catálogo');
  assert.deepEqual(Object.keys(rd.DETECTORS), py.detectors);
  assert.deepEqual(rd.catalog().map(entry => entry.key), Object.keys(py.params));
  const problems = [];
  CLEAN.forEach(([name, raw], k) => check(problems, `cleanParams ${name} ${JSON.stringify(raw)}`, (mine) => {
    try {
      assert.deepEqual(rd.cleanParams(name, raw), py.clean[k]);
    } catch (error) {
      mine.push(error.message);
    }
  }));
  finish(problems);
});

test('sumas y desviación como numpy, al bit (0 a 4,097 valores)', () => {
  const problems = [];
  check(problems, 'sumas', (mine) => {
    for (const { x, sum, std } of py.sums) {
      if (rd.npSum(x) !== sum) mine.push(`np.sum de ${x.length} valores: ${rd.npSum(x)} contra ${sum}`);
      if (std !== null && rd.npStd(x) !== std) mine.push(`np.std de ${x.length} valores: ${rd.npStd(x)} contra ${std}`);
    }
  });
  finish(problems);
});

CASES.forEach((entry, k) => {
  test(entry.label, () => {
    const problems = [];
    const summary = [];
    for (const ds of datasets) {
      const pyRun = ds.cases[k];
      check(problems, `${ds.name}, ${entry.label}`, (mine) => {
        if (entry.set) {
          try {
            assert.deepEqual(rd.cleanParams(entry.detector, rd.PARAMS[entry.detector][entry.set]), pyRun.params);
          } catch (error) {
            mine.push(`${ds.name}: valores distintos de los de Python: ${error.message}`);
          }
        }
        compareRun(ds.name, runCase(entry, ds.arrays, ds.tf), pyRun, mine);
      });
      summary.push(`${ds.symbol.replace('USDT', '')} ${ds.key}${ds.count > 3000 ? '·10k' : ''} ${pyRun.zones.length}`);
    }
    finish(problems);
    return `zonas: ${summary.join(', ')}`;
  });
});

test('rango mayor sobre las cajas de er_box afinado (closes_out 1 y 6, y 3 con 4 ATR)', () => {
  const problems = [];
  for (const ds of datasets) {
    const box = rd.runDetector('er_box', ds.arrays, ds.tf, rd.PARAMS.er_box.params);
    const parts = rd.partsFromZones(box.zones, ds.arrays.t);
    MAJORS.forEach((params, k) => check(problems, `${ds.name}, major ${describe(params)}`, (mine) => {
      compareRun(`${ds.name}, major ${describe(params)}`, rd.major(ds.arrays, parts, params), ds.major[k], mine);
    }));
  }
  finish(problems);
});

test('piezas al bit: SMA de 20, rango verdadero, ATR de Wilder y Bollinger de 20 a 2σ', () => {
  const problems = [];
  for (const ds of datasets) {
    check(problems, `${ds.name}, piezas`, (mine) => {
      const { h, l, c } = ds.arrays;
      const bands = rd.bollinger(c, 20, 2.0);
      compareArrays(`${ds.name}, SMA`, rd.sma(c, 20), ds.pieces.sma, mine);
      compareArrays(`${ds.name}, rango verdadero`, rd.trueRange(h, l, c), ds.pieces.tr, mine);
      compareArrays(`${ds.name}, ATR de Wilder`, rd.atrWilder(h, l, c), ds.pieces.atr, mine);
      compareArrays(`${ds.name}, Bollinger media`, bands.mid, ds.pieces.bbMid, mine);
      compareArrays(`${ds.name}, Bollinger arriba`, bands.up, ds.pieces.bbUp, mine);
      compareArrays(`${ds.name}, Bollinger abajo`, bands.lo, ds.pieces.bbLo, mine);
    });
  }
  finish(problems);
});

test('perfil de volumen y forma de App 8 en tramos sueltos, al bit', () => {
  const problems = [];
  for (const ds of datasets) {
    check(problems, `${ds.name}, perfiles`, (mine) => {
      const { h, l, v } = ds.arrays;
      for (const p of ds.profiles) {
        const label = `${ds.name}, perfil de ${p.size} velas desde ${p.s}`;
        const js = rd.volumeProfile(h.subarray(p.s, p.s + p.size), l.subarray(p.s, p.s + p.size), v.subarray(p.s, p.s + p.size), 50);
        if (p.none || js === null) {
          if (!p.none || js !== null) mine.push(`${label}: ${js === null ? 'sin perfil en JS' : 'sin perfil en Python'}`);
          continue;
        }
        compareArrays(`${label}, volumen por franja`, js.vol, p.vol, mine);
        compareArrays(`${label}, bordes`, js.edges, p.edges, mine);
        for (const key of ['poc', 'val', 'vah', 'low', 'high', 'total']) {
          if (js[key] !== p[key]) mine.push(`${label}: ${key} ${js[key]} contra ${p[key]}`);
        }
        const [kind, d] = rd.shape(js);
        if (kind !== p.shape || d !== p.d) mine.push(`${label}: forma ${kind} ${d} contra ${p.shape} ${p.d}`);
      }
    });
  }
  finish(problems);
});

// No compara con Python: dice qué detectores se pueden calcular una vez y cortar en la hora simulada. atr_range no:
// las velas de una salida de su caja (hasta max_out) quedan fuera del rango y, si el precio vuelve, pasan a rango.
// Así lo hace Python (con velas hasta la 838 de BTC 4h, la 836 no es rango; con las siguientes, sí)
test('sin futuro: cortar las velas no cambia lo ya cerrado, salvo atr_range, que repinta como en Python', () => {
  const cutTo = (arrays, cut) => Object.fromEntries(Object.entries(arrays).map(([key, values]) => [key, values.subarray(0, cut)]));
  const leaks = [], repaints = [];
  for (const ds of datasets.filter(d => d.symbol === 'BTCUSDT' && d.count === 3000 && d.key !== '1h')) {
    const n = ds.arrays.c.length;
    const box = (arrays) => rd.partsFromZones(rd.runDetector('er_box', arrays, ds.tf, rd.PARAMS.er_box.params).zones, arrays.t);
    const runs = [
      ...CASES.filter(entry => entry.set).map(entry => [entry.label, (arrays) => runCase(entry, arrays, ds.tf).state]),
      ['major closes_out 6', (arrays) => rd.major(arrays, box(arrays), MAJORS[1]).state]
    ];
    for (const [label, run] of runs) {
      const full = run(ds.arrays);
      let bars = 0, cuts = 0;
      for (let cut = 300; cut < n; cut += 50) {
        const part = run(cutTo(ds.arrays, cut));
        let changed = 0;
        for (let i = 0; i < cut; i++) if (part[i] !== full[i]) changed++;
        bars += changed;
        if (changed) cuts++;
      }
      if (bars) (label.startsWith('atr_range') ? repaints : leaks).push(`${ds.name}, ${label}: ${bars} velas en ${cuts} cortes`);
    }
  }
  assert.deepEqual(leaks, []);
  return repaints.length ? `repinta: ${repaints.join('; ')}` : '';
});

test('con arreglos comunes en lugar de Float64Array da lo mismo', () => {
  const problems = [];
  const ds = datasets[0];
  const plainArrays = Object.fromEntries(Object.entries(ds.arrays).map(([key, values]) => [key, Array.from(values)]));
  CASES.forEach((entry, k) => {
    if (!entry.set) return;
    check(problems, `${ds.name} en Array, ${entry.label}`, (mine) => compareRun(`${ds.name} en Array, ${entry.label}`, runCase(entry, plainArrays, ds.tf), ds.cases[k], mine));
  });
  finish(problems);
});

test('toArrays: velas de App 1 sin la vela en formación', () => {
  const { t, o, h, l, c, v } = datasets[0].arrays;
  const candles = Array.from(t, (timestamp, i) => ({ timestamp, open: o[i], high: h[i], low: l[i], close: c[i], volume: v[i] }));
  candles.push({ timestamp: t[t.length - 1] + 240 * 60000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 9, in_progress: true });
  const arrays = rd.toArrays(candles);
  for (const key of ['t', 'o', 'h', 'l', 'c', 'v']) assert.deepEqual(Array.from(arrays[key]), Array.from(datasets[0].arrays[key]), key);
  const backend = rd.toArrays([{ t: 5, o: 1, h: 2, l: 0.5, c: 1.5, vol: 7 }]);
  assert.equal(backend.v[0], 7);
  assert.equal(backend.t[0], 5);
});

// ---- Correr las pruebas

let failed = 0;
for (const [name, run] of tests) {
  try {
    const note = await run();
    log(`ok    ${name}${note ? ` · ${note}` : ''}`);
  } catch (error) {
    failed++;
    log(`FALLA ${name}\n${error.message}`);
  }
}

// ---- Lo que tarda cada detector en JS (mediana de varias corridas, con los afinados), y Python en una corrida

const TIMED = [
  ['BTCUSDT 4h · 3,000', datasets.find(ds => ds.key === '4h' && ds.symbol === 'BTCUSDT')],
  ['BTCUSDT 15m · 3,000', datasets.find(ds => ds.key === '15m' && ds.symbol === 'BTCUSDT' && ds.count === 3000)],
  ['BTCUSDT 15m · 10,000', datasets.find(ds => ds.key === '15m' && ds.symbol === 'BTCUSDT' && ds.count === 10000)]
];

function median(run, reps) {
  run();
  const times = [];
  for (let k = 0; k < reps; k++) {
    const started = performance.now();
    run();
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  return times[times.length >> 1];
}

const fmt = (ms) => (ms < 10 ? ms.toFixed(2) : ms.toFixed(1)).padStart(7);
const rows = [];
for (const [detector, entry] of Object.entries(rd.PARAMS)) {
  const sets = entry.original && detector === 'vp_prog' ? ['params', 'original'] : ['params'];
  for (const set of sets) {
    const k = CASES.findIndex(c => c.detector === detector && c.set === set);
    rows.push([CASES[k].label, (ds) => rd.runDetector(detector, ds.arrays, ds.tf, entry[set]), (ds) => ds.cases[k].ms]);
  }
}
rows.push(['major (closes_out 1, sobre er_box)', (ds) => {
  const parts = ds.parts || (ds.parts = rd.partsFromZones(rd.runDetector('er_box', ds.arrays, ds.tf, rd.PARAMS.er_box.params).zones, ds.arrays.t));
  return rd.major(ds.arrays, parts, MAJORS[0]);
}, (ds) => ds.major[0].ms]);

const REPS = 11;
log(`\nTiempo por detector, en ms (JS: mediana de ${REPS} corridas · Python: una corrida)`);
log(`${'Detector'.padEnd(38)}${TIMED.map(([name]) => name.padStart(26)).join('')}`);
for (const [label, run, pyMs] of rows) {
  const cells = TIMED.map(([, ds]) => `${fmt(median(() => run(ds), REPS))} JS ${fmt(pyMs(ds))} Py`.padStart(26));
  log(`${label.padEnd(38)}${cells.join('')}`);
}

log(`\nCasos: ${totals.passed} de ${totals.cases} iguales a Python. Zonas comparadas: ${totals.zones.toLocaleString('es')}; low y high iguales al bit: ${totals.exact.toLocaleString('es')} de ${totals.prices.toLocaleString('es')}`);
log(`${tests.length - failed} de ${tests.length} correctas`);
process.exit(failed ? 1 : 0);
