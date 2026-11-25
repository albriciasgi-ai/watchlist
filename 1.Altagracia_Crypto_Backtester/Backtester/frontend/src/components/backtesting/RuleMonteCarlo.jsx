import React, { useMemo, useState } from 'react';
import { monteCarlo, resultsByExit, SMALL_SAMPLE } from './dashboard/monteCarlo.js';
import { THEME, isNewTheme } from '../uiTheme.js';

/**
 * Monte Carlo de los trades de una corrida del probador (23/11/2026, pedido del usuario): entre qué valores pudo quedar
 * la curva de R por el orden y la suerte. Plegado de fábrica: se calcula al abrirlo.
 * - trades: los de la corrida (objetos con exit_t y r) o las ternas [entrada, salida, R] del informe "Todas";
 * - de fábrica remuestrea por semanas de salida: los trades que salen la misma semana (sobre todo entre monedas) se
 *   mueven juntos, y tratarlos como independientes daría bandas demasiado angostas (lo mismo que el margen del motor 6).
 * No mira nada nuevo: usa solo los trades ya calculados de la fase a la vista, así que no gasta ninguna fase.
 */
const fmt = (v, digits = 1) => `${v > 0 ? '+' : ''}${Number(v).toFixed(digits)} R`;
const plain = (v, digits = 1) => `${Number(v).toFixed(digits)} R`;

const Bands = ({ result }) => {
  const values = [...result.bands.flatMap(b => [b.p5, b.p95]), ...result.actual, 0];
  const low = Math.min(...values), high = Math.max(...values);
  const span = high - low || 1;
  const last = result.at.length - 1;
  const x = (i) => (last <= 0 ? 300 : (i / last) * 600);
  const y = (v) => 135 - ((v - low) / span) * 130;
  const area = (top, bottom) => [
    ...result.bands.map((b, i) => `${x(i).toFixed(1)},${y(b[top]).toFixed(1)}`),
    ...result.bands.map((b, i) => `${x(i).toFixed(1)},${y(b[bottom]).toFixed(1)}`).reverse(),
  ].join(' ');
  const path = (list) => list.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const up = result.real.final >= 0;
  const color = isNewTheme() ? (up ? THEME.upText : THEME.downText) : (up ? '#0a7d5a' : '#c62828');
  return (
    <svg className="rt-equity" style={{ height: 140 }} viewBox="0 0 600 140" preserveAspectRatio="none">
      <polygon points={area('p95', 'p5')} fill="currentColor" fillOpacity="0.08" />
      <polygon points={area('p75', 'p25')} fill="currentColor" fillOpacity="0.12" />
      <line x1="0" x2="600" y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity="0.25" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      <polyline fill="none" stroke="currentColor" strokeOpacity="0.5" strokeDasharray="3 3" strokeWidth="1" vectorEffect="non-scaling-stroke" points={path(result.bands.map(b => b.p50))} />
      <polyline fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" points={path(result.actual)} />
    </svg>
  );
};

export default function RuleMonteCarlo({ trades, many = false }) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState('resample');
  const [byWeek, setByWeek] = useState(true);
  const data = useMemo(() => (open ? resultsByExit(trades) : null), [open, trades]);
  const result = useMemo(
    () => (data ? monteCarlo(data.results, { method, groups: byWeek ? data.weeks : undefined }) : null),
    [data, method, byWeek],
  );

  return (
    <div className="rt-group">
      <h4 style={{ cursor: 'pointer' }} onClick={() => setOpen(v => !v)} title="Con los trades de esta corrida, entre qué valores pudo quedar la curva por el orden y la suerte">
        {open ? '▾' : '▸'} Monte Carlo de los trades
      </h4>
      {open && !result && <div className="rt-note">Hacen falta al menos 2 trades cerrados.</div>}
      {open && result && (
        <>
          <div className="rt-row" style={{ marginBottom: 6 }}>
            <button type="button" className={`rt-btn${method === 'resample' ? ' on' : ''}`} onClick={() => setMethod('resample')} title="Cada corrida saca al azar, con repetición, tantos trades como hay: cambian el resultado y la caída">Remuestrear</button>
            <button type="button" className={`rt-btn${method === 'shuffle' ? ' on' : ''}`} onClick={() => setMethod('shuffle')} title="Los mismos trades en otro orden: el resultado final no cambia, cambian la caída y las rachas">Barajar</button>
            <label title="Los trades que salen la misma semana van siempre juntos. Sin esto se tratan como independientes y las bandas salen más angostas de lo que son">
              <input type="checkbox" checked={byWeek} onChange={(e) => setByWeek(e.target.checked)} /> por semanas
            </label>
          </div>
          {result.small && (
            <div className="rt-warn">
              Muestra pequeña ({result.n} trades{result.blocks !== null ? ` en ${result.blocks} semanas` : ''}; menos de {SMALL_SAMPLE}): las bandas son tan inciertas como la muestra.
            </div>
          )}
          <div className="rt-cards">
            {method === 'resample' ? (
              <div className="rt-card" title={`Mediana ${fmt(result.final.p50)}. El real fue ${fmt(result.real.final)}`}><b>{fmt(result.final.p5)} a {fmt(result.final.p95)}</b><span>R total (5% a 95%)</span></div>
            ) : (
              <div className="rt-card" title="Barajando, el resultado final es siempre el mismo"><b>{fmt(result.real.final)}</b><span>R total</span></div>
            )}
            {method === 'resample' && (
              <div className="rt-card" title="Parte de las corridas que termina por debajo de cero"><b>{(result.lossShare * 100).toFixed(1)}%</b><span>Termina en pérdida</span></div>
            )}
            {method === 'resample' && (
              <div className="rt-card" title="R medio por trade en el 5% y el 95% de las corridas"><b>{fmt(result.final.p5 / result.n, 3)} a {fmt(result.final.p95 / result.n, 3)}</b><span>R medio (5% a 95%)</span></div>
            )}
            <div className="rt-card" title="Mayor caída desde un pico: la mediana de las corridas y la que solo supera el 5%"><b>{plain(result.drawdown.p50)} · {plain(result.drawdown.p95)}</b><span>Caída típica · mala</span></div>
            <div className="rt-card" title={`Mayor o igual que la del ${(result.drawdownRank * 100).toFixed(0)}% de las corridas`}><b>{plain(result.real.drawdown)}</b><span>Caída real</span></div>
            <div className="rt-card" title={`La racha más larga de pérdidas: típica y mala (5%). La real fue ${result.real.streak}`}><b>{Math.round(result.streak.p50)} · {Math.round(result.streak.p95)}</b><span>Racha de pérdidas típica · mala</span></div>
          </div>
          <Bands result={result} />
          <div className="rt-note">
            {result.runs.toLocaleString('es-CO')} corridas con los {result.n.toLocaleString('es-CO')} trades de esta fase, con 1 R por trade
            {result.blocks !== null ? `, tomados por semanas de salida (${result.blocks})` : ''}. La línea de color es la curva real y la punteada la mediana; la zona oscura tiene la mitad de las corridas y la clara el 90%.
            {many && ' Las monedas operan a la vez: no es la curva de una sola cuenta.'}
            {' '}No mira datos nuevos ni gasta ninguna fase. Supone que los próximos trades se parecen a estos: no dice si la ventaja es real (eso lo dicen los controles al azar), solo cuánto pudo cambiar el camino con estos mismos trades.
          </div>
        </>
      )}
    </div>
  );
}
