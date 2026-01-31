"""
Script de diagnóstico para encontrar el error 'days' no definido
Ejecutar: python check_days_error.py
"""

import re

def check_file(filepath):
    print(f"\n{'='*60}")
    print(f"Analizando: {filepath}")
    print(f"{'='*60}")

    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    # Buscar funciones y sus parámetros
    current_function = None
    function_params = set()
    local_vars = set()

    problems = []

    for i, line in enumerate(lines, 1):
        # Detectar definición de función
        func_match = re.match(r'^(?:async\s+)?def\s+(\w+)\s*\((.*?)\):', line)
        if func_match:
            current_function = func_match.group(1)
            params_str = func_match.group(2)
            function_params = set(re.findall(r'(\w+)\s*[=:,)]', params_str))
            local_vars = set()
            continue

        # Detectar asignaciones locales (x = ...)
        assign_match = re.match(r'\s+(\w+)\s*=', line)
        if assign_match and current_function:
            local_vars.add(assign_match.group(1))

        # Buscar uso de 'days' que no esté en parámetros ni variables locales
        if 'days' in line and current_function:
            # Ignorar comentarios
            if '#' in line and line.index('#') < line.index('days'):
                continue
            # Ignorar strings
            if '"days"' in line or "'days'" in line:
                continue
            # Ignorar si es parte de otro nombre
            if re.search(r'\w+days|days\w+', line):
                if not re.search(r'(?<!\w)days(?!\w)', line):
                    continue

            # Verificar si 'days' está siendo usado sin estar definido
            if 'days' not in function_params and 'days' not in local_vars:
                # Verificar si es un uso real (no asignación)
                if re.search(r'[^=]=\s*days\b', line) or re.search(r':\s*days\b', line) or re.search(r',\s*days\b', line):
                    problems.append({
                        'line': i,
                        'function': current_function,
                        'code': line.strip(),
                        'params': function_params,
                        'local_vars': local_vars
                    })

    if problems:
        print(f"\n[ERROR] PROBLEMAS ENCONTRADOS:")
        for p in problems:
            print(f"\n  Linea {p['line']} en funcion '{p['function']}':")
            print(f"    Codigo: {p['code']}")
            print(f"    Params disponibles: {p['params']}")
            print(f"    Vars locales: {p['local_vars']}")
    else:
        print("\n[OK] No se encontraron problemas obvios con 'days'")

    return problems

if __name__ == '__main__':
    problems = check_file('main.py')

    if problems:
        print(f"\n{'='*60}")
        print(f"RESUMEN: {len(problems)} problemas potenciales encontrados")
        print(f"{'='*60}")
    else:
        print(f"\n[OK] El archivo parece estar bien.")
        print(f"Si el error persiste, verifica:")
        print(f"  1. Que el servidor se reinició correctamente")
        print(f"  2. Que no hay archivos .pyc con código viejo")
        print(f"  3. Donde exactamente aparece el error (navegador/terminal)")
