# CLAUDE.md - Watchlist Trading System

Este archivo proporciona orientación a Claude Code para trabajar en este repositorio.

---

## REGLAS DEL PROYECTO

### Idioma
**IMPORTANTE**: Comunicarse SIEMPRE en español con el usuario. Todos los mensajes, explicaciones y comentarios deben ser en español.

### Perfil
Agente programador Python con experiencia en desarrollo de aplicaciones.

### Comportamiento
1. **Autonomia**: Trabajar sin preguntar. Entregar código completo y funcional, no mostrar borradores ni código parcial en el chat.
2. **Formato visual**: NO modificar estilos, CSS, layouts ni estructura visual existente.
3. **Honestidad**: Si algo no es posible o hay limitaciones, informar claramente.
4. **Calidad**: Revisar exhaustivamente antes de entregar. Ediciones pequeñas y precisas, evitar refactors grandes.
5. **Análisis profundo**: Cuando se solicite, revisar archivos relacionados, dependencias, edge cases y posibles efectos secundarios.

### Limitaciones conocidas
- No puedo ejecutar código Python directamente para probar
- Las pruebas de funcionamiento las debe hacer el usuario

---

## VISIÓN GENERAL DEL REPOSITORIO

Este repositorio contiene **11 aplicaciones relacionadas** para trading de criptomonedas:

| Carpeta | Aplicación | Puerto Backend | Puerto Frontend | Documentación |
|---------|------------|----------------|-----------------|---------------|
| `1.Altagracia_Crypto_Backtester/` | Backtester de estrategias | 9000 | 5173 | `./Backtester/CLAUDE.md` |
| `2.WatchlistConIndicadores/` | Watchlist con indicadores en tiempo real | 8000 | 5173 | `CLAUDE_WATCHLIST.md` |
| `3.TradingBot_Python/` | Bot de trading automatizado | 5000 | 3000 | `./CLAUDE.md` |
| `4.Analizador cripto/` | Analizador de un solo símbolo | 10001 | 10001 | `CLAUDE_ANALIZADOR.md` |
| `5.Order_flow/` | Analizador de Order Flow | 11000 | 11001 | `CLAUDE_ORDERFLOW.md` |
| `6.Trading_Journal/` | Diario de trading | 12000 | 12001 | `CLAUDE_JOURNAL.md` |
| `7.WatchlistDesktop/` | Watchlist Electron | 8000 | Electron | Ver App 2 |
| `8.AnalizadorDesktop/` | Analizador Desktop Electron | 10001 | 5174 | Ver App 4 |
| `9.OrderFlowDesktop/` | Order Flow Desktop Electron | 11000 | 5175 | Ver App 5 |
| `10.TradingBotDesktop/` | Trading Bot Desktop Electron | 5000 | 5001 | Ver App 3 |
| `11.TradingJournalDesktop/` | Trading Journal Desktop Electron | 12000 | 12002 | Ver App 6 |

**Stack común:**
- Frontend: React 18 + Vite + uPlot
- Backend: FastAPI + Uvicorn (Python 3.10+)
- Data Source: Bybit Futures API (REST + WebSocket)
- Desktop: Electron 33+ (Apps 7-11)

---

## CÓMO USAR ESTA DOCUMENTACIÓN

### Estructura de Archivos CLAUDE.md

**Archivo Raíz** (`CLAUDE.md`):
- Visión general del repositorio
- Reglas globales del proyecto
- Integraciones entre aplicaciones
- Referencias a documentación específica

**Archivos Específicos por App**:
Cada aplicación tiene su propia documentación detallada. Cuando trabajes en una app específica, consulta su CLAUDE.md correspondiente:

1. **Backtester**: `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md`
2. **Watchlist**: `CLAUDE_WATCHLIST.md` (este directorio)
3. **Trading Bot**: `3.TradingBot_Python/CLAUDE.md`
4. **Analizador**: `CLAUDE_ANALIZADOR.md` (este directorio)
5. **Order Flow**: `CLAUDE_ORDERFLOW.md` (este directorio)
6. **Journal**: `CLAUDE_JOURNAL.md` (este directorio)

### Qué Contiene Cada CLAUDE.md Específico

- Arquitectura detallada de la aplicación
- Endpoints API y estructura de datos
- Componentes principales y su responsabilidad
- Indicadores y sistemas específicos
- Historial de cambios recientes
- Troubleshooting específico
- Comandos de inicio

---

## INTEGRACIÓN ENTRE APLICACIONES

### Flujo Completo de Trading

```
1. BACKTESTER (App 1)
   - Desarrolla y prueba estrategias
   - Analiza patrones históricos
   - Optimiza parámetros
   ↓
2. WATCHLIST (App 2)
   - Monitorea mercado en tiempo real
   - Detecta patrones configurados
   - Genera alertas automáticas
   ↓
3. TRADING BOT (App 3)
   - Recibe alertas de Watchlist (puerto 5000)
   - Ejecuta órdenes en Bybit
   - Gestiona SL/TP automáticamente
   ↓
4. TRADING JOURNAL (App 6)
   - Registra trades ejecutados
   - Calcula métricas de rendimiento
   - Genera análisis y estadísticas
```

### Conexión Watchlist → Bot

```python
# En 2.WatchlistConIndicadores/backend/alert_sender.py
async def send_alert(alert_data):
    await httpx.post("http://localhost:5000/api/watchlist-alert", json=alert_data)

# En 3.TradingBot_Python/backend/main.py
@app.post("/api/watchlist-alert")
async def process_watchlist_alert(alert: dict):
    # Ejecuta orden si pasa filtros
```

---

## COMANDOS RÁPIDOS POR APLICACIÓN

### Backtester (App 1)
```bash
cd 1.Altagracia_Crypto_Backtester/Backtester/backend
uvicorn main:app --reload --port 9000

cd ../frontend
npm run dev  # Puerto 5173
```

### Watchlist (App 2)
```bash
cd 2.WatchlistConIndicadores/backend
start_backend.bat  # Puerto 8000

cd ../frontend
npm run dev  # Puerto 5173
```

### Trading Bot (App 3)
```bash
cd 3.TradingBot_Python
START_HERE.bat  # Puerto 5000 (backend) + 3000 (frontend)
```

### Analizador (App 4/8)
```bash
cd "4.Analizador cripto/backend"
start_backend.bat  # Puerto 10001

cd 8.AnalizadorDesktop
npm run dev:electron  # Electron app
```

---

## TROUBLESHOOTING GLOBAL

**Backend no inicia:**
- Verificar Python 3.10+
- Verificar puerto no en uso
- Verificar .venv existe

**Frontend no carga gráficos:**
- Verificar backend corriendo
- Revisar consola por errores CORS

**Alertas no llegan al Bot:**
- Verificar Bot corriendo en puerto 5000
- Verificar dirección del símbolo no es DISABLED

**Órdenes no se ejecutan:**
- Verificar credenciales Bybit
- Verificar modo (Demo vs Live)
- Revisar logs del Bot

---

## REFERENCIAS

Para documentación detallada de cada aplicación, consulta el archivo CLAUDE.md correspondiente listado en la tabla de "VISIÓN GENERAL DEL REPOSITORIO".
