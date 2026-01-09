#!/usr/bin/env python3
"""
Analiza el PDF de Rayner Teo buscando conceptos de price action y relaciones de velas
"""
import PyPDF2
import json
import re

def search_rayner_keywords(pdf_path):
    """Busca keywords relacionados con price action y relaciones de velas"""

    keywords = [
        # Relaciones de velas
        'candle relationship', 'candle structure', 'candle pattern',
        'bullish candle', 'bearish candle',

        # Conceptos de price action
        'price action', 'market structure', 'trend', 'reversal',
        'continuation', 'momentum', 'breakout', 'rejection',

        # Conceptos específicos de Rayner Teo
        'higher high', 'higher low', 'lower high', 'lower low',
        'swing high', 'swing low', 'trend line', 'support', 'resistance',

        # Estrategias
        'false breakout', 'fakey', 'inside bar', 'pin bar',
        'engulfing', 'doji', 'hammer', 'shooting star',

        # Contexto
        'area of value', 'market condition', 'trending market', 'ranging market'
    ]

    results = {}
    page_keywords = {}

    with open(pdf_path, 'rb') as file:
        reader = PyPDF2.PdfReader(file)
        total_pages = len(reader.pages)

        print(f'[*] Analizando {total_pages} paginas...\n')

        for page_num in range(total_pages):
            try:
                page = reader.pages[page_num]
                text = page.extract_text().lower()

                if not text or len(text) < 50:
                    continue

                # Buscar keywords
                found = []
                for keyword in keywords:
                    if keyword.lower() in text:
                        found.append(keyword)

                if found:
                    page_keywords[page_num + 1] = {
                        'keywords': found,
                        'count': len(found),
                        'snippet': text[:300].replace('\n', ' ')
                    }

            except Exception as e:
                print(f'[!] Error en pagina {page_num + 1}: {str(e)[:50]}')
                continue

        print(f'[+] Encontradas {len(page_keywords)} paginas con contenido relevante\n')

    return page_keywords

def extract_chapter_structure(pdf_path, max_pages=20):
    """Intenta extraer la estructura de capítulos"""
    chapters = []

    with open(pdf_path, 'rb') as file:
        reader = PyPDF2.PdfReader(file)

        for page_num in range(min(max_pages, len(reader.pages))):
            try:
                page = reader.pages[page_num]
                text = page.extract_text()

                # Buscar líneas que parecen títulos de capítulos
                lines = text.split('\n')
                for i, line in enumerate(lines):
                    line = line.strip()

                    # Detectar capítulos (números, todo mayúsculas, etc.)
                    if re.match(r'^(CHAPTER|Chapter|PART|Part)\s+\d+', line, re.IGNORECASE):
                        chapters.append(f"P{page_num+1}: {line}")
                    elif re.match(r'^\d+\.\s+[A-Z]', line) and len(line) < 80:
                        chapters.append(f"P{page_num+1}: {line}")
                    elif line.isupper() and 10 < len(line) < 60 and i < 20:
                        chapters.append(f"P{page_num+1}: {line}")

            except:
                continue

    return chapters

def categorize_pages(page_keywords):
    """Categoriza páginas por tipo de contenido"""
    categories = {
        'trend_structure': [],
        'candle_patterns': [],
        'price_action_basics': [],
        'strategies': [],
        'market_context': []
    }

    for page, data in page_keywords.items():
        keywords = [k.lower() for k in data['keywords']]

        # Estructura de tendencia
        if any(k in keywords for k in ['higher high', 'higher low', 'lower high', 'lower low', 'market structure']):
            categories['trend_structure'].append(page)

        # Patrones de velas
        if any(k in keywords for k in ['pin bar', 'inside bar', 'engulfing', 'doji', 'hammer', 'shooting star']):
            categories['candle_patterns'].append(page)

        # Fundamentos de price action
        if any(k in keywords for k in ['price action', 'candle relationship', 'candle structure']):
            categories['price_action_basics'].append(page)

        # Estrategias
        if any(k in keywords for k in ['false breakout', 'fakey', 'breakout', 'continuation']):
            categories['strategies'].append(page)

        # Contexto de mercado
        if any(k in keywords for k in ['trending market', 'ranging market', 'market condition', 'area of value']):
            categories['market_context'].append(page)

    return categories

if __name__ == '__main__':
    pdf_path = 'Rayner Teo - Price Action Trading Secrets-compressed.pdf'

    print('=' * 70)
    print('RAYNER TEO - PRICE ACTION TRADING SECRETS ANALYZER')
    print('=' * 70 + '\n')

    # 1. Estructura de capítulos
    print('[CHAPTERS] Extrayendo estructura de capitulos...\n')
    chapters = extract_chapter_structure(pdf_path, max_pages=30)
    for ch in chapters[:20]:
        print(f'  {ch}')
    print()

    # 2. Buscar keywords
    page_keywords = search_rayner_keywords(pdf_path)

    # 3. Categorizar
    categories = categorize_pages(page_keywords)

    print('[CATEGORIES] Paginas por categoria:\n')
    for category, pages in categories.items():
        if pages:
            print(f'  {category}: {len(pages)} paginas')
            print(f'    Paginas: {sorted(set(pages))[:10]}')  # Primeras 10
            print()

    # 4. Top páginas con más keywords
    print('[TOP PAGES] Paginas con mas contenido relevante:\n')
    sorted_pages = sorted(page_keywords.items(), key=lambda x: x[1]['count'], reverse=True)
    for page, data in sorted_pages[:15]:
        print(f"  Pagina {page}: {data['count']} keywords encontrados")
        print(f"    Keywords: {', '.join(data['keywords'][:8])}")
        print()

    # 5. Guardar resultados
    output = {
        'total_relevant_pages': len(page_keywords),
        'chapters': chapters,
        'categories': {k: list(set(v)) for k, v in categories.items()},
        'top_pages': [
            {
                'page': page,
                'keywords': data['keywords'],
                'count': data['count']
            }
            for page, data in sorted_pages[:20]
        ]
    }

    with open('rayner_teo_analysis.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print('\n[OK] Resultados guardados en: rayner_teo_analysis.json')
