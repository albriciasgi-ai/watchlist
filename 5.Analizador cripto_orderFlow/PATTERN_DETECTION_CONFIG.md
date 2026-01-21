# 📐 GUÍA DE CONFIGURACIÓN: Parámetros de Detección de Patrones

**Versión:** 2.7.0
**Fecha:** 2025-12-01

---

## 🎯 RESUMEN DE MEJORAS

Ahora **TODOS los parámetros** de detección de patrones son configurables, lo que te permite:

1. ✅ **Afinar el indicador** según el gráfico y timeframe
2. ✅ **Ver por qué se rechazan patrones** con modo debug
3. ✅ **Valores más permisivos por defecto** (más patrones detectados)

---

## 🔧 PARÁMETROS CONFIGURABLES

### **1. HAMMER** (Patrón Bullish - Pin Bar con mecha inferior larga)

```javascript
{
  hammer: {
    enabled: true,
    minWickRatio: 1.5,           // Mecha inferior / cuerpo (antes: 2.0)
    maxUpperWickRatio: 0.3,      // Mecha superior / cuerpo máximo (antes: 0.2)
    minBodyPosition: 0.5,        // Posición del cuerpo en el rango (0-1) (antes: 0.6)
    debug: false                 // Ver por qué se rechazan en consola
  }
}
```

**Qué hace cada parámetro:**

| Parámetro | Descripción | Valor Default | Ajustar Si... |
|-----------|-------------|---------------|---------------|
| `minWickRatio` | Mecha inferior debe ser X veces el cuerpo | 1.5 | Ves hammers con mechas más cortas que quieres detectar → reducir |
| `maxUpperWickRatio` | Mecha superior máxima permitida vs cuerpo | 0.3 | Quieres hammers con mecha superior más larga → aumentar |
| `minBodyPosition` | Qué tan arriba debe estar el cuerpo (0=abajo, 1=arriba) | 0.5 | Quieres detectar hammers con cuerpo más bajo → reducir |
| `debug` | Mostrar en consola por qué se rechazan | false | Quieres debuggear → `true` |

**Ejemplo visual:**
```
     |      <- Mecha superior (debe ser < 30% del cuerpo)
    ███     <- Cuerpo (debe estar en 50% superior del rango)
    ███
     |
     |
     |      <- Mecha inferior (debe ser >= 1.5x el cuerpo)
```

---

### **2. SHOOTING STAR** (Patrón Bearish - Pin Bar con mecha superior larga)

```javascript
{
  shootingStar: {
    enabled: true,
    minWickRatio: 1.5,           // Mecha superior / cuerpo
    maxLowerWickRatio: 0.3,      // Mecha inferior / cuerpo máximo
    minBodyPosition: 0.5,        // Posición del cuerpo desde arriba
    debug: false
  }
}
```

**Qué hace cada parámetro:**

| Parámetro | Descripción | Valor Default | Ajustar Si... |
|-----------|-------------|---------------|---------------|
| `minWickRatio` | Mecha superior debe ser X veces el cuerpo | 1.5 | Ves shooting stars con mechas más cortas → reducir |
| `maxLowerWickRatio` | Mecha inferior máxima permitida vs cuerpo | 0.3 | Quieres shooting stars con mecha inferior más larga → aumentar |
| `minBodyPosition` | Qué tan abajo debe estar el cuerpo (desde arriba) | 0.5 | Quieres cuerpos más arriba → reducir |
| `debug` | Mostrar en consola por qué se rechazan | false | Debuggear → `true` |

**Ejemplo visual:**
```
     |
     |
     |      <- Mecha superior (debe ser >= 1.5x el cuerpo)
    ███     <- Cuerpo (debe estar en 50% inferior del rango)
    ███
     |      <- Mecha inferior (debe ser < 30% del cuerpo)
```

---

### **3. DOJI** (Patrón de Indecisión)

```javascript
{
  doji: {
    enabled: false,              // Deshabilitado por defecto
    maxBodyRatio: 0.08,          // Cuerpo máximo vs rango total (antes: 0.05)
    minLongWick: 0.5,            // Mecha larga mínima vs rango (antes: 0.6)
    maxShortWick: 0.15,          // Mecha corta máxima vs rango (antes: 0.1)
    debug: false
  }
}
```

**Qué hace cada parámetro:**

