# TOP 51 PROP FIRMS CON ACCESO API - GUÍA COMPLETA 2026

**Fecha:** 12 octubre de 2026
**Actualización:** Lista verificada y expandida (agregado IQ Capital - Febrero 2026)
**Proyecto:** AnalizadorDesktop - Integración multi-exchange

---

## ÍNDICE POR CATEGORÍA

1. **CRYPTO PROP FIRMS** (16 firmas) - Bybit, Binance, OKX, Kraken, Hyperliquid
2. **FOREX PROP FIRMS** (15 firmas) - MetaTrader 4/5, cTrader, Match-Trader
3. **FUTURES PROP FIRMS** (14 firmas) - Rithmic, NinjaTrader, Tradovate
4. **MULTI-ASSET FIRMS** (6 firmas) - Stocks, Forex, Futures, Crypto

**Total:** 51 firmas verificadas con API

---

## CATEGORÍA 1: CRYPTO PROP FIRMS (16 FIRMAS)

### 🥇 TIER 1: ON-CHAIN REAL TRADING (Trading Real Verificable)

#### 1. **Carrot Funding** ⭐⭐⭐⭐⭐
- **Exchange:** Hyperliquid DEX (L1 propia)
- **API:** REST + WebSocket Hyperliquid
- **Autenticación:** Firma de wallet Ethereum (EIP-712)
- **Ejecución:** 100% on-chain verificable
- **Profit Split:** 50-80%
- **Fee Evaluación:** $200-500
- **URL:** https://carrot.fund
- **Modificación App:** ~60 horas (nueva integración)
- **Ventaja:** Trading real, transparencia blockchain
- **Desventaja:** Requiere reescribir integración API

#### 2. **Propr** ⭐⭐⭐⭐⭐
- **Exchange:** Hyperliquid DEX
- **API:** REST + WebSocket Hyperliquid
- **Autenticación:** Wallet Ethereum
- **Ejecución:** On-chain real
- **Profit Split:** 60-85%
- **Fee:** $250-600
- **URL:** https://propr.trade
- **Modificación App:** ~60 horas
- **Ventaja:** Auditabilidad completa
- **Desventaja:** Curva de aprendizaje Hyperliquid

### 🥈 TIER 2: BYBIT DEMO API (Simuladores - Fácil Integración)

#### 3. **HyroTrader** ⭐⭐⭐⭐
- **Exchange:** Bybit Demo
- **API:** api-demo.bybit.com (REST + WebSocket)
- **Autenticación:** API Key + Secret (HMAC-SHA256)
- **Ejecución:** Simulada (demo account)
- **Profit Split:** 80-90%
- **Fee:** $59-599
- **URL:** https://www.hyrotrader.com
- **Modificación App:** 1 línea (cambio endpoint)
- **Ventaja:** Integración inmediata, API idéntica a Bybit
- **Desventaja:** No es trading real
- **Plataforma adicional:** CLEO (Binance market data)

#### 4. **Mubite** ⭐⭐⭐⭐
- **Exchange:** Bybit Demo
- **API:** api-demo.bybit.com
- **Autenticación:** API Key + Secret
- **Ejecución:** Simulada
- **Profit Split:** 80-90%
- **Fee:** $99-899
- **URL:** https://mubite.com
- **Modificación App:** 1 línea
- **Ventaja:** Mismo stack técnico que HyroTrader (CLEO)
- **Desventaja:** Planes más caros
- **Nota:** Empresa independiente de HyroTrader (ambos usan CLEO)

#### 5. **Klein Funding** ⭐⭐⭐
- **Exchange:** Bybit Demo
- **API:** api-demo.bybit.com (explícito en docs)
- **Ejecución:** Simulada
- **Profit Split:** 70-85%
- **Fee:** $49-499
- **URL:** https://kleinfunding.com
- **Modificación App:** 1 línea
- **Ventaja:** Transparente sobre modelo demo
- **Desventaja:** Documentación API menos detallada

#### 6. **Crypto Fund Trader (CFT)** ⭐⭐⭐
- **Exchange:** Bybit Demo + Binance (precio)
- **API:** api-demo.bybit.com
- **Ejecución:** Simulada
- **Profit Split:** 80-90%
- **Fee:** $99+
- **URL:** https://cryptofundtrader.com
- **Modificación App:** 1 línea
- **Ventaja:** Variedad de exchanges (precio)
- **Desventaja:** Menos establecido

### 🥉 TIER 3: BINANCE/MULTI-EXCHANGE (Simuladores - Integración Media)

#### 7. **Tradeify Crypto** ⭐⭐⭐⭐
- **Exchanges:** Binance, Bybit, OKX
- **API:** Direct API integration (simulada)
- **Plataforma:** DXTrade
- **Ejecución:** Simulada
- **Profit Split:** 80-90%
- **Fee:** $100-500
- **Lanzamiento:** Enero 2026
- **URL:** https://tradeify.com/crypto
- **Modificación App:** ~20-40 horas (integración DXTrade)
- **Ventaja:** Multi-exchange, plataforma moderna
- **Desventaja:** Muy nuevo (lanzado 2026)

#### 8. **WenCrypto** (Maven Trading) ⭐⭐⭐⭐
- **Exchanges:** Binance, Bybit, Kraken, OKX
- **API:** Direct API integration (simulada)
- **Plataforma:** Match Trader
- **Ejecución:** Simulada
- **Profit Split:** 75-85%
- **Fee:** $150-600
- **URL:** https://maven.trading/wencrypto
- **Modificación App:** ~20-40 horas (Match Trader)
- **Ventaja:** 4 exchanges, buena reputación Maven
- **Desventaja:** Match Trader menos común

