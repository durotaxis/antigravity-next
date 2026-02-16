# Deprecations

This file tracks legacy code paths that should be removed after migration.

## Rules
- Mark legacy paths with `@deprecated` in code.
- Add one row here when deprecating.
- Remove the row when deletion is completed.
- Run `npm run audit:deprecated` before cleanup.

## Active Entries
| Target | Type | Status | Replacement | Added | Remove By | Notes |
|---|---|---|---|---|---|---|
| `/api/_analyze-vision` | API route contract | Deprecated | `/api/analyze` | 2026-02-13 | 2026-02-20 | Legacy lightbox analyze flow. Remove after old UI migration cleanup. |
| `api.analyzeVision` | Client helper function | Deprecated | direct `/api/analyze` upload flow | 2026-02-13 | 2026-02-20 | Unused in `client/app`; currently commented out as legacy marker. |
| `image_service.extractDateFromFilename` | Utility function | Deprecated | OCR/explicit run date input | 2026-02-13 | 2026-02-20 | Currently not exported/used in ingest path. |

## Source Of Truth
- `tools/metrics_cli` must follow: `C:\work\antigravity-next-clean\tools\metrics_cli`
- If differences exist in this repo, overwrite from the path above.
- `metrics_form_casha.py` is not used as source of truth.

## Test Sources
- Runtime uses no dedicated app test source under `tests/` (directory is currently empty).
- `check-models.js` is retained only for manual Gemini API connectivity/model listing checks.
- `check-db.js` was debug-only DB write/read verification and has been removed.

## Correction Sources
- `backfill_daily_summary_from_cache.js`: rebuilds `daily_summary` metrics from intraday cache.
- `backfill_daily_summary_from_images.js`: backfills `daily_summary` from OCR image assets.
- `backfill_daily_summary_avg_speed.js`: backfills missing `daily_summary.avg_speed`.
- `backfill_daily_summary_cadence.js`: backfills missing cadence fields in `daily_summary`.
- `recompute_daily_summary_avg_speed_from_cache.js`: recomputes average speed from cache for incorrect rows.
- `recompute_daily_summary_stride_from_cache.js`: recomputes stride from cache for incorrect rows.
- `backfill_max_speed.js`: fills missing/zero max speed (cache-first, optional API backfill).
- `backfill_image_assets_avg_speed.js`: fills missing avg speed on image assets.
- `fill_speed_nulls.js`: normalization script to replace NULL speed with 0.
- `add_speed_columns.js`, `add_avg_speed_to_image_assets.js`: one-time schema migration scripts.

## Change History
- 2026-02-13:
  - Restored `GEMINI_RATE_LIMIT_MESSAGE` to user-facing Japanese message.
  - Removed legacy lightbox Analyze button from `public/index.html`.
  - Removed legacy `_analyze-vision` commented client logic from `public/script.js`.
  - Kept legacy route/items tracked only in this document for cleanup visibility.
  - Removed debug-only metric logs (`[Metric Debug]`) from `google_fit_service.js`.
  - Removed debug/test utility `check-db.js`.
  - Added test-source and correction-source documentation in this file.
  - Updated old-screen advice save path (`/api/advice`) to sync metrics from cache even when a cached message already exists.
  - Updated old-screen client send format for stride values from integer rounding to 1-decimal precision.
  - Fixed speed persistence on old-screen import path so `daily_summary.avg_speed/max_speed` are saved during selected-image import.
  - Adjusted max-stride persistence to prioritize intraday-derived measured maximum instead of fallback fill from average stride.
