# zone_optimizer.py
# Zone Optimizer - Auto-optimización de parámetros para detección de zonas
# Usa grid search y walk-forward analysis para encontrar la mejor configuración

from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, asdict
from datetime import datetime
import numpy as np
from itertools import product
import json
import os

from zone_detector import Zone, ZoneDetector, ZoneDetectionParams
from zone_evaluator import ZoneEvaluator, ZoneEvaluation, EvaluationParams


@dataclass
class OptimizationResult:
    """Resultado de una iteración de optimización"""
    params: Dict
    method: str
    zones_detected: int
    zones_tradeable: int
    tradeable_rate: float
    avg_score: float
    overall_win_rate: float
    total_bounces: int
    successful_bounces: int
    avg_fakeout_rate: float
    fitness_score: float  # Score combinado para ranking

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class OptimizationConfig:
    """Configuración del optimizador"""
    # Rangos de parámetros para grid search
    # Pivot Cluster
    pivot_tolerance_range: List[float] = None
    pivot_min_touches_range: List[int] = None
    pivot_swing_bars_range: List[int] = None

    # ATR Based
    atr_period_range: List[int] = None
    atr_threshold_range: List[float] = None

    # Volume Profile
    vp_value_area_range: List[float] = None
    vp_price_bins_range: List[int] = None

    # Price Action
    pa_touch_tolerance_range: List[float] = None
    pa_min_touches_range: List[int] = None

    # Walk-forward settings
    train_pct: float = 0.7
    test_pct: float = 0.3
    walk_forward_folds: int = 3

    # Fitness function weights
    weight_win_rate: float = 0.35
    weight_tradeable_rate: float = 0.25
    weight_avg_score: float = 0.20
    weight_bounces: float = 0.10
    weight_fakeout_penalty: float = 0.10

    def __post_init__(self):
        # Valores por defecto para los rangos
        if self.pivot_tolerance_range is None:
            self.pivot_tolerance_range = [0.2, 0.3, 0.4, 0.5]
        if self.pivot_min_touches_range is None:
            self.pivot_min_touches_range = [2, 3, 4]
        if self.pivot_swing_bars_range is None:
            self.pivot_swing_bars_range = [3, 5, 7]
        if self.atr_period_range is None:
            self.atr_period_range = [10, 14, 20]
        if self.atr_threshold_range is None:
            self.atr_threshold_range = [0.5, 0.7, 0.9]
        if self.vp_value_area_range is None:
            self.vp_value_area_range = [60, 70, 80]
        if self.vp_price_bins_range is None:
            self.vp_price_bins_range = [30, 50, 70]
        if self.pa_touch_tolerance_range is None:
            self.pa_touch_tolerance_range = [0.15, 0.2, 0.3]
        if self.pa_min_touches_range is None:
            self.pa_min_touches_range = [2, 3, 4]