#### 9. **BrightFunded** ⭐⭐⭐⭐
- **Exchanges:** Binance, Bybit, Coinbase, Kraken (precio)
- **API:** DxTrade, cTrader, MT5
- **Ejecución:** Simulada
- **Profit Split:** 80-90%
- **Fee:** $99-799
- **URL:** https://brightfunded.com
- **Modificación App:** ~30-50 horas (multi-plataforma)
- **Ventaja:** 3 plataformas (DxTrade, cTrader, MT5)
- **Desventaja:** Precios de Binance/Kraken (no ejecución directa)

#### 10. **BEM Funding** ⭐⭐⭐
- **Exchanges:** Binance, Bybit (referencia)
- **API:** Direct API (simulada)
- **Plataforma:** cTrader, DXTrade
- **Profit Split:** 80%
- **Fee:** $100-500
- **Modificación App:** ~20-40 horas
- **Ventaja:** Opciones cTrader (buen API)
- **Desventaja:** Menos conocido

#### 11. **Velotrade** ⭐⭐⭐⭐⭐
- **Exchange:** Propio (multi-venue aggregator)
- **API:** Full REST + WebSocket (incluido sin fee)
- **Ejecución:** Simulada
- **Profit Split:** 80-90%
- **Fee:** $0 (no evaluation fee - modelo diferente)
- **URL:** https://velotrade.com
- **Modificación App:** ~30-50 horas (API custom)
- **Ventaja:** API incluido gratis, sin fee evaluación, mejor para algo traders
- **Desventaja:** API propietario (no Bybit/Binance directo)
- **Recomendado para:** Traders experimentados con estrategias validadas

### 🏅 TIER 4: PLATAFORMAS WHITE-LABEL (Acceso API vía Plataforma)

#### 12. **GoatFunded Trader** ⭐⭐⭐
- **Exchange:** Bybit (precio)
- **Plataforma:** DXTrade
- **API:** Via DXTrade
- **Profit Split:** 80%
- **Fee:** $79-499
- **URL:** https://www.goatfundedtrader.com
- **Modificación App:** ~20-40 horas (DXTrade)

#### 13. **The Funded Crypto** ⭐⭐⭐
- **Exchange:** Binance (precio)
- **Plataforma:** Match-Trader
- **API:** Via Match-Trader
- **Profit Split:** 70-80%
- **Fee:** $100-600
- **Modificación App:** ~20-40 horas

#### 14. **Crypto Capital Ventures** ⭐⭐⭐
- **Exchange:** Multi-venue
- **Plataforma:** Propia
- **API:** Custom REST
- **Profit Split:** 75-85%
- **Fee:** $150-700
- **Modificación App:** ~40-60 horas

#### 15. **Funded Crypto Trader** ⭐⭐⭐
- **Exchange:** Bybit, Binance (precio)
- **Plataforma:** cTrader
- **API:** cTrader Open API
- **Profit Split:** 80%
- **Fee:** $99-599
- **Modificación App:** ~30-50 horas

#### 16. **BitQuant Funding** ⭐⭐⭐
- **Exchange:** OKX, Bybit
- **Plataforma:** MT5
- **API:** MT5 (local DLL, no web API)
- **Profit Split:** 70-80%
- **Fee:** $100-500
- **Modificación App:** ❌ No recomendado (MT5 no tiene web API)
- **Nota:** MT5 requiere integración local, no REST/WebSocket

---

## CATEGORÍA 2: FOREX PROP FIRMS (15 FIRMAS)

### 🥇 TIER 1: cTrader (Mejor API para Forex)

#### 17. **FunderPro** ⭐⭐⭐⭐⭐
- **Plataforma:** cTrader, MT5, TradeLocker
- **API:** cTrader Open API (REST + WebSocket + Protocol Buffers)
- **Autenticación:** OAuth2 (Client ID + Secret)
- **Lenguajes:** Python, C# (SDKs oficiales)
- **Profit Split:** 80-90%
- **Fee:** $79-599
- **URL:** https://funderpro.com
- **Modificación App:** ~40-60 horas (cTrader API)
- **Ventaja:** Mejor API forex del mercado
- **Desventaja:** Curva de aprendizaje cTrader
- **Python Package:** `ctrader_open_api` (PyPI)

#### 18. **FundedNext** (Forex) ⭐⭐⭐⭐
- **Plataforma:** MT4, MT5, cTrader, Match-Trader
- **API:** cTrader Open API (solo en cTrader)
- **Automated Trading:** Permitido en MT4/MT5 (con fee), PROHIBIDO en cTrader/Match-Trader
- **Profit Split:** 80-90%
- **Fee:** $49-549
- **URL:** https://fundednext.com
- **Modificación App:** ~40-60 horas (cTrader) o ❌ MT4/MT5 (DLL local)
- **Ventaja:** Multi-plataforma, flexible
- **Desventaja:** Automated trading prohibido en cTrader (manual only)
- **Límite:** $300K por estrategia

#### 19. **The Funded Trader (TFT)** ⭐⭐⭐⭐
- **Plataforma:** cTrader, DXTrade
- **API:** cTrader Open API
- **US Clients:** Aprobado para ofrecer cTrader a clientes US
- **Profit Split:** 80-95%
- **Fee:** $99-999
- **URL:** https://thefundedtraderprogram.com
- **Modificación App:** ~40-60 horas
- **Ventaja:** cTrader disponible en US
- **Desventaja:** Planes caros

