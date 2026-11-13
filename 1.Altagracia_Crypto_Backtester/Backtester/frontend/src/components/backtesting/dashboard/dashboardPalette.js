// Colores de los widgets del dashboard que se dibujan con Chart.js y los medidores (13/11/2026).
// Sin `themed` (App 1) son los de siempre. Con `themed` (el journal de la suite: "los widgets con los estilos
// escogidos por el usuario") son los del estilo elegido; con el Clásico, también los de siempre.
// Las tarjetas, textos y tablas toman sus colores de las variables --dash-* de dashboard_styles.css: quien monta el
// dashboard las cambia (la suite, en JournalDashboard.jsx).
import { THEME, hexOfRgb, isNewTheme, readableOn, rgbOf } from '../../uiTheme.js';

/** Los colores de siempre, escritos a mano en cada widget hasta el 13/11 */
export const CLASSIC_PALETTE = {
  win: '#4CAF50',
  loss: '#EF5350',
  winFill: 'rgba(76, 175, 80, 0.1)',
  lossFill: 'rgba(239, 83, 80, 0.1)',
  muted: '#666',
  grid: '#F0F0F0',
  tooltipBg: 'rgba(255, 255, 255, 0.95)',
  tooltipTitle: '#333',
  tooltipBody: '#666',
  tooltipBorder: '#E0E0E0',
  // Zonas de los medidores, de mala a excelente, y el texto de su evaluación (en el clásico, el mismo color)
  zone: { bad: '#EF5350', poor: '#FF9800', fair: '#FFC107', good: '#8BC34A', great: '#4CAF50' },
  zoneText: { bad: '#EF5350', poor: '#FF9800', fair: '#FFC107', good: '#8BC34A', great: '#4CAF50' },
  needle: '#666',
  gaugeText: '#333',
  font: null,
};

const mixHex = (a, b, t) => {
  const x = rgbOf(a)?.split(',').map(Number);
  const y = rgbOf(b)?.split(',').map(Number);
  if (!x || !y) return a;
  return hexOfRgb(x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(','));
};

/** Los colores de los widgets: los de siempre, o los del estilo elegido si `themed` y el estilo no es el Clásico */
export function dashboardPalette(themed) {
  if (!themed || !isNewTheme()) return CLASSIC_PALETTE;
  const { up, down, divergence } = THEME;
  const zone = { bad: down, poor: mixHex(down, divergence, 0.5), fair: divergence, good: mixHex(divergence, up, 0.5), great: up };
  const background = THEME.chartBg;
  return {
    win: up,
    loss: down,
    winFill: `rgba(${rgbOf(up)}, 0.12)`,
    lossFill: `rgba(${rgbOf(down)}, 0.12)`,
    muted: THEME.textMuted,
    grid: THEME.grid,
    tooltipBg: background,
    tooltipTitle: THEME.text,
    tooltipBody: THEME.textMuted,
    tooltipBorder: THEME.line,
    zone,
    zoneText: Object.fromEntries(Object.entries(zone).map(([name, color]) => [name, readableOn(color, background, 4.5)])),
    needle: THEME.textMuted,
    gaugeText: THEME.text,
    font: THEME.font,
  };
}

/** La letra del estilo para Chart.js (ejes y tooltip), o nada en el clásico: Chart.js sigue con la suya */
export const chartFont = (palette) => (palette.font ? { font: { family: palette.font } } : {});
export const tooltipFonts = (palette) => (palette.font ? { titleFont: { family: palette.font }, bodyFont: { family: palette.font } } : {});