| Parámetro | Descripción | Valor Default | Ajustar Si... |
|-----------|-------------|---------------|---------------|
| `maxBodyRatio` | Cuerpo máximo permitido como % del rango | 0.08 (8%) | Quieres dojis con cuerpo más grande → aumentar |
| `minLongWick` | Mecha larga mínima como % del rango | 0.5 (50%) | Ves dojis con mechas más cortas → reducir |
| `maxShortWick` | Mecha corta máxima como % del rango | 0.15 (15%) | Quieres dojis con mecha corta más larga → aumentar |
| `debug` | Mostrar en consola por qué se rechazan | false | Debuggear → `true` |

**Tipos de Doji:**
- **Dragonfly Doji** (🐉 Bullish): Mecha inferior larga, superior corta
- **Gravestone Doji** (🪦 Bearish): Mecha superior larga, inferior corta

---

## 🔍 MODO DEBUG

### **Cómo Habilitar Debug:**

**Opción 1: Debug Global (Todos los patrones)**
```javascript
{
  debugMode: true  // En la config principal
}
```

**Opción 2: Debug por Patrón**
```javascript
{
  patterns: {
    hammer: {
      enabled: true,
      debug: true  // Solo debug de hammers
    },
    shootingStar: {
      enabled: true,
      debug: false  // No debug de shooting stars
    }
  }
}
```

### **Qué Verás en la Consola:**

Con debug habilitado, verás mensajes como:

```
[HAMMER REJECTED] time=1764568800000, wickRatio=1.20 (need >=1.5), upperWickRatio=0.15 (need <=0.3), bodyPos=0.45 (need >=0.5)
```

**Interpretación:**
- `wickRatio=1.20` pero necesita `>=1.5` → **Rechazado por mecha inferior corta**
- `upperWickRatio=0.15` pasa (< 0.3) ✅
- `bodyPos=0.45` pero necesita `>=0.5` → **Rechazado por cuerpo muy bajo**

**Acción:** Reduce `minWickRatio` a 1.2 y `minBodyPosition` a 0.4 para detectar este patrón.

---

## ⚙️ CONFIGURACIÓN ADICIONAL

### **Swing Detection (Detección de Swings)**

```javascript
{
  swingDetection: {
    enabled: true,
    leftBars: 5,         // Velas a la izquierda para comparar
    rightBars: 5,        // Velas a la derecha para comparar
    required: false      // Si true, SOLO muestra patrones en swings
  }
}
```

**Valores recomendados por timeframe:**

| Timeframe | leftBars | rightBars | Razón |
|-----------|----------|-----------|-------|
| 1m | 3 | 3 | Swings más rápidos |
| 5m | 5 | 5 | Balance |
| 15m | 7 | 7 | Swings más amplios |
| 1H | 10 | 10 | Estructura macro |
| 4H | 12 | 12 | Swings grandes |

**¿Qué hace `required`?**
- `required: true` → Solo muestra patrones en swing highs/lows (**más restrictivo**)
- `required: false` → Muestra todos los patrones, pero marca cuáles están en swings (**más permisivo**)

---

### **Filtros de Confidence**

```javascript
{
  filters: {
    minConfidence: 50,         // Reducido de 60 - más permisivo
    requireNearLevel: false,   // Cambiado a false - más patrones
    proximityPercent: 1.0
  }
}
```

**Ajustar según necesidad:**

| Filtro | Valor Restrictivo | Valor Permisivo | Uso |
|--------|-------------------|-----------------|-----|
| `minConfidence` | 80-100 | 30-50 | Cuántos patrones quieres ver |
| `requireNearLevel` | `true` | `false` | Solo patrones cerca de niveles importantes |
| `proximityPercent` | 0.5% | 2.0% | Qué tan cerca debe estar de un nivel |

---

## 📊 EJEMPLOS DE USO

### **Caso 1: "Veo muy pocos patrones"**

**Problema:** Solo detecta 2-3 patrones en 100 velas.

**Solución:**
```javascript
{
  patterns: {
    hammer: {
      enabled: true,
      minWickRatio: 1.2,        // Reducir (era 1.5)
      maxUpperWickRatio: 0.4,   // Aumentar (era 0.3)
      minBodyPosition: 0.4      // Reducir (era 0.5)
    }
  },
  swingDetection: {
    required: false             // Desactivar requerimiento (era true)
  },
  filters: {
    minConfidence: 40          // Reducir (era 50)
  }
}
```

---

### **Caso 2: "Veo demasiados patrones (falsos positivos)"**

