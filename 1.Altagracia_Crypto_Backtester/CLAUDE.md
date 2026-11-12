# CLAUDE.md - Crypto Backtester

Sistema profesional de backtesting para criptomonedas con análisis avanzado de patrones, volumen y momentum.

---

## HISTORIAL DE CAMBIOS RECIENTES

### Noviembre 2026: Ajustes Propios del 2.º Gráfico

Cada indicador del 2.º gráfico tiene su ⚙️ con los modales de la principal; lo cambiado ahí queda solo en ese gráfico. Detalle en `Backtester/CLAUDE.md`, "Ajustes propios del 2.º gráfico".

### Noviembre 2026: 2.º Gráfico Fluido

El 2.º gráfico recibía la hora 8.5 veces por segundo y a 10000x cada aviso traía 20 minutos. Ahora avanza en cada cuadro de la pantalla, minuto a minuto, sin pasar nunca de la hora de la principal: 59 dibujos por segundo con 3 minutos cada uno. Detalle en `Backtester/CLAUDE.md`, "SEGUNDO GRÁFICO, VENTANAS Y MEJORAS DEL 11/11", "2.º gráfico fluido".

### Noviembre 2026: Panel de Trading Aparte, Cajas TP/SL y Velas que se Forman en el 2.º Gráfico

El panel de trading se abre en una ventana aparte. El 2.º gráfico dibuja las cajas TP/SL de los trades y sus velas se forman con el paso del marco más fino a la vista. El reloj ya no avanza a saltos con la principal en segundo plano (lo marca un Worker), y el 2.º gráfico sigue una sola principal. La caja de texto toma los colores del estilo. Detalle en `Backtester/CLAUDE.md`, "SEGUNDO GRÁFICO, VENTANAS Y MEJORAS DEL 11/11".

### Noviembre 2026: Segundo Gráfico, Observador en Ventana Aparte y Mejoras

Segundo gráfico en otra pestaña que sigue la reproducción, con su marco e indicadores. Observador en ventana aparte. VWAP, volumen y paneles elegibles para el análisis. Caja de texto en los dibujos. Los trades se numeran sin contar las órdenes canceladas. VP de rango fijo con 400 niveles. Detalle en `Backtester/CLAUDE.md`, "SEGUNDO GRÁFICO, VENTANAS Y MEJORAS DEL 11/11".

### Noviembre 2026: Prueba Manual de los Setups y Precio como Índice en Fecha Oculta

Fase 4: fecha de corte que "Evaluar" nunca mira, "Comprobación final" registrada en lo reservado, versiones de cada receta, tus trades por setup en el informe del Observador y, con fecha oculta, precio como índice base 80-120 y volumen relativo. Corrige que "Evaluar" midiera solo 70 días. Detalle en `Backtester/CLAUDE.md`, "ELEMENTOS DE ORDER FLOW", "Prueba manual", y "OBSERVADOR", "Retrocesos y fecha oculta".

### Noviembre 2026: Setups de Order Flow como Recetas

Los 91 setups de Orderflows Unlocked como recetas de los elementos: misma vela, ventana o secuencia, con filtros de swing, momentum y confirmación de entrada. Se dibujan con su etiqueta y se evalúan en el histórico anterior a la hora simulada, con costos y contra la base. Hay un editor para recetas propias. Detalle en `Backtester/CLAUDE.md`, sección "ELEMENTOS DE ORDER FLOW", "Setups como recetas".

---

### Noviembre 2026: Delta Exacto y Órdenes Reales en Elementos OF

Almacén de flujo nuevo (`OrderFlowData/flow`): el delta dentro de cada minuto y las órdenes agresivas reales. Con él, "Elementos OF" suma Extreme Delta, Small Min/Max Delta, barridos reales y órdenes grandes, y la tabla de la vela muestra Máx Δ y Mín Δ exactos. Detalle en `Backtester/CLAUDE.md`, sección "ELEMENTOS DE ORDER FLOW".

---

### Noviembre 2026: Elementos de Order Flow

Indicador "Elementos OF": 27 elementos de los setups (8 de ellos solo en velas de mucho volumen) de Orderflows Unlocked detectados con los trades reales, como franjas que siguen hasta que el precio vuelve, celdas, contornos y un triángulo con códigos, más la tabla de la vela y la EMA 14. Umbrales calibrados con los 30 días anteriores y solo velas cerradas. Detalle en `Backtester/CLAUDE.md`, sección "ELEMENTOS DE ORDER FLOW".

---

### Noviembre 2026: Estilos Oscuro, Personalizado y Muhammad

El modal "Estilo" ofrece cinco estilos:
- **Nítido**, con sus colores fijos: es el único que no se puede cambiar;
- **Oscuro**, con lienzo, barras, panel de trading, menús y modales oscuros;
- **Personalizado**, que parte de Nítido;
- **Muhammad**, con una paleta del arte islámico investigada en museos y textos académicos;
- **Clásico**.

Oscuro, Personalizado y Muhammad dejan cambiar sus colores y cada uno guarda lo suyo. Nítido y Clásico no cambian: 0 píxeles distintos. Detalle en `Backtester/CLAUDE.md`, sección "ESTILO NÍTIDO", "Oscuro, Personalizado y Muhammad" y "Paleta Muhammad".

---

### Noviembre 2026: Liquidaciones de Velas Fijadas en su Mecha

Una vela fijada en Liquidaciones cuenta lo liquidado en su mecha: el máximo, de su cuerpo hacia arriba; el mínimo, hacia abajo. Toma al menos 0.1% junto al extremo y a lo sumo el "Alto máximo de la mecha" del modal ⚙️ (0.5% por defecto). La franja cubre ese rango y la etiqueta lo dice. Antes se contaba la mitad de la vela. Detalle en `Backtester/CLAUDE.md`, sección "LIQUIDACIONES", "Velas fijadas".

---

### Noviembre 2026: Footprints al Alejar la Vista

Order Flow dejaba de pedir footprints con más de 400 velas en pantalla, unos 4 días en 15m. Al alejar la vista, las velas anteriores quedaban sin footprints, sin aviso, aunque el almacén los tuviera. Ahora pide hasta 1600 velas y 70 días de trades por vista, y con más avisa que hay que acercar el zoom. Detalle en `Backtester/CLAUDE.md`, sección "ORDER FLOW SOBRE LAS VELAS", "Dibujo".

---

### Noviembre 2026: Colores Propios en los Modales de los Indicadores

Con Nítido, lo cambiado en el modal de un indicador gana sobre el estilo: perfil de volumen, VP de rango fijo, Order Flow, confluencia OI y volumen, y volumen. Cada modal tiene cómo volver a los colores del estilo. También se corrigió el área de valor del perfil dinámico: abarcaba todo el perfil, con VAH y VAL en sus extremos, también en el Clásico. Detalle en `Backtester/CLAUDE.md`, sección "ESTILO NÍTIDO", "Ajustes propios en el modal de cada indicador".

---

### Noviembre 2026: Estilo Nítido

App 1 abre con el estilo Nítido:
- una sola letra;
- color solo en los datos;
- ejes con números y horas redondos, leyenda y último precio;
- footprint graduado por volumen;
- íconos de línea y paneles en español.

El botón "Estilo" abre un modal para cambiar cada color o volver al aspecto clásico, que queda idéntico al anterior. Detalle en `Backtester/CLAUDE.md`, sección "ESTILO NÍTIDO".

---

### Noviembre 2026: Nitidez del Gráfico