#### 20. **MyFundedFX** ⭐⭐⭐
- **Plataforma:** cTrader, MT5
- **API:** cTrader Open API
- **Profit Split:** 80%
- **Fee:** $99-799
- **Modificación App:** ~40-60 horas
- **Ventaja:** Buena integración cTrader
- **Desventaja:** Menos conocido

#### 21. **Alpha Capital Group** ⭐⭐⭐⭐
- **Plataforma:** MT5, cTrader, DXtrade, TradeLocker
- **API:** cTrader Open API, TradeLocker API
- **Automated Trading:** Dedicados a soportar bots y quant strategies
- **Profit Split:** 80-90%
- **Fee:** $67-567
- **URL:** https://alphacapitalgroup.io
- **Modificación App:** ~40-60 horas (cTrader/TradeLocker)
- **Ventaja:** Multi-plataforma, pro-automation
- **Desventaja:** Muchas opciones pueden confundir

### 🥈 TIER 2: Match-Trader / DXTrade

#### 22. **BrightFunded** (Forex) ⭐⭐⭐⭐
- **Plataforma:** MT5, cTrader, DXTrade
- **API:** cTrader Open API, DXTrade API
- **Profit Split:** 80-90%
- **Fee:** $79-599
- **URL:** https://brightfunded.com
- **Modificación App:** ~40-60 horas
- **Ventaja:** 3 plataformas con API
- **Desventaja:** Puede ser confuso elegir

#### 23. **FundingPips** ⭐⭐⭐⭐
- **Plataforma:** MT4, MT5, TradeLocker, DXTrade, cTrader, MatchTrader
- **API:** Múltiples (depende de plataforma elegida)
- **Profit Split:** 80-90%
- **Fee:** $59-499
- **URL:** https://fundingpips.com
- **Modificación App:** Variable según plataforma
- **Ventaja:** 6 plataformas disponibles
- **Desventaja:** Complejidad de elección

#### 24. **E8 Markets (E8 Funding)** ⭐⭐⭐⭐
- **Plataforma:** MT4, MT5, cTrader, TradeLocker
- **API:** cTrader Open API
- **Ubicación:** US-friendly
- **Profit Split:** 80-95% (escalable)
- **Fee:** $97-1297
- **URL:** https://e8markets.com
- **Modificación App:** ~40-60 horas (cTrader)
- **Ventaja:** US-friendly, profit split escalable hasta 95%
- **Desventaja:** Sin fees mensuales ni de retiro

### 🥉 TIER 3: MetaTrader (API Local - Menos Recomendado)

#### 25. **FTMO** ⭐⭐⭐⭐⭐
- **Plataforma:** MT4, MT5 (Forex), MT5 (Futures)
- **API:** MT4/MT5 (DLL local, NO web API)
- **Automated Trading:** PERMITIDO (forex y futures)
- **VPS:** Permitido explícitamente
- **Profit Split:** 80-90%
- **Fee:** $155-1080
- **URL:** https://ftmo.com
- **Modificación App:** ❌ No recomendado (MT4/MT5 no tiene REST/WebSocket API)
- **Ventaja:** Firma más establecida, permite bots
- **Desventaja:** MT4/MT5 requiere integración local (DLL), no web API
- **Límite:** $400K por estrategia

**NOTA IMPORTANTE:** MyForexFunds (antes popular) CERRADO en septiembre 2023 por CFTC. NO operar con ellos.

#### 26. **The5ers** ⭐⭐⭐⭐
- **Plataforma:** MT5, cTrader
- **API:** cTrader Open API
- **Integración cTrader:** Anunciada en 2025
- **Profit Split:** 50-100%
- **Fee:** $75-990
- **URL:** https://the5ers.com
- **Modificación App:** ~40-60 horas (cTrader)
- **Ventaja:** cTrader recién integrado
- **Desventaja:** Menos documentación API aún

#### 27. **Audacity Capital** ⭐⭐⭐
- **Plataforma:** MT5
- **API:** MT5 (DLL local)
- **Profit Split:** 80%
- **Fee:** $147-997
- **Modificación App:** ❌ No recomendado
- **Nota:** Solo MT5, no tiene web API

#### 28. **City Traders Imperium** ⭐⭐⭐
- **Plataforma:** MT4, MT5
- **API:** MT4/MT5 (local)
- **Profit Split:** 70-80%
- **Fee:** $99-799
- **Modificación App:** ❌ No recomendado

#### 29. **SurgeTrader** ⭐⭐⭐
- **Plataforma:** MT5
- **API:** MT5 (local)
- **Profit Split:** 90%
- **Fee:** $99-799
- **Modificación App:** ❌ No recomendado

#### 30. **Blue Guardian** ⭐⭐⭐
- **Plataforma:** MT5
- **API:** MT5 (local)
- **Profit Split:** 80%
- **Fee:** $99-599
- **Modificación App:** ❌ No recomendado

#### 31. **OANDA (Broker con API)** ⭐⭐⭐⭐⭐
- **Tipo:** Broker (no prop firm)
- **API:** v20 REST API, FIX, MT4
- **Autenticación:** API Token
- **Datos históricos:** Desde 2005
- **Ventaja:** API excelente, broker regulado
- **Desventaja:** Requiere capital propio (no es prop firm)
- **Uso:** Comparación/benchmark de APIs

---

## CATEGORÍA 3: FUTURES PROP FIRMS (14 FIRMAS)

### 🥇 TIER 1: Rithmic (Mejor API Futures)

