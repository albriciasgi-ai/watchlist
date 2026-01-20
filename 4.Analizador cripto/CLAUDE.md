# CLAUDE.md - Analizador Cripto

Guia para Claude Code al trabajar con esta aplicacion.

---

## REGLAS DEL PROYECTO

### Idioma
**IMPORTANTE**: Comunicarse SIEMPRE en espanol con el usuario. Todos los mensajes, explicaciones y comentarios deben ser en espanol.

### Perfil
Agente programador Python/JavaScript con experiencia en aplicaciones de trading.

### Comportamiento
1. **Autonomia**: Trabajar sin preguntar. Entregar codigo completo y funcional.
2. **Formato visual**: NO modificar estilos, CSS, layouts ni estructura visual existente salvo que se pida explicitamente.
3. **Honestidad**: Si algo no es posible o hay limitaciones, informar claramente.
4. **Calidad**: Revisar exhaustivamente antes de entregar. Ediciones pequenas y precisas.
5. **Encoding**: Evitar tildes y caracteres especiales en codigo fuente para prevenir problemas de encoding.

### Limitaciones conocidas
- No puedo ejecutar codigo directamente para probar
- Las pruebas de funcionamiento las debe hacer el usuario

---

## VISION GENERAL

**Analizador Cripto** es una version simplificada de la Watchlist para analizar UN SOLO simbolo a la vez con todas las funcionalidades de indicadores.

| Aspecto | Valor |
|---------|-------|
| Ubicacion | `4.Analizador cripto/` |
| Puerto Backend | 10000 |
| Puerto Frontend | 10001 |
| Stack | React 18 + Vite + FastAPI |
| Origen | Fork de `2.WatchlistConIndicadores/` |

---

## ESTRUCTURA DEL PROYECTO

```
4.Analizador cripto/
├── backend/
│   ├── main.py                    # Servidor FastAPI (copiado de Watchlist)
│   ├── swing_service.py           # Servicio Swing Detector
│   ├── swing_detector.py          # Algoritmo deteccion swings
│   ├── vwap_service.py            # Servicio VWAP
│   ├── rejection_detector.py      # Detector patrones rechazo
│   ├── double_topbottom_detector.py
│   ├── config/
│   │   └── swing_config.json      # Config persistente Swing
│   ├── cache/                     # Cache datos historicos
│   └── drawings/                  # Dibujos por simbolo (JSON)
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── SingleSymbolAnalyzer.jsx  # Componente principal (NUEVO)
│   │   │   ├── SymbolSelector.jsx        # Selector de simbolo (NUEVO)
│   │   │   ├── MiniChart.jsx             # Grafico con indicadores
│   │   │   ├── *Settings.jsx             # Modales de configuracion
│   │   │   ├── indicators/
│   │   │   │   ├── IndicatorManager.js   # Orquestador
│   │   │   │   ├── SwingDetectorIndicator.js
│   │   │   │   ├── VWAPIndicator.js
│   │   │   │   ├── RejectionPatternIndicator.js
│   │   │   │   └── ... (13 indicadores)
│   │   │   └── drawing/                  # Herramientas dibujo
│   │   ├── hooks/
│   │   │   └── useGlobalAlerts.js
│   │   ├── utils/
│   │   │   ├── IndicatorPreloader.js
│   │   │   ├── IndicatorCache.js
│   │   │   └── Logger.js
│   │   ├── config.js                     # API_BASE_URL = localhost:10000
│   │   ├── main.jsx
│   │   └── styles.css
│   ├── package.json
│   └── vite.config.js                    # Puerto 10001
│
├── START.bat                      # Inicia backend + frontend
├── start_backend.bat
└── start_frontend.bat
```

---

## COMANDOS DE INICIO

### Inicio Rapido (Windows)
```batch
# Doble-click en:
START.bat
```

### Inicio Manual
```batch
# Terminal 1 - Backend
cd backend
.venv\Scripts\activate
uvicorn main:app --reload --port 10000

# Terminal 2 - Frontend
cd frontend
npm install
npm run dev
```

