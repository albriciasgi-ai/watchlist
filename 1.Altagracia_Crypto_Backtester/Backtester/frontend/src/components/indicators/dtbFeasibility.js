// Double Top/Bottom: dice si la configuración no puede dar ningún patrón de un lado.
// Repite los topes de _calculate_confidence en backend/double_topbottom_detector.py:
// rechazo 25 + 25, precio 20, volumen 15 (solo con el filtro de volumen), simetría 15,
// más el bonus de validación posterior. Sin patrón de rechazo en un lado solo quedan
// precio, volumen y bonus. Si cambia esa fórmula, cambiar también aquí.

const SIDES = [
  { key: 'top', name: 'Double Top', patterns: ['shootingStar', 'bearishEngulfing'] },
  { key: 'bottom', name: 'Double Bottom', patterns: ['hammer', 'bullishEngulfing'] }
];

export function maxConfidenceWithoutRejection(config) {
  const volumeOn = !!config?.doubleTopBottom?.volumeFilter?.enabled;
  const bonus = Number(config?.filters?.postPatternConfidenceBonus ?? 20) || 0;
  return 20 + (volumeOn ? 15 : 0) + Math.max(0, bonus);
}

// Devuelve [{ side, name, reason }] con los lados que nunca darán un patrón.
export function impossibleSides(config) {
  const rejection = config?.doubleTopBottom?.rejectionPatterns || {};
  const requireBoth = config?.filters?.requireBothRejections ?? true;
  const minConfidence = Number(config?.filters?.minConfidence ?? 60) || 0;
  const maxWithout = maxConfidenceWithoutRejection(config);
  const out = [];
  for (const side of SIDES) {
    const anyPattern = side.patterns.some(p => rejection[p] !== false);
    if (anyPattern) continue;
    if (requireBoth) {
      out.push({ side: side.key, name: side.name, reason: 'both' });
    } else if (minConfidence > maxWithout) {
      out.push({ side: side.key, name: side.name, reason: 'confidence', max: maxWithout, min: minConfidence });
    }
  }
  return out;
}
