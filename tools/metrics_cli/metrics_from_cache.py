#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
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


def fmt_hms(seconds: int) -> str:
    td = timedelta(seconds=max(0, int(seconds)))
    total_seconds = int(td.total_seconds())
    h = total_seconds // 3600
    m = (total_seconds % 3600) // 60
    s = total_seconds % 60
    return f"{h:02d}:{m:02d}:{s:02d}"


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

        # Track maximum stride length (cm) if both distance and steps are present
        if steps > 0 and math.isfinite(dist) and dist > 0:
            stride_cm = float(dist) * 100.0 / steps
            if stride_cm > max_stride_cm:
                max_stride_cm = stride_cm

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

    avg_stride = round((sum_distance_m * 100.0 / sum_steps), 1) if sum_steps > 0 and sum_distance_m > 0 else 0.0

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

        metrics: Optional[ComputedMetrics] = None
        if raw_path.exists():
            buckets = read_json(raw_path)
            if isinstance(buckets, list):
                metrics = compute_from_raw_buckets(date, buckets)
        if metrics is None and intraday_path.exists():
            points = read_json(intraday_path)
            if isinstance(points, list):
                metrics = compute_from_intraday_points(date, points)

        if metrics is None:
            if args.skip_missing:
                print(f"Warning: No cache found for {date}, skipping...")
                continue
            else:
                raise SystemExit(f"No cache found for {date} in {cache_dir}")
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
