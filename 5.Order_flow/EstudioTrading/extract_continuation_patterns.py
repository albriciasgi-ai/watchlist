#!/usr/bin/env python3
"""
Extrae páginas específicas sobre patrones de continuación
"""
import PyPDF2
import json

def extract_specific_pages(pdf_path, pages_list):
    """Extrae páginas específicas del PDF"""
    extracted = {}

    with open(pdf_path, 'rb') as file:
        reader = PyPDF2.PdfReader(file)

        for page_num in pages_list:
            if 0 < page_num <= len(reader.pages):
                page = reader.pages[page_num - 1]
                text = page.extract_text()
                extracted[page_num] = text

    return extracted

def save_to_markdown(extracted_pages, output_file):
    """Guarda las páginas extraídas en formato markdown"""
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write("# Candlestick Patterns Encyclopedia - Continuation Patterns\n\n")
        f.write("Páginas extraídas sobre patrones de continuación y momentum.\n\n")
        f.write("---\n\n")

        for page_num in sorted(extracted_pages.keys()):
            f.write(f"## Página {page_num}\n\n")
            f.write(extracted_pages[page_num])
            f.write("\n\n---\n\n")

if __name__ == '__main__':
    pdf_path = 'Candlestick Patterns Encyclopedia-comprimido.pdf'

    # Páginas identificadas con patrones de continuación
    relevant_pages = [9, 18, 26, 33, 40, 41, 42, 138, 142, 150]

    # También extraer páginas adyacentes para contexto
    all_pages = []
    for page in relevant_pages:
        # Agregar página anterior y siguiente para contexto
        all_pages.extend([page - 1, page, page + 1])

    # Eliminar duplicados y ordenar
    all_pages = sorted(set(all_pages))
    all_pages = [p for p in all_pages if p > 0]  # Solo páginas válidas

    print(f"[*] Extrayendo {len(all_pages)} paginas del PDF...")
    extracted = extract_specific_pages(pdf_path, all_pages)

    print(f"[+] Extraidas {len(extracted)} paginas exitosamente")

    # Guardar en markdown
    output_file = 'continuation_patterns_extracted.md'
    save_to_markdown(extracted, output_file)

    print(f"[OK] Contenido guardado en: {output_file}")
    print(f"\n[INFO] Paginas extraidas: {all_pages}")
