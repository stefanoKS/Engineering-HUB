# V1.7.3 GATE 3 — Reads nobody needed

| Field | Value |
| --- | --- |
| Release line | V1.7 corrective change (application version `1.7.3`) |
| Scope | `src/Database.gs`, `src/ManagerWeb.gs`, `src/ManagerWebClient.html` |
| Result | **PASS (local)**; live Workspace verification **BLOCKED / NOT_RUN** |
| Backend impact | None. Google Sheets stays authoritative; no server-side cache was added |

## 1. First page load is one execution

`applyBootstrap()` no longer calls `syncTaskIndex(false)`. `syncTaskIndex(force)` now returns for a
non-forced call while the index is not loaded, so the compact index is read when タスク opens (or when
a project write invalidated it) and the paginated server page is only requested when the index is
unavailable.

| Path | Before | After |
| --- | --- | --- |
| Page load | `bootstrap` + `taskIndex` | `bootstrap` only |
| タスク (first visit) | uses the prefetched index | one `taskIndex` read, then local pages |
| タスク (index unavailable) | server page | server page (unchanged fallback) |

Existing local search, filters, pagination and the "report the total, never truncate silently" rule
are unchanged; the V1.5.1 navigation tests were updated to the new contract (they now open タスク once
before asserting zero further RPCs).

## 2. One range read per table per execution

`Database.data()` caches the raw values in the execution-local read context, and `withLock()` plus
every write (`insert`, `update`, `updateMany`, `writeGenerated`) invalidate that entry. Effect:
`find()` + `data()` inside one write no longer call `getDataRange()` twice, and no execution re-opens
the workbook (`Database.book()` is still resolved once and the `SETTINGS` binding check is unchanged).

The read context stays execution-local: no `CacheService`, no cross-user cache, no browser storage.

## 3. One bootstrap, shared derived data

`bootstrap()` builds the project/member index maps and the responsibility list once and passes them to
`overviewCore()`, `responsibilitySummaries()` and `referenceOptions()`. Previously the same maps were
built three times per execution. The task count for the index bound now comes from the already-read
`TASKS` rows instead of a second filtered copy.

## 4. Client requests

- Identical in-flight reads are still deduplicated (`inflight`), and stale responses are still dropped
  by token.
- A write still invalidates only the cache prefixes that can contain the changed record or a derived
  aggregate; unrelated cached views are kept, and the task index is refreshed after a project write
  because the area of a task is resolved through its project.
- RPC concurrency was **not** raised (`pump()` still runs at most two calls); overlapping calls would
  only add load to Apps Script.
- Manual refresh (`再読み込み`) and the safe revalidation on focus/visibility are unchanged.

## 5. Evidence

```
node --test tests/v1_7_3-performance.test.js    # 13 tests, 13 pass
node --test tests/v1_5_1-performance.test.js    # 14 tests, 14 pass (updated contract)
node --test tests/v1_5-web-ui.test.js           # updated: no taskIndex prefetch after bootstrap
```

Measured `bootstrap`: 10 range reads, 1 workbook open, 9 table builds at every dataset size.
Measured `Database.update`: 1 range read of the table.

## 12. Final gate status

| Criterion | Status |
| --- | --- |
| No task-index prefetch during the first paint | **PASS (local)** |
| Bounded task index and pagination preserved | **PASS (local)** |
| One range read per table per execution | **PASS (local)** |
| Environment binding check intact | **PASS (local)** |
| No new cache layer | **PASS (local)** |
| Client request count / dedupe unchanged or lower | **PASS (local)** |
| Real Workspace read counts and latency | **BLOCKED / NOT_RUN** |
