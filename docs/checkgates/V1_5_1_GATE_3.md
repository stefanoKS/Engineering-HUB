# V1.5.1 gate 3 — Instant navigation and local search

Status: **PASS**
Date: 2026-10-28
Starting commit SHA: adde446e856f992d16aca18b116489126b9a57c7
Implementation commit SHA: 6da346c (feat(manager-web): local-first navigation with an authorized snapshot)

## 1. Objective

Make overview → projects → tasks render from local data with no waiting, and add local search,
sorting and filtering without ever claiming that a partial list covers every record.

## 2. Affected source files

`src/ManagerWebClient.html` (paint-from-store, `localPage`, `matchesTask`, `matchesProject`,
`taskOrder`, filter bar, diagnostics), `src/ManagerWeb.gs` (shared `taskOrder`/`taskSummary`).

## 3. Exact acceptance criteria and result

- Cached navigation renders synchronously without `google.script.run`: PASS.
- Local filtering/sorting/paging matches the server result for the same filters: PASS (project,
  owner, status, responsibility, subproject, deadline range and sort compared against the server
  in tests and in the preview browser).
- Global search correctness is preserved: PASS — pressing 検索 still runs the server search, which
  covers description and acceptance criteria; a description-only match is proved reachable in
  `v1_5_1-performance.test.js` while the local filter reports no match.
- Large datasets keep server paging instead of a silent prefix: PASS — above the bounds the server
  reports `complete:false` and the list uses `tasks`/`projects`, with the filter bar stating that
  the search is server-side.
- Cached navigation < 100 ms and cached search/filter < 50 ms (targets): PASS locally.

## 4. Automated tests performed

`v1_5_1-performance.test.js`: "navigation between overview, projects and tasks never calls the
server", "local filtering and sorting match the authoritative server result", "typing filters
locally while an explicit search still queries every field", "large datasets keep the first
payload bounded and the local list complete".

## 5. Manual tests performed

Preview browser, 10/100 and 300/3,000 datasets: 案件 3.4 ms, タスク 0.7 ms, cached タスク 2.0 ms,
typing 0.2–1.3 ms, all with zero additional RPCs; 375/768/1366 layouts measured by DOM metrics

("no horizontal overflow; 1366 px grid = 180 px + 1,171 px").

## 6. Test commands

npm test; node scripts/manager-web-benchmark.js; npm run preview:manager-web.

## 7. Actual results

Measured through the real client in the harness (p50, 12 navigation samples):

| Projects/tasks | Cached navigation p50 | Local filter p50 | Cached project open |
| --- | ---: | ---: | ---: |
| 10/100 | 0.57 ms | 0.06 ms | 0.08 ms |
| 100/1000 | 1.45 ms | 0.36 ms | 0.06 ms |
| 300/3000 | 0.92 ms | 1.80 ms | 0.07 ms |

Server filters reproduced exactly: owner+status 80, responsibility R2 50, project P3 10,
subproject S1 5 (identical to the server's own totals). Pagination labels keep the previous
`1–50 / 100` format and count every filtered record, not just the page.

## 8. Relevant logs and evidence

[raw performance](V1_5_1_PERFORMANCE.json), preview screenshots
[768 overview](evidence/V1_5_1-overview-768.png),
[768 filtered tasks](evidence/V1_5_1-tasks-filter-768.png),
[375 tasks](evidence/V1_5_1-tasks-375.png),
[計測 / Diagnostics](evidence/V1_5_1-diagnostics.png).

Those images were captured through the embedded preview browser, which clamps the viewport to
~719 CSS px and cannot take stable element screenshots; 1366/1920 layouts were therefore verified
by DOM measurement instead (see §5) and no image claims to show them.

## 9. Identified problems

Local free-text narrowing cannot see description or acceptance criteria because those fields are
deliberately excluded from the task index.

## 10. Corrective actions

The filter bar states exactly what typing filters and that 検索 covers every field; the explicit
search always goes to the server. Above the dataset bounds the list switches to server mode and
says so.

## 11. Remaining limitations

Browser paint time (as opposed to synchronous DOM render time) is NOT_RUN. The preview browser in
this environment clamps the viewport, so 1366/1920 screenshots were replaced by DOM measurements
and the iframe-measured grid; native 200 % zoom is NOT_RUN.

## 12. Final gate status

**PASS** locally. **IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR
PRODUCTION.**
