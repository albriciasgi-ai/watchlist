import React, { useEffect, useMemo, useState } from 'react';
import { API_BASE_URL } from '../../config.js';

/**
 * Pestaña "Régimen" del backtesting global: dibuja en el gráfico de la fase 1 las zonas de horizontalidad de un
 * detector y, de fondo, la referencia (verde tendencia alcista, rojo bajista; sin color, horizontal). La referencia
 * mira el futuro a propósito: es la vara para calificar a los detectores, no algo que se pueda operar.
 * El cálculo es del backend (regime.py y regime_detectors.py).
 */

const KEY = 'tester_regime_v1';
const TF_OF = { '15m': 15, '1h': 60, '4h': 240 };
const PARAM_LABEL = {
  n: 'Velas', below: 'Bajo', buffer: 'Margen de salida (ATR)', exit_er: 'Sale si la eficiencia pasa de', min_bars: 'Velas seguidas',
  bb_k: 'Bollinger (σ)', kc_k: 'Keltner (ATR)', lookback: 'Velas del percentil', length: 'Velas', atr_len: 'Velas del ATR', mult: 'ATR',
  max_out: 'Cierres fuera para terminar', threshold: 'Umbral (vacío = el de App 1)', min_c: 'Velas mínimas', range_pct: 'Rango máximo (%)',
  range_atr: 'Rango máximo (ATR, vacío = usar %)', min_d: 'd_score mínimo', close_out: 'Cierres fuera del valor'
};
const HELP = {
  er_box: 'Rango cuando el avance neto de las últimas velas es poco comparado con lo recorrido. Termina en el primer cierre fuera de la caja o cuando la eficiencia sube.',
  er: 'Rango mientras el avance neto de las últimas velas es poco comparado con lo recorrido.',
  adx: 'Rango mientras el ADX está bajo.',
  ttm: 'Rango mientras la banda de Bollinger cabe dentro del canal de Keltner.',
  bbwp: 'Rango mientras el ancho de Bollinger está en un percentil bajo de su historia.',
  atr_range: 'El Range Detection de App 1: los últimos cierres quedan a menos de N ATR de su media.',
  vwap_bw: 'El BandWidth del VWAP de sesión de App 1, bajo su umbral de "consolidación".',
  vp_prog: 'El "Progresivo (D creciente)" de App 8: las últimas velas caben en un rango estrecho y su perfil de volumen es D.'
};

const api = async (path) => {
  const response = await fetch(`${API_BASE_URL}${path}`);
  if (!response.ok) throw new Error(`El backend respondió ${response.status}`);
  return response.json();
};
const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
};
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const TIME = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: '2-digit' });
const day = (ms) => TIME.format(new Date(ms));

