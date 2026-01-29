# TRADING JOURNAL - Plan de Desarrollo

**Fecha de inicio:** Enero 2026
**UbicaciÃ³n:** `6.Trading_Journal/`
**Puertos:** Backend 12000, Frontend 12001

---

## 1. VISIÃ“N GENERAL

### PropÃ³sito

El Trading Journal es un sistema centralizado para:

1. **Auto-registrar** todos los trades ejecutados en Bybit
2. **Capturar screenshots** del grÃ¡fico al abrir y cerrar cada posiciÃ³n
3. **Calcular mÃ©tricas** de performance automÃ¡ticamente
4. **Detectar patrones** de comportamiento (buenos y malos)
5. **Generar feedback con IA** para mejorar el trading

### Principio Fundamental: Backend-First

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                         ARQUITECTURA BACKEND-FIRST                           â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                                              â”‚
â”‚  TODO EL PROCESAMIENTO OCURRE EN EL BACKEND (Python)                        â”‚
â”‚                                                                              â”‚
â”‚  - El sistema funciona 24/7 sin necesidad de navegador abierto              â”‚
â”‚  - Position monitoring corre como servicio continuo                          â”‚
â”‚  - Screenshots se generan server-side (Playwright/mplfinance)               â”‚
â”‚  - MÃ©tricas y anÃ¡lisis calculados en Python                                  â”‚
â”‚  - AI feedback via API calls desde backend                                   â”‚
â”‚                                                                              â”‚
â”‚  EL FRONTEND ES SOLO VISUALIZACIÃ“N                                           â”‚
â”‚                                                                              â”‚
â”‚  - Muestra datos ya calculados por el backend                                â”‚
â”‚  - No hace cÃ¡lculos ni procesamiento                                         â”‚
â”‚  - Puede estar cerrado y el sistema sigue funcionando                       â”‚
â”‚                                                                              â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

### Preguntas que Responde el Journal

- Â¿QuÃ© trades hice y por quÃ©?
- Â¿CÃ³mo me fue realmente vs lo esperado?
- Â¿QuÃ© patrones de comportamiento tengo?
- Â¿QuÃ© debo mejorar?
- Â¿CuÃ¡ndo opero mejor/peor?

---

## 2. FLUJO DE CAPTURA DE TRADES

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                        FLUJO DE CAPTURA DE TRADES                            â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                                              â”‚
â”‚  FUENTES DE SEÃ‘ALES                           EJECUCIÃ“N                      â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”                           â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”              â”‚
â”‚  â”‚  2.Watchlist  â”‚â”€â”€â”                        â”‚  3.TradingBot â”‚              â”‚
â”‚  â”‚  (puerto 8000)â”‚  â”‚                        â”‚  (puerto 5000)â”‚              â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚                        â”‚               â”‚              â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚   Alertas / Manual     â”‚ - Ejecuta en  â”‚              â”‚
â”‚  â”‚ 4.Analizador  â”‚â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¶ â”‚   Bybit       â”‚              â”‚
â”‚  â”‚ (puerto 10000)â”‚  â”‚                        â”‚               â”‚              â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  â”‚                        â”‚ - Gestiona    â”‚              â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”  â”‚                        â”‚   posiciones  â”‚              â”‚
â”‚  â”‚ 5.Order Flow  â”‚â”€â”€â”˜                        â”‚               â”‚              â”‚
â”‚  â”‚ (puerto 11000)â”‚                           â””â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”˜              â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜                                   â”‚                       â”‚
â”‚                                                      â”‚                       â”‚
â”‚                                                      â–¼                       â”‚
â”‚                                              â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”              â”‚
â”‚                                              â”‚  6.JOURNAL    â”‚              â”‚
â”‚                                              â”‚ (puerto 12000)â”‚              â”‚
â”‚                                              â”‚               â”‚              â”‚
â”‚                                              â”‚ Consulta al   â”‚              â”‚
â”‚                                              â”‚ TradingBot    â”‚              â”‚
â”‚                                              â”‚ cada 5 seg    â”‚              â”‚
â”‚                                              â””â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”˜              â”‚
â”‚                                                      â”‚                       â”‚
â”‚         â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”         â”‚
â”‚         â”‚                                                         â”‚         â”‚
â”‚         â–¼                                                         â–¼         â”‚
â”‚  â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”                                    â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”‚
â”‚  â”‚ POSITION_OPENED â”‚                                    â”‚ POSITION_CLOSED â”‚ â”‚
â”‚  â”‚                 â”‚                                    â”‚                 â”‚ â”‚
â”‚  â”‚ 1. Detectar     â”‚                                    â”‚ 1. Detectar     â”‚ â”‚
â”‚  â”‚    fuente       â”‚                                    â”‚    cierre       â”‚ â”‚
â”‚  â”‚                 â”‚                                    â”‚                 â”‚ â”‚
â”‚  â”‚ 2. Capturar     â”‚                                    â”‚ 2. Capturar     â”‚ â”‚
â”‚  â”‚    screenshot   â”‚                                    â”‚    screenshot   â”‚ â”‚
â”‚  â”‚    de ENTRADA   â”‚                                    â”‚    de SALIDA    â”‚ â”‚
â”‚  â”‚                 â”‚                                    â”‚                 â”‚ â”‚
â”‚  â”‚ 3. Crear        â”‚                                    â”‚ 3. Calcular PnL â”‚ â”‚
â”‚  â”‚    JournalEntry â”‚                                    â”‚                 â”‚ â”‚
â”‚  â”‚    (status:open)â”‚                                    â”‚ 4. Completar    â”‚ â”‚
â”‚  â”‚                 â”‚                                    â”‚    entry        â”‚ â”‚
â”‚  â”‚ 4. Enriquecer   â”‚                                    â”‚    (status:     â”‚ â”‚
â”‚  â”‚    con contexto â”‚                                    â”‚     closed)     â”‚ â”‚
â”‚  â”‚    de mercado   â”‚                                    â”‚                 â”‚ â”‚
â”‚  â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜                                    â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â”‚
â”‚                                                                              â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

## 3. MODELO DE DATOS

### JournalEntry (Entrada Principal)

