from __future__ import annotations

from dataclasses import dataclass

CSV_FIELDS = [
    "file_name",
    "run_date",
    "run_time_range",
    "steps",
    "active_time",
    "distance_km",
    "heart_rate_bpm",
    "pace_per_km",
    "date",
    "step_count",
    "total_distance_km",
    "total_time",
    "avg_heart_rate",
    "max_heart_rate",
    "avg_speed",
    "max_speed",
    "avg_stride_cm",
    "max_stride_cm",
    "avg_cadence",
    "max_cadence",
]


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
    date: str
    step_count: str
    total_distance_km: str
    total_time: str
    avg_heart_rate: str
    max_heart_rate: str
    avg_speed: str
    max_speed: str
    avg_stride_cm: str
    max_stride_cm: str
    avg_cadence: str
    max_cadence: str

    def to_row(self) -> dict[str, str]:
        return {k: getattr(self, k) for k in CSV_FIELDS}
