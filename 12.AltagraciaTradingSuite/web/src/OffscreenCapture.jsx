import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import MiniChart from '@app1/components/MiniChart';
import { linesFor } from './botBook.js';

/**
 * Imagen de apertura o cierre de una moneda que no está a la vista (pedido del usuario, 12/11/2026): su gráfico se
 * arma fuera de la pantalla con los indicadores del marco a la vista, toma la imagen y se quita. Quien opera no ve
 * nada, no se abre ninguna ventana y su vista no cambia. Va en document.body: dentro de la vista del gráfico, oculta
 * cuando se mira el módulo del bot, el lienzo no tendría tamaño.
 *
 * job: { id, kind: 'open' | 'close', symbol, side, at, tf, days, size, options, box }. options van a captureScreenshot
 * (la de cierre encuadra desde la apertura con lo elegido para el trade) y box es la caja del trade (getTradeBoxes).
 * onDone(job, imagen o null) se llama una vez.
 */
const WAIT_CANDLES_MS = 25000; // sin velas en ese tiempo, la imagen se da por perdida
const SETTLE_MS = 6000;        // indicadores y footprints piden lo suyo después de las velas
const noop = () => {};
const none = () => [];
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export default function OffscreenCapture({ job, size, tabState, rejectionConfig, onDone }) {
  const chartRef = useRef(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    let alive = true;
    const finish = (image) => {
      if (alive) doneRef.current(job, image);
      alive = false;
    };
    (async () => {
      const started = Date.now();
      while (alive && !(chartRef.current?.candleCount?.() > 0) && Date.now() - started < WAIT_CANDLES_MS) await sleep(500);
      if (!alive) return;
      if (!(chartRef.current?.candleCount?.() > 0)) {
        console.warn(`[journal] ${job.symbol}: sin velas para la imagen de ${job.kind === 'open' ? 'apertura' : 'cierre'}`);
        finish(null);
        return;
      }
      await sleep(SETTLE_MS);
      if (!alive) return;
      chartRef.current?.forceRedraw?.();
      try {
        const shot = await chartRef.current.captureScreenshot('journal', `${job.kind}-${job.at}-${job.symbol}`,
          job.options || { context: job.kind === 'open' });
        finish(shot?.screenshotPath || null);
      } catch (e) {
        console.warn(`[journal] ${job.symbol}: imagen fuera de la pantalla no tomada:`, e?.message);
        finish(null);
      }
    })();
    return () => { alive = false; };
  }, [job]);

  return createPortal(
    <div
      className="backtesting-main"
      aria-hidden="true"
      style={{ position: 'fixed', left: -30000, top: 0, width: size.width, height: size.height, pointerEvents: 'none', zIndex: -1 }}
    >
      <div className="timeframes-container" style={{ height: '100%' }}>
        <div className="timeframe-panel" style={{ display: 'block', height: '100%' }}>
          <MiniChart
            ref={chartRef}
            key={job.id}
            symbol={job.symbol}
            interval={job.tf}
            days={job.days}
            isActive={false}
            indicatorStates={tabState.indicatorStates}
            backtestingMode={false}
            vpConfig={tabState.vpConfig}
            vpFixedRange={null}
            oiMode={tabState.oiMode}
            rejectionPatternConfig={rejectionConfig}
            currentTool="select"
            onToolChange={noop}
            getTradeBoundaries={none}
            getTradeBoxes={() => (job.box ? [job.box] : [])}
            getPositionLines={() => linesFor(job.symbol)}
            chosenStyle="numbers"
            onRequestPause={noop}
            onRequestTimeChange={noop}
            onDrawingsChange={noop}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
