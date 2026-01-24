# footprint_storage.py - Persistencia de footprints en disco
#
# Guarda footprints completados en archivos JSON para poder cargarlos
# al reiniciar el servicio. Mantiene un historial configurable (default 12h).

import json
import logging
import time
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import asdict
from collections import defaultdict

logger = logging.getLogger(__name__)

# Directorio donde se guardan los footprints
STORAGE_DIR = Path(__file__).parent / "footprint_cache"


class FootprintStorage:
    """
    Almacena y recupera footprints de disco.

    Los footprints se guardan en archivos JSON por simbolo+intervalo:
    footprint_cache/
        BTCUSDT_1.json
        ETHUSDT_1.json
        ...

    Cada archivo contiene un array de footprints ordenados por timestamp.
    """

    def __init__(self, storage_dir: Path = None, max_age_hours: float = 12):
        """
        Args:
            storage_dir: Directorio para guardar archivos (default: footprint_cache/)
            max_age_hours: Edad maxima de footprints a mantener (default: 12 horas)
        """
        self.storage_dir = storage_dir or STORAGE_DIR
        self.max_age_hours = max_age_hours
        self.max_age_ms = max_age_hours * 60 * 60 * 1000  # Convertir a milliseconds

        # Cache en memoria para evitar lecturas frecuentes
        self._cache: Dict[str, List[dict]] = defaultdict(list)
        self._dirty: Dict[str, bool] = defaultdict(bool)  # Marca si hay cambios sin guardar
        self._last_save: Dict[str, float] = defaultdict(float)

        # Crear directorio si no existe
        self.storage_dir.mkdir(parents=True, exist_ok=True)

        logger.info(f"[FOOTPRINT_STORAGE] Initialized at {self.storage_dir}, max_age={max_age_hours}h")

    def _get_file_path(self, symbol: str, interval: str) -> Path:
        """Retorna el path del archivo para un simbolo+intervalo."""
        return self.storage_dir / f"{symbol}_{interval}.json"

    def _get_key(self, symbol: str, interval: str) -> str:
        """Retorna la key para el cache en memoria."""
        return f"{symbol}_{interval}"

    def load(self, symbol: str, interval: str) -> List[dict]:
        """
        Carga footprints desde disco para un simbolo+intervalo.

        Returns:
            Lista de footprints (diccionarios) ordenados por timestamp
        """
        key = self._get_key(symbol, interval)

        # Si ya esta en cache, retornar
        if key in self._cache and self._cache[key]:
            return self._cache[key]

        file_path = self._get_file_path(symbol, interval)

        if not file_path.exists():
            logger.debug(f"[FOOTPRINT_STORAGE] No cache file for {key}")
            return []

        try:
            with open(file_path, 'r') as f:
                data = json.load(f)

            footprints = data.get("footprints", [])

            # Filtrar footprints antiguos
            now_ms = int(time.time() * 1000)
            cutoff_ms = now_ms - self.max_age_ms

            # DEBUG: Log timestamps for troubleshooting
            if footprints:
                first_ts = footprints[0].get("candle_timestamp", 0)
                last_ts = footprints[-1].get("candle_timestamp", 0)
                logger.info(
                    f"[FOOTPRINT_STORAGE] Loading {key}: "
                    f"{len(footprints)} footprints in file, "
                    f"now_ms={now_ms}, cutoff_ms={cutoff_ms}, "
                    f"first_ts={first_ts}, last_ts={last_ts}, "
                    f"max_age_hours={self.max_age_hours}"
                )

            valid_footprints = [
                fp for fp in footprints
                if fp.get("candle_timestamp", 0) >= cutoff_ms
            ]

            # Ordenar por timestamp
            valid_footprints.sort(key=lambda x: x.get("candle_timestamp", 0))

            self._cache[key] = valid_footprints

            logger.info(
                f"[FOOTPRINT_STORAGE] Loaded {len(valid_footprints)} footprints for {key} "
                f"(filtered {len(footprints) - len(valid_footprints)} old)"
            )

            return valid_footprints

        except Exception as e:
            logger.error(f"[FOOTPRINT_STORAGE] Error loading {key}: {e}")
            return []

    def save_footprint(self, footprint_dict: dict) -> bool:
        """
        Guarda un footprint nuevo.

        Args:
            footprint_dict: Footprint serializado como diccionario

        Returns:
            True si se guardo correctamente
        """
        symbol = footprint_dict.get("symbol")
        interval = footprint_dict.get("interval")

        if not symbol or not interval:
            logger.warning("[FOOTPRINT_STORAGE] Footprint missing symbol/interval")
            return False

        key = self._get_key(symbol, interval)

        # Cargar cache si no esta
        if key not in self._cache:
            self.load(symbol, interval)

        # Verificar si ya existe (por timestamp)
        timestamp = footprint_dict.get("candle_timestamp")
        existing_timestamps = {fp.get("candle_timestamp") for fp in self._cache[key]}

        if timestamp in existing_timestamps:
            # Actualizar existente
            self._cache[key] = [
                footprint_dict if fp.get("candle_timestamp") == timestamp else fp
                for fp in self._cache[key]
            ]
        else:
            # Agregar nuevo
            self._cache[key].append(footprint_dict)

        # Ordenar por timestamp
        self._cache[key].sort(key=lambda x: x.get("candle_timestamp", 0))

        # Marcar como dirty
        self._dirty[key] = True

        # Auto-save cada 30 segundos o cada 10 footprints nuevos
        now = time.time()
        if now - self._last_save.get(key, 0) > 30:
            self._flush_to_disk(symbol, interval)

        return True

    def _flush_to_disk(self, symbol: str, interval: str) -> bool:
        """Guarda los footprints en memoria a disco."""
        key = self._get_key(symbol, interval)

        if not self._dirty.get(key):
            return True

        # Filtrar antiguos antes de guardar
        now_ms = int(time.time() * 1000)
        cutoff_ms = now_ms - self.max_age_ms

        valid_footprints = [
            fp for fp in self._cache[key]
            if fp.get("candle_timestamp", 0) >= cutoff_ms
        ]

        self._cache[key] = valid_footprints

        file_path = self._get_file_path(symbol, interval)

        try:
            data = {
                "symbol": symbol,
                "interval": interval,
                "max_age_hours": self.max_age_hours,
                "updated_at": int(time.time() * 1000),
                "count": len(valid_footprints),
                "footprints": valid_footprints
            }

            with open(file_path, 'w') as f:
                json.dump(data, f)

            self._dirty[key] = False
            self._last_save[key] = time.time()

            logger.debug(f"[FOOTPRINT_STORAGE] Flushed {len(valid_footprints)} footprints for {key}")
            return True

        except Exception as e:
            logger.error(f"[FOOTPRINT_STORAGE] Error saving {key}: {e}")
            return False

    def flush_all(self) -> int:
        """Guarda todos los footprints pendientes a disco."""
        saved = 0
        for key in list(self._dirty.keys()):
            if self._dirty[key]:
                parts = key.split("_")
                if len(parts) >= 2:
                    symbol = "_".join(parts[:-1])  # Handle symbols with _ in name
                    interval = parts[-1]
                    if self._flush_to_disk(symbol, interval):
                        saved += 1

        if saved > 0:
            logger.info(f"[FOOTPRINT_STORAGE] Flushed {saved} files to disk")

        return saved

    def get_footprints(self, symbol: str, interval: str,
                       limit: int = None, since_ms: int = None) -> List[dict]:
        """
        Obtiene footprints del cache.

        Args:
            symbol: Simbolo
            interval: Intervalo
            limit: Maximo numero de footprints (mas recientes)
            since_ms: Solo footprints desde este timestamp

        Returns:
            Lista de footprints
        """
        key = self._get_key(symbol, interval)

        # Cargar si no esta en cache
        if key not in self._cache:
            self.load(symbol, interval)

        footprints = self._cache.get(key, [])

        # Filtrar por timestamp si se especifica
        if since_ms:
            footprints = [fp for fp in footprints if fp.get("candle_timestamp", 0) >= since_ms]

        # Limitar cantidad
        if limit and len(footprints) > limit:
            footprints = footprints[-limit:]

        return footprints

    def get_count(self, symbol: str, interval: str) -> int:
        """Retorna la cantidad de footprints almacenados."""
        key = self._get_key(symbol, interval)
        if key not in self._cache:
            self.load(symbol, interval)
        return len(self._cache.get(key, []))

    def cleanup_old(self) -> int:
        """
        Limpia footprints antiguos de todos los archivos.

        Returns:
            Cantidad de footprints eliminados
        """
        removed = 0
        now_ms = int(time.time() * 1000)
        cutoff_ms = now_ms - self.max_age_ms

        for key in list(self._cache.keys()):
            before = len(self._cache[key])
            self._cache[key] = [
                fp for fp in self._cache[key]
                if fp.get("candle_timestamp", 0) >= cutoff_ms
            ]
            after = len(self._cache[key])

            if before > after:
                removed += (before - after)
                self._dirty[key] = True

        if removed > 0:
            self.flush_all()
            logger.info(f"[FOOTPRINT_STORAGE] Cleaned up {removed} old footprints")

        return removed

    def clear(self, symbol: str = None, interval: str = None) -> bool:
        """
        Limpia footprints.

        Args:
            symbol: Si se especifica, solo limpia este simbolo
            interval: Si se especifica, solo limpia este intervalo
        """
        if symbol and interval:
            # Limpiar solo un archivo
            key = self._get_key(symbol, interval)
            self._cache[key] = []
            self._dirty[key] = True
            self._flush_to_disk(symbol, interval)
            logger.info(f"[FOOTPRINT_STORAGE] Cleared {key}")
        else:
            # Limpiar todo
            for file_path in self.storage_dir.glob("*.json"):
                try:
                    file_path.unlink()
                except Exception as e:
                    logger.error(f"[FOOTPRINT_STORAGE] Error deleting {file_path}: {e}")

            self._cache.clear()
            self._dirty.clear()
            logger.info("[FOOTPRINT_STORAGE] Cleared all footprints")

        return True

    def get_stats(self) -> dict:
        """Retorna estadisticas del storage."""
        total_footprints = sum(len(fps) for fps in self._cache.values())
        files = list(self.storage_dir.glob("*.json"))

        return {
            "storage_dir": str(self.storage_dir),
            "max_age_hours": self.max_age_hours,
            "files_count": len(files),
            "cached_keys": list(self._cache.keys()),
            "total_footprints_in_memory": total_footprints,
            "dirty_files": [k for k, v in self._dirty.items() if v]
        }


# Singleton instance
_storage_instance: Optional[FootprintStorage] = None


def get_footprint_storage(max_age_hours: float = 12) -> FootprintStorage:
    """Retorna la instancia singleton del storage."""
    global _storage_instance
    if _storage_instance is None:
        _storage_instance = FootprintStorage(max_age_hours=max_age_hours)
    return _storage_instance


def reset_footprint_storage():
    """Reset del singleton (para testing)."""
    global _storage_instance
    if _storage_instance:
        _storage_instance.flush_all()
    _storage_instance = None
