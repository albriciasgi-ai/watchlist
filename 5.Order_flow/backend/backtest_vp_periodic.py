"""
Backtest VP Periodic + VWAP
===========================
3 estrategias de trading basadas en Volume Profile Periodic y VWAP Session.

Uso:
  python backtest_vp_periodic.py

Requiere: httpx (pip install httpx)
"""
import asyncio
import httpx
import time
import math
import json
import os
from datetime import datetime, timezone, timedelta
from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional, Tuple

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SYMBOL = "BTCUSDT"
INTERVAL = "1"          # 1 minuto
DAYS = 400              # 400 dias de datos
BYBIT_URL = "https://api.bybit.com/v5/market/kline"

# ---------------------------------------------------------------------------
# Data Fetching
# ---------------------------------------------------------------------------

async def fetch_candles(symbol: str, interval: str, days: int,
                        progress_cb=None) -> List[Dict]:
    """Descarga velas historicas de Bybit con paginacion."""
    interval_minutes = int(interval) if interval.isdigit() else 1440
    total_needed = days * 24 * 60 // interval_minutes
    now_ms = int(time.time() * 1000)
    start_ms = now_ms - (days * 24 * 60 * 60 * 1000)
    end_ms = now_ms + (10 * 60 * 1000)

    all_raw = []
    current_start = start_ms
    req_count = 0
    max_requests = 700

    async with httpx.AsyncClient(timeout=60) as client:
        while len(all_raw) < total_needed and req_count < max_requests:
            req_count += 1
            remaining = total_needed - len(all_raw)
            limit = min(1000, remaining)

            url = (f"{BYBIT_URL}?category=linear&symbol={symbol}"
                   f"&interval={interval}&start={current_start}&limit={limit}")

            try:
                r = await client.get(url)
                data = r.json()
            except Exception as e:
                print(f"  Error request #{req_count}: {e}")
                await asyncio.sleep(1)
                continue

            if data.get("retCode") != 0:
                print(f"  Bybit error: {data.get('retMsg')}")
                break

            batch = data["result"]["list"]
            if not batch:
                break

            batch.reverse()
            all_raw.extend(batch)

            last_ts = int(batch[-1][0])
            current_start = last_ts + (interval_minutes * 60 * 1000)

            if current_start >= end_ms:
                break

            if req_count <= 5 or req_count % 50 == 0:
                pct = len(all_raw) / total_needed * 100
                print(f"  Request #{req_count}: {len(all_raw)}/{total_needed} velas ({pct:.1f}%)")
                if progress_cb:
                    progress_cb(len(all_raw), total_needed)

            await asyncio.sleep(0.05)

    # Parsear
    candles = []
    for c in all_raw:
        candles.append({
            "timestamp": int(c[0]),
            "open": float(c[1]),
            "high": float(c[2]),
            "low": float(c[3]),
            "close": float(c[4]),
            "volume": float(c[5]),
        })

    if len(candles) > total_needed:
        candles = candles[-total_needed:]

    return candles


# ---------------------------------------------------------------------------
# Volume Profile Calculation
# ---------------------------------------------------------------------------

def compute_volume_profile(candles: List[Dict], bins: int = 50,
                           va_percent: float = 0.70) -> Optional[Dict]:
    """Calcula VP con POC, VAH, VAL."""
    if not candles or len(candles) < 2:
        return None

    min_price = min(c['low'] for c in candles)
    max_price = max(c['high'] for c in candles)
    if max_price <= min_price:
        return None

    step = (max_price - min_price) / bins

    levels = []
    for i in range(bins):
        lo = min_price + i * step
        hi = lo + step
        levels.append({'price': (lo + hi) / 2.0, 'volume': 0.0, 'lo': lo, 'hi': hi})

    total_volume = 0.0
    for c in candles:
        c_lo, c_hi, c_vol = c['low'], c['high'], c.get('volume', 0)
        c_range = c_hi - c_lo
        if c_range <= 0 or c_vol <= 0:
            continue
        for lv in levels:
            overlap = max(0.0, min(c_hi, lv['hi']) - max(c_lo, lv['lo']))
            if overlap > 0:
                lv['volume'] += c_vol * (overlap / c_range)
                total_volume += c_vol * (overlap / c_range)

    if total_volume <= 0:
        return None

    # POC
    poc_idx = max(range(bins), key=lambda i: levels[i]['volume'])
    max_vol = levels[poc_idx]['volume']

    # Value Area
    va_threshold = total_volume * va_percent
    va_vol = max_vol
    va_lo, va_hi = poc_idx, poc_idx
    while va_vol < va_threshold:
        up_ok = va_hi < bins - 1
        dn_ok = va_lo > 0
        if not up_ok and not dn_ok:
            break
        up_v = levels[va_hi + 1]['volume'] if up_ok else -1
        dn_v = levels[va_lo - 1]['volume'] if dn_ok else -1
        if up_v >= dn_v:
            va_hi += 1
            va_vol += levels[va_hi]['volume']
        else:
            va_lo -= 1
            va_vol += levels[va_lo]['volume']

    return {
        'poc_price': levels[poc_idx]['price'],
        'poc_volume': max_vol,
        'vah_price': levels[va_hi]['hi'],
        'val_price': levels[va_lo]['lo'],
        'min_price': min_price,
        'max_price': max_price,
        'total_volume': total_volume,
        'levels': levels,
    }


# ---------------------------------------------------------------------------
# VWAP Session Calculation
# ---------------------------------------------------------------------------

