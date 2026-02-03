import json

with open('zones_result.json', 'r') as f:
    data = json.load(f)

if not data.get('success'):
    print('Error:', data.get('error'))
    exit()

zones = data.get('zones', [])
print(f'=== RESUMEN DE SIMULACION DE TRADING ===')
print(f'Symbol: {data.get("symbol")}')
print(f'Interval: {data.get("interval")}m')
print(f'Days: {data.get("days")}')
print(f'Candles: {data.get("candles_count")}')
print(f'Total Zonas Detectadas: {len(zones)}')
print()

# Calcular metricas
wins = [z for z in zones if z.get('trade_result') == 'WIN']
losses = [z for z in zones if z.get('trade_result') == 'LOSS']
total_pnl_r = sum(z.get('trade_pnl_r', 0) for z in zones)
avg_bars_to_close = sum(z.get('bars_to_close', 0) for z in zones) / len(zones) if zones else 0

# Desglose por direccion
up_zones = [z for z in zones if z.get('breakout_direction') == 'UP']
down_zones = [z for z in zones if z.get('breakout_direction') == 'DOWN']

up_wins = len([z for z in up_zones if z.get('trade_result') == 'WIN'])
down_wins = len([z for z in down_zones if z.get('trade_result') == 'WIN'])

print(f'=== RESULTADOS DE TRADING ===')
print(f'Wins: {len(wins)} ({100*len(wins)/len(zones):.1f}%)')
print(f'Losses: {len(losses)} ({100*len(losses)/len(zones):.1f}%)')
print(f'P&L Total (R): {total_pnl_r:.1f}R')
print(f'Promedio velas para cerrar: {avg_bars_to_close:.1f}')
print()
print(f'=== DESGLOSE POR DIRECCION ===')
print(f'UP (LONG): {len(up_zones)} trades, {up_wins} wins ({100*up_wins/len(up_zones) if up_zones else 0:.1f}%)')
print(f'DOWN (SHORT): {len(down_zones)} trades, {down_wins} wins ({100*down_wins/len(down_zones) if down_zones else 0:.1f}%)')
print()

# Zonas con mejor R multiple
reached_2r = len([z for z in zones if z.get('reached_2r')])
reached_3r = len([z for z in zones if z.get('reached_3r')])
print(f'=== ALCANCE DE OBJETIVOS ===')
print(f'Alcanzaron 2R: {reached_2r} ({100*reached_2r/len(zones):.1f}%)')
print(f'Alcanzaron 3R: {reached_3r} ({100*reached_3r/len(zones):.1f}%)')
print()

# Top 5 mejores zonas
sorted_zones = sorted(zones, key=lambda z: z.get('r_multiple', 0), reverse=True)[:5]
print(f'=== TOP 5 MEJORES R-MULTIPLES ===')
for i, z in enumerate(sorted_zones, 1):
    print(f'{i}. Zone {z.get("id")[-4:]}: {z.get("r_multiple", 0):.1f}R | {z.get("breakout_direction")} | Score: {z.get("trading_score", 0):.0f}')

# Top 5 peores zonas
sorted_losses = sorted([z for z in zones if z.get('trade_result') == 'LOSS'], key=lambda z: z.get('r_multiple', 0))[:5]
if sorted_losses:
    print()
    print(f'=== TOP 5 PEORES TRADES (LOSSES) ===')
    for i, z in enumerate(sorted_losses, 1):
        print(f'{i}. Zone {z.get("id")[-4:]}: {z.get("r_multiple", 0):.1f}R | {z.get("breakout_direction")} | Score: {z.get("trading_score", 0):.0f}')

# Estadisticas adicionales
print()
print(f'=== ESTADISTICAS ADICIONALES ===')
print(f'Promedio R ganado (wins): {sum(z.get("r_multiple", 0) for z in wins)/len(wins) if wins else 0:.2f}R')
print(f'Score promedio: {sum(z.get("trading_score", 0) for z in zones)/len(zones):.1f}')

# Distribucion por score
high_score = len([z for z in zones if z.get('trading_score', 0) >= 90])
mid_score = len([z for z in zones if 70 <= z.get('trading_score', 0) < 90])
low_score = len([z for z in zones if z.get('trading_score', 0) < 70])
print(f'Score >= 90: {high_score} ({100*high_score/len(zones):.1f}%)')
print(f'Score 70-89: {mid_score} ({100*mid_score/len(zones):.1f}%)')
print(f'Score < 70: {low_score} ({100*low_score/len(zones):.1f}%)')
