#!/usr/bin/env python3
"""
Extractor de PDF del resumen de Rayner Teo por partes
Para evitar bloqueos, lee el PDF en secciones
"""
import sys
import PyPDF2
import json

def extract_metadata(pdf_path):
    """Extrae metadata del PDF"""
    with open(pdf_path, 'rb') as file:
        reader = PyPDF2.PdfReader(file)
        return {
            'num_pages': len(reader.pages),
            'metadata': reader.metadata if reader.metadata else {}
        }

def extract_pages_range(pdf_path, start_page, end_page):
    """Extrae un rango de páginas"""
    text = []
    with open(pdf_path, 'rb') as file:
        reader = PyPDF2.PdfReader(file)
        total_pages = len(reader.pages)

        actual_end = min(end_page, total_pages)

        for page_num in range(start_page - 1, actual_end):
            page = reader.pages[page_num]
            page_text = page.extract_text()
            text.append(f"--- PÁGINA {page_num + 1} ---\n{page_text}\n")

    return '\n'.join(text)

def search_keywords(pdf_path, keywords):
    """Busca palabras clave y retorna páginas donde aparecen"""
    results = {}
    with open(pdf_path, 'rb') as file:
        reader = PyPDF2.PdfReader(file)

        for keyword in keywords:
            results[keyword] = []

            for page_num, page in enumerate(reader.pages):
                text = page.extract_text().lower()
                if keyword.lower() in text:
                    results[keyword].append(page_num + 1)

    return results

if __name__ == '__main__':
    pdf_path = r'Price Action Trading Secrets - Resumen Profesional Completo_Claude.pdf'

    print("=" * 80)
    print("EXTRACTOR DE PDF - Rayner Teo Resumen")
    print("=" * 80 + "\n")

    # 1. Metadata
    print("[1] METADATA:")
    metadata = extract_metadata(pdf_path)
    print(f"    Total páginas: {metadata['num_pages']}")
    print()

    # 2. Buscar keywords relevantes
    print("[2] BUSCANDO KEYWORDS RELEVANTES:")
    keywords = [
        'continuation',
        'momentum',
        'inside bar',
        'marubozu',
        'trend',
        'false breakout',
        'breakout',
        'consolidation',
        'flag pattern',
        'pennant',
        'three white soldiers',
        'three black crows'
    ]

    print(f"    Buscando: {', '.join(keywords)}\n")
    keyword_results = search_keywords(pdf_path, keywords)

    for keyword, pages in keyword_results.items():
        if pages:
            print(f"    '{keyword}': encontrado en {len(pages)} páginas -> {pages[:10]}")

    print()

    # 3. Extraer en secciones para evitar bloqueos
    print("[3] MODO DE EXTRACCIÓN:")
    print("    Usa los siguientes comandos para extraer por partes:\n")

    total_pages = metadata['num_pages']
    sections = []
    section_size = 10  # 10 páginas por sección

    for start in range(1, total_pages + 1, section_size):
        end = min(start + section_size - 1, total_pages)
        sections.append((start, end))
        print(f"    python extract_rayner_summary.py {start} {end}")

    print()

    # Si se pasan argumentos de línea de comandos, extraer ese rango
    if len(sys.argv) == 3:
        start = int(sys.argv[1])
        end = int(sys.argv[2])

        print(f"[4] EXTRAYENDO PÁGINAS {start}-{end}:")
        print("-" * 80)
        text = extract_pages_range(pdf_path, start, end)

        # Guardar en archivo SIN imprimir en consola (evita encoding errors)
        output_file = f'rayner_summary_pages_{start}_{end}.txt'
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(text)
        print(f"[OK] Guardado en: {output_file}")
        print(f"    Caracteres extraídos: {len(text)}")

    # Guardar resultados de keywords
    with open('rayner_keywords_results.json', 'w', encoding='utf-8') as f:
        json.dump({
            'metadata': metadata,
            'keyword_results': keyword_results
        }, f, indent=2, ensure_ascii=False)

    print("\n[OK] Resultados de keywords guardados en: rayner_keywords_results.json")
