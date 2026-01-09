#!/usr/bin/env python3
"""
PDF Extractor - Analiza PDFs de forma incremental
"""
import sys
import PyPDF2
import json
import re

def extract_pdf_metadata(pdf_path):
    """Extrae metadata básica del PDF"""
    with open(pdf_path, 'rb') as file:
        reader = PyPDF2.PdfReader(file)
        return {
            'num_pages': len(reader.pages),
            'metadata': reader.metadata if reader.metadata else {}
        }

def extract_table_of_contents(pdf_path, max_pages=10):
    """Extrae tabla de contenidos de las primeras páginas"""
    toc = []
    with open(pdf_path, 'rb') as file:
        reader = PyPDF2.PdfReader(file)

        # Buscar en las primeras páginas
        for page_num in range(min(max_pages, len(reader.pages))):
            page = reader.pages[page_num]
            text = page.extract_text()

            # Buscar patrones de TOC (números de página, títulos, etc.)
            lines = text.split('\n')
            for line in lines:
                line = line.strip()
                # Detectar líneas que parecen títulos de capítulos
                if re.search(r'^\d+\..*\d+$', line) or \
                   re.search(r'^[A-Z][^.!?]*[A-Z].*\d+$', line):
                    toc.append(line)

    return toc

def search_patterns(pdf_path, keywords):
    """Busca palabras clave en el PDF y retorna páginas relevantes"""
    results = []
    with open(pdf_path, 'rb') as file:
        reader = PyPDF2.PdfReader(file)

        for page_num, page in enumerate(reader.pages):
            text = page.extract_text().lower()

            # Buscar cada keyword
            found_keywords = []
            for keyword in keywords:
                if keyword.lower() in text:
                    found_keywords.append(keyword)

            if found_keywords:
                # Extraer un snippet alrededor de la primera keyword
                snippet = text[:500] if len(text) > 500 else text
                results.append({
                    'page': page_num + 1,
                    'keywords': found_keywords,
                    'snippet': snippet.replace('\n', ' ')[:200] + '...'
                })

    return results

def extract_page_range(pdf_path, start_page, end_page):
    """Extrae texto de un rango de páginas"""
    text = []
    with open(pdf_path, 'rb') as file:
        reader = PyPDF2.PdfReader(file)

        for page_num in range(start_page - 1, min(end_page, len(reader.pages))):
            page = reader.pages[page_num]
            page_text = page.extract_text()
            text.append(f"--- PAGE {page_num + 1} ---\n{page_text}\n")

    return '\n'.join(text)

def extract_pattern_sections(pdf_path):
    """Extrae secciones específicas sobre patrones"""
    # Patrones de continuación/momentum que queremos encontrar
    continuation_keywords = [
        'continuation', 'momentum', 'trend continuation',
        'bullish continuation', 'bearish continuation',
        'marubozu', 'three white soldiers', 'three black crows',
        'rising three', 'falling three', 'upside gap', 'downside gap',
        'bullish belt', 'bearish belt', 'continuation patterns'
    ]

    print("[*] Buscando patrones de continuacion en el PDF...\n")
    results = search_patterns(pdf_path, continuation_keywords)

    print(f"[+] Encontradas {len(results)} paginas con patrones de continuacion:\n")
    for result in results:
        print(f"[>] Pagina {result['page']}: {', '.join(result['keywords'])}")
        print(f"    Preview: {result['snippet'][:150]}...\n")

    return results

if __name__ == '__main__':
    pdf_path = 'Candlestick Patterns Encyclopedia-comprimido.pdf'

    print("=" * 70)
    print("PDF ANALYZER - Candlestick Patterns Encyclopedia")
    print("=" * 70 + "\n")

    # 1. Metadata
    print("[META] METADATA:")
    metadata = extract_pdf_metadata(pdf_path)
    print(f"   Total de paginas: {metadata['num_pages']}")
    if metadata['metadata']:
        print(f"   Titulo: {metadata['metadata'].get('/Title', 'N/A')}")
        print(f"   Autor: {metadata['metadata'].get('/Author', 'N/A')}")
    print()

    # 2. Tabla de contenidos
    print("[TOC] TABLA DE CONTENIDOS (primeras 10 paginas):")
    toc = extract_table_of_contents(pdf_path, max_pages=10)
    for item in toc[:20]:  # Mostrar solo primeras 20 lineas
        print(f"   {item}")
    print()

    # 3. Buscar patrones de continuacion
    continuation_results = extract_pattern_sections(pdf_path)

    # 4. Guardar resultados
    output = {
        'metadata': metadata,
        'toc': toc,
        'continuation_patterns': continuation_results
    }

    with open('pdf_analysis_results.json', 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print("\n[OK] Resultados guardados en: pdf_analysis_results.json")
    print("\nPara extraer páginas específicas, usa:")
    print("  python extract_pdf_info.py --pages 10-20")
