import React from 'react';
import VolumeProfileSettings from '../VolumeProfileSettings';
import RangeDetectionSettings from '../RangeDetectionSettings';
import RejectionPatternSettings from '../RejectionPatternSettings';
import SupportResistanceSettings from '../SupportResistanceSettings';
import SupportResistance2Settings from '../SupportResistance2Settings';
import VWAPSettings from '../VWAPSettings';
import DoubleTopBottomSettings from '../DoubleTopBottomSettings';
import SwingDetectorSettings from '../SwingDetectorSettings';
import OIVolumeConfluenceSettings from '../OIVolumeConfluenceSettings';
import OrderFlowSettings from '../OrderFlowSettings';
import FVGSettings from '../FVGSettings';
import HorizontalRangesSettings from '../HorizontalRangesSettings';
import LiquidationsSettings from '../LiquidationsSettings';
import OrderFlowElementsSettings from '../OrderFlowElementsSettings';
import OrderFlowSetupsSettings from '../OrderFlowSetupsSettings';
import VPPeriodicSettings from '../VPPeriodicSettings';
import ResponseVolumeSettings from '../ResponseVolumeSettings';

/**
 * Los modales de ajustes de los indicadores (los mismos de la principal) para una ventana con un solo gráfico:
 * el 2.º gráfico y el backtesting global. Cada modal cambia el indicador de ese gráfico y lo redibuja.
 */

// Indicadores con modal de ajustes
export const WITH_SETTINGS = new Set([
  'Volume Profile', 'Range Detection', 'Rejection Patterns', 'Support & Resistance', 'S&R v2', 'VWAP',
  'Double Top/Bottom', 'Swing Detector', 'OI-Volume Confluence', 'Order Flow', 'FVG', 'VP Periodic',
  'Volumen de Respuesta', 'Liquidaciones', 'Elementos OF', 'Rangos horizontales'
]);

/** Fondo y caja de los modales que no traen la suya */
const ModalBox = ({ onClose, width = 600, children }) => (
  <div
    className="modal-overlay"
    onClick={onClose}
    style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 3000 }}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ backgroundColor: 'white', borderRadius: 8, maxWidth: width, maxHeight: '85vh', width: '90%', overflow: 'auto', position: 'relative', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}
    >
      <button
        onClick={onClose}
        title="Cerrar"
        style={{ position: 'sticky', top: 8, float: 'right', marginRight: 8, background: '#f44336', color: 'white', border: 'none', borderRadius: '50%', width: 32, height: 32, fontSize: 20, cursor: 'pointer', zIndex: 1 }}
      >
        ×
      </button>
      <div style={{ padding: 20 }}>{children}</div>
    </div>
  </div>
);

const noop = () => {};

/**
 * name: indicador cuyo modal está abierto (o 'Setups OF'). chartRef: el MiniChart. candles: todas las velas del marco;
 * closedCandles(): las cerradas a la hora que se muestra. startTime: inicio de la simulación o de la fase.
 */