class ZoneOptimizer:
    """
    Optimiza parámetros de detección de zonas usando datos históricos.

    Características:
    - Grid search sobre rangos de parámetros
    - Walk-forward analysis para evitar overfitting
    - Función de fitness configurable
    - Soporte para todos los métodos de detección
    """

    def __init__(self):
        self.detector = ZoneDetector()
        self.evaluator = ZoneEvaluator()
        self._results_cache = {}

    def optimize(
        self,
        candles: List[Dict],
        method: str = "pivot_cluster",
        config: Optional[OptimizationConfig] = None,
        eval_params: Optional[EvaluationParams] = None,
        progress_callback: callable = None
    ) -> Dict:
        """
        Ejecuta optimización para un método específico.

        Args:
            candles: Datos históricos completos
            method: Método de detección a optimizar
            config: Configuración de optimización
            eval_params: Parámetros de evaluación
            progress_callback: Callback para reportar progreso (opcional)

        Returns:
            Dict con mejores parámetros y resultados detallados
        """
        if config is None:
            config = OptimizationConfig()
        if eval_params is None:
            eval_params = EvaluationParams()

        # Generar combinaciones de parámetros
        param_combinations = self._generate_param_combinations(method, config)

        if not param_combinations:
            return {'error': f'No se pudieron generar combinaciones para método {method}'}

        total_combinations = len(param_combinations)
        results = []

        for i, params in enumerate(param_combinations):
            # Callback de progreso
            if progress_callback:
                progress_callback(i + 1, total_combinations, method)

            # Ejecutar evaluación con estos parámetros
            result = self._evaluate_params(
                candles, method, params, config, eval_params
            )

            if result:
                results.append(result)

        if not results:
            return {'error': 'No se obtuvieron resultados válidos'}

        # Ordenar por fitness score
        results.sort(key=lambda x: x.fitness_score, reverse=True)

        # Preparar respuesta
        best_result = results[0]
        top_10 = results[:10]

        return {
            'method': method,
            'best_params': best_result.params,
            'best_fitness': best_result.fitness_score,
            'best_win_rate': best_result.overall_win_rate,
            'best_tradeable_rate': best_result.tradeable_rate,
            'total_combinations_tested': total_combinations,
            'results_with_trades': len([r for r in results if r.total_bounces > 0]),
            'top_10_results': [r.to_dict() for r in top_10],
            'summary': {
                'avg_fitness': np.mean([r.fitness_score for r in results]),
                'max_fitness': max(r.fitness_score for r in results),
                'min_fitness': min(r.fitness_score for r in results),
                'avg_win_rate': np.mean([r.overall_win_rate for r in results if r.total_bounces > 0]) if any(r.total_bounces > 0 for r in results) else 0
            }
        }

    def optimize_all_methods(
        self,
        candles: List[Dict],
        config: Optional[OptimizationConfig] = None,
        eval_params: Optional[EvaluationParams] = None,
        progress_callback: callable = None
    ) -> Dict:
        """
        Optimiza todos los métodos y los compara.
        """
        if config is None:
            config = OptimizationConfig()

        results = {}
        for method in self.detector.METHODS:
            print(f"[ZoneOptimizer] Optimizando método: {method}")

            result = self.optimize(
                candles, method, config, eval_params,
                progress_callback=lambda i, t, m: progress_callback(i, t, m) if progress_callback else None
            )

            results[method] = result

        # Encontrar mejor método global
        best_method = max(
            results.keys(),
            key=lambda m: results[m].get('best_fitness', 0)
        )

        return {
            'best_method': best_method,
            'best_overall_params': results[best_method].get('best_params'),
            'best_overall_fitness': results[best_method].get('best_fitness'),
            'methods': results
        }

    def walk_forward_optimize(
        self,
        candles: List[Dict],
        method: str = "pivot_cluster",
        config: Optional[OptimizationConfig] = None,
        eval_params: Optional[EvaluationParams] = None
    ) -> Dict:
        """
        Optimización con walk-forward analysis para validación robusta.

        Divide los datos en K folds y optimiza/valida secuencialmente.
        """
        if config is None:
            config = OptimizationConfig()

        n = len(candles)
        folds = config.walk_forward_folds
        fold_size = n // folds

        all_train_results = []
        all_test_results = []

        for fold in range(folds - 1):
            # Dividir datos
            train_end = (fold + 1) * fold_size
            test_end = (fold + 2) * fold_size

            train_candles = candles[:train_end]
            test_candles = candles[:test_end]  # Test incluye train para evaluación

            # Optimizar en train
            train_result = self.optimize(train_candles, method, config, eval_params)

            if 'error' in train_result:
                continue

            best_params = train_result['best_params']

            # Validar en test (out-of-sample)
            test_result = self._evaluate_params(
                test_candles, method, best_params, config, eval_params,
                train_end_idx=train_end  # Solo evaluar zonas detectadas en train
            )

            all_train_results.append(train_result)
            if test_result:
                all_test_results.append(test_result)

        if not all_test_results:
            return {'error': 'Walk-forward no produjo resultados válidos'}

        # Calcular métricas promedio out-of-sample
        avg_test_win_rate = np.mean([r.overall_win_rate for r in all_test_results])
        avg_test_fitness = np.mean([r.fitness_score for r in all_test_results])

        # Comparar con in-sample
        avg_train_win_rate = np.mean([r['best_win_rate'] for r in all_train_results])
        avg_train_fitness = np.mean([r['best_fitness'] for r in all_train_results])

        # Degradation ratio (menor = más robusto)
        win_rate_degradation = 1 - (avg_test_win_rate / max(avg_train_win_rate, 0.01))
        fitness_degradation = 1 - (avg_test_fitness / max(avg_train_fitness, 0.01))

        # Parámetros más consistentes (los que aparecen más veces)
        all_best_params = [r['best_params'] for r in all_train_results]
        consistent_params = self._find_consistent_params(all_best_params)

        return {
            'method': method,
            'folds_evaluated': len(all_test_results),
            'in_sample': {
                'avg_win_rate': avg_train_win_rate,
                'avg_fitness': avg_train_fitness
            },
            'out_of_sample': {
                'avg_win_rate': avg_test_win_rate,
                'avg_fitness': avg_test_fitness
            },
            'degradation': {
                'win_rate': win_rate_degradation,
                'fitness': fitness_degradation,
                'is_robust': win_rate_degradation < 0.2 and fitness_degradation < 0.2
            },
            'consistent_params': consistent_params,
            'recommended_params': consistent_params if consistent_params else all_train_results[-1]['best_params'],
            'fold_results': [
                {
                    'train': r,
                    'test': all_test_results[i].to_dict() if i < len(all_test_results) else None
                }
                for i, r in enumerate(all_train_results)
            ]
        }

    # =========================================================================
    # MÉTODOS PRIVADOS
    # =========================================================================

    def _generate_param_combinations(
        self,
        method: str,
        config: OptimizationConfig
    ) -> List[Dict]:
        """Genera todas las combinaciones de parámetros para un método"""

        if method == "pivot_cluster":
            ranges = [
                config.pivot_tolerance_range,
                config.pivot_min_touches_range,
                config.pivot_swing_bars_range
            ]
            keys = ['pivot_tolerance_pct', 'pivot_min_touches', 'pivot_swing_bars']

        elif method == "atr_based":
            ranges = [
                config.atr_period_range,
                config.atr_threshold_range
            ]
            keys = ['atr_period', 'atr_threshold']

        elif method == "volume_profile":
            ranges = [
                config.vp_value_area_range,
                config.vp_price_bins_range
            ]
            keys = ['vp_value_area_pct', 'vp_price_bins']

        elif method == "price_action":
            ranges = [
                config.pa_touch_tolerance_range,
                config.pa_min_touches_range
            ]
            keys = ['pa_touch_tolerance_pct', 'pa_min_touches']

        else:
            return []

        combinations = []
        for values in product(*ranges):
            param_dict = dict(zip(keys, values))
            combinations.append(param_dict)

        return combinations

    def _evaluate_params(
        self,
        candles: List[Dict],
        method: str,
        params: Dict,
        config: OptimizationConfig,
        eval_params: EvaluationParams,
        train_end_idx: int = None
    ) -> Optional[OptimizationResult]:
        """Evalúa un conjunto específico de parámetros"""

        # Dividir datos
        if train_end_idx:
            split_idx = train_end_idx
        else:
            split_idx = int(len(candles) * config.train_pct)

        detection_candles = candles[:split_idx]

        # Crear params de detección
        detection_params = ZoneDetectionParams()
        for key, value in params.items():
            if hasattr(detection_params, key):
                setattr(detection_params, key, value)

        # Detectar zonas
        try:
            zones = self.detector.detect_zones(detection_candles, method, detection_params)
        except Exception as e:
            print(f"[ZoneOptimizer] Error detectando zonas: {e}")
            return None

        if not zones:
            return OptimizationResult(
                params=params,
                method=method,
                zones_detected=0,
                zones_tradeable=0,
                tradeable_rate=0,
                avg_score=0,
                overall_win_rate=0,
                total_bounces=0,
                successful_bounces=0,
                avg_fakeout_rate=0,
                fitness_score=0
            )

        # Evaluar zonas
        evaluations = self.evaluator.evaluate_zones_batch(zones, candles, eval_params)

        # Calcular métricas
        tradeable = [e for e in evaluations if e.tradeable]
        total_bounces = sum(e.total_bounces for e in evaluations)
        successful_bounces = sum(e.successful_bounces for e in evaluations)

        metrics = {
            'zones_detected': len(zones),
            'zones_tradeable': len(tradeable),
            'tradeable_rate': len(tradeable) / len(zones) if zones else 0,
            'avg_score': np.mean([e.overall_score for e in evaluations]),
            'overall_win_rate': successful_bounces / total_bounces if total_bounces > 0 else 0,
            'total_bounces': total_bounces,
            'successful_bounces': successful_bounces,
            'avg_fakeout_rate': np.mean([e.fakeout_rate for e in evaluations])
        }

        # Calcular fitness score
        fitness = self._calculate_fitness(metrics, config)

        return OptimizationResult(
            params=params,
            method=method,
            fitness_score=fitness,
            **metrics
        )

    def _calculate_fitness(self, metrics: Dict, config: OptimizationConfig) -> float:
        """Calcula score de fitness combinado"""

        # Normalizar bounces (asumiendo max ~50 es excelente)
        normalized_bounces = min(metrics['total_bounces'] / 50, 1)

        fitness = (
            metrics['overall_win_rate'] * config.weight_win_rate +
            metrics['tradeable_rate'] * config.weight_tradeable_rate +
            (metrics['avg_score'] / 100) * config.weight_avg_score +
            normalized_bounces * config.weight_bounces -
            metrics['avg_fakeout_rate'] * config.weight_fakeout_penalty
        )

        # Bonus por tener suficientes trades
        if metrics['total_bounces'] >= 10:
            fitness *= 1.1
        elif metrics['total_bounces'] < 3:
            fitness *= 0.5

        return max(0, min(1, fitness)) * 100  # Escala 0-100

    def _find_consistent_params(self, all_params: List[Dict]) -> Optional[Dict]:
        """Encuentra parámetros que aparecen consistentemente"""
        if not all_params:
            return None

        # Contar ocurrencias de cada valor por parámetro
        param_counts = {}
        for params in all_params:
            for key, value in params.items():
                if key not in param_counts:
                    param_counts[key] = {}
                param_counts[key][value] = param_counts[key].get(value, 0) + 1

        # Seleccionar el valor más común para cada parámetro
        consistent = {}
        for key, counts in param_counts.items():
            most_common = max(counts.keys(), key=lambda v: counts[v])
            consistent[key] = most_common

        return consistent

    def save_results(self, results: Dict, filepath: str):
        """Guarda resultados de optimización a archivo"""
        with open(filepath, 'w') as f:
            json.dump(results, f, indent=2, default=str)

    def load_results(self, filepath: str) -> Optional[Dict]:
        """Carga resultados de optimización desde archivo"""
        if not os.path.exists(filepath):
            return None
        with open(filepath, 'r') as f:
            return json.load(f)


