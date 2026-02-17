#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import sqlite3
from dataclasses import asdict, dataclass
from datetime import date as dt_date
from datetime import timedelta
from pathlib import Path
from typing import Any, Iterable, Optional


DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def is_date_string(value: str) -> bool:
    return bool(DATE_RE.match(value.strip()))

def parse_date(value: str) -> dt_date:
    y, m, d = value.split("-")
    return dt_date(int(y), int(m), int(d))

def iter_dates(start: dt_date, end: dt_date) -> Iterable[dt_date]:
    if end < start:
        start, end = end, start
    cur = start
    while cur <= end:
        yield cur
        cur = cur + timedelta(days=1)


def find_repo_root(start: Path) -> Optional[Path]:
    cur = start.resolve()
    for _ in range(8):
        if (cur / "storage" / "cache").is_dir():
            return cur
        if cur.parent == cur:
            break
        cur = cur.parent
    return None


def find_latest_date(cache_dir: Path) -> Optional[str]:
    """Find the most recent date with cache files in the directory."""
    dates: set[str] = set()

    # Scan for raw_buckets_*.json files
    for file_path in cache_dir.glob("raw_buckets_*.json"):
        date_part = file_path.stem.replace("raw_buckets_", "")
        if is_date_string(date_part):
            dates.add(date_part)

    # Scan for intraday_*.json files
    for file_path in cache_dir.glob("intraday_*.json"):
        date_part = file_path.stem.replace("intraday_", "")
        if is_date_string(date_part):
            dates.add(date_part)

    if not dates:
        return None

    # Return the most recent date
    return max(dates)


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def safe_number(value: Any) -> float:
    try:
        num = float(value)
    except (TypeError, ValueError):
        return float("nan")
    return num


def bucket_is_running(bucket: dict[str, Any]) -> bool:
    # Google Fit activity types: 8 = running
    # Some caches contain com.google.activity.segment, others com.google.activity.summary.
    for ds in bucket.get("dataset", []) or []:
        source_id = (ds.get("dataSourceId") or "")
        if "activity.segment" in source_id:
            for p in ds.get("point", []) or []:
                for v in p.get("value", []) or []:
                    if v.get("intVal") == 8:
                        return True

        if "activity.summary" in source_id:
            for p in ds.get("point", []) or []:
                values = p.get("value", []) or []
                if values and values[0].get("intVal") == 8:
                    return True

    return False


def source_is_ticwatch(source_id: str) -> bool:
    src = (source_id or "").lower()
    return (
        "mobvoi" in src
        or "ticwatch" in src
        or "watch" in src
        or "wear" in src
        or "android" in src
        or "heart_rate" in src
    )


def bucket_has_ticwatch_source(bucket: dict[str, Any]) -> bool:
    for ds in bucket.get("dataset", []) or []:
        source_id = (ds.get("dataSourceId") or "")
        if source_is_ticwatch(source_id):
            return True
    return False


@dataclass(frozen=True)
class ComputedMetrics:
    date: str
    source: str
    points: int
    running_points: int
    distance_km: float
    duration: str
    avg_speed_kmh: float
    max_speed_kmh: float
    avg_stride_cm: float
    max_stride_cm: float
    avg_pitch_spm: int
    max_pitch_spm: int
    avg_heart_rate: int
    max_heart_rate: int


def pick_positive(preferred: Any, fallback: Any) -> float:
    a = safe_number(preferred)
    if math.isfinite(a) and a > 0:
        return float(a)
    b = safe_number(fallback)
    if math.isfinite(b) and b > 0:
        return float(b)
    return 0.0


def pick_text(preferred: Any, fallback: Any) -> str:
    a = "" if preferred is None else str(preferred).strip()
    if a:
        return a
    b = "" if fallback is None else str(fallback).strip()
    if b:
        return b
    return "00:00:00"


