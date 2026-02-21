# Antigravity Next

## Batch OCR Rules

- Date rule (fixed): `run date = OCR extracted date`, fallback to selected run date (`input.date` / `runId`) when OCR date is missing.
- Stored filename matching rule (fixed): compare with `trim + lowercase` normalization.
- For UI batch execution, only the latest `job_id` response is allowed to update the screen.
- Fallback policy (fixed): when `mode=vision` but file is missing, OCR falls back to `mock` for response preview.
- Persist policy (fixed): batch persist accepts `vision` rows only (`mock` rows are not persisted).
- Note: `POST /api/daily` is for debug/manual correction (explicit `date` write), not the normal ingestion path.
