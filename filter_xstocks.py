import json

# Cargar datos
with open('xstocks_found.json', 'r') as f:
    data = json.load(f)

# Filtrar solo xStocks (multiplier != 1)
xstocks = [x for x in data if x.get('multiplier', '1') != '1']

print(f'Total xStocks encontrados: {len(xstocks)}\n')
print(f"{'Symbol':<20} | {'BaseCoin':<10} | {'Multiplier':<25} | Status")
print("-" * 85)

for x in xstocks:
    print(f"{x['symbol']:<20} | {x['baseCoin']:<10} | {x['multiplier']:<25} | {x['status']}")
