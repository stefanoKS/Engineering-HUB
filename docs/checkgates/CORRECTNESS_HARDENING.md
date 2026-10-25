# Gate C — Management correctness hardening

Status: **PASS (local tests)**

## C1. Health result structure

Root cause: `Health.classify` returned `staleDays: limits`, i.e. the *thresholds object* under a numeric field
name. Any consumer treating `staleDays` as a number received an object.

Correction: `staleDays` is now the numeric age (days since `Last_Updated`/`Created_At`, `null` when unknown) and
the limits live under `thresholds: {staleDays, milestoneApproachDays, delayToleranceDays, staleAlert}`.

Test: `tests/gate-c-correctness.test.js` asserts `typeof staleDays === 'number'`, that
`staleDays.staleDays` does not exist, the threshold values, and that `evaluateProjectHealth` returns exactly
`evaluatedOn, health, reasons, staleDays, thresholds`.

## C2. Dashboard attention categories

Root cause: `projectsUnknownSchedule` was filled for every project whose health was YELLOW/RED/UNKNOWN
(`Health.isAttention`), so blocked, overdue, stale or critical-issue projects were all reported as having an
unknown schedule.

Correction: independent categories, each with its own source of truth:

| Category | Source |
| --- | --- |
| `unknownScheduleProjects` | Active project with neither `Committed_Deadline` nor `Forecast_End` |
| `atRiskProjects` | Active project whose health is YELLOW or RED |
| `overdueTasks` | Eligible open task with `Due_Date` before the reference date |
| `blockedTasks` | Eligible open task with status `Blocked` |
| `criticalIssues` | Open issue with severity `Critical` |
| `staleProjects` | Active project past the configured stale threshold |

The dashboard sheet reports each category on its own line, and `metrics.*` derives from those arrays.

Test: a fixture with one project per condition asserts each set exactly and that the unknown-schedule project is
*not* counted as at-risk.

## C3. Progress verification

Unchanged and still asserted: effort-weighted progress with the documented fallback weight 1, no double counting
between direct and subproject tasks, unknown estimates counted separately from zero, archived/cancelled exclusion,
stable project IDs, and preservation of user-entered fields.

## C4. Real-life scenario coverage

`tests/gate-c-correctness.test.js` models a small programme: two subprojects plus a direct task, a deadline-only
assignment, three engineers with different loads, a late supplier delivery (blocked, overdue, with an issue),
missing estimates, an archived project, a critical blocker and overlapping commitments. Assertions cover weighted
progress (58.82 %), per-member remaining hours, unknown counts, archived exclusion, attention categories, health
reason codes and the weekly report text.

## C5. Data-preservation regression

Two upgrade tests snapshot every cell of a fictional populated version-2 workbook, run the approved version-3
migration, and compare every value and formula:

1. wide fixture (projects, subprojects, direct tasks, members, skills, archived project, custom column, formula);
2. populated fixture including `MEMBER_SKILLS` evidence/training fields and a historical `NOTIFICATION_LOG` row.

Both assert: identical IDs, identical cell values, identical formulas, preserved skill records, preserved task
ownership, preserved notification history, preserved custom column, and exactly one verified pre-migration backup.

## Gate C acceptance

| Criterion | Result |
| --- | --- |
| Dashboard metrics distinguish issue categories | PASS |
| No incorrect health property returned | PASS |
| All new and existing tests pass | PASS (105 total) |
| No operational data loss | PASS (cell-by-cell comparison) |

## Known interpretations

- Remaining hours are `estimate − logged actual hours`; a 50 % progress value without logged hours does not reduce
  them. This is intentional and documented in [DATA_SCHEMA.md](../../DATA_SCHEMA.md).
- A subproject containing only unestimated work reports 0 % (weight 1) with `unknown` counted separately.