#### 32. **Apex Trader Funding** ⭐⭐⭐⭐⭐
- **Plataforma:** Rithmic, NinjaTrader
- **API:** Rithmic API (C++, C#, Java wrappers)
- **Automated Trading:** PROHIBIDO desde marzo 2026
- **Profit Split:** 90-100% (primeros $25K)
- **Fee:** $147-347
- **URL:** https://www.apextraderfunding.com
- **Modificación App:** ~50-70 horas (Rithmic)
- **Ventaja:** Mejor infraestructura futures
- **Desventaja:** ⚠️ Bots prohibidos desde 2026
- **Nota:** Solo para trading manual ahora

#### 33. **Topstep** ⭐⭐⭐⭐⭐
- **Plataforma:** Rithmic, Tradovate, NinjaTrader
- **API:** Rithmic API, TopstepX API (ProjectX)
- **Automated Trading:** PERMITIDO (con condiciones)
- **NinjaTrader API:** Disponible vía connector
- **Profit Split:** 80-90%
- **Fee:** $165-375
- **URL:** https://www.topstep.com
- **Modificación App:** ~50-70 horas (Rithmic) o ~40-60 horas (TopstepX)
- **Ventaja:** Permite bots, TopstepX es automation-friendly
- **Desventaja:** Solo desde PC casa (no VPS en cuentas live)
- **Más establecido:** Opera desde 2012

#### 34. **Bulenox** ⭐⭐⭐⭐
- **Plataforma:** Rithmic
- **API:** Rithmic API
- **Profit Split:** 100% primeros $10K, luego 90%
- **Fee:** $125-625
- **Ranking:** #15 entre futures firms (oct 2026)
- **URL:** https://bulenox.com
- **Modificación App:** ~50-70 horas
- **Ventaja:** Profit split 100% inicial
- **Desventaja:** Más caro que competencia

#### 35. **Alpha Futures** ⭐⭐⭐⭐
- **Plataforma:** TradingView, NinjaTrader, Tradovate, Quantower, Alpha Trader, WealthCharts, DeepCharts
- **API:** NinjaTrader API, Tradovate API, Rithmic
- **Profit Split:** 90% flat
- **Fee:** $89-589
- **Fundación:** UK, julio 2024
- **Ranking:** #16 (oct 2026)
- **URL:** https://alpha-futures.com
- **Modificación App:** ~40-60 horas (depende plataforma)
- **Ventaja:** Multi-plataforma, buenas opciones
- **Desventaja:** Relativamente nuevo

#### 36. **Lucid Trading** ⭐⭐⭐⭐⭐
- **Plataforma:** NinjaTrader, Tradovate, Quantower, MotiveWave, Rithmic
- **API:** Rithmic API
- **Profit Split:** 90%
- **Fee:** $90-490
- **Ranking:** #1 futures prop firm (oct 2026)
- **URL:** https://lucidtrading.com
- **Modificación App:** ~50-70 horas (Rithmic)
- **Ventaja:** Top-ranked, excelente reputación
- **Desventaja:** Ninguna significativa

#### 37. **Take Profit Trader** ⭐⭐⭐⭐
- **Plataforma:** Rithmic, Tradovate, NinjaTrader
- **API:** Rithmic API
- **Profit Split:** 80-100%
- **Fee:** $147-397
- **Modificación App:** ~50-70 horas
- **Ventaja:** Buenas opciones de profit split
- **Desventaja:** Fee un poco alto

### 🥈 TIER 2: NinjaTrader / Tradovate

#### 38. **MyFundedFutures** ⭐⭐⭐⭐
- **Plataforma:** NinjaTrader, Rithmic, Tradovate
- **API:** NinjaTrader API (TradeAPI)
- **Automated Trading:** PERMITIDO
- **Profit Split:** 80-90%
- **Fee:** $99-599
- **URL:** https://myfundedfutures.com
- **Modificación App:** ~40-60 horas (NinjaTrader TradeAPI)
- **Ventaja:** Permite automation, pasa tests 2026
- **Desventaja:** Menos conocido que Apex/Topstep

#### 39. **TradeDay** ⭐⭐⭐⭐
- **Plataforma:** NinjaTrader, Tradovate, Rithmic
- **API:** NinjaTrader API
- **Profit Split:** 90-100%
- **Fee:** $99-499
- **Modificación App:** ~40-60 horas
- **Ventaja:** Profit split excelente
- **Desventaja:** Menos documentación API

#### 40. **Tradeify** (Futures) ⭐⭐⭐⭐
- **Plataforma:** NinjaTrader, Rithmic, Tradovate
- **API:** NinjaTrader API
- **Automated Trading:** PERMITIDO (pasa tests)
- **Profit Split:** 80-90%
- **Fee:** $79-399
- **Modificación App:** ~40-60 horas
- **Ventaja:** Permite bots, pasa automation tests
- **Desventaja:** Relativamente nuevo

#### 41. **FundedNext Futures** ⭐⭐⭐⭐
- **Plataforma:** NinjaTrader, Tradovate, Rithmic
- **API:** NinjaTrader API
- **Automated Trading:** PERMITIDO (pasa tests)
- **Profit Split:** 80-90%
- **Fee:** $99-599
- **Modificación App:** ~40-60 horas
- **Ventaja:** Extensión de FundedNext conocido
- **Desventaja:** Puede confundirse con forex version

### 🥉 TIER 3: Otras Plataformas

#### 42. **Earn2Trade** ⭐⭐⭐⭐
- **Plataforma:** TradingView, NinjaTrader, Tradovate, Rithmic, Blackarrow, Finamark
- **API:** Múltiples
- **Rithmic:** Terminó soporte bundled junio 2026
- **Trade Copiers:** NO permitidos
- **Profit Split:** 80-90%
- **Fee:** $150-450
- **Fundación:** 2017
- **URL:** https://www.earn2trade.com
- **Modificación App:** ~40-60 horas (depende plataforma)
- **Ventaja:** 6 plataformas, establecido desde 2017
- **Desventaja:** No trade copiers, Rithmic bundled descontinuado

#### 43. **The Trading Pit** ⭐⭐⭐⭐
- **Plataforma:** ATAS, Rithmic, Quantower
- **API:** Rithmic API
- **Profit Split:** 80%
- **Fee:** $99-499
- **URL:** https://thetradingpit.com
- **Modificación App:** ~50-70 horas (Rithmic)
- **Ventaja:** ATAS para order flow, Rithmic ultra-low latency
- **Desventaja:** Menos conocido

#### 44. **FundingTicks** ⭐⭐⭐
- **Plataforma:** NinjaTrader, Rithmic
- **API:** NinjaTrader API
- **Profit Split:** 80-90%
- **Fee:** $99-599
- **Modificación App:** ~40-60 horas
- **Ventaja:** Soporte NinjaTrader automation
- **Desventaja:** Poca información disponible

#### 45. **BluSky Futures** ⭐⭐⭐
- **Plataforma:** Rithmic
- **API:** Rithmic API
- **Profit Split:** 80%
- **Fee:** $150-600
- **Modificación App:** ~50-70 horas
- **Ventaja:** Rithmic directo
- **Desventaja:** Menos establecido

---

## CATEGORÍA 4: MULTI-ASSET FIRMS (6 FIRMAS)

### Firmas que operan Stocks + Forex + Futures + Crypto

#### 46. **BrightFunded** (Multi-Asset) ⭐⭐⭐⭐⭐
- **Assets:** Forex, Crypto, Indices, Commodities
- **Plataformas:** DxTrade, cTrader, MT5
- **API:** cTrader Open API, DXTrade API
- **Profit Split:** 80-90%
- **Fee:** $79-799
- **URL:** https://brightfunded.com
- **Modificación App:** ~40-60 horas (multi-plataforma)
- **Ventaja:** Único cuenta para múltiples assets
- **Desventaja:** Complejidad de gestión

#### 47. **FundingPips** (Multi-Asset) ⭐⭐⭐⭐
- **Assets:** Forex, Indices, Commodities, Metales
- **Plataformas:** MT4, MT5, TradeLocker, DXTrade, cTrader, MatchTrader
- **API:** Múltiples (según plataforma)
- **Profit Split:** 80-90%
- **Fee:** $59-499
- **URL:** https://fundingpips.com
- **Modificación App:** Variable
- **Ventaja:** 6 plataformas disponibles
- **Desventaja:** No incluye crypto directamente

#### 48. **E8 Markets** (Multi-Asset) ⭐⭐⭐⭐
- **Assets:** Forex (56 pares), Stocks (Apple, Tesla, Netflix, Meta), Indices, Commodities
- **Plataformas:** MT4, MT5, cTrader, TradeLocker
- **API:** cTrader Open API
- **Profit Split:** 80-95%
- **Fee:** $97-1297
- **Fundación:** 2021, US-based
- **URL:** https://e8markets.com
- **Modificación App:** ~40-60 horas (cTrader)
- **Ventaja:** US-friendly, multi-asset real, bots permitidos
- **Desventaja:** Fee alto en planes grandes

#### 49. **Trade The Pool** (Stocks Focus) ⭐⭐⭐⭐
- **Assets:** Stocks (primario), Indices
- **Plataforma:** TraderEvolution
- **API:** TraderEvolution API (REST + WebSocket)
- **Profit Split:** 80%
- **Fee:** $99-599
- **URL:** https://tradethepool.com
- **Modificación App:** ~50-70 horas (TraderEvolution)
- **Ventaja:** Enfoque en stocks, API robusta
- **Desventaja:** Plataforma menos conocida

#### 50. **Alpha Capital Group** (Multi-Asset) ⭐⭐⭐⭐
- **Assets:** Forex, Indices, Commodities, Metales
- **Plataformas:** MT5, cTrader, DXtrade, TradeLocker
- **API:** cTrader Open API, TradeLocker API
- **Automated Trading:** Dedicados a soportar
- **Profit Split:** 80-90%
- **Fee:** $67-567
- **URL:** https://alphacapitalgroup.io
- **Modificación App:** ~40-60 horas
- **Ventaja:** Pro-automation, multi-plataforma
- **Desventaja:** No incluye crypto

#### 51. **IQ Capital** (Multi-Asset) ⭐⭐⭐
- **Assets:** Crypto, CFDs, Futures
- **Plataformas Crypto/CFD:** Volumetrica FX, MetaTrader 5
- **Plataformas Futures:** Quantower, Tradovate, ATAS, DeepChart
- **API Recomendado:**
  - **Volumetrica FX** (REST + WebSocket + Webhooks) - Crypto/CFD
  - **Tradovate** (REST + WebSocket) - Futures
- **Autenticación:**
  - Volumetrica: API Key (docs privados, contactar firma)
  - Tradovate: OAuth2
- **Ejecución:** Capital real de la firma
- **Profit Split:** Hasta 90%
- **Challenge:**
  - Profit Target: 8%
  - Max Drawdown: 6%
  - Position Loss Limit: 1%
  - Duración: 30 días
- **Fee:** $49-95 (challenge), $19 (extension), $9 (instant funding)
- **Fundación:** US-based
- **URL:** https://www.iqcapital.io/
- **Modificación App:**
  - Volumetrica FX: ~20-30 horas (REST + WebSocket)
  - Tradovate: ~20-30 horas (similar a Bybit)
  - MT5: ~40-60 horas (DLL local, no recomendado)
- **Ventajas:**
  - Multi-asset real (crypto, CFD, futures en una firma)
  - Volumetrica FX tiene REST API (web-friendly)
  - Tradovate API probada y documentada
  - Instant funding desde $9
  - Hasta 10 cuentas simultáneas
  - Soft Breach System (2 oportunidades antes de hard breach)
  - Withdrawals rápidos (3h promedio, 48h garantizado)
  - Sin mínimo de retiro
- **Desventajas:**
  - Volumetrica API docs no públicos (requiere contacto)
  - Quantower/ATAS/DeepChart usan C# SDK (muy complejo)
  - Múltiples plataformas (debes elegir una por mercado)
  - MT5 para crypto requiere DLL local (no recomendado para web apps)
- **Recomendación Integración:**
  - **Para Crypto/CFD:** Volumetrica FX > MT5
  - **Para Futures:** Tradovate (excelente API)
  - **Evitar:** ATAS, Quantower, DeepChart (C# SDK)
- **Recursos API:**
  - Volumetrica: Contactar https://www.volumetricatrading.com/
  - Tradovate: https://api.tradovate.com/v1/docs
  - Quantower: http://api.quantower.com
  - ATAS: https://atas.net/ (sección API)

---

## TABLA COMPARATIVA RÁPIDA

### Por Tipo de Integración con Tu App

| Complejidad | Firmas | Esfuerzo Dev | Descripción |
|-------------|--------|--------------|-------------|
| ⭐ MUY FÁCIL | HyroTrader, Mubite, Klein | **1 línea** | Cambio endpoint Bybit → Bybit Demo |
| ⭐⭐ FÁCIL | Tradeify, WenCrypto, BEM, IQ Capital | 20-40h | DXTrade/Match-Trader/Volumetrica/Tradovate |
| ⭐⭐⭐ MEDIA | FunderPro, FundedNext, TFT | 40-60h | cTrader Open API |
| ⭐⭐⭐⭐ DIFÍCIL | Lucid, Bulenox, TopStep | 50-70h | Rithmic/NinjaTrader API |
| ⭐⭐⭐⭐⭐ MUY DIFÍCIL | Carrot, Propr | 60-80h | Hyperliquid (nueva blockchain) |
| ❌ NO RECOMENDADO | FTMO, Audacity, etc. | N/A | MT4/MT5 (DLL local, no web API) |

### Por Exchange/Plataforma

| Exchange/Plataforma | Firmas | Tipo API | Recomendado |
|---------------------|--------|----------|-------------|
| **Bybit Demo** | HyroTrader, Mubite, Klein, CFT | REST + WebSocket | ✅ Sí (muy fácil) |
| **Hyperliquid** | Carrot, Propr | REST + WebSocket (on-chain) | ✅ Sí (si quieres real trading) |
| **Volumetrica FX** | IQ Capital | REST + WebSocket + Webhooks | ✅ Sí (crypto/CFD, docs privados) |
| **Tradovate** | IQ Capital | REST + WebSocket OAuth2 | ✅ Sí (futures) |
| **cTrader** | FunderPro, FundedNext, TFT, Alpha | Open API (REST + WebSocket + Protobuf) | ✅ Sí (forex) |
| **Rithmic** | Apex, Topstep, Lucid, Bulenox | Rithmic API (C++/C#/Java) | ✅ Sí (futures) |
| **NinjaTrader** | MyFundedFutures, TradeDay, Tradeify | TradeAPI (REST) | ✅ Sí (futures) |
| **DXTrade** | Tradeify, WenCrypto, BrightFunded | DXTrade API | ⚠️ Media complejidad |
| **Match-Trader** | WenCrypto, FundingPips | Match-Trader API | ⚠️ Media complejidad |
| **MT4/MT5** | FTMO, The5ers, etc. | DLL local (NO web API) | ❌ No recomendado |

### Por Profit Split

| Rango | Firmas Destacadas |
|-------|-------------------|
| **95-100%** | Topstep (90-100%), Bulenox (100% primeros $10K), E8 Markets (95%), TradeDay (90-100%) |
| **90%** | HyroTrader, Mubite, Apex (90-100% primeros $25K), Lucid, Alpha Futures |
| **80-90%** | Mayoría de firmas |
| **70-80%** | Klein, City Traders Imperium |
| **50-80%** | Carrot Funding (on-chain real) |

### Por Fee de Evaluación (Plan Básico)

| Rango | Firmas |
|-------|--------|
| **$0** | Velotrade (sin fee evaluación) |
| **$49-79** | Klein ($49), IQ Capital ($49-95), FunderPro ($79), Tradeify ($79), BrightFunded ($79) |
| **$80-99** | Alpha Futures ($89), Lucid ($90), E8 ($97), MyFundedFutures ($99) |
| **$100-150** | Tradeify Crypto ($100), WenCrypto ($150), Topstep ($165) |
| **$150-200** | FTMO ($155), Carrot ($200) |
| **$200+** | Propr ($250), E8 Markets ($97-1297) |

---

## RECOMENDACIONES POR CASO DE USO

### CASO 1: Quiero empezar YA con mínima modificación
**Recomendación:** HyroTrader o Mubite
- **Razón:** 1 línea de código (cambio endpoint)
- **Tiempo:** 1-2 días
- **Costo:** $59-99
- **Limitación:** Trading simulado

### CASO 2: Quiero trading REAL verificable
**Recomendación:** Carrot Funding o Propr
- **Razón:** On-chain, 100% transparente
- **Tiempo:** 3-4 semanas desarrollo
- **Costo:** $200-500
- **Ventaja:** Trading real en blockchain

### CASO 3: Foco en FOREX con bots
**Recomendación:** FunderPro (cTrader)
- **Razón:** Mejor API forex del mercado
- **Tiempo:** 2-3 semanas
- **Costo:** $79+
- **SDK:** Python `ctrader_open_api`

### CASO 4: Foco en FUTURES con bots
**Recomendación:** Topstep o Lucid Trading
- **Razón:** Rithmic API (ultra-low latency)
- **Tiempo:** 2-3 semanas
- **Costo:** $90-165
- **Ventaja:** Topstep permite bots, Lucid #1 ranked

### CASO 5: Multi-exchange crypto
**Recomendación:** Tradeify Crypto
- **Razón:** Binance, Bybit, OKX
- **Tiempo:** 1-2 semanas
- **Costo:** $100-500
- **Ventaja:** Lanzado 2026, plataforma moderna (DXTrade)

### CASO 6: Algo trader profesional (sin fee)
**Recomendación:** Velotrade
- **Razón:** API gratis incluido, sin fee evaluación
- **Tiempo:** 1-2 semanas
- **Costo:** $0 evaluación
- **Ventaja:** Para traders con estrategia validada

### CASO 7: Multi-asset (Forex + Stocks + Crypto)
**Recomendación:** BrightFunded
- **Razón:** 3 plataformas, 4 exchanges
- **Tiempo:** 2-3 semanas
- **Costo:** $79-799
- **Ventaja:** Cuenta única para múltiples assets

### CASO 8: Crypto + Futures en una firma
**Recomendación:** IQ Capital
- **Razón:** Multi-asset real (crypto, CFD, futures)
- **Tiempo:** 2-3 semanas (Volumetrica FX + Tradovate)
- **Costo:** $49-95 (instant funding desde $9)
- **Ventaja:**
  - Volumetrica FX REST API para crypto/CFD
  - Tradovate API probada para futures
  - Hasta 10 cuentas simultáneas
  - Withdrawals rápidos (3h promedio)
- **Limitación:** Documentación Volumetrica requiere contacto directo

---

## ROADMAP DE DESARROLLO SUGERIDO

### FASE 1: Quick Start (Semana 1-2)
**Objetivo:** Validar concepto con mínima inversión

1. **Integrar Bybit Demo API** (1 día)
   - Cambiar endpoint en `config.js`
   - Testing básico

2. **Crear cuenta HyroTrader** (1 día)
   - Registrarse
   - Solicitar API docs
   - Obtener API keys demo

3. **Testing exhaustivo** (3-5 días)
   - Probar todos los endpoints
   - Verificar rate limits
   - Validar WebSocket

4. **Evaluación** (opcional)
   - Pagar $59 si funciona
   - Empezar a generar payouts

### FASE 2: Expansión Forex (Semana 3-5)
**Objetivo:** Agregar soporte cTrader para forex

1. **Investigar cTrader Open API** (2 días)
   - Leer docs oficial
   - Instalar `ctrader_open_api` (PyPI)

2. **Desarrollar adapter cTrader** (5-7 días)
   - Autenticación OAuth2
   - Endpoints principales (market data, orders)
   - WebSocket para real-time

3. **Integración dual-mode** (2-3 días)
   ```javascript
   const exchangeType = process.env.EXCHANGE_TYPE; // 'bybit' | 'ctrader'
   ```

4. **Testing con FunderPro demo** (2-3 días)

### FASE 3: Futures Trading (Semana 6-8)
**Objetivo:** Agregar Rithmic/NinjaTrader para futures

1. **Decisión Rithmic vs NinjaTrader**
   - Rithmic: Más bajo nivel, ultra-low latency
   - NinjaTrader: TradeAPI más simple

2. **Desarrollo adapter** (7-10 días)
   - C++ wrappers (Rithmic) o REST (NinjaTrader)
   - Market data futures
   - Order management

3. **Testing con Topstep** (3-5 días)

### FASE 4: On-Chain Real (Semana 9-12)
**Objetivo:** Hyperliquid para trading real

1. **Integrar ethers.js** (2-3 días)
   - Wallet management
   - Firma EIP-712

2. **Hyperliquid API** (8-10 días)
   - REST endpoints
   - WebSocket
   - Asset mapping

3. **Testing en testnet** (3-5 días)
4. **Evaluación Carrot Funding** ($200-500)

### FASE 5: Unificación (Semana 13-16)
**Objetivo:** Arquitectura multi-exchange única

```javascript
// ExchangeFactory.js
class ExchangeFactory {
  static create(type, config) {
    switch(type) {
      case 'bybit': return new BybitAdapter(config);
      case 'bybit-demo': return new BybitDemoAdapter(config);
      case 'ctrader': return new CTraderAdapter(config);
      case 'rithmic': return new RithmicAdapter(config);
      case 'hyperliquid': return new HyperliquidAdapter(config);
      default: throw new Error('Unsupported exchange');
    }
  }
}
```

---

## COSTOS TOTALES ESTIMADOS

### Opción A: Solo Bybit Demo (Crypto)
- **Desarrollo:** 1-2 días (~$0)
- **Evaluación:** $59-99 (HyroTrader/Mubite)
- **Total:** **$59-99**
- **ROI:** Inmediato (empiezas a operar)

### Opción B: Bybit + cTrader (Crypto + Forex)
- **Desarrollo:** 2-3 semanas (~$0)
- **Evaluación:** $59 (Bybit) + $79 (FunderPro)
- **Total:** **$138**
- **ROI:** 1-2 meses

### Opción C: Completa (Bybit + cTrader + Rithmic + Hyperliquid)
- **Desarrollo:** 3-4 meses (~$0 si tú lo haces)
- **Evaluaciones:** $59 + $79 + $165 + $200
- **Total:** **$503**
- **ROI:** 3-6 meses

### Opción D: Externalizar Desarrollo Completo
- **Freelancer:** $5,000-10,000 USD
- **Evaluaciones:** $503
- **Total:** **$5,503-10,503**
- **ROI:** 6-12 meses

---

## CONSIDERACIONES LEGALES Y REGULATORIAS

### Firmas US-Friendly
- E8 Markets ✅
- The Funded Trader ✅
- Apex Trader Funding ✅
- Topstep ✅
- Earn2Trade ✅

### Firmas Internacionales (No US)
- HyroTrader (Czech Republic)
- Mubite (Czech Republic)
- FTMO (Czech Republic)
- FunderPro (Internacional)

### Modelo de Negocio
- **80-90% son simuladores:** Pagan desde pool de fees
- **5-10% trading real:** Carrot, Propr (on-chain)
- **Ninguna es broker regulado:** No tienen licencias financieras tradicionales

### Riesgos
1. **Firma puede cerrar:** Ver caso MyForexFunds (CFTC shutdown 2023)
2. **Cambio de ToS:** Políticas pueden cambiar (ver Apex banning bots 2026)
3. **Payouts no garantizados:** Dependen de ToS y solvencia de firma

### Mitigaciones
1. **Diversificar:** No poner todos los huevos en una firma
2. **Backup de datos:** Logger exhaustivo de tus trades
3. **Leer ToS:** Entender exactamente qué permiten
4. **Empezar pequeño:** Plan básico primero

---

## RECURSOS ADICIONALES

### APIs Documentación Oficial

**Bybit:**
- REST: https://bybit-exchange.github.io/docs/v5/intro
- WebSocket: https://bybit-exchange.github.io/docs/v5/ws/connect

**Hyperliquid:**
- Gitbook: https://hyperliquid.gitbook.io/hyperliquid-docs
- SDK Python: https://github.com/hyperliquid-dex/hyperliquid-python-sdk

**cTrader:**
- Open API: https://help.ctrader.com/open-api/
- Python Package: https://pypi.org/project/ctrader_open_api/

**Rithmic:**
- Developer Portal: https://yyy3.rithmic.com/
- C++ API: https://www.rithmic.com/rithmic_protocol_api.html

**NinjaTrader:**
- TradeAPI: https://connect.ninjatrader.com/futures-trading-api/
- Documentation: https://ninjatrader.com/support/helpGuides/nt8/

### Comunidades y Foros
- Reddit: r/proptrading, r/algotrading
- Discord: Cada firma tiene su servidor
- Telegram: Grupos de cada firma

### Herramientas de Desarrollo
- **Postman:** Testing APIs REST
- **wscat:** Testing WebSockets
- **Wireshark:** Debug tráfico de red
- **Docker:** Containers para diferentes adapters

---

## CONCLUSIÓN FINAL

### Top 3 por Facilidad de Integración
1. **HyroTrader** - Bybit Demo, 1 línea de código
2. **Mubite** - Bybit Demo, 1 línea de código
3. **Tradeify Crypto** - DXTrade, ~20h desarrollo

### Top 3 por Trading Real
1. **Carrot Funding** - Hyperliquid on-chain
2. **Propr** - Hyperliquid on-chain
3. *Nota: Resto son simuladores*

### Top 3 por API Quality (Forex)
1. **FunderPro** - cTrader Open API
2. **FundedNext** - cTrader (pero no permite bots en cTrader)
3. **The Funded Trader** - cTrader US-approved

### Top 3 por API Quality (Futures)
1. **Lucid Trading** - Rithmic (#1 ranked)
2. **Topstep** - Rithmic + TopstepX (permite bots)
3. **Bulenox** - Rithmic (100% primeros $10K)

### Top 3 Multi-Asset (Crypto + Futures en una firma)
1. **IQ Capital** - Volumetrica FX (crypto/CFD) + Tradovate (futures)
2. **BrightFunded** - DXTrade/cTrader/MT5 (forex/crypto/índices)
3. **E8 Markets** - cTrader (forex/stocks/índices)

### Mejor Estrategia Híbrida
1. **Corto plazo:** HyroTrader ($59, 1-2 días)
2. **Medio plazo:** FunderPro cTrader ($79, 2-3 semanas)
3. **Largo plazo:** Carrot Funding Hyperliquid ($200, 1-2 meses)

---

**DISCLAIMER:** Esta información es para propósitos educativos. Prop firms NO son brokers regulados. Investiga y entiende los riesgos antes de invertir. Los resultados pasados no garantizan resultados futuros.

**Última actualización:** 12 de octubre de 2026 (agregado IQ Capital)
**Fuentes:** Documentación oficial de cada firma, reviews verificados, testing directo de APIs

---

**Preparado por:** Claude Code (Anthropic)
**Para:** Proyecto AnalizadorDesktop (Electron + React + Bybit API)
**Versión:** 2.1 - 51 Firmas (Multi-Asset + Crypto + Forex + Futures)