**Problema:** Detecta 50+ patrones, muchos irrelevantes.

**Solución:**
```javascript
{
  patterns: {
    hammer: {
      enabled: true,
      minWickRatio: 2.0,        // Aumentar (era 1.5)
      maxUpperWickRatio: 0.2,   // Reducir (era 0.3)
      minBodyPosition: 0.6      // Aumentar (era 0.5)
    }
  },
  swingDetection: {
    required: true              // Activar requerimiento (era false)
  },
  filters: {
    minConfidence: 70,         // Aumentar (era 50)
    requireNearLevel: true      // Solo patrones cerca de niveles
  }
}
```

---

### **Caso 3: "Quiero debuggear por qué no detecta un patrón específico"**

**Acción:**
1. Habilita debug en el patrón:
   ```javascript
   {
     hammer: {
       debug: true
     }
   }
   ```

2. Recarga la página (F5)

3. Abre la consola del navegador (F12 → Console)

4. Busca mensajes `[HAMMER REJECTED]`

5. Lee los valores y ajusta los parámetros según necesites

**Ejemplo de output:**
```
[HAMMER REJECTED] time=1764568800000, wickRatio=1.35 (need >=1.5), upperWickRatio=0.25 (need <=0.3), bodyPos=0.55 (need >=0.5)
```

**Solución:** Reduce `minWickRatio` de 1.5 a 1.3 para detectar este patrón.

---

## 🎛️ CÓMO MODIFICAR LA CONFIGURACIÓN

### **Método 1: Desde localStorage (Temporal - Solo testing)**

1. Abre la consola del navegador (F12)
2. Ejecuta:
```javascript
const symbol = 'BTCUSDT';
const config = JSON.parse(localStorage.getItem(`rejection_pattern_config_${symbol}`));
config.patterns.hammer.minWickRatio = 1.2;  // Ajustar valor
config.debugMode = true;  // Habilitar debug
localStorage.setItem(`rejection_pattern_config_${symbol}`, JSON.stringify(config));
location.reload();  // Recargar página
```

### **Método 2: Desde el código (Permanente)**

Modifica `getDefaultConfig()` en `RejectionPatternIndicator.js`:

```javascript
getDefaultConfig() {
  return {
    patterns: {
      hammer: {
        minWickRatio: 1.2,  // Tu valor personalizado
        // ...
      }
    }
  };
}
```

---

## 📈 VALORES RECOMENDADOS POR TIMEFRAME

### **1 Minuto (Scalping)**
```javascript
{
  hammer: {
    minWickRatio: 1.2,
    maxUpperWickRatio: 0.4,
    minBodyPosition: 0.4
  },
  swingDetection: {
    leftBars: 3,
    rightBars: 3,
    required: false
  },
  filters: {
    minConfidence: 40
  }
}
```

### **15 Minutos / 1 Hora (Swing Trading)**
```javascript
{
  hammer: {
    minWickRatio: 1.5,
    maxUpperWickRatio: 0.3,
    minBodyPosition: 0.5
  },
  swingDetection: {
    leftBars: 7,
    rightBars: 7,
    required: true
  },
  filters: {
    minConfidence: 60
  }
}
```

### **4 Horas / Diario (Position Trading)**
```javascript
{
  hammer: {
    minWickRatio: 2.0,
    maxUpperWickRatio: 0.2,
    minBodyPosition: 0.6
  },
  swingDetection: {
    leftBars: 12,
    rightBars: 12,
    required: true
  },
  filters: {
    minConfidence: 70
  }
}
```

---

## 🚀 PRÓXIMOS PASOS

1. **Recarga la aplicación** para aplicar los nuevos valores default más permisivos
2. **Revisa cuántos patrones detecta** ahora (debería ser más que antes)
3. **Habilita debug** si quieres entender por qué se rechazan algunos
4. **Ajusta los parámetros** según lo que veas en tu gráfico
5. **Comparte feedback** sobre qué valores funcionan mejor

---

## 📞 SOPORTE

Si encuentras problemas:
1. Habilita `debugMode: true`
2. Abre consola del navegador (F12)
3. Copia los mensajes `[PATTERN REJECTED]`
4. Ajusta parámetros según los valores mostrados

---

**Firma:** ✅ Configuración completa y documentada
**Versión:** 2.7.0 - Parámetros Configurables + Debug Mode
**Fecha:** 2025-12-01
