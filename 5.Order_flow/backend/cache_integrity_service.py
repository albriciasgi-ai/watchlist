# cache_integrity_service.py - Servicio de validacion y reparacion de cache de footprints
#
# Valida la integridad del cache local y repara automaticamente usando el cloud collector.
# Se ejecuta al iniciar el backend y puede ser invocado manualmente desde la UI.

import json
import logging
import time
import asyncio
import httpx
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
from enum import Enum

logger = logging.getLogger(__name__)

# URL del Cloud Footprint Collector en Northflank
CLOUD_COLLECTOR_URL = "https://p01--altagracia--rxv8nrbhxln9.code.run"
CLOUD_TIMEOUT = 30.0

# Directorio de cache
CACHE_DIR = Path(__file__).parent / "footprint_cache"


class IntegrityStatus(str, Enum):
    HEALTHY = "healthy"
    REPAIRING = "repairing"
    ISSUES = "issues"
    UNKNOWN = "unknown"


@dataclass
class ValidationResult:
    """Resultado de validacion para un simbolo."""
    symbol: str
    interval: str
    status: IntegrityStatus
    total_footprints: int
    valid_footprints: int
    invalid_step_size: int
    gaps_detected: int
    gaps_ranges: List[Dict]  # [{start_ts, end_ts, missing_minutes}]
    issues: List[str]


@dataclass
class RepairResult:
    """Resultado de reparacion para un simbolo."""
    symbol: str
    interval: str
    success: bool
    footprints_removed: int
    footprints_added_from_cloud: int
    gaps_filled: int
    error: Optional[str] = None


@dataclass
class IntegrityReport:
    """Reporte completo de integridad."""
    timestamp: int
    overall_status: IntegrityStatus
    symbols_healthy: int
    symbols_with_issues: int
    symbols_repairing: int
    validations: List[ValidationResult]
    is_repairing: bool = False
    repair_progress: float = 0.0
    current_repair_symbol: Optional[str] = None