const ChartIndicatorSettings = ({
  name, setName, chartRef, symbol, timeframe, candles, closedCandles, startTime, label,
  vpConfig, setVpConfig, setVpFixedRange, rejectionConfig, setRejectionConfig, setIndicatorStates
}) => {
  const current = name ? chartRef.current?.getIndicatorManager?.() || null : null;
  if (!current || !symbol) return null;
  const close = () => setName(null);
  const applyHere = (change) => {
    const manager = chartRef.current?.getIndicatorManager?.();
    if (!manager) return;
    change(manager);
    chartRef.current?.forceRedraw?.();
  };
  switch (name) {
    case 'Volume Profile':
      return (
        <ModalBox onClose={close}>
          <h3 style={{ marginTop: 0 }}>Volume Profile · {label}</h3>
          <VolumeProfileSettings
            config={vpConfig}
            onConfigChange={(next) => setVpConfig(previous => ({ ...previous, ...next }))}
            onFixedRangeChange={(start, end) => setVpFixedRange({ start, end, applyToAll: false, symbol })}
            applyToAll={false}
            onApplyToAllChange={noop}
            currentSymbol={symbol}
          />
        </ModalBox>
      );
    case 'Range Detection':
      return (
        <div className="modal-overlay" onClick={close}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <RangeDetectionSettings symbol={symbol} indicatorManager={current} candles={closedCandles()} onClose={close} />
          </div>
        </div>
      );
    case 'Rejection Patterns':
      return (
        <RejectionPatternSettings
          symbol={symbol}
          indicatorManager={current}
          onConfigChange={(config) => { setRejectionConfig(config); applyHere(m => m.updateRejectionPatternConfig(config)); }}
          onShowModeChange={(mode) => applyHere(m => m.getRejectionPatternIndicator()?.setShowMode(mode))}
          onClose={close}
          initialConfig={rejectionConfig}
        />
      );
    case 'Support & Resistance':
      return <SupportResistanceSettings symbol={symbol} indicatorManager={current} onClose={close} />;
    case 'S&R v2':
      return (
        <SupportResistance2Settings
          symbol={symbol}
          indicatorManager={current}
          onConfigChange={config => applyHere(m => m.supportResistance2Indicator?.updateConfig(config))}
          onClose={close}
        />
      );
    case 'VWAP':
      return (
        <ModalBox onClose={close}>
          <VWAPSettings
            config={current.getIndicatorConfig('VWAP') || {}}
            onConfigChange={async (next) => {
              await current.applyConfig('VWAP', next);
              const vwap = current.indicators.find(indicator => indicator.name === 'VWAP');
              if (vwap) {
                vwap._lastCalculatedLength = 0;
                vwap._calculationValid = false;
              }
              chartRef.current?.forceRedraw?.();
            }}
            currentSymbol={symbol}
            interval={timeframe}
            onClose={close}
          />
        </ModalBox>
      );
    case 'Double Top/Bottom':
      return (
        <ModalBox onClose={close} width={700}>
          <DoubleTopBottomSettings
            symbol={symbol}
            initialConfig={current.getIndicatorConfig('Double Top/Bottom')}
            onConfigChange={async (next) => {
              await current.applyConfig('Double Top/Bottom', next, candles, startTime);
              // Como en la principal: apagar y encender para que el gráfico tome los patrones nuevos
              setIndicatorStates(previous => ({ ...previous, 'Double Top/Bottom': false }));
              setTimeout(() => setIndicatorStates(previous => ({ ...previous, 'Double Top/Bottom': next.enabled !== false })), 50);
            }}
            onClose={close}
          />
        </ModalBox>
      );
    case 'Swing Detector':
      return (
        <ModalBox onClose={close} width={500}>
          <SwingDetectorSettings
            symbol={symbol}
            config={current.getIndicatorConfig('Swing Detector')}
            onConfigChange={async (next) => {
              await current.applyConfig('Swing Detector', next);
              chartRef.current?.forceRedraw?.();
            }}
            onClose={close}
          />
        </ModalBox>
      );
    case 'OI-Volume Confluence':
      return (
        <ModalBox onClose={close} width={500}>
          <OIVolumeConfluenceSettings
            config={current.getIndicatorConfig('OI-Volume Confluence') || {}}
            onConfigChange={async (next) => {
              await current.applyConfig('OI-Volume Confluence', next);
              chartRef.current?.forceRedraw?.();
            }}
            currentSymbol={symbol}
            onClose={close}
          />
        </ModalBox>
      );
    case 'Order Flow':
      return (
        <OrderFlowSettings
          symbol={symbol}
          indicator={current.getOrderFlowIndicator()}
          activeTimeframe={timeframe}
          onApply={(settings) => applyHere(m => m.getOrderFlowIndicator().updateConfig(settings))}
          onClose={close}
        />
      );
    case 'FVG':
      return (
        <FVGSettings
          symbol={symbol}
          indicator={current.getFVGIndicator()}
          onApply={(settings) => applyHere(m => m.getFVGIndicator().updateConfig(settings))}
          onClose={close}
        />
      );
    case 'Rangos horizontales':
      return (
        <HorizontalRangesSettings
          symbol={symbol}
          indicator={current.getHorizontalRangesIndicator()}
          onApply={(settings) => applyHere(m => m.getHorizontalRangesIndicator().updateConfig(settings))}
          onClose={close}
        />
      );
    case 'VP Periodic':
      return (
        <VPPeriodicSettings
          symbol={symbol}
          indicator={current.getVPPeriodicIndicator()}
          onApply={(settings) => applyHere(m => m.getVPPeriodicIndicator().updateConfig(settings))}
          onClose={close}
        />
      );
    case 'Volumen de Respuesta':
      return (
        <ResponseVolumeSettings
          symbol={symbol}
          indicator={current.getResponseVolumeIndicator()}
          onApply={(settings) => applyHere(m => m.getResponseVolumeIndicator().updateConfig(settings))}
          onClose={close}
        />
      );
    case 'Liquidaciones':
      return (
        <LiquidationsSettings
          symbol={symbol}
          indicator={current.getLiquidationsIndicator()}
          onApply={(settings) => applyHere(m => m.getLiquidationsIndicator().updateConfig(settings))}
          onClose={close}
        />
      );
    case 'Elementos OF':
      return (
        <OrderFlowElementsSettings
          symbol={symbol}
          indicator={current.getOFElementsIndicator()}
          onApply={(settings) => applyHere(m => m.getOFElementsIndicator().updateConfig(settings))}
          onClose={close}
          onOpenSetups={() => setName('Setups OF')}
        />
      );
    case 'Setups OF':
      return (
        <OrderFlowSetupsSettings
          symbol={symbol}
          indicator={current.getOFElementsIndicator()}
          onApply={(config) => applyHere(m => m.getOFElementsIndicator().setSetupsConfig(config))}
          onClose={close}
        />
      );
    default:
      return null;
  }
};

export default ChartIndicatorSettings;
