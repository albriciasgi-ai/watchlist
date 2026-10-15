# GUÍA COMPLETA: ALPACA TRADING API

**Fecha:** 15 de octubre de 2026
**Versión:** 1.0

---

## TABLA DE CONTENIDOS

1. [Resumen Ejecutivo](#resumen-ejecutivo)
2. [¿Qué es Alpaca?](#qué-es-alpaca)
3. [Requisitos de Depósito](#requisitos-de-depósito)
4. [Proceso de Apertura de Cuenta](#proceso-de-apertura-de-cuenta)
5. [Configuración de API](#configuración-de-api)
6. [Tipos de Órdenes](#tipos-de-órdenes)
7. [Gestión de Posiciones](#gestión-de-posiciones)
8. [Costos y Fees](#costos-y-fees)
9. [Comparación: Alpaca vs Bybit xStocks](#comparación-alpaca-vs-bybit-xstocks)
10. [Código de Ejemplo Completo](#código-de-ejemplo-completo)
11. [Troubleshooting](#troubleshooting)
12. [Recursos Adicionales](#recursos-adicionales)

---

## RESUMEN EJECUTIVO

### Características Principales

| Característica | Detalle |
|----------------|---------|
| **Regulación** | FINRA/SIPC (EE.UU.) |
| **Depósito mínimo** | **$0 USD** |
| **Comisión acciones/ETFs** | **$0** |
| **Activos disponibles** | **1,000+ acciones y ETFs de EE.UU.** |
| **Fracciones** | Desde $1 USD |
| **Trading 24/5** | Pre-market + Regular + After-hours |
| **Paper Trading** | Gratis ilimitado |
| **API** | REST + WebSocket completamente documentada |
| **SDK Python** | `alpaca-py` oficial |
| **Tiempo de apertura** | 1 día hábil (KYC) |
| **Métodos de depósito** | ACH ($0 fee), Wire ($25 salida) |

### Ventajas Clave

✅ **Sin depósito mínimo** - Comienza con $1
✅ **Comisión cero** - No pagas por trades
✅ **Paper trading gratis** - Testea sin riesgo
✅ **API moderna** - Documentación excelente
✅ **Fracciones** - Diversifica con poco capital
✅ **24/5 trading** - Pre-market y after-hours incluidos

### Desventajas

❌ **Solo fiat USD** - No acepta crypto directamente
❌ **No trading 24/7** - Cierra fines de semana
❌ **Margin requiere $2,000** - Para SHORT selling
❌ **Solo EE.UU.** - Acciones y ETFs estadounidenses únicamente

---

## ¿QUÉ ES ALPACA?

Alpaca Securities LLC es un broker-dealer regulado en Estados Unidos que ofrece:

- **Trading API-first**: Diseñado específicamente para trading algorítmico
- **Custodia regulada**: Miembro FINRA/SIPC
- **Infraestructura moderna**: REST API + WebSocket en tiempo real
- **Acciones reales**: No derivados ni productos sintéticos

### Historia Reciente

| Fecha | Evento |
|-------|--------|
| **Antes 2024** | Requería $30,000 depósito mínimo |
| **2024-2026** | Eliminó depósito mínimo → $0 |
| **Octubre 2026** | Bybit integra Alpaca para Stocks Trading (1,000+ activos) |

### Arquitectura de Trading

```
Usuario → Alpaca API (REST/WebSocket)
    ↓
Alpaca Securities LLC (Broker-Dealer)
    ↓
Mercado de Valores EE.UU. (NYSE, NASDAQ)
    ↓
Custodia regulada (FINRA/SIPC)
```

---

## REQUISITOS DE DEPÓSITO

### Por Tipo de Cuenta

| Tipo de Cuenta | Depósito Mínimo | Propósito |
|----------------|-----------------|-----------|
| **Individual Cash** | **$0** | Trading normal (LONG only) |
| **Individual Margin** | **$2,000** | SHORT selling, apalancamiento |
| **Business (Beta)** | **$30,000** | Empresas |
| **Paper Trading** | **$0** | Simulador (fondos virtuales) |

### Regulaciones FINRA

**Para Margin Trading:**
- Depósito inicial mínimo: **$2,000 USD**
- Pattern Day Trading (PDT): **$25,000 USD** si haces 4+ day trades en 5 días
- Margin rate: **6.5% anual**

### Lo Que Significa en la Práctica

#### Cuenta Cash ($0 mínimo)
```
✅ Puedes depositar: $1, $10, $50, $100...
✅ Primer trade mínimo: $1 USD
✅ Fracciones: Sí
❌ SHORT selling: No
❌ Apalancamiento: No
```

#### Cuenta Margin ($2,000 mínimo)
```
✅ Todo lo de cuenta Cash
✅ SHORT selling: Sí
✅ Apalancamiento: Sí (hasta 2x intraday, 1x overnight)
⚠️ Margin call: Si saldo < $2,000
```

---

## PROCESO DE APERTURA DE CUENTA

### Timeline Completo

| Fase | Duración | Acción Requerida |
|------|----------|------------------|
| **Registro** | 5-10 minutos | Formulario online |
| **KYC** | 1 día hábil | Subir documentos |
| **Aprobación** | Automática | Esperar email |
| **Depósito ACH** | 3-5 días hábiles | Transferencia bancaria |
| **Listo para operar** | **~4-6 días totales** | - |

### Paso 1: Registro

**URL:** https://app.alpaca.markets/signup

**Información Requerida:**
1. Nombre completo
2. Email
3. Número de teléfono
4. Dirección residencial
5. SSN o ITIN (EE.UU.) / Pasaporte (Internacional)
6. Fecha de nacimiento
7. Información de empleo
8. Experiencia de inversión

### Paso 2: Verificación KYC

**Documentos Necesarios:**

**Para residentes EE.UU.:**
- Driver's License o State ID
- SSN (Social Security Number)

**Para no residentes:**
- Pasaporte válido
- Comprobante de domicilio (factura servicios < 3 meses)

**Proceso:**
1. Subir fotos de documentos
2. Verificación automática (1 día hábil)
3. Email de confirmación

### Paso 3: Generar API Keys

**Una vez aprobada la cuenta:**

1. Login en: https://app.alpaca.markets
2. Navegar a sección "Home"
3. Click "Generate API Key"
4. Elegir:
   - **Paper Trading** (simulado, fondos virtuales)
   - **Live Trading** (real, dinero real)

**IMPORTANTE:**
- El Secret Key solo se muestra UNA vez
- Guárdalo en lugar seguro (password manager)
- Nunca lo compartas ni lo subas a GitHub

**Ejemplo de Keys:**
```
API Key:     PKXXXXXXXXXXXXXXXXXXXXXXXX
Secret Key:  XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### Paso 4: Depositar Fondos (Opcional)

**Métodos de Depósito:**

| Método | Tiempo | Fee | Disponibilidad |
|--------|--------|-----|----------------|
| **ACH** | 3-5 días | $0 | ✅ EE.UU. |
| **Wire** | 1 día | $0 entrada / $25 salida | ✅ EE.UU. |
| **International Wire** | 1-2 días | $0 entrada / $50 salida | ✅ Internacional |

**Proceso ACH:**
1. Link cuenta bancaria en Alpaca
2. Iniciar transferencia ACH
3. Micro-depósitos de verificación (2 depósitos < $1)
4. Confirmar montos
5. Esperar 3-5 días hábiles
6. Fondos disponibles

**NOTA:** Paper trading NO requiere depósito (fondos virtuales incluidos).

---

## CONFIGURACIÓN DE API

### Instalación del SDK

```bash
# Instalar alpaca-py
pip install alpaca-py

# Dependencias adicionales
pip install python-dotenv
```

### Configurar Variables de Entorno

**Crear archivo `.env`:**
```bash
# .env
ALPACA_API_KEY=PKXXXXXXXXXXXXXXXXXXXXXXXX
ALPACA_SECRET_KEY=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

**Agregar `.env` al `.gitignore`:**
```bash
# .gitignore
.env
```

### Código de Conexión Básico

```python
import os
from dotenv import load_dotenv
from alpaca.trading.client import TradingClient

# Cargar variables de entorno
load_dotenv()

# Obtener API keys
ALPACA_API_KEY = os.environ.get("ALPACA_API_KEY")
ALPACA_SECRET_KEY = os.environ.get("ALPACA_SECRET_KEY")

# Crear cliente de trading
trade_client = TradingClient(
    api_key=ALPACA_API_KEY,
    secret_key=ALPACA_SECRET_KEY,
    paper=True  # True = Paper Trading, False = Live Trading
)

# Verificar conexión
account = trade_client.get_account()
print(f"✅ Conectado exitosamente")
print(f"Account ID: {account.account_number}")
print(f"Buying Power: ${account.buying_power}")
print(f"Cash: ${account.cash}")
print(f"Portfolio Value: ${account.portfolio_value}")
```

### URLs Base

| Entorno | Base URL | WebSocket URL |
|---------|----------|---------------|
| **Paper** | `https://paper-api.alpaca.markets` | `wss://paper-api.alpaca.markets/stream` |
| **Live** | `https://api.alpaca.markets` | `wss://api.alpaca.markets/stream` |

**NOTA:** El SDK maneja las URLs automáticamente según el parámetro `paper`.

---

## TIPOS DE ÓRDENES

### 1. Market Order (Orden a Mercado)

**Descripción:** Ejecuta inmediatamente al mejor precio disponible.

```python
from alpaca.trading.requests import MarketOrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce

def buy_market(symbol: str, qty: float):
    """Compra acciones a precio de mercado"""
    order_data = MarketOrderRequest(
        symbol=symbol,
        qty=qty,  # Puede ser fracción: 0.5, 1.25, etc.
        side=OrderSide.BUY,
        time_in_force=TimeInForce.DAY
    )
    order = trade_client.submit_order(order_data=order_data)
    return order

# Ejemplo: Comprar 0.5 acciones de Apple
order = buy_market("AAPL", 0.5)
print(f"Order ID: {order.id}")
print(f"Status: {order.status}")
```

### 2. Notional Order (Orden por Monto en Dólares)

**Descripción:** Compra acciones por valor en USD (mínimo $1).

```python
from alpaca.trading.requests import MarketOrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce

def buy_notional(symbol: str, usd_amount: float):
    """Compra acciones por valor en dólares"""
    order_data = MarketOrderRequest(
        symbol=symbol,
        notional=usd_amount,  # Mínimo $1.00
        side=OrderSide.BUY,
        time_in_force=TimeInForce.DAY
    )
    order = trade_client.submit_order(order_data=order_data)
    return order

# Ejemplo: Comprar $50 de Tesla
order = buy_notional("TSLA", 50.0)
```

**Ventaja:** Ideal para diversificación con capital limitado.

**Ejemplo con $100:**
```python
portfolio = [
    ("AAPL", 20),   # $20 Apple
    ("NVDA", 20),   # $20 NVIDIA
    ("MSFT", 20),   # $20 Microsoft
    ("GOOGL", 20),  # $20 Google
    ("TSLA", 20),   # $20 Tesla
]

for symbol, amount in portfolio:
    buy_notional(symbol, amount)

# Resultado: 5 posiciones fraccionadas con solo $100
```

### 3. Limit Order (Orden Limitada)

**Descripción:** Ejecuta solo si el precio es favorable (≤ limit para compra, ≥ limit para venta).

```python
from alpaca.trading.requests import LimitOrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce

def buy_limit(symbol: str, qty: float, limit_price: float):
    """Compra solo si el precio es <= limit_price"""
    order_data = LimitOrderRequest(
        symbol=symbol,
        qty=qty,
        side=OrderSide.BUY,
        time_in_force=TimeInForce.GTC,  # Good Till Cancelled
        limit_price=limit_price
    )
    order = trade_client.submit_order(order_data=order_data)
    return order

# Ejemplo: Comprar NVDA solo si baja a $800
order = buy_limit("NVDA", 1.0, 800.0)
```

**TimeInForce Options:**
- `DAY`: Válida solo hoy
- `GTC`: Válida hasta cancelar (max 90 días)
- `IOC`: Immediate or Cancel
- `FOK`: Fill or Kill

### 4. Stop Order (Orden Stop)

**Descripción:** Se convierte en market order cuando el precio alcanza el stop.

```python
from alpaca.trading.requests import StopOrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce

def sell_stop(symbol: str, qty: float, stop_price: float):
    """Vende cuando el precio cae a stop_price (Stop Loss)"""
    order_data = StopOrderRequest(
        symbol=symbol,
        qty=qty,
        side=OrderSide.SELL,
        time_in_force=TimeInForce.GTC,
        stop_price=stop_price
    )
    order = trade_client.submit_order(order_data=order_data)
    return order

# Ejemplo: Stop Loss en AAPL a $180
order = sell_stop("AAPL", 1.0, 180.0)
```

### 5. Bracket Order (Orden con TP/SL Integrado)

**Descripción:** Compra con Take Profit y Stop Loss automáticos.

```python
from alpaca.trading.requests import OrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce, OrderClass

def buy_bracket(symbol: str, qty: float, take_profit_price: float, stop_loss_price: float):
    """Compra con Take Profit y Stop Loss automáticos"""
    order_data = OrderRequest(
        symbol=symbol,
        qty=qty,
        side=OrderSide.BUY,
        type="market",
        time_in_force=TimeInForce.GTC,
        order_class=OrderClass.BRACKET,
        take_profit={"limit_price": take_profit_price},
        stop_loss={"stop_price": stop_loss_price}
    )
    order = trade_client.submit_order(order_data=order_data)
    return order

# Ejemplo: Comprar AAPL con TP=$200 y SL=$180
order = buy_bracket("AAPL", 1.0, take_profit_price=200.0, stop_loss_price=180.0)
```

**Ventaja:** Gestión de riesgo automática, no requieres monitorear.

### 6. Trailing Stop Order

**Descripción:** Stop Loss que sigue el precio si sube (para proteger ganancias).

```python
from alpaca.trading.requests import TrailingStopOrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce

def sell_trailing_stop(symbol: str, qty: float, trail_percent: float):
    """Stop Loss que sigue el precio al alza"""
    order_data = TrailingStopOrderRequest(
        symbol=symbol,
        qty=qty,
        side=OrderSide.SELL,
        time_in_force=TimeInForce.GTC,
        trail_percent=trail_percent  # Ej: 5.0 = 5%
    )
    order = trade_client.submit_order(order_data=order_data)
    return order

# Ejemplo: Trailing stop 5% (vende si cae 5% desde el máximo)
order = sell_trailing_stop("NVDA", 1.0, 5.0)
```

---

## GESTIÓN DE POSICIONES

### Verificar Posición Abierta

```python
def get_position(symbol: str):
    """Obtiene posición abierta, retorna None si no existe"""
    try:
        position = trade_client.get_open_position(symbol)
        return position
    except Exception as e:
        if "does not exist" in str(e).lower():
            return None
        raise

# Ejemplo
position = get_position("AAPL")
if position:
    print(f"Symbol: {position.symbol}")
    print(f"Quantity: {position.qty}")
    print(f"Avg Entry Price: ${position.avg_entry_price}")
    print(f"Current Price: ${position.current_price}")
    print(f"Market Value: ${position.market_value}")
    print(f"Unrealized P&L: ${position.unrealized_pl}")
    print(f"Unrealized P&L %: {position.unrealized_plpc}%")
    print(f"Cost Basis: ${position.cost_basis}")
else:
    print("No hay posición abierta")
```

### Cerrar Posición Completamente

```python
def close_position(symbol: str):
    """Cierra completamente la posición"""
    try:
        trade_client.close_position(symbol)
        print(f"✅ Posición {symbol} cerrada")
        return True
    except Exception as e:
        print(f"❌ Error cerrando posición: {e}")
        return False

# Ejemplo
close_position("AAPL")
```

### Cerrar Posición Parcialmente

```python
from alpaca.trading.requests import MarketOrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce

def close_position_partial(symbol: str, qty_to_sell: float):
    """Cierra parcialmente la posición"""
    order_data = MarketOrderRequest(
        symbol=symbol,
        qty=qty_to_sell,
        side=OrderSide.SELL,
        time_in_force=TimeInForce.DAY
    )
    order = trade_client.submit_order(order_data=order_data)
    return order

# Ejemplo: Vender 0.5 de 1.0 acciones de AAPL
order = close_position_partial("AAPL", 0.5)
```

### Obtener Todas las Posiciones

```python
positions = trade_client.get_all_positions()

for pos in positions:
    print(f"{pos.symbol}: {pos.qty} shares")
    print(f"  Entry: ${pos.avg_entry_price}")
    print(f"  Current: ${pos.current_price}")
    print(f"  P&L: ${pos.unrealized_pl} ({pos.unrealized_plpc}%)")
    print()
```

### Calcular Métricas de Portfolio

```python
def get_portfolio_summary():
    """Obtiene resumen completo del portfolio"""
    account = trade_client.get_account()
    positions = trade_client.get_all_positions()

    summary = {
        "cash": float(account.cash),
        "portfolio_value": float(account.portfolio_value),
        "buying_power": float(account.buying_power),
        "equity": float(account.equity),
        "total_positions": len(positions),
        "total_unrealized_pl": sum(float(p.unrealized_pl) for p in positions),
        "total_unrealized_plpc": (sum(float(p.unrealized_pl) for p in positions) / float(account.portfolio_value)) * 100,
    }

    return summary

# Ejemplo
summary = get_portfolio_summary()
print(f"Portfolio Value: ${summary['portfolio_value']:.2f}")
print(f"Cash: ${summary['cash']:.2f}")
print(f"Total Positions: {summary['total_positions']}")
print(f"Unrealized P&L: ${summary['total_unrealized_pl']:.2f} ({summary['total_unrealized_plpc']:.2f}%)")
```

---

## VERIFICACIÓN DE ÓRDENES

### Obtener Orden por ID

```python
order = trade_client.get_order_by_id(order_id="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")

print(f"Order ID: {order.id}")
print(f"Symbol: {order.symbol}")
print(f"Side: {order.side}")
print(f"Status: {order.status}")
print(f"Filled Qty: {order.filled_qty}")
print(f"Filled Avg Price: ${order.filled_avg_price}")
print(f"Created At: {order.created_at}")
```

**Status posibles:**
- `new`: Orden aceptada pero no ejecutada
- `partially_filled`: Parcialmente ejecutada
- `filled`: Completamente ejecutada
- `canceled`: Cancelada
- `rejected`: Rechazada

### Listar Órdenes Abiertas

```python
from alpaca.trading.requests import GetOrdersRequest
from alpaca.trading.enums import QueryOrderStatus

orders = trade_client.get_orders(
    filter=GetOrdersRequest(status=QueryOrderStatus.OPEN)
)

for order in orders:
    print(f"{order.symbol}: {order.side} {order.qty} @ {order.limit_price or 'market'}")
    print(f"  Status: {order.status}")
    print(f"  Created: {order.created_at}")
    print()
```

### Listar Órdenes Cerradas (Historial)

```python
from alpaca.trading.requests import GetOrdersRequest
from alpaca.trading.enums import QueryOrderStatus

orders = trade_client.get_orders(
    filter=GetOrdersRequest(
        status=QueryOrderStatus.CLOSED,
        limit=100  # Últimas 100 órdenes
    )
)

for order in orders:
    print(f"{order.symbol}: {order.side} {order.qty}")
    print(f"  Status: {order.status}")
    print(f"  Filled: {order.filled_qty} @ ${order.filled_avg_price}")
    print()
```

### Cancelar Orden

```python
# Cancelar por ID
trade_client.cancel_order_by_id(order_id="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx")

# Cancelar todas las órdenes abiertas
trade_client.cancel_orders()
```

---

## COSTOS Y FEES (2026)

### Tabla de Costos

| Concepto | Costo |
|----------|-------|
| **Comisión acciones** | **$0** ✅ |
| **Comisión ETFs** | **$0** ✅ |
| **Comisión opciones** | $0.65 por contrato |
| **Orden mínima** | $1 USD (notional) |
| **Regulatory fees (SEC)** | $22.90 por $1,000,000 en ventas |
| **FINRA TAF** | $0.000119 por acción vendida |
| **Inactividad** | **$0** ✅ |
| **Mantenimiento cuenta** | **$0** ✅ |
| **ACH deposit** | **$0** ✅ |
| **ACH withdrawal** | **$0** ✅ |
| **Wire deposit** | **$0** ✅ |
| **Wire withdrawal (doméstico)** | $25 |
| **Wire withdrawal (internacional)** | $50 |
| **Margin rate** | 6.5% anual |
| **Market data (gratis)** | 15 min delay ✅ |
| **Market data (real-time)** | $99/mes (Algo Trader Plus) |

### Ejemplo de Costos Reales

**Escenario:** Comprar $100 de AAPL y vender después de ganar 10%

```
Compra:
- Inversión: $100.00
- Comisión: $0.00 ✅
- Regulatory fees: $0.00 (solo en ventas)
Total invertido: $100.00

Venta (después de +10%):
- Valor de venta: $110.00
- Comisión: $0.00 ✅
- SEC fee: $0.00252 ($22.90 por $1M → $110 * 0.00002290)
- FINRA TAF: ~$0.00001 (despreciable)
Total fees: ~$0.03

Ganancia neta: $110.00 - $100.00 - $0.03 = $9.97
ROI: 9.97%
```

**Conclusión:** Fees regulatorios son **despreciables** para trades pequeños.

---

## COMPARACIÓN: ALPACA VS BYBIT xSTOCKS

### Tabla Comparativa

| Aspecto | **Alpaca** | **Bybit xStocks** |
|---------|-----------|-------------------|
| **Activos** | 1,000+ acciones + ETFs | 5 xStocks |
| **Depósito mínimo** | **$0 USD** | **$0 USDC** |
| **Primer trade mínimo** | $1 USD | ~$5 USDC |
| **Comisión** | $0 | Desconocido |
| **Moneda** | USD (fiat) | USDC (stablecoin) |
| **Funding** | ACH desde banco | Crypto deposit |
| **Fracciones** | Sí (6 decimales) | Sí (tokenización) |
| **Trading 24/7** | No (24/5) | Sí |
| **Weekends** | Cerrado | Abierto |
| **Paper trading** | ✅ Gratis | ❌ No disponible |
| **Dividendos** | ✅ Sí | ❌ No |
| **SHORT** | Sí (con $2,000 margin) | 3/5 permiten |
| **API** | Documentada ✅ | Documentada ✅ |
| **Regulación** | FINRA/SIPC (EE.UU.) | N/A (tokenizado) |
| **KYC** | Obligatorio | Obligatorio |
| **Custodia** | Alpaca Securities (regulada) | Blockchain Solana |
| **Tipo de activo** | Acciones reales | Tokens sintéticos |
| **Tiempo apertura** | 1-6 días | Inmediato (si ya tienes cuenta) |

### ¿Cuándo Usar Alpaca?

✅ **Mejor para:**
- Diversificación extrema (1,000+ opciones)
- Dividendos reales
- ETFs (no disponibles en xStocks)
- Trading tradicional regulado
- Paper trading para testeo

❌ **No usar si:**
- Quieres trading 24/7 sin parar
- Solo tienes crypto (sin cuenta bancaria USD)
- Necesitas liquidez inmediata (fines de semana)

### ¿Cuándo Usar xStocks?

✅ **Mejor para:**
- Trading 24/7 (weekends incluidos)
- Ya tienes USDC en Bybit
- Necesitas liquidez inmediata
- Integración con tu bot actual (ya configurado)

❌ **No usar si:**
- Quieres más de 5 activos
- Necesitas dividendos
- Quieres ETFs

### Estrategia Híbrida Recomendada

**Opción ideal: Usar AMBOS**

```
Bybit xStocks (5 activos)
  → Trading 24/7 automatizado
  → Capitalizar oportunidades inmediatas
  → AAPL, NVDA, META, GOOGL, MCD

Alpaca (1,000+ activos)
  → Diversificación amplia
  → ETFs (QQQ, SPY, VOO, etc.)
  → Dividendos
  → Trading horario regular
```

---

## CÓDIGO DE EJEMPLO COMPLETO

### Bot de Trading Simple con Alpaca

```python
"""
Bot de Trading Simple con Alpaca API
Estrategia: Ejecución de señales externas
"""

import os
from dotenv import load_dotenv
from alpaca.trading.client import TradingClient
from alpaca.trading.requests import MarketOrderRequest, OrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce, OrderClass

# Configuración
load_dotenv()

trade_client = TradingClient(
    api_key=os.environ.get("ALPACA_API_KEY"),
    secret_key=os.environ.get("ALPACA_SECRET_KEY"),
    paper=True  # Cambiar a False para live trading
)

def get_position(symbol: str):
    """Verifica si hay posición abierta"""
    try:
        position = trade_client.get_open_position(symbol)
        return position
    except:
        return None

def execute_signal(symbol: str, signal: str, usd_amount: float = 100.0,
                   tp_percent: float = 2.0, sl_percent: float = 1.0):
    """
    Ejecuta señal de trading

    Args:
        symbol: Símbolo de acción (ej: "AAPL")
        signal: "BUY", "SELL", o "CLOSE"
        usd_amount: Cantidad en USD a invertir (para BUY)
        tp_percent: Take Profit % (default 2%)
        sl_percent: Stop Loss % (default 1%)
    """

    # Verificar posición existente
    position = get_position(symbol)
    has_position = position is not None

    if signal == "BUY" and not has_position:
        # Comprar con TP/SL integrado

        # Obtener precio actual aproximado
        # (En producción, usa Market Data API para precio exacto)
        try:
            # Simple market order para obtener precio
            test_order = MarketOrderRequest(
                symbol=symbol,
                notional=usd_amount,
                side=OrderSide.BUY,
                time_in_force=TimeInForce.DAY
            )
            order = trade_client.submit_order(order_data=test_order)

            # Esperar fill para obtener precio de entrada
            import time
            time.sleep(2)
            filled_order = trade_client.get_order_by_id(order.id)
            entry_price = float(filled_order.filled_avg_price)
            qty = float(filled_order.filled_qty)

            # Calcular TP/SL
            tp_price = round(entry_price * (1 + tp_percent / 100), 2)
            sl_price = round(entry_price * (1 - sl_percent / 100), 2)

            # Colocar órdenes TP/SL
            # Take Profit (Limit)
            tp_order_data = OrderRequest(
                symbol=symbol,
                qty=qty,
                side=OrderSide.SELL,
                type="limit",
                time_in_force=TimeInForce.GTC,
                limit_price=tp_price
            )
            tp_order = trade_client.submit_order(order_data=tp_order_data)

            # Stop Loss (Stop)
            from alpaca.trading.requests import StopOrderRequest
            sl_order_data = StopOrderRequest(
                symbol=symbol,
                qty=qty,
                side=OrderSide.SELL,
                time_in_force=TimeInForce.GTC,
                stop_price=sl_price
            )
            sl_order = trade_client.submit_order(order_data=sl_order_data)

            print(f"✅ BUY ejecutado: {symbol}")
            print(f"   Cantidad: {qty} acciones")
            print(f"   Entry: ${entry_price}")
            print(f"   TP: ${tp_price} (+{tp_percent}%)")
            print(f"   SL: ${sl_price} (-{sl_percent}%)")

            return {
                "status": "success",
                "action": "BUY",
                "symbol": symbol,
                "qty": qty,
                "entry_price": entry_price,
                "tp_price": tp_price,
                "sl_price": sl_price,
                "order_id": order.id
            }

        except Exception as e:
            print(f"❌ Error ejecutando BUY: {e}")
            return {"status": "error", "message": str(e)}

    elif signal == "SELL" and has_position:
        # Cerrar posición
        try:
            trade_client.close_position(symbol)
            print(f"✅ SELL ejecutado: {symbol} (cerrada posición de {position.qty} acciones)")

            return {
                "status": "success",
                "action": "SELL",
                "symbol": symbol,
                "qty": float(position.qty),
                "exit_price": float(position.current_price)
            }
        except Exception as e:
            print(f"❌ Error ejecutando SELL: {e}")
            return {"status": "error", "message": str(e)}

    elif signal == "CLOSE" and has_position:
        # Igual que SELL (cerrar posición)
        return execute_signal(symbol, "SELL")

    else:
        # No acción necesaria
        reason = f"{signal} signal pero posición = {has_position}"
        print(f"⚠️ No acción: {reason}")
        return {"status": "skipped", "reason": reason}

# Ejemplo de uso con señales externas
if __name__ == "__main__":
    # Simular señales de tu sistema de análisis
    signals = [
        {"symbol": "AAPL", "signal": "BUY", "amount": 50},
        {"symbol": "NVDA", "signal": "BUY", "amount": 50},
    ]

    for sig in signals:
        result = execute_signal(
            symbol=sig["symbol"],
            signal=sig["signal"],
            usd_amount=sig["amount"],
            tp_percent=2.0,  # TP a +2%
            sl_percent=1.0   # SL a -1%
        )
        print(f"Resultado: {result}")
        print()
```

### Integración con Tu Bot Actual

```python
"""
Integración Alpaca con tu Bot de Bybit
Recibe señales del Swing Detector y ejecuta en Alpaca
"""

from fastapi import FastAPI
from alpaca.trading.client import TradingClient

app = FastAPI()

# Cliente Alpaca
alpaca_client = TradingClient(
    api_key=os.environ.get("ALPACA_API_KEY"),
    secret_key=os.environ.get("ALPACA_SECRET_KEY"),
    paper=False  # Live trading
)

# Mapeo de símbolos Bybit → Alpaca
SYMBOL_MAP = {
    "BTCUSDT": None,      # No disponible en Alpaca
    "ETHUSDT": None,      # No disponible en Alpaca
    "AAPLXUSDT": "AAPL",  # xStock → Acción real
    "NVDAXUSDT": "NVDA",
    "METAXUSDT": "META",
    "GOOGLXUSDT": "GOOGL",
    "MCDXUSDT": "MCD",
}

@app.post("/api/alpaca/signal")
async def receive_signal(signal_data: dict):
    """
    Recibe señal del Swing Detector y ejecuta en Alpaca

    Formato esperado:
    {
        "symbol": "AAPLXUSDT",
        "direction": "LONG",
        "price": 195.50,
        "source": "SWING_DETECTOR"
    }
    """

    bybit_symbol = signal_data.get("symbol")
    direction = signal_data.get("direction")

    # Mapear símbolo
    alpaca_symbol = SYMBOL_MAP.get(bybit_symbol)

    if not alpaca_symbol:
        return {
            "status": "skipped",
            "reason": f"Symbol {bybit_symbol} not available in Alpaca"
        }

    # Ejecutar señal
    if direction == "LONG":
        result = execute_signal(alpaca_symbol, "BUY", usd_amount=100)
    elif direction == "SHORT":
        result = execute_signal(alpaca_symbol, "SELL")
    else:
        result = {"status": "skipped", "reason": "Unknown direction"}

    return result
```

---

## TROUBLESHOOTING

### Error: HTTP 401 Unauthorized

**Causa:** API keys incorrectas o no coinciden con el entorno (paper vs live).

**Solución:**
1. Verificar que usas las keys correctas (paper o live)
2. Verificar que no hay espacios en las keys
3. Regenerar keys si es necesario

```python
# Debug: Verificar keys
print(f"API Key (primeros 10 chars): {ALPACA_API_KEY[:10]}")
print(f"Paper mode: {trade_client._trading_client._api_version == 'v2'}")
```

### Error: Position does not exist

**Causa:** Intentas obtener posición que no existe.

**Solución:** Usar try/except:

```python
try:
    position = trade_client.get_open_position("AAPL")
except Exception as e:
    if "does not exist" in str(e).lower():
        print("No hay posición abierta")
        position = None
    else:
        raise
```

### Error: Insufficient buying power

**Causa:** No tienes suficiente efectivo para la compra.

**Solución:** Verificar buying power antes de operar:

```python
account = trade_client.get_account()
if float(account.buying_power) < usd_amount:
    print(f"Insuficiente buying power: ${account.buying_power} < ${usd_amount}")
    return
```

### Error: Market is closed

**Causa:** Intentas operar fuera del horario de mercado.

**Solución:** Verificar si el mercado está abierto:

```python
clock = trade_client.get_clock()
if not clock.is_open:
    print(f"Market is closed. Opens at: {clock.next_open}")
    return
```

### Órdenes no se ejecutan (Pending)

**Causa:** Órdenes limit/stop no alcanzan el precio.

**Solución:**
1. Usar market orders para ejecución inmediata
2. Ajustar precios limit
3. Verificar status de órdenes regularmente

```python
import time

order = trade_client.submit_order(order_data)
time.sleep(2)  # Esperar 2 segundos
updated_order = trade_client.get_order_by_id(order.id)

if updated_order.status != "filled":
    print(f"Orden aún no ejecutada: {updated_order.status}")
```

---

## RECURSOS ADICIONALES

### Documentación Oficial

- **API Docs:** https://docs.alpaca.markets/us/docs/getting-started
- **Trading API:** https://docs.alpaca.markets/us/docs/trading-api
- **Market Data:** https://docs.alpaca.markets/us/docs/getting-started-with-alpaca-market-data
- **SDK Python:** https://github.com/alpacahq/alpaca-py

### Tutoriales

- **Conectar a Alpaca:** https://alpaca.markets/learn/connect-to-alpaca-api
- **Paper Trading:** https://alpaca.markets/learn/start-paper-trading
- **Build Trading Bot:** https://alpaca.markets/learn/how-to-build-stock-trading-bot-with-alpaca
- **Fractional Shares:** https://alpaca.markets/learn/fractional-shares-api

### Comunidad

- **Forum:** https://forum.alpaca.markets/
- **Discord:** https://alpaca.markets/discord
- **GitHub Issues:** https://github.com/alpacahq/alpaca-py/issues

### Soporte

- **Email:** support@alpaca.markets
- **Help Center:** https://alpaca.markets/support

---

## CONCLUSIÓN

Alpaca ofrece una plataforma robusta para trading algorítmico de acciones estadounidenses:

✅ **Sin depósito mínimo** - Empieza con $1
✅ **Comisión cero** - Maximiza tus ganancias
✅ **API moderna** - Fácil integración
✅ **Paper trading gratis** - Testea sin riesgo
✅ **1,000+ activos** - Diversificación extrema

**Próximos Pasos:**

1. ✅ Crear cuenta paper en Alpaca (gratis)
2. ✅ Generar API keys
3. ✅ Instalar `alpaca-py`
4. ✅ Probar código de ejemplo
5. ✅ Desarrollar estrategia
6. ✅ Pasar a live trading cuando esté listo

**Timeline estimado:**
- Testeo con paper: 1-2 semanas
- Apertura cuenta live + KYC: 1-6 días
- Primer trade real: Día 7-20

---

**Documento generado:** 15 de octubre de 2026
**Autor:** Claude Code
**Versión:** 1.0
