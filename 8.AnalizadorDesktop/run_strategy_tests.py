#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Strategy Builder - Test Runner Automatizado
=============================================
Ejecuta todas las pruebas del protocolo de forma secuencial,
guarda resultados en CSV y evalua PASS/FAIL automaticamente.

Requisitos: Python 3.8+ (solo usa stdlib)
Backend debe estar corriendo en el puerto configurado.

Uso:
  python run_strategy_tests.py
  python run_strategy_tests.py --url http://localhost:10001
  python run_strategy_tests.py --symbol ETHUSDT
  python run_strategy_tests.py --tests A1,A2,B3,F1a
  python run_strategy_tests.py --group A
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

BACKEND_URL = "http://localhost:10001"
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
    """Retorna la configuracion base para todas las pruebas."""
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
    # GRUPO A: Level Sources
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
    # GRUPO B: Entry Signals
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
    # GRUPO C: Context Filters
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
        "expected": "Se ejecuta sin error (resultado puede coincidir si regla no se activa)",
        "modify": lambda cfg: add_exit_rule(cfg, "reenter_zone", {}),
        "checks": ["no_error"],
    })

    tests.append({
        "id": "E4", "group": "Exit Rules",
        "desc": "Squeeze Activate",
        "param_changed": "exit rule nueva",
        "baseline_val": "OFF", "test_val": "squeeze_activate",
        "expected": "Se ejecuta sin error (resultado puede coincidir si no hay squeeze durante trades)",
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
        "modify": lambda cfg: None,  # Sin cambios
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
        "modify": lambda cfg: None,  # baseline ya tiene period=240
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
                                # Mostrar progreso en la misma linea
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
        "Filt MaxSeg", "Filt Cooldown", "Filt Context",
        "Filt SL Inv", "Filt SL Dir", "Filt TP Inv",
        "Trades Opened", "Efecto Esperado",
        "Comparacion vs Baseline", "PASS/FAIL", "Notas"
    ]

    with open(filepath, "w", encoding="utf-8-sig") as f:
        f.write(";".join(headers) + "\n")
        for row in rows:
            # Escapar ; en campos
            cells = []
            for cell in row:
                s = str(cell).replace(";", ",")
                cells.append(s)
            f.write(";".join(cells) + "\n")

    print(f"\n  CSV guardado en: {filepath}")


# =========================================================================
# MAIN
# =========================================================================

def main():
    parser = argparse.ArgumentParser(description="Strategy Builder Test Runner")
    parser.add_argument("--url", default=BACKEND_URL, help=f"URL del backend (default: {BACKEND_URL})")
    parser.add_argument("--symbol", default=DEFAULT_SYMBOL, help=f"Simbolo (default: {DEFAULT_SYMBOL})")
    parser.add_argument("--interval", default=DEFAULT_INTERVAL, help=f"Intervalo (default: {DEFAULT_INTERVAL})")
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS, help=f"Dias (default: {DEFAULT_DAYS})")
    parser.add_argument("--tests", default=None, help="Lista de IDs separados por coma (ej: A1,A2,B3)")
    parser.add_argument("--group", default=None, help="Ejecutar solo un grupo (A, B, C, D, E, F)")
    parser.add_argument("--output", default=None, help="Nombre del CSV de salida")
    parser.add_argument("--timeout", type=int, default=TEST_TIMEOUT, help=f"Timeout por test en segundos (default: {TEST_TIMEOUT})")
    args = parser.parse_args()

    url = args.url
    symbol = args.symbol
    interval = args.interval
    days = args.days

    # Generar nombre de CSV
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    csv_path = args.output or f"test_results_{symbol}_{interval}_{days}d_{timestamp}.csv"

    print("=" * 70)
    print("  STRATEGY BUILDER - TEST RUNNER AUTOMATIZADO")
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
        print(f"\n  Asegurate de que el backend esta corriendo.")
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
