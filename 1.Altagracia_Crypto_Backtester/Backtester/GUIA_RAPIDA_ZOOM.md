# Guía Rápida: Nuevo Sistema de Zoom

## ¿Qué hay de nuevo?

Tu aplicación de backtesting ahora tiene un sistema de zoom profesional similar a TradingView.

---

## 🎯 Zoom Manual Mejorado

### Antes:
- ❌ Solo podías ver ~1,000 velas máximo
- ❌ No podías ver todo el contexto disponible
- ❌ Zoom out limitado

### Ahora:
- ✅ Puedes ver TODAS las velas cargadas
- ✅ Zoom out ilimitado (hasta 0.3px por vela)
- ✅ Se adapta automáticamente a tus datos

**Cómo usar:**
- **Rueda del mouse** = Zoom horizontal (más/menos velas)
- **Ctrl + Rueda** = Zoom vertical (escala de precios)
- **Arrastrar** = Mover el gráfico
- **Doble click en eje Y** = Auto-ajustar escala

---

## ⚡ Presets de Zoom Rápido (NUEVO)

### ¿Qué son?

Botones que te llevan instantáneamente a períodos específicos con un solo click.

### Botones por defecto:

```
[⚙️] [1D] [3D] [1W] [ALL] [⛶] [→|] ...
```

- **⚙️** = Configurar presets
- **1D** = Ver último día
- **3D** = Ver últimos 3 días
- **1W** = Ver última semana
- **ALL** = Ver todo el rango disponible

**Cuando un preset está activo, el botón se pone NARANJA.**

---

## 🔧 Configurar Presets

1. Click en botón **⚙️** (gear icon)
2. Se abre ventana de configuración
3. Para cada preset puedes:
   - ✅ Activar/desactivar (checkbox)
   - ✏️ Cambiar etiqueta (máx 4 caracteres)
   - 📅 Cambiar período (1-730 días o "TODO")
4. Click "Guardar"

**Tu configuración se guarda automáticamente** y se mantiene después de cerrar el navegador.

---

## 📖 Ejemplos de Uso

### Escenario 1: Análisis de Scalping
```
Preset 1: "4H" (4 horas)
Preset 2: "1D" (1 día)
Preset 3: "3D" (contexto)
Preset 4: "ALL" (panorama completo)
```

### Escenario 2: Swing Trading
```
Preset 1: "1W" (semana actual)
Preset 2: "2W" (dos semanas)
Preset 3: "1M" (mes)
Preset 4: "ALL" (histórico completo)
```

### Escenario 3: Análisis Institucional
```
Preset 1: "1M" (mes)
Preset 2: "3M" (trimestre)
Preset 3: "1Y" (año)
Preset 4: "ALL" (todo)
```

---

## 🎓 Workflow Recomendado para Backtesting

1. **Carga tus datos:**
   - Selecciona timeframe (ej: 15m)
   - Selecciona días (ej: 15 días)

2. **Vista panorámica:**
   - Click en botón **ALL**
   - Ves todo el contexto disponible
   - Identificas zonas clave

3. **Zoom a área de interés:**
   - Click en preset **1W** o **3D**
   - O usa zoom manual (rueda del mouse)

4. **Análisis detallado:**
   - Usa **Ctrl + Rueda** para ajustar escala vertical
   - **Doble click en eje Y** para auto-scale

5. **Repetir** para diferentes áreas o activos

---

## ⚠️ Notas Importantes

### Con zoom extremo las velas se ven pequeñas:
**Esto es normal.** Si tienes 2,000 velas en 800 píxeles, cada vela medirá ~0.4 píxeles.

**Solución:**
- Usa presets para períodos más cortos
- O haz zoom in manual
- El objetivo es ver el **contexto**, no el detalle

### Los presets se adaptan al timeframe:
- **1D** en timeframe **15m** = 96 velas (24h × 4)
- **1D** en timeframe **1h** = 24 velas (24h × 1)
- **1D** en timeframe **D** = 1 vela (1 día)

**El sistema calcula automáticamente.**

### Preset "ALL" depende de los días cargados:
- Si cargaste 15 días, ALL muestra 15 días
- Si cargaste 730 días, ALL muestra 730 días
- Ajusta el selector de días para cargar más/menos datos

---

## 🚀 Tips Pro

1. **Atajos rápidos:**
   - Usa presets para navegación rápida
   - Luego ajusta manualmente con zoom
   - El preset se desmarca automáticamente

2. **Combina zoom horizontal y vertical:**
   - **Rueda** para ver más/menos velas
   - **Ctrl + Rueda** para aumentar/reducir rango de precios

3. **Resetear vista:**
   - Click en preset que necesites
   - O **Doble click en eje Y** para autoscale vertical
   - O botón **→|** para ir a última vela

4. **Para traders de múltiples timeframes:**
   - Configura diferentes presets por estrategia
   - Cambias rápido entre vistas sin perder tiempo

---

## ❓ Preguntas Frecuentes

**P: ¿Puedo tener más de 4 presets?**
R: Actualmente máximo 4-5 para no saturar la UI. En futuras versiones se podrá aumentar.

**P: ¿Los presets son por símbolo o globales?**
R: Son globales para todos los símbolos. Se adaptan automáticamente al timeframe.

**P: ¿Puedo compartir mis presets con otros traders?**
R: Por ahora no, pero es una feature planificada para próximas versiones.

**P: ¿El zoom dinámico tiene límite?**
R: Sí, mínimo 0.3 píxeles por vela para mantener visibilidad. Pero esto te permite ver miles de velas.

**P: ¿Funciona en fullscreen?**
R: Sí, los presets y zoom funcionan igual en modo fullscreen.

---

## 🆘 Soporte

Si encuentras algún problema:
1. Revisa que los servidores estén corriendo
2. Recarga la página (F5)
3. Limpia localStorage si es necesario
4. Reporta el issue con detalles

---

**¡Feliz Backtesting! 📈**
