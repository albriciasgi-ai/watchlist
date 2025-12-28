# 📋 Instrucciones de Prueba - Mejoras de Backtesting

Este documento contiene las instrucciones detalladas para probar las tres mejoras implementadas en el sistema de backtesting.

---

## 🚀 Inicio Rápido

1. **Reiniciar servidores:**
   ```bash
   # Backend
   cd backend
   start_backend.bat

   # Frontend (en otra terminal)
   cd frontend
   npm run dev
   ```

2. **Acceder a la aplicación:**
   - Abrir navegador en `http://localhost:9001`
   - Ir a la sección de Backtesting

---

## ✅ Fix #1: Órdenes Limit con Precio Personalizado

### Problema Original
Las órdenes tipo "limit" se auto-actualizaban con el precio de mercado, impidiendo que el usuario ingresara un precio personalizado.

### Cambios Implementados
- **Archivo:** `TradingControls.jsx:15-29`
- El checkbox "Usar precio actual" se desactiva automáticamente al seleccionar orden tipo "limit"
- El precio NO se actualiza automáticamente en órdenes limit

### Cómo Probar

1. **Inicializar backtesting** con cualquier símbolo (ej: BTCUSDT, 15m)

2. **Reproducir simulación** para que haya un precio actual

3. **Crear orden Market (control):**
   - Tipo: Market
   - Verificar que el precio se actualiza automáticamente ✅
   - Verificar que el checkbox "Usar precio actual" está activo ✅

4. **Crear orden Limit (caso de prueba):**
   - Cambiar Tipo a: **Limit**
   - **Verificar:** El checkbox "Usar precio actual" se desactiva automáticamente ✅
   - **Ingresar precio personalizado** (ej: precio actual + $100)
   - **Esperar 5 segundos** mientras la simulación avanza
   - **Verificar:** El precio ingresado NO cambia ✅

5. **Verificar en consola:**
   ```
   [TradingControls] Auto-actualización desactivada para orden limit
   ```

### ✅ Resultado Esperado
- Órdenes limit permiten ingresar precio personalizado sin auto-actualización
- Órdenes market continúan funcionando con auto-actualización

---

## ✅ Fix #2: Popup de Confirmación de Orden

### Problema Original
No había feedback visual al crear órdenes, causando duplicados accidentales.

### Cambios Implementados
- **Archivos nuevos:**
  - `OrderConfirmationModal.jsx`
  - `OrderConfirmationModal.css`
- **Archivo modificado:** `TradingControls.jsx` (integración del modal)

### Cómo Probar

1. **Configurar una orden con TP/SL:**
   - Tipo: Market
   - Lado: Long
   - Cantidad: 0.5
   - Stop Loss: -2% (usar botón rápido)
   - Take Profit: +4% (usar botón rápido)
   - Notas: "Prueba de confirmación"

2. **Crear la orden** (botón verde "COMPRAR")

3. **Verificar modal aparece** con la siguiente información:
   ```
   ✅ Orden Creada Exitosamente

   Tipo: MARKET
   Lado: LONG 📈
   Cantidad: 0.5
   Precio Entrada: $45,250.00
   Stop Loss: $44,345.00 (-2.00%)
   Take Profit: $47,060.00 (+4.00%)
   Risk/Reward: 1:2.00
   Riesgo Total: $452.50

   Notas: "Prueba de confirmación"

   [Cerrar (5s)]
   ```

4. **Verificar countdown:** El botón muestra cuenta regresiva 5, 4, 3, 2, 1

5. **Verificar auto-cierre:** Modal se cierra automáticamente a los 5 segundos

6. **Probar cierre manual:**
   - Crear otra orden
   - Click en el botón "Cerrar" antes de que termine el countdown
   - Modal debe cerrarse inmediatamente ✅

7. **Probar orden sin TP/SL:**
   - Crear orden sin Stop Loss ni Take Profit
   - Verificar que NO aparecen las secciones de R:R ni Riesgo ✅

### ✅ Resultado Esperado
- Popup aparece inmediatamente después de crear orden
- Muestra toda la información relevante
- Se cierra automáticamente en 5 segundos
- Previene duplicados accidentales al dar feedback visual claro

---

## ✅ Fix #3: Sistema de Sesiones (Guardar/Cargar)

### Problema Original
No había forma de guardar el progreso del backtesting (dibujos, órdenes, configuraciones) para continuar después.

