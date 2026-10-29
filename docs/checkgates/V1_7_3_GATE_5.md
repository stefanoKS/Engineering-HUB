# V1.7.3 GATE 5 — Caching policy, regression and release record

| Field | Value |
| --- | --- |
| Release line | V1.7 corrective change (application version `1.7.3`) |
| Scope | Full suite, lint, source validation, documentation |
| Result | **PASS (local)**; live Workspace verification **BLOCKED / NOT_RUN** |
| Backend impact | None beyond GATE 1–4 |

## 1. Caching policy (PHASE 6 decision)

**Deferred.** No cross-user or cross-execution server cache of the private management workbook was
introduced. Google Sheets stays authoritative, and the only reuse is the execution-local read context
(`Database.withReadContext` / `Database.memo`), which dies with the Apps Script execution.

A future server-side cache would have to demonstrate all of the following before it could ship; none is
implemented today:

| Requirement | Today |
| --- | --- |
| Revalidate the caller's authorization before serving data | only per request |
| Correct environment + identity scoping | not implemented |
| Bounded size and expiry | not implemented |
| Invalidate on every application write | not implemented (execution-local only) |
| Account for direct edits in Google Sheets | not implemented |
| Never serve stale data for approvals, deletions or request decisions | guaranteed only because there is no cache |
| Safe fallback on cache failure | n/a |

The employee snapshot publication and its hash validation are unchanged by this release.

## 2. Regression evidence

```
node --test tests/*.test.js
ℹ tests 649
ℹ pass 649
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```

| Gate | Command | Result |
| --- | --- | --- |
| Lint | `node node_modules/eslint/bin/eslint.js .` | PASS (no findings) |
| Source validation | `node scripts/validate-source.js` | PASS — 42 manager files, 3 dashboard files, both manifests, 970 translation keys |
| Local benchmark | `BENCHMARK_OUTPUT=V1_7_3_PERFORMANCE.json node scripts/manager-web-benchmark.js` | PASS — written to `docs/checkgates/V1_7_3_PERFORMANCE.json` |
| Full suite | `node --test tests/*.test.js` | 649 pass / 0 fail / 0 skipped |

New coverage in this release:

| Area | Test file |
| --- | --- |
| Numeric `Snapshot_Version`, approval idempotency, reject/return/stale, strict other fields | `tests/v1_7_3-correctness.test.js` |
| Editor race, Escape dismissal, latest-row edit, editor allowlist, version | `tests/v1_7_3-correctness.test.js` |
| Parent search above one page (server and client) | `tests/v1_7_3-correctness.test.js` |
| One read per table, no task-index prefetch, compact/detailed metrics, diagnostics page | `tests/v1_7_3-performance.test.js` |
| Write batching, formula/custom column preservation | `tests/v1_7_3-performance.test.js` |
| `batchGet` equivalence and fallback | `tests/v1_7_3-performance.test.js` |
| DEV benchmark is read-only and environment-gated | `tests/v1_7_3-performance.test.js` |

Three pre-existing tests encode behaviour this release deliberately changes; they were updated, never
weakened:

| Test | Change |
| --- | --- |
| v1.5.1 "navigation between overview, projects and tasks never calls the server" | opens タスク once (the on-demand index read), then asserts zero further RPCs |
| v1.5.1 "existing writes still go through the validated domain path" | asserts exactly one authorized detail read per editor open instead of zero |
| v1.5 "older startup response cannot replace newer navigation" | asserts the snapshot no longer prefetches the task index |
| v1.6.2 version agreement | asserts the single `APP_VERSION` constant and that `1.6.1` is gone |

## 3. Documentation updated

`AGENTS.md` (rules 111–122), `README.md`, `README_JP.md`, `CHANGELOG.md`, `ARCHITECTURE.md`,
`DEPLOYMENT.md`, `docs/MANAGER_WEB_APP.md`, `docs/MANAGER_WEB_APP_PERFORMANCE.md`,
`docs/PRODUCTION_READINESS.md` (still **NOT APPROVED FOR PRODUCTION**) and this gate set.

## 4. Deliberately not done

- No migration, no schema change (schema stays **8**), no employee contract change (stays **1.6**).
- No deployment, no initialization, no trigger, no notification or Calendar activation.
- No production data touched; no request replayed; no backup deleted.
- No server cache, no blanket RPC concurrency increase, no full-row write.

## 12. Final gate status

| Criterion | Status |
| --- | --- |
| Remaining correctness defects fixed | **PASS (local)** |
| Existing workflows unchanged and green | **PASS (local)** |
| Claimed Sheets improvement backed by *local* measurements | **PASS (local, explicitly labelled)** |
| Claimed Sheets improvement backed by *real DEV* measurements | **BLOCKED / NOT_RUN** |
| Documentation updated for every behavioural change | **PASS (local)** |
| Production readiness | **NOT APPROVED FOR PRODUCTION** |