El lienzo del gráfico usa los píxeles reales de la pantalla, y velas, líneas, perfiles, footprints y dibujos caen en píxeles enteros: nítido a 100% y en monitores con escala, sin cambiar colores ni disposición. El texto del gráfico sale con ClearType y las imágenes de trades se guardan al doble de resolución. Detalle en `Backtester/CLAUDE.md`, sección "NITIDEZ DEL GRÁFICO".

---

### Noviembre 2026: Indicador de Liquidaciones

Zonas donde se liquidó mucho dinero en los últimos 30 días, cerca del precio, que cambian al avanzar la reproducción. Usa MarginPad, Coinalyze, Binance Coin-M y Bitfinex sin mezclarlas, y dice cuál usa. El 8/11 se agregó fijar el máximo o el mínimo de una vela, aunque sea de hace meses, para dejar sus liquidaciones como nivel hasta soltarla. Detalle en `Backtester/CLAUDE.md`, sección "LIQUIDACIONES".

---

### Noviembre 2026: Registro Automático de Operaciones

Cada orden guarda sola las medidas de 15m, 1h y 4h, los dibujos de las últimas 100 velas y los niveles elegidos con clic en el gráfico. El Observador compara las entradas con momentos sin entrada y prueba reglas en el histórico. El Zone Detector de esta app se eliminó. Detalle en `Backtester/CLAUDE.md` sección "REGISTRO AUTOMÁTICO".

---

### Noviembre 2026: Orden y Altura de Paneles

Cada panel de indicador se mueve con ▲▼ y su altura cambia al arrastrar su borde superior, sin tocar los demás paneles. Se guarda por símbolo y lo comparten los marcos. Detalle en `Backtester/CLAUDE.md`, sección "Orden y altura de los paneles".

---

### Noviembre 2026: Órdenes por Riesgo, VP Periodic y Volumen de Respuesta

Órdenes por capital arriesgado y automáticas desde la caja TP/SL, como en App 8. VP Periodic, Volumen de Respuesta medido con el histórico de BTC, máximo de 10 niveles por vela y modales claros. La pestaña Estrategia se quitó del código porque sus resultados dependían del futuro. Detalle en `Backtester/CLAUDE.md`, secciones "ÓRDENES", "SESIONES" y "VOLUMEN DE RESPUESTA".

---

### Noviembre 2026: Journal de Trades con Imagen

Cada trade guarda una imagen del gráfico al abrir y otra 10 velas después de cerrar, y se ven con 📸 en el historial. Las líneas verticales salen de las órdenes y la sesión se guarda sola con cada operación. Detalle en `Backtester/CLAUDE.md`, sección "JOURNAL DE TRADES".

---

### Noviembre 2026: Indicadores sin Futuro

VWAP, Swing, Rejection, Double Top/Bottom y Range Detection solo muestran lo que ya se podía conocer en la hora simulada. Double Top/Bottom calcula al marcar su casilla y Rejection validado funciona en backtesting. Detalle en `Backtester/CLAUDE.md`, sección "INDICADORES SIN FUTURO". El filtro por `secondExtreme.timestamp` que aparece más abajo fue reemplazado por `knownAt`.

---

### Noviembre 2026: Observador + Parámetros de Order Flow y FVG

Cada orden manual queda registrada en disco con la lectura de la regla del laboratorio, oculta hasta que la orden termina. Los modales de Order Flow y FVG cambian step, imbalances y gaps. Detalle en `Backtester/CLAUDE.md`, sección "OBSERVADOR".

---

### Noviembre 2026: Reproducción sin Futuro + Footprints Reales

Velas en formación, órdenes y perfiles solo usan lo ocurrido hasta la hora simulada. Los footprints se leen sobre las velas, desde el almacén diario de trades de Bybit. Detalle en `Backtester/CLAUDE.md`, sección "ORDER FLOW SOBRE LAS VELAS".

---

### Octubre 2026: OPCIÓN B - Subdivisiones = Main (Optimización de Performance)

**Problema:** Las subdivisiones descargaban velas de timeframes inferiores, causando:
- Descarga de 2.6M velas de 1m para subdivisiones de 5m (60+ minutos)
- Consumo de memoria: ~150MB solo en subdivisiones
- Procesamiento pesado: agregar múltiples velas para formar una vela superior

**Solución Implementada: OPCIÓN B**
Las subdivisiones ahora son **referencias directas al array main**, sin descarga extra.

**Cambios en Backend:**
1. `subdivision_candles = main_candles` - Referencia directa, no copia
2. Configuración actualizada: `subdivisions.interval` = mismo que `main`
3. Eliminado código de descarga separada de subdivisiones
4. Eliminado código de expansión hacia atrás de subdivisiones
5. Eliminado código de actualización incremental de subdivisiones

**Resultados:**
- ✅ Descarga: 525K velas en 5 min (antes: 2.6M en 60 min)
- ✅ Memoria: ~20MB (antes: ~150MB)
- ✅ Playback funciona correctamente vela por vela
- ⚠️ Trade-off: No hay movimiento "fluido" intravela (igual que TradingView)

**Archivos modificados:**
- `backend/main.py` (líneas 1954-1985, 2716-2722, 2564-2590, 2601-2608)
- `CLAUDE.md` - Documentación

---

### Octubre 2026: Header Fusionado + Fix Open Interest + UI Optimizations

**Cambios completados:**
1. **Header Fusionado (40px único)**: Eliminado header duplicado en main.jsx, consolidado todo en BacktestingApp.jsx con position fixed
2. **Fix Open Interest Endpoint**: Corrección de parámetros `Optional[int]` para start/end timestamps + import de typing
3. OI descarga datos a resolución real del timeframe (sin forward-fill/interpolación)
4. Mapeo directo: 1m→5min, 5m→5min, 15m→15min, 1h→1h, 4h→4h
5. MAX_OI_REQUESTS aumentado a 600 para máxima cobertura histórica
6. Backend retorna metadata de cobertura OI (fecha desde/hasta, intervalo)
7. Frontend muestra mensaje informativo con fecha exacta de disponibilidad
8. Helper `_getOICoverageMessage()` centraliza lógica en 3 modos de render

**Archivos modificados:**
- `frontend/src/main.jsx` - Eliminado header duplicado (50px), removido wrapper con marginTop
- `frontend/src/components/backtesting/BacktestingApp.jsx` - Header único con icono, reducido a 40px
- `frontend/src/backtesting_styles.css` - Header position fixed, padding-top en container, tamaños reducidos
- `frontend/src/components/backtesting/TimeframeTabs.css` - Tabs ultra-compactos (26px altura)
- `frontend/src/components/drawing/DrawingSidebar.css` - Alineado con header (top: 40px)
- `backend/main.py` - Fix parámetros `Optional[int]` en endpoint OI (líneas 5, 633-634)
- `frontend/src/components/indicators/OpenInterestIndicator.js` - metadata, `_getOICoverageMessage()`

### Octubre 2026: Expansión a 5 Años + Gzip Cache + VP Fixed Range from Rectangle + Fix Delete Key

**Cambios completados** (ver secciones detalladas más abajo):
1. Expansión de límites de backtesting de 2 años a 5 años para la mayoría de timeframes
2. Compresión gzip del caché de backtesting (~90% reducción de tamaño)
3. Carga incremental de velas (solo descarga velas nuevas si caché >1h)
4. Auto-detección de caché incompleto (re-descarga si <80% de velas esperadas)
5. VP Fixed Range desde rectángulos dibujados en el chart
6. Fix: Delete key no borraba shapes seleccionados (referencia obsoleta)
7. Fix: Chart flip al hacer click/drag durante playback