def load_daily_summary_row(db_path: Path, date: str) -> Optional[dict[str, Any]]:
    if not db_path.exists():
        return None
    conn = sqlite3.connect(str(db_path))
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT
              total_distance_km,
              total_time,
              avg_stride,
              max_stride,
              hr_avg,
              hr_max,
              avg_speed,
              max_speed,
              avg_cadence,
              max_cadence
            FROM daily_summary
            WHERE date = ?
            """,
            (date,),
        )
        row = cur.fetchone()
        if not row:
            return None
        return {
            "total_distance_km": row[0],
            "total_time": row[1],
            "avg_stride": row[2],
            "max_stride": row[3],
            "hr_avg": row[4],
            "hr_max": row[5],
            "avg_speed": row[6],
            "max_speed": row[7],
            "avg_cadence": row[8],
            "max_cadence": row[9],
        }
    finally:
        conn.close()


def apply_screen_merge(metrics: ComputedMetrics, summary: Optional[dict[str, Any]]) -> ComputedMetrics:
    if not summary:
        return metrics
    return ComputedMetrics(
        date=metrics.date,
        source=f"{metrics.source}+screen_merge",
        points=metrics.points,
        running_points=metrics.running_points,
        distance_km=round(pick_positive(summary.get("total_distance_km"), metrics.distance_km), 2),
        duration=pick_text(summary.get("total_time"), metrics.duration),
        avg_speed_kmh=round(pick_positive(summary.get("avg_speed"), metrics.avg_speed_kmh), 1),
        max_speed_kmh=round(pick_positive(summary.get("max_speed"), metrics.max_speed_kmh), 1),
        avg_stride_cm=round(pick_positive(summary.get("avg_stride"), metrics.avg_stride_cm), 2),
        max_stride_cm=round(pick_positive(summary.get("max_stride"), metrics.max_stride_cm), 1),
        avg_pitch_spm=int(round(pick_positive(summary.get("avg_cadence"), metrics.avg_pitch_spm))),
        max_pitch_spm=int(round(pick_positive(summary.get("max_cadence"), metrics.max_pitch_spm))),
        avg_heart_rate=int(round(pick_positive(summary.get("hr_avg"), metrics.avg_heart_rate))),
        max_heart_rate=int(round(pick_positive(summary.get("hr_max"), metrics.max_heart_rate))),
    )


def fmt_hms(seconds: int) -> str:
    td = timedelta(seconds=max(0, int(seconds)))
    total_seconds = int(td.total_seconds())
    h = total_seconds // 3600
    m = (total_seconds % 3600) // 60
    s = total_seconds % 60
    return f"{h:02d}:{m:02d}:{s:02d}"


def parse_hms_to_seconds(hms: str) -> int:
    if not hms:
        return 0
    parts = [p.strip() for p in str(hms).strip().split(":")]
    nums: list[int] = []
    for p in parts:
        if not p:
            return 0
        try:
            nums.append(int(p))
        except ValueError:
            return 0
    if len(nums) == 3:
        return max(0, nums[0] * 3600 + nums[1] * 60 + nums[2])
    if len(nums) == 2:
        return max(0, nums[0] * 60 + nums[1])
    return 0


def compute_derived_from_cache(raw_buckets: list[dict[str, Any]], intraday_points: list[dict[str, Any]]) -> Optional[dict[str, float]]:
    raw_max_speed = 0.0
    raw_avg_speed = 0.0
    raw_max_pitch = 0
    raw_avg_pitch = 0
    raw_points = 0

    if raw_buckets:
        raw_points = len(raw_buckets)
        sum_speed_any = 0.0
        count_speed_any = 0
        sum_pitch_any = 0
        count_pitch_any = 0
        max_speed_any = 0.0
        max_pitch_any = 0

        sum_speed_run = 0.0
        count_speed_run = 0
        sum_pitch_run = 0
        count_pitch_run = 0
        max_speed_run = 0.0
        max_pitch_run = 0

        for bucket in raw_buckets:
            bucket_steps = 0
            bucket_distance = 0.0
            bucket_is_run = False

            for ds in bucket.get("dataset", []) or []:
                source_id = str(ds.get("dataSourceId") or "")
                if "activity.segment" in source_id:
                    for p in ds.get("point", []) or []:
                        for v in p.get("value", []) or []:
                            if v.get("intVal") == 8:
                                bucket_is_run = True

                if "activity.summary" in source_id:
                    for p in ds.get("point", []) or []:
                        values = p.get("value", []) or []
                        if values and values[0].get("intVal") == 8:
                            bucket_is_run = True

                for p in ds.get("point", []) or []:
                    for v in p.get("value", []) or []:
                        if "step_count" in source_id:
                            bucket_steps += int(v.get("intVal") or 0)
                        if "distance" in source_id:
                            bucket_distance += float(v.get("fpVal") or 0)

            if bucket_steps > 0:
                max_pitch_any = max(max_pitch_any, bucket_steps)
                sum_pitch_any += bucket_steps
                count_pitch_any += 1
                if bucket_is_run:
                    max_pitch_run = max(max_pitch_run, bucket_steps)
                    sum_pitch_run += bucket_steps
                    count_pitch_run += 1

            if bucket_distance > 0:
                speed = round(bucket_distance * 0.06, 1)
                if speed > 0:
                    max_speed_any = max(max_speed_any, speed)
                    sum_speed_any += speed
                    count_speed_any += 1
                    if bucket_is_run:
                        max_speed_run = max(max_speed_run, speed)
                        sum_speed_run += speed
                        count_speed_run += 1

        avg_pitch_any = int(round(sum_pitch_any / count_pitch_any)) if count_pitch_any > 0 else 0
        avg_speed_any = round(sum_speed_any / count_speed_any, 1) if count_speed_any > 0 else 0.0
        avg_pitch_run = int(round(sum_pitch_run / count_pitch_run)) if count_pitch_run > 0 else 0
        avg_speed_run = round(sum_speed_run / count_speed_run, 1) if count_speed_run > 0 else 0.0

        raw_max_speed = max_speed_run if max_speed_run > 0 else max_speed_any
        raw_avg_speed = avg_speed_run if avg_speed_run > 0 else avg_speed_any
        raw_max_pitch = max_pitch_run if max_pitch_run > 0 else max_pitch_any
        raw_avg_pitch = avg_pitch_run if avg_pitch_run > 0 else avg_pitch_any

    intraday_avg_speed = 0.0
    intraday_avg_pitch = 0
    intraday_max_speed = 0.0
    intraday_max_pitch = 0
    intraday_points_count = 0

    if intraday_points:
        intraday_points_count = len(intraday_points)
        sum_speed = 0.0
        count_speed = 0
        sum_pitch = 0
        count_pitch = 0

        for p in intraday_points:
            speed = safe_number(p.get("speed"))
            if math.isfinite(speed) and speed > intraday_max_speed:
                intraday_max_speed = float(speed)
            if math.isfinite(speed) and speed > 0:
                sum_speed += float(speed)
                count_speed += 1

            steps = int(p.get("steps") or 0)
            if steps > 0:
                intraday_max_pitch = max(intraday_max_pitch, steps)
                sum_pitch += steps
                count_pitch += 1

        intraday_avg_speed = round(sum_speed / count_speed, 1) if count_speed > 0 else 0.0
        intraday_avg_pitch = int(round(sum_pitch / count_pitch)) if count_pitch > 0 else 0

    if raw_points == 0 and intraday_points_count == 0:
        return None

    if 0 < raw_avg_pitch < 30:
        raw_avg_pitch = 0
    if 0 < raw_max_pitch < 30:
        raw_max_pitch = 0
    if 0 < intraday_avg_pitch < 30:
        intraday_avg_pitch = 0
    if 0 < intraday_max_pitch < 30:
        intraday_max_pitch = 0

    return {
        "json_avg_speed": intraday_avg_speed if intraday_avg_speed > 0 else raw_avg_speed,
        "json_max_speed": round(raw_max_speed, 1) if raw_max_speed > 0 else round(intraday_max_speed, 1),
        "json_avg_pitch": raw_avg_pitch if raw_avg_pitch > 0 else intraday_avg_pitch,
        "json_max_pitch": raw_max_pitch if raw_max_pitch > 0 else intraday_max_pitch,
        "json_points": raw_points if raw_points > 0 else intraday_points_count,
    }


def compute_from_cache_logic(date: str, raw_buckets: list[dict[str, Any]], intraday_points: list[dict[str, Any]]) -> Optional[ComputedMetrics]:
    derived = compute_derived_from_cache(raw_buckets, intraday_points)
    if not derived:
        return None

    out: dict[str, Any] = {
        "step_count": 0,
        "total_distance_km": 0.0,
        "total_time": None,
        "calories_kcal": 0.0,
        "avg_stride_cm": 0.0,
        "max_stride_cm": 0.0,
        "avg_heart_rate": 0,
        "max_heart_rate": 0,
        "avg_speed": float(derived.get("json_avg_speed") or 0),
        "max_speed": float(derived.get("json_max_speed") or 0),
        "avg_cadence": int(derived.get("json_avg_pitch") or 0),
        "max_cadence": int(derived.get("json_max_pitch") or 0),
    }

    if raw_buckets:
        any_totals = {"steps": 0, "distance_m": 0.0, "active_sec": 0, "points_distance": 0}
        run_totals = {"steps": 0, "distance_m": 0.0, "active_sec": 0, "points_distance": 0}

        for bucket in raw_buckets:
            datasets = bucket.get("dataset", []) or []
            if not datasets:
                continue

            bucket_steps = 0
            bucket_distance = 0.0
            bucket_is_run = False

            for ds in datasets:
                dsid = str(ds.get("dataSourceId") or "")
                points = ds.get("point", []) or []
                if not points:
                    continue

                if "activity.segment" in dsid or "activity.summary" in dsid:
                    for p in points:
                        v = (p.get("value") or [{}])[0]
                        t = safe_number(v.get("intVal"))
                        if math.isfinite(t) and int(t) == 8:
                            bucket_is_run = True
                    continue

                if "step_count.delta" in dsid:
                    for p in points:
                        v = (p.get("value") or [{}])[0]
                        n = safe_number(v.get("intVal"))
                        if math.isfinite(n) and n > 0:
                            bucket_steps += int(n)
                    continue

                if "distance.delta" in dsid:
                    for p in points:
                        v = (p.get("value") or [{}])[0]
                        n = safe_number(v.get("fpVal"))
                        if math.isfinite(n) and n > 0:
                            bucket_distance += float(n)
                    continue

                if "calories.expended" in dsid:
                    for p in points:
                        v = (p.get("value") or [{}])[0]
                        n = safe_number(v.get("fpVal"))
                        if math.isfinite(n) and n > 0:
                            out["calories_kcal"] += float(n)
                    continue

            if bucket_steps > 0:
                any_totals["steps"] += bucket_steps
            if bucket_distance > 0:
                any_totals["distance_m"] += bucket_distance
                any_totals["points_distance"] += 1
            if bucket_distance > 0 or bucket_steps > 0:
                any_totals["active_sec"] += 60

            if bucket_is_run:
                if bucket_steps > 0:
                    run_totals["steps"] += bucket_steps
                if bucket_distance > 0:
                    run_totals["distance_m"] += bucket_distance
                    run_totals["points_distance"] += 1
                if bucket_distance > 0 or bucket_steps > 0:
                    run_totals["active_sec"] += 60

        use_run = run_totals["distance_m"] > 0 and run_totals["active_sec"] >= 60
        picked = run_totals if use_run else any_totals

        out["step_count"] = int(round(picked["steps"]))
        out["total_distance_km"] = round(float(picked["distance_m"]) / 1000.0, 2)
        seconds = picked["active_sec"] if picked["active_sec"] > 0 else picked["points_distance"] * 60
        out["total_time"] = fmt_hms(seconds) if seconds > 0 else None

    if intraday_points:
        sum_stride = 0.0
        count_stride = 0
        max_stride = 0.0
        sum_hr = 0.0
        count_hr = 0
        max_hr = 0.0

        for p in intraday_points:
            stride = safe_number(p.get("stride"))
            if math.isfinite(stride) and 0 < stride <= 250:
                stride_val = float(stride)
                sum_stride += stride_val
                count_stride += 1
                max_stride = max(max_stride, stride_val)

            hr = safe_number(p.get("heartRate"))
            if math.isfinite(hr) and hr > 0:
                hr_val = float(hr)
                sum_hr += hr_val
                count_hr += 1
                max_hr = max(max_hr, hr_val)

        out["avg_stride_cm"] = round(sum_stride / count_stride, 1) if count_stride > 0 else 0.0
        out["max_stride_cm"] = round(max_stride, 1) if max_stride > 0 else 0.0
        out["avg_heart_rate"] = int(round(sum_hr / count_hr)) if count_hr > 0 else 0
        out["max_heart_rate"] = int(round(max_hr)) if max_hr > 0 else 0

        if not out["total_time"]:
            out["total_time"] = fmt_hms(len(intraday_points) * 60)

    if out["avg_speed"] <= 0 and out["total_distance_km"] > 0 and out["total_time"]:
        hours = parse_hms_to_seconds(str(out["total_time"])) / 3600.0
        if hours > 0:
            out["avg_speed"] = round(float(out["total_distance_km"]) / hours, 1)

    calories = safe_number(out["calories_kcal"])
    out["calories_kcal"] = round(calories) if math.isfinite(calories) and calories > 0 else 0

    points_count = int(derived.get("json_points") or 0)
    return ComputedMetrics(
        date=date,
        source="cache_logic_js_parity",
        points=points_count,
        running_points=points_count,
        distance_km=round(float(out["total_distance_km"]), 2),
        duration=str(out["total_time"] or "00:00:00"),
        avg_speed_kmh=round(float(out["avg_speed"] or 0), 1),
        max_speed_kmh=round(float(out["max_speed"] or 0), 1),
        avg_stride_cm=round(float(out["avg_stride_cm"] or 0), 2),
        max_stride_cm=round(float(out["max_stride_cm"] or 0), 1),
        avg_pitch_spm=int(out["avg_cadence"] or 0),
        max_pitch_spm=int(out["max_cadence"] or 0),
        avg_heart_rate=int(out["avg_heart_rate"] or 0),
        max_heart_rate=int(out["max_heart_rate"] or 0),
    )


def compute_from_raw_buckets(date: str, buckets: list[dict[str, Any]]) -> ComputedMetrics:
    run_distance_m = 0.0
    run_steps = 0
    run_minutes = 0

    max_speed_kmh = 0.0
    max_pitch_spm = 0
    max_stride_cm = 0.0

    max_heart_rate = 0
    sum_heart_rate = 0
    count_heart_rate = 0

    for bucket in buckets:
        bucket_distance_m = 0.0
        bucket_steps = 0
        bucket_heart_rate = 0

        for ds in bucket.get("dataset", []) or []:
            source_id = (ds.get("dataSourceId") or "")
            for p in ds.get("point", []) or []:
                for v in p.get("value", []) or []:
                    if "distance" in source_id:
                        bucket_distance_m += float(v.get("fpVal") or 0)
                    if "step_count" in source_id:
                        bucket_steps += int(v.get("intVal") or 0)
                    if "heart_rate" in source_id:
                        # Heart rate can be in fpVal or intVal
                        hr = int(v.get("fpVal") or v.get("intVal") or 0)
                        if hr > 0:
                            bucket_heart_rate = hr

        is_run = bucket_is_running(bucket)
        is_ticwatch = bucket_has_ticwatch_source(bucket)
        if is_run and is_ticwatch:
            run_minutes += 1
            run_distance_m += bucket_distance_m
            run_steps += bucket_steps

            if bucket_steps > max_pitch_spm:
                max_pitch_spm = bucket_steps

            # Track maximum stride length (cm) during running buckets
            if bucket_steps > 0 and bucket_distance_m > 0:
                stride_cm = bucket_distance_m * 100.0 / bucket_steps
                if stride_cm > max_stride_cm:
                    max_stride_cm = stride_cm

            # 1-minute bucket assumption: speed(km/h) = distance(m) * 0.06
            if bucket_distance_m > 0:
                speed = round(bucket_distance_m * 0.06, 1)
                if speed > max_speed_kmh:
                    max_speed_kmh = speed

            # Track heart rate during running
            if bucket_heart_rate > 0:
                if bucket_heart_rate > max_heart_rate:
                    max_heart_rate = bucket_heart_rate
                sum_heart_rate += bucket_heart_rate
                count_heart_rate += 1

    # Use TicWatch + Running only. If none, metrics stay at 0.
    use_running = run_minutes > 0 and run_distance_m > 0
    distance_m = run_distance_m if use_running else 0.0
    steps = run_steps if use_running else 0
    minutes = run_minutes if use_running else 0

    distance_km = round(distance_m / 1000.0, 2)
    duration_seconds = int(minutes * 60)
    hours = duration_seconds / 3600.0 if duration_seconds > 0 else 0.0
    avg_speed_kmh = round((distance_km / hours), 1) if hours > 0 and distance_km > 0 else 0.0

    avg_stride_cm = round((distance_m * 100.0 / steps), 1) if steps > 0 and distance_m > 0 else 0.0

    avg_pitch_spm = int(round(steps / minutes)) if minutes > 0 and steps > 0 else 0

    avg_heart_rate = int(round(sum_heart_rate / count_heart_rate)) if count_heart_rate > 0 else 0

    return ComputedMetrics(
        date=date,
        source="raw_buckets",
        points=len(buckets),
        running_points=run_minutes,
        distance_km=distance_km,
        duration=fmt_hms(duration_seconds),
        avg_speed_kmh=avg_speed_kmh,
        max_speed_kmh=round(max_speed_kmh, 1),
        avg_stride_cm=avg_stride_cm,
        max_stride_cm=round(max_stride_cm, 1),
        avg_pitch_spm=avg_pitch_spm,
        max_pitch_spm=max_pitch_spm,
        avg_heart_rate=avg_heart_rate,
        max_heart_rate=max_heart_rate,
    )


def compute_from_intraday_points(date: str, points: list[dict[str, Any]]) -> ComputedMetrics:
    # Processed intraday is already filtered; use what we have.
    max_speed = 0.0
    sum_speed = 0.0
    count_speed = 0

    max_pitch = 0
    sum_pitch = 0
    count_pitch = 0

    sum_distance_m = 0.0
    sum_steps = 0
    max_stride_cm = 0.0
    sum_stride_cm = 0.0
    count_stride_cm = 0

    max_heart_rate = 0
    sum_heart_rate = 0
    count_heart_rate = 0

    points_used = 0
    for p in points:
        # If source is present, keep only TicWatch-derived points.
        source = str(p.get("source") or "").lower()
        if source and not source_is_ticwatch(source):
            continue
        speed = safe_number(p.get("speed"))
        if math.isfinite(speed) and speed > 0:
            max_speed = max(max_speed, float(speed))
            sum_speed += float(speed)
            count_speed += 1

        steps = int(p.get("steps") or 0)
        if steps > 0:
            max_pitch = max(max_pitch, steps)
            sum_pitch += steps
            count_pitch += 1
            sum_steps += steps

        dist = safe_number(p.get("distance"))
        if math.isfinite(dist) and dist > 0:
            sum_distance_m += float(dist)

        # Prefer explicit per-point stride from intraday cache (same source used by app chart/details).
        stride_val = safe_number(p.get("stride"))
        if math.isfinite(stride_val) and 0 < stride_val <= 250:
            stride_cm = float(stride_val)
            if stride_cm > max_stride_cm:
                max_stride_cm = stride_cm
            sum_stride_cm += stride_cm
            count_stride_cm += 1
        elif steps > 0 and math.isfinite(dist) and dist > 0:
            # Fallback only when stride field is unavailable.
            stride_cm = float(dist) * 100.0 / steps
            if stride_cm > max_stride_cm:
                max_stride_cm = stride_cm
            sum_stride_cm += stride_cm
            count_stride_cm += 1

        heart_rate = int(p.get("heartRate") or 0)
        if heart_rate > 0:
            max_heart_rate = max(max_heart_rate, heart_rate)
            sum_heart_rate += heart_rate
            count_heart_rate += 1
        points_used += 1

    avg_speed = round(sum_speed / count_speed, 1) if count_speed > 0 else 0.0
    avg_pitch = int(round(sum_pitch / count_pitch)) if count_pitch > 0 else 0

    # We don't have guaranteed 1-minute buckets here; assume each point is 1 minute if time series is minute-granularity.
    duration_seconds = points_used * 60
    hours = duration_seconds / 3600.0 if duration_seconds > 0 else 0.0
    distance_km = round(sum_distance_m / 1000.0, 2)
    avg_speed_fallback = round((distance_km / hours), 1) if avg_speed <= 0 and hours > 0 and distance_km > 0 else avg_speed

    avg_stride = round((sum_stride_cm / count_stride_cm), 1) if count_stride_cm > 0 else 0.0

    avg_heart_rate = int(round(sum_heart_rate / count_heart_rate)) if count_heart_rate > 0 else 0

    return ComputedMetrics(
        date=date,
        source="intraday",
        points=points_used,
        running_points=points_used,
        distance_km=distance_km,
        duration=fmt_hms(duration_seconds),
        avg_speed_kmh=avg_speed_fallback,
        max_speed_kmh=round(max_speed, 1),
        avg_stride_cm=avg_stride,
        max_stride_cm=round(max_stride_cm, 1),
        avg_pitch_spm=avg_pitch,
        max_pitch_spm=max_pitch,
        avg_heart_rate=avg_heart_rate,
        max_heart_rate=max_heart_rate,
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compute distance/time/speed/stride/pitch from Google Fit JSON cache files."
    )
    parser.add_argument("dates", nargs="*", help="YYYY-MM-DD (one or more)")
    parser.add_argument("--from", dest="date_from", default="", help="Start date YYYY-MM-DD (inclusive)")
    parser.add_argument("--to", dest="date_to", default="", help="End date YYYY-MM-DD (inclusive)")
    parser.add_argument("--cache-dir", default="", help="Cache dir containing raw_buckets_*.json / intraday_*.json")
    parser.add_argument("--daily-db", default="", help="Path to daily.db for screen-logic merge")
    parser.add_argument("--pure-logic", action="store_true", help="Disable daily_summary screen merge")
    parser.add_argument("--skip-missing", action="store_true", help="Skip dates with missing cache files instead of failing")
    parser.add_argument("--json", action="store_true", help="Output JSON only")
    parser.add_argument("--csv", action="store_true", help="Output CSV to stdout")
    parser.add_argument("--output", default="", help="Write output to file instead of stdout")
    args = parser.parse_args()

    if args.json and args.csv:
        raise SystemExit("Choose one: --json or --csv")

    selected_dates: list[str] = []
    if args.dates:
        selected_dates.extend([d.strip() for d in args.dates if d.strip()])

    if args.date_from or args.date_to:
        if not (args.date_from and args.date_to):
            raise SystemExit("Both --from and --to are required together.")
        if not (is_date_string(args.date_from) and is_date_string(args.date_to)):
            raise SystemExit("Invalid --from/--to date format. Use YYYY-MM-DD.")
        for d in iter_dates(parse_date(args.date_from), parse_date(args.date_to)):
            selected_dates.append(d.isoformat())

    # Resolve cache directory early if we need to find the latest date
    cache_dir = Path(args.cache_dir).expanduser().resolve() if args.cache_dir else None
    if cache_dir is None:
        repo_root = find_repo_root(Path.cwd())
        if repo_root is None:
            raise SystemExit("Could not locate repo root (missing storage/cache). Use --cache-dir.")
        cache_dir = repo_root / "storage" / "cache"
    if args.daily_db:
        daily_db = Path(args.daily_db).expanduser().resolve()
    else:
        daily_db = (repo_root / "daily.db") if "repo_root" in locals() else (Path.cwd() / "daily.db")
    if not selected_dates:
        # Auto-detect latest date from cache directory
        latest_date = find_latest_date(cache_dir)
        if latest_date:
            selected_dates = [latest_date]
            print(f"Auto-selected latest date: {latest_date}")
        else:
            date_str = input("Date (YYYY-MM-DD): ").strip()
            if not is_date_string(date_str):
                raise SystemExit(f"Invalid date: {date_str}")
            selected_dates = [date_str]

    # De-dup while preserving order
    deduped: list[str] = []
    seen: set[str] = set()
    for d in selected_dates:
        if d not in seen:
            seen.add(d)
            deduped.append(d)
    selected_dates = deduped

    all_metrics: list[ComputedMetrics] = []
    for date in selected_dates:
        raw_path = cache_dir / f"raw_buckets_{date}.json"
        intraday_path = cache_dir / f"intraday_{date}.json"

        raw_buckets: list[dict[str, Any]] = []
        intraday_points: list[dict[str, Any]] = []
        if raw_path.exists():
            raw_data = read_json(raw_path)
            if isinstance(raw_data, list):
                raw_buckets = raw_data
        if intraday_path.exists():
            intraday_data = read_json(intraday_path)
            if isinstance(intraday_data, list):
                intraday_points = intraday_data

        metrics = compute_from_cache_logic(date, raw_buckets, intraday_points)
        if metrics is None:
            if args.skip_missing:
                print(f"Warning: No cache found for {date}, skipping...")
                continue
            else:
                raise SystemExit(f"No cache found for {date} in {cache_dir}")
        if not args.pure_logic:
            metrics = apply_screen_merge(metrics, load_daily_summary_row(daily_db, date))
        all_metrics.append(metrics)

    if not all_metrics:
        raise SystemExit("No data found for the specified dates.")

    out_file = open(args.output, "w", encoding="utf-8", newline="") if args.output else None
    out = out_file if out_file is not None else os.sys.stdout

    try:
        if args.csv:
            writer = csv.DictWriter(
                out,
                fieldnames=list(asdict(all_metrics[0]).keys()),
                extrasaction="ignore",
            )
            writer.writeheader()
            for m in all_metrics:
                writer.writerow(asdict(m))
            return 0

        if args.json:
            payload = [asdict(m) for m in all_metrics]
            print(json.dumps(payload if len(payload) > 1 else payload[0], ensure_ascii=False), file=out)
            return 0

        for m in all_metrics:
            print(f"date: {m.date}", file=out)
            print(f"source: {m.source} (points={m.points}, running_points={m.running_points})", file=out)
            print(f"distance_km: {m.distance_km}", file=out)
            print(f"duration: {m.duration}", file=out)
            print(f"avg_speed_kmh: {m.avg_speed_kmh}", file=out)
            print(f"max_speed_kmh: {m.max_speed_kmh}", file=out)
            print(f"avg_stride_cm: {m.avg_stride_cm}", file=out)
            print(f"max_stride_cm: {m.max_stride_cm}", file=out)
            print(f"avg_pitch_spm: {m.avg_pitch_spm}", file=out)
            print(f"max_pitch_spm: {m.max_pitch_spm}", file=out)
            print(f"avg_heart_rate: {m.avg_heart_rate}", file=out)
            print(f"max_heart_rate: {m.max_heart_rate}", file=out)
            if m is not all_metrics[-1]:
                print("", file=out)
        return 0
    finally:
        if out_file is not None:
            out_file.close()


if __name__ == "__main__":
    raise SystemExit(main())
