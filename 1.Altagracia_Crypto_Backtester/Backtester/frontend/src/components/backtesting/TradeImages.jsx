import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import ObserverReading from './ObserverReading';
import ScreenshotModal from './ScreenshotModal';
import { imageBlock, imageCaption, imageSlots, screenshotUrl } from './observer.js';
import './Observer.css';

import { tradeLabel } from './OrderManager.js';
import { usePortalTarget } from './PopupWindow';
const BLOCK_TEXT = {
  date: 'Oculta: es de otra sesión y mostraría la fecha',
  future: 'Oculta: muestra velas posteriores a la hora simulada'
};

/** Imágenes de una orden terminada. Se abren junto a sus medidas para poder confirmarlas */
const TradeImages = ({ trade, catalog, viewer, onGoTo = null }) => {
  const portalTarget = usePortalTarget(); // En la ventana aparte del Observador, si está abierta
  const [view, setView] = useState(null);
  const [revealed, setRevealed] = useState({});

  const slots = imageSlots(trade);
  if (slots.length === 0) {
    return <div className="observer-note">{trade.status === 'cancelled' ? 'La orden se canceló sin abrirse.' : 'Esta orden no guardó imágenes.'}</div>;
  }

  const blockOf = (kind) => (revealed[kind] ? null : imageBlock(trade, kind, viewer()));
  const shown = (kind) => (trade.images?.[kind] && !blockOf(kind) ? trade.images[kind].path : undefined);
  const captions = Object.fromEntries(slots.map(({ kind }) => [kind, imageCaption(trade, kind)]));

  return (
    <div className="observer-images">
      {slots.map(({ kind, label, image, missing }) => {
        if (!image) return <div key={kind} className="observer-image-missing">{label}: {missing}</div>;

        const block = blockOf(kind);
        if (block) {
          return (
            <div key={kind} className="observer-image-missing">
              <span>{label}. {BLOCK_TEXT[block]}.</span>
              <button type="button" className="btn-quick" onClick={() => setRevealed(current => ({ ...current, [kind]: true }))}>Ver igual</button>
            </div>
          );
        }

        return (
          <button key={kind} type="button" className="observer-image" title="Ver junto a las medidas" onClick={() => setView(kind)}>
            <img src={screenshotUrl(image.path)} alt={`${label} del trade`} loading="lazy" />
            <span>{label}</span>
          </button>
        );
      })}

      {view && createPortal(
        <ScreenshotModal
          decisionScreenshotPath={shown('decision')}
          screenshotPath={shown('entry')}
          exitScreenshotPath={shown('exit')}
          initialView={view}
          orderId={tradeLabel(trade)}
          side={trade.side}
          pnl={trade.pnl}
          captions={captions}
          markers={Object.fromEntries(slots.map(({ kind }) => [kind, trade.images?.[kind]?.markers || []]))}
          items={trade.levels || []}
          onGoTo={onGoTo}
          aside={<ObserverReading trade={trade} catalog={catalog} review onGoTo={onGoTo && ((item) => onGoTo(item))} />}
          onClose={() => setView(null)}
        />,
        portalTarget
      )}
    </div>
  );
};

export default TradeImages;
