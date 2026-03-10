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
- one image file

### 5.3 Upload API

The component sends:

- `POST /api/analyze`

with:

- `image`
- `date`
- `ocr_mode=python`

### 5.4 Upload date meaning

The selected `Run Date (Upload Target)` is sent as the upload target date.

This date is used as fallback when OCR does not provide a date.

### 5.5 OCR mode

The new screen is currently defined to use:

- Python OCR

### 5.6 Result handling

After successful upload, the component refreshes the page.

It also handles:

- duplicate upload reuse
- OCR failure response
- missing run date response

## 6. New Screen Ingest Behavior

The new screen uses the single-image ingest path.

That path performs:

- image upload
- asset creation or reuse
- OCR
- run-date resolution
- run-image link creation
- image metric persistence
- `daily_summary` creation or update
- advice generation/update in the server flow

The new screen is therefore the single-image normal ingestion flow.

## 7. Run Cards

Each run card displays:

- date
- chart/detail shortcuts
- run ID
- distance
- total time
- coach advice message if present
- stride max/avg
- heart rate max/avg
- speed max/avg
- pitch max/avg
- image thumbnails

## 8. Card Image Area

The card image section shows linked run images.

Images are displayed through the shared image grid/lightbox behavior.

Clicking an image opens the lightbox.

## 9. Legacy Chart and Detail Access

The new screen can open legacy functionality in overlays.

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
