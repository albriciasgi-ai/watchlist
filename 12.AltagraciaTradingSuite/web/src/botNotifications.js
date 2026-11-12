/**
 * Avisos de Windows del bot (paso 4 de la integración, 12/11/2026), como los de App 10: aviso crítico (posición sin
 * stop, SL que no se pudo poner, resultado desconocido), pausa o reanudación, y posición abierta o cerrada.
 * Solo los da la pestaña principal, para no repetirlos. En Electron la página sigue trabajando oculta en la bandeja.
 */
import { useEffect } from 'react';
import { getJson } from './api.js';
import { subscribeBook } from './botBook.js';
import { TAB } from './tabs.js';

function show(title, body) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    new Notification(title, { body, icon: '/icon.svg' });
  } catch {
    // Sin avisos del sistema: lo mismo se ve en el módulo del bot
  }
}

const sideText = (p) => (p.side === 'Buy' ? 'LONG' : 'SHORT');
const positionKey = (p) => `${p.symbol}:${p.positionIdx ?? 0}:${p.side}`;

export function useBotNotifications() {
  useEffect(() => {
    if (TAB !== 1 || typeof Notification === 'undefined') return undefined;
    if (Notification.permission === 'default') {
      try { Notification.requestPermission(); } catch { /* el navegador puede pedir un clic primero */ }
    }
    let alive = true;
    let lastAlert = null; // hora del aviso crítico más nuevo ya visto (los anteriores a abrir la página no se avisan)
    let paused = null;
    const readOverview = async () => {
      try {
        const d = await getJson('/api/bot/overview');
        if (!alive) return;
        const alerts = d.critical || [];
        const newest = alerts.reduce((m, a) => Math.max(m, Number(a.timestamp) || 0), 0);
        if (lastAlert !== null) {
          for (const a of alerts) {
            if ((Number(a.timestamp) || 0) > lastAlert) show(`Bot: ${a.type || 'aviso'} ${a.symbol || ''}`.trim(), a.message || '');
          }
        }
        lastAlert = Math.max(lastAlert ?? 0, newest);
        const now = d.status?.trading_paused;
        if (paused !== null && typeof now === 'boolean' && now !== paused) {
          show(now ? 'Bot en pausa' : 'Bot reanudado', now ? 'No abre operaciones nuevas.' : 'Vuelve a operar las alertas.');
        }
        if (typeof now === 'boolean') paused = now;
      } catch {
        // El bot no responde: la barra de estado y el módulo del bot lo dicen
      }
    };
    readOverview();
    const timer = setInterval(readOverview, 10000);

    let known = null; // posiciones vistas en la lectura anterior
    const stop = subscribeBook((book) => {
      if (book.error || !book.at) return;
      const current = new Map(book.positions.filter(p => Number(p.size) > 0).map(p => [positionKey(p), p]));
      if (known) {
        for (const [key, p] of current) {
          if (!known.has(key)) {
            show(`Posición abierta: ${sideText(p)} ${p.symbol}`, `${p.size} a ${p.entryPrice}${p.stopLoss ? ` · SL ${p.stopLoss}` : ' · SIN STOP'}`);
          }
        }
        for (const [key, p] of known) {
          if (!current.has(key)) show(`Posición cerrada: ${sideText(p)} ${p.symbol}`, `${p.size} (entrada ${p.entryPrice})`);
        }
      }
      known = current;
    });
    return () => { alive = false; clearInterval(timer); stop(); };
  }, []);
}
