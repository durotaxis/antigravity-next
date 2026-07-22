# New Screen Specification

Last updated: 2026-03-10

## 1. Scope

This document describes the current behavior of the Next.js new screen.

The scope of this document is:

- `client/app/page.tsx`
- `client/app/components/RunUploader.tsx`
- related shared APIs used by the new screen

It does not define the legacy screen except where the new screen opens or embeds legacy functionality.

## 2. Screen Purpose

The new screen is the main user-facing screen for:

- normal run image upload
- result viewing
- run card browsing
- image viewing
- opening legacy chart/detail overlays

It is the normal screen.
The legacy screen is the debug / operational companion.

## 3. Main Screen Structure

The new screen contains these major areas:

- Page header
- `RunUploader`
- error banner
- efficiency chart
- run card grid
- image lightbox
- legacy chart modal
- legacy minute-detail modal

## 4. Run List Loading

### 4.1 Data source

On load, the new screen fetches:

- `GET /api/runs?includeDerived=1`

### 4.2 What the screen builds from the API

The screen normalizes API rows into run cards with:

- date
- distance
- total time
- steps
- stride
- heart rate
- cadence
- speed
- message
- images

### 4.3 Filtering behavior

The screen hides today's placeholder-like card when it contains no meaningful run data.

This is intended to avoid showing an empty day card before real data exists.

## 5. RunUploader

### 5.1 Purpose

`RunUploader` is the main upload entry point on the new screen.

### 5.2 Inputs

The component uses:

- `Run Date (Upload Target)`
- one file

The file can currently be either:

- one image file
- one `TCX` file

### 5.3 Upload API

The component currently switches API route by file type.

- image file
  - `POST /api/analyze`
- `TCX` file
  - `POST /api/import-tcx`

Image upload sends:

- `image`
- `date`
- `ocr_mode=python`

TCX upload sends:

- `file`
- optional `date` fallback

### 5.4 Upload date meaning

For image upload:

- the selected `Run Date (Upload Target)` is sent as the upload target date
- this date is used as fallback when OCR does not provide a date

For `TCX` upload:

- the run date is resolved primarily from the `TCX` filename
- if filename resolution fails, the server may fall back to `TCX` contents
- the UI date is only a fallback and is not the primary source of truth for `TCX`

### 5.5 OCR mode

The new screen is currently defined to use:

- Python OCR

This applies to image upload only.

`TCX` upload does not use OCR.

### 5.6 Result handling

After successful upload, the component refreshes the page.

It also handles:

- duplicate upload reuse
- OCR failure response
- missing run date response

More specifically:

- duplicate upload
  - reuses the existing imported asset/data and reloads the page
- OCR failure
  - keeps the imported image but reports that analysis values could not be extracted
  - does not immediately reload the page in that branch
- missing run date
  - asks the user to set or confirm the upload target date and retry

For `TCX` upload:

- successful import
  - saves run-based TCX minute cache
  - updates `daily_summary`
  - reloads the page

## 6. New Screen Ingest Behavior

The new screen currently supports two ingest paths:

- single-image ingest path
- `TCX` ingest path

The image path performs:

- image upload
- asset creation or reuse
- OCR
- run-date resolution
- run-image link creation
- image metric persistence
- `daily_summary` creation or update
- advice generation/update in the server flow

The image path therefore combines:

- one uploaded image
- OCR result
- cache/Fit-derived supplemental metrics
- same-date summary merge behavior
- possible advice/message persistence

The `TCX` path performs:

- `TCX` upload
- run-date resolution from filename/content
- run-based minute-cache creation
- `daily_summary` regeneration/update from `TCX`

Current `TCX` handling note:

- `COROS` `TCX` is treated as run-based data
- `daily_summary` remains date-based
- when `TCX` exists, the server updates `daily_summary` from `TCX`-derived values
- TCX Run Comment generation receives only complete-rest time windows as additional second-level context
- complete rest is recorded speed of at most `1.0 m/s` and cadence of `0` for at least `10 seconds`
- each supplied window contains its start time, end time, duration, heart rate at the first valid sample, heart rate at the last valid sample, and their difference; near-LT and moving-recovery classifications are not supplied
- prompt context notes that a single run may contain stops caused by traffic signals or similar circumstances
- when the run structure is clearly interval training, the comment may use Daniels, Canova, and Norwegian training principles as reference frameworks
- the comment must not assert a named method when the run data does not establish it
- the comment appends next-training advice suited to the current run data, using the running theories of Daniels, Bakken, Canova, Lydiard, and Peter Coe as references
- the generated comment does not use technical terminology or theory names and explains the advice in language understandable to the general public
- the most recent saved RUN COMMENT before the current run is attached as comparison context, ordered by run date and `run_id`
- evaluations, observations, and workout suggestions that are substantively the same as the previous RUN COMMENT are omitted; changing only numeric wording does not make a point new
- complete-rest windows remain on the chart timeline and are not removed or compressed
- this analysis does not rewrite TCX points, minute adjustment, splits, or `daily_summary` metrics

