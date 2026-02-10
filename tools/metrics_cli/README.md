# metrics_cli

Compute run metrics from local Google Fit JSON caches (no API calls).

## Usage

From repo root:

```bash
python tools/metrics_cli/metrics_from_cache.py 2026-02-07
python tools/metrics_cli/metrics_from_cache.py 2026-02-07 --json
```

If running from another directory:

```bash
python metrics_from_cache.py 2026-02-07 --cache-dir "C:\Users\yuji_\Downloads\storage\cache"
```

