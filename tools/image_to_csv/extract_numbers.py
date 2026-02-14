#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Extract running metrics from screenshot images and export to CSV.

Target fields:
- run_date (YYYY-MM-DD)
- run_time_range (HH:MM-HH:MM)
- steps
- active_time (MM:SS)
- distance_km
- heart_rate_bpm
- pace_per_km (MM:SS)
"""

from __future__ import annotations

import argparse
import csv
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable, Optional

import pytesseract
from PIL import Image, ImageEnhance, ImageOps


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".gif", ".webp"}


@dataclass
class RunMetrics:
    file_name: str
    run_date: str
    run_time_range: str
    steps: str
    active_time: str
    distance_km: str
    heart_rate_bpm: str
    pace_per_km: str

    def to_row(self) -> dict[str, str]:
        return {
            "file_name": self.file_name,
            "run_date": self.run_date,
            "run_time_range": self.run_time_range,
            "steps": self.steps,
            "active_time": self.active_time,
            "distance_km": self.distance_km,
            "heart_rate_bpm": self.heart_rate_bpm,
            "pace_per_km": self.pace_per_km,
        }


def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("〜", "~").replace("～", "~")
    text = text.replace("／", "/").replace("：", ":")
    return text


def preprocess_variants(image: Image.Image) -> list[Image.Image]:
    gray = ImageOps.grayscale(image)
    up = gray.resize((gray.width * 2, gray.height * 2))
    hi_contrast = ImageEnhance.Contrast(up).enhance(2.0)
    sharp = ImageEnhance.Sharpness(hi_contrast).enhance(1.8)
    return [image, gray, hi_contrast, sharp]


def run_ocr(
    image_path: Path,
    language: str,
    tessdata_dir: Optional[Path],
    fast_mode: bool = False,
) -> str:
    image = Image.open(image_path)
    variants = preprocess_variants(image)
    ocr_texts: list[str] = []
    configs = ["--oem 3 --psm 6", "--oem 3 --psm 11"]
    if fast_mode:
        variants = [variants[0]]
        configs = ["--oem 3 --psm 6"]

    for variant in variants:
        for cfg in configs:
            if tessdata_dir:
                cfg = f"--tessdata-dir {tessdata_dir.as_posix()} {cfg}"
            try:
                txt = pytesseract.image_to_string(variant, lang=language, config=cfg)
                if txt and txt.strip():
                    ocr_texts.append(txt)
            except Exception:
                continue

    return normalize_text("\n".join(ocr_texts))


def infer_date_from_filename(image_path: Path) -> Optional[str]:
    m = re.search(r"(\d{4})(\d{2})(\d{2})[-_]\d{6}", image_path.name)
    if not m:
        return None
    y, mo, d = m.groups()
    return f"{y}-{mo}-{d}"


def extract_run_date(text: str, image_path: Path) -> str:
    date_match = re.search(r"(?P<m>\d{1,2})\s*月\s*(?P<d>\d{1,2})\s*日", text)
    fallback = infer_date_from_filename(image_path)

    if date_match:
        month = int(date_match.group("m"))
        day = int(date_match.group("d"))
        year = None
        if fallback:
            year = int(fallback[:4])
        if year is None:
            year = datetime.fromtimestamp(image_path.stat().st_mtime).year
        return f"{year:04d}-{month:02d}-{day:02d}"

    return fallback or ""


def extract_time_range(text: str) -> str:
    # ex: 19時08分~19時35分 / 19時08分19時35分
    m = re.search(
        r"(?P<sh>[01]?\d|2[0-3])\s*(?:時|:)\s*(?P<sm>[0-5]\d)\s*(?:分)?\s*(?:[~\-〜ー−]?\s*)"
        r"(?P<eh>[01]?\d|2[0-3])\s*(?:時|:)\s*(?P<em>[0-5]\d)",
        text,
    )
    if m:
        return f"{int(m.group('sh')):02d}:{m.group('sm')}-{int(m.group('eh')):02d}:{m.group('em')}"

    # fallback: first two HH:MM values in text
    times = re.findall(r"([01]?\d|2[0-3]):([0-5]\d)", text)
    if len(times) >= 2:
        t1 = f"{int(times[0][0]):02d}:{times[0][1]}"
        t2 = f"{int(times[1][0]):02d}:{times[1][1]}"
        return f"{t1}-{t2}"
    return ""


def extract_steps(text: str) -> str:
    # Prefer comma-separated values (e.g., 4,310)
    comma_nums = re.findall(r"\b\d{1,3}(?:,\d{3})+\b", text)
    if comma_nums:
        values = [int(x.replace(",", "")) for x in comma_nums]
        filtered = [v for v in values if 200 <= v <= 200000]
        if filtered:
            return str(max(filtered))

    plain_nums = re.findall(r"\b\d{4,6}\b", text)
    values = [int(x) for x in plain_nums if 200 <= int(x) <= 200000]
    return str(max(values)) if values else ""


def extract_active_time(text: str) -> str:
    # ex: 26分28秒
    m = re.search(r"(\d{1,3})\s*分\s*([0-5]?\d)\s*秒", text)
    if m:
        return f"{int(m.group(1)):02d}:{int(m.group(2)):02d}"

    mmss = re.findall(r"\b([0-9]{1,3}):([0-5]\d)\b", text)
    if not mmss:
        return ""
    # Active time tends to be the largest elapsed MM:SS in this screen.
    best_m, best_s = max(((int(m), int(s)) for m, s in mmss), key=lambda x: (x[0], x[1]))
    return f"{best_m:02d}:{best_s:02d}"


def extract_distance_km(text: str) -> str:
    km_values = re.findall(r"\b(\d+(?:\.\d+)?)\s*km\b", text, flags=re.IGNORECASE)
    if not km_values:
        return ""
    values = [float(v) for v in km_values]
    return f"{max(values):.2f}"


def extract_heart_rate_bpm(text: str) -> str:
    m = re.search(r"\b(\d{2,3})\s*bpm\b", text, flags=re.IGNORECASE)
    if m:
        return m.group(1)
    return ""


def extract_pace_per_km(text: str) -> str:
    # ex: 6:25/km
    m = re.search(r"\b([0-2]?\d:[0-5]\d)\s*/\s*km\b", text, flags=re.IGNORECASE)
    if m:
        mm, ss = m.group(1).split(":")
        return f"{int(mm):02d}:{ss}"
    return ""


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
    return RunMetrics(
        file_name=image_path.name,
        run_date=extract_run_date(text, image_path),
        run_time_range=extract_time_range(text),
        steps=extract_steps(text),
        active_time=extract_active_time(text),
        distance_km=extract_distance_km(text),
        heart_rate_bpm=extract_heart_rate_bpm(text),
        pace_per_km=extract_pace_per_km(text),
    )


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
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "file_name",
                "run_date",
                "run_time_range",
                "steps",
                "active_time",
                "distance_km",
                "heart_rate_bpm",
                "pace_per_km",
            ],
        )
        writer.writeheader()
        for row in rows:
            writer.writerow(row.to_row())


def detect_tesseract_cmd() -> Optional[str]:
    candidates = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    return None


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
