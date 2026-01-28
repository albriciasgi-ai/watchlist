// Script para agregar onOpenOrderFlowSettings prop a MiniChart
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'frontend/src/components/SingleSymbolAnalyzer.jsx');

const oldCode = `            onOpenSwingDetectorSettings={handleOpenSwingDetectorSettings}
            onOpenSR2Settings={handleOpenSR2Settings}
            rejectionPatternConfig={rejectionPatternConfig}`;

const newCode = `            onOpenSwingDetectorSettings={handleOpenSwingDetectorSettings}
            onOpenSR2Settings={handleOpenSR2Settings}
            onOpenOrderFlowSettings={handleOpenOrderFlowSettings}
            rejectionPatternConfig={rejectionPatternConfig}`;

try {
  let content = fs.readFileSync(filePath, 'utf8');

  // Verificar si ya existe
  if (content.includes('onOpenOrderFlowSettings={handleOpenOrderFlowSettings}')) {
    console.log('La prop onOpenOrderFlowSettings ya existe');
    process.exit(0);
  }

  if (content.includes(oldCode)) {
    content = content.replace(oldCode, newCode);
    fs.writeFileSync(filePath, content);
    console.log('Prop onOpenOrderFlowSettings agregada exitosamente a MiniChart');
  } else {
    console.log('No se encontro el patron exacto');
    process.exit(1);
  }
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
