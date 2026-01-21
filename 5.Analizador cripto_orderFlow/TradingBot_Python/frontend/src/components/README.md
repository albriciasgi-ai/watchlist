# Trading Bot - React Components

## Descripción General

Este directorio contiene todos los componentes React para el Trading Bot de Bybit. Cada componente está completamente funcional y conectado al backend API.

## Componentes Creados

### 1. CredentialsPanel.jsx
Panel para configurar las credenciales de API de Bybit.

**Características:**
- Inputs para API Key y Secret (con campo password)
- Toggle para cambiar entre Testnet/Live
- Validación de campos requeridos
- Indicador de estado (configurado/no configurado)
- Mensajes de éxito/error
- Información de seguridad

**API Endpoints:**
- `GET /api/credentials/check` - Verificar si hay credenciales configuradas
- `POST /api/credentials` - Guardar credenciales

**Props:** Ninguno

---

### 2. DirectionManager.jsx
Gestor de direcciones de trading por símbolo.

**Características:**
- Lista completa de símbolos configurados
- Botones para cada dirección: LONG, SHORT, BOTH, DISABLED
- Indicadores visuales del estado actual
- Estadísticas en tiempo real (total, activos, long, short, both, disabled)
- Actualización inmediata con feedback visual

**API Endpoints:**
- `GET /api/directions` - Obtener todas las direcciones
- `POST /api/directions/update` - Actualizar dirección de un símbolo

**Props:** Ninguno

---

### 3. ConfigManager.jsx
Gestor de configuraciones por moneda.

**Características:**
- Tabla con todos los símbolos y sus configuraciones
- Edición inline de parámetros:
  - risk_amount (USDT)
  - stop_loss_percent (%)
  - take_profit_percent (%)
- Validación de valores positivos
- Guardado individual por símbolo
- Indicador de fila en edición

**API Endpoints:**
- `GET /api/config` - Obtener configuraciones
- `POST /api/config/update` - Actualizar configuración de un símbolo

**Props:** Ninguno

---

### 4. AlertPanel.jsx
Panel para procesar alertas de ATAS.

**Características:**
- Textarea grande para pegar alerta raw
- Botón "Process Alert" con estado de carga
- Visualización del resultado parseado:
  - Symbol
  - Side (Long/Short)
  - Price
- Botón "Manual Trade" (aparece si el parseo es exitoso)
- Modal para ejecutar trade manual
- Formato esperado: SYMBOL, SIDE, PRICE

**API Endpoints:**
- `POST /api/alert` - Procesar alerta
- `POST /api/trade/manual` - Ejecutar trade manual

**Props:** Ninguno

---

### 5. LogsPanel.jsx
Panel de visualización de logs en tiempo real.

