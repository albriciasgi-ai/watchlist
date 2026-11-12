# -*- coding: utf-8 -*-
"""
VWAP Service - Backend Native VWAP Calculator
==============================================
Real-time VWAP calculation with standard deviation bands and volatility indicators.
Replaces frontend calculation with centralized backend service.

Estado por clave (Noviembre 2026)
---------------------------------
- Cada clave (symbol, interval) guarda sus velas, sus puntos VWAP y sus parametros
  (days, vwapType, rollingPeriod). Calcular una clave no cambia las otras ni la config
  global, que queda solo como valores por defecto. Antes habia un solo interval/vwapType
  global: un pedido de 60m poco despues de uno de 15m devolvia puntos de 15m, y los
  cierres de vela de otros intervalos no recalculaban nada.
- Los calculos corren en un hilo (asyncio.to_thread) sobre copias y el resultado se
  asigna al final desde el event loop. Las bandas de sesion, rolling y anchored, y el
  BBWP, son O(n) u O(n log n): 1m x 7 dias pasa de ~21 s a menos de 1 s.
"""

import asyncio
import bisect
import copy
import logging
import time
import json
import math
import aiohttp
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional, Any, Tuple
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Set VWAP service logging to WARNING to reduce noise
logger.setLevel(logging.WARNING)

# Bybit API for historical data
BYBIT_API_URL = "https://api.bybit.com/v5/market/kline"

# Config file path
CONFIG_DIR = Path(__file__).parent / "config"
CONFIG_FILE = CONFIG_DIR / "vwap_config.json"

VALID_INTERVALS = ("1", "3", "5", "15", "30", "60", "120", "240", "360", "720", "D", "W")

# Dias minimos que conviene pedir para el filtro VWAP del Swing: con menos historial la
# primera sesion dura hasta 47 h (no se reinicia hasta 23 h despues de la primera vela) y
# las bandas no son las de una sesion diaria
VWAP_FILTER_MIN_DAYS = 3

# Tope de velas por clave (5m x 400 dias = 115.200). Mas que esto ya no se podia calcular
MAX_CANDLES_PER_KEY = 120_000
# Una clave sin pedidos durante este tiempo se libera (las de config.symbols no)
KEY_IDLE_TTL_SECONDS = 30 * 60
# Tras una carga completa fallida no se reintenta antes de esto (antes: cooldown global de 30 s)
FULL_LOAD_RETRY_SECONDS = 30
# Minimo entre dos pedidos REST incrementales de la misma clave
TAIL_FETCH_MIN_SECONDS = 5
# Una clave se considera atrasada si su ultima vela cerro hace mas de esto
STALE_GRACE_MS = 10_000
# Paginas maximas para rellenar el final; si el hueco es mayor se recarga completa
MAX_TAIL_PAGES = 10
BYBIT_PAGE_LIMIT = 200
HTTP_TIMEOUT_SECONDS = 20

_SESSION_MIN_GAP_MS = 23 * 60 * 60 * 1000
# Desviacion por debajo de esto (relativa al VWAP) es redondeo, no dispersion: con ticks reales
# la menor desviacion posible es ~1e-7 del precio
_NOISE_STD_RATIO = 1e-12


@dataclass
class VWAPServiceConfig:
    """Configuration for VWAP Service"""
    enabled: bool = True
    symbols: List[str] = field(default_factory=lambda: ["BTCUSDT", "ETHUSDT"])
    interval: str = "60"  # Default to 1h (matches frontend default)

    # Historical data loading - minimal initial load, frontend will request more as needed
    historyDays: int = 1  # Start small, frontend will request what it needs

    # VWAP Type: 'session', 'rolling', 'anchored'
    vwapType: str = "session"
    resetHour: int = 0  # UTC hour for session reset
    rollingPeriod: int = 20  # Candles for rolling VWAP
    anchorTimestamp: Optional[int] = None  # For anchored VWAP

    # Bands configuration
    showBands: bool = True
    bandMultipliers: List[float] = field(default_factory=lambda: [1.0, 2.0, 3.0])
    applyCryptoAdjustment: bool = True
    cryptoAdjustmentFactor: float = 1.15

    # Volatility indicators
    showBandWidth: bool = True
    showBBWP: bool = False
    showTTMSqueeze: bool = False

    # BandWidth thresholds (adaptive by timeframe)
    bandWidthThresholds: Dict = field(default_factory=lambda: {
        "squeeze": 2.0,
        "consolidation": 5.0,
        "normal": 10.0
    })

    # BBWP configuration
    bbwpLookback: int = 252
    bbwpThresholds: Dict = field(default_factory=lambda: {
        "squeeze": 20,
        "normal": 80
    })

    # TTM Squeeze configuration
    ttmATRLength: int = 20
    ttmATRMultiplier: float = 1.5


def get_default_bandwidth_thresholds(interval: str) -> Dict:
    """Get recommended BandWidth thresholds based on timeframe"""
    thresholds = {
        '1': {'squeeze': 8, 'consolidation': 12, 'normal': 18},
        '3': {'squeeze': 6, 'consolidation': 10, 'normal': 15},
        '5': {'squeeze': 5, 'consolidation': 8, 'normal': 12},
        '15': {'squeeze': 3.5, 'consolidation': 6, 'normal': 10},
        '30': {'squeeze': 3, 'consolidation': 5, 'normal': 8},
        '60': {'squeeze': 2.5, 'consolidation': 4.5, 'normal': 7},
        '240': {'squeeze': 2, 'consolidation': 4, 'normal': 6},
        'D': {'squeeze': 1.5, 'consolidation': 3, 'normal': 5},
        'W': {'squeeze': 1, 'consolidation': 2, 'normal': 4}
    }
    return thresholds.get(interval, {'squeeze': 2, 'consolidation': 5, 'normal': 10})


def _sanitize_config(cfg: VWAPServiceConfig) -> VWAPServiceConfig:
    """Enteros que llegan como 252.0 desde JSON: con float el slicing fallaba."""
    for name in ('rollingPeriod', 'bbwpLookback', 'ttmATRLength', 'resetHour', 'historyDays'):
        value = getattr(cfg, name, None)
        if isinstance(value, float) and value.is_integer():
            setattr(cfg, name, int(value))
    if cfg.interval is not None:
        cfg.interval = str(cfg.interval)
    return cfg


@dataclass
class VWAPPoint:
    """Single VWAP data point"""
    timestamp: int
    vwap: float
    typical_price: float
    volume: float
    cumulative_volume: float
    cumulative_pv: float

    # Bands
    upper_1: Optional[float] = None
    lower_1: Optional[float] = None
    upper_2: Optional[float] = None
    lower_2: Optional[float] = None
    upper_3: Optional[float] = None
    lower_3: Optional[float] = None
    std_dev: Optional[float] = None

    # Volatility indicators
    bandwidth: Optional[float] = None
    bandwidth_state: Optional[str] = None
    bbwp: Optional[float] = None
    bbwp_state: Optional[str] = None
    squeeze: Optional[bool] = None
    squeeze_state: Optional[str] = None

    def to_dict(self) -> Dict:
        return {
            'timestamp': self.timestamp,
            'vwap': self.vwap,
            'typical_price': self.typical_price,
            'volume': self.volume,
            'bands': {
                'upper_1': self.upper_1,
                'lower_1': self.lower_1,
                'upper_2': self.upper_2,
                'lower_2': self.lower_2,
                'upper_3': self.upper_3,
                'lower_3': self.lower_3,
            },
            'std_dev': self.std_dev,
            'bandwidth': self.bandwidth,
            'bandwidth_state': self.bandwidth_state,
            'bbwp': self.bbwp,
            'bbwp_state': self.bbwp_state,
            'squeeze': self.squeeze,
            'squeeze_state': self.squeeze_state
        }


def _typical_prices_and_volumes(candles: List[Dict]) -> Tuple[List[float], List[float]]:
    """Precio tipico y volumen de cada vela, con las mismas expresiones de siempre."""
    tps = []
    vols = []
    for c in candles:
        high = c.get('high') or (c.high if hasattr(c, 'high') else 0)
        low = c.get('low') or (c.low if hasattr(c, 'low') else 0)
        close = c.get('close') or (c.close if hasattr(c, 'close') else 0)
        volume = c.get('volume') or (c.volume if hasattr(c, 'volume') else 0)
        tps.append((high + low + close) / 3.0)
        vols.append(volume)
    return tps, vols


