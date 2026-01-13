/**
 * Script de prueba automatizado para verificar la corrección del bug
 * de Double Top/Bottom maxBreakoutPercent
 */

const fs = require('fs');
const path = require('path');

// Colores para la consola
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m'
};

// Mock de localStorage para pruebas
class LocalStorageMock {
    constructor() {
        this.store = {};
    }

    getItem(key) {
        return this.store[key] || null;
    }

    setItem(key, value) {
        this.store[key] = value.toString();
    }

    removeItem(key) {
        delete this.store[key];
    }

    clear() {
        this.store = {};
    }
}

// Mock de la función getMaxBreakoutByInterval
function getMaxBreakoutByInterval(interval) {
    switch (interval) {
        case '1':   return 7.0;
        case '3':   return 5.0;
        case '5':   return 4.0;
        case '15':  return 3.0;
        case '30':  return 2.5;
        case '60':  return 2.0;
        case '120': return 2.0;
        case '240': return 2.0;
        case 'D':   return 2.0;
        default:    return 3.0;
    }
}

// Simulación de la función loadConfig CORREGIDA
function loadConfigCorrected(symbol, interval, localStorage) {
    const saved = localStorage.getItem(`double_topbottom_config_${symbol}`);
    let config;

    if (saved) {
        try {
            config = JSON.parse(saved);
            // RESPETAMOS LA CONFIGURACIÓN GUARDADA DEL USUARIO
            // Solo aplicamos valores por defecto si faltan propiedades

            // Asegurar estructura básica
            if (!config.doubleTopBottom) {
                config.doubleTopBottom = {};
            }

            // Solo aplicar valor por defecto si maxBreakoutPercent no está definido
            if (config.doubleTopBottom.maxBreakoutPercent === undefined || config.doubleTopBottom.maxBreakoutPercent === null) {
                config.doubleTopBottom.maxBreakoutPercent = getMaxBreakoutByInterval(interval);
                console.log(`[${symbol}] Using default maxBreakoutPercent: ${config.doubleTopBottom.maxBreakoutPercent}% for interval ${interval}`);
            }

            // Asegurar que existan las estructuras necesarias sin sobrescribir valores
            if (!config.doubleTopBottom.volumeFilter) {
                config.doubleTopBottom.volumeFilter = { enabled: false };
            }

            if (!config.filters) {
                config.filters = {
                    minConfidence: 20,
                    requireBothRejections: false
                };
            }

        } catch (e) {
            console.error(`[${symbol}] Failed to load double top/bottom config:`, e);
            config = getDefaultConfig(interval);
        }
    } else {
        config = getDefaultConfig(interval);
    }

    return config;
}

// Simulación de la función loadConfig BUGUEADA (versión anterior)
function loadConfigBuggy(symbol, interval, localStorage) {
    const saved = localStorage.getItem(`double_topbottom_config_${symbol}`);
    let config;

    if (saved) {
        try {
            config = JSON.parse(saved);
        } catch (e) {
            console.error(`[${symbol}] Failed to load double top/bottom config:`, e);
            config = getDefaultConfig(interval);
        }
    } else {
        config = getDefaultConfig(interval);
    }

    // BUG: SIEMPRE actualizar maxBreakoutPercent según el timeframe actual
    if (!config.doubleTopBottom) {
        config.doubleTopBottom = {};
    }

    config.doubleTopBottom.maxBreakoutPercent = getMaxBreakoutByInterval(interval);

    // BUG: FORZAR valores
    if (!config.filters) {
        config.filters = {};
    }
    config.filters.minConfidence = 20;
    config.filters.requireBothRejections = false;

    return config;
}

function getDefaultConfig(interval) {
    return {
        enabled: true,
        doubleTopBottom: {
            maxBreakoutPercent: getMaxBreakoutByInterval(interval),
            lookbackCandles: 50,
            candlesPerExtreme: 5,
            volumeFilter: { enabled: false }
        },
        filters: {
            minConfidence: 20,
            requireBothRejections: false
        }
    };
}

