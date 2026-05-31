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
  - `SAVE AGE`
  - `SAVE REST HR`
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
- TCX cache files
  - run-based minute cache
    - `storage/cache/tcx_intraday_YYYY-MM-DD_HHMMSS.json`
  - run-based split cache
    - `storage/cache/tcx_splits_YYYY-MM-DD_HHMMSS.json`

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
- Loads cached Google Fit sessions for the selected date when available
- Loads `daily_summary` for the selected date
- Renders summary values
- Loads linked images
- Loads daily message if present

The legacy run-analyzer result area currently shows:

- `Google Fit Sessions`
  - run-session name and start-end time range from `sessions_YYYY-MM-DD.json` when available
- Upper chart
  - `Stride` and `Heart Rate`
- Lower chart
  - `Speed` and `Pitch`
- `Speed (accurate)` and `HR (accurate)`
  - detailed Google Fit series
- `Pitch (rough)`
  - run-session-limited coarse reconstructed pitch series
- `Stride (rough)`
  - run-session-limited coarse reconstructed stride series
- `TCX Run` pager
  - available when one or more run-based TCX files exist for the selected date
- `TCX Stride + HR`
  - run-based minute chart from the selected TCX run
- `TCX Speed + Pitch`
  - run-based minute chart from the selected TCX run
- `1km Splits`
  - lap-style averages derived from minute data
- `Per Minute`
  - the existing minute-level detail table
- `TCX Per Minute`
  - minute-level detail table for the selected TCX run
- `TCX 1km Splits`
  - lap table built from the selected TCX run's `<Lap>` blocks

Current run-owned cache behavior:

- legacy run-owned cache is start-date-owned
- the selected date is the run ownership date
- when a run starts on the selected date and its `end` is on the next day, the next-day portion is still included in the same start-date-owned run cache
- therefore the legacy screen can treat one cross-midnight run as one run owned by its start date

The legacy summary card currently displays:

- `Peak Performance`
- `VS World Record`
- `Max Heart Rate`
- `Avg Heart Rate`
- `Max Speed`
- `Avg Speed`
- `TIME`
- `STEPS`
- `DIST (M)`
- `DIST / STEPS x100`

Current heart-rate guide display behavior in the summary card:

- `Max Heart Rate`
  - shows `LTHR: ...` as the helper line
- `Avg Heart Rate`
  - shows `LSD: ...` and `Z2: ... bpm` inline on the same helper line

Current split-table behavior:

- `1km Splits` is a display-only table built from intraday minute data
- it shows average:
  - `Speed`
  - `Pitch`
  - `Heart Rate`
  - `Stride`
- when Google Fit sessions are available, split accumulation is reset at each run-session start time
- when multiple run sessions exist on the same date, the split table treats them as separate runs for lap accumulation

Current TCX-driven legacy behavior:

- when one or more TCX runs exist for the selected date, the legacy screen enables `TCX Run` page control
- TCX run ownership is start-date-based
- when a TCX run starts on the selected date and its `end` is on the next day, that run is still treated as the selected date's run
- the selected page determines:
  - `TCX Per Minute`
  - `TCX 1km Splits`
  - `TCX Stride + HR`
  - `TCX Speed + Pitch`
- when TCX runs exist for the selected date, the legacy screen hides:
  - legacy `1km Splits`
  - legacy `Per Minute`
  - legacy `Stride + Heart Rate`
  - legacy `Speed + Pitch`
  - `Pitch (rough)`
  - `Stride (rough)`
- when no TCX run exists for the selected date, the legacy screen falls back to the pre-existing non-TCX display

In addition, when the chart API is called with legacy sync behavior enabled, the screen may fill missing day-summary fields from intraday data for an already-existing `daily_summary` row.

### 5.3 Data sources

The legacy screen combines:

- Google Fit derived chart data
- `daily_summary`
- linked images from `run_images`
- optional run-based `TCX` minute and lap cache data

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

### 5.6 Google Fit token-expiry limitation

Current operational limitation:

- Google Fit access tokens can expire or be revoked
- in practice, this may appear after roughly 7 days
- token-expiry handling is not yet enforced consistently across every Google Fit path used by the legacy screen

Typical visible error:

- `Error loading splits: {"error":"invalid_grant"}`
- `Error loading data: {"error":"invalid_grant"}`

Meaning of this error:

- the failure is not limited to `1km Splits`
- it indicates that a Google Fit request failed with `invalid_grant`
- some legacy routes still surface this as a generic legacy-screen load error instead of a dedicated re-auth message

Current manual response:

1. delete `token.json`
2. trigger a Google Fit flow again so that the OAuth consent / re-auth screen appears
3. confirm that a new `token.json` is created
4. if the legacy screen still hangs after re-auth, restart the local server process and retry `RUN ANALYZER`

Current implementation gap:

- some older Google Fit flows delete `token.json` when `invalid_grant` is detected
- some newer range/session-based flows used by legacy run-owned cache rebuild do not yet enforce that behavior consistently
- because of that inconsistency, token expiry may surface as a legacy-screen chart/table load failure instead of immediately forcing re-auth

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
- Run OCR for each selected image
- Resolve the run date from OCR per image
- Auto-link each successful image to the corresponding date-specific `daily_summary`

The import creates or reuses:

- `image_assets`
- `run_images`

When OCR resolves multiple different dates, the selected images may be linked to multiple different run dates in one operation.

### 8.3 What it does not do

It does not use the current `RUN ANALYZER` date as a temporary run link target.

It does not create a temporary same-date link and then move the image later.

