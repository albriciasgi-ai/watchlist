# footprint_collector.py - Recolector de footprints desde Bybit WebSocket
#
# Conecta al WebSocket de trades de Bybit y construye footprints
# que se guardan en disco de forma comprimida.

import asyncio
import json
import gzip
import os
import logging
import time
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Set
from collections import defaultdict
from dataclasses import dataclass, asdict

import websockets

logger = logging.getLogger(__name__)

# Bybit WebSocket URL
BYBIT_WS_URL = "wss://stream.bybit.com/v5/public/linear"

# Step sizes por defecto para cada simbolo (en USD)
DEFAULT_STEP_SIZES = {
    "BTCUSDT": 10.0,
    "ETHUSDT": 5.0,
    "SOLUSDT": 0.5,
    "XRPUSDT": 0.005,
    "ADAUSDT": 0.005,
    "DOGEUSDT": 0.001,
    "BNBUSDT": 1.0,
    "MATICUSDT": 0.01,
    "DOTUSDT": 0.1,
    "LINKUSDT": 0.1,
}


@dataclass
class FootprintLevel:
    """Un nivel de precio en el footprint."""
    price_min: float
    price_max: float
    price_mid: float
    bid_volume: float = 0.0
    ask_volume: float = 0.0
    delta: float = 0.0
    total_volume: float = 0.0
    trade_count: int = 0


@dataclass
class ActiveFootprint:
    """Footprint en construccion para la vela actual."""
    candle_timestamp: int
    symbol: str
    interval: str
    step_size: float
    levels: Dict[float, FootprintLevel]  # key = price_min
    candle_open: Optional[float] = None
    candle_high: Optional[float] = None
    candle_low: Optional[float] = None
    candle_close: Optional[float] = None
    total_volume: float = 0.0
    total_delta: float = 0.0
    trade_count: int = 0


