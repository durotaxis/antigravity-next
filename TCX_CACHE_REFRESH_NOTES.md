# TCX Cache Refresh Notes

## Summary

This note explains the intent behind the recent TCX-related cache refresh
changes.

## Current Goal

When a TCX file is imported for a date, the system should not leave legacy
run-owned caches or related chart data stale for that same date.

## Expected Behavior

- TCX import updates the date-level summary from TCX data
- legacy run-owned caches are rebuilt for the imported date
- Google Fit intraday cache refresh is attempted after TCX import
- if cache rebuild fails, the import itself should still complete and log a
  warning instead of crashing the whole flow

## Related Areas

- `index.js`
- `google_fit_service.js`

## Notes

- This note is only a lightweight implementation memo
- It is not a product specification