**Características:**
- Lista de logs con auto-scroll
- Colores por nivel:
  - INFO: Azul (#3b82f6)
  - SUCCESS: Verde (#22c55e)
  - WARNING: Amarillo (#f59e0b)
  - ERROR: Rojo (#ef4444)
- Timestamps formateados (HH:MM:SS.mmm)
- Iconos por nivel (✓, ✕, ⚠, ℹ)
- Toggle de auto-scroll
- Botón para limpiar logs
- Contador de logs

**API Endpoints:** Ninguno (recibe datos por props)

**Props:**
- `logs` (array): Array de objetos con estructura:
  ```javascript
  {
    timestamp: "2025-11-20T19:00:00.000Z",
    level: "info" | "success" | "warning" | "error",
    message: "Log message",
    details: "Optional details" // objeto o string
  }
  ```
- `maxHeight` (string): Altura máxima del contenedor (default: "400px")
- `onClear` (function): Callback para limpiar logs

**Ejemplo de uso:**
```jsx
const [logs, setLogs] = useState([]);

const handleClearLogs = () => {
  setLogs([]);
};

<LogsPanel
  logs={logs}
  maxHeight="500px"
  onClear={handleClearLogs}
/>
```

---

### 6. PositionsPanel.jsx
Panel de visualización de posiciones abiertas.

**Características:**
- Lista de todos los símbolos configurados
- Botón "Check Position" por símbolo
- Auto-refresh cada 10 segundos (configurable)
- Información mostrada:
  - Estado: hasPosition (true/false)
  - Size (cantidad)
  - Side (Buy/Sell → LONG/SHORT)
  - Entry Price
  - Unrealized PnL
  - Leverage
- Estadísticas: Total, Open, Long, Short
- Indicadores visuales (verde=posición abierta, gris=sin posición)
- Timestamp de última verificación

**API Endpoints:**
- `GET /api/config` - Obtener lista de símbolos
- `GET /api/position/{symbol}` - Obtener posición de un símbolo

**Props:** Ninguno

---

## Archivo CSS (components.css)

El archivo `components.css` contiene todos los estilos compartidos para los componentes.

**Características del diseño:**
- Dark theme (#0f172a background, #1e293b cards)
- Bordes redondeados (12px paneles, 8px elementos)
- Paleta de colores:
  - Azul: #3b82f6
  - Verde: #22c55e
  - Rojo: #ef4444
  - Amarillo: #f59e0b
  - Púrpura: #a855f7
- Transiciones suaves (0.3s)
- Hover effects en botones
- Responsive design (breakpoints: 768px, 480px)
- Shadows y depth
- Animaciones (slideIn, fadeIn, slideUp, pulse)

**Clases principales:**
- `.panel-header` - Encabezado de paneles
- `.btn`, `.btn-primary`, `.btn-secondary`, etc. - Botones
- `.badge`, `.badge-success`, etc. - Badges
- `.alert`, `.alert-success`, etc. - Alertas
- `.stats-grid`, `.stat-card` - Grid de estadísticas
- `.modal-overlay`, `.modal-content` - Modales
- `.form-input`, `.form-select` - Inputs de formulario
- `.toggle-switch` - Toggle switches
- Utilidades: `.text-success`, `.text-danger`, etc.

---

## Archivo de Exportación (index.js)

El archivo `index.js` exporta todos los componentes para facilitar la importación:

```javascript
import {
  CredentialsPanel,
  DirectionManager,
  ConfigManager,
  AlertPanel,
  LogsPanel,
  PositionsPanel
} from './components';
```

---

## Integración en App.jsx

Ejemplo de cómo usar estos componentes en la aplicación principal:

```jsx
import { useState } from 'react';
import {
  CredentialsPanel,
  DirectionManager,
  ConfigManager,
  AlertPanel,
  LogsPanel,
  PositionsPanel
} from './components';

function App() {
  const [logs, setLogs] = useState([]);

  const addLog = (level, message, details = null) => {
    setLogs(prev => [...prev, {
      timestamp: new Date().toISOString(),
      level,
      message,
      details
    }]);
  };

  return (
    <div className="app">
      <CredentialsPanel />
      <DirectionManager />
      <ConfigManager />
      <AlertPanel />
      <PositionsPanel />
      <LogsPanel
        logs={logs}
        maxHeight="400px"
        onClear={() => setLogs([])}
      />
    </div>
  );
}
```

---

## Backend API Requirements

Los componentes esperan que el backend tenga los siguientes endpoints:

### Credentials
- `GET /api/credentials/check`
- `POST /api/credentials` - Body: `{ api_key, api_secret, testnet }`

### Directions
- `GET /api/directions`
- `POST /api/directions/update` - Body: `{ symbol, direction }`

### Config
- `GET /api/config`
- `POST /api/config/update` - Body: `{ symbol, config: { risk_amount, stop_loss_percent, take_profit_percent } }`

### Alerts
- `POST /api/alert` - Body: `{ raw_alert }`
- `POST /api/trade/manual` - Body: `{ symbol, side, price }`

### Positions
- `GET /api/position/{symbol}`

---

## Manejo de Errores

Todos los componentes incluyen manejo robusto de errores:

1. **Network errors**: Capturados con try/catch
2. **API errors**: Validados con response.ok
3. **User feedback**: Mensajes de error visibles
4. **Loading states**: Indicadores durante operaciones async
5. **Validation**: Validación de inputs antes de enviar

---

## Características de UX

- **Loading states**: Todos los botones muestran estado de carga
- **Disabled states**: Inputs/botones deshabilitados durante operaciones
- **Auto-clear messages**: Mensajes de éxito se limpian automáticamente
- **Visual feedback**: Colores y animaciones para feedback inmediato
- **Responsive**: Funciona en mobile, tablet y desktop
- **Accessibility**: Labels, placeholders y aria-labels apropiados

---

## Tecnologías Utilizadas

- React 18+ (Hooks)
- Fetch API
- CSS3 (Variables, Grid, Flexbox, Animations)
- ES6+ JavaScript

---

## Total de Líneas de Código

- **AlertPanel.jsx**: 293 líneas
- **ConfigManager.jsx**: 264 líneas
- **CredentialsPanel.jsx**: 182 líneas
- **DirectionManager.jsx**: 234 líneas
- **LogsPanel.jsx**: 159 líneas
- **PositionsPanel.jsx**: 299 líneas
- **components.css**: 1,243 líneas
- **TOTAL**: 2,674 líneas

---

## Notas Importantes

1. Todos los componentes asumen que el backend está corriendo en `http://localhost:5000`
2. Los componentes son independientes y pueden usarse por separado
3. El único componente que requiere props es `LogsPanel`
4. Todos incluyen estados de carga y manejo de errores
5. El diseño es completamente responsive
6. Los colores y estilos están centralizados en components.css

---

## Próximos Pasos

Para usar estos componentes:

1. Importar en App.jsx
2. Asegurarse de que el backend está corriendo
3. Configurar CORS en el backend para permitir requests desde el frontend
4. Opcionalmente, mover la URL del backend a una variable de entorno

```javascript
// .env
VITE_API_URL=http://localhost:5000
```

```javascript
// En los componentes
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
```
