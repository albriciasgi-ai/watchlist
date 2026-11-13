import React, { useEffect, useMemo, useState } from 'react';
import '@app1/dashboard_styles.css';
import EquityCurveChart from '@app1/components/backtesting/dashboard/EquityCurveChart.jsx';
import ProfitLossHistogram from '@app1/components/backtesting/dashboard/ProfitLossHistogram.jsx';
import WinRateGauge from '@app1/components/backtesting/dashboard/WinRateGauge.jsx';
import AvgProfitLossGauge from '@app1/components/backtesting/dashboard/AvgProfitLossGauge.jsx';
import DrawdownGrowthCards from '@app1/components/backtesting/dashboard/DrawdownGrowthCards.jsx';
import TradesDataGrid from '@app1/components/backtesting/dashboard/TradesDataGrid.jsx';
import { THEME, isNewTheme } from '@app1/components/uiTheme.js';
import useUiTheme from '@app1/components/useUiTheme.js';
import { filterOptions, priceText, riskReward, signature, toDashboardTrades, totals } from './journalStats.js';
import { TAB } from './tabs.js';

/**
 * Dashboard del journal (13/11/2026, pedido del usuario: "lo que tiene la app 1 como dashboard ... con los estilos
 * escogidos por el usuario"). Son los widgets del dashboard de App 1, importados sin copiarlos, con los trades reales
 * del bot: curva de capital, P&L por trade, Win Rate, Profit Factor, riesgo y recompensa y la tabla con selección.
 * - Dinero real, sin saldo simulado: la curva es el P&L neto acumulado (o el R acumulado) y las tarjetas dan dólares y R.
 * - Los colores salen del estilo elegido: Chart.js y los medidores con `themed`, las tarjetas y la tabla con las
 *   variables --dash-* de dashboard_styles.css. Con el Clásico se ve como el de App 1.
 * - Solo trades cerrados de los días elegidos en el journal. Un trade nuevo entra seleccionado.
 */

