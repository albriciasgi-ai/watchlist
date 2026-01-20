# Rejection Pattern Detection System

Sistema completo de detección de patrones de rechazo/retroceso en velas japonesas con validación contextual.

## 📋 Tabla de Contenidos

1. [Descripción General](#descripción-general)
2. [Arquitectura](#arquitectura)
3. [Instalación](#instalación)
4. [Uso](#uso)
5. [Configuración](#configuración)
6. [Sistema de Alertas](#sistema-de-alertas)
7. [Patrones Detectados](#patrones-detectados)
8. [Troubleshooting](#troubleshooting)

---

## 📖 Descripción General

Este sistema detecta patrones de velas japonesas (Hammer, Shooting Star, Engulfing, Doji) y los valida contra **contextos de referencia** seleccionados por el usuario (Volume Profiles, Range Detector).

### ✨ Características Principales

- ✅ **Detección de 6 patrones**: Hammer, Shooting Star, Engulfing (Bullish/Bearish), Doji (Dragonfly/Gravestone)
- ✅ **Validación contextual**: Solo alerta patrones cerca de niveles clave (POC, VAH, VAL, rangos)
- ✅ **Sistema de confianza**: Score 0-100 basado en calidad del patrón, proximidad a niveles, volumen
- ✅ **Alertas externas**: Envía notificaciones a puerto 5000 para integración con otros servicios
- ✅ **Configuración por símbolo**: Cada criptomoneda puede tener su propia configuración
- ✅ **Filtros avanzados**: Confianza mínima, proximidad, volumen, etc.

---

## 🏗️ Arquitectura

### Backend (FastAPI)

```
backend/
├── main.py                    # Endpoints principales + rejection pattern endpoints
├── rejection_detector.py      # Lógica de detección de patrones
└── alert_sender.py            # Envío de alertas a puerto 5000
```

**Nuevos Endpoints:**

- `POST /api/rejection-patterns/detect` - Detecta patrones para un símbolo
- `GET /api/rejection-patterns/available-contexts/{symbol}` - Lista contextos disponibles

### Frontend (React)

```
frontend/src/components/
├── RejectionPatternSettings.jsx      # Panel de configuración
├── RejectionPatternSettings.css      # Estilos del panel
└── indicators/
    └── RejectionPatternIndicator.js  # Renderizado en el chart
```

### Servicio de Alertas

```
alert_listener.py          # Servicio HTTP en puerto 5000
start_alert_listener.bat   # Script para iniciar el servicio (Windows)
```

---

## 🚀 Instalación

### 1. Backend (ya instalado)

El backend ya tiene los módulos integrados. No requiere instalación adicional.

### 2. Frontend

El sistema se integra con el `Watchlist.jsx` existente. Ver sección [Integración](#integración-con-watchlist).

### 3. Servicio de Alertas

```bash
# Opción 1: Windows (recomendado)
start_alert_listener.bat

# Opción 2: Manual
python alert_listener.py
```

El servicio estará disponible en: `http://localhost:5000`

---

## 💻 Uso

### Flujo Básico

```
1. Usuario abre Watchlist y selecciona un símbolo (ej. BTCUSDT)
2. Activa indicadores de referencia:
   - Volume Profile (dinámico o fijo)
   - Range Detector
3. Abre "Configuración de Patrones de Rechazo"
4. Selecciona qué contextos usar para validación:
   ✅ VP Dinámico (POC: $42,150)
   ✅ VP Fijo: Nov 1-10 (POC: $41,800)
   ❌ Rango Detectado (deshabilitado)
5. Ajusta filtros (confianza mínima, proximidad, volumen)
6. Los patrones detectados se renderizan en el chart
7. (Opcional) Habilita alertas → puerto 5000
```

### Ejemplo Visual

```
Chart de BTCUSDT 4H:

                ⭐ ← Shooting Star detectado (87% confianza)
               /|\    cerca de VAH del VP
              / | \
             /  |  \
    ────────────────── VAH (Value Area High)
         |     |
         |  🔨 | ← Hammer detectado (78% confianza)
         | /|\ |    cerca de POC del VP Fijo
         |/ | \|
    ────────────────── POC (Point of Control) VP Fijo
         |  |  |
```

---

## ⚙️ Configuración

### Panel de Configuración

El panel `RejectionPatternSettings.jsx` tiene 4 secciones:

#### 1. **Patrones a Detectar**

```
✅ 🔨 Hammer (Pin Bar alcista)
   - Sombra inferior larga (≥ 2x cuerpo)
   - Cierre en tercio superior del rango

✅ ⭐ Shooting Star (Pin Bar bajista)
   - Sombra superior larga (≥ 2x cuerpo)
   - Cierre en tercio inferior del rango

✅ 📦 Engulfing
   - Una vela envuelve completamente la anterior
   - Indica reversión fuerte

❌ 🎯 Doji (deshabilitado por defecto)
   - Cuerpo muy pequeño con mechas largas
```

**Configuración Avanzada:**
- `minWickRatio`: Ratio mínimo de mecha/cuerpo (1.5 - 4.0)

#### 2. **Contextos de Referencia**

Esta es la sección **clave** del sistema. Define qué niveles técnicos usar para validar patrones.

```
Tipos de contextos:
- Volume Profile Dinámico    → POC, VAH, VAL actuales
- Volume Profile Fijo        → POC, VAH, VAL de rango manual
- Range Detector             → TOP, BOTTOM, MIDDLE de rangos detectados
```

**Cómo agregar contextos:**

1. Activa el indicador en el chart (VP o Range Detector)
2. Click en "➕ Add Reference Context"
3. Selecciona el tipo y configura el peso (0-100%)

**Peso del contexto:**
- 100% = Máxima importancia
- 50% = Importancia media
- 0% = Deshabilitado

#### 3. **Filtros y Confianza**

```
Confianza Mínima: [60%] ──────────●────── [100%]
  Menor = más patrones (más falsos positivos)
  Mayor = menos patrones (más selectivo)

✅ Solo alertar cerca de nivel clave
  Tolerancia de proximidad: [1.0%] ──●── [5.0%]

✅ Requiere volumen elevado
  Volumen debe ser > 1.2x promedio
```

**Cálculo de Confianza:**
```
Confianza = (Calidad del Patrón × 30%)
          + (Proximidad a Niveles × 40%)
          + (Volumen × 15%)
          + (Tamaño Relativo × 15%)
```

#### 4. **Alertas**

```
✅ Enable alerts to port 5000
  Envía notificaciones al servicio de alertas
```

---

## 🔔 Sistema de Alertas

### Arquitectura

```
Backend (8000)          Alert Listener (5000)
    |                          |
    | POST /api/alerts         |
    |───────────────────────>  |
    |                          |
    |                      [Dashboard]
    |                      [Logs]
    |                      [Notifications*]

* Futuro: Telegram, Email, etc.
```

### Iniciar el Servicio de Alertas

```bash
# Windows
start_alert_listener.bat

# Linux/Mac
python alert_listener.py
```

### Dashboard de Alertas

Abre en tu navegador: `http://localhost:5000`

**Características:**
- 📊 Lista de alertas recientes
- 🔄 Auto-refresh cada 5 segundos
- 🗑️ Botón para limpiar historial
- 📋 Detalles completos de cada alerta

### Formato de Alerta

```json
{
  "type": "REJECTION_PATTERN_ALERT",
  "timestamp": 1699123456000,
  "symbol": "BTCUSDT",
  "interval": "4h",
  "severity": "HIGH",
  "title": "🔨 BTCUSDT | 4h - Hammer",
  "description": "Hammer detected @ $42,150\nConfidence: 87.3%\nNear 2 key level(s):\n  • POC @ $42,180 (0.07% away) - Volume Profile Fixed\n  • VAL @ $41,900 (0.59% away) - Volume Profile Dynamic",
  "data": {
    "patternType": "HAMMER",
    "confidence": 87.3,
    "price": 42150,
    "nearLevels": [...],
    "metrics": {
      "pattern_quality": 0.89,
      "volume_score": 0.92
    }
  }
}
```

### Integración Futura

El servicio de alertas está diseñado para extenderse fácilmente:

```python
# alert_listener.py - Agregar en receive_alert():

# Telegram
if TELEGRAM_ENABLED:
    send_telegram_message(alert)

# Email
if EMAIL_ENABLED:
    send_email_alert(alert)

# Webhook
if WEBHOOK_URL:
    requests.post(WEBHOOK_URL, json=alert)
```

---

## 📊 Patrones Detectados

### 1. Hammer 🔨

**Características:**
- Sombra inferior ≥ 2x tamaño del cuerpo
- Sombra superior pequeña (≤ 10% del cuerpo)
- Cierre en tercio superior del rango

**Significado:** Rechazo bajista → Posible reversión alcista

**Mejor en:** Soportes, POC inferior, VAL

### 2. Shooting Star ⭐

**Características:**
- Sombra superior ≥ 2x tamaño del cuerpo
- Sombra inferior pequeña (≤ 10% del cuerpo)
- Cierre en tercio inferior del rango

**Significado:** Rechazo alcista → Posible reversión bajista

**Mejor en:** Resistencias, POC superior, VAH

### 3. Engulfing Bullish 📈

**Características:**
- Vela previa bajista (cierre < apertura)
- Vela actual alcista (cierre > apertura)
- Cuerpo actual envuelve completamente cuerpo previo

**Significado:** Compradores superan vendedores → Reversión alcista

### 4. Engulfing Bearish 📉

**Características:**
- Vela previa alcista (cierre > apertura)
- Vela actual bajista (cierre < apertura)
- Cuerpo actual envuelve completamente cuerpo previo

**Significado:** Vendedores superan compradores → Reversión bajista

### 5. Dragonfly Doji 🐉

**Características:**
- Cuerpo muy pequeño (< 5% del rango)
- Sombra inferior larga (> 60% del rango)
- Sin sombra superior

**Significado:** Indecisión con rechazo bajista

### 6. Gravestone Doji 🪦

**Características:**
- Cuerpo muy pequeño (< 5% del rango)
- Sombra superior larga (> 60% del rango)
- Sin sombra inferior

**Significado:** Indecisión con rechazo alcista

---

## 🔧 Troubleshooting

### Problema: No se detectan patrones

**Posibles causas:**

1. **Sin contextos activos**
   ```
   Solución: Agregar al menos 1 contexto de referencia
   (Volume Profile o Range Detector)
   ```

2. **Confianza mínima muy alta**
   ```
   Solución: Reducir "Confianza Mínima" a 50-60%
   ```

3. **No hay patrones cerca de niveles**
   ```
   Solución: Aumentar "Tolerancia de proximidad" a 2-3%
   ```

### Problema: Alertas no llegan al puerto 5000

1. **Verificar que el servicio está corriendo:**
   ```bash
   # Abrir http://localhost:5000
   # Debe mostrar el dashboard
   ```

2. **Verificar que las alertas están habilitadas:**
   ```
   Panel de configuración → Alertas → ✅ Enable alerts
   ```

3. **Check backend logs:**
   ```bash
   cd backend
   # Buscar mensajes de "Alert sender"
   ```

### Problema: Muchos falsos positivos

**Solución:**

1. Aumentar confianza mínima a 70-80%
2. ✅ Habilitar "Requiere volumen elevado"
3. ✅ Habilitar "Solo alertar cerca de nivel clave"
4. Usar solo contextos de alta calidad (VP fijos bien definidos)

### Problema: Backend error al detectar patrones

**Check logs:**

```bash
cd backend
# Ver terminal donde corre uvicorn
# Buscar errores de:
# - rejection_detector.py
# - alert_sender.py
```

**Verificar que existen los módulos:**
```bash
ls backend/rejection_detector.py
ls backend/alert_sender.py
```

---

## 📝 Notas de Implementación

### Integración con Watchlist

El sistema está diseñado para integrarse con el `Watchlist.jsx` existente. Pasos recomendados:

1. Importar componentes:
   ```jsx
   import RejectionPatternSettings from './RejectionPatternSettings';
   import RejectionPatternIndicator from './indicators/RejectionPatternIndicator';
   ```

2. Agregar botón de configuración en cada símbolo

3. Agregar indicador al IndicatorManager

Ver ejemplo de integración en sección siguiente.

### Performance

- **Cache:** Las detecciones se calculan en el backend y no se re-calculan en cada render
- **Lazy loading:** Los patrones solo se cargan cuando el usuario abre el panel
- **Optimización:** Use `days` apropiados (7-14 días para 4H, 30 días para 1H)

### Próximas Mejoras (Fase 2)

- [ ] Detección en tiempo real (WebSocket)
- [ ] Backtesting de patrones
- [ ] ML para mejorar confianza
- [ ] Integración con Telegram bot
- [ ] Alertas por email
- [ ] Dashboard avanzado con estadísticas

---

## 📚 Referencias

- `VolumeProfile_tradingview.txt` - Investigación Volume Profile
- `RangeDetector_tradingView.txt` - Algoritmo Range Detector
- `EstudioTrading/` - Libros de patrones de velas

---

## 🤝 Contribuciones

Sistema desarrollado por Claude Code.

Para reportar bugs o sugerir mejoras, crear un issue en el repositorio.

---

**¡Happy Trading! 🚀📈**
