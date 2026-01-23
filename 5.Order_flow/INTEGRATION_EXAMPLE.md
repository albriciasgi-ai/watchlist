# Ejemplo de Integración: Rejection Patterns en Watchlist

Este documento muestra cómo integrar el sistema de Rejection Patterns en el `Watchlist.jsx` existente.

## Paso 1: Modificar Watchlist.jsx

### Imports necesarios

```jsx
import React, { useState, useEffect } from 'react';
import RejectionPatternSettings from './RejectionPatternSettings';
// ... otros imports existentes
```

### Agregar estado para el panel de configuración

```jsx
function Watchlist() {
  // Estados existentes...
  const [timeframe, setTimeframe] = useState('4h');
  const [days, setDays] = useState(7);

  // NUEVO: Estado para el panel de patrones de rechazo
  const [rejectionPatternConfigOpen, setRejectionPatternConfigOpen] = useState(null); // null o symbol
  const [rejectionPatternConfigs, setRejectionPatternConfigs] = useState({}); // configs por símbolo

  // ... resto del código
}
```

### Agregar botón de configuración en cada símbolo

Busca donde se renderizan los símbolos en el watchlist y agrega un botón:

```jsx
<div className="symbol-controls">
  {/* Botones existentes... */}

  {/* NUEVO: Botón de configuración de patrones */}
  <button
    className="pattern-config-button"
    onClick={() => setRejectionPatternConfigOpen(symbol)}
    title="Configure Rejection Patterns"
  >
    📊 Patterns
  </button>
</div>
```

### Renderizar el modal de configuración

Al final del componente, antes del cierre:

```jsx
return (
  <div className="watchlist">
    {/* Contenido existente del watchlist */}

    {/* NUEVO: Modal de configuración de patrones */}
    {rejectionPatternConfigOpen && (
      <RejectionPatternSettings
        symbol={rejectionPatternConfigOpen}
        onConfigChange={(config) => {
          setRejectionPatternConfigs(prev => ({
            ...prev,
            [rejectionPatternConfigOpen]: config
          }));
        }}
        onClose={() => setRejectionPatternConfigOpen(null)}
        initialConfig={rejectionPatternConfigs[rejectionPatternConfigOpen]}
      />
    )}
  </div>
);
```

### Agregar estilos CSS

```css
/* En Watchlist.css */

.pattern-config-button {
  padding: 6px 12px;
  background: #2a2a2a;
  border: 1px solid #444;
  color: #4a9eff;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.pattern-config-button:hover {
  background: #333;
  border-color: #4a9eff;
}
```

---

## Paso 2: Integrar con MiniChart

### Modificar MiniChart.jsx para agregar el indicador

```jsx
import RejectionPatternIndicator from './indicators/RejectionPatternIndicator';

function MiniChart({ symbol, interval, days }) {
  const chartRef = useRef(null);
  const indicatorManager = useRef(null);

  useEffect(() => {
    // Inicializar IndicatorManager existente...
    indicatorManager.current = new IndicatorManager(symbol, interval, days);

    // NUEVO: Agregar Rejection Pattern Indicator
    const rejectionIndicator = new RejectionPatternIndicator(symbol, interval, days);
    indicatorManager.current.addIndicator('rejectionPatterns', rejectionIndicator);

    // Cargar datos
    indicatorManager.current.fetchAllData();

  }, [symbol, interval, days]);

  // Resto del código...
}
```

---

## Paso 3: Conectar configuración con el indicador

### Opción A: Desde Watchlist

```jsx
function Watchlist() {
  const [rejectionPatternConfigs, setRejectionPatternConfigs] = useState({});

  // Cuando cambia la configuración, notificar al MiniChart correspondiente
  useEffect(() => {
    // Esta es una forma simplificada. En producción podrías usar Context o un state manager.
    Object.keys(rejectionPatternConfigs).forEach(symbol => {
      const config = rejectionPatternConfigs[symbol];

      // Buscar el chart del símbolo y actualizar su indicador
      // Esto depende de cómo tengas estructurados los charts
      // Ejemplo:
      const chartComponent = document.querySelector(`[data-symbol="${symbol}"]`);
      if (chartComponent && chartComponent._indicatorManager) {
        const indicator = chartComponent._indicatorManager.getIndicator('rejectionPatterns');
        if (indicator) {
          indicator.updateConfig(config);
        }
      }
    });
  }, [rejectionPatternConfigs]);

  // ... resto del código
}
```

### Opción B: Usar Context API (Recomendado)

