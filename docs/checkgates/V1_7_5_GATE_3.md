# V1.7.5 GATE 3 — Performance preservation, release and documentation

| Field | Value |
| --- | --- |
| Release line | V1.7.5 corrective release (application version `1.7.5`; V1.7 has not been deployed) |
| Scope | `src/Config.gs`, `src/ManagerWebIndex.html`, `src/Ui.gs` (`taskPatch`, task create), `tests/v1_7_5-*.test.js`, `AGENTS.md`, `CHANGELOG.md`, `README.md`, `README_JP.md`, `docs/checkgates/V1_7_5_*` |
| Result | **PASS (local)**; live Workspace verification **BLOCKED / NOT_RUN** |
| Backend impact | No schema change (still **8**), no migration, no new Script Property, no new API operation, employee contract still **1.6** |

## 1. Preserved invariants

| Invariant | Status |
| --- | --- |
| Database schema version | **8** (unchanged) |
| Employee publication contract | **1.6** (unchanged) |
| Migrations | unchanged (`APPROVED_MIGRATIONS` untouched) |
| Authorization rules | unchanged — no new entrypoint, no new role check, no browser-supplied authority |
| Audit and approval safeguards | unchanged — no change to `Access`, `Roles`, `Completion`, `Requests.decide`, `Notifications` |
| Project colours and styling | unchanged (no stylesheet change in this release) |
| Deployment topology | unchanged (`src/` container-bound + `dashboard-app/` standalone) |
| Notification, Calendar, publication defaults | unchanged (OFF by default) |

## 2. Spreadsheet and RPC cost

Benchmark (`node scripts/manager-web-benchmark.js`, `docs/checkgates/V1_7_5_PERFORMANCE.json`,
1,000 tasks dataset; v1.7.4 record from `V1_7_3_PERFORMANCE.json`) — every figure is identical:

| Operation | Range reads v1.7.4 → v1.7.5 | Write calls | Payload bytes |
| --- | --- | --- | --- |
| `overview` | 10 → 10 | 0 → 0 | 9956 → 9956 |
| `bootstrap` | 10 → 10 | 0 → 0 | 58070 → 58070 |
| `taskIndex` | 6 → 6 | 0 → 0 | 200871 → 200871 |
| `projectList` | 8 → 8 | 0 → 0 | 20959 → 20959 |
| `taskDetail` | 5 → 5 | 0 → 0 | 1068 → 1068 |
| `taskSearch` | 6 → 6 | 0 → 0 | 4315 → 4315 |
| `taskUpdate` | 17 → 17 | 6.33 → 6.33 | 942 → 942 |
| `taskCreate` | 13 → 13 | 4 → 4 | 999 → 998 |
| `requestApproval` | 19 → 19 | 14 → 14 | 192 → 192 |

Client reads after the initial paint: `rpcAfterInitialLoad = 2` at 100, 1,000 and 3,000 tasks (one
compact index, one project page), and `taskIndexLoaded = true` in every dataset.

Client timings are single local samples on a shared machine and are recorded, not compared as a
regression signal: this run reports first load 55.57 / 69.05 / 160.17 ms and cached navigation p95
1.81 / 2.17 / 4.25 ms, while the v1.7.4 record (`V1_7_3_PERFORMANCE.json`) reports 28.98 / 57.29 /
169.65 ms and p95 1.01 / 2.07 / 3.22 ms. Repeated runs of both records vary by the same order of
magnitude, and the 3,000-task case is faster in this run. Nothing in this release adds a backend
call: a task save replaces a whole-snapshot refresh with one compact-index read, so the number of
reads after a save did not grow.

## 3. Release mechanics

- `src/Config.gs` declares `APP_VERSION = '1.7.5'`; the overview, publication page, システム状態 and the
  header badge (`ManagerWebIndex.html`) show the same value.
- The three historical assertions that pinned `1.7.4` (`v1_6_2-release`, `v1_7_3-correctness`,
  `v1_7_3-performance`) were updated to the new value; they still assert that one constant feeds every
  surface. No assertion was weakened or removed.
- No test was deleted, skipped or relaxed anywhere in this release.

## 4. Documentation

| Document | Change |
| --- | --- |
| `CHANGELOG.md` | V1.7.5 section: every confirmed defect, root cause, correction, test and measurement |
| `README.md`, `README_JP.md` | current-release section rewritten; V1.7.4 kept as a historical record |
| `AGENTS.md` | V1.7.5 mandatory rules 131–138 |
| `docs/checkgates/V1_7_5_GATE_1..3.md`, `V1_7_5_PERFORMANCE.json` | this release's evidence |
| `docs/PRODUCTION_READINESS.md` | unchanged status: **NOT APPROVED FOR PRODUCTION** (live evidence still missing) |

## 5. Evidence

```
npm ci                                                  # PASS
node node_modules/eslint/bin/eslint.js .                 # PASS (no findings)
node --test                                              # 722 tests, 722 pass, 0 fail, 0 skipped
node scripts/validate-source.js                          # PASS (42 manager files, 3 dashboard files, 970 keys)
node scripts/manager-web-benchmark.js                    # PASS, liveWorkspace NOT_RUN
```

## 6. Remaining limitations and risks

| Item | Status |
| --- | --- |
| Live Workspace (HTML Service, real Sheets latency, multiple users) | **BLOCKED / NOT_RUN** — required before production approval |
| A task save on タスク refreshes the compact index; the KPI/aggregate figures are re-read on the next page that shows them (documented lazy refresh, no stale aggregate is claimed) | Accepted design |
| An in-flight `bootstrap` read is not superseded by an unrelated write (only cached payloads are); the write's own revalidation still corrects the view | Accepted, unchanged from v1.7.4 |
| Two concurrent 申請一覧 entries may both import; the server import is idempotent per inbox request ID and no duplicate request or audit row is created | Accepted, verified by test |
| `docs/PRODUCTION_READINESS.md` | **NOT APPROVED FOR PRODUCTION** |

## 7. Final gate status

| Criterion | Status |
| --- | --- |
| No known task display metadata corruption after save | **PASS (local)** |
| No outdated asynchronous response overwrites a newer UI state | **PASS (local)** |
| No permanent loading caused by task-index mismatches | **PASS (local)** |
| No unhandled `.length` exception from malformed or missing fields | **PASS (local)** |
| Request approvals and synchronization remain safe and idempotent | **PASS (local)** |
| No unnecessary Google Sheets performance regression | **PASS (local, measured)** |
| All existing workflows and tests pass | **PASS (local, 722 tests)** |
| Suitable for DEV validation, live Workspace testing still required | **PASS (local scope)** |