def _exact_prefix_sums(tps: List[float], vols: List[float], with_squares: bool = True):
    """Sumas acumuladas EXACTAS de v, p*v y p*p*v, como enteros escalados por 2^k0, 2^k1 y 2^k2.

    Con enteros la resta de dos sumas acumuladas no tiene error: la suma de cualquier ventana
    sale en O(1) y no depende de donde empieza. Dos ventanas con las mismas velas con volumen
    dan exactamente el mismo resultado, igual que la suma de izquierda a derecha de antes
    (eso conserva los empates que cuenta el BBWP). None si hay valores no finitos.
    """
    try:
        p_ratios = [float(tp).as_integer_ratio() for tp in tps]
        v_ratios = [float(v).as_integer_ratio() for v in vols]
    except (OverflowError, ValueError, TypeError):
        return None
    n = len(p_ratios)
    kp = [den.bit_length() - 1 for _, den in p_ratios]
    kv = [den.bit_length() - 1 for _, den in v_ratios]
    k0 = max(kv, default=0)
    k1 = max((kp[j] + kv[j] for j in range(n)), default=0)
    k2 = max((2 * kp[j] + kv[j] for j in range(n)), default=0) if with_squares else 0

    p0 = [0] * (n + 1)
    p1 = [0] * (n + 1)
    p2 = [0] * (n + 1) if with_squares else None
    s0 = s1 = s2 = 0
    for j in range(n):
        vn = v_ratios[j][0]
        if vn:
            pn = p_ratios[j][0]
            pv = pn * vn
            s0 += vn << (k0 - kv[j])
            s1 += pv << (k1 - kp[j] - kv[j])
            if with_squares:
                s2 += (pv * pn) << (k2 - 2 * kp[j] - kv[j])
        p0[j + 1] = s0
        p1[j + 1] = s1
        if with_squares:
            p2[j + 1] = s2
    return p0, p1, p2, k0, k1, k2


