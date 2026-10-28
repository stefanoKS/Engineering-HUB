# V1.6.2 gate 7 — Task responsibility filter

Status: **PASS** (local) — **BLOCKED** for live verification
Date: 2026-10-29
Starting commit SHA: `4154cab302565967f977362a3f32a688bd647201`
Branch: `fix/v1.6.2-reliability`

## 1. Objective

The task list must filter by the responsibility of the task's project reliably. Selection has to work for one
responsibility, for the 未分類 bucket and for a retired area that still owns projects; the browser (local snapshot)
and the server (paginated `tasks` operation) must produce the same result; and a project that moves between
responsibilities must never leave its tasks in the previous area's list. Schema **7**, the compact task-index
contract, the request/approval workflows, the colour picker and the local-first architecture are unchanged.

## 2. Confirmed root cause

Four defects, all in the manager web read path and its in-memory snapshot:

1. **`ManagerWeb.taskList` ignored `unassigned`.** It filtered only `input.responsibilityId`:
   `if (input.responsibilityId && String(projects[t.Project_ID].Responsibility_ID || '') !== input.responsibilityId) return false;`
   The client sends `{unassigned: true}` for 未分類 (`viewFilters`), so the server returned **every** task while the
   local path returned only unassigned ones. On a workbook above the index bound the two paths therefore disagreed.
2. **The local matcher omitted two server filters.** `matchesTask` never applied `treeScope: 'TOP'` or
   `parentTaskId`, so "最上位のみ / top level" (and a parent-scoped list) filtered on the server but not in a fully
   loaded snapshot. The status filter also compared the *displayed* status locally (a container task reports its
   derived completion from `TaskTree.viewIn`) while the server compared the stored `TASKS.Status` through
   `Tasks.list`, so a container whose leaves are all `Done` matched "完了" locally but not on the server.
3. **A project write did not invalidate the area data.** `afterWritePrefixes('projectSave')` returned
   `['bootstrap', 'references', 'project']`. The `taskIndex` cache entry, every scoped `tasks` page and every scoped
   `overview` payload survived, and `applyBootstrap` keeps the previous index rows while the record count is
   unchanged (`sameCount`). `syncTaskIndex` then skips the refresh because `store.at.tasks` is still fresh. A task
   summary copies its project's `Responsibility_ID`, so a transferred project's tasks stayed in the previous area's
   list for at least one freshness window, and `store.overview` kept the old area aggregates.
4. **Filter order and project scope.** `listFilters` appended the responsibility selector after every other task
   filter, and the project selector always offered every project. Choosing another area left an incompatible
   `projectId` selected, which produced a silently empty list with a project name that the area could not contain.

## 3. Before behavior

| Scenario | V1.6.2 result |
| --- | --- |
| `未分類` selected with more tasks than the index bound | Server returned every task; the local path returned only unassigned ones |
| "最上位のみ" on a fully loaded snapshot | No effect locally, filtered on the server |
| Container task with all leaves `Done` | Matched 完了 locally, missing from the server page |
| Project moved from area A to area B | Its tasks stayed in A's list (cached index row plus cached pages) and A's card kept the old aggregates |
| Switching responsibility with a project selected | Empty list, project filter still pointing at a project outside the area |
| Filter bar | Responsibility selector was the last control |
| Switching responsibility on a server-backed list | The previous area's rows stayed on screen until the new page arrived |

## 4. Corrected behavior

- One area rule (`inArea(scope, id)`) is shared by the overview and the task list: `unassigned` means "no
  responsibility", otherwise a named area or everything. `taskList` resolves the area through
  `TASKS.Project_ID -> PROJECTS.Responsibility_ID` (`responsibilityOf`); nothing is copied into `TASKS` and the
  schema is untouched.
- The status filter compares the value the list displays, on both sides: `taskList` filters with
  `TaskTree.viewIn(t, treeIndex).status` and no longer pushes `status` into `Tasks.list` (whose stored-column
  semantics stay unchanged for every other caller). All filters, including the area scope, are applied **before**
  `page()`, so `total` is the filtered count and an offset never crosses an unfiltered set.
- `matchesTask` now applies `treeScope: 'TOP'` and `parentTaskId`, so a fully loaded snapshot and the server page
  return the same rows for every documented filter combination.
