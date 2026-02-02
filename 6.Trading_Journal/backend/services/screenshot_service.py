"""
Trading Journal - Screenshot Service
Sistema híbrido de capturas: Playwright (primario) + mplfinance (fallback).
"""

import os
import asyncio
import logging
from typing import Optional, Dict, Any
from datetime import datetime
from pathlib import Path
import json

logger = logging.getLogger(__name__)

# Intentar importar Playwright
try:
    from playwright.async_api import async_playwright, Browser, Page
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False
    logger.warning("Playwright not available. Install with: pip install playwright && playwright install chromium")

# Intentar importar mplfinance para fallback
try:
    import mplfinance as mpf
    import pandas as pd
    MPLFINANCE_AVAILABLE = True
except ImportError:
    MPLFINANCE_AVAILABLE = False
    logger.warning("mplfinance not available for fallback charts")


class ScreenshotService:
    """
    Servicio de capturas de pantalla híbrido.

    Estrategia:
    1. Intenta usar Playwright para capturar el frontend real
    2. Si falla, usa mplfinance para generar gráfico estático
    3. Guarda imágenes en screenshots/{symbol}/{entry_id}_{event}.png
    """

    def __init__(
        self,
        screenshots_dir: str = "screenshots",
        frontend_urls: Dict[str, str] = None
    ):
        self.screenshots_dir = Path(screenshots_dir)
        self.screenshots_dir.mkdir(parents=True, exist_ok=True)

        # URLs de frontends por defecto (versiones Desktop)
        self.frontend_urls = frontend_urls or {
            "watchlist": "http://localhost:5173",      # App 2 (web)
            "analizador": "http://localhost:5174",     # App 8 AnalizadorDesktop
            "order_flow": "http://localhost:5175",     # App 9 OrderFlowDesktop
            "backtester": "http://localhost:5173"      # App 1 (web)
        }

        # Estado de Playwright
        self._browser: Optional[Browser] = None
        self._playwright = None

    async def initialize(self):
        """Inicializa Playwright si está disponible"""
        if not PLAYWRIGHT_AVAILABLE:
            logger.info("Screenshot service initialized (mplfinance fallback only)")
            return

        try:
            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(
                headless=True,
                args=['--no-sandbox', '--disable-setuid-sandbox']
            )
            logger.info("Screenshot service initialized with Playwright")
        except Exception as e:
            logger.error(f"Failed to initialize Playwright: {e}")
            self._browser = None

    async def shutdown(self):
        """Cierra recursos"""
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()
        logger.info("Screenshot service shut down")

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
        Captura screenshot del gráfico.

        Args:
            symbol: Símbolo (ej: BTCUSDT)
            event_type: "entry" o "exit"
            entry_id: ID de la entrada del journal
            source: App fuente para determinar URL
            timeframe: Timeframe del gráfico
            candles_data: Datos de velas para fallback (opcional)

        Returns:
            Path al archivo de imagen o None si falla
        """
        # Crear directorio para el símbolo
        symbol_dir = self.screenshots_dir / symbol
        symbol_dir.mkdir(parents=True, exist_ok=True)

        # Nombre del archivo
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{entry_id}_{event_type}_{timestamp}.png"
        filepath = symbol_dir / filename

        # Intentar Playwright primero
        if self._browser:
            success = await self._capture_with_playwright(
                symbol=symbol,
                source=source,
                timeframe=timeframe,
                filepath=str(filepath)
            )
            if success:
                return str(filepath)

        # Fallback a mplfinance
        if MPLFINANCE_AVAILABLE and candles_data:
            success = await self._capture_with_mplfinance(
                symbol=symbol,
                candles_data=candles_data,
                filepath=str(filepath)
            )
            if success:
                return str(filepath)

        # Fallback: intentar obtener datos y generar gráfico
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

    async def _capture_with_playwright(
        self,
        symbol: str,
        source: str,
        timeframe: str,
        filepath: str
    ) -> bool:
        """Captura usando Playwright"""
        try:
            base_url = self.frontend_urls.get(source, self.frontend_urls["analizador"])

            # Crear nueva página
            page = await self._browser.new_page()
            page.set_default_timeout(30000)  # 30 segundos

            # Construir URL según la app
            if source == "analizador":
                url = f"{base_url}?symbol={symbol}&interval={timeframe}"
            elif source == "watchlist":
                url = f"{base_url}?symbol={symbol}"
            elif source == "order_flow":
                url = f"{base_url}?symbol={symbol}&interval={timeframe}"
            else:
                url = base_url

            logger.info(f"Navigating to {url}")

            # Navegar
            await page.goto(url, wait_until="networkidle")

            # Esperar a que el gráfico cargue
            await asyncio.sleep(3)  # Dar tiempo para renderizado

            # Intentar encontrar el contenedor del gráfico
            chart_selectors = [
                '.chart-container',
                '.uplot',
                '[class*="chart"]',
                'canvas',
                '#chart'
            ]

            element = None
            for selector in chart_selectors:
                try:
                    element = await page.query_selector(selector)
                    if element:
                        break
                except:
                    continue

            if element:
                # Capturar solo el gráfico
                await element.screenshot(path=filepath)
            else:
                # Capturar página completa
                await page.screenshot(path=filepath, full_page=False)

            await page.close()

            logger.info(f"Playwright screenshot saved: {filepath}")
            return True

        except Exception as e:
            logger.error(f"Playwright capture failed: {e}")
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
        """Obtiene datos de velas para el fallback"""
        import httpx

        # Intentar desde diferentes backends
        backends = [
            f"http://localhost:10000/api/historical/{symbol}?interval={timeframe}&limit={limit}",
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

    async def request_screenshot_from_frontend(
        self,
        symbol: str,
        source: str,
        event_type: str,
        entry_id: str
    ) -> Optional[str]:
        """
        Solicita screenshot directamente al frontend vía endpoint.
        Requiere que el frontend implemente /api/screenshot
        """
        import httpx

        base_url = self.frontend_urls.get(source, self.frontend_urls["analizador"])

        # Cambiar puerto de frontend a backend si es necesario
        port_mapping = {
            "10001": "10000",  # Analizador
            "5173": "8000",    # Watchlist
            "11001": "11000",  # Order Flow
        }

        for frontend_port, backend_port in port_mapping.items():
            if frontend_port in base_url:
                backend_url = base_url.replace(frontend_port, backend_port)
                break
        else:
            backend_url = base_url

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{backend_url}/api/screenshot",
                    json={
                        "symbol": symbol,
                        "event_type": event_type,
                        "entry_id": entry_id
                    }
                )

                if response.status_code == 200:
                    data = response.json()
                    if data.get('success') and data.get('path'):
                        # Copiar archivo al directorio de screenshots del journal
                        # Por ahora solo retornamos el path
                        return data.get('path')

        except Exception as e:
            logger.debug(f"Frontend screenshot request failed: {e}")

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
            "playwright_available": PLAYWRIGHT_AVAILABLE,
            "playwright_browser_running": self._browser is not None,
            "mplfinance_available": MPLFINANCE_AVAILABLE,
            "screenshots_dir": str(self.screenshots_dir),
            "frontend_urls": self.frontend_urls
        }
