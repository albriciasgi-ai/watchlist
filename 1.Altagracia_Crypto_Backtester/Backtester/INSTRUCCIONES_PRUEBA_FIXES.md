# 🔧 Instrucciones de Prueba - Correcciones

## ✅ Fix #1: Carga de Sesiones (COMPLETADO)

### Problema Original
Error: `timeControllerRef.current.setCurrentTime is not a function`

### Solución
TimeController no tiene método `setCurrentTime`, se usa asignación directa a la propiedad `currentTime`.

### Cómo Probar
1. Crear una sesión con algunos dibujos y órdenes
2. Guardar sesión (Ctrl+S)
3. Modificar estado (borrar dibujos, crear órdenes)
4. Cargar sesión (Ctrl+O)
5. **Verificar:** No debe aparecer error ✅
6. **Verificar:** Todo se restaura correctamente ✅

---

## ✅ Fix #2: Limit Orders con Ejecución Pendiente (COMPLETADO)

### Problema Original
Las limit orders se ejecutaban inmediatamente sin esperar a que el precio llegue al valor límite.

### Solución Implementada
- Limit orders ahora tienen estado "pending"
- Solo se ejecutan cuando el precio toca el nivel especificado
- TP/SL se aplican después de la ejecución
- Popup de confirmación se muestra cuando la orden se ejecuta (no cuando se crea)

### Cómo Probar Limit Orders LONG

1. **Preparar:** Iniciar backtesting BTCUSDT, 15m, precio actual ~$45,000

2. **Crear Limit Order LONG:**
   - Tipo: **Limit**
   - Lado: **Long**
   - Precio: **$44,500** (por debajo del precio actual)
   - Cantidad: 0.5
   - Stop Loss: $44,000
   - Take Profit: $45,500
   - Click "COMPRAR (LONG)"

3. **Verificar creación (NO debe ejecutarse aún):**
   - ❌ **NO** debe aparecer popup de confirmación todavía
   - ✅ En consola: `Orden LIMIT pendiente creada`
   - ✅ En consola: `Se ejecutará cuando el precio llegue a $44,500.00`
   - ✅ La orden está en estado "pending"

4. **Iniciar reproducción:**
   - Poner velocidad rápida (100x o más)
   - Click en Play ▶️
   - **Observar el precio actual**

5. **Cuando el precio BAJE a $44,500:**
   - ✅ Debe aparecer popup de confirmación: "✅ Orden Creada Exitosamente"
   - ✅ Popup muestra: "Precio Ejecutado: $44,500.00"
   - ✅ Si el precio ejecutado difiere del objetivo, muestra "Precio Objetivo: $44,500.00"
   - ✅ Muestra SL y TP correctos
   - ✅ En consola: `Orden pendiente EJECUTADA`

6. **Verificar TP/SL funcionan:**
   - Continuar reproducción
   - ✅ Si el precio baja a $44,000 → Se cierra con Stop Loss
   - ✅ Si el precio sube a $45,500 → Se cierra con Take Profit

### Cómo Probar Limit Orders SHORT

1. **Preparar:** Precio actual ~$45,000

2. **Crear Limit Order SHORT:**
   - Tipo: **Limit**
   - Lado: **Short**
   - Precio: **$45,500** (por encima del precio actual)
   - Cantidad: 0.5
   - Stop Loss: $46,000
   - Take Profit: $44,500
   - Click "VENDER (SHORT)"

3. **Verificar creación:**
   - ❌ **NO** debe aparecer popup todavía
   - ✅ En consola: `Orden LIMIT pendiente creada`

4. **Iniciar reproducción y esperar:**
   - **Cuando el precio SUBA a $45,500:**
   - ✅ Aparece popup: "Precio Ejecutado: $45,500.00"
   - ✅ Orden se ejecuta

5. **Verificar TP/SL:**
   - ✅ Si sube a $46,000 → Stop Loss
   - ✅ Si baja a $44,500 → Take Profit

### Comparación: Market vs Limit Orders

| Característica | Market Order | Limit Order |
|----------------|--------------|-------------|
| Ejecución | Inmediata | Cuando precio toca el límite |
| Popup confirmación | Al crear | Al ejecutar |
| Estado inicial | "open" | "pending" |
| Precio | Precio actual | Precio especificado |
| TP/SL | Funcionan desde el inicio | Funcionan después de ejecución |