### Cambios Implementados
- **Archivos nuevos:**
  - `SessionManager.js` - Gestión de IndexedDB
  - `SessionSaveModal.jsx` - UI para guardar
  - `SessionLoadModal.jsx` - UI para cargar
  - `SessionModals.css` - Estilos
- **Archivos modificados:**
  - `BacktestingApp.jsx` - Integración completa
  - `MiniChart.jsx` - Métodos getDrawings() y loadDrawings()

### Cómo Probar

#### **Parte 1: Crear y Guardar Sesión**

1. **Preparar estado de prueba:**
   - Inicializar backtesting: BTCUSDT, 15m, fecha 2024-01-01
   - Crear 3-4 órdenes (algunas cerradas, algunas abiertas)
   - Dibujar varias herramientas: fibonacci, líneas, rectángulos, TP/SL
   - Configurar indicadores específicos
   - Avanzar la simulación a una fecha específica

2. **Guardar sesión (Ctrl+S o botón "💾 Guardar"):**
   - Abrir modal de guardar
   - **Nombre:** "Prueba Fibonacci - BTCUSDT"
   - **Tags:** "fibonacci, scalping, test"
   - **Notas:** "Sesión de prueba para validar sistema de guardado"
   - **Auto-save:** Activar checkbox ✅
   - Click "💾 Guardar Sesión"

3. **Verificar guardado:**
   - Debe aparecer alert: "✅ Sesión guardada: Prueba Fibonacci - BTCUSDT"
   - Botón "💾 Guardar" cambia a color verde ✅
   - Verificar en consola:
     ```
     [SessionManager] Sesión guardada: session_BTCUSDT_15m_...
     [BacktestingApp] Sesión guardada y registrada: Prueba Fibonacci - BTCUSDT
     ```

4. **Verificar auto-save:**
   - Esperar 30 segundos
   - Crear una nueva orden
   - Verificar en consola:
     ```
     [SessionManager] Auto-guardado ejecutado
     ```

#### **Parte 2: Cargar Sesión**

5. **Modificar estado actual:**
   - Limpiar todos los dibujos
   - Cerrar todas las órdenes
   - Cambiar configuración de indicadores
   - Cambiar fecha de simulación

6. **Cargar sesión guardada (Ctrl+O o botón "📂 Cargar"):**
   - Abrir modal de cargar
   - **Verificar lista de sesiones:**
     ```
     📊 Prueba Fibonacci - BTCUSDT
        BTCUSDT - 15m
        4 trades | 50% WR | fibonacci, scalping
        Guardado: 05/12/2024 15:30
        "Sesión de prueba para validar sistema de guardado"
        [▶ Cargar] [📥] [🗑]
     ```

7. **Cargar sesión:**
   - Click "▶ Cargar"
   - Debe aparecer alert: "✅ Sesión cargada: Prueba Fibonacci - BTCUSDT"

8. **Verificar restauración completa:**
   - ✅ Órdenes restauradas (mismas que tenías antes)
   - ✅ Dibujos restaurados (fibonacci, líneas, etc.)
   - ✅ Configuraciones de indicadores restauradas
   - ✅ Fecha de simulación restaurada
   - ✅ Precio actual restaurado

9. **Verificar en consola:**
   ```
   [BacktestingApp] Restaurando sesión: Prueba Fibonacci - BTCUSDT
   [OrderManager] Datos importados
   [MiniChart] Dibujos cargados desde sesión: 5
   [BacktestingApp] Configuraciones de indicadores restauradas
   [BacktestingApp] ✅ Sesión restaurada exitosamente
   ```

#### **Parte 3: Funciones Adicionales**

10. **Exportar sesión a JSON:**
    - Abrir modal de cargar
    - Click en botón "📥" de la sesión
    - Debe descargarse archivo: `backtesting_session_BTCUSDT_15m_2024-12-05.json`
    - Abrir archivo y verificar estructura JSON

11. **Importar sesión desde JSON:**
    - En modal de cargar, click "📥 Importar JSON"
    - Seleccionar el archivo JSON descargado
    - Verificar que aparece nueva sesión con "(Importada)" en el nombre

12. **Eliminar sesión:**
    - Click en botón "🗑" de una sesión
    - Confirmar eliminación
    - Verificar que desaparece de la lista

13. **Filtros de búsqueda:**
    - Crear sesiones con diferentes símbolos y timeframes
    - Usar filtros de Símbolo y Timeframe
    - Verificar que solo muestra sesiones que coinciden

