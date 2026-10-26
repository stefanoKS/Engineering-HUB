# V1.4 gate 3 — nested subprojects and calculations

Status: **PASS (local only)**

Scope: the two-level hierarchy, its validation, task association, archiving behaviour and the
rollups consumed by the dashboard, Gantt fallback, workload and snapshot.

## What was checked

| Check | Evidence |
| --- | --- |
| A nested subproject is created beneath a root subproject and IDs stay stable | `tests/v1_4-hierarchy.test.js` → "a nested subproject is created beneath a root subproject and keeps stable IDs" |
| Level 1 root, level 2 nested | same test (`Subprojects.levelOf`) |
| A third level is refused | "a third level, a self-parent and a cross-project parent are refused" |
| A self-parent is refused | same test |
| A cross-project parent is refused | same test |
| A missing parent is refused | same test |
| Reparenting a root with children is refused instead of flattening the tree | "reparenting a root that has children is refused instead of flattening the tree" |
| A valid reparent needs confirmation, is audited and moves no task | "a valid reparent is audited and never moves tasks" |
| A parent rollup counts its own and descendant tasks exactly once | "a parent subproject rolls up its own and descendant tasks exactly once" |
| The project rollup uses its own grouping, so nothing is double counted | same test (project 39.22 from 3 tasks, one of them unestimated) |
| Unknown effort stays unknown; no zero is invented | "a nested subproject keeps unknown effort unknown and never invents hours" |
| Archived parents remove descendants from active work but keep every row | "archiving a parent removes descendant tasks from active work but keeps every row" |
| Reactivating restores eligibility | same test |
| A task move is explicit, same-project only, and keeps the task's identity and schedule | "moving a task is explicit, stays inside the project and preserves the schedule" |
| A cross-project task move is refused | same test |
| Existing V1.3 gates still pass (progress, Gantt, workload, reports) | `tests/gate2-progress.test.js`, `tests/gate3-views.test.js`, `tests/v1_3-planning.test.js` |

## Weight rules (unchanged)

```text
known positive estimate  -> the estimate is the weight
unknown estimate         -> fallback weight 1, counted as unknown, never converted to hours
zero-hour estimate       -> no weight, still counted
Cancelled task           -> excluded
parent subproject        -> own tasks + every descendant task, once
project                  -> its own task grouping, once
```

## Performance

`Progress.refresh`, `Dashboard.analyze` and `SharedDashboardModel.build` read each table once,
build the hierarchy in memory (`Subprojects.childrenMap`, `Progress.subtreeTasks`) and then
aggregate. There is no recursive spreadsheet access. Depth is bounded to two, so the traversal is
constant work per node. The local mock scale benchmark in `tests/gate6-release.test.js` still
passes; it is a mock measurement, not Workspace evidence.

## Not verified here

Live Apps Script execution time, quota behaviour and the real Sheets read latency were not
measured. Confirm in a development deployment with a realistic number of projects and subtasks.
