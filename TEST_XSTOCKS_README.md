# xStocks API Validation Script

## Descripción

Este script prueba la compatibilidad de los xStocks (acciones tokenizadas de Bybit) con nuestra infraestructura actual de API.

## Qué prueba

El script ejecuta **4 tests completos** para cada símbolo:

### Test 1: Instruments Info
- ✓ Verifica que el símbolo existe en Bybit
- ✓ Confirma que `category=spot` funciona
- ✓ Valida que tiene el campo `xstockMultiplier`
- ✓ Verifica baseCoin, quoteCoin, status

### Test 2: Kline Data (Velas históricas)
- ✓ Obtiene datos históricos
- ✓ Valida formato de 7 elementos
- ✓ Verifica lógica OHLC (high >= open/close, etc.)
- ✓ Muestra precio actual, volumen, turnover

### Test 3: Ticker Data (Tiempo real)
- ✓ Obtiene precio en tiempo real
- ✓ Valida datos de 24h (high, low, volume)
- ✓ Verifica bid/ask prices
- ✓ Calcula spread

### Test 4: Multiple Intervals
- ✓ Prueba intervalos: 1, 5, 15, 60, 240, D
- ✓ Confirma compatibilidad con nuestros timeframes

## Símbolos que se prueban

```
AAPLX   - Apple
TSLAX   - Tesla
NVDAX   - NVIDIA
MSFX    - Microsoft
METAX   - Meta
MSTRx   - MicroStrategy
COINx   - Coinbase
SPYx    - S&P 500 ETF
```

## Instalación

```bash
# Instalar dependencias
pip install -r test_requirements.txt
```

O manualmente:
```bash
pip install httpx
```

## Ejecución

```bash
python test_xstocks_api.py
```

## Output Esperado

El script mostrará:

```
================================================================================
                         xSTOCKS API VALIDATION SCRIPT
================================================================================

Testing 8 xStock symbols...

================================================================================
                              TESTING: AAPLX
================================================================================

Test 1: Instruments Info - AAPLX
✓ Symbol: AAPLX
✓ Category: spot
✓ BaseCoin: AAPLX
✓ QuoteCoin: USDT
✓ xstockMultiplier: 1.0
ℹ Status: Trading
ℹ Innovation: 0

Test 2: Kline Data - AAPLX @ 60min
✓ Received 10 candles
✓ Candle format: 7 elements ✓
ℹ Latest Candle (2026-02-03 14:00):
  Open:     $173.50
  High:     $174.20
  Low:      $173.10
  Close:    $173.80
  Volume:   125,000
  Turnover: $21,750,000.00
✓ OHLC logic: Valid ✓

Test 3: Ticker Data - AAPLX
✓ Symbol: AAPLX
ℹ Last Price: $173.80
ℹ 24h High:   $175.50
ℹ 24h Low:    $172.20
ℹ 24h Volume: 2,500,000
ℹ Bid:        $173.75
ℹ Ask:        $173.85
ℹ Spread:     $0.10 (0.058%)

Test 4: Multiple Intervals - AAPLX
✓ Interval   1: ✓
✓ Interval   5: ✓
✓ Interval  15: ✓
✓ Interval  60: ✓
✓ Interval 240: ✓
✓ Interval   D: ✓
ℹ Supported intervals: 6/6

Summary for AAPLX: 4/4 tests passed
✓ AAPLX is FULLY COMPATIBLE ✓

[... repite para cada símbolo ...]

================================================================================
                              FINAL REPORT
================================================================================

Results Summary:
✓ Fully Compatible:      8/8
```

## Archivo de Resultados

El script genera `xstocks_validation_results.json` con todos los detalles:

```json
{
  "timestamp": "2026-02-03T15:30:00",
  "symbols_tested": 8,
  "compatible": 8,
  "partial": 0,
  "failed": 0,
  "details": [
    {
      "symbol": "AAPLX",
      "tests": {
        "instruments": true,
        "kline": true,
        "ticker": true,
        "intervals": true
      },
      "passed": 4,
      "total": 4,
      "compatible": true
    }
  ]
}
```

## Interpretación de Resultados

### ✓ Fully Compatible (Verde)
- **Todos los tests pasaron**
- El símbolo se puede usar inmediatamente en nuestras apps
- API 100% compatible con nuestra infraestructura

### ⚠ Partially Compatible (Amarillo)
- **Algunos tests fallaron**
- Requiere investigación adicional
- Puede funcionar con limitaciones

### ✗ Failed (Rojo)
- **Todos los tests fallaron**
- El símbolo no está disponible o la API cambió
- No se puede usar actualmente

## Posibles Problemas

### Error: "Symbol not found"
**Causa**: El símbolo no existe en Bybit o fue retirado.
**Solución**: Verificar lista actualizada de xStocks en Bybit.

### Error: "HTTP 403 Forbidden"
**Causa**: Bybit está bloqueando requests.
**Solución**:
- Esperar unos minutos (rate limit)
- Usar VPN si estás en región restringida

### Error: "Connection timeout"
**Causa**: Problemas de red o API de Bybit caída.
**Solución**: Revisar conectividad, reintentar más tarde.

### Warning: "No data" en klines
**Causa**: Símbolo muy nuevo sin historial.
**Solución**: Normal para lanzamientos recientes, usar con precaución.

## Próximos Pasos

Si todos los tests pasan:

1. ✅ **Implementar en Watchlist (App 2/7)**
   - Agregar símbolos a lista
   - Actualizar función `get_category()`

2. ✅ **Implementar en Analizador (App 4/8)**
   - Agregar a selector de símbolos
   - Sin más cambios (API compatible)

3. ✅ **Implementar en TradingBot (App 3/10)**
   - Actualizar config
   - Agregar categoría en client

4. ✅ **Testing en producción**
   - Probar con usuarios beta
   - Monitorear errores

## Modificar el Script

Para probar otros símbolos, edita la lista en el script:

```python
SYMBOLS_TO_TEST = [
    "AAPLX",   # Apple
    "TSLAX",   # Tesla
    # Agregar más aquí
    "AMDx",    # AMD
    "QQQx",    # Nasdaq ETF
]
```

## Contacto

Si encuentras problemas o necesitas ayuda:
1. Revisar archivo de resultados JSON
2. Buscar errores en output con color rojo
3. Verificar que httpx está instalado correctamente

---

**Tiempo estimado de ejecución**: ~30-60 segundos (depende de red)
**Requisitos**: Python 3.8+, httpx, conexión a internet
