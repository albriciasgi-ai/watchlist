// Script para habilitar temporalmente los logs de debug
// Ejecutar esto en la consola del navegador

localStorage.setItem('DEBUG_MODE', 'true');
console.log('✅ Debug mode enabled. Refresh the page to see all logs.');
console.log('To disable debug mode, run: localStorage.setItem("DEBUG_MODE", "false")');