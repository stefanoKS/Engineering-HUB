# V1.5.1 gate 7 — Performance checkgate

Status: **PASS** (local targets) — live Workspace latency **NOT_RUN**
Date: 2026-10-28
Starting commit SHA: adde446e856f992d16aca18b116489126b9a57c7

## 1. Objective

Measure the required scenarios at the required dataset sizes, record p50/p95 where samples allow,
and separate local mock evidence from live Workspace verification.

## 2. Affected source files

Measured: `src/ManagerWeb.gs`, `src/ManagerWebClient.html`, `src/Tasks.gs`. Evidence:
`docs/checkgates/V1_5_1_PERFORMANCE.json`, produced by `scripts/manager-web-benchmark.js`.

## 3. Exact acceptance criteria and result

| Target | Result | Status |
| --- | --- | --- |
| Cached navigation < 100 ms | 0.57 / 1.45 / 0.92 ms p50 (10/100/300 projects) | PASS |
| Cached search/filter < 50 ms | 0.06 / 0.36 / 1.80 ms p50 (10 samples each) | PASS |
| Cached project open < 100 ms | 0.08 / 0.06 / 0.07 ms | PASS |
| Responsive while a request runs | 0.60 / 1.31 / 0.02 ms p50 with one pending refresh | PASS |
| Server operations measured, not guaranteed | bootstrap 4.01 / 35.25 / 113.22 ms p50; taskIndex 1.75 / 15.52 / 47.99 ms p50; taskUpdate 2.74 / 16.93 / 57.58 ms p50 | PASS |
| Datasets 10/100, 100/1,000, 300/3,000 | all three measured | PASS |
| Simulated 5-second RPC | 2 s per RPC in `?scenario=slow`; navigation stayed at 6 ms | PASS (2 s, not 5 s) |
| Live Workspace latency | not attempted | NOT_RUN |

## 4. Automated tests performed

`v1_5_1-performance.test.js` asserts the bounds and the local-mode invariants; the benchmark is
reproducible with `node scripts/manager-web-benchmark.js`.

## 5. Manual tests performed

Preview browser (`normal`, `large`, `slow`, `error`, `empty`): navigation 0.4–6 ms, typing
0.2–1.3 ms, cached detail 0.2 ms, 0 additional RPCs; refresh during a 2 s delay kept the page
interactive.

## 6. Test commands

node scripts/manager-web-benchmark.js; npm run preview:manager-web.

## 7. Actual results

First load (harness, includes vm compile): previous client 9.05 / 39.09 / 105.32 ms with 1 RPC;
V1.5.1 35.94 / 68.03 / 104.32 ms with 2–3 RPCs. First (uncached) project open: 1.45 / 4.14 /
13.76 ms. Read RPCs to show overview → projects → tasks: 4 before, 0 after the first load.
Payloads: bootstrap 8,515 / 48,663 / 130,867 bytes; taskIndex 15,052 / 152,716 / 467,516 bytes.
Range reads per call: bootstrap 10 (9 tables + marker), taskIndex 4 (3 tables + marker), one
workbook open each. Repeated runs on the same machine differ by a few milliseconds; the committed
JSON is one complete run.

Spreadsheet read time is only observable as the mock's synchronous read cost inside `dataMs`; the
real Sheets service latency is NOT_RUN. Browser render/paint time is NOT_RUN; the recorded render
values are DOM work in Node.

## 8. Relevant logs and evidence

[V1_5_1_PERFORMANCE.json](V1_5_1_PERFORMANCE.json), [V1_5_1_VALIDATION.txt](V1_5_1_VALIDATION.txt),
[performance document](../MANAGER_WEB_APP_PERFORMANCE.md),
[DEV smoke plan](../MANAGER_WEB_APP_SMOKE_TEST.md).

## 9. Identified problems

A "5-second delay" scenario was exercised at 2 s (the preview server's fixed delay). The first
load is measurably slower than V1.5 because it now carries the snapshot.

## 10. Corrective actions

The delay scenario documents its actual 2 s value instead of claiming 5 s; the first-load cost is
reported with its payload sizes and the reasoning (one execution, later navigation free).

## 11. Remaining limitations

No live latency claim is made anywhere. Live p50/p95, cold start and quota behaviour require a DEV
deployment and must be recorded with account, dataset, timestamp, execution ID and version.

## 12. Final gate status

**PASS** for the local targets, **NOT_RUN** for live measurements.
**IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**
