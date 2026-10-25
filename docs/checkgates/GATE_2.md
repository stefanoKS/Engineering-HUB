# Gate 2 — Project management & progress

Status: **PASS (automated) / LIVE VERIFICATION REQUIRED (Google Sheets rendering)**

## 2.1 Automatic progress

`Progress.gs` implements effort-weighted progress.

- Task progress: `Done` = 100, `Cancelled` is excluded, otherwise the stored 0–100 percentage.
- Known positive estimates are the weight; a known `0` hour task carries no weight but is counted.
- Unknown estimates use the documented temporary fallback weight **1**. The unknown count is reported
  separately and never presented as hours.
- Subproject progress uses its child tasks; project progress uses all tasks of the project, including tasks
  that live under a subproject. Each task is counted exactly once, so direct project tasks and subproject tasks
  cannot be double counted.
- Example from the specification (40h @100 %, 60h @50 %, 20h @0 %) evaluates to **58.33 %**.
- A project without tasks stores a blank progress and the views display `未計算` instead of a fabricated number.

`Progress.refresh()` writes only `PROJECTS.Progress_Percent` and `SUBPROJECTS.Progress_Percent`, only when the
value changed, using `Database.updateMany`. Other columns, custom columns and formulas are untouched.

## 2.2 Project health

`Health.gs` returns a deterministic label plus reason codes:

| Label | Meaning |
| --- | --- |
| `GREEN` | No known threat and the schedule information is present |
| `YELLOW` | Approaching milestone, blocked/overdue work, stale update, documented recovery pending, missing owner |
| `RED` | Missed commitment or milestone, forecast beyond the commitment without a recovery action, critical issue |
| `UNKNOWN` | Active project without a committed deadline or forecast — never green |
| `PLANNED`, `ON_HOLD`, `COMPLETED`, `CANCELLED`, `ARCHIVED` | Lifecycle states kept separate from risk colour |

Thresholds come from the persisted automation settings and are configurable:

- `PROJECT_STALE_DAYS` (default 7)
- `HEALTH_MILESTONE_APPROACH_DAYS` (default 14)
- `HEALTH_DELAY_TOLERANCE_DAYS` (default 0)
- `PROJECT_STALE_ALERT_ENABLED` (default true)

Health is a heuristic, documented as such: "recovery plan" is approximated by a documented `Next_Action`.

## 2.3 Staleness

- `Projects.touch` updates `Last_Updated` when an application-managed record changes.
- Dashboard and workload refreshes never mark a project as fresh.
- Projects without updates beyond the configured number of days are listed as stale and reported in the
  weekly report.
- A project missing both a committed deadline and a forecast is classified `UNKNOWN` and appears in the
  management attention list.

## 2.4 Hierarchy and operations

Project → Subproject → Task and Project → Task are both supported. New helpers:

- `Tasks.list(filter)` — project, subproject, owner, status, query, active-only, overdue filters.
- `Tasks.reassign(id, ownerId)`, `Tasks.complete(id)`, `Tasks.recordBlocker(id, note)`.
- `Projects.list(filter)`, `Members.list(filter)`, `Members.openTasks(id)`.
- Archiving never deletes child records.

## 2.5 Reverse scheduling

`Planning.reverse` improvements:

- Accepts a deadline without a start date; drafts phases when a duration is unknown.
- Excludes weekends and `HOLIDAYS`.
- Supports parallel stages through phase dependencies (DAG validation, cycle detection).
- Persists the plan per project in `PROJECT_PHASES` with `Plan_Version` and `Active`; superseded rows are kept
  as history. Re-planning one project cannot replace another project's stored plan.
- `BACKPLAN` remains a replaceable generated overview of all active phases.
- The committed deadline is stored on the phase rows, separately from the generated dates.
- No complete resource-constrained critical-path solver is claimed.

## Gate 2 checklist

| Check | Result | Evidence |
| --- | --- | --- |
| Project/subproject progress calculates correctly | PASS | `tests/gate2-progress.test.js` (58.33 example, 80 % direct+subproject) |
| Direct project tasks not double-counted | PASS | `tests/gate2-progress.test.js` |
| Unknown estimates handled honestly | PASS | `tests/gate1-safety.test.js`, `tests/gate2-progress.test.js` |
| Health classifications deterministic | PASS | `tests/gate2-progress.test.js` (GREEN/UNKNOWN/RED/PLANNED/ON_HOLD/YELLOW/ARCHIVED, repeated run) |
| Project staleness works | PASS | `tests/gate1-safety.test.js`, `tests/gate2-progress.test.js` |
| Parent status filtering works | PASS | `tests/gate1-safety.test.js`, `tests/gate3-views.test.js` |
| Deadlines remain immutable where required | PASS | `Projects.update` rejects `Original_Deadline` changes; `tests/domain.test.js` |
| Reverse scheduling respects Japanese holidays | PASS | `tests/gate2-progress.test.js`, `tests/domain.test.js` |
| Multiple project plans coexist | PASS | `tests/gate2-progress.test.js` |
| No operational data loss during refresh | PASS | `tests/gate2-progress.test.js` "dashboard refresh never clears operational sheets…" |

## Changed files

`src/Progress.gs` (new), `src/Health.gs` (new), `src/Estimates.gs` (new), `src/Eligibility.gs` (new),
`src/Planning.gs`, `src/Projects.gs`, `src/Subprojects.gs`, `src/Tasks.gs`, `src/ScheduleConfirmations.gs` (new),
`src/Schema.gs`, `src/Dashboard.gs`, `tests/gate2-progress.test.js` (new).

## Risks

- Progress and health are written to operational columns; direct sheet edits to `Progress_Percent` or `Health`
  are expected to be overwritten by the next refresh.
- Rollups treat "unknown" as weight 1 by design; the number is labelled and the unknown count is reported, but a
  manager must still review unestimated work.
- `PROJECT_PHASES` did not exist before version 3; reverse planning on an unmigrated workbook fails with a
  missing-table error instead of writing anywhere unexpected.

## Post-merge audit (production hardening)

Previously undiscovered issue: `Health.classify` returned `staleDays: limits`, i.e. the thresholds object under a
numeric field name, so any consumer treating `staleDays` as a number received an object.

Corrected behaviour: `staleDays` is the numeric age (or `null`), and the limits are returned under `thresholds`.

New regression tests: `tests/gate-c-correctness.test.js` (numeric `staleDays`, threshold separation, weighted
progress 58.82 %, per-member remaining hours, unknown counts, archived exclusion, data-preservation upgrade).

Remaining live verification: none specific to this gate beyond the general smoke test; progress and health remain
documented heuristics that require human review in a real workbook.
