# Current Spec (Adopted)

Last updated: 2026-03-10

## 1. Purpose
- This document is the single source of truth for currently adopted behavior.
- Keep only active rules here. Move discussion/history elsewhere if needed.

## 2. Screen Roles
- New screen (Next UI): normal upload and result viewing.
- Legacy screen: `RUN ANALYZER` (chart/detail) and `BATCH OCR` operations.

## 3. Navigation Rules
- New screen provides two links:
- `Open Run Analyzer`: opens legacy screen with selected date (`?date=YYYY-MM-DD`).
- `Open Batch OCR`: opens legacy screen with selected date and batch section anchor (`#batch-ocr`).
- Legacy screen date initialization priority:
- URL query `date` > saved local date > today.

## 4. Date Rules
- New screen image import (`/api/analyze`):
- OCR extracted date is preferred.
- If OCR date is missing, set `run date` to the user-selected `Run Date (Upload Target)` value.
- Legacy screen date meaning:
- Legacy date is the operation target date (passed from New screen run date via `?date=` in normal flow).
- It is used for viewing target and batch candidate scope.
- Legacy batch persist (`/api/analyze/batch`):
- Run date uses OCR-extracted date first.
- If OCR date is missing, fallback to selected run date (`input.date`/`runId`).
- Legacy batch candidate fetch (`/api/images/candidates`):
- Strict mode: only images already linked to the selected run date.
- No global fallback list.

## 5. Batch OCR Rules
- `LOAD IMAGES` defines target filenames for batch run.
- Checkbox selection is removed from batch image list.
- If no image exists for the selected date, `RUN BATCH` is a normal skip (not an error).
- Candidate order is ascending by `created_at` (oldest -> newest).
- For same-day multiple images, final summary values are effectively last-write-wins.
- For multi-image batch where OCR dates differ, each image is persisted to its own OCR/fallback run date (can update multiple dates in one run).
- Persist accepts `vision` rows only. `mock` rows are returned for preview but not saved.

## 6. Running Data Filter Rules
- `RUN ANALYZER` uses running-only points from Google Fit processing.
- Running condition: `activity.segment == 8` (running) and watch-origin source filter.
- High-heart-rate-only fallback is not used for running classification.

## 7. Performance Notes
- `RUN BATCH` completion UI no longer blocks on heavy refresh after response.
- (Parallel OCR exists in local working change but is not included in the last pushed commit.)

## 8. Out of Scope
- This document does not define long-term architecture choices.
- This document does not include rejected alternatives.

## 9. Debug/Manual API
- `POST /api/daily` is a debug/manual correction path.
- Provided `date` is written directly to `daily_summary.date`.
- This path is not the primary production ingestion flow.

## 10. Normal Ingest Order
- ① Create JSON cache.
- ② Create/Register `daily_summary`.
- ③ Run OCR and update `daily_summary` with OCR results.