class CacheIntegrityService:
    """
    Servicio para validar y reparar el cache de footprints.

    Funcionalidades:
    - Validar estructura JSON
    - Verificar step_size contra configuracion
    - Detectar gaps en timestamps
    - Reparar automaticamente desde cloud collector
    - Reportar estado de salud
    """

    def __init__(self, config: Dict = None):
        """
        Args:
            config: Configuracion de orderflow (symbols, step_sizes, etc.)
        """
        self.config = config or {}
        self.cache_dir = CACHE_DIR
        self._is_repairing = False
        self._repair_progress = 0.0
        self._current_repair_symbol: Optional[str] = None
        self._last_report: Optional[IntegrityReport] = None

        # Asegurar que el directorio existe
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def update_config(self, config: Dict):
        """Actualiza la configuracion."""
        self.config = config

    def _get_expected_step_size(self, symbol: str) -> float:
        """Obtiene el step_size esperado para un simbolo."""
        # Primero buscar en config custom
        custom_sizes = self.config.get("symbol_step_sizes", {})
        if symbol in custom_sizes:
            return custom_sizes[symbol]

        # Luego en defaults del footprint_calculator
        from footprint_calculator import get_default_step_size
        return get_default_step_size(symbol)

    def _get_cache_file_path(self, symbol: str, interval: str) -> Path:
        """Retorna el path del archivo de cache."""
        return self.cache_dir / f"{symbol}_{interval}.json"

    def _load_cache_file(self, symbol: str, interval: str) -> Tuple[bool, List[Dict], str]:
        """
        Carga y parsea un archivo de cache.

        Returns:
            (success, footprints, error_message)
        """
        file_path = self._get_cache_file_path(symbol, interval)

        if not file_path.exists():
            return True, [], ""  # No existe = OK, lista vacia

        try:
            with open(file_path, 'r') as f:
                data = json.load(f)

            footprints = data.get("footprints", [])
            return True, footprints, ""

        except json.JSONDecodeError as e:
            return False, [], f"JSON corrupto: {str(e)}"
        except Exception as e:
            return False, [], f"Error leyendo archivo: {str(e)}"

    def _detect_gaps(self, footprints: List[Dict], interval: str, max_gap_minutes: int = 2) -> List[Dict]:
        """
        Detecta gaps en los timestamps de footprints.

        Args:
            footprints: Lista de footprints ordenados por timestamp
            interval: Intervalo en minutos (string)
            max_gap_minutes: Maximo gap permitido antes de reportar

        Returns:
            Lista de gaps detectados [{start_ts, end_ts, missing_minutes}]
        """
        if len(footprints) < 2:
            return []

        interval_ms = int(interval) * 60 * 1000
        max_gap_ms = max_gap_minutes * 60 * 1000
        gaps = []

        sorted_fps = sorted(footprints, key=lambda x: x.get("candle_timestamp", 0))

        for i in range(1, len(sorted_fps)):
            prev_ts = sorted_fps[i-1].get("candle_timestamp", 0)
            curr_ts = sorted_fps[i].get("candle_timestamp", 0)

            expected_next = prev_ts + interval_ms
            actual_gap = curr_ts - prev_ts

            if actual_gap > interval_ms + max_gap_ms:
                missing_minutes = (actual_gap - interval_ms) / (60 * 1000)
                gaps.append({
                    "start_ts": prev_ts,
                    "end_ts": curr_ts,
                    "missing_minutes": round(missing_minutes, 1)
                })

        return gaps

    def validate_symbol(self, symbol: str, interval: str = "1") -> ValidationResult:
        """
        Valida el cache de un simbolo.

        Returns:
            ValidationResult con detalles de la validacion
        """
        issues = []

        # Cargar archivo
        success, footprints, error = self._load_cache_file(symbol, interval)

        if not success:
            return ValidationResult(
                symbol=symbol,
                interval=interval,
                status=IntegrityStatus.ISSUES,
                total_footprints=0,
                valid_footprints=0,
                invalid_step_size=0,
                gaps_detected=0,
                gaps_ranges=[],
                issues=[error]
            )

        if not footprints:
            return ValidationResult(
                symbol=symbol,
                interval=interval,
                status=IntegrityStatus.HEALTHY,
                total_footprints=0,
                valid_footprints=0,
                invalid_step_size=0,
                gaps_detected=0,
                gaps_ranges=[],
                issues=[]
            )

        # Validar footprints - step_size diferente es solo informativo, no un problema
        expected_step = self._get_expected_step_size(symbol)
        valid_fps = []
        different_step_count = 0

        for fp in footprints:
            fp_step = fp.get("step_size")

            # Contar step_size diferente (solo informativo)
            if fp_step is not None and abs(fp_step - expected_step) > 0.0001:
                different_step_count += 1

            # Todos los footprints con campos requeridos son validos
            required_fields = ["candle_timestamp", "symbol", "levels"]
            if all(fp.get(f) is not None for f in required_fields):
                valid_fps.append(fp)

        # Step_size diferente es solo informativo, NO es un issue
        # (los footprints antiguos con step_size diferente siguen siendo utiles)

        # Detectar gaps - ESTO SI es un problema real
        gaps = self._detect_gaps(valid_fps, interval)
        if gaps:
            total_missing = sum(g["missing_minutes"] for g in gaps)
            issues.append(f"{len(gaps)} gaps detectados ({total_missing:.0f} minutos faltantes)")

        # Determinar estado - solo GAPS causan estado "issues"
        if issues:
            status = IntegrityStatus.ISSUES
        else:
            status = IntegrityStatus.HEALTHY

        return ValidationResult(
            symbol=symbol,
            interval=interval,
            status=status,
            total_footprints=len(footprints),
            valid_footprints=len(valid_fps),
            invalid_step_size=different_step_count,  # Solo informativo
            gaps_detected=len(gaps),
            gaps_ranges=gaps,
            issues=issues
        )

    def validate_all(self, intervals: List[str] = None) -> IntegrityReport:
        """
        Valida todos los simbolos configurados.

        Returns:
            IntegrityReport con estado de todos los simbolos
        """
        symbols = self.config.get("symbols", [])
        intervals = intervals or self.config.get("intervals", ["1"])

        validations = []
        healthy_count = 0
        issues_count = 0

        for symbol in symbols:
            for interval in intervals:
                result = self.validate_symbol(symbol, interval)
                validations.append(result)

                if result.status == IntegrityStatus.HEALTHY:
                    healthy_count += 1
                else:
                    issues_count += 1

        # Determinar estado general
        if issues_count == 0:
            overall_status = IntegrityStatus.HEALTHY
        elif self._is_repairing:
            overall_status = IntegrityStatus.REPAIRING
        else:
            overall_status = IntegrityStatus.ISSUES

        report = IntegrityReport(
            timestamp=int(time.time() * 1000),
            overall_status=overall_status,
            symbols_healthy=healthy_count,
            symbols_with_issues=issues_count,
            symbols_repairing=1 if self._is_repairing else 0,
            validations=validations,
            is_repairing=self._is_repairing,
            repair_progress=self._repair_progress,
            current_repair_symbol=self._current_repair_symbol
        )

        self._last_report = report
        return report

    async def _fetch_from_cloud(self, symbol: str, interval: str, hours: int = 12) -> List[Dict]:
        """
        Obtiene footprints del cloud collector.

        Returns:
            Lista de footprints o lista vacia si falla
        """
        try:
            url = f"{CLOUD_COLLECTOR_URL}/api/footprints/{symbol}"
            params = {"hours": hours, "interval": interval}

            async with httpx.AsyncClient(timeout=CLOUD_TIMEOUT) as client:
                response = await client.get(url, params=params)

                if response.status_code == 200:
                    data = response.json()
                    footprints = data.get("footprints", [])
                    logger.info(f"[INTEGRITY] Cloud: obtenidos {len(footprints)} footprints de {symbol}")
                    return footprints
                else:
                    logger.warning(f"[INTEGRITY] Cloud error para {symbol}: HTTP {response.status_code}")
                    return []

        except httpx.TimeoutException:
            logger.warning(f"[INTEGRITY] Cloud timeout para {symbol}")
            return []
        except Exception as e:
            logger.warning(f"[INTEGRITY] Cloud error para {symbol}: {e}")
            return []

    async def repair_symbol(self, symbol: str, interval: str = "1") -> RepairResult:
        """
        Repara el cache de un simbolo.

        1. Elimina footprints con step_size incorrecto
        2. Carga footprints del cloud para gaps y reemplazos
        3. Hace merge inteligente
        4. Guarda el archivo reparado

        Returns:
            RepairResult con detalles de la reparacion
        """
        self._current_repair_symbol = symbol

        try:
            # Cargar cache local
            success, footprints, error = self._load_cache_file(symbol, interval)

            if not success:
                # Archivo corrupto - cargar todo del cloud
                logger.info(f"[INTEGRITY] {symbol}: cache corrupto, cargando todo del cloud")
                cloud_fps = await self._fetch_from_cloud(symbol, interval)

                if not cloud_fps:
                    return RepairResult(
                        symbol=symbol,
                        interval=interval,
                        success=False,
                        footprints_removed=0,
                        footprints_added_from_cloud=0,
                        gaps_filled=0,
                        error="No se pudo obtener datos del cloud"
                    )

                # Guardar footprints del cloud
                self._save_cache_file(symbol, interval, cloud_fps)

                return RepairResult(
                    symbol=symbol,
                    interval=interval,
                    success=True,
                    footprints_removed=len(footprints),
                    footprints_added_from_cloud=len(cloud_fps),
                    gaps_filled=0
                )

            # Filtrar footprints con step_size correcto
            expected_step = self._get_expected_step_size(symbol)
            valid_fps = []
            removed_count = 0

            for fp in footprints:
                fp_step = fp.get("step_size")
                if fp_step is None or abs(fp_step - expected_step) < 0.0001:
                    valid_fps.append(fp)
                else:
                    removed_count += 1

            if removed_count > 0:
                logger.info(f"[INTEGRITY] {symbol}: eliminados {removed_count} footprints con step_size incorrecto")

            # Detectar gaps
            gaps = self._detect_gaps(valid_fps, interval)

            # Cargar del cloud si hay gaps o footprints eliminados
            added_from_cloud = 0
            gaps_filled = 0

            if gaps or removed_count > 0:
                cloud_fps = await self._fetch_from_cloud(symbol, interval)

                if cloud_fps:
                    # Crear set de timestamps locales validos
                    local_timestamps = {fp.get("candle_timestamp") for fp in valid_fps}

                    # Agregar footprints del cloud que no existan localmente
                    for cloud_fp in cloud_fps:
                        ts = cloud_fp.get("candle_timestamp")
                        if ts and ts not in local_timestamps:
                            valid_fps.append(cloud_fp)
                            added_from_cloud += 1
                            local_timestamps.add(ts)

                    # Contar gaps rellenados
                    if gaps:
                        new_gaps = self._detect_gaps(valid_fps, interval)
                        gaps_filled = len(gaps) - len(new_gaps)

            # Ordenar por timestamp
            valid_fps.sort(key=lambda x: x.get("candle_timestamp", 0))

            # Guardar archivo reparado
            self._save_cache_file(symbol, interval, valid_fps)

            logger.info(
                f"[INTEGRITY] {symbol} reparado: "
                f"-{removed_count} invalidos, +{added_from_cloud} del cloud, "
                f"{gaps_filled} gaps rellenados, total: {len(valid_fps)}"
            )

            return RepairResult(
                symbol=symbol,
                interval=interval,
                success=True,
                footprints_removed=removed_count,
                footprints_added_from_cloud=added_from_cloud,
                gaps_filled=gaps_filled
            )

        except Exception as e:
            logger.error(f"[INTEGRITY] Error reparando {symbol}: {e}")
            return RepairResult(
                symbol=symbol,
                interval=interval,
                success=False,
                footprints_removed=0,
                footprints_added_from_cloud=0,
                gaps_filled=0,
                error=str(e)
            )
        finally:
            self._current_repair_symbol = None

    def _save_cache_file(self, symbol: str, interval: str, footprints: List[Dict]):
        """Guarda footprints al archivo de cache."""
        file_path = self._get_cache_file_path(symbol, interval)

        # Filtrar footprints viejos (> max_history_hours)
        max_hours = self.config.get("max_history_hours", 12)
        max_age_ms = max_hours * 60 * 60 * 1000
        now_ms = int(time.time() * 1000)
        cutoff_ms = now_ms - max_age_ms

        valid_fps = [
            fp for fp in footprints
            if fp.get("candle_timestamp", 0) >= cutoff_ms
        ]

        data = {
            "symbol": symbol,
            "interval": interval,
            "max_age_hours": max_hours,
            "updated_at": now_ms,
            "count": len(valid_fps),
            "footprints": valid_fps
        }

        with open(file_path, 'w') as f:
            json.dump(data, f)

    async def repair_all(self, intervals: List[str] = None) -> List[RepairResult]:
        """
        Repara todos los simbolos con problemas.

        Returns:
            Lista de RepairResult
        """
        self._is_repairing = True
        self._repair_progress = 0.0

        symbols = self.config.get("symbols", [])
        intervals = intervals or self.config.get("intervals", ["1"])

        results = []
        total_tasks = len(symbols) * len(intervals)
        completed = 0

        try:
            for symbol in symbols:
                for interval in intervals:
                    # Validar primero
                    validation = self.validate_symbol(symbol, interval)

                    # Solo reparar si hay problemas
                    if validation.status == IntegrityStatus.ISSUES:
                        result = await self.repair_symbol(symbol, interval)
                        results.append(result)

                    completed += 1
                    self._repair_progress = (completed / total_tasks) * 100

        finally:
            self._is_repairing = False
            self._repair_progress = 100.0

        return results

    async def clear_and_reload(self, symbol: str = None, interval: str = "1") -> List[RepairResult]:
        """
        Limpia el cache y recarga todo desde el cloud.

        Args:
            symbol: Simbolo especifico o None para todos
            interval: Intervalo

        Returns:
            Lista de RepairResult
        """
        self._is_repairing = True
        self._repair_progress = 0.0

        symbols = [symbol] if symbol else self.config.get("symbols", [])
        intervals = [interval] if interval else self.config.get("intervals", ["1"])

        results = []
        total_tasks = len(symbols) * len(intervals)
        completed = 0

        try:
            for sym in symbols:
                for intv in intervals:
                    self._current_repair_symbol = sym

                    # Eliminar archivo de cache
                    file_path = self._get_cache_file_path(sym, intv)
                    if file_path.exists():
                        file_path.unlink()
                        logger.info(f"[INTEGRITY] Eliminado cache de {sym}_{intv}")

                    # Cargar del cloud
                    cloud_fps = await self._fetch_from_cloud(sym, intv)

                    if cloud_fps:
                        self._save_cache_file(sym, intv, cloud_fps)
                        results.append(RepairResult(
                            symbol=sym,
                            interval=intv,
                            success=True,
                            footprints_removed=0,
                            footprints_added_from_cloud=len(cloud_fps),
                            gaps_filled=0
                        ))
                    else:
                        results.append(RepairResult(
                            symbol=sym,
                            interval=intv,
                            success=False,
                            footprints_removed=0,
                            footprints_added_from_cloud=0,
                            gaps_filled=0,
                            error="No se pudo obtener datos del cloud"
                        ))

                    completed += 1
                    self._repair_progress = (completed / total_tasks) * 100

        finally:
            self._is_repairing = False
            self._repair_progress = 100.0
            self._current_repair_symbol = None

        return results

    def get_status(self) -> Dict:
        """
        Retorna el estado actual del servicio.

        Returns:
            Dict con estado, progreso, ultimo reporte
        """
        return {
            "is_repairing": self._is_repairing,
            "repair_progress": self._repair_progress,
            "current_repair_symbol": self._current_repair_symbol,
            "last_report": asdict(self._last_report) if self._last_report else None
        }


