# STRATEGY TESTER - Plan de Implementación

**Fecha inicio:** Enero 2026
**Ubicación:** `1.Altagracia_Crypto_Backtester/Backtester/`

---

## VISIÓN GENERAL

El Strategy Tester es un sistema para crear, probar y optimizar estrategias de trading basadas en **zonas de consolidación/rangos**. La idea principal es:

1. **Detectar zonas** de consolidación históricas (rangos donde el precio rebota)
2. **Definir reglas de entrada/salida** cuando el precio interactúa con estas zonas
3. **Ejecutar backtesting** con las reglas definidas
4. **Analizar resultados** y optimizar parámetros

---

## ESTADO ACTUAL (Enero 2026)

### ✅ COMPLETADO

#### Zone Detector 2.0
- **4 métodos de detección**:
  - `pivot_cluster`: Agrupa pivots cercanos en precio
  - `atr_based`: Detecta consolidaciones por volatilidad baja
  - `volume_profile`: Identifica zonas de alto volumen (POC, VAH, VAL)
  - `price_action`: Cuenta toques a niveles de precio

- **Parámetros configurables**:
  - `max_price_range_pct`: Filtra zonas demasiado amplias (default 5%)
  - Parámetros específicos por método (tolerancia, min_touches, swing_bars, etc.)

- **Integración con Playback**:
  - Las zonas se calculan solo con datos **anteriores** a la fecha de inicio de reproducción
  - Evita survival bias en el backtesting

#### Zone Evaluator
- Métricas de calidad de zonas (toques, bounces, fakeouts)
- Cálculo de win rate histórico por zona
- Estrategias recomendadas (aggressive, conservative, breakout, avoid)

#### Zone Optimizer
- Grid search para encontrar mejores parámetros
- Walk-forward validation para robustez
- Comparación entre métodos

#### UI ZoneDetectorTester
- Modal con 4 tabs: Detectar, Evaluar, Comparar, Optimizar
- Visualización de zonas en el gráfico
- Indicador de fecha límite de datos (playback)

### 🔄 EN PROGRESO / PENDIENTE REFINAMIENTO

#### Detección de Zonas
- Los algoritmos actuales detectan zonas pero no siempre coinciden con lo que un trader buscaría
- **Mejoras potenciales**:
  - Usar swing highs/lows como base para zonas
  - Considerar estructura de mercado (HH, HL, LH, LL)
  - Filtrar por contexto (tendencia vs rango)
  - Integrar Volume Profile real (no solo POC)

---

## PRÓXIMOS PASOS

### FASE 1: Strategy Builder (UI para crear estrategias)

**Objetivo**: Permitir al usuario definir reglas de trading sin código

#### 1.1 Modelo de Estrategia
```javascript
{
  name: "Range Bounce Strategy",
  version: "1.0",

  // Condiciones de entrada
  entry: {
    trigger: "price_touches_zone",  // Evento que dispara evaluación
    direction: "BOTH",              // LONG, SHORT, BOTH
    conditions: [
      { type: "zone_quality", minScore: 70 },
      { type: "zone_touches", min: 3 },
      { type: "candle_pattern", patterns: ["hammer", "engulfing"] },
      { type: "volume", condition: "above_average" }
    ],
    confirmation: {
      type: "candle_close",  // Esperar cierre de vela
      above_zone: true       // Para LONG: cierre arriba de zona
    }
  },

  // Gestión de posición
  position: {
    sizing: "fixed_risk",     // fixed_risk, fixed_amount, percent_equity
    riskPercent: 1,           // % del capital a arriesgar

    stopLoss: {
      type: "below_zone",     // below_zone, atr_multiple, fixed_percent
      buffer: 0.1             // % adicional debajo de la zona
    },

    takeProfit: {
      type: "risk_reward",    // risk_reward, opposite_zone, fixed_percent
      ratio: 2                // RR ratio
    }
  },

  // Filtros adicionales
  filters: {
    maxOpenTrades: 3,
    minTimeBetweenTrades: 60,  // minutos
    tradingHours: null,        // null = 24/7
    excludeHighVolatility: false
  }
}
```

#### 1.2 UI Components
- `StrategyBuilder.jsx`: Editor visual de estrategias
- `ConditionEditor.jsx`: Editor de condiciones (drag & drop)
- `StrategyList.jsx`: Lista de estrategias guardadas
- `StrategyCard.jsx`: Preview de estrategia

