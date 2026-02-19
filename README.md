# Antigravity Next

## Batch OCR Rules

- Date decision rule (fixed): `UI-specified date > runId > OCR extracted date > fallback`.
- Stored filename matching rule (fixed): compare with `trim + lowercase` normalization.
- For UI batch execution, only the latest `job_id` response is allowed to update the screen.
- Fallback/persist policy (fixed): when `mode=vision` but file is missing, OCR falls back to `mock` and still counts as success.
- To block mock persistence, call `/api/analyze/batch` with `require_vision_for_persist=true`.
