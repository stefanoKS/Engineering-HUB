# Gate 1 — Architecture & data safety

Status: **PASS (automated) / LIVE VERIFICATION REQUIRED (Google Workspace behaviour)**

Branch: `feature/v1.1-management-reliability`

## 1.1 Baseline review

Inspected before changing anything: `Schema.gs`, `Database.gs`, `Migrations.gs`, `Config.gs`, `Tasks.gs`,
`Projects.gs`, `Subprojects.gs`, `Notifications.gs`, `Triggers.gs`, `Main.gs`, `AGENTS.md`, `DEPLOYMENT.md`,
all tests, mocks and the existing documentation.

Baseline evidence (commit `3432788`, branch `main`):

```text
npm run lint     -> pass
npm test         -> 41 tests, 41 pass, 0 fail
npm run validate -> Validated 19 Apps Script files and manifest
```

The existing architecture (single Apps Script runtime, Sheets as the data store, header-based access,
`Database.withLock`, versioned migrations, generated-sheet allowlist) was kept. No component was rewritten for
cosmetic reasons; the existing public function names still work.

## 1.2 Unknown estimates

- `Estimates.gs`: blank / `null` / missing means **unknown**; a numeric value (including `0`) is **known**.
- `TASKS.Estimated_Hours` and `SUBPROJECTS.Estimated_Hours` now default to **blank** instead of `0`, so a new
  task without an estimate is not silently reported as zero work.
- Existing stored values are never rewritten. A stored `0` remains a deliberate zero.
- Workload, dashboards, weekly reports and progress rollups report unknown counts separately.
- `Progress.rollup` uses the documented temporary fallback weight `1` for unknown effort; the fallback weight is
  never shown as real working hours.

## 1.3 Consolidated approval logic

Two independent concepts, one validated public path:

| Concept | Function | Requires |
| --- | --- | --- |
| Assignment approval | `Notifications.approveAssignment` (used by `approveTaskAssignment`, the UI and the legacy name) | valid project/subproject, active owner, verified active account, explicit `APPROVE ASSIGNMENT`, activated notification baseline |
| Schedule confirmation | `Tasks.confirmSchedule` / `ScheduleConfirmations.gs` | valid assignment, a deadline, a **known** effort estimate; the start date stays optional |

- `Tasks.approvalPatch` is the single assignment validation used by the approval path; a UI cannot post a
  forged `Assignment_Approved_At` or `Assignment_Version` (the domain layer overwrites both).
- Deadline-only assignment works: a task may have a due date and no planned start or estimate.
- Material assignment changes (owner, project, subproject, dates, estimate, name, dependencies, priority,
  acceptance criteria, required skill) increment `Assignment_Version` and clear `Assignment_Approved_At`.
- Ordinary progress updates (`Progress_Percent`, `Status`, `Actual_Hours`, `Next_Action`) leave assignment
  approval untouched.
- Date/estimate changes supersede the active schedule confirmation (`SCHEDULE_CONFIRMATIONS.Active = false`,
  history retained) instead of deleting it.

## 1.4 Shared eligibility policy

`Eligibility.gs` is the single policy used by dashboards, workload, notifications, deadlines, the weekly report
and task lists:

- Archived / cancelled projects keep their rows but stop contributing to active work.
- On Hold is reported as its own state, not as active workload.
- Subprojects must belong to the same project; archived subprojects are excluded.
- Blank `PROJECTS.Notification_Enabled` keeps the previous behaviour (allowed); an explicit `false` suppresses
  notifications for that project.

## 1.5 Data integrity

- Stable IDs, header-based access, immutable-ID checks, duplicate-ID detection and referential validation remain.
- `Database.updateMany` groups consecutive explicit cells per column; `Notifications.writeBaselines` now writes
  only changed system cells through it instead of rewriting every task's notification columns.
- `Projects.touch` maintains `Last_Updated` for application-managed changes (tasks, subprojects, issues,
  milestones). Dashboard refreshes never touch it.