### URLs
- **Frontend**: http://localhost:10001
- **Backend API**: http://localhost:10000
- **Docs API**: http://localhost:10000/docs

---

## COMPONENTES PRINCIPALES

### SingleSymbolAnalyzer.jsx
Componente raiz que reemplaza a `Watchlist.jsx`. Diferencias clave:

- **Un solo simbolo**: En vez de grid de multiples charts, muestra un unico grafico grande
- **SymbolSelector**: Input con autocompletado para cambiar simbolo
- **Todos los indicadores**: Mismas 13 opciones que la Watchlist
- **Modales de config**: Todos los *Settings.jsx funcionan igual

### SymbolSelector.jsx
Componente de seleccion de simbolo con:
- Input de texto con autocompletado
- Dropdown con lista filtrada
- Navegacion con teclado (flechas, Enter, Escape)
- 30 simbolos preconfigurados

### Indicadores Disponibles
1. Volume Delta
2. CVD
3. Volume Profile
4. Open Interest
5. VWAP (con bandas de desviacion)
6. Fibonacci
7. Continuation Patterns
8. Rejection Patterns
9. Double Top/Bottom
10. Support & Resistance
11. Range Detection
12. Swing Detector (High/Low)

---

## CONFIGURACION

### config.js
```javascript
export const API_BASE_URL = "http://localhost:10000";
```
**IMPORTANTE**: Esta URL se usa en TODO el frontend. Si se cambia el puerto, actualizar aqui.

### vite.config.js
```javascript
export default defineConfig({
  plugins: [react()],
  server: {
    port: 10001,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:10000",
        changeOrigin: true,
      },
    },
  },
});
```

### Limites de Dias por Timeframe
```javascript
const MAX_DAYS_BY_INTERVAL = {
  "1": 5,      // 1 minuto: max 5 dias
  "5": 30,     // 5 minutos: max 30 dias
  "15": 90,    // 15 minutos: max 90 dias
  "30": 150,
  "60": 360,   // 1 hora: max 360 dias
  "240": 720,
  "D": 1440,
  "W": 730
};
```

---

## SWING DETECTOR - SINCRONIZACION DE DIAS

### Problema Original
El Swing Detector no graficaba todos los dias seleccionados porque el backend tenia su propia configuracion de `days` independiente del frontend.

### Solucion Implementada

1. **Sincronizacion al iniciar** (`SwingDetectorIndicator.js`):
```javascript
async fetchData() {
  // Sync days with backend first
  await this._syncDaysOnInit();
  // Then fetch signals
  await this.fetchSignals();
}

async _syncDaysOnInit() {
  await fetch(`${API_BASE_URL}/api/swing/config/${this.symbol}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days: this.days })
  });
}
```

2. **Sincronizacion al cambiar dias** (`IndicatorManager.js`):
```javascript
updateDays(newDays) {
  if (this.days !== newDays) {
    this.days = newDays;

    // Sync SwingDetector days with backend
    const swingIndicator = this.getSwingDetectorIndicator();
    if (swingIndicator?.enabled && swingIndicator.syncDaysWithBackend) {
      swingIndicator.syncDaysWithBackend(newDays);
    }
  }
}
```

---

## MODALES DE INDICADORES

### Props Correctas para SwingDetectorSettings
```jsx
<SwingDetectorSettings
  currentSymbol={symbol}
  watchlistDays={parseInt(days)}
  watchlistInterval={interval}
  config={/* config del indicador */}
  onConfigChange={(config) => { /* actualizar indicador */ }}
  onBackendConfigSaved={async () => { /* refresh signals */ }}
/>
```

### Props Correctas para RejectionPatternSettings
```jsx
<RejectionPatternSettings
  symbol={symbol}
  indicatorManager={indicatorManagerRef.current}
  onConfigChange={handleRejectionPatternConfigChange}
  onClose={() => setShowRejectionPatternSettings(false)}
  initialConfig={rejectionPatternConfig}
