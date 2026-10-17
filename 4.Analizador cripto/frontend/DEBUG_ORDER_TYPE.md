# DEBUG: Problema de Tipo de Orden

## Pasos para verificar:

### 1. FORZAR RECARGA DEL FRONTEND

```bash
# Detener el servidor de desarrollo (Ctrl+C)
# Limpiar cache de Vite
cd "C:\Users\inven\OneDrive\Documentos\GitHub\watchlist\4.Analizador cripto\frontend"
rm -rf node_modules/.vite
npm run dev
```

### 2. ABRIR NAVEGADOR CON CONSOLA

1. Presionar **F12** para abrir DevTools
2. Ir a pestaña **Console**
3. Hacer **Ctrl+Shift+R** (hard refresh)

### 3. CREAR ORDEN DE PRUEBA

1. Dibujar caja TP/SL con entry price MUY diferente al precio actual
   - Ejemplo: Si BTC está en $60,000, poner entry en $59,000 o $61,000
2. Abrir Trading Panel (Alt+T)
3. Preparar orden

### 4. VERIFICAR LOGS EN CONSOLA DEL NAVEGADOR

Deberías ver estos mensajes:

```
[OrderForm] Order type calculation: {
  entryPrice: 59000,
  currentPrice: 60000,
  priceDiff: "1000.0000",
  priceThreshold: "60.0000",
  orderType: "LIMIT"
}

[TradingPanel] Order type detection: entryPrice=59000, currentPrice=60000, diff=1000.00, threshold=60.00 => LIMIT

[TradingPanel] Sending order: {
  symbol: "BTCUSDT",
  side: "Buy",
  quantity: 0.001,
  stopLoss: 58000,
  takeProfit: 62000,
  currentPrice: 59000,
  order_type: "Limit",
  limit_price: 59000,
  custom_stop_loss: 58000,
  custom_take_profit: 62000
}
```

### 5. SI NO VES ESTOS LOGS

Significa que el código viejo sigue en cache. Hacer:

```bash
# Opción 1: Limpiar cache de Vite
rm -rf node_modules/.vite
rm -rf dist

# Opción 2: Cambiar puerto para forzar nuevo build
# En vite.config.js cambiar puerto de 10001 a 10002
```

### 6. VERIFICAR BACKEND DEL TRADINGBOT

En la terminal del TradingBot deberías ver:

```
[MANUAL TRADE] LIMIT order: BTCUSDT Buy @ $59000
[EXECUTE] ================================================
[EXECUTE] LIMIT + TP/SL: Buy BTCUSDT
[EXECUTE] ================================================
```

Si ves `MARKET order` en lugar de `LIMIT order`, entonces el problema está en el payload que llega al backend.

### 7. SI TODO FALLA

Verificar que los archivos tienen los cambios correctos:

```bash
# Ver si submitOrder existe (no submitMarketOrder)
grep -n "const submitOrder" src/components/trading/TradingPanel.jsx

# Ver si orderType se calcula
grep -n "const orderType = useMemo" src/components/trading/OrderForm.jsx

# Ver si order_type se incluye en payload
grep -n "order_type:" src/components/trading/TradingPanel.jsx
```
