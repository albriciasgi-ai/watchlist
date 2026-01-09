# Guía de Presets - Continuation Patterns Indicator

## 📋 Índice

1. [¿Qué son los Presets?](#qué-son-los-presets)
2. [Presets Disponibles](#presets-disponibles)
3. [Cómo Usar Presets](#cómo-usar-presets)
4. [Comparativa de Presets](#comparativa-de-presets)
5. [Personalización](#personalización)

---

## ¿Qué son los Presets?

Los **presets** son configuraciones predefinidas del indicador de Continuation Patterns optimizadas para diferentes estilos de trading y filosofías.

### ¿Por qué usar presets?

- ✅ **Ahorro de tiempo**: Configuración instantánea sin ajustar 20+ parámetros
- ✅ **Mejores prácticas**: Configuraciones probadas para cada estilo
- ✅ **Aprendizaje**: Ver cómo diferentes configuraciones afectan la detección
- ✅ **Experimentación**: Probar rápidamente diferentes enfoques

### ¿Cómo funcionan?

Un preset carga una configuración completa que incluye:
- Tipos de patrones activos (Reversal, Continuation, etc.)
- Patrones individuales activados/desactivados
- Parámetros de detección (estrictos vs permisivos)
- Confianza mínima requerida
- Configuración de level sources (VWAP, Fibonacci)
- Lógica de proximidad (normal vs invertida)

---

## Presets Disponibles

### 1. 🎯 Default (Balanceado)

**Filosofía**: Configuración general equilibrada para todos los estilos.

**Ideal para**:
- Traders que están empezando con el indicador
- Uso general en múltiples timeframes
- No estás seguro qué preset usar

**Características**:
```
Patrones activos: 16/16
Tipos activos: Reversal, Continuation
Confianza mínima: 30%
Parámetros: Balanceados (ni muy estrictos ni muy permisivos)
Level sources: VWAP ✅, Fibonacci ❌
Lógica proximidad: Normal (cerca de niveles = alta confianza)
```

**Patrones detectados esperados**: 10-20 por 100 velas

**Configuración clave**:
- `minConfidence: 30%` - Balance entre cantidad y calidad
- `minWickRatio: 1.5` - Detecta pin bars moderados
- `engulfingTolerance: 2%` - Permite 98% de envolvimiento
- Todos los patrones activados

---

### 2. 📚 Rayner Teo Mode

**Filosofía**: "Contexto sobre cantidad de patrones" - Enfoque del libro de Rayner Teo.

**Ideal para**:
- Traders que siguen la metodología de Rayner Teo
- Buscas menos señales pero de muy alta calidad
- Prefieres contexto (VWAP/Fibonacci) sobre patrones

**Características**:
```
Patrones activos: 8/16 (SOLO CORE)
  Reversal: Hammer, Shooting Star
  Continuation: Bull Flag, Bear Flag
  Trend Start: Bull/Bear Breakout
  Momentum: Three Soldiers/Crows

Tipos activos: TODOS (para ver las 4 categorías)
Confianza mínima: 50% (MUY ALTA)
Parámetros: Estrictos (alta calidad)
Level sources: VWAP ✅, Fibonacci ✅ (AMBOS)
Lógica proximidad: Normal (cerca = alta confianza)
```

**Patrones detectados esperados**: 3-8 por 100 velas

**Configuración clave**:
- `minConfidence: 50%` - Solo alta calidad
- `minWickRatio: 2.0` - Pin bars muy pronunciados
- `maxOppositeWick: 0.15` - Mechas opuestas mínimas
- `minTrendStrength: 70%` - Solo tendencias fuertes
- `engulfingTolerance: 1%` - Engulfing casi perfecto

**Diferencias vs Default**:
| Parámetro | Default | Rayner Teo | Efecto |
|-----------|---------|------------|--------|
| Patrones | 16 | 8 | -50% patrones |
| Confianza | 30% | 50% | Más selectivo |
| Wick Ratio | 1.5 | 2.0 | Solo pin bars pronunciados |
| Fibonacci | ❌ | ✅ | Más contexto |
| Señales | 10-20 | 3-8 | Menos pero mejores |

**Por qué estos 8 patrones**:
1. **Hammer/Shooting Star**: Los más confiables para reversión
2. **Bull/Bear Flag**: Patrones de continuación más claros
3. **Breakouts**: Inicio de tendencia bien definido
4. **Soldiers/Crows**: Momentum fuerte y claro

**Qué patrones NO incluye y por qué**:
- ❌ **Engulfing**: Muchos falsos positivos sin contexto
- ❌ **Doji**: Menos comunes y más ambiguos
- ❌ **Pennants**: Más difíciles de detectar que flags
- ❌ **Marubozu**: Menos confiables que soldiers/crows

---

### 3. ⚡ Scalping (Alta Frecuencia)

**Filosofía**: Máximas oportunidades para trading de corto plazo.

**Ideal para**:
- Scalpers (timeframes 1m-5m)
- Buscas muchas señales rápidas
- No te importan algunos falsos positivos

**Características**:
```
Patrones activos: 16/16 (TODOS)
Tipos activos: TODOS
Confianza mínima: 25% (MUY BAJA)
Parámetros: Permisivos (detecta más patrones)
Level sources: VWAP Rolling ✅, Fibonacci ❌
Lógica proximidad: Normal
```

**Patrones detectados esperados**: 25-40 por 100 velas

**Configuración clave**:
- `minConfidence: 25%` - Baja exigencia
- `minWickRatio: 1.2` - Acepta pin bars pequeños
- `minBreakoutSize: 0.5%` - Breakouts pequeños
- `minConsecutive: 2` - Solo 2 velas para soldiers/crows
- `vwap_type: 'rolling'` - Rolling VWAP mejor para scalping
- `showLabels: false` - Menos clutter visual

**Warning**: ⚠️ Alta tasa de falsos positivos. Requiere confirmación adicional.

---

### 4. 📊 Swing Trading (Posiciones Largas)

**Filosofía**: Conservador, alta calidad, pocas señales para posiciones de días/semanas.

**Ideal para**:
- Swing traders (timeframes 4h-1D)
- Buscas solo las mejores oportunidades
- Prefieres calidad sobre cantidad

**Características**:
```
Patrones activos: 4/16 (MUY SELECTIVO)
  Solo: Hammer, Shooting Star, Bull/Bear Breakout

Tipos activos: Reversal, Trend Start
Confianza mínima: 60% (EXTREMADAMENTE ALTA)
Parámetros: Muy estrictos
Level sources: VWAP ✅, Fibonacci ✅ (AMBOS)
Lógica proximidad: Normal
```

**Patrones detectados esperados**: 1-4 por 100 velas

**Configuración clave**:
- `minConfidence: 60%` - Solo lo mejor
- `minWickRatio: 2.5` - Solo pin bars perfectos
- `maxOppositeWick: 0.1` - Casi sin mecha opuesta
- `minBreakoutSize: 3%` - Solo breakouts grandes
- `fibonacciLookback: 150` - Lookback largo para swing
- `iconSize: 12px` - Iconos grandes para visibilidad

**Diferencias vs Rayner Teo**:
| Aspecto | Rayner Teo | Swing Trading |
|---------|------------|---------------|
| Patrones | 8 | 4 |
| Confianza | 50% | 60% |
| Enfoque | Contexto | Ultra conservador |
| Momentum | ✅ | ❌ |
| Continuation | ✅ | ❌ |

---

### 5. 🔍 Divergence Hunter

**Filosofía**: Detectar patrones LEJOS de niveles (divergencias, agotamiento).

**Ideal para**:
- Detectar divergencias precio vs indicadores
- Buscar agotamiento de tendencia
- Trading contrarian

**Características**:
```
Patrones activos: 6/16 (Solo Reversal)
Tipos activos: Solo Reversal
Confianza mínima: 40%
Parámetros: Moderadamente estrictos
Level sources: VWAP ✅, Fibonacci ✅ (AMBOS)
Lógica proximidad: ⚠️ INVERTIDA (lejos = alta confianza)
```

**Patrones detectados esperados**: 5-12 por 100 velas

**Configuración clave**:
- **`invertProximity: true`** - ⚠️ Lógica invertida
- `minConfidence: 40%` - Moderado
- Solo patrones de reversión activos
- Fibonacci con extensiones para detectar zonas extremas

**⚠️ Lógica Invertida Explicada**:
```
Normal:     Patrón cerca de VWAP = ALTA confianza
Invertida:  Patrón LEJOS de VWAP = ALTA confianza

Por qué: Un hammer que se forma lejos del VWAP en un máximo
puede indicar agotamiento o divergencia bearish.
```

**Ejemplo de uso**:
1. Precio sube fuertemente
2. Se forma shooting star LEJOS del VWAP
3. Indica posible agotamiento alcista
4. Señal de reversión bajista

---

## Cómo Usar Presets

### Paso 1: Abrir Modal de Configuración

1. Haz clic en el botón ⚙️ en el header del chart
2. Se abre el modal "Configuración Continuation Patterns"

### Paso 2: Seleccionar Preset

1. En la parte superior del modal verás: **📋 Cargar Preset**
2. Despliega el dropdown
3. Opciones disponibles:
   ```
   -- Custom / Actual --
   Default (Balanceado)
   Rayner Teo Mode
   Scalping (Alta Frecuencia)
   Swing Trading (Posiciones Largas)
   Divergence Hunter
   ```
4. Selecciona el preset deseado

### Paso 3: Configuración Aplicada

- ✅ Todos los parámetros se cargan instantáneamente
- ✅ Los patrones se actualizan en el gráfico
- ✅ Puedes ver los cambios inmediatamente

### Paso 4: Personalizar (Opcional)

Después de cargar un preset, puedes:
- Ajustar parámetros individuales
- Activar/desactivar patrones específicos
- Modificar confianza mínima
- Cambiar level sources

**Nota**: Al modificar cualquier parámetro, el preset se convierte en "Custom".

---

## Comparativa de Presets

### Tabla Comparativa General

| Preset | Patrones | Confianza | Señales/100 | Strictness | Timeframe |
|--------|----------|-----------|-------------|------------|-----------|
| Default | 16 | 30% | 10-20 | Medio | Todos |
| Rayner Teo | 8 | 50% | 3-8 | Alto | 15m+ |
| Scalping | 16 | 25% | 25-40 | Bajo | 1m-5m |
| Swing | 4 | 60% | 1-4 | Muy Alto | 4h-1D |
| Divergence | 6 | 40% | 5-12 | Medio | 15m+ |

### Comparativa de Parámetros Clave

| Parámetro | Default | Rayner | Scalping | Swing | Divergence |
|-----------|---------|--------|----------|-------|------------|
| Min Confidence | 30% | 50% | 25% | 60% | 40% |
| Min Wick Ratio | 1.5 | 2.0 | 1.2 | 2.5 | 2.0 |
| Engulfing Tolerance | 2% | 1% | 3% | 0.5% | 1.5% |
| Min Trend Strength | 60% | 70% | 50% | 75% | - |
| VWAP | ✅ | ✅ | ✅ | ✅ | ✅ |
| Fibonacci | ❌ | ✅ | ❌ | ✅ | ✅ |
| Invert Proximity | ❌ | ❌ | ❌ | ❌ | ✅ |

### Gráfico de Trade-offs

```
Cantidad de Señales vs Calidad:

Scalping ●━━━━━━━━━━━━━━━━━━━━○ Swing
          (Muchas señales,      (Pocas señales,
           más ruido)            alta calidad)

Default ━━━━━━●━━━━━━━━━━━━━━━━
Rayner  ━━━━━━━━━━━●━━━━━━━━━━
Divergence ━━━━━━━━●━━━━━━━━━━━
```

---

## Personalización

### Crear tu Propio "Preset"

Aunque no puedes guardar presets personalizados (todavía), puedes:

1. **Documentar tu configuración**:
   - Anota los parámetros que funcionan para ti
   - Guarda screenshots de la configuración
   - Crea un documento con tus valores

2. **Usar preset como base**:
   - Carga el preset más cercano a tu estilo
   - Ajusta solo los parámetros necesarios

3. **Probar sistemáticamente**:
   - Usa un preset durante una semana
   - Documenta resultados
   - Ajusta basado en performance

### Modificar un Preset Existente

**Ejemplo**: Rayner Teo Mode pero con más patrones

1. Carga "Rayner Teo Mode"
2. Ve a "Activar/Desactivar Patrones Individuales"
3. Activa patrones adicionales:
   - ✅ Bull/Bear Engulfing
   - ✅ Dragonfly/Gravestone Doji
4. Mantén el resto de configuración

**Resultado**: Rayner Teo con 12 patrones en lugar de 8.

### Combinar Filosofías

**Ejemplo**: Divergence Hunter + Momentum

1. Carga "Divergence Hunter"
2. Activa "Momentum" en tipos de patrones
3. Activa Three Soldiers/Crows en toggles individuales
4. Mantén lógica invertida para Reversal
5. Configura lógica normal para Momentum

**Resultado**: Detecta divergencias (Reversal) + momentum fuerte.

---

## Casos de Uso por Timeframe

### 1 minuto - 5 minutos
**Preset recomendado**: Scalping
- Muchas señales
- Confirmación rápida necesaria
- Stop loss apretados

### 15 minutos - 1 hora
**Preset recomendado**: Default o Rayner Teo
- Balance entre cantidad y calidad
- Contexto importante
- Intradía

### 4 horas - Diario
**Preset recomendado**: Swing Trading o Rayner Teo
- Alta calidad
- Pocas señales
- Posiciones largas

### Semanal+
**Preset recomendado**: Swing Trading
- Solo las mejores oportunidades
- Análisis profundo de contexto

---

## Preguntas Frecuentes

**Q: ¿Qué preset debo usar si estoy empezando?**
A: **Default**. Es balanceado y te permite ver diferentes tipos de patrones.

**Q: ¿Puedo guardar mi configuración personalizada?**
A: Actualmente no, pero está en el roadmap. Por ahora, documenta tus parámetros.

**Q: ¿Rayner Teo Mode es mejor que Default?**
A: No necesariamente. Es más selectivo (menos señales, más calidad). "Mejor" depende de tu estilo.

**Q: ¿Puedo usar diferentes presets para diferentes símbolos?**
A: La configuración es por símbolo, así que puedes cambiar el preset para cada uno.

**Q: ¿Qué preset usa menos recursos?**
A: **Swing Trading** - Solo 4 patrones activos, menos procesamiento.

**Q: ¿Puedo combinar presets?**
A: No directamente, pero puedes cargar uno y modificarlo manualmente.

**Q: ¿Los presets se guardan al cerrar el navegador?**
A: Actualmente no. Tendrás que reseleccionar el preset cada sesión.

---

## Tips y Mejores Prácticas

### 1. Experimenta con Presets
- Prueba cada preset durante al menos 1 semana
- Documenta qué funciona mejor para tu estilo
- No cambies presets constantemente

### 2. Ajusta Según Volatilidad
- **Alta volatilidad**: Usa parámetros más estrictos (Swing/Rayner)
- **Baja volatilidad**: Puedes usar más permisivos (Default/Scalping)

### 3. Combina con Otros Indicadores
- VWAP + Rayner Teo Mode = Excelente combinación
- Volume Profile + Divergence Hunter = Detecta zonas extremas

### 4. Backtesting Mental
- Observa patrones detectados durante días
- Nota cuáles resultan en movimientos reales
- Ajusta preset según resultados

### 5. No Sobreoptimices
- Evita ajustar parámetros cada día
- Dale tiempo a cada configuración
- Los presets ya están optimizados

---

## Presets Personalizados del Usuario

### ¿Cómo Guardar Mis Propios Presets?

El sistema ahora permite **guardar tus configuraciones personalizadas** como presets reutilizables.

#### Guardar un Preset

1. **Configura el indicador** a tu gusto:
   - Ajusta parámetros de detección
   - Activa/desactiva patrones
   - Modifica confianza mínima
   - Configura level sources

2. **En el modal**, sección "📋 Gestión de Presets":
   - Escribe un nombre en "Guardar configuración actual como:"
   - Ejemplos: "Mi Scalping BTC", "Swing ETH", "Intradía 15m"
   - Clic en "💾 Guardar" o presiona Enter

3. **Confirmación**:
   - Verás mensaje: "✅ Preset 'Tu Nombre' guardado exitosamente"
   - Aparece inmediatamente en dropdown bajo "⭐ Mis Presets"

#### Cargar un Preset Guardado

1. Abre dropdown "Cargar Preset"
2. Busca sección "━━━ Mis Presets ━━━"
3. Selecciona tu preset (tienen ⭐ al inicio)
4. Se carga instantáneamente

#### Eliminar un Preset

1. Carga el preset que quieres eliminar
2. Aparece botón "🗑️ Eliminar preset actual"
3. Clic en botón → Confirmación
4. Preset eliminado de localStorage

**Nota**: Solo puedes eliminar TUS presets. Los predefinidos no se pueden eliminar.

#### Persistencia

- ✅ Los presets se guardan en **localStorage del navegador**
- ✅ Sobreviven al cerrar el navegador
- ✅ Persisten entre sesiones
- ✅ Por símbolo (cada símbolo puede tener diferentes presets activos)

#### Backup y Restore (Avanzado)

Si necesitas hacer backup de tus presets:

```javascript
// En consola del navegador:
import { exportUserPresets, importUserPresets } from './presets/UserPresetManager';

// Exportar (copiar el JSON)
const backup = exportUserPresets();
console.log(backup);

// Importar (pegar JSON)
importUserPresets(backup);
```

---

**Última actualización**: 12 de Diciembre, 2024 (tarde)
**Versión**: 2.0 (con presets personalizados)
**Estado**: ✅ Completo
