# Manager Web App performance — V1.5

Measured 2026-10-28 on Windows, Node v24.22.1, mocked Google services. **Real Workspace timings: NOT_RUN.** Raw results: [V1_5_PERFORMANCE.json](checkgates/V1_5_PERFORMANCE.json). Reproduce with node scripts/manager-web-benchmark.js. Small/medium/large contain 10/100/300 projects, 100/1,000/3,000 tasks, two subprojects per project, active/retired responsibilities, four members, archived records and pending deadline/completion requests.

## Method and actual values

The baseline loads every original manager .gs file from starting commit 5c1143edef3f8ba74ce92219a59ea58723847941 into a separate mock context and measures Ui.context. Final values use the new focused APIs on equivalent fixtures. This compares the sidebar's broad bootstrap with the web overview, not identical computation. Range counters include the environment-marker read; tableReads in RPC metrics excludes that marker. Read operations have 12 samples (one cold, 11 warm); writes have six (one cold, five warm); report refresh has three (one cold, two warm). p95 is an observed order statistic, not a statistically stable service guarantee. Cold means first call in that mock instance, not a Google cold start.

| Projects/tasks | Operation | Cold ms | Warm p50 ms | Warm p95 ms | Range reads/call | Opens/call | Payload bytes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 10/100 | baseline | 10.7 | 1.17 | 1.56 | 26.0 | 13.0 | 46519 |
| 10/100 | overview | 8.94 | 1.06 | 1.17 | 7.0 | 1.0 | 2553 |
| 10/100 | projectList | 0.25 | 0.14 | 0.18 | 4.0 | 1.0 | 2211 |
| 10/100 | projectDetail | 1.33 | 0.99 | 1.18 | 5.0 | 1.0 | 1726 |
| 10/100 | taskSearch | 0.93 | 0.52 | 0.76 | 5.0 | 1.0 | 2449 |
| 10/100 | taskDetail | 0.82 | 0.5 | 0.9 | 4.0 | 1.0 | 921 |
| 10/100 | taskCreate | 2.44 | 1.88 | 2.15 | 17.0 | 1.0 | 972 |
| 10/100 | taskUpdate | 4.76 | 2.36 | 2.52 | 20.0 | 2.0 | 915 |
| 10/100 | requestApproval | 5.66 | 2.66 | 2.91 | 24.0 | 1.0 | 201 |
| 10/100 | publication | 4.88 | 2.43 | 3.35 | 20.0 | 2.0 | 295 |
| 10/100 | reportRefresh | 14.17 | 10.53 | 10.53 | 16.7 | 1.0 | 1498 |
| 100/1000 | baseline | 8.8 | 7.01 | 7.78 | 26.0 | 13.0 | 180010 |
| 100/1000 | overview | 9.34 | 8.11 | 9.58 | 7.0 | 1.0 | 4652 |
| 100/1000 | projectList | 0.72 | 0.52 | 0.91 | 4.0 | 1.0 | 10593 |
| 100/1000 | projectDetail | 5.02 | 3.75 | 5.03 | 5.0 | 1.0 | 1726 |
| 100/1000 | taskSearch | 3.76 | 3.55 | 4.41 | 5.0 | 1.0 | 2449 |
| 100/1000 | taskDetail | 3.11 | 2.99 | 4.29 | 4.0 | 1.0 | 921 |
| 100/1000 | taskCreate | 9.58 | 9.55 | 12.46 | 17.0 | 1.0 | 972 |
| 100/1000 | taskUpdate | 16.97 | 15.66 | 20.9 | 20.0 | 2.0 | 916 |
| 100/1000 | requestApproval | 11.57 | 10.28 | 11.71 | 24.0 | 1.0 | 202 |
| 100/1000 | publication | 6.8 | 5.86 | 7.95 | 20.0 | 2.0 | 298 |
| 100/1000 | reportRefresh | 85.76 | 81.74 | 81.74 | 16.7 | 1.0 | 1507 |
| 300/3000 | baseline | 19.22 | 17.02 | 19.12 | 26.0 | 13.0 | 302191 |
| 300/3000 | overview | 21.97 | 19.25 | 21.47 | 7.0 | 1.0 | 4654 |
| 300/3000 | projectList | 1.55 | 1.32 | 1.45 | 4.0 | 1.0 | 10593 |
| 300/3000 | projectDetail | 11.8 | 10.28 | 11.6 | 5.0 | 1.0 | 1728 |
| 300/3000 | taskSearch | 10.54 | 10.22 | 11.99 | 5.0 | 1.0 | 2450 |
| 300/3000 | taskDetail | 9.05 | 8.65 | 10.13 | 4.0 | 1.0 | 921 |
| 300/3000 | taskCreate | 32.1 | 38.97 | 40.05 | 17.0 | 1.0 | 975 |
| 300/3000 | taskUpdate | 44.76 | 45.28 | 46.73 | 20.0 | 2.0 | 917 |
| 300/3000 | requestApproval | 31.9 | 28.43 | 30.82 | 24.0 | 1.0 | 203 |
| 300/3000 | publication | 14.88 | 13.43 | 14.64 | 20.0 | 2.0 | 302 |
| 300/3000 | reportRefresh | 251.11 | 260.8 | 260.8 | 16.7 | 1.0 | 1516 |

