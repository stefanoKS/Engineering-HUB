# Manager Web App performance — V1.6.1

Measured 2026-10-29 on Windows, Node v24.21.0, mocked Google services. **Real Workspace timings: NOT_RUN.** Raw
results: [V1_6_1_PERFORMANCE.json](checkgates/V1_6_1_PERFORMANCE.json) (V1.6.1), [V1_6_PERFORMANCE.json](checkgates/V1_6_PERFORMANCE.json)
(V1.6), [V1_5_1_PERFORMANCE.json](checkgates/V1_5_1_PERFORMANCE.json) (V1.5.1) and
[V1_5_PERFORMANCE.json](checkgates/V1_5_PERFORMANCE.json) (V1.5), kept as historical evidence.
Reproduce with `BENCHMARK_OUTPUT=V1_6_1_PERFORMANCE.json node scripts/manager-web-benchmark.js` (the script defaults
to the V1.6 file name so a V1.6 rerun cannot overwrite this record).

## V1.6.1 comparison with V1.6

| Dataset | bootstrap p50 | bootstrap payload | taskIndex p50 | taskIndex payload | cached nav p50 | local filter p50 | RPC after load |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10 / 100 | 5.87 ms (4.43) | 11.0 KB (10.5) | 1.96 ms (2.29) | 16.5 KB (16.5) | 0.81 ms (0.77) | 0.08 ms (0.07) | 2 (2) |
| 100 / 1,000 | 46.48 ms (43.40) | 57.8 KB (57.3) | 19.20 ms (17.37) | 166.8 KB (166.8) | 1.42 ms (1.45) | 0.40 ms (0.39) | 2 (2) |
| 300 / 3,000 | 140.35 ms (115.55) | 153.2 KB (152.7) | 47.37 ms (49.07) | 509.8 KB (509.8) | 1.11 ms (1.13) | 2.05 ms (2.19) | 3 (3) |

Figures in brackets are the V1.6 values.

### Disclosed regression

The warm `bootstrap` grew by +2 % (10 projects) to +21 % (300 projects) and the payload by about 0.5 KB. The cause is
the correctness fix itself: every displayed figure now derives from one counting rule, so `TaskScope.create()` builds
a hierarchy index and one eligibility pass over the leaf work on each read (24.8 ms p50 at 3,000 tasks measured in
isolation), and each responsibility card rolls up leaf work only.

The first implementation was worse and was replaced before this record was written: it recomputed the active and
leaf lists once per area and tested area membership with `Array#indexOf` inside the filter (quadratic in the task
count). The shipped code counts every group in one pass (`TaskScope.summariseBy`) and rolls up a leaf-only list, so
the remaining cost is the index build, not the grouping.

Cached navigation (< 100 ms) and local filtering (< 50 ms) targets are met with a wide margin and are unaffected by
the release. The RPC count after the first load is unchanged (`2 / 2 / 3`). A live Workspace comparison stays
**NOT_RUN**; the extra index build is local CPU and Sheets I/O dominates a real call, but that is not measured here.

## Historical V1.6 measurements

Measured 2026-10-28. Raw results: [V1_6_PERFORMANCE.json](checkgates/V1_6_PERFORMANCE.json).

## V1.6 comparison with V1.5.1

| Dataset | bootstrap p50 | bootstrap payload | taskIndex p50 | taskIndex payload | cached nav p50 | local filter p50 | RPC after load |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10 / 100 | 4.43 ms (4.01) | 10.5 KB (8.5) | 2.29 ms (1.75) | 16.5 KB (15.1) | 0.77 ms | 0.07 ms | 2 |
| 100 / 1,000 | 43.40 ms (35.25) | 57.3 KB (48.7) | 17.37 ms (15.52) | 166.8 KB (152.7) | 1.45 ms | 0.39 ms | 2 |
| 300 / 3,000 | 115.55 ms (113.22) | 152.7 KB (130.9) | 49.07 ms (47.99) | 509.8 KB (467.5) | 1.13 ms | 2.19 ms | 3 |

Figures in brackets are the V1.5.1 values. The increase is the responsibility cards, the four new task-index columns
(`parentId`, `container`, `depth`, `reviewState`) and the extra cached `TASK_REQUESTS` read used for the review state.
Cached navigation (< 100 ms) and local filtering (< 50 ms) targets are met with a wide margin, and the RPC count after
the first load is unchanged.

## Historical V1.5.1 measurements

## V1.5.1: what changed and what it measured

The V1.5 page asked the server for every view: opening 案件 cost two sequential RPCs (`references`, then `projects`) and タスク cost another, each one a full Apps Script execution with its own Sheets reads. The 30-second browser cache then forced a reload of everything after any write.