def compute_vwap_rolling(candles: List[Dict], period: int = 20) -> List[Dict]:
    """Calcula Rolling VWAP con bandas de desviacion, TTM Squeeze y BBWP.

    Ventana movil de `period` velas. Coincide con el indicador VWAP
    del chart en modo rolling.

    Campos adicionales por punto:
      - squeeze (bool): True si Bollinger Bands (sigma 1) estan dentro de
        Keltner Channels (VWAP +/- ATR*mult). Indica compresion.
      - bbwp (float 0-100): Percentil del bandwidth actual respecto a las
        ultimas 252 velas. Valores bajos = compresion, altos = expansion.

    Args:
        candles: Lista de velas OHLCV
        period: Numero de velas en la ventana rolling (default 20)
    """
    n = len(candles)
    result = []

    for i in range(n):
        start_idx = max(0, i - period + 1)
        window = candles[start_idx:i + 1]

        cum_pv = 0.0
        cum_vol = 0.0

        for c in window:
            tp = (c['high'] + c['low'] + c['close']) / 3.0
            vol = c['volume']
            cum_pv += tp * vol
            cum_vol += vol

        curr = candles[i]
        tp_curr = (curr['high'] + curr['low'] + curr['close']) / 3.0
        vwap = cum_pv / cum_vol if cum_vol > 0 else tp_curr

        # Varianza ponderada por volumen sobre la ventana
        weighted_sq_diff = 0.0
        for c in window:
            tp = (c['high'] + c['low'] + c['close']) / 3.0
            vol = c['volume']
            weighted_sq_diff += ((tp - vwap) ** 2) * vol

        variance = weighted_sq_diff / cum_vol if cum_vol > 0 else 0
        std_dev = math.sqrt(variance) if variance > 0 else 0

        result.append({
            'timestamp': curr['timestamp'],
            'vwap': vwap,
            'upper_1': vwap + std_dev,
            'lower_1': vwap - std_dev,
            'upper_2': vwap + 2 * std_dev,
            'lower_2': vwap - 2 * std_dev,
            'upper_3': vwap + 3 * std_dev,
            'lower_3': vwap - 3 * std_dev,
            'std_dev': std_dev,
            'squeeze': False,
            'bbwp': 50.0,
        })

    # --- Segundo paso: calcular ATR, TTM Squeeze y BBWP ---
    atr_length = 20
    atr_mult = 1.5
    bbwp_lookback = 252

    # ATR simple (SMA de True Range)
    atr_values = [0.0] * n
    true_ranges = []
    for i in range(n):
        h = candles[i]['high']
        l = candles[i]['low']
        if i == 0:
            tr = h - l
        else:
            pc = candles[i - 1]['close']
            tr = max(h - l, abs(h - pc), abs(l - pc))
        true_ranges.append(tr)
        if i >= atr_length - 1:
            atr_values[i] = sum(true_ranges[i - atr_length + 1:i + 1]) / atr_length
        else:
            atr_values[i] = sum(true_ranges[:i + 1]) / (i + 1)

    # TTM Squeeze: BB (sigma 1) dentro de Keltner Channel (VWAP +/- ATR*mult)
    for i in range(n):
        pt = result[i]
        atr = atr_values[i]
        if atr <= 0 or pt['std_dev'] <= 0:
            continue
        kc_upper = pt['vwap'] + atr * atr_mult
        kc_lower = pt['vwap'] - atr * atr_mult
        pt['squeeze'] = (pt['upper_1'] < kc_upper) and (pt['lower_1'] > kc_lower)

    # Bandwidth y BBWP
    bandwidths = []
    for i in range(n):
        pt = result[i]
        if pt['vwap'] > 0:
            bw = ((pt['upper_1'] - pt['lower_1']) / pt['vwap']) * 100.0
        else:
            bw = 0.0
        bandwidths.append(bw)

    for i in range(n):
        bw = bandwidths[i]
        start_idx = max(0, i - bbwp_lookback + 1)
        hist = bandwidths[start_idx:i + 1]
        if len(hist) < 2:
            continue
        count_below = sum(1 for h in hist if h < bw)
        result[i]['bbwp'] = (count_below / len(hist)) * 100.0

    return result


# ---------------------------------------------------------------------------
# VP Periodic Segmentation
# ---------------------------------------------------------------------------

def get_vp_segments(candles: List[Dict], period: int, bins: int = 50,
                    va_pct: float = 0.70) -> List[Dict]:
    """Divide velas en segmentos de `period` y calcula VP para cada uno."""
    segments = []
    for start in range(0, len(candles), period):
        end = min(start + period, len(candles))
        if end - start < 2:
            continue
        seg_candles = candles[start:end]
        profile = compute_volume_profile(seg_candles, bins, va_pct)
        if profile:
            segments.append({
                'start_idx': start,
                'end_idx': end,
                'start_ts': seg_candles[0]['timestamp'],
                'end_ts': seg_candles[-1]['timestamp'],
                'profile': profile,
            })
    return segments


def build_segment_lookup(segments: List[Dict], total_candles: int, period: int) -> List[Optional[Dict]]:
    """Pre-computa un array de lookup: para cada candle_idx, cual es el segmento activo.
    O(n) en vez de O(n*m). Solo usa segmentos ya finalizados (no look-ahead bias).
    En la practica, el trader usa los niveles del VP anterior (ya cerrado) para
    medir breakouts durante el segmento actual."""
    lookup = [None] * total_candles
    seg_idx = 0
    for i in range(total_candles):
        # Avanzar al siguiente segmento completado si aplica
        while (seg_idx < len(segments) and segments[seg_idx]['end_idx'] <= i):
            seg_idx += 1
        # El segmento activo es el anterior al actual (ya completado)
        if seg_idx > 0:
            lookup[i] = segments[seg_idx - 1]
    return lookup


# ---------------------------------------------------------------------------
# VWAP Filter Helper
# ---------------------------------------------------------------------------

def _check_vwap_filter(price: float, vwap_point: Dict, vwap_filter: str,
                       direction: str) -> bool:
    """Verifica si el precio cumple el filtro VWAP configurable.

    vwap_filter options:
      'none'    - Sin filtro VWAP (siempre True)
      'vwap'    - LONG: price > vwap, SHORT: price < vwap
      'upper_1' - LONG: price > upper_1, SHORT: price < lower_1
      'upper_2' - LONG: price > upper_2, SHORT: price < lower_2
    """
    if vwap_filter == 'none':
        return True

    if vwap_filter == 'vwap':
        if direction == 'LONG':
            return price > vwap_point['vwap']
        else:
            return price < vwap_point['vwap']

    if vwap_filter == 'upper_1':
        if direction == 'LONG':
            return price > vwap_point['upper_1']
        else:
            return price < vwap_point['lower_1']

    if vwap_filter == 'upper_2':
        if direction == 'LONG':
            return price > vwap_point['upper_2']
        else:
            return price < vwap_point['lower_2']

    # Default: sin filtro
    return True


# ---------------------------------------------------------------------------
# Trade Resolution (bar by bar)
# ---------------------------------------------------------------------------

def resolve_trade(candles: List[Dict], entry_idx: int, entry_price: float,
                  sl_price: float, tp_price: float,
                  direction: str) -> Tuple[str, float, Optional[int], int]:
    """Monitorea SL/TP barra a barra.
    Returns: (result, pnl_r, close_ts, bars_held)"""
    risk = abs(entry_price - sl_price)
    if risk <= 0:
        return 'SKIP', 0.0, None, 0

    tp_rr = abs(tp_price - entry_price) / risk

    for j in range(entry_idx + 1, len(candles)):
        tc = candles[j]
        if direction == 'LONG':
            hit_tp = tc['high'] >= tp_price
            hit_sl = tc['low'] <= sl_price
        else:
            hit_tp = tc['low'] <= tp_price
            hit_sl = tc['high'] >= sl_price

        # Si ambos en la misma vela
        if hit_sl and hit_tp:
            if direction == 'LONG':
                hit_sl_first = tc['open'] <= sl_price
            else:
                hit_sl_first = tc['open'] >= sl_price
            if hit_sl_first:
                hit_tp = False
            else:
                hit_sl = False

        if hit_tp:
            return 'WIN', round(tp_rr, 2), tc['timestamp'], j - entry_idx
        elif hit_sl:
            return 'LOSS', -1.0, tc['timestamp'], j - entry_idx

    return 'OPEN', 0.0, None, len(candles) - entry_idx - 1