### Casos de Prueba Adicionales

#### Caso 1: Limit que nunca se ejecuta
1. Crear limit order muy por debajo/encima del precio
2. Reproducir simulación completa
3. ✅ La orden debe quedar en estado "pending"
4. ✅ Nunca se ejecuta
5. ✅ No hay popup

#### Caso 2: Múltiples Limit Orders
1. Crear 3 limit orders en diferentes niveles
2. Reproducir
3. ✅ Cada una se ejecuta cuando el precio llega a su nivel
4. ✅ Cada una muestra su propio popup
5. ✅ TP/SL funcionan independientemente

#### Caso 3: Limit Order sin TP/SL
1. Crear limit order sin Stop Loss ni Take Profit
2. Esperar ejecución
3. ✅ Popup muestra solo precio ejecutado
4. ✅ No muestra sección de R:R ni Riesgo
5. ✅ Orden queda abierta indefinidamente

### Verificaciones en Consola

Cuando creas una limit order:
```
[TradingControls] Orden creada: {...}
[OrderManager] Orden LIMIT/STOP pendiente: { id: 1, type: 'limit', side: 'long', targetPrice: 44500, quantity: 0.5 }
[TradingControls] Orden LIMIT pendiente creada - Se ejecutará cuando el precio llegue a $44500.00
```

Cuando la limit order se ejecuta:
```
[OrderManager] ✅ Orden pendiente EJECUTADA: { id: 1, type: 'limit', side: 'long', targetPrice: 44500, executedPrice: 44500.23, quantity: 0.5 }
[TradingControls] Orden pendiente ejecutada, mostrando popup: {...}
```

Cuando TP o SL se ejecutan:
```
[OrderManager] Orden cerrada: { id: 1, pnl: 250.00, pnlPercent: 1.12%, reason: 'take_profit' }
```

---

## 🔍 Debugging

### Si la limit order se ejecuta inmediatamente
- **Problema:** El precio actual ya está en o más allá del precio límite
- **Solución:** Para long, poner precio límite DEBAJO del actual. Para short, ENCIMA del actual.

### Si la limit order nunca se ejecuta
- **Verificar:** Que el precio llegue realmente a ese nivel
- **Solución:** Poner precio límite más cercano al precio actual

### Si TP/SL no funcionan
- **Verificar en consola:** Que la orden esté en estado "open" (no "pending")
- **Verificar:** Que los valores de TP/SL sean correctos para el lado (long/short)

### Si no aparece el popup
- **Verificar:** Para limit orders, el popup solo aparece cuando se ejecutan
- **Abrir consola:** Debe aparecer mensaje `Orden pendiente ejecutada`

---

## 📊 Resumen de Cambios en el Código

### OrderManager.js
- ✅ Agregado array `pendingOrders`
- ✅ Estado "pending" para limit/stop orders
- ✅ Método `executePendingOrder()`
- ✅ Callback `onOrderExecuted`
- ✅ Lógica de ejecución en `updateOrders()`
- ✅ Soporte para `executedPrice` en cálculo de PnL

### TradingControls.jsx
- ✅ Pasar `currentPrice` al crear orden
- ✅ Popup solo para market orders al crear
- ✅ Conectar `onOrderExecuted` para mostrar popup cuando limit se ejecuta

### OrderConfirmationModal.jsx
- ✅ Mostrar "Precio Ejecutado" vs "Precio Entrada"
- ✅ Mostrar "Precio Objetivo" si difieren
- ✅ Usar `executedPrice` para cálculos

### BacktestingApp.jsx
- ✅ Conectar callback `onOrderExecuted`
- ✅ Fix de carga de sesión (currentTime)

---

## ✅ Checklist de Prueba

- [ ] Limit Order Long se ejecuta cuando precio baja al límite
- [ ] Limit Order Short se ejecuta cuando precio sube al límite
- [ ] Popup NO aparece al crear limit order
- [ ] Popup SÍ aparece cuando limit order se ejecuta
- [ ] TP/SL funcionan después de ejecución de limit order
- [ ] Market orders siguen funcionando normalmente
- [ ] Carga de sesión funciona sin errores
- [ ] Múltiples limit orders se ejecutan correctamente
- [ ] Limit orders pendientes aparecen en la lista
- [ ] Limit orders que nunca se ejecutan quedan en "pending"
