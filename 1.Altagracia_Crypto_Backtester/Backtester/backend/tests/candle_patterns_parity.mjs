// Corre la regla del navegador (candlePatterns.js) para tests/test_candle_patterns.py. Entrada: {candles, config} por stdin
import { findPatterns, ruleOptions } from '../../frontend/src/components/indicators/candlePatterns.js';
let raw = '';
process.stdin.on('data', d => { raw += d; });
process.stdin.on('end', () => {
  const { cases } = JSON.parse(raw);
  const out = cases.map(({ candles, config }) => findPatterns(candles, ruleOptions(config))
    .map(p => [p.index, p.type, p.volumeZ === null ? null : Math.round(p.volumeZ * 1e6) / 1e6]));
  process.stdout.write(JSON.stringify(out));
});