class VWAPCalculator:
    """Core VWAP calculation engine"""

    def __init__(self, config: VWAPServiceConfig):
        self.config = config

    def update_config(self, config: VWAPServiceConfig):
        self.config = config

    def calculate(self, candles: List[Dict]) -> List[VWAPPoint]:
        """Calculate VWAP with bands and volatility indicators"""
        if not candles or len(candles) == 0:
            return []

        # Step 1: Calculate base VWAP
        if self.config.vwapType == 'session':
            vwap_points = self._calculate_session_vwap(candles)
        elif self.config.vwapType == 'rolling':
            vwap_points = self._calculate_rolling_vwap(candles)
        elif self.config.vwapType == 'anchored':
            vwap_points = self._calculate_anchored_vwap(candles)
        else:
            vwap_points = self._calculate_session_vwap(candles)

        # Step 2: Calculate standard deviation bands
        if self.config.showBands:
            self._calculate_std_bands(candles, vwap_points)

        # Step 3: Calculate volatility indicators (always calculate for availability)
        self._calculate_bandwidth(vwap_points)
        self._calculate_bbwp(vwap_points)
        self._calculate_ttm_squeeze(candles, vwap_points)

        return vwap_points

    def _calculate_session_vwap(self, candles: List[Dict]) -> List[VWAPPoint]:
        """Calculate session VWAP with daily reset"""
        points = []
        cumulative_pv = 0.0
        cumulative_volume = 0.0
        session_start_ts = None

        for candle in candles:
            timestamp = candle.get('timestamp') or candle.get('open_time', 0)
            if hasattr(candle, 'timestamp'):
                timestamp = candle.timestamp

            # Check for session reset
            dt_utc = datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc)
            current_hour = dt_utc.hour

            if session_start_ts is None or current_hour == self.config.resetHour:
                if session_start_ts is None:
                    cumulative_pv = 0.0
                    cumulative_volume = 0.0
                    session_start_ts = timestamp
                else:
                    time_since_session = timestamp - session_start_ts
                    if time_since_session >= (23 * 60 * 60 * 1000):
                        cumulative_pv = 0.0
                        cumulative_volume = 0.0
                        session_start_ts = timestamp

            # Get OHLCV
            high = candle.get('high') or (candle.high if hasattr(candle, 'high') else 0)
            low = candle.get('low') or (candle.low if hasattr(candle, 'low') else 0)
            close = candle.get('close') or (candle.close if hasattr(candle, 'close') else 0)
            volume = candle.get('volume') or (candle.volume if hasattr(candle, 'volume') else 0)

            typical_price = (high + low + close) / 3.0

            cumulative_pv += typical_price * volume
            cumulative_volume += volume

            vwap = cumulative_pv / cumulative_volume if cumulative_volume > 0 else typical_price

            points.append(VWAPPoint(
                timestamp=timestamp,
                vwap=vwap,
                typical_price=typical_price,
                volume=volume,
                cumulative_volume=cumulative_volume,
                cumulative_pv=cumulative_pv
            ))

        return points

    def _calculate_rolling_vwap(self, candles: List[Dict]) -> List[VWAPPoint]:
        """Calculate rolling VWAP with fixed window.

        Misma ventana de siempre (las ultimas rollingPeriod velas), en O(n): las sumas de cada
        ventana salen de sumas acumuladas exactas (ver _exact_prefix_sums).
        """
        period = self.config.rollingPeriod
        tps, vols = _typical_prices_and_volumes(candles)
        sums = _exact_prefix_sums(tps, vols, with_squares=False)
        if sums is None:
            return self._calculate_rolling_vwap_scan(candles)
        p0, p1, _, k0, k1, _ = sums
        scale_v = 1 << k0
        scale_pv = 1 << k1
        shift = k0 - k1

        points = []
        for i, candle in enumerate(candles):
            start = i - period + 1
            if start < 0:
                start = 0
            if start > i + 1:
                start = i + 1
            a0 = p0[i + 1] - p0[start]
            a1 = p1[i + 1] - p1[start]
            cumulative_volume = a0 / scale_v
            cumulative_pv = a1 / scale_pv

            timestamp = candle.get('timestamp') or candle.get('open_time', 0)
            if hasattr(candle, 'timestamp'):
                timestamp = candle.timestamp

            tp = tps[i]
            if a0 > 0:
                vwap = (a1 << shift) / a0 if shift >= 0 else a1 / (a0 << -shift)
            else:
                vwap = tp

            points.append(VWAPPoint(
                timestamp=timestamp,
                vwap=vwap,
                typical_price=tp,
                volume=vols[i],
                cumulative_volume=cumulative_volume,
                cumulative_pv=cumulative_pv
            ))

        return points

    def _calculate_rolling_vwap_scan(self, candles: List[Dict]) -> List[VWAPPoint]:
        """Version anterior (suma cada ventana). Solo para datos con valores no finitos."""
        points = []
        period = self.config.rollingPeriod

        for i in range(len(candles)):
            start_idx = max(0, i - period + 1)
            window = candles[start_idx:i + 1]

            cumulative_pv = 0.0
            cumulative_volume = 0.0

            for c in window:
                high = c.get('high') or (c.high if hasattr(c, 'high') else 0)
                low = c.get('low') or (c.low if hasattr(c, 'low') else 0)
                close = c.get('close') or (c.close if hasattr(c, 'close') else 0)
                volume = c.get('volume') or (c.volume if hasattr(c, 'volume') else 0)

                tp = (high + low + close) / 3.0
                cumulative_pv += tp * volume
                cumulative_volume += volume

            candle = candles[i]
            timestamp = candle.get('timestamp') or candle.get('open_time', 0)
            if hasattr(candle, 'timestamp'):
                timestamp = candle.timestamp

            high = candle.get('high') or (candle.high if hasattr(candle, 'high') else 0)
            low = candle.get('low') or (candle.low if hasattr(candle, 'low') else 0)
            close = candle.get('close') or (candle.close if hasattr(candle, 'close') else 0)
            volume = candle.get('volume') or (candle.volume if hasattr(candle, 'volume') else 0)

            typical_price = (high + low + close) / 3.0
            vwap = cumulative_pv / cumulative_volume if cumulative_volume > 0 else typical_price

            points.append(VWAPPoint(
                timestamp=timestamp,
                vwap=vwap,
                typical_price=typical_price,
                volume=volume,
                cumulative_volume=cumulative_volume,
                cumulative_pv=cumulative_pv
            ))

        return points

    def _calculate_anchored_vwap(self, candles: List[Dict]) -> List[VWAPPoint]:
        """Calculate anchored VWAP from specific timestamp"""
        points = []

        # Find anchor index
        anchor_idx = 0
        if self.config.anchorTimestamp:
            for i, candle in enumerate(candles):
                ts = candle.get('timestamp') or candle.get('open_time', 0)
                if hasattr(candle, 'timestamp'):
                    ts = candle.timestamp
                if ts >= self.config.anchorTimestamp:
                    anchor_idx = i
                    break

        cumulative_pv = 0.0
        cumulative_volume = 0.0

        for i in range(anchor_idx, len(candles)):
            candle = candles[i]
            timestamp = candle.get('timestamp') or candle.get('open_time', 0)
            if hasattr(candle, 'timestamp'):
                timestamp = candle.timestamp

            high = candle.get('high') or (candle.high if hasattr(candle, 'high') else 0)
            low = candle.get('low') or (candle.low if hasattr(candle, 'low') else 0)
            close = candle.get('close') or (candle.close if hasattr(candle, 'close') else 0)
            volume = candle.get('volume') or (candle.volume if hasattr(candle, 'volume') else 0)

            typical_price = (high + low + close) / 3.0

            cumulative_pv += typical_price * volume
            cumulative_volume += volume

            vwap = cumulative_pv / cumulative_volume if cumulative_volume > 0 else typical_price

            points.append(VWAPPoint(
                timestamp=timestamp,
                vwap=vwap,
                typical_price=typical_price,
                volume=volume,
                cumulative_volume=cumulative_volume,
                cumulative_pv=cumulative_pv
            ))

        return points

    def _session_band_starts(self, candles: List[Dict]) -> Optional[List[int]]:
        """Inicio de la ventana de bandas de cada vela en modo session, en O(n).

        Es la misma regla de siempre: la ultima vela j (j >= 1, j < i) con hora == resetHour
        que esta al menos 23 h antes de la vela i; si no hay, la vela 0. Esa ventana cruza la
        sesion anterior (no es la sesion del VWAP) y se conserva asi para no cambiar lo dibujado.
        Devuelve None si los timestamps no son estrictamente crecientes.
        """
        n = len(candles)
        ts_list = []
        for c in candles:
            ts_list.append(c.get('timestamp') or (c.timestamp if hasattr(c, 'timestamp') else 0))
        for k in range(1, n):
            if not ts_list[k] > ts_list[k - 1]:
                return None

        reset_hour = self.config.resetHour
        candidates = []
        for j in range(1, n):
            if datetime.fromtimestamp(ts_list[j] / 1000, tz=timezone.utc).hour == reset_hour:
                candidates.append(j)

        starts = [0] * n
        best = 0
        p = 0
        n_cand = len(candidates)
        for i in range(n):
            limit = ts_list[i] - _SESSION_MIN_GAP_MS
            while p < n_cand and candidates[p] < i and ts_list[candidates[p]] <= limit:
                best = candidates[p]
                p += 1
            starts[i] = best
        return starts

    def _calculate_std_bands(self, candles: List[Dict], vwap_points: List[VWAPPoint]):
        """Calculate standard deviation bands.

        Mismas ventanas que antes, en O(n):
        - rolling: las ultimas rollingPeriod velas
        - session: ver _session_band_starts()
        - otro tipo: desde la primera vela
        La varianza alrededor del VWAP del punto, sum(v*(p - vwap)^2) / sum(v), se arma con las
        sumas exactas de la ventana (sum v, sum p*v, sum p*p*v en enteros, ver _exact_prefix_sums)
        y se redondea una sola vez: no hay cancelacion y el resultado no depende de la ventana anterior.
        """
        if len(candles) != len(vwap_points):
            logger.warning(f"Candle/VWAP length mismatch: {len(candles)} vs {len(vwap_points)}")
            return

        vwap_type = self.config.vwapType
        starts = None
        if vwap_type == 'session':
            starts = self._session_band_starts(candles)
            if starts is None:
                # Timestamps fuera de orden: la ventana deja de avanzar en un solo sentido
                self._calculate_std_bands_scan(candles, vwap_points)
                return
        period = self.config.rollingPeriod if vwap_type == 'rolling' else None

        tps, vols = _typical_prices_and_volumes(candles)
        sums = _exact_prefix_sums(tps, vols)
        if sums is None:
            self._calculate_std_bands_scan(candles, vwap_points)
            return
        p0, p1, p2, k0, k1, k2 = sums

        # Apply crypto adjustment if enabled
        multipliers = self.config.bandMultipliers.copy()
        if self.config.applyCryptoAdjustment:
            multipliers = [m * self.config.cryptoAdjustmentFactor for m in multipliers]
        n_mult = len(multipliers)

        for i, point in enumerate(vwap_points):
            if period is not None:
                s = i - period + 1
                if s < 0:
                    s = 0
            elif starts is not None:
                s = starts[i]
            else:
                s = 0
            if s > i + 1:
                s = i + 1

            vwap_value = point.vwap

            if i - s + 1 < 2:
                point.upper_1 = vwap_value
                point.lower_1 = vwap_value
                point.upper_2 = vwap_value
                point.lower_2 = vwap_value
                point.upper_3 = vwap_value
                point.lower_3 = vwap_value
                point.std_dev = 0
                continue

            a0 = p0[i + 1] - p0[s]
            if a0 > 0:
                try:
                    m_num, m_den = float(vwap_value).as_integer_ratio()
                except (OverflowError, ValueError):
                    m_num = None
                if m_num is None:
                    vwap_value, std_dev = self._scan_window_point(candles, point, s, i, period is not None)
                else:
                    a1 = p1[i + 1] - p1[s]
                    a2 = p2[i + 1] - p2[s]
                    km = m_den.bit_length() - 1
                    # sum v*(p - m)^2 = sum p*p*v - 2*m*sum p*v + m*m*sum v, exacto con denominador 2^d
                    d = max(k2, k1 + km, k0 + 2 * km)
                    numerator = ((a2 << (d - k2))
                                 - ((2 * m_num * a1) << (d - k1 - km))
                                 + ((m_num * m_num * a0) << (d - k0 - 2 * km)))
                    variance = numerator / (a0 << (d - k0)) if numerator > 0 else 0.0
                    std_dev = math.sqrt(variance)
            else:
                variance = 0
                std_dev = math.sqrt(variance)

            if a0 > 0 and std_dev <= _NOISE_STD_RATIO * abs(vwap_value):
                # Ventana sin dispersion real (un solo precio con volumen): la desviacion es solo
                # redondeo y el BBWP ordenaria ese ruido. Se repite el calculo anterior del punto
                vwap_value, std_dev = self._scan_window_point(candles, point, s, i, period is not None)

            point.std_dev = std_dev

            # Set bands
            if n_mult >= 1:
                point.upper_1 = vwap_value + (std_dev * multipliers[0])
                point.lower_1 = vwap_value - (std_dev * multipliers[0])
            if n_mult >= 2:
                point.upper_2 = vwap_value + (std_dev * multipliers[1])
                point.lower_2 = vwap_value - (std_dev * multipliers[1])
            if n_mult >= 3:
                point.upper_3 = vwap_value + (std_dev * multipliers[2])
                point.lower_3 = vwap_value - (std_dev * multipliers[2])

    def _scan_window_point(self, candles: List[Dict], point: VWAPPoint, start_idx: int, i: int,
                           rolling: bool) -> Tuple[float, float]:
        """Calculo anterior de UN punto (ventana sin dispersion): devuelve (vwap, std) identicos a antes."""
        window_candles = candles[start_idx:i + 1]
        if rolling:
            # El VWAP rolling anterior sumaba la ventana de izquierda a derecha
            cumulative_pv = 0.0
            cumulative_volume = 0.0
            for c in window_candles:
                high = c.get('high') or (c.high if hasattr(c, 'high') else 0)
                low = c.get('low') or (c.low if hasattr(c, 'low') else 0)
                close = c.get('close') or (c.close if hasattr(c, 'close') else 0)
                volume = c.get('volume') or (c.volume if hasattr(c, 'volume') else 0)

                tp = (high + low + close) / 3.0
                cumulative_pv += tp * volume
                cumulative_volume += volume
            point.vwap = cumulative_pv / cumulative_volume if cumulative_volume > 0 else point.typical_price
            point.cumulative_volume = cumulative_volume
            point.cumulative_pv = cumulative_pv

        vwap_value = point.vwap
        total_weighted_sq_diff = 0.0
        total_volume = 0.0
        for c in window_candles:
            high = c.get('high') or (c.high if hasattr(c, 'high') else 0)
            low = c.get('low') or (c.low if hasattr(c, 'low') else 0)
            close = c.get('close') or (c.close if hasattr(c, 'close') else 0)
            volume = c.get('volume') or (c.volume if hasattr(c, 'volume') else 0)

            tp = (high + low + close) / 3.0
            sq_diff = (tp - vwap_value) ** 2
            total_weighted_sq_diff += sq_diff * volume
            total_volume += volume

        variance = total_weighted_sq_diff / total_volume if total_volume > 0 else 0
        return vwap_value, math.sqrt(variance)

    def _calculate_std_bands_scan(self, candles: List[Dict], vwap_points: List[VWAPPoint]):
        """Version anterior (recorre la ventana de cada punto). Solo para timestamps fuera de orden."""
        multipliers = self.config.bandMultipliers.copy()
        if self.config.applyCryptoAdjustment:
            multipliers = [m * self.config.cryptoAdjustmentFactor for m in multipliers]

        for i, point in enumerate(vwap_points):
            vwap_value = point.vwap

            # Determine window based on VWAP type
            if self.config.vwapType == 'rolling':
                start_idx = max(0, i - self.config.rollingPeriod + 1)
                window_candles = candles[start_idx:i + 1]
            elif self.config.vwapType == 'session':
                # Find session start
                start_idx = 0
                for j in range(i, -1, -1):
                    if j == 0:
                        start_idx = 0
                        break
                    ts = candles[j].get('timestamp') or (candles[j].timestamp if hasattr(candles[j], 'timestamp') else 0)
                    dt = datetime.fromtimestamp(ts / 1000, tz=timezone.utc)
                    if dt.hour == self.config.resetHour and j < i:
                        prev_ts = candles[i].get('timestamp') or (candles[i].timestamp if hasattr(candles[i], 'timestamp') else 0)
                        if prev_ts - ts >= (23 * 60 * 60 * 1000):
                            start_idx = j
                            break
                window_candles = candles[start_idx:i + 1]
            else:
                window_candles = candles[:i + 1]

            if len(window_candles) < 2:
                point.upper_1 = vwap_value
                point.lower_1 = vwap_value
                point.upper_2 = vwap_value
                point.lower_2 = vwap_value
                point.upper_3 = vwap_value
                point.lower_3 = vwap_value
                point.std_dev = 0
                continue

            # Calculate weighted variance
            total_weighted_sq_diff = 0.0
            total_volume = 0.0

            for c in window_candles:
                high = c.get('high') or (c.high if hasattr(c, 'high') else 0)
                low = c.get('low') or (c.low if hasattr(c, 'low') else 0)
                close = c.get('close') or (c.close if hasattr(c, 'close') else 0)
                volume = c.get('volume') or (c.volume if hasattr(c, 'volume') else 0)

                tp = (high + low + close) / 3.0
                sq_diff = (tp - vwap_value) ** 2
                total_weighted_sq_diff += sq_diff * volume
                total_volume += volume

            variance = total_weighted_sq_diff / total_volume if total_volume > 0 else 0
            std_dev = math.sqrt(variance)

            point.std_dev = std_dev

            # Set bands
            if len(multipliers) >= 1:
                point.upper_1 = vwap_value + (std_dev * multipliers[0])
                point.lower_1 = vwap_value - (std_dev * multipliers[0])
            if len(multipliers) >= 2:
                point.upper_2 = vwap_value + (std_dev * multipliers[1])
                point.lower_2 = vwap_value - (std_dev * multipliers[1])
            if len(multipliers) >= 3:
                point.upper_3 = vwap_value + (std_dev * multipliers[2])
                point.lower_3 = vwap_value - (std_dev * multipliers[2])

    def _calculate_bandwidth(self, vwap_points: List[VWAPPoint]):
        """Calculate BandWidth indicator"""
        thresholds = self.config.bandWidthThresholds

        for point in vwap_points:
            if point.upper_1 is None or point.lower_1 is None or point.vwap == 0:
                point.bandwidth = 0
                point.bandwidth_state = 'unknown'
                continue

            bandwidth = ((point.upper_1 - point.lower_1) / point.vwap) * 100
            point.bandwidth = bandwidth

            # Determine state
            if bandwidth < thresholds.get('squeeze', 2):
                point.bandwidth_state = 'squeeze'
            elif bandwidth < thresholds.get('consolidation', 5):
                point.bandwidth_state = 'consolidation'
            elif bandwidth < thresholds.get('normal', 10):
                point.bandwidth_state = 'normal'
            else:
                point.bandwidth_state = 'trending'

    def _calculate_bbwp(self, vwap_points: List[VWAPPoint]):
        """Calculate BandWidth Percentile (BBWP).

        Mismo percentil de siempre (cuantos BandWidth de la ventana son menores que el actual),
        con la ventana ordenada y busqueda binaria: O(n log L) en vez de O(n x L).
        """
        lookback = min(self.config.bbwpLookback, len(vwap_points))
        bandwidths = [p.bandwidth for p in vwap_points]
        # La ventana ordenada exige numeros comparables: con None o NaN se usa el recorrido anterior
        if (not isinstance(lookback, int) or lookback < 1
                or any(bw is None or bw != bw for bw in bandwidths)):
            self._calculate_bbwp_scan(vwap_points)
            return

        thresholds = self.config.bbwpThresholds
        squeeze_limit = thresholds.get('squeeze', 20)
        normal_limit = thresholds.get('normal', 80)
        window = []
        for i, point in enumerate(vwap_points):
            bw = bandwidths[i]
            bisect.insort(window, bw)
            if i >= lookback:
                del window[bisect.bisect_left(window, bandwidths[i - lookback])]

            count_below = bisect.bisect_left(window, bw)
            percentile = (count_below / len(window)) * 100

            point.bbwp = percentile

            # Determine state
            if percentile < squeeze_limit:
                point.bbwp_state = 'squeeze'
            elif percentile < normal_limit:
                point.bbwp_state = 'normal'
            else:
                point.bbwp_state = 'trending'

    def _calculate_bbwp_scan(self, vwap_points: List[VWAPPoint]):
        """BBWP recorriendo la ventana de cada punto (version anterior)."""
        lookback = min(self.config.bbwpLookback, len(vwap_points))
        thresholds = self.config.bbwpThresholds

        for i, point in enumerate(vwap_points):
            if point.bandwidth is None:
                point.bbwp = 0
                point.bbwp_state = 'unknown'
                continue

            start_idx = max(0, i - lookback + 1)
            historical_bws = [p.bandwidth for p in vwap_points[start_idx:i + 1] if p.bandwidth is not None]

            if len(historical_bws) == 0:
                point.bbwp = 0
                point.bbwp_state = 'unknown'
                continue

            count_below = sum(1 for bw in historical_bws if bw < point.bandwidth)
            percentile = (count_below / len(historical_bws)) * 100

            point.bbwp = percentile

            # Determine state
            if percentile < thresholds.get('squeeze', 20):
                point.bbwp_state = 'squeeze'
            elif percentile < thresholds.get('normal', 80):
                point.bbwp_state = 'normal'
            else:
                point.bbwp_state = 'trending'

    def _calculate_ttm_squeeze(self, candles: List[Dict], vwap_points: List[VWAPPoint]):
        """Calculate TTM Squeeze (BB inside Keltner Channels)"""
        atr_length = self.config.ttmATRLength
        atr_mult = self.config.ttmATRMultiplier

        # Calculate ATR
        atr_values = self._calculate_atr(candles, atr_length)

        for i, point in enumerate(vwap_points):
            if i >= len(atr_values) or point.upper_1 is None or point.lower_1 is None:
                point.squeeze = False
                point.squeeze_state = 'off'
                continue

            atr = atr_values[i]

            # Bollinger Bands (VWAP std dev bands)
            bb_upper = point.upper_1
            bb_lower = point.lower_1

            # Keltner Channels
            kc_upper = point.vwap + (atr * atr_mult)
            kc_lower = point.vwap - (atr * atr_mult)

            # Squeeze ON when BB inside KC
            squeeze = (bb_upper < kc_upper) and (bb_lower > kc_lower)

            point.squeeze = squeeze
            point.squeeze_state = 'on' if squeeze else 'off'

    def _calculate_atr(self, candles: List[Dict], length: int) -> List[float]:
        """Calculate Average True Range"""
        atr_values = []
        true_ranges = []

        for i, candle in enumerate(candles):
            high = candle.get('high') or (candle.high if hasattr(candle, 'high') else 0)
            low = candle.get('low') or (candle.low if hasattr(candle, 'low') else 0)

            if i == 0:
                tr = high - low
            else:
                prev_close = candles[i-1].get('close') or (candles[i-1].close if hasattr(candles[i-1], 'close') else 0)
                tr = max(high - low, abs(high - prev_close), abs(low - prev_close))

            true_ranges.append(tr)

            if i >= length - 1:
                atr = sum(true_ranges[i - length + 1:i + 1]) / length
            else:
                atr = tr

            atr_values.append(atr)

        return atr_values