```jsx
// RejectionPatternContext.js
import React, { createContext, useContext, useState } from 'react';

const RejectionPatternContext = createContext();

export function RejectionPatternProvider({ children }) {
  const [configs, setConfigs] = useState({});

  const updateConfig = (symbol, config) => {
    setConfigs(prev => ({ ...prev, [symbol]: config }));
  };

  const getConfig = (symbol) => {
    return configs[symbol] || null;
  };

  return (
    <RejectionPatternContext.Provider value={{ configs, updateConfig, getConfig }}>
      {children}
    </RejectionPatternContext.Provider>
  );
}

export function useRejectionPatternConfig() {
  return useContext(RejectionPatternContext);
}
```

```jsx
// En App.jsx o index.jsx
import { RejectionPatternProvider } from './RejectionPatternContext';

function App() {
  return (
    <RejectionPatternProvider>
      <Watchlist />
    </RejectionPatternProvider>
  );
}
```

```jsx
// En Watchlist.jsx
import { useRejectionPatternConfig } from './RejectionPatternContext';

function Watchlist() {
  const { updateConfig } = useRejectionPatternConfig();

  return (
    <>
      {/* ... */}
      {rejectionPatternConfigOpen && (
        <RejectionPatternSettings
          symbol={rejectionPatternConfigOpen}
          onConfigChange={(config) => updateConfig(rejectionPatternConfigOpen, config)}
          onClose={() => setRejectionPatternConfigOpen(null)}
        />
      )}
    </>
  );
}
```

```jsx
// En MiniChart.jsx
import { useRejectionPatternConfig } from './RejectionPatternContext';

function MiniChart({ symbol, interval, days }) {
  const { getConfig } = useRejectionPatternConfig();

  useEffect(() => {
    const config = getConfig(symbol);
    if (config && indicatorManager.current) {
      const indicator = indicatorManager.current.getIndicator('rejectionPatterns');
      if (indicator) {
        indicator.updateConfig(config);
      }
    }
  }, [symbol, getConfig]);

  // ... resto del código
}
```

---

## Paso 4: Agregar controles en la UI del chart

### Botón para toggle del indicador

```jsx
// En MiniChart.jsx

function MiniChart({ symbol, interval, days }) {
  const [showRejectionPatterns, setShowRejectionPatterns] = useState(true);

  const toggleRejectionPatterns = () => {
    setShowRejectionPatterns(prev => {
      const newValue = !prev;
      if (indicatorManager.current) {
        const indicator = indicatorManager.current.getIndicator('rejectionPatterns');
        if (indicator) {
          indicator.setEnabled(newValue);
          // Re-render
          renderChart();
        }
      }
      return newValue;
    });
  };

  return (
    <div className="mini-chart">
      {/* Chart controls */}
      <div className="chart-controls">
        {/* Controles existentes... */}

        {/* NUEVO: Toggle de patrones */}
        <button
          className={`indicator-toggle ${showRejectionPatterns ? 'active' : ''}`}
          onClick={toggleRejectionPatterns}
          title="Toggle Rejection Patterns"
        >
          📊
        </button>
      </div>

      {/* Canvas del chart */}
      <canvas ref={chartRef} />

      {/* Pattern count badge */}
      {showRejectionPatterns && (
        <div className="pattern-count-badge">
          {getPatternCount()} patterns
        </div>
      )}
    </div>
  );
}
```

---

## Paso 5: Renderizar patrones en el canvas

### Modificar la función de render del chart

```jsx
// En MiniChart.jsx

function renderChart() {
  const canvas = chartRef.current;
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const bounds = { x: 0, y: 0, width: canvas.width, height: canvas.height };

  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Render candles (código existente)
  renderCandles(ctx, bounds);

  // NUEVO: Render rejection patterns
  if (indicatorManager.current) {
    const indicator = indicatorManager.current.getIndicator('rejectionPatterns');
    if (indicator && indicator.enabled) {
      indicator.render(ctx, bounds, candles, priceToY);
    }
  }

  // Render other indicators (código existente)
  // ...
}
```

---

## Paso 6: Agregar tooltips para patrones

```jsx
// En MiniChart.jsx

function MiniChart({ symbol, interval, days }) {
  const [tooltip, setTooltip] = useState(null);

  const handleMouseMove = (e) => {
    const rect = chartRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check if hovering over a pattern
    if (indicatorManager.current) {
      const indicator = indicatorManager.current.getIndicator('rejectionPatterns');
      if (indicator && indicator.enabled) {
        const tooltipInfo = indicator.getTooltipInfo(x, y, bounds, candles, priceToY);
        if (tooltipInfo) {
          setTooltip({ x: e.clientX, y: e.clientY, text: tooltipInfo });
          return;
        }
      }
    }

    // Check other tooltips (código existente)
    // ...

    setTooltip(null);
  };

  return (
    <div className="mini-chart">
      <canvas
        ref={chartRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
      />

      {/* Tooltip */}
      {tooltip && (
        <div
          className="pattern-tooltip"
          style={{
            position: 'fixed',
            left: tooltip.x + 10,
            top: tooltip.y + 10,
            background: '#252525',
            border: '1px solid #444',
            borderRadius: '4px',
            padding: '8px 12px',
            color: '#fff',
            fontSize: '12px',
            whiteSpace: 'pre-wrap',
            zIndex: 10000,
            pointerEvents: 'none'
          }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
```