---

## COMANDOS DE INICIO

```bash
# Backend (Puerto 9000)
cd 1.Altagracia_Crypto_Backtester/Backtester/backend
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 9000

# Frontend (Puerto 5173)
cd 1.Altagracia_Crypto_Backtester/Backtester/frontend
npm install && npm run dev
```

---

## ESTRUCTURA DE ARCHIVOS

```
1.Altagracia_Crypto_Backtester/Backtester/
├── backend/
│   ├── main.py                      # Servidor FastAPI (~94KB, ~2400 líneas)
│   ├── double_topbottom_detector.py # Detector DTB (~60KB, ~1350 líneas)
│   ├── rejection_detector.py        # Detector patrones rechazo (~19KB)
│   ├── alert_sender.py              # Sistema alertas (~10KB)
│   ├── vwap_calculator.py           # Calculador VWAP (~13KB)
│   ├── observer.py                  # Registro de órdenes y lectura de la regla
│   ├── measures.py                  # Tabla de medidas por vela de 15m
│   ├── patterns.py                  # Lectura de cada orden, informe y prueba de reglas
│   ├── cache/                       # Caché datos históricos
│   ├── backtesting_cache/           # Caché específico backtesting
│   └── drawings/                    # Dibujos guardados (JSON)
│
├── frontend/
│   ├── src/components/
│   │   ├── backtesting/
│   │   │   ├── BacktestingApp.jsx   # Componente raíz (~84KB)
│   │   │   ├── BacktestingChart.jsx # Gráfico principal (~43KB)
│   │   │   ├── TimeController.js    # Control temporal (~12KB)
│   │   │   ├── OrderManager.js      # Gestor órdenes (~18KB)
│   │   │   ├── TradingControls.jsx  # Controles trading (~11KB)
│   │   │   ├── PerformancePanel.jsx # Métricas (~11KB)
│   │   │   ├── TradeHistory.jsx     # Historial (~7KB)
│   │   │   └── SessionManager.js    # Sesiones (~9KB)
│   │   ├── indicators/              # Sistema indicadores (compartido)
│   │   │   ├── IndicatorManager.js  # Orquestador (~56KB)
│   │   │   ├── DoubleTopBottomIndicator.js  # DTB (~96KB) ⭐
│   │   │   ├── RejectionPatternIndicator.js # Rejection (~114KB)
│   │   │   ├── SupportResistance2Indicator.js # S&R v2 basado en Swing Points ⭐
│   │   │   ├── swingLevels.js                 # Niveles de S&R v2
│   │   │   └── ... (otros indicadores)
│   │   ├── SupportResistance2Settings.jsx # Modal config S&R v2
│   │   ├── MiniChart.jsx            # Gráfico con indicadores (~92KB)
│   │   └── Watchlist.jsx            # Watchlist (~13KB)
│   └── dist/                        # Build producción
```

---

## CARACTERÍSTICAS PRINCIPALES

- **29 pares de criptomonedas** soportados (BTCUSDT, ETHUSDT, SOLUSDT, etc.)
- **10+ indicadores técnicos** simultáneos
- **Detección automática** de patrones (Double Top/Bottom, Rejection Patterns)
- **Backtesting realista** con órdenes market/limit/stop
- **TimeController** con subdivisiones intravela (1x, 2x, 5x, 10x)
- **Métricas**: Win Rate, Drawdown, Sharpe Ratio
- **Zoom dinámico v3.0** similar a TradingView
- **Exportación**: Excel, CSV, PNG
- **Persistencia de sesiones**
- **Timeframes**: 1m, 5m, 15m, 1h, 4h (5 tabs independientes)
  - 1m: 2 años de datos (1,051,200 velas)
  - 5m: 5 años de datos (525,600 velas)
  - 15m/1h/4h: 5 años de datos
- **VP Fixed Range desde rectángulos** dibujados en el chart

---

## ENDPOINTS BACKEND

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/status` | GET | Estado servidor, caché, zona horaria |
| `/api/historical/{symbol}` | GET | Datos OHLCV (params: interval, days) |
| `/api/volume-delta/{symbol}` | GET | Volume Delta + CVD |
| `/api/rejection-patterns/detect` | POST | Detecta patrones de rechazo |
| `/api/rejection-patterns/available-contexts/{symbol}` | GET | Contextos de referencia |
| `/api/double-topbottom/detect` | POST | Detecta Double Top/Bottom ⭐ |
| `/api/double-topbottom/chunk` | POST | Obtiene patrones por chunks ⭐ |
| `/api/observer/patterns/{symbol}` | GET | Entradas contra momentos sin entrada |
| `/api/observer/rule-test/{symbol}` | POST | Prueba una regla en fechas no operadas |
| `/api/observer/measures/{symbol}` | GET | Catálogo de medidas y estado de la tabla |
| `/api/observer/export/{symbol}` | GET | Registro completo en CSV |
| `/api/liquidations/{symbol}` | GET | Liquidaciones conocidas en la ventana, cortadas en `known_until`, y el tramo de cada fuente |
| `/api/clear-cache` | POST | Limpia caché |

---

## LÍMITES POR TIMEFRAME

**CRÍTICO: Deben coincidir en backend Y frontend**

```python
MAX_DAYS_BY_INTERVAL = {
    "1": 730,    # 1 minuto: 2 años (1,051,200 velas) - BACKTESTING
    "3": 10,     # 3 minutos: máx 10 días
    "5": 1825,   # 5 minutos: 5 años (525,600 velas) - BACKTESTING
    "15": 1825,  # 15 minutos: 5 años (175,200 velas) - BACKTESTING
    "30": 1825,  # 30 minutos: 5 años
    "60": 1825,  # 1 hora: 5 años (43,800 velas)
    "120": 1825, # 2 horas: 5 años
    "240": 1825, # 4 horas: 5 años (10,950 velas)
    "D": 1825,   # Diario: 5 años
    "W": 1825    # Semanal: 5 años
}
```

### Configuración de Backtesting (BACKTESTING_CONFIG)

```python
BACKTESTING_CONFIG = {
    "1m": { "interval": "1", "days": 730, "subdivisions": { "interval": "1", "count": 1, "days": 730 } },
    "5m": { "interval": "5", "days": 1825, "subdivisions": { "interval": "1", "count": 5, "days": 730 } },
    "15m": { "interval": "15", "days": 1825, "subdivisions": { "interval": "5", "count": 3, "days": 1825 } },
    "1h": { "interval": "60", "days": 1825, "subdivisions": { "interval": "15", "count": 4, "days": 1825 } },
    "4h": { "interval": "240", "days": 1825, "subdivisions": { "interval": "60", "count": 4, "days": 1825 } }
}
```

**Notas:**
- Open Interest usa resolucion real del timeframe (1m/5m→5min OI, 15m→15min OI, 1h→1h OI, 4h→4h OI). No hay forward-fill.
- Cobertura historica OI: 5min ~416 dias, 15min ~1249 dias, 1h/4h ~2268 dias (limites de Bybit)
- MAX_OI_REQUESTS = 600 (hasta 120,000 puntos por descarga)
- Subdivisiones tienen su propio campo `days` independiente del timeframe principal
- La fecha de inicio por defecto varia por timeframe (1m=30d atras, 5m=90d, 15m=6mo, 1h=1yr, 4h=2yr)

---

# ⭐ SISTEMA DOUBLE TOP/BOTTOM (Documentación Detallada)

Este sistema fue complejo de implementar. Requirió múltiples iteraciones para:
1. Manejar correctamente las fechas y timestamps
2. Implementar sistema de chunks para evitar sesgo de supervivencia
3. Sincronizar el playback con la visualización de patrones
4. Optimizar carga de datos (~11MB de velas para 3 años)

## Arquitectura General

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    DOUBLE TOP/BOTTOM DETECTION SYSTEM                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐                    ┌─────────────────────────────────┐ │
│  │   FRONTEND      │                    │        BACKEND                  │ │
│  │   (React)       │                    │        (FastAPI)                │ │
│  │                 │                    │                                 │ │
│  │ BacktestingApp  │──── Velas ────────▶│  POST /api/double-topbottom/   │ │
│  │      ↓          │    (~11MB)         │       detect                    │ │
│  │ IndicatorManager│                    │         ↓                       │ │
│  │      ↓          │                    │  DoubleTopBottomDetector        │ │
│  │ DTBIndicator    │                    │    .detect_patterns()           │ │
│  │                 │                    │         ↓                       │ │
│  │                 │◀── Chunks ─────────│  divide_patterns_into_chunks()  │ │
│  │                 │   metadata         │         ↓                       │ │
│  │                 │                    │  DTB_PATTERNS_CACHE[key]        │ │
│  │                 │                    │    (por trimestres)             │ │
│  │                 │                    │                                 │ │
│  │ precalculate    │──── upTo ─────────▶│  POST /api/double-topbottom/   │ │
│  │ WithCandles()   │   timestamp        │       chunk                     │ │
│  │      ↓          │                    │         ↓                       │ │
│  │ fetchPatterns   │◀── Patrones ───────│  Filtra por timestamp           │ │
│  │ UpTo()          │   filtrados        │  (evita sesgo supervivencia)    │ │
│  │      ↓          │                    │                                 │ │
│  │ renderOverlay() │                    │                                 │ │
│  │  (filtra por    │                    │                                 │ │
│  │   playbackTime) │                    │                                 │ │
│  │                 │                    │                                 │ │
│  └─────────────────┘                    └─────────────────────────────────┘ │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Flujo de Detección (Backend)

### 1. Endpoint Principal: `/api/double-topbottom/detect`

```python
@app.post("/api/double-topbottom/detect")
async def detect_double_topbottom(request: Request):
    # Body esperado:
    # {
    #   "symbol": "BTCUSDT",
    #   "interval": "240",      # 4 horas
    #   "days": 730,            # 2 años de datos
    #   "config": {...},        # Configuración del detector
    #   "candles": [...],       # OPCIONAL: velas (solo primera vez)
    #   "backtesting": true     # OPCIONAL: sin velas en memoria responde needsCandles
    # }