```python
@dataclass
class JournalEntry:
    id: str

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # ORIGEN DEL TRADE
    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    source: str                       # "watchlist", "analizador", "orderflow",
                                      # "backtester", "manual"
    source_app_port: int              # 8000, 10000, 11000, etc.
    alert_id: Optional[str]           # ID de la alerta que generÃ³ el trade

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # DATOS DEL TRADE
    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    symbol: str                       # "BTCUSDT"
    side: str                         # "long", "short"
    entry_time: int                   # Timestamp de entrada
    entry_price: float
    quantity: float

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # DATOS DE SALIDA (se llenan cuando cierra)
    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    exit_time: Optional[int]
    exit_price: Optional[float]
    pnl: Optional[float]              # En USD
    pnl_percent: Optional[float]      # Porcentaje
    exit_reason: Optional[str]        # "tp", "sl", "manual", "liquidation"

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # SCREENSHOTS
    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    entry_screenshot: Optional[str]   # Path: screenshots/2026/01/trade_123_entry.png
    exit_screenshot: Optional[str]    # Path: screenshots/2026/01/trade_123_exit.png

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # CONTEXTO (auto-capturado por backend)
    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    market_context: MarketContext

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # SETUP Y RAZONES
    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    setup: TradeSetup

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # CALIDAD DE EJECUCIÃ“N (auto-calculado)
    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    execution: ExecutionQuality

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # REFLEXIÃ“N (manual + IA)
    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    reflection: TradeReflection

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # ESTADO Y METADATA
    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    status: str                       # "open", "closed"
    created_at: int
    updated_at: int
    tags: List[str]                   # Para filtrado: ["scalp", "swing", etc.]
```

### MarketContext (Auto-Capturado)

```python
@dataclass
class MarketContext:
    """Contexto del mercado al momento de entrada - CALCULADO POR BACKEND"""

    # Tendencia
    trend: str                        # "uptrend", "downtrend", "ranging"
    trend_strength: float             # 0-100

    # Volatilidad
    volatility: str                   # "low", "medium", "high"
    atr_value: float
    atr_percent: float                # ATR como % del precio

    # Niveles cercanos
    nearest_support: Optional[float]
    nearest_resistance: Optional[float]
    distance_to_support_pct: float
    distance_to_resistance_pct: float

    # Indicadores al momento de entrada
    rsi: Optional[float]              # 0-100
    vwap_position: str                # "above", "below", "at"
    volume_vs_average: float          # 1.0 = promedio, 2.0 = 2x promedio

    # Zonas (del Zone Detector)
    in_zone: bool
    zone_type: Optional[str]          # "support", "resistance"
    zone_quality: Optional[float]     # Score de la zona
    zone_touches: Optional[int]

    # Patrones detectados
    patterns_detected: List[str]      # ["hammer", "engulfing", "doji"]

    # SesiÃ³n de mercado
    session: str                      # "asia", "london", "new_york"
    day_of_week: str                  # "monday", "tuesday", etc.
    hour_utc: int                     # 0-23
```

### TradeSetup (Semi-Auto)

```python
@dataclass
class TradeSetup:
    """RazÃ³n del trade"""

    # Si viene de una estrategia del Strategy Builder
    strategy_name: Optional[str]
    strategy_id: Optional[str]

    # Trigger que iniciÃ³ el trade
    entry_trigger: str                # "zone_bounce", "breakout", "pattern",
                                      # "swing_signal", "manual"

    # Condiciones que se cumplieron (auto-detectadas)
    conditions_met: List[str]         # ["rsi_oversold", "volume_spike", etc.]

    # Plan original
    planned_sl: float
    planned_tp: float
    planned_rr: float                 # Risk/Reward ratio planeado

    # RazÃ³n en texto (manual o generada)
    rationale: str                    # "Price touched support zone with hammer"

    # Confianza pre-trade (manual)
    confidence_level: Optional[int]   # 1-10
```

### ExecutionQuality (Auto-Calculado)

```python
@dataclass
class ExecutionQuality:
    """Calidad de la ejecuciÃ³n - CALCULADO POR BACKEND"""

    # Slippage
    entry_slippage: float             # Diferencia entre precio esperado y real
    exit_slippage: float

    # Timing
    entry_timing: str                 # "early", "on_time", "late", "missed"
    exit_timing: str

    # Plan vs Realidad
    followed_plan: bool               # Â¿SiguiÃ³ el plan original?
    sl_moved: bool                    # Â¿MoviÃ³ el SL?
    sl_move_direction: Optional[str]  # "tighter", "wider"
    tp_moved: bool
    tp_move_direction: Optional[str]

    # Tiempo en trade
    holding_time_minutes: int
    holding_time_vs_avg: float        # vs promedio histÃ³rico

    # Resultado vs Plan
    actual_rr: float                  # RR real obtenido
    planned_vs_actual_rr: float       # Diferencia
```

### TradeReflection (Manual + IA)

```python
@dataclass
class TradeReflection:
    """ReflexiÃ³n post-trade"""

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # EMOCIONAL (manual)
    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    emotional_state_entry: Optional[str]   # "calm", "anxious", "fomo", "revenge"
    emotional_state_during: Optional[str]
    emotional_state_exit: Optional[str]

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # EVALUACIÃ“N (manual)
    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    what_went_well: Optional[str]
    what_went_wrong: Optional[str]
    lesson_learned: Optional[str]
    would_take_again: Optional[bool]       # Â¿TomarÃ­as este trade de nuevo?
    rating: Optional[int]                  # 1-5 estrellas

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # FEEDBACK IA (auto-generado por backend)
    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    ai_analysis: Optional[str]             # AnÃ¡lisis de la IA
    ai_suggestions: List[str]              # Sugerencias
    similar_trades: List[str]              # IDs de trades similares
    pattern_detected: Optional[str]        # PatrÃ³n de comportamiento detectado
```

---

## 4. SISTEMA DE SCREENSHOTS