# Singleton instance
_integrity_service: Optional[CacheIntegrityService] = None


def get_integrity_service(config: Dict = None) -> CacheIntegrityService:
    """Retorna la instancia singleton del servicio."""
    global _integrity_service
    if _integrity_service is None:
        _integrity_service = CacheIntegrityService(config)
    elif config:
        _integrity_service.update_config(config)
    return _integrity_service


async def startup_integrity_check(config: Dict) -> IntegrityReport:
    """
    Ejecuta validacion y reparacion automatica al iniciar.

    Esta funcion debe llamarse durante el startup del backend.

    Returns:
        IntegrityReport con resultados
    """
    service = get_integrity_service(config)

    logger.info("[INTEGRITY] Iniciando validacion de cache...")

    # Validar todo
    report = service.validate_all()

    logger.info(
        f"[INTEGRITY] Validacion completada: "
        f"{report.symbols_healthy} OK, {report.symbols_with_issues} con problemas"
    )

    # Reparar automaticamente si hay problemas
    if report.symbols_with_issues > 0:
        logger.info("[INTEGRITY] Iniciando reparacion automatica...")

        repair_results = await service.repair_all()

        success_count = sum(1 for r in repair_results if r.success)
        logger.info(f"[INTEGRITY] Reparacion completada: {success_count}/{len(repair_results)} exitosas")

        # Re-validar
        report = service.validate_all()

    return report