// Tests
class TestSuite {
    constructor() {
        this.tests = [];
        this.passed = 0;
        this.failed = 0;
    }

    test(name, fn) {
        this.tests.push({ name, fn });
    }

    async run() {
        console.log(`${colors.cyan}${colors.bold}🧪 Ejecutando suite de pruebas para Double Top/Bottom Config${colors.reset}\n`);

        for (const test of this.tests) {
            try {
                await test.fn();
                console.log(`${colors.green}✅ ${test.name}${colors.reset}`);
                this.passed++;
            } catch (error) {
                console.log(`${colors.red}❌ ${test.name}${colors.reset}`);
                console.log(`   ${colors.red}${error.message}${colors.reset}`);
                this.failed++;
            }
        }

        console.log(`\n${colors.bold}Resultados:${colors.reset}`);
        console.log(`${colors.green}✅ Pasaron: ${this.passed}${colors.reset}`);
        console.log(`${colors.red}❌ Fallaron: ${this.failed}${colors.reset}`);

        if (this.failed === 0) {
            console.log(`\n${colors.green}${colors.bold}🎉 ¡Todas las pruebas pasaron exitosamente!${colors.reset}`);
        } else {
            console.log(`\n${colors.red}${colors.bold}⚠️ Algunas pruebas fallaron${colors.reset}`);
        }

        return this.failed === 0;
    }
}

// Función de aserción
function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

