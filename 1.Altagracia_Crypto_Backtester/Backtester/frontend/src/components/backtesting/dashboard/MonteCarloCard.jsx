import React, { useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler
} from 'chart.js';
import useUiTheme from '../../useUiTheme.js';
import { chartFont, dashboardPalette, tooltipFonts } from './dashboardPalette.js';
import { monteCarlo, SMALL_SAMPLE } from './monteCarlo.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

/**
 * Monte Carlo de los trades (23/11/2026, pedido del usuario): con los resultados de los trades a la vista, entre qué
 * valores pudo quedar la curva por el orden y la suerte. El cálculo está en monteCarlo.js.
 * - trades: los del dashboard, en su orden. `readValue(trade)` da el resultado de cada uno (de fábrica, trade.pnl);
 * - format(valor): cómo se escribe un resultado ('$12.30', '1.20 R');
 * - themed: colores y letra del estilo elegido, como los demás widgets (la suite lo pasa; App 1 no);
 * - modes: [id, texto, ayuda, leer, escribir] si el resultado se puede leer de varias formas (la suite: $ y R).
 * Dos métodos: remuestrear (de fábrica) o barajar el orden. No dice si la ventaja es real: lo dice el pie.
 */
const METHODS = [
  ['resample', 'Remuestrear', 'Cada corrida saca al azar, con repetición, tantos trades como hay: cambian el resultado y la caída'],
  ['shuffle', 'Barajar', 'Los mismos trades en otro orden: el resultado final no cambia, cambian la caída y las rachas'],
];
/** Un color #RGB o #RRGGBB con transparencia */
const faded = (hex, alpha) => {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  return Number.isFinite(n) && full.length === 6 ? `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})` : hex;
};
const pnlOf = (trade) => trade.pnl;
const dollars = (v) => `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`;

const MonteCarloCard = ({ trades, readValue = pnlOf, format = dollars, themed = false, modes = null }) => {
  useUiTheme();
  const palette = dashboardPalette(themed);
  const [method, setMethod] = useState('resample');
  const [modeId, setModeId] = useState(modes ? modes[0][0] : null);
  const mode = modes ? (modes.find(([id]) => id === modeId) || modes[0]) : null;
  const read = mode ? mode[3] : readValue;
  const text = mode ? mode[4] : format;

  const values = useMemo(() => trades.map(read).filter(Number.isFinite), [trades, read]);
  const result = useMemo(() => monteCarlo(values, { method }), [values, method]);

  const stat = (label, value, tone = '', title = undefined) => (
    <div className="stat-item" key={label} title={title}>
      <span className="stat-label">{label}:</span>
      <span className={`stat-value ${tone}`}>{value}</span>
    </div>
  );
  const toneOf = (v) => (v > 0 ? 'positive' : v < 0 ? 'negative' : '');

  let body = <div className="no-data-message">Hacen falta al menos 2 trades cerrados</div>;
  if (result) {
    const band = (key) => result.bands.map(b => b[key]);
    const line = (label, data, extra) => ({ label, data, pointRadius: 0, pointHoverRadius: 0, tension: 0, borderWidth: 1, ...extra });
    const data = {
      labels: result.at.map(i => `T${i}`),
      datasets: [
        line('Real', result.actual, { borderColor: result.real.final >= 0 ? palette.win : palette.loss, borderWidth: 2, order: 0 }),
        line('Mediana', band('p50'), { borderColor: palette.muted, borderDash: [4, 4], order: 1 }),
        line('5%', band('p5'), { borderColor: 'transparent', order: 3 }),
        line('95%', band('p95'), { borderColor: 'transparent', backgroundColor: faded(palette.muted, 0.13), fill: '-1', order: 3 }),
        line('25%', band('p25'), { borderColor: 'transparent', order: 2 }),
        line('75%', band('p75'), { borderColor: 'transparent', backgroundColor: faded(palette.muted, 0.2), fill: '-1', order: 2 }),
      ],
    };
    const options = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: palette.tooltipBg,
          titleColor: palette.tooltipTitle,
          bodyColor: palette.tooltipBody,
          borderColor: palette.tooltipBorder,
          borderWidth: 1,
          padding: 10,
          ...tooltipFonts(palette),
          itemSort: (a, b) => b.parsed.y - a.parsed.y,
          callbacks: { label: (context) => `${context.dataset.label}: ${text(context.parsed.y)}` },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 10, color: palette.muted, ...chartFont(palette) } },
        y: { grid: { color: palette.grid }, ticks: { color: palette.muted, ...chartFont(palette), callback: (v) => text(v) } },
      },
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
    };
    body = <Line data={data} options={options} />;
  }

  return (
    <div className="chart-card">
      <div className="chart-header">
        <h3>Monte Carlo</h3>
        <div className="chart-controls">
          {modes && modes.map(([id, label, title]) => (
            <button key={id} className={`mode-toggle-btn ${mode[0] === id ? 'active' : ''}`} onClick={() => setModeId(id)} title={title}>{label}</button>
          ))}
          {METHODS.map(([id, label, title]) => (
            <button key={id} className={`mode-toggle-btn ${method === id ? 'active' : ''}`} onClick={() => setMethod(id)} title={title}>{label}</button>
          ))}
        </div>
      </div>
      <div className="chart-content" style={{ height: '280px' }}>{body}</div>
      {result && (
        <>
          <div className="chart-footer">
            {method === 'resample'
              ? stat('Resultado (5% a 95%)', `${text(result.final.p5)} a ${text(result.final.p95)}`, '', `Mediana ${text(result.final.p50)}. El real fue ${text(result.real.final)}`)
              : stat('Resultado', text(result.real.final), toneOf(result.real.final), 'Barajando, el resultado final es siempre el mismo')}
            {method === 'resample' && stat('Termina en pérdida', `${(result.lossShare * 100).toFixed(1)}%`, result.lossShare > 0.2 ? 'negative' : '', 'Parte de las corridas que termina por debajo de cero')}
            {stat('Caída típica · mala', `${text(result.drawdown.p50)} · ${text(result.drawdown.p95)}`, '', 'Mayor caída desde un pico: la mediana de las corridas y la que solo supera el 5%')}
            {stat('Caída real', text(result.real.drawdown), '', `Mayor o igual que la del ${(result.drawdownRank * 100).toFixed(0)}% de las corridas`)}
            {stat('Racha de pérdidas', `${Math.round(result.streak.p50)} · ${Math.round(result.streak.p95)}`, '', `La más larga: típica y mala (5%). La real fue ${result.real.streak}`)}
          </div>
          <div className="chart-footer interpretation">
            <div className="interpretation-text">
              {result.small && <><strong>Muestra pequeña ({result.n} trades, menos de {SMALL_SAMPLE}):</strong> las bandas son tan inciertas como la muestra. </>}
              {result.runs.toLocaleString('es-CO')} corridas con los {result.n} trades a la vista. La zona oscura tiene la mitad de las corridas y la clara el 90%.
              Supone que los próximos trades se parecen a estos y que no dependen unos de otros: no dice si la ventaja es real, solo cuánto pudo cambiar el camino.
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default React.memo(MonteCarloCard);
