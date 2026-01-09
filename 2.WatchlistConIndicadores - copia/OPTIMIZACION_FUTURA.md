# Plan de Optimización de Rendimiento - Double Top/Bottom

**Fecha:** 26 de Diciembre 2024
**Estado Actual:** Modo debugging - optimizaciones pospuestas hasta validar estrategias
**Problema:** Detección de patrones tarda ~7 segundos por símbolo (210s para 30 monedas)

---

## 📊 Contexto y Decisiones

### Requisitos de Producción
- **Símbolos:** 30 monedas simultáneamente
- **Histórico:** 90 días (2,160 candles @ 60min)
- **Viewport:** 4 monedas visibles a la vez (scroll)
- **Tiempo ideal:** Carga instantánea
- **Uso de config:** Casi nunca cambia (excepto en debugging)

### Decisión: Posponer Optimización
Durante la fase de debugging necesitamos:
- Cambiar configuración frecuentemente para probar estrategias
- Ver resultados inmediatos de los cambios
- Validar qué patrones realmente funcionan para trading

**Por tanto:** Implementaremos optimizaciones DESPUÉS de saber qué funciona.

---

## 🚀 Estrategias de Optimización (Para Implementar Después)

### **FASE 1: Quick Wins (1-2 días de trabajo)**

#### 1. Cache de Patrones Detectados ⭐ **PRIORIDAD MÁXIMA**
**Impacto:** Muy Alto | **Complejidad:** Baja

**Problema actual:**
- Backend cachea candles (30 min TTL)
- Backend NO cachea patrones detectados
- Cada cambio de config recalcula todos los patrones

**Solución:**
```python
# backend/double_topbottom_detector.py

def get_cache_key(symbol, interval, days, config):
    """Genera hash único basado en configuración"""
    config_hash = hashlib.md5(
        json.dumps(config, sort_keys=True).encode()
    ).hexdigest()[:8]
    return f"{symbol}_{interval}_{days}_{config_hash}_patterns"

def detect_patterns_cached(symbol, interval, days, config):
    cache_key = get_cache_key(symbol, interval, days, config)
    cache_file = f"cache/{cache_key}.json"

    # Verificar cache (30 min TTL)
    if os.path.exists(cache_file):
        age = time.time() - os.path.getmtime(cache_file)
        if age < 1800:  # 30 min
            with open(cache_file) as f:
                return json.load(f)

    # Calcular patrones
    patterns = detect_patterns(symbol, interval, days, config)

    # Guardar en cache
    with open(cache_file, 'w') as f:
        json.dump(patterns, f)

    return patterns
```

**Resultado esperado:**
- Primera carga: 7s
- Cargas subsecuentes (mismo config): <100ms
- En debugging: 7s cada vez que cambias config (esperado)
- En producción: instantáneo (config casi nunca cambia)

---

#### 2. Procesamiento Paralelo con AsyncIO ⭐ **PRIORIDAD ALTA**
**Impacto:** Muy Alto | **Complejidad:** Media

**Problema actual:**
- 30 símbolos × 7s = 210 segundos (secuencial)

**Solución:**
```python
# backend/main.py

@app.post("/api/double-topbottom/detect-batch")
async def detect_patterns_batch(request: dict):
    """Procesa múltiples símbolos en paralelo"""
    symbols = request.get("symbols", [])
    interval = request.get("interval")
    days = request.get("days")
    config = request.get("config")

    # Procesar 6 símbolos en paralelo (batches de 6)
    batch_size = 6
    all_results = {}

    for i in range(0, len(symbols), batch_size):
        batch = symbols[i:i+batch_size]

        tasks = [
            detect_patterns_async(sym, interval, days, config)
            for sym in batch
        ]

        results = await asyncio.gather(*tasks)

        for sym, patterns in zip(batch, results):
            all_results[sym] = patterns

    return {"success": True, "results": all_results}
```

**Resultado esperado:**
- 30 símbolos en ~35-40 segundos (5 batches × 7s)
- 80% reducción de tiempo total
- Sin sobrecarga del servidor (solo 6 cores usados)

---

#### 3. Early Termination (Optimización de Algoritmo)
**Impacto:** Medio | **Complejidad:** Baja

**Implementación:**
```python
def detect_patterns(candles, config):
    """Detecta patrones desde fechas recientes hacia atrás"""
    patterns = []
    max_patterns = 20  # Límite configurable

    # ⚠️ IMPORTANTE: Empezar desde el final (fechas recientes)
    for i in range(len(candles) - 1, config.lookback, -1):
        # Buscar patrón en ventana actual
        pattern = check_for_pattern(candles, i, config)

        if pattern:
            patterns.append(pattern)

            # Early exit si ya tenemos suficientes patrones
            if len(patterns) >= max_patterns:
                print(f"Early termination: {max_patterns} patterns found")
                break

    return patterns
```

**Resultado esperado:**
- Si encuentra 20 patrones en primeros 30 días: reduce tiempo 66%
- Variable según volatilidad del mercado

---

### **FASE 2: Optimizaciones Medias (3-5 días de trabajo)**