# ---------------------------------------------------------------------------
# Metrics Calculation
# ---------------------------------------------------------------------------

def calculate_metrics(trades: List[Dict]) -> Dict:
    """Calcula metricas estandar de un conjunto de trades."""
    resolved = [t for t in trades if t['result'] in ('WIN', 'LOSS')]
    wins = [t for t in resolved if t['result'] == 'WIN']
    losses = [t for t in resolved if t['result'] == 'LOSS']
    open_trades = [t for t in trades if t['result'] == 'OPEN']

    total_closed = len(resolved)
    if total_closed == 0:
        return {
            'total_trades': len(trades),
            'closed': 0, 'wins': 0, 'losses': 0, 'open': len(open_trades),
            'win_rate': 0, 'total_pnl_r': 0, 'expectancy': 0,
            'profit_factor': 0, 'max_drawdown_r': 0, 'recovery_factor': 0,
            'avg_winner_r': 0, 'avg_loser_r': 0,
            'max_consec_wins': 0, 'max_consec_losses': 0,
            'avg_bars_held': 0,
        }

    total_pnl = sum(t['pnl_r'] for t in resolved)
    win_rate = len(wins) / total_closed * 100
    expectancy = total_pnl / total_closed

    gross_profit = sum(t['pnl_r'] for t in wins)
    gross_loss = abs(sum(t['pnl_r'] for t in losses))
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else (99.9 if gross_profit > 0 else 0)

    avg_winner = gross_profit / len(wins) if wins else 0
    avg_loser = -gross_loss / len(losses) if losses else 0

    # Max drawdown
    equity = 0.0
    max_eq = 0.0
    max_dd = 0.0
    equity_curve = []
    for t in sorted(resolved, key=lambda x: x.get('entry_ts', 0)):
        equity += t['pnl_r']
        max_eq = max(max_eq, equity)
        dd = max_eq - equity
        max_dd = max(max_dd, dd)
        equity_curve.append({'ts': t.get('close_ts', 0), 'equity': round(equity, 2)})

    # Consecutive
    max_cw = max_cl = cw = cl = 0
    for t in sorted(resolved, key=lambda x: x.get('entry_ts', 0)):
        if t['result'] == 'WIN':
            cw += 1
            cl = 0
        else:
            cl += 1
            cw = 0
        max_cw = max(max_cw, cw)
        max_cl = max(max_cl, cl)

    avg_bars = sum(t.get('bars_held', 0) for t in resolved) / total_closed

    # Recovery Factor = total_pnl / max_drawdown
    recovery_factor = round(total_pnl / max_dd, 2) if max_dd > 0 else (99.9 if total_pnl > 0 else 0)

    return {
        'total_trades': len(trades),
        'closed': total_closed,
        'wins': len(wins),
        'losses': len(losses),
        'open': len(open_trades),
        'win_rate': round(win_rate, 1),
        'total_pnl_r': round(total_pnl, 2),
        'expectancy': round(expectancy, 3),
        'profit_factor': round(profit_factor, 2),
        'max_drawdown_r': round(max_dd, 2),
        'recovery_factor': recovery_factor,
        'avg_winner_r': round(avg_winner, 2),
        'avg_loser_r': round(avg_loser, 2),
        'max_consec_wins': max_cw,
        'max_consec_losses': max_cl,
        'avg_bars_held': round(avg_bars, 1),
        'equity_curve': equity_curve,
    }


# ---------------------------------------------------------------------------
# STRATEGY 1: POC Bounce (Mean Reversion al POC)
# ---------------------------------------------------------------------------

def strategy_poc_bounce(candles: List[Dict], vwap_data: List[Dict],
                        vp_period: int = 240, bins: int = 50,
                        tp_rr: float = 2.0,
                        vwap_filter: str = 'vwap') -> List[Dict]:
    """
    Logica:
    - Precio cruza POC del segmento anterior
    - Direccion filtrada por VWAP (configurable: none/vwap/upper_1/upper_2)
    - SL en borde opuesto del Value Area
    - TP = tp_rr * riesgo
    """
    segments = get_vp_segments(candles, vp_period, bins)
    seg_lookup = build_segment_lookup(segments, len(candles), vp_period)
    trades = []
    # Max 1 trade por segmento+direccion (permite LONG y SHORT en el mismo segmento)
    used_seg_dir = set()

    for i in range(1, len(candles)):
        seg = seg_lookup[i]
        if not seg:
            continue

        prof = seg['profile']
        poc = prof['poc_price']
        vah = prof['vah_price']
        val = prof['val_price']
        vwap_point = vwap_data[i] if i < len(vwap_data) else None
        if not vwap_point:
            continue

        vwap_val = vwap_point['vwap']
        prev = candles[i - 1]
        curr = candles[i]
        seg_id = seg['start_idx']

        # Determinar valor VWAP para filtro
        vwap_long_ok = _check_vwap_filter(curr['close'], vwap_point, vwap_filter, 'LONG')
        vwap_short_ok = _check_vwap_filter(curr['close'], vwap_point, vwap_filter, 'SHORT')

        # LONG: precio cruza POC de abajo hacia arriba + close > POC + filtro VWAP
        if (seg_id, 'LONG') not in used_seg_dir and prev['close'] < poc and curr['close'] > poc and vwap_long_ok:
            entry_price = curr['close']
            sl_price = val - (val * 0.0005)  # VAL - 0.05% buffer
            risk = entry_price - sl_price
            if risk <= 0:
                continue
            tp_price = entry_price + risk * tp_rr

            result, pnl_r, close_ts, bars = resolve_trade(
                candles, i, entry_price, sl_price, tp_price, 'LONG')

            trades.append({
                'entry_idx': i, 'entry_ts': curr['timestamp'],
                'entry_price': entry_price, 'direction': 'LONG',
                'sl': sl_price, 'tp': tp_price,
                'poc': poc, 'vah': vah, 'val': val, 'vwap': vwap_val,
                'result': result, 'pnl_r': pnl_r,
                'close_ts': close_ts, 'bars_held': bars,
            })
            used_seg_dir.add((seg_id, 'LONG'))

        # SHORT: precio cruza POC de arriba hacia abajo + close < POC + filtro VWAP
        elif (seg_id, 'SHORT') not in used_seg_dir and prev['close'] > poc and curr['close'] < poc and vwap_short_ok:
            entry_price = curr['close']
            sl_price = vah + (vah * 0.0005)  # VAH + 0.05% buffer
            risk = sl_price - entry_price
            if risk <= 0:
                continue
            tp_price = entry_price - risk * tp_rr

            result, pnl_r, close_ts, bars = resolve_trade(
                candles, i, entry_price, sl_price, tp_price, 'SHORT')

            trades.append({
                'entry_idx': i, 'entry_ts': curr['timestamp'],
                'entry_price': entry_price, 'direction': 'SHORT',
                'sl': sl_price, 'tp': tp_price,
                'poc': poc, 'vah': vah, 'val': val, 'vwap': vwap_val,
                'result': result, 'pnl_r': pnl_r,
                'close_ts': close_ts, 'bars_held': bars,
            })
            used_seg_dir.add((seg_id, 'SHORT'))

    return trades


