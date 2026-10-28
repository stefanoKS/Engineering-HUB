# Task duration policy (deadline + required duration)

V1.3 makes **deadline + required duration** the primary scheduling input for a task. The
manager no longer has to enter a start date: the planned start is calculated.

## 1. Inputs

| Field | Stored as | Notes |
| --- | --- | --- |
| Deadline | `TASKS.Due_Date` | committed date, inclusive |
| Required duration value | `TASKS.Planned_Duration_Value` | positive integer, blank when unknown |
| Duration unit | `TASKS.Planned_Duration_Unit` | `DAY` or `WEEK` |
| Duration basis | `TASKS.Planned_Duration_Basis` | `WORKING_DAYS` or `CALENDAR_DAYS` |
| Planned start | `TASKS.Planned_Start` | calculated when the duration is known |
| Planned start source | `TASKS.Planned_Start_Source` | `DERIVED`, `MANUAL` or blank (`LEGACY`) |
| Effort estimate (optional) | `TASKS.Estimated_Hours` | capacity analysis only |

**Duration is not labour hours.** One working day is never converted to eight hours, and
`Estimated_Hours` is never derived from the duration. Workload analysis keeps using the
existing effort estimates.

## 2. Calculation

`Planning.planFromDuration(deadline, value, unit, basis, holidays)` is a pure function:

* The range is **inclusive of the deadline date**.
* `WORKING_DAYS`: Monday–Friday minus `HOLIDAYS`. One week = 5 working days.
* `CALENDAR_DAYS`: every date counts, including weekends and holidays. One week = 7 days.
* If the deadline falls on a non-working day the last working day on or before it is used
  for the working-day span, and a warning is raised. **The committed deadline is never
  altered silently.**

Examples (2026, Asia/Tokyo, no holidays):

| Deadline | Duration | Basis | Planned start |
| --- | --- | --- | --- |
| 2026-11-20 (Fri) | 3 days | working | 2026-11-18 (Wed) |
| 2026-11-20 (Fri) | 1 week (5 wd) | working | 2026-11-16 (Mon) |
| 2026-11-20 (Fri) | 3 days | calendar | 2026-11-18 (Wed) |
| 2026-11-20 (Fri) | 1 week (7 d) | calendar | 2026-11-14 (Sat) |

All calculations use explicit `Date.UTC` arithmetic; no locale-dependent `Date` parsing is
used.

## 3. Warnings

`Planning.planningWarnings()` returns neutral codes that the UI localizes:

| Code | Meaning |
| --- | --- |
| `MISSING_DEADLINE` | no deadline entered |
| `MISSING_DURATION` | no duration entered (a deadline-only task is still valid) |
| `PAST_DEADLINE` | the deadline is in the past |
| `PAST_START` | the calculated start is in the past |
| `NON_WORKING_DEADLINE` | the deadline is not a working day |
| `MILESTONE_OVERLAP` | a related milestone falls inside the planned range |

A `NON_WORKING_DEADLINE` warning requires an explicit acknowledgement in the manager form
before the task is saved. The deadline itself is not changed.

## 4. Manager responsibility, not automation

The manager decides whether the deadline and duration are feasible. V1.3 deliberately does
**not** implement:

* automatic workload-overlap warnings,
* assignment conflict detection for overlapping dates,
* duration-based capacity limits,
* automatic reassignment,
* blocking a task assignment because of a scheduling conflict,
* resource-constrained schedule optimisation.

An authorised manager may create overlapping assignments; the existing workload view is
unchanged and remains an informational tool.

## 5. Legacy data

* Migration `005_task_planning_and_requests` is additive: it only appends columns and
  tables. Existing rows, dates, formulas and custom columns are preserved.
* A task without a duration keeps its stored `Planned_Start`. Historical durations are
  never inferred from old dates.
* A deadline-only task is still valid in the manager web app: a deadline is required, the
  required duration is optional, and the planned start stays blank (`Planned_Start_Source`
  empty) instead of being back-planned. The browser form states this instead of blocking the
  save, matching `Ui.assignTask` and the sidebar.
* A legacy start keeps working until a manager explicitly enters a duration, at which point
  the start becomes `DERIVED`.
* Blank planning fields are reported as incomplete by the UI warnings rather than being
  filled with an invented estimate.

## 6. Side effects of a change

Changing the deadline or the derived start:

* recalculates `Planned_Start`,
* increments `Assignment_Version` and clears `Assignment_Approved_At`,
* invalidates any active schedule confirmation (`SCHEDULE_CHANGED`),
* is recorded in `AUDIT_LOG`.

Project committed deadlines are never changed by a task change. Phase planning
(`Planning.reverse()`, `PROJECT_PHASES`, `BACKPLAN`, `WORKLOAD`) keeps working unchanged.
