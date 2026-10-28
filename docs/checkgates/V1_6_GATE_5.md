# V1.6 gate 5 — Nested tasks and progress rollup

Status: **PASS** (local) — **BLOCKED** for live verification
Date: 2026-10-28
Starting commit SHA: `c769cb5006b13130e1358df3cbad436068a3c3f8`
Implementation commit SHA: sealed in the delivery header (see §13)

## 1. Objective

Tasks may contain subtasks up to three levels, parent/child is organisation only, and a parent is never counted as
extra work beside its children.

## 2. Relevant source files

`src/TaskTree.gs` (limits, index, validation, leaf rollups, derived view), `src/Tasks.gs` (`validate` wiring),
`src/Progress.gs` (containers excluded from weighting), `src/ManagerWeb.gs` (task summaries, task index, hierarchy
filters), `src/ManagerWebClient.html` (indented task cards, subtask action, parent selector),
`src/SharedDashboardModel.gs` (derived status/progress, leaf-only aggregates),
`dashboard-app/DataService.gs` (nested ordering, leaf counts).

## 3. Required functionality

1. `Parent_Task_ID` referencing an existing task in the same project **and** the same subproject.
2. Three levels accepted, a fourth refused; self parent and cycles refused.
3. A task with children is a container: progress and completion derive from leaf work, and it is never counted
   twice in a project, subproject, report or published aggregate.
4. A task with recorded work, approval or completion is never silently converted into a container.
5. `Dependency_IDs` stays the separate sequencing constraint with its own cycle rule.
6. Container status/progress and cross-subproject moves are refused; an unrelated field stays editable.

## 4. Acceptance criteria

- Leaf-only rollups match the documented weight rules (known estimate, fallback weight 1, `Cancelled` excluded).
- Container derived completion is computed for display without rewriting stored columns.
- The task index carries `parentId`, `container`, `depth`, `reviewState` without a second read.

## 5. Automated test cases

`tests/v1_6-hierarchy.test.js` (levels, parents, cycles, conversion refusal, leaf rollup numbers, derived view,
refused manual edits, dependency separation, task index columns), `tests/v1_4-hierarchy.test.js` (rollup exactly
once), `tests/v1_5-project-metrics.test.js` (fresh metrics), `tests/v1_4-release.test.js` (contract parity).

## 6. Actual test results

PASS locally. With T1 (25 % of 40 h), T2 (unestimated) and a completed 2 h leaf, the project reads 27.91 %
(12 / 43) and the two containers contribute nothing.

## 7. Manual test cases (DEV, not executed)

1. Create 図面作成 → 断面図作成 → 寸法確認; confirm the fourth level is refused.
2. Try to add a child under a task that already has recorded hours; confirm the refusal message.
3. Complete a grandchild through the request workflow; confirm the parent cards show derived progress/status.
4. Confirm the stored sheet cells of the containers were not rewritten.

## 8. Performance results

`taskIndex` p50 2.08 / 16.49 / 48.48 ms and 16.5 / 166.8 / 509.8 KB for 100/1,000/3,000 tasks (+4 to +19 % latency,
+9 % payload versus V1.5.1). The hierarchy index is built once per response.

## 9. Security review

Parent links are validated server-side inside the script lock. A browser cannot place a task into another project,
another subproject, an archived branch or a cycle. Derived values never overwrite stored data, so a forged payload
cannot fake a completion.

## 10. Problems found

The first `taskSummary` implementation called `TaskTree.levelOf` twice per task and accepted a raw list, which was
O(n²). It now takes a prebuilt index.

## 11. Corrective actions

Added `TaskTree.buildIndex`/`viewIn` and one index per manager response.

## 12. Final gate status

**PASS** locally (implementation, tests, lint, validation) — **BLOCKED** for live Workspace verification.

### Remaining blockers

Live behaviour of three task levels in the DEV dashboard is **BLOCKED** (no deployment).

## 13. Commit SHA

Starting `c769cb5006b13130e1358df3cbad436068a3c3f8`; implementation SHA sealed in the delivery commit.
**IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**
