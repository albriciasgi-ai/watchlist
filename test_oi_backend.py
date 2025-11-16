#!/usr/bin/env python3
"""
Test Open Interest backend endpoint
"""
import requests
import json
from datetime import datetime

def test_oi(symbol="BTCUSDT", interval="15", days=30):
    url = f"http://localhost:8000/api/open-interest/{symbol}?interval={interval}&days={days}"

    print(f"Testing: {url}")
    print("-" * 80)

    try:
        response = requests.get(url)
        data = response.json()

        print(f"Success: {data.get('success')}")
        print(f"Data points: {len(data.get('data', []))}")
        print(f"Days requested: {data.get('days_requested')}")
        print(f"Days fetched: {data.get('days_fetched')}")
        print(f"API requests: {data.get('api_requests_made', 'N/A')}")
        print()

        if data.get('data'):
            oi_data = data['data']

            print("First 5 data points:")
            for i, item in enumerate(oi_data[:5]):
                ts = item['timestamp']
                dt = datetime.fromtimestamp(ts / 1000)
                oi = item['openInterest']
                print(f"  {i}: {dt.isoformat()} | TS: {ts} | OI: {oi}")

            print()
            print("Last 5 data points:")
            for i, item in enumerate(oi_data[-5:]):
                ts = item['timestamp']
                dt = datetime.fromtimestamp(ts / 1000)
                oi = item['openInterest']
                print(f"  {i}: {dt.isoformat()} | TS: {ts} | OI: {oi}")

            print()
            print("Checking for variability:")
            oi_values = [item['openInterest'] for item in oi_data]
            unique_values = len(set(oi_values))
            print(f"  Total points: {len(oi_values)}")
            print(f"  Unique OI values: {unique_values}")
            print(f"  Min OI: {min(oi_values)}")
            print(f"  Max OI: {max(oi_values)}")
            print(f"  Range: {max(oi_values) - min(oi_values)}")

            # Check deltas
            deltas = []
            for i in range(1, len(oi_values)):
                delta = oi_values[i] - oi_values[i-1]
                if delta != 0:
                    deltas.append(delta)

            print(f"  Non-zero deltas: {len(deltas)} out of {len(oi_values)-1}")
            if deltas:
                print(f"  Sample deltas: {deltas[:10]}")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_oi()
