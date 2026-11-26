// Corre los niveles de S&R v2 del navegador (swingLevels.js) para tests/test_kitchen.py. Entrada por stdin:
// {candles: [{timestamp, open, high, low, close, volume}], at: [índices]}. Salida: por cada índice, los niveles activos
// al cerrar esa vela, como [lado (1 soporte, −1 resistencia), precio que se dibuja (el promedio de los toques), toque
// más lejano (el que un cierre tiene que pasar para romperlo)].
import { LevelBook } from '../../frontend/src/components/indicators/swingLevels.js';

let raw = '';
process.stdin.on('data', d => { raw += d; });
process.stdin.on('end', () => {
  const { candles, at } = JSON.parse(raw);
  const book = new LevelBook();
  const out = at.map(i => {
    book.advance(candles.slice(0, i + 1));
    const rows = [];
    for (const [side, way] of [['resistance', -1], ['support', 1]]) {
      for (const level of book.levels[side]) {
        if (level.brokenAt === null) rows.push([way, level.priceSum / level.touches, level.extreme]);
      }
    }
    return rows;
  });
  process.stdout.write(JSON.stringify(out));
});