### Arquitectura HÃ­brida

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                    SISTEMA DE SCREENSHOTS HÃBRIDO                            â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚                                                                              â”‚
â”‚  MÃ‰TODO PRIMARIO: Playwright Headless                                        â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€              â”‚
â”‚                                                                              â”‚
â”‚  1. Journal detecta que necesita screenshot                                  â”‚
â”‚  2. Lanza Playwright en modo headless                                        â”‚
â”‚  3. Navega a la app correspondiente:                                         â”‚
â”‚     - Watchlist:  http://localhost:5173/?symbol=BTCUSDT                     â”‚
â”‚     - Analizador: http://localhost:10001/?symbol=BTCUSDT                    â”‚
â”‚     - OrderFlow:  http://localhost:11001/?symbol=BTCUSDT                    â”‚
â”‚  4. Espera a que el grÃ¡fico cargue (WebSocket conectado)                    â”‚
â”‚  5. Captura screenshot del elemento del grÃ¡fico                             â”‚
â”‚  6. Guarda en screenshots/{year}/{month}/{trade_id}_{type}.png              â”‚
â”‚                                                                              â”‚
â”‚  Ventajas:                                                                   â”‚
â”‚  - GrÃ¡fico idÃ©ntico a lo que ve el usuario                                  â”‚
â”‚  - Incluye todos los indicadores configurados                               â”‚
â”‚  - Incluye dibujos y zonas                                                  â”‚
â”‚                                                                              â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€              â”‚
â”‚                                                                              â”‚
â”‚  MÃ‰TODO FALLBACK: mplfinance (Python)                                        â”‚
â”‚  â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€              â”‚
â”‚                                                                              â”‚
â”‚  Si Playwright falla (frontend no disponible, timeout, etc.):               â”‚
â”‚                                                                              â”‚
â”‚  1. Obtener velas del backend correspondiente                               â”‚
â”‚  2. Generar candlestick chart con mplfinance                                â”‚
â”‚  3. AÃ±adir indicadores bÃ¡sicos (VWAP, zonas S/R)                           â”‚
â”‚  4. Marcar punto de entrada/salida                                          â”‚
â”‚  5. Guardar como PNG                                                        â”‚
â”‚                                                                              â”‚
â”‚  Ventajas:                                                                   â”‚
â”‚  - Siempre funciona (no depende de frontend)                                â”‚
â”‚  - MÃ¡s rÃ¡pido y ligero                                                      â”‚
â”‚                                                                              â”‚
â”‚  Desventajas:                                                                â”‚
â”‚  - GrÃ¡fico mÃ¡s simple                                                       â”‚
â”‚  - No incluye todos los indicadores custom                                  â”‚
â”‚                                                                              â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

### Estructura de Almacenamiento

```
6.Trading_Journal/
â”œâ”€â”€ screenshots/
â”‚   â”œâ”€â”€ 2026/
â”‚   â”‚   â”œâ”€â”€ 01/
â”‚   â”‚   â”‚   â”œâ”€â”€ trade_btc_1706500000_entry.png
â”‚   â”‚   â”‚   â”œâ”€â”€ trade_btc_1706500000_exit.png
â”‚   â”‚   â”‚   â”œâ”€â”€ trade_eth_1706510000_entry.png
â”‚   â”‚   â”‚   â””â”€â”€ trade_eth_1706510000_exit.png
â”‚   â”‚   â”œâ”€â”€ 02/
â”‚   â”‚   â””â”€â”€ ...
â”‚   â””â”€â”€ 2027/
```

### CÃ³digo del Screenshot Service

```python
# services/screenshot_service.py

class ScreenshotService:
    def __init__(self):
        self.screenshots_dir = Path("screenshots")
        self.app_urls = {
            "watchlist": "http://localhost:5173",
            "analizador": "http://localhost:10001",
            "orderflow": "http://localhost:11001"
        }

    async def capture(
        self,
        source: str,
        symbol: str,
        trade_id: str,
        screenshot_type: str  # "entry" or "exit"
    ) -> str:
        """Captura screenshot, retorna path del archivo"""

        # Intentar Playwright primero
        try:
            path = await self._capture_with_playwright(
                source, symbol, trade_id, screenshot_type
            )
            if path:
                return path
        except Exception as e:
            logger.warning(f"Playwright failed: {e}")

        # Fallback a mplfinance
        return await self._capture_with_mplfinance(
            symbol, trade_id, screenshot_type
        )

    async def _capture_with_playwright(self, source, symbol, trade_id, stype):
        """Captura usando Playwright headless"""
        from playwright.async_api import async_playwright

        url = f"{self.app_urls[source]}/?symbol={symbol}"

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page(viewport={'width': 1920, 'height': 1080})

            await page.goto(url)

            # Esperar a que el grÃ¡fico cargue
            await page.wait_for_selector('.chart-container', timeout=10000)
            await page.wait_for_timeout(2000)  # Esperar datos WebSocket

            # Capturar elemento del grÃ¡fico
            chart = await page.query_selector('.chart-container')

            # Generar path
            path = self._generate_path(trade_id, stype)

            await chart.screenshot(path=path)
            await browser.close()

            return str(path)

    async def _capture_with_mplfinance(self, symbol, trade_id, stype):
        """Fallback: genera grÃ¡fico con mplfinance"""
        import mplfinance as mpf
        import pandas as pd

        # Obtener velas del backend
        candles = await self._fetch_candles(symbol, limit=100)

        # Convertir a DataFrame
        df = pd.DataFrame(candles)
        df['Date'] = pd.to_datetime(df['timestamp'], unit='ms')
        df.set_index('Date', inplace=True)
        df = df.rename(columns={
            'open': 'Open', 'high': 'High',
            'low': 'Low', 'close': 'Close', 'volume': 'Volume'
        })

        # Generar grÃ¡fico
        path = self._generate_path(trade_id, stype)

        mpf.plot(
            df,
            type='candle',
            style='nightclouds',
            volume=True,
            savefig=path,
            figsize=(16, 9)
        )

        return str(path)

    def _generate_path(self, trade_id: str, stype: str) -> Path:
        """Genera path para guardar screenshot"""
        now = datetime.now()
        dir_path = self.screenshots_dir / str(now.year) / f"{now.month:02d}"
        dir_path.mkdir(parents=True, exist_ok=True)
        return dir_path / f"{trade_id}_{stype}.png"
```

---

## 5. INTEGRACIÃ“N CON APPS EXISTENTES

### ComunicaciÃ³n con TradingBot

El Journal NO se conecta directamente a Bybit. En su lugar, consulta al TradingBot que ya tiene las credenciales configuradas.

