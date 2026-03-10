# Legacy Screen Specification

Last updated: 2026-03-10

## 1. Scope

This document describes the current legacy screen behavior implemented by `public/index.html`, `public/script.js`, and the related server endpoints in `index.js`, `image_service.js`, `repo.js`, and `image_repo.js`.

The scope of this document is the old screen only.
It does not define the Next.js new screen except where the old screen interacts with shared APIs or shared tables.

## 2. Screen Structure

The legacy screen contains these major areas:

- Main analyzer area
  - Date input
  - `RUN ANALYZER`
  - Advice provider radio buttons
- Result area
  - Daily message
  - Chart
  - Summary card
  - Minute-level table
- Debug area
  - `SYNC FIT JSON`
  - `SYNC DAILY`
  - `CLEAR RUN`
  - `+ SELECT IMAGE FROM PHONE LINK (without SYNC DAILY)`
  - `SAVE HEIGHT`
- Run history area
  - Existing runs list
  - Delete action
- Modal/lightbox area
  - Phone Link image picker modal
  - Image lightbox

## 3. Shared Data Model Used by Legacy Screen

The legacy screen works mainly with these persisted resources:

- `daily_summary`
  - Day-level summary record
- `image_assets`
  - Stored image record plus OCR-derived image metrics
- `run_images`
  - Link table between a run date and image assets
- Google Fit cache files
  - `storage/cache/raw_buckets_YYYY-MM-DD.json`
  - `storage/cache/intraday_YYYY-MM-DD.json`

## 4. Date Semantics

Different controls use different date inputs:

- `dateInput`
  - Main selected date for `RUN ANALYZER`
- `fitSyncFromDateInput`
  - Start date for `SYNC FIT JSON`
- `snapshotDateInput`
  - Start/target date for `SYNC DAILY`
- `clearDateInput`
  - Target date for `CLEAR RUN`

Legacy screen dates are operation target dates.
They are not guaranteed to be OCR-derived dates.

Additional note:

- `CLEAR RUN` is a single-date debug operation
- unlike `SYNC FIT JSON`, it is not defined as a range traversal flow

## 5. RUN ANALYZER

### 5.1 Purpose

`RUN ANALYZER` is the viewing entry point for a selected day.

### 5.2 Main behavior

When the user presses `RUN ANALYZER`, the screen:

- Loads chart data for the selected date
- Loads `daily_summary` for the selected date
- Renders summary values
- Loads linked images
- Loads daily message if present

In addition, when the chart API is called with legacy sync behavior enabled, the screen may fill missing day-summary fields from intraday data for an already-existing `daily_summary` row.

### 5.3 Data sources

The legacy screen combines:

- Google Fit derived chart data
- `daily_summary`
- linked images from `run_images`

### 5.4 Advice behavior

Advice generation is conditional.

The current behavior is:

- Advice is not generated blindly on every view
- Existing `daily_summary.message` is reused when present
- Auto-triggering is guarded by run-like minute data checks

The intent is:

- Before a real run exists, viewing should avoid unnecessary side effects

### 5.5 Summary fill behavior triggered by legacy chart load

The legacy chart path can act as a limited backfill path for an existing day.

The current implementation can fill missing values such as:

- `avg_stride`
- `max_stride`
- `hr_avg`
- `hr_max`
- `avg_cadence`
- `max_cadence`
- `avg_speed`
- `max_speed`

Important limits:

- it does not create a new `daily_summary` row when none exists
- it only fills fields that are currently missing or non-positive
- it does not intentionally overwrite an already-populated field through this path

## 6. SYNC FIT JSON

### 6.1 Purpose

`SYNC FIT JSON` is the Google Fit synchronization path for the legacy screen.

### 6.2 What it does

For each target date, it:

- Reads Google Fit data
- Creates or updates:
  - `raw_buckets_YYYY-MM-DD.json`
  - `intraday_YYYY-MM-DD.json`
- Builds cache-derived daily metrics
- Creates or updates `daily_summary`

### 6.3 What it does not do

It does not import Phone Link images.

It does not create image links.

It does not perform OCR on screenshots.

### 6.4 Role in the system

This is the cache-oriented path.
It establishes the Google Fit / JSON side of the selected day.

## 7. SYNC DAILY

### 7.1 Purpose

`SYNC DAILY` is the image/OCR-oriented daily synchronization path.

### 7.2 Full flow

The button flow is not a single step.
It is a composite operation:

1. Import matching images from Phone Link for the target date
2. Build or reuse image records and date links
3. Run OCR batch on the selected/linked images
4. Persist OCR-driven daily results
5. If no linked image exists, optionally fall back to cache-based `daily_summary` sync

### 7.3 Image import stage

The first stage imports matching files from Phone Link.

This stage:

- Scans Phone Link files
- Matches files by target date token
- Imports matched files through `import-selected`
- Creates or reuses `image_assets`
- Creates or reuses `run_images`
- Does not create or update `daily_summary` in the intended debug flow

### 7.4 OCR batch stage

After import, the screen runs OCR batch for the target date.

This stage:

- Uses the selected OCR mode (`Python OCR` or `Vision OCR`)
- Runs OCR for the candidate images
- Creates or updates OCR metrics on `image_assets`
- Creates or updates `daily_summary`

This stage is responsible for the OCR-side daily-summary persistence.
It should be treated separately from the image-import stage.

