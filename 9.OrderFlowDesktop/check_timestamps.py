import datetime

# Timestamps del feed live de MarginPad
events = [
    1792381263525,  # Más reciente
    1792381256000,
    1792381253102,
    1792380085219,
    1792379754739
]

now_ts = 1792381400000  # Aproximado cuando se hizo la consulta

print("Análisis de Latencia - MarginPad Live Feed\n")
print("=" * 60)

now = datetime.datetime.fromtimestamp(now_ts/1000, tz=datetime.timezone.utc)
print(f"Timestamp de consulta: {now}")
print(f"\nÚltimas liquidaciones:\n")

for i, ts in enumerate(events):
    dt = datetime.datetime.fromtimestamp(ts/1000, tz=datetime.timezone.utc)
    diff_seconds = (now_ts - ts) / 1000
    diff_minutes = diff_seconds / 60

    print(f"{i+1}. {dt.strftime('%Y-%m-%d %H:%M:%S')} UTC")
    print(f"   Hace: {diff_seconds:.0f} segundos ({diff_minutes:.1f} minutos)\n")

print("\nCONCLUSIÓN:")
print("- Liquidación más reciente: hace ~2 minutos")
print("- Feed incluye eventos hasta ~30 minutos atrás")
print("- Latencia típica: 1-3 minutos (aceptable)")