```python
# services/position_monitor.py

class PositionMonitor:
    """Monitorea posiciones consultando al TradingBot"""

    def __init__(self):
        self.trading_bot_url = "http://localhost:5000"
        self.previous_positions = {}
        self.open_trades = {}  # symbol -> trade_id
        self.polling_interval = 5  # segundos

    async def start(self):
        """Inicia el monitoreo continuo"""
        logger.info("[PositionMonitor] Starting...")

        while True:
            try:
                await self._check_positions()
            except Exception as e:
                logger.error(f"[PositionMonitor] Error: {e}")

            await asyncio.sleep(self.polling_interval)

    async def _check_positions(self):
        """Consulta posiciones actuales y detecta cambios"""

        # Obtener posiciones del TradingBot
        response = await httpx.get(
            f"{self.trading_bot_url}/api/positions",
            timeout=10
        )
        current_positions = response.json()

        # Comparar con estado anterior
        await self._compare_and_process(current_positions)

        self.previous_positions = current_positions

    async def _compare_and_process(self, current: Dict):
        """Detecta aperturas y cierres"""

        # Detectar nuevas posiciones
        for symbol, pos in current.items():
            if symbol not in self.previous_positions:
                if pos.get('size', 0) > 0:
                    await self._on_position_opened(symbol, pos)

        # Detectar posiciones cerradas
        for symbol, prev_pos in self.previous_positions.items():
            if symbol not in current or current[symbol].get('size', 0) == 0:
                if prev_pos.get('size', 0) > 0:
                    await self._on_position_closed(symbol, prev_pos)

    async def _on_position_opened(self, symbol: str, position: Dict):
        """Cuando se abre una nueva posiciÃ³n"""
        logger.info(f"[POSITION_OPENED] {symbol}")

        # 1. Determinar fuente (de quÃ© app vino)
        source = await self._determine_source(symbol)

        # 2. Generar trade_id
        trade_id = f"trade_{symbol.lower()}_{int(time.time())}"

        # 3. Capturar screenshot de entrada
        screenshot_path = await screenshot_service.capture(
            source=source,
            symbol=symbol,
            trade_id=trade_id,
            screenshot_type="entry"
        )

        # 4. Calcular contexto de mercado
        market_context = await context_enricher.enrich(symbol)

        # 5. Crear JournalEntry
        entry = JournalEntry(
            id=trade_id,
            source=source,
            symbol=symbol,
            side=position['side'].lower(),
            entry_time=int(time.time() * 1000),
            entry_price=float(position['avgPrice']),
            quantity=float(position['size']),
            entry_screenshot=screenshot_path,
            market_context=market_context,
            status="open"
        )

        await journal_store.save(entry)
        self.open_trades[symbol] = trade_id

    async def _on_position_closed(self, symbol: str, prev_position: Dict):
        """Cuando se cierra una posiciÃ³n"""
        logger.info(f"[POSITION_CLOSED] {symbol}")

        trade_id = self.open_trades.get(symbol)
        if not trade_id:
            return

        # 1. Obtener precio de salida
        exit_price = await self._get_last_trade_price(symbol)

        # 2. Calcular PnL
        entry = await journal_store.get(trade_id)
        pnl = self._calculate_pnl(entry, exit_price)

        # 3. Capturar screenshot de salida
        screenshot_path = await screenshot_service.capture(
            source=entry.source,
            symbol=symbol,
            trade_id=trade_id,
            screenshot_type="exit"
        )

        # 4. Actualizar entry
        await journal_store.update(trade_id, {
            "exit_time": int(time.time() * 1000),
            "exit_price": exit_price,
            "pnl": pnl['amount'],
            "pnl_percent": pnl['percent'],
            "exit_screenshot": screenshot_path,
            "status": "closed"
        })

        del self.open_trades[symbol]

    async def _determine_source(self, symbol: str) -> str:
        """Determina de quÃ© app vino el trade"""
        # Consultar historial de alertas del TradingBot
        response = await httpx.get(
            f"{self.trading_bot_url}/api/alerts/recent?symbol={symbol}",
            timeout=5
        )
        alerts = response.json()

        if alerts:
            return alerts[-1].get('source', 'manual')
        return 'manual'
```

### Endpoints Necesarios en TradingBot

El TradingBot (App 3) necesita exponer estos endpoints para que el Journal pueda consultarlo:

```python
# AÃ±adir en 3.TradingBot_Python/backend/main.py

@app.get("/api/positions")
async def get_all_positions():
    """Retorna todas las posiciones abiertas en Bybit"""
    positions = await bybit_client.get_positions()
    return positions

@app.get("/api/alerts/recent")
async def get_recent_alerts(symbol: Optional[str] = None, limit: int = 10):
    """Retorna alertas recientes recibidas"""
    # Filtrar por sÃ­mbolo si se proporciona
    alerts = alert_history[-limit:]
    if symbol:
        alerts = [a for a in alerts if a['symbol'] == symbol]
    return alerts

@app.get("/api/orders/recent")
async def get_recent_orders(symbol: Optional[str] = None, limit: int = 20):
    """Retorna Ã³rdenes recientes ejecutadas"""
    orders = await bybit_client.get_order_history(symbol, limit)
    return orders
```

### Mapping de Fuentes

| Source | App | Puerto Backend | Puerto Frontend |
|--------|-----|----------------|-----------------|
| `watchlist` | 2.WatchlistConIndicadores | 8000 | 5173 |
| `analizador` | 4.Analizador cripto | 10000 | 10001 |
| `orderflow` | 5.Order_flow | 11000 | 11001 |
| `backtester` | 1.Altagracia_Crypto_Backtester | 9000 | 5173 |
| `manual` | Trade manual sin alerta | - | - |

---

## 6. SISTEMA DE MÃ‰TRICAS

### JournalMetrics (Calculado por Backend)

```python
@dataclass
class JournalMetrics:
    """MÃ©tricas agregadas - CALCULADO POR BACKEND"""

    # PerÃ­odo de anÃ¡lisis
    period_start: int
    period_end: int
    total_entries: int

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # PERFORMANCE
    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    total_pnl: float
    total_pnl_percent: float
    win_rate: float                   # 0-100
    profit_factor: float              # gross_profit / gross_loss
    avg_win: float
    avg_loss: float
    avg_trade: float
    best_trade: float
    worst_trade: float
    max_drawdown: float
    max_drawdown_percent: float

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # RATIOS
    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    sharpe_ratio: float
    sortino_ratio: float
    avg_rr_achieved: float            # Risk/Reward promedio logrado

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # ACTIVIDAD
    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    total_trades: int
    trades_per_week: float
    avg_holding_time_minutes: float

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # DESGLOSE POR DIMENSIÃ“N
    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    performance_by_trend: Dict[str, PerformanceStats]
    performance_by_volatility: Dict[str, PerformanceStats]
    performance_by_session: Dict[str, PerformanceStats]
    performance_by_day: Dict[str, PerformanceStats]
    performance_by_hour: Dict[int, PerformanceStats]
    performance_by_source: Dict[str, PerformanceStats]
    performance_by_symbol: Dict[str, PerformanceStats]

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # EJECUCIÃ“N
    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    plan_adherence_rate: float        # % que siguiÃ³ el plan
    sl_move_rate: float               # % que moviÃ³ SL
    avg_slippage: float

    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    # PATRONES DETECTADOS
    # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    recurring_mistakes: List[BehaviorPattern]
    strengths: List[BehaviorPattern]


@dataclass
class PerformanceStats:
    """Stats para un subconjunto de trades"""
    count: int
    win_rate: float
    total_pnl: float
    avg_pnl: float
    profit_factor: float
```

