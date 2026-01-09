// Script para verificar que los cambios funcionan correctamente
// Ejecutar en la consola del navegador después de abrir la aplicación

console.log('=== VERIFICACIÓN DE CORRECCIONES ===');

// 1. Verificar que los console.log de MiniChart aparecen
console.log('\n📊 PASO 1: Verificar logs de MiniChart');
console.log('Buscar estos mensajes en la consola:');
console.log('- "[SYMBOL] Solicitando histórico..."');
console.log('- "[SYMBOL] ✅ Histórico cargado..."');
console.log('- "[SYMBOL] 🚀 Componente montado..."');

// 2. Verificar que NO se crean indicadores deshabilitados
console.log('\n🚫 PASO 2: Verificar indicadores deshabilitados');
console.log('NO deben aparecer estos mensajes si están deshabilitados:');
console.log('- "Creando Fibonacci porque está habilitado"');
console.log('- "Creando Continuation Patterns porque está habilitado"');

// 3. Verificar estado de los gráficos
console.log('\n📈 PASO 3: Verificar gráficos');
setTimeout(() => {
    // Buscar canvas de uPlot
    const charts = document.querySelectorAll('canvas');
    console.log(`Encontrados ${charts.length} elementos canvas`);

    // Verificar si tienen contenido
    let chartsConDatos = 0;
    charts.forEach((canvas, index) => {
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const hasContent = imageData.data.some(pixel => pixel !== 0);
        if (hasContent) {
            chartsConDatos++;
            console.log(`✅ Canvas ${index + 1}: Tiene datos dibujados`);
        } else {
            console.log(`❌ Canvas ${index + 1}: Está en blanco`);
        }
    });

    if (chartsConDatos > 0) {
        console.log(`\n✅ ÉXITO: ${chartsConDatos} gráficos están mostrando datos`);
    } else {
        console.log('\n❌ ERROR: Ningún gráfico muestra datos');
    }
}, 3000);

// 4. Verificar indicadores activos
console.log('\n🔧 PASO 4: Verificar indicadores activos');
setTimeout(() => {
    // Verificar registro de managers
    if (window.IndicatorManagerRegistry) {
        const managers = window.IndicatorManagerRegistry.managers;
        console.log(`Managers registrados: ${Object.keys(managers).length}`);

        Object.entries(managers).forEach(([symbol, manager]) => {
            console.log(`\n${symbol}:`);
            if (manager && manager.indicators) {
                const activeIndicators = manager.indicators.filter(ind => ind.enabled);
                console.log(`  - Indicadores activos: ${activeIndicators.map(ind => ind.name).join(', ')}`);
                console.log(`  - Total indicadores creados: ${manager.indicators.length}`);
            }
        });
    } else {
        console.log('Registry no disponible aún');
    }
}, 4000);

console.log('\n=== FIN DE VERIFICACIÓN ===');
console.log('Espera 4 segundos para ver todos los resultados...');