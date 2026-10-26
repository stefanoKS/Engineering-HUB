# V1.4.1 gate 3 — hierarchy, eligibility and calculations

Status: **PASS (local only)** — live Google Workspace behaviour remains UNVERIFIED.

Scope: `src/Subprojects.gs`, `src/Tasks.gs`, `src/Progress.gs`, `src/Eligibility.gs`,
`src/Notifications.gs`, `src/Reports.gs`, `src/Dashboard.gs`, `src/SharedDashboardModel.gs`.

## Hierarchy safety

| Check | Evidence |
| --- | --- |
| Third level, self-parent, cycle and cross-project parent are refused | `tests/v1_4_1-stabilization.test.js` → "the hierarchy stops at two levels and rejects self, cycle and cross-project parents" |
| Reparenting a root beneath a nested node is refused (would be level three) | same test |
| Reparenting a node beneath its own descendant is reported as a cycle | same test |
| IDs are never regenerated | same test (`S-CHILD`, `S-OTHER`, `S-ROOT`, `S1` unchanged) |
| Malformed (hand-edited) cycles terminate with the documented error | "malformed hierarchy data cannot recurse without bound" |
| A task cannot be created or moved beneath an archived ancestor | "a task is never placed inside an archived branch by accident" |
| An existing task in an archived branch stays editable and finishable | same test |
| Archiving cascades nothing (child status, task status, progress) | `tests/v1_4-hierarchy.test.js` and the same test |

`Subprojects.heightOf` and `Progress.subtreeTasks` carry a path/visited guard; `descendants` and
`Eligibility.subprojectInActiveWork` stop on a repeat. `Subprojects.archivedChain` treats a cycle or
an over-long chain as unsafe, so a move is refused rather than silently landing in archived work.

## One eligibility rule

`Eligibility.subprojectInActiveWork(subprojectId, projectId, index)` walks the whole ancestor chain
and returns `false` for a missing node, a cross-project link, an archived/non-working ancestor, a
cycle or a broken parent reference. It is used by:

| Consumer | Evidence |
| --- | --- |
| Active work / workload / dashboard metrics | "active work, reminders and published counts exclude an archived branch once" |
| Reminder eligibility (`Eligibility.taskNotifiable`) | same test — an archived ancestor suppresses the reminder |
| Weekly report (`overdue`, `missingEstimates`, `blocked`, `upcoming`) | `tests/v1_3-*` report cases plus the shared helper |
| Published snapshot aggregates | "a published snapshot counts only active work and never duplicates a nested task" |

Historic progress is not recomputed by an archive: the stored `SUBPROJECTS.Progress_Percent` is
only rewritten by a refresh, exactly as before.

## Calculations

| Check | Evidence |
| --- | --- |
| A parent subproject counts each descendant task once | `tests/v1_4-hierarchy.test.js`, "the snapshot publishes … hierarchical progress" |
| A project counts its own and every subproject's tasks once | `tests/gate2-progress.test.js`, `tests/v1_4-hierarchy.test.js` |
| Unknown effort is never invented | `tests/gate1-safety.test.js`, `tests/v1_4-hierarchy.test.js` |
| Weighted rollups keep the documented fallback weight | `tests/gate2-progress.test.js` |
| The published viewer shows each task exactly once | "a published snapshot counts only active work and never duplicates a nested task" |

## Not verified here

Real Sheets read volume for very large workbooks, and reminder delivery through the live mail gate.