### MetricsCalculator

```python
# services/metrics_calculator.py

class MetricsCalculator:
    """Calcula mÃ©tricas de performance"""

    async def calculate(
        self,
        entries: List[JournalEntry],
        start_date: Optional[int] = None,
        end_date: Optional[int] = None
    ) -> JournalMetrics:
        """Calcula mÃ©tricas para un conjunto de entries"""

        # Filtrar por fecha
        if start_date:
            entries = [e for e in entries if e.entry_time >= start_date]
        if end_date:
            entries = [e for e in entries if e.entry_time <= end_date]

        closed = [e for e in entries if e.status == "closed"]

        if not closed:
            return self._empty_metrics()

        # Calcular mÃ©tricas bÃ¡sicas
        wins = [e for e in closed if e.pnl > 0]
        losses = [e for e in closed if e.pnl < 0]

        total_pnl = sum(e.pnl for e in closed)
        win_rate = len(wins) / len(closed) * 100

        gross_profit = sum(e.pnl for e in wins) if wins else 0
        gross_loss = abs(sum(e.pnl for e in losses)) if losses else 1
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else float('inf')

        # Calcular por dimensiones
        performance_by_trend = self._group_performance(closed, 'market_context.trend')
        performance_by_session = self._group_performance(closed, 'market_context.session')
        performance_by_day = self._group_performance(closed, 'market_context.day_of_week')
        # ... mÃ¡s dimensiones

        return JournalMetrics(
            period_start=min(e.entry_time for e in closed),
            period_end=max(e.exit_time for e in closed if e.exit_time),
            total_entries=len(closed),
            total_pnl=total_pnl,
            win_rate=win_rate,
            profit_factor=profit_factor,
            performance_by_trend=performance_by_trend,
            # ... resto de campos
        )

    def _group_performance(
        self,
        entries: List[JournalEntry],
        field_path: str
    ) -> Dict[str, PerformanceStats]:
        """Agrupa entries por un campo y calcula stats"""
        groups = {}

        for entry in entries:
            # Obtener valor del campo (soporta paths como 'market_context.trend')
            value = self._get_nested_field(entry, field_path)
            if value not in groups:
                groups[value] = []
            groups[value].append(entry)

        return {
            key: self._calculate_stats(group)
            for key, group in groups.items()
        }
```

---

## 7. PATTERN DETECTOR

### Patrones de Comportamiento

```python
# services/pattern_detector.py

@dataclass
class BehaviorPattern:
    """PatrÃ³n de comportamiento detectado"""
    type: str                         # Identificador del patrÃ³n
    description: str                  # DescripciÃ³n legible
    severity: str                     # "info", "warning", "critical"
    suggestion: str                   # Sugerencia de mejora
    evidence: List[str]               # IDs de trades que evidencian el patrÃ³n
    frequency: float                  # QuÃ© tan frecuente (0-1)


class PatternDetector:
    """Detecta patrones de comportamiento en el trading"""

    def detect(self, entries: List[JournalEntry]) -> List[BehaviorPattern]:
        """Analiza entries y detecta patrones"""
        patterns = []

        closed = [e for e in entries if e.status == "closed"]
        if len(closed) < 10:
            return patterns  # Necesita mÃ­nimo de datos

        # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        # PATRÃ“N: Peor dÃ­a de la semana
        # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        by_day = self._group_by(closed, lambda e: e.market_context.day_of_week)
        day_stats = {day: self._calc_stats(trades) for day, trades in by_day.items()}

        worst_day = min(day_stats.items(), key=lambda x: x[1]['avg_pnl'])
        if worst_day[1]['avg_pnl'] < 0 and worst_day[1]['count'] >= 5:
            patterns.append(BehaviorPattern(
                type="weak_day",
                description=f"Consistentemente pierdes los {worst_day[0]}",
                severity="warning",
                suggestion=f"Considera reducir tamaÃ±o o no operar los {worst_day[0]}",
                evidence=[e.id for e in by_day[worst_day[0]] if e.pnl < 0][:5],
                frequency=worst_day[1]['loss_rate']
            ))

        # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        # PATRÃ“N: Mover SL resulta en pÃ©rdidas mayores
        # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        sl_moved = [e for e in closed if e.execution and e.execution.sl_moved]
        sl_moved_losses = [e for e in sl_moved if e.pnl < 0]

        if len(sl_moved) >= 5:
            sl_move_loss_rate = len(sl_moved_losses) / len(sl_moved)
            if sl_move_loss_rate > 0.6:
                patterns.append(BehaviorPattern(
                    type="sl_moving_hurts",
                    description=f"Cuando mueves el SL, el {sl_move_loss_rate*100:.0f}% de veces pierdes mÃ¡s",
                    severity="critical",
                    suggestion="Respeta tu SL original. Si el trade se invalida, sal.",
                    evidence=[e.id for e in sl_moved_losses][:5],
                    frequency=sl_move_loss_rate
                ))

        # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        # PATRÃ“N: Mejor en alta volatilidad
        # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        by_vol = self._group_by(closed, lambda e: e.market_context.volatility)
        if 'high' in by_vol and 'low' in by_vol:
            high_wr = self._calc_stats(by_vol['high'])['win_rate']
            low_wr = self._calc_stats(by_vol['low'])['win_rate']

            if high_wr > low_wr * 1.3:
                patterns.append(BehaviorPattern(
                    type="high_volatility_edge",
                    description=f"Tu win rate es {((high_wr/low_wr)-1)*100:.0f}% mejor en alta volatilidad",
                    severity="info",
                    suggestion="Considera aumentar tamaÃ±o en condiciones de alta volatilidad",
                    evidence=[],
                    frequency=0
                ))

        # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        # PATRÃ“N: Revenge trading despuÃ©s de pÃ©rdida
        # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        revenge_trades = []
        for i in range(1, len(closed)):
            prev = closed[i-1]
            curr = closed[i]

            # Trade dentro de 30 minutos de una pÃ©rdida
            time_diff = (curr.entry_time - prev.exit_time) / (1000 * 60)
            if prev.pnl < 0 and time_diff < 30:
                revenge_trades.append(curr)

        if len(revenge_trades) >= 3:
            revenge_loss_rate = len([t for t in revenge_trades if t.pnl < 0]) / len(revenge_trades)
            if revenge_loss_rate > 0.5:
                patterns.append(BehaviorPattern(
                    type="revenge_trading",
                    description=f"Trades rÃ¡pidos despuÃ©s de pÃ©rdida tienen {revenge_loss_rate*100:.0f}% loss rate",
                    severity="critical",
                    suggestion="Toma un break de al menos 30 minutos despuÃ©s de una pÃ©rdida",
                    evidence=[e.id for e in revenge_trades if e.pnl < 0][:5],
                    frequency=revenge_loss_rate
                ))

        # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        # PATRÃ“N: Mejor en cierta sesiÃ³n
        # â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        by_session = self._group_by(closed, lambda e: e.market_context.session)
        if len(by_session) >= 2:
            session_stats = {s: self._calc_stats(t) for s, t in by_session.items()}
            best_session = max(session_stats.items(), key=lambda x: x[1]['avg_pnl'])

            if best_session[1]['avg_pnl'] > 0:
                patterns.append(BehaviorPattern(
                    type="best_session",
                    description=f"Tu mejor sesiÃ³n es {best_session[0]} con ${best_session[1]['avg_pnl']:.2f} promedio",
                    severity="info",
                    suggestion=f"Considera concentrar mÃ¡s operaciones en la sesiÃ³n de {best_session[0]}",
                    evidence=[],
                    frequency=0
                ))

        return patterns
```

