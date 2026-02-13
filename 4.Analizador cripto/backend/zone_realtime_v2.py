# zone_realtime_v2.py
# Detector de zonas de consolidacion en TIEMPO REAL (incremental, vela a vela).
# Solo usa el metodo ATR Dynamic. Sin re-deteccion historica.
#
# Arquitectura:
#   - Cada vela nueva actualiza indicadores incrementalmente (ATR, SMA, TTM)
#   - 6 condiciones diagnosticas se evaluan por vela (barras azul/gris)
#   - Cuando TODAS las condiciones se cumplen consecutivamente >= min_bars,
#     se crea una zona en estado BUILDING
#   - Cuando alguna condicion falla, la zona pasa a COMPLETE
#   - Luego se busca breakout en las siguientes velas
#   - Breakout confirmado -> OPEN con SL/TP -> se monitorea hasta WIN/LOSS
#
# Zona lifecycle: BUILDING -> COMPLETE -> BREAKOUT/OPEN -> WIN/LOSS

import asyncio
import json
import time
import logging
from pathlib import Path
from typing import Optional, List, Dict
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone

import httpx

logger = logging.getLogger("zone_v2")

LOG_DIR = Path("logs")
LOG_DIR.mkdir(exist_ok=True)
_alert_log_file = LOG_DIR / "zone_v2_alerts.log"
_alert_logger = logging.getLogger("zone_v2_alerts")
if not _alert_logger.handlers:
    _fh = logging.FileHandler(_alert_log_file, encoding="utf-8")
    _fh.setFormatter(logging.Formatter("%(asctime)s | %(levelname)s | %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
    _alert_logger.addHandler(_fh)
    _alert_logger.setLevel(logging.INFO)

CONFIG_DIR = Path("config")
CONFIG_DIR.mkdir(exist_ok=True)
CONFIG_FILE = CONFIG_DIR / "zone_v2_config.json"

BYBIT_API_URL = "https://api.bybit.com/v5/market/kline"


# ============================================================
# Config
# ============================================================

@dataclass
class ZoneV2Config:
    enabled: bool = False
    symbols: List[str] = field(default_factory=lambda: ["BTCUSDT"])
    interval: str = "1"

    # ATR Dynamic params
    atr_period: int = 100          # Periodo ATR (volatilidad de fondo)
    ma_period: int = 20            # Periodo SMA (tambien ventana de count_outside)
    multiplier: float = 1.5        # Ancho: SMA +/- ATR * mult
    max_outside_bars: int = 5      # Velas fuera permitidas antes de romper

    # Consolidation filters
    min_bars: int = 8              # Min velas con todas las condiciones = azul
    max_range_pct: float = 6.0     # Max % rango de precio de la zona
    body_ratio: float = 0.7        # Max ratio cuerpo/rango promedio (0.7 = tolera cuerpos grandes)
    max_outside_count: int = 3     # Max velas fuera del rango ATR en ventana rolling
    grace_bars: int = 2            # Velas fallidas consecutivas permitidas antes de cerrar zona

    # TTM Squeeze (opcional)
    use_ttm: bool = False
    ttm_atr_length: int = 30
    ttm_kc_multiplier: float = 1.0
    ttm_min_squeeze_bars: int = 10

    # Breakout & Trade
    breakout_confirm_bars: int = 3   # Velas fuera para confirmar breakout
    tp_rr_ratio: float = 1.0        # TP = N * R
    sl_buffer_pct: float = 0.1      # Buffer extra para SL (% del rango)
    position_mode: str = "sequential"  # sequential o concurrent
    sl_mode: str = "zone_opposite"   # "zone_opposite" o "va_poc"
    sl_poc_buffer_pct: float = 50.0  # Buffer % sobre distancia entry->POC para SL
    vp_bins_per_zone: int = 30       # Bins de precio para Volume Profile de cada zona

    # Filtro de score
    min_score_filter: float = 0.0     # 0 = sin filtro. Zonas con score < min se descartan

    # Alertas
    alerts_enabled: bool = True
    alert_target_url: str = "http://localhost:5000/api/watchlist-alert"
    cooldown_minutes: int = 5

    # Historial para warmup (velas historicas a cargar al iniciar)
    warmup_candles: int = 500

    def to_dict(self) -> Dict:
        return asdict(self)


# ============================================================
# Condiciones diagnosticas (barras)
# ============================================================

# Cada condicion devuelve True/False por vela.
# Las 6 barras son:
#   1. ATR_RANGE   - Close dentro de SMA +/- ATR*mult
#   2. COUNT_OUT   - count_outside == 0 en ventana rolling ma_period
#   3. BODY_RATIO  - Ratio cuerpo/rango de la vela < body_ratio
#   4. RANGE_PCT   - Rango acumulado de la zona potencial < max_range_pct
#   5. MIN_BARS    - Se han acumulado >= min_bars consecutivas con cond 1-4
#   6. TTM_SQUEEZE - (Opcional) Bollinger dentro de Keltner

DIAG_KEYS = ["atr_range", "count_outside", "body_ratio", "range_pct", "min_bars", "ttm_squeeze"]


def _ts_str(ts_ms):
    """Timestamp ms a string legible."""
    return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime('%m/%d %H:%M')


# ============================================================
# IncrementalZoneDetector
# ============================================================

class IncrementalZoneDetector:
    """
    Detector incremental que se alimenta vela a vela.
    Mantiene estado interno de:
    - Indicadores (ATR, SMA, TTM)
    - Zona en construccion (BUILDING)
    - Zonas completadas (COMPLETE, esperando breakout)
    - Trades abiertos (OPEN, monitoreando SL/TP)
    - Trades resueltos (WIN/LOSS)
    """

    def __init__(self, symbol: str, config: ZoneV2Config, backtest_mode: bool = False):
        self.symbol = symbol
        self.config = config
        self._backtest_mode = backtest_mode

        # Buffer de velas (rolling, max = atr_period + margen)
        self._candles: List[Dict] = []
        self._max_buffer = max(config.atr_period, config.ma_period) + 100

        # Indicadores incrementales
        self._atr_values: List[float] = []  # ATR por vela (aligned con _candles)
        self._sma_values: List[float] = []  # SMA por vela

        # TTM Squeeze
        self._bb_sma: List[float] = []     # Bollinger SMA(20)
        self._bb_std: List[float] = []     # Bollinger Std(20)
        self._squeeze_consecutive: int = 0  # Velas consecutivas en squeeze

        # Diagnosticos por vela (para barras del frontend)
        # Map: timestamp -> {atr_range: bool, count_outside: bool, ...}
        self._diagnostics: Dict[int, Dict[str, bool]] = {}
        self._max_diagnostics = 2000  # Limpiar antiguos

        # Zona en construccion
        self._building_zone: Optional[Dict] = None
        self._consecutive_pass: int = 0  # Velas consecutivas con todas las cond
        self._grace_counter: int = 0     # Velas fallidas consecutivas (grace bars)

        # Zonas completadas (esperando breakout)
        self._complete_zones: List[Dict] = []

        # Trades abiertos
        self._open_trades: List[Dict] = []

        # Zonas resueltas (WIN/LOSS/EXPIRED) - para visualizacion
        self._resolved_zones: List[Dict] = []
        self._max_resolved = 50

        # Contadores de breakout por zona (para confirmar breakout)
        # zone_id -> {'count': N, 'direction': UP/DOWN}
        self._breakout_counters: Dict[str, Dict] = {}

        # Zone ID counter
        self._zone_counter = 0

    # --------------------------------------------------
    # Warmup: cargar velas historicas
    # --------------------------------------------------

    def warmup(self, candles: List[Dict]):
        """Carga velas historicas para inicializar indicadores sin generar zonas/alertas."""
        for c in candles:
            self._add_candle_to_buffer(c)
            self._update_indicators()
        logger.info(f"[{self.symbol}] Warmup completado: {len(self._candles)} velas, "
                    f"ATR={len(self._atr_values)}, SMA={len(self._sma_values)}")

    # --------------------------------------------------
    # Procesar nueva vela (punto de entrada principal)
    # --------------------------------------------------

    def process_candle(self, candle: Dict) -> Dict:
        """
        Procesa una nueva vela cerrada. Retorna resultado con:
        - diagnostics: dict de condiciones para esta vela
        - events: lista de eventos (zone_complete, breakout, win, loss)
        """
        self._add_candle_to_buffer(candle)
        self._update_indicators()

        ts = candle['timestamp']
        events = []

        # 1. Evaluar diagnosticos
        diag = self._evaluate_diagnostics(candle)
        self._diagnostics[ts] = diag
        self._trim_diagnostics()

        # 2. Logica de zona BUILDING (con grace bars para tolerancia)
        # Usar solo las 4 condiciones base (NO min_bars, que es un indicador visual del acumulado)
        base_keys = ['atr_range', 'count_outside', 'body_ratio', 'range_pct']
        all_pass = all(diag[k] for k in base_keys)
        if self.config.use_ttm:
            all_pass = all_pass and diag.get("ttm_squeeze", False)

        grace_limit = self.config.grace_bars

        if all_pass:
            self._consecutive_pass += 1
            self._grace_counter = 0  # Resetear grace al pasar todas las condiciones
            if self._building_zone is None and self._consecutive_pass >= self.config.min_bars:
                # Iniciar zona nueva
                start_idx = max(0, len(self._candles) - self._consecutive_pass)
                start_candle = self._candles[start_idx]
                zone_candles = self._candles[start_idx:]
                highs = [c['high'] for c in zone_candles]
                lows = [c['low'] for c in zone_candles]
                self._zone_counter += 1
                self._building_zone = {
                    'id': f"zv2_{self.symbol}_{self._zone_counter}",
                    'symbol': self.symbol,
                    'state': 'BUILDING',
                    'start_timestamp': start_candle['timestamp'],
                    'end_timestamp': candle['timestamp'],
                    'min_price': min(lows),
                    'max_price': max(highs),
                    'candle_count': len(zone_candles),
                    'consecutive_bars': self._consecutive_pass,
                    'grace_used': 0,
                }
                _alert_logger.info(f"ZONE_BUILDING | {self.symbol} | "
                                   f"#{self._zone_counter} | "
                                   f"{_ts_str(start_candle['timestamp'])} - {_ts_str(candle['timestamp'])} | "
                                   f"bars={len(zone_candles)}")
            elif self._building_zone is not None:
                # Extender zona
                self._building_zone['end_timestamp'] = candle['timestamp']
                self._building_zone['min_price'] = min(self._building_zone['min_price'], candle['low'])
                self._building_zone['max_price'] = max(self._building_zone['max_price'], candle['high'])
                self._building_zone['candle_count'] += 1
                self._building_zone['consecutive_bars'] = self._consecutive_pass
        else:
            # Alguna condicion fallo
            self._grace_counter += 1

            if self._building_zone is not None:
                if self._grace_counter <= grace_limit:
                    # GRACE: tolerar vela fallida, zona sigue BUILDING
                    self._building_zone['end_timestamp'] = candle['timestamp']
                    self._building_zone['min_price'] = min(self._building_zone['min_price'], candle['low'])
                    self._building_zone['max_price'] = max(self._building_zone['max_price'], candle['high'])
                    self._building_zone['candle_count'] += 1
                    self._building_zone['grace_used'] = self._building_zone.get('grace_used', 0) + 1
                else:
                    # Grace agotado - zona pasa de BUILDING a COMPLETE
                    zone = self._building_zone
                    zone['state'] = 'COMPLETE'
                    # Calcular Volume Profile al completarse (necesario para VA breakout)
                    zone['volume_profile'] = self._calculate_zone_volume_profile(zone)
                    # Calcular trading_score: basado en duracion y compresion
                    zone['trading_score'] = self._calculate_zone_score(zone)
                    self._complete_zones.append(zone)
                    vp = zone['volume_profile']
                    _alert_logger.info(f"ZONE_COMPLETE | {self.symbol} | "
                                       f"#{zone['id']} | "
                                       f"{_ts_str(zone['start_timestamp'])} - {_ts_str(zone['end_timestamp'])} | "
                                       f"bars={zone['candle_count']} | score={zone['trading_score']:.1f} | "
                                       f"range={zone['min_price']:.2f}-{zone['max_price']:.2f} | "
                                       f"POC={vp.get('poc_price', 0):.2f} | "
                                       f"VAH={vp.get('vah_price', 0):.2f} | "
                                       f"VAL={vp.get('val_price', 0):.2f} | "
                                       f"grace_used={zone.get('grace_used', 0)}")
                    events.append({'type': 'zone_complete', 'zone': zone})
                    self._building_zone = None
                    self._consecutive_pass = 0
                    self._grace_counter = 0
            else:
                # Sin zona activa - grace solo aplica durante pre-acumulacion
                if self._grace_counter > grace_limit:
                    self._consecutive_pass = 0
                    self._grace_counter = 0

        # 3. Chequear breakout en zonas COMPLETE
        breakout_events = self._check_breakouts(candle)
        events.extend(breakout_events)

        # 4. Monitorear trades OPEN (SL/TP)
        trade_events = self._update_open_trades(candle)
        events.extend(trade_events)

        return {
            'diagnostics': diag,
            'events': events,
        }

    # --------------------------------------------------
    # Buffer de velas
    # --------------------------------------------------

    def _add_candle_to_buffer(self, candle: Dict):
        """Agrega vela al buffer rolling."""
        self._candles.append(candle)
        if len(self._candles) > self._max_buffer:
            excess = len(self._candles) - self._max_buffer
            self._candles = self._candles[excess:]
            self._atr_values = self._atr_values[excess:] if len(self._atr_values) > excess else []
            self._sma_values = self._sma_values[excess:] if len(self._sma_values) > excess else []
            self._bb_sma = self._bb_sma[excess:] if len(self._bb_sma) > excess else []
            self._bb_std = self._bb_std[excess:] if len(self._bb_std) > excess else []

    # --------------------------------------------------
    # Indicadores incrementales
    # --------------------------------------------------

    def _update_indicators(self):
        """Recalcula ATR y SMA para la ultima vela."""
        n = len(self._candles)
        atr_p = self.config.atr_period
        ma_p = self.config.ma_period

        # ATR
        if n > atr_p:
            trs = []
            for j in range(n - atr_p, n):
                h = self._candles[j]['high']
                lo = self._candles[j]['low']
                pc = self._candles[j - 1]['close'] if j > 0 else self._candles[j]['open']
                tr = max(h - lo, abs(h - pc), abs(lo - pc))
                trs.append(tr)
            atr = sum(trs) / len(trs) if trs else 0
        else:
            atr = 0

        # Mantener aligned: un valor ATR por cada vela en buffer
        while len(self._atr_values) < n - 1:
            self._atr_values.append(0)
        if len(self._atr_values) < n:
            self._atr_values.append(atr)
        else:
            self._atr_values[-1] = atr

        # SMA
        if n >= ma_p:
            closes = [self._candles[i]['close'] for i in range(n - ma_p, n)]
            sma = sum(closes) / ma_p
        else:
            sma = self._candles[-1]['close'] if n > 0 else 0

        while len(self._sma_values) < n - 1:
            self._sma_values.append(0)
        if len(self._sma_values) < n:
            self._sma_values.append(sma)
        else:
            self._sma_values[-1] = sma

        # Bollinger (para TTM Squeeze)
        if self.config.use_ttm and n >= 20:
            bb_closes = [self._candles[i]['close'] for i in range(n - 20, n)]
            bb_mean = sum(bb_closes) / 20
            bb_var = sum((c - bb_mean) ** 2 for c in bb_closes) / 20
            bb_std = bb_var ** 0.5

            while len(self._bb_sma) < n - 1:
                self._bb_sma.append(0)
            while len(self._bb_std) < n - 1:
                self._bb_std.append(0)
            if len(self._bb_sma) < n:
                self._bb_sma.append(bb_mean)
            else:
                self._bb_sma[-1] = bb_mean
            if len(self._bb_std) < n:
                self._bb_std.append(bb_std)
            else:
                self._bb_std[-1] = bb_std

    # --------------------------------------------------
    # Diagnosticos
    # --------------------------------------------------

    def _evaluate_diagnostics(self, candle: Dict) -> Dict[str, bool]:
        """Evalua las 6 condiciones diagnosticas para la vela actual."""
        n = len(self._candles)
        cfg = self.config
        result = {k: False for k in DIAG_KEYS}

        if n < max(cfg.atr_period, cfg.ma_period) + 1:
            return result

        idx = n - 1
        atr_val = self._atr_values[idx] * cfg.multiplier if idx < len(self._atr_values) else 0
        sma_val = self._sma_values[idx] if idx < len(self._sma_values) else 0

        if atr_val <= 0 or sma_val <= 0:
            return result

        range_high = sma_val + atr_val
        range_low = sma_val - atr_val
        close = candle['close']

        # 1. ATR_RANGE: close dentro de la banda
        result['atr_range'] = range_low <= close <= range_high

        # 2. COUNT_OUTSIDE: contar velas fuera en ventana rolling
        ma_p = cfg.ma_period
        count_outside = 0
        start_j = max(0, n - ma_p)
        for j in range(start_j, n):
            j_close = self._candles[j]['close']
            j_sma = self._sma_values[j] if j < len(self._sma_values) else sma_val
            j_atr = (self._atr_values[j] * cfg.multiplier) if j < len(self._atr_values) else atr_val
            deviation = abs(j_close - j_sma)
            if deviation > j_atr:
                count_outside += 1
        result['count_outside'] = count_outside <= cfg.max_outside_count

        # 3. BODY_RATIO: cuerpo / rango de la vela
        candle_range = candle['high'] - candle['low']
        if candle_range > 0:
            body = abs(candle['close'] - candle['open'])
            result['body_ratio'] = (body / candle_range) <= cfg.body_ratio
        else:
            result['body_ratio'] = True  # Doji

        # 4. RANGE_PCT: rango acumulado de la zona potencial
        if self._building_zone:
            zone_high = max(self._building_zone['max_price'], candle['high'])
            zone_low = min(self._building_zone['min_price'], candle['low'])
            mid = (zone_high + zone_low) / 2
            range_pct = ((zone_high - zone_low) / mid) * 100 if mid > 0 else 0
            result['range_pct'] = range_pct <= cfg.max_range_pct
        else:
            # Sin zona activa, evaluar rango de las ultimas min_bars velas
            lookback = min(cfg.min_bars, n)
            recent = self._candles[n - lookback:]
            highs = [c['high'] for c in recent]
            lows = [c['low'] for c in recent]
            zone_high = max(highs)
            zone_low = min(lows)
            mid = (zone_high + zone_low) / 2
            range_pct = ((zone_high - zone_low) / mid) * 100 if mid > 0 else 0
            result['range_pct'] = range_pct <= cfg.max_range_pct

        # 5. MIN_BARS: acumulacion consecutiva
        # Depende de las 4 condiciones base + TTM si esta habilitado (coherente con logica de zona)
        temp_pass = all(result[k] for k in ['atr_range', 'count_outside', 'body_ratio', 'range_pct'])
        if cfg.use_ttm:
            temp_pass = temp_pass and result.get('ttm_squeeze', False)
        consecutive = (self._consecutive_pass + 1) if temp_pass else 0
        result['min_bars'] = consecutive >= cfg.min_bars

        # 6. TTM_SQUEEZE (opcional)
        if cfg.use_ttm and idx < len(self._bb_sma) and idx < len(self._bb_std):
            bb_sma_val = self._bb_sma[idx]
            bb_std_val = self._bb_std[idx]

            # Bollinger bands
            bb_upper = bb_sma_val + 2 * bb_std_val
            bb_lower = bb_sma_val - 2 * bb_std_val

            # Keltner channels (usa ATR del TTM config)
            kc_atr = self._calculate_kc_atr(idx)
            kc_upper = bb_sma_val + cfg.ttm_kc_multiplier * kc_atr
            kc_lower = bb_sma_val - cfg.ttm_kc_multiplier * kc_atr

            is_squeeze = bb_upper < kc_upper and bb_lower > kc_lower
            if is_squeeze:
                self._squeeze_consecutive += 1
            else:
                self._squeeze_consecutive = 0

            result['ttm_squeeze'] = self._squeeze_consecutive >= cfg.ttm_min_squeeze_bars
        else:
            # TTM deshabilitado = siempre pasa
            result['ttm_squeeze'] = True

        return result

    def _calculate_kc_atr(self, idx: int) -> float:
        """Calcula ATR para Keltner Channels (puede usar periodo diferente)."""
        kc_period = self.config.ttm_atr_length
        n = len(self._candles)
        if n < kc_period + 1:
            return 0
        trs = []
        start = max(0, idx - kc_period + 1)
        for j in range(start, idx + 1):
            h = self._candles[j]['high']
            lo = self._candles[j]['low']
            pc = self._candles[j - 1]['close'] if j > 0 else self._candles[j]['open']
            trs.append(max(h - lo, abs(h - pc), abs(lo - pc)))
        return sum(trs) / len(trs) if trs else 0

    def _trim_diagnostics(self):
        """Limpia diagnosticos antiguos."""
        if len(self._diagnostics) > self._max_diagnostics:
            keys = sorted(self._diagnostics.keys())
            excess = len(keys) - self._max_diagnostics
            for k in keys[:excess]:
                del self._diagnostics[k]

    # --------------------------------------------------
    # Volume Profile de zona
    # --------------------------------------------------

    def _calculate_zone_score(self, zone: Dict) -> float:
        """
        Calcula un score 0-100 para la zona basado en:
        - Duracion (candle_count): mas barras = zona mas consolidada (0-40)
        - Compresion (rango %): rango mas estrecho = mayor compresion (0-35)
        - Volume Profile: concentracion en POC (0-25)
        """
        score = 0.0
        bars = zone.get('candle_count', 0)
        # Duracion: 8 bars=10, 15=20, 25=30, 40+=40
        score += min(40, bars * 1.2)

        # Compresion: rango % menor = mejor
        min_p = zone.get('min_price', 0)
        max_p = zone.get('max_price', 0)
        if min_p > 0:
            range_pct = (max_p - min_p) / min_p * 100
            # 0.5% rango = 35, 1% = 28, 2% = 17, 4% = 0
            score += max(0, 35 - range_pct * 8.75)

        # Volume Profile concentracion
        vp = zone.get('volume_profile', {})
        if vp.get('total_volume', 0) > 0 and vp.get('poc_volume', 0) > 0:
            concentration = vp['poc_volume'] / vp['total_volume']
            score += min(25, concentration * 100)

        return round(min(100, max(0, score)), 1)

    def _calculate_zone_volume_profile(self, zone: Dict) -> Dict:
        """
        Calcula Volume Profile para una zona usando las velas del buffer.
        Retorna POC, VAH, VAL, bins con volumen y rango de precios.
        """
        num_bins = self.config.vp_bins_per_zone
        zone_start = zone['start_timestamp']
        zone_end = zone['end_timestamp']

        # Obtener velas de la zona desde el buffer
        zone_candles = [c for c in self._candles
                        if zone_start <= c['timestamp'] <= zone_end]

        if not zone_candles or len(zone_candles) < 2:
            return {"poc_price": 0, "vah_price": 0, "val_price": 0,
                    "total_volume": 0, "bins": [], "price_low": 0, "price_high": 0}

        price_high = max(c['high'] for c in zone_candles)
        price_low = min(c['low'] for c in zone_candles)

        if price_high == price_low:
            mid = price_high
            return {"poc_price": mid, "vah_price": mid, "val_price": mid,
                    "total_volume": sum(c['volume'] for c in zone_candles),
                    "bins": [{"price": mid, "volume": 1.0}],
                    "price_low": price_low, "price_high": price_high}

        bin_size = (price_high - price_low) / num_bins
        volume_by_bin = [0.0] * num_bins

        total_volume = 0.0
        for c in zone_candles:
            c_low = c['low']
            c_high = c['high']
            c_vol = c['volume']
            total_volume += c_vol

            low_bin = int((c_low - price_low) / bin_size)
            high_bin = int((c_high - price_low) / bin_size)
            low_bin = max(0, min(low_bin, num_bins - 1))
            high_bin = max(0, min(high_bin, num_bins - 1))

            bins_touched = high_bin - low_bin + 1
            vol_per_bin = c_vol / bins_touched if bins_touched > 0 else 0

            for b in range(low_bin, high_bin + 1):
                volume_by_bin[b] += vol_per_bin

        if total_volume == 0:
            mid = (price_high + price_low) / 2
            return {"poc_price": mid, "vah_price": price_high, "val_price": price_low,
                    "total_volume": 0, "bins": [], "price_low": price_low, "price_high": price_high}

        # POC: bin con mayor volumen
        max_vol = max(volume_by_bin)
        poc_bin = max(range(num_bins), key=lambda i: volume_by_bin[i])
        poc_price = price_low + (poc_bin + 0.5) * bin_size

        # Value Area: 70% del volumen, expandiendo desde POC
        target_volume = total_volume * 0.70
        va_volume = volume_by_bin[poc_bin]
        va_low_bin = poc_bin
        va_high_bin = poc_bin

        while va_volume < target_volume and (va_low_bin > 0 or va_high_bin < num_bins - 1):
            vol_below = volume_by_bin[va_low_bin - 1] if va_low_bin > 0 else 0
            vol_above = volume_by_bin[va_high_bin + 1] if va_high_bin < num_bins - 1 else 0

            if vol_below >= vol_above and va_low_bin > 0:
                va_low_bin -= 1
                va_volume += volume_by_bin[va_low_bin]
            elif va_high_bin < num_bins - 1:
                va_high_bin += 1
                va_volume += volume_by_bin[va_high_bin]
            elif va_low_bin > 0:
                va_low_bin -= 1
                va_volume += volume_by_bin[va_low_bin]
            else:
                break

        val_price = price_low + va_low_bin * bin_size
        vah_price = price_low + (va_high_bin + 1) * bin_size

        # Generar bins normalizados para renderizado frontend
        bins_data = []
        for i in range(num_bins):
            bin_price = price_low + (i + 0.5) * bin_size
            norm_vol = volume_by_bin[i] / max_vol if max_vol > 0 else 0
            bins_data.append({
                "price": round(bin_price, 8),
                "volume_norm": round(norm_vol, 4),  # 0-1 normalizado vs max
                "in_va": va_low_bin <= i <= va_high_bin,
            })

        return {
            "poc_price": round(poc_price, 8),
            "vah_price": round(vah_price, 8),
            "val_price": round(val_price, 8),
            "total_volume": round(total_volume, 2),
            "bins": bins_data,
            "price_low": round(price_low, 8),
            "price_high": round(price_high, 8),
        }

    # --------------------------------------------------
    # Breakout detection
    # --------------------------------------------------

    def _check_breakouts(self, candle: Dict) -> List[Dict]:
        """Chequea si alguna zona COMPLETE tiene breakout."""
        events = []
        remaining = []

        for zone in self._complete_zones:
            zone_id = zone['id']
            zone_high = zone['max_price']
            zone_low = zone['min_price']
            close = candle['close']

            # Determinar limites de breakout segun sl_mode
            # va_poc: breakout del Value Area (VAH/VAL) - entry mas rapido
            # zone_opposite: breakout de la zona completa (zone_high/zone_low)
            if self.config.sl_mode == "va_poc":
                vp = zone.get('volume_profile', {})
                breakout_upper = vp.get('vah_price', zone_high)
                breakout_lower = vp.get('val_price', zone_low)
                # Fallback si VP no tiene datos validos
                if breakout_upper <= 0 or breakout_lower <= 0:
                    breakout_upper = zone_high
                    breakout_lower = zone_low
            else:
                breakout_upper = zone_high
                breakout_lower = zone_low

            # Determinar direccion
            direction = None
            if close > breakout_upper:
                direction = 'UP'
            elif close < breakout_lower:
                direction = 'DOWN'

            if direction:
                # Incrementar contador de breakout
                if zone_id not in self._breakout_counters:
                    self._breakout_counters[zone_id] = {'count': 0, 'direction': direction}

                counter = self._breakout_counters[zone_id]
                if counter['direction'] == direction:
                    counter['count'] += 1
                else:
                    # Cambio de direccion - resetear
                    counter['direction'] = direction
                    counter['count'] = 1

                if counter['count'] >= self.config.breakout_confirm_bars:
                    # BREAKOUT CONFIRMADO
                    zone_range = zone_high - zone_low
                    entry_price = close

                    # Usar Volume Profile ya calculado al completar la zona
                    vp_data = zone.get('volume_profile') or self._calculate_zone_volume_profile(zone)

                    # SL segun sl_mode
                    if self.config.sl_mode == "va_poc" and vp_data.get('poc_price', 0) > 0:
                        poc_price = vp_data['poc_price']
                        dist_to_poc = abs(entry_price - poc_price)
                        if dist_to_poc == 0:
                            dist_to_poc = zone_range * 0.3
                        buffer_mult = 1.0 + (self.config.sl_poc_buffer_pct / 100.0)
                        r_distance = dist_to_poc * buffer_mult

                        if direction == 'UP':
                            sl_price = entry_price - r_distance
                            risk = r_distance
                            tp_price = entry_price + (risk * self.config.tp_rr_ratio)
                        else:
                            sl_price = entry_price + r_distance
                            risk = r_distance
                            tp_price = entry_price - (risk * self.config.tp_rr_ratio)

                        _alert_logger.info(f"SL_MODE_POC | {self.symbol} | "
                                           f"POC={poc_price:.2f} | dist={dist_to_poc:.2f} | "
                                           f"buffer={self.config.sl_poc_buffer_pct}% | "
                                           f"SL={sl_price:.2f}")
                    else:
                        # zone_opposite (default)
                        if direction == 'UP':
                            sl_price = zone_low - (zone_range * self.config.sl_buffer_pct / 100)
                            risk = entry_price - sl_price
                            tp_price = entry_price + (risk * self.config.tp_rr_ratio)
                        else:
                            sl_price = zone_high + (zone_range * self.config.sl_buffer_pct / 100)
                            risk = sl_price - entry_price
                            tp_price = entry_price - (risk * self.config.tp_rr_ratio)

                    trade = {
                        **zone,
                        'state': 'OPEN',
                        'trade_result': 'OPEN',
                        'breakout_direction': direction,
                        'breakout_timestamp': candle['timestamp'],
                        'entry_price': entry_price,
                        'entry_timestamp': candle['timestamp'],
                        'sl_price': sl_price,
                        'tp_price': tp_price,
                        'risk': risk,
                        'volume_profile': vp_data,
                    }

                    # Verificar sequential mode
                    if self.config.position_mode == 'sequential' and len(self._open_trades) > 0:
                        _alert_logger.info(f"BLOCKED_SEQUENTIAL | {self.symbol} | "
                                           f"{zone_id} | {direction} | "
                                           f"open_trades={len(self._open_trades)}")
                        # Descartar zona
                        if zone_id in self._breakout_counters:
                            del self._breakout_counters[zone_id]
                        continue

                    self._open_trades.append(trade)
                    if zone_id in self._breakout_counters:
                        del self._breakout_counters[zone_id]

                    breakout_mode = "VA_BREAKOUT" if self.config.sl_mode == "va_poc" else "ZONE_BREAKOUT"
                    _alert_logger.info(f"BREAKOUT | {self.symbol} | "
                                       f"{zone_id} | {direction} | {breakout_mode} | "
                                       f"entry={entry_price:.2f} | "
                                       f"SL={sl_price:.2f} | TP={tp_price:.2f} | "
                                       f"R={risk:.2f}")

                    events.append({'type': 'breakout', 'trade': trade})
                    continue  # No agregar a remaining
            else:
                # Vela dentro de la zona - resetear contador
                if zone_id in self._breakout_counters:
                    self._breakout_counters[zone_id]['count'] = 0

            # Expirar zonas muy viejas (mas de 100 velas sin breakout)
            age_bars = 0
            for i, c in enumerate(reversed(self._candles)):
                if c['timestamp'] <= zone['end_timestamp']:
                    age_bars = i
                    break
            if age_bars > 100:
                _alert_logger.info(f"ZONE_EXPIRED | {self.symbol} | {zone_id} | age={age_bars} bars")
                if zone_id in self._breakout_counters:
                    del self._breakout_counters[zone_id]
                continue

            remaining.append(zone)

        self._complete_zones = remaining
        return events

    # --------------------------------------------------
    # Trade monitoring (SL/TP)
    # --------------------------------------------------

    def _update_open_trades(self, candle: Dict) -> List[Dict]:
        """Monitorea trades abiertos para SL/TP."""
        events = []
        remaining = []

        for trade in self._open_trades:
            direction = trade['breakout_direction']
            hit_tp = False
            hit_sl = False

            if direction == 'UP':
                hit_tp = candle['high'] >= trade['tp_price']
                hit_sl = candle['low'] <= trade['sl_price']
            else:
                hit_tp = candle['low'] <= trade['tp_price']
                hit_sl = candle['high'] >= trade['sl_price']

            if hit_sl and hit_tp:
                # Ambos tocados - usar open para determinar cual primero
                if direction == 'UP':
                    hit_sl_first = candle['open'] <= trade['sl_price']
                else:
                    hit_sl_first = candle['open'] >= trade['sl_price']
                if hit_sl_first:
                    hit_tp = False
                else:
                    hit_sl = False

            if hit_tp:
                trade['state'] = 'RESOLVED'
                trade['trade_result'] = 'WIN'
                trade['trade_pnl_r'] = self.config.tp_rr_ratio
                trade['trade_close_timestamp'] = candle['timestamp']
                self._add_resolved(trade)
                _alert_logger.info(f"WIN | {self.symbol} | {trade['id']} | "
                                   f"{direction} | pnl=+{self.config.tp_rr_ratio}R")
                events.append({'type': 'win', 'trade': trade})
                continue

            if hit_sl:
                trade['state'] = 'RESOLVED'
                trade['trade_result'] = 'LOSS'
                trade['trade_pnl_r'] = -1.0
                trade['trade_close_timestamp'] = candle['timestamp']
                self._add_resolved(trade)
                _alert_logger.info(f"LOSS | {self.symbol} | {trade['id']} | "
                                   f"{direction} | pnl=-1R")
                events.append({'type': 'loss', 'trade': trade})
                continue

            remaining.append(trade)

        self._open_trades = remaining
        return events

    def _add_resolved(self, trade: Dict):
        """Agrega trade resuelto al historial."""
        self._resolved_zones.append(trade)
        # En modo backtest no limitar: necesitamos todas las zonas para estadisticas
        if not self._backtest_mode and len(self._resolved_zones) > self._max_resolved:
            self._resolved_zones = self._resolved_zones[-self._max_resolved:]

    # --------------------------------------------------
    # Getters para el frontend
    # --------------------------------------------------

    def get_all_zones(self) -> List[Dict]:
        """Retorna todas las zonas para visualizacion (BUILDING + COMPLETE + OPEN + RESOLVED)."""
        zones = []
        idx = 1

        # Resueltas primero (orden cronologico) - ya tienen VP desde breakout
        for z in self._resolved_zones:
            zone_out = dict(z)
            zone_out['timeline_index'] = idx
            zones.append(zone_out)
            idx += 1

        # Trades abiertos - ya tienen VP desde breakout
        for z in self._open_trades:
            zone_out = dict(z)
            zone_out['timeline_index'] = idx
            zones.append(zone_out)
            idx += 1

        # Zonas COMPLETE (esperando breakout) - calcular VP on-the-fly
        for z in self._complete_zones:
            zone_out = dict(z)
            zone_out['trade_result'] = 'PENDING'
            zone_out['timeline_index'] = idx
            if 'volume_profile' not in zone_out:
                zone_out['volume_profile'] = self._calculate_zone_volume_profile(z)
            zones.append(zone_out)
            idx += 1

        # Zona BUILDING actual - calcular VP on-the-fly
        if self._building_zone:
            zone_out = dict(self._building_zone)
            zone_out['trade_result'] = 'BUILDING'
            zone_out['timeline_index'] = idx
            zone_out['volume_profile'] = self._calculate_zone_volume_profile(self._building_zone)
            zones.append(zone_out)

        return zones

    def get_diagnostics(self, timestamps: Optional[List[int]] = None) -> Dict:
        """
        Retorna diagnosticos para las barras del frontend.
        Si timestamps se proporciona, filtra solo esos.
        """
        if timestamps:
            filtered = {ts: self._diagnostics.get(ts, {k: False for k in DIAG_KEYS}) for ts in timestamps}
        else:
            filtered = dict(self._diagnostics)

        # Convertir a formato columnar (mas eficiente para frontend)
        all_ts = sorted(filtered.keys())
        result = {
            'timestamps': all_ts,
            'use_ttm': self.config.use_ttm,
        }
        for key in DIAG_KEYS:
            result[key] = [filtered[ts].get(key, False) for ts in all_ts]

        return result

    def get_stats(self) -> Dict:
        """Estadisticas del detector."""
        wins = sum(1 for z in self._resolved_zones if z.get('trade_result') == 'WIN')
        losses = sum(1 for z in self._resolved_zones if z.get('trade_result') == 'LOSS')
        total_pnl = sum(z.get('trade_pnl_r', 0) for z in self._resolved_zones)

        return {
            'candles_in_buffer': len(self._candles),
            'building_zone': self._building_zone is not None,
            'complete_zones': len(self._complete_zones),
            'open_trades': len(self._open_trades),
            'resolved_total': len(self._resolved_zones),
            'wins': wins,
            'losses': losses,
            'total_pnl_r': round(total_pnl, 2),
            'win_rate': round(wins / (wins + losses) * 100, 1) if (wins + losses) > 0 else 0,
            'consecutive_pass': self._consecutive_pass,
        }


# ============================================================
# Backtest V2 - Simulacion historica con motor incremental
# ============================================================

def backtest_v2(candles: List[Dict], config_overrides: Dict = None) -> Dict:
    """
    Ejecuta backtest historico usando el motor IncrementalZoneDetector.
    Alimenta velas una por una, igual que el realtime.

    Args:
        candles: Lista de velas OHLCV (deben estar ordenadas por timestamp asc)
        config_overrides: Dict con parametros a sobreescribir en ZoneV2Config

    Returns:
        Dict con zones, stats, equity_curve
    """
    # Crear config con overrides
    cfg = ZoneV2Config()
    if config_overrides:
        for key, val in config_overrides.items():
            if hasattr(cfg, key):
                setattr(cfg, key, val)

    # Crear detector temporal (backtest_mode=True para no limitar resolved_zones)
    detector = IncrementalZoneDetector(symbol="BACKTEST", config=cfg, backtest_mode=True)

    # Determinar warmup: primeras N velas solo para indicadores
    warmup_count = max(cfg.atr_period, cfg.ma_period) + 10
    warmup_candles = candles[:warmup_count] if len(candles) > warmup_count else []
    trade_candles = candles[warmup_count:] if len(candles) > warmup_count else candles

    # Warmup (sin generar zonas)
    if warmup_candles:
        detector.warmup(warmup_candles)

    # Procesar velas una por una
    for candle in trade_candles:
        detector.process_candle(candle)

    # Recoger todas las zonas
    all_zones = detector.get_all_zones()

    # Aplicar filtro de score minimo (igual que en realtime _send_alert)
    if cfg.min_score_filter > 0:
        all_zones = [z for z in all_zones if z.get('trading_score', 0) >= cfg.min_score_filter]

    # Calcular estadisticas
    resolved = [z for z in all_zones if z.get('trade_result') in ('WIN', 'LOSS')]
    open_trades = [z for z in all_zones if z.get('trade_result') == 'OPEN']
    wins = [z for z in resolved if z['trade_result'] == 'WIN']
    losses = [z for z in resolved if z['trade_result'] == 'LOSS']

    total_closed = len(wins) + len(losses)
    total_pnl_r = sum(z.get('trade_pnl_r', 0) for z in resolved)
    win_rate = (len(wins) / total_closed * 100) if total_closed > 0 else 0
    expectancy = (total_pnl_r / total_closed) if total_closed > 0 else 0

    # Profit factor
    gross_profit = sum(z.get('trade_pnl_r', 0) for z in wins)
    gross_loss = abs(sum(z.get('trade_pnl_r', 0) for z in losses))
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (99.9 if gross_profit > 0 else 0)

    # Max drawdown & equity curve
    trades_sorted = sorted(resolved, key=lambda z: z.get('entry_timestamp', 0) or z.get('breakout_timestamp', 0))
    max_equity = 0.0
    max_drawdown = 0.0
    equity = 0.0
    equity_curve = []
    for z in trades_sorted:
        equity += z.get('trade_pnl_r', 0)
        if equity > max_equity:
            max_equity = equity
        dd = max_equity - equity
        if dd > max_drawdown:
            max_drawdown = dd
        equity_curve.append({
            'timestamp': z.get('trade_close_timestamp', z.get('entry_timestamp', 0)),
            'equity': round(equity, 2),
        })

    return {
        'zones': all_zones,
        'stats': {
            'total_zones': len(all_zones),
            'wins': len(wins),
            'losses': len(losses),
            'open': len(open_trades),
            'total_closed': total_closed,
            'win_rate': round(win_rate, 1),
            'total_pnl_r': round(total_pnl_r, 2),
            'expectancy': round(expectancy, 3),
            'profit_factor': round(profit_factor, 2),
            'max_drawdown_r': round(max_drawdown, 2),
        },
        'equity_curve': equity_curve,
        'candles_processed': len(trade_candles),
        'warmup_candles': len(warmup_candles),
    }


# ============================================================
# ZoneServiceV2 - Orquestador con WebSocket y alertas
# ============================================================

class ZoneServiceV2:
    """
    Servicio que conecta el IncrementalZoneDetector con:
    - WebSocket (candle close callback)
    - API REST (endpoints para frontend)
    - Alertas HTTP (al TradingBot)
    """

    def __init__(self):
        self.config = ZoneV2Config()
        self.running = False
        self.ws_manager = None
        self._http_client: Optional[httpx.AsyncClient] = None

        # Un detector por simbolo
        self._detectors: Dict[str, IncrementalZoneDetector] = {}

        # Cooldowns por simbolo+direccion
        self._cooldowns: Dict[str, float] = {}

        # Stats globales
        self.stats = {
            'start_time': 0,
            'candles_processed': 0,
            'alerts_sent': 0,
            'alerts_blocked_cooldown': 0,
            'last_candle_time': 0,
        }

        self._load_config()

    # --------------------------------------------------
    # Config
    # --------------------------------------------------

    def _load_config(self):
        if CONFIG_FILE.exists():
            try:
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for key, val in data.items():
                    if hasattr(self.config, key):
                        setattr(self.config, key, val)
                logger.info(f"[ZONE_V2] Config cargada: {self.config.symbols} @ {self.config.interval}")
            except Exception as e:
                logger.error(f"[ZONE_V2] Error cargando config: {e}")

    def _save_config(self):
        try:
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(self.config.to_dict(), f, indent=2)
        except Exception as e:
            logger.error(f"[ZONE_V2] Error guardando config: {e}")

    def update_config(self, new_config: Dict) -> Dict:
        changed = []
        for key, val in new_config.items():
            if hasattr(self.config, key):
                old_val = getattr(self.config, key)
                if old_val != val:
                    setattr(self.config, key, val)
                    changed.append(key)
        if changed:
            self._save_config()
            # Actualizar config en detectores existentes
            for det in self._detectors.values():
                det.config = self.config
            logger.info(f"[ZONE_V2] Config actualizada: {changed}")
        return {"updated": changed}

    # --------------------------------------------------
    # Start / Stop
    # --------------------------------------------------

    async def start(self):
        if self.running:
            return

        from websocket_manager import get_websocket_manager
        self.ws_manager = get_websocket_manager()
        self.running = True
        self.stats['start_time'] = time.time()

        self._http_client = httpx.AsyncClient(timeout=15.0)

        # Registrar callback
        self.ws_manager.add_candle_close_listener(self._sync_handler)
        await self.ws_manager.add_subscriptions(self.config.symbols, [self.config.interval])

        # Warmup en background
        asyncio.create_task(self._warmup_all())

        logger.info(f"[ZONE_V2] Iniciado: {self.config.symbols} @ {self.config.interval}")

    async def stop(self):
        if not self.running:
            return
        self.running = False
        if self.ws_manager:
            self.ws_manager.remove_candle_close_listener(self._sync_handler)
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None
        logger.info("[ZONE_V2] Detenido")

    # --------------------------------------------------
    # Warmup
    # --------------------------------------------------

    async def _warmup_all(self):
        """Carga velas historicas para cada simbolo."""
        for symbol in self.config.symbols:
            try:
                candles = await self._fetch_historical(symbol, self.config.warmup_candles)
                detector = IncrementalZoneDetector(symbol, self.config)
                detector.warmup(candles)
                self._detectors[symbol] = detector
                logger.info(f"[ZONE_V2] {symbol}: Warmup OK, {len(candles)} velas")
            except Exception as e:
                logger.error(f"[ZONE_V2] {symbol}: Error en warmup: {e}")

    async def _fetch_historical(self, symbol: str, count: int) -> List[Dict]:
        """Fetch velas historicas de Bybit."""
        all_candles = []
        end_ts = int(time.time() * 1000)
        remaining = count

        while remaining > 0:
            limit = min(remaining, 200)
            url = f"{BYBIT_API_URL}?category=linear&symbol={symbol}&interval={self.config.interval}&limit={limit}&end={end_ts}"

            try:
                if self._http_client is None or self._http_client.is_closed:
                    self._http_client = httpx.AsyncClient(timeout=15.0)
                resp = await self._http_client.get(url)
                data = resp.json()
                rows = data.get('result', {}).get('list', [])
                if not rows:
                    break

                batch = []
                for r in rows:
                    batch.append({
                        'timestamp': int(r[0]),
                        'open': float(r[1]),
                        'high': float(r[2]),
                        'low': float(r[3]),
                        'close': float(r[4]),
                        'volume': float(r[5]),
                    })
                batch.sort(key=lambda c: c['timestamp'])
                all_candles = batch + all_candles
                end_ts = batch[0]['timestamp'] - 1
                remaining -= len(batch)
            except Exception as e:
                logger.error(f"[ZONE_V2] {symbol}: Error fetch: {e}")
                break

        # Deduplicar por timestamp
        seen = set()
        unique = []
        for c in all_candles:
            if c['timestamp'] not in seen:
                seen.add(c['timestamp'])
                unique.append(c)
        unique.sort(key=lambda c: c['timestamp'])
        return unique

    # --------------------------------------------------
    # WebSocket callback
    # --------------------------------------------------

    def _sync_handler(self, symbol: str, interval: str, candle):
        """Wrapper sincrono para el callback del WebSocket."""
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._on_candle_close(symbol, interval, candle))
        except RuntimeError:
            try:
                loop = asyncio.get_event_loop()
                loop.create_task(self._on_candle_close(symbol, interval, candle))
            except Exception as e:
                logger.error(f"[ZONE_V2] Error scheduling handler: {e}")

    async def _on_candle_close(self, symbol: str, interval: str, candle):
        """Procesa cierre de vela."""
        if not self.running or not self.config.enabled:
            return
        if symbol not in self.config.symbols:
            return
        if interval != self.config.interval:
            return

        # Convertir candle
        if hasattr(candle, 'timestamp'):
            candle_dict = {
                'timestamp': candle.timestamp,
                'open': candle.open,
                'high': candle.high,
                'low': candle.low,
                'close': candle.close,
                'volume': candle.volume,
            }
        elif isinstance(candle, dict):
            candle_dict = candle
        else:
            return

        detector = self._detectors.get(symbol)
        if not detector:
            return

        self.stats['candles_processed'] += 1
        self.stats['last_candle_time'] = time.time()

        # Procesar vela
        result = detector.process_candle(candle_dict)

        # Enviar alertas para breakouts
        for event in result.get('events', []):
            if event['type'] == 'breakout' and self.config.alerts_enabled:
                await self._send_alert(symbol, event['trade'])

    # --------------------------------------------------
    # Alertas
    # --------------------------------------------------

    async def _send_alert(self, symbol: str, trade: Dict):
        """Envia alerta al TradingBot."""
        direction = trade.get('breakout_direction', 'UP')

        # Check min_score_filter
        zone_score = trade.get('trading_score', 0)
        if self.config.min_score_filter > 0 and zone_score < self.config.min_score_filter:
            _alert_logger.info(f"BLOCKED_LOW_SCORE | {symbol} | {direction} | "
                               f"score={zone_score:.1f} < min={self.config.min_score_filter}")
            return

        cooldown_key = f"{symbol}_{direction}"

        # Check cooldown
        now = time.time()
        if cooldown_key in self._cooldowns:
            elapsed = now - self._cooldowns[cooldown_key]
            if elapsed < self.config.cooldown_minutes * 60:
                remaining = self.config.cooldown_minutes * 60 - elapsed
                self.stats['alerts_blocked_cooldown'] += 1
                _alert_logger.info(f"BLOCKED_COOLDOWN | {symbol} | {direction} | "
                                   f"remaining={remaining:.0f}s")
                return

        side = "Buy" if direction == "UP" else "Sell"
        payload = {
            "source": "ZONE_DETECTOR_V2",
            "symbol": symbol,
            "interval": self.config.interval,
            "pattern": {
                "patternType": f"ZONE_BREAKOUT_{direction}",
                "price": trade['entry_price'],
                "confidence": 80,
                "timestamp": trade['breakout_timestamp'],
                "direction": "LONG" if direction == "UP" else "SHORT",
            },
            "custom_stop_loss": trade['sl_price'],
            "custom_take_profit": trade['tp_price'],
        }

        try:
            if self._http_client and not self._http_client.is_closed:
                resp = await self._http_client.post(self.config.alert_target_url, json=payload)
                self._cooldowns[cooldown_key] = now
                self.stats['alerts_sent'] += 1
                _alert_logger.info(f"ALERT_SENT | {symbol} | {direction} | "
                                   f"entry={trade['entry_price']:.2f} | "
                                   f"SL={trade['sl_price']:.2f} | TP={trade['tp_price']:.2f} | "
                                   f"status={resp.status_code}")
        except Exception as e:
            _alert_logger.error(f"ALERT_ERROR | {symbol} | {e}")

    # --------------------------------------------------
    # API Getters
    # --------------------------------------------------

    def get_zones(self, symbol: str) -> List[Dict]:
        detector = self._detectors.get(symbol)
        if not detector:
            return []
        return detector.get_all_zones()

    def get_diagnostics(self, symbol: str, timestamps: Optional[List[int]] = None) -> Dict:
        detector = self._detectors.get(symbol)
        if not detector:
            return {'timestamps': [], 'use_ttm': False}
        return detector.get_diagnostics(timestamps)

    def get_status(self) -> Dict:
        uptime = time.time() - self.stats['start_time'] if self.stats['start_time'] > 0 else 0
        last_ago = round(time.time() - self.stats['last_candle_time']) if self.stats['last_candle_time'] > 0 else 0

        detector_stats = {}
        for sym, det in self._detectors.items():
            detector_stats[sym] = det.get_stats()

        return {
            'enabled': self.config.enabled,
            'running': self.running,
            'uptime_seconds': round(uptime),
            'config': self.config.to_dict(),
            'stats': self.stats.copy(),
            'last_candle_ago_seconds': last_ago,
            'detectors': detector_stats,
            'cooldowns': {
                k: round(self.config.cooldown_minutes * 60 - (time.time() - v))
                for k, v in self._cooldowns.items()
                if time.time() - v < self.config.cooldown_minutes * 60
            },
        }

    def clear_cooldowns(self):
        self._cooldowns.clear()
        logger.info("[ZONE_V2] Cooldowns limpiados")

    async def reset(self):
        """Resetea detectores y recarga warmup."""
        self._detectors.clear()
        self._cooldowns.clear()
        if self.running:
            await self._warmup_all()


# ============================================================
# Singleton
# ============================================================

_instance: Optional[ZoneServiceV2] = None


def get_zone_service_v2() -> ZoneServiceV2:
    global _instance
    if _instance is None:
        _instance = ZoneServiceV2()
    return _instance
