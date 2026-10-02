# COROS direct MCP manual reception

Adds an independent OAuth client to Run Comment. It does not reuse the credentials
of ChatGPT/Codex, use the Partner API, or install a new acquisition schedule.
Existing TCX upload, same-day run handling, FIT calculations, and route replay
continue through their existing implementations.

## Run locally

1. Install server dependencies with `npm ci` and client dependencies with
   `npm ci --prefix client`.
2. Start the existing API server and Next.js frontend in the usual way.
3. Open the frontend on the server PC using `http://localhost:3001`.
4. Press **COROS接続**, log in at COROS and approve this application's access.
5. Close the completion tab, press **接続状態を確認**, select a Japanese calendar
   date, and press **指定日のランを受信**.

The default OAuth callback is
`http://localhost:3000/api/coros-mcp/callback`. If using a different server port,
set `COROS_REDIRECT_URI` to that loopback URL before starting the API server.
For authorization on a phone or another PC, configure a reachable **HTTPS** URL
ending in `/api/coros-mcp/callback`; localhost on a phone refers to the phone.
The existing HTTPS API listener can serve this callback. Its certificate must
already be trusted by the browser.

## Data flow

- OAuth metadata discovery and dynamic client registration use the official MCP
  SDK, PKCE S256 and a one-use state with a ten-minute lifetime.
- COROS's documented regional MCP resource URLs are explicitly allowed; other
  resource URLs are rejected.
- Authorization information is saved separately in ignored
  `data/coros/oauth/credentials.json`, with mode 0600 on POSIX. On Windows protect
  this directory using the user's filesystem permissions. It is never returned
  by the status API. Disconnect removes the locally stored connection; it does
  not promise remote token revocation.
- Live `tools/list` schemas determine accepted arguments. An unknown required
  argument, unrecognized response, truncated list, unsafe numeric activity ID or
  mismatched date stops the operation instead of inventing values.
- `querySportRecords` requests one date with running codes 100–103. Every activity
  is processed separately using its full string `labelId`.
- `getActivityDetail` and `queryActivityFitFileDownloadUrls` retrieve detail and
  an HTTPS COROS FIT link. FIT integrity is checked before replacing a file.
- FIT and metadata go to the existing `data/coros/fit` and `metadata` directories.
  The existing importer creates minute data, day metrics, comments and GPS route
  data. The existing automatic import lock is shared to avoid concurrent parsing
  and comment generation.
- Valid existing FIT pairs are reused. Applied runs with matching minute data and
  route output are skipped. A failed comment can be retried without redownloading
  its FIT. Individual failures are visible alongside successful activities.
- The direct receiver does not update the Codex acquisition cursor or its
  automation memory. Existing scheduled acquisition is neither disabled nor
  replaced, and its status panel continues to describe that separate process.

## Limits and acceptance check

COROS currently documents a shared allowance of 50 FIT/file-URL requests per fixed
24-hour window. The server remains authoritative; this implementation additionally
limits a manual pass to 50 download-URL requests. It does not silently truncate a
day with 100 or more returned records or a response advertising more records.
There is no webhook and no new background schedule.

Before considering this production-verified, authorize on the actual local app
and receive a date with multiple runs. Verify the live activity-list/detail/URL
response shapes and compare IDs, start/end timestamps, GPS route, laps and metrics
with the source TCX. Synthetic FIT tests check conversion and separate route
outputs, but do not prove equality with the user's COROS export. Existing lap
behavior is preserved; no new COROS lap display is introduced.

Official references:

- https://support.coros.com/hc/en-us/articles/53181619102996-Build-on-COROS-MCP
- https://github.com/coroslab/COROS-MCP
- https://github.com/durotaxis/antigravity-next/issues/2

## Validation commands

```sh
NODE_OPTIONS=--experimental-vm-modules npm test -- --runInBand coros_direct_mcp.test.js coros_fit_importer.test.js coros_auto_import.test.js coros_fit_sync_store.test.js
./client/node_modules/.bin/tsc --noEmit --project client/tsconfig.json
npm run build --prefix client
```