#### 1.3 Backend Endpoints
```
POST /api/strategies/save      - Guardar estrategia
GET  /api/strategies/list      - Listar estrategias
GET  /api/strategies/{id}      - Obtener estrategia
DELETE /api/strategies/{id}    - Eliminar estrategia
POST /api/strategies/validate  - Validar sintaxis
```

---

### FASE 2: Strategy Executor (Motor de ejecución)

**Objetivo**: Ejecutar estrategias en modo backtesting

#### 2.1 StrategyExecutor Class (Backend)
```python
class StrategyExecutor:
    def __init__(self, strategy: dict, candles: list, zones: list):
        self.strategy = strategy
        self.candles = candles
        self.zones = zones
        self.trades = []
        self.equity_curve = []

    def run(self, start_time: int, end_time: int) -> BacktestResult:
        """Ejecuta la estrategia vela por vela"""
        for candle in self.candles:
            # 1. Actualizar zonas activas
            # 2. Evaluar condiciones de entrada
            # 3. Gestionar posiciones abiertas (SL/TP)
            # 4. Registrar estado
        return self.generate_report()

    def _check_entry_conditions(self, candle, zone) -> bool:
        """Evalúa si se cumplen todas las condiciones de entrada"""
        pass

    def _calculate_position_size(self, entry_price, stop_loss) -> float:
        """Calcula tamaño de posición según sizing rules"""
        pass
```

#### 2.2 Integración con TimeController
- El executor debe sincronizarse con el playback existente
- Las señales aparecen en tiempo real mientras avanza la simulación
- El usuario puede pausar y analizar cada señal

#### 2.3 Trade Signals en Chart
- Flechas de entrada/salida en el gráfico
- Tooltip con detalles del trade
- Líneas de SL/TP durante posición abierta

---

### FASE 3: Results Dashboard

**Objetivo**: Visualizar y analizar resultados del backtesting

#### 3.1 Métricas Principales
- **Rentabilidad**: Total P&L, % return, avg trade
- **Riesgo**: Max drawdown, Sharpe ratio, Sortino ratio
- **Consistencia**: Win rate, profit factor, avg win/loss
- **Actividad**: Total trades, trades/month, avg holding time

#### 3.2 Visualizaciones
- Equity curve (gráfico de línea)
- Drawdown chart
- Monthly returns heatmap
- Trade distribution (histogram)
- Win rate by zone type
- P&L by hour/day

#### 3.3 Trade Analysis
- Lista de trades con filtros
- Detalles de cada trade
- Replay de trade específico

---

### FASE 4: Optimization & Walk-Forward

**Objetivo**: Encontrar parámetros óptimos de forma robusta

#### 4.1 Parameter Optimization
- Grid search para parámetros de estrategia
- Genetic algorithm (opcional)
- Multi-objective optimization (profit vs drawdown)

#### 4.2 Walk-Forward Analysis
- Dividir datos en períodos in-sample / out-of-sample
- Optimizar en IS, validar en OOS
- Análisis de degradación

#### 4.3 Monte Carlo Simulation
- Randomizar orden de trades
- Calcular intervalos de confianza
- Identificar peor caso esperado

---

### FASE 5: Live Integration (Futuro)

**Objetivo**: Conectar estrategias probadas con el Trading Bot

#### 5.1 Strategy Export
- Exportar estrategia validada a formato compatible con Bot
- Configurar alerts automáticos

#### 5.2 Paper Trading
- Ejecutar estrategia en tiempo real sin dinero real
- Comparar con backtesting

---

## ARQUITECTURA PROPUESTA