---

## 8. AI FEEDBACK

### AnÃ¡lisis Individual de Trade

```python
# services/ai_analyzer.py

class AIAnalyzer:
    """Genera anÃ¡lisis y feedback usando LLM"""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.model = "gpt-4"  # o "claude-3-sonnet"

    async def analyze_trade(self, entry: JournalEntry) -> AIAnalysis:
        """Genera anÃ¡lisis de un trade individual"""

        prompt = f"""
Analiza este trade de criptomonedas:

CONTEXTO DEL MERCADO:
- SÃ­mbolo: {entry.symbol}
- DirecciÃ³n: {entry.side}
- Tendencia: {entry.market_context.trend} (fuerza: {entry.market_context.trend_strength})
- Volatilidad: {entry.market_context.volatility}
- RSI: {entry.market_context.rsi}
- PosiciÃ³n vs VWAP: {entry.market_context.vwap_position}
- Volumen vs promedio: {entry.market_context.volume_vs_average}x
- En zona: {entry.market_context.in_zone} ({entry.market_context.zone_type})
- Patrones detectados: {entry.market_context.patterns_detected}

SETUP:
- Trigger: {entry.setup.entry_trigger}
- Condiciones cumplidas: {entry.setup.conditions_met}
- RR planeado: {entry.setup.planned_rr}
- RazÃ³n: {entry.setup.rationale}

EJECUCIÃ“N:
- Â¿SiguiÃ³ el plan?: {entry.execution.followed_plan}
- Â¿MoviÃ³ SL?: {entry.execution.sl_moved}
- Tiempo en trade: {entry.execution.holding_time_minutes} minutos
- RR logrado: {entry.execution.actual_rr}

RESULTADO:
- PnL: ${entry.pnl:.2f} ({entry.pnl_percent:.2f}%)
- RazÃ³n de salida: {entry.exit_reason}

Por favor proporciona:
1. EVALUACIÃ“N DEL SETUP (1-10): Â¿Era un buen trade para tomar?
2. EVALUACIÃ“N DE EJECUCIÃ“N (1-10): Â¿CÃ³mo fue la ejecuciÃ³n?
3. LECCIÃ“N CLAVE: Una lecciÃ³n concreta de este trade
4. SUGERENCIA: Una mejora especÃ­fica para el futuro

Responde en formato JSON:
{{
  "setup_score": <1-10>,
  "execution_score": <1-10>,
  "key_lesson": "<lecciÃ³n>",
  "suggestion": "<sugerencia>",
  "summary": "<resumen de 1-2 oraciones>"
}}
"""

        response = await self._call_llm(prompt)
        return AIAnalysis.from_dict(response)

    async def generate_weekly_review(
        self,
        entries: List[JournalEntry],
        metrics: JournalMetrics,
        patterns: List[BehaviorPattern]
    ) -> WeeklyReview:
        """Genera review semanal"""

        prompt = f"""
Genera un review semanal de trading basado en estos datos:

MÃ‰TRICAS DE LA SEMANA:
- Total trades: {metrics.total_trades}
- Win rate: {metrics.win_rate:.1f}%
- PnL total: ${metrics.total_pnl:.2f}
- Profit factor: {metrics.profit_factor:.2f}
- Mejor trade: ${metrics.best_trade:.2f}
- Peor trade: ${metrics.worst_trade:.2f}
- Max drawdown: {metrics.max_drawdown_percent:.1f}%

PERFORMANCE POR CONTEXTO:
- Por tendencia: {self._format_perf(metrics.performance_by_trend)}
- Por sesiÃ³n: {self._format_perf(metrics.performance_by_session)}
- Por dÃ­a: {self._format_perf(metrics.performance_by_day)}

EJECUCIÃ“N:
- Adherencia al plan: {metrics.plan_adherence_rate:.1f}%
- Veces que moviÃ³ SL: {metrics.sl_move_rate:.1f}%

PATRONES DETECTADOS:
{self._format_patterns(patterns)}

Genera un review que incluya:
1. RESUMEN EJECUTIVO (2-3 oraciones)
2. TOP 3 FORTALEZAS esta semana
3. TOP 3 ÃREAS DE MEJORA
4. OBJETIVO CONCRETO para la prÃ³xima semana
5. FRASE MOTIVACIONAL personalizada

Responde en formato JSON.
"""

        response = await self._call_llm(prompt)
        return WeeklyReview.from_dict(response)

    async def find_similar_trades(
        self,
        entry: JournalEntry,
        all_entries: List[JournalEntry],
        limit: int = 10
    ) -> SimilarTradesAnalysis:
        """Encuentra trades similares y compara"""

        similar = []
        for e in all_entries:
            if e.id == entry.id:
                continue

            score = self._similarity_score(entry, e)
            if score > 0.7:
                similar.append((e, score))

        similar.sort(key=lambda x: x[1], reverse=True)
        similar = similar[:limit]

        if not similar:
            return None

        similar_entries = [s[0] for s in similar]
        avg_pnl = sum(e.pnl for e in similar_entries) / len(similar_entries)
        win_rate = len([e for e in similar_entries if e.pnl > 0]) / len(similar_entries)

        return SimilarTradesAnalysis(
            similar_trades=[e.id for e in similar_entries],
            your_pnl=entry.pnl,
            avg_pnl_similar=avg_pnl,
            win_rate_similar=win_rate * 100,
            comparison="above_average" if entry.pnl > avg_pnl else "below_average",
            insight=f"En {len(similar_entries)} trades similares, win rate: {win_rate*100:.0f}%, PnL promedio: ${avg_pnl:.2f}"
        )

    def _similarity_score(self, a: JournalEntry, b: JournalEntry) -> float:
        """Calcula score de similitud entre dos trades"""
        score = 0

        # Mismo sÃ­mbolo
        if a.symbol == b.symbol:
            score += 0.3

        # Misma direcciÃ³n
        if a.side == b.side:
            score += 0.1

        # Mismo contexto
        if a.market_context.trend == b.market_context.trend:
            score += 0.2
        if a.market_context.volatility == b.market_context.volatility:
            score += 0.1
        if a.market_context.session == b.market_context.session:
            score += 0.1

        # Mismo trigger
        if a.setup.entry_trigger == b.setup.entry_trigger:
            score += 0.2

        return score
```