# ----------------------------------------------------------------------------------------
# Funciones que corren en el hilo de calculo: solo leen sus argumentos y devuelven resultados
# ----------------------------------------------------------------------------------------

def _candle_values(c: Dict) -> tuple:
    return (c.get('open'), c.get('high'), c.get('low'), c.get('close'), c.get('volume'))


def _merge_candles(base: List[Dict], new_candles: List[Dict], normalize_base: bool,
                   trim: Optional[Tuple[int, int]]) -> Tuple[List[Dict], bool]:
    """Une velas por timestamp (las nuevas pisan a las viejas) y devuelve una lista NUEVA.

    No modifica `base` ni sus diccionarios. Si nada cambia devuelve `base` tal cual.
    """
    changed = False
    if normalize_base or new_candles:
        by_ts = {}
        for c in base:
            by_ts[c['timestamp']] = c
        if normalize_base:
            changed = True
        for c in new_candles:
            ts = c.get('timestamp')
            if ts is None:
                continue
            old = by_ts.get(ts)
            if old is not c and (old is None or _candle_values(old) != _candle_values(c)):
                by_ts[ts] = c
                changed = True
        merged = sorted(by_ts.values(), key=lambda x: x['timestamp']) if changed else base
    else:
        merged = base

    if trim is not None:
        threshold, keep = trim
        if len(merged) > threshold:
            merged = merged[-keep:]
            changed = True
    return merged, changed


