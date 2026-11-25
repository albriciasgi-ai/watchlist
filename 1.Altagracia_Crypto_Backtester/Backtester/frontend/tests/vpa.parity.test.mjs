// Paridad: vpa.js (navegador) contra backend/vpa.py (probador de reglas). Mismas velas, mismos números al bit, también
// al agregarlas de a una (lo ya calculado no cambia). Python: BACKEND_PYTHON, el .venv de esta copia o el de la principal.
// Uso: node tests/vpa.parity.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VpaReader, computeVpa, cleanVpaParams, cleanVpaConfig, defaultVpaParams, describeVpa, up, down, volumeWidthFactor } from '../src/components/indicators/vpa.js';
import VPAIndicator from '../src/components/indicators/VPAIndicator.js';

const MAIN_PYTHON = 'C:\\Users\\inven\\OneDrive\\Documentos\\GitHub\\watchlist\\1.Altagracia_Crypto_Backtester\\Backtester\\backend\\.venv\\Scripts\\python.exe';
const LOCAL_PYTHON = fileURLToPath(new URL(process.platform === 'win32' ? '../../backend/.venv/Scripts/python.exe' : '../../backend/.venv/bin/python', import.meta.url));
const BACKEND = fileURLToPath(new URL('../../backend', import.meta.url));

function backendPython() {
  if (process.env.BACKEND_PYTHON) return process.env.BACKEND_PYTHON;
  if (existsSync(LOCAL_PYTHON) && existsSync(join(LOCAL_PYTHON, '..', '..', 'pyvenv.cfg'))) return LOCAL_PYTHON;
  if (existsSync(MAIN_PYTHON)) return MAIN_PYTHON;
  throw new Error('No encuentro el Python del backend: indícalo en BACKEND_PYTHON');
}

// Velas al azar con rachas de volumen alto y bajo y velas con mechas largas, para que aparezcan todos los elementos
function randomBars(n, seed, step) {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const out = [];
  let price = 100;
  let drift = 0;
  for (let i = 0; i < n; i += 1) {
    if (i % 60 === 0) drift = (rand() - 0.5) * 0.01;
    const open = price;
    const close = open * (1 + drift + (rand() - 0.5) * 0.02);
    const wickUp = rand() < 0.15 ? rand() * 0.03 : rand() * 0.006;
    const wickDown = rand() < 0.15 ? rand() * 0.03 : rand() * 0.006;
    const volume = (100 + rand() * 900) * (rand() < 0.1 ? 4 : rand() < 0.2 ? 0.3 : 1);
    out.push({ t: 1600000000000 + i * step, o: open, h: Math.max(open, close) * (1 + wickUp), l: Math.min(open, close) * (1 - wickDown), c: close, v: volume });
    price = close;
  }
  return out;
}

const SCRIPT = `
import json, sys
sys.path.insert(0, sys.argv[1])
import vpa
data = json.load(open(sys.argv[2], encoding="utf-8"))
bars, tf, cfg = data["bars"], data["tf"], data["cfg"]
t = [b["t"] for b in bars]; o = [b["o"] for b in bars]; h = [b["h"] for b in bars]; l = [b["l"] for b in bars]; c = [b["c"] for b in bars]; v = [b["v"] for b in bars]
def clean(x):
    if isinstance(x, float) and x != x: return None
    if isinstance(x, list): return [clean(y) for y in x]
    if isinstance(x, dict): return {k: clean(y) for k, y in x.items()}
    return x
s = vpa.compute(t, o, h, l, c, v, tf, cfg)
ev = vpa.detect(t, o, h, l, c, v, tf, cfg, series=s)
print(json.dumps(clean({"s": s, "ev": ev})))
`;

const KEYS = ['atr', 'rv', 'rr', 'q', 'absorb', 'trap', 'valid', 'upper', 'lower', 'body', 'closeLoc', 'star', 'hammer', 'doji',
  'ext', 'maturity', 'fade', 'contrib', 'meter', 'leg', 'legStart', 'legExtreme', 'dir', 'hang', 'invh',
  'rvn', 'rrn', 'rvHi', 'wide', 'absorbE', 'validE', 'boxLow', 'boxHigh'];
// Los valores que repiten la regla de antes del motor 7 (galería 2 del protocolo de pruebas, 24/11/2026)
const BEFORE_M7 = { nearBars: 0, skipAfterWide: false, wideResult: false, wideMeter: false, testBox: false, testAfter: false, stopWick: [0.25, 0.4], pullBack: false };
const nn = (x) => (typeof x === 'number' && Number.isNaN(x) ? null : x);

