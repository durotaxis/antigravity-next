from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Optional


def _extract_explicit_date(text: str) -> Optional[str]:
    m = re.search(
        r"(?P<y>\d{4})\s*(?:年|[./-])\s*(?P<m>\d{1,2})\s*(?:月|[./-])\s*(?P<d>\d{1,2})\s*(?:日)?",
        text,
    )
    if not m:
        return None
    year = int(m.group("y"))
    month = int(m.group("m"))
    day = int(m.group("d"))
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return None
    return f"{year:04d}-{month:02d}-{day:02d}"


def infer_date_from_filename(image_path: Path) -> Optional[str]:
    m = re.search(r"(\d{4})(\d{2})(\d{2})[-_]\d{6}", image_path.name)
    if not m:
        return None
    y, mo, d = m.groups()
    return f"{y}-{mo}-{d}"


def extract_run_date(text: str, image_path: Path) -> str:
    explicit = _extract_explicit_date(text)
    if explicit:
        return explicit

    fallback = infer_date_from_filename(image_path)
    if fallback:
        try:
            ref_date = datetime.strptime(fallback, "%Y-%m-%d")
        except ValueError:
            ref_date = datetime.fromtimestamp(image_path.stat().st_mtime)
    else:
        ref_date = datetime.fromtimestamp(image_path.stat().st_mtime)

    # 2月12日 or 2 / 12 (year omitted in screenshot UI)
    m = re.search(r"(?P<m>\d{1,2})\s*(?:月|/)\s*(?P<d>\d{1,2})\s*(?:日)?", text)
    if m:
        month = int(m.group("m"))
        day = int(m.group("d"))
        if not (1 <= month <= 12 and 1 <= day <= 31):
            return fallback or ""

        # If OCR month is ahead of reference month, it is likely a previous-year run.
        year = ref_date.year - 1 if month > ref_date.month else ref_date.year
        return f"{year:04d}-{month:02d}-{day:02d}"
    return fallback or ""


def extract_time_range(text: str) -> str:
    m = re.search(
        r"(?P<sh>[01]?\d|2[0-3])\s*(?:時|:)\s*(?P<sm>[0-5]\d)\s*(?:分)?\s*(?:[~\-〜ー一]?\s*)"
        r"(?P<eh>[01]?\d|2[0-3])\s*(?:時|:)\s*(?P<em>[0-5]\d)",
        text,
    )
    if m:
        return f"{int(m.group('sh')):02d}:{m.group('sm')}-{int(m.group('eh')):02d}:{m.group('em')}"

    times = re.findall(r"([01]?\d|2[0-3]):([0-5]\d)", text)
    if len(times) >= 2:
        t1 = f"{int(times[0][0]):02d}:{times[0][1]}"
        t2 = f"{int(times[1][0]):02d}:{times[1][1]}"
        return f"{t1}-{t2}"
    return ""


def extract_steps(text: str) -> str:
    # Prefer values near shoe/icon OCR noise ('$' is commonly recognized from the shoe icon).
    icon_hits = re.findall(r"[$¥]\s*(\d{1,3}(?:,\d{3})+)", text)
    if icon_hits:
        values = [int(x.replace(",", "")) for x in icon_hits]
        filtered = [v for v in values if 200 <= v <= 50000]
        if filtered:
            return str(filtered[0])

    comma_nums = re.findall(r"\b\d{1,3}(?:,\d{3})+\b", text)
    if comma_nums:
        values = [int(x.replace(",", "")) for x in comma_nums]
        filtered = [v for v in values if 200 <= v <= 50000]
        if filtered:
            # OCR variants may include a spurious prefixed digit (e.g. 85,501 vs 5,501).
            return str(min(filtered))

    plain_nums = re.findall(r"\b\d{4,6}\b", text)
    values = [int(x) for x in plain_nums if 200 <= int(x) <= 50000]
    return str(max(values)) if values else ""


def extract_active_time(text: str) -> str:
    # 1) Japanese explicit duration: 1時間04分07秒 / 64分07秒
    hms = re.search(r"(\d{1,2})\s*(?:時間|時)\s*([0-5]?\d)\s*分\s*([0-5]?\d)\s*秒", text)
    if hms:
        return f"{int(hms.group(1)):02d}:{int(hms.group(2)):02d}:{int(hms.group(3)):02d}"

    ms = re.search(r"(\d{1,3})\s*分\s*([0-5]?\d)\s*秒", text)
    if ms:
        return f"{int(ms.group(1)):02d}:{int(ms.group(2)):02d}"

    # 2) Colon format with hours (from split table cumulative time): 1:04:07
    hms_colon = re.findall(r"\b([0-9]{1,2}):([0-5]\d):([0-5]\d)\b", text)
    if hms_colon:
        best_h, best_m, best_s = max(
            ((int(h), int(m), int(s)) for h, m, s in hms_colon),
            key=lambda x: (x[0] * 3600 + x[1] * 60 + x[2]),
        )
        return f"{best_h:02d}:{best_m:02d}:{best_s:02d}"

    # 3) Fallback: MM:SS (short runs)
    mmss = re.findall(r"\b([0-9]{1,3}):([0-5]\d)\b", text)
    if not mmss:
        return ""
    best_m, best_s = max(((int(mm), int(ss)) for mm, ss in mmss), key=lambda x: (x[0], x[1]))
    return f"{best_m:02d}:{best_s:02d}"


def extract_distance_km(text: str) -> str:
    km_values = re.findall(r"\b(\d+(?:\.\d+)?)\s*km\b", text, flags=re.IGNORECASE)
    if not km_values:
        return ""
    values = [float(v) for v in km_values]
    return f"{max(values):.2f}"


def extract_heart_rate_bpm(text: str) -> str:
    m = re.search(r"\b(\d{2,3})\s*bpm\b", text, flags=re.IGNORECASE)
    return m.group(1) if m else ""


def extract_pace_per_km(text: str) -> str:
    m = re.search(r"\b([0-2]?\d:[0-5]\d)\s*/\s*km\b", text, flags=re.IGNORECASE)
    if not m:
        return ""
    mm, ss = m.group(1).split(":")
    return f"{int(mm):02d}:{ss}"
