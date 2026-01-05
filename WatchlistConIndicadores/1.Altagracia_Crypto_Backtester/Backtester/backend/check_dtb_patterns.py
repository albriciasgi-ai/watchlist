#!/usr/bin/env python3
"""
Script para verificar los patrones Double Top/Bottom almacenados en el backend.
Muestra cuántos patrones hay por mes/trimestre y sus fechas.
"""

import httpx
import json
from datetime import datetime

API_URL = "http://localhost:9000"
SYMBOL = "BTCUSDT"
INTERVAL = "15m"

def format_timestamp(ts):
    """Convierte timestamp de milisegundos a fecha legible"""
    return datetime.fromtimestamp(ts / 1000).strftime('%Y-%m-%d %H:%M:%S')

def check_patterns():
    """Consulta la API para obtener todos los patrones hasta el final"""

    # Solicitar todos los patrones hasta el año 2025 (timestamp muy futuro)
    future_timestamp = int(datetime(2025, 12, 31).timestamp() * 1000)

    print(f"\n{'='*80}")
    print(f"CONSULTANDO PATRONES DOUBLE TOP/BOTTOM - {SYMBOL} {INTERVAL}")
    print(f"{'='*80}\n")

    try:
        response = httpx.post(
            f"{API_URL}/api/double-topbottom/chunk",
            json={
                "symbol": SYMBOL,
                "interval": INTERVAL,
                "upTo": future_timestamp
            },
            timeout=10
        )

        if response.status_code == 200:
            data = response.json()

            if data.get('success'):
                patterns = data.get('patterns', [])
                total = len(patterns)

                print(f"[OK] Total patrones encontrados: {total}\n")

                if total > 0:
                    # Organizar patrones por mes
                    by_month = {}
                    for p in patterns:
                        ts = p.get('secondExtreme', {}).get('timestamp', 0)
                        dt = datetime.fromtimestamp(ts / 1000)
                        month_key = f"{dt.year}-{dt.month:02d}"

                        if month_key not in by_month:
                            by_month[month_key] = []
                        by_month[month_key].append(p)

                    # Mostrar estadísticas por mes
                    print(f"{'Mes':<12} {'Patrones':<10} {'Fecha Inicio':<20} {'Fecha Fin':<20}")
                    print(f"{'-'*12} {'-'*10} {'-'*20} {'-'*20}")

                    for month in sorted(by_month.keys()):
                        patterns_in_month = by_month[month]
                        count = len(patterns_in_month)

                        timestamps = [p['secondExtreme']['timestamp'] for p in patterns_in_month]
                        first_ts = min(timestamps)
                        last_ts = max(timestamps)

                        first_date = format_timestamp(first_ts)
                        last_date = format_timestamp(last_ts)

                        print(f"{month:<12} {count:<10} {first_date:<20} {last_date:<20}")

                    # Mostrar primeros y últimos 3 patrones
                    print(f"\n{'='*80}")
                    print(f"PRIMEROS 3 PATRONES:")
                    print(f"{'='*80}")
                    for i, p in enumerate(patterns[:3]):
                        ts = p['secondExtreme']['timestamp']
                        price = p['levelPrice']
                        ptype = p['type']
                        print(f"{i+1}. {ptype} @ ${price:.2f} - {format_timestamp(ts)}")

                    print(f"\n{'='*80}")
                    print(f"ÚLTIMOS 3 PATRONES:")
                    print(f"{'='*80}")
                    for i, p in enumerate(patterns[-3:]):
                        ts = p['secondExtreme']['timestamp']
                        price = p['levelPrice']
                        ptype = p['type']
                        idx = total - 3 + i + 1
                        print(f"{idx}. {ptype} @ ${price:.2f} - {format_timestamp(ts)}")

                else:
                    print("[WARN] No se encontraron patrones")

            else:
                error = data.get('error', 'Unknown error')
                print(f"[ERROR] API error: {error}")

        else:
            print(f"[ERROR] HTTP {response.status_code}: {response.text}")

    except httpx.ConnectError:
        print(f"[ERROR] No se pudo conectar al backend en {API_URL}")
        print(f"Asegúrate de que el backend esté corriendo en el puerto 9000")
    except Exception as e:
        print(f"[ERROR] {type(e).__name__}: {e}")

    print(f"\n{'='*80}\n")

if __name__ == "__main__":
    check_patterns()