V1.5.1 adds one authorized snapshot for ordinary navigation:

| Operation | Table reads | Payload (10/100) | Payload (100/1000) | Payload (300/3000) | p50 ms (10/100/300) |
| --- | ---: | ---: | ---: | ---: | --- |
| `bootstrap` (overview + reference choices + every project summary + task count) | 9 | 8,515 B | 48,663 B | 130,867 B | 4.01 / 35.25 / 113.22 |
| `taskIndex` (compact columnar task summaries) | 3 | 15,052 B | 152,716 B | 467,516 B | 1.75 / 15.52 / 47.99 |
| `overview` (unchanged, for comparison) | 9 | 3,967 B | 7,483 B | 7,487 B | 4.28 / 38.15 / 104.38 |

`bootstrap` costs about the same server time as the previous `overview` because both read the same nine tables inside one read context; it simply returns the project summaries and the reference choices that used to arrive in separate calls. `taskIndex` is only requested when its size is known to be within the bound, and above 1,000 tasks it is fetched when タスク is first opened rather than at startup. Timings vary by a few milliseconds between runs on the same machine; the committed JSON is one complete run and is the authoritative record.

Navigation measured through the real client in the same harness (`entry.ui` in the raw JSON), with the previous release's client run on identical fixtures for comparison:

| Projects/tasks | Previous client: overview→projects→tasks | Previous nav p50 (projects / tasks) | V1.5.1 cached navigation p50 | V1.5.1 local filter p50 | V1.5.1 cached project open |
| --- | --- | --- | ---: | ---: | ---: |
| 10/100 | 4 read RPCs | 4.30 / 2.58 ms | **0.57 ms** (0 RPCs) | **0.06 ms** | **0.08 ms** |
| 100/1000 | 4 read RPCs | 25.94 / 12.08 ms | **1.45 ms** (0 RPCs) | **0.36 ms** | **0.06 ms** |
| 300/3000 | 4 read RPCs | 26.75 / 35.97 ms | **0.92 ms** (0 RPCs) | **1.80 ms** | **0.07 ms** |

First load and the first project open do pay for the snapshot:

| Projects/tasks | Previous first load (1 RPC) | V1.5.1 first load (2–3 RPCs) | First (uncached) project open | Navigation while a request is in flight |
| --- | ---: | ---: | ---: | ---: |
| 10/100 | 9.05 ms | 35.94 ms | 1.45 ms | 0.60 ms p50 |
| 100/1000 | 39.09 ms | 68.03 ms | 4.14 ms | 1.31 ms p50 |
| 300/3000 | 105.32 ms | 104.32 ms | 13.76 ms | 0.02 ms p50 |

These are Node/vm figures from the mocked harness, not browser paints or Workspace timings. The first-load difference is the project snapshot plus the background task index; at 300 projects it is within 2 % of the previous first load because the same nine tables dominate. Browser paint time, real RPC latency and real Sheets read time remain **NOT_RUN**. A live DEV measurement must record the actual account, dataset, timestamp, execution ID and deployment version.

## How the snapshot stays correct

