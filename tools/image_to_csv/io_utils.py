from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Iterable

from models import CSV_FIELDS, RunMetrics

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".gif", ".webp"}


def collect_images(inputs: Iterable[str]) -> list[Path]:
    files: list[Path] = []
    for item in inputs:
        p = Path(item)
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS:
            files.append(p)
        elif p.is_dir():
            for ext in IMAGE_EXTENSIONS:
                files.extend(p.glob(f"*{ext}"))
    return sorted(set(files))


def write_csv(rows: list[RunMetrics], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow(row.to_row())


def write_json(payload: list[dict], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