# Singleton para uso global
zone_optimizer = ZoneOptimizer()


# =========================================================================
# FUNCIONES DE CONVENIENCIA
# =========================================================================

def quick_optimize(candles: List[Dict], method: str = "pivot_cluster") -> Dict:
    """
    Optimización rápida con parámetros por defecto.
    Útil para testing inicial.
    """
    return zone_optimizer.optimize(candles, method)


def full_optimize(candles: List[Dict]) -> Dict:
    """
    Optimización completa de todos los métodos con walk-forward.
    Más lento pero más robusto.
    """
    results = {}

    for method in ZoneDetector.METHODS:
        print(f"\n{'='*50}")
        print(f"Optimizando: {method}")
        print(f"{'='*50}")

        result = zone_optimizer.walk_forward_optimize(candles, method)
        results[method] = result

        if 'error' not in result:
            print(f"  Win Rate (in-sample):  {result['in_sample']['avg_win_rate']:.2%}")
            print(f"  Win Rate (out-sample): {result['out_of_sample']['avg_win_rate']:.2%}")
            print(f"  Robusto: {result['degradation']['is_robust']}")

    # Encontrar mejor método robusto
    robust_methods = [
        m for m in results
        if 'error' not in results[m] and results[m]['degradation']['is_robust']
    ]

    if robust_methods:
        best_method = max(
            robust_methods,
            key=lambda m: results[m]['out_of_sample']['avg_fitness']
        )
    else:
        # Si ninguno es robusto, usar el de mejor fitness out-of-sample
        valid_methods = [m for m in results if 'error' not in results[m]]
        best_method = max(
            valid_methods,
            key=lambda m: results[m]['out_of_sample']['avg_fitness']
        ) if valid_methods else None

    return {
        'best_method': best_method,
        'best_params': results[best_method]['recommended_params'] if best_method else None,
        'methods': results
    }