If OCR date resolution fails for an image, that image is treated as an import failure.

If the OCR-resolved date has no `daily_summary`, the system attempts cache/FIT reconstruction first.
Only dates with an available `daily_summary` receive links.

That is why the button text explicitly says:

- `without SYNC DAILY`

### 8.4 Role in the system

This is now a direct OCR-assisted image import and auto-link step.
It is not the legacy batch OCR accumulation flow used by `SYNC DAILY`.

## 9. CLEAR RUN

### 9.1 Purpose

`CLEAR RUN` is intended to remove artifacts created by one of the two debug synchronization paths.

### 9.2 Current modes

The button currently has three modes:

- `Fit JSON`
- `Daily`
- `Images Reset`

### 9.3 Intended FIT JSON behavior

When `Fit JSON` is selected, the intended behavior is:

- Remove artifacts created by `SYNC FIT JSON`

That means the FIT/JSON side of the selected day, not the image/OCR side.

At minimum, this concerns:

- Google Fit JSON cache files
- cache-derived `daily_summary`

The image/OCR side should remain untouched in this mode.

### 9.4 Current DAILY behavior

When `Daily` is selected, the current behavior is:

- Delete the selected date through the summary-only delete path
- Remove `run_images` rows for that date
- Remove the `daily_summary` row for that date
- Keep `image_assets` in place
- Do not restore `daily_summary` from cache automatically

This is narrower than "remove all `SYNC DAILY` artifacts and rebuild from FIT/JSON".

### 9.5 Current IMAGES RESET behavior

When `Images Reset` is selected, the current behavior is:

- Delete `run_images` rows for the selected date
- Delete orphaned `image_assets` rows linked only to that date
- Delete the corresponding files under `public/assets/store`
- Delete the existing `daily_summary` row for the selected date
- Recreate `daily_summary` from cache / FIT JSON using `sync-cache` semantics

This mode is the image/OCR cleanup path that restores the date back to JSON-only daily-summary values.

### 9.6 Current state

- `FIT JSON`
  - deletes cache files for the selected date
  - then the SPA update path can immediately fetch data again
- `DAILY`
  - currently goes through the summary-only delete path
  - therefore current behavior is narrower than the intended "remove all `SYNC DAILY` artifacts"
- `Images Reset`
  - is the current mode that removes linked images and restores the cache-driven `daily_summary`

## 10. SAVE HEIGHT

### 10.1 Purpose

Stores the user's height setting used by legacy-screen-related calculations and prompts.

### 10.2 Scope

This button saves height only.
It does not trigger sync or OCR.

## 11. SAVE AGE

### 11.1 Purpose

Stores the user's age setting for legacy-screen-only heart-rate context.

### 11.2 Scope

This button saves age only.
It does not trigger sync or OCR.

### 11.3 Persistence

The current implementation stores age in browser local storage.

### 11.4 Derived value

The legacy screen uses:

- `estimated max heart rate = 220 - age`

This is a display-side derived value in the current old-screen implementation.

### 11.5 Current display behavior

The legacy summary card can show:

- `Max Heart Rate`
- `Max Heart Rate (xx%)`

where the percentage is:

- observed max heart rate divided by `220 - age`

### 11.6 New environment behavior

In a new browser/device environment:

- seeing a number in the `Age` input is not sufficient by itself
- the user must enter and save the value in that environment
- until `SAVE AGE` is executed there, age-based helper references may remain unavailable

## 12. SAVE REST HR

### 12.1 Purpose

Stores resting heart rate for old-screen-only heart-rate guide display.

### 12.2 Scope

This button saves resting heart rate only.
It does not trigger sync or OCR.

### 12.3 Persistence

The current implementation stores resting heart rate in browser local storage.

### 12.4 Derived values

The legacy debug display can compute:

- `HRmax = 220 - age`
- `LTHR = (HRmax - HRrest) * 0.85 + HRrest`
- `Z2 lower = (HRmax - HRrest) * 0.60 + HRrest`
- `Z2 upper = (HRmax - HRrest) * 0.70 + HRrest`

These are current old-screen display-side helper values only.

### 12.5 New environment behavior

In a new browser/device environment:

- seeing a number in the `Rest HR` input is not sufficient by itself
- the user must enter and save the value in that environment
- until `SAVE REST HR` is executed there, resting-HR-based helper references may remain unavailable

## 13. Run History

### 11.1 Purpose

Shows existing run rows and allows deletion.

### 11.2 Delete behavior

The run history delete path is already implemented.

It is a stronger cleanup path than the current `CLEAR RUN` implementation.

It deletes the run by date/ID through the shared delete endpoint.

Current behavior:

- removes `run_images` for the selected run/date
- deletes the `daily_summary` row for the selected run/date
- removes orphaned `image_assets`
- deletes orphaned files from `public/assets/store`
- does not restore `daily_summary` from cache automatically

This path should not be confused with the intended debug-only semantics of `CLEAR RUN`.

## 14. Lightbox and Image Viewing

The old screen can:

- display linked images
- open the image lightbox

Image unlink/delete from lightbox is currently disabled.

## 15. Current Functional Separation

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

## 16. Known Areas Where Specification and Implementation Still Diverge

At the time of writing, the following areas are still under active alignment:

- the exact cleanup semantics of `CLEAR RUN`
- whether and when FIT JSON cache should visibly "stay deleted" after a clear
- how `SYNC DAILY` should treat an already-existing cache-derived `daily_summary`
- how OCR-derived day totals and cache-derived day totals should coexist in `daily_summary`
