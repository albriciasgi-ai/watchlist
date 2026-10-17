#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Analiza la cobertura real de footprints históricos en el cloud collector.
"""

import httpx
import asyncio
import sys
import io
from datetime import datetime, timedelta

# Fix encoding
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

CLOUD_URL = "https://p01--altagracia--rxv8nrbhxln9.code.run"
TIMEOUT = 120.0


async def analyze_symbol_coverage(symbol: str, test_periods: list):
    """Analiza cobertura de un símbolo probando diferentes períodos."""
    print(f"\n{'='*80}")
    print(f"📊 Analizando cobertura de {symbol}")
    print(f"{'='*80}")

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        results = []

        for hours in test_periods:
            try:
                print(f"\n⏳ Probando últimas {hours} horas...")

                response = await client.get(
                    f"{CLOUD_URL}/api/footprints/{symbol}",
                    params={"hours": hours, "interval": "1"}
                )

                if response.status_code == 200:
                    data = response.json()
                    count = data.get("count", 0)
                    oldest = data.get("oldest")
                    newest = data.get("newest")

                    if count > 0:
                        oldest_dt = datetime.fromtimestamp(oldest / 1000)
                        newest_dt = datetime.fromtimestamp(newest / 1000)

                        expected = hours * 60  # 1 footprint por minuto
                        coverage = (count / expected) * 100

                        print(f"   ✅ Footprints: {count:,} / {expected:,} esperados ({coverage:.1f}%)")
                        print(f"   📅 Rango: {oldest_dt.strftime('%Y-%m-%d %H:%M')} → {newest_dt.strftime('%Y-%m-%d %H:%M')}")

                        # Detectar gaps grandes
                        duration_actual = (newest - oldest) / (1000 * 60)  # minutos
                        if duration_actual > hours * 60 * 1.2:
                            print(f"   ⚠️  WARNING: Rango de tiempo mayor al esperado (posibles gaps)")

                        results.append({
                            "hours": hours,
                            "count": count,
                            "expected": expected,
                            "coverage": coverage,
                            "oldest": oldest_dt,
                            "newest": newest_dt
                        })
                    else:
                        print(f"   ❌ Sin datos para este período")
                        results.append({
                            "hours": hours,
                            "count": 0,
                            "expected": hours * 60,
                            "coverage": 0
                        })
                else:
                    print(f"   ❌ Error HTTP: {response.status_code}")

            except httpx.TimeoutException:
                print(f"   ⏱️  TIMEOUT (>120s) - Período muy grande")
            except Exception as e:
                print(f"   ❌ Error: {e}")

        return results


async def main():
    """Función principal."""
    print("=" * 80)
    print("ANÁLISIS DE COBERTURA HISTÓRICA - CLOUD FOOTPRINT COLLECTOR")
    print("=" * 80)
    print(f"URL: {CLOUD_URL}")
    print()

    # Períodos a probar (en horas)
    test_periods = [
        1,      # 1 hora (60 fps esperados)
        6,      # 6 horas (360 fps)
        24,     # 1 día (1,440 fps)
        168,    # 1 semana (10,080 fps)
        720,    # 1 mes (43,200 fps)
        2160,   # 3 meses (129,600 fps)
    ]

    # Probar BTCUSDT (símbolo principal)
    results = await analyze_symbol_coverage("BTCUSDT", test_periods)

    # Resumen
    print(f"\n{'='*80}")
    print("📈 RESUMEN DE COBERTURA")
    print(f"{'='*80}")

    if results:
        print("\nPeríodo          Footprints    Esperados    Cobertura")
        print("─" * 60)

        for r in results:
            if r["count"] > 0:
                print(f"{r['hours']:>4} horas     {r['count']:>10,}    {r['expected']:>10,}    {r['coverage']:>6.1f}%")
            else:
                print(f"{r['hours']:>4} horas     {'Sin datos':>10}    {r['expected']:>10,}    {'0.0%':>7}")

        # Determinar rango real de datos disponibles
        max_coverage = max([r for r in results if r["count"] > 0], key=lambda x: x["hours"], default=None)

        if max_coverage and max_coverage["count"] > 0:
            print(f"\n✅ Datos disponibles desde: {max_coverage['oldest'].strftime('%Y-%m-%d %H:%M')}")
            print(f"✅ Última actualización: {max_coverage['newest'].strftime('%Y-%m-%d %H:%M')}")

            days_coverage = (max_coverage["newest"] - max_coverage["oldest"]).days
            print(f"✅ Días de cobertura: ~{days_coverage} días")

            if max_coverage["coverage"] < 80:
                print(f"\n⚠️  WARNING: Cobertura menor al 80% sugiere gaps significativos")
        else:
            print("\n❌ No hay datos históricos disponibles")

    print()


if __name__ == "__main__":
    asyncio.run(main())
