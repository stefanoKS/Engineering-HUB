# V1.6.1 gate 1 — One counting rule and scope-before-paging

Status: **PASS** (local) — **BLOCKED** for live verification
Date: 2026-10-29
Starting commit SHA: `ea3fbc9` (V1.6 delivery, `main`)
Branch: `fix/v1.6.1-stabilization`

## 1. Objective

Make every manager-facing number mean the same thing, and let a scope decide the numbers instead of the browser
filtering a page that was already cut.

## 2. Findings (audit of the V1.6 delivery)

1. `ManagerWeb.responsibilitySummaries` counted every non-Done/Cancelled task row, container tasks included, and
   ignored eligibility, while `Progress.rollup` counted leaf work only. The area card and the rollup disagreed about
   the same area.
2. `ManagerWeb.overviewCore` iterated the active task list counting containers in `soon`/`overdue`, and built one
   global top-five `upcoming` list **before** any responsibility scoping.
3. `overview()`/`bootstrap()` returned `page(projects, {limit: 20})`, and `ManagerWebClient` filtered that 20-row
   page locally, so an area with 50 projects showed only the matches inside the first 20.
4. `TaskTree.hasRecordedWork` only inspected `Actual_Hours`, `Progress_Percent`, `Completed_At` and `Status`, so a
   task with an approved assignment, a confirmed schedule, a recorded request or deadline history could be turned
   into a container and bury that history behind derived values.
5. `Tasks.assignmentFields` did not contain `Parent_Task_ID`, so reparenting a task never bumped
   `Assignment_Version` and never cleared a stale approval.

## 3. Required functionality

1. One counting policy: work item = leaf task; container = organisation only; open/overdue = open leaf work in
   active work; completed work reported separately and never mixed into a workload figure.
2. The scope is applied before paging and before the top-five cut; the totals describe the scope.
3. The conversion guard considers approval, schedule confirmation, request and audit history.
4. Reparenting is a material assignment change.

## 4. Relevant source files

`src/TaskScope.gs` (new: `create`, `summarise`, `summariseBy`, `upcoming`), `src/ManagerWeb.gs`
(`responsibilitySummaries`, `overviewCore`, `scopeInput`, `scoped`, `overview`, `bootstrap`),
`src/ManagerWebClient.html` (`viewFilters`, `peekView`, `load`, `revalidateView`, overview render, `areaCard`),
`src/TaskTree.gs` (`hasRecordedWork`, `historyFor`, `assertConvertible`), `src/Tasks.gs`
(`assignmentFields`), `shared/i18n.js` (`web.areaWorkItems`).

## 5. Acceptance criteria

- A container task never increases `openTasks`, `overdueTasks`, `kpis.soon` or `kpis.overdue`.
- The area card, the overview `counts` and the progress rollup report one rule.
- A scoped overview returns the scope total, not the page or cut length.
- `upcoming.items` is the first five of the scoped window and `upcoming.total` is the whole scoped window.
- A task with any recorded history refuses conversion to a container with the documented Japanese message.
- Moving a task under another task bumps `Assignment_Version` and clears `Assignment_Approved_At`.

## 6. Automated test cases

`tests/v1_6_1-counting.test.js` — 8 cases: container not counted as work; card/KPI/rollup agreement; overdue
restricted to open leaf work in active work (completed work excluded, archived branch leaves active work); scope
before paging (25-project area with `limit 20`); scoped upcoming with the top-five cut; container never a deadline
item; conversion guard for approval / schedule confirmation / recorded request and the allowed plain case;
reparenting invalidation. `tests/v1_6-responsibilities.test.js` was retargeted: selecting an area now performs
exactly one scoped `overview` read instead of filtering locally.

## 7. Actual test results

PASS locally: 8/8 new cases, and the retargeted responsibility test asserts the scoped read and payload. Full suite
**500 tests, 500 pass, 0 fail, 0 skipped**.

## 8. Manual test cases (DEV, not executed)

1. Seed one area with more than 20 projects and confirm the header, the KPI row and the project list agree.
2. Create a parent task with two children and confirm the area card counts the children, not the parent.
3. Select an area whose only near deadlines belong to another area and confirm the upcoming list is empty with a
   total of 0.
4. Archive a subproject with an overdue task and confirm the overdue count drops without losing the task.

## 9. Performance results

`TaskScope.create()` costs 24.8 ms p50 at 300 projects / 3,000 tasks; per-group counting is one pass
(`summariseBy`). Warm `bootstrap` 5.87 / 46.48 / 140.35 ms and 11.0 / 57.8 / 153.2 KB for 10/100/300 projects;
cached navigation 0.81 / 1.42 / 1.11 ms and local filtering 0.08 / 0.40 / 2.05 ms
([V1_6_1_PERFORMANCE.json](V1_6_1_PERFORMANCE.json)). See gate 6 for the comparison with V1.6.

## 10. Security review

No new entrypoint and no new write path: the counting policy is read-only and runs inside the existing authorized
read context. The scope input is validated as data (`responsibilityId` string or `unassigned` boolean) and can only
narrow what the caller can already read. No stored text reaches the browser through the new fields.

## 11. Problems found

- The first implementation of `responsibilitySummaries` used `rows.indexOf(task)` inside a per-area filter, which
  was O(n²); it was replaced by one grouped pass before the gate was recorded.
- `TaskScope.summarise` initially recomputed the active and leaf lists per call (once per area); it now accumulates
  into one bucket per group.

## 12. Final gate status

**PASS** locally (implementation, tests, lint, validation) — **BLOCKED** for live Workspace verification.

### Remaining blockers

Live rendering of the scoped figures and the real Workspace latency are **BLOCKED** (no DEV deployment in this
session).

**IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**