# ---------------------------------------------------------------------------
# STRATEGY 2: Value Area Breakout
# ---------------------------------------------------------------------------

def strategy_va_breakout(candles: List[Dict], vwap_data: List[Dict],
                         vp_period: int = 480, bins: int = 50,
                         tp_rr: float = 3.0,
                         confirm_bars: int = 2,
                         min_va_width_pct: float = 0.3,
                         vwap_filter: str = 'upper_1') -> List[Dict]:
    """
    Logica:
    - Precio cierra fuera del Value Area (arriba de VAH o abajo de VAL)
    - confirm_bars cierres consecutivos fuera del VA
    - Filtro: VWAP configurable (none/vwap/upper_1/upper_2)
    - Filtro: ancho VA > min_va_width_pct%
    - SL en POC
    - TP = tp_rr * riesgo
    """
    segments = get_vp_segments(candles, vp_period, bins)
    seg_lookup = build_segment_lookup(segments, len(candles), vp_period)
    trades = []
    # Max 1 trade por segmento+direccion
    used_seg_dir = set()

    for i in range(confirm_bars, len(candles)):
        seg = seg_lookup[i]
        if not seg:
            continue

        prof = seg['profile']
        poc = prof['poc_price']
        vah = prof['vah_price']
        val = prof['val_price']
        seg_id = seg['start_idx']

        # Filtro de ancho minimo del VA
        va_width_pct = (vah - val) / poc * 100 if poc > 0 else 0
        if va_width_pct < min_va_width_pct:
            continue

        vwap_point = vwap_data[i] if i < len(vwap_data) else None
        if not vwap_point:
            continue

        curr = candles[i]

        # Determinar filtro VWAP
        vwap_long_ok = _check_vwap_filter(curr['close'], vwap_point, vwap_filter, 'LONG')
        vwap_short_ok = _check_vwap_filter(curr['close'], vwap_point, vwap_filter, 'SHORT')

        # LONG breakout: N cierres consecutivos arriba de VAH + filtro VWAP
        all_above_vah = all(candles[i - k]['close'] > vah for k in range(confirm_bars))
        if (seg_id, 'LONG') not in used_seg_dir and all_above_vah and vwap_long_ok:
            entry_price = curr['close']
            sl_price = poc
            risk = entry_price - sl_price
            if risk <= 0:
                continue
            tp_price = entry_price + risk * tp_rr

            result, pnl_r, close_ts, bars = resolve_trade(
                candles, i, entry_price, sl_price, tp_price, 'LONG')

            trades.append({
                'entry_idx': i, 'entry_ts': curr['timestamp'],
                'entry_price': entry_price, 'direction': 'LONG',
                'sl': sl_price, 'tp': tp_price,
                'poc': poc, 'vah': vah, 'val': val,
                'vwap': vwap_point['vwap'], 'vwap_upper1': vwap_point['upper_1'],
                'va_width_pct': round(va_width_pct, 2),
                'result': result, 'pnl_r': pnl_r,
                'close_ts': close_ts, 'bars_held': bars,
            })
            used_seg_dir.add((seg_id, 'LONG'))
            continue

        # SHORT breakout: N cierres consecutivos abajo de VAL + filtro VWAP
        all_below_val = all(candles[i - k]['close'] < val for k in range(confirm_bars))
        if (seg_id, 'SHORT') not in used_seg_dir and all_below_val and vwap_short_ok:
            entry_price = curr['close']
            sl_price = poc
            risk = sl_price - entry_price
            if risk <= 0:
                continue
            tp_price = entry_price - risk * tp_rr

            result, pnl_r, close_ts, bars = resolve_trade(
                candles, i, entry_price, sl_price, tp_price, 'SHORT')

            trades.append({
                'entry_idx': i, 'entry_ts': curr['timestamp'],
                'entry_price': entry_price, 'direction': 'SHORT',
                'sl': sl_price, 'tp': tp_price,
                'poc': poc, 'vah': vah, 'val': val,
                'vwap': vwap_point['vwap'], 'vwap_lower1': vwap_point['lower_1'],
                'va_width_pct': round(va_width_pct, 2),
                'result': result, 'pnl_r': pnl_r,
                'close_ts': close_ts, 'bars_held': bars,
            })
            used_seg_dir.add((seg_id, 'SHORT'))

    return trades


# ---------------------------------------------------------------------------
# STRATEGY 3: VAH/VAL Rejection + VWAP Confluence
# ---------------------------------------------------------------------------