#### 4. Lazy Loading con IntersectionObserver ⭐ **ESENCIAL PARA 30 MONEDAS**
**Impacto:** Muy Alto | **Complejidad:** Media

**Problema:**
- Usuario solo ve 4 monedas a la vez
- Cargamos las 30 simultáneamente

**Solución:**
```javascript
// frontend/src/components/MiniChart.jsx

useEffect(() => {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !patternsLoaded) {
          // Chart entró al viewport - cargar patrones
          loadDoubleTopBottomPatterns();
          setPatternsLoaded(true);
        }
      });
    },
    {
      rootMargin: '200px', // Pre-cargar 200px antes de ser visible
      threshold: 0.1
    }
  );

  if (chartRef.current) {
    observer.observe(chartRef.current);
  }

  return () => observer.disconnect();
}, []);
```

**Resultado esperado:**
- Carga inicial: 4-6 monedas visibles × 7s = 28-42s
- Resto se cargan mientras scrolleas
- Experiencia percibida: mucho más rápida

---

#### 5. Vectorización con NumPy (Backend)
**Impacto:** Alto | **Complejidad:** Alta

**Refactorizar loops de detección:**
```python
import numpy as np

def find_extremes_vectorized(highs, lows, window=5):
    """Busca extremos usando operaciones vectorizadas"""
    n = len(highs)

    # Crear rolling windows
    high_windows = np.lib.stride_tricks.sliding_window_view(highs, window)
    low_windows = np.lib.stride_tricks.sliding_window_view(lows, window)

    # Encontrar máximos/mínimos locales
    is_peak = highs[window//2:-window//2] == high_windows.max(axis=1)
    is_valley = lows[window//2:-window//2] == low_windows.min(axis=1)

    peaks = np.where(is_peak)[0] + window//2
    valleys = np.where(is_valley)[0] + window//2

    return peaks, valleys
```

**Resultado esperado:**
- 7s → 2-3s por símbolo
- 60-70% reducción de tiempo

---

#### 6. Incremental Pattern Detection
**Impacto:** Muy Alto (en producción) | **Complejidad:** Alta

**Concepto:**
- Guardar patrones detectados con timestamp
- Solo procesar candles nuevos desde último análisis
- Mantener patrones históricos válidos

```python
def detect_patterns_incremental(symbol, interval, config):
    # Cargar patrones existentes
    cached_patterns = load_cached_patterns(symbol)
    last_analysis = get_last_analysis_timestamp(symbol)

    # Obtener solo candles nuevos
    new_candles = get_candles_since(symbol, last_analysis)

    if len(new_candles) < 5:
        # Muy pocas velas nuevas, retornar cache
        return cached_patterns

    # Detectar patrones solo en ventana reciente
    new_patterns = detect_in_window(
        candles=get_candles(symbol, days=30),  # Últimos 30 días
        config=config
    )

    # Merge con patrones históricos (filtrar duplicados)
    return merge_patterns(cached_patterns, new_patterns)
```

**Resultado esperado:**
- Si solo hay 1-2 horas de candles nuevos: 7s → <1s
- 85-95% reducción en recargas frecuentes

---

### **FASE 3: Arquitectura Robusta (1-2 semanas)**

#### 7. Background Worker Service ⭐ **SOLUCIÓN DEFINITIVA**
**Impacto:** Muy Alto | **Complejidad:** Alta

**Sobre tus preguntas:**

**¿El worker service se basa en CPU?**
- Sí, usa CPU para procesar patrones
- Pero de forma **controlada y no bloqueante**
- El worker corre en un proceso separado del servidor web

**¿Sobrecarga el PC?**
- NO, si se configura correctamente:
  - Límite de workers concurrentes (ej: máx 4 workers)
  - Prioridad de proceso baja (nice level)
  - Rate limiting (procesar 1 símbolo cada 2 segundos)
  - Sleep entre batches

**Arquitectura:**

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────┐
│   Frontend      │────────▶│  FastAPI Server  │◀────────│   Worker    │
│   (React)       │         │   (API only)     │         │   Service   │
└─────────────────┘         └──────────────────┘         └─────────────┘
                                     │                           │
                                     ▼                           ▼
                            ┌──────────────────┐       ┌─────────────┐
                            │   Redis Queue    │       │  Database   │
                            │   (jobs)         │       │  (patterns) │
                            └──────────────────┘       └─────────────┘
```

**Implementación:**

```python
# backend/worker.py

from celery import Celery
import time

celery_app = Celery('watchlist', broker='redis://localhost:6379')

# ⚙️ Configuración para NO sobrecargar CPU
celery_app.conf.update(
    worker_prefetch_multiplier=1,  # Procesar 1 tarea a la vez
    worker_max_tasks_per_child=10,  # Reiniciar worker cada 10 tareas
    task_time_limit=30,  # Timeout de 30s por tarea
)

@celery_app.task
def detect_patterns_task(symbol, interval, days, config):
    """Task de background - procesa 1 símbolo"""

    # Reducir prioridad del proceso (Linux)
    os.nice(10)

    patterns = detect_patterns(symbol, interval, days, config)

    # Guardar en database
    save_patterns_to_db(symbol, patterns)

    # Sleep para no saturar CPU
    time.sleep(0.5)

    return {"symbol": symbol, "count": len(patterns)}

