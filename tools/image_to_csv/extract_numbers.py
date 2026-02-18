#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Extract running metrics from screenshot images and export to CSV.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Optional

import pytesseract

from io_utils import collect_images, write_csv
from metrics_builder import build_run_metrics
from models import RunMetrics
from ocr_adapter import detect_tesseract_cmd, run_ocr


def extract_metrics(
    image_path: Path,
    language: str,
    tessdata_dir: Optional[Path],
    fast_mode: bool = False,
) -> RunMetrics:
    text = run_ocr(
        image_path,
        language=language,
        tessdata_dir=tessdata_dir,
        fast_mode=fast_mode,
    )
    return build_run_metrics(image_path, text)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract running metrics from screenshot image(s) to CSV.",
    )
    parser.add_argument(
        "inputs",
        nargs="+",
        help="Input image file(s) and/or directory path(s).",
    )
    parser.add_argument(
        "-o",
        "--output",
        default="running_metrics.csv",
        help="Output CSV path (default: running_metrics.csv)",
    )
    parser.add_argument(
        "-l",
        "--language",
        default="jpn+eng",
        help="Tesseract language(s), e.g. jpn+eng, eng",
    )
    parser.add_argument(
        "--tesseract-cmd",
        default="",
        help="Path to tesseract.exe",
    )
    parser.add_argument(
        "--tessdata-dir",
        default="",
        help="Path to tessdata directory (optional)",
    )
    parser.add_argument(
        "--fast",
        action="store_true",
        help="Fast mode: single OCR pass per image (lower accuracy, much faster).",
    )
    args = parser.parse_args()

    tesseract_cmd = args.tesseract_cmd or detect_tesseract_cmd()
    if not tesseract_cmd:
        raise SystemExit(
            "tesseract.exe not found. Install Tesseract or pass --tesseract-cmd."
        )
    pytesseract.pytesseract.tesseract_cmd = tesseract_cmd

    tessdata_dir: Optional[Path] = None
    if args.tessdata_dir:
        tessdata_dir = Path(args.tessdata_dir)
    else:
        local_tess = Path(__file__).parent / "tessdata"
        if local_tess.exists():
            tessdata_dir = local_tess

    images = collect_images(args.inputs)
    if not images:
        raise SystemExit("No image files found in input paths.")

    rows: list[RunMetrics] = []
    for image_path in images:
        metrics = extract_metrics(
            image_path,
            language=args.language,
            tessdata_dir=tessdata_dir,
            fast_mode=args.fast,
        )
        rows.append(metrics)
        print(
            f"[OK] {metrics.file_name} | date={metrics.run_date} | steps={metrics.steps} | "
            f"active={metrics.active_time} | dist={metrics.distance_km}km | "
            f"hr={metrics.heart_rate_bpm}bpm | pace={metrics.pace_per_km}/km"
        )

    output_path = Path(args.output)
    write_csv(rows, output_path)
    print(f"Saved CSV: {output_path}")


if __name__ == "__main__":
    main()
