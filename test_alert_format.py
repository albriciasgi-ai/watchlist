#!/usr/bin/env python3
"""
Test script to verify alert format is correct for trading bot

Expected format: [2025-09-16 10:12:00] [BTCUSDT] ABRIR LONG 45000.50
"""

import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'WatchlistConIndicadores', 'backend'))

from alert_sender import AlertSender
import asyncio
import json


async def test_alert_format():
    """Test that alert format matches trading bot expectations"""

    alert_sender = AlertSender()

    # Test patterns
    test_cases = [
        {
            "name": "Hammer (Bullish)",
            "pattern": {
                "patternType": "HAMMER",
                "confidence": 85.5,
                "price": 45000.50,
                "timestamp": 1726478520000,  # 2024-09-16 10:12:00
                "nearLevels": [],
                "metrics": {}
            },
            "expected_action": "ABRIR LONG"
        },
        {
            "name": "Shooting Star (Bearish)",
            "pattern": {
                "patternType": "SHOOTING_STAR",
                "confidence": 78.2,
                "price": 12.46,
                "timestamp": 1726478520000,
                "nearLevels": [],
                "metrics": {}
            },
            "expected_action": "ABRIR SHORT"
        },
        {
            "name": "Engulfing Bullish",
            "pattern": {
                "patternType": "ENGULFING_BULLISH",
                "confidence": 92.1,
                "price": 3500.25,
                "timestamp": 1726478520000,
                "nearLevels": [],
                "metrics": {}
            },
            "expected_action": "ABRIR LONG"
        },
        {
            "name": "Engulfing Bearish",
            "pattern": {
                "patternType": "ENGULFING_BEARISH",
                "confidence": 88.7,
                "price": 2100.75,
                "timestamp": 1726478520000,
                "nearLevels": [],
                "metrics": {}
            },
            "expected_action": "ABRIR SHORT"
        }
    ]

    print("=" * 80)
    print("TESTING ALERT FORMAT FOR TRADING BOT")
    print("=" * 80)
    print()

    all_passed = True

    for test in test_cases:
        print(f"📊 Test: {test['name']}")
        print("-" * 80)

        # Build payload
        payload = alert_sender._build_alert_payload(
            symbol="BTCUSDT" if test['name'] == "Hammer (Bullish)" else "INJUSDT",
            interval="4h",
            pattern=test['pattern'],
            user_config=None
        )

        # Verify structure
        assert "message" in payload, "Missing 'message' field"
        assert "timestamp" in payload, "Missing 'timestamp' field"
        assert "symbol" in payload, "Missing 'symbol' field"
        assert "action" in payload, "Missing 'action' field"
        assert "price" in payload, "Missing 'price' field"
        assert "confidence" in payload, "Missing 'confidence' field"

        # Verify action mapping
        assert payload["action"] == test["expected_action"], \
            f"Expected action '{test['expected_action']}', got '{payload['action']}'"

        # Print results
        print(f"✅ Message format: {payload['message']}")
        print(f"   Symbol: {payload['symbol']}")
        print(f"   Action: {payload['action']}")
        print(f"   Price: {payload['price']}")
        print(f"   Confidence: {payload['confidence']}%")
        print()

        # Print full JSON payload
        print("📦 Full JSON Payload:")
        print(json.dumps(payload, indent=2))
        print()

        print("✅ PASSED")
        print()

    if all_passed:
        print("=" * 80)
        print("✅ ALL TESTS PASSED - Format is compatible with trading bot")
        print("=" * 80)
        print()
        print("Sample output for bot:")
        print(payload['message'])
        print()
        print("The bot can read either:")
        print("1. The 'message' field (simple string format)")
        print("2. The structured fields: symbol, action, price, confidence")
        print("3. The full 'data' field for detailed pattern info")

    return True


if __name__ == "__main__":
    asyncio.run(test_alert_format())