---

## 9. ESTRUCTURA DE ARCHIVOS

```
6.Trading_Journal/
â”œâ”€â”€ backend/
â”‚   â”œâ”€â”€ main.py                        # FastAPI server (puerto 12000)
â”‚   â”œâ”€â”€ requirements.txt
â”‚   â”‚
â”‚   â”œâ”€â”€ models/
â”‚   â”‚   â”œâ”€â”€ __init__.py
â”‚   â”‚   â”œâ”€â”€ journal_entry.py           # JournalEntry, MarketContext, etc.
â”‚   â”‚   â”œâ”€â”€ metrics.py                 # JournalMetrics, PerformanceStats
â”‚   â”‚   â””â”€â”€ patterns.py                # BehaviorPattern, AIAnalysis
â”‚   â”‚
â”‚   â”œâ”€â”€ services/
â”‚   â”‚   â”œâ”€â”€ __init__.py
â”‚   â”‚   â”œâ”€â”€ position_monitor.py        # Monitorea posiciones via TradingBot
â”‚   â”‚   â”œâ”€â”€ screenshot_service.py      # Captura screenshots (Playwright/mplfinance)
â”‚   â”‚   â”œâ”€â”€ context_enricher.py        # Calcula MarketContext
â”‚   â”‚   â”œâ”€â”€ metrics_calculator.py      # Calcula mÃ©tricas agregadas
â”‚   â”‚   â”œâ”€â”€ pattern_detector.py        # Detecta patrones de comportamiento
â”‚   â”‚   â””â”€â”€ ai_analyzer.py             # AnÃ¡lisis con LLM
â”‚   â”‚
â”‚   â”œâ”€â”€ store/
â”‚   â”‚   â”œâ”€â”€ __init__.py
â”‚   â”‚   â”œâ”€â”€ journal_store.py           # SQLite storage
â”‚   â”‚   â””â”€â”€ migrations/
â”‚   â”‚       â””â”€â”€ 001_initial.sql
â”‚   â”‚
â”‚   â”œâ”€â”€ config/
â”‚   â”‚   â””â”€â”€ settings.json
â”‚   â”‚
â”‚   â””â”€â”€ screenshots/                   # Almacenamiento de imÃ¡genes
â”‚       â””â”€â”€ .gitkeep
â”‚
â”œâ”€â”€ frontend/
â”‚   â”œâ”€â”€ src/
â”‚   â”‚   â”œâ”€â”€ components/
â”‚   â”‚   â”‚   â”œâ”€â”€ journal/
â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ JournalApp.jsx     # Layout principal
â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ TradesList.jsx     # Lista filtrable
â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ TradeDetail.jsx    # Detalle con screenshots
â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ TradeForm.jsx      # Entrada manual
â”‚   â”‚   â”‚   â”‚   â””â”€â”€ ScreenshotViewer.jsx
â”‚   â”‚   â”‚   â”‚
â”‚   â”‚   â”‚   â”œâ”€â”€ metrics/
â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ MetricsDashboard.jsx
â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ EquityCurve.jsx
â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ WinRateChart.jsx
â”‚   â”‚   â”‚   â”‚   â””â”€â”€ PerformanceHeatmap.jsx
â”‚   â”‚   â”‚   â”‚
â”‚   â”‚   â”‚   â”œâ”€â”€ analysis/
â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ PatternsList.jsx
â”‚   â”‚   â”‚   â”‚   â”œâ”€â”€ WeeklyReview.jsx
â”‚   â”‚   â”‚   â”‚   â””â”€â”€ AIAssistant.jsx
â”‚   â”‚   â”‚   â”‚
â”‚   â”‚   â”‚   â””â”€â”€ common/
â”‚   â”‚   â”‚       â”œâ”€â”€ Filters.jsx
â”‚   â”‚   â”‚       â”œâ”€â”€ DateRangePicker.jsx
â”‚   â”‚   â”‚       â””â”€â”€ Tags.jsx
â”‚   â”‚   â”‚
â”‚   â”‚   â”œâ”€â”€ App.jsx
â”‚   â”‚   â”œâ”€â”€ index.jsx
â”‚   â”‚   â””â”€â”€ config.js
â”‚   â”‚
â”‚   â”œâ”€â”€ package.json
â”‚   â””â”€â”€ vite.config.js
â”‚
â”œâ”€â”€ 1_START_JOURNAL.bat               # Script de inicio Windows
â”œâ”€â”€ README.md
â””â”€â”€ PLAN_TRADING_JOURNAL.md           # Este documento
```