```

**Flujo interno:**

```
1. Recibe request con symbol, interval, days, config
   ↓
2. Verifica si las velas están en caché (DTB_CANDLES_CACHE)
   - SI: Usa caché (~instantáneo)
   - NO, en backtesting: responde needsCandles y el frontend las reenvía
   - NO, fuera de backtesting: pide velas recientes a Bybit
   ↓
3. Crea instancia de DoubleTopBottomDetector
   ↓
4. detector.detect_patterns(symbol, candles, config)
   ↓
5. Serializa patrones con serialize_pattern()
   ↓
6. divide_patterns_into_chunks() → por trimestre (2023-Q1, 2023-Q2, etc.)
   ↓
7. Guarda en DTB_PATTERNS_CACHE[cache_key]
   ↓
8. Retorna metadata de chunks (NO los patrones completos)
   {
     "success": true,
     "cached": true,
     "chunks": ["2022-Q1", "2022-Q2", ...],
     "totalPatterns": 150,
     "message": "Use /api/double-topbottom/chunk para obtenerlos"
   }
```

### 2. Endpoint de Chunks: `/api/double-topbottom/chunk`

```python
@app.post("/api/double-topbottom/chunk")
async def get_dtb_chunk(request: Request):
    # Body esperado (opción A - chunk específico):
    # {
    #   "symbol": "BTCUSDT",
    #   "interval": "240",
    #   "chunk": "2023-Q1"
    # }
    #
    # Body esperado (opción B - hasta timestamp):
    # {
    #   "symbol": "BTCUSDT",
    #   "interval": "240",
    #   "upTo": 1705500000000  # Timestamp límite
    # }
```

**Flujo con `upTo` (usado por playback):**

```
1. Recibe upTo timestamp (ej: fecha actual del playback)
   ↓
2. Calcula limit_key = timestamp → "2023-Q4" (trimestre)
   ↓
3. Itera chunks ordenados cronológicamente
   ↓
4. Para cada chunk <= limit_key:
   - Filtra patrones donde secondExtreme.timestamp <= upTo
   ↓
5. Retorna SOLO patrones que ya "existían" en ese momento
   (evita sesgo de supervivencia)
```

### 3. Algoritmo de Detección (DoubleTopBottomDetector)

```python
def detect_patterns(self, symbol, candles, config):
    """
    Pipeline de detección en 7 pasos:

    1. FIND LOCAL EXTREMES
       - Busca máximos locales (highs) para Double Tops
       - Busca mínimos locales (lows) para Double Bottoms
       - Usa ventana de N velas a cada lado (candlesPerExtreme)

    2. FILTER BY VOLUME (opcional)
       - Si requireHighVolumeAtExtremes.enabled:
         - Busca volumen alto en ventana ±N velas del extremo
         - zScoreThresholdFirst: umbral para primer extremo (default 1.5)
         - zScoreThresholdSecond: umbral para segundo extremo (default 0.5)

    3. FIND DOUBLE TOPS
       - Emparejar highs que cumplan:
         - Distancia: minCandlesBetween <= dist <= maxCandlesBetween
         - Precio similar: abs(h1-h2)/avg < priceMarginPercent
         - Sin breakout entre extremos: maxBreakoutPercent
         - Patrones de rechazo (Shooting Star, Engulfing Bearish)

    4. FIND DOUBLE BOTTOMS
       - Igual que tops pero con lows
       - Patrones de rechazo: Hammer, Engulfing Bullish

    5. POST-PATTERN VALIDATION
       - Verifica movimiento direccional después del patrón
       - Double Top: precio debe bajar después
       - Double Bottom: precio debe subir después
       - Añade bonus de confianza si se confirma

    6. FILTER DUPLICATES
       - Elimina patrones en misma zona precio/tiempo
       - Mantiene el de mayor confianza

    7. MOMENTUM CONFIRMATION (Phase 2, opcional)
       - Busca patrones de momentum después del segundo extremo
       - Marubozu, White Soldiers, Black Crows, Big Body
       - Añade entry_signal con dirección LONG/SHORT
    """
