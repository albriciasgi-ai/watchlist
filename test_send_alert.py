#!/usr/bin/env python3
"""
Script to test sending alerts to the trading bot on port 5000

Usage:
    python test_send_alert.py

This script will:
1. Send a test alert via the backend API
2. Show if the alert was sent successfully
3. Display the alert format that the bot receives
"""

import requests
import sys
import json
from datetime import datetime


def test_via_backend_api():
    """Send test alert via backend API endpoint"""
    print("=" * 70)
    print("🧪 TESTING ALERT SYSTEM")
    print("=" * 70)
    print()

    backend_url = "http://localhost:8000/api/test-alert"

    print("📡 Sending test alert via backend...")
    print(f"   Endpoint: {backend_url}")
    print()

    try:
        response = requests.post(backend_url, timeout=5)

        if response.status_code == 200:
            result = response.json()

            if result.get('success'):
                print("✅ SUCCESS - Test alert sent!")
                print()
                print("📊 Alert Details:")
                print(f"   Pattern: {result.get('pattern')}")
                print(f"   Symbol: {result.get('symbol')}")
                print(f"   Price: ${result.get('price')}")
                print(f"   Confidence: {result.get('confidence')}%")
                print(f"   Target: {result.get('alert_service_url')}")
                print()
                print("Expected format sent to bot:")
                print(f"   [{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [BTCUSDT] ABRIR LONG 45000.50")
                print()
                print("💡 Check your bot logs on port 5000 to confirm receipt!")
                return True
            else:
                print("❌ FAILED - Alert could not be sent")
                print(f"   Message: {result.get('message')}")
                print(f"   Target: {result.get('alert_service_url')}")
                print()
                print("⚠️ Make sure your bot is running on port 5000")
                return False

        else:
            print(f"❌ HTTP Error {response.status_code}")
            print(f"   Response: {response.text}")
            return False

    except requests.exceptions.ConnectionError:
        print("❌ CONNECTION ERROR")
        print()
        print("Cannot connect to backend on http://localhost:8000")
        print()
        print("Please start the backend first:")
        print("   cd WatchlistConIndicadores/backend")
        print("   python -m uvicorn main:app --reload --port 8000")
        return False

    except requests.exceptions.Timeout:
        print("❌ TIMEOUT ERROR")
        print("   Backend took too long to respond")
        return False

    except Exception as e:
        print(f"❌ UNEXPECTED ERROR: {str(e)}")
        return False


def test_direct_to_bot():
    """Send test alert directly to bot (alternative method)"""
    print()
    print("-" * 70)
    print("🔧 ALTERNATIVE: Testing direct connection to bot")
    print("-" * 70)
    print()

    bot_url = "http://localhost:5000/api/alerts"

    test_payload = {
        "message": f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [BTCUSDT] ABRIR LONG 45000.50",
        "timestamp": datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        "symbol": "BTCUSDT",
        "action": "ABRIR LONG",
        "price": 45000.50,
        "confidence": 85.5,
        "interval": "4h",
        "type": "TEST_ALERT",
        "severity": "HIGH",
        "title": "🧪 TEST - BTCUSDT | 4h - Hammer",
        "description": "This is a test alert from test_send_alert.py"
    }

    print("📡 Sending test alert directly to bot...")
    print(f"   Endpoint: {bot_url}")
    print()

    try:
        response = requests.post(bot_url, json=test_payload, timeout=5)

        if response.status_code == 200:
            result = response.json()
            print("✅ SUCCESS - Bot received the alert!")
            print()
            print("📦 Bot Response:")
            print(json.dumps(result, indent=2))
            print()
            print("💡 Your bot is working correctly on port 5000!")
            return True
        else:
            print(f"❌ HTTP Error {response.status_code}")
            print(f"   Response: {response.text}")
            return False

    except requests.exceptions.ConnectionError:
        print("❌ CONNECTION ERROR")
        print()
        print("Cannot connect to bot on http://localhost:5000")
        print()
        print("⚠️ Your bot is not running or not listening on port 5000")
        print()
        print("Please start your trading bot first.")
        return False

    except Exception as e:
        print(f"❌ ERROR: {str(e)}")
        return False


def main():
    """Main test function"""
    print()
    print("🤖 TRADING BOT ALERT SYSTEM TEST")
    print()

    # Test 1: Via backend API (recommended)
    backend_success = test_via_backend_api()

    # Test 2: Direct to bot (fallback)
    print()
    bot_success = test_direct_to_bot()

    # Summary
    print()
    print("=" * 70)
    print("📊 TEST SUMMARY")
    print("=" * 70)
    print()
    print(f"Backend API test: {'✅ PASSED' if backend_success else '❌ FAILED'}")
    print(f"Direct bot test:  {'✅ PASSED' if bot_success else '❌ FAILED'}")
    print()

    if backend_success and bot_success:
        print("🎉 ALL TESTS PASSED - System is ready for production!")
        print()
        print("Next steps:")
        print("1. Configure rejection patterns in the watchlist UI")
        print("2. Enable 'Send Alerts' in pattern settings")
        print("3. Your bot will receive real alerts automatically")
        sys.exit(0)
    elif backend_success and not bot_success:
        print("⚠️ Backend is working, but bot is not reachable")
        print()
        print("Action required:")
        print("- Start your trading bot on port 5000")
        print("- Make sure it's listening for POST /api/alerts")
        sys.exit(1)
    elif not backend_success and bot_success:
        print("⚠️ Bot is working, but backend connection failed")
        print()
        print("Action required:")
        print("- Start the backend server on port 8000")
        print("- cd WatchlistConIndicadores/backend")
        print("- python -m uvicorn main:app --reload --port 8000")
        sys.exit(1)
    else:
        print("❌ BOTH TESTS FAILED")
        print()
        print("Action required:")
        print("1. Start the backend server on port 8000")
        print("2. Start your trading bot on port 5000")
        print("3. Run this test again")
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️ Test interrupted by user")
        sys.exit(1)
