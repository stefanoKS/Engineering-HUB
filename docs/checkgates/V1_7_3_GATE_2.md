# V1.7.3 GATE 2 — Measurement and the DEV benchmark

| Field | Value |
| --- | --- |
| Release line | V1.7 corrective change (application version `1.7.3`) |
| Scope | `src/Database.gs`, `src/ManagerWeb.gs`, `src/ManagerWebClient.html`, `src/DevBenchmark.gs`, `shared/i18n.js` (and its two generated copies), `scripts/manager-web-benchmark.js`, `tests/v1_7_3-performance.test.js` |
| Result | **PASS (local instrumentation)**; real Workspace measurement **BLOCKED / NOT_RUN** |
| Backend impact | No schema, migration, property, authorization or publication change |

## 1. What is measured now

| Measurement | Where | Sent by default |
| --- | --- | --- |
| Browser RPC queue wait | `rpc()` — `queueMs` | client only |
| Browser ↔ server round trip | `rpc()` — `serverRoundTripMs` | client only |
| Apps Script execution | `ManagerWeb.response` — `executionMs` | yes |
| Workbook opening | `Database.book()` — `openMs` | detail only |
| Environment binding verification | `Database.book()` — `bindMs` | detail only |
| Per-table read time | `Database.data()` — `tableMs[table]` | detail only |
| Number of table/range reads | `readContext.reads` / `rangeReads` | `tableReads` yes, `rangeReads` detail |
| Number of spreadsheet writes | `readContext.writes` / `cellsWritten` | detail only |
| Lock waiting | `Database.withLock()` — `lockMs` | detail only |
| Response serialization | `response()` — `serializationMs` | detail only |
| Response payload size | `response()` — `payloadBytes` (UTF-8 bytes) | yes |

The detailed envelope is returned **only** when the caller sets `diagnostics: true`; the ordinary
response carries `executionMs`, `tableReads` and `payloadBytes`, which keeps the V1.5 payload bound
intact (a 100-project `overview` stays at 9,956 B including its measurement envelope).

No spreadsheet ID, e-mail address, cell value, record text or request text is placed in a metric.
`V1_7_3_GATE_1` and the performance test assert that the envelope does not contain record content.

## 2. 計測 / Diagnostics page

`計測` now shows: RPC count, local reuse, discarded stale responses, pending writes, sum of table
reads, largest payload, and a per-operation table with queue p50, round-trip p50/p95, server p50 and
the last sheet-read count. A new **詳細計測を実行** button runs a read-only measurement of
`bootstrap`, `overview(areas:false)`, `taskIndex`, `projects`, `tasks`, `references` and the request
queue with `diagnostics: true`, and shows workbook opens, range reads, writes, cells written, lock
wait, environment-check time, serialization and round-trip p50 per operation.

## 3. Safe DEV procedure

`devBenchmarkManagerWeb(repeats)` in `src/DevBenchmark.gs`:

- requires `Access.requireManager()` and `ENVIRONMENT=DEVELOPMENT`; production refuses;
- runs only manager **reads** (`readOnly` execution, so a write is refused by `Database`);
- never imports the inbox, publishes a snapshot, sends mail, touches Calendar or installs a trigger;
- returns/publishes only timings and service-call counts, with cold (first) and warm (p50/p95) values
  per operation;
- logs one JSON line through `console.info` so the developer can paste it into
  `docs/MANAGER_WEB_APP_PERFORMANCE.md`.

## 4. Local results (mocked services — NOT a Workspace measurement)

Raw: [V1_7_3_PERFORMANCE.json](V1_7_3_PERFORMANCE.json). See
[MANAGER_WEB_APP_PERFORMANCE.md](../MANAGER_WEB_APP_PERFORMANCE.md) for the table.

| Dataset | bootstrap p50 | taskIndex p50 | taskUpdate p50 | first load (client) | cached nav p50 |
| --- | --- | --- | --- | --- | --- |
| 10 projects / 100 tasks | 5.46 ms | 2.29 ms | 2.31 ms | 28.98 ms | 0.85 ms |
| 100 / 1,000 | 47.18 ms | 18.86 ms | 17.62 ms | 57.29 ms | 1.50 ms |
| 300 / 3,000 | 138.41 ms | 56.87 ms | 47.30 ms | 169.65 ms | 3.06 ms |

## 5. Workspace comparison

| Operation | Previous DEV figure | V1.7.3 DEV figure | Status |
| --- | --- | --- | --- |
| Bootstrap | ≈ 7.74 s | — | **NOT_RUN** |
| Requests | ≈ 6.03 s | — | **NOT_RUN** |
| Task index | ≈ 4.97 s | — | **NOT_RUN** |

Mock timings are never substituted for service latency.

## 12. Final gate status

| Criterion | Status |
| --- | --- |
| Every listed operation is instrumented | **PASS (local)** |
| Diagnostics page shows the summarized values | **PASS (local)** |
| Detailed envelope is opt-in and content-free | **PASS (local)** |
| DEV benchmark is read-only and environment-gated | **PASS (local)** |
| Cold and warm DEV measurement recorded | **BLOCKED / NOT_RUN** |
