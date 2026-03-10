# Daily Summary Field Specification

Last updated: 2026-03-10

## 1. Scope

This document describes how `daily_summary` is created and updated, field by field.

It covers:

- table-level persistence behavior
- field-level upsert behavior
- route-specific value selection rules

It does not define UI behavior except where UI actions trigger these write paths.

## 2. Table and Fields

`daily_summary` stores one row per date.

Main fields:

- `date`
- `step_count`
- `total_distance_km`
- `total_time`
- `calories_kcal`
- `max_stride`
- `avg_stride`
- `hr_avg`
- `hr_max`
- `avg_speed`
- `max_speed`
- `avg_cadence`
- `max_cadence`
- `message`
- `created_at`

## 3. Base Persistence Rule

All writes eventually go through `repo.saveDailySummary(data)`.

That function performs:

- insert when the date does not exist
- upsert when the date already exists

## 4. Field-Level Upsert Rules in `saveDailySummary`

These are the final database-level rules.

### 4.1 `step_count`

- Insert:
  - stored as numeric value, or `0` if omitted
- Update:
  - overwrite only when incoming value is `> 0`
  - otherwise keep existing value

### 4.2 `total_distance_km`

- Insert:
  - stored as numeric value, or `0`
- Update:
  - overwrite only when incoming value is `> 0`
  - otherwise keep existing value

### 4.3 `total_time`

- Insert:
  - stored as trimmed text or `NULL`
- Update:
  - `COALESCE(excluded.total_time, total_time)`
  - incoming non-null text replaces existing
  - incoming null leaves existing value unchanged

### 4.4 `calories_kcal`

- Insert:
  - stored as numeric value, or `0`
- Update:
  - overwrite only when incoming value is `> 0`

### 4.5 `max_stride`

- Insert:
  - stored as positive number or `NULL`
- Update:
  - monotonic max
  - overwrite only when incoming value is greater than current value

### 4.6 `avg_stride`

- Insert:
  - stored as positive number or `NULL`
- Update:
  - overwrite when incoming value is `> 0`

### 4.7 `hr_avg`

- Insert:
  - stored as positive number or `NULL`
- Update:
  - overwrite when incoming value is `> 0`

### 4.8 `hr_max`

- Insert:
  - stored as positive number or `NULL`
- Update:
  - monotonic max
  - overwrite only when incoming value is greater than current value

### 4.9 `avg_cadence`

- Insert:
  - stored as positive number or `NULL`
- Update:
  - overwrite when incoming value is `> 0`

### 4.10 `max_cadence`

- Insert:
  - stored as positive number or `NULL`
- Update:
  - monotonic max
  - overwrite only when incoming value is greater than current value

### 4.11 `avg_speed`

- Insert:
  - stored as positive number or `NULL`
- Update:
  - overwrite when incoming value is `> 0`

### 4.12 `max_speed`

- Insert:
  - stored as positive number or `NULL`
- Update:
  - monotonic max
  - overwrite only when incoming value is greater than current value

### 4.13 `message`

- Insert:
  - stored as provided
- Update:
  - `COALESCE(excluded.message, message)`
  - incoming non-null message replaces existing
  - incoming null preserves existing

## 5. Route-Specific Creation and Update Rules

The same fields are written differently depending on the route.

## 5.1 Legacy chart sync path (`GET /api/stride?sync=1`)

This is not a full summary-construction route.

It is a limited fill path used by the legacy screen.

### Source of values

This path derives values from intraday chart data.

### Intended behavior

It can fill missing values on an already-existing `daily_summary` row.

Typical fill candidates:

- `avg_stride`
- `max_stride`
- `hr_avg`
- `hr_max`
- `avg_cadence`
- `max_cadence`
- `avg_speed`
- `max_speed`

### Important limits

- it does not create a new `daily_summary` row when none exists
- it is intended to fill only missing/non-positive fields
- it is not the primary path for `step_count`, `total_distance_km`, or `total_time`