```

### 4. Estructura de un Patrón Detectado

```python
@dataclass
class DoublePattern:
    type: str                    # "DOUBLE_TOP" o "DOUBLE_BOTTOM"
    timestamp: int               # Timestamp del segundo extremo (confirmación)
    confidence: float            # 0-100

    first_extreme: Dict          # {
                                 #   timestamp: int,
                                 #   price: float,
                                 #   candle_index: int,
                                 #   rejection_pattern: str,  # "HAMMER", "SHOOTING_STAR", etc.
                                 #   pattern_quality: float,
                                 #   volume_zscore: float
                                 # }

    second_extreme: Dict         # Misma estructura que first_extreme

    level_price: float           # Precio del nivel (resistencia/soporte)
                                 # Double Top: min(h1, h2) - el techo que no pudo romper
                                 # Double Bottom: max(l1, l2) - el piso que no pudo romper

    price_variance: float        # % diferencia entre extremos

    entry_signal: Optional[Dict] # Solo si momentum habilitado:
                                 # {
                                 #   has_momentum: bool,
                                 #   momentum_pattern: str,  # "BULLISH_MARUBOZU", etc.
                                 #   entry_candle_timestamp: int,
                                 #   entry_price: float,
                                 #   direction: str,  # "LONG" o "SHORT"
                                 #   momentum_quality: float,
                                 #   volume_zscore: float
                                 # }

    candles_between_extremes: int
    pattern_duration_hours: float
    volume_average: float
    meets_volume_criteria: bool
```

## Flujo Frontend (DoubleTopBottomIndicator.js)

### 1. Inicialización

```javascript
class DoubleTopBottomIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 90, config = {}) {
    // 🎯 CRÍTICO: Modo backtesting deshabilita fetch directo
    this.backtestingMode = config.backtestingMode || false;

    // Flag para optimización: solo enviar velas la primera vez
    this.candlesSentToBackend = false;

    // Sistema de alertas
    this.alertedPatterns = new Set();
    this.alertCooldownMs = 5 * 60 * 1000; // 5 min

    // Control de playback
    this._currentPlaybackTime = null;
  }
}
```

### 2. Precálculo con Velas (Modo Backtesting)

```javascript
async precalculateWithCandles(candles, playbackStartTime = null) {
  /**
   * FLUJO:
   * 1. Envía velas al backend (solo primera vez, ~11MB)
   * 2. Backend detecta patrones y los divide en chunks
   * 3. Frontend solicita TODOS los patrones (upTo: 2030)
   * 4. Guarda en this.patterns
   * 5. Inicializa _currentPlaybackTime
   * 6. renderOverlay filtrará según avanza el playback
   */

  const payload = {
    symbol: this.symbol,
    interval: this.interval,
    days: this.days,
    config: this.config
  };

  // Solo primera vez: enviar velas
  if (!this.candlesSentToBackend) {
    payload.candles = candles;  // ~11MB para 3 años de 4h
  }

  const response = await fetch(`${API_BASE_URL}/api/double-topbottom/detect`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  // Si el backend tiene chunks, solicitar todos
  if (result.success && result.cached && result.chunks) {
    const futureTimestamp = new Date(2030, 0, 1).getTime();
    const patternsResult = await this.fetchPatternsUpTo(futureTimestamp);
    this.patterns = patternsResult.patterns;

    // Inicializar tiempo de playback
    this._currentPlaybackTime = playbackStartTime || candles[0].timestamp;
  }
}
```

### 3. Solicitar Patrones por Chunks

```javascript
async fetchPatternsUpTo(timestamp) {
  /**
   * Solicita patrones hasta cierto timestamp.
   * El backend filtra y solo devuelve patrones que
   * ya "existían" en ese momento temporal.
   */
  const response = await fetch(`${API_BASE_URL}/api/double-topbottom/chunk`, {
    method: 'POST',
    body: JSON.stringify({
      symbol: this.symbol,
      interval: this.interval,
      upTo: timestamp  // Solo patrones hasta esta fecha
    })
  });

  return await response.json();
}
```

### 4. Actualización Durante Playback

```javascript
async updatePlaybackDate(timestamp) {
  // Simplemente guarda el timestamp actual
  // El filtrado se hace en renderOverlay
  this._currentPlaybackTime = timestamp;
}
```

### 5. Renderizado (Filtrado por Tiempo)

```javascript
renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
  // 🎯 CRÍTICO: Filtrar patrones según el tiempo del playback
  // Esto evita el sesgo de supervivencia (ver patrones futuros)
  const currentTime = this._currentPlaybackTime || Date.now();

  const visiblePatterns = this.patterns.filter(pattern =>
    pattern.secondExtreme.timestamp <= currentTime
  );

  // Solo renderizar patrones que ya existían en currentTime
  visiblePatterns.forEach(pattern => {
    // Verificar si está en rango de precios visible
    if (pattern.levelPrice < minPrice || pattern.levelPrice > maxPrice) {
      return;  // Fuera del rango visible
    }

    // Dibujar línea de nivel
    if (this.config.visualization.showLines) {
      this._drawLevelLine(ctx, pattern, ...);
    }

    // Dibujar iconos de rechazo en extremos
    if (this.config.visualization.showRejectionIcons) {
      this._drawRejectionIcons(ctx, pattern, ...);
    }

    // Dibujar momentum y flecha de entrada (si Phase 2 habilitada)
    if (pattern.entrySignal?.has_momentum) {
      this._drawMomentumIcon(ctx, pattern, ...);
      this._drawEntryArrow(ctx, pattern, ...);
    }
  });
}
```

## Sistema de Chunks por Trimestre

### Por qué se implementó

**Problema original:** Al cargar 3 años de datos (730 días en 4h = ~4380 velas), la detección producía cientos de patrones. Enviarlos todos al frontend de una vez causaba:
1. Respuestas HTTP enormes
2. Sesgo de supervivencia (ver patrones "futuros" durante backtesting)

**Solución:** Dividir patrones en chunks trimestrales y filtrar por timestamp.

### Implementación Backend

```python
def divide_patterns_into_chunks(patterns):
    """
    Divide patrones en chunks por trimestre.

    Ejemplo de salida:
    {
        "2022-Q1": [pattern1, pattern2, ...],
        "2022-Q2": [pattern3, pattern4, ...],
        "2022-Q3": [...],
        ...
    }
    """
    chunks = defaultdict(list)

    for pattern in patterns:
        # Usar timestamp del segundo extremo (confirmación)
        dt = datetime.fromtimestamp(pattern['timestamp'] / 1000)
        quarter = (dt.month - 1) // 3 + 1
        chunk_key = f"{dt.year}-Q{quarter}"
        chunks[chunk_key].append(pattern)

    return dict(sorted(chunks.items()))
```

### Caché en Memoria

```python
# En main.py
DTB_CANDLES_CACHE = {}    # Velas: ~11MB por símbolo/intervalo
DTB_PATTERNS_CACHE = {}   # Patrones divididos por chunks

# Estructura de DTB_PATTERNS_CACHE:
# {
#   "BTCUSDT_240": {
#     "2022-Q1": [p1, p2, ...],
#     "2022-Q2": [p3, p4, ...],
#     ...
#   },
#   "ETHUSDT_240": {...}
# }
```

## Problemas Resueltos y Lecciones Aprendidas

### 1. Orden de Velas (Cronológico vs Inverso)

**Problema:** Bybit API devuelve velas en orden inverso (recientes primero).

**Síntomas:** Patrones detectados con timestamps incorrectos, índices de velas invertidos.

**Solución:** El backend verifica y logea el orden:
```python
# En double_topbottom_detector.py:99-108
if len(candles) > 0:
    first_ts = candles[0].get('timestamp', 0)
    last_ts = candles[-1].get('timestamp', 0)
    print(f"Orden: {'OK Cronológico' if last_ts > first_ts else 'WARN INVERSO'}")
