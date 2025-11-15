const fs = require('fs');
const path = require('path');

// Read the markdown file
const mdContent = fs.readFileSync('Resumen_Desarrollo_RangeDetector.md', 'utf8');

// Simple markdown to HTML converter
function mdToHtml(md) {
  let html = md;

  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Code blocks
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Lists
  html = html.replace(/^\- (.*$)/gim, '<li>$1</li>');
  html = html.replace(/^\d+\. (.*$)/gim, '<li>$1</li>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li>.*<\/li>\n)+/g, (match) => '<ul>' + match + '</ul>');

  // Tables
  html = html.replace(/\|(.+)\|\n\|[\-\s|]+\|\n((?:\|.+\|\n?)+)/g, (match, header, rows) => {
    const headerCells = header.split('|').filter(s => s.trim()).map(h => `<th>${h.trim()}</th>`).join('');
    const bodyRows = rows.trim().split('\n').map(row => {
      const cells = row.split('|').filter(s => s.trim()).map(c => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
  });

  // Horizontal rules
  html = html.replace(/^---$/gim, '<hr>');

  // Checkmarks
  html = html.replace(/✅/g, '<span class="checkmark">✅</span>');

  // Paragraphs
  html = html.split('\n\n').map(para => {
    if (!para.match(/^<(h[1-6]|ul|ol|pre|table|hr)/)) {
      return '<p>' + para + '</p>';
    }
    return para;
  }).join('\n');

  return html;
}

const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Resumen Desarrollo Range Detector</title>
  <style>
    @page {
      margin: 2cm;
      size: A4;
    }

    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 210mm;
      margin: 0 auto;
      padding: 20px;
      background: white;
    }

    h1 {
      color: #2196F3;
      border-bottom: 3px solid #2196F3;
      padding-bottom: 10px;
      margin-top: 30px;
      page-break-after: avoid;
    }

    h2 {
      color: #1976D2;
      border-bottom: 2px solid #E3F2FD;
      padding-bottom: 8px;
      margin-top: 25px;
      page-break-after: avoid;
    }

    h3 {
      color: #0D47A1;
      margin-top: 20px;
      page-break-after: avoid;
    }

    code {
      background: #f5f5f5;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 0.9em;
      color: #d32f2f;
    }

    pre {
      background: #263238;
      color: #ECEFF1;
      padding: 15px;
      border-radius: 5px;
      overflow-x: auto;
      page-break-inside: avoid;
    }

    pre code {
      background: none;
      color: #ECEFF1;
      padding: 0;
    }

    table {
      border-collapse: collapse;
      width: 100%;
      margin: 20px 0;
      page-break-inside: avoid;
    }

    th, td {
      border: 1px solid #ddd;
      padding: 12px;
      text-align: left;
    }

    th {
      background: #2196F3;
      color: white;
      font-weight: bold;
    }

    tr:nth-child(even) {
      background: #f5f5f5;
    }

    ul, ol {
      margin: 15px 0;
      padding-left: 30px;
    }

    li {
      margin: 8px 0;
    }

    hr {
      border: none;
      border-top: 2px solid #E0E0E0;
      margin: 30px 0;
    }

    .checkmark {
      color: #4CAF50;
      font-weight: bold;
    }

    a {
      color: #2196F3;
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    blockquote {
      border-left: 4px solid #2196F3;
      padding-left: 20px;
      margin: 20px 0;
      color: #666;
      font-style: italic;
    }

    .page-break {
      page-break-after: always;
    }

    @media print {
      body {
        padding: 0;
      }

      h1, h2, h3 {
        page-break-after: avoid;
      }

      pre, table {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
${mdToHtml(mdContent)}
</body>
</html>`;

// Write HTML file
fs.writeFileSync('Resumen_Desarrollo_RangeDetector.html', htmlContent, 'utf8');

console.log('✅ HTML generado: Resumen_Desarrollo_RangeDetector.html');
console.log('');
console.log('Para convertir a PDF:');
console.log('1. Abre el archivo HTML en tu navegador');
console.log('2. Presiona Ctrl+P para imprimir');
console.log('3. Selecciona "Guardar como PDF"');
console.log('4. Guarda como: Resumen_Desarrollo_RangeDetector.pdf');