---

## Paso 7: Obtener contextos desde otros indicadores

Para que el sistema funcione correctamente, necesitas proporcionar los contextos activos:

### Método 1: Exportar datos de Volume Profile e IndicatorManager

```jsx
// En IndicatorManager.js

class IndicatorManager {
  // ... código existente

  // NUEVO: Método para obtener contextos de referencia
  getReferenceContexts() {
    const contexts = [];

    // Volume Profile dinámico
    const vpDynamic = this.indicators.get('volumeProfile');
    if (vpDynamic && vpDynamic.enabled && vpDynamic.data) {
      contexts.push({
        id: `vp_dynamic_${this.symbol}`,
        type: 'VOLUME_PROFILE_DYNAMIC',
        label: `VP Dinámico (${this.interval})`,
        description: `POC: ${vpDynamic.data.poc?.toFixed(2)}`,
        enabled: true,
        weight: 0.5,
        levels: ['POC', 'VAH', 'VAL'],
        metadata: {
          poc: vpDynamic.data.poc,
          vah: vpDynamic.data.vah,
          val: vpDynamic.data.val
        }
      });
    }

    // Volume Profile fijo (fixed ranges)
    const vpFixed = this.indicators.get('volumeProfileFixedRanges');
    if (vpFixed && vpFixed.enabled && vpFixed.profiles) {
      vpFixed.profiles.forEach(profile => {
        contexts.push({
          id: profile.rangeId,
          type: 'VOLUME_PROFILE_FIXED',
          label: `VP Fijo: ${profile.name || profile.rangeId}`,
          description: `${formatDate(profile.startTime)} - ${formatDate(profile.endTime)}`,
          enabled: true,
          weight: 0.5,
          levels: ['POC', 'VAH', 'VAL'],
          metadata: {
            poc: profile.poc,
            vah: profile.vah,
            val: profile.val,
            startTime: profile.startTime,
            endTime: profile.endTime
          }
        });
      });
    }

    return contexts;
  }
}
```

### Método 2: Usar estos contextos en la configuración

```jsx
// En RejectionPatternSettings.jsx

useEffect(() => {
  // Cuando se abre el panel, obtener contextos disponibles del IndicatorManager
  const manager = getIndicatorManagerForSymbol(symbol); // Implementar esta función
  if (manager) {
    const contexts = manager.getReferenceContexts();
    setAvailableContexts(contexts);
  }
}, [symbol]);
```

---

## Resumen de Archivos Modificados

```
✅ Nuevos archivos creados:
   - backend/rejection_detector.py
   - backend/alert_sender.py
   - frontend/src/components/RejectionPatternSettings.jsx
   - frontend/src/components/RejectionPatternSettings.css
   - frontend/src/components/indicators/RejectionPatternIndicator.js
   - alert_listener.py
   - start_alert_listener.bat

📝 Archivos a modificar:
   - backend/main.py (✅ ya modificado)
   - frontend/src/components/Watchlist.jsx (pendiente)
   - frontend/src/components/MiniChart.jsx (pendiente)
   - frontend/src/components/indicators/IndicatorManager.js (pendiente)
```

---

## Testing

### 1. Test Backend

```bash
cd backend
python -m pytest test_rejection_detector.py  # Si tienes tests
```

### 2. Test Frontend

```bash
cd frontend
npm run dev
```

### 3. Test Alert Service

```bash
# Terminal 1: Backend
cd backend
uvicorn main:app --reload --port 8000

# Terminal 2: Alert Listener
python alert_listener.py

# Terminal 3: Frontend
cd frontend
npm run dev

# Verificar:
# 1. Backend: http://localhost:8000/docs
# 2. Alert Dashboard: http://localhost:5000
# 3. Frontend: http://localhost:5173
```

### 4. Test End-to-End

1. Abre el frontend
2. Selecciona BTCUSDT 4H
3. Activa Volume Profile
4. Abre configuración de Rejection Patterns
5. Agrega el VP como contexto
6. Ajusta filtros
7. Verifica que se detectan patrones en el chart
8. Habilita alertas
9. Verifica que llegan al dashboard (puerto 5000)

---

¡Listo! Siguiendo estos pasos tendrás el sistema completo integrado y funcionando. 🚀