```

**Fix:** El frontend invierte las velas antes de enviar si es necesario.

### 2. Timestamps de Patrones vs Velas Visibles

**Problema:** Los patrones se detectaban pero no se dibujaban.

**Diagnóstico:**
```javascript
// En renderOverlay - logs de diagnóstico
console.log(`Rango timestamps PATRONES:`);
console.log(`  Inicio: ${formatDate(minPatternTimestamp)}`);
console.log(`  Fin: ${formatDate(maxPatternTimestamp)}`);
console.log(`Rango timestamps VELAS VISIBLES:`);
console.log(`  Inicio: ${formatDate(minVisibleTimestamp)}`);
console.log(`  Fin: ${formatDate(maxVisibleTimestamp)}`);
```

**Causa:** Los timestamps de patrones no coincidían con los de las velas visibles (diferente rango temporal).

**Solución:** Verificar que `timeToX()` retorna valores válidos antes de dibujar.

### 3. Sesgo de Supervivencia en Backtesting

**Problema:** Durante el playback, se veían patrones que aún no se habían formado.

**Ejemplo:** En fecha 2023-06-01 del playback, se veían patrones de 2023-09.

**Solución:**
1. Backend: Dividir patrones en chunks temporales
2. Frontend: Filtrar por `_currentPlaybackTime` en `renderOverlay`

```javascript
const visiblePatterns = this.patterns.filter(pattern =>
  pattern.knownAt <= currentTime && (pattern.replacedAt === null || currentTime < pattern.replacedAt)
);
```

`knownAt` es el cierre de la última vela que usa el patrón. El segundo extremo no basta: necesita velas a su derecha.

### 4. Optimización de Carga de Velas (~11MB)

**Problema:** Enviar 11MB de velas en cada request era lento.

**Solución:** Flag `candlesSentToBackend`:
```javascript
if (!this.candlesSentToBackend) {
  payload.candles = candles;  // Solo primera vez
  this.candlesSentToBackend = true;
}
// Subsecuentes requests usan caché del backend
```

### 5. Level Price Incorrecto

**Problema inicial:** Se usaba promedio de extremos como `level_price`.

**Problema:** No representa el nivel real de resistencia/soporte.

**Fix:**
```python
# Para Double Top: el nivel es el TOP MÁS BAJO
# (el precio que ambos extremos NO pudieron superar)
resistance_level = min(h1_price, h2_price)

# Para Double Bottom: el nivel es el BOTTOM MÁS ALTO
# (el precio que ambos extremos NO pudieron romper)
support_level = max(l1_price, l2_price)
```

### 6. Breakout Entre Extremos

**Problema:** Patrones inválidos donde el precio rompía el primer extremo entre los dos picos.

**Solución:** Validación de breakout:
```python
breakout_tolerance_pct = config.get('maxBreakoutPercent', 2.0) / 100.0
candles_between = all_candles[h1['candle_index']:h2['candle_index'] + 1]

highest_high_between = max(c.get('high', 0) for c in candles_between)
breakout_amount = (highest_high_between - h1_price) / h1_price

if breakout_amount > breakout_tolerance_pct:
    # Patrón invalidado por breakout
    continue
```

## Configuración del Indicador

### Config por Defecto

```javascript
getDefaultConfig() {
  return {
    enabled: true,

    doubleTopBottom: {
      lookbackCandles: 50,
      candlesPerExtreme: 5,       // Velas a cada lado para confirmar extremo
      priceMarginPercent: 2.0,    // Max diferencia entre extremos
      minCandlesBetween: 5,
      maxCandlesBetween: 50,
      maxBreakoutPercent: 2.0,    // Max % de breakout permitido

      rejectionPatterns: {
        hammer: true,
        shootingStar: true,
        bullishEngulfing: true,
        bearishEngulfing: true
      },

      volumeFilter: {
        enabled: false,
        zScoreThreshold: 1.5,
        zScorePeriod: 20
      },

      requireHighVolumeAtExtremes: {
        enabled: false,
        zScoreThresholdFirst: 1.5,
        zScoreThresholdSecond: 0.5,
        zScorePeriod: 20,
        volumeWindowCandles: 3
      }
    },

    momentumConfirmation: {
      enabled: false,
      patterns: {
        marubozu: { enabled: true, minBodyRatio: 0.8 },
        soldiers_crows: { enabled: true, minBodyRatio: 0.6 },
        bigBody: { enabled: true, minBodyRatio: 0.7, allowBigWick: true }
      },
      lookbackAfterPattern: 10,
      requireMomentum: false
    },

    filters: {
      minConfidence: 60,
      requireBothRejections: true,
      minPatternDuration: 3,      // horas
      maxPatternDuration: 72,     // horas
      applyPostValidationToRealtimeSignals: false,
      postPatternValidationCandles: 5,
      minPostPatternMovePercent: 0.5,
      postPatternConfidenceBonus: 20,
      duplicatePriceTolerancePercent: 2.0,
      duplicateTimeToleranceHours: 24
    },

    visualization: {
      showLines: true,
      showRejectionIcons: true,
      showMomentumIcons: true,
      showEntryArrows: true,
      colors: {
        doubleTopLine: '#FF5722',
        doubleBottomLine: '#4CAF50',
        rejectionIcon: '#FFC107',
        entryLong: '#00E676',
        entryShort: '#FF1744'
      }
    },

    alertsEnabled: false
  };
}
```

---

# ⭐ INDICADOR S&R v2 (Support & Resistance basado en Swing Points)

Mapa de los swings que el precio no ha superado. Medido en BTC de 2023 a 2026 contra un nivel al azar a la misma distancia, ni estos niveles ni el filtro de volumen aguantan más que un precio cualquiera: no presentar el filtro ni el strength como calidad del nivel.

## Archivos

| Archivo | Descripción |
|---------|-------------|
| `swingLevels.js` | `LevelBook`: recorre las velas cerradas y lleva los niveles |
| `SupportResistance2Indicator.js` | Parámetros y dibujo |
| `SupportResistance2Settings.jsx` | Modal, con el efecto de los valores antes de aplicar |

## Reglas

```
1. Un swing se conoce cuando cierra la última vela de su derecha. Empatar con una vecina no cuenta
2. Un swing nuevo refuerza el nivel activo más cercano a menos de clusterDistancePct de su primer toque.
   Si no hay ninguno, abre un nivel
3. El filtro de volumen deja fuera los swings con z-score menor a minVolumeZScore. Cada z se calcula con
   las volumeLookbackBars velas que terminan en el swing y no cambia después
4. Activo: ninguna vela cerró más allá de todos sus toques. Una mecha sin cierre no lo rompe
5. Roto: se dibuja punteado brokenKeepBars velas, de cualquier lado del precio
6. La vela en formación no confirma ni rompe nada: solo mueve el precio actual
7. priceRangePct decide lo que se dibuja, no lo que existe
8. strength = toques × 2 + z promedio (0 a 3) + recencia (0 a 3), con tope de 10.
   La recencia baja a 0 en 1000 velas sin toques
