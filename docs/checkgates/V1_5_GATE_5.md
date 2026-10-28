# V1.5 gate 5 — Project/task/responsibility/member workflows

Status: **BLOCKED**
Date: 2026-10-28
Starting commit SHA: 5c1143edef3f8ba74ce92219a59ea58723847941
Implementation commit SHA: 63596375251c230afa11ad42cf999cd3a2f0cef9 (V1.5 implementation); review-correction commit: 309a86c17643e01235555f820a921438fe285487 (project summary freshness, deadline-only tasks, project cards).

## 1. Objective

Verify project/task/responsibility/member workflows without treating local mock evidence as Workspace proof.

## 2. Affected source files

src/ManagerWebClient.html, ManagerWebApi.gs, ManagerWeb.gs, Ui.gs; unchanged domain services

## 3. Exact acceptance criteria and result

- Project CRUD/transfers/default RESTRICTED, responsibility reorder/retire/reactivate and two-level subproject operations: local regressions PASS.
- Task scheduling/approval/confirmation/progress/partial edits and member/skill forms: local PASS.
- Request decisions and controlled admin/report/publication actions use existing services: local PASS.
- Same normal workflows through a deployed manager URL with actual permissions/audit: NOT_RUN.

## 4. Automated tests performed

v1_5-web.test.js, v1_5-web-ui.test.js; V1.3/V1.4 project/task/responsibility/member/domain suites. Final aggregate: **387 tests, 387 pass, 0 fail, 0 skipped**.

## 5. Manual tests performed

Task edit/save, hierarchy navigation and request/administration UI reviewed locally; all 20 DEV cases remain NOT_RUN.

## 6. Test commands

npm ci; npm run lint; npm test; npm run validate. Performance: node scripts/manager-web-benchmark.js. Browser: npm run preview:manager-web with normal/empty/large/slow/error synthetic scenarios.

## 7. Actual results

All four final npm commands exited 0. Dependency audit: 0 vulnerabilities (existing deprecation warnings). Validator: 35 manager .gs files, 3 employee .gs files, both manifests, 689 translation keys. Baseline was 344 tests / 340 pass / 4 fail; corrections are documented, not hidden. No live Workspace test ran.

## 8. Relevant logs and evidence

[V1_5_VALIDATION.txt](V1_5_VALIDATION.txt), [baseline](V1_5_BASELINE.md), [raw performance](V1_5_PERFORMANCE.json), [visual checks](V1_5_VISUAL.md), [DEV test plan](../MANAGER_WEB_APP_SMOKE_TEST.md).

## 9. Identified problems

Partial member edits could blank untouched fields; separate subproject rename/reparent could leave a partial logical change.

## 10. Corrective actions

Merge stored untouched member fields; validate/reparent via one domain patch; web task actual/progress fields supported.

## 11. Remaining limitations

No live CRUD or permission test; automation is not activated by this implementation.

## 12. Final gate status

**BLOCKED**. Local criteria above have their actual results; unexecuted live/manual criteria are not silently excluded from this gate. Release implementation: **IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING**. **NOT APPROVED FOR PRODUCTION.**

## 13. Commit SHA

The starting SHA is recorded above. The implementation SHA will be sealed in a subsequent documentation-only commit so this evidence names an actual immutable implementation commit rather than a predicted self-referential hash.

## 14. Review correction — 2026-10-28 (workflow regressions)

- **Project save**: `projectSave` still applies a partial patch, refuses a stale revision and never
  rewrites `PROJECTS.Progress_Percent`. The card value is derived from tasks, so a rename does not
  change progress. Regression: `project save keeps the derived progress and never rewrites it from
  the browser`.
- **Task save**: progress and status edits are reflected in the project list, the overview cards and
  the KPI counts on the very next read while `Dashboard.refresh` is stubbed to throw. Regression:
  `a task save immediately changes the project list and overview without a report refresh`
  (24.39% → 26.83% after completing the unestimated task; `BLOCKED_TASK` turns the health YELLOW).
- **Deadline-only task creation restored**: `ManagerWebApi` requires a deadline and no longer
  requires a duration. A create with only `deadline` + owner succeeds and stores an empty
  `Planned_Start`/`Planned_Duration_Value` (`Planned_Start_Source` blank = unknown start). A create
  with `durationValue: 3` still back-plans `Planned_Start = 2026-12-16` (`DERIVED`). A create with no
  deadline is refused with `Deadline required`. The preview was exercised end to end: the form
  submitted and the created row had `due=2026-12-18`, empty start, empty duration.
- **Responsibility/member workflows**: untouched; existing suites still pass (387 tests total).

Evidence: [V1_5_VALIDATION.txt](V1_5_VALIDATION.txt), [visual checks](V1_5_VISUAL.md),
[task form screenshot](evidence/V1_5-task-form-duration-1366.png).
