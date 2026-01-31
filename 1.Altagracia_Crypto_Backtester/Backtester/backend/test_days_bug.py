"""
Script de prueba independiente para reproducir el bug de 'days'
Ejecutar: python test_days_bug.py
"""
import time
from datetime import datetime, timezone, timedelta

# Colombia es UTC-5
COLOMBIA_TZ = timezone(timedelta(hours=-5))

# Copiar exactamente la config del main.py
BACKTESTING_CONFIG = {
    "1m": {
        "interval": "1",
        "days": 365,
        "subdivisions": {"interval": "1", "count": 1}
    },
    "5m": {
        "interval": "5",
        "days": 1095,
        "subdivisions": {"interval": "1", "count": 5}
    },
    "15m": {
        "interval": "15",
        "days": 730,
        "subdivisions": {"interval": "5", "count": 3}
    },
    "1h": {
        "interval": "60",
        "days": 730,
        "subdivisions": {"interval": "15", "count": 4}
    },
    "4h": {
        "interval": "240",
        "days": 730,
        "subdivisions": {"interval": "60", "count": 4}
    }
}

def test_metadata_generation():
    """Reproduce exactamente el codigo del endpoint bulk-data"""
    print("=" * 60)
    print("TEST: Generacion de metadata (igual que bulk-data endpoint)")
    print("=" * 60)

    try:
        # Simular timeframes_data
        timeframes_data = {
            "1m": {"main": [{"timestamp": 1704067200000}], "subdivisions": [], "open_interest": []},
            "5m": {"main": [{"timestamp": 1704067200000}], "subdivisions": [], "open_interest": []},
            "15m": {"main": [{"timestamp": 1704067200000}], "subdivisions": [], "open_interest": []},
            "1h": {"main": [{"timestamp": 1704067200000}], "subdivisions": [], "open_interest": []},
            "4h": {"main": [{"timestamp": 1704067200000}], "subdivisions": [], "open_interest": []}
        }

        print("\nPASO 1: Calculando timestamps...")
        all_timestamps = []
        for tf_data in timeframes_data.values():
            all_timestamps.extend([c["timestamp"] for c in tf_data["main"]])
        print(f"  OK - {len(all_timestamps)} timestamps")

        print("\nPASO 2: Calculando min/max...")
        if all_timestamps:
            min_ts = min(all_timestamps)
            max_ts = max(all_timestamps)
            print(f"  OK - min_ts={min_ts}, max_ts={max_ts}")

            start_date = datetime.fromtimestamp(min_ts / 1000, tz=COLOMBIA_TZ)
            end_date = datetime.fromtimestamp(max_ts / 1000, tz=COLOMBIA_TZ)
            print(f"  OK - start_date={start_date}, end_date={end_date}")
        else:
            start_date = end_date = datetime.now(COLOMBIA_TZ)

        print("\nPASO 3: Construyendo days_info...")
        days_info = {tf: cfg.get("days", 730) for tf, cfg in BACKTESTING_CONFIG.items()}
        print(f"  OK - days_info = {days_info}")

        print("\nPASO 4: Construyendo metadata dict...")
        metadata = {
            "cached_at": int(time.time() * 1000),
            "cached_at_colombia": datetime.now(COLOMBIA_TZ).strftime("%Y-%m-%d %H:%M:%S"),
            "date_range": {
                "start": start_date.strftime("%Y-%m-%d %H:%M:%S"),
                "end": end_date.strftime("%Y-%m-%d %H:%M:%S"),
                "days_by_timeframe": days_info
            }
        }
        print(f"  OK - metadata construido")
        print(f"  metadata = {metadata}")

        print("\n" + "=" * 60)
        print("RESULTADO: TODO OK - No hay error con 'days'")
        print("=" * 60)
        print("\nEl bug debe estar en OTRO lugar, no en la generacion de metadata.")
        print("Posibles causas:")
        print("  1. El servidor esta corriendo con codigo viejo (reiniciar)")
        print("  2. Hay un archivo .pyc cacheado (borrar __pycache__)")
        print("  3. El error viene del FRONTEND, no del backend")

        return True

    except NameError as e:
        print(f"\n[ERROR] NameError: {e}")
        print("Este es el bug que buscamos!")
        import traceback
        traceback.print_exc()
        return False

    except Exception as e:
        print(f"\n[ERROR] {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    test_metadata_generation()