Current persistence shape:

- per-image OCR data is written to `image_assets`
- per-day OCR results are merged into `daily_summary`
- the batch summary path currently merges against any already-existing same-date `daily_summary`

Because of that, `SYNC DAILY` can interact with an already-existing cache-derived summary unless the day is explicitly cleared or rebuilt.

### 7.5 Fallback behavior

If OCR batch has no effective image work for the date, the flow may fall back to cache-based `daily_summary` synchronization.

In practice this includes cases where:

- no linked image exists
- batch processing is skipped
- batch total is zero

### 7.6 Role in the system

This is the screenshot/OCR-oriented path.
It is the path that combines imported screenshots with OCR persistence.

## 8. + SELECT IMAGE FROM PHONE LINK (without SYNC DAILY)

### 8.1 Purpose

This is a manual image import tool inside the debug area.

### 8.2 What it does

It allows the user to:

- Open a modal
- Browse Phone Link images
- Select one or more images
- Import them into the application

The import creates or reuses:

- `image_assets`
- `run_images`

The import is an image/link preparation step only.
It is also a single-target-date debug import step.

### 8.3 What it does not do

By itself, it does not run OCR batch aggregation.

By current intended behavior, it also does not create or update `daily_summary`.

In the current debug design, if the selected filenames indicate multiple dates or a date different from the chosen target date, the import should fail instead of mixing multiple dates into one run date.

Operationally, the chosen target date here is the currently selected `RUN ANALYZER` date.

That is why the button text explicitly says:

- `without SYNC DAILY`

### 8.4 Role in the system

This is a manual preparation/import step.
It is not the complete OCR aggregation flow.

## 9. CLEAR RUN

### 9.1 Purpose

`CLEAR RUN` is intended to remove artifacts created by one of the two debug synchronization paths.

### 9.2 Intended modes

The button has two modes:

- `Fit JSON`
- `Daily`

### 9.3 Intended FIT JSON behavior

When `Fit JSON` is selected, the intended behavior is:

- Remove artifacts created by `SYNC FIT JSON`

That means the FIT/JSON side of the selected day, not the image/OCR side.

At minimum, this concerns:

- Google Fit JSON cache files
- cache-derived `daily_summary`

The image/OCR side should remain untouched in this mode.

### 9.4 Intended DAILY behavior

When `Daily` is selected, the intended behavior is:

- Remove artifacts created by `SYNC DAILY`
- Keep the FIT/JSON side intact

That means:

- remove image/OCR side data
- then restore `daily_summary` from the remaining FIT JSON side if needed

The FIT JSON cache itself should remain in place in this mode.

### 9.5 Current state

The current implementation is not yet aligned with the intended clear specification.

The current button exists, but its behavior is still under review.

The currently observed gaps include:

- `FIT JSON` clear can remove cache files, but immediate screen refresh can recreate them
- `DAILY` clear behavior is not yet equivalent to "remove everything created by `SYNC DAILY` and then restore cache-derived summary"

Current observed implementation shape:

- `FIT JSON`
  - deletes cache files for the selected date
  - then the SPA update path can immediately fetch data again
- `DAILY`
  - currently goes through the summary-only delete path
  - therefore current behavior is narrower than the intended "remove all `SYNC DAILY` artifacts"

## 10. SAVE HEIGHT

### 10.1 Purpose

Stores the user's height setting used by legacy-screen-related calculations and prompts.

### 10.2 Scope

This button saves height only.
It does not trigger sync or OCR.

## 11. Run History

### 11.1 Purpose

Shows existing run rows and allows deletion.

### 11.2 Delete behavior

The run history delete path is already implemented.

It is a stronger cleanup path than the current `CLEAR RUN` implementation.

It deletes the run by date/ID through the shared delete endpoint.

This path should not be confused with the intended debug-only semantics of `CLEAR RUN`.

## 12. Lightbox and Image Viewing

The old screen can:

- display linked images
- open the image lightbox

Image unlink/delete from lightbox is currently disabled.

## 13. Current Functional Separation

The intended separation of legacy debug tools is:

- `SYNC FIT JSON`
  - Google Fit / JSON cache side
- `SYNC DAILY`
  - Phone Link import + OCR side
- `+ SELECT IMAGE FROM PHONE LINK`
  - manual image import only
- `CLEAR RUN`
  - cleanup entry point for one of the above two paths

This separation is the current conceptual model for the old screen.

Additional interpretation notes:

- `RUN ANALYZER`
  - is mainly a viewing path
  - but it can also fill missing `daily_summary` metric fields on an already-existing row
- `+ SELECT IMAGE FROM PHONE LINK`
  - is intended as an image preparation step only
  - it should not be treated as a complete day-summary build path
- `CLEAR RUN`
  - is intended to separate FIT/JSON-side cleanup from DAILY/image-side cleanup
  - but the current implementation is still only a partial approximation of that intent

## 14. Known Areas Where Specification and Implementation Still Diverge

At the time of writing, the following areas are still under active alignment:

- the exact cleanup semantics of `CLEAR RUN`
- whether and when FIT JSON cache should visibly "stay deleted" after a clear
- how `SYNC DAILY` should treat an already-existing cache-derived `daily_summary`
- how OCR-derived day totals and cache-derived day totals should coexist in `daily_summary`