---

## 10. ENDPOINTS API

### Entries (CRUD)

```
POST   /api/journal/entries              # Crear entry (al abrir posiciÃ³n)
PATCH  /api/journal/entries/{id}         # Actualizar (al cerrar, aÃ±adir reflexiÃ³n)
GET    /api/journal/entries              # Listar con filtros
GET    /api/journal/entries/{id}         # Obtener detalle
DELETE /api/journal/entries/{id}         # Eliminar
```

### Screenshots

```
POST   /api/journal/screenshots          # Subir screenshot (interno)
GET    /api/journal/screenshots/{path}   # Servir imagen
```

### MÃ©tricas

```
GET    /api/journal/metrics              # MÃ©tricas generales
GET    /api/journal/metrics/by/{dim}     # Por dimensiÃ³n (trend, session, day, etc.)
GET    /api/journal/metrics/equity-curve # Equity curve data
```

### AnÃ¡lisis

```
GET    /api/journal/patterns             # Patrones detectados
POST   /api/journal/ai/analyze/{id}      # AnÃ¡lisis IA de un trade
POST   /api/journal/ai/weekly-review     # Generar review semanal
GET    /api/journal/similar/{id}         # Trades similares
```

### ReflexiÃ³n

```
POST   /api/journal/entries/{id}/reflection  # AÃ±adir reflexiÃ³n manual
```

---

## 11. FASES DE DESARROLLO

### Fase 1: Infraestructura Base
**Entregables:**
- Estructura de carpetas
- Modelos de datos (JournalEntry, etc.)
- SQLite store con migraciones
- Endpoints CRUD bÃ¡sicos
- FastAPI server corriendo en puerto 12000

### Fase 2: Position Monitor
**Entregables:**
- PositionMonitor service
- IntegraciÃ³n con TradingBot API
- DetecciÃ³n de apertura/cierre de posiciones
- CreaciÃ³n automÃ¡tica de entries

**Dependencias:**
- AÃ±adir endpoints en TradingBot (/api/positions, /api/alerts/recent)

### Fase 3: Screenshot Service
**Entregables:**
- ScreenshotService con Playwright
- Fallback con mplfinance
- Almacenamiento organizado por fecha
- Endpoint para servir imÃ¡genes

### Fase 4: Frontend BÃ¡sico
**Entregables:**
- JournalApp layout
- TradesList con filtros
- TradeDetail con screenshots lado a lado
- TradeForm para entrada manual

### Fase 5: MÃ©tricas y Dashboard
**Entregables:**
- MetricsCalculator service
- MetricsDashboard UI
- Equity curve chart
- Performance por dimensiones

### Fase 6: Context Enricher
**Entregables:**
- ContextEnricher service
- CÃ¡lculo de indicadores (RSI, ATR, tendencia)
- IntegraciÃ³n con Zone Detector
- DetecciÃ³n de patrones de velas

### Fase 7: Pattern Detector
**Entregables:**
- PatternDetector service
- DetecciÃ³n de patrones de comportamiento
- PatternsList UI
- Alertas de patrones negativos

### Fase 8: AI Feedback
**Entregables:**
- AIAnalyzer service
- AnÃ¡lisis individual de trades
- GeneraciÃ³n de reviews semanales
- AIAssistant UI

---

## 12. PUERTOS FINALES

| App | DescripciÃ³n | Backend | Frontend |
|-----|-------------|---------|----------|
| 1 | Backtester | 9000 | 5173 |
| 2 | Watchlist | 8000 | 5173 |
| 3 | TradingBot | 5000 | 3000 |
| 4 | Analizador | 10000 | 10001 |
| 5 | Order Flow | 11000 | 11001 |
| 6 | **Journal** | **12000** | **12001** |

---

## 13. DEPENDENCIAS

### Python (backend/requirements.txt)

```
fastapi==0.109.0
uvicorn==0.27.0
pydantic==2.5.0
httpx==0.26.0
aiosqlite==0.19.0
playwright==1.41.0
mplfinance==0.12.10b0
pandas==2.1.4
numpy==1.26.3
python-multipart==0.0.6
openai==1.10.0  # Para AI feedback (opcional)
```

### Node.js (frontend/package.json)

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "uplot": "^1.6.30",
    "lightweight-charts": "^4.1.0"
  },
  "devDependencies": {
    "vite": "^5.0.0"
  }
}
```

---

## 14. NOTAS DE IMPLEMENTACIÃ“N

### Screenshot Timing

- **Entry screenshot**: Capturar inmediatamente al detectar nueva posiciÃ³n
- **Exit screenshot**: Capturar al detectar cierre, antes de actualizar el entry
- **Timeout**: 10 segundos mÃ¡ximo para Playwright, luego fallback a mplfinance

### Position Monitor

- Polling cada 5 segundos (configurable)
- ComparaciÃ³n de estados para detectar cambios
- Retry con backoff exponencial en caso de error
- Log detallado para debugging

### DeterminaciÃ³n de Source

1. Consultar `/api/alerts/recent` del TradingBot
2. Buscar alerta del mismo sÃ­mbolo en los Ãºltimos 5 minutos
3. Si existe, usar el `source` de esa alerta
4. Si no, marcar como "manual"

### Almacenamiento de Screenshots

- Formato: `{trade_id}_{type}.png` donde type es "entry" o "exit"
- OrganizaciÃ³n: `screenshots/{year}/{month}/`
- Limpieza: Considerar polÃ­tica de retenciÃ³n (ej: 1 aÃ±o)

### Backend-First

- Todo cÃ¡lculo pesado en Python (mÃ©tricas, patrones, AI)
- Frontend solo hace fetch y renderiza
- WebSocket para actualizaciones en tiempo real (opcional)
- El sistema funciona sin frontend abierto

---

## 15. PRÃ“XIMOS PASOS

1. **Crear estructura base** del proyecto (carpetas, archivos iniciales)
2. **Implementar modelos** de datos en Python
3. **Configurar SQLite** con migraciones
4. **Implementar PositionMonitor** y aÃ±adir endpoints al TradingBot
5. **Implementar ScreenshotService** (Playwright + mplfinance)
6. **Crear endpoints bÃ¡sicos** del Journal
7. **Probar flujo completo** con un trade real
8. **Desarrollar frontend** bÃ¡sico
9. **AÃ±adir mÃ©tricas** y dashboard
10. **Implementar AI feedback**