- The snapshot is authorized on every call: `ManagerWeb.authorize()` re-checks `Session.getActiveUser()`, the allowed domains and `Access.requireManager()` before `bootstrap`/`taskIndex` run. Members and viewers cannot reach the manager web app at all.
- Datasets are all-or-nothing. Above `TASK_INDEX_LIMIT = 3000` tasks or `PROJECT_INDEX_LIMIT = 1000` projects the response reports `complete: false` and carries no rows, so the browser keeps the paginated `tasks`/`projects` operations. A partial list is never presented as complete.
- The task index contains only the allowlisted summary columns (id, names, project/subproject/owner/responsibility ids, deadline, status, progress, priority). Descriptions, acceptance criteria, estimates, notes and request text never reach the browser outside the single-record detail form.
- Local filtering mirrors the server filters (project, subproject, owner, status, responsibility, deadline range, sort. The free-text field only matches the fields the index holds; pressing 検索 still runs the server search over description and acceptance criteria, so a description-only match can never be silently missed.
- Every dataset has a 30-second freshness window. Cached data paints immediately, a background `bootstrap` (and, when it is itself stale, `taskIndex`) revalidates it, and the toolbar shows 最終更新 / 更新中…. Tab focus and `visibilitychange` revalidate a stale view.
- A write patches the affected summary rows, drops only the affected detail and aggregate entries, keeps unrelated cached views, and revalidates the affected dataset. "Saved" is only shown after the server confirmed the write. A refused write keeps the draft and the stored revision check remains authoritative.
- A response whose dispatch was superseded by a newer request, or by an invalidation (`api.clear`, a write, a revoked session), is discarded instead of repopulating the cache. `MANAGER_ACCESS_DENIED`/`Insufficient role` clears every cached view and unsent draft and blocks further requests.
- Nothing private is persisted: no localStorage/IndexedDB record cache and no server-side cache. The language preference remains the only browser-stored value.

## V1.5 measurements (historical)

Measured 2026-10-28 on Windows, Node v24.21.0, mocked Google services. **Real Workspace timings: NOT_RUN.** Raw results: [V1_5_PERFORMANCE.json](checkgates/V1_5_PERFORMANCE.json). Small/medium/large contain 10/100/300 projects, 100/1,000/3,000 tasks, two subprojects per project, active/retired responsibilities, four members, archived records and pending deadline/completion requests.

This section records the **V1.5 review-correction** measurement: the project list and overview no longer return the stored `PROJECTS.Progress_Percent` / `PROJECTS.Health` columns and instead derive progress, health, task counts and the neutral deadline state from current rows (`Dashboard.projectMetrics`). Every table is still read at most once per request; the derived values add the MILESTONES, ISSUES and AUTOMATION_SETTINGS reads that health classification needs. Task saves are unchanged and still skip the report refresh, so a save costs what it did before while the next read shows fresh values.

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

The 計測 / Diagnostics view (header button, every manager screen) shows the same numbers without DevTools: RPC count, local reuse, discarded stale responses, pending writes, dataset sizes and a per-operation table (calls, p50/p95 of the round trip or render, last server execution time and table reads). It also offers ローカルデータを破棄 / Clear local data. The measured window is the current page session only; nothing is uploaded or persisted.

Overview, project list/detail, task search/detail/create/update, request approval, manual publication and manual report refresh use the same instrumentation. First authorized response is the first bootstrap RPC; initial page paint should be measured with the browser Performance panel during DEV testing. Browser render/RPC p50/p95 and pure calculation timings remain NOT_RUN; local DOM tests verify ordering and loading behavior, not browser timing targets.

## Cache and remaining bottlenecks

Read tables/workbook are reused only within an Apps Script execution. Writes invalidate affected tables and lock acquisition discards stale reads before revision checks. The browser keeps an authorized in-memory snapshot for the session (see above) with a 30-second freshness window per dataset; `api.clear()` (diagnostics view) drops it explicitly; no private persistent/shared server cache exists. Heavy reports run only when explicitly requested. Task saves do not invoke Dashboard.refresh.

Remaining bottlenecks, measured rather than hidden:

- `bootstrap` returns every project summary, so its payload grows with the project count (131 KB at 300 projects). Above 1,000 projects the dataset is reported incomplete and the projects view returns to server paging.
- `taskIndex` grows with the task count (468 KB at 3,000 tasks) and is therefore fetched in the background (≤1,000 tasks) or when タスク opens. A very large dataset pays that payload once per session/staleness window.
- Local free-text filtering covers the summary fields only; description/acceptance-criteria matches need the explicit server search.
- The server still scans the TASKS table in memory after one batch read; Google Sheets is not an indexed database. The `tasks` operation now reads three tables instead of four because an unfiltered task read no longer loads projects and subprojects for the ancestor-aware active-work rule.
- Very large request/history queues and member directories still use plain server paging.

Project progress, health, task counts and deadline wording are derived on every project read (`Dashboard.projectMetrics`) instead of being taken from the stored `PROJECTS` columns, which only `Dashboard.refresh`/`Progress.refresh` rewrite. That keeps the overview and cards correct after a task save without a report refresh. The cost is one read each of MILESTONES, ISSUES and AUTOMATION_SETTINGS per request plus one `Health.classify` call per returned project; the paginated project list limits that to the visible page. Do not reintroduce a second stored copy of these values, and do not call `Dashboard.refresh` from a task save to fix staleness.

Each task query still scans the source TASKS table in memory after one batch read. Google Sheets is not an indexed database. Project and member reference choices are loaded on demand. Large request/history queues and very large member directories may need additional server paging beyond this release. Browser tables are paginated; no thousands-of-tasks dropdown is loaded.

Targets remain goals: local navigation approximately 100 ms, cached filters under 150 ms, warm Workspace overview under 3 seconds, project detail under 2 seconds, common save under 3 seconds. Measure warm/cold p50/p95 in DEV with the actual account, dataset, timestamp, execution ID and deployment version. Do not substitute mock timings for those targets.