- Audit records are written for domain changes, setting changes, approvals, reconciliations and critical actions.
- Documented limitation: Apps Script locks do not protect against simultaneous direct human edits in Google
  Sheets. Direct edits bypass validation and auditing (see [ARCHITECTURE.md](../../ARCHITECTURE.md)).

## 1.6 UI architecture decision

- The V1.1 manager UI is implemented as a **container-bound** adapter (`Ui.gs`, `UiMenu.html`,
  `UiSettings.html`, `UiSystem.html`; `.claspignore` now includes HTML).
- A standalone project cannot display `SpreadsheetApp.getUi()`; `Ui.show` fails with an explicit Japanese error
  instead of pretending to work.
- The service layer is unchanged and shared by the menu, the editor and the triggers.
- No second trigger set is created: `onOpen` installs only a menu, never triggers.
- Google Sheets editor permissions are not an administrator boundary. V1.1 assumes trusted managers only; see
  [MANAGER_WORKFLOW.md](../MANAGER_WORKFLOW.md) and [DEPLOYMENT.md](../../DEPLOYMENT.md).

## Gate 1 checklist

| Check | Result | Evidence |
| --- | --- | --- |
| Existing tests still pass | PASS | 41 original tests still run and pass (see [GATE_6.md](GATE_6.md)) |
| New data-preservation tests pass | PASS | `tests/gate1-safety.test.js`, `tests/gate6-release.test.js` |
| Unknown estimates distinguishable from zero | PASS | `tests/gate1-safety.test.js` "unknown effort stays unknown" |
| Deadline-only assignment supported | PASS | `tests/gate1-safety.test.js` "deadline-only assignment…" |
| Approval cannot bypass validation | PASS | `tests/gate1-safety.test.js` "approval cannot bypass owner validation…" |
| Archived tasks excluded from active workload | PASS | `tests/gate1-safety.test.js` "archived projects keep their records…" |
| Project/subproject relationships intact | PASS | `tests/domain.test.js`, `tests/gate6-release.test.js` |
| IDs unchanged after sorting | PASS | `tests/gate1-safety.test.js` "stable IDs survive view refreshes and sorting" |
| No production reset path introduced | PASS | `npm run validate` destructive-API scan |
| UI architecture technically valid | PASS (design) / LIVE VERIFICATION REQUIRED | Container-bound adapter; the bound deployment has not been executed in a real Workspace |
| Development/production isolated | PASS | `Config.gs` environment binding, `Database.book()` marker check |

## Changed files

`src/Estimates.gs` (new), `src/Eligibility.gs` (new), `src/ScheduleConfirmations.gs` (new), `src/Roles.gs` (new),
`src/Tasks.gs`, `src/Projects.gs`, `src/Subprojects.gs`, `src/Issues.gs`, `src/Milestones.gs`,
`src/Notifications.gs`, `src/Schema.gs`, `src/Migrations.gs`, `src/Ui.gs`, `src/UiMenu.html`, `src/UiSettings.html`,
`src/UiSystem.html`, `.claspignore`, `scripts/validate-source.js`, `tests/gate1-safety.test.js` (new),
`tests/fixtures.js` (new), `tests/core.test.js` (version/backup expectations), `tests/mocks/google.js`.

## Test adaptations (documented, not weakened)

Two existing assertions referenced the schema version and the per-migration backup count. Both changed because
version 3 adds a second approved migration:

- `Migrations.currentVersion()` after initialization is now `3`.
- `upgradeExistingDatabase()` from version 1 now returns `3` and the fixture approves both migrations.
- The preservation test expects **two** verified backups (one per applied migration), which is the intended
  behaviour: migration backups cannot be skipped.

No assertion was removed or relaxed beyond these deliberate schema/version consequences.

## Risks

- `PROJECTS.Notification_Enabled` and `MEMBERS.Role` are appended by the migration as **blank** for existing
  rows. Blank role is treated as `VIEWER` (fail closed) and blank project switch keeps the previous behaviour.
  A manager must assign roles after upgrading, or the automation/UI surfaces stay locked.
- The separate schedule-confirmation table means older code cannot see confirmation state; it is additive.
- The UI adapter is only testable with mocks locally.

Commands:

```text
npm run lint
npm test
npm run validate
```