- A project write invalidates the task index, the scoped task pages and the scoped overview:
  `afterWritePrefixes` returns `['bootstrap', 'references', 'project', 'tasks', 'taskIndex', 'overview']`, and
  `invalidateAreaSnapshot()` drops the index rows and the overview snapshot. The returned project row is applied to
  the local project summary (`patchProjectSummary`), so the project selector keeps offering only the selected area's
  projects instead of widening to every project. `settle` refetches the index after a project write, so the area
  data is restored instead of staying empty.
- The responsibility selector is the **first** control of the task filter bar. The project selector offers only the
  selected area's projects (or every project while the project index is not loaded, where the area cannot be proven);
  a `projectId` the area cannot contain is dropped before the results are computed, so the rebuilt selector visibly
  shows すべて while the status/member/priority/deadline filters are preserved. `未分類` stays selectable while it is
  the active scope, even at zero unassigned projects.
- Selecting an area resets every offset, clears the existing rows and repaints a loading state before the request; a
  superseded response is discarded by the existing `sequence`/token guard. A list view without any authorized result
  now shows the loading text instead of the previous scope's rows or an unconfirmed "no records".
- Retired areas keep working: the selector is built from `responsibilitySummaries`, which lists every
  `RESPONSIBILITIES` row regardless of `Status`, and the filter only compares stable IDs.

## 5. Source files modified

| File | Change |
| --- | --- |
| `src/ManagerWeb.gs` | `responsibilityOf`, `inArea`, `taskList` (unassigned scope, displayed-status filter, filtering before paging) |
| `src/ManagerWebClient.html` | `responsibilityFilter` (first in the task bar), `projectChoices`, `detachProjectOutsideArea`, `setActiveResponsibility` (offset reset, cleared rows, project reconciliation), `matchesTask` parity, `afterWritePrefixes`, `invalidateAreaSnapshot`, `patchProjectSummary`, `settle`, `repaintIfAllowed`, `renderList`, `load`, `patchSummary` area preservation |
| `tests/v1_6_2-task-filter.test.js` | Fourteen new cases (see below) |
| `docs/checkgates/V1_6_2_GATE_7.md`, `docs/checkgates/V1_6_2_GATE_7_PERFORMANCE.json` | This gate and its measured benchmark |
| `README.md`, `README_JP.md`, `CHANGELOG.md`, `docs/PRODUCTION_READINESS.md`, `docs/MANAGER_WORKFLOW.md`, `ARCHITECTURE.md`, `docs/MANAGER_WEB_APP_PERFORMANCE.md` | Operating documentation updated for the corrected filter, order and invalidation |

`shared/i18n.js` is untouched: no new user-visible string was needed (the existing `web.filterResponsibility`,
`web.allResponsibilities`, `web.unassigned`, `web.all` and `web.loading` labels are reused), so no translation copy
changed.

## 6. Test cases

`tests/v1_6_2-task-filter.test.js` — 14 cases:

| # | Case | Result |
| --- | --- | --- |
| 1 | Responsibility A returns only A's tasks; B returns only B's | PASS |
| 2 | `unassigned` returns only unassigned tasks and wins over a named area | PASS |
| 3 | A retired responsibility with existing projects stays filterable and listed | PASS |
| 4 | A → B project transfer moves its tasks and leaves the other list untouched | PASS |
| 5 | A renamed project keeps filtering by stable ID and shows the new name | PASS |
| 6 | A nested subtask inherits its project responsibility; `TOP` and `parentTaskId` combine with the area | PASS |
| 7 | Project, owner, status, priority and deadline filters combine with the area filter | PASS |
| 8 | The status filter follows the displayed status of a container task on the server | PASS |
| 9 | More than fifty tasks paginate inside the selected responsibility only | PASS |
| 10 | The responsibility selector is the first control; active, retired and 未分類 are all offered | PASS |
| 11 | Cached filtering and the server page agree for every area and filter combination | PASS |
| 12 | Switching area resets paging, drops an incompatible project and keeps compatible filters | PASS |
| 13 | A client `projectSave` transfer drops the index and the overview, patches the project summary, then shows both lists correctly | PASS |
| 14 | Rapid area switches on the server path never paint an older area page; an oversized index is not trusted | PASS |

## 7. Actual test results

