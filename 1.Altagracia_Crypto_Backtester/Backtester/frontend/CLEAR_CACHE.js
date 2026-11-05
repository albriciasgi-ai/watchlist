/**
 * SCRIPT DE LIMPIEZA DE CACHÉ - Backtesting App
 *
 * Ejecutar este código en la consola del navegador (F12 → Console)
 * para limpiar completamente el caché de IndexedDB.
 *
 * Instrucciones:
 * 1. Abrir la app del backtester en el navegador
 * 2. Presionar F12 para abrir DevTools
 * 3. Ir a la pestaña "Console"
 * 4. Copiar y pegar este código completo
 * 5. Presionar Enter
 * 6. Esperar mensaje de confirmación
 * 7. Recargar la página (F5)
 */

(async function clearBacktestingCache() {
  console.log('%c🧹 LIMPIEZA DE CACHÉ - INICIANDO...', 'background: #FF9800; color: white; font-size: 16px; padding: 10px;');

  try {
    // 1. Eliminar IndexedDB
    console.log('🗑️ Paso 1: Eliminando IndexedDB...');
    const dbDeleteRequest = indexedDB.deleteDatabase('BacktestingDataDB');

    await new Promise((resolve, reject) => {
      dbDeleteRequest.onsuccess = () => {
        console.log('✅ IndexedDB eliminado exitosamente');
        resolve();
      };

      dbDeleteRequest.onerror = () => {
        console.error('❌ Error al eliminar IndexedDB:', dbDeleteRequest.error);
        reject(dbDeleteRequest.error);
      };

      dbDeleteRequest.onblocked = () => {
        console.warn('⚠️ Operación bloqueada - Cierra todas las pestañas de la app e intenta de nuevo');
        reject(new Error('Database deletion blocked'));
      };
    });

    // 2. Eliminar localStorage relacionado
    console.log('🗑️ Paso 2: Limpiando localStorage...');
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (
        key.includes('backtesting') ||
        key.includes('BTCUSDT') ||
        key.includes('volumeprofile') ||
        key.includes('indicator')
      )) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach(key => {
      localStorage.removeItem(key);
      console.log(`   🗑️ Eliminado: ${key}`);
    });
    console.log(`✅ ${keysToRemove.length} items eliminados de localStorage`);

    // 3. Limpiar sessionStorage
    console.log('🗑️ Paso 3: Limpiando sessionStorage...');
    sessionStorage.clear();
    console.log('✅ sessionStorage limpiado');

    // 4. Mostrar resumen
    console.log('%c✅ LIMPIEZA COMPLETADA', 'background: #4CAF50; color: white; font-size: 18px; padding: 10px; font-weight: bold;');
    console.log('%cAhora recarga la página (F5) para descargar datos frescos del backend', 'background: #2196F3; color: white; font-size: 14px; padding: 8px;');
    console.log('%c⏱️ La descarga inicial tomará ~15 minutos (todos los timeframes)', 'background: #FF9800; color: white; font-size: 12px; padding: 5px;');

    // Ofrecer recarga automática
    if (confirm('✅ Caché limpiado exitosamente.\n\n¿Recargar la página ahora para descargar datos frescos?')) {
      location.reload();
    }

  } catch (error) {
    console.error('%c❌ ERROR EN LIMPIEZA', 'background: #F44336; color: white; font-size: 16px; padding: 10px;');
    console.error(error);
    console.log('%cInstrucciones alternativas:', 'font-weight: bold; font-size: 14px;');
    console.log('1. Cierra TODAS las pestañas de la app del backtester');
    console.log('2. Abre una nueva pestaña');
    console.log('3. Ve a DevTools (F12) → Application → Storage');
    console.log('4. Click derecho en "IndexedDB" → Delete');
    console.log('5. Click en "Clear site data"');
    console.log('6. Recarga la app');
  }
})();
