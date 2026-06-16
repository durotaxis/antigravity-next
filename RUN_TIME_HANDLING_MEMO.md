# Run Time Handling Memo

## Purpose

This memo captures the current risky time-handling logic and the minimum
requirements for fixing it.

The issue is not display-time labels like `HH:mm` themselves.
The issue is using `HH:mm` fallback inside chronological/session logic.

## Current Assumptions

- The system input unit is a run.
- Source data is TCX and related run/session-derived data.
- Display grouping is based on run start date.
- Cache filenames and `daily_summary.date` may remain start-date-based.
- Display labels may stay as `HH:mm`.

## Problem Statement

The risky behavior is limited to places where chronological logic or session
membership is reconstructed from time-only values.

These paths can break when a run crosses midnight.

## Fix Targets

### 1. Legacy session membership fallback

- File: [public/script.js](/c:/Users/yuji_/Downloads/public/script.js:1482)
- Function: `pointBelongsToSession()`

Current behavior:

- Uses `bucketStartMs` when present
- Falls back to `point.time`

Required change:

- Session membership must use full timestamp only
- If full timestamp is missing, do not reconstruct from `HH:mm`
- If full timestamp is missing, the point may be excluded from
  session-membership logic rather than guessed

### 2. Time reconstruction helper

- File: [public/script.js](/c:/Users/yuji_/Downloads/public/script.js:1493)
- Function: `pointTimeToMillis()`

Current behavior:

- Reconstructs timestamp from `date + HH:mm`

Required change:

- Remove this from chronological logic
- If kept, restrict it to display-only/helper usage
- Deletion is not required if the function becomes unused by
  run/session chronology

### 3. Chart chronological fallback

- File: [public/script.js](/c:/Users/yuji_/Downloads/public/script.js:1899)
- Function: `chartPointTimeToMillis()`

Current behavior:

- Uses `bucketStartMs` when present
- Falls back to `HH:mm` converted to minute millis

Required change:

- Chart chronological handling must use full timestamp only
- Do not convert `HH:mm` to sortable time for run logic
- If no full timestamp exists, skip chronological comparison rather
  than constructing a pseudo-time

### 4. Gap handling in charts

- File: [public/script.js](/c:/Users/yuji_/Downloads/public/script.js:1911)
- Function: `buildGapAwareChartData()`

Current behavior:

- Gap judgment depends on `chartPointTimeToMillis()`

Required change:

- Gap judgment must use full timestamp only
- If a point has no timestamp, do not apply `HH:mm` fallback
- Missing-timestamp points may remain renderable for display, but must
  not participate in gap calculation

### 5. Intraday sort fallback

- File: [google_fit_service.js](/c:/Users/yuji_/Downloads/google_fit_service.js:657)
- Function: `cleanIntradayData()`

Current behavior:

- Sorts by `bucketStartMs` if present
- Falls back to `time.localeCompare(...)`

Required change:

- Do not use `time` string sort as a chronological fallback
- Sorting must rely on full timestamp fields only
- If a row lacks sortable timestamp fields, preserve original order or
  exclude it from chronology-sensitive processing

## Non-Goals

The following are not problems by themselves and do not need immediate changes:

- Displaying `HH:mm` in tables or labels
- Keeping both `time` and `bucketStartMs` in JSON
- Start-date-based cache filenames
- Start-date-based `daily_summary.date`

## Fix Requirements Summary

1. Chronological logic must use full timestamp fields only
2. `HH:mm` must be treated as display-only
3. No `date + HH:mm` reconstruction inside run/session logic
4. No `HH:mm` fallback for chart gap detection
5. No `HH:mm` fallback for intraday sorting
6. Missing-timestamp rows must not be guessed into chronology

## Priority

1. `pointBelongsToSession()`
2. `pointTimeToMillis()`
3. `chartPointTimeToMillis()`
4. `buildGapAwareChartData()`
5. `cleanIntradayData()`

## Handling Rows Without Full Timestamp

Rows lacking `bucketStartMs`, `timestampMs`, or equivalent full time fields
should not be converted into pseudo-chronological points from `HH:mm`.

Safe options are:

- exclude them from chronology-sensitive logic
- preserve them only for display
- keep original order without claiming true chronological meaning

Unsafe option:

- reconstructing order or session membership from `date + HH:mm`

## Short Conclusion

The root fix is simple:

- keep start-date-based management
- keep `HH:mm` for display if desired
- remove `HH:mm` fallback from chronological logic
- treat full timestamp as the only valid source for time-order decisions
- when full timestamp is missing, prefer omission over guessed chronology
