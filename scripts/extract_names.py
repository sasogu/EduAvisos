#!/usr/bin/env python3
"""Extrae texto de un PDF y heurísticamente detecta nombres de alumnos.

Uso:
    python3 scripts/extract_names.py path/al/pdf.pdf

Genera en la raíz:
 - verReport.txt      (texto completo extraído)
 - alumnos.csv        (lista de nombres, una columna)
 - alumnos.json       (lista de nombres en JSON)

Notas:
 - El script aplica varias heurísticas y produce también un archivo con
   candidatos para que revises manualmente.
 - Ajusta las regexp si el formato del PDF es distinto.
"""
import sys
import re
import json
from pathlib import Path

import pdfplumber


def extract_text(pdf_path: Path) -> str:
    texts = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            txt = page.extract_text() or ""
            texts.append(txt)
    return "\n".join(texts)


def candidate_names_from_text(text: str):
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    candidates = []

    # Heurística 1: líneas con formato Apellido, Nombre
    for l in lines:
        if "," in l:
            parts = [p.strip() for p in l.split(",")]
            if len(parts) >= 2 and all(parts):
                # reconstruir Nombre Apellido
                name = parts[1] + " " + parts[0]
                candidates.append(name)

    # Heurística 2: líneas con 2-4 palabras que parezcan nombres (inician en mayúscula)
    name_word = r"[A-ZÁÉÍÓÚÑ][a-záéíóúñü]+"
    pattern = re.compile(rf"^{name_word}(?:[ \-]{name_word}){{1,3}}$")
    for l in lines:
        # limpiar caracteres comunes que no son nombres
        clean = re.sub(r"[••·\*\t]+", " ", l)
        # quitar números y notas al final: ' - 9.5' o '(12)'
        clean = re.sub(r"\s*[-–—].*$", "", clean)
        clean = re.sub(r"\(.*?\)$", "", clean).strip()
        if pattern.match(clean):
            candidates.append(clean)

    # Heurística 3: buscar dentro de tablas (separadas por múltiples espacios)
    for l in lines:
        parts = re.split(r"\s{2,}", l)
        for p in parts:
            p = p.strip()
            if pattern.match(p):
                candidates.append(p)

    # Normalizar: quitar duplicados manteniendo orden
    seen = set()
    final = []
    for c in candidates:
        if c not in seen:
            seen.add(c)
            final.append(c)
    return final


def main():
    if len(sys.argv) < 2:
        print("Uso: python3 scripts/extract_names.py path/al/pdf.pdf")
        sys.exit(1)

    pdf_path = Path(sys.argv[1])
    if not pdf_path.exists():
        print(f"No existe: {pdf_path}")
        sys.exit(2)

    root = Path(__file__).resolve().parents[1]
    text_out = root / "verReport.txt"

    print(f"Extrayendo texto de {pdf_path} ...")
    text = extract_text(pdf_path)
    text_out.write_text(text, encoding="utf-8")
    print(f"Texto extraído guardado en {text_out}")

    print("Detectando candidatos a nombres...")
    candidates = candidate_names_from_text(text)

    # Si no hay candidatos, entregar algunas líneas útiles para inspección
    if not candidates:
        print("No se hallaron candidatos con las heurísticas. Se guardarán las primeras 200 líneas para inspección.")
        sample = [l for l in text.splitlines() if l.strip()][:200]
        (root / "verReport_sample_lines.txt").write_text("\n".join(sample), encoding="utf-8")
        print("Archivo verReport_sample_lines.txt creado. Revisa el formato para ajustar heurísticas.")
        sys.exit(0)

    # Guardar CSV y JSON
    csv_out = root / "alumnos.csv"
    json_out = root / "alumnos.json"

    csv_out.write_text("\n".join(candidates), encoding="utf-8")
    json_out.write_text(json.dumps(candidates, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"{len(candidates)} candidatos guardados en {csv_out} y {json_out}")
    print("Si faltan nombres o hay falsos positivos, comparte el contenido de verReport.txt o verReport_sample_lines.txt y ajusto las reglas.")


if __name__ == "__main__":
    main()
