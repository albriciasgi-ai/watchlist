# INVESTIGACIÓN BROKERS API

Documentación completa sobre brokers con API para trading algorítmico de acciones estadounidenses.

**Fecha de investigación:** 3 de Febrero de 2026
**Objetivo:** Expandir el trading bot más allá de crypto hacia acciones US reales

---

## 📚 Documentos Incluidos

### 1. Guías Completas (Markdown)

| Archivo | Descripción | Líneas |
|---------|-------------|--------|
| **ALPACA_TRADING_GUIDE.md** | Guía completa de Alpaca Securities | 500+ |
| **BROKERS_API_COMPARISON.md** | Comparación detallada de 5 brokers | 500+ |

### 2. Presentación Visual

| Archivo | Descripción | Slides |
|---------|-------------|--------|
| **Alpaca_Brokers_Comparison.pptx** | Presentación PowerPoint profesional | 10 |

### 3. Scripts de Validación

| Archivo | Descripción | Lenguaje |
|---------|-------------|----------|
| **count_all_xstocks.py** | Cuenta todos los xStocks disponibles en Bybit | Python |
| **check_xstocks_margin.py** | Verifica capacidades de margin trading | Python |

### 4. Datos de Validación

| Archivo | Descripción | Formato |
|---------|-------------|---------|
| **xstocks_validation_results.json** | Resultados de validación de 5 xStocks | JSON |
| **xstocks_found.json** | Lista completa de xStocks encontrados | JSON |

---

## 🎯 Resumen Ejecutivo

### Bybit xStocks (Actual)
- **Total disponible:** 5 tokens (AAPL, NVDA, META, GOOGL, MCD)
- **Tipo:** Tokens en Solana (no acciones reales)
- **Horario:** 24/7
- **Trading SHORT:** Solo 3/5 con margin (AAPL, NVDA, GOOGL)

### Alpaca Securities (Recomendado)
- **Total disponible:** 1,000+ acciones y ETFs reales
- **Regulación:** FINRA/SIPC (Estados Unidos)
- **Depósito mínimo:** $0
- **Comisiones:** $0
- **API:** Python SDK oficial (`alpaca-py`)
- **Paper trading:** ✅ Gratis
- **Trading SHORT:** ✅ Con margin account ($2,000 mín)

---

## 🏆 5 Brokers Analizados

| # | Broker | Rating | Depósito | Comisiones | API Python | Paper Trading |
|---|--------|--------|----------|------------|------------|---------------|
| 1 | **Alpaca** | ⭐⭐⭐⭐⭐ | $0 | $0 | ✅ Oficial | ✅ Gratis |
| 2 | **Webull** | ⭐⭐⭐⭐ | $0 | $0 | ✅ Oficial | ✅ Gratis |
| 3 | **Interactive Brokers** | ⭐⭐⭐⭐⭐ | $0 | $0.005/sh | ⚠️ Community | ✅ Gratis |
| 4 | **Tradier** | ⭐⭐⭐⭐ | $0 | $0 (Pro $10/mes) | ✅ Oficial | ✅ Gratis |
| 5 | **Schwab** | ⭐⭐⭐ | $0 | $0 | ⚠️ Community | ❌ No |

**Mejor opción para empezar:** Alpaca (facilidad de setup + documentación excelente)

---

## 📖 Contenido Detallado

### ALPACA_TRADING_GUIDE.md
- Proceso de apertura de cuenta (timeline 5-6 días)
- Configuración de API con ejemplos de código
- 6 tipos de órdenes soportadas
- Gestión de posiciones
- Costos y fees detallados
- Comparación con Bybit xStocks
- Bot de ejemplo completo
- Troubleshooting

### BROKERS_API_COMPARISON.md
- Análisis individual de 5 brokers
- Tabla comparativa completa
- Ventajas y desventajas de cada uno
- Estrategia multi-broker recomendada
- Estimación de costos por escenario
- Recursos y documentación oficial
- Roadmap de implementación