```text
npm run lint      -> pass (eslint 10.13.0, no findings)
npm test          -> 567 tests, 567 pass, 0 fail, 0 cancelled, 0 skipped
                     (553 before this gate + 14 task-filter cases)
                     node --test tests/v1_6_2-task-filter.test.js -> 14 tests, 14 pass
npm run validate  -> 39 manager Apps Script files, 3 dashboard files, both manifests
                     and 817 translation keys validated
node scripts/manager-web-benchmark.js -> exit 0
output: docs/checkgates/V1_6_2_GATE_7_PERFORMANCE.json (liveWorkspace: NOT_RUN)
```

Benchmark (`BENCHMARK_OUTPUT=V1_6_2_GATE_7_PERFORMANCE.json`, mocked services, Node v24.21.0, local only):

| Dataset | `bootstrap` p50 / payload | `overview` p50 | `taskIndex` p50 / payload | Cached navigation | Local filtering |
| --- | --- | --- | --- | --- | --- |
| 10 projects | 7.52 ms / 11 152 B | 6.15 ms | 2.17 ms / 16 504 B | 2.50 ms | 0.10 ms |
| 100 projects | 49.12 ms / 57 911 B | 49.09 ms | 16.86 ms / 166 830 B | 1.43 ms | 0.41 ms |
| 300 projects | 142.89 ms / 153 325 B | 143.77 ms | 49.74 ms / 509 771 B | 1.18 ms | 1.45 ms |

The compact task index payload is byte-identical to the sealed V1.6.2 measurement (16 504 / 166 830 / 509 771 B):
no column was added to the index, and the area filter adds nothing per interaction because it filters data the
browser already holds. Timings stay inside the recorded envelope. The sealed `V1_6_2_VALIDATION.txt`,
`V1_6_2_PERFORMANCE.json` and gates 1–6 were left unchanged.

## 8. Security implications

- No entrypoint, action, Script Property, schema field or migration was added. `managerWebRead('tasks')` still runs
  through `ManagerWeb.authorize()` (domain allowlist plus `Access.requireManager`).
- The area is derived on the server from `PROJECTS.Responsibility_ID`; a browser-supplied `responsibilityId`,
  `unassigned` or `projectId` remains a filter value, never authority, and cannot widen or bypass the role check.
- No `TASKS.Responsibility_ID` column exists or was added, so a task cannot carry a second, spoofable area.
- The response stays the allowlisted compact summary (no description, acceptance criteria, notes or hours).
- Stored text is still rendered with `textContent`/DOM creation; `npm run validate` passes with no markup insertion.

## 9. Performance implications

No additional workbook read was introduced. `taskList` still reads each table once; the displayed-status comparison
only runs when a status filter is present (`TaskTree.viewIn` per row, and the page still builds one summary per visible
row). A project write costs one extra `taskIndex` read and one bootstrap read, which is the price of never showing a
moved project under its previous responsibility. Cached navigation (1.18–2.50 ms) and local filtering (0.10–1.45 ms)
stay inside the documented bounds of the local-first design.

## 10. Known limitations

- A free-text `query` is still matched on the server across description and acceptance criteria while the local
  snapshot matches name, ID, project, owner and subproject; pressing 検索 therefore remains the authoritative search
  (the hint in the filter bar says so). This is unchanged by this gate.
- The area scoping of the project selector needs the project index; above its bound the selector offers every project
  and the area filter alone still decides the rows.
- The load state is text, not a skeleton with placeholder rows, because a placeholder row is still a row.
- Browser paint, zoom and screen-reader behaviour remain manual Workspace checks.

## 11. Remaining blockers

All live criteria are **BLOCKED / NOT_RUN**: DEV deployment of the manager web app, `Session.getActiveUser()` inside
the Workspace domain, the filter in a real browser with a real schema-7 workbook, and browser paint timings. No
deployment, migration, trigger, mail, publication or data change was performed for this gate.

## 12. Final gate status

**PASS** locally (implementation, 14 gate tests, 567-test suite, lint, validation, benchmark) — **BLOCKED** for live
Workspace verification. `docs/PRODUCTION_READINESS.md` stays **NOT APPROVED FOR PRODUCTION**.

Implementation commit SHA: recorded by the evidence commit that adds this file.

**IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**
