# V1.5.1 gate 2 — Client-side data store

Status: **PASS**
Date: 2026-10-28
Starting commit SHA: adde446e856f992d16aca18b116489126b9a57c7

## 1. Objective

Give the manager page one reusable, authorized in-memory data store that answers ordinary
navigation without a server call, without persisting private records and without weakening the
server-side authorization.

## 2. Affected source files

`src/ManagerWebClient.html` (snapshot store, request queue, invalidation),
`src/ManagerWeb.gs` (`bootstrap`, `taskIndex`, reference and summary helpers),
`src/ManagerWebIndex.html` (計測/Diagnostics entry).

## 3. Exact acceptance criteria and result

- Project summaries, task summaries, hierarchy references, member/reference choices and opened
  detail records are cached in memory: PASS.
- No localStorage/IndexedDB/persistent browser storage for private records: PASS (asserted in
  `v1_5_1-release.test.js`; the only stored value remains `eh.lang`).
- Identical in-flight reads are deduplicated into one RPC: PASS.
- The 30-second cache *expiry* is replaced by a 30-second *freshness* window; data stays usable for
  the session until invalidated, revalidated or explicitly cleared: PASS.
- Authorization stays on the server for every call: PASS (each `bootstrap`/`taskIndex` call runs
  through `ManagerWeb.response` → `ManagerWeb.authorize`).

## 4. Automated tests performed

`tests/v1_5_1-performance.test.js`: bootstrap/index shape and read counts, in-flight dedupe,
superseded-response discard, selective invalidation, revocation clearing.

## 5. Manual tests performed

Preview browser: `window.ManagerWebClient.stats` inspected after load (2 RPCs), navigation
(0 further RPCs), and repeatedly typing in the task filter (0 further RPCs).

## 6. Test commands

npm test; npm run validate; node scripts/manager-web-benchmark.js.

## 7. Actual results

`bootstrap` reads each source table exactly once per call (9 tables, 10 range reads including the
environment marker, 1 workbook open) and returns 8,515 / 48,663 / 130,867 bytes at 10/100/300
projects. `taskIndex` reads three tables (4 range reads) and returns 15,052 / 152,715 / 467,516
bytes at 100/1,000/3,000 tasks. Identical reads issued in the same tick produce one request
(asserted). A response superseded by `api.clear()` resolves to `null` and does not repopulate the
cache (asserted).

## 8. Relevant logs and evidence

[raw performance](V1_5_1_PERFORMANCE.json), [validation output](V1_5_1_VALIDATION.txt),
[performance document](../MANAGER_WEB_APP_PERFORMANCE.md).

## 9. Identified problems

The task index is large at 3,000 tasks (467 KB). Sending it with the first paint would slow the
initial view, so it is fetched in the background only up to 1,000 tasks and otherwise when タスク
is opened.

## 10. Corrective actions

Two dataset bounds (`TASK_INDEX_LIMIT = 3000`, `PROJECT_INDEX_LIMIT = 1000`), all-or-nothing
datasets with an explicit `complete` flag, and a `PREFETCH_TASKS = 1000` background threshold.

## 11. Remaining limitations

The snapshot uses browser memory only; a reload or a second tab fetches it again. Payload size
grows with the dataset up to the documented bounds, and real transfer time is NOT_RUN.

## 12. Final gate status

**PASS** locally. **IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR
PRODUCTION.**