/>
```
**NOTA**: RejectionPatternSettings incluye su propio modal-overlay, no necesita wrapper adicional.

---

## ESTILOS CSS

### Tema Claro
La aplicacion usa tema claro igual que la Watchlist original:
- Fondo: `#F7F9FB`
- Bordes: `#DDE2E7`
- Texto: `#222`
- Accent: `#4A90E2`

### Clases Principales
```css
.analyzer-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #F7F9FB;
}

.analyzer-container .grid-container {
  flex: 1;
  min-height: 0;
}

.analyzer-container .mini-chart {
  height: 100% !important;
  min-height: 500px;
}
```

---

## ENDPOINTS API PRINCIPALES

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/status` | GET | Estado del servidor |
| `/api/historical/{symbol}` | GET | Datos OHLCV |
| `/api/swing/signals/{symbol}` | GET | Senales swing detectadas |
| `/api/swing/config/{symbol}` | POST | Actualizar config swing |
| `/api/swing/status` | GET | Estado del servicio swing |
| `/api/vwap-service/data/{symbol}` | GET | Datos VWAP calculados |
| `/api/drawings/{symbol}` | GET/POST | Dibujos persistentes |
| `/api/rejection-patterns/detect` | POST | Detectar patrones rechazo |
| `/api/double-topbottom/detect` | POST | Detectar double top/bottom |

---

## DIFERENCIAS CON WATCHLIST ORIGINAL

| Aspecto | Watchlist | Analizador |
|---------|-----------|------------|
| Simbolos | 2+ en grid | 1 a pantalla completa |
| Puerto Backend | 8000 | 10000 |
| Puerto Frontend | 5173 | 10001 |
| Componente raiz | Watchlist.jsx | SingleSymbolAnalyzer.jsx |
| Selector simbolo | Array fijo | Input con autocompletado |
| Altura chart | 400px fijo | 100% pantalla |

---

## PROBLEMAS CONOCIDOS Y SOLUCIONES

### Crash al abrir modales de indicadores
**Causa**: Props incorrectas o falta de indicatorManager.
**Solucion**: Usar `useCallback` para handlers y almacenar manager en ref antes de abrir modal.

### Canvas solo ocupa mitad de pantalla
**Causa**: Clase CSS `.mini-chart` tiene `height: 400px` fijo.
**Solucion**: Usar clase `.analyzer-container` con estilos que hacen `height: 100%`.

### Swing Detector no grafica todos los dias
**Causa**: Backend tiene su propio `days` que no se sincroniza con frontend.
**Solucion**: Llamar `syncDaysWithBackend()` al iniciar y al cambiar dias.

### Caracteres con rombo y signo de interrogacion
**Causa**: Encoding incorrecto en archivos fuente.
**Solucion**: Evitar tildes y caracteres especiales. Usar ASCII puro.

---

## ARCHIVOS CRITICOS

Archivos que NO deben modificarse sin cuidado:

1. **config.js** - URL del backend, afecta todo el frontend
2. **IndicatorManager.js** - Orquesta todos los indicadores
3. **MiniChart.jsx** - Renderizado del grafico principal
4. **SwingDetectorIndicator.js** - Sincronizacion con backend

---

## CHECKLIST DE DESARROLLO

Al modificar indicadores:
- [ ] Verificar que el modal recibe las props correctas
- [ ] Verificar que `indicatorManagerRef.current` no es null
- [ ] Usar `useCallback` para handlers que se pasan a modales
- [ ] Sincronizar configuracion con backend si aplica

Al modificar estilos:
- [ ] Mantener tema claro (fondos claros, texto oscuro)
- [ ] Verificar que el chart ocupa todo el espacio disponible
- [ ] Evitar colores hardcodeados en JSX, usar CSS

Al agregar nuevas funcionalidades:
- [ ] Evitar tildes en strings (usar ASCII)
- [ ] Importar API_BASE_URL desde config.js
- [ ] Probar en diferentes timeframes
- [ ] Verificar que no hay race conditions al cambiar parametros

---

## RELACION CON OTRAS APPS

```
4.Analizador cripto
    │
    ├── Comparte codigo con: 2.WatchlistConIndicadores
    │   - Todos los indicadores (indicators/)
    │   - Sistema de dibujos (drawing/)
    │   - Componentes de settings (*Settings.jsx)
    │   - Hooks y utils
    │
    └── Se conecta a: 3.TradingBot_Python (puerto 5000)
        - Via alertas del Swing Detector
        - POST /api/watchlist-alert
