# 📝 CHANGELOG - Trading Bot

Registro de cambios y versiones del proyecto.

---

## [1.1.0] - 2025-01-23

### 🆕 Agregado

#### Integración con Watchlist
- Nuevo endpoint `POST /api/watchlist-alert` para recibir alertas en formato JSON
- Soporte para patrones de velas con detección automática de dirección
- Campo `confidence` opcional en alertas
- Logs mejorados con información de patrón y confianza
- Documentación completa en `WATCHLIST_INTEGRATION.md`
- Guía de configuración en `CONFIGURAR_WATCHLIST.md`
- Script de prueba `test_watchlist_alert.py`

#### Historial Permanente de Órdenes
- Persistencia automática en `config/order_history.json`
- Sin límite de órdenes (antes: 500)
- Nuevo endpoint `DELETE /api/orders/history` para borrar historial
- Botón "Clear History" en la UI con confirmación
- Carga automática del historial al iniciar
- Guardado automático en cada orden ejecutada

### 🔧 Modificado

#### Backend
- **Puerto cambiado:** 7000 → **5000**
- `main.py`:
  - Nueva clase `WatchlistAlertRequest`
  - Métodos `load_order_history()`, `save_order_history()`, `clear_order_history()`
  - Modificado `add_order_to_history()` para persistencia automática
  - Carga de historial en `startup()`

#### Frontend
- `vite.config.js`: Proxy actualizado al puerto 5000
- `App.jsx`: WebSocket actualizado al puerto 5000
- `OrdersPanel.jsx`:
  - Función `clearHistory()` agregada
  - Botón "Clear History" con diálogo de confirmación

#### Scripts
- `START_HERE.bat`: URLs actualizadas al puerto 5000
- `start_backend.bat`: URLs actualizadas al puerto 5000

### 📚 Documentación
- `SESSION_NOTES.md`: Documentación completa de la sesión
- `WATCHLIST_INTEGRATION.md`: Guía de integración (15 páginas)
- `CONFIGURAR_WATCHLIST.md`: Configuración paso a paso (10 páginas)
- `README.md`: Actualizado con nuevas funcionalidades
- `CHANGELOG.md`: Este archivo

### ✅ Probado
- ✅ Endpoint `/api/watchlist-alert` funcionando
- ✅ 3 órdenes de prueba ejecutadas exitosamente en Bybit
- ✅ Persistencia de historial verificada
- ✅ Botón Clear History funcional
- ✅ Todos los puertos actualizados correctamente

---

## [1.0.0] - 2025-01-20

### 🎉 Lanzamiento Inicial

#### Core Trading
- Cliente Bybit con firma HMAC-SHA256
- Ejecución automática de Market + SL + TP
- Parser de alertas ATAS
- Gestión de riesgo automática
- Filtros de dirección por símbolo
- Verificación de posiciones duplicadas
- StepSize/TickSize para 16 símbolos

#### Interfaz Web
- Dashboard con WebSocket en tiempo real
- Panel de alertas
- Panel de posiciones con auto-refresh
- Gestor de configuraciones
- Gestor de direcciones de trading
- Logs en tiempo real

#### Backend
- FastAPI 0.115.0
- Uvicorn 0.32.0
- HTTPX 0.27.2
- WebSocket support

#### Frontend
- React 18.3.1
- Vite 5.4.2
- Dark theme profesional
- Responsive design

#### Documentación
- README.md completo (15 páginas)
- QUICKSTART.md (8 páginas)
- PROJECT_SUMMARY.md (6 páginas)
- ENTREGA_FINAL.md (8 páginas)

#### Scripts
- `START_HERE.bat` - Inicio automático
- `start_backend.bat` - Solo backend
- `start_frontend.bat` - Solo frontend

---

## Formato del Changelog

Este changelog sigue el formato [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/),
y este proyecto adhiere a [Semantic Versioning](https://semver.org/lang/es/).

### Tipos de Cambios
- **Agregado** - Para nuevas funcionalidades
- **Modificado** - Para cambios en funcionalidades existentes
- **Obsoleto** - Para funcionalidades que serán removidas
- **Removido** - Para funcionalidades removidas
- **Corregido** - Para bugs corregidos
- **Seguridad** - Para vulnerabilidades corregidas

---

**Última actualización:** 23 de Enero 2025