def schedule_pattern_detection():
    """Scheduler - corre cada 15 minutos"""
    symbols = ["BTCUSDT", "ETHUSDT", ...]

    for symbol in symbols:
        # Encolar tarea (no bloquea)
        detect_patterns_task.delay(symbol, "60", 90, config)

        # Pequeño delay entre encolados
        time.sleep(0.1)
```

**Frontend consulta resultados:**
```javascript
// Solo consulta - no calcula
const response = await fetch(
  `${API_BASE_URL}/api/patterns/get/${symbol}`
);
const patterns = await response.json();
```

**Ventajas:**
- ✅ Frontend: consulta instantánea (<100ms)
- ✅ CPU: uso distribuido en el tiempo
- ✅ Actualización automática cada 15 min
- ✅ Escalable a 100+ símbolos
- ✅ No bloquea UI nunca

**Desventajas:**
- ⚠️ Complejidad: necesita Redis + Celery
- ⚠️ Delay inicial: primera carga toma tiempo
- ⚠️ Cambios de config: tardan 15 min en aplicarse (a menos que fuerces recálculo)

---

## 📈 Resumen de Impacto por Fase

| Fase | Optimización | Tiempo (30 símbolos) | Reducción | Esfuerzo |
|------|--------------|---------------------|-----------|----------|
| **Actual** | Ninguna | 210s (3.5 min) | - | - |
| **Fase 1** | Cache + Paralelo | 35-40s | 81% | 1-2 días |
| **Fase 2** | + Lazy Loading | 28-42s (inicial) | 80-87% | 3-5 días |
| **Fase 2** | + Vectorización | 12-18s | 94% | +2 días |
| **Fase 3** | Worker Service | <1s (consulta) | 99%+ | 1-2 semanas |

---

## 🎯 Recomendación Post-Debugging

Una vez validada la estrategia de trading, implementar en este orden:

### **Semana 1: Quick Wins**
1. ✅ Cache de patrones (Día 1)
2. ✅ Procesamiento paralelo (Día 2)
3. ✅ Early termination (Día 2)

**Meta:** 210s → 30-40s

### **Semana 2: UX Improvements**
4. ✅ Lazy loading con IntersectionObserver (Día 3-4)
5. ✅ Vectorización NumPy (Día 5-7)

**Meta:** 30-40s → 10-15s (percibido como instantáneo con lazy loading)

### **Semana 3-4: Producción (Opcional)**
6. ✅ Background worker service
7. ✅ Database storage
8. ✅ Incremental updates

**Meta:** <1s consulta instantánea

---

## 🔧 Configuración Recomendada para Worker Service

```python
# docker-compose.yml (para deployment)

version: '3.8'
services:
  redis:
    image: redis:alpine
    ports:
      - "6379:6379"

  backend:
    build: ./backend
    ports:
      - "8000:8000"
    depends_on:
      - redis

  worker:
    build: ./backend
    command: celery -A worker worker --loglevel=info --concurrency=2
    depends_on:
      - redis
    deploy:
      resources:
        limits:
          cpus: '2.0'      # Limitar a 2 CPU cores
          memory: 2G       # Limitar RAM
```

---

## 📝 Notas Importantes

### Durante Debugging (Ahora)
- ❌ NO implementar optimizaciones todavía
- ✅ Mantener sistema actual (cambios rápidos de config)
- ✅ Foco en validar estrategias de trading

### Para Producción (Después)
- ✅ Implementar Fase 1 mínimo (cache + paralelo)
- ✅ Lazy loading esencial para 30 monedas
- ✅ Worker service ideal para escalabilidad

### Trade-offs
- **Cache de patrones:** Funciona mal en debugging (config cambia mucho)
- **Lazy loading:** Perfecto para scroll, pero primera carga sigue lenta
- **Worker service:** Mejor UX pero mayor complejidad operacional

---

## 🧪 Testing de Rendimiento

Una vez implementado, medir con:

```javascript
// frontend/src/utils/PerformanceMonitor.js

class PerformanceMonitor {
  static async measurePatternLoad(symbol, config) {
    const start = performance.now();

    const response = await fetch('/api/double-topbottom/detect', {
      method: 'POST',
      body: JSON.stringify({ symbol, config })
    });

    const end = performance.now();
    const duration = end - start;

    console.log(`[Perf] ${symbol}: ${duration}ms`);

    // Enviar métrica al backend
    await fetch('/api/metrics', {
      method: 'POST',
      body: JSON.stringify({
        metric: 'pattern_load_time',
        symbol,
        duration,
        timestamp: Date.now()
      })
    });

    return duration;
  }
}
```

**Métricas objetivo:**
- ✅ P50: <2s por símbolo
- ✅ P95: <5s por símbolo
- ✅ Carga total (30 símbolos): <60s

---

*Documento generado: 26 de Diciembre 2024*
*Revisión requerida antes de implementar*