def _merge_and_compute(base: List[Dict], new_candles: List[Dict], normalize_base: bool,
                       cfg: VWAPServiceConfig, trim: Optional[Tuple[int, int]], need_compute: bool):
    """Hilo de calculo: une velas y calcula el VWAP sobre la copia. Devuelve (velas, cambio, datos, error)."""
    merged, changed = _merge_candles(base, new_candles, normalize_base, trim)
    if not (changed or need_compute) or len(merged) < 5:
        return merged, changed, None, None
    try:
        points = VWAPCalculator(cfg).calculate(merged)
        data = [p.to_dict() for p in points]
    except Exception as e:  # el error se registra desde el event loop
        return merged, changed, None, e
    return merged, changed, data, None


def _calc_signature(cfg: VWAPServiceConfig) -> str:
    """Todo lo que cambia el resultado del calculo (no incluye symbols, enabled ni flags de UI)."""
    fields = [
        cfg.vwapType, cfg.rollingPeriod, cfg.resetHour, cfg.anchorTimestamp, cfg.showBands,
        list(cfg.bandMultipliers or []), cfg.applyCryptoAdjustment, cfg.cryptoAdjustmentFactor,
        cfg.bandWidthThresholds, cfg.bbwpLookback, cfg.bbwpThresholds,
        cfg.ttmATRLength, cfg.ttmATRMultiplier,
    ]
    return json.dumps(fields, sort_keys=True, default=str)


class _VWAPKeyState:
    """Estado de una clave (symbol, interval). Solo se modifica desde el event loop."""

    def __init__(self, symbol: str, interval: str, vwap_type: str, rolling_period: int):
        self.symbol = symbol
        self.interval = interval
        self.days = 0                      # dias de la ultima carga completa
        self.vwap_type = vwap_type
        self.rolling_period = rolling_period
        self.candles: List[Dict] = []      # ordenadas y unicas; se reemplaza la lista, no se edita
        self.candles_version = 0
        self.data: List[Dict] = []         # puntos (to_dict); se reemplaza la lista, no se edita
        self.data_version = -1
        self.data_signature: Optional[str] = None
        self.params: Dict[str, Any] = {}   # parametros con que se calcularon los puntos
        self.full_load_ok = False          # la ultima carga completa trajo velas
        self.full_load_complete = False    # ... y llego a los dias pedidos (o al inicio del historial)
        self.last_full_attempt = 0.0
        self.last_tail_fetch = 0.0
        self.last_update = 0.0
        self.last_access = time.time()
        self.lock = asyncio.Lock()
        self.loading_task: Optional[asyncio.Task] = None
        self.loading_days = 0
        self.busy = 0


