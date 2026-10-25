# V1.3.1 Gate 2 — Editing existing projects and tasks

Scope: project and task edit modes built on partial patches, with authorization, immutable
identifiers, derived start recalculation and a staleness guard.

## Result

Result: **PASS** (local) — live Google Workspace verification: **UNVERIFIED**

| Check | Result | Evidence |
| --- | --- | --- |
| A project edit mode exists (案件編集 / *Edit project*) | PASS | `#projectPick` loads the stored values; button label becomes `保存` (`src/UiMenu.html`) |
| A task edit mode exists (タスク編集 / *Edit task*) | PASS | `#taskPick` loads the stored values |
| Editable project fields: name, owner, status, category, committed deadline, visibility, summary, description, priority | PASS | `Ui.updateProject` |
| Editable task fields: name, owner, deadline, duration, unit, basis, priority, estimate, acceptance criteria, notification preference | PASS | `Ui.taskPatch` |
| `Project_ID` / `Task_ID` cannot be edited and no record is recreated | PASS | Patch never includes the id; `Database.update` rejects an id change; test "a project edit patches only the supplied fields and keeps the identity" |
| `Original_Deadline`, `Created_At` and audit/migration identifiers are not editable | PASS | Not exposed by the payload map; `Projects.update` keeps `Original_Deadline` immutable |
| `Projects.update` / `Tasks.update` are used through an authorized UI adapter | PASS | `Ui.updateProject` → `Access.requireProjectWrite`; `Ui.assignTask` → `Access.requireTaskWrite` |
| A task cannot be moved into a project outside the manager scope | PASS | `Access.requireProjectWrite(patch.Project_ID)`; test "a task cannot be moved into a project outside the manager scope" |
| Updating one field preserves unrelated fields | PASS | `taskPatch`/`updateProject` only emit supplied keys; 3 tests cover notification-only, summary-only and name-only edits |
| Changing the deadline or duration recalculates the derived start | PASS | `Planning.applyTaskPlan` inside `Tasks.validate`; tests for deadline, duration and cleared duration |
| Managers never type a start date while a duration exists | PASS | The plan preview derives it; `Planned_Start_Source = DERIVED` asserted |
| Existing progress, actual hours, notification setting and completion state survive an edit | PASS | test "a task edit preserves the fields it does not address" |
| Assignment approval and schedule confirmation are invalidated when required | PASS | `Tasks.validate` assignment/schedule field lists; test "renaming a task invalidates the stale assignment approval but keeps the data" |
| A stale edit is refused instead of overwriting newer data | PASS | `Tasks.update` stamps `Last_Updated`; `stampChanged()` guard; tests for project and task |
| A committed deadline change requires explicit confirmation | PASS | `confirmDeadlineChange`; test "a committed deadline change needs an explicit confirmation" |
| A project can only be completed when every task is done | PASS | `Ui.updateProject` rollup check |
| Unauthorized edits are rejected | PASS | tests for another manager's project, a task outside the scope, and a MEMBER |
| No direct cell writes bypass validation | PASS | Everything goes through `Domain.save` → `Database.update`/`insert` |
| Japanese and English both work | PASS | `data-i18n` keys validated; client harness asserts the English labels after switching |

## Evidence

* `npm test` — all suites pass, including `tests/v1_3_1-stabilization.test.js` and
  `tests/v1_3_1-ui.test.js`.
* `npm run lint` — clean.
* `npm run validate` — passes (templates, manifests, dictionaries).

## Notes and limits

`Project_ID` and the original deadline stay immutable, so the edit path is a patch over the
existing row. A name, owner, priority, acceptance-criteria or schedule change intentionally
bumps `Assignment_Version` and clears the assignment approval, because that is the existing
material-change rule; the manager re-approves when ready. Workspace behaviour is unverified.