TaskUpdate includes a fresh detail read to acquire its revision plus the write. TaskCreate adds a distinct row per sample. RequestApproval applies six distinct pending deadline requests; fixture setup is outside timing. Receipt mirroring to inbox C is unavailable in this benchmark and emits the expected warning; authoritative approval/task/history complete. Publication initializes a mock B, publishes one INTERNAL project and excludes other RESTRICTED projects; its range counter covers A only. Report refresh runs explicitly and includes generated-sheet creation on its first call. There are no live Sheets latency, network, authorization or quota effects in these numbers.

At 3,000 tasks the overview reduces range reads **26 → 7** (73.1%), workbook opens **13 → 1** (92.3%) and payload **302,191 → 4,654 bytes** (98.5%). Warm local overview p50 is **17.02 → 19.25 ms**, so local CPU time did not improve. Fewer remote calls and a smaller payload are verified; a live latency improvement is not yet established. Earlier candidate task writes used 62 reads/30 opens including the detail read; request-local caching reduced the final path to 20/2. That candidate comparison is developmental observation, not the original sidebar baseline.

## Instrumentation and interpretation

Every manager RPC returns numeric executionMs, dataMs, tableReads and applicationMs. dataMs measures Database.read work; applicationMs is the remaining elapsed time, including validation/calculation and uninstrumented write/service overhead. It is **not pure calculation time**, and dataMs does not represent total remote write time. A real DEV execution must separately profile Google service latency before making that claim.

window.ManagerWebClient.metrics is an in-memory, numeric operation/timing list. RPC roundTripMs includes client queue time and the full call. View entries contain renderMs and totalMs. The shell entry is the navigation-relative performance.now timestamp at shell initialization, not a paint measurement. No emails, record bodies, descriptions or credentials are logged in these metrics. Do not export arbitrary page state as performance evidence.

Overview, project list/detail, task search/detail/create/update, request approval, manual publication and manual report refresh use the same instrumentation. First authorized response is the first overview RPC; initial page paint should be measured with the browser Performance panel during DEV testing. Browser render/RPC p50/p95 and pure calculation timings remain NOT_RUN; local DOM tests verify ordering and loading behavior, not browser timing targets.

## Cache and remaining bottlenecks

Read tables/workbook are reused only within an Apps Script execution. Writes invalidate affected tables and lock acquisition discards stale reads before revision checks. Browser reads cache for 30 seconds; writes invalidate the cache; no private persistent/shared server cache exists. Heavy reports run only when explicitly requested. Task saves do not invoke Dashboard.refresh.

Each task query still scans the source TASKS table in memory after one batch read. Google Sheets is not an indexed database. Project and member reference choices are loaded on demand. Large request/history queues and very large member directories may need additional server paging beyond this release. Browser tables are paginated; no thousands-of-tasks dropdown is loaded.

Targets remain goals: local navigation approximately 100 ms, cached filters under 150 ms, warm Workspace overview under 3 seconds, project detail under 2 seconds, common save under 3 seconds. Measure warm/cold p50/p95 in DEV with the actual account, dataset, timestamp, execution ID and deployment version. Do not substitute mock timings for those targets.
