# Manager Web App performance — V1.5

Measured 2026-10-28 on Windows, Node v24.21.0, mocked Google services. **Real Workspace timings: NOT_RUN.** Raw results: [V1_5_PERFORMANCE.json](checkgates/V1_5_PERFORMANCE.json). Reproduce with node scripts/manager-web-benchmark.js. Small/medium/large contain 10/100/300 projects, 100/1,000/3,000 tasks, two subprojects per project, active/retired responsibilities, four members, archived records and pending deadline/completion requests.

This document records the **review-correction** measurement: the project list and overview no longer return the stored `PROJECTS.Progress_Percent` / `PROJECTS.Health` columns and instead derive progress, health, task counts and the neutral deadline state from current rows (`Dashboard.projectMetrics`). Every table is still read at most once per request; the derived values add the MILESTONES, ISSUES and AUTOMATION_SETTINGS reads that health classification needs. Task saves are unchanged and still skip the report refresh, so a save costs what it did before while the next read shows fresh values.

## Method and actual values

The baseline loads every original manager .gs file from starting commit 5c1143edef3f8ba74ce92219a59ea58723847941 into a separate mock context and measures Ui.context. Final values use the new focused APIs on equivalent fixtures. This compares the sidebar's broad bootstrap with the web overview, not identical computation. Range counters include the environment-marker read; tableReads in RPC metrics excludes that marker. Read operations have 12 samples (one cold, 11 warm); writes have six (one cold, five warm); report refresh has three (one cold, two warm). p95 is an observed order statistic, not a statistically stable service guarantee. Cold means first call in that mock instance, not a Google cold start.

| Projects/tasks | Operation | Cold ms | Warm p50 ms | Warm p95 ms | Range reads/call | Opens/call | Payload bytes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 10/100 | baseline | 9.77 | 1.02 | 1.24 | 26.0 | 13.0 | 46519 |
| 10/100 | overview | 13.42 | 3.82 | 5.81 | 10.0 | 1.0 | 3787 |
| 10/100 | projectList | 3.25 | 3.09 | 4.88 | 8.0 | 1.0 | 3445 |
| 10/100 | projectDetail | 0.96 | 0.52 | 2.4 | 5.0 | 1.0 | 1726 |
| 10/100 | taskSearch | 0.79 | 0.45 | 1.12 | 5.0 | 1.0 | 2449 |
| 10/100 | taskDetail | 0.47 | 0.35 | 0.54 | 4.0 | 1.0 | 921 |
| 10/100 | taskCreate | 2.34 | 1.73 | 1.92 | 17.0 | 1.0 | 972 |
| 10/100 | taskUpdate | 4.23 | 2.51 | 3.32 | 20.0 | 2.0 | 915 |
| 10/100 | requestApproval | 4.87 | 2.28 | 2.81 | 24.0 | 1.0 | 201 |
| 10/100 | publication | 4.5 | 2.23 | 2.37 | 20.0 | 2.0 | 295 |
| 10/100 | reportRefresh | 12.54 | 8.95 | 8.95 | 16.7 | 1.0 | 1498 |
| 100/1000 | baseline | 7.72 | 6.56 | 7.38 | 26.0 | 13.0 | 180010 |
| 100/1000 | overview | 32.91 | 33.04 | 50.68 | 10.0 | 1.0 | 7123 |
| 100/1000 | projectList | 16.33 | 15.98 | 29.71 | 8.0 | 1.0 | 16768 |
| 100/1000 | projectDetail | 3.95 | 3.57 | 14.29 | 5.0 | 1.0 | 1726 |
| 100/1000 | taskSearch | 8.74 | 3.57 | 4.44 | 5.0 | 1.0 | 2449 |
| 100/1000 | taskDetail | 3.19 | 3.01 | 3.47 | 4.0 | 1.0 | 921 |
| 100/1000 | taskCreate | 10.37 | 9.34 | 10.04 | 17.0 | 1.0 | 972 |
| 100/1000 | taskUpdate | 16.19 | 15.7 | 16.4 | 20.0 | 2.0 | 916 |
| 100/1000 | requestApproval | 12.03 | 11.4 | 11.86 | 24.0 | 1.0 | 202 |
| 100/1000 | publication | 7.15 | 5.78 | 7 | 20.0 | 2.0 | 298 |
| 100/1000 | reportRefresh | 84.9 | 82.77 | 82.77 | 16.7 | 1.0 | 1507 |
| 300/3000 | baseline | 19.86 | 17.59 | 19.36 | 26.0 | 13.0 | 302191 |
| 300/3000 | overview | 96.79 | 93.76 | 123.16 | 10.0 | 1.0 | 7126 |
| 300/3000 | projectList | 62.65 | 21.58 | 50.76 | 8.0 | 1.0 | 16769 |
| 300/3000 | projectDetail | 10.85 | 10.52 | 19.9 | 5.0 | 1.0 | 1728 |
| 300/3000 | taskSearch | 10.5 | 10.86 | 12.59 | 5.0 | 1.0 | 2451 |
| 300/3000 | taskDetail | 8.97 | 8.89 | 9.91 | 4.0 | 1.0 | 921 |
| 300/3000 | taskCreate | 32.11 | 37.5 | 39.56 | 17.0 | 1.0 | 975 |
| 300/3000 | taskUpdate | 45.02 | 45.84 | 47.24 | 20.0 | 2.0 | 917 |
| 300/3000 | requestApproval | 30.54 | 30.87 | 31.88 | 24.0 | 1.0 | 204 |
| 300/3000 | publication | 16.65 | 14.15 | 15.79 | 20.0 | 2.0 | 302 |
| 300/3000 | reportRefresh | 253.9 | 278.3 | 278.3 | 16.7 | 1.0 | 1516 |

