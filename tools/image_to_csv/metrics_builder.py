from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

from models import RunMetrics
from parser import (
    extract_active_time,
    extract_distance_km,
    extract_heart_rate_bpm,
    extract_pace_per_km,
    extract_run_date,
    extract_steps,
    extract_time_range,
)


def parse_int_str(value: str) -> Optional[int]:
    if not value:
        return None
    raw = value.replace(",", "").strip()
    if not raw.isdigit():
        return None
    return int(raw)


def parse_float_str(value: str) -> Optional[float]:
    if not value:
        return None
    try:
        return float(value.strip())
    except Exception:
        return None


def active_time_to_hhmmss(active_time: str) -> str:
    m = re.match(r"^\s*(\d{1,3}):([0-5]\d)\s*$", active_time or "")
    if not m:
        return ""
    minutes = int(m.group(1))
    seconds = int(m.group(2))
    return f"00:{minutes:02d}:{seconds:02d}"


def pace_to_speed_kmh(pace_per_km: str) -> str:
    m = re.match(r"^\s*(\d{1,2}):([0-5]\d)\s*$", pace_per_km or "")
    if not m:
        return ""
    pace_min = int(m.group(1)) + int(m.group(2)) / 60.0
    if pace_min <= 0:
        return ""
    speed = 60.0 / pace_min
    return f"{speed:.1f}"


def derive_stride_cm(distance_km: str, steps: str) -> str:
    d = parse_float_str(distance_km)
    s = parse_int_str(steps)
    if not d or not s or s <= 0:
        return ""
    stride = (d * 100000.0) / float(s)
    return f"{stride:.2f}"


def derive_avg_cadence(steps: str, active_time: str) -> str:
    s = parse_int_str(steps)
    if s is None or s <= 0:
        return ""
    m = re.match(r"^\s*(\d{1,3}):([0-5]\d)\s*$", active_time or "")
    if not m:
        return ""
    minutes = int(m.group(1)) + int(m.group(2)) / 60.0
    if minutes <= 0:
        return ""
    return str(int(round(s / minutes)))


def build_run_metrics(image_path: Path, text: str) -> RunMetrics:
    run_date = extract_run_date(text, image_path)
    steps = extract_steps(text)
    active_time = extract_active_time(text)
    distance_km = extract_distance_km(text)
    heart_rate_bpm = extract_heart_rate_bpm(text)
    pace_per_km = extract_pace_per_km(text)

    total_time = active_time_to_hhmmss(active_time)
    avg_speed = pace_to_speed_kmh(pace_per_km)
    avg_stride_cm = derive_stride_cm(distance_km, steps)
    avg_cadence = derive_avg_cadence(steps, active_time)

    return RunMetrics(
        file_name=image_path.name,
        run_date=run_date,
        run_time_range=extract_time_range(text),
        steps=steps,
        active_time=active_time,
        distance_km=distance_km,
        heart_rate_bpm=heart_rate_bpm,
        pace_per_km=pace_per_km,
        date=run_date,
        step_count=steps,
        total_distance_km=distance_km,
        total_time=total_time,
        avg_heart_rate=heart_rate_bpm,
        max_heart_rate="",
        avg_speed=avg_speed,
        max_speed="",
        avg_stride_cm=avg_stride_cm,
        max_stride_cm="",
        avg_cadence=avg_cadence,
        max_cadence="",
    )
