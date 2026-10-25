# Gate 3 — Dashboard, Gantt & workload

Status: **PASS (automated, mocked Google services) / LIVE VERIFICATION REQUIRED (real Sheets rendering and quotas)**

## 3.1 Management dashboard

`Dashboard.analyze` derives every number from the operational tables; no second project database exists.
`Dashboard.refresh` writes these generated sheets:

- `DASHBOARD` — portfolio metrics, management attention, generated-sheet index, last refresh time.
- `PROJECT_OVERVIEW` — project, owner, deadline, progress, current phase, health, next action, last update,
  reasons.
- `TEAM_VIEW` — member, assigned tasks, remaining estimated hours, capacity, utilisation, overdue, unknown
  estimates, actual hours.
- `TIMELINE_DATA` — task-level timeline for manual native Timeline setup.
- `GANTT_OVERVIEW` — portfolio/detailed fallback Gantt (projects, subprojects, milestones, tasks, forecast
  dates, unscheduled markers).
- `AUTOMATION_STATUS` — effective automation state (no identifiers or secrets).

Portfolio metrics: active, planned, on-hold, completed, archived, at-risk, open/overdue/blocked tasks,
open/critical issues, upcoming milestones, stale projects.

Management attention: pending approvals, tasks without an owner, tasks needing reassignment (inactive owner),
projects with unknown schedules, tasks due within 7/30 days, over-capacity members, unknown estimates.

## 3.2 Gantt overview

Two levels are produced by the same analysis:

- Portfolio rows for projects, subprojects and milestones.
- Detailed task rows with planned start, deadline, forecast end (project-level, kept separate from the task
  deadline), progress and status.

Tasks without dates stay visible and are marked `日程未設定` instead of being dropped. No native Google Timeline
is created automatically; availability depends on Workspace edition and remains a manual step.

## 3.3 Workload

`Planning.workloadData` / `Planning.workload`:

- Remaining hours = estimate − actual, distributed over working days (weekends and holidays excluded).
- Capacity = weekly capacity × working days / 5.
- Utilisation and an `Overallocated` flag (`> 100 %`).
- Unknown or undated tasks are counted separately, never as zero hours.
- Actual hours are reported in their own column, separate from planned remaining hours.
- Archived, cancelled and on-hold project work is excluded through `Eligibility`.

## 3.4 Generated view protection

- Only sheets on `Schema.generated` may be cleared and rebuilt; `Database.writeGenerated` rejects anything else.
- Operational tables and custom columns are never cleared; the Gate 2 preservation test asserts task rows are
  identical across a refresh.
- Generated sheets carry an explicit "自動生成・編集禁止" label (or headers) so users know not to store data.

## Gate 3 checklist

| Check | Result | Evidence |
| --- | --- | --- |
| New projects appear automatically in the dashboard | PASS | `tests/gate3-views.test.js` |
| Progress refresh calculates correct values | PASS | `tests/gate2-progress.test.js` |
| Archived projects are not counted as active | PASS | `tests/gate1-safety.test.js`, `tests/gate3-views.test.js` |
| Gantt shows multiple projects | PASS | `tests/gate3-views.test.js` (project/subproject/milestone/task rows) |
| Tasks without dates remain visible as unscheduled | PASS | `tests/gate3-views.test.js` (`日程未設定`) |
| Workload identifies overcapacity | PASS | `tests/gate3-views.test.js` (utilisation 4.5, `超過`) |
| Unknown hours remain visible | PASS | `tests/gate1-safety.test.js`, `tests/gate3-views.test.js` |
| No operational worksheet is cleared | PASS | `tests/gate2-progress.test.js`, `tests/gate3-views.test.js` |
| Dashboard works with several hundred test tasks | PASS (5,000 tasks, mock) | `tests/gate6-release.test.js` scale benchmark |

## Changed files

`src/Dashboard.gs`, `src/Planning.gs`, `src/Schema.gs`, `src/Progress.gs`, `src/Health.gs`,
`tests/gate3-views.test.js` (new).

## Risks

- The local scale benchmark runs against in-memory mocks, not Google Sheets. Apps Script execution limits,
  Sheets read/write latency and quotas must be measured in development.
- Writing computed progress/health on every manual refresh costs one bounded batch per table; on very large
  workbooks this may approach the 6-minute execution limit and should be measured.
- Native Google Timeline must be created manually; the fallback sheet is authoritative for V1.1.