const EQUITY_MODES = [
  ['absolute', '$', 'P&L neto acumulado, en dólares'],
  ['r', 'R', 'R acumulado: cada resultado sobre lo que arriesgaba su SL inicial'],
];
const PNL_MODES = [
  ['absolute', '$', 'P&L neto de cada trade, en dólares'],
  ['percent', '%', 'Lo que se movió el precio a favor del trade, en %'],
  ['r', 'R', 'R de cada trade'],
];
const EXTRA_COLUMNS = [
  { key: 'symbol', label: 'Moneda', sortKey: 'symbol', render: (t) => t.symbol },
  { key: 'origin', label: 'Origen', render: (t) => t.origin },
  {
    key: 'r',
    label: 'R',
    sortKey: 'r',
    render: (t) => (Number.isFinite(t.r) ? t.r.toFixed(2) : '—'),
    className: (t) => `td-number ${Number.isFinite(t.r) ? (t.r > 0 ? 'positive' : 'negative') : ''}`,
  },
];
const money = (v) => `${v >= 0 ? '+' : '−'}$${Math.abs(v).toFixed(2)}`;
const rText = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)} R`;
const dollars = (v) => `$${v.toFixed(2)}`;
const rUnits = (v) => `${v.toFixed(2)} R`;
const asIs = (q) => q ?? '–';

const SETTINGS_KEY = `suite_journal_dashboard_${TAB}`;
function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

/** Las variables de colores del dashboard de App 1 con el estilo elegido. Con el Clásico, las suyas de siempre */
function themeVars() {
  if (!isNewTheme()) return {};
  return {
    '--dash-bg': THEME.page,
    '--dash-card-bg': THEME.chartBg,
    '--dash-card-hover': THEME.chartBg,
    '--dash-text': THEME.text,
    '--dash-text-light': THEME.textMuted,
    '--dash-text-lighter': THEME.textFaint,
    '--dash-border': THEME.line,
    '--dash-primary-blue': THEME.accent,
    '--dash-primary-green': THEME.upText,
    '--dash-primary-red': THEME.downText,
    '--dash-primary-orange': THEME.divergence,
    '--dash-warning-yellow': THEME.divergence,
    '--dash-shadow': THEME.dark ? 'rgba(0, 0, 0, 0.35)' : 'rgba(0, 0, 0, 0.06)',
    fontFamily: THEME.font,
  };
}

export default function JournalDashboard({ trades, days }) {
  useUiTheme(); // Al cambiar el estilo, las variables de colores cambian con él
  const saved = useMemo(loadSettings, []);
  const [equityMode, setEquityMode] = useState(EQUITY_MODES.some(([m]) => m === saved.equityMode) ? saved.equityMode : 'absolute');
  const [pnlMode, setPnlMode] = useState(PNL_MODES.some(([m]) => m === saved.pnlMode) ? saved.pnlMode : 'absolute');
  const [symbol, setSymbol] = useState(saved.symbol || 'all');
  const [origin, setOrigin] = useState(saved.origin || 'all');
  const [account, setAccount] = useState(saved.account || 'all');
  // Los que se quitaron de la selección: los demás, también los que cierren después, quedan seleccionados
  const [deselected, setDeselected] = useState(() => new Set());

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ equityMode, pnlMode, symbol, origin, account }));
    } catch {
      // Sin almacenamiento la elección dura hasta cerrar la página
    }
  }, [equityMode, pnlMode, symbol, origin, account]);

  // El journal se vuelve a leer cada 15 s: los widgets solo cambian si cambiaron los trades
  const sig = signature(trades);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all = useMemo(() => toDashboardTrades(trades), [sig]);
  const options = useMemo(() => filterOptions(all), [all]);
  const filtered = useMemo(() => all.filter(t => (symbol === 'all' || t.symbol === symbol)
    && (origin === 'all' || t.origin === origin) && (account === 'all' || t.account === account)), [all, symbol, origin, account]);
  const selected = useMemo(() => filtered.filter(t => !deselected.has(t.id)), [filtered, deselected]);
  const selectedIds = useMemo(() => selected.map(t => t.id), [selected]);
  const changeSelection = (ids) => {
    const keep = new Set(ids);
    setDeselected(prev => {
      const next = new Set(prev);
      for (const t of filtered) {
        if (keep.has(t.id)) next.delete(t.id);
        else next.add(t.id);
      }
      return next;
    });
  };

  const sums = useMemo(() => totals(selected), [selected]);
  const risk = useMemo(() => riskReward(selected), [selected]);
  const summary = useMemo(() => [
    { label: 'P&L neto', value: money(sums.pnl), tone: sums.pnl >= 0 ? 'positive' : 'negative' },
    { label: 'R acumulado', value: rText(sums.r), tone: sums.r >= 0 ? 'positive' : 'negative' },
    { label: 'Trades', value: sums.withoutR ? `${sums.n} (${sums.withoutR} sin R)` : String(sums.n) },
  ], [sums]);
  const tooltipExtra = useMemo(() => (t) => [
    `Moneda: ${t.symbol}`,
    `Origen: ${t.origin}`,
    `R: ${Number.isFinite(t.r) ? t.r.toFixed(2) : 'sin SL'}`,
  ], []);
  const metrics = { maxDrawdown: risk.maxDrawdown, maxDrawdownUSD: risk.maxDrawdownR, maxGrowth: risk.maxGrowth, maxGrowthUSD: risk.maxGrowthR };

  const select = (label, value, onChange, list, allText) => (
    <select className="filter-select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="all">{allText}</option>
      {list.map(item => <option key={item} value={item}>{item}</option>)}
    </select>
  );

  return (
    <div className="trading-dashboard suite-dashboard" style={themeVars()}>
      <div className="dashboard-header">
        <div className="dashboard-title">
          <h2>Dashboard de Trading</h2>
          <p className="dashboard-subtitle">
            {selected.length} de {filtered.length} trades seleccionados · cerrados en los últimos {days} días · P&L neto de comisiones (Bybit)
          </p>
        </div>
        <div className="dashboard-actions">
          {select('Filtrar por moneda', symbol, setSymbol, options.symbols, 'Todas las monedas')}
          {select('Filtrar por origen', origin, setOrigin, options.origins, 'Todos los orígenes')}
          {options.accounts.length > 1 && select('Filtrar por cuenta', account, setAccount, options.accounts, 'Todas las cuentas')}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="dashboard-empty-state">
          <div className="empty-state-icon">📊</div>
          <h3>{all.length ? 'Ningún trade cerrado con estos filtros' : 'No hay trades cerrados en estos días'}</h3>
          <p>{all.length ? 'Cambia la moneda, el origen o la cuenta.' : 'Los cierres llegan de Bybit; también puedes elegir más días.'}</p>
        </div>
      ) : (
        <>
          <div className="charts-grid">
            <div id="equity-curve-chart">
              <EquityCurveChart
                trades={selected}
                initialBalance={0}
                mode={equityMode}
                onModeChange={setEquityMode}
                themed
                modes={EQUITY_MODES}
                summary={summary}
              />
            </div>
            <div id="pnl-histogram-chart">
              <ProfitLossHistogram
                trades={selected}
                mode={pnlMode}
                onModeChange={setPnlMode}
                themed
                modes={PNL_MODES}
                formatPrice={priceText}
                tooltipExtra={tooltipExtra}
              />
            </div>
            <WinRateGauge trades={selected} themed />
            <AvgProfitLossGauge trades={selected} themed />
          </div>

          <div id="drawdown-growth-cards">
            <DrawdownGrowthCards metrics={metrics} mainText={dollars} subText={rUnits} />
          </div>

          <TradesDataGrid
            trades={filtered}
            selectedIds={selectedIds}
            onSelectionChange={changeSelection}
            extraColumns={EXTRA_COLUMNS}
            formatPrice={priceText}
            formatQuantity={asIs}
            idSortKey="tradeNumber"
          />
        </>
      )}
    </div>
  );
}
