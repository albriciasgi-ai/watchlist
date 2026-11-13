// Corre detectSwings() del indicador Swing de App 1 sobre los casos de swing_checks.py y escribe lo que detecta,
// para compararlo con swing_rules.py del servidor.
// Uso: node swing_parity.mjs <carpeta src del frontend de App 1> <entrada.json> <salida.json>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [src, input, output] = process.argv.slice(2);
const load = (rel) => import(pathToFileURL(path.join(src, rel)).href);
const { default: SwingDetectorIndicator } = await load('components/indicators/SwingDetectorIndicator.js');
const { default: Rectangle } = await load('components/drawing/shapes/Rectangle.js');

console.log = () => {};  // el indicador escribe en la consola en cada cálculo
const data = JSON.parse(readFileSync(input, 'utf8'));
const results = {};
for (const c of data.cases) {
  const indicator = new SwingDetectorIndicator(c.symbol, c.interval, 30);
  if (c.config) indicator.updateConfig(c.config);
  if (c.vwap) {
    // El indicador VWAP encendido, con los mismos puntos que usa el servidor
    indicator.setVWAPIndicator({ enabled: true, dataMap: new Map(c.vwap.map(p => [p.timestamp, p])), calculations: 1 });
  }
  if (c.shapes) {
    // Los dibujos guardados, armados como los arma el gráfico al cargarlos
    const shapes = c.shapes.map(s => (s.type === 'rectangle' ? Rectangle.deserialize(s) : s));
    indicator.setDrawingManager({ shapes });
    indicator.getProfileRectIds = () => new Set(c.profileRectIds || []);
  }
  results[c.name] = indicator.detectSwings(data.candles[c.candles]);
}
writeFileSync(output, JSON.stringify(results));