function runPython(bars, tf, cfg) {
  const dir = mkdtempSync(join(tmpdir(), 'vpa-'));
  try {
    const script = join(dir, 'p.py');
    const input = join(dir, 'in.json');
    writeFileSync(script, SCRIPT);
    writeFileSync(input, JSON.stringify({ bars, tf, cfg }));
    return JSON.parse(execFileSync(backendPython(), ['-B', script, BACKEND, input], { maxBuffer: 1 << 28 }).toString());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('las rampas suben y bajan sin salirse de 0 a 1', () => {
  assert.equal(up(1, 2, 3), 0); assert.equal(up(4, 2, 3), 1); assert.equal(up(2.5, 2, 3), 0.5);
  assert.equal(down(1, 2, 3), 1); assert.equal(down(4, 2, 3), 0); assert.equal(down(2.5, 2, 3), 0.5);
  assert.equal(up(NaN, 0, 1), 0); assert.equal(down(NaN, 0, 1), 0);
});

test('los parámetros fuera de rango vuelven a un valor válido', () => {
  const p = cleanVpaParams({ days: 1000, minDays: 50, decay: 'x', volHigh: [2, 1], legAtr: 0 });
  assert.equal(p.days, 120);
  assert.equal(p.minDays, 30);
  assert.equal(p.decay, defaultVpaParams().decay);
  assert.deepEqual(p.volHigh, defaultVpaParams().volHigh);
  assert.equal(p.legAtr, 0.5);
});

const strip = (e) => ({ code: e.code, dir: e.dir, index: e.index, lo: e.lo, hi: e.hi, grade: e.grade });

for (const [tf, step, n, seed] of [[240, 14400000, 1500, 7], [15, 900000, 4000, 11], [1440, 86400000, 400, 3]]) {
  for (const [name, extra, must] of [['de fábrica', {}, ['QA', 'QV', 'QB', 'QE', 'QG']], ['con la regla de antes del motor 7', BEFORE_M7, ['QA', 'QB', 'QT', 'QE']]]) {
    test(`vpa.js y vpa.py dan lo mismo al bit en ${tf} minutos, ${name}`, () => {
      const bars = randomBars(n, seed, step);
      const cfg = { ...defaultVpaParams(), ...extra };
      const py = runPython(bars, tf, cfg);
      const js = computeVpa(bars, tf, cfg);
      for (const key of KEYS) {
        assert.equal(js.s[key].length, n, key);
        for (let i = 0; i < n; i += 1) assert.equal(nn(js.s[key][i]), py.s[key][i], `${key}[${i}]`);
      }
      assert.deepEqual(js.events.map(strip), py.ev.map(strip));
      const codes = new Set(js.events.map(e => e.code));
      if (tf !== 1440) for (const code of must) assert.ok(codes.has(code), `aparece ${code}`);
    });
  }
}

test('motor 7: con la regla de antes, los elementos de siempre no cambian; de fábrica, lo alto también frente a las vecinas', () => {
  const bars = randomBars(3000, 13, 14400000);
  const before = computeVpa(bars, 240, { ...defaultVpaParams(), ...BEFORE_M7 });
  const now = computeVpa(bars, 240);
  // El medidor solo cambia por wideMeter, y solo en las velas anchas
  const meterOld = computeVpa(bars, 240, { ...defaultVpaParams(), wideMeter: false });
  for (let i = 0; i < bars.length; i += 1) assert.equal(meterOld.s.meter[i], before.s.meter[i], `meter[${i}]`);
  let moved = 0;
  for (let i = 0; i < bars.length; i += 1) {
    if (now.s.contrib[i] !== meterOld.s.contrib[i]) {
      moved += 1;
      assert.ok(now.s.wide[i] > 0, `el medidor cambia en una vela que no es ancha ${i}`);
      assert.ok(now.s.absorb[i] <= meterOld.s.absorb[i] && now.s.valid[i] >= meterOld.s.valid[i], `${i}`);
    }
  }
  assert.ok(moved > 0, 'alguna vela ancha cambia el medidor');
  const fire = now.cfg.fire;
  for (const e of now.events) {
    const i = e.index;
    if (['QA', 'QV', 'QB'].includes(e.code)) assert.ok(now.s.rvHi[i] <= now.s.rv[i] && now.s.rvHi[i] <= now.s.rvn[i], `${e.code} ${i}`);
    if (e.code === 'QA') assert.ok(!(now.s.wide[i - 1] >= fire), `esfuerzo tras una vela ancha ${i}`);
    if (e.code === 'QA') assert.ok(!(now.s.wide[i] > 1 - fire), `esfuerzo sin resultado en una vela ancha ${i}`);
    if (e.code === 'QV') assert.ok(now.s.wide[i] >= fire, `esfuerzo con resultado en una vela que no es ancha ${i}`);
    if (e.code === 'QT') assert.ok(Number.isFinite(now.s.boxLow[i]), `prueba fuera de una caja ${i}`);
    if (e.code === 'QR') assert.ok(Number.isFinite(e.info.breakout), 'el retroceso sabe su ruptura');
  }
  // Lo que no cambió: la ruptura sin volumen; y el cruce del medidor, sin wideMeter
  const only = (r, code) => r.events.filter(e => e.code === code).map(strip);
  assert.deepEqual(only(now, 'QF'), only(before, 'QF'), 'QF');
  assert.deepEqual(only(meterOld, 'QE'), only(before, 'QE'), 'QE');
  // El esfuerzo sin resultado y la ruptura con volumen de fábrica están entre los de antes
  for (const code of ['QA', 'QB']) {
    const old = new Set(before.events.filter(e => e.code === code).map(e => `${e.index}:${e.dir}`));
    for (const e of now.events.filter(x => x.code === code)) assert.ok(old.has(`${e.index}:${e.dir}`), `${code} ${e.index}`);
  }
});

test('agregar velas no cambia lo ya calculado (sin futuro)', () => {
  const bars = randomBars(1200, 5, 14400000);
  const whole = computeVpa(bars, 240);
  const part = computeVpa(bars.slice(0, 700), 240);
  for (const key of KEYS) for (let i = 0; i < 700; i += 1) assert.equal(nn(part.s[key][i]), nn(whole.s[key][i]), `${key}[${i}]`);
  const early = whole.events.filter(e => e.index < 700);
  assert.deepEqual(part.events, early);
});

test('el cuadro de la vela dice lo que leyó', () => {
  const reader = new VpaReader(240);
  for (const bar of randomBars(400, 9, 14400000)) reader.push(bar);
  const lines = describeVpa(reader, 399);
  assert.ok(lines.length >= 2);
  assert.ok(lines.at(-1).startsWith('Tramo'));
  assert.match(lines[0], /su hora · .* las 20 anteriores/, 'el volumen, contra su hora y contra las vecinas');
  assert.deepEqual(describeVpa(reader, 0), ['Sin volumen normal de esta hora todavía (primeros días)']);
});

test('velas con ancho por volumen: el volumen normal da el ancho de siempre, solo velas cerradas', () => {
  assert.equal(volumeWidthFactor(1), 0.7);
  assert.equal(volumeWidthFactor(4), 1);
  assert.equal(volumeWidthFactor(0.01), 0.25);
  assert.equal(volumeWidthFactor(NaN), null);
  assert.ok(volumeWidthFactor(0.5) < 0.7 && volumeWidthFactor(1.5) > 0.7);
  assert.equal(cleanVpaConfig({}).show.widthByVolume, false, 'apagado de fábrica');
  const candles = randomBars(400, 9, 14400000).map(b => ({ timestamp: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }));
  const forming = [...candles.slice(0, 300), { ...candles[300], in_progress: true }];
  const indicator = new VPAIndicator('TEST', '4h', 30);
  indicator.enabled = true;
  indicator.config = cleanVpaConfig({ show: { widthByVolume: false } });
  assert.equal(indicator.candleWidths(forming.slice(-50), forming), null, 'apagado, el ancho de siempre');
  indicator.config = cleanVpaConfig({ show: { widthByVolume: true } });
  const widths = indicator.candleWidths(forming.slice(-50), forming);
  assert.equal(widths.length, 50);
  assert.equal(widths.at(-1), null, 'la vela en formación no se mide');
  assert.equal(widths[0], volumeWidthFactor(indicator.reader.s.rv[251]));
  // Con más velas, lo ya medido no cambia
  const later = new VPAIndicator('TEST', '4h', 30);
  later.enabled = true;
  later.config = indicator.config;
  assert.deepEqual(later.candleWidths(candles.slice(251, 301), candles).slice(0, 49), widths.slice(0, 49));
  indicator.enabled = false;
  assert.equal(indicator.candleWidths(forming.slice(-50), forming), null);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${name}\n     ${err.message}`);
  }
}
console.log(`\n${tests.length - failed} de ${tests.length} pasan`);
process.exit(failed ? 1 : 0);