```
┌─────────────────────────────────────────────────────────────────┐
│                     STRATEGY TESTER                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   STRATEGY   │    │    ZONE      │    │   MARKET     │       │
│  │   BUILDER    │    │   DETECTOR   │    │    DATA      │       │
│  │              │    │              │    │              │       │
│  │ - Conditions │    │ - 4 methods  │    │ - Candles    │       │
│  │ - Sizing     │    │ - Evaluator  │    │ - Volume     │       │
│  │ - SL/TP      │    │ - Optimizer  │    │ - Indicators │       │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘       │
│         │                   │                   │                │
│         └───────────────────┼───────────────────┘                │
│                             │                                    │
│                             ▼                                    │
│                    ┌──────────────┐                              │
│                    │   STRATEGY   │                              │
│                    │   EXECUTOR   │                              │
│                    │              │                              │
│                    │ - Run backtest│                             │
│                    │ - Generate    │                             │
│                    │   signals     │                             │
│                    └──────┬───────┘                              │
│                           │                                      │
│                           ▼                                      │
│                    ┌──────────────┐                              │
│                    │   RESULTS    │                              │
│                    │   ANALYZER   │                              │
│                    │              │                              │
│                    │ - Metrics    │                              │
│                    │ - Charts     │                              │
│                    │ - Reports    │                              │
│                    └──────────────┘                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## PRIORIDADES DE DESARROLLO

### Alta Prioridad (Próximo)
1. **Strategy Builder UI** - Permitir crear estrategias simples
2. **Strategy Executor básico** - Ejecutar reglas en backtesting
3. **Trade visualization** - Ver señales en el gráfico

### Media Prioridad
4. **Results Dashboard** - Métricas y análisis
5. **Persistence** - Guardar/cargar estrategias
6. **Optimization básica** - Grid search para parámetros

### Baja Prioridad (Futuro)
7. **Walk-forward analysis**
8. **Monte Carlo simulation**
9. **Live integration con Trading Bot**

---

## ARCHIVOS RELACIONADOS

### Backend
- `backend/zone_detector.py` - Detección de zonas
- `backend/zone_evaluator.py` - Evaluación de zonas
- `backend/zone_optimizer.py` - Optimización de parámetros
- `backend/main.py` - Endpoints API (líneas 2690-3100)

### Frontend
- `frontend/src/components/ZoneDetectorTester.jsx` - UI del detector
- `frontend/src/components/indicators/ZoneVisualizerIndicator.js` - Renderizado de zonas
- `frontend/src/components/backtesting/BacktestingApp.jsx` - App principal

---

## NOTAS TÉCNICAS

### Evitar Survival Bias
- Siempre usar `end_timestamp` en endpoints de zonas
- Las zonas se detectan solo con datos anteriores al playback
- El evaluator no debe "ver" datos futuros

### Performance
- Limitar zonas mostradas (max 20-30)
- Cache de cálculos de indicadores
- Lazy loading de datos históricos

### UX
- Feedback visual inmediato al crear/modificar estrategia
- Tooltips explicativos en cada opción
- Presets de estrategias comunes

---

## CHANGELOG

### Enero 2026 - Phase 2: Strategy Builder
- [x] Zone Detector 2.0 con 4 métodos
- [x] Zone Evaluator con métricas
- [x] Zone Optimizer con grid search
- [x] UI ZoneDetectorTester
- [x] Visualización de zonas en gráfico
- [x] Integración con fecha de playback (anti-bias)
- [x] Filtro max_price_range_pct
- [x] **Strategy Model** (backend/strategy_model.py)
  - Dataclasses: Strategy, EntryRules, Condition, RiskManagement, Filters
  - Templates predefinidos: range_bounce, breakout, aggressive_scalp
- [x] **Strategy Store** (backend/strategy_store.py)
  - Persistencia JSON en backend/strategies/
  - CRUD completo: save, load, delete, list_all, duplicate
- [x] **Strategy Executor** (backend/strategy_executor.py)
  - Motor de backtesting: Trade, Signal, BacktestResult
  - Procesa velas, gestiona SL/TP, genera equity curve
  - Calcula métricas: win_rate, profit_factor, max_drawdown, sharpe_ratio
- [x] **Strategy Builder UI** (frontend/src/components/strategy/)
  - StrategyBuilder.jsx: 4 secciones (Básico, Entrada, Riesgo, Filtros)
  - ConditionEditor.jsx: Editor dinámico de condiciones
  - StrategyList.jsx: Lista con filtro, duplicar, eliminar
  - BacktestResults.jsx: Resumen, tabla de trades, equity curve
- [x] **API Endpoints completa**
  - CRUD: /api/strategies (GET, POST, PUT, DELETE)
  - Templates: /api/strategies/templates
  - Backtest: /api/strategies/{id}/backtest
  - Quick backtest: /api/strategies/quick-backtest
- [x] **Integración en BacktestingApp**
  - Panel "Estrategia" en sidebar
  - Botón "Run Backtest" ejecuta backtest y muestra resultados

### Pendiente (Siguiente Fase)
- [ ] Visualización de trades en el gráfico (flechas de entrada/salida)
- [ ] Sincronización con TimeController (playback de trades)
- [ ] Mejoras al Zone Detector (zonas más similares a las que busca un trader)
- [ ] Optimization UI (grid search de parámetros de estrategia)
- [ ] Walk-forward validation
