const fs = require('fs');
const path = require('path');

// Leer el archivo
const filePath = path.join(__dirname, 'frontend/src/components/MiniChart.jsx');
let content = fs.readFileSync(filePath, 'utf8');

// Reemplazar log.candle
content = content.replace(/log\.candle\(symbol,\s*([`'"])(.*?)\1(.*?)\);/g,
  (match, quote, message, rest) => {
    return `log.debug(\`[\${symbol}] ${message}\`${rest});`;
  });

// Reemplazar log.ws
content = content.replace(/log\.ws\(symbol,\s*([`'"])(.*?)\1(.*?)\);/g,
  (match, quote, message, rest) => {
    return `log.debug(\`[\${symbol}] 📡 ${message}\`${rest});`;
  });

// Reemplazar log.indicator
content = content.replace(/log\.indicator\(symbol,\s*([`'"])(.*?)\1(.*?)\);/g,
  (match, quote, message, rest) => {
    return `log.debug(\`[\${symbol}] 📊 ${message}\`${rest});`;
  });

// Reemplazar log.state
content = content.replace(/log\.state\(symbol,\s*(.*?)\);/g,
  (match, params) => {
    const paramsList = params.split(',').map(p => p.trim());
    return `log.trace(\`[\${symbol}] Estado: \${${paramsList[0]}} confirmadas, En progreso: \${${paramsList[1]} ? 'SÍ' : 'NO'}\`);`;
  });

// Contar reemplazos
const candleCount = (content.match(/log\.candle\(/g) || []).length;
const wsCount = (content.match(/log\.ws\(/g) || []).length;
const indicatorCount = (content.match(/log\.indicator\(/g) || []).length;
const stateCount = (content.match(/log\.state\(/g) || []).length;

// Guardar el archivo
fs.writeFileSync(filePath, content, 'utf8');

console.log(`✅ Actualizado MiniChart.jsx:`);
console.log(`   - log.candle: ${candleCount} restantes`);
console.log(`   - log.ws: ${wsCount} restantes`);
console.log(`   - log.indicator: ${indicatorCount} restantes`);
console.log(`   - log.state: ${stateCount} restantes`);