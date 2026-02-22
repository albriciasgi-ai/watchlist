# strategy_realtime_service.py
# ============================
# Servicio de ejecucion en tiempo real de estrategias del Strategy Builder.
#
# Arquitectura:
#   1. Al activar: carga historico, pre-calcula todos los niveles (batch, una vez).
#   2. En cada cierre de vela:
#      a) Agrega vela al buffer.
#      b) Actualiza niveles incrementalmente (solo cuando toca recalcular).
#      c) Evalua senal de entrada contra niveles activos.
#      d) Aplica filtros de contexto.
#      e) Si senal valida: calcula SL/TP, abre trade, envia alerta al TradingBot.
#      f) Monitorea trades abiertos (SL/TP hit vela a vela).
#
# Los niveles NO se re-detectan en cada vela. Se pre-calculan y se extienden
# incrementalmente solo cuando corresponde (nuevo segmento VP, recalc SR, etc.).

import asyncio
import json
import time
import math
import logging
from pathlib import Path
from typing import Optional, List, Dict, Tuple
from dataclasses import dataclass, field, asdict

import httpx

logger = logging.getLogger("strategy_rt")

# Alert log file
LOG_DIR = Path("logs")
LOG_DIR.mkdir(exist_ok=True)
alert_log_file = LOG_DIR / "strategy_rt_alerts.log"
alert_logger = logging.getLogger("strategy_rt_alerts")
if not alert_logger.handlers:
    fh = logging.FileHandler(alert_log_file, encoding="utf-8")
    fh.setFormatter(logging.Formatter(
        "%(asctime)s | %(levelname)s | %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
    alert_logger.addHandler(fh)
    alert_logger.setLevel(logging.INFO)

# Config persistence
CONFIG_DIR = Path("config")
CONFIG_DIR.mkdir(exist_ok=True)
CONFIG_FILE = CONFIG_DIR / "strategy_rt_config.json"

BYBIT_API_URL = "https://api.bybit.com/v5/market/kline"


# ============================================================
# Config
# ============================================================

@dataclass
class StrategyRTConfig:
    """Configuracion del servicio realtime del Strategy Builder."""
    enabled: bool = False
    symbols: List[str] = field(default_factory=lambda: ["BTCUSDT"])
    interval: str = "5"
    window_candles: int = 2000  # Historico necesario para calcular niveles

    # Estrategia activa (mismo formato que Strategy Builder)
    strategy: Dict = field(default_factory=dict)

    # Alertas
    alertsEnabled: bool = True
    alertTargetUrl: str = "http://localhost:5000/api/watchlist-alert"
    cooldownMinutes: int = 30

    # Recalculo periodico
    dtb_recalc_every: int = 50    # Re-detectar DTB cada N velas
    sr_recalc_every: int = 100    # Re-detectar S&R cada N velas (override del param)

    def to_dict(self) -> Dict:
        return asdict(self)


# ============================================================
# Level dataclass (replica ligera del Level del strategy_engine)
# ============================================================

@dataclass
class RTLevel:
    price: float
    level_type: str       # 'support' | 'resistance'
    source: str           # 'vp_periodic' | 'sr_v2' | 'vwap_bands' | 'swing_levels' | 'dtb_neckline' | 'vp_zones'
    strength: float = 1.0
    valid_from_idx: int = 0
    valid_until_idx: Optional[int] = None
    extra: Dict = field(default_factory=dict)


# ============================================================
# Service
# ============================================================

class StrategyRealtimeService:
    """
    Servicio que ejecuta una estrategia del Strategy Builder en tiempo real.

    Principio: los niveles se pre-calculan una vez al iniciar y se extienden
    incrementalmente. La evaluacion de senales es O(L) por vela donde L = niveles activos.
    """

    def __init__(self):
        self.ws_manager = None
        self.config = StrategyRTConfig()
        self.running = False

        # Candle buffers por simbolo
        self._candle_buffers: Dict[str, List[Dict]] = {}

        # Pre-computed state per symbol
        self._levels: Dict[str, List[RTLevel]] = {}
        self._vwap_state: Dict[str, Dict] = {}  # rolling VWAP state
        self._dtb_patterns: Dict[str, List[Dict]] = {}

        # Counters for periodic recalc
        self._candle_count: Dict[str, int] = {}
        self._last_vp_seg_end: Dict[str, int] = {}  # last VP segment end idx
        self._last_sr_recalc: Dict[str, int] = {}
        self._last_dtb_recalc: Dict[str, int] = {}
        self._last_swing_check: Dict[str, int] = {}

        # Trade management
        self._open_trades: Dict[str, List[Dict]] = {}
        self._trade_history: Dict[str, List[Dict]] = {}
        self._cooldowns: Dict[str, float] = {}  # key: "SYMBOL_DIRECTION" -> expiry timestamp

        # Signals for frontend polling
        self._recent_signals: Dict[str, List[Dict]] = {}

        # Stats
        self.stats = {
            "candles_processed": 0,
            "signals_generated": 0,
            "signals_filtered": 0,
            "alerts_sent": 0,
            "alerts_blocked_cooldown": 0,
            "trades_opened": 0,
            "trades_closed": 0,
            "start_time": 0,
        }

        # HTTP client
        self._http_client: Optional[httpx.AsyncClient] = None

        self._load_config()

    # --------------------------------------------------
    # Config persistence
    # --------------------------------------------------

    def _load_config(self):
        if CONFIG_FILE.exists():
            try:
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for key, val in data.items():
                    if hasattr(self.config, key):
                        setattr(self.config, key, val)
                logger.info(f"[STRAT_RT] Config cargada: {len(self.config.symbols)} simbolos")
            except Exception as e:
                logger.error(f"[STRAT_RT] Error cargando config: {e}")

    def _save_config(self):
        try:
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(self.config.to_dict(), f, indent=2, ensure_ascii=False)
            logger.info("[STRAT_RT] Config guardada")
        except Exception as e:
            logger.error(f"[STRAT_RT] Error guardando config: {e}")

    # --------------------------------------------------
    # Start / Stop
    # --------------------------------------------------

    async def start(self):
        if self.running:
            logger.info("[STRAT_RT] Ya esta corriendo")
            return

        if not self.config.strategy:
            logger.warning("[STRAT_RT] No hay estrategia configurada")
            return

        from websocket_manager import get_websocket_manager
        self.ws_manager = get_websocket_manager()

        self.running = True
        self.stats["start_time"] = time.time()

        self._http_client = httpx.AsyncClient(timeout=15.0)

        # Register candle close listener
        self.ws_manager.add_candle_close_listener(self._sync_candle_close_handler)

        # Subscribe symbols
        await self.ws_manager.add_subscriptions(self.config.symbols, [self.config.interval])

        # Load historical data and pre-compute levels (background)
        asyncio.create_task(self._initialize())

        # Log startup details to both loggers
        strategy_name = self.config.strategy.get('_name', 'Sin nombre')
        entry_type = self.config.strategy.get('entry_signal', {}).get('signal_type', '?')
        level_sources = [
            s.get('source', '?') for s in self.config.strategy.get('level_sources', [])
            if s.get('enabled', False)
        ]
        context_filters = [
            f.get('filter_type', '?') for f in self.config.strategy.get('context_filters', [])
            if f.get('enabled', False)
        ]
        exit_rules_list = [
            r.get('rule_type', '?') for r in self.config.strategy.get('exit_rules', [])
            if r.get('enabled', False)
        ]
        risk_cfg = self.config.strategy.get('risk', {})

        logger.info(
            f"[STRAT_RT] Iniciado - {len(self.config.symbols)} simbolos "
            f"@ {self.config.interval}m, ventana={self.config.window_candles}"
        )

        alert_logger.info("=" * 80)
        alert_logger.info(f"SERVICE_STARTED | symbols={self.config.symbols} | interval={self.config.interval}")
        alert_logger.info(f"STRATEGY | name={strategy_name}")
        alert_logger.info(f"ENTRY | signal_type={entry_type}")
        alert_logger.info(f"LEVELS | sources={level_sources}")
        alert_logger.info(f"FILTERS | context={context_filters}")
        alert_logger.info(f"EXIT_RULES | rules={exit_rules_list}")
        alert_logger.info(
            f"RISK | sl_method={risk_cfg.get('sl_method', '?')} "
            f"tp_method={risk_cfg.get('tp_method', '?')} "
            f"max_trades_per_seg={risk_cfg.get('max_trades_per_segment', '?')} "
            f"trailing={risk_cfg.get('trailing_stop', False)}"
        )
        alert_logger.info(
            f"ALERTS | enabled={self.config.alertsEnabled} "
            f"target={self.config.alertTargetUrl} "
            f"cooldown={self.config.cooldownMinutes}min"
        )
        alert_logger.info("=" * 80)

    async def stop(self):
        if not self.running:
            return

        self.running = False

        if self.ws_manager:
            self.ws_manager.remove_candle_close_listener(self._sync_candle_close_handler)

        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None

        logger.info("[STRAT_RT] Detenido")
        alert_logger.info("=" * 80)
        alert_logger.info(
            f"SERVICE_STOPPED | stats={json.dumps(self.stats, default=str)}"
        )
        alert_logger.info("=" * 80)

    # --------------------------------------------------
    # Initialization: load history + pre-compute levels
    # --------------------------------------------------

    async def _initialize(self):
        """Carga historico y pre-calcula niveles para cada simbolo."""
        await asyncio.sleep(1.0)

        for symbol in self.config.symbols:
            try:
                await self._init_symbol(symbol)
            except Exception as e:
                logger.error(f"[STRAT_RT] Error inicializando {symbol}: {e}")

        logger.info("[STRAT_RT] Inicializacion completa para todos los simbolos")

    async def _init_symbol(self, symbol: str):
        """Carga historico + pre-calcula niveles para un simbolo."""
        desired = self.config.window_candles

        # Try WS buffer first
        candles = []
        if self.ws_manager:
            ws_candles = self.ws_manager.get_candles(symbol, self.config.interval)
            if ws_candles:
                for c in ws_candles:
                    if hasattr(c, "timestamp"):
                        candles.append({
                            "timestamp": c.timestamp, "open": c.open,
                            "high": c.high, "low": c.low,
                            "close": c.close, "volume": c.volume,
                        })
                    elif isinstance(c, dict):
                        candles.append(c)

        # Load from API if not enough
        if len(candles) < desired:
            logger.info(f"[STRAT_RT] {symbol}: Buffer WS={len(candles)}, necesita {desired}. Cargando API...")
            api_candles = await self._fetch_from_api(symbol, desired)
            if api_candles:
                candle_map = {c["timestamp"]: c for c in api_candles}
                for c in candles:
                    candle_map[c["timestamp"]] = c
                candles = sorted(candle_map.values(), key=lambda x: x["timestamp"])

        self._candle_buffers[symbol] = candles[-desired:]
        self._candle_count[symbol] = 0

        logger.info(f"[STRAT_RT] {symbol}: {len(self._candle_buffers[symbol])} velas cargadas")

        # Pre-compute all levels
        self._precompute_levels(symbol)

    def _precompute_levels(self, symbol: str):
        """Pre-calcula todos los niveles de la estrategia activa para un simbolo."""
        candles = self._candle_buffers.get(symbol, [])
        if not candles:
            return

        strategy = self.config.strategy
        level_sources = strategy.get('level_sources', [])
        vwap_period = strategy.get('vwap_period', 20)

        t0 = time.time()
        all_levels: List[RTLevel] = []
        dtb_patterns: List[Dict] = []

        # Import strategy_engine functions
        from strategy_engine import (
            compute_vp_levels, compute_sr_levels, compute_vwap_band_levels,
            compute_swing_as_levels, compute_dtb_levels, compute_vp_zone_levels,
            compute_vwap_rolling,
        )

        # Always compute VWAP (needed for filters)
        vwap_data = compute_vwap_rolling(candles, period=vwap_period)
        self._vwap_state[symbol] = {
            'data': vwap_data,
            'period': vwap_period,
        }

        for src in level_sources:
            if not src.get('enabled', False):
                continue

            source_name = src.get('source', '')
            params = src.get('params', {})

            try:
                if source_name == 'vp_periodic':
                    levels = compute_vp_levels(
                        candles,
                        period=params.get('period', 240),
                        bins=params.get('bins', 50),
                        use_poc=params.get('use_poc', True),
                        use_vah=params.get('use_vah', True),
                        use_val=params.get('use_val', True),
                        lookback_segments=params.get('lookback_segments', 1),
                    )
                    for lv in levels:
                        all_levels.append(RTLevel(
                            price=lv.price, level_type=lv.level_type,
                            source=lv.source, strength=lv.strength,
                            valid_from_idx=lv.valid_from_idx,
                            valid_until_idx=lv.valid_until_idx,
                            extra=lv.extra if hasattr(lv, 'extra') else {},
                        ))
                    self._last_vp_seg_end[symbol] = len(candles)

                elif source_name == 'sr_v2':
                    levels = compute_sr_levels(candles, params)
                    for lv in levels:
                        all_levels.append(RTLevel(
                            price=lv.price, level_type=lv.level_type,
                            source=lv.source, strength=lv.strength,
                            valid_from_idx=lv.valid_from_idx,
                            valid_until_idx=lv.valid_until_idx,
                            extra=lv.extra if hasattr(lv, 'extra') else {},
                        ))
                    self._last_sr_recalc[symbol] = len(candles)

                elif source_name == 'vwap_bands':
                    levels = compute_vwap_band_levels(vwap_data)
                    for lv in levels:
                        all_levels.append(RTLevel(
                            price=lv.price, level_type=lv.level_type,
                            source=lv.source, strength=lv.strength,
                            valid_from_idx=lv.valid_from_idx,
                            valid_until_idx=lv.valid_until_idx,
                            extra=lv.extra if hasattr(lv, 'extra') else {},
                        ))

                elif source_name == 'swing_levels':
                    swing_bars = params.get('swing_bars', 5)
                    levels = compute_swing_as_levels(candles, swing_bars)
                    for lv in levels:
                        all_levels.append(RTLevel(
                            price=lv.price, level_type=lv.level_type,
                            source=lv.source, strength=lv.strength,
                            valid_from_idx=lv.valid_from_idx,
                            valid_until_idx=lv.valid_until_idx,
                            extra=lv.extra if hasattr(lv, 'extra') else {},
                        ))
                    self._last_swing_check[symbol] = len(candles)

                elif source_name == 'dtb_neckline':
                    dtb_lvls, dtb_pats = compute_dtb_levels(candles, params)
                    for lv in dtb_lvls:
                        all_levels.append(RTLevel(
                            price=lv.price, level_type=lv.level_type,
                            source=lv.source, strength=lv.strength,
                            valid_from_idx=lv.valid_from_idx,
                            valid_until_idx=lv.valid_until_idx,
                            extra=lv.extra if hasattr(lv, 'extra') else {},
                        ))
                    dtb_patterns = dtb_pats
                    self._last_dtb_recalc[symbol] = len(candles)

                elif source_name == 'vp_zones':
                    vpz_levels, _ = compute_vp_zone_levels(
                        candles, params, symbol=symbol,
                        interval=self.config.interval,
                        days=self.config.window_candles // 1440 or 1,
                    )
                    for lv in vpz_levels:
                        all_levels.append(RTLevel(
                            price=lv.price, level_type=lv.level_type,
                            source=lv.source, strength=lv.strength,
                            valid_from_idx=lv.valid_from_idx,
                            valid_until_idx=lv.valid_until_idx,
                            extra=lv.extra if hasattr(lv, 'extra') else {},
                        ))

            except Exception as e:
                logger.error(f"[STRAT_RT] {symbol}: Error calculando {source_name}: {e}")

        self._levels[symbol] = all_levels
        self._dtb_patterns[symbol] = dtb_patterns

        elapsed = time.time() - t0
        logger.info(
            f"[STRAT_RT] {symbol}: Pre-calculo completado: {len(all_levels)} niveles, "
            f"{len(dtb_patterns)} DTB patterns en {elapsed:.1f}s"
        )

    # --------------------------------------------------
    # Incremental level updates
    # --------------------------------------------------

    def _update_levels_incremental(self, symbol: str, new_candle: Dict):
        """Actualiza niveles incrementalmente cuando toca recalcular."""
        candles = self._candle_buffers.get(symbol, [])
        n = len(candles)
        count = self._candle_count.get(symbol, 0)
        strategy = self.config.strategy
        level_sources = strategy.get('level_sources', [])

        from strategy_engine import (
            compute_vp_levels, compute_sr_levels, compute_vwap_band_levels,
            compute_swing_as_levels, compute_dtb_levels, compute_vwap_rolling,
        )

        for src in level_sources:
            if not src.get('enabled', False):
                continue

            source_name = src.get('source', '')
            params = src.get('params', {})

            try:
                # VP Periodic: new segment when candle count crosses period boundary
                if source_name == 'vp_periodic':
                    period = params.get('period', 240)
                    last_end = self._last_vp_seg_end.get(symbol, 0)
                    if n >= last_end + period:
                        # New segment available - compute VP for the new segment
                        seg_candles = candles[last_end:last_end + period]
                        if len(seg_candles) >= period:
                            from backtest_vp_periodic import compute_volume_profile
                            vp = compute_volume_profile(seg_candles, params.get('bins', 50))
                            poc = vp.get('poc_price', 0)
                            vah = vp.get('vah', 0)
                            val_ = vp.get('val', 0)

                            new_end = last_end + period
                            next_end = new_end + period

                            if params.get('use_poc', True) and poc:
                                self._levels[symbol].append(RTLevel(
                                    price=poc, level_type='support',
                                    source='vp_periodic', strength=1.0,
                                    valid_from_idx=new_end,
                                    valid_until_idx=next_end,
                                    extra={'level_label': 'POC', 'seg_start_idx': last_end},
                                ))
                            if params.get('use_vah', True) and vah:
                                self._levels[symbol].append(RTLevel(
                                    price=vah, level_type='resistance',
                                    source='vp_periodic', strength=0.8,
                                    valid_from_idx=new_end,
                                    valid_until_idx=next_end,
                                    extra={'level_label': 'VAH', 'seg_start_idx': last_end},
                                ))
                            if params.get('use_val', True) and val_:
                                self._levels[symbol].append(RTLevel(
                                    price=val_, level_type='support',
                                    source='vp_periodic', strength=0.8,
                                    valid_from_idx=new_end,
                                    valid_until_idx=next_end,
                                    extra={'level_label': 'VAL', 'seg_start_idx': last_end},
                                ))

                            self._last_vp_seg_end[symbol] = new_end
                            logger.info(
                                f"[STRAT_RT] {symbol}: Nuevo segmento VP #{new_end // period}: "
                                f"POC={poc:.2f} VAH={vah:.2f} VAL={val_:.2f}"
                            )

                # S&R v2: recalculate periodically
                elif source_name == 'sr_v2':
                    recalc_every = self.config.sr_recalc_every
                    last_recalc = self._last_sr_recalc.get(symbol, 0)
                    if n >= last_recalc + recalc_every:
                        # Remove old sr_v2 levels
                        self._levels[symbol] = [
                            lv for lv in self._levels[symbol]
                            if lv.source != 'sr_v2'
                        ]
                        # Recalculate
                        new_levels = compute_sr_levels(candles, params)
                        for lv in new_levels:
                            self._levels[symbol].append(RTLevel(
                                price=lv.price, level_type=lv.level_type,
                                source=lv.source, strength=lv.strength,
                                valid_from_idx=lv.valid_from_idx,
                                valid_until_idx=lv.valid_until_idx,
                                extra=lv.extra if hasattr(lv, 'extra') else {},
                            ))
                        self._last_sr_recalc[symbol] = n
                        logger.info(f"[STRAT_RT] {symbol}: SR v2 recalculado: {len(new_levels)} niveles")

                # VWAP bands: update every candle (O(1) per level)
                elif source_name == 'vwap_bands':
                    vwap_data = self._vwap_state.get(symbol, {}).get('data', [])
                    if n <= len(vwap_data) and n > 0:
                        vw = vwap_data[n - 1]
                        vwap_val = vw.get('vwap', 0)
                        upper1 = vw.get('upper_1', 0)
                        lower1 = vw.get('lower_1', 0)
                        upper2 = vw.get('upper_2', 0)
                        lower2 = vw.get('lower_2', 0)
                        # Add levels valid only for this candle
                        for price, lt, label in [
                            (vwap_val, 'support', 'VWAP'),
                            (upper1, 'resistance', '+1s'),
                            (lower1, 'support', '-1s'),
                            (upper2, 'resistance', '+2s'),
                            (lower2, 'support', '-2s'),
                        ]:
                            if price:
                                self._levels[symbol].append(RTLevel(
                                    price=price, level_type=lt,
                                    source='vwap_bands', strength=0.6,
                                    valid_from_idx=n - 1,
                                    valid_until_idx=n,
                                    extra={'level_label': label},
                                ))

                # Swing levels: check if new swing confirmed
                elif source_name == 'swing_levels':
                    swing_bars = params.get('swing_bars', 5)
                    if n > swing_bars * 2:
                        pivot_idx = n - 1 - swing_bars
                        if pivot_idx > 0:
                            pivot_candle = candles[pivot_idx]
                            # Check swing high
                            is_high = True
                            for j in range(1, swing_bars + 1):
                                if pivot_idx - j < 0 or pivot_idx + j >= n:
                                    is_high = False
                                    break
                                if (candles[pivot_idx - j]['high'] >= pivot_candle['high'] or
                                        candles[pivot_idx + j]['high'] >= pivot_candle['high']):
                                    is_high = False
                                    break
                            if is_high:
                                self._levels[symbol].append(RTLevel(
                                    price=pivot_candle['high'],
                                    level_type='resistance',
                                    source='swing_levels', strength=0.7,
                                    valid_from_idx=n - 1,
                                    valid_until_idx=None,
                                    extra={'swing_type': 'high'},
                                ))

                            # Check swing low
                            is_low = True
                            for j in range(1, swing_bars + 1):
                                if pivot_idx - j < 0 or pivot_idx + j >= n:
                                    is_low = False
                                    break
                                if (candles[pivot_idx - j]['low'] <= pivot_candle['low'] or
                                        candles[pivot_idx + j]['low'] <= pivot_candle['low']):
                                    is_low = False
                                    break
                            if is_low:
                                self._levels[symbol].append(RTLevel(
                                    price=pivot_candle['low'],
                                    level_type='support',
                                    source='swing_levels', strength=0.7,
                                    valid_from_idx=n - 1,
                                    valid_until_idx=None,
                                    extra={'swing_type': 'low'},
                                ))

                # DTB: recalculate periodically
                elif source_name == 'dtb_neckline':
                    recalc_every = self.config.dtb_recalc_every
                    last_recalc = self._last_dtb_recalc.get(symbol, 0)
                    if n >= last_recalc + recalc_every:
                        # Remove old dtb_neckline levels
                        self._levels[symbol] = [
                            lv for lv in self._levels[symbol]
                            if lv.source != 'dtb_neckline'
                        ]
                        dtb_lvls, dtb_pats = compute_dtb_levels(candles, params)
                        for lv in dtb_lvls:
                            self._levels[symbol].append(RTLevel(
                                price=lv.price, level_type=lv.level_type,
                                source=lv.source, strength=lv.strength,
                                valid_from_idx=lv.valid_from_idx,
                                valid_until_idx=lv.valid_until_idx,
                                extra=lv.extra if hasattr(lv, 'extra') else {},
                            ))
                        self._dtb_patterns[symbol] = dtb_pats
                        self._last_dtb_recalc[symbol] = n
                        logger.info(
                            f"[STRAT_RT] {symbol}: DTB recalculado: "
                            f"{len(dtb_lvls)} niveles, {len(dtb_pats)} patrones"
                        )

            except Exception as e:
                logger.error(f"[STRAT_RT] {symbol}: Error incremental {source_name}: {e}")

    def _update_vwap_incremental(self, symbol: str):
        """Recalcula VWAP rolling con el buffer actual."""
        candles = self._candle_buffers.get(symbol, [])
        if not candles:
            return

        vwap_period = self.config.strategy.get('vwap_period', 20)

        from strategy_engine import compute_vwap_rolling
        vwap_data = compute_vwap_rolling(candles, period=vwap_period)
        self._vwap_state[symbol] = {
            'data': vwap_data,
            'period': vwap_period,
        }

    # --------------------------------------------------
    # Candle close handler
    # --------------------------------------------------

    def _sync_candle_close_handler(self, symbol: str, interval: str, candle):
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._on_candle_close(symbol, interval, candle))
        except RuntimeError:
            try:
                loop = asyncio.get_event_loop()
                loop.create_task(self._on_candle_close(symbol, interval, candle))
            except Exception as e:
                logger.error(f"[STRAT_RT] Error scheduling handler: {e}")

    async def _on_candle_close(self, symbol: str, interval: str, candle):
        if not self.running or not self.config.enabled:
            return
        if symbol not in self.config.symbols:
            return
        if interval != self.config.interval:
            return

        # Convert candle to dict
        if hasattr(candle, "timestamp"):
            candle_dict = {
                "timestamp": candle.timestamp, "open": candle.open,
                "high": candle.high, "low": candle.low,
                "close": candle.close, "volume": candle.volume,
            }
        elif isinstance(candle, dict):
            candle_dict = candle
        else:
            return

        candle_ts = candle_dict.get("timestamp", 0)
        self.stats["candles_processed"] += 1

        # Add to buffer (deduplicate)
        buffer = self._candle_buffers.get(symbol, [])
        if buffer and buffer[-1]["timestamp"] >= candle_ts:
            if buffer[-1]["timestamp"] == candle_ts:
                buffer[-1] = candle_dict
            return
        buffer.append(candle_dict)

        # Sliding window
        max_size = self.config.window_candles + 200
        if len(buffer) > max_size:
            buffer = buffer[-self.config.window_candles:]
        self._candle_buffers[symbol] = buffer

        # Wait for enough candles
        if len(buffer) < 50:
            return

        self._candle_count[symbol] = self._candle_count.get(symbol, 0) + 1
        n = len(buffer)
        count = self._candle_count[symbol]

        from datetime import datetime as _dt
        ts_str = _dt.fromtimestamp(candle_ts / 1000).strftime('%H:%M:%S') if candle_ts else '?'
        close_price = candle_dict.get('close', 0)

        # Log every candle to alert_logger for traceability
        alert_logger.info(
            f"CANDLE_CLOSE | {symbol} | #{count} | {ts_str} | "
            f"O={candle_dict.get('open', 0):.2f} H={candle_dict.get('high', 0):.2f} "
            f"L={candle_dict.get('low', 0):.2f} C={close_price:.2f} V={candle_dict.get('volume', 0):.0f}"
        )

        # Step 1: Update VWAP
        self._update_vwap_incremental(symbol)

        # Step 2: Update levels incrementally
        self._update_levels_incremental(symbol, candle_dict)

        # Step 3: Monitor open trades (SL/TP)
        self._check_open_trades(symbol, candle_dict)

        # Step 4: Evaluate entry signal
        await self._evaluate_entry(symbol, candle_dict, n - 1)

        # Log summary every candle to alert_logger (concise) and every 10 to main logger
        open_count = len(self._open_trades.get(symbol, []))
        active_levels = sum(1 for lv in self._levels.get(symbol, [])
                            if lv.valid_from_idx <= n - 1 and
                            (lv.valid_until_idx is None or lv.valid_until_idx >= n - 1))

        alert_logger.info(
            f"SUMMARY | {symbol} | #{count} | niveles_activos={active_levels} | "
            f"open_trades={open_count} | signals={self.stats['signals_generated']} | "
            f"filtered={self.stats['signals_filtered']} | alerts_sent={self.stats['alerts_sent']} | "
            f"cooldown_blocked={self.stats['alerts_blocked_cooldown']}"
        )

        if count % 10 == 0:
            logger.info(
                f"[STRAT_RT] {symbol} @ {ts_str}: vela #{count} | "
                f"niveles_activos={active_levels} | open_trades={open_count} | "
                f"signals={self.stats['signals_generated']} | filtered={self.stats['signals_filtered']} | "
                f"alerts_sent={self.stats['alerts_sent']}"
            )

    # --------------------------------------------------
    # Open trade monitoring (SL/TP hit)
    # --------------------------------------------------

    def _check_open_trades(self, symbol: str, candle: Dict):
        """Verifica SL/TP de trades abiertos con la nueva vela."""
        open_trades = self._open_trades.get(symbol, [])
        if not open_trades:
            return

        high = candle.get("high", 0)
        low = candle.get("low", 0)
        close = candle.get("close", 0)
        open_price = candle.get("open", 0)

        resolved = []
        for trade in open_trades:
            direction = trade.get("direction", "")
            entry_price = trade.get("entry_price", 0)
            sl_price = trade.get("sl_price", 0)
            tp_price = trade.get("tp_price", 0)

            if not entry_price or not sl_price or not tp_price:
                continue

            if direction == "LONG":
                tp_hit = high >= tp_price
                sl_hit = low <= sl_price
            else:
                tp_hit = low <= tp_price
                sl_hit = high >= sl_price

            if tp_hit and sl_hit:
                result = "WIN" if (close >= open_price if direction == "LONG" else close <= open_price) else "LOSS"
            elif tp_hit:
                result = "WIN"
            elif sl_hit:
                result = "LOSS"
            else:
                # Update partial PnL
                if direction == "LONG":
                    risk = abs(entry_price - sl_price)
                    trade["partial_pnl_r"] = round((close - entry_price) / risk, 2) if risk else 0
                else:
                    risk = abs(sl_price - entry_price)
                    trade["partial_pnl_r"] = round((entry_price - close) / risk, 2) if risk else 0

                # Log open trade monitoring
                alert_logger.info(
                    f"TRADE_MONITOR | {symbol} | {direction} | OPEN | "
                    f"entry={entry_price:.2f} sl={sl_price:.2f} tp={tp_price:.2f} | "
                    f"close={close:.2f} partial_pnl_r={trade['partial_pnl_r']} | "
                    f"sl_dist={abs(close - sl_price):.2f} tp_dist={abs(tp_price - close):.2f}"
                )
                continue

            # Trade resolved
            risk = abs(entry_price - sl_price) if entry_price != sl_price else 1
            if result == "WIN":
                pnl_r = round(abs(tp_price - entry_price) / risk, 2)
            else:
                pnl_r = -1.0

            trade["result"] = result
            trade["pnl_r"] = pnl_r
            trade["close_ts"] = candle["timestamp"]
            resolved.append(trade)

            self.stats["trades_closed"] += 1

            alert_logger.info(
                f"TRADE_CLOSED | {symbol} | {direction} | {result} | "
                f"pnl_r={pnl_r} | entry={entry_price:.2f} sl={sl_price:.2f} tp={tp_price:.2f} | "
                f"close_price={close:.2f}"
            )

        # Move resolved trades to history
        if resolved:
            history = self._trade_history.setdefault(symbol, [])
            for t in resolved:
                history.append(t)

            self._open_trades[symbol] = [
                t for t in open_trades if t not in resolved
            ]

    # --------------------------------------------------
    # Check exit rules for open trades
    # --------------------------------------------------

    def _check_exit_rules(self, symbol: str, candle: Dict, idx: int):
        """Verifica exit rules para trades abiertos."""
        open_trades = self._open_trades.get(symbol, [])
        if not open_trades:
            return

        strategy = self.config.strategy
        exit_rules = [r for r in strategy.get('exit_rules', []) if r.get('enabled', False)]
        if not exit_rules:
            return

        alert_logger.info(
            f"EXIT_RULES_CHECK | {symbol} | open_trades={len(open_trades)} | "
            f"exit_rules={[r.get('rule_type', '?') for r in exit_rules]}"
        )

        candles = self._candle_buffers.get(symbol, [])
        vwap_data = self._vwap_state.get(symbol, {}).get('data', [])

        from strategy_engine import check_exit_rules

        resolved_by_rule = []
        for trade in open_trades:
            direction = trade.get("direction", "")
            entry_idx = trade.get("entry_idx", 0)
            entry_price = trade.get("entry_price", 0)
            sl_price = trade.get("sl_price", 0)
            level_price = trade.get("level_price", 0)

            should_exit = check_exit_rules(
                candles, entry_idx, idx, direction,
                vwap_data, exit_rules, level_price
            )
            if should_exit:
                close_price = candle.get("close", 0)
                risk = abs(entry_price - sl_price) if entry_price != sl_price else 1
                if direction == "LONG":
                    pnl_r = round((close_price - entry_price) / risk, 2)
                else:
                    pnl_r = round((entry_price - close_price) / risk, 2)

                result = "WIN" if pnl_r > 0 else "LOSS"
                trade["result"] = result
                trade["pnl_r"] = pnl_r
                trade["close_ts"] = candle["timestamp"]
                trade["exit_reason"] = "exit_rule"
                resolved_by_rule.append(trade)

                self.stats["trades_closed"] += 1
                alert_logger.info(
                    f"TRADE_EXIT_RULE | {symbol} | {direction} | {result} | "
                    f"pnl_r={pnl_r} | entry={entry_price:.2f}"
                )

        if resolved_by_rule:
            history = self._trade_history.setdefault(symbol, [])
            for t in resolved_by_rule:
                history.append(t)
            self._open_trades[symbol] = [
                t for t in open_trades if t not in resolved_by_rule
            ]

    # --------------------------------------------------
    # Entry signal evaluation
    # --------------------------------------------------

    async def _evaluate_entry(self, symbol: str, candle: Dict, idx: int):
        """Evalua si la vela actual genera una senal de entrada."""
        strategy = self.config.strategy
        if not strategy:
            return

        candles = self._candle_buffers.get(symbol, [])
        all_levels = self._levels.get(symbol, [])
        dtb_patterns = self._dtb_patterns.get(symbol, [])
        vwap_data = self._vwap_state.get(symbol, {}).get('data', [])

        entry_cfg = strategy.get('entry_signal', {})
        signal_type = entry_cfg.get('signal_type', 'price_touch')
        signal_params = entry_cfg.get('params', {})
        context_filters = strategy.get('context_filters', [])
        risk_cfg = strategy.get('risk', {})
        exit_rules = strategy.get('exit_rules', [])
        confluence_mode = strategy.get('confluence_mode', 'any')
        min_confluence = strategy.get('min_confluence_score', 0)

        # Check exit rules first for open trades
        self._check_exit_rules(symbol, candle, idx)

        # Build Level-compatible objects for strategy_engine functions
        from strategy_engine import (
            Level,
            signal_price_touch, signal_swing_confirm, signal_breakout_close,
            signal_rejection_candle, signal_pattern_match, signal_squeeze_release,
            signal_cvd_divergence, signal_dtb_confirm,
            filter_direction, filter_vwap_trend, filter_vwap_position,
            filter_ttm_squeeze, filter_bbwp_range, filter_volume_zscore,
            filter_cvd_trend, filter_dtb_bias, filter_vp_shape,
            compute_confluence_score, compute_sl, compute_tp,
        )

        # Convert RTLevel to Level objects for compatibility
        active_levels = []
        for lv in all_levels:
            if lv.valid_from_idx <= idx and (lv.valid_until_idx is None or lv.valid_until_idx >= idx):
                active_levels.append(Level(
                    price=lv.price, level_type=lv.level_type,
                    source=lv.source, strength=lv.strength,
                    valid_from_idx=lv.valid_from_idx,
                    valid_until_idx=lv.valid_until_idx,
                    extra=lv.extra,
                ))

        if not active_levels:
            alert_logger.info(
                f"EVAL_ENTRY | {symbol} | idx={idx} | NO_ACTIVE_LEVELS | "
                f"total_levels={len(all_levels)}"
            )
            return

        # Generate signal
        signal = None
        if signal_type == 'price_touch':
            signal = signal_price_touch(candles, idx, active_levels,
                                         tolerance_pct=signal_params.get('tolerance_pct', 0.1))
        elif signal_type == 'swing_confirm':
            signal = signal_swing_confirm(candles, idx, active_levels,
                                           swing_bars=signal_params.get('swing_bars', 3),
                                           tolerance_pct=signal_params.get('tolerance_pct', 0.3))
        elif signal_type == 'breakout_close':
            signal = signal_breakout_close(candles, idx, active_levels,
                                            confirm_bars=signal_params.get('confirm_bars', 2),
                                            tolerance_pct=signal_params.get('tolerance_pct', 0.1))
        elif signal_type == 'rejection_candle':
            signal = signal_rejection_candle(candles, idx, active_levels,
                                              wick_ratio=signal_params.get('wick_ratio', 0.6),
                                              tolerance_pct=signal_params.get('tolerance_pct', 0.2))
        elif signal_type == 'pattern_match':
            signal = signal_pattern_match(candles, idx, active_levels,
                                           pattern_type=signal_params.get('pattern_type', 'hammer'),
                                           min_confidence=signal_params.get('min_confidence', 50),
                                           tolerance_pct=signal_params.get('tolerance_pct', 0.5))
        elif signal_type == 'squeeze_release':
            signal = signal_squeeze_release(vwap_data, idx, active_levels)
        elif signal_type == 'cvd_divergence':
            signal = signal_cvd_divergence(candles, idx, active_levels,
                                            lookback=signal_params.get('lookback', 20))
        elif signal_type == 'dtb_confirm':
            signal = signal_dtb_confirm(dtb_patterns, idx, candles,
                                         lookback=signal_params.get('lookback', 50),
                                         min_confidence=signal_params.get('min_confidence', 50))

        if signal is None or not signal.get('triggered'):
            alert_logger.info(
                f"EVAL_ENTRY | {symbol} | idx={idx} | NO_SIGNAL | "
                f"signal_type={signal_type} | active_levels={len(active_levels)} | "
                f"close={candle.get('close', 0):.2f}"
            )
            return

        direction = signal['direction']
        self.stats['signals_generated'] += 1

        alert_logger.info(
            f"SIGNAL_GENERATED | {symbol} | {direction} | {signal_type} | "
            f"entry_price={signal.get('entry_price', 0):.2f} | "
            f"level_source={signal.get('level_source', '')} | "
            f"level_price={signal.get('level_price', 0):.2f} | "
            f"active_levels={len(active_levels)}"
        )

        # ====== CHEAP CHECKS FIRST (cooldown + existing trade) ======

        # Check cooldown BEFORE expensive filters/SL/TP
        cooldown_key = f"{symbol}_{direction}"
        now = time.time()
        if self._cooldowns.get(cooldown_key, 0) > now:
            remaining = int(self._cooldowns[cooldown_key] - now)
            self.stats['alerts_blocked_cooldown'] += 1
            alert_logger.info(
                f"BLOCKED_COOLDOWN | {symbol} | {direction} | remaining={remaining}s"
            )
            return

        # Check if we already have an open trade in same direction
        open_trades = self._open_trades.get(symbol, [])
        if open_trades:
            same_dir = [t for t in open_trades if t.get('direction') == direction]
            if same_dir:
                alert_logger.info(
                    f"SIGNAL_BLOCKED | {symbol} | {direction} | EXISTING_TRADE | "
                    f"open_trades={len(open_trades)} same_dir={len(same_dir)}"
                )
                return  # Already have a trade in this direction

        # ====== FILTERS (direction, confluence, context) ======

        # Resolve trigger_level
        trigger_level = None
        sig_source = signal.get('level_source', '')
        sig_price = signal.get('level_price', 0)
        if sig_source and sig_price:
            for lv in active_levels:
                if (lv.source == sig_source and
                        abs(lv.price - sig_price) < 0.01):
                    trigger_level = lv
                    break
        signal['trigger_level'] = trigger_level

        # Direction filter
        allowed_direction = 'both'
        for f in context_filters:
            if f.get('filter_type') == 'direction' and f.get('enabled'):
                allowed_direction = f.get('params', {}).get('allowed', 'both')

        if not filter_direction(direction, allowed_direction):
            self.stats['signals_filtered'] += 1
            alert_logger.info(
                f"SIGNAL_FILTERED | {symbol} | {direction} | DIRECTION_FILTER | "
                f"allowed={allowed_direction}"
            )
            return

        # Confluence check
        if confluence_mode == 'score' and min_confluence > 0:
            score = compute_confluence_score(active_levels, idx, signal['entry_price'])
            if score < min_confluence:
                self.stats['signals_filtered'] += 1
                alert_logger.info(
                    f"SIGNAL_FILTERED | {symbol} | {direction} | CONFLUENCE_SCORE | "
                    f"score={score} < min={min_confluence}"
                )
                return

        # Context filters (AND logic)
        for f in context_filters:
            if not f.get('enabled', False):
                continue
            ft = f.get('filter_type', '')
            fp = f.get('params', {})
            passed = True

            if ft == 'vwap_trend':
                passed = filter_vwap_trend(vwap_data, idx, direction,
                                            lookback=fp.get('lookback', 10),
                                            min_diff_pct=fp.get('min_diff_pct', 0))
            elif ft == 'vwap_position':
                passed = filter_vwap_position(candles, vwap_data, idx, direction,
                                               mode=fp.get('mode', 'trend'),
                                               long_ref=fp.get('long_ref', 'vwap'),
                                               short_ref=fp.get('short_ref', 'vwap'),
                                               reference=fp.get('reference', ''))
            elif ft == 'ttm_squeeze':
                passed = filter_ttm_squeeze(vwap_data, idx,
                                             require_squeeze=fp.get('require_squeeze', True))
            elif ft == 'bbwp_range':
                passed = filter_bbwp_range(vwap_data, idx,
                                            min_val=fp.get('min_val', fp.get('min', 0)),
                                            max_val=fp.get('max_val', fp.get('max', 100)))
            elif ft == 'volume_zscore':
                passed = filter_volume_zscore(candles, idx,
                                               min_zscore=fp.get('min_zscore', 1.5),
                                               lookback=fp.get('lookback', 20))
            elif ft == 'cvd_trend':
                passed = filter_cvd_trend(candles, idx, direction,
                                           lookback=fp.get('lookback', 20))
            elif ft == 'dtb_bias':
                passed = filter_dtb_bias(dtb_patterns, idx, direction,
                                          lookback=fp.get('lookback', 50),
                                          min_confidence=fp.get('min_confidence', 50))
            elif ft == 'vp_shape':
                allowed_shapes = fp.get('allowed_shapes', ['all'])
                if isinstance(allowed_shapes, str):
                    allowed_shapes = [allowed_shapes]
                tl = signal.get('trigger_level')
                if tl:
                    passed = filter_vp_shape(tl, allowed_shapes)

            if not passed:
                self.stats['signals_filtered'] += 1
                alert_logger.info(
                    f"SIGNAL_FILTERED | {symbol} | {direction} | CONTEXT_FILTER:{ft} | "
                    f"params={json.dumps(fp, default=str)}"
                )
                return

        alert_logger.info(
            f"SIGNAL_PASSED_ALL_FILTERS | {symbol} | {direction} | "
            f"entry={signal['entry_price']:.2f} | computing SL/TP..."
        )

        # ====== COMPUTE SL/TP (expensive) ======

        entry_price = signal['entry_price']
        level_price = signal['level_price']

        sl_price = compute_sl(candles, idx, entry_price, direction, level_price,
                               active_levels, risk_cfg, signal)
        if sl_price is None:
            alert_logger.info(
                f"SIGNAL_REJECTED | {symbol} | {direction} | SL_NONE | "
                f"entry={entry_price:.2f} | sl_method={risk_cfg.get('sl_method', '?')}"
            )
            return
        if direction == 'LONG' and sl_price >= entry_price:
            alert_logger.info(
                f"SIGNAL_REJECTED | {symbol} | {direction} | SL_ABOVE_ENTRY | "
                f"entry={entry_price:.2f} sl={sl_price:.2f}"
            )
            return
        if direction == 'SHORT' and sl_price <= entry_price:
            alert_logger.info(
                f"SIGNAL_REJECTED | {symbol} | {direction} | SL_BELOW_ENTRY | "
                f"entry={entry_price:.2f} sl={sl_price:.2f}"
            )
            return

        # Compute TP
        tp_price = compute_tp(candles, idx, entry_price, sl_price, direction,
                               active_levels, risk_cfg)
        if tp_price is None:
            alert_logger.info(
                f"SIGNAL_REJECTED | {symbol} | {direction} | TP_NONE | "
                f"entry={entry_price:.2f} sl={sl_price:.2f} | tp_method={risk_cfg.get('tp_method', '?')}"
            )
            return

        alert_logger.info(
            f"SIGNAL_SL_TP_COMPUTED | {symbol} | {direction} | "
            f"entry={entry_price:.2f} sl={sl_price:.2f} tp={tp_price:.2f} | "
            f"risk={abs(entry_price - sl_price):.2f} reward={abs(tp_price - entry_price):.2f} | "
            f"RR={abs(tp_price - entry_price) / abs(entry_price - sl_price):.2f}"
        )

        # Register trade
        trade = {
            "symbol": symbol,
            "direction": direction,
            "entry_price": entry_price,
            "sl_price": sl_price,
            "tp_price": tp_price,
            "level_price": level_price,
            "level_source": signal.get('level_source', ''),
            "signal_type": signal_type,
            "entry_ts": candle["timestamp"],
            "entry_idx": idx,
            "result": "OPEN",
            "pnl_r": 0,
            "partial_pnl_r": 0,
        }

        self._open_trades.setdefault(symbol, []).append(trade)
        self.stats['trades_opened'] += 1

        # Set cooldown
        self._cooldowns[cooldown_key] = now + self.config.cooldownMinutes * 60

        # Store signal for frontend
        sig_record = {
            "timestamp": candle["timestamp"],
            "symbol": symbol,
            "direction": direction,
            "entry_price": entry_price,
            "sl_price": sl_price,
            "tp_price": tp_price,
            "level_source": signal.get('level_source', ''),
            "signal_type": signal_type,
        }
        self._recent_signals.setdefault(symbol, []).append(sig_record)
        # Keep last 50 signals
        if len(self._recent_signals[symbol]) > 50:
            self._recent_signals[symbol] = self._recent_signals[symbol][-50:]

        from datetime import datetime as _dt2
        ts_str2 = _dt2.fromtimestamp(candle["timestamp"] / 1000).strftime('%Y-%m-%d %H:%M:%S') if candle.get("timestamp") else '?'

        alert_logger.info(
            f">>> TRADE_OPENED | {symbol} | {direction} | {signal_type} | "
            f"entry={entry_price:.2f} sl={sl_price:.2f} tp={tp_price:.2f} | "
            f"level_src={signal.get('level_source', '')} level_price={level_price:.2f} | "
            f"candle_time={ts_str2} | "
            f"cooldown_until={_dt2.fromtimestamp(self._cooldowns[cooldown_key]).strftime('%H:%M:%S')} | "
            f"total_trades_opened={self.stats['trades_opened']}"
        )

        # Send alert to TradingBot
        if self.config.alertsEnabled:
            alert_logger.info(
                f"SENDING_ALERT | {symbol} | {direction} | target={self.config.alertTargetUrl}"
            )
            sent = await self._send_alert(symbol, trade)
            alert_logger.info(
                f"ALERT_RESULT | {symbol} | {direction} | sent={'OK' if sent else 'FAILED'} | "
                f"alerts_sent_total={self.stats['alerts_sent']}"
            )
        else:
            alert_logger.info(
                f"ALERT_SKIPPED | {symbol} | {direction} | alertsEnabled=false"
            )

    # --------------------------------------------------
    # Send alert to TradingBot
    # --------------------------------------------------

    async def _send_alert(self, symbol: str, trade: Dict) -> bool:
        """Envia alerta al TradingBot via HTTP POST."""
        if not self._http_client:
            return False

        direction = trade["direction"]
        entry_price = trade["entry_price"]
        sl_price = trade["sl_price"]
        tp_price = trade["tp_price"]

        sl_distance = abs(entry_price - sl_price)
        tp_distance = abs(tp_price - entry_price)

        payload = {
            "source": "STRATEGY_BUILDER",
            "symbol": symbol,
            "interval": self.config.interval,
            "pattern": {
                "patternType": f"SB_{trade.get('signal_type', 'unknown').upper()}",
                "price": float(entry_price),
                "confidence": 75,
                "direction": direction,
            },
            "sl_distance": round(sl_distance, 2),
            "tp_distance": round(tp_distance, 2),
        }

        try:
            alert_logger.info(
                f"ALERT_HTTP_REQUEST | {symbol} | {direction} | "
                f"url={self.config.alertTargetUrl} | "
                f"payload={json.dumps(payload, default=str)}"
            )
            response = await self._http_client.post(
                self.config.alertTargetUrl, json=payload,
            )
            if response.status_code == 200:
                result = response.json()
                success = result.get("success", False)
                if success:
                    self.stats['alerts_sent'] += 1
                    alert_logger.info(
                        f"ALERT_SENT_OK | {symbol} | {direction} | "
                        f"entry={entry_price:.2f} sl={sl_price:.2f} tp={tp_price:.2f} | "
                        f"response={json.dumps(result, default=str)[:200]}"
                    )
                else:
                    reason = result.get("message", result.get("detail", "unknown"))
                    alert_logger.info(
                        f"ALERT_REJECTED_BY_BOT | {symbol} | {direction} | "
                        f"reason={reason} | response={json.dumps(result, default=str)[:200]}"
                    )
                return success
            else:
                resp_text = response.text[:200] if response.text else ''
                alert_logger.error(
                    f"ALERT_HTTP_ERROR | {symbol} | {direction} | "
                    f"status={response.status_code} | body={resp_text}"
                )
                return False
        except httpx.ConnectError:
            alert_logger.error(
                f"ALERT_CONNECT_ERROR | {symbol} | {direction} | "
                f"TradingBot no disponible en {self.config.alertTargetUrl}"
            )
            return False
        except httpx.TimeoutException:
            alert_logger.error(
                f"ALERT_TIMEOUT | {symbol} | {direction} | "
                f"url={self.config.alertTargetUrl} timeout=15s"
            )
            return False
        except Exception as e:
            alert_logger.error(
                f"ALERT_EXCEPTION | {symbol} | {direction} | "
                f"error={type(e).__name__}: {str(e)}"
            )
            return False

    # --------------------------------------------------
    # API fetch
    # --------------------------------------------------

    async def _fetch_from_api(self, symbol: str, desired_candles: int) -> List[Dict]:
        """Fetch velas historicas desde Bybit API."""
        if not self._http_client:
            return []

        all_candles = []
        limit = 1000
        end_time = int(time.time() * 1000)
        requests_made = 0
        max_requests = max(3, desired_candles // 1000 + 1)
        max_requests = min(max_requests, 20)

        while len(all_candles) < desired_candles and requests_made < max_requests:
            try:
                url = (
                    f"{BYBIT_API_URL}?category=linear&symbol={symbol}"
                    f"&interval={self.config.interval}&limit={limit}&end={end_time}"
                )
                response = await self._http_client.get(url)
                if response.status_code != 200:
                    break

                data = response.json()
                result_list = data.get("result", {}).get("list", [])
                if not result_list:
                    break

                batch = []
                for item in result_list:
                    batch.append({
                        "timestamp": int(item[0]),
                        "open": float(item[1]),
                        "high": float(item[2]),
                        "low": float(item[3]),
                        "close": float(item[4]),
                        "volume": float(item[5]),
                    })

                batch.sort(key=lambda x: x["timestamp"])
                all_candles = batch + all_candles

                end_time = batch[0]["timestamp"] - 1
                requests_made += 1

                if len(result_list) < limit:
                    break

                await asyncio.sleep(0.1)

            except Exception as e:
                logger.error(f"[STRAT_RT] API fetch error {symbol}: {e}")
                break

        seen = set()
        unique = []
        for c in all_candles:
            if c["timestamp"] not in seen:
                seen.add(c["timestamp"])
                unique.append(c)

        unique.sort(key=lambda x: x["timestamp"])
        return unique[-desired_candles:]

    # --------------------------------------------------
    # Public API methods (called from endpoints)
    # --------------------------------------------------

    def get_status(self) -> Dict:
        """Retorna estado del servicio para el frontend."""
        open_trades_summary = {}
        for sym, trades in self._open_trades.items():
            open_trades_summary[sym] = [{
                "direction": t.get("direction"),
                "entry_price": t.get("entry_price"),
                "sl_price": t.get("sl_price"),
                "tp_price": t.get("tp_price"),
                "partial_pnl_r": t.get("partial_pnl_r", 0),
                "entry_ts": t.get("entry_ts"),
            } for t in trades]

        levels_summary = {}
        for sym, levels in self._levels.items():
            n = len(self._candle_buffers.get(sym, []))
            active_count = sum(1 for lv in levels
                               if lv.valid_from_idx <= n and
                               (lv.valid_until_idx is None or lv.valid_until_idx >= n))
            levels_summary[sym] = {
                "total": len(levels),
                "active": active_count,
            }

        return {
            "running": self.running,
            "enabled": self.config.enabled,
            "symbols": self.config.symbols,
            "interval": self.config.interval,
            "alertsEnabled": self.config.alertsEnabled,
            "strategy_name": self.config.strategy.get("_name", "Sin nombre"),
            "stats": self.stats,
            "open_trades": open_trades_summary,
            "levels": levels_summary,
            "buffers": {sym: len(buf) for sym, buf in self._candle_buffers.items()},
        }

    def get_signals(self, symbol: str) -> List[Dict]:
        """Retorna senales recientes para un simbolo."""
        return self._recent_signals.get(symbol, [])

    def get_trades(self, symbol: str) -> Dict:
        """Retorna trades abiertos y cerrados para un simbolo."""
        return {
            "open": self._open_trades.get(symbol, []),
            "history": self._trade_history.get(symbol, [])[-50:],
        }

    async def update_config(self, new_config: Dict):
        """Actualiza configuracion y reinicia si es necesario."""
        was_running = self.running
        strategy_changed = new_config.get('strategy') != self.config.strategy

        for key, val in new_config.items():
            if hasattr(self.config, key):
                setattr(self.config, key, val)

        self._save_config()

        # If strategy changed and running, restart to re-precompute levels
        if was_running and strategy_changed:
            await self.stop()
            await self.start()

    async def clear_cooldowns(self):
        """Limpia todos los cooldowns (para testing)."""
        self._cooldowns.clear()
        logger.info("[STRAT_RT] Cooldowns limpiados")


# Singleton
_strategy_rt_service: Optional[StrategyRealtimeService] = None


def get_strategy_rt_service() -> StrategyRealtimeService:
    global _strategy_rt_service
    if _strategy_rt_service is None:
        _strategy_rt_service = StrategyRealtimeService()
    return _strategy_rt_service