def strategy_rejection_confluence(candles: List[Dict], vwap_data: List[Dict],
                                  vp_period: int = 240, bins: int = 50,
                                  tolerance_pct: float = 0.1,
                                  wick_ratio: float = 0.6,
                                  vwap_filter: str = 'band_zone') -> List[Dict]:
    """
    Logica:
    - Precio toca VAL (+-tolerance) + confluencia VWAP (configurable)
      + vela de rechazo (mecha inferior > wick_ratio del rango)  -> LONG
    - Precio toca VAH (+-tolerance) + confluencia VWAP (configurable)
      + vela de rechazo (mecha superior > wick_ratio del rango) -> SHORT
    - SL debajo/encima de la mecha de rechazo + buffer
    - TP en POC del segmento
    - vwap_filter: 'none', 'vwap', 'upper_1', 'upper_2', 'band_zone' (original: entre sigma1 y sigma2)
    """
    segments = get_vp_segments(candles, vp_period, bins)
    seg_lookup = build_segment_lookup(segments, len(candles), vp_period)
    trades = []
    used_seg_dir: set = set()  # max 1 trade per segment+direction

    for i in range(1, len(candles)):
        seg = seg_lookup[i]
        if not seg:
            continue

        seg_id = seg['start_idx']
        prof = seg['profile']
        poc = prof['poc_price']
        vah = prof['vah_price']
        val = prof['val_price']

        vwap_point = vwap_data[i] if i < len(vwap_data) else None
        if not vwap_point:
            continue

        curr = candles[i]
        candle_range = curr['high'] - curr['low']
        if candle_range <= 0:
            continue

        body_top = max(curr['open'], curr['close'])
        body_bot = min(curr['open'], curr['close'])
        lower_wick = body_bot - curr['low']
        upper_wick = curr['high'] - body_top

        tol = poc * tolerance_pct / 100.0

        # Filtro VWAP para rejection
        if vwap_filter == 'band_zone':
            # Original: precio dentro de zona entre sigma1 y sigma2
            long_vwap_ok = (curr['low'] <= vwap_point['lower_1'] and
                            curr['low'] >= vwap_point['lower_2'])
            short_vwap_ok = (curr['high'] >= vwap_point['upper_1'] and
                             curr['high'] <= vwap_point['upper_2'])
        elif vwap_filter == 'none':
            long_vwap_ok = True
            short_vwap_ok = True
        else:
            long_vwap_ok = _check_vwap_filter(curr['close'], vwap_point, vwap_filter, 'LONG')
            short_vwap_ok = _check_vwap_filter(curr['close'], vwap_point, vwap_filter, 'SHORT')

        # LONG: toca VAL + confluencia VWAP + rejection candle
        if ((seg_id, 'LONG') not in used_seg_dir and
            curr['low'] <= val + tol and curr['close'] > val and
            long_vwap_ok and
            lower_wick / candle_range >= wick_ratio):

            entry_price = curr['close']
            sl_price = curr['low'] - (curr['low'] * 0.0005)
            risk = entry_price - sl_price
            if risk <= 0:
                continue
            tp_price = poc  # TP en POC
            tp_rr = (tp_price - entry_price) / risk
            if tp_rr < 0.5:  # Si POC esta muy cerca, skip
                continue

            result, pnl_r, close_ts, bars = resolve_trade(
                candles, i, entry_price, sl_price, tp_price, 'LONG')

            trades.append({
                'entry_idx': i, 'entry_ts': curr['timestamp'],
                'entry_price': entry_price, 'direction': 'LONG',
                'sl': sl_price, 'tp': tp_price, 'tp_rr': round(tp_rr, 2),
                'poc': poc, 'vah': vah, 'val': val,
                'vwap': vwap_point['vwap'],
                'lower_wick_ratio': round(lower_wick / candle_range, 2),
                'result': result, 'pnl_r': pnl_r,
                'close_ts': close_ts, 'bars_held': bars,
            })
            used_seg_dir.add((seg_id, 'LONG'))
            continue

        # SHORT: toca VAH + confluencia VWAP + rejection candle
        if ((seg_id, 'SHORT') not in used_seg_dir and
            curr['high'] >= vah - tol and curr['close'] < vah and
            short_vwap_ok and
            upper_wick / candle_range >= wick_ratio):

            entry_price = curr['close']
            sl_price = curr['high'] + (curr['high'] * 0.0005)
            risk = sl_price - entry_price
            if risk <= 0:
                continue
            tp_price = poc  # TP en POC
            tp_rr = (entry_price - tp_price) / risk
            if tp_rr < 0.5:
                continue

            result, pnl_r, close_ts, bars = resolve_trade(
                candles, i, entry_price, sl_price, tp_price, 'SHORT')

            trades.append({
                'entry_idx': i, 'entry_ts': curr['timestamp'],
                'entry_price': entry_price, 'direction': 'SHORT',
                'sl': sl_price, 'tp': tp_price, 'tp_rr': round(tp_rr, 2),
                'poc': poc, 'vah': vah, 'val': val,
                'vwap': vwap_point['vwap'],
                'upper_wick_ratio': round(upper_wick / candle_range, 2),
                'result': result, 'pnl_r': pnl_r,
                'close_ts': close_ts, 'bars_held': bars,
            })
            used_seg_dir.add((seg_id, 'SHORT'))

    return trades


# ---------------------------------------------------------------------------
# STRATEGY 4: VWAP Trend + Swing Confirmation
# ---------------------------------------------------------------------------

def _detect_swing_low(candles: List[Dict], idx: int, swing_bars: int) -> bool:
    """Detecta swing low en idx: el low de idx es menor que los N bars a cada lado."""
    if idx < swing_bars or idx + swing_bars >= len(candles):
        return False
    ref_low = candles[idx]['low']
    for j in range(1, swing_bars + 1):
        if candles[idx - j]['low'] <= ref_low:
            return False
        if candles[idx + j]['low'] <= ref_low:
            return False
    return True


def _detect_swing_high(candles: List[Dict], idx: int, swing_bars: int) -> bool:
    """Detecta swing high en idx: el high de idx es mayor que los N bars a cada lado."""
    if idx < swing_bars or idx + swing_bars >= len(candles):
        return False
    ref_high = candles[idx]['high']
    for j in range(1, swing_bars + 1):
        if candles[idx - j]['high'] >= ref_high:
            return False
        if candles[idx + j]['high'] >= ref_high:
            return False
    return True


def _is_vwap_trending_up(vwap_data: List[Dict], idx: int,
                         lookback: int = 10) -> bool:
    """VWAP subiendo: vwap actual > vwap de hace `lookback` velas."""
    if idx < lookback:
        return False
    return vwap_data[idx]['vwap'] > vwap_data[idx - lookback]['vwap']


def _is_vwap_trending_down(vwap_data: List[Dict], idx: int,
                           lookback: int = 10) -> bool:
    """VWAP bajando: vwap actual < vwap de hace `lookback` velas."""
    if idx < lookback:
        return False
    return vwap_data[idx]['vwap'] < vwap_data[idx - lookback]['vwap']


def strategy_vwap_swing(candles: List[Dict], vwap_data: List[Dict],
                        vp_period: int = 240, bins: int = 50,
                        swing_bars: int = 3, tp_rr: float = 2.0,
                        vwap_lookback: int = 10,
                        direction_filter: str = 'both') -> List[Dict]:
    """
    Estrategia VWAP Trend + Swing Confirmation.

    LONG:
      - VWAP subiendo (tendencia alcista)
      - Precio por debajo del POC del segmento anterior (retroceso)
      - Swing Low confirmado (N barras a cada lado)
      - SL debajo del swing low - buffer
      - TP con R:R configurable

    SHORT:
      - VWAP bajando (tendencia bajista)
      - Precio por encima del POC del segmento anterior (retroceso)
      - Swing High confirmado (N barras a cada lado)
      - SL encima del swing high + buffer
      - TP con R:R configurable

    Parametros:
      swing_bars: # de barras a cada lado para confirmar swing (2-10)
      tp_rr: ratio risk/reward para TP
      vwap_lookback: # de velas atras para medir tendencia VWAP
      direction_filter: 'both', 'long', 'short'
    """
    segments = get_vp_segments(candles, vp_period, bins)
    seg_lookup = build_segment_lookup(segments, len(candles), vp_period)
    trades = []
    used_seg_dir: set = set()  # max 1 trade per segment+direction

    # El swing se confirma swing_bars velas DESPUES del pivot
    # Asi que evaluamos el pivot en (i - swing_bars) cuando estamos en i
    for i in range(swing_bars + 1, len(candles)):
        pivot_idx = i - swing_bars  # indice del pivot que acaba de confirmarse

        seg = seg_lookup[pivot_idx]
        if not seg:
            continue

        seg_id = seg['start_idx']
        prof = seg['profile']
        poc = prof['poc_price']
        vah = prof['vah_price']
        val = prof['val_price']

        vwap_point = vwap_data[pivot_idx] if pivot_idx < len(vwap_data) else None
        if not vwap_point:
            continue

        pivot_candle = candles[pivot_idx]
        confirm_candle = candles[i]  # vela actual (la que confirma)

        # --- LONG: VWAP subiendo + precio < POC + swing low ---
        if (direction_filter in ('both', 'long') and
            (seg_id, 'LONG') not in used_seg_dir and
            _is_vwap_trending_up(vwap_data, pivot_idx, vwap_lookback) and
            pivot_candle['low'] < poc and
            _detect_swing_low(candles, pivot_idx, swing_bars)):

            entry_price = confirm_candle['close']
            sl_price = pivot_candle['low'] - (pivot_candle['low'] * 0.0005)
            risk = entry_price - sl_price
            if risk <= 0:
                continue
            tp_price = entry_price + (risk * tp_rr)

            result, pnl_r, close_ts, bars = resolve_trade(
                candles, i, entry_price, sl_price, tp_price, 'LONG')

            trades.append({
                'entry_idx': i, 'entry_ts': confirm_candle['timestamp'],
                'entry_price': entry_price, 'direction': 'LONG',
                'sl': sl_price, 'tp': tp_price, 'tp_rr': round(tp_rr, 2),
                'poc': poc, 'vah': vah, 'val': val,
                'vwap': vwap_point['vwap'],
                'swing_pivot_idx': pivot_idx,
                'swing_pivot_price': pivot_candle['low'],
                'result': result, 'pnl_r': pnl_r,
                'close_ts': close_ts, 'bars_held': bars,
            })
            used_seg_dir.add((seg_id, 'LONG'))
            continue

        # --- SHORT: VWAP bajando + precio > POC + swing high ---
        if (direction_filter in ('both', 'short') and
            (seg_id, 'SHORT') not in used_seg_dir and
            _is_vwap_trending_down(vwap_data, pivot_idx, vwap_lookback) and
            pivot_candle['high'] > poc and
            _detect_swing_high(candles, pivot_idx, swing_bars)):

            entry_price = confirm_candle['close']
            sl_price = pivot_candle['high'] + (pivot_candle['high'] * 0.0005)
            risk = sl_price - entry_price
            if risk <= 0:
                continue
            tp_price = entry_price - (risk * tp_rr)

            result, pnl_r, close_ts, bars = resolve_trade(
                candles, i, entry_price, sl_price, tp_price, 'SHORT')

            trades.append({
                'entry_idx': i, 'entry_ts': confirm_candle['timestamp'],
                'entry_price': entry_price, 'direction': 'SHORT',
                'sl': sl_price, 'tp': tp_price, 'tp_rr': round(tp_rr, 2),
                'poc': poc, 'vah': vah, 'val': val,
                'vwap': vwap_point['vwap'],
                'swing_pivot_idx': pivot_idx,
                'swing_pivot_price': pivot_candle['high'],
                'result': result, 'pnl_r': pnl_r,
                'close_ts': close_ts, 'bars_held': bars,
            })
            used_seg_dir.add((seg_id, 'SHORT'))

    return trades


# ---------------------------------------------------------------------------
# Parameter Variations
# ---------------------------------------------------------------------------

STRATEGY_VARIATIONS = {
    "POC Bounce": [
        {"vp_period": 120, "tp_rr": 2.0, "label": "VP120 RR2"},
        {"vp_period": 240, "tp_rr": 2.0, "label": "VP240 RR2"},
        {"vp_period": 240, "tp_rr": 1.5, "label": "VP240 RR1.5"},
        {"vp_period": 480, "tp_rr": 2.0, "label": "VP480 RR2"},
        {"vp_period": 480, "tp_rr": 3.0, "label": "VP480 RR3"},
    ],
    "VA Breakout": [
        {"vp_period": 240, "tp_rr": 2.0, "confirm_bars": 2, "label": "VP240 RR2 C2"},
        {"vp_period": 480, "tp_rr": 3.0, "confirm_bars": 2, "label": "VP480 RR3 C2"},
        {"vp_period": 480, "tp_rr": 2.0, "confirm_bars": 3, "label": "VP480 RR2 C3"},
        {"vp_period": 960, "tp_rr": 3.0, "confirm_bars": 2, "label": "VP960 RR3 C2"},
        {"vp_period": 960, "tp_rr": 2.0, "confirm_bars": 3, "label": "VP960 RR2 C3"},
    ],
    "Rejection Confluence": [
        {"vp_period": 120, "tolerance_pct": 0.1, "wick_ratio": 0.6, "label": "VP120 T0.1 W0.6"},
        {"vp_period": 240, "tolerance_pct": 0.1, "wick_ratio": 0.6, "label": "VP240 T0.1 W0.6"},
        {"vp_period": 240, "tolerance_pct": 0.15, "wick_ratio": 0.5, "label": "VP240 T0.15 W0.5"},
        {"vp_period": 480, "tolerance_pct": 0.1, "wick_ratio": 0.6, "label": "VP480 T0.1 W0.6"},
        {"vp_period": 480, "tolerance_pct": 0.15, "wick_ratio": 0.5, "label": "VP480 T0.15 W0.5"},
    ],
}

# Mapa de funciones de estrategia para invocacion desde endpoint
STRATEGY_FUNCTIONS = {
    "poc_bounce": strategy_poc_bounce,
    "va_breakout": strategy_va_breakout,
    "rejection_confluence": strategy_rejection_confluence,
    "vwap_swing": strategy_vwap_swing,
}


# ---------------------------------------------------------------------------
# run_backtest() - Funcion invocable desde endpoint de main.py
# ---------------------------------------------------------------------------

def run_backtest(candles: List[Dict], strategy: str, params: Dict,
                 progress_callback=None) -> Dict:
    """Ejecuta backtest de una estrategia VP Periodic sobre velas precargadas.

    Args:
        candles: Lista de velas OHLCV (ya descargadas)
        strategy: Nombre de estrategia: poc_bounce, va_breakout, rejection_confluence
        params: Parametros de la estrategia (vp_period, tp_rr, etc.)
        progress_callback: Funcion opcional (phase, percent, message) para reportar progreso

    Returns:
        Dict con trades, metrics, zones (formato para ZoneVisualizerIndicator)
    """
    def _progress(phase, percent, message):
        if progress_callback:
            try:
                progress_callback(phase, percent, message)
            except Exception:
                pass

    if strategy not in STRATEGY_FUNCTIONS:
        return {
            'success': False,
            'error': f'Estrategia desconocida: {strategy}. Opciones: {list(STRATEGY_FUNCTIONS.keys())}'
        }

    # Extraer parametros con defaults
    vp_period = params.get('vp_period', 240)
    bins = params.get('bins', 50)
    tp_rr = params.get('tp_rr', 2.0)
    vwap_filter = params.get('vwap_filter', 'vwap')
    vwap_period = int(params.get('vwap_period', 20))  # Rolling VWAP period

    # Fase 1: Calcular Rolling VWAP
    _progress('vwap', 10, f'Calculando Rolling VWAP (period={vwap_period}, {len(candles):,} velas)...')
    vwap_data = compute_vwap_rolling(candles, period=vwap_period)

    # Fase 2: Ejecutar estrategia
    _progress('strategy', 30, f'Ejecutando estrategia {strategy}...')
    strategy_fn = STRATEGY_FUNCTIONS[strategy]

    if strategy == 'poc_bounce':
        trades = strategy_fn(candles, vwap_data,
                             vp_period=vp_period, bins=bins, tp_rr=tp_rr,
                             vwap_filter=vwap_filter)
    elif strategy == 'va_breakout':
        confirm_bars = params.get('confirm_bars', 2)
        min_va_width_pct = params.get('min_va_width_pct', 0.3)
        trades = strategy_fn(candles, vwap_data,
                             vp_period=vp_period, bins=bins, tp_rr=tp_rr,
                             confirm_bars=confirm_bars,
                             min_va_width_pct=min_va_width_pct,
                             vwap_filter=vwap_filter)
    elif strategy == 'rejection_confluence':
        tolerance_pct = params.get('tolerance_pct', 0.1)
        wick_ratio = params.get('wick_ratio', 0.6)
        trades = strategy_fn(candles, vwap_data,
                             vp_period=vp_period, bins=bins,
                             tolerance_pct=tolerance_pct,
                             wick_ratio=wick_ratio,
                             vwap_filter=vwap_filter)
    elif strategy == 'vwap_swing':
        swing_bars = int(params.get('swing_bars', 3))
        vwap_lookback = int(params.get('vwap_lookback', 10))
        direction_filter = params.get('direction_filter', 'both')
        trades = strategy_fn(candles, vwap_data,
                             vp_period=vp_period, bins=bins,
                             swing_bars=swing_bars, tp_rr=tp_rr,
                             vwap_lookback=vwap_lookback,
                             direction_filter=direction_filter)
    else:
        trades = []

    # Fase 3: Calcular metricas
    _progress('metrics', 70, f'Calculando metricas ({len(trades)} trades)...')
    metrics = calculate_metrics(trades)

    # Fase 4: Calcular segmentos VP para visualizacion
    _progress('zones', 80, 'Construyendo zonas para visualizacion...')
    segments = get_vp_segments(candles, vp_period, bins)
    # seg_lookup: segmento de REFERENCIA (anterior completado) - usado para trading
    seg_lookup = build_segment_lookup(segments, len(candles), vp_period)

    # seg_visual: segmento al que PERTENECE la vela visualmente (start_idx <= i < end_idx)
    seg_visual = [None] * len(candles)
    for seg in segments:
        for i in range(seg['start_idx'], min(seg['end_idx'], len(candles))):
            seg_visual[i] = seg

    # Convertir trades a formato ZoneVisualizerIndicator (zonas VP)
    zones = []
    for idx, trade in enumerate(trades):
        if trade['result'] == 'SKIP':
            continue

        entry_idx = trade['entry_idx']

        # Segmento de referencia (del que se tomaron VAH/VAL/POC para el trade)
        ref_seg = seg_lookup[entry_idx] if entry_idx < len(seg_lookup) else None

        # Segmento visual (donde el entry ocurre temporalmente en el chart)
        vis_seg = seg_visual[entry_idx] if entry_idx < len(seg_visual) else None

        # Para la zona visual, usar el segmento de referencia (cuyos niveles se usaron)
        # porque ese es el VP cuyo VAH/VAL se rompio
        if ref_seg:
            zone_start_ts = ref_seg['start_ts']
            # Extender la zona hasta el entry del trade para conexion visual
            zone_end_ts = max(ref_seg['end_ts'], trade['entry_ts'])
            full_range_min = ref_seg['profile']['min_price']
            full_range_max = ref_seg['profile']['max_price']
        else:
            zone_start_ts = trade['entry_ts']
            zone_end_ts = trade['entry_ts']
            full_range_min = trade.get('val', trade['entry_price'] * 0.99)
            full_range_max = trade.get('vah', trade['entry_price'] * 1.01)

        zone = {
            'timeline_index': idx + 1,
            'start_timestamp': zone_start_ts,
            'end_timestamp': zone_end_ts,
            'min_price': trade.get('val', trade['sl']),  # VAL como min del VA
            'max_price': trade.get('vah', trade['tp']),   # VAH como max del VA
            'full_range_min': full_range_min,
            'full_range_max': full_range_max,
            'entry_price': trade['entry_price'],
            'sl_price': trade['sl'],
            'tp_price': trade['tp'],
            'entry_timestamp': trade['entry_ts'],
            'trade_result': trade['result'],
            'trade_close_timestamp': trade.get('close_ts'),
            'trade_pnl_r': trade.get('pnl_r', 0),
            'direction': trade['direction'],
            'poc_price': trade.get('poc'),
            'bars_held': trade.get('bars_held', 0),
            '_source': 'vp',
        }
        zones.append(zone)

    _progress('done', 100, f'Completado: {len(zones)} zonas, {metrics["closed"]} trades cerrados')

    return {
        'success': True,
        'trades': trades,
        'zones': zones,
        'metrics': metrics,
        'segments_count': len(segments),
        'candles_count': len(candles),
    }


# ---------------------------------------------------------------------------
# Pretty Print Results
# ---------------------------------------------------------------------------

def print_metrics(name: str, metrics: Dict):
    """Imprime metricas formateadas."""
    print(f"\n{'='*70}")
    print(f"  {name}")
    print(f"{'='*70}")
    print(f"  Total trades:       {metrics['total_trades']}")
    print(f"  Cerrados:           {metrics['closed']}  (W:{metrics['wins']} / L:{metrics['losses']})")
    print(f"  Abiertos:           {metrics['open']}")
    print(f"  Win Rate:           {metrics['win_rate']}%")
    print(f"  Total PnL (R):      {metrics['total_pnl_r']}")
    print(f"  Expectancy (R):     {metrics['expectancy']}")
    print(f"  Profit Factor:      {metrics['profit_factor']}")
    print(f"  Max Drawdown (R):   {metrics['max_drawdown_r']}")
    print(f"  Avg Winner (R):     {metrics['avg_winner_r']}")
    print(f"  Avg Loser (R):      {metrics['avg_loser_r']}")
    print(f"  Max Consec Wins:    {metrics['max_consec_wins']}")
    print(f"  Max Consec Losses:  {metrics['max_consec_losses']}")
    print(f"  Avg Bars Held:      {metrics['avg_bars_held']}")
    print(f"{'='*70}")