14. **Sesión con símbolo diferente:**
    - Guardar sesión con ETHUSDT
    - Cambiar a BTCUSDT
    - Intentar cargar sesión de ETHUSDT
    - Debe preguntar: "¿Reinicializar con ETHUSDT?"
    - Probar ambos casos (Sí / No)

#### **Parte 4: Keyboard Shortcuts**

15. **Atajos de teclado:**
    - **Ctrl+S:** Abre modal de guardar ✅
    - **Ctrl+O:** Abre modal de cargar ✅
    - Verificar que funcionan en cualquier momento

### ✅ Resultado Esperado

El sistema de sesiones debe permitir:
1. ✅ Guardar estado completo del backtesting
2. ✅ Restaurar exactamente desde donde se dejó
3. ✅ Múltiples sesiones por símbolo/timeframe
4. ✅ Auto-guardado cada 30 segundos (opcional)
5. ✅ Exportación/importación a JSON
6. ✅ Búsqueda y filtrado de sesiones
7. ✅ Eliminación de sesiones
8. ✅ Atajos de teclado

---

## 🐛 Casos de Error Conocidos

### IndexedDB No Disponible
- **Síntoma:** Error al guardar/cargar sesiones
- **Solución:** Verificar que el navegador soporta IndexedDB y no está en modo incógnito

### Sesión Corrupta
- **Síntoma:** Error al cargar sesión específica
- **Solución:** Eliminar sesión corrupta y crear nueva

### Auto-save Múltiple
- **Síntoma:** Múltiples mensajes de auto-guardado
- **Solución:** Solo debe haber un auto-save activo. Recargar página.

---

## 📊 Resumen de Archivos Modificados/Creados

### Fix #1 (Limit Orders)
- ✏️ `frontend/src/components/backtesting/TradingControls.jsx`

### Fix #2 (Confirmation Popup)
- ✨ `frontend/src/components/backtesting/OrderConfirmationModal.jsx` (nuevo)
- ✨ `frontend/src/components/backtesting/OrderConfirmationModal.css` (nuevo)
- ✏️ `frontend/src/components/backtesting/TradingControls.jsx`

### Fix #3 (Session System)
- ✨ `frontend/src/components/backtesting/SessionManager.js` (nuevo)
- ✨ `frontend/src/components/backtesting/SessionSaveModal.jsx` (nuevo)
- ✨ `frontend/src/components/backtesting/SessionLoadModal.jsx` (nuevo)
- ✨ `frontend/src/components/backtesting/SessionModals.css` (nuevo)
- ✏️ `frontend/src/components/backtesting/BacktestingApp.jsx`
- ✏️ `frontend/src/components/MiniChart.jsx`

**Total:** 6 archivos nuevos, 4 archivos modificados

---

## 🎯 Checklist de Prueba Completa

### Fix #1: Limit Orders
- [ ] Orden Market actualiza precio automáticamente
- [ ] Orden Limit NO actualiza precio automáticamente
- [ ] Checkbox se desactiva al cambiar a Limit
- [ ] Precio personalizado se mantiene en órdenes Limit

### Fix #2: Confirmation Popup
- [ ] Modal aparece al crear orden
- [ ] Muestra toda la información correcta
- [ ] Countdown funciona (5s)
- [ ] Auto-cierre funciona
- [ ] Cierre manual funciona
- [ ] R:R y Riesgo se calculan correctamente
- [ ] Notas se muestran si existen

### Fix #3: Session System
- [ ] Guardar sesión funciona (Ctrl+S)
- [ ] Cargar sesión restaura estado completo
- [ ] Auto-save funciona cada 30s
- [ ] Exportar a JSON funciona
- [ ] Importar desde JSON funciona
- [ ] Eliminar sesión funciona
- [ ] Filtros funcionan correctamente
- [ ] Múltiples sesiones se manejan bien
- [ ] Atajos de teclado funcionan
- [ ] Sesión de otro símbolo pregunta antes de cargar

---

## ⚠️ IMPORTANTE

**NO PUEDO EJECUTAR LOS SERVIDORES NI PROBAR EN NAVEGADOR**

He implementado todo el código con la mejor calidad posible, pero necesitas:
1. Reiniciar los servidores frontend y backend
2. Ejecutar estas pruebas manualmente
3. Reportarme cualquier error que encuentres

Si encuentras algún problema, dame:
- El error exacto que aparece en consola
- Los pasos que seguiste
- El comportamiento esperado vs el actual

Estaré atento para corregir cualquier issue. 🚀
