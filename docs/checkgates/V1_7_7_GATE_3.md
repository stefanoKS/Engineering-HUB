# V1.7.7 GATE 3 — Preservation, release integrity and validation

| Field | Value |
| --- | --- |
| Release line | V1.7.7 corrective release (application version `1.7.7`) |
| Scope | release metadata, non-regression of the v1.7.6 fixes, lint/test/validate/benchmark evidence |
| Result | **PASS (local)**; live Workspace verification **BLOCKED / NOT RUN** |
| Backend impact | No schema, migration, property, contract, authorization or publication change |

## 1. Release metadata

| Marker | Value |
| --- | --- |
| `src/Config.gs` → `APP_VERSION` | `1.7.7` |
| `src/ManagerWebIndex.html` → header badge | `V1.7.7` |
| `package.json` → `version` | `1.7.7` |
| `package-lock.json` → `version`, `packages[""].version` | `1.7.7` |
| `Schema.version` | `8` (unchanged) |
| Employee publication contract | `1.6` (unchanged) |
| `SharedDashboardPublisher.PUBLISHER_VERSION` | `1.7.0` (unchanged) |
| `APPROVED_MIGRATIONS` | unchanged (7 reviewed IDs, no new migration) |

## 2. Behaviour preserved from v1.7.6 and earlier

Verified by the existing suites, which are unchanged in intent and all pass:

- request decisions invalidate the compact index, the task/project pages, the scoped overview payloads
  and the snapshot aggregates; an import is judged by `imported.imported`;
- `revoke()` advances the page, editor, task-index and request-sync generations, and a delayed answer
  never repaints after a revocation;
- `invalidatePrefixes()` supersedes the in-flight read as well as the cached payload, and a superseded
  view read re-reads once;
- task-summary metadata preservation, multiple assignees, nested hierarchy, `Parent_Task_ID` persistence,
  request decision idempotency, task-index mismatch recovery, generation-based stale-response protection,
  `.length`/response-contract validation, the no-draft editor, project and responsibility filtering,
  project colours and the measured Sheets read/write optimisations;
- no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `localStorage` or `sessionStorage`
  in the manager client; the dashboard keeps no forbidden service.

Two release-record assertions were re-pointed at the current implementation, not weakened: the version
markers of the earlier release suites now name `1.7.7`, and the v1.7.6 record now pins
`if (imported) requestChangedDerived()` — the v1.7.6 intent (an import that changed nothing pays for no
index read) is unchanged.

## 3. Validation commands

| Command | Result |
| --- | --- |
| `npm ci` | PASS (dependencies restored from the lockfile) |
| `npm run lint` | PASS |
| `npm test` | **PASS — 765 tests, 765 pass, 0 fail, 0 skipped** |
| `npm run validate` | PASS (manager files, dashboard files and translation keys) |
| `node scripts/manager-web-benchmark.js` | PASS — `docs/checkgates/V1_7_7_PERFORMANCE.json` |

## 4. Sheets service work

`docs/checkgates/V1_7_7_PERFORMANCE.json` (`liveWorkspace: "NOT_RUN"`, mocked Google services, local
execution only) at 10 / 100 / 300 projects (100 / 1,000 / 3,000 tasks):

| Operation | Range reads | Write calls | Cells written |
| --- | --- | --- | --- |
| `bootstrap` | 10 | 0 | 0 |
| `overview` (all areas) | 10 | 0 | 0 |
| `taskIndex` | 6 | 0 | 0 |
| `projectList` | 8 | 0 | 0 |
| `projectDetail` | 5 | 0 | 0 |
| `taskSearch` | 6 | 0 | 0 |
| `taskDetail` | 5 | 0 | 0 |
| `taskSave` (update) | 17 | 6.33 | 22.33 |
| `taskSave` (create) | 13 | 4 | 51 |
| `requestDecide` (approval) | 19 | 14 | 60 |
| `reportRefresh` | 14 | 13.67 / 22.67 / 42.67 | 2,628 / 22,629 / 67,075 |

`reportRefresh` grows with the workbook (100 / 1,000 / 3,000 tasks) because it rewrites the generated
report rows; the counts are identical to the v1.7.6 record for every operation. The release changes client
control flow only and adds no server-side cache, no `batchGet`, no polling and no extra write.

## 5. No database, deployment or automation action

No initialization, no migration, no backup, no deployment, no trigger installation and no
notification/Calendar activation was performed. Production data was not touched.

## 6. Remaining blockers

Live Workspace verification is **BLOCKED / NOT RUN**: the DEV Workspace smoke plan in
`docs/MANAGER_WEB_APP_DEPLOYMENT.md` and the recorded Workspace evidence still have to be produced by an
authorized person. `docs/PRODUCTION_READINESS.md` stays **NOT APPROVED FOR PRODUCTION**, and this release
is only ready for real DEV Workspace testing.

## 7. Final gate status

Status: **PASS (local)** — **BLOCKED** for live verification. Production readiness: **NOT APPROVED FOR
PRODUCTION**.
