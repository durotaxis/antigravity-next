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

## 13. Relation to Legacy Screen

The conceptual separation is:

- New screen
  - normal upload and viewing
- Legacy screen
  - analyzer/debug/manual sync operations

This is the current operational split between the two UIs.
