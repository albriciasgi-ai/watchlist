# ⚡ QUICKSTART - Trading Bot

> **¡Inicia en 5 minutos!** Guía rápida para comenzar a usar el Trading Bot

---

## 🎯 Paso 1: Iniciar la Aplicación (30 segundos)

### Windows (Recomendado)

**Doble click en:**
```
START_HERE.bat
```

✅ Esto iniciará automáticamente backend y frontend

### Manual (Si prefieres control)

**Terminal 1 - Backend:**
```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm install
npm run dev
```

---

## 🌐 Paso 2: Acceder a la Aplicación (10 segundos)

Abre tu navegador en:

```
http://localhost:3000
```

✅ Deberías ver la interfaz del Trading Bot

---

## 🔐 Paso 3: Configurar Credenciales (2 minutos)

### Opción A: Testnet (Recomendado para pruebas)

1. Ve a [Bybit Testnet](https://testnet.bybit.com/)
2. Crea una cuenta de prueba
3. Ve a: User → API Management
4. Crea una API Key:
   - ✅ Read
   - ✅ Trade
   - ❌ Withdraw (NO habilitar)
5. Copia **API Key** y **API Secret**

### Opción B: Live (Solo si ya probaste en Testnet)

1. Ve a [Bybit Live](https://www.bybit.com/)
2. Inicia sesión
3. User → API Management
4. Crear API Key (mismos permisos que arriba)

### Configurar en la App

1. En el Dashboard, ve al panel "Credentials"
2. Pega tu **API Key**
3. Pega tu **API Secret**
4. Selecciona **Testnet** ✅ (o Live si aplica)
5. Click **"Save Credentials"**

✅ Deberías ver "Credentials configured successfully"

---

## 🎯 Paso 4: Habilitar un Símbolo (1 minuto)

1. En el Dashboard, panel "Trading Directions"
2. Encuentra **BTCUSDT**
3. Click en **"BOTH"**
4. Verás que cambia de gris a color

✅ BTCUSDT ahora acepta alertas LONG y SHORT

**Opcional**: Habilita más símbolos según prefieras

---

## 🚀 Paso 5: Prueba tu Primera Alerta (1 minuto)

### Formato de Alerta ATAS

```
[2025-01-20 14:30:00] [BTCUSDT] ABRIR LONG 95000
```

### Cómo probar

1. Ve a la pestaña **"Alerts"**
2. En el textarea grande, pega:
```
[2025-01-20 14:30:00] [BTCUSDT] ABRIR LONG 50000
```
3. Click **"Process Alert"**

### ¿Qué verás?

La aplicación:
1. ✅ Parseará la alerta
2. ✅ Mostrará: Symbol, Side, Price
3. ✅ Verificará si ya tienes posición abierta
4. ✅ Calculará la cantidad basada en riesgo
5. ✅ Ejecutará la secuencia: Market → SL → TP

**Logs en tiempo real**:
- Verás cada paso en el panel de logs
- Color verde = éxito
- Color rojo = error

---

## 📊 Paso 6: Verificar en Bybit (30 segundos)

1. Ve a [Bybit Testnet - Positions](https://testnet.bybit.com/app/trade)
2. Busca **BTCUSDT**
3. Deberías ver:
   - ✅ Posición LONG abierta
   - ✅ Stop Loss colocado
   - ✅ Take Profit colocado

---

## 🎓 Próximos Pasos

### Explorar la Interfaz

1. **Dashboard**:
   - Ver credentials
   - Gestionar direcciones
   - Logs en tiempo real

2. **Alerts**:
   - Procesar alertas ATAS
   - Ejecutar trades manuales
   - Ver resultados

3. **Positions**:
   - Ver posiciones abiertas
   - Verificar entry price
   - Auto-refresh cada 10s

4. **Configuration**:
   - Editar risk amount por símbolo
   - Ajustar stop loss %
   - Ajustar take profit %

---

## ⚙️ Configuraciones Recomendadas

### Para Principiantes

```json
{
  "risk_amount": 1.0,        // $1 por trade
  "stop_loss_percent": 0.01,  // 1% SL
  "take_profit_percent": 0.02 // 2% TP
}
```

### Para Usuarios Avanzados

```json
{
  "risk_amount": 3.0,         // $3 por trade
  "stop_loss_percent": 0.022,  // 2.2% SL
  "take_profit_percent": 0.045 // 4.5% TP
}
```

**Editar**: Configuration Tab → Click en los valores → Modificar → Save

---

## 🐛 Troubleshooting Rápido

### Backend no inicia

```bash
# Verificar Python
python --version  # Debe ser 3.10+

# Reinstalar
cd backend
rmdir /s /q venv
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### Frontend no carga

```bash
# Verificar Node
node --version  # Debe ser 18+

# Reinstalar
cd frontend
rmdir /s /q node_modules
npm install
```

### Error "Credentials not configured"

1. Verificar que guardaste las credenciales
2. Verificar que el backend esté corriendo
3. Recargar la página
4. Volver a configurar credenciales

### Alerta rechazada "Direction not allowed"

1. Verificar que el símbolo esté habilitado
2. Dashboard → Trading Directions
3. Cambiar de DISABLED a BOTH/LONG/SHORT

### Error 10002 (Timestamp)

- El sistema se sincroniza automáticamente
- Esperar 30 segundos y reintentar
- Si persiste, reiniciar backend

---

## 📖 Más Información

- [README.md](README.md) - Documentación completa
- [API Reference](README.md#-api-reference) - Endpoints disponibles
- Logs del backend - Salida de consola
- Bybit Docs - [https://bybit-exchange.github.io/docs/](https://bybit-exchange.github.io/docs/)

---

## ✅ Checklist de Inicio

Antes de usar en Live:

- [ ] ✅ Probado en Testnet
- [ ] ✅ Verificado cálculo de cantidades
- [ ] ✅ Confirmado Stop Loss funciona
- [ ] ✅ Confirmado Take Profit funciona
- [ ] ✅ Ajustados risk amounts
- [ ] ✅ Configurados símbolos deseados
- [ ] ✅ Probado con alertas reales
- [ ] ✅ Monitoreado logs por 1 semana

---

## 🎯 Objetivo: Trading en 5 Minutos

1. ⏱️ **Minuto 1**: Doble click en START_HERE.bat
2. ⏱️ **Minuto 2**: Abrir http://localhost:3000
3. ⏱️ **Minuto 3**: Configurar credenciales Testnet
4. ⏱️ **Minuto 4**: Habilitar BTCUSDT
5. ⏱️ **Minuto 5**: Procesar primera alerta

**¡Listo! 🎉**

---

## 💡 Tips Pro

1. **Monitorear siempre**: Mantén el panel de logs visible
2. **Empezar pequeño**: $1-2 risk amount al inicio
3. **Un símbolo primero**: Prueba con BTC o ETH primero
4. **Auto-refresh**: Positions se actualiza cada 10 segundos
5. **Testnet primero**: NUNCA saltar directo a Live

---

## 🚨 Advertencias Importantes

⚠️ **Trading implica riesgo**: Puedes perder dinero
⚠️ **Testnet primero**: Siempre probar antes de Live
⚠️ **Monitorear**: No dejar desatendido
⚠️ **Risk management**: No arriesgar más de lo que puedes perder
⚠️ **API Keys**: Nunca compartir, nunca habilitar withdraw

---

**¡Feliz Trading! 🚀📈**
