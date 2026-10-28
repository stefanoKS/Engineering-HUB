# V1.5.1 gate 6 — Backend read reduction

Status: **PASS**
Date: 2026-10-28
Starting commit SHA: adde446e856f992d16aca18b116489126b9a57c7
Implementation commit SHA: 6da346c (feat(manager-web): local-first navigation with an authorized snapshot)

## 1. Objective

Reduce redundant SpreadsheetApp work without weakening validation, permission, audit or history,
and without adding a server-side cache.

## 2. Affected source files

`src/ManagerWeb.gs` (bootstrap, taskIndex, shared summaries/order, reference options),
`src/Tasks.gs` (lazy PROJECTS/SUBPROJECTS reads).

## 3. Exact acceptance criteria and result

- Measured live read counts reduced: PASS for the operations that were reworked.
- Each table is still read at most once per execution: PASS (asserted by counting
  `getDataRange` calls per sheet in `v1_5_1-performance.test.js` and `v1_5-web.test.js`).
- No private unrestricted rows returned: PASS (allowlisted summaries; asserted by regex).
- No new server-side cache; heavy reports stay out of interactive paths: PASS.
- Validation, permissions, audit and history untouched: PASS (`ManagerWebApi` unchanged except
  version strings).

## 4. Automated tests performed

`v1_5_1-performance.test.js`: bootstrap read count (9 tables), taskIndex read count (3 tables),
oversized dataset behaviour, project-summary fields; `v1_5-performance.test.js`: bounded reads and
payloads for overview/tasks; `v1_5-web.test.js`: permission and revision behaviour.

## 5. Manual tests performed

Diagnostics view in the preview browser: `bootstrap` 9 sheet reads, `taskIndex` 3, `project`
detail 4 – matching the assertions.

## 6. Test commands

npm test; node scripts/manager-web-benchmark.js.

## 7. Actual results

| Operation | Before (tables) | After (tables) | Notes |
| --- | ---: | ---: | --- |
| overview | 9 | 9 | unchanged, kept for compatibility |
| projects | 7 | 7 | unchanged, kept for server paging |
| tasks | 4 | **3** | PROJECTS/SUBPROJECTS only load for the ancestor-aware filter |
| references | 3 | 3 | now also delivered inside `bootstrap` |
| bootstrap | — | 9 | overview + references + all project summaries + task count in one call |
| taskIndex | — | 3 | compact columnar task summaries |

A client session that used to spend 3 RPCs and 16 table reads to show overview → projects → tasks
(references 3, projects 7, tasks 4 plus the overview's own 9 executed separately) now spends one
`bootstrap` (9 tables) and one background `taskIndex` (3 tables), and no further reads for that
navigation. `reportRefresh` (16.7 reads, 267 ms at 300/3000) remains explicit only.

## 8. Relevant logs and evidence

[raw performance](V1_5_1_PERFORMANCE.json), [performance document](../MANAGER_WEB_APP_PERFORMANCE.md).

## 9. Identified problems

`bootstrap` returns every project summary, so its payload scales with the project count; the
compact task index scales with the task count.

## 10. Corrective actions

Documented bounds (`PROJECT_INDEX_LIMIT = 1000`, `TASK_INDEX_LIMIT = 3000`) with all-or-nothing
payloads, plus a 1,000-task background prefetch threshold. No server-side cache was added because
the benchmark shows the remaining cost is Sheets I/O, not repeated computation.

## 11. Remaining limitations

Google Sheets has no index: `Tasks.list` still scans the TASKS rows in memory after one batch read.
Server execution time at 300/3000 is ~100 ms for `bootstrap` in the mock; the live equivalent is
NOT_RUN.

## 12. Final gate status

**PASS** locally. **IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR
PRODUCTION.**
