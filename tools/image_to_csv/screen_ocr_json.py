#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any, Optional

import pytesseract

from extract_numbers import extract_metrics
from ocr_adapter import detect_tesseract_cmd


def to_int(value: str) -> Optional[int]:
    if not value:
        return None
    raw = value.replace(",", "").strip()
    if not raw:
        return None
    try:
        return int(raw)
    except Exception:
        return None


def to_float(value: str) -> Optional[float]:
    if not value:
        return None
    raw = value.strip()
    if not raw:
        return None
    try:
        return float(raw)
    except Exception:
        return None


def to_time(value: str) -> Optional[str]:
    text = (value or "").strip()
    return text if text else None


def to_payload(metrics: Any) -> dict[str, Any]:
    return {
        "date": (metrics.date or "").strip() or None,
        "step_count": to_int(metrics.step_count),
        "total_distance_km": to_float(metrics.total_distance_km),
        "total_time": to_time(metrics.total_time),
        "avg_heart_rate": to_int(metrics.avg_heart_rate),
        "max_heart_rate": to_int(metrics.max_heart_rate),
        "avg_speed": to_float(metrics.avg_speed),
        "max_speed": to_float(metrics.max_speed),
        "avg_stride_cm": to_float(metrics.avg_stride_cm),
        "max_stride_cm": to_float(metrics.max_stride_cm),
        "avg_cadence": to_int(metrics.avg_cadence),
        "max_cadence": to_int(metrics.max_cadence),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract screen OCR metrics as JSON.")
    parser.add_argument("--image", required=True, help="Input image path")
    parser.add_argument("-l", "--language", default="jpn+eng", help="Tesseract language(s)")
    parser.add_argument("--tesseract-cmd", default="", help="Path to tesseract executable")
    parser.add_argument("--tessdata-dir", default="", help="Path to tessdata directory")
    parser.add_argument("--fast", action="store_true", help="Fast mode OCR")
    args = parser.parse_args()

    image_path = Path(args.image)
    if not image_path.exists():
        raise SystemExit(f"Image not found: {image_path}")

    tesseract_cmd = args.tesseract_cmd or detect_tesseract_cmd()
    if not tesseract_cmd:
        raise SystemExit("tesseract executable not found. Install Tesseract or pass --tesseract-cmd.")
    pytesseract.pytesseract.tesseract_cmd = tesseract_cmd

    tessdata_dir: Optional[Path] = None
    if args.tessdata_dir:
        tessdata_dir = Path(args.tessdata_dir)
    else:
        local_tess = Path(__file__).parent / "tessdata"
        if local_tess.exists():
            tessdata_dir = local_tess

    metrics = extract_metrics(
        image_path=image_path,
        language=args.language,
        tessdata_dir=tessdata_dir,
        fast_mode=args.fast,
    )
    print(json.dumps(to_payload(metrics), ensure_ascii=False))


if __name__ == "__main__":
    main()
