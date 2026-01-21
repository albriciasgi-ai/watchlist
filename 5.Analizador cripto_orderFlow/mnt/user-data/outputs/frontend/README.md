# Crypto Watchlist - Frontend con Indicadores Modulares

## Estructura del Proyecto

```
frontend/
├── src/
│   ├── components/
│   │   ├── indicators/           # Sistema modular de indicadores
│   │   │   ├── IndicatorBase.js        # Clase base para indicadores
│   │   │   ├── IndicatorManager.js     # Gestor de indicadores
│   │   │   └── VolumeIndicator.js      # Indicador de Volume Delta / CVD
│   │   ├── MiniChart.jsx               # Componente del gráfico
│   │   ├── Watchlist.jsx               # Componente principal
│   │   └── WebSocketManager.js         # Gestor de WebSocket
│   ├── config.js                 # Configuración de API
│   ├── main.jsx                  # Punto de entrada
│   └── styles.css                # Estilos
├── cache/                        # Datos de cache para volume delta
├── index.html
├── package.json
└── vite.config.js

```

## Instalación

1. Asegúrate de tener Node.js instalado (v16+)
2. Instala las dependencias:
```bash
npm install
```

## Uso

### Desarrollo
```bash
npm run dev
```
El servidor se iniciará en http://localhost:5173

### Backend
Asegúrate de que el backend esté corriendo en http://localhost:8000

## Sistema de Indicadores Modulares

### Arquitectura Plug & Play

El sistema está diseñado para que sea muy fácil agregar nuevos indicadores:

1. **IndicatorBase.js**: Clase base que define la interfaz estándar
2. **IndicatorManager.js**: Gestor que coordina todos los indicadores
3. **Indicadores específicos** (ej: VolumeIndicator.js): Implementaciones concretas

### Cómo Agregar un Nuevo Indicador

1. Crea un nuevo archivo en `src/components/indicators/` (ej: `MyIndicator.js`)
2. Extiende la clase `IndicatorBase`:

```javascript
import IndicatorBase from "./IndicatorBase";
import { API_BASE_URL } from "../../../config";

class MyIndicator extends IndicatorBase {
  constructor(symbol, interval) {
    super(symbol, interval);
    this.name = "Mi Indicador";  // Nombre que aparecerá en la UI
    this.height = 100;            // Altura en píxeles
  }

  async fetchData() {
    // Cargar datos desde el backend
    try {
      const url = `${API_BASE_URL}/api/mi-indicador/${this.symbol}?interval=${this.interval}`;
      const res = await fetch(url);
      const json = await res.json();
      
      if (json.success) {
        this.data = json.data;
        return true;
      }
      return false;
    } catch (err) {
      console.error(`Error cargando ${this.name}:`, err);
      return false;
    }
  }

  render(ctx, bounds, visibleCandles) {
    // Dibujar el indicador en el canvas
    if (!this.enabled || this.data.length === 0) return;
    
    const { x, y, width, height } = bounds;
    
    // Tu lógica de renderizado aquí...
  }
}

export default MyIndicator;
```

3. Registra el indicador en `IndicatorManager.js`:

```javascript
import MyIndicator from "./MyIndicator";

async initialize() {
  // Crear indicadores
  const volumeIndicator = new VolumeIndicator(this.symbol, this.interval);
  const myIndicator = new MyIndicator(this.symbol, this.interval);  // <-- Agregar aquí
  
  this.indicators.push(volumeIndicator);
  this.indicators.push(myIndicator);  // <-- Agregar aquí
  
  // ...resto del código
}
```

4. Agrega el control en `Watchlist.jsx`:

```javascript
const [indicatorStates, setIndicatorStates] = useState({
  "Volume Delta": true,
  "Mi Indicador": false  // <-- Agregar aquí
});

// Y en el JSX:
<label>
  <input 
    type="checkbox" 
    checked={indicatorStates["Mi Indicador"]}
    onChange={() => toggleIndicator("Mi Indicador")}
  />
  Mi Indicador
</label>
```

## Volume Delta / CVD

El indicador de Volume Delta ya está implementado y muestra:
- **Histograma**: Diferencia entre volumen de compra y venta
- **CVD (Cumulative Volume Delta)**: Suma acumulada del volume delta
- **Colores**: Verde para compras, rojo para ventas

### Datos de Cache

Los datos de volume delta se cargan desde archivos en la carpeta `cache/`:
- `BTCUSDT_5_volumedelta.json`
- `BTCUSDT_15_volumedelta.json`
- etc.

Estos archivos deben tener la estructura:
```json
{
  "symbol": "BTCUSDT",
  "timeframe": "15",
  "klines": [
    {
      "timestamp": 1234567890000,
      "open": 50000,
      "high": 50100,
      "low": 49900,
      "close": 50050,
      "volume": 123.45,
      "volumeDelta": 10.5
    }
  ]
}
```

## Características

- ✅ Gráficos en tiempo real con WebSocket
- ✅ Sistema modular de indicadores (Plug & Play)
- ✅ Volume Delta + CVD implementado
- ✅ Controles para mostrar/ocultar indicadores
- ✅ Zoom y desplazamiento en gráficos
- ✅ Múltiples timeframes
- ✅ 30+ símbolos simultáneos

## Próximos Indicadores a Implementar

- Open Interest
- RSI
- MACD
- Bollinger Bands
- etc.

## Notas Técnicas

- **Canvas Rendering**: Los gráficos usan Canvas para máximo rendimiento
- **WebSocket**: Conexión en tiempo real con Bybit
- **Lazy Loading**: Los indicadores solo cargan datos cuando están habilitados
- **Cache**: Sistema de cache para evitar llamadas repetidas al API