```

## Parámetros de Configuración

| Parámetro | Default | Descripción |
|-----------|---------|-------------|
| `swingBars` | 5 | Velas a cada lado para confirmar swing (2-15) |
| `priceRangePct` | 10.0 | % arriba/abajo del precio que se dibuja |
| `clusterDistancePct` | 0.3 | % de distancia al primer toque para reforzar un nivel |
| `minTouches` | 1 | Toques mínimos para dibujar un nivel |
| `maxLevels` | 5 | Máximo por lado, para activos y rotos por separado |
| `minVolumeZScore` | 0 | Filtro de volumen (0 = sin filtro) |
| `volumeLookbackBars` | 50 | Velas para calcular el z-score de cada swing |
| `brokenKeepBars` | 50 | Velas que sigue dibujado un nivel roto |

Se guardan en `support_resistance_2_config_{símbolo}`, valen para todos los marcos y el indicador los lee al crearse. `cleanLevelConfig()` descarta lo que no sea número y acota los valores a los rangos del modal: un `null` guardado o un 0 en `swingBars` no llegan al libro.

## Visualización

- **Líneas rojas**: Resistencias, nacidas de máximos
- **Líneas verdes**: Soportes, nacidos de mínimos
- **Líneas sólidas**: Niveles activos
- **Líneas punteadas**: Rotos hace poco. Una roja puede quedar debajo del precio
- **Etiquetas**: Lado izquierdo, formato `R1: $price (Nt, S★, z Z)`

## Uso en Backtesting

- Siempre usa `priceContext.knownCandles`
- `LevelBook.advance()` revisa solo las velas cerradas nuevas: cuesta menos de 0.2 ms por tick
- Si se retrocede o cambian las velas empieza de cero: 108 ms en 15m, 312 ms en 5m y 418 ms en 1m, con todo el historial
- `_breakLevels()` guarda el nivel activo más cercano: solo recorre los demás si un cierre lo pasa
- La vista previa del modal espera 250 ms sin cambios y no corre con las casillas de mostrar
- El z-score crudo favorece las horas de más volumen: con z>=1.5 pasan 2.5 veces más swings de las 14h UTC que de las 3h. No se ajusta por hora

---

## OTROS COMPONENTES PRINCIPALES

### BacktestingApp.jsx (Raíz)

Estado global de la aplicación:

```javascript
const [symbol, setSymbol] = useState('');
const [activeTimeframe, setActiveTimeframe] = useState('15m');
const [marketData, setMarketData] = useState(null);
const [currentTime, setCurrentTime] = useState(null);
const [isPlaying, setIsPlaying] = useState(false);
const [playbackSpeed, setPlaybackSpeed] = useState(1);

// Estado por timeframe independiente
const [tabStates, setTabStates] = useState({
  '15m': { indicatorStates, vpConfig, ... },
  '1h': { ... },
  '4h': { ... }
});
```

### TimeController.js (Control Temporal)

Control de reproducción con subdivisiones intravela:

```javascript
subdivisionConfig = {
  "15m": { interval: 5, count: 3 },   // 3 estados de 5min
  "1h": { interval: 15, count: 4 },   // 4 estados de 15min
  "4h": { interval: 60, count: 4 }    // 4 estados de 1h
};
```

### OrderManager.js (Gestión de Órdenes)

**Tipos de órdenes:**
1. **Market**: Ejecuta inmediatamente
2. **Limit**: Ejecuta si precio llega al nivel
3. **Stop**: Ejecuta si precio cae por debajo (SL)

**Métricas calculadas:**
- Unrealized PnL, Realized PnL
- Win Rate, Drawdown máximo, Sharpe Ratio

---

## PATRONES DETECTADOS

### Rejection Patterns

| Patrón | Emoji | Dirección |
|--------|-------|-----------|
| HAMMER | 🔨 | Alcista |
| SHOOTING_STAR | ⭐ | Bajista |
| ENGULFING_BULLISH | 📈 | Alcista |
| ENGULFING_BEARISH | 📉 | Bajista |
| DOJI_DRAGONFLY | 🐉 | Alcista |
| DOJI_GRAVESTONE | 🪦 | Bajista |

### Double Top/Bottom

| Patrón | Emoji | Dirección |
|--------|-------|-----------|
| DOUBLE_TOP | 🔻 (DT) | Bajista (SHORT) |
| DOUBLE_BOTTOM | 🔺 (DB) | Alcista (LONG) |

---

## CACHÉ

### Backend

```python
DTB_CANDLES_CACHE = {}    # Velas: ~11MB por símbolo/intervalo
DTB_PATTERNS_CACHE = {}   # Patrones divididos por chunks trimestrales
```

**TTL general:** 30 minutos (CACHE_MAX_AGE = 1800)

### Frontend (localStorage)

```javascript
'double_topbottom_config_{symbol}'
'rejection_pattern_config_{symbol}'
'volumeprofile_fixed_ranges_v2'
'backtesting_session_{sessionId}'
```

---

## TROUBLESHOOTING

**Patrones DTB no aparecen:**
1. Verificar que el indicador está habilitado en config
2. Verificar logs de backend: `[PRUEBA_DBT]`
3. Verificar que hay suficientes velas (mínimo 50)
4. Verificar rango de precios visible vs rango de patrones
5. Verificar `_currentPlaybackTime` está correctamente inicializado

**Patrones aparecen en fechas incorrectas:**
1. Verificar orden de velas (cronológico vs inverso)
2. Verificar que `timeToX()` devuelve valores correctos
3. Verificar logs de timestamps en renderOverlay

**Carga muy lenta:**
1. Primera carga siempre es lenta (~11MB de velas)
2. Subsecuentes deberían usar caché
3. Verificar `candlesSentToBackend` flag

**Sesgo de supervivencia (ver patrones futuros):**
1. Verificar `_currentPlaybackTime` se actualiza con playback
2. Verificar filtro en `renderOverlay`:
   ```javascript
   pattern.knownAt <= currentTime
   ```

---

## STACK TECNOLÓGICO

| Capa | Tecnología |
|------|-----------|
| **Backend** | Python 3.10+, FastAPI, Uvicorn |
| **HTTP Client** | httpx |
| **Frontend** | React 18, Vite |
| **Gráficos** | uPlot, Chart.js |
| **Export** | ExcelJS, html2canvas |
| **Utilidades** | Lodash |

---

## DIFERENCIAS CON WATCHLIST

| Aspecto | Backtester | Watchlist |
|---------|-----------|----------|
| **Modo** | Histórico (reproducción) | Tiempo real (WebSocket) |
| **Timeframes** | 5 fijos (1m, 5m, 15m, 1h, 4h) | Múltiples (1m-D) |
| **Datos** | Bybit REST API | Bybit WebSocket |
| **Órdenes** | Simuladas | No ejecuta |
| **TimeController** | SÍ | NO |
| **DTB Chunks** | SÍ (evita sesgo) | NO (tiempo real) |

---

# FIX: CHART FLIP BUG DURANTE PLAYBACK (Octubre 2026)

## Problema

Al hacer click o drag sobre el chart durante el playback del backtester, el gráfico se "volteaba" mostrando velas históricas antiguas y ocultando las barras recientes, haciendo imposible analizar.

## Causa Raíz

En `MiniChart.jsx`, `handleMouseMove` usaba `allCandlesRef` (~4380 velas) para `maxOffset` y `drawChart()`, pero el offset almacenado estaba dimensionado para `candlesRef` (~500 velas de playback). La fórmula `startIdx = displayCandles.length - candlesPerScreen - offset` producía índices incorrectos al saltar de ~500 a ~4380.

## Fix (MiniChart.jsx)

```javascript
// Línea 1350 - maxOffset: ahora usa candlesRef en vez de allCandlesRef
const maxOffset = Math.max(0, candlesRef.current.length - candlesPerScreen);

