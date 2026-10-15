# COMPARACIÓN DE BROKERS CON API PARA TRADING ALGORÍTMICO

**Fecha:** 15 de octubre de 2026
**Propósito:** Encontrar las mejores alternativas a Alpaca para integrar con nuestra app de trading

---

## TABLA DE CONTENIDOS

1. [Resumen Ejecutivo](#resumen-ejecutivo)
2. [Top 5 Brokers Recomendados](#top-5-brokers-recomendados)
3. [Comparación Detallada](#comparación-detallada)
4. [Análisis Individual](#análisis-individual)
5. [Conclusiones y Recomendaciones](#conclusiones-y-recomendaciones)

---

## RESUMEN EJECUTIVO

### Brokers Analizados

| # | Broker | Depósito Mínimo | Comisión Acciones | API Python | Recomendación |
|---|--------|-----------------|-------------------|------------|---------------|
| 1 | **Alpaca** | **$0** | **$0** | ✅ Excelente | ⭐⭐⭐⭐⭐ |
| 2 | **Webull** | **$0** | **$0** | ✅ Buena | ⭐⭐⭐⭐ |
| 3 | **Interactive Brokers** | **$0** (cash) | $0.005/share | ✅ Excelente | ⭐⭐⭐⭐⭐ |
| 4 | **Tradier** | **$0** | $0 (Pro plan) | ✅ Buena | ⭐⭐⭐⭐ |
| 5 | **Schwab (ex-TD Ameritrade)** | $0 | $0 | ⚠️ Nueva API | ⭐⭐⭐ |

### Criterios de Evaluación

- ✅ **Depósito mínimo bajo** ($0 preferible)
- ✅ **Comisiones bajas/cero**
- ✅ **API Python oficial**
- ✅ **Documentación completa**
- ✅ **Paper trading gratuito**
- ✅ **Facilidad de integración**

---

## TOP 5 BROKERS RECOMENDADOS

### 1. ALPACA ⭐⭐⭐⭐⭐ (MEJOR OPCIÓN)

**Por qué es #1:**
- API diseñada específicamente para trading algorítmico
- Documentación excelente
- Paper trading ilimitado gratis
- Zero fees, zero minimums
- SDK Python oficial muy maduro

#### Especificaciones

| Característica | Detalle |
|----------------|---------|
| **Depósito mínimo** | **$0** |
| **Comisión acciones** | **$0** |
| **Comisión opciones** | $0.65/contrato |
| **API** | REST + WebSocket |
| **SDK Python** | `alpaca-py` (oficial) |
| **Paper trading** | Gratis ilimitado |
| **Activos** | 1,000+ acciones + ETFs |
| **Fracciones** | Sí (desde $1) |
| **Regulación** | FINRA/SIPC (EE.UU.) |
| **Margin trading** | Sí ($2,000 mínimo) |
| **Market data** | Gratis (15 min delay) o $99/mes real-time |

#### Código de Ejemplo

```python
from alpaca.trading.client import TradingClient
from alpaca.trading.requests import MarketOrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce

trade_client = TradingClient(
    api_key="YOUR_KEY",
    secret_key="YOUR_SECRET",
    paper=True
)

# Comprar $50 de Apple
order_data = MarketOrderRequest(
    symbol="AAPL",
    notional=50.0,
    side=OrderSide.BUY,
    time_in_force=TimeInForce.DAY
)
order = trade_client.submit_order(order_data=order_data)
```

#### Pros y Contras

**✅ Pros:**
- Zero depósito, zero comisión
- API-first design (hecha para bots)
- Documentación excelente
- Paper trading sin restricciones
- Comunidad activa
- Fracciones desde $1

**❌ Contras:**
- Solo acciones y ETFs de EE.UU.
- No trading 24/7 (solo 24/5)
- No acepta crypto directamente
- Market data real-time cuesta $99/mes

#### Integración con Nuestra App

**Dificultad:** Muy Fácil (1-2 días)

**Pasos:**
1. Crear cuenta paper (gratis, 5 min)
2. Instalar `alpaca-py`
3. Adaptar endpoint de señales
4. Testear con paper trading
5. Pasar a live cuando esté listo

---

### 2. WEBULL ⭐⭐⭐⭐

**Por qué es #2:**
- API oficial lanzada en agosto 2026
- Comisión cero en acciones
- SDK Python oficial
- Soporte de AI trading (Model Context Protocol)

#### Especificaciones

| Característica | Detalle |
|----------------|---------|
| **Depósito mínimo** | **$0** |
| **Comisión acciones** | **$0** (US & Hong Kong) |
| **Comisión opciones** | $0 |
| **API** | REST + WebSocket |
| **SDK Python** | Oficial (Python 3.8-3.13) |
| **Paper trading** | Sandbox gratuito |
| **Activos** | US stocks + Hong Kong stocks |
| **Fracciones** | Sí |
| **Regulación** | SEC/FINRA (EE.UU.) |
| **Market data** | Real-time incluido gratis |

#### Características Únicas

- **AI Trading (2026):** Soporta Model Context Protocol para comandos en lenguaje natural
- **Hong Kong Stocks:** Acceso a mercado asiático
- **50+ Skills:** Funciones predefinidas para análisis y trading

#### Código de Ejemplo

```python
# Webull OpenAPI (oficial desde agosto 2026)
from webull import trading_client

client = trading_client.TradingClient(
    app_key="YOUR_APP_KEY",
    app_secret="YOUR_APP_SECRET"
)

# Comprar acciones
order = client.place_order(
    symbol="AAPL",
    side="BUY",
    qty=10,
    order_type="MARKET"
)
```

#### Pros y Contras

**✅ Pros:**
- Comisión $0 en acciones y opciones
- Market data real-time gratis
- API oficial reciente (2026)
- Hong Kong stocks (diversificación asiática)
- AI trading integrado

**❌ Contras:**
- API nueva (menos madura que Alpaca)
- Documentación menos completa
- Comunidad más pequeña
- Ejemplos de código limitados

#### Integración con Nuestra App

**Dificultad:** Fácil-Media (2-3 días)

**Consideraciones:**
- API lanzada recientemente (agosto 2026)
- Puede tener bugs o cambios frecuentes
- Documentación en desarrollo

---

### 3. INTERACTIVE BROKERS (IBKR) ⭐⭐⭐⭐⭐ (MÁS COMPLETO)

**Por qué es #3 (pero el más robusto):**
- API más completa de la industria
- Acceso a 150+ mercados globales
- Ultra-low latency (<50ms)
- Mejor para traders profesionales

#### Especificaciones

| Característica | Detalle |
|----------------|---------|
| **Depósito mínimo** | **$0** (cash), $2,000 (margin) |
| **Comisión acciones** | $0.005/share (mín $1, máx 1%) |
| **Comisión opciones** | $0.65/contrato |
| **API** | TWS API (REST + WebSocket + FIX) |
| **SDK Python** | `ib_insync` (community), `ibapi` (oficial) |
| **Paper trading** | Sí (requiere cuenta real primero) |
| **Activos** | Stocks, opciones, futuros, FX, bonds, crypto |
| **Mercados** | 150+ exchanges en 34 países |
| **Regulación** | SEC/FINRA + múltiples reguladores globales |
| **Market data** | Requiere $500 en cuenta + subscripción |

#### Características Únicas

- **Cobertura global:** NYSE, NASDAQ, LSE, TSE, HKEX, etc.
- **150+ order types:** Bracket, trailing stop, iceberg, etc.
- **Ultra-low latency:** <50ms avg execution
- **Multi-asset:** Stocks, options, futures, FX, bonds, crypto
- **Institucional:** Usado por hedge funds y prop trading firms

#### Código de Ejemplo

```python
from ib_insync import *

ib = IB()
ib.connect('127.0.0.1', 7497, clientId=1)  # TWS debe estar corriendo

# Crear contrato
contract = Stock('AAPL', 'SMART', 'USD')

# Market order
order = MarketOrder('BUY', 10)

# Ejecutar
trade = ib.placeOrder(contract, order)
```

#### Pros y Contras

**✅ Pros:**
- API más completa y madura
- Acceso a mercados globales (150+ exchanges)
- Ultra-low latency
- Multi-asset (stocks, options, futures, FX, crypto)
- Paper trading robusto
- Mejor para trading profesional

**❌ Contras:**
- API compleja (curva de aprendizaje alta)
- Requiere TWS o IB Gateway corriendo localmente
- Market data requiere $500 + subscripción
- Comisiones (aunque bajas)
- Setup más complicado

#### Integración con Nuestra App

**Dificultad:** Media-Alta (5-7 días)

**Requerimientos:**
1. Descargar TWS o IB Gateway
2. Configurar puertos y permisos
3. Aprender estructura de contratos IB
4. Manejar callbacks asíncronos
5. Gestionar conexión local

**Cuándo usar IBKR:**
- Necesitas trading global (Europa, Asia, etc.)
- Quieres futuros o FX
- Trading profesional de alto volumen
- Dispuesto a invertir tiempo en setup

---

### 4. TRADIER ⭐⭐⭐⭐

**Por qué es #4:**
- API moderna cloud-based
- Comisión $0 con plan Pro ($10/mes)
- SDK Python oficial
- Sin depósito mínimo

#### Especificaciones

| Característica | Detalle |
|----------------|---------|
| **Depósito mínimo** | **$0** |
| **Comisión acciones (Free)** | $0.35/trade |
| **Comisión acciones (Pro)** | **$0** ($10/mes) |
| **Comisión opciones (Free)** | $0.35/contrato |
| **Comisión opciones (Pro)** | **$0** ($10/mes) |
| **API** | REST/JSON cloud-based |
| **SDK Python** | Oficial + Node.js |
| **Paper trading** | Sandbox incluido |
| **Activos** | Stocks + opciones |
| **Mercados** | US stocks |

#### Planes de Precios (2026)

| Plan | Costo | Comisión Stocks | Comisión Options |
|------|-------|-----------------|------------------|
| **Lite** | $0/mes | $0.35/trade | $0.35/contrato |
| **Pro** | $10/mes | **$0** | **$0** |
| **Pro Plus** | $35/mes | **$0** + features | **$0** + features |

**Promoción:** 3 meses Pro gratis con depósito de $500 en 30 días.

#### Código de Ejemplo

```python
import requests

# Autenticación
headers = {
    'Authorization': 'Bearer YOUR_ACCESS_TOKEN',
    'Accept': 'application/json'
}

# Market order
order_data = {
    'class': 'equity',
    'symbol': 'AAPL',
    'side': 'buy',
    'quantity': 10,
    'type': 'market',
    'duration': 'day'
}

response = requests.post(
    'https://api.tradier.com/v1/accounts/{account_id}/orders',
    headers=headers,
    data=order_data
)
```

#### Pros y Contras

**✅ Pros:**
- Cloud-based (no software local)
- API moderna REST/JSON
- SDK Python oficial
- Sandbox gratuito
- Comisión $0 con plan Pro ($10/mes)
- Opciones incluidas

**❌ Contras:**
- Comisión $0.35 en plan gratuito
- Plan Pro cuesta $10/mes
- Solo US stocks (no global)
- Menos documentación que Alpaca
- Comunidad más pequeña

#### Integración con Nuestra App

**Dificultad:** Fácil (2-3 días)

**Consideración:** Si haces muchos trades, el plan Pro ($10/mes) se paga solo vs comisiones de $0.35/trade.

**Breakeven:** 29 trades/mes ($10 / $0.35 = 28.5)

---

### 5. SCHWAB (ex-TD AMERITRADE) ⭐⭐⭐

**Por qué es #5:**
- API nueva (Schwab Trader API)
- Comisión $0 en acciones
- Migración desde TD Ameritrade
- Broker tradicional grande

#### Especificaciones

| Característica | Detalle |
|----------------|---------|
| **Depósito mínimo** | $0 |
| **Comisión acciones** | **$0** |
| **Comisión opciones** | $0.65/contrato |
| **API** | Schwab Trader API (nueva) |
| **SDK Python** | Community (`schwabdev`) |
| **Paper trading** | ⚠️ No disponible |
| **Activos** | Stocks, opciones, ETFs |
| **Regulación** | SEC/FINRA |

#### Situación Actual (2026)

**⚠️ IMPORTANTE:**
- TD Ameritrade API fue **descontinuada** después de fusión con Schwab
- Schwab lanzó nueva "Schwab Trader API"
- Registro requiere aprobación individual
- API nueva (menos madura)

#### Código de Ejemplo

```python
# Usando schwabdev (community library)
from schwabdev import client

schwab_client = client.Client(
    app_key='YOUR_APP_KEY',
    app_secret='YOUR_APP_SECRET'
)

# Market order
order = schwab_client.place_order(
    account_id='YOUR_ACCOUNT_ID',
    symbol='AAPL',
    quantity=10,
    side='BUY',
    order_type='MARKET'
)
```

#### Pros y Contras

**✅ Pros:**
- Broker grande y confiable
- Comisión $0 en acciones
- Plataforma thinkorswim (charting)
- Recursos educativos extensos

**❌ Contras:**
- API nueva (lanzada 2025-2026)
- Documentación incompleta
- Requiere aprobación individual para API
- Sin paper trading API
- Thinkorswim sin webhook/API externa
- Migración desde TD Ameritrade no automática
- Community libraries (no SDK oficial Python)

#### Integración con Nuestra App

**Dificultad:** Media-Alta (7-10 días)

**NO RECOMENDADO** para nuevos proyectos porque:
- API muy nueva (bugs potenciales)
- Documentación en desarrollo
- Proceso de aprobación lento
- Mejor esperar 6-12 meses a que madure

---

## COMPARACIÓN DETALLADA

### Tabla Completa de Comparación

| Aspecto | Alpaca | Webull | IBKR | Tradier | Schwab |
|---------|--------|--------|------|---------|--------|
| **Depósito mínimo** | $0 | $0 | $0 | $0 | $0 |
| **Comisión stocks** | $0 | $0 | $0.005/sh | $0.35 (Lite) | $0 |
| **Comisión stocks (plan pago)** | N/A | N/A | N/A | $0 (Pro $10) | N/A |
| **Comisión options** | $0.65 | $0 | $0.65 | $0.35 (Lite) | $0.65 |
| **API Python oficial** | ✅ Sí | ✅ Sí | ⚠️ Community | ✅ Sí | ⚠️ Community |
| **Documentación** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ |
| **Paper trading** | ✅ Gratis | ✅ Sandbox | ✅ Sí | ✅ Sandbox | ❌ No |
| **Fracciones** | ✅ Desde $1 | ✅ Sí | ✅ Sí | ⚠️ Limitado | ✅ Sí |
| **Market data gratis** | ⚠️ 15 min delay | ✅ Real-time | ⚠️ $500+sub | ⚠️ 15 min delay | ✅ Real-time |
| **Activos** | US stocks/ETFs | US + HK stocks | Global multi-asset | US stocks/opts | US stocks/opts |
| **Mercados** | 1 (US) | 2 (US, HK) | 150+ | 1 (US) | 1 (US) |
| **Setup local** | ❌ No | ❌ No | ✅ TWS/Gateway | ❌ No | ❌ No |
| **Madurez API** | ⭐⭐⭐⭐⭐ | ⭐⭐ (nueva) | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ (nueva) |
| **Comunidad** | Grande | Pequeña | Grande | Media | Media |
| **Dificultad integración** | Muy Fácil | Fácil | Media-Alta | Fácil | Media-Alta |
| **Recomendación** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |

---

## ANÁLISIS INDIVIDUAL

### ALPACA - Análisis Detallado

**Mejor para:**
- Beginners en trading algorítmico
- Desarrollo rápido de bots
- Testing sin riesgo (paper trading)
- US stocks/ETFs focus
- Presupuesto limitado ($0 depósito)

**Casos de uso ideales:**
```
✅ Bot de swing trading en acciones US
✅ Estrategia momentum con ETFs
✅ Portfolio diversificado con fracciones
✅ Testing de algoritmos (paper trading)
✅ Integración con señales externas (tu caso)
```

**Timeline de implementación:**
- Día 1: Crear cuenta paper, generar keys
- Día 2: Instalar SDK, código básico
- Día 3-7: Integrar con tu app, testear
- Día 8+: Live trading con capital real

---

### WEBULL - Análisis Detallado

**Mejor para:**
- Traders que quieren market data real-time gratis
- Acceso a Hong Kong stocks (diversificación Asia)
- Early adopters de AI trading
- Comisión $0 en options también

**Casos de uso ideales:**
```
✅ Trading US + Asia
✅ Options strategies comisión $0
✅ AI-assisted trading (Model Context Protocol)
✅ Real-time market data sin pagar extra
```

**Riesgos:**
- API lanzada agosto 2026 (muy nueva)
- Posibles bugs o cambios breaking
- Documentación aún en desarrollo
- Menos ejemplos community

**Recomendación:** Esperar 3-6 meses para que madure, o usar como secundario a Alpaca.

---

### INTERACTIVE BROKERS - Análisis Detallado

**Mejor para:**
- Traders profesionales
- Trading global (Europa, Asia, etc.)
- Multi-asset (stocks, options, futures, FX)
- High frequency trading (latency <50ms)
- Volumen alto

**Casos de uso ideales:**
```
✅ Trading de futuros (ES, NQ, etc.)
✅ FX (EUR/USD, GBP/USD, etc.)
✅ Acciones europeas/asiáticas
✅ Estrategias complejas multi-asset
✅ Arbitraje inter-exchange
```

**Cuándo NO usar:**
- Primer bot (muy complejo para empezar)
- Solo US stocks (overkill)
- No quieres instalar software local
- Presupuesto muy limitado (market data caro)

**Setup requerido:**
1. Descargar TWS o IB Gateway (500MB+)
2. Configurar puertos (7496/7497)
3. Habilitar API en settings
4. Manejar callbacks asíncronos
5. Entender estructura de contratos IB

**Timeline:** 5-7 días para setup inicial completo

---

### TRADIER - Análisis Detallado

**Mejor para:**
- Traders de opciones
- Budget conscious (plan Pro $10/mes)
- Cloud-native (sin software local)
- API moderna REST/JSON

**Casos de uso ideales:**
```
✅ Options strategies automatizadas
✅ Budget: >29 trades/mes (plan Pro se paga solo)
✅ Preferencia por API REST simple
```

**Cálculo de costos:**

**Plan Lite (Free):**
```
100 trades/mes × $0.35 = $35/mes en comisiones
```

**Plan Pro ($10/mes):**
```
100 trades/mes × $0 = $0 + $10 = $10/mes total
Ahorro: $25/mes
```

**Breakeven:** 29 trades/mes

**Recomendación:** Si haces >30 trades/mes → Plan Pro. Si <30 trades/mes → Alpaca (gratis total).

---

### SCHWAB - Análisis Detallado

**Mejor para:**
- Usuarios legacy de TD Ameritrade
- Largo plazo (esperar a que API madure)
- No necesitas API inmediatamente

**Situación actual:**
```
TD Ameritrade API: ❌ Descontinuada (fusión con Schwab)
Schwab Trader API: ⚠️ Nueva (2025-2026)
Thinkorswim API: ❌ No disponible (sin webhook)
```

**NO RECOMENDADO** para:
- Nuevos proyectos de trading algorítmico
- Necesitas API estable YA
- Quieres paper trading

**Recomendación:** Esperar hasta 2027 cuando API esté madura.

---

## CONCLUSIONES Y RECOMENDACIONES

### Para Tu Caso Específico

**Contexto:**
- Tienes bot funcionando con Bybit
- Quieres expandir a US stocks
- Integración con señales existentes
- Presupuesto variable

### Estrategia Recomendada: Multi-Broker

#### Fase 1: Implementación Inmediata (Semana 1-2)

**ALPACA como primario:**
```
✅ Crear cuenta paper (gratis, hoy)
✅ Instalar alpaca-py
✅ Adaptar endpoint de señales
✅ Testear con $100k virtuales
✅ Validar integración completa
```

**Razón:** Zero risk, zero cost, documentación excelente.

#### Fase 2: Producción (Semana 3-4)

**ALPACA live trading:**
```
✅ Abrir cuenta real
✅ Depositar $100-500 inicial
✅ Ejecutar con capital real
✅ Monitorear performance
```

#### Fase 3: Expansión (Mes 2-3)

**Agregar WEBULL como secundario:**
```
✅ API nueva pero prometedora
✅ Hong Kong stocks (diversificación)
✅ Market data real-time gratis
✅ Comisión $0 en options
```

**O TRADIER si haces >30 trades/mes:**
```
✅ Plan Pro $10/mes
✅ Comisión $0 ilimitada
✅ Break-even en 29 trades
```

#### Fase 4: Professional (Mes 6+)

**IBKR si necesitas:**
```
✅ Trading global (Europa, Asia)
✅ Futuros (ES, NQ, etc.)
✅ FX
✅ Ultra-low latency
```

### Comparación de Costos (100 trades/mes)

| Broker | Setup | Comisiones | Market Data | Total/Mes |
|--------|-------|------------|-------------|-----------|
| **Alpaca** | $0 | $0 | $0 (delay) | **$0** ✅ |
| **Alpaca + Real-time data** | $0 | $0 | $99 | $99 |
| **Webull** | $0 | $0 | $0 (real-time) | **$0** ✅ |
| **Tradier Lite** | $0 | $35 ($0.35×100) | $0 | $35 |
| **Tradier Pro** | $10 | $0 | $0 | **$10** ✅ |
| **IBKR** | $0 | $50 ($0.005×100×100sh) | $10-50 | $60-100 |
| **Schwab** | $0 | $0 | $0 | **$0** (API inmadura) |

**Ganador costo:** Alpaca o Webull ($0 total)

### Recomendación Final

**Para empezar HOY:**
1. **Alpaca** (primario) - Paper trading gratis
2. Testear 1-2 semanas
3. Pasar a live con $100-500

**Para expansión (1-3 meses):**
1. Mantener Alpaca como base
2. Agregar **Webull** (market data real-time gratis)
3. O **Tradier Pro** si >30 trades/mes

**Para profesional (6+ meses):**
1. Agregar **IBKR** si necesitas global/multi-asset
2. Mantener Alpaca para US stocks simple

### Código de Integración Sugerido

```python
"""
Multi-Broker Manager
Ejecuta señales en broker apropiado según símbolo
"""

class MultiBrokerManager:
    def __init__(self):
        self.alpaca = AlpacaClient()      # US stocks primario
        self.webull = WebullClient()      # Hong Kong stocks
        self.ibkr = IBKRClient()          # Futuros, FX, global

    def execute_signal(self, symbol, signal, amount):
        # Routing logic
        if symbol.endswith("XUSDT"):
            # xStock en Bybit
            return self.bybit.execute(symbol, signal, amount)

        elif self._is_us_stock(symbol):
            # US stock → Alpaca
            return self.alpaca.execute(symbol, signal, amount)

        elif self._is_hk_stock(symbol):
            # Hong Kong → Webull
            return self.webull.execute(symbol, signal, amount)

        elif self._is_future(symbol):
            # Futures → IBKR
            return self.ibkr.execute(symbol, signal, amount)

    def _is_us_stock(self, symbol):
        # Simple check - US stocks son symbols cortos
        return len(symbol) <= 5 and symbol.isalpha()
```

---

## TABLA DE DECISIÓN RÁPIDA

| Si necesitas... | Usa... |
|----------------|--------|
| **Empezar gratis HOY** | Alpaca paper trading |
| **US stocks comisión $0** | Alpaca o Webull |
| **Market data real-time gratis** | Webull |
| **Paper trading robusto** | Alpaca |
| **Hong Kong stocks** | Webull |
| **Trading global (Europa, Asia)** | Interactive Brokers |
| **Futuros (ES, NQ, etc.)** | Interactive Brokers |
| **FX trading** | Interactive Brokers |
| **Options $0 comisión** | Webull o Tradier Pro |
| **>30 trades/mes** | Tradier Pro ($10/mes) |
| **<30 trades/mes** | Alpaca (gratis total) |
| **AI trading** | Webull (Model Context Protocol) |
| **Ultra-low latency** | Interactive Brokers (<50ms) |
| **Setup más simple** | Alpaca |
| **Mejor documentación** | Alpaca o IBKR |
| **Comunidad más grande** | Alpaca o IBKR |

---

**Documento generado:** 15 de octubre de 2026
**Última actualización:** 15 de octubre de 2026
**Autor:** Claude Code
**Versión:** 1.0
