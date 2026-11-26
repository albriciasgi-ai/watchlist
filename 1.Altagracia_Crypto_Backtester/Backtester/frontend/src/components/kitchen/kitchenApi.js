// Pedidos de la cocina de estrategias al backend de App 1 (kitchen.py)
import { API_BASE_URL } from '../../config.js';

/**
 * La estrategia en borrador sobre las velas ya cerradas en la hora simulada. body: { tf (minutos), candles, doc, view, pick }.
 * Un backend de antes de la cocina responde 404: el error lo dice.
 */
export async function evaluateKitchen(symbol, body, signal) {
  const response = await fetch(`${API_BASE_URL}/api/kitchen/evaluate/${encodeURIComponent(symbol)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal
  });
  if (response.status === 404) throw new Error('El backend de App 1 que está corriendo no conoce la cocina: hay que reiniciarlo.');
  if (!response.ok) throw new Error(`El backend respondió ${response.status}`);
  const data = await response.json();
  if (!data.success) throw new Error(data.message || 'El backend no pudo evaluar la estrategia');
  return data;
}
