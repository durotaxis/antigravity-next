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
  - in the current OCR day-summary flows, this field is treated as a derived metric
  - when both `total_distance_km` and `step_count` are positive, `avg_stride` is recalculated as:
    - `total_distance_km * 100000 / step_count`

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

This route is also reused by the legacy `CLEAR RUN` `Images Reset` mode to restore a date back to cache-derived values after image/OCR artifacts are removed.

### 6.4 Run-signal gate for new-row creation

This route does not blindly create a new row from cache.

When no existing `daily_summary` row exists, creation is gated by explicit running-activity signal checks.

That means cache availability by itself is not always sufficient to create a brand-new day row.

## 7. `POST /api/analyze`

## 6.5 `POST /api/import-tcx` and `POST /api/daily/:date/sync-tcx`

These are the `TCX`-driven summary paths.

### 6.5.1 Source of values

These routes build values from run-based `TCX` minute caches.

Current `TCX` cache model:

- one `COROS` `TCX` file is treated as one run
- run-based minute cache is stored as:
  - `storage/cache/tcx_intraday_YYYY-MM-DD_HHMMSS.json`
- run-based split cache is stored as:
  - `storage/cache/tcx_splits_YYYY-MM-DD_HHMMSS.json`

### 6.5.2 Day-level summary behavior

`daily_summary` remains one row per date.

When `TCX` data exists for a date, the server:

- finds all run-based `TCX` caches for that date
- reads all run minute rows
- recomputes one date-level summary from the combined run rows
- writes the recomputed result back to `daily_summary`

Current run ownership rule:

- a TCX run belongs to its start date
- when a TCX run starts on one date and its `end` is on the next day, the next-day portion still belongs to the start date's run cache and start-date `daily_summary`

This means:

- `TCX` is run-based
- `daily_summary` is still date-based
- same-date multiple runs are recombined before the day row is written

### 6.5.3 Upsert behavior difference

The normal `saveDailySummary` monotonic-max behavior is not used for `TCX` sync.

Instead, `TCX` sync uses exact overwrite semantics for the core summary values.

That means when `TCX` is the chosen source of truth for the date, fields such as:

- `step_count`
- `total_distance_km`
- `total_time`
- `avg_stride`
- `max_stride`
- `hr_avg`
- `hr_max`
- `avg_cadence`
- `max_cadence`
- `avg_speed`
- `max_speed`

are overwritten from the recomputed `TCX` summary, even when that lowers a previously stored value.

### 6.5.4 Message handling

When `TCX` sync changes the core summary values, the server may regenerate the stored advice message using the refreshed summary values plus any linked images.

If regeneration fails, the existing stored message is preserved.

For a newly imported TCX run, run-message generation may also receive complete-rest time windows derived from second-level TCX motion data. Each window contains its start time, end time, duration, first valid heart-rate sample, last valid heart-rate sample, and heart-rate difference. No near-LT or moving-recovery classification is added to this prompt context. If the run is clearly interval training, the comment may use Daniels, Canova, and Norwegian principles as reference frameworks, but it must not assert a named method without sufficient evidence. This affects generated comment text only and does not alter the chart timeline or exact-overwrite summary fields.

The prompt context notes that a single run may contain stops caused by traffic signals or similar circumstances.

The run comment appends next-training advice suited to the current run data, using running theories such as Daniels, Bakken, and Canova as references.

The generated comment does not use technical terminology or theory names and explains the advice in language understandable to the general public.

The most recent saved RUN COMMENT before the current run is attached as comparison context, ordered by run date and `run_id`. Evaluations, observations, and workout suggestions that are substantively the same as the previous comment are omitted; changing only numeric wording does not make a point new.

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
  - on the first OCR-persisted image for the day, existing `avg_stride` is not reused
  - after merged `step_count` and `total_distance_km` are known, recompute from:
    - `total_distance_km * 100000 / step_count`
  - fallback to positive average only when recalculation is not possible
- `hr_max`
  - positive max
- `hr_avg`
  - positive average
  - on the first OCR-persisted image for the day, existing `hr_avg` is not reused
- `max_cadence`
  - positive max
- `avg_cadence`
  - positive average
  - on the first OCR-persisted image for the day, existing `avg_cadence` is not reused
- `avg_speed`
  - positive average
  - on the first OCR-persisted image for the day, existing `avg_speed` is not reused
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
  - on the first OCR-persisted image for the day, existing `avg_stride` is not reused
  - after merged `step_count` and `total_distance_km` are known, recompute from:
    - `total_distance_km * 100000 / step_count`
  - fallback to positive average only when recalculation is not possible
- `hr_max`
  - positive max
- `hr_avg`
  - positive average
  - on the first OCR-persisted image for the day, existing `hr_avg` is not reused
- `avg_cadence`
  - positive average
  - on the first OCR-persisted image for the day, existing `avg_cadence` is not reused
- `max_cadence`
  - positive max
- `avg_speed`
  - positive average
  - on the first OCR-persisted image for the day, existing `avg_speed` is not reused
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

The current legacy `+ SELECT IMAGE FROM PHONE LINK (without SYNC DAILY)` behavior is:

- create or reuse `image_assets`
- run OCR per selected image
- resolve the target run date from OCR per image
- if the OCR-resolved date has no `daily_summary`, attempt cache/FIT reconstruction first
- create `run_images` only for images whose OCR-resolved date has an available `daily_summary`
- allow one import operation to link images to multiple different dates
- report partial success / failure back to the UI

This route is no longer a fixed `RUN ANALYZER`-date image-link import.
It is an OCR-date-driven auto-link route.

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
