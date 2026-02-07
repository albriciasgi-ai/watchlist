"""
Trading Journal - Screenshot Service
Captura screenshots del grafico del AnalizadorDesktop via HTTP + mplfinance (fallback).

Estrategia de captura:
1. Electron capture: HTTP GET al servidor de screenshots del AnalizadorDesktop (puerto 5180)
2. Fallback mplfinance: Genera grafico estatico con datos de la API
"""

import os
import asyncio
import logging
from typing import Optional, Dict, Any
from datetime import datetime
from pathlib import Path
import json

logger = logging.getLogger(__name__)

# Intentar importar mplfinance para fallback
try:
    import mplfinance as mpf
    import pandas as pd
    MPLFINANCE_AVAILABLE = True
except ImportError:
    MPLFINANCE_AVAILABLE = False
    logger.warning("mplfinance not available for fallback charts")


# URL del servidor de screenshots del AnalizadorDesktop
ELECTRON_SCREENSHOT_URL = "http://127.0.0.1:5180"


class ScreenshotService:
    """
    Servicio de capturas de pantalla.

    Estrategia:
    1. Intenta capturar via HTTP desde AnalizadorDesktop (Electron, puerto 5180)
    2. Si falla, usa mplfinance para generar grafico estatico
    3. Guarda imagenes en screenshots/{symbol}/{entry_id}_{event}.png
    """

    def __init__(
        self,
        screenshots_dir: str = "screenshots",
        electron_url: str = ELECTRON_SCREENSHOT_URL
    ):
        self.screenshots_dir = Path(screenshots_dir)
        self.screenshots_dir.mkdir(parents=True, exist_ok=True)
        self.electron_url = electron_url

    async def initialize(self):
        """Inicializa el servicio y verifica disponibilidad del Electron screenshot server"""
        electron_ok = await self._check_electron_available()
        if electron_ok:
            logger.info(f"Screenshot service initialized (Electron capture at {self.electron_url})")
        elif MPLFINANCE_AVAILABLE:
            logger.info("Screenshot service initialized (mplfinance fallback only - Electron not available)")
        else:
            logger.warning("Screenshot service initialized (NO capture methods available)")

    async def shutdown(self):
        """Cierra recursos"""
        logger.info("Screenshot service shut down")

    async def _check_electron_available(self) -> bool:
        """Verifica si el servidor de screenshots de Electron esta disponible"""
        import httpx
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                response = await client.get(f"{self.electron_url}/status")
                if response.status_code == 200:
                    data = response.json()
                    logger.info(f"Electron screenshot server: available={data.get('available')}, symbol={data.get('currentSymbol')}")
                    return data.get('available', False)
        except Exception:
            pass
        return False

    async def capture(
        self,
        symbol: str,
        event_type: str,  # "entry" o "exit"
        entry_id: str,
        source: str = "analizador",
        timeframe: str = "1",
        candles_data: Optional[list] = None
    ) -> Optional[str]:
        """
        Captura screenshot del grafico.

        Args:
            symbol: Simbolo (ej: BTCUSDT)
            event_type: "entry" o "exit"
            entry_id: ID de la entrada del journal
            source: App fuente (no se usa actualmente, siempre captura del Analizador)
            timeframe: Timeframe del grafico
            candles_data: Datos de velas para fallback (opcional)

        Returns:
            Path al archivo de imagen o None si falla
        """
        # Crear directorio para el simbolo
        symbol_dir = self.screenshots_dir / symbol
        symbol_dir.mkdir(parents=True, exist_ok=True)

        # Nombre del archivo
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{entry_id}_{event_type}_{timestamp}.png"
        filepath = symbol_dir / filename

        # 1. Intentar captura desde Electron (AnalizadorDesktop)
        success = await self._capture_from_electron(
            symbol=symbol,
            filepath=str(filepath)
        )
        if success:
            return str(filepath)

        # 2. Fallback a mplfinance con datos proporcionados
        if MPLFINANCE_AVAILABLE and candles_data:
            success = await self._capture_with_mplfinance(
                symbol=symbol,
                candles_data=candles_data,
                filepath=str(filepath)
            )
            if success:
                return str(filepath)

        # 3. Fallback: obtener datos de la API y generar grafico
        if MPLFINANCE_AVAILABLE:
            candles = await self._fetch_candles_for_fallback(symbol, timeframe)
            if candles:
                success = await self._capture_with_mplfinance(
                    symbol=symbol,
                    candles_data=candles,
                    filepath=str(filepath)
                )
                if success:
                    return str(filepath)

        logger.error(f"All screenshot methods failed for {symbol}")
        return None

    async def _capture_from_electron(
        self,
        symbol: str,
        filepath: str
    ) -> bool:
        """Captura screenshot desde el AnalizadorDesktop via HTTP"""
        import httpx
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.electron_url}/screenshot",
                    params={"symbol": symbol}
                )

                if response.status_code == 200:
                    # Verificar si el simbolo coincide
                    symbol_match = response.headers.get('X-Symbol-Match', 'false') == 'true'
                    current_symbol = response.headers.get('X-Current-Symbol', 'unknown')

                    # Guardar la imagen PNG
                    with open(filepath, 'wb') as f:
                        f.write(response.content)

                    if symbol_match:
                        logger.info(f"Electron screenshot saved: {filepath} (symbol: {symbol})")
                    else:
                        logger.info(f"Electron screenshot saved: {filepath} (requested: {symbol}, showing: {current_symbol})")

                    return True
                else:
                    error_msg = "unknown error"
                    try:
                        error_msg = response.json().get('error', error_msg)
                    except Exception:
                        pass
                    logger.warning(f"Electron screenshot failed ({response.status_code}): {error_msg}")
                    return False

        except httpx.ConnectError:
            logger.debug("Electron screenshot server not available (AnalizadorDesktop not running?)")
            return False
        except Exception as e:
            logger.warning(f"Electron screenshot error: {e}")
            return False

    async def _capture_with_mplfinance(
        self,
        symbol: str,
        candles_data: list,
        filepath: str
    ) -> bool:
        """Genera gráfico estático con mplfinance"""
        try:
            # Convertir a DataFrame
            df = pd.DataFrame(candles_data)

            # Asegurar columnas correctas
            required_cols = ['timestamp', 'open', 'high', 'low', 'close', 'volume']
            for col in required_cols:
                if col not in df.columns:
                    # Intentar mapear nombres alternativos
                    alt_names = {
                        'timestamp': ['time', 't', 'date'],
                        'open': ['o', 'Open'],
                        'high': ['h', 'High'],
                        'low': ['l', 'Low'],
                        'close': ['c', 'Close'],
                        'volume': ['v', 'Volume', 'vol']
                    }
                    for alt in alt_names.get(col, []):
                        if alt in df.columns:
                            df[col] = df[alt]
                            break

            # Convertir tipos
            df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
            df.set_index('timestamp', inplace=True)

            for col in ['open', 'high', 'low', 'close', 'volume']:
                df[col] = pd.to_numeric(df[col], errors='coerce')

            # Tomar últimas 100 velas
            df = df.tail(100)

            # Configuración del estilo
            mc = mpf.make_marketcolors(
                up='#26a69a',
                down='#ef5350',
                edge='inherit',
                wick='inherit',
                volume='in'
            )

            style = mpf.make_mpf_style(
                base_mpf_style='nightclouds',
                marketcolors=mc,
                gridstyle='',
                y_on_right=True
            )

            # Generar gráfico
            mpf.plot(
                df,
                type='candle',
                style=style,
                volume=True,
                title=f'{symbol} Chart',
                savefig=dict(fname=filepath, dpi=150, bbox_inches='tight'),
                figsize=(12, 8)
            )

            logger.info(f"mplfinance screenshot saved: {filepath}")
            return True

        except Exception as e:
            logger.error(f"mplfinance capture failed: {e}")
            return False

    async def _fetch_candles_for_fallback(
        self,
        symbol: str,
        timeframe: str,
        limit: int = 100
    ) -> Optional[list]:
        """Obtiene datos de velas para el fallback de mplfinance"""
        import httpx

        # Intentar desde diferentes backends (Analizador, Watchlist, Backtester)
        backends = [
            f"http://localhost:10001/api/historical/{symbol}?interval={timeframe}&limit={limit}",
            f"http://localhost:8000/api/historical/{symbol}?interval={timeframe}&limit={limit}",
            f"http://localhost:9000/api/historical/{symbol}?interval={timeframe}&limit={limit}",
        ]

        async with httpx.AsyncClient(timeout=10.0) as client:
            for url in backends:
                try:
                    response = await client.get(url)
                    if response.status_code == 200:
                        data = response.json()
                        candles = data.get('candles') or data.get('data') or data
                        if candles and isinstance(candles, list):
                            return candles
                except Exception:
                    continue

        return None

    def get_screenshots_for_entry(self, entry_id: str) -> Dict[str, Optional[str]]:
        """Busca screenshots existentes para una entry"""
        result = {"entry": None, "exit": None}

        for symbol_dir in self.screenshots_dir.iterdir():
            if symbol_dir.is_dir():
                for file in symbol_dir.glob(f"{entry_id}_*.png"):
                    filename = file.name
                    if "_entry_" in filename:
                        result["entry"] = str(file)
                    elif "_exit_" in filename:
                        result["exit"] = str(file)

        return result

    def delete_screenshots_for_entry(self, entry_id: str) -> int:
        """Elimina screenshots de una entry"""
        deleted = 0

        for symbol_dir in self.screenshots_dir.iterdir():
            if symbol_dir.is_dir():
                for file in symbol_dir.glob(f"{entry_id}_*.png"):
                    try:
                        file.unlink()
                        deleted += 1
                    except Exception as e:
                        logger.error(f"Failed to delete {file}: {e}")

        return deleted

    def get_status(self) -> Dict[str, Any]:
        """Retorna estado del servicio"""
        return {
            "electron_screenshot_url": self.electron_url,
            "mplfinance_available": MPLFINANCE_AVAILABLE,
            "screenshots_dir": str(self.screenshots_dir)
        }
