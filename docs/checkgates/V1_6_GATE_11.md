# V1.6 gate 11 — Performance and security regression

Status: **PASS** (local) — **BLOCKED** for live latency measurement
Date: 2026-10-28
Starting commit SHA: `c769cb5006b13130e1358df3cbad436068a3c3f8`
Implementation commit SHA: 34a2bf1

## 1. Objective

Keep the V1.5.1 local-first behaviour and the same security boundaries after adding the V1.6 features.

## 2. Relevant source files

`src/ManagerWeb.gs` (bootstrap, taskIndex, summaries), `src/ManagerWebClient.html` (snapshot store, cache,
invalidation, revocation), `src/ManagerWebApi.gs` (allowlist, spoofing refusal, revision checks),
`scripts/manager-web-benchmark.js` (`V1_6_PERFORMANCE.json`), `src/Access.gs`, `src/Roles.gs`.

## 3. Required functionality

1. One authorized snapshot; navigation, filtering and cached opening stay local (< 100 ms / < 50 ms targets).
2. In-flight deduplication, stale-while-revalidate, selective invalidation and revision-checked writes preserved.
3. Bounded hierarchy work: one index per response, bounded walks, cycle detection.
4. No private persistence in the browser; no new page-wide cache clear on every write.
5. All V1.4.1 authorization rules unchanged.

## 4. Acceptance criteria

- Cached navigation < 100 ms, local filtering < 50 ms at 300 projects / 3,000 tasks.
- RPCs after the first load do not exceed the V1.5.1 count (≤ 3).
- `npm test`, `npm run lint`, `npm run validate` and the benchmark are green.
- No unbounded growth: caches stay bounded, listeners are attached once, drafts are dropped on revoke.

## 5. Automated test cases

`tests/v1_5_1-performance.test.js` (one read per table, columnar index, no server call during navigation,
deduplication, stale repaint, selective invalidation, revocation), `tests/v1_5-web.test.js`
(private fields absent from payloads), `tests/gate-a-security.test.js`, `tests/v1_4_1-stabilization.test.js`
(role checks), `tests/v1_6-*` (bounded hierarchy, single index).

## 6. Actual test results — measured 2026-10-28 (mocked services)

| Dataset | bootstrap p50 / payload | taskIndex p50 / payload | cached nav p50 | local filter p50 | RPC after load |
| --- | --- | --- | --- | --- | --- |
| 10 projects / 100 tasks | 4.43 ms / 10.5 KB | 2.29 ms / 16.5 KB | 0.77 ms | 0.07 ms | 2 |
| 100 / 1,000 | 43.40 ms / 57.3 KB | 17.37 ms / 166.8 KB | 1.45 ms | 0.39 ms | 2 |
| 300 / 3,000 | 115.55 ms / 152.7 KB | 49.07 ms / 509.8 KB | 1.13 ms | 2.19 ms | 3 |

V1.5.1 reference: bootstrap 4.01 / 35.25 / 113.22 ms (8.5 / 48.7 / 130.9 KB), taskIndex 1.75 / 15.52 / 47.99 ms
(15.1 / 152.7 / 467.5 KB). V1.6 costs +2 to +23 % bootstrap latency, +2 to +31 % task-index latency, +17 %
bootstrap payload and +9 % task-index payload for the area cards, the four new task columns and the extra cached
`TASK_REQUESTS` read; single-machine mock timings fluctuate between runs, while the payload growth is deterministic.
Targets (cached navigation < 100 ms, local filtering < 50 ms) are met with a wide margin. Raw:
[V1_6_PERFORMANCE.json](V1_6_PERFORMANCE.json). **Live Workspace timing: NOT_RUN.**

## 7. Manual test cases (DEV, not executed)

1. Measure first load and cached navigation in DEV with 300 projects; record execution IDs.
2. Navigate overview → area → project → tasks repeatedly for two minutes; confirm no monotonic memory growth in
   the browser task manager.
3. Edit a record while a refresh is running; confirm the draft is not lost and the revision check refuses a stale
   save.
4. Revoke the account (deactivate the member) and confirm cached views plus drafts are dropped.

## 8. Problems found and corrected

1. Per-task review lookup → 2.4× task-index regression; fixed by one lookup per response (114 → 48.5 ms).
2. Per-task `levelOf` double call (O(n²)) → fixed with the prebuilt hierarchy index.
3. `bootstrap`/`taskIndex` grew by 15–17 % / 9 % payload for the new fields; accepted and recorded, not hidden.

## 9. Remaining blockers

Real network/service latency, quota recovery and long-session memory measurement are **BLOCKED** (no DEV
deployment or browser session). No live number is claimed.

## 10. Regression evidence

Cross-project hierarchy manipulation, cycle injection, excessive depth, fake parent IDs, task completion bypass,
duplicate completion request, stale approval, deleted-record references, non-ADMIN deletion, browser-supplied
actor/role spoofing, restricted-project publication leakage and cache invalidation after a role change are covered
by `tests/v1_6-*`, `tests/gate-a-security.test.js`, `tests/v1_4_1-stabilization.test.js`,
`tests/v1_5-publication.test.js` and `tests/v1_2-dashboard.test.js`.

## 11. Local gate sequence

`npm ci` exit 0; `npm run lint` exit 0; `npm test` all suites green; `npm run validate` exit 0;
`node scripts/manager-web-benchmark.js` exit 0.

## 12. Final gate status

**PASS** locally for tests, lint, validation and the mock benchmark. **BLOCKED** for live measurement.
Local sequence `npm ci`, `npm run lint`, `npm test`, `npm run validate`,
`node scripts/manager-web-benchmark.js` all exit 0. **NOT APPROVED FOR PRODUCTION.**

## 13. Commit SHA

Starting `c769cb5006b13130e1358df3cbad436068a3c3f8`; implementation SHA 34a2bf1.
