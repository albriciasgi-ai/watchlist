const fs = require('fs');
const path = require('path');

// Lista de archivos a procesar
const files = [
  'frontend/src/components/indicators/DoubleTopBottomIndicator.js',
  'frontend/src/components/indicators/VWAPIndicator.js',
  'frontend/src/components/indicators/IndicatorManager.js',
  'frontend/src/components/WebSocketManager.js',
  'frontend/src/components/MiniChart.jsx',
  'frontend/src/components/Watchlist.jsx'
];

// Función para reemplazar console.log en un archivo
function replaceConsoleInFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let originalLength = content.length;

    // Contar reemplazos
    let logCount = (content.match(/console\.log/g) || []).length;
    let errorCount = (content.match(/console\.error/g) || []).length;
    let warnCount = (content.match(/console\.warn/g) || []).length;

    // Solo procesar si hay algo que reemplazar
    if (logCount + errorCount + warnCount === 0) {
      console.log(`✅ ${path.basename(filePath)}: No console statements found`);
      return;
    }

    // Verificar si ya tiene Logger importado
    const hasLogger = content.includes("import Logger from");

    // Si no tiene Logger, agregarlo
    if (!hasLogger) {
      // Buscar el lugar correcto para agregar el import (después de otros imports)
      const importRegex = /^import .* from .*$/gm;
      const imports = content.match(importRegex);

      if (imports && imports.length > 0) {
        const lastImport = imports[imports.length - 1];
        const lastImportIndex = content.lastIndexOf(lastImport);
        const insertPosition = lastImportIndex + lastImport.length;

        // Determinar la ruta correcta basada en la ubicación del archivo
        let loggerPath = '../utils/Logger.js';
        if (filePath.includes('indicators')) {
          loggerPath = '../../utils/Logger.js';
        } else if (filePath.includes('components') && !filePath.includes('indicators')) {
          loggerPath = '../utils/Logger.js';
        }

        // Insertar import y crear instancia
        const componentName = path.basename(filePath, path.extname(filePath))
          .replace('Indicator', '')
          .replace('.jsx', '')
          .replace('.js', '');

        const loggerImport = `\nimport Logger from '${loggerPath}';`;
        const loggerInstance = `\n\n// Logger instance\nconst log = new Logger('${componentName}', { level: 'info' });`;

        content = content.slice(0, insertPosition) +
                 loggerImport +
                 loggerInstance +
                 content.slice(insertPosition);
      }
    }

    // Reemplazar console statements
    // Reemplazar console.log con log.debug o log.trace dependiendo del contexto
    content = content.replace(/console\.log\(/g, 'log.debug(');

    // Para logs que parecen ser de trace (tienen muchos detalles)
    content = content.replace(/log\.debug\(\`\[.*?\] 🔍/g, 'log.trace(`[');
    content = content.replace(/log\.debug\(\`\[.*?\] DTB/g, 'log.trace(`[');
    content = content.replace(/log\.debug\(\`\[.*?\] Config/g, 'log.trace(`[');

    // Reemplazar console.error con log.error
    content = content.replace(/console\.error\(/g, 'log.error(');

    // Reemplazar console.warn con log.warn
    content = content.replace(/console\.warn\(/g, 'log.warn(');

    // Reemplazar console.info con log.info
    content = content.replace(/console\.info\(/g, 'log.info(');

    // Guardar el archivo
    fs.writeFileSync(filePath, content, 'utf8');

    console.log(`✅ ${path.basename(filePath)}: Replaced ${logCount} console.log, ${errorCount} console.error, ${warnCount} console.warn`);

  } catch (error) {
    console.error(`❌ Error processing ${filePath}:`, error.message);
  }
}

// Procesar todos los archivos
console.log('🔄 Starting console.log replacement...\n');

files.forEach(file => {
  const fullPath = path.join(__dirname, file);
  if (fs.existsSync(fullPath)) {
    replaceConsoleInFile(fullPath);
  } else {
    console.log(`⚠️  ${file}: File not found`);
  }
});

console.log('\n✅ Replacement complete!');
console.log('\n💡 Note: Logger will be disabled in production automatically.');
console.log('   In development, use window.toggleDebugMode() to toggle logs.');
console.log('   Use window.disableHeavyLogs() to disable performance-heavy logs.');