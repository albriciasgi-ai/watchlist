#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Strategy Builder (Order Flow) - Test Runner Automatizado
=========================================================
Ejecuta todas las pruebas del protocolo de forma secuencial,
guarda resultados en CSV y evalua PASS/FAIL automaticamente.

Incluye tests para los componentes Order Flow:
- Level Sources: of_poc_cluster, of_imbalance_zones, of_high_volume_node,
                 of_abandoned_va, of_aligned_poc
- Entry Signals: of_absorption, of_stacked_trigger,
                 of_delta_divergence, of_delta_tail, of_exhaustion
- Context Filters: of_delta_bias, of_poc_position,
                   of_accumulation, of_delta_volume_ratio, of_extreme_delta

Requisitos: Python 3.8+ (solo usa stdlib)
Backend de Order Flow debe estar corriendo en el puerto configurado.

Uso:
  python run_strategy_tests.py
  python run_strategy_tests.py --url http://localhost:11000
  python run_strategy_tests.py --symbol ETHUSDT
  python run_strategy_tests.py --tests A1,A2,G1,G2
  python run_strategy_tests.py --group G
"""

import json
import copy
import time
import sys
import os
import argparse
import urllib.request
import urllib.error
from datetime import datetime

# =========================================================================
# CONFIGURACION - Editar aqui para ajustar
# =========================================================================

BACKEND_URL = "http://localhost:11000"
DEFAULT_SYMBOL = "BTCUSDT"
DEFAULT_INTERVAL = "60"
DEFAULT_DAYS = 90

# Timeout por test (segundos)
TEST_TIMEOUT = 300  # 5 minutos max por test

# Nombre del CSV de salida
OUTPUT_CSV = None  # Se genera automaticamente con timestamp


# =========================================================================
# BASELINE CONFIG
# =========================================================================

def baseline_config():
    """Retorna la configuracion base para todas las pruebas.
    Identica a App 8 pero incluye OF level sources (deshabilitados por defecto)."""
    return {
        "level_sources": [
            {
                "source": "vp_periodic",
                "enabled": True,
                "params": {
                    "period": 240,
                    "bins": 50,
                    "use_poc": True,
                    "use_vah": True,
                    "use_val": True,
                    "lookback_segments": 1,
                }
            },
            {"source": "vp_zones", "enabled": False, "params": {}},
            {"source": "sr_v2", "enabled": False, "params": {
                "swing_bars": 3, "cluster_distance_pct": 0.3,
                "min_touches": 2, "max_levels": 10, "recalc_every": 100
            }},
            {"source": "vwap_bands", "enabled": False, "params": {}},
            {"source": "swing_levels", "enabled": False, "params": {"swing_bars": 5}},
            {"source": "dtb_neckline", "enabled": False, "params": {
                "candles_per_extreme": 5, "price_margin_pct": 2.0,
                "min_candles_between": 10
            }},
            # === ORDER FLOW LEVEL SOURCES ===
            {"source": "of_poc_cluster", "enabled": False, "params": {
                "period": 20, "min_persistence": 5, "cluster_pct": 0.15, "step_size": 0
            }},
            {"source": "of_imbalance_zones", "enabled": False, "params": {
                "period": 20, "imbalance_threshold": 2.5, "min_imbalances": 3, "step_size": 0
            }},
            {"source": "of_high_volume_node", "enabled": False, "params": {
                "period": 30, "min_zscore": 1.5, "top_n": 3, "step_size": 0
            }},
            {"source": "of_abandoned_va", "enabled": False, "params": {
                "period": 20, "va_pct": 0.70, "min_abandoned": 1, "step_size": 0
            }},
            {"source": "of_aligned_poc", "enabled": False, "params": {
                "period": 20, "min_aligned": 3, "tolerance_pct": 0.10, "step_size": 0
            }},
        ],
        "entry_signal": {
            "signal_type": "price_touch",
            "params": {"tolerance_pct": 0.15}
        },
        "context_filters": [
            {"filter_type": "direction", "enabled": True, "params": {"allowed": "both"}},
            {"filter_type": "vwap_trend", "enabled": False, "params": {"lookback": 10, "min_diff_pct": 0}},
            {"filter_type": "vwap_position", "enabled": False, "params": {"mode": "trend", "long_ref": "vwap", "short_ref": "vwap"}},
            {"filter_type": "ttm_squeeze", "enabled": False, "params": {"require_squeeze": True}},
            {"filter_type": "bbwp_range", "enabled": False, "params": {"min_val": 0, "max_val": 50}},
            {"filter_type": "volume_zscore", "enabled": False, "params": {"min_zscore": 1.5, "lookback": 20}},
            {"filter_type": "cvd_trend", "enabled": False, "params": {"lookback": 20}},
            {"filter_type": "dtb_bias", "enabled": False, "params": {"lookback": 50, "min_confidence": 50}},
            {"filter_type": "vp_shape", "enabled": False, "params": {"allowed_shapes": ["all"]}},
            # === ORDER FLOW CONTEXT FILTERS ===
            {"filter_type": "of_delta_bias", "enabled": False, "params": {"lookback": 10, "min_ratio": 0.55}},
            {"filter_type": "of_poc_position", "enabled": False, "params": {"lookback": 20, "mode": "trend"}},
            {"filter_type": "of_accumulation", "enabled": False, "params": {"lookback": 10, "min_ratio": 0.55}},
            {"filter_type": "of_delta_volume_ratio", "enabled": False, "params": {"min_ratio": 0.25, "lookback": 5}},
            {"filter_type": "of_extreme_delta", "enabled": False, "params": {"percentile": 95.0, "lookback": 50}},
        ],
        "risk": {
            "sl_method": "below_level",
            "sl_params": {"buffer_pct": 0.10},
            "tp_method": "rr_fixed",
            "tp_params": {"rr": 2.0},
            "max_trades_per_segment": 1,
            "cooldown_bars": 0,
        },
        "exit_rules": [],
        "confluence_mode": "any",
        "min_confluence_score": 0,
        "vwap_period": 20,
    }


# =========================================================================
# HELPERS - Modificadores de configuracion
# =========================================================================

def set_level_param(cfg, source_id, param_key, value):
    """Modifica un parametro de una level source."""
    for ls in cfg["level_sources"]:
        if ls["source"] == source_id:
            ls["params"][param_key] = value
            return
    raise ValueError(f"Level source '{source_id}' no encontrada")


def set_level_enabled(cfg, source_id, enabled):
    """Activa/desactiva una level source."""
    for ls in cfg["level_sources"]:
        if ls["source"] == source_id:
            ls["enabled"] = enabled
            return
    raise ValueError(f"Level source '{source_id}' no encontrada")


def set_entry_signal(cfg, signal_type, params=None):
    """Cambia la senal de entrada."""
    cfg["entry_signal"] = {
        "signal_type": signal_type,
        "params": params or {}
    }


def set_filter_enabled(cfg, filter_type, enabled, params=None):
    """Activa/desactiva un filtro de contexto, opcionalmente cambia params."""
    for f in cfg["context_filters"]:
        if f["filter_type"] == filter_type:
            f["enabled"] = enabled
            if params:
                f["params"].update(params)
            return
    # Si no existe, agregar
    cfg["context_filters"].append({
        "filter_type": filter_type,
        "enabled": enabled,
        "params": params or {}
    })


def set_risk(cfg, **kwargs):
    """Modifica parametros de riesgo."""
    for key, value in kwargs.items():
        if key in ("sl_method", "tp_method", "max_trades_per_segment", "cooldown_bars"):
            cfg["risk"][key] = value
        elif key == "sl_params":
            cfg["risk"]["sl_params"] = value
        elif key == "tp_params":
            cfg["risk"]["tp_params"] = value


def add_exit_rule(cfg, rule_type, params=None):
    """Agrega una exit rule."""
    cfg["exit_rules"].append({
        "rule_type": rule_type,
        "enabled": True,
        "params": params or {}
    })


# =========================================================================
# DEFINICION DE TESTS
# =========================================================================

def define_all_tests():
    """
    Retorna lista de tests. Cada test es un dict:
    {
        "id": str,
        "group": str,
        "desc": str,
        "param_changed": str,
        "baseline_val": str,
        "test_val": str,
        "expected": str,  # Descripcion del efecto esperado
        "modify": callable(cfg),  # Funcion que modifica el config
        "checks": list[str],  # Lista de evaluaciones automaticas
        "symbol": str (optional),
        "interval": str (optional),
        "days": int (optional),
    }
    """
    tests = []

    # =====================================================================
    # GRUPO A: Level Sources (clasicos)
    # =====================================================================

    tests.append({
        "id": "A1", "group": "Level Sources",
        "desc": "VP Period 120",
        "param_changed": "vp_periodic.period",
        "baseline_val": "240", "test_val": "120",
        "expected": "Trades != baseline (segmentos mas cortos)",
        "modify": lambda cfg: set_level_param(cfg, "vp_periodic", "period", 120),
        "checks": ["trades_diff"],
    })

    tests.append({
        "id": "A2", "group": "Level Sources",
        "desc": "VP Bins 20",
        "param_changed": "vp_periodic.bins",
        "baseline_val": "50", "test_val": "20",
        "expected": "WR o PnL != baseline (resolucion diferente)",
        "modify": lambda cfg: set_level_param(cfg, "vp_periodic", "bins", 20),
        "checks": ["wr_diff_or_pnl_diff"],
    })

    def a3_modify(cfg):
        set_level_param(cfg, "vp_periodic", "use_vah", False)
        set_level_param(cfg, "vp_periodic", "use_val", False)
    tests.append({
        "id": "A3", "group": "Level Sources",
        "desc": "Solo POC (sin VAH/VAL)",
        "param_changed": "vp_periodic.use_vah + use_val",
        "baseline_val": "ON", "test_val": "OFF",
        "expected": "Trades < baseline (menos niveles)",
        "modify": a3_modify,
        "checks": ["trades_less"],
    })

    tests.append({
        "id": "A4", "group": "Level Sources",
        "desc": "Lookback Segments 0",
        "param_changed": "vp_periodic.lookback_segments",
        "baseline_val": "1", "test_val": "0",
        "expected": "Trades != baseline (niveles permanentes)",
        "modify": lambda cfg: set_level_param(cfg, "vp_periodic", "lookback_segments", 0),
        "checks": ["trades_diff"],
    })

    def a5_modify(cfg):
        set_level_enabled(cfg, "vp_periodic", False)
        set_level_enabled(cfg, "sr_v2", True)
    tests.append({
        "id": "A5", "group": "Level Sources",
        "desc": "S&R v2 solo",
        "param_changed": "Level source",
        "baseline_val": "vp_periodic", "test_val": "sr_v2",
        "expected": "Trades != baseline (fuente diferente)",
        "modify": a5_modify,
        "checks": ["trades_diff"],
    })

    def a6_modify(cfg):
        set_level_enabled(cfg, "vp_periodic", False)
        set_level_enabled(cfg, "vwap_bands", True)
    tests.append({
        "id": "A6", "group": "Level Sources",
        "desc": "VWAP Bands solo",
        "param_changed": "Level source",
        "baseline_val": "vp_periodic", "test_val": "vwap_bands",
        "expected": "Trades != baseline (niveles dinamicos)",
        "modify": a6_modify,
        "checks": ["trades_diff"],
    })

    def a7_modify(cfg):
        set_level_enabled(cfg, "vp_periodic", False)
        set_level_enabled(cfg, "swing_levels", True)
    tests.append({
        "id": "A7", "group": "Level Sources",
        "desc": "Swing Levels solo",
        "param_changed": "Level source",
        "baseline_val": "vp_periodic", "test_val": "swing_levels",
        "expected": "Trades != baseline y != A5",
        "modify": a7_modify,
        "checks": ["trades_diff"],
    })

    def a8_modify(cfg):
        set_level_enabled(cfg, "sr_v2", True)
    tests.append({
        "id": "A8", "group": "Level Sources",
        "desc": "VP + SR v2 (any)",
        "param_changed": "Level sources",
        "baseline_val": "1 fuente", "test_val": "2 fuentes",
        "expected": "Trades >= baseline (mas niveles)",
        "modify": a8_modify,
        "checks": ["trades_more_or_equal"],
    })

    def a9_modify(cfg):
        set_level_enabled(cfg, "sr_v2", True)
        cfg["confluence_mode"] = "score"
        cfg["min_confluence_score"] = 30
    tests.append({
        "id": "A9", "group": "Level Sources",
        "desc": "VP + SR v2 (score 30)",
        "param_changed": "confluence_mode + min_score",
        "baseline_val": "any/0", "test_val": "score/30",
        "expected": "Trades < A8 (filtro confluencia)",
        "modify": a9_modify,
        "checks": ["filt_confluence_active"],
    })

    # =====================================================================
    # GRUPO B: Entry Signals (clasicos)
    # =====================================================================

    tests.append({
        "id": "B1", "group": "Entry Signal",
        "desc": "Tolerancia 0.50",
        "param_changed": "tolerance_pct",
        "baseline_val": "0.15", "test_val": "0.50",
        "expected": "Signals > baseline (mas permisivo)",
        "modify": lambda cfg: set_entry_signal(cfg, "price_touch", {"tolerance_pct": 0.50}),
        "checks": ["signals_more"],
    })

    tests.append({
        "id": "B2", "group": "Entry Signal",
        "desc": "Tolerancia 0.05",
        "param_changed": "tolerance_pct",
        "baseline_val": "0.15", "test_val": "0.05",
        "expected": "Signals < baseline (mas restrictivo)",
        "modify": lambda cfg: set_entry_signal(cfg, "price_touch", {"tolerance_pct": 0.05}),
        "checks": ["signals_less"],
    })

    tests.append({
        "id": "B3", "group": "Entry Signal",
        "desc": "Breakout Close",
        "param_changed": "signal_type",
        "baseline_val": "price_touch", "test_val": "breakout_close",
        "expected": "WR o PnL != baseline (logica inversa)",
        "modify": lambda cfg: set_entry_signal(cfg, "breakout_close", {"tolerance_pct": 0.10}),
        "checks": ["wr_diff_or_pnl_diff"],
    })

    tests.append({
        "id": "B4", "group": "Entry Signal",
        "desc": "Swing Confirm",
        "param_changed": "signal_type",
        "baseline_val": "price_touch", "test_val": "swing_confirm",
        "expected": "Trades < baseline (necesita confirmacion)",
        "modify": lambda cfg: set_entry_signal(cfg, "swing_confirm", {"tolerance_pct": 0.30, "swing_bars": 3}),
        "checks": ["trades_diff"],
    })

    tests.append({
        "id": "B5", "group": "Entry Signal",
        "desc": "Rejection Candle",
        "param_changed": "signal_type",
        "baseline_val": "price_touch", "test_val": "rejection_candle",
        "expected": "Trades != baseline",
        "modify": lambda cfg: set_entry_signal(cfg, "rejection_candle", {"tolerance_pct": 0.30, "wick_body_ratio": 2.0}),
        "checks": ["trades_diff"],
    })

    tests.append({
        "id": "B6", "group": "Entry Signal",
        "desc": "Squeeze Release",
        "param_changed": "signal_type",
        "baseline_val": "price_touch", "test_val": "squeeze_release",
        "expected": "Trades != baseline (independiente de niveles)",
        "modify": lambda cfg: set_entry_signal(cfg, "squeeze_release", {}),
        "checks": ["trades_diff"],
    })

    tests.append({
        "id": "B7", "group": "Entry Signal",
        "desc": "Pattern Match Engulfing",
        "param_changed": "signal_type",
        "baseline_val": "price_touch", "test_val": "pattern_match (engulfing)",
        "expected": "Trades != baseline",
        "modify": lambda cfg: set_entry_signal(cfg, "pattern_match", {"tolerance_pct": 0.30, "pattern_type": "engulfing"}),
        "checks": ["trades_diff"],
    })

    tests.append({
        "id": "B8", "group": "Entry Signal",
        "desc": "CVD Divergence",
        "param_changed": "signal_type",
        "baseline_val": "price_touch", "test_val": "cvd_divergence",
        "expected": "Trades != baseline",
        "modify": lambda cfg: set_entry_signal(cfg, "cvd_divergence", {"lookback": 20}),
        "checks": ["trades_diff"],
    })

    # =====================================================================
    # GRUPO C: Context Filters (clasicos)
    # =====================================================================

    tests.append({
        "id": "C1", "group": "Context Filter",
        "desc": "Direction LONG",
        "param_changed": "direction.allowed",
        "baseline_val": "both", "test_val": "long",
        "expected": "Trades < baseline + filt_direction > 0",
        "modify": lambda cfg: set_filter_enabled(cfg, "direction", True, {"allowed": "long"}),
        "checks": ["trades_less", "filt_direction_active"],
    })

    tests.append({
        "id": "C2", "group": "Context Filter",
        "desc": "Direction SHORT",
        "param_changed": "direction.allowed",
        "baseline_val": "both", "test_val": "short",
        "expected": "Trades < baseline + C1+C2 ~= baseline",
        "modify": lambda cfg: set_filter_enabled(cfg, "direction", True, {"allowed": "short"}),
        "checks": ["trades_less", "filt_direction_active"],
    })

    tests.append({
        "id": "C3", "group": "Context Filter",
        "desc": "VWAP Trend",
        "param_changed": "filtro nuevo",
        "baseline_val": "OFF", "test_val": "vwap_trend ON",
        "expected": "Trades < baseline + filt_context.vwap_trend > 0",
        "modify": lambda cfg: set_filter_enabled(cfg, "vwap_trend", True, {"lookback": 10, "min_diff_pct": 0}),
        "checks": ["trades_less_or_equal", "filt_context_vwap_trend_active"],
    })

    def c4_modify(cfg):
        set_filter_enabled(cfg, "ttm_squeeze", True, {"require_squeeze": True})
    tests.append({
        "id": "C4", "group": "Context Filter",
        "desc": "TTM Squeeze ON",
        "param_changed": "filtro nuevo",
        "baseline_val": "OFF", "test_val": "ttm_squeeze ON (require=true)",
        "expected": "Trades <= baseline + filt_context.ttm_squeeze > 0",
        "modify": c4_modify,
        "checks": ["trades_less_or_equal", "filt_context_ttm_squeeze_active"],
    })

    def c5_modify(cfg):
        set_filter_enabled(cfg, "ttm_squeeze", True, {"require_squeeze": False})
    tests.append({
        "id": "C5", "group": "Context Filter",
        "desc": "TTM Squeeze OFF",
        "param_changed": "filtro nuevo",
        "baseline_val": "OFF", "test_val": "ttm_squeeze ON (require=false)",
        "expected": "Trades < baseline + C4+C5 ~= baseline",
        "modify": c5_modify,
        "checks": ["trades_less_or_equal", "filt_context_ttm_squeeze_active"],
    })

    tests.append({
        "id": "C6", "group": "Context Filter",
        "desc": "BBWP Range 0-30",
        "param_changed": "filtro nuevo",
        "baseline_val": "OFF", "test_val": "bbwp_range (0-30)",
        "expected": "Trades <= baseline + filt_context.bbwp_range > 0",
        "modify": lambda cfg: set_filter_enabled(cfg, "bbwp_range", True, {"min_val": 0, "max_val": 30}),
        "checks": ["trades_less_or_equal", "filt_context_bbwp_range_active"],
    })

    tests.append({
        "id": "C7", "group": "Context Filter",
        "desc": "Volume Z-Score 1.5",
        "param_changed": "filtro nuevo",
        "baseline_val": "OFF", "test_val": "volume_zscore (1.5)",
        "expected": "Trades < baseline + filt_context.volume_zscore > 0",
        "modify": lambda cfg: set_filter_enabled(cfg, "volume_zscore", True, {"min_zscore": 1.5, "lookback": 20}),
        "checks": ["trades_less", "filt_context_volume_zscore_active"],
    })

    tests.append({
        "id": "C8", "group": "Context Filter",
        "desc": "CVD Trend",
        "param_changed": "filtro nuevo",
        "baseline_val": "OFF", "test_val": "cvd_trend ON",
        "expected": "Trades < baseline + filt_context.cvd_trend > 0",
        "modify": lambda cfg: set_filter_enabled(cfg, "cvd_trend", True, {"lookback": 20}),
        "checks": ["trades_less_or_equal", "filt_context_cvd_trend_active"],
    })

    tests.append({
        "id": "C9", "group": "Context Filter",
        "desc": "VWAP Position trend",
        "param_changed": "filtro nuevo",
        "baseline_val": "OFF", "test_val": "vwap_position (trend)",
        "expected": "Trades < baseline + filt_context.vwap_position > 0",
        "modify": lambda cfg: set_filter_enabled(cfg, "vwap_position", True, {"mode": "trend", "long_ref": "vwap", "short_ref": "vwap"}),
        "checks": ["trades_less_or_equal", "filt_context_vwap_position_active"],
    })

    def c10_modify(cfg):
        set_filter_enabled(cfg, "vwap_trend", True, {"lookback": 10, "min_diff_pct": 0})
        set_filter_enabled(cfg, "volume_zscore", True, {"min_zscore": 1.5, "lookback": 20})
    tests.append({
        "id": "C10", "group": "Context Filter",
        "desc": "2 filtros AND",
        "param_changed": "filtros",
        "baseline_val": "0 filtros", "test_val": "vwap_trend + vol_zscore",
        "expected": "Trades < min(C3; C7)",
        "modify": c10_modify,
        "checks": ["trades_less"],
    })

    # =====================================================================
    # GRUPO D: Risk Management
    # =====================================================================

    tests.append({
        "id": "D1", "group": "Risk",
        "desc": "TP RR 1.0",
        "param_changed": "tp_params.rr",
        "baseline_val": "2.0", "test_val": "1.0",
        "expected": "WR% > baseline + trades = baseline",
        "modify": lambda cfg: set_risk(cfg, tp_params={"rr": 1.0}),
        "checks": ["wr_higher", "trades_equal"],
    })

    tests.append({
        "id": "D2", "group": "Risk",
        "desc": "TP RR 4.0",
        "param_changed": "tp_params.rr",
        "baseline_val": "2.0", "test_val": "4.0",
        "expected": "WR% < baseline + trades = baseline",
        "modify": lambda cfg: set_risk(cfg, tp_params={"rr": 4.0}),
        "checks": ["wr_lower", "trades_equal"],
    })

    tests.append({
        "id": "D3", "group": "Risk",
        "desc": "SL ATR Multiple",
        "param_changed": "sl_method",
        "baseline_val": "below_level", "test_val": "atr_multiple (1.5)",
        "expected": "WR% o PnL != baseline",
        "modify": lambda cfg: set_risk(cfg, sl_method="atr_multiple", sl_params={"atr_multiplier": 1.5}),
        "checks": ["wr_diff_or_pnl_diff"],
    })

    tests.append({
        "id": "D4", "group": "Risk",
        "desc": "SL Fixed 1%",
        "param_changed": "sl_method",
        "baseline_val": "below_level", "test_val": "fixed_pct (1.0)",
        "expected": "WR% != baseline",
        "modify": lambda cfg: set_risk(cfg, sl_method="fixed_pct", sl_params={"fixed_pct": 1.0}),
        "checks": ["wr_diff"],
    })

    tests.append({
        "id": "D5", "group": "Risk",
        "desc": "TP Opposite Level",
        "param_changed": "tp_method",
        "baseline_val": "rr_fixed", "test_val": "opposite_level (fb=2.0)",
        "expected": "WR% != baseline (TPs variables)",
        "modify": lambda cfg: set_risk(cfg, tp_method="opposite_level", tp_params={"fallback_rr": 2.0}),
        "checks": ["wr_diff"],
    })

    tests.append({
        "id": "D6", "group": "Risk",
        "desc": "Max Trades/Seg 3",
        "param_changed": "max_trades_per_segment",
        "baseline_val": "1", "test_val": "3",
        "expected": "Trades >= baseline + filt_maxSeg baja",
        "modify": lambda cfg: set_risk(cfg, max_trades_per_segment=3),
        "checks": ["trades_more_or_equal"],
    })

    tests.append({
        "id": "D7", "group": "Risk",
        "desc": "Cooldown 100 bars",
        "param_changed": "cooldown_bars",
        "baseline_val": "0", "test_val": "100",
        "expected": "Trades < baseline + filt_cooldown > 0",
        "modify": lambda cfg: set_risk(cfg, cooldown_bars=100),
        "checks": ["trades_less", "filt_cooldown_active"],
    })

    tests.append({
        "id": "D8", "group": "Risk",
        "desc": "SL Below Swing",
        "param_changed": "sl_method",
        "baseline_val": "below_level", "test_val": "below_swing (0.10)",
        "expected": "SL diferente al baseline (filt_sl_dir cambia)",
        "modify": lambda cfg: set_risk(cfg, sl_method="below_swing", sl_params={"buffer_pct": 0.10}),
        "checks": ["filt_sl_dir_diff"],
    })

    # =====================================================================
    # GRUPO E: Exit Rules
    # =====================================================================

    tests.append({
        "id": "E1", "group": "Exit Rules",
        "desc": "Timeout 30 bars",
        "param_changed": "exit rule nueva",
        "baseline_val": "OFF", "test_val": "timeout (30)",
        "expected": "WR% != baseline + trades = baseline",
        "modify": lambda cfg: add_exit_rule(cfg, "timeout", {"max_bars": 30}),
        "checks": ["trades_equal"],
    })

    tests.append({
        "id": "E2", "group": "Exit Rules",
        "desc": "VWAP Reverse",
        "param_changed": "exit rule nueva",
        "baseline_val": "OFF", "test_val": "vwap_reverse (10)",
        "expected": "WR% != baseline + trades = baseline",
        "modify": lambda cfg: add_exit_rule(cfg, "vwap_reverse", {"lookback": 10}),
        "checks": ["trades_equal"],
    })

    tests.append({
        "id": "E3", "group": "Exit Rules",
        "desc": "Re-enter Zone",
        "param_changed": "exit rule nueva",
        "baseline_val": "OFF", "test_val": "reenter_zone",
        "expected": "Se ejecuta sin error",
        "modify": lambda cfg: add_exit_rule(cfg, "reenter_zone", {}),
        "checks": ["no_error"],
    })

    tests.append({
        "id": "E4", "group": "Exit Rules",
        "desc": "Squeeze Activate",
        "param_changed": "exit rule nueva",
        "baseline_val": "OFF", "test_val": "squeeze_activate",
        "expected": "Se ejecuta sin error",
        "modify": lambda cfg: add_exit_rule(cfg, "squeeze_activate", {}),
        "checks": ["no_error"],
    })

    def e5_modify(cfg):
        add_exit_rule(cfg, "timeout", {"max_bars": 30})
        add_exit_rule(cfg, "vwap_reverse", {"lookback": 10})
    tests.append({
        "id": "E5", "group": "Exit Rules",
        "desc": "Timeout + VWAP Rev",
        "param_changed": "exit rules",
        "baseline_val": "OFF", "test_val": "timeout(30) + vwap_rev(10)",
        "expected": "WR% diferente a E1 y E2",
        "modify": e5_modify,
        "checks": ["trades_equal"],
    })

    # =====================================================================
    # GRUPO F: Determinismo y Edge Cases
    # =====================================================================

    # F1a, F1b, F1c - 3 ejecuciones identicas del baseline
    tests.append({
        "id": "F1a", "group": "Determinismo",
        "desc": "Ejecucion 1 de 3",
        "param_changed": "ninguno",
        "baseline_val": "baseline", "test_val": "baseline",
        "expected": "Hash IDENTICO a F1b y F1c",
        "modify": lambda cfg: None,
        "checks": ["hash_equal"],
    })
    tests.append({
        "id": "F1b", "group": "Determinismo",
        "desc": "Ejecucion 2 de 3",
        "param_changed": "ninguno",
        "baseline_val": "baseline", "test_val": "baseline",
        "expected": "Hash = F1a",
        "modify": lambda cfg: None,
        "checks": ["hash_equal"],
    })
    tests.append({
        "id": "F1c", "group": "Determinismo",
        "desc": "Ejecucion 3 de 3",
        "param_changed": "ninguno",
        "baseline_val": "baseline", "test_val": "baseline",
        "expected": "Hash = F1a",
        "modify": lambda cfg: None,
        "checks": ["hash_equal"],
    })

    # F2 - Cambio intermedio y vuelta
    tests.append({
        "id": "F2a", "group": "Determinismo",
        "desc": "Antes del cambio",
        "param_changed": "ninguno",
        "baseline_val": "baseline", "test_val": "baseline",
        "expected": "Anotar hash y trades",
        "modify": lambda cfg: None,
        "checks": ["hash_equal"],
    })
    tests.append({
        "id": "F2b", "group": "Determinismo",
        "desc": "Cambio intermedio",
        "param_changed": "vp_periodic.period",
        "baseline_val": "240", "test_val": "120",
        "expected": "Diferente de F2a",
        "modify": lambda cfg: set_level_param(cfg, "vp_periodic", "period", 120),
        "checks": ["trades_diff"],
    })
    tests.append({
        "id": "F2c", "group": "Determinismo",
        "desc": "Vuelta al original",
        "param_changed": "vp_periodic.period",
        "baseline_val": "120", "test_val": "240",
        "expected": "Hash y trades = F2a",
        "modify": lambda cfg: None,
        "checks": ["hash_equal", "trades_equal"],
    })

    # F3 - Sin level sources
    def f3_modify(cfg):
        for ls in cfg["level_sources"]:
            ls["enabled"] = False
    tests.append({
        "id": "F3", "group": "Edge Case",
        "desc": "Sin Level Sources",
        "param_changed": "todas las fuentes",
        "baseline_val": "vp_periodic ON", "test_val": "todas OFF",
        "expected": "0 trades sin error",
        "modify": f3_modify,
        "checks": ["no_error", "trades_zero"],
    })

    # F4 - Timeframe diferente
    tests.append({
        "id": "F4", "group": "Edge Case",
        "desc": "Timeframe 5min 30d",
        "param_changed": "interval + days",
        "baseline_val": "60/90", "test_val": "5/30",
        "expected": "Se ejecuta sin errores",
        "modify": lambda cfg: None,
        "interval": "5", "days": 30,
        "checks": ["no_error"],
    })

    # F5 - Simbolo diferente
    tests.append({
        "id": "F5", "group": "Edge Case",
        "desc": "Simbolo ETHUSDT",
        "param_changed": "symbol",
        "baseline_val": "BTCUSDT", "test_val": "ETHUSDT",
        "expected": "WR o PnL != baseline (datos diferentes)",
        "modify": lambda cfg: None,
        "symbol": "ETHUSDT",
        "checks": ["wr_diff_or_pnl_diff"],
    })

    # =====================================================================
    # GRUPO G: Order Flow Level Sources
    # =====================================================================

    # G1 - OF POC Cluster como unica fuente
    def g1_modify(cfg):
        set_level_enabled(cfg, "vp_periodic", False)
        set_level_enabled(cfg, "of_poc_cluster", True)
    tests.append({
        "id": "G1", "group": "OF Level Sources",
        "desc": "OF POC Cluster solo",
        "param_changed": "Level source",
        "baseline_val": "vp_periodic", "test_val": "of_poc_cluster",
        "expected": "Trades != baseline (fuente OF diferente)",
        "modify": g1_modify,
        "checks": ["trades_diff"],
    })

    # G2 - OF POC Cluster con period diferente
    def g2_modify(cfg):
        set_level_enabled(cfg, "vp_periodic", False)
        set_level_enabled(cfg, "of_poc_cluster", True)
        set_level_param(cfg, "of_poc_cluster", "period", 40)
    tests.append({
        "id": "G2", "group": "OF Level Sources",
        "desc": "OF POC Cluster period=40",
        "param_changed": "of_poc_cluster.period",
        "baseline_val": "20", "test_val": "40",
        "expected": "Trades != G1 (segmentos mas largos)",
        "modify": g2_modify,
        "checks": ["no_error"],
    })

    # G3 - OF POC Cluster con min_persistence baja
    def g3_modify(cfg):
        set_level_enabled(cfg, "vp_periodic", False)
        set_level_enabled(cfg, "of_poc_cluster", True)
        set_level_param(cfg, "of_poc_cluster", "min_persistence", 3)
    tests.append({
        "id": "G3", "group": "OF Level Sources",
        "desc": "OF POC Cluster persist=3",
        "param_changed": "of_poc_cluster.min_persistence",
        "baseline_val": "5", "test_val": "3",
        "expected": "Mas niveles detectados (mas permisivo)",
        "modify": g3_modify,
        "checks": ["no_error"],
    })

    # G4 - OF Imbalance Zones como unica fuente
    def g4_modify(cfg):
        set_level_enabled(cfg, "vp_periodic", False)
        set_level_enabled(cfg, "of_imbalance_zones", True)
    tests.append({
        "id": "G4", "group": "OF Level Sources",
        "desc": "OF Imbalance Zones solo",
        "param_changed": "Level source",
        "baseline_val": "vp_periodic", "test_val": "of_imbalance_zones",
        "expected": "Trades != baseline (fuente OF diferente)",
        "modify": g4_modify,
        "checks": ["trades_diff"],
    })

    # G5 - OF Imbalance Zones con threshold bajo
    def g5_modify(cfg):
        set_level_enabled(cfg, "vp_periodic", False)
        set_level_enabled(cfg, "of_imbalance_zones", True)
        set_level_param(cfg, "of_imbalance_zones", "imbalance_threshold", 1.5)
    tests.append({
        "id": "G5", "group": "OF Level Sources",
        "desc": "OF Imbalance thresh=1.5",
        "param_changed": "of_imbalance_zones.imbalance_threshold",
        "baseline_val": "2.5", "test_val": "1.5",
        "expected": "Mas niveles (mas desequilibrios detectados)",
        "modify": g5_modify,
        "checks": ["no_error"],
    })

    # G6 - OF High Volume Node como unica fuente
    def g6_modify(cfg):
        set_level_enabled(cfg, "vp_periodic", False)
        set_level_enabled(cfg, "of_high_volume_node", True)
    tests.append({
        "id": "G6", "group": "OF Level Sources",
        "desc": "OF High Volume Node solo",
        "param_changed": "Level source",
        "baseline_val": "vp_periodic", "test_val": "of_high_volume_node",
        "expected": "Trades != baseline (fuente OF diferente)",
        "modify": g6_modify,
        "checks": ["trades_diff"],
    })

    # G7 - OF HVN con zscore bajo
    def g7_modify(cfg):
        set_level_enabled(cfg, "vp_periodic", False)
        set_level_enabled(cfg, "of_high_volume_node", True)
        set_level_param(cfg, "of_high_volume_node", "min_zscore", 1.0)
    tests.append({
        "id": "G7", "group": "OF Level Sources",
        "desc": "OF HVN zscore=1.0",
        "param_changed": "of_high_volume_node.min_zscore",
        "baseline_val": "1.5", "test_val": "1.0",
        "expected": "Mas niveles (umbral mas bajo)",
        "modify": g7_modify,
        "checks": ["no_error"],
    })

    # G8 - OF HVN con top_n=5
    def g8_modify(cfg):
        set_level_enabled(cfg, "vp_periodic", False)
        set_level_enabled(cfg, "of_high_volume_node", True)
        set_level_param(cfg, "of_high_volume_node", "top_n", 5)
    tests.append({
        "id": "G8", "group": "OF Level Sources",
        "desc": "OF HVN top_n=5",
        "param_changed": "of_high_volume_node.top_n",
        "baseline_val": "3", "test_val": "5",
        "expected": "Mas niveles por segmento",
        "modify": g8_modify,
        "checks": ["no_error"],
    })

    # G9 - VP + OF POC Cluster combinados (confluence any)
    def g9_modify(cfg):
        set_level_enabled(cfg, "of_poc_cluster", True)
    tests.append({
        "id": "G9", "group": "OF Level Sources",
        "desc": "VP + OF POC (any)",
        "param_changed": "Level sources",
        "baseline_val": "1 fuente", "test_val": "vp + of_poc (any)",
        "expected": "Trades >= baseline (mas niveles)",
        "modify": g9_modify,
        "checks": ["trades_more_or_equal"],
    })

    # G10 - VP + OF POC Cluster (confluence score)
    def g10_modify(cfg):
        set_level_enabled(cfg, "of_poc_cluster", True)
        cfg["confluence_mode"] = "score"
        cfg["min_confluence_score"] = 30
    tests.append({
        "id": "G10", "group": "OF Level Sources",
        "desc": "VP + OF POC (score 30)",
        "param_changed": "confluence_mode + min_score",
        "baseline_val": "any/0", "test_val": "score/30",
        "expected": "Trades filtrados por confluencia",
        "modify": g10_modify,
        "checks": ["filt_confluence_active"],
    })

    # G11 - Todas las fuentes OF activadas
    def g11_modify(cfg):
        set_level_enabled(cfg, "vp_periodic", False)
        set_level_enabled(cfg, "of_poc_cluster", True)
        set_level_enabled(cfg, "of_imbalance_zones", True)
        set_level_enabled(cfg, "of_high_volume_node", True)
    tests.append({
        "id": "G11", "group": "OF Level Sources",
        "desc": "3 fuentes OF juntas",
        "param_changed": "Level sources",
        "baseline_val": "vp_periodic", "test_val": "3x OF sources",
        "expected": "Se ejecuta sin error + trades > 0",
        "modify": g11_modify,
        "checks": ["no_error"],
    })

    # G12 - OF Abandoned VA como unica fuente
    def g12_modify(cfg):
        set_level_enabled(cfg, "vp_periodic", False)
        set_level_enabled(cfg, "of_abandoned_va", True)
    tests.append({
        "id": "G12", "group": "OF Level Sources",
        "desc": "OF Abandoned VA solo",
        "param_changed": "Level source",
        "baseline_val": "vp_periodic", "test_val": "of_abandoned_va",
        "expected": "Trades != baseline (fuente OF diferente)",
        "modify": g12_modify,
        "checks": ["trades_diff"],
    })

    # G13 - OF Abandoned VA con va_pct alto
    def g13_modify(cfg):
        set_level_enabled(cfg, "vp_periodic", False)
        set_level_enabled(cfg, "of_abandoned_va", True)
        set_level_param(cfg, "of_abandoned_va", "va_pct", 0.85)
    tests.append({
        "id": "G13", "group": "OF Level Sources",
        "desc": "OF Abandoned VA va_pct=0.85",
        "param_changed": "of_abandoned_va.va_pct",
        "baseline_val": "0.70", "test_val": "0.85",
        "expected": "Mas zonas abandonadas (VA mas ancha = mas facil abandonar)",
        "modify": g13_modify,
        "checks": ["no_error"],
    })

    # G14 - OF Aligned POC como unica fuente
    def g14_modify(cfg):
        set_level_enabled(cfg, "vp_periodic", False)
        set_level_enabled(cfg, "of_aligned_poc", True)
    tests.append({
        "id": "G14", "group": "OF Level Sources",
        "desc": "OF Aligned POC solo",
        "param_changed": "Level source",
        "baseline_val": "vp_periodic", "test_val": "of_aligned_poc",
        "expected": "Trades != baseline (fuente OF diferente)",
        "modify": g14_modify,
        "checks": ["trades_diff"],
    })

    # G15 - OF Aligned POC con min_aligned bajo
    def g15_modify(cfg):
        set_level_enabled(cfg, "vp_periodic", False)
        set_level_enabled(cfg, "of_aligned_poc", True)
        set_level_param(cfg, "of_aligned_poc", "min_aligned", 2)
    tests.append({
        "id": "G15", "group": "OF Level Sources",
        "desc": "OF Aligned POC min=2",
        "param_changed": "of_aligned_poc.min_aligned",
        "baseline_val": "3", "test_val": "2",
        "expected": "Mas niveles (requisito mas bajo)",
        "modify": g15_modify,
        "checks": ["no_error"],
    })

    # G16 - OF Aligned POC con tolerancia amplia
    def g16_modify(cfg):
        set_level_enabled(cfg, "vp_periodic", False)
        set_level_enabled(cfg, "of_aligned_poc", True)
        set_level_param(cfg, "of_aligned_poc", "tolerance_pct", 0.25)
    tests.append({
        "id": "G16", "group": "OF Level Sources",
        "desc": "OF Aligned POC tol=0.25",
        "param_changed": "of_aligned_poc.tolerance_pct",
        "baseline_val": "0.10", "test_val": "0.25",
        "expected": "Mas niveles (tolerancia mas amplia)",
        "modify": g16_modify,
        "checks": ["no_error"],
    })

    # G17 - Todas las 5 fuentes OF activadas
    def g17_modify(cfg):
        set_level_enabled(cfg, "vp_periodic", False)
        set_level_enabled(cfg, "of_poc_cluster", True)
        set_level_enabled(cfg, "of_imbalance_zones", True)
        set_level_enabled(cfg, "of_high_volume_node", True)
        set_level_enabled(cfg, "of_abandoned_va", True)
        set_level_enabled(cfg, "of_aligned_poc", True)
    tests.append({
        "id": "G17", "group": "OF Level Sources",
        "desc": "5 fuentes OF juntas",
        "param_changed": "Level sources",
        "baseline_val": "vp_periodic", "test_val": "5x OF sources",
        "expected": "Se ejecuta sin error + trades > 0",
        "modify": g17_modify,
        "checks": ["no_error"],
    })

    # =====================================================================
    # GRUPO H: Order Flow Entry Signals
    # =====================================================================

    # H1 - OF Absorption signal
    tests.append({
        "id": "H1", "group": "OF Entry Signal",
        "desc": "OF Absorption",
        "param_changed": "signal_type",
        "baseline_val": "price_touch", "test_val": "of_absorption",
        "expected": "Trades != baseline (logica OF)",
        "modify": lambda cfg: set_entry_signal(cfg, "of_absorption", {
            "lookback": 5, "min_delta_ratio": 2.0, "tolerance_pct": 0.20
        }),
        "checks": ["trades_diff"],
    })

    # H2 - OF Absorption con parametros permisivos
    tests.append({
        "id": "H2", "group": "OF Entry Signal",
        "desc": "OF Absorption permisivo",
        "param_changed": "of_absorption params",
        "baseline_val": "default", "test_val": "lookback=10, ratio=1.5, tol=0.4",
        "expected": "Mas senales que H1 (mas permisivo)",
        "modify": lambda cfg: set_entry_signal(cfg, "of_absorption", {
            "lookback": 10, "min_delta_ratio": 1.5, "tolerance_pct": 0.40
        }),
        "checks": ["no_error"],
    })

    # H3 - OF Stacked Trigger signal
    tests.append({
        "id": "H3", "group": "OF Entry Signal",
        "desc": "OF Stacked Trigger",
        "param_changed": "signal_type",
        "baseline_val": "price_touch", "test_val": "of_stacked_trigger",
        "expected": "Trades != baseline (logica OF stacked)",
        "modify": lambda cfg: set_entry_signal(cfg, "of_stacked_trigger", {
            "lookback": 3, "min_consecutive": 3, "tolerance_pct": 0.20
        }),
        "checks": ["trades_diff"],
    })

    # H4 - OF Stacked Trigger con min_consecutive bajo
    tests.append({
        "id": "H4", "group": "OF Entry Signal",
        "desc": "OF Stacked consecutive=2",
        "param_changed": "of_stacked_trigger.min_consecutive",
        "baseline_val": "3", "test_val": "2",
        "expected": "Mas senales (requisito mas bajo)",
        "modify": lambda cfg: set_entry_signal(cfg, "of_stacked_trigger", {
            "lookback": 3, "min_consecutive": 2, "tolerance_pct": 0.20
        }),
        "checks": ["no_error"],
    })

    # H5 - OF Absorption + OF Level Source
    def h5_modify(cfg):
        set_level_enabled(cfg, "of_poc_cluster", True)
        set_entry_signal(cfg, "of_absorption", {
            "lookback": 5, "min_delta_ratio": 2.0, "tolerance_pct": 0.20
        })
    tests.append({
        "id": "H5", "group": "OF Entry Signal",
        "desc": "OF Absorption + OF POC",
        "param_changed": "signal + levels",
        "baseline_val": "price_touch + vp", "test_val": "of_absorption + vp + of_poc",
        "expected": "Combinacion OF completa",
        "modify": h5_modify,
        "checks": ["no_error"],
    })

    # H6 - OF Delta Divergence signal
    tests.append({
        "id": "H6", "group": "OF Entry Signal",
        "desc": "OF Delta Divergence",
        "param_changed": "signal_type",
        "baseline_val": "price_touch", "test_val": "of_delta_divergence",
        "expected": "Trades != baseline (logica divergencia OF)",
        "modify": lambda cfg: set_entry_signal(cfg, "of_delta_divergence", {
            "lookback": 10, "tolerance_pct": 0.30
        }),
        "checks": ["trades_diff"],
    })

    # H7 - OF Delta Divergence con lookback corto
    tests.append({
        "id": "H7", "group": "OF Entry Signal",
        "desc": "OF Delta Divergence lb=5",
        "param_changed": "of_delta_divergence.lookback",
        "baseline_val": "10", "test_val": "5",
        "expected": "Menos divergencias (ventana mas corta)",
        "modify": lambda cfg: set_entry_signal(cfg, "of_delta_divergence", {
            "lookback": 5, "tolerance_pct": 0.30
        }),
        "checks": ["no_error"],
    })

    # H8 - OF Delta Tail signal
    tests.append({
        "id": "H8", "group": "OF Entry Signal",
        "desc": "OF Delta Tail",
        "param_changed": "signal_type",
        "baseline_val": "price_touch", "test_val": "of_delta_tail",
        "expected": "Trades != baseline (absorcion en extremos)",
        "modify": lambda cfg: set_entry_signal(cfg, "of_delta_tail", {
            "min_tail_ratio": 0.6, "tolerance_pct": 0.30
        }),
        "checks": ["trades_diff"],
    })

    # H9 - OF Delta Tail con ratio bajo (mas permisivo)
    tests.append({
        "id": "H9", "group": "OF Entry Signal",
        "desc": "OF Delta Tail ratio=0.3",
        "param_changed": "of_delta_tail.min_tail_ratio",
        "baseline_val": "0.6", "test_val": "0.3",
        "expected": "Mas senales (requisito mas bajo)",
        "modify": lambda cfg: set_entry_signal(cfg, "of_delta_tail", {
            "min_tail_ratio": 0.3, "tolerance_pct": 0.30
        }),
        "checks": ["no_error"],
    })

    # H10 - OF Exhaustion signal
    tests.append({
        "id": "H10", "group": "OF Entry Signal",
        "desc": "OF Exhaustion",
        "param_changed": "signal_type",
        "baseline_val": "price_touch", "test_val": "of_exhaustion",
        "expected": "Trades != baseline (agotamiento en extremos)",
        "modify": lambda cfg: set_entry_signal(cfg, "of_exhaustion", {
            "max_extreme_vol_pct": 10.0, "n_extreme_levels": 3, "tolerance_pct": 0.30
        }),
        "checks": ["trades_diff"],
    })

    # H11 - OF Exhaustion con pct mas permisivo
    tests.append({
        "id": "H11", "group": "OF Entry Signal",
        "desc": "OF Exhaustion pct=20",
        "param_changed": "of_exhaustion.max_extreme_vol_pct",
        "baseline_val": "10", "test_val": "20",
        "expected": "Mas senales (umbral mas permisivo)",
        "modify": lambda cfg: set_entry_signal(cfg, "of_exhaustion", {
            "max_extreme_vol_pct": 20.0, "n_extreme_levels": 3, "tolerance_pct": 0.30
        }),
        "checks": ["no_error"],
    })

    # H12 - OF Delta Divergence + OF Level Source
    def h12_modify(cfg):
        set_level_enabled(cfg, "of_poc_cluster", True)
        set_entry_signal(cfg, "of_delta_divergence", {
            "lookback": 10, "tolerance_pct": 0.30
        })
    tests.append({
        "id": "H12", "group": "OF Entry Signal",
        "desc": "OF DeltaDiv + OF POC",
        "param_changed": "signal + levels",
        "baseline_val": "price_touch + vp", "test_val": "of_delta_div + vp + of_poc",
        "expected": "Combinacion OF completa",
        "modify": h12_modify,
        "checks": ["no_error"],
    })

    # =====================================================================
    # GRUPO I: Order Flow Context Filters
    # =====================================================================

    # I1 - OF Delta Bias filter
    tests.append({
        "id": "I1", "group": "OF Context Filter",
        "desc": "OF Delta Bias ON",
        "param_changed": "filtro nuevo",
        "baseline_val": "OFF", "test_val": "of_delta_bias ON (ratio=0.55)",
        "expected": "Trades <= baseline + filt_context.of_delta_bias > 0",
        "modify": lambda cfg: set_filter_enabled(cfg, "of_delta_bias", True, {"lookback": 10, "min_ratio": 0.55}),
        "checks": ["trades_less_or_equal", "filt_context_of_delta_bias_active"],
    })

    # I2 - OF Delta Bias con ratio alto (mas restrictivo)
    tests.append({
        "id": "I2", "group": "OF Context Filter",
        "desc": "OF Delta Bias ratio=0.70",
        "param_changed": "of_delta_bias.min_ratio",
        "baseline_val": "0.55", "test_val": "0.70",
        "expected": "Mas filtrado que I1 (ratio mas estricto)",
        "modify": lambda cfg: set_filter_enabled(cfg, "of_delta_bias", True, {"lookback": 10, "min_ratio": 0.70}),
        "checks": ["trades_less_or_equal"],
    })

    # I3 - OF POC Position filter (trend)
    tests.append({
        "id": "I3", "group": "OF Context Filter",
        "desc": "OF POC Position (trend)",
        "param_changed": "filtro nuevo",
        "baseline_val": "OFF", "test_val": "of_poc_position ON (trend)",
        "expected": "Trades <= baseline + filt_context.of_poc_position > 0",
        "modify": lambda cfg: set_filter_enabled(cfg, "of_poc_position", True, {"lookback": 20, "mode": "trend"}),
        "checks": ["trades_less_or_equal", "filt_context_of_poc_position_active"],
    })

    # I4 - OF POC Position filter (counter)
    tests.append({
        "id": "I4", "group": "OF Context Filter",
        "desc": "OF POC Position (counter)",
        "param_changed": "of_poc_position.mode",
        "baseline_val": "trend", "test_val": "counter",
        "expected": "Trades != I3 (logica opuesta)",
        "modify": lambda cfg: set_filter_enabled(cfg, "of_poc_position", True, {"lookback": 20, "mode": "counter"}),
        "checks": ["trades_less_or_equal"],
    })

    # I5 - Delta Bias + POC Position combinados
    def i5_modify(cfg):
        set_filter_enabled(cfg, "of_delta_bias", True, {"lookback": 10, "min_ratio": 0.55})
        set_filter_enabled(cfg, "of_poc_position", True, {"lookback": 20, "mode": "trend"})
    tests.append({
        "id": "I5", "group": "OF Context Filter",
        "desc": "Delta Bias + POC Position",
        "param_changed": "filtros",
        "baseline_val": "0 OF filtros", "test_val": "delta_bias + poc_pos",
        "expected": "Trades < min(I1; I3)",
        "modify": i5_modify,
        "checks": ["trades_less"],
    })

    # I6 - Todos los filtros OF + clasicos combinados
    def i6_modify(cfg):
        set_filter_enabled(cfg, "vwap_trend", True, {"lookback": 10, "min_diff_pct": 0})
        set_filter_enabled(cfg, "of_delta_bias", True, {"lookback": 10, "min_ratio": 0.55})
        set_filter_enabled(cfg, "of_poc_position", True, {"lookback": 20, "mode": "trend"})
    tests.append({
        "id": "I6", "group": "OF Context Filter",
        "desc": "VWAP Trend + 2 OF filtros",
        "param_changed": "filtros",
        "baseline_val": "0 filtros", "test_val": "vwap_trend + delta_bias + poc_pos",
        "expected": "Trades < baseline (multiples filtros AND)",
        "modify": i6_modify,
        "checks": ["trades_less"],
    })

    # I7 - OF Accumulation filter
    tests.append({
        "id": "I7", "group": "OF Context Filter",
        "desc": "OF Accumulation ON",
        "param_changed": "filtro nuevo",
        "baseline_val": "OFF", "test_val": "of_accumulation ON (ratio=0.55)",
        "expected": "Trades <= baseline + filt_context.of_accumulation > 0",
        "modify": lambda cfg: set_filter_enabled(cfg, "of_accumulation", True, {"lookback": 10, "min_ratio": 0.55}),
        "checks": ["trades_less_or_equal", "filt_context_of_accumulation_active"],
    })

    # I8 - OF Accumulation con ratio alto (mas restrictivo)
    tests.append({
        "id": "I8", "group": "OF Context Filter",
        "desc": "OF Accumulation ratio=0.70",
        "param_changed": "of_accumulation.min_ratio",
        "baseline_val": "0.55", "test_val": "0.70",
        "expected": "Mas filtrado que I7 (ratio mas estricto)",
        "modify": lambda cfg: set_filter_enabled(cfg, "of_accumulation", True, {"lookback": 10, "min_ratio": 0.70}),
        "checks": ["trades_less_or_equal"],
    })

    # I9 - OF Delta/Volume Ratio filter
    tests.append({
        "id": "I9", "group": "OF Context Filter",
        "desc": "OF Delta/Vol Ratio ON",
        "param_changed": "filtro nuevo",
        "baseline_val": "OFF", "test_val": "of_delta_volume_ratio ON (ratio=0.25)",
        "expected": "Trades <= baseline + filt_context.of_delta_volume_ratio > 0",
        "modify": lambda cfg: set_filter_enabled(cfg, "of_delta_volume_ratio", True, {"min_ratio": 0.25, "lookback": 5}),
        "checks": ["trades_less_or_equal", "filt_context_of_delta_volume_ratio_active"],
    })

    # I10 - OF Delta/Volume Ratio con ratio alto
    tests.append({
        "id": "I10", "group": "OF Context Filter",
        "desc": "OF Delta/Vol ratio=0.40",
        "param_changed": "of_delta_volume_ratio.min_ratio",
        "baseline_val": "0.25", "test_val": "0.40",
        "expected": "Mas filtrado (ratio mas exigente)",
        "modify": lambda cfg: set_filter_enabled(cfg, "of_delta_volume_ratio", True, {"min_ratio": 0.40, "lookback": 5}),
        "checks": ["trades_less_or_equal"],
    })

    # I11 - OF Extreme Delta filter
    tests.append({
        "id": "I11", "group": "OF Context Filter",
        "desc": "OF Extreme Delta ON",
        "param_changed": "filtro nuevo",
        "baseline_val": "OFF", "test_val": "of_extreme_delta ON (pctl=95)",
        "expected": "Trades <= baseline + filt_context.of_extreme_delta > 0",
        "modify": lambda cfg: set_filter_enabled(cfg, "of_extreme_delta", True, {"percentile": 95.0, "lookback": 50}),
        "checks": ["trades_less_or_equal", "filt_context_of_extreme_delta_active"],
    })

    # I12 - OF Extreme Delta con percentile bajo (mas permisivo)
    tests.append({
        "id": "I12", "group": "OF Context Filter",
        "desc": "OF Extreme Delta pctl=85",
        "param_changed": "of_extreme_delta.percentile",
        "baseline_val": "95", "test_val": "85",
        "expected": "Mas trades que I11 (percentil mas permisivo)",
        "modify": lambda cfg: set_filter_enabled(cfg, "of_extreme_delta", True, {"percentile": 85.0, "lookback": 50}),
        "checks": ["trades_less_or_equal"],
    })

    # I13 - Tres nuevos filtros OF combinados
    def i13_modify(cfg):
        set_filter_enabled(cfg, "of_accumulation", True, {"lookback": 10, "min_ratio": 0.55})
        set_filter_enabled(cfg, "of_delta_volume_ratio", True, {"min_ratio": 0.25, "lookback": 5})
        set_filter_enabled(cfg, "of_extreme_delta", True, {"percentile": 95.0, "lookback": 50})
    tests.append({
        "id": "I13", "group": "OF Context Filter",
        "desc": "3 nuevos filtros OF juntos",
        "param_changed": "filtros",
        "baseline_val": "0 OF filtros", "test_val": "accum + dvr + extreme",
        "expected": "Trades < baseline (AND de 3 filtros)",
        "modify": i13_modify,
        "checks": ["trades_less"],
    })

    # I14 - Todos los 5 filtros OF combinados
    def i14_modify(cfg):
        set_filter_enabled(cfg, "of_delta_bias", True, {"lookback": 10, "min_ratio": 0.55})
        set_filter_enabled(cfg, "of_poc_position", True, {"lookback": 20, "mode": "trend"})
        set_filter_enabled(cfg, "of_accumulation", True, {"lookback": 10, "min_ratio": 0.55})
        set_filter_enabled(cfg, "of_delta_volume_ratio", True, {"min_ratio": 0.25, "lookback": 5})
        set_filter_enabled(cfg, "of_extreme_delta", True, {"percentile": 95.0, "lookback": 50})
    tests.append({
        "id": "I14", "group": "OF Context Filter",
        "desc": "5 filtros OF juntos",
        "param_changed": "filtros",
        "baseline_val": "0 OF filtros", "test_val": "5x OF filters",
        "expected": "Trades < baseline (AND de 5 filtros)",
        "modify": i14_modify,
        "checks": ["trades_less"],
    })

    # I15 - VWAP Trend + 3 nuevos filtros OF
    def i15_modify(cfg):
        set_filter_enabled(cfg, "vwap_trend", True, {"lookback": 10, "min_diff_pct": 0})
        set_filter_enabled(cfg, "of_accumulation", True, {"lookback": 10, "min_ratio": 0.55})
        set_filter_enabled(cfg, "of_delta_volume_ratio", True, {"min_ratio": 0.25, "lookback": 5})
        set_filter_enabled(cfg, "of_extreme_delta", True, {"percentile": 90.0, "lookback": 50})
    tests.append({
        "id": "I15", "group": "OF Context Filter",
        "desc": "VWAP + 3 nuevos OF filtros",
        "param_changed": "filtros",
        "baseline_val": "0 filtros", "test_val": "vwap + accum + dvr + extreme",
        "expected": "Trades < baseline (clasico + OF)",
        "modify": i15_modify,
        "checks": ["trades_less"],
    })

    # =====================================================================
    # GRUPO J: Parameter Validation (Auto-prueba sistematica)
    # =====================================================================
    # Cada test cambia UN parametro y verifica que el resultado difiere.
    # Prueba que cada parametro esta correctamente cableado en el pipeline.
    # Se usa una sub-baseline apropiada para cada componente.

    # --- J1-J6: Level Source params ---
    # J1: vp_periodic.period (120 vs 240)
    tests.append({
        "id": "J1", "group": "Param Validation",
        "desc": "[LevelParam] vp_periodic.period 120 vs 240",
        "param_changed": "vp_periodic.period",
        "baseline_val": "240", "test_val": "120",
        "expected": "Resultado difiere al cambiar period",
        "modify": lambda cfg: set_level_param(cfg, "vp_periodic", "period", 120),
        "checks": ["wr_diff_or_pnl_diff"],
    })

    # J2: vp_periodic.lookback_segments (0 vs 1)
    tests.append({
        "id": "J2", "group": "Param Validation",
        "desc": "[LevelParam] vp_periodic.lookback_segments 0 vs 1",
        "param_changed": "vp_periodic.lookback_segments",
        "baseline_val": "1", "test_val": "0",
        "expected": "Resultado difiere al cambiar lookback",
        "modify": lambda cfg: set_level_param(cfg, "vp_periodic", "lookback_segments", 0),
        "checks": ["wr_diff_or_pnl_diff"],
    })

    # J3: sr_v2 solo - swing_bars 5 vs 3
    def j3_modify(cfg):
        set_level_enabled(cfg, "vp_periodic", False)
        set_level_enabled(cfg, "sr_v2", True)
        set_level_param(cfg, "sr_v2", "swing_bars", 5)
    def j3_alt_modify(cfg):
        set_level_enabled(cfg, "vp_periodic", False)
        set_level_enabled(cfg, "sr_v2", True)
        set_level_param(cfg, "sr_v2", "swing_bars", 3)
    tests.append({
        "id": "J3", "group": "Param Validation",
        "desc": "[LevelParam] sr_v2.swing_bars 5 vs 3",
        "param_changed": "sr_v2.swing_bars",
        "baseline_val": "3", "test_val": "5",
        "expected": "Resultado difiere al cambiar swing_bars",
        "modify": j3_modify,
        "compare_with": "J3_ALT",
        "_alt_modify": j3_alt_modify,
        "checks": ["no_error"],
    })

    # J4: of_poc_cluster solo - min_persistence 3 vs 5
    def j4_modify(cfg):
        set_level_enabled(cfg, "vp_periodic", False)
        set_level_enabled(cfg, "of_poc_cluster", True)
        set_level_param(cfg, "of_poc_cluster", "min_persistence", 3)
    tests.append({
        "id": "J4", "group": "Param Validation",
        "desc": "[LevelParam] of_poc_cluster.min_persistence 3 vs 5",
        "param_changed": "of_poc_cluster.min_persistence",
        "baseline_val": "5", "test_val": "3",
        "expected": "Mas niveles con menor persistencia",
        "modify": j4_modify,
        "checks": ["no_error"],
    })

    # J5: of_imbalance_zones - threshold 1.5 vs 2.5
    def j5_modify(cfg):
        set_level_enabled(cfg, "vp_periodic", False)
        set_level_enabled(cfg, "of_imbalance_zones", True)
        set_level_param(cfg, "of_imbalance_zones", "imbalance_threshold", 1.5)
    tests.append({
        "id": "J5", "group": "Param Validation",
        "desc": "[LevelParam] of_imbalance.threshold 1.5 vs 2.5",
        "param_changed": "of_imbalance_zones.imbalance_threshold",
        "baseline_val": "2.5", "test_val": "1.5",
        "expected": "Mas imbalances con threshold bajo",
        "modify": j5_modify,
        "checks": ["no_error"],
    })

    # J6: of_high_volume_node - min_zscore 1.0 vs 1.5
    def j6_modify(cfg):
        set_level_enabled(cfg, "vp_periodic", False)
        set_level_enabled(cfg, "of_high_volume_node", True)
        set_level_param(cfg, "of_high_volume_node", "min_zscore", 1.0)
    tests.append({
        "id": "J6", "group": "Param Validation",
        "desc": "[LevelParam] of_hvn.min_zscore 1.0 vs 1.5",
        "param_changed": "of_high_volume_node.min_zscore",
        "baseline_val": "1.5", "test_val": "1.0",
        "expected": "Mas nodos con zscore bajo",
        "modify": j6_modify,
        "checks": ["no_error"],
    })

    # --- J7-J16: Entry Signal params ---
    # J7: price_touch tolerance 0.05 vs 0.15
    tests.append({
        "id": "J7", "group": "Param Validation",
        "desc": "[EntryParam] price_touch.tolerance 0.05 vs 0.15",
        "param_changed": "price_touch.tolerance_pct",
        "baseline_val": "0.15", "test_val": "0.05",
        "expected": "Menos trades con tolerancia baja",
        "modify": lambda cfg: set_entry_signal(cfg, "price_touch", {"tolerance_pct": 0.05}),
        "checks": ["wr_diff_or_pnl_diff"],
    })

    # J8: swing_confirm.swing_bars 5 vs 3
    tests.append({
        "id": "J8", "group": "Param Validation",
        "desc": "[EntryParam] swing_confirm.swing_bars 5 vs 3",
        "param_changed": "swing_confirm.swing_bars",
        "baseline_val": "3 (baseline=price_touch)", "test_val": "swing_confirm(sb=5)",
        "expected": "Senal diferente produce resultado diferente",
        "modify": lambda cfg: set_entry_signal(cfg, "swing_confirm", {
            "swing_bars": 5, "tolerance_pct": 0.3
        }),
        "checks": ["trades_diff"],
    })

    # J9: breakout_close tolerance 0.5 vs 0.1
    tests.append({
        "id": "J9", "group": "Param Validation",
        "desc": "[EntryParam] breakout_close.tolerance 0.5 vs 0.1",
        "param_changed": "breakout_close.tolerance_pct",
        "baseline_val": "price_touch", "test_val": "breakout_close(tol=0.5)",
        "expected": "Breakout con tolerancia amplia",
        "modify": lambda cfg: set_entry_signal(cfg, "breakout_close", {"tolerance_pct": 0.5}),
        "checks": ["trades_diff"],
    })

    # J10: rejection_candle.wick_body_ratio 1.5 vs 2.0
    tests.append({
        "id": "J10", "group": "Param Validation",
        "desc": "[EntryParam] rejection_candle.wick_ratio 1.5",
        "param_changed": "rejection_candle.wick_body_ratio",
        "baseline_val": "price_touch", "test_val": "rejection(wick=1.5)",
        "expected": "Mas rejections con ratio bajo",
        "modify": lambda cfg: set_entry_signal(cfg, "rejection_candle", {
            "wick_body_ratio": 1.5, "tolerance_pct": 0.3
        }),
        "checks": ["trades_diff"],
    })

    # J11: of_absorption.min_delta_ratio 1.5 vs 2.0
    tests.append({
        "id": "J11", "group": "Param Validation",
        "desc": "[EntryParam] of_absorption.delta_ratio 1.5 vs 2.0",
        "param_changed": "of_absorption.min_delta_ratio",
        "baseline_val": "price_touch", "test_val": "of_absorption(dr=1.5)",
        "expected": "Mas absorcion con ratio bajo",
        "modify": lambda cfg: set_entry_signal(cfg, "of_absorption", {
            "lookback": 5, "min_delta_ratio": 1.5, "tolerance_pct": 0.2
        }),
        "checks": ["trades_diff"],
    })

    # J12: of_stacked_trigger.min_consecutive 2 vs 3
    tests.append({
        "id": "J12", "group": "Param Validation",
        "desc": "[EntryParam] of_stacked.min_consec 2 vs 3",
        "param_changed": "of_stacked_trigger.min_consecutive",
        "baseline_val": "price_touch", "test_val": "of_stacked(mc=2)",
        "expected": "Mas triggers con requisito bajo",
        "modify": lambda cfg: set_entry_signal(cfg, "of_stacked_trigger", {
            "lookback": 3, "min_consecutive": 2, "tolerance_pct": 0.2
        }),
        "checks": ["trades_diff"],
    })

    # J13: cvd_divergence.lookback 10 vs 20
    tests.append({
        "id": "J13", "group": "Param Validation",
        "desc": "[EntryParam] cvd_divergence.lookback 10 vs 20",
        "param_changed": "cvd_divergence.lookback",
        "baseline_val": "price_touch", "test_val": "cvd_divergence(lb=10)",
        "expected": "Divergencia con lookback corto",
        "modify": lambda cfg: set_entry_signal(cfg, "cvd_divergence", {"lookback": 10}),
        "checks": ["trades_diff"],
    })

    # J14: of_delta_divergence.lookback 5 vs 10
    tests.append({
        "id": "J14", "group": "Param Validation",
        "desc": "[EntryParam] of_delta_div.lookback 5 vs 10",
        "param_changed": "of_delta_divergence.lookback",
        "baseline_val": "price_touch", "test_val": "of_delta_div(lb=5)",
        "expected": "Divergencia OF con lookback corto",
        "modify": lambda cfg: set_entry_signal(cfg, "of_delta_divergence", {
            "lookback": 5, "tolerance_pct": 0.3
        }),
        "checks": ["trades_diff"],
    })

    # J15: of_delta_tail.min_tail_ratio 0.3 vs 0.6
    tests.append({
        "id": "J15", "group": "Param Validation",
        "desc": "[EntryParam] of_delta_tail.ratio 0.3 vs 0.6",
        "param_changed": "of_delta_tail.min_tail_ratio",
        "baseline_val": "price_touch", "test_val": "of_delta_tail(r=0.3)",
        "expected": "Mas tails con ratio bajo",
        "modify": lambda cfg: set_entry_signal(cfg, "of_delta_tail", {
            "min_tail_ratio": 0.3, "tolerance_pct": 0.3
        }),
        "checks": ["trades_diff"],
    })

    # J16: of_exhaustion.max_extreme_vol_pct 20 vs 10
    tests.append({
        "id": "J16", "group": "Param Validation",
        "desc": "[EntryParam] of_exhaustion.vol_pct 20 vs 10",
        "param_changed": "of_exhaustion.max_extreme_vol_pct",
        "baseline_val": "price_touch", "test_val": "of_exhaustion(pct=20)",
        "expected": "Mas exhaustion con pct alto",
        "modify": lambda cfg: set_entry_signal(cfg, "of_exhaustion", {
            "max_extreme_vol_pct": 20.0, "n_extreme_levels": 3, "tolerance_pct": 0.3
        }),
        "checks": ["trades_diff"],
    })

    # --- J17-J28: Context Filter params ---
    # J17: vwap_trend.lookback 50 vs 10
    tests.append({
        "id": "J17", "group": "Param Validation",
        "desc": "[FilterParam] vwap_trend.lookback 50 vs 10",
        "param_changed": "vwap_trend.lookback",
        "baseline_val": "OFF", "test_val": "vwap_trend(lb=50)",
        "expected": "Filtro activo con lookback largo",
        "modify": lambda cfg: set_filter_enabled(cfg, "vwap_trend", True, {"lookback": 50, "min_diff_pct": 0}),
        "checks": ["trades_less_or_equal"],
    })

    # J18: vwap_position.mode counter vs trend
    tests.append({
        "id": "J18", "group": "Param Validation",
        "desc": "[FilterParam] vwap_position.mode counter",
        "param_changed": "vwap_position.mode",
        "baseline_val": "OFF", "test_val": "vwap_position(counter)",
        "expected": "Filtro position en modo counter",
        "modify": lambda cfg: set_filter_enabled(cfg, "vwap_position", True, {
            "mode": "counter", "long_ref": "vwap", "short_ref": "vwap"
        }),
        "checks": ["trades_less_or_equal"],
    })

    # J19: ttm_squeeze (require_squeeze=True)
    tests.append({
        "id": "J19", "group": "Param Validation",
        "desc": "[FilterParam] ttm_squeeze ON",
        "param_changed": "ttm_squeeze.require_squeeze",
        "baseline_val": "OFF", "test_val": "ttm_squeeze(ON)",
        "expected": "Filtro squeeze activo reduce trades",
        "modify": lambda cfg: set_filter_enabled(cfg, "ttm_squeeze", True, {"require_squeeze": True}),
        "checks": ["trades_less_or_equal"],
    })

    # J20: bbwp_range (0-20 = compresion fuerte)
    tests.append({
        "id": "J20", "group": "Param Validation",
        "desc": "[FilterParam] bbwp_range 0-20",
        "param_changed": "bbwp_range.max_val",
        "baseline_val": "OFF", "test_val": "bbwp_range(0-20)",
        "expected": "Solo trades en compresion fuerte",
        "modify": lambda cfg: set_filter_enabled(cfg, "bbwp_range", True, {"min_val": 0, "max_val": 20}),
        "checks": ["trades_less_or_equal"],
    })

    # J21: volume_zscore.min_zscore 2.5
    tests.append({
        "id": "J21", "group": "Param Validation",
        "desc": "[FilterParam] volume_zscore min=2.5",
        "param_changed": "volume_zscore.min_zscore",
        "baseline_val": "OFF", "test_val": "vol_zscore(2.5)",
        "expected": "Solo trades con volumen anomalo alto",
        "modify": lambda cfg: set_filter_enabled(cfg, "volume_zscore", True, {"min_zscore": 2.5, "lookback": 20}),
        "checks": ["trades_less_or_equal"],
    })

    # J22: cvd_trend.lookback 30
    tests.append({
        "id": "J22", "group": "Param Validation",
        "desc": "[FilterParam] cvd_trend lb=30",
        "param_changed": "cvd_trend.lookback",
        "baseline_val": "OFF", "test_val": "cvd_trend(lb=30)",
        "expected": "Filtro CVD activo",
        "modify": lambda cfg: set_filter_enabled(cfg, "cvd_trend", True, {"lookback": 30}),
        "checks": ["trades_less_or_equal"],
    })

    # J23: direction=long
    tests.append({
        "id": "J23", "group": "Param Validation",
        "desc": "[FilterParam] direction=long",
        "param_changed": "direction.allowed",
        "baseline_val": "both", "test_val": "long",
        "expected": "Solo trades LONG",
        "modify": lambda cfg: set_filter_enabled(cfg, "direction", True, {"allowed": "long"}),
        "checks": ["trades_less_or_equal", "filt_direction_active"],
    })

    # J24: of_delta_bias.lookback 5 vs 10
    tests.append({
        "id": "J24", "group": "Param Validation",
        "desc": "[FilterParam] of_delta_bias lb=5",
        "param_changed": "of_delta_bias.lookback",
        "baseline_val": "OFF", "test_val": "of_delta_bias(lb=5)",
        "expected": "Filtro delta bias con lookback corto",
        "modify": lambda cfg: set_filter_enabled(cfg, "of_delta_bias", True, {"lookback": 5, "min_ratio": 0.55}),
        "checks": ["trades_less_or_equal"],
    })

    # J25: of_poc_position.lookback 10
    tests.append({
        "id": "J25", "group": "Param Validation",
        "desc": "[FilterParam] of_poc_position lb=10",
        "param_changed": "of_poc_position.lookback",
        "baseline_val": "OFF", "test_val": "of_poc_pos(lb=10)",
        "expected": "Filtro POC position con lookback corto",
        "modify": lambda cfg: set_filter_enabled(cfg, "of_poc_position", True, {"lookback": 10, "mode": "trend"}),
        "checks": ["trades_less_or_equal"],
    })

    # J26: of_accumulation.min_ratio 0.65
    tests.append({
        "id": "J26", "group": "Param Validation",
        "desc": "[FilterParam] of_accum ratio=0.65",
        "param_changed": "of_accumulation.min_ratio",
        "baseline_val": "OFF", "test_val": "of_accum(r=0.65)",
        "expected": "Filtro acumulacion estricto",
        "modify": lambda cfg: set_filter_enabled(cfg, "of_accumulation", True, {"lookback": 10, "min_ratio": 0.65}),
        "checks": ["trades_less_or_equal"],
    })

    # J27: of_delta_volume_ratio.min_ratio 0.35
    tests.append({
        "id": "J27", "group": "Param Validation",
        "desc": "[FilterParam] of_dvr ratio=0.35",
        "param_changed": "of_delta_volume_ratio.min_ratio",
        "baseline_val": "OFF", "test_val": "of_dvr(r=0.35)",
        "expected": "Filtro delta/vol ratio estricto",
        "modify": lambda cfg: set_filter_enabled(cfg, "of_delta_volume_ratio", True, {"min_ratio": 0.35, "lookback": 5}),
        "checks": ["trades_less_or_equal"],
    })

    # J28: of_extreme_delta.percentile 90
    tests.append({
        "id": "J28", "group": "Param Validation",
        "desc": "[FilterParam] of_extreme_delta pctl=90",
        "param_changed": "of_extreme_delta.percentile",
        "baseline_val": "OFF", "test_val": "of_extreme(p=90)",
        "expected": "Filtro extreme delta con percentil 90",
        "modify": lambda cfg: set_filter_enabled(cfg, "of_extreme_delta", True, {"percentile": 90.0, "lookback": 50}),
        "checks": ["trades_less_or_equal"],
    })

    # --- J29-J36: Risk Management params ---
    # J29: SL method atr_multiple
    tests.append({
        "id": "J29", "group": "Param Validation",
        "desc": "[Risk] SL atr_multiple vs below_level",
        "param_changed": "risk.sl_method",
        "baseline_val": "below_level", "test_val": "atr_multiple",
        "expected": "SL diferente cambia resultados",
        "modify": lambda cfg: set_risk(cfg, sl_method="atr_multiple", sl_params={"atr_multiplier": 1.5}),
        "checks": ["wr_diff_or_pnl_diff"],
    })

    # J30: SL method fixed_pct
    tests.append({
        "id": "J30", "group": "Param Validation",
        "desc": "[Risk] SL fixed_pct 2.0",
        "param_changed": "risk.sl_method",
        "baseline_val": "below_level", "test_val": "fixed_pct(2.0)",
        "expected": "SL fijo cambia resultados",
        "modify": lambda cfg: set_risk(cfg, sl_method="fixed_pct", sl_params={"fixed_pct": 2.0}),
        "checks": ["wr_diff_or_pnl_diff"],
    })

    # J31: SL below_level buffer_pct 0.5 vs 0.1
    tests.append({
        "id": "J31", "group": "Param Validation",
        "desc": "[Risk] SL buffer 0.5 vs 0.1",
        "param_changed": "risk.sl_params.buffer_pct",
        "baseline_val": "0.1", "test_val": "0.5",
        "expected": "Buffer amplio cambia WR o PnL",
        "modify": lambda cfg: set_risk(cfg, sl_params={"buffer_pct": 0.5}),
        "checks": ["wr_diff_or_pnl_diff"],
    })

    # J32: TP method opposite_level
    tests.append({
        "id": "J32", "group": "Param Validation",
        "desc": "[Risk] TP opposite_level vs rr_fixed",
        "param_changed": "risk.tp_method",
        "baseline_val": "rr_fixed", "test_val": "opposite_level",
        "expected": "TP diferente cambia resultados",
        "modify": lambda cfg: set_risk(cfg, tp_method="opposite_level", tp_params={"fallback_rr": 2.0}),
        "checks": ["wr_diff_or_pnl_diff"],
    })

    # J33: TP rr_fixed rr=4.0 vs 2.0
    tests.append({
        "id": "J33", "group": "Param Validation",
        "desc": "[Risk] TP rr=4.0 vs 2.0",
        "param_changed": "risk.tp_params.rr",
        "baseline_val": "2.0", "test_val": "4.0",
        "expected": "RR mas alto cambia WR y PnL",
        "modify": lambda cfg: set_risk(cfg, tp_params={"rr": 4.0}),
        "checks": ["wr_diff_or_pnl_diff"],
    })

    # J34: TP atr_multiple
    tests.append({
        "id": "J34", "group": "Param Validation",
        "desc": "[Risk] TP atr_multiple 3.0",
        "param_changed": "risk.tp_method",
        "baseline_val": "rr_fixed", "test_val": "atr_multiple(3.0)",
        "expected": "TP ATR cambia resultados",
        "modify": lambda cfg: set_risk(cfg, tp_method="atr_multiple", tp_params={"atr_multiplier": 3.0}),
        "checks": ["wr_diff_or_pnl_diff"],
    })

    # J35: TP fixed_pct
    tests.append({
        "id": "J35", "group": "Param Validation",
        "desc": "[Risk] TP fixed_pct 3.0",
        "param_changed": "risk.tp_method",
        "baseline_val": "rr_fixed", "test_val": "fixed_pct(3.0)",
        "expected": "TP fijo cambia resultados",
        "modify": lambda cfg: set_risk(cfg, tp_method="fixed_pct", tp_params={"fixed_pct": 3.0}),
        "checks": ["wr_diff_or_pnl_diff"],
    })

    # J36: SL below_swing
    tests.append({
        "id": "J36", "group": "Param Validation",
        "desc": "[Risk] SL below_swing vs below_level",
        "param_changed": "risk.sl_method",
        "baseline_val": "below_level", "test_val": "below_swing",
        "expected": "SL swing produce resultado diferente",
        "modify": lambda cfg: set_risk(cfg, sl_method="below_swing", sl_params={"buffer_pct": 0.1}),
        "checks": ["wr_diff_or_pnl_diff"],
    })

    # --- J37-J40: Exit Rules ---
    # J37: vwap_reverse exit rule
    tests.append({
        "id": "J37", "group": "Param Validation",
        "desc": "[Exit] vwap_reverse lb=10",
        "param_changed": "exit_rules",
        "baseline_val": "ninguna", "test_val": "vwap_reverse(lb=10)",
        "expected": "Exit rule reduce trades/cambia PnL",
        "modify": lambda cfg: add_exit_rule(cfg, "vwap_reverse", {"lookback": 10}),
        "checks": ["wr_diff_or_pnl_diff"],
    })

    # J38: timeout exit rule
    tests.append({
        "id": "J38", "group": "Param Validation",
        "desc": "[Exit] timeout 20 bars",
        "param_changed": "exit_rules",
        "baseline_val": "ninguna", "test_val": "timeout(20)",
        "expected": "Timeout corto cambia resultados",
        "modify": lambda cfg: add_exit_rule(cfg, "timeout", {"max_bars": 20}),
        "checks": ["wr_diff_or_pnl_diff"],
    })

    # J39: reenter_zone exit rule
    tests.append({
        "id": "J39", "group": "Param Validation",
        "desc": "[Exit] reenter_zone",
        "param_changed": "exit_rules",
        "baseline_val": "ninguna", "test_val": "reenter_zone",
        "expected": "Reentrar zona cierra trades antes",
        "modify": lambda cfg: add_exit_rule(cfg, "reenter_zone"),
        "checks": ["wr_diff_or_pnl_diff"],
    })

    # J40: squeeze_activate exit rule
    tests.append({
        "id": "J40", "group": "Param Validation",
        "desc": "[Exit] squeeze_activate",
        "param_changed": "exit_rules",
        "baseline_val": "ninguna", "test_val": "squeeze_activate",
        "expected": "Squeeze nuevo cierra trades",
        "modify": lambda cfg: add_exit_rule(cfg, "squeeze_activate"),
        "checks": ["wr_diff_or_pnl_diff"],
    })

    # --- J41-J44: Global params ---
    # J41: max_trades_per_segment 3 vs 1
    tests.append({
        "id": "J41", "group": "Param Validation",
        "desc": "[Global] max_trades_per_seg 3 vs 1",
        "param_changed": "risk.max_trades_per_segment",
        "baseline_val": "1", "test_val": "3",
        "expected": "Mas trades permitidos por segmento",
        "modify": lambda cfg: set_risk(cfg, max_trades_per_segment=3),
        "checks": ["trades_more_or_equal"],
    })

    # J42: cooldown_bars 10 vs 0
    tests.append({
        "id": "J42", "group": "Param Validation",
        "desc": "[Global] cooldown_bars 10 vs 0",
        "param_changed": "risk.cooldown_bars",
        "baseline_val": "0", "test_val": "10",
        "expected": "Cooldown reduce trades",
        "modify": lambda cfg: set_risk(cfg, cooldown_bars=10),
        "checks": ["trades_less_or_equal"],
    })

    # J43: vwap_period 50 vs 20
    tests.append({
        "id": "J43", "group": "Param Validation",
        "desc": "[Global] vwap_period 50 vs 20",
        "param_changed": "vwap_period",
        "baseline_val": "20", "test_val": "50",
        "expected": "VWAP mas lento cambia indicadores",
        "modify": lambda cfg: cfg.__setitem__("vwap_period", 50) or cfg,
        "checks": ["no_error"],
    })

    # J44: confluence_mode score con min_score 30
    def j44_modify(cfg):
        set_level_enabled(cfg, "sr_v2", True)
        cfg["confluence_mode"] = "score"
        cfg["min_confluence_score"] = 30
    tests.append({
        "id": "J44", "group": "Param Validation",
        "desc": "[Global] confluence score=30",
        "param_changed": "confluence_mode + min_score",
        "baseline_val": "any", "test_val": "score(30)",
        "expected": "Score filtra senales sin confluencia",
        "modify": j44_modify,
        "checks": ["trades_less_or_equal"],
    })

    return tests


# =========================================================================
# EJECUCION DE BACKTEST VIA SSE
# =========================================================================

def run_backtest(url, symbol, interval, days, config, timeout=TEST_TIMEOUT):
    """
    Ejecuta un backtest llamando al endpoint POST SSE.
    Parsea el stream linea por linea y retorna el resultado.
    """
    endpoint = f"{url}/api/strategy-builder/backtest-stream"
    payload = json.dumps({
        "symbol": symbol,
        "interval": interval,
        "days": days,
        "config": config,
    }).encode("utf-8")

    req = urllib.request.Request(
        endpoint,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        method="POST",
    )

    t0 = time.time()
    result = None
    error = None
    last_progress = ""

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            buffer = ""
            while True:
                chunk = resp.read(4096)
                if not chunk:
                    break
                buffer += chunk.decode("utf-8", errors="replace")

                # Procesar lineas SSE completas
                while "\n\n" in buffer:
                    event_block, buffer = buffer.split("\n\n", 1)
                    for line in event_block.split("\n"):
                        if line.startswith("data: "):
                            data_str = line[6:]
                            try:
                                data = json.loads(data_str)
                            except json.JSONDecodeError:
                                continue

                            if data.get("type") == "progress":
                                pct = data.get("percent", 0)
                                msg = data.get("message", "")
                                last_progress = f"{pct}% - {msg}"
                                sys.stdout.write(f"\r    Progreso: {last_progress[:60]:<60}")
                                sys.stdout.flush()

                            elif data.get("type") == "result":
                                result = data
                                sys.stdout.write(f"\r    {'Completado':60}\n")
                                sys.stdout.flush()

                            elif data.get("type") == "error":
                                error = data.get("message", "Error desconocido")
                                sys.stdout.write(f"\r    ERROR: {error[:60]}\n")
                                sys.stdout.flush()

    except urllib.error.URLError as e:
        error = f"Conexion fallida: {e}"
    except Exception as e:
        error = f"Error: {e}"

    elapsed = time.time() - t0

    if error:
        return {"success": False, "error": error, "elapsed": elapsed}

    if not result:
        return {"success": False, "error": "No se recibio resultado", "elapsed": elapsed}

    return {
        "success": True,
        "trades": result.get("stats", {}).get("total_trades", 0),
        "wins": result.get("stats", {}).get("wins", 0),
        "losses": result.get("stats", {}).get("losses", 0),
        "wr": result.get("stats", {}).get("win_rate", 0),
        "pnl_r": result.get("stats", {}).get("total_pnl_r", 0),
        "expectancy": result.get("stats", {}).get("expectancy", 0),
        "profit_factor": result.get("stats", {}).get("profit_factor", 0),
        "hash": result.get("candle_hash", ""),
        "filter_stats": result.get("filter_stats", {}),
        "candles_count": result.get("candles_count", 0),
        "levels_count": result.get("levels_count", 0),
        "elapsed": elapsed,
    }


# =========================================================================
# EVALUACION AUTOMATICA
# =========================================================================

def evaluate_checks(checks, result, baseline_result, all_results):
    """
    Evalua los checks automaticos para un test.
    Retorna (pass_fail, notas).
    """
    if not result.get("success"):
        return "FAIL", f"Error: {result.get('error', '?')}"

    if not baseline_result or not baseline_result.get("success"):
        return "?", "Sin baseline para comparar"

    notes = []
    all_pass = True
    t = result["trades"]
    bt = baseline_result["trades"]
    wr = result["wr"]
    bwr = baseline_result["wr"]

    # Signals y PnL para checks avanzados
    sg = result.get("filter_stats", {}).get("signals_generated", 0)
    bsg = baseline_result.get("filter_stats", {}).get("signals_generated", 0)
    pnl = result.get("pnl_r", 0)
    bpnl = baseline_result.get("pnl_r", 0)

    for check in checks:
        if check == "trades_diff":
            if t == bt:
                all_pass = False
                notes.append(f"FAIL: trades={t} == baseline={bt}")
            else:
                notes.append(f"OK: trades={t} != baseline={bt}")

        elif check == "trades_less":
            if t >= bt:
                all_pass = False
                notes.append(f"FAIL: trades={t} >= baseline={bt}")
            else:
                notes.append(f"OK: trades={t} < baseline={bt}")

        elif check == "trades_less_or_equal":
            if t > bt:
                all_pass = False
                notes.append(f"FAIL: trades={t} > baseline={bt}")
            else:
                notes.append(f"OK: trades={t} <= baseline={bt}")

        elif check == "trades_more":
            if t <= bt:
                all_pass = False
                notes.append(f"FAIL: trades={t} <= baseline={bt}")
            else:
                notes.append(f"OK: trades={t} > baseline={bt}")

        elif check == "trades_more_or_equal":
            if t < bt:
                all_pass = False
                notes.append(f"FAIL: trades={t} < baseline={bt}")
            else:
                notes.append(f"OK: trades={t} >= baseline={bt}")

        elif check == "trades_equal":
            if t != bt:
                all_pass = False
                notes.append(f"FAIL: trades={t} != baseline={bt}")
            else:
                notes.append(f"OK: trades={t} == baseline={bt}")

        elif check == "trades_zero":
            if t != 0:
                all_pass = False
                notes.append(f"FAIL: trades={t} != 0")
            else:
                notes.append("OK: trades=0")

        elif check == "wr_higher":
            if wr <= bwr:
                all_pass = False
                notes.append(f"FAIL: WR={wr:.1f}% <= baseline={bwr:.1f}%")
            else:
                notes.append(f"OK: WR={wr:.1f}% > baseline={bwr:.1f}%")

        elif check == "wr_lower":
            if wr >= bwr:
                all_pass = False
                notes.append(f"FAIL: WR={wr:.1f}% >= baseline={bwr:.1f}%")
            else:
                notes.append(f"OK: WR={wr:.1f}% < baseline={bwr:.1f}%")

        elif check == "wr_diff":
            if abs(wr - bwr) < 0.01:
                all_pass = False
                notes.append(f"FAIL: WR={wr:.1f}% == baseline={bwr:.1f}%")
            else:
                notes.append(f"OK: WR={wr:.1f}% != baseline={bwr:.1f}%")

        elif check == "hash_equal":
            h = result["hash"]
            bh = baseline_result["hash"]
            if h != bh:
                all_pass = False
                notes.append(f"FAIL: hash={h} != baseline={bh}")
            else:
                notes.append(f"OK: hash={h} == baseline")

        elif check == "hash_diff":
            h = result["hash"]
            bh = baseline_result["hash"]
            if h == bh:
                all_pass = False
                notes.append(f"FAIL: hash={h} == baseline={bh}")
            else:
                notes.append(f"OK: hash={h} != baseline")

        elif check == "no_error":
            notes.append("OK: sin errores")

        elif check == "filt_direction_active":
            fd = result["filter_stats"].get("filtered_direction", 0)
            if fd == 0:
                all_pass = False
                notes.append("FAIL: filt_direction=0")
            else:
                notes.append(f"OK: filt_direction={fd}")

        elif check == "filt_confluence_active":
            fc = result["filter_stats"].get("filtered_confluence", 0)
            if fc == 0:
                all_pass = False
                notes.append("FAIL: filt_confluence=0")
            else:
                notes.append(f"OK: filt_confluence={fc}")

        elif check == "filt_cooldown_active":
            fcd = result["filter_stats"].get("filtered_cooldown", 0)
            if fcd == 0:
                all_pass = False
                notes.append("FAIL: filt_cooldown=0")
            else:
                notes.append(f"OK: filt_cooldown={fcd}")

        elif check.startswith("filt_context_") and check.endswith("_active"):
            # Extraer nombre del filtro: filt_context_vwap_trend_active -> vwap_trend
            filter_name = check[len("filt_context_"):-len("_active")]
            ctx = result["filter_stats"].get("filtered_context", {})
            count = ctx.get(filter_name, 0)
            if count == 0:
                all_pass = False
                notes.append(f"FAIL: filt_ctx.{filter_name}=0")
            else:
                notes.append(f"OK: filt_ctx.{filter_name}={count}")

        elif check == "signals_more":
            if sg <= bsg:
                all_pass = False
                notes.append(f"FAIL: signals={sg} <= baseline={bsg}")
            else:
                notes.append(f"OK: signals={sg} > baseline={bsg}")

        elif check == "signals_less":
            if sg >= bsg:
                all_pass = False
                notes.append(f"FAIL: signals={sg} >= baseline={bsg}")
            else:
                notes.append(f"OK: signals={sg} < baseline={bsg}")

        elif check == "signals_diff":
            if sg == bsg:
                all_pass = False
                notes.append(f"FAIL: signals={sg} == baseline={bsg}")
            else:
                notes.append(f"OK: signals={sg} != baseline={bsg}")

        elif check == "pnl_diff":
            if abs(pnl - bpnl) < 0.01:
                all_pass = False
                notes.append(f"FAIL: pnl={pnl:.1f} == baseline={bpnl:.1f}")
            else:
                notes.append(f"OK: pnl={pnl:.1f} != baseline={bpnl:.1f}")

        elif check == "wr_diff_or_pnl_diff":
            if abs(wr - bwr) < 0.01 and abs(pnl - bpnl) < 0.01:
                all_pass = False
                notes.append(f"FAIL: WR y PnL identicos a baseline")
            else:
                notes.append(f"OK: WR={wr:.1f}% pnl={pnl:.1f} vs baseline WR={bwr:.1f}% pnl={bpnl:.1f}")

        elif check == "filt_sl_dir_diff":
            fsd = result.get("filter_stats", {}).get("filtered_sl_direction", 0)
            bfsd = baseline_result.get("filter_stats", {}).get("filtered_sl_direction", 0)
            if fsd == bfsd:
                all_pass = False
                notes.append(f"FAIL: filt_sl_dir={fsd} == baseline={bfsd}")
            else:
                notes.append(f"OK: filt_sl_dir={fsd} != baseline={bfsd}")

    if not checks:
        return "?", "Sin checks automaticos (verificar manualmente)"

    return ("PASS" if all_pass else "FAIL"), "; ".join(notes)


# =========================================================================
# FORMATEO CSV
# =========================================================================

def format_filter_context(filter_stats):
    """Formatea filtered_context como string legible."""
    ctx = filter_stats.get("filtered_context", {})
    if not ctx:
        return ""
    parts = []
    for k, v in sorted(ctx.items()):
        if v > 0:
            parts.append(f"{k}={v}")
    return " | ".join(parts)


def write_csv(filepath, rows):
    """Escribe el CSV con separador ; (formato europeo)."""
    headers = [
        "Test ID", "Grupo", "Descripcion", "Parametro Cambiado",
        "Valor Baseline", "Valor Test",
        "Trades", "WR%", "PnL R", "Hash",
        "Signals Gen", "Filt Direction", "Filt Confluence",
        "Filt MaxTrades", "Filt Cooldown", "Filt Context",
        "Filt SL Invalid", "Filt SL Dir", "Filt TP Invalid",
        "Trades Opened",
        "Esperado", "Comparacion vs Baseline", "PASS/FAIL", "Notas",
    ]

    with open(filepath, "w", encoding="utf-8-sig") as f:
        f.write(";".join(headers) + "\n")

        for row in rows:
            cells = []
            for val in row:
                s = str(val).replace(";", ",").replace("\n", " ")
                cells.append(s)
            f.write(";".join(cells) + "\n")

    print(f"\n  CSV guardado en: {filepath}")


# =========================================================================
# MAIN
# =========================================================================

def main():
    parser = argparse.ArgumentParser(description="Strategy Builder (Order Flow) Test Runner")
    parser.add_argument("--url", default=BACKEND_URL, help=f"URL del backend (default: {BACKEND_URL})")
    parser.add_argument("--symbol", default=DEFAULT_SYMBOL, help=f"Simbolo (default: {DEFAULT_SYMBOL})")
    parser.add_argument("--interval", default=DEFAULT_INTERVAL, help=f"Intervalo (default: {DEFAULT_INTERVAL})")
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS, help=f"Dias (default: {DEFAULT_DAYS})")
    parser.add_argument("--tests", default=None, help="Lista de IDs separados por coma (ej: A1,A2,G1,H1)")
    parser.add_argument("--group", default=None, help="Ejecutar solo un grupo (A, B, C, D, E, F, G, H, I, J)")
    parser.add_argument("--output", default=None, help="Nombre del CSV de salida")
    parser.add_argument("--timeout", type=int, default=TEST_TIMEOUT, help=f"Timeout por test en segundos (default: {TEST_TIMEOUT})")
    args = parser.parse_args()

    url = args.url
    symbol = args.symbol
    interval = args.interval
    days = args.days

    # Generar nombre de CSV
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_path = args.output or f"test_results_OF_{symbol}_{interval}_{days}d_{timestamp}.csv"

    print("=" * 70)
    print("  STRATEGY BUILDER (ORDER FLOW) - TEST RUNNER AUTOMATIZADO")
    print("=" * 70)
    print(f"  Backend:   {url}")
    print(f"  Simbolo:   {symbol}")
    print(f"  Intervalo: {interval}")
    print(f"  Dias:      {days}")
    print(f"  CSV:       {csv_path}")
    print(f"  Timeout:   {args.timeout}s por test")
    print("=" * 70)

    # Verificar conexion con backend
    print("\n  Verificando conexion con backend...")
    try:
        status_req = urllib.request.Request(f"{url}/api/status")
        with urllib.request.urlopen(status_req, timeout=10) as resp:
            print(f"  Backend OK (status {resp.status})")
    except Exception as e:
        print(f"  ERROR: No se pudo conectar al backend en {url}")
        print(f"  Detalle: {e}")
        print(f"\n  Asegurate de que el backend de Order Flow esta corriendo.")
        sys.exit(1)

    # Cargar tests
    all_tests = define_all_tests()

    # Filtrar tests si se especifico
    if args.tests:
        test_ids = [t.strip().upper() for t in args.tests.split(",")]
        all_tests = [t for t in all_tests if t["id"].upper() in test_ids]
        if not all_tests:
            print(f"  ERROR: Ningun test coincide con {args.tests}")
            sys.exit(1)
    elif args.group:
        group_prefix = args.group.upper()
        all_tests = [t for t in all_tests if t["id"].upper().startswith(group_prefix)]
        if not all_tests:
            print(f"  ERROR: Ningun test en grupo {args.group}")
            sys.exit(1)

    total_tests = len(all_tests)
    print(f"\n  Tests a ejecutar: {total_tests}")
    print(f"  Grupos: A (Levels), B (Entry), C (Filters), D (Risk), E (Exit),")
    print(f"          F (Determinismo), G (OF Levels), H (OF Entry), I (OF Filters),")
    print(f"          J (Param Validation)")

    # =======================================
    # PASO 1: Ejecutar BASELINE
    # =======================================
    print("\n" + "-" * 70)
    print("  EJECUTANDO BASELINE...")
    print("-" * 70)

    base_cfg = baseline_config()
    baseline_result = run_backtest(url, symbol, interval, days, base_cfg, args.timeout)

    if not baseline_result.get("success"):
        print(f"\n  ERROR en baseline: {baseline_result.get('error')}")
        print("  No se puede continuar sin un baseline exitoso.")
        sys.exit(1)

    print(f"  Baseline: Trades={baseline_result['trades']}, "
          f"WR={baseline_result['wr']:.1f}%, "
          f"PnL={baseline_result['pnl_r']:.1f}R, "
          f"Hash={baseline_result['hash']}, "
          f"Tiempo={baseline_result['elapsed']:.1f}s")

    # =======================================
    # PASO 2: Ejecutar cada test
    # =======================================
    all_results = {"BASELINE": baseline_result}
    csv_rows = []

    # Fila del baseline
    bfs = baseline_result["filter_stats"]
    csv_rows.append([
        "BASELINE", "-", "Configuracion base", "-", "-", "-",
        baseline_result["trades"],
        f"{baseline_result['wr']:.1f}",
        f"{baseline_result['pnl_r']:.1f}",
        baseline_result["hash"],
        bfs.get("signals_generated", ""),
        bfs.get("filtered_direction", ""),
        bfs.get("filtered_confluence", ""),
        bfs.get("filtered_max_trades_seg", ""),
        bfs.get("filtered_cooldown", ""),
        format_filter_context(bfs),
        bfs.get("filtered_sl_invalid", ""),
        bfs.get("filtered_sl_direction", ""),
        bfs.get("filtered_tp_invalid", ""),
        bfs.get("trades_opened", ""),
        "Referencia para todas las pruebas",
        "", "-", "",
    ])

    passed = 0
    failed = 0
    skipped = 0
    t_total_start = time.time()

    for i, test in enumerate(all_tests):
        tid = test["id"]
        print(f"\n  [{i+1}/{total_tests}] Test {tid}: {test['desc']}")
        print(f"    Cambio: {test['param_changed']} = {test['test_val']}")

        # Construir config para este test
        cfg = copy.deepcopy(base_cfg)
        test["modify"](cfg)

        # Sobreescribir symbol/interval/days si el test lo especifica
        t_symbol = test.get("symbol", symbol)
        t_interval = test.get("interval", interval)
        t_days = test.get("days", days)

        # Ejecutar
        result = run_backtest(url, t_symbol, t_interval, t_days, cfg, args.timeout)
        all_results[tid] = result

        if not result.get("success"):
            print(f"    ERROR: {result.get('error')}")
            pass_fail = "ERROR"
            comparison = f"Error: {result.get('error', '?')[:50]}"
            notes = ""
        else:
            print(f"    Trades={result['trades']}, WR={result['wr']:.1f}%, "
                  f"PnL={result['pnl_r']:.1f}R, Hash={result['hash']}, "
                  f"Tiempo={result['elapsed']:.1f}s")

            # Evaluar
            pass_fail, notes = evaluate_checks(
                test["checks"], result, baseline_result, all_results
            )

            # Generar comparacion vs baseline
            if result["trades"] != baseline_result["trades"]:
                diff_t = result["trades"] - baseline_result["trades"]
                comparison = f"Trades: {'+' if diff_t>0 else ''}{diff_t}"
            else:
                comparison = "Trades: IGUAL"

            if abs(result["wr"] - baseline_result["wr"]) > 0.01:
                diff_wr = result["wr"] - baseline_result["wr"]
                comparison += f" | WR: {'+' if diff_wr>0 else ''}{diff_wr:.1f}%"
            else:
                comparison += " | WR: IGUAL"

        # Contar
        if pass_fail == "PASS":
            passed += 1
            status_icon = "OK"
        elif pass_fail == "FAIL":
            failed += 1
            status_icon = "XX"
        else:
            skipped += 1
            status_icon = "??"

        print(f"    [{status_icon}] {pass_fail}: {notes[:80]}")

        # Construir fila CSV
        fs = result.get("filter_stats", {})
        csv_rows.append([
            tid,
            test["group"],
            test["desc"],
            test["param_changed"],
            test["baseline_val"],
            test["test_val"],
            result.get("trades", "ERR"),
            f"{result.get('wr', 0):.1f}" if result.get("success") else "ERR",
            f"{result.get('pnl_r', 0):.1f}" if result.get("success") else "ERR",
            result.get("hash", ""),
            fs.get("signals_generated", ""),
            fs.get("filtered_direction", ""),
            fs.get("filtered_confluence", ""),
            fs.get("filtered_max_trades_seg", ""),
            fs.get("filtered_cooldown", ""),
            format_filter_context(fs) if result.get("success") else "",
            fs.get("filtered_sl_invalid", ""),
            fs.get("filtered_sl_direction", ""),
            fs.get("filtered_tp_invalid", ""),
            fs.get("trades_opened", ""),
            test["expected"],
            comparison if result.get("success") else "",
            pass_fail,
            notes,
        ])

    # =======================================
    # PASO 3: Guardar CSV y resumen
    # =======================================
    t_total = time.time() - t_total_start

    write_csv(csv_path, csv_rows)

    print("\n" + "=" * 70)
    print("  RESUMEN DE RESULTADOS")
    print("=" * 70)
    print(f"  Total tests:  {total_tests}")
    print(f"  PASS:         {passed}")
    print(f"  FAIL:         {failed}")
    print(f"  Sin check:    {skipped}")
    print(f"  Tiempo total: {t_total:.0f}s ({t_total/60:.1f} min)")
    print(f"  CSV:          {csv_path}")
    print("=" * 70)

    # Listar los FAIL
    if failed > 0:
        print("\n  Tests FALLIDOS:")
        for row in csv_rows:
            if row[22] == "FAIL":
                print(f"    {row[0]}: {row[2]} - {row[23][:60]}")

    # Exit code
    sys.exit(1 if failed > 0 else 0)


if __name__ == "__main__":
    main()
