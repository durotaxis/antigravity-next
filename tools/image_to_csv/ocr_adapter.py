from __future__ import annotations

from pathlib import Path
from typing import Optional
import unicodedata

import pytesseract
from PIL import Image, ImageEnhance, ImageOps


def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
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


def detect_tesseract_cmd() -> Optional[str]:
    candidates = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    return None