class FootprintCollector:
    """
    Recolecta trades de Bybit y construye footprints.

    Los footprints se guardan en disco organizados por fecha:
    /data/BTCUSDT/2024-01-26.json.gz
    """

    def __init__(
        self,
        symbols: List[str],
        interval: str = "1",
        data_dir: Path = Path("/data"),
        max_days: int = 30
    ):
        self.symbols = [s.upper() for s in symbols]
        self.interval = interval
        self.interval_ms = int(interval) * 60 * 1000
        self.data_dir = data_dir
        self.max_days = max_days
        self.running = False

        # Footprint activo por simbolo
        self.active_footprints: Dict[str, ActiveFootprint] = {}

        # Grabador de trades en el formato del almacen (.tape); lo asigna main.py
        self.tape = None

        # Buffer de footprints completados (antes de guardar a disco)
        self.completed_buffer: Dict[str, List[dict]] = defaultdict(list)
        self.buffer_size = 10  # Guardar cada 10 footprints
        # Guardado fuera del bucle: _complete_footprint solo marca la moneda y _flush_loop escribe en un hilo.
        # Antes se releia y reescribia todo el dia comprimido dentro del bucle: se trababa hasta 30 s, las
        # descargas de /api/tape se colgaban y el WebSocket de Bybit podia cortarse
        self._flush_pending = set()
        self._writing: Dict[str, List[dict]] = {}  # lo que se esta escribiendo: get_footprints tambien lo ve
        self._flush_task = None
        self._verified = set()  # archivos ya revisados desde que arranco

        # Stats
        self.stats = {
            "trades_processed": 0,
            "footprints_completed": 0,
            "files_written": 0,
            "last_trade_time": None,
            "connected_since": None,
            "reconnections": 0
        }

        # Crear directorios
        for symbol in self.symbols:
            (self.data_dir / symbol).mkdir(parents=True, exist_ok=True)

    def _get_step_size(self, symbol: str) -> float:
        """Obtiene el step size para un simbolo."""
        return DEFAULT_STEP_SIZES.get(symbol, 1.0)

    def _get_candle_timestamp(self, trade_time_ms: int) -> int:
        """Calcula el timestamp de la vela a la que pertenece un trade."""
        return (trade_time_ms // self.interval_ms) * self.interval_ms

    def _get_price_level(self, price: float, step_size: float) -> float:
        """Obtiene el precio minimo del nivel al que pertenece un precio."""
        return (price // step_size) * step_size

    def _process_trade(self, symbol: str, trade: dict):
        """Procesa un trade individual y lo agrega al footprint activo."""
        try:
            price = float(trade["p"])
            size = float(trade["v"])
            side = trade["S"]  # "Buy" o "Sell"
            trade_time = int(trade["T"])

            candle_ts = self._get_candle_timestamp(trade_time)
            step_size = self._get_step_size(symbol)

            # Verificar si necesitamos una nueva vela
            if symbol not in self.active_footprints or \
               self.active_footprints[symbol].candle_timestamp != candle_ts:
                # Guardar footprint anterior si existe
                if symbol in self.active_footprints:
                    self._complete_footprint(symbol)

                # Crear nuevo footprint
                self.active_footprints[symbol] = ActiveFootprint(
                    candle_timestamp=candle_ts,
                    symbol=symbol,
                    interval=self.interval,
                    step_size=step_size,
                    levels={},
                    candle_open=price,
                    candle_high=price,
                    candle_low=price,
                    candle_close=price
                )

            fp = self.active_footprints[symbol]

            # Actualizar OHLC
            if fp.candle_open is None:
                fp.candle_open = price
            fp.candle_close = price
            if fp.candle_high is None or price > fp.candle_high:
                fp.candle_high = price
            if fp.candle_low is None or price < fp.candle_low:
                fp.candle_low = price

            # Obtener o crear nivel de precio
            level_price = self._get_price_level(price, step_size)

            if level_price not in fp.levels:
                fp.levels[level_price] = FootprintLevel(
                    price_min=level_price,
                    price_max=level_price + step_size,
                    price_mid=level_price + step_size / 2
                )

            level = fp.levels[level_price]

            # Actualizar volumenes segun lado
            if side == "Buy":
                level.ask_volume += size
                fp.total_delta += size
            else:
                level.bid_volume += size
                fp.total_delta -= size

            level.total_volume += size
            level.delta = level.ask_volume - level.bid_volume
            level.trade_count += 1

            fp.total_volume += size
            fp.trade_count += 1

            self.stats["trades_processed"] += 1
            self.stats["last_trade_time"] = trade_time

        except Exception as e:
            logger.error(f"Error procesando trade: {e}")

    def _complete_footprint(self, symbol: str):
        """Completa y guarda un footprint."""
        if symbol not in self.active_footprints:
            return

        fp = self.active_footprints[symbol]

        # Convertir a diccionario
        levels_list = sorted(
            [asdict(level) for level in fp.levels.values()],
            key=lambda x: x["price_min"]
        )

        # Encontrar POC (Point of Control)
        poc_index = 0
        max_volume = 0
        for i, level in enumerate(levels_list):
            if level["total_volume"] > max_volume:
                max_volume = level["total_volume"]
                poc_index = i

        footprint_dict = {
            "candle_timestamp": fp.candle_timestamp,
            "symbol": fp.symbol,
            "interval": fp.interval,
            "candle_open": fp.candle_open,
            "candle_high": fp.candle_high,
            "candle_low": fp.candle_low,
            "candle_close": fp.candle_close,
            "step_size": fp.step_size,
            "levels": levels_list,
            "num_levels": len(levels_list),
            "poc_index": poc_index,
            "poc_price": levels_list[poc_index]["price_mid"] if levels_list else fp.candle_close,
            "total_delta": round(fp.total_delta, 6),
            "total_volume": round(fp.total_volume, 6),
            "trade_count": fp.trade_count,
            "estimated": False  # Datos reales de trades
        }

        # Agregar al buffer
        self.completed_buffer[symbol].append(footprint_dict)
        self.stats["footprints_completed"] += 1

        logger.debug(
            f"[{symbol}] Footprint completado: ts={fp.candle_timestamp}, "
            f"levels={len(levels_list)}, vol={fp.total_volume:.2f}"
        )

        # Buffer lleno: se guarda en un hilo desde _flush_loop, nunca dentro del bucle
        if len(self.completed_buffer[symbol]) >= self.buffer_size:
            self._flush_pending.add(symbol)

    # ---------- disco: un archivo por moneda y dia, con un footprint por linea ----------
    # Formato: JSON lines dentro de un gzip al que se le agregan miembros al final (no se relee el dia).
    # Los archivos de antes eran un arreglo JSON: se leen igual y se pasan a lineas la primera vez que se agrega.

    @staticmethod
    def _read_day(file_path: Path, status: Optional[dict] = None) -> List[dict]:
        """Footprints de un dia, del formato nuevo (lineas) o del viejo (arreglo). Un final cortado se ignora.
        status (opcional) recibe old_format y truncated."""
        out: Dict[int, dict] = {}
        if status is not None:
            status.update(old_format=False, truncated=False)
        with gzip.open(file_path, 'rt', encoding='utf-8') as f:
            first = f.read(1)
            if first == '[':
                if status is not None:
                    status["old_format"] = True
                for fp in json.loads(first + f.read()):
                    out[fp["candle_timestamp"]] = fp
            elif first:
                pending = first
                try:
                    for line in f:
                        line = pending + line
                        pending = ''
                        line = line.strip()
                        if line:
                            fp = json.loads(line)
                            out[fp["candle_timestamp"]] = fp
                except (EOFError, OSError, ValueError) as e:
                    # Un apagado a mitad de un guardado deja el ultimo miembro incompleto: vale lo anterior
                    if status is not None:
                        status["truncated"] = True
                    logger.warning(f"{file_path}: final incompleto ({e}); se usa lo leido")
        return [out[k] for k in sorted(out)]

    def _write_footprints(self, symbol: str, footprints: List[dict]):
        """Agrega footprints a sus dias. En un hilo: no toca el bucle."""
        by_date: Dict[str, List[dict]] = defaultdict(list)
        for fp in footprints:
            date_str = datetime.fromtimestamp(fp["candle_timestamp"] / 1000).strftime("%Y-%m-%d")
            by_date[date_str].append(fp)

        for date_str, fps in by_date.items():
            file_path = self.data_dir / symbol / f"{date_str}.json.gz"
            if file_path.exists() and file_path not in self._verified:
                # Una vez por archivo desde que arranca: un arreglo viejo pasa a lineas, y un final cortado
                # (apagado a mitad de un guardado) se repara antes de agregar, o lo agregado no se leeria
                status = {}
                existing = self._read_day(file_path, status)
                if status["old_format"] or status["truncated"]:
                    tmp = file_path.with_name(file_path.name + ".tmp")
                    with gzip.open(tmp, 'wt', encoding='utf-8', compresslevel=6) as f:
                        for fp in existing:
                            f.write(json.dumps(fp, separators=(',', ':')) + '\n')
                    os.replace(tmp, file_path)
            self._verified.add(file_path)
            with gzip.open(file_path, 'at', encoding='utf-8', compresslevel=6) as f:
                f.write(''.join(json.dumps(fp, separators=(',', ':')) + '\n' for fp in fps))
            self.stats["files_written"] += 1

    async def _flush_symbol(self, symbol: str):
        fps = self.completed_buffer.get(symbol) or []
        if not fps:
            return
        self.completed_buffer[symbol] = []
        self._writing[symbol] = fps
        try:
            await asyncio.to_thread(self._write_footprints, symbol, fps)
        except Exception as e:
            # Vuelven al buffer y se reintenta en la siguiente vuelta
            self.completed_buffer[symbol] = fps + self.completed_buffer[symbol]
            logger.error(f"Error guardando footprints de {symbol}: {e}")
        finally:
            self._writing.pop(symbol, None)

    async def _flush_loop(self):
        while True:
            await asyncio.sleep(5)
            for symbol in list(self._flush_pending):
                self._flush_pending.discard(symbol)
                await self._flush_symbol(symbol)

    async def flush_all_async(self):
        """Guarda todos los buffers (en un hilo)."""
        for symbol in self.symbols:
            await self._flush_symbol(symbol)

    def flush_all(self):
        """Guarda todos los buffers en este hilo (al apagar, cuando el bucle ya no atiende)."""
        for symbol in self.symbols:
            fps = self.completed_buffer.get(symbol) or []
            if not fps:
                continue
            try:
                self._write_footprints(symbol, fps)
                self.completed_buffer[symbol] = []
            except Exception as e:
                logger.error(f"Error guardando footprints de {symbol}: {e}")

    def get_footprints(self, symbol: str, interval: str, hours: int = 12) -> List[dict]:
        """
        Obtiene footprints historicos desde disco.

        Args:
            symbol: Simbolo (ej: BTCUSDT)
            interval: Intervalo (debe coincidir con el configurado)
            hours: Horas de historico

        Returns:
            Lista de footprints ordenados por timestamp
        """
        symbol = symbol.upper()
        symbol_dir = self.data_dir / symbol

        if not symbol_dir.exists():
            return []

        # Calcular fechas a buscar
        now = datetime.now()
        cutoff = now - timedelta(hours=hours)
        cutoff_ts = int(cutoff.timestamp() * 1000)

        footprints = []

        # Buscar archivos de las fechas relevantes
        for days_ago in range(hours // 24 + 2 if self.max_days <= 0 else min(hours // 24 + 2, self.max_days)):
            date = now - timedelta(days=days_ago)
            date_str = date.strftime("%Y-%m-%d")
            file_path = symbol_dir / f"{date_str}.json.gz"

            if not file_path.exists():
                continue

            try:
                for fp in self._read_day(file_path):
                    if fp["candle_timestamp"] >= cutoff_ts:
                        footprints.append(fp)
            except Exception as e:
                logger.warning(f"Error leyendo {file_path}: {e}")

        # Footprints aun no guardados: los del buffer y los que se estan escribiendo
        for pending in (list(self._writing.get(symbol) or []), list(self.completed_buffer.get(symbol) or [])):
            for fp in pending:
                if fp["candle_timestamp"] >= cutoff_ts:
                    footprints.append(fp)

        # Ordenar por timestamp, una vez cada vela (un footprint recien guardado puede estar en los dos)
        by_ts = {fp["candle_timestamp"]: fp for fp in footprints}
        return [by_ts[k] for k in sorted(by_ts)]

    def cleanup_old_files(self) -> int:
        """Elimina archivos mas antiguos que max_days (0 = sin limite: no borra nada)."""
        deleted = 0
        if self.max_days <= 0:
            return 0
        cutoff = datetime.now() - timedelta(days=self.max_days)

        for symbol in self.symbols:
            symbol_dir = self.data_dir / symbol
            if not symbol_dir.exists():
                continue

            for file_path in symbol_dir.glob("*.json.gz"):
                try:
                    # Extraer fecha del nombre
                    date_str = file_path.stem  # "2024-01-26"
                    file_date = datetime.strptime(date_str, "%Y-%m-%d")

                    if file_date < cutoff:
                        file_path.unlink()
                        deleted += 1
                        logger.info(f"Eliminado archivo antiguo: {file_path}")

                except Exception as e:
                    logger.warning(f"Error procesando {file_path}: {e}")

        return deleted

    def get_stats(self) -> dict:
        """Retorna estadisticas del collector."""
        # Contar footprints en disco
        # Solo tamanos: antes descomprimia todos los archivos en cada /health y la consulta
        # tardaba mas de un minuto
        disk_files = 0
        disk_size = 0

        for symbol in self.symbols:
            symbol_dir = self.data_dir / symbol
            if symbol_dir.exists():
                for file_path in symbol_dir.glob("*.json.gz"):
                    disk_size += file_path.stat().st_size
                    disk_files += 1

        return {
            **self.stats,
            "symbols": self.symbols,
            "interval": self.interval,
            "buffer_sizes": {s: len(fps) for s, fps in self.completed_buffer.items()},
            "active_footprints": list(self.active_footprints.keys()),
            "disk_files": disk_files,
            "disk_size_mb": round(disk_size / (1024 * 1024), 2)
        }

    async def start(self):
        """Inicia la recoleccion de trades via WebSocket."""
        self.running = True
        if self._flush_task is None:
            self._flush_task = asyncio.create_task(self._flush_loop())

        while self.running:
            try:
                logger.info(f"Conectando a Bybit WebSocket...")

                async with websockets.connect(
                    BYBIT_WS_URL,
                    ping_interval=20,
                    ping_timeout=10
                ) as ws:
                    self.stats["connected_since"] = int(time.time() * 1000)
                    logger.info(f"Conectado a Bybit WebSocket")
                    if self.tape:
                        self.tape.mark_connected()

                    # Suscribirse a trades de todos los simbolos
                    topics = [f"publicTrade.{symbol}" for symbol in self.symbols]
                    subscribe_msg = {
                        "op": "subscribe",
                        "args": topics
                    }
                    await ws.send(json.dumps(subscribe_msg))
                    logger.info(f"Suscrito a: {topics}")

                    # Procesar mensajes
                    async for message in ws:
                        if not self.running:
                            break

                        try:
                            data = json.loads(message)

                            # Ignorar mensajes de control
                            if "topic" not in data:
                                continue

                            topic = data["topic"]
                            if not topic.startswith("publicTrade."):
                                continue

                            symbol = topic.replace("publicTrade.", "")
                            trades = data.get("data", [])

                            for trade in trades:
                                self._process_trade(symbol, trade)
                                if self.tape:
                                    self.tape.add_trade(symbol, trade)

                        except json.JSONDecodeError:
                            pass
                        except Exception as e:
                            logger.error(f"Error procesando mensaje: {e}")

            except websockets.exceptions.ConnectionClosed as e:
                logger.warning(f"WebSocket cerrado: {e}")
                self.stats["reconnections"] += 1
            except Exception as e:
                logger.error(f"Error WebSocket: {e}")
                self.stats["reconnections"] += 1
            if self.tape:
                # Desde aqui hasta reconectar no hay trades: queda anotado como hueco del dia
                self.tape.mark_disconnected()

            if self.running:
                logger.info("Reconectando en 5 segundos...")
                await asyncio.sleep(5)

    async def stop(self):
        """Detiene la recoleccion."""
        self.running = False
        if self._flush_task:
            self._flush_task.cancel()
            self._flush_task = None
        # Flush final (en un hilo)
        await self.flush_all_async()