def print_comparison_table(all_results: List[Dict]):
    """Imprime tabla comparativa de todas las variaciones."""
    print(f"\n\n{'#'*90}")
    print(f"  TABLA COMPARATIVA - Todas las variaciones")
    print(f"{'#'*90}")
    print(f"\n  {'Estrategia':<40} {'WR%':>6} {'Trades':>7} {'PnL(R)':>8} {'Expect':>8} {'PF':>6} {'MaxDD':>7} {'ConsW':>6} {'ConsL':>6}")
    print(f"  {'-'*40} {'-'*6} {'-'*7} {'-'*8} {'-'*8} {'-'*6} {'-'*7} {'-'*6} {'-'*6}")

    for r in sorted(all_results, key=lambda x: x['metrics']['total_pnl_r'], reverse=True):
        m = r['metrics']
        name = r['name'][:40]
        print(f"  {name:<40} {m['win_rate']:>5.1f}% {m['closed']:>7} {m['total_pnl_r']:>8.1f} {m['expectancy']:>8.3f} {m['profit_factor']:>6.2f} {m['max_drawdown_r']:>7.1f} {m['max_consec_wins']:>6} {m['max_consec_losses']:>6}")

    print()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main():
    print("=" * 70)
    print("  BACKTEST VP PERIODIC + VWAP")
    print(f"  {SYMBOL} | {INTERVAL}min | {DAYS} dias")
    print("=" * 70)

    # 1. Cargar datos
    t0 = time.time()
    print(f"\n[1/4] Descargando {DAYS} dias de velas de {SYMBOL}...")
    candles = await fetch_candles(SYMBOL, INTERVAL, DAYS)
    t_fetch = time.time() - t0
    print(f"  -> {len(candles)} velas cargadas en {t_fetch:.1f}s")
    print(f"  -> Rango: {datetime.fromtimestamp(candles[0]['timestamp']/1000, tz=timezone.utc).strftime('%Y-%m-%d')} "
          f"a {datetime.fromtimestamp(candles[-1]['timestamp']/1000, tz=timezone.utc).strftime('%Y-%m-%d')}")

    # 2. Calcular Rolling VWAP
    print(f"\n[2/4] Calculando Rolling VWAP (period=20) + bandas sigma...")
    t1 = time.time()
    vwap_data = compute_vwap_rolling(candles, period=20)
    print(f"  -> {len(vwap_data)} puntos VWAP en {time.time()-t1:.2f}s")

    # 3. Ejecutar las 3 estrategias con variaciones
    print(f"\n[3/4] Ejecutando backtesting de 3 estrategias (15 variaciones)...")
    all_results = []

    # Strategy 1: POC Bounce
    for var in STRATEGY_VARIATIONS["POC Bounce"]:
        t2 = time.time()
        trades = strategy_poc_bounce(candles, vwap_data,
                                     vp_period=var["vp_period"],
                                     tp_rr=var["tp_rr"])
        metrics = calculate_metrics(trades)
        elapsed = time.time() - t2
        name = f"S1: POC Bounce ({var['label']})"
        all_results.append({'name': name, 'metrics': metrics, 'trades': trades, 'time': elapsed})
        print(f"  -> {name}: {metrics['closed']} trades, WR={metrics['win_rate']}%, PnL={metrics['total_pnl_r']}R ({elapsed:.1f}s)")

    # Strategy 2: VA Breakout
    for var in STRATEGY_VARIATIONS["VA Breakout"]:
        t2 = time.time()
        trades = strategy_va_breakout(candles, vwap_data,
                                      vp_period=var["vp_period"],
                                      tp_rr=var["tp_rr"],
                                      confirm_bars=var["confirm_bars"])
        metrics = calculate_metrics(trades)
        elapsed = time.time() - t2
        name = f"S2: VA Breakout ({var['label']})"
        all_results.append({'name': name, 'metrics': metrics, 'trades': trades, 'time': elapsed})
        print(f"  -> {name}: {metrics['closed']} trades, WR={metrics['win_rate']}%, PnL={metrics['total_pnl_r']}R ({elapsed:.1f}s)")

    # Strategy 3: Rejection Confluence
    for var in STRATEGY_VARIATIONS["Rejection Confluence"]:
        t2 = time.time()
        trades = strategy_rejection_confluence(candles, vwap_data,
                                               vp_period=var["vp_period"],
                                               tolerance_pct=var["tolerance_pct"],
                                               wick_ratio=var["wick_ratio"])
        metrics = calculate_metrics(trades)
        elapsed = time.time() - t2
        name = f"S3: Rejection ({var['label']})"
        all_results.append({'name': name, 'metrics': metrics, 'trades': trades, 'time': elapsed})
        print(f"  -> {name}: {metrics['closed']} trades, WR={metrics['win_rate']}%, PnL={metrics['total_pnl_r']}R ({elapsed:.1f}s)")

    # 4. Mostrar resultados
    print(f"\n[4/4] Resultados detallados...")

    # Top 3 overall
    top3 = sorted(all_results, key=lambda x: x['metrics']['total_pnl_r'], reverse=True)[:3]
    for r in top3:
        print_metrics(r['name'], r['metrics'])

    # Tabla comparativa
    print_comparison_table(all_results)

    # Guardar resultados en JSON (sin trades individuales para no hacer archivo enorme)
    output = {
        'symbol': SYMBOL,
        'interval': INTERVAL,
        'days': DAYS,
        'candles_count': len(candles),
        'date_range': {
            'start': datetime.fromtimestamp(candles[0]['timestamp']/1000, tz=timezone.utc).isoformat(),
            'end': datetime.fromtimestamp(candles[-1]['timestamp']/1000, tz=timezone.utc).isoformat(),
        },
        'results': [{
            'name': r['name'],
            'metrics': {k: v for k, v in r['metrics'].items() if k != 'equity_curve'},
            'time_seconds': round(r['time'], 2),
            'sample_trades': r['trades'][:5] if r['trades'] else [],
        } for r in all_results]
    }

    output_path = os.path.join(os.path.dirname(__file__), 'backtest_vp_periodic_results.json')
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n  Resultados guardados en: {output_path}")

    total_time = time.time() - t0
    print(f"\n  Tiempo total: {total_time:.1f}s ({total_time/60:.1f} minutos)")


if __name__ == "__main__":
    asyncio.run(main())