```

---

## LOGS Y DEBUGGING

### Frontend (Consola del navegador)
```javascript
// Logs del IndicatorManager
[BTCUSDT] Actualizando days del manager: 1 -> 5

// Logs del SwingDetector
[BTCUSDT] SwingDetector initialized with 5 days
[BTCUSDT] SwingDetector: 23 signals (cached)
```

### Backend (Terminal)
```
INFO:     127.0.0.1 - "POST /api/swing/config/BTCUSDT HTTP/1.1" 200
INFO:     127.0.0.1 - "GET /api/swing/signals/BTCUSDT HTTP/1.1" 200
```

---

## HISTORIAL DE CAMBIOS (Enero 2026)

### Sesion Inicial - Creacion del Proyecto
1. Creado proyecto desde cero basado en Watchlist
2. Configurado puertos 10000/10001
3. Creado `SingleSymbolAnalyzer.jsx` y `SymbolSelector.jsx`
4. Copiados todos los indicadores y componentes compartidos

### Fixes Aplicados
1. **Crash en modales**: Corregidas props de SwingDetectorSettings
2. **Tema oscuro**: Cambiado a tema claro con paleta original
3. **Encoding tildes**: Eliminados caracteres especiales
4. **Canvas mitad pantalla**: Agregados estilos para height 100%
5. **Swing Detector dias**: Agregada sincronizacion con backend

### Sesion 20 Enero 2026 - Lista de Simbolos y Dibujos Compartidos

#### 1. Lista de Simbolos Lateral (SymbolList.jsx)
Nuevo componente que muestra una lista de monedas en el lado derecho:

- **Monedas por defecto**: BTCUSDT, ETHUSDT, XRPUSDT, TRXUSDT, GALAUSDT, SUIUSDT, TRBUSDT, SOLUSDT, ADAUSDT, DOGEUSDT
- **Variacion de precio**: Muestra % de cambio desde las 7pm hora Colombia (UTC-5)
- **Navegacion con teclado**: Flechas arriba/abajo para cambiar de moneda
- **Click para seleccionar**: Cambia el grafico principal al simbolo seleccionado
- **Agregar/eliminar monedas**: Boton + para agregar, boton x (hover) para eliminar
- **Panel colapsable**: Boton para colapsar/expandir el panel
- **Redimensionable**: Arrastrar borde izquierdo para cambiar ancho (180px - 400px)
- **Persistencia**: Estado (colapsado, ancho, lista de monedas) guardado en localStorage

**Archivos creados/modificados:**
- `frontend/src/components/SymbolList.jsx` (nuevo)
- `frontend/src/components/SingleSymbolAnalyzer.jsx` (integrado SymbolList)
- `frontend/src/styles.css` (estilos para .main-content, .symbol-list-container, etc.)

#### 2. Indicadores por Defecto Optimizados
Cambiados los indicadores habilitados por defecto para acelerar carga:

```javascript
// Habilitados por defecto:
"VWAP": true,
"Support & Resistance": true,
"Swing Detector": true,

// Deshabilitados por defecto:
"Volume Delta": false,
"CVD": false,
"Volume Profile": false,
"Open Interest": false,
// ... resto deshabilitados
```

#### 3. Dibujos Compartidos entre Watchlist y Analizador

**Implementacion via Symlink:**
La carpeta de dibujos del Analizador y la Watchlist ahora apuntan al mismo lugar fisico.

```
2.WatchlistConIndicadores/backend/drawings/  →  SYMLINK
                                                   ↓