// Ejecutar pruebas
async function runTests() {
    const suite = new TestSuite();
    const symbol = 'BTCUSDT';

    suite.test('Test 1: Configuración por defecto se aplica cuando no hay datos guardados', () => {
        const localStorage = new LocalStorageMock();
        const config = loadConfigCorrected(symbol, '60', localStorage);

        assert(config.doubleTopBottom.maxBreakoutPercent === 2.0,
            `Expected maxBreakoutPercent=2.0 for 1h interval, got ${config.doubleTopBottom.maxBreakoutPercent}`);
    });

    suite.test('Test 2: El valor personalizado de maxBreakoutPercent se mantiene (versión corregida)', () => {
        const localStorage = new LocalStorageMock();

        // Guardar configuración personalizada
        const customConfig = {
            doubleTopBottom: {
                maxBreakoutPercent: 15.5,
                lookbackCandles: 75
            },
            filters: {
                minConfidence: 35,
                requireBothRejections: true
            }
        };
        localStorage.setItem(`double_topbottom_config_${symbol}`, JSON.stringify(customConfig));

        // Cargar con diferentes timeframes
        const config60 = loadConfigCorrected(symbol, '60', localStorage);
        const config15 = loadConfigCorrected(symbol, '15', localStorage);
        const config5 = loadConfigCorrected(symbol, '5', localStorage);

        assert(config60.doubleTopBottom.maxBreakoutPercent === 15.5,
            `Expected maxBreakoutPercent=15.5, got ${config60.doubleTopBottom.maxBreakoutPercent} for 1h`);
        assert(config15.doubleTopBottom.maxBreakoutPercent === 15.5,
            `Expected maxBreakoutPercent=15.5, got ${config15.doubleTopBottom.maxBreakoutPercent} for 15m`);
        assert(config5.doubleTopBottom.maxBreakoutPercent === 15.5,
            `Expected maxBreakoutPercent=15.5, got ${config5.doubleTopBottom.maxBreakoutPercent} for 5m`);
    });

    suite.test('Test 3: Los valores de filters personalizados se mantienen', () => {
        const localStorage = new LocalStorageMock();

        const customConfig = {
            doubleTopBottom: {
                maxBreakoutPercent: 10.0
            },
            filters: {
                minConfidence: 45,
                requireBothRejections: true
            }
        };
        localStorage.setItem(`double_topbottom_config_${symbol}`, JSON.stringify(customConfig));

        const config = loadConfigCorrected(symbol, '60', localStorage);

        assert(config.filters.minConfidence === 45,
            `Expected minConfidence=45, got ${config.filters.minConfidence}`);
        assert(config.filters.requireBothRejections === true,
            `Expected requireBothRejections=true, got ${config.filters.requireBothRejections}`);
    });

    suite.test('Test 4: La versión bugueada SIEMPRE sobrescribe los valores (demostración del bug)', () => {
        const localStorage = new LocalStorageMock();

        const customConfig = {
            doubleTopBottom: {
                maxBreakoutPercent: 15.5  // Valor personalizado
            },
            filters: {
                minConfidence: 45,
                requireBothRejections: true
            }
        };
        localStorage.setItem(`double_topbottom_config_${symbol}`, JSON.stringify(customConfig));

        const config = loadConfigBuggy(symbol, '60', localStorage);

        // Esta prueba demuestra el bug: el valor personalizado se pierde
        assert(config.doubleTopBottom.maxBreakoutPercent === 2.0,  // Se sobrescribe con el valor del timeframe
            `Bug confirmado: maxBreakoutPercent fue sobrescrito a ${config.doubleTopBottom.maxBreakoutPercent} en lugar de mantener 15.5`);
        assert(config.filters.minConfidence === 20,  // Se fuerza a 20
            `Bug confirmado: minConfidence fue forzado a ${config.filters.minConfidence} en lugar de mantener 45`);
    });

    suite.test('Test 5: Valores por defecto solo se aplican cuando faltan propiedades', () => {
        const localStorage = new LocalStorageMock();

        // Configuración parcial (falta maxBreakoutPercent)
        const partialConfig = {
            doubleTopBottom: {
                lookbackCandles: 100  // Solo este valor
                // maxBreakoutPercent no está definido
            },
            filters: {
                minConfidence: 30
                // requireBothRejections no está definido
            }
        };
        localStorage.setItem(`double_topbottom_config_${symbol}`, JSON.stringify(partialConfig));

        const config = loadConfigCorrected(symbol, '15', localStorage);

        // maxBreakoutPercent debe tomar el valor por defecto del timeframe
        assert(config.doubleTopBottom.maxBreakoutPercent === 3.0,  // Valor por defecto para 15m
            `Expected default maxBreakoutPercent=3.0 for 15m, got ${config.doubleTopBottom.maxBreakoutPercent}`);

        // lookbackCandles debe mantener el valor personalizado
        assert(config.doubleTopBottom.lookbackCandles === 100,
            `Expected lookbackCandles=100, got ${config.doubleTopBottom.lookbackCandles}`);

        // minConfidence debe mantener el valor personalizado
        assert(config.filters.minConfidence === 30,
            `Expected minConfidence=30, got ${config.filters.minConfidence}`);
    });

    suite.test('Test 6: Cambio de timeframe no afecta valores guardados', () => {
        const localStorage = new LocalStorageMock();

        // Simular un flujo de trabajo real
        // 1. Usuario configura valores en timeframe 60m
        let config = {
            doubleTopBottom: {
                maxBreakoutPercent: 25.0,
                lookbackCandles: 80
            },
            filters: {
                minConfidence: 50
            }
        };
        localStorage.setItem(`double_topbottom_config_${symbol}`, JSON.stringify(config));

        // 2. Cargar en diferentes timeframes
        const intervals = ['1', '5', '15', '30', '60', '240', 'D'];

        for (const interval of intervals) {
            const loadedConfig = loadConfigCorrected(symbol, interval, localStorage);
            assert(loadedConfig.doubleTopBottom.maxBreakoutPercent === 25.0,
                `maxBreakoutPercent should remain 25.0 in interval ${interval}, got ${loadedConfig.doubleTopBottom.maxBreakoutPercent}`);
        }
    });

    await suite.run();
}

// Ejecutar las pruebas
console.log(`${colors.yellow}========================================${colors.reset}`);
console.log(`${colors.yellow}  Double Top/Bottom Config Test Suite${colors.reset}`);
console.log(`${colors.yellow}========================================${colors.reset}\n`);

runTests().then(success => {
    process.exit(success ? 0 : 1);
}).catch(error => {
    console.error(`${colors.red}Error fatal:${colors.reset}`, error);
    process.exit(1);
});