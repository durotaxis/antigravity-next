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

## Source Of Truth
- `tools/metrics_cli` must follow: `C:\work\antigravity-next-clean\tools\metrics_cli`
- If differences exist in this repo, overwrite from the path above.