TaskUpdate includes a fresh detail read to acquire its revision plus the write. TaskCreate adds a distinct row per sample. RequestApproval applies six distinct pending deadline requests; fixture setup is outside timing. Receipt mirroring to inbox C is unavailable in this benchmark and emits the expected warning; authoritative approval/task/history complete. Publication initializes a mock B, publishes one INTERNAL project and excludes other RESTRICTED projects; its range counter covers A only. Report refresh runs explicitly and includes generated-sheet creation on its first call. There are no live Sheets latency, network, authorization or quota effects in these numbers.

At 3,000 tasks the overview reduces range reads **26 → 10** (61.5%), workbook opens **13 → 1** (92.3%) and payload **302,191 → 7,126 bytes** (97.6%). Warm local overview p50 is **17.59 → 93.76 ms**: deriving fresh health for all 300 projects costs about 66 ms of local CPU (mostly `Utilities.formatDate` inside `Health.staleDays`), which the stored-column version did not pay. That local cost is disclosed rather than hidden; Sheets I/O dominates a real Workspace call, but a measured Workspace comparison is still NOT_RUN. Fewer remote calls and a smaller payload are verified; a live latency improvement is not yet established.

The review correction moved work from the task-save path to the read path: `taskUpdate` stays at **20 reads / 2 opens / ~917 bytes** and never calls `Dashboard.refresh` (8.95–278.3 ms report refresh with generated-sheet writes is avoided), while the next overview/project read returns current progress and health. The paginated project list recalculates only its visible page, so 20 cards cost **21.58 ms** p50 instead of the 86.6 ms measured when every stored project was classified.

Earlier candidate task writes used 62 reads/30 opens including the detail read; request-local caching reduced the final path to 20/2. That candidate comparison is developmental observation, not the original sidebar baseline.

## Instrumentation and interpretation

Every manager RPC returns numeric executionMs, dataMs, tableReads and applicationMs. dataMs measures Database.read work; applicationMs is the remaining elapsed time, including validation/calculation and uninstrumented write/service overhead. It is **not pure calculation time**, and dataMs does not represent total remote write time. A real DEV execution must separately profile Google service latency before making that claim.

window.ManagerWebClient.metrics is an in-memory, numeric operation/timing list. RPC roundTripMs includes client queue time and the full call. View entries contain renderMs and totalMs. The shell entry is the navigation-relative performance.now timestamp at shell initialization, not a paint measurement. No emails, record bodies, descriptions or credentials are logged in these metrics. Do not export arbitrary page state as performance evidence.

Overview, project list/detail, task search/detail/create/update, request approval, manual publication and manual report refresh use the same instrumentation. First authorized response is the first overview RPC; initial page paint should be measured with the browser Performance panel during DEV testing. Browser render/RPC p50/p95 and pure calculation timings remain NOT_RUN; local DOM tests verify ordering and loading behavior, not browser timing targets.

## Cache and remaining bottlenecks

Read tables/workbook are reused only within an Apps Script execution. Writes invalidate affected tables and lock acquisition discards stale reads before revision checks. Browser reads cache for 30 seconds; writes invalidate the cache; no private persistent/shared server cache exists. Heavy reports run only when explicitly requested. Task saves do not invoke Dashboard.refresh.

Project progress, health, task counts and deadline wording are derived on every project read (`Dashboard.projectMetrics`) instead of being taken from the stored `PROJECTS` columns, which only `Dashboard.refresh`/`Progress.refresh` rewrite. That keeps the overview and cards correct after a task save without a report refresh. The cost is one read each of MILESTONES, ISSUES and AUTOMATION_SETTINGS per request plus one `Health.classify` call per returned project; the paginated project list limits that to the visible page. Do not reintroduce a second stored copy of these values, and do not call `Dashboard.refresh` from a task save to fix staleness.

Each task query still scans the source TASKS table in memory after one batch read. Google Sheets is not an indexed database. Project and member reference choices are loaded on demand. Large request/history queues and very large member directories may need additional server paging beyond this release. Browser tables are paginated; no thousands-of-tasks dropdown is loaded.

Targets remain goals: local navigation approximately 100 ms, cached filters under 150 ms, warm Workspace overview under 3 seconds, project detail under 2 seconds, common save under 3 seconds. Measure warm/cold p50/p95 in DEV with the actual account, dataset, timestamp, execution ID and deployment version. Do not substitute mock timings for those targets.
