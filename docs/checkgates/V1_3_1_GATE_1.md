# V1.3.1 Gate 1 — Project creation and visibility

Scope: manager-controlled publication of a project (`Dashboard_Visibility`,
`Dashboard_Summary`), the private description, the ownership default and the manual
publication action. Direct work on `main`; no branch, pull request, commit or deployment.

## Result

Result: **PASS** (local) — live Google Workspace verification: **UNVERIFIED**

| Check | Result | Evidence |
| --- | --- | --- |
| The manager form exposes `社内ダッシュボードに表示する` / *Show on internal dashboard* | PASS | `src/UiMenu.html` `#projectVisibility` with `RESTRICTED` selected first |
| Supported stored values are exactly `INTERNAL` and `RESTRICTED` | PASS | `Ui.visibilityValue()`; `Schema` enum; `Ui.updateProject` rejects anything else (`tests/v1_3_1-stabilization.test.js` "an invalid visibility … is refused") |
| A new project is `RESTRICTED` until a manager selects `INTERNAL` | PASS | Schema default + `Ui.createProject` (`visibilityValue(undefined) → 'RESTRICTED'`); sidebar default asserted through the client harness (`tests/v1_3_1-ui.test.js`) |
| Visibility can be set at creation and when editing | PASS | `Ui.createProject`, `Ui.updateProject` |
| `共有用概要` / *Dashboard summary* exists and explains what is published | PASS | `#projectSummary` + `manager.project.summaryHint` translation |
| Publication still uses the allowlisted sanitized snapshot | PASS | `SharedDashboardModel` unchanged; `tests/v1_3_1-stabilization.test.js` "the dashboard summary is published while private text never leaves the workbook" |
| Private `Description`, `Acceptance_Criteria`, notes, skills and logs are not published | PASS | Same test scans every cell of the snapshot workbook for the private strings |
| A save states that the change appears at the next publication | PASS | `#visibilityNote` (`manager.project.updated`), asserted by the client harness |
| A manual publication action exists in the manager UI | PASS | `#projectSubmit` panel button → `uiPublishPublicationNow` → `SharedDashboardPublisher.publish`; the automation settings screen keeps its own action |
| Manual publication does not bypass the ADMIN activation rules | PASS | `publish()` requires a manager session; the *scheduled* trigger still requires `SHARED_DASHBOARD_PUBLISH_ENABLED` + ADMIN + `ENABLE SHARED DASHBOARD PUBLICATION` (`src/SharedDashboardPublisher.gs`) |
| A creating manager becomes the owner when no owner is chosen | PASS | `Ui.createProject` uses `current.memberId`; test "a manager owns a new project by default and can then edit it" |
| Another owner can be chosen and then governs the scope | PASS | test "a manager cannot edit a project owned by somebody else" |
| No owner ID is invented and a browser role is never trusted | PASS | Owner comes from `Roles.describe`/`MEMBERS`; `Projects.validate` requires an existing member; `Access.requireProjectWrite` uses the verified session |
| Restricted project stays hidden after publication | PASS | test "a new project stays hidden until a manager publishes it deliberately" |
| A published project appears; a restricted one disappears after republication | PASS | Same test (A/B active slot read through `PUBLISHED_META`) |
| Subprojects and tasks follow their project's visibility | PASS | test "subprojects and tasks disappear with their project" |
| Unauthorized visibility edits are rejected | PASS | tests "a manager cannot edit a project owned by somebody else" and "a member cannot create or publish a project" |
| No schema change | PASS | Schema stays at version 5; `PROJECTS.Dashboard_Visibility` / `Dashboard_Summary` already exist |

## Evidence

* `npm test` — 256 tests, 256 pass, 0 fail (includes the 24 stabilization and 15 sidebar
  wiring tests added for V1.3.1).
* `npm run lint` — clean.
* `npm run validate` — 32 manager files, 3 dashboard files, both manifests, 452 translation keys.

## Notes and limits

Manual publication is a manager action by design and remains independent from the scheduled
trigger. Nothing here proves the shared dashboard updates immediately: the snapshot is
written by `publish()`, and the UI says so. Browser and Workspace behaviour is unverified.