### 6.1 TCX route-video data

The TCX ingest path also extracts GPS route points for the run-video feature.

- route data is stored separately as `storage/cache/tcx_route_YYYY-MM-DD_HHMMSS.json`
- route points retain timestamp, latitude, longitude, distance, speed, heart rate, pitch, and altitude when available
- this cache is independent of the minute and split caches
- creating or reading it does not change TCX minute adjustment, split, or `daily_summary` behavior
- for an older run whose source TCX still exists, the route cache may be created lazily when the video route is first requested

## 7. Run Cards

Each run card displays:

- date
- run ID
- distance
- total time
- coach advice message if present
- stride max/avg
- heart rate max/avg
- speed max/avg
- pitch max/avg
- image thumbnails

Implementation note:

- the underlying legacy chart/detail state still exists
- but `Chart` / `Detail` shortcuts are currently hidden from the visible run-card UI

## 8. Card Image Area

The card image section shows linked run images.

Images are displayed through the shared image grid/lightbox behavior.

Clicking an image opens the lightbox.

## 8.1 Run Video

Each run card provides a `RUN VIDEO` action.

- the action requests run-owned GPS data for the card date
- when multiple TCX runs exist on the date, the modal allows the user to select a run
- the route is rendered on OpenStreetMap tiles with attribution
- the replay shows the completed route, current position, elapsed time, distance, speed, heart rate, and pitch
- metric text is drawn directly over the map with a dark outline and no opaque background panel so that the route remains visible
- playback is compressed to approximately 45 seconds
- the user can preview the replay or save it as a WebM video in supported browsers
- a missing GPS route is reported without changing the run or its stored summary
- invalid or temporarily unavailable GPS points are skipped, and drawing falls back to a valid route point instead of interrupting playback
- MP4 generation is outside the current implementation because the local environment does not currently provide FFmpeg

## 9. Legacy Chart and Detail Access

The new screen can open legacy functionality in overlays.

Current UI note:

- the underlying legacy overlay logic still exists
- however, the `Chart` and `Detail` buttons are currently hidden from the new-screen run cards
- so this access path is not currently available from the visible new-screen UI

### 9.1 Chart button

The `Chart` button opens:

- `LegacyStrideChart`

for the selected run date.

### 9.2 Detail button

The `Detail` button opens:

- `LegacyMinuteDetail`

for the selected run date.

### 9.3 Meaning

The new screen remains the primary screen, but it can reuse legacy chart/detail views without moving the user into the full legacy operational UI.

## 10. Lightbox

The new screen includes a lightbox for run images.

The lightbox is display-only in the new screen flow.

## 11. Error Handling

The new screen can surface these categories of errors:

- run list fetch failure
- upload failure
- OCR failure
- missing run date

These are shown through:

- error banner
- alert dialogs

## 12. Data Role of the New Screen

The new screen is responsible for the ordinary user flow:

- upload one run screenshot
- persist image data
- update day summary
- view saved runs

The new screen is not intended to be the bulk sync/debug screen.

## 12.1 COROS Run Comment Inbox

The new screen can display a Run Comment imported independently of TCX.

- Codex Scheduled Task writes UTF-8 JSON to `data/run-comment/inbox`
- filenames use `run_<activityId>.json`
- required fields are `date` and `activityId`; any incoming `message` is ignored
- the local server generates the Run Comment from COROS activity data through `gemini_service`
- Gemini model selection uses the configured fallback order and records the successful model in the processed JSON
- the server writes the locally generated message into `run_messages` with `activityId` as `run_id`
- an existing `(date, run_id)` message is overwritten
- after generation, the same latest message is always written to `daily_summary.message`; it is not left `null` while waiting for a separate Apply action
- regenerating the same activity overwrites both `run_messages.message` and `daily_summary.message` with the newly generated message
- after a successful database write, the JSON is moved to `data/run-comment/processed`
- invalid or failed JSON remains in the inbox for correction or retry
- the latest imported run message for a date and `daily_summary.message` represent the same latest generated Run Comment
- this flow does not read or modify TCX caches
- when the date has no `daily_summary`, the server creates the run card from available COROS summary fields
- when the date already has `daily_summary`, existing metric fields are left unchanged
- run-card creation occurs only while importing a new or updated JSON from `inbox`
- files already in `processed` never recreate a deleted run card

## 13. Relation to Legacy Screen

The conceptual separation is:

- New screen
  - normal upload and viewing
- Legacy screen
  - analyzer/debug/manual sync operations

This is the current operational split between the two UIs.
