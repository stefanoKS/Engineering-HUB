# V1.3 Gate 2 — Deadline + duration planning

Scope: `Planning.planFromDuration`, migration `005_task_planning_and_requests` and the
manager task form.

## Result

Result: **PASS** (local) — live Google Workspace verification: **UNVERIFIED**

| Check | Result | Evidence |
| --- | --- | --- |
| 3 working days from 2026-11-20 starts 2026-11-18 | PASS | `tests/v1_3-planning.test.js` |
| 1 week = 5 working days starts 2026-11-16 | PASS | same |
| Weekends and `HOLIDAYS` excluded on the working-day basis | PASS | same, with a holiday inside the span |
| Calendar-day basis counts every date | PASS | same (3 calendar days and 1 calendar week) |
| Inclusive range, no off-by-one | PASS | start and end both included; asserted for 1, 2, 3 and 5 days |
| Past-start and past-deadline warnings | PASS | `Planning.planningWarnings` |
| Deadline on a non-working day warns and does not move the deadline | PASS | `NON_WORKING_DEADLINE`, `Due_Date` unchanged; the manager form requires explicit acknowledgement |
| Legacy planned starts preserved by the migration | PASS | `tests/v1_3-planning.test.js` upgrade test compares every pre-existing cell |
| `Estimated_Hours` never derived from the duration | PASS | duration is stored separately; no conversion code exists |
| Task progress and notification rules still work | PASS | existing `npm test` automation suites |
| Project committed deadlines unchanged | PASS | `Tasks.validate` never writes `PROJECTS`; asserted in `tests/v1_3-planning.test.js` |
| Overlapping assignments are allowed | PASS | no overlap validation exists; test asserts two overlapping tasks can both be saved |
| Duration unit/basis enum guardrails | PASS | schema enums `DAY`/`WEEK` and `WORKING_DAYS`/`CALENDAR_DAYS` |
| Change side effects | PASS | assignment version bump, approval cleared, schedule confirmation invalidated, audit row |

## Evidence

* `node --test tests/v1_3-planning.test.js`
* Migration `005_task_planning_and_requests` is additive and requires explicit approval via
  `APPROVED_MIGRATIONS`.
* `npm run validate` compiles every Apps Script source, including `Planning.gs`.

## Notes and limits

Workload-overlap detection, capacity limits and automatic reassignment are **out of scope**
by instruction: the manager decides feasibility. The existing workload view is untouched.
Live calendar behaviour (holiday rows in a real workbook) remains UNVERIFIED locally.