class VWAPService:
    """
    VWAP Service - Manages real-time VWAP calculation for multiple symbols.
    Estado independiente por clave (symbol, interval); self.config son los valores por defecto.
    """

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return

        self.config = self._load_config()
        self.calculator = VWAPCalculator(self.config)
        self.ws_manager = None
        self.running = False
        self.start_time = None

        # Estado por clave (SYMBOL, interval)
        self._keys: Dict[Tuple[str, str], _VWAPKeyState] = {}
        self._tasks = set()
        self._last_eviction = 0.0

        # Stats
        self.stats = {
            'calculations': 0,
            'last_update': {},
            'candles_loaded': {}
        }

        self._initialized = True
        logger.info("[VWAP_SERVICE] Initialized")

    def _load_config(self) -> VWAPServiceConfig:
        """Load config from file or use defaults"""
        try:
            if CONFIG_FILE.exists():
                with open(CONFIG_FILE, 'r') as f:
                    data = json.load(f)
                    # Update bandWidthThresholds based on interval
                    if 'interval' in data and 'bandWidthThresholds' not in data:
                        data['bandWidthThresholds'] = get_default_bandwidth_thresholds(data['interval'])
                    cfg = _sanitize_config(VWAPServiceConfig(**data))
                    if cfg.interval not in VALID_INTERVALS:
                        logger.warning(f"[VWAP_SERVICE] Invalid interval in config ({cfg.interval}), using 60")
                        cfg.interval = "60"
                    return cfg
        except Exception as e:
            logger.error(f"[VWAP_SERVICE] Error loading config: {e}")

        return VWAPServiceConfig()

    def _save_config(self):
        """Save current config to file"""
        try:
            CONFIG_DIR.mkdir(parents=True, exist_ok=True)
            with open(CONFIG_FILE, 'w') as f:
                json.dump(asdict(self.config), f, indent=2)
            logger.info("[VWAP_SERVICE] Config saved")
        except Exception as e:
            logger.error(f"[VWAP_SERVICE] Error saving config: {e}")

    # ------------------------------------------------------------------ ciclo de vida

    def _spawn(self, coro):
        """Crea una tarea y guarda la referencia (sin referencia la tarea puede perderse)."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            try:
                loop = asyncio.get_event_loop()
            except Exception as e:
                coro.close()
                logger.error(f"[VWAP_SERVICE] Could not schedule task: {e}")
                return None
        task = loop.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    async def start(self, ws_manager=None):
        """Start the VWAP service"""
        if self.running:
            logger.warning("[VWAP_SERVICE] Already running")
            return

        self.ws_manager = ws_manager
        self.running = True
        self.start_time = time.time()

        # Register for candle close events
        if self.ws_manager:
            self.ws_manager.add_candle_close_listener(self._sync_candle_close_handler)
            logger.info("[VWAP_SERVICE] Registered candle close listener")

        # Load historical data in background (non-blocking)
        logger.info(f"[VWAP_SERVICE] Starting background load of {self.config.historyDays} day(s) historical data...")
        self._spawn(self._background_init())

        logger.info(f"[VWAP_SERVICE] Started for symbols: {self.config.symbols}")

    async def _background_init(self):
        """Background initialization - load historical data without blocking startup"""
        try:
            await self._load_historical_data()
            logger.info("[VWAP_SERVICE] Background initialization complete")
        except Exception as e:
            logger.error(f"[VWAP_SERVICE] Background init error: {e}")

    async def stop(self):
        """Stop the VWAP service"""
        if not self.running:
            return

        self.running = False

        if self.ws_manager:
            self.ws_manager.remove_candle_close_listener(self._sync_candle_close_handler)

        logger.info("[VWAP_SERVICE] Stopped")

    async def _load_historical_data(self):
        """Carga las claves por defecto: config.symbols @ config.interval con config.historyDays."""
        for symbol in list(self.config.symbols or []):
            try:
                data = await self.ensure_vwap_data(symbol, self.config.interval, days=self.config.historyDays)
                logger.info(f"[VWAP_SERVICE] {symbol}@{self.config.interval}: {len(data)} VWAP points")
            except Exception as e:
                logger.error(f"[VWAP_SERVICE] {symbol}: Error loading historical data: {e}")

    # ------------------------------------------------------------------ claves

    def _normalize_key(self, symbol: str, interval: Optional[str] = None) -> Tuple[str, str]:
        sym = str(symbol or '').strip().upper()
        if interval is None or str(interval).strip() == '':
            iv = str(self.config.interval)
        else:
            iv = str(interval).strip()
        return sym, iv

    def _get_or_create_state(self, symbol: str, interval: str) -> _VWAPKeyState:
        key = (symbol, interval)
        st = self._keys.get(key)
        if st is None:
            st = _VWAPKeyState(symbol, interval, self.config.vwapType, self.config.rollingPeriod)
            self._keys[key] = st
        return st

    def _evict_idle_keys(self):
        """Libera claves sin pedidos (se revisa como mucho una vez por minuto)."""
        now = time.time()
        if now - self._last_eviction < 60:
            return
        self._last_eviction = now
        pinned = {self._normalize_key(s, self.config.interval) for s in (self.config.symbols or [])}
        for key, st in list(self._keys.items()):
            if key in pinned or st.busy or st.lock.locked():
                continue
            if st.loading_task is not None and not st.loading_task.done():
                continue
            ttl = max(KEY_IDLE_TTL_SECONDS, 3 * self._interval_to_minutes(st.interval) * 60)
            if now - st.last_access > ttl:
                del self._keys[key]
                logger.info(f"[VWAP_SERVICE] {key[0]}@{key[1]}: released after {int(now - st.last_access)}s idle")

    def _interval_ms(self, interval: str) -> int:
        return self._interval_to_minutes(interval) * 60 * 1000

    def _candles_for_days(self, days: int, interval: str) -> int:
        # Antes: ((24*60) // minutos) * dias, que para "W" daba 0 y nunca cargaba nada
        return max(1, (int(days) * 24 * 60) // self._interval_to_minutes(interval))

    def _trim_limits(self, st: _VWAPKeyState) -> Tuple[int, int]:
        """Tope de crecimiento de una clave: (umbral, velas que se conservan al recortar).

        Se conservan los dias pedidos + 3 dias + 300 velas, asi el recorte no cambia los
        puntos dentro del rango pedido (la sesion y el BBWP no miran mas atras que eso).
        """
        days = st.days or self.config.historyDays or 1
        needed = min(self._candles_for_days(days, st.interval), MAX_CANDLES_PER_KEY)
        per_day = max(1, (24 * 60) // self._interval_to_minutes(st.interval))
        guard = 3 * per_day + 300
        keep = min(MAX_CANDLES_PER_KEY, needed + guard)
        threshold = min(MAX_CANDLES_PER_KEY, max(2 * needed, needed + 2 * guard))
        return threshold, keep

    def _config_for_key(self, st: _VWAPKeyState) -> VWAPServiceConfig:
        """Copia de la config global con los parametros de la clave (el hilo solo lee esta copia)."""
        cfg = copy.deepcopy(self.config)
        cfg.interval = st.interval
        cfg.vwapType = st.vwap_type
        cfg.rollingPeriod = st.rolling_period
        if st.days:
            cfg.historyDays = st.days
        return cfg

    def _ws_candles(self, symbol: str, interval: str) -> List[Dict]:
        """Velas del buffer del WebSocket para (symbol, interval), como diccionarios."""
        if not self.ws_manager:
            return []
        buffers = getattr(self.ws_manager, 'buffers', None)
        if isinstance(buffers, dict):
            # .get no crea buffers vacios en el defaultdict del WebSocketManager
            inner = buffers.get(symbol)
            if not inner or interval not in inner:
                return []
        try:
            raw = self.ws_manager.get_candles(symbol, interval)
        except Exception as e:
            logger.debug(f"[VWAP_SERVICE] {symbol}@{interval}: WebSocket buffer unavailable: {e}")
            return []
        out = []
        for c in raw or []:
            if hasattr(c, 'timestamp'):
                out.append({
                    'timestamp': c.timestamp,
                    'open': c.open,
                    'high': c.high,
                    'low': c.low,
                    'close': c.close,
                    'volume': c.volume
                })
            elif isinstance(c, dict) and c.get('timestamp') is not None:
                out.append(c)
        return out

    async def _sync_locked(self, st: _VWAPKeyState, new_candles: Optional[List[Dict]] = None,
                           replace_with: Optional[List[Dict]] = None, force: bool = False) -> bool:
        """Une velas nuevas y recalcula si hace falta. Llamar con st.lock tomado.

        El trabajo pesado corre en un hilo sobre copias; aqui solo se asigna el resultado.
        """
        cfg = self._config_for_key(st)
        signature = _calc_signature(cfg)
        base = replace_with if replace_with is not None else st.candles
        need_compute = (force or replace_with is not None or signature != st.data_signature
                        or st.data_version != st.candles_version)
        merged, changed, data, error = await asyncio.to_thread(
            _merge_and_compute, base, list(new_candles or ()), replace_with is not None,
            cfg, self._trim_limits(st), need_compute
        )
        if replace_with is not None or changed:
            st.candles = merged
            st.candles_version += 1
        if error is not None:
            logger.error(f"[VWAP_SERVICE] {st.symbol}@{st.interval}: Calculation error: {error}")
            return False
        if data is not None:
            st.data = data
            st.data_version = st.candles_version
            st.data_signature = signature
            st.params = {
                'vwapType': cfg.vwapType,
                'rollingPeriod': cfg.rollingPeriod,
                'resetHour': cfg.resetHour,
                'anchorTimestamp': cfg.anchorTimestamp,
                'days': st.days,
            }
            st.last_update = time.time()
            self.stats['calculations'] += 1
            self.stats['last_update'][st.symbol] = st.last_update
            self.stats['candles_loaded'][st.symbol] = len(merged)
            logger.debug(f"[VWAP_SERVICE] {st.symbol}@{st.interval}: Calculated {len(data)} VWAP points from {len(merged)} candles")
        return True

    def _lacks_history(self, st: _VWAPKeyState, want_days: int) -> bool:
        """La clave no tiene velas, tiene menos dias de los pedidos o su ultima carga quedo corta."""
        if not st.candles or want_days > st.days:
            return True
        needed = min(self._candles_for_days(st.days, st.interval), MAX_CANDLES_PER_KEY)
        return not st.full_load_complete and len(st.candles) < 0.9 * needed

    def _needs_full_load(self, st: _VWAPKeyState, want_days: int, now: float) -> bool:
        """Hay que lanzar una carga completa ahora (sin reintentar antes de 30 s tras un fallo)."""
        if not self._lacks_history(st, want_days):
            return False
        if now - st.last_full_attempt < FULL_LOAD_RETRY_SECONDS:
            if not st.full_load_ok:
                return False      # fallo reciente: no martillar a Bybit
            if st.candles and want_days <= st.days:
                return False      # carga reciente que quedo corta: se reintenta pasados 30 s
        return True

    async def _await_quietly(self, task: asyncio.Task):
        """Espera una carga compartida sin cancelarla si quien espera se cancela."""
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f"[VWAP_SERVICE] Load error: {e}")

    def _start_full_load(self, st: _VWAPKeyState, days: int) -> asyncio.Task:
        task = st.loading_task
        if task is None or task.done():
            st.loading_days = days
            task = asyncio.ensure_future(self._full_load(st, days))
            st.loading_task = task
        return task

    async def _full_load(self, st: _VWAPKeyState, days: int) -> bool:
        """Carga completa de una clave: baja las velas sin lock y las aplica con lock."""
        st.last_full_attempt = time.time()
        total = min(self._candles_for_days(days, st.interval), MAX_CANDLES_PER_KEY)
        logger.info(f"[VWAP_SERVICE] {st.symbol}: Reloading {days} days @ {st.interval} ({total} candles)")
        try:
            candles, complete = await self._fetch_klines(st.symbol, st.interval, total_needed=total)
        except Exception as e:
            st.full_load_ok = False
            logger.error(f"[VWAP_SERVICE] {st.symbol}@{st.interval}: Reload error: {e}")
            return False
        if not candles:
            st.full_load_ok = False
            logger.warning(f"[VWAP_SERVICE] {st.symbol}@{st.interval}: No historical data loaded")
            return False
        async with st.lock:
            st.days = days
            st.full_load_ok = True
            st.full_load_complete = complete
            st.last_tail_fetch = time.time()
            ws = self._ws_candles(st.symbol, st.interval)
            await self._sync_locked(st, new_candles=ws, replace_with=candles)
        logger.info(f"[VWAP_SERVICE] {st.symbol}: Reloaded {len(candles)} candles for {days} days @ {st.interval}")
        return True

    async def _fetch_tail_if_needed(self, st: _VWAPKeyState, force: bool) -> Optional[List[Dict]]:
        """Velas nuevas al final de la clave por REST, sin lock.

        Devuelve [] si no hace falta (el WebSocket la mantiene o aun no cierra la ultima vela),
        la lista de velas, o None si el hueco es demasiado grande (hay que recargar completa).
        """
        if not st.candles:
            return []
        interval_ms = self._interval_ms(st.interval)
        now_ms = int(time.time() * 1000)
        last_ts = st.candles[-1]['timestamp']
        ws = self._ws_candles(st.symbol, st.interval)
        ws_last = ws[-1]['timestamp'] if ws else 0
        newest = max(last_ts, ws_last)
        stale = newest + interval_ms + STALE_GRACE_MS <= now_ms
        ws_live = bool(ws) and ws_last + interval_ms > now_ms
        if not (stale or (force and not ws_live)):
            return []
        if time.time() - st.last_tail_fetch < TAIL_FETCH_MIN_SECONDS:
            return []
        st.last_tail_fetch = time.time()
        missing = max(1, (now_ms - last_ts) // interval_ms + 2)
        candles, reached = await self._fetch_klines(
            st.symbol, st.interval, stop_at_ts=last_ts,
            first_limit=min(BYBIT_PAGE_LIMIT, missing), max_pages=MAX_TAIL_PAGES
        )
        if not reached:
            if candles:
                logger.info(f"[VWAP_SERVICE] {st.symbol}@{st.interval}: gap too large for incremental load, full reload")
                return None
            return []  # Bybit no respondio: se reintenta en el proximo pedido
        return candles

    # ------------------------------------------------------------------ API publica

    async def ensure_vwap_data(self, symbol: str, interval: Optional[str] = None, days: Optional[int] = None,
                               vwap_type: Optional[str] = None, rolling_period: Optional[int] = None,
                               refresh: bool = False) -> List[Dict]:
        """
        Devuelve los puntos VWAP de la clave (symbol, interval) y la deja al dia:
        - Carga completa solo si la clave no existe o tiene menos de `days` dias (una carga a
          la vez por clave; los demas pedidos la esperan).
        - Sin carga completa: une las velas del WebSocket y, si la clave quedo atrasada o con
          refresh=True, trae por REST solo las velas que faltan.
        - vwap_type / rolling_period cambian los parametros de ESA clave (se recalcula con sus
          mismas velas). None mantiene los de la clave.
        days=None: los dias que ya tiene la clave (o config.historyDays si es nueva).
        Los diccionarios devueltos son compartidos: tratarlos como de solo lectura.
        """
        symbol, interval = self._normalize_key(symbol, interval)
        if not symbol:
            raise ValueError("symbol is required")
        if interval not in VALID_INTERVALS:
            raise ValueError(f"invalid interval: {interval}")

        self._evict_idle_keys()
        st = self._get_or_create_state(symbol, interval)
        st.busy += 1
        try:
            st.last_access = time.time()
            if days is None:
                want_days = st.days or self.config.historyDays or 1
            else:
                want_days = int(days)
            want_days = max(1, want_days)

            # 1) Carga completa si falta historial. Si a la clave no le falta nada, no se espera
            #    una carga en curso (el filtro del Swing no queda detras de una recarga larga)
            for _ in range(4):
                if not self._lacks_history(st, want_days):
                    break
                task = st.loading_task
                if task is not None and not task.done():
                    await self._await_quietly(task)
                    continue
                if not self._needs_full_load(st, want_days, time.time()):
                    break
                await self._await_quietly(self._start_full_load(st, want_days))

            # 2) Velas nuevas al final
            tail: List[Dict] = []
            if st.candles:
                fetched = await self._fetch_tail_if_needed(st, force=refresh)
                if fetched is None:
                    await self._await_quietly(self._start_full_load(st, max(st.days, want_days)))
                else:
                    tail = fetched

            # 3) Parametros de la clave y recalculo (atomico: nadie cambia la clave en medio).
            #    Las velas REST recien bajadas van al final y pisan al buffer del WebSocket: solo
            #    se piden cuando el WebSocket no tenia la clave al dia
            async with st.lock:
                if vwap_type:
                    st.vwap_type = str(vwap_type)
                if rolling_period:
                    st.rolling_period = int(rolling_period)
                ws = self._ws_candles(symbol, interval)
                await self._sync_locked(st, new_candles=ws + tail)
                st.last_access = time.time()
                return list(st.data)
        finally:
            st.busy -= 1

    def get_vwap_data(self, symbol: str, interval: Optional[str] = None) -> List[Dict]:
        """Get VWAP data for a symbol and interval (sin interval: el intervalo por defecto).

        No carga nada: devuelve lo que tiene la clave ([] si no existe). Para cargarla usar
        ensure_vwap_data(). Los diccionarios son compartidos: tratarlos como de solo lectura.
        """
        st = self._keys.get(self._normalize_key(symbol, interval))
        if st is None:
            return []
        st.last_access = time.time()
        return list(st.data)

    def get_latest_vwap(self, symbol: str, interval: Optional[str] = None) -> Optional[Dict]:
        """Get latest VWAP point for a symbol and interval (sin interval: el por defecto)."""
        st = self._keys.get(self._normalize_key(symbol, interval))
        if st is None or not st.data:
            return None
        st.last_access = time.time()
        last = st.data[-1]
        latest = dict(last)
        latest['bands'] = dict(last.get('bands') or {})
        return latest

    def get_key_info(self, symbol: str, interval: Optional[str] = None) -> Optional[Dict]:
        """Parametros y tamano de una clave, o None si no existe."""
        key = self._normalize_key(symbol, interval)
        st = self._keys.get(key)
        if st is None:
            return None
        return self._describe_key(key, st)

    def _describe_key(self, key: Tuple[str, str], st: _VWAPKeyState) -> Dict:
        return {
            'symbol': key[0],
            'interval': key[1],
            'days': st.days,
            'vwapType': st.params.get('vwapType', st.vwap_type),
            'rollingPeriod': st.params.get('rollingPeriod', st.rolling_period),
            'resetHour': st.params.get('resetHour', self.config.resetHour),
            'points': len(st.data),
            'candles': len(st.candles),
            'first_timestamp': st.candles[0]['timestamp'] if st.candles else None,
            'last_timestamp': st.candles[-1]['timestamp'] if st.candles else None,
            'last_update': st.last_update,
            'loading': bool(st.loading_task is not None and not st.loading_task.done()),
        }

    async def reload_symbol_data(self, symbol: str, days: Optional[int] = None, interval: Optional[str] = None,
                                 incremental: bool = False, vwap_type: Optional[str] = None,
                                 rolling_period: Optional[int] = None) -> List[Dict]:
        """
        Recarga UNA clave (symbol, interval) y devuelve sus puntos. No toca otras claves ni la config.
        - incremental=False: baja de nuevo `days` dias completos.
        - incremental=True: trae solo las velas que faltan al final (WebSocket o REST).
        """
        symbol, interval = self._normalize_key(symbol, interval)
        if not symbol:
            raise ValueError("symbol is required")
        if interval not in VALID_INTERVALS:
            raise ValueError(f"invalid interval: {interval}")

        st = self._get_or_create_state(symbol, interval)
        st.busy += 1
        try:
            st.last_access = time.time()
            reload_days = max(1, int(days)) if days is not None else (st.days or self.config.historyDays or 1)

            tail: List[Dict] = []
            full = not (incremental and st.candles)
            if not full:
                fetched = await self._fetch_tail_if_needed(st, force=True)
                if fetched is None:
                    full = True
                else:
                    tail = fetched
            if full:
                satisfied = False
                task = st.loading_task
                if task is not None and not task.done():
                    # Una carga de esta clave ya estaba en curso: si trajo los dias pedidos, basta
                    await self._await_quietly(task)
                    satisfied = st.loading_days >= reload_days and st.full_load_ok
                if not satisfied:
                    await self._await_quietly(self._start_full_load(st, reload_days))

            async with st.lock:
                if vwap_type:
                    st.vwap_type = str(vwap_type)
                if rolling_period:
                    st.rolling_period = int(rolling_period)
                ws = self._ws_candles(symbol, interval)
                await self._sync_locked(st, new_candles=ws + tail)
                st.last_access = time.time()
                return list(st.data)
        except Exception as e:
            logger.error(f"[VWAP_SERVICE] {symbol}@{interval}: Reload error: {e}")
            return list(st.data)
        finally:
            st.busy -= 1

    def get_status(self) -> Dict:
        """Get service status (config = valores por defecto; 'keys' = estado de cada clave)"""
        uptime = time.time() - self.start_time if self.start_time else 0

        return {
            'running': self.running,
            'enabled': self.config.enabled,
            'symbols': self.config.symbols,
            'interval': self.config.interval,
            'historyDays': self.config.historyDays,
            'vwapType': self.config.vwapType,
            'resetHour': self.config.resetHour,
            'rollingPeriod': self.config.rollingPeriod,
            'showBands': self.config.showBands,
            'bandMultipliers': self.config.bandMultipliers,
            'applyCryptoAdjustment': self.config.applyCryptoAdjustment,
            'showBandWidth': self.config.showBandWidth,
            'showBBWP': self.config.showBBWP,
            'showTTMSqueeze': self.config.showTTMSqueeze,
            'bandWidthThresholds': self.config.bandWidthThresholds,
            'bbwpThresholds': self.config.bbwpThresholds,
            'ttmATRLength': self.config.ttmATRLength,
            'ttmATRMultiplier': self.config.ttmATRMultiplier,
            'uptime_seconds': int(uptime),
            'stats': self.stats,
            'keys': [self._describe_key(k, st) for k, st in sorted(self._keys.items())]
        }

    def update_config(self, new_config: Dict) -> bool:
        """Update default configuration (y los ajustes compartidos de calculo)"""
        try:
            changed = []
            for key, value in new_config.items():
                if not hasattr(self.config, key):
                    continue
                if key == 'interval':
                    value = str(value)
                    if value not in VALID_INTERVALS:
                        logger.warning(f"[VWAP_SERVICE] Ignoring invalid interval: {value}")
                        continue
                setattr(self.config, key, value)
                changed.append(key)
            _sanitize_config(self.config)

            # vwapType / rollingPeriod globales valen, como antes, para todas las claves
            # hasta que el grafico de una clave pida los suyos
            for st in self._keys.values():
                if 'vwapType' in changed and self.config.vwapType:
                    st.vwap_type = self.config.vwapType
                if 'rollingPeriod' in changed and self.config.rollingPeriod:
                    st.rolling_period = int(self.config.rollingPeriod)

            # Update calculator config
            self.calculator.update_config(self.config)

            # Save to file
            self._save_config()

            # Recalculate if running
            if self.running:
                self._spawn(self._calculate_all_symbols())

            logger.info(f"[VWAP_SERVICE] Config updated: {list(new_config.keys())}")
            return True
        except Exception as e:
            logger.error(f"[VWAP_SERVICE] Config update error: {e}")
            return False

    async def recalculate(self):
        """Force recalculation for all keys"""
        logger.info("[VWAP_SERVICE] Force recalculating all keys...")
        await self._calculate_all_symbols()
        return True

    # ------------------------------------------------------------------ cierres de vela

    def _sync_candle_close_handler(self, symbol: str, interval: str, candle):
        """Sync wrapper for async candle handler"""
        self._spawn(self._on_candle_close(symbol, interval, candle))

    async def _on_candle_close(self, symbol: str, interval: str, candle):
        """Called when a candle closes: actualiza la clave (symbol, interval) si existe."""
        if not self.running or not self.config.enabled:
            return

        st = self._keys.get(self._normalize_key(symbol, interval))
        if st is None:
            return

        st.busy += 1
        try:
            async with st.lock:
                new_candles = self._ws_candles(st.symbol, st.interval)
                if not new_candles and candle is not None:
                    if hasattr(candle, 'timestamp'):
                        new_candles = [{
                            'timestamp': candle.timestamp,
                            'open': candle.open,
                            'high': candle.high,
                            'low': candle.low,
                            'close': candle.close,
                            'volume': candle.volume
                        }]
                    elif isinstance(candle, dict) and candle.get('timestamp') is not None:
                        new_candles = [candle]
                await self._sync_locked(st, new_candles=new_candles)
        except Exception as e:
            logger.error(f"[VWAP_SERVICE] {symbol}@{interval}: Candle close update error: {e}")
        finally:
            st.busy -= 1

    async def _calculate_all_symbols(self):
        """Carga las claves por defecto que falten y recalcula todas las claves."""
        for symbol in list(self.config.symbols or []):
            if self._normalize_key(symbol, self.config.interval) not in self._keys:
                try:
                    await self.ensure_vwap_data(symbol, self.config.interval, days=self.config.historyDays)
                except Exception as e:
                    logger.error(f"[VWAP_SERVICE] {symbol}: Error loading default key: {e}")
        for st in list(self._keys.values()):
            await self._recompute_state(st, force=True)

    async def _calculate_symbol(self, symbol: str, interval: Optional[str] = None):
        """Recalcula una clave existente (sin interval: el intervalo por defecto)."""
        st = self._keys.get(self._normalize_key(symbol, interval))
        if st is not None:
            await self._recompute_state(st)

    async def _recompute_state(self, st: _VWAPKeyState, force: bool = False):
        st.busy += 1
        try:
            async with st.lock:
                await self._sync_locked(st, new_candles=self._ws_candles(st.symbol, st.interval), force=force)
        except Exception as e:
            logger.error(f"[VWAP_SERVICE] {st.symbol}@{st.interval}: Recalculation error: {e}")
        finally:
            st.busy -= 1

    # ------------------------------------------------------------------ Bybit

    def _interval_to_minutes(self, interval: str) -> int:
        """Convert interval string to minutes"""
        mapping = {
            '1': 1,
            '3': 3,
            '5': 5,
            '15': 15,
            '30': 30,
            '60': 60,
            '120': 120,
            '240': 240,
            '360': 360,
            '720': 720,
            'D': 1440,
            'W': 10080
        }
        return mapping.get(interval, 1)

    async def _fetch_klines(self, symbol: str, interval: str, total_needed: Optional[int] = None,
                            stop_at_ts: Optional[int] = None, first_limit: Optional[int] = None,
                            max_pages: Optional[int] = None) -> Tuple[List[Dict], bool]:
        """
        Fetch candles from Bybit API, de la mas nueva hacia atras (200 por pedido).
        Para cuando junta total_needed, cuando llega a stop_at_ts o cuando Bybit no tiene mas.
        Devuelve (velas ascendentes, completo). completo=False si se corto por un error.
        """
        all_candles: List[Dict] = []
        end_time = None  # None means current time
        complete = False
        pages = 0

        timeout = aiohttp.ClientTimeout(total=HTTP_TIMEOUT_SECONDS)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            while True:
                if total_needed is not None:
                    remaining = total_needed - len(all_candles)
                    if remaining <= 0:
                        complete = True
                        break
                    batch_size = min(BYBIT_PAGE_LIMIT, remaining)
                else:
                    batch_size = BYBIT_PAGE_LIMIT
                if pages == 0 and first_limit:
                    batch_size = max(1, min(batch_size, int(first_limit)))
                if max_pages is not None and pages >= max_pages:
                    break

                url = (
                    f"{BYBIT_API_URL}?"
                    f"category=linear&symbol={symbol}&interval={interval}"
                    f"&limit={batch_size}"
                )
                if end_time:
                    url += f"&end={end_time}"

                try:
                    async with session.get(url) as response:
                        if response.status != 200:
                            logger.error(f"[VWAP_SERVICE] {symbol}: API error {response.status}")
                            break
                        data = await response.json()
                except Exception as e:
                    logger.error(f"[VWAP_SERVICE] {symbol}: Fetch error: {e}")
                    break

                if data.get('retCode') != 0:
                    logger.error(f"[VWAP_SERVICE] {symbol}: API returned error: {data.get('retMsg')}")
                    break

                pages += 1
                klines = data.get('result', {}).get('list', [])
                if not klines:
                    logger.info(f"[VWAP_SERVICE] {symbol}: No more data available")
                    complete = True
                    break

                # Bybit returns: [timestamp, open, high, low, close, volume, turnover]
                # Data is in descending order (newest first)
                for kline in klines:
                    all_candles.append({
                        'timestamp': int(kline[0]),
                        'open': float(kline[1]),
                        'high': float(kline[2]),
                        'low': float(kline[3]),
                        'close': float(kline[4]),
                        'volume': float(kline[5]),
                        'turnover': float(kline[6]) if len(kline) > 6 else 0
                    })

                # Get oldest timestamp for next request
                oldest_ts = int(klines[-1][0])
                end_time = oldest_ts - 1  # 1ms before oldest

                logger.debug(f"[VWAP_SERVICE] {symbol}: Fetched {len(klines)} candles, total: {len(all_candles)}")

                if stop_at_ts is not None and oldest_ts <= stop_at_ts:
                    complete = True
                    break

                # Small delay to avoid rate limiting
                await asyncio.sleep(0.1)

        # Sort by timestamp ascending (oldest first) for VWAP calculation
        all_candles.sort(key=lambda x: x['timestamp'])
        return all_candles, complete

    async def _fetch_historical_candles(self, symbol: str) -> List[Dict]:
        """Compatibilidad: velas de config.historyDays @ config.interval."""
        return await self._fetch_historical_candles_with_params(symbol, self.config.historyDays, self.config.interval)

    async def _fetch_historical_candles_with_params(self, symbol: str, days: int, interval: str) -> List[Dict]:
        """
        Fetch historical candles from Bybit API with explicit parameters.
        This method doesn't modify global config, avoiding race conditions.
        """
        total = min(self._candles_for_days(days, interval), MAX_CANDLES_PER_KEY)
        logger.info(f"[VWAP_SERVICE] {symbol}: Need {total} candles ({days} days @ {interval}m)")
        candles, _ = await self._fetch_klines(symbol, interval, total_needed=total)
        logger.info(f"[VWAP_SERVICE] {symbol}: Total {len(candles)} candles loaded @ {interval}")
        return candles


# Singleton accessor
_vwap_service: Optional[VWAPService] = None


def get_vwap_service() -> VWAPService:
    """Get or create the VWAP service singleton"""
    global _vwap_service
    if _vwap_service is None:
        _vwap_service = VWAPService()
    return _vwap_service