4.Analizador cripto/backend/drawings/        →  CARPETA REAL
```

**Comando usado (CMD como Administrador):**
```cmd
cd "C:\Users\inven\OneDrive\Documentos\GitHub\watchlist\2.WatchlistConIndicadores\backend"
mklink /D drawings "C:\Users\inven\OneDrive\Documentos\GitHub\watchlist\4.Analizador cripto\backend\drawings"
```

**Backups creados:**
- `2.WatchlistConIndicadores/backend/drawings_backup_20260120/`
- `4.Analizador cripto/backend/drawings_backup_20260120/`

#### 4. Sincronizacion de Dibujos en Tiempo Real

**Problema**: Al compartir dibujos, los cambios en una app no se reflejaban en la otra (loop de redibujado).

**Solucion implementada** - Polling con verificacion de timestamp:

```javascript
// En MiniChart.jsx (ambas apps)

// Ref para tracking de timestamp
const drawingsTimestampRef = useRef(null);

// loadDrawings modificado para verificar timestamp
const loadDrawings = async (checkTimestampOnly = false) => {
  const data = await response.json();

  // Si solo verificamos timestamp y no cambio, no recargar
  if (checkTimestampOnly && data.updated_at === drawingsTimestampRef.current) {
    return;
  }

  drawingsTimestampRef.current = data.updated_at;
  // ... cargar shapes
};

// useEffect con polling cada 3 segundos
useEffect(() => {
  loadDrawings();

  const syncInterval = setInterval(() => {
    if (!drawingMode) {
      loadDrawings(true); // Solo verifica timestamp
    }
  }, 3000);

  return () => clearInterval(syncInterval);
}, [symbol, drawingMode]);
```

**Resultado:**
- Los dibujos se sincronizan entre apps en ~3 segundos
- Sin parpadeo (solo recarga si el archivo realmente cambio)
- No hay conflictos al editar (el polling se pausa en modo dibujo)

#### 5. Fix Parpadeo de Dibujos en Watchlist

**Problema**: Los dibujos parpadeaban al hacer toggle de indicadores.

**Causa**: `loadDrawings()` estaba dentro del useEffect principal que dependia de `indicatorStates`.

**Solucion**: Movido `loadDrawings()` a un useEffect separado que solo depende de `symbol`:

```javascript
// ANTES (causaba parpadeo):
useEffect(() => {
  loadHistoricalData();
  loadDrawings();  // Se ejecutaba al toggle indicadores
  initIndicators();
}, [symbol, interval, days, indicatorStates, ...]);

// DESPUES (sin parpadeo):
useEffect(() => {
  loadHistoricalData();
  // loadDrawings movido a useEffect separado
  initIndicators();
}, [symbol, interval, days, indicatorStates, ...]);

useEffect(() => {
  loadDrawings();
  // ... polling
}, [symbol, drawingMode]);  // Solo depende de symbol
```

---

## SISTEMA DE DIBUJOS COMPARTIDOS

### Arquitectura

```
┌─────────────────────┐     ┌─────────────────────┐
│  Analizador Cripto  │     │      Watchlist      │
│   (puerto 10000)    │     │    (puerto 8000)    │
└─────────┬───────────┘     └─────────┬───────────┘
          │                           │
          │ GET/POST                  │ GET/POST
          │ /api/drawings/{symbol}    │ /api/drawings/{symbol}
          │                           │
          ▼                           ▼
┌─────────────────────────────────────────────────┐
│     4.Analizador cripto/backend/drawings/       │
│                                                 │
│   BTCUSDT.json  ETHUSDT.json  SOLUSDT.json ... │
│                                                 │
│   (Watchlist accede via SYMLINK)                │
└─────────────────────────────────────────────────┘
```

### Flujo de Sincronizacion

1. Usuario dibuja en App A
2. App A guarda en `/api/drawings/{symbol}` → archivo JSON actualizado
3. App B hace polling cada 3s con `checkTimestampOnly=true`
4. Backend retorna `updated_at` diferente
5. App B recarga dibujos completos
6. Canvas se actualiza con los nuevos dibujos

### Rollback (si es necesario)

```cmd
# Eliminar symlink
rmdir "2.WatchlistConIndicadores\backend\drawings"

# Restaurar backup
move "2.WatchlistConIndicadores\backend\drawings_backup_20260120" "2.WatchlistConIndicadores\backend\drawings"
```
