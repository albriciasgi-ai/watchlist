"""
Alert Sender Module

Sends rejection pattern alerts to localhost:5000 for external notification systems.
Supports WebSocket connections for real-time alerts.

Author: Claude Code
Date: 2025-11-11
"""

import asyncio
import httpx
import json
from typing import Dict, List, Optional
from datetime import datetime
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class AlertSender:
    """Sends alerts to external notification service on port 5000"""

    def __init__(self, alert_service_url: str = "http://localhost:5000"):
        self.alert_service_url = alert_service_url
        self.client: Optional[httpx.AsyncClient] = None
        self.alert_queue: asyncio.Queue = asyncio.Queue()
        self.is_running = False

    async def start(self):
        """Start the alert sender service"""
        self.client = httpx.AsyncClient(timeout=5.0)
        self.is_running = True
        logger.info(f"🚀 Alert sender started. Target: {self.alert_service_url}")

        # Start background task to process alert queue
        asyncio.create_task(self._process_alert_queue())

    async def stop(self):
        """Stop the alert sender service"""
        self.is_running = False
        if self.client:
            await self.client.aclose()
        logger.info("🛑 Alert sender stopped")

    async def send_rejection_pattern_alert(
        self,
        symbol: str,
        interval: str,
        pattern: Dict,
        user_config: Optional[Dict] = None
    ) -> bool:
        """
        Sends a rejection pattern alert to the notification service

        Args:
            symbol: Trading pair symbol
            interval: Timeframe (1h, 4h, etc.)
            pattern: Detected pattern data
            user_config: Optional user configuration

        Returns:
            True if sent successfully, False otherwise
        """
        alert_payload = self._build_alert_payload(
            symbol,
            interval,
            pattern,
            user_config
        )

        # Add to queue for asynchronous processing
        await self.alert_queue.put(alert_payload)

        return True

    def _build_alert_payload(
        self,
        symbol: str,
        interval: str,
        pattern: Dict,
        user_config: Optional[Dict]
    ) -> Dict:
        """
        Builds the alert payload in a standardized format compatible with trading bot

        Format expected by bot: [2025-09-16 10:12:00] [BTCUSDT] ABRIR LONG 45000.50
        """
        pattern_type = pattern.get('patternType', 'UNKNOWN')
        confidence = pattern.get('confidence', 0)
        price = pattern.get('price', 0)
        timestamp = pattern.get('timestamp', 0)
        near_levels = pattern.get('nearLevels', [])
        metrics = pattern.get('metrics', {})

        # Determine trading action based on pattern type
        action = self._get_trading_action(pattern_type)

        # Determine alert severity based on confidence
        if confidence >= 80:
            severity = "HIGH"
            priority = 1
        elif confidence >= 65:
            severity = "MEDIUM"
            priority = 2
        else:
            severity = "LOW"
            priority = 3

        # Build human-readable title
        pattern_emoji = self._get_pattern_emoji(pattern_type)
        title = f"{pattern_emoji} {symbol} | {interval} - {self._format_pattern_name(pattern_type)}"

        # Build description
        description = self._build_description(
            symbol,
            interval,
            pattern_type,
            confidence,
            price,
            near_levels,
            metrics
        )

        # Format timestamp
        dt = datetime.fromtimestamp(timestamp / 1000)
        formatted_time = dt.strftime("%Y-%m-%d %H:%M:%S")

        # Build simple message for trading bot
        simple_message = f"[{formatted_time}] [{symbol}] {action} {price:.2f}"

        # Build payload with both formats: simple for bot, detailed for monitoring
        return {
            # Simple format for trading bot execution
            "message": simple_message,
            "timestamp": formatted_time,
            "symbol": symbol,
            "action": action,
            "price": price,
            "confidence": confidence,
            "interval": interval,

            # Detailed format for monitoring/logging (optional, bot can ignore)
            "type": "REJECTION_PATTERN_ALERT",
            "severity": severity,
            "priority": priority,
            "title": title,
            "description": description,
            "data": {
                "patternType": pattern_type,
                "confidence": confidence,
                "price": price,
                "nearLevels": near_levels,
                "metrics": metrics,
                "candle": pattern.get('candle', {}),
                "contextScores": pattern.get('contextScores', {})
            },
            "userConfig": user_config or {}
        }

    def _get_trading_action(self, pattern_type: str) -> str:
        """
        Maps rejection pattern to trading action

        Bullish patterns → ABRIR LONG
        Bearish patterns → ABRIR SHORT
        """
        bullish_patterns = {
            "HAMMER",              # Bullish pin bar reversal
            "ENGULFING_BULLISH",   # Bullish engulfing
            "DOJI_DRAGONFLY"       # Bullish doji
        }

        bearish_patterns = {
            "SHOOTING_STAR",       # Bearish pin bar reversal
            "ENGULFING_BEARISH",   # Bearish engulfing
            "DOJI_GRAVESTONE"      # Bearish doji
        }

        if pattern_type in bullish_patterns:
            return "ABRIR LONG"
        elif pattern_type in bearish_patterns:
            return "ABRIR SHORT"
        else:
            # Fallback for unknown patterns
            return "ABRIR LONG"  # Default to long, but this shouldn't happen

    def _get_pattern_emoji(self, pattern_type: str) -> str:
        """Returns emoji for pattern type"""
        emoji_map = {
            "HAMMER": "🔨",
            "SHOOTING_STAR": "⭐",
            "ENGULFING_BULLISH": "📈",
            "ENGULFING_BEARISH": "📉",
            "DOJI_DRAGONFLY": "🐉",
            "DOJI_GRAVESTONE": "🪦"
        }
        return emoji_map.get(pattern_type, "🔔")

    def _format_pattern_name(self, pattern_type: str) -> str:
        """Formats pattern name for display"""
        name_map = {
            "HAMMER": "Hammer",
            "SHOOTING_STAR": "Shooting Star",
            "ENGULFING_BULLISH": "Bullish Engulfing",
            "ENGULFING_BEARISH": "Bearish Engulfing",
            "DOJI_DRAGONFLY": "Dragonfly Doji",
            "DOJI_GRAVESTONE": "Gravestone Doji"
        }
        return name_map.get(pattern_type, pattern_type)

    def _build_description(
        self,
        symbol: str,
        interval: str,
        pattern_type: str,
        confidence: float,
        price: float,
        near_levels: List[Dict],
        metrics: Dict
    ) -> str:
        """Builds human-readable alert description"""
        lines = [
            f"{self._format_pattern_name(pattern_type)} detected @ ${price:,.2f}",
            f"Confidence: {confidence:.1f}%"
        ]

        # Add nearby levels info
        if near_levels:
            lines.append(f"Near {len(near_levels)} key level(s):")
            for level in near_levels[:3]:  # Show max 3 levels
                level_type = level.get('type', 'Unknown')
                level_price = level.get('price', 0)
                source_type = level.get('sourceType', '').replace('_', ' ').title()
                distance_pct = abs(price - level_price) / price * 100
                lines.append(f"  • {level_type} @ ${level_price:,.2f} ({distance_pct:.2f}% away) - {source_type}")

        # Add metrics
        if metrics:
            pattern_quality = metrics.get('pattern_quality', 0)
            volume_score = metrics.get('volume_score', 0)
            lines.append(f"Pattern Quality: {pattern_quality:.2f} | Volume: {volume_score:.2f}")

        return "\n".join(lines)

    async def _process_alert_queue(self):
        """Background task to process queued alerts"""
        logger.info("📬 Alert queue processor started")

        while self.is_running:
            try:
                # Wait for alert with timeout
                alert = await asyncio.wait_for(
                    self.alert_queue.get(),
                    timeout=1.0
                )

                # Try to send the alert
                success = await self._send_to_service(alert)

                if success:
                    logger.info(f"✅ Alert sent: {alert['title']}")
                else:
                    logger.warning(f"⚠️ Failed to send alert: {alert['title']}")

            except asyncio.TimeoutError:
                # No alerts in queue, continue
                continue
            except Exception as e:
                logger.error(f"❌ Error processing alert: {str(e)}")

        logger.info("📬 Alert queue processor stopped")

    async def _send_to_service(self, alert: Dict) -> bool:
        """
        Sends alert to the notification service via HTTP POST

        Args:
            alert: Alert payload

        Returns:
            True if successful, False otherwise
        """
        if not self.client:
            logger.error("❌ Client not initialized")
            return False

        try:
            response = await self.client.post(
                f"{self.alert_service_url}/api/alerts",
                json=alert
            )

            if response.status_code == 200:
                return True
            else:
                logger.warning(f"⚠️ Alert service returned status {response.status_code}")
                return False

        except httpx.ConnectError:
            logger.error(f"❌ Cannot connect to alert service at {self.alert_service_url}")
            logger.info("💡 Tip: Make sure alert listener is running on port 5000")
            return False

        except httpx.TimeoutException:
            logger.error("❌ Alert service timeout")
            return False

        except Exception as e:
            logger.error(f"❌ Error sending alert: {str(e)}")
            return False

    async def test_connection(self) -> bool:
        """
        Tests connection to alert service

        Returns:
            True if service is reachable, False otherwise
        """
        if not self.client:
            await self.start()

        try:
            response = await self.client.get(
                f"{self.alert_service_url}/api/health"
            )

            if response.status_code == 200:
                logger.info(f"✅ Alert service is reachable at {self.alert_service_url}")
                return True
            else:
                logger.warning(f"⚠️ Alert service returned status {response.status_code}")
                return False

        except httpx.ConnectError:
            logger.warning(f"⚠️ Alert service not reachable at {self.alert_service_url}")
            logger.info("💡 Alert service is optional. Alerts will be logged locally.")
            return False

        except Exception as e:
            logger.error(f"❌ Error testing connection: {str(e)}")
            return False


# Global instance
alert_sender = AlertSender()


# Convenience functions
async def send_pattern_alert(
    symbol: str,
    interval: str,
    pattern: Dict,
    user_config: Optional[Dict] = None
) -> bool:
    """Convenience function to send alert using global instance"""
    return await alert_sender.send_rejection_pattern_alert(
        symbol,
        interval,
        pattern,
        user_config
    )


async def initialize_alert_sender():
    """Initialize the global alert sender"""
    await alert_sender.start()
    await alert_sender.test_connection()


async def shutdown_alert_sender():
    """Shutdown the global alert sender"""
    await alert_sender.stop()