## 6. `POST /api/daily/:date/sync-cache`

This is the cache-driven day summary path.

### 6.1 Source of values

This route builds values from cache-derived metrics:

- `computeDailySummaryFromCache(date)`

### 6.2 Field mapping

- `step_count`
  - from cache
- `total_distance_km`
  - from cache
- `total_time`
  - from cache
- `calories_kcal`
  - from cache
- `avg_stride`
  - from cache
- `max_stride`
  - from cache
- `hr_avg`
  - from cache
- `hr_max`
  - from cache
- `avg_cadence`
  - from cache
- `max_cadence`
  - from cache
- `avg_speed`
  - from cache
- `max_speed`
  - from cache
- `message`
  - not provided in this route

### 6.3 Semantics

This route treats cache as the source of truth for the day-level summary.

In the legacy debug model, this route represents the FIT/JSON side of the day.

### 6.4 Run-signal gate for new-row creation

This route does not blindly create a new row from cache.

When no existing `daily_summary` row exists, creation is gated by explicit running-activity signal checks.

That means cache availability by itself is not always sufficient to create a brand-new day row.

## 7. `POST /api/analyze`

This is the new-screen single-image route.

### 7.1 High-level behavior

This route combines:

- OCR result
- cache metrics
- Google Fit metrics
- existing `daily_summary`

### 7.2 Initial summary fields before merge

For the image being analyzed:

- `summaryStepCount`
  - `pickPositive(result.step_count, cacheMetrics.step_count)`
- `summaryTotalDistanceKm`
  - `pickPositive(result.total_distance_km, cacheMetrics.total_distance_km)`
- `summaryTotalTime`
  - `pickText(result.total_time, cacheMetrics.total_time)`
- `summaryCaloriesKcal`
  - `pickPositive(result.calories_kcal, cacheMetrics.calories_kcal)`

### 7.3 Metric resolution before merge

The route resolves stride, heart rate, cadence, and speed from a mixture of:

- OCR result
- cache metrics
- Google Fit metrics
- existing summary

Important examples:

- `safeMaxStride`
  - OCR max stride
  - else Fit max stride
  - else existing summary max stride
- `safeAvgStride`
  - OCR avg stride
  - else Fit avg stride
  - else existing summary avg stride
- `safeMaxHR`
  - OCR max HR
  - else Fit max HR
  - else existing summary max HR
- `safeAvgHR`
  - OCR avg HR
  - else Fit avg HR
  - else existing summary avg HR

### 7.4 Cadence resolution

`avg_cadence` resolution order is:

- OCR avg cadence
- cache avg cadence
- Fit avg cadence
- cadence derived from `step_count / total_time`
- existing summary avg cadence

`max_cadence` resolution order is:

- Fit max cadence
- cache max cadence
- OCR max cadence
- existing summary max cadence

### 7.5 Speed resolution

`avg_speed` resolution order is:

- OCR avg speed
- derived cache/intraday avg speed
- calculated from OCR distance/time

`max_speed` resolution order is:

- Fit max speed
- OCR max speed

### 7.6 Merge with existing summary

After resolution, same-date values are merged with the existing row:

- `step_count`
  - positive sum
- `total_distance_km`
  - positive sum
- `total_time`
  - time sum
- `max_stride`
  - positive max
- `avg_stride`
  - positive average
- `hr_max`
  - positive max
- `hr_avg`
  - positive average
- `max_cadence`
  - positive max
- `avg_cadence`
  - positive average
- `max_speed`
  - positive max
- `avg_speed`
  - positive average
- `message`
  - preserve existing message at save time, then optionally update asynchronously with generated advice

### 7.7 Semantics

This route is not pure OCR and not pure cache.

It is a merged summary route with same-day accumulation behavior.

It is the primary normal-ingest path for the new screen.

## 8. `POST /api/analyze/batch`

This is the legacy batch persistence path through `persistBatchItem()`.

### 8.1 Source of values

This route uses the batch item OCR payload directly.