export default function RegimeTab({ symbol, chartTf, onBands, onFocus }) {
  const saved = useMemo(load, []);
  const [catalog, setCatalog] = useState([]);
  const [detector, setDetector] = useState(saved.detector || 'er_box');
  const [params, setParams] = useState(saved.params || {});
  const [win, setWin] = useState(saved.window || 48);
  const [minRun, setMinRun] = useState(saved.minRun || 8);
  const [detectTf, setDetectTf] = useState(saved.detectTf || 0);  // 0 = el marco del gráfico
  const [showTruth, setShowTruth] = useState(saved.showTruth !== false);
  const [showZones, setShowZones] = useState(saved.showZones !== false);
  const [onlyBad, setOnlyBad] = useState(false);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const tf = TF_OF[chartTf];

  useEffect(() => {
    api('/api/regime/catalog').then(r => r.success && setCatalog(r.detectors)).catch(error => setMessage(
      /404/.test(error.message) ? 'El backend de App 1 no tiene todavía los detectores de régimen: reinícialo (puerto 9000) y recarga la página.' : error.message));
  }, []);
  const entry = catalog.find(d => d.key === detector);
  const shown = { ...(entry?.params || {}), ...(params[detector] || {}) };
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ detector, params, window: win, minRun, showTruth, showZones, detectTf }));
    } catch { /* sin almacenamiento se usa igual */ }
  }, [detector, params, win, minRun, showTruth, showZones, detectTf]);

  const setParam = (key, value) => setParams(previous => ({ ...previous, [detector]: { ...shown, [key]: value } }));
  const preset = (which) => setParams(previous => ({ ...previous, [detector]: { ...(entry?.params || {}), ...(which === 'original' ? entry?.original || {} : {}) } }));

  const run = async () => {
    if (!tf) {
      setMessage('Pon el gráfico en 15m, 1h o 4h: el régimen se mide en el marco del gráfico.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const query = new URLSearchParams({ tf: String(tf), detector, params: JSON.stringify(shown), window: String(win), min_run: String(minRun),
        detect_tf: String(detectTf && detectTf < tf ? detectTf : tf) });
      const answer = await api(`/api/regime/${symbol}?${query}`);
      if (!answer.success) setMessage(answer.message);
      else setData(answer);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };

  // Lo que se dibuja: la referencia de fondo y las cajas del detector (tenue antes de saberse, marcada desde que se supo)
  useEffect(() => {
    if (!data || data.tf !== tf || data.symbol !== symbol) {
      onBands(null);
      return;
    }
    const bands = [];
    if (showTruth) for (const z of data.truth.zones) bands.push({ kind: 'strip', dir: z.dir, start: z.start, end: z.end });
    if (showZones) {
      for (const z of data.zones) {
        if (z.start < z.detected) bands.push({ kind: 'outline', low: z.low, high: z.high, start: z.start, end: z.detected, strong: false });
        bands.push({ kind: 'outline', low: z.low, high: z.high, start: z.detected, end: z.end, strong: true });
        bands.push({ kind: 'strip', dir: 'range', start: z.detected, end: z.end });
      }
    }
    onBands(bands);
  }, [data, showTruth, showZones, tf, symbol]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onBands(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const list = (data?.zones || []).filter(z => !onlyBad || (z.match != null && z.match < 0.5));
  const row = (label, s) => s && (
    <tr><td style={{ textAlign: 'left' }}>{label}</td><td>{pct(s.share)}</td><td>{pct(s.precision)} <span className="rt-note">({pct(s.base)})</span></td>
      <td>{pct(s.recall)}</td><td>{pct(s.leak)}</td><td><b>{s.j?.toFixed(2)}</b></td></tr>
  );

  return (
    <>
      <div className="rt-note" style={{ marginBottom: 8 }}>
        Zonas de horizontalidad en la fase 1, en el gráfico. <b>Arriba</b>, la referencia: barra verde en tendencia alcista, roja en bajista y
        nada en horizontal (mira el futuro a propósito: es la vara para calificar, no algo operable). <b>Abajo</b>, barra morada mientras el
        detector dice rango, con la caja de cada rango: punteada antes de que se pudiera saber, continua desde la vela en que se supo.
        Donde hay barra arriba y abajo a la vez, el detector confundió tendencia con rango.
      </div>

      <div className="rt-group">
        <h4>Detector</h4>
        {!catalog.length && message && <div className="rt-warn">{message}</div>}
        <select value={detector} onChange={(e) => setDetector(e.target.value)} style={{ width: '100%' }}>
          {catalog.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
        <div className="rt-note" style={{ margin: '4px 0' }}>{HELP[detector]}</div>
        {Object.keys(entry?.params || {}).map(key => (
          <div className="rt-row" key={key}>
            <span style={{ flex: 1 }}>{PARAM_LABEL[key] || key}</span>
            <input type="number" step="any" value={shown[key] ?? ''} style={{ width: 80 }}
              onChange={(e) => setParam(key, e.target.value === '' ? null : Number(e.target.value))} />
          </div>
        ))}
        <div className="rt-row" style={{ marginTop: 4 }}>
          <span>Detectar en</span>
          {[0, 60, 15].filter(m => !m || (tf && m < tf)).map(m => (
            <button key={m} type="button" className={`rt-btn${(detectTf || 0) === m ? ' on' : ''}`} onClick={() => setDetectTf(m)}>
              {m ? (m === 60 ? '1h' : '15m') : `el marco del gráfico${chartTf ? ` (${chartTf})` : ''}`}
            </button>
          ))}
        </div>
        {detectTf > 0 && tf && detectTf < tf && (
          <div className="rt-note">Las velas de los parámetros son de {detectTf === 60 ? '1h' : '15m'}. Medido en la fase 1, siete monedas, contra la referencia de 4h:
            detectar en 1h o 15m separa peor que en 4h (la eficiencia, de J 0.31 en 4h a 0.27 en 1h con 80 velas y 0.08 en 15m): en velas chicas
            un retroceso dentro de una tendencia ya parece rango.</div>
        )}
        <div className="rt-row" style={{ marginTop: 4 }}>
          <button type="button" className="rt-btn" onClick={() => preset('tuned')} title="Los afinados en la fase 1 contra la referencia de 48 velas">Afinados</button>
          {entry?.original && <button type="button" className="rt-btn" onClick={() => preset('original')} title="Como estaban en App 1 o App 8">De fábrica</button>}
        </div>
      </div>

      <div className="rt-group">
        <h4>Referencia</h4>
        <div className="rt-row">
          <span>Ventana de</span><input type="number" value={win} min={6} max={400} style={{ width: 64 }} onChange={(e) => setWin(Number(e.target.value) || 48)} />
          <span>velas y tramos de al menos</span><input type="number" value={minRun} min={1} max={100} style={{ width: 56 }} onChange={(e) => setMinRun(Number(e.target.value) || 8)} />
        </div>
        <div className="rt-note">La cuarta parte del tiempo con el avance más derecho es tendencia; el resto, horizontal.</div>
        <div className="rt-row">
          <label><input type="checkbox" checked={showTruth} onChange={(e) => setShowTruth(e.target.checked)} />referencia</label>
          <label><input type="checkbox" checked={showZones} onChange={(e) => setShowZones(e.target.checked)} />zonas del detector</label>
        </div>
      </div>

      <button type="button" className="rt-btn primary" style={{ width: '100%', padding: '6px 0', margin: '6px 0' }} disabled={busy} onClick={run}>
        {busy ? 'Calculando…' : `Ver en el gráfico (${symbol}, ${chartTf})`}
      </button>
      {message && <div className="rt-warn">{message}</div>}

      {data && (
        <>
          <div className="rt-group">
            <h4>Calificación contra la referencia · {data.symbol} {chartTf}{data.detectTf !== data.tf ? ` · detectado en ${data.detectTf === 60 ? '1h' : '15m'}` : ''}</h4>
            <table className="rt-table">
              <thead><tr><th style={{ textAlign: 'left' }}>Tramo</th><th>Marca</th><th>Precisión</th><th>Rango hallado</th><th>Tendencia confundida</th><th>J</th></tr></thead>
              <tbody>
                {row(`Fase 1 completa`, data.score.all)}
                {row(`Hasta ${data.split}`, data.score.train)}
                {row(`Desde ${data.split}`, data.score.hold)}
              </tbody>
            </table>
            <div className="rt-note">
              Precisión: de lo que marca, cuánto era horizontal (entre paréntesis, lo horizontal de todo el tiempo: marcar siempre da eso).
              Tendencia confundida: de la tendencia, cuánto marca como rango; es el error caro. J = rango hallado − tendencia confundida: 0 es azar y 1, perfecto.
              Conocer la referencia 12 velas tarde ya da J de 0.49 en 4h: un detector sin futuro siempre llega tarde.
            </div>
          </div>

          <div className="rt-group">
            <h4>Zonas ({data.zones.length})</h4>
            <label className="rt-note"><input type="checkbox" checked={onlyBad} onChange={(e) => setOnlyBad(e.target.checked)} />solo las que caen más en tendencia que en rango</label>
            <table className="rt-table" style={{ marginTop: 4 }}>
              <thead><tr><th style={{ textAlign: 'left' }}>Se supo</th><th>Velas</th><th>Horizontal</th><th></th></tr></thead>
              <tbody>
                {list.slice(0, 300).map(z => (
                  <tr key={z.detected}>
                    <td style={{ textAlign: 'left' }}>{day(z.detected)}</td><td>{z.bars}</td><td>{pct(z.match)}</td>
                    <td><button type="button" className="rt-btn" onClick={() => onFocus(z.detected, (z.low + z.high) / 2)}>Ver</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.length > 300 && <div className="rt-note">Se muestran las primeras 300.</div>}
          </div>
        </>
      )}
    </>
  );
}