### Alpaca_Brokers_Comparison.pptx (10 slides)
1. Portada
2. Resumen Ejecutivo Alpaca
3. Comparación Bybit vs Alpaca
4. Timeline Apertura de Cuenta
5. Tipos de Cuenta
6. 5 Brokers Comparados
7. Tabla Comparativa Detallada
8. Estrategia Multi-Broker
9. Ejemplo de Código
10. Próximos Pasos

---

## 🚀 Próximos Pasos Recomendados

### Fase 1: Quick Start (Semana 1-2)
1. Abrir cuenta Alpaca Paper Trading (gratis, 5 minutos)
2. Configurar API keys
3. Integrar `alpaca_adapter.py` en el bot
4. Testing exhaustivo en paper trading

### Fase 2: Live Trading (Semana 3-4)
1. Migrar a cuenta Live Alpaca
2. Depositar $100-500 inicial (ACH gratis, 3-5 días)
3. Operar acciones de alta liquidez (AAPL, TSLA, NVDA)
4. Validar retornos reales

### Fase 3: Expansión Multi-Exchange (Mes 2-3)
1. Agregar Webull para acciones de Hong Kong
2. Mantener Bybit para crypto 24/7
3. Total: 3 exchanges (diversificación)

### Fase 4: Pro Trader (Mes 6+)
1. Evaluar Interactive Brokers si necesitas:
   - Futures (ES, NQ, CL)
   - Forex (EUR/USD, GBP/USD)
   - Mercados globales (150+ países)

---

## 📊 Validación de xStocks

### Resultados (xstocks_validation_results.json)
- **Símbolos testados:** 5
- **Compatible:** 5/5 (100%)
- **Tests realizados:** instruments, kline, ticker, intervals
- **Conclusión:** ✅ 100% compatible con API de Bybit

### xStocks con Margin Trading
| Símbolo | Margin Trading | Status |
|---------|----------------|--------|
| AAPLXUSDT | ✅ utaOnly | Trading |
| NVDAXUSDT | ✅ utaOnly | Trading |
| METAXUSDT | ❌ none | Trading |
| GOOGLXUSDT | ✅ utaOnly | Trading |
| MCDXUSDT | ❌ none | Trading |

**Conclusión:** Solo 3/5 xStocks permiten SHORT (requiere cuenta UTA de Bybit)

---

## 🔗 Referencias

### Alpaca
- Docs: https://docs.alpaca.markets/
- SDK Python: https://github.com/alpacahq/alpaca-py
- Forum: https://forum.alpaca.markets/

### Webull
- API: https://webullcorporation.com/api
- SDK: https://github.com/webull-inc/openapi-python-sdk

### Interactive Brokers
- TWS API: https://www.interactivebrokers.com/en/trading/tws-api.php
- Python: https://ib-insync.readthedocs.io/

### Tradier
- Docs: https://documentation.tradier.com/
- Python: https://github.com/tradier/tradier-python-client

### Bybit
- V5 API: https://bybit-exchange.github.io/docs/v5/intro
- WebSocket: https://bybit-exchange.github.io/docs/v5/ws/connect

---

## 💡 Notas Importantes

1. **Regulación:** Alpaca, Webull, IBKR, Tradier y Schwab son brokers regulados por FINRA/SIPC en Estados Unidos
2. **Pattern Day Trading:** Requiere $25,000 para hacer 4+ day trades en 5 días
3. **Margin Account:** Requiere $2,000 mínimo para trading SHORT
4. **Paper Trading:** Siempre empezar con paper trading gratis antes de live
5. **Comisiones $0:** Alpaca, Webull y Schwab tienen comisiones $0 en stocks/ETFs
6. **API Keys:** NUNCA subir API keys a GitHub (usar .env)

---

## 📝 Integración con el Bot Actual

El bot actual (`3.TradingBot_Python`) está integrado con Bybit. Para agregar Alpaca:

1. Crear `alpaca_adapter.py` en `backend/trading/`
2. Modificar `exchange_config.json` para multi-exchange
3. Implementar `ExchangeFactory` pattern
4. Testing completo en paper trading
5. Migración gradual a live trading

**Tiempo estimado:** 1-2 semanas de desarrollo + 2-4 semanas de testing

---

**Autor:** Claude Code (Anthropic)
**Última actualización:** 3 de Febrero de 2026
