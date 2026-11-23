// Elegir pestaña sin tocar la página, para probarlo con node (tests/tabchoice.test.mjs).
// tabs: lo que da openTabsNow() de tabs.js, [{ n, alive, module, role }] de la 1 a la 5

/**
 * Dónde abrir una moneda del scanner (23/11/2026). Usa la pestaña que ya abrió el scanner, si sigue con el gráfico, o
 * la primera libre de la 2 a la 5. Nunca usa esta pestaña ni un gráfico abierto a mano: el análisis que se hace ahí no
 * se toca. null: todas ocupadas
 */
export function scannerTabNumber(tabs, current) {
  const others = (tabs || []).filter(t => t.n >= 2 && t.n !== current);
  const mine = others.find(t => t.alive && t.role === 'scanner' && t.module === 'chart');
  return (mine || others.find(t => !t.alive))?.n ?? null;
}
