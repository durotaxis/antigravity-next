# Cleanup Notes

## Legacy Import Cleanup Candidates

These items are still present for safety, but became lower-priority after the new OCR-date-driven `+ SELECT` auto-link flow was added.

- `POST /api/runs/:runId/import-selected`
  - old fixed-run-date image import route
  - no longer used by the current `+ SELECT IMAGE FROM PHONE LINK` UI flow

- `imageService.importSelectedFiles(filenames, runId, options)`
  - service path that imports and links directly to the provided `runId`
  - now mostly a legacy/debug compatibility path

- `public/script.js`
  - old `+ SELECT` assumptions tied to `RUN ANALYZER` date should be reviewed for further cleanup
  - current modal flow still stores `currentRunDate`, but the new API no longer uses it as the link target

## Cleanup Rule

Do not remove these paths blindly.

Before deletion, confirm:

- no remaining UI path calls the fixed-run-date import route
- no debug/manual workflow still depends on the old API
- the new OCR-date auto-link flow is stable in real use