// Línea 1362 - drawChart: ahora pasa candlesRef en vez de allCandlesRef
drawChart(candlesRef.current, lastPriceRef.current, null, null);
```

`centerOnTimestamp` y `renderOverlays` siguen usando `allCandlesRef` correctamente (son casos diferentes).

---

# EXPANSIÓN A 5 AÑOS DE DATOS (Octubre 2026)

## Problema

Los timeframes 5m, 15m, 1h y 4h estaban limitados a 2 años (730 días), lo cual impedía hacer backtesting en fechas anteriores a 2024. Además, el caché de backtesting usaba JSON sin comprimir, ocupando mucho espacio en disco.

## Cambios Implementados

### 1. Expansión de MAX_DAYS_BY_INTERVAL

| Timeframe | Antes | Después | Velas máx |
|-----------|-------|---------|-----------|
| 1m | 365 (1 año) | 730 (2 años) | 1,051,200 |
| 5m | 1095 (3 años) | 1825 (5 años) | 525,600 |
| 15m | 730 (2 años) | 1825 (5 años) | 175,200 |
| 1h | 730 (2 años) | 1825 (5 años) | 43,800 |
| 4h | 730 (2 años) | 1825 (5 años) | 10,950 |

### 2. Caché con Compresión Gzip

**Archivo:** `backend/main.py`

- Los archivos de caché de backtesting ahora se guardan como `.json.gz` (~90% reducción de tamaño)
- Migración automática: al iniciar, archivos `.json` existentes se comprimen a `.json.gz` y se elimina el original
- Lectura/escritura transparente con `gzip.open()`

### 3. Carga Incremental de Velas

Cuando el caché existe pero tiene más de 1 hora de antigüedad:
1. Lee velas existentes del caché
2. Identifica el timestamp de la última vela
3. Descarga solo velas nuevas desde ese timestamp
4. Mergea con deduplicación por timestamp
5. Guarda el caché actualizado

Esto evita re-descargar 500,000+ velas cuando solo faltan unas pocas recientes.

### 4. Auto-detección de Caché Incompleto

Si el caché tiene **menos del 80%** de las velas esperadas para los días configurados, se descarta y se hace una descarga completa. Esto resuelve el caso donde se expanden los días (ej: de 2 años a 5 años) y el caché viejo no cubre el rango completo.

### 5. Fecha de Inicio Dinámica por Timeframe

La fecha por defecto donde inicia el playback varía según el timeframe:

| Timeframe | Inicio por defecto |
|-----------|--------------------|
| 1m | 30 días atrás |
| 5m | 90 días atrás |
| 15m | 6 meses atrás |
| 1h | 1 año atrás |
| 4h | 2 años atrás |

El buffer para la fecha de inicio es de 3 días para 1m/5m/15m y 7 días para 1h/4h.

### Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `backend/main.py` | MAX_DAYS_BY_INTERVAL, BACKTESTING_CONFIG, gzip cache, incremental loading, auto-detect |
| `frontend/src/components/backtesting/BacktestingApp.jsx` | Fecha de inicio dinámica por timeframe |
| `frontend/src/components/backtesting/TimeframeTabs.jsx` | Labels actualizados (ej: "5m (5Y)") |

---

# VP FIXED RANGE DESDE RECTÁNGULOS (Octubre 2026)

## Funcionalidad

Permite crear Volume Profiles de rango fijo directamente desde rectángulos dibujados en el chart, sin necesidad de ingresar fechas manualmente.

## Flujo de Uso

1. El usuario dibuja un rectángulo en el chart (herramienta de dibujo)
2. Abre el modal "VP Fixed Ranges" → click en "+ Nuevo Rango"
3. En la sección "Desde rectangulo del chart", ve la lista de rectángulos disponibles
4. Click en "Usar" junto al rectángulo deseado
5. Se crea el VP Fixed Range usando el rango temporal del rectángulo
6. El rectángulo puede borrarse sin afectar al VP ya creado

## Implementación

### FixedRangeProfilesManager.jsx

- **Props nuevas**: `chartRectangles` (array de rectángulos del chart), `onStartDrawRectangle` (callback)
- **Deduplicación**: Sistema `existingRanges` (Set) previene crear múltiples VP del mismo rectángulo via `sourceRectId`
- **UI**: Sección "Desde rectangulo del chart" con lista de rectángulos, botón "+ Dibujar", botón "Seleccionar"
- Cada rectángulo muestra rango de precios, fechas, y badge si ya tiene VP creado

### MiniChart.jsx

- **Estado**: `chartRectangles` - array de shapes tipo rectangle del DrawingManager
- **Función** `updateChartRectangles()`: Filtra shapes del DrawingManager por `type === 'rectangle'`
- **Handler** `handleCreateFixedRangeProfile()`: Pasa `sourceRectId` al IndicatorManager
- **Handler** `handleStartDrawRectangle()`: Activa herramienta de rectángulo y cierra modal
- Se llama `updateChartRectangles()` después de cargar/guardar dibujos

### Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `FixedRangeProfilesManager.jsx` | UI para seleccionar rectángulos, deduplicación |
| `MiniChart.jsx` | Estado chartRectangles, handlers, integración |

---

# FIX: DELETE KEY NO BORRABA SHAPES (Octubre 2026)

## Problema

El usuario podía seleccionar shapes (rectángulos, líneas, etc.) con el mouse, pero al presionar Delete, el shape no se borraba. La única opción era usar "Limpiar todo" que borraba todos los dibujos.

## Causa Raíz

El polling de dibujos (cada 30s) llama `loadShapes()` que reemplaza el array `this.shapes` con nuevas instancias deserializadas. Cuando el usuario seleccionaba un shape, `this.selectedShape` apuntaba a la instancia original. Después del polling, esa instancia ya no existía en el nuevo array.

```
1. Usuario selecciona shape → selectedShape = instanciaA
2. Polling (30s) → loadShapes() → shapes = [instanciaB, instanciaC, ...] (nuevas instancias)
3. Usuario presiona Delete → indexOf(instanciaA) en [instanciaB, instanciaC] → retorna -1
4. Deletion falla silenciosamente
```

## Fix (DrawingToolManager.js)

### 1. `deleteSelected()` - Búsqueda por ID como fallback

```javascript
deleteSelected() {
  if (this.selectedShape) {
    let index = this.shapes.indexOf(this.selectedShape);
    // Fallback: buscar por ID si la referencia es obsoleta
    if (index === -1 && this.selectedShape.id) {
      index = this.shapes.findIndex(s => s.id === this.selectedShape.id);
    }
    if (index !== -1) {
      this.shapes.splice(index, 1);
      this.selectedShape = null;
      this.saveToHistory();
    }
  }
}
```

### 2. `loadShapes()` - Re-mapear selectedShape

```javascript
loadShapes(shapesData) {
  const prevSelectedId = this.selectedShape?.id || null;
  this.shapes = shapesData.map(data => this.deserializeShape(data)).filter(s => s !== null);
  // Re-mapear selectedShape a nueva instancia
  if (prevSelectedId) {
    this.selectedShape = this.shapes.find(s => s.id === prevSelectedId) || null;
  }
  this.history = [this.shapes.map(s => s.serialize())];
  this.historyIndex = 0;
}
```

### 3. `restoreFromHistory()` - Preservar selección en undo/redo

Mismo patrón: guarda `prevSelectedId` antes de reemplazar shapes y re-mapea después.

### Archivo Modificado

`frontend/src/components/drawing/DrawingToolManager.js` - métodos `deleteSelected`, `loadShapes`, `restoreFromHistory`
