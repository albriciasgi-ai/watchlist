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
        self.client = httpx.AsyncClient(timeout=15.0)  # Increased from 5s to 15s for slow bot responses
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
        logger.debug("\n" + "="*80)
        logger.debug(f"📨 [ALERT_SENDER] Preparing to send alert")
        logger.debug("="*80)
        logger.debug(f"   Symbol: {symbol}")
        logger.debug(f"   Interval: {interval}")
        logger.debug(f"   Pattern Type: {pattern.get('patternType', 'UNKNOWN')}")
        logger.debug(f"   Price: ${pattern.get('price', 0):.2f}")
        logger.debug(f"   Confidence: {pattern.get('confidence', 0)}%")

        alert_payload = self._build_alert_payload(
            symbol,
            interval,
            pattern,
            user_config
        )

        logger.debug(f"\n📦 Built alert payload:")
        logger.debug(f"   Pattern String: {alert_payload.get('pattern', 'N/A')}")
        logger.debug(f"   Symbol: {alert_payload.get('symbol', 'N/A')}")
        logger.debug(f"   Price: ${alert_payload.get('price', 0):.2f}")
        logger.debug(f"   Confidence: {alert_payload.get('confidence', 0)}%")

        # Add to queue for asynchronous processing
        logger.debug(f"\n📬 Adding alert to queue for async processing")
        logger.debug(f"   Current queue size: {self.alert_queue.qsize()}")

        await self.alert_queue.put(alert_payload)

        logger.debug(f"   ✅ Alert added to queue successfully")
        logger.debug(f"   New queue size: {self.alert_queue.qsize()}")
        logger.debug("="*80 + "\n")

        return True

    def _build_alert_payload(
        self,
        symbol: str,
        interval: str,
        pattern: Dict,
        user_config: Optional[Dict]
    ) -> Dict:
        """
        Builds the alert payload compatible with trading bot

        Format: {"pattern": "HAMMER (ABRIR LONG)", "symbol": "BTCUSDT", "price": 45000.5, "confidence": 85.5}
        """
        pattern_type = pattern.get('patternType', 'UNKNOWN')
        confidence = pattern.get('confidence', 0)
        price = pattern.get('price', 0)

        # Get trading action and build pattern string
        action = self._get_trading_action(pattern_type)
        pattern_name = self._format_pattern_name(pattern_type)
        pattern_with_action = f"{pattern_name} ({action})"

        # 📝 DEBUG LOG: Building alert payload
        logger.debug(f"[ALERT BUILD] Pattern: {pattern_type} → {pattern_with_action}")
        logger.debug(f"[ALERT BUILD] Symbol: {symbol}, Price: {price}, Confidence: {confidence}%")

        # Simple payload format for trading bot
        payload = {
            "pattern": pattern_with_action,
            "symbol": symbol,
            "price": price,
            "confidence": confidence
        }

        logger.info(f"[ALERT PAYLOAD] {symbol} | {pattern_with_action} @ ${price:.2f} (conf: {confidence}%)")

        return payload

    def _get_trading_action(self, pattern_type: str) -> str:
        """
        Maps rejection pattern to trading action

        Bullish patterns → ABRIR LONG
        Bearish patterns → ABRIR SHORT
        """
        bullish_patterns = {
            "HAMMER",              # Bullish pin bar reversal
            "ENGULFING_BULLISH",   # Bullish engulfing
            "DOJI_DRAGONFLY",      # Bullish doji
            "DOUBLE_BOTTOM",       # Double bottom reversal
            "SWING_LOW"            # Swing low - LONG signal
        }

        bearish_patterns = {
            "SHOOTING_STAR",       # Bearish pin bar reversal
            "ENGULFING_BEARISH",   # Bearish engulfing
            "DOJI_GRAVESTONE",     # Bearish doji
            "DOUBLE_TOP",          # Double top reversal
            "SWING_HIGH"           # Swing high - SHORT signal
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
            "DOJI_GRAVESTONE": "🪦",
            "DOUBLE_BOTTOM": "⏫",
            "DOUBLE_TOP": "⏬",
            "SWING_LOW": "↑",
            "SWING_HIGH": "↓"
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
            "DOJI_GRAVESTONE": "Gravestone Doji",
            "DOUBLE_BOTTOM": "Double Bottom",
            "DOUBLE_TOP": "Double Top",
            "SWING_LOW": "Swing Low",
            "SWING_HIGH": "Swing High"
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

                # 📝 DEBUG LOG: Processing alert from queue
                alert_summary = f"{alert.get('symbol', 'UNKNOWN')} | {alert.get('pattern', 'UNKNOWN PATTERN')}"
                logger.debug(f"[QUEUE] Processing alert: {alert_summary}")

                # Try to send the alert
                success = await self._send_to_service(alert)

                if success:
                    logger.info(f"✅ Alert sent successfully: {alert_summary}")
                else:
                    logger.warning(f"⚠️ Failed to send alert: {alert_summary}")

                # 📝 DEBUG LOG: Add delay between alerts to prevent overwhelming the bot
                await asyncio.sleep(0.5)

            except asyncio.TimeoutError:
                # No alerts in queue, continue
                continue
            except Exception as e:
                logger.error(f"❌ Error processing alert: {str(e)}")
                import traceback
                logger.error(f"[TRACEBACK] {traceback.format_exc()}")

        logger.info("📬 Alert queue processor stopped")

    async def _send_to_service(self, alert: Dict) -> bool:
        """
        Sends alert to the notification service via HTTP POST

        Args:
            alert: Alert payload

        Returns:
            True if successful, False otherwise
        """
        from datetime import datetime
        start_time = datetime.now()

        logger.debug("\n" + "="*80)
        logger.debug(f"🌐 [HTTP] Sending alert to external service (port 5000)")
        logger.debug("="*80)

        if not self.client:
            logger.error("❌ HTTP client not initialized - cannot send alert")
            logger.error("="*80 + "\n")
            return False

        endpoint = f"{self.alert_service_url}/api/watchlist-alert"

        logger.debug(f"📡 HTTP Request Details:")
        logger.debug(f"   Method: POST")
        logger.debug(f"   Endpoint: {endpoint}")
        logger.debug(f"   Headers: Content-Type: application/json")
        logger.debug(f"\n📦 Request Payload:")
        logger.debug(f"{json.dumps(alert, indent=2)}")

        try:
            logger.debug(f"\n⏳ Sending HTTP POST request...")
            response = await self.client.post(endpoint, json=alert)
            duration = (datetime.now() - start_time).total_seconds()

            logger.debug(f"\n📥 HTTP Response received ({duration:.3f}s)")
            logger.debug(f"   Status Code: {response.status_code}")
            logger.debug(f"   Status Text: {response.reason_phrase}")

            if response.status_code == 200:
                logger.debug(f"\n✅ SUCCESS: Alert service accepted the alert")

                try:
                    response_data = response.json()
                    logger.debug(f"   Response Body (JSON):")
                    logger.debug(f"{json.dumps(response_data, indent=2)}")
                except:
                    logger.debug(f"   Response Body (Text): {response.text}")

                logger.info(f"✅ Alert delivered to trading bot at {endpoint}")
                logger.debug("="*80 + "\n")
                return True
            else:
                logger.warning(f"\n⚠️ REJECTED: Alert service returned non-200 status")
                logger.warning(f"   Status Code: {response.status_code}")
                logger.warning(f"   Response Body: {response.text}")
                logger.debug("="*80 + "\n")
                return False

        except httpx.ConnectError as e:
            duration = (datetime.now() - start_time).total_seconds()
            logger.error(f"\n❌ CONNECTION ERROR ({duration:.3f}s)")
            logger.error(f"   Cannot connect to alert service at {self.alert_service_url}")
            logger.error(f"   Error: {str(e)}")
            logger.error(f"\n💡 Troubleshooting:")
            logger.error(f"   1. Check if alert listener is running:")
            logger.error(f"      → python alert_listener.py")
            logger.error(f"   2. Verify port 5000 is not blocked by firewall")
            logger.error(f"   3. Confirm alert service is accessible at {self.alert_service_url}")
            logger.debug("="*80 + "\n")
            return False

        except httpx.TimeoutException as e:
            duration = (datetime.now() - start_time).total_seconds()
            logger.error(f"\n❌ TIMEOUT ERROR ({duration:.3f}s)")
            logger.error(f"   Alert service took too long to respond (>5s)")
            logger.error(f"   Endpoint: {endpoint}")
            logger.error(f"   Error: {str(e)}")
            logger.debug("="*80 + "\n")
            return False

        except Exception as e:
            duration = (datetime.now() - start_time).total_seconds()
            logger.error(f"\n❌ UNEXPECTED ERROR ({duration:.3f}s)")
            logger.error(f"   Exception Type: {type(e).__name__}")
            logger.error(f"   Exception Message: {str(e)}")
            logger.error(f"\n🔍 Stack Trace:")
            import traceback
            logger.error(traceback.format_exc())
            logger.debug("="*80 + "\n")
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