Per item:

- `currentStepCount`
- `currentTotalDistanceKm`
- `currentTotalTime`
- `currentCaloriesKcal`
- `currentMaxStride`
- `currentAvgStride`
- `currentHrMax`
- `currentHrAvg`
- `currentAvgCadence`
- `currentMaxCadence`
- `currentAvgSpeed`
- `currentMaxSpeed`

### 8.2 Merge behavior

The route merges each OCR item into the existing day summary as follows:

- `step_count`
  - positive sum
- `total_distance_km`
  - positive sum
- `total_time`
  - time sum
- `calories_kcal`
  - positive sum
- `max_stride`
  - positive max
- `avg_stride`
  - positive average
- `hr_max`
  - positive max
- `hr_avg`
  - positive average
- `avg_cadence`
  - positive average
- `max_cadence`
  - positive max
- `avg_speed`
  - positive average
- `max_speed`
  - positive max
- `message`
  - explicitly `null`

### 8.3 Semantics

This is the OCR-batch accumulation route.

It assumes each processed item contributes to the same day summary unless OCR/fallback date resolution points elsewhere.

In the legacy debug model, this route represents the OCR-side daily aggregation path.

### 8.4 Image-side persistence

The batch path also updates matching `image_assets` rows for the processed filenames.

Current intended image-side rule:

- write the OCR values for that image item
- do not write merged day-summary totals back into `image_assets`

## 9. `POST /api/daily`

This is the manual/debug correction path.

### 9.1 Fields it accepts

This route only writes:

- `date`
- `max_stride`
- `avg_stride`
- `hr_max`
- `hr_avg`
- `message`

### 9.2 Semantics

It is not a full daily-summary reconstruction route.
It is a partial manual patch route.

## 9.1 Legacy `+ SELECT` note

The intended legacy `+ SELECT IMAGE FROM PHONE LINK (without SYNC DAILY)` behavior is:

- create or reuse image/link records
- do not create or update `daily_summary`

This keeps image import separate from OCR-side summary aggregation.

## 10. Advice Update Routes

Advice routes also write back to `daily_summary`.

These routes resolve values first, then save:

- `POST /api/advice`
- `POST /api/advice/gemini`

### 10.1 Resolved fields

These routes resolve and write:

- `step_count`
- `total_distance_km`
- `total_time`
- `max_stride`
- `avg_stride`
- `hr_max`
- `hr_avg`
- `avg_cadence`
- `max_cadence`
- `avg_speed`
- `max_speed`
- `message`

### 10.2 Resolution principle

The advice routes prefer already-saved `daily_summary` first, then cache, then request body fallback.

## 11. Summary of Field Ownership by Route

### 11.1 Cache-oriented route

`/api/daily/:date/sync-cache`

- Owns cache-derived day summary creation/update

### 11.2 Single-image route

`/api/analyze`

- Owns merged single-image ingest with cache/Fit fallback and same-day accumulation

### 11.3 Batch OCR route

`/api/analyze/batch`

- Owns OCR batch accumulation into day summary

### 11.4 Manual patch route

`/api/daily`

- Owns partial/manual field updates

### 11.5 Advice routes

- Own finalized message plus resolved metrics back to the summary

## 12. Practical Notes

- `step_count`, `total_distance_km`, and `total_time` are not globally immutable truths.
  - Their actual persisted values depend on which route wrote last and how that route merged data.
- `message` persists unless overwritten by a non-null incoming message.
- Max fields are generally monotonic at the DB level.
- Avg fields are overwrite-at-save fields, but many routes pre-merge them before calling `saveDailySummary`.

## 13. Known Areas Still Requiring Specification Alignment

- How `CLEAR RUN` should restore or remove `daily_summary` by mode
- Whether cache deletion should remain visible after immediate UI refresh
- How OCR-side `daily_summary` construction should interact with an already-existing FIT/JSON-derived row
- Which fields are owned by FIT/JSON versus OCR when both are present for the same date
