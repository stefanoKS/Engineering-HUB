# Gate 4 — Manager UI & member skills

Status: **PASS (automated with a mocked HtmlService) / LIVE VERIFICATION REQUIRED (container-bound deployment)**

## 4.1 Manager UI

Architecture: a **container-bound** Apps Script adapter (`Ui.gs` + three HTML templates). A standalone script
project cannot open `SpreadsheetApp.getUi()`; the adapter throws an explicit Japanese error instead of appearing
to work.

- `onOpen()` adds the **Engineering HUB** menu: ダッシュボード, 新規プロジェクト, 新規サブプロジェクト,
  新規タスク, タスク割当, 進捗更新, 課題, マイルストーン, メンバー, スキル, 自動化設定,
  ダッシュボード更新, システム状態.
- Sidebars: `UiMenu.html` (project/subproject/task/progress/member/skill), `UiSettings.html`
  (自動化設定), `UiSystem.html` (システム状態).
- Japanese labels, inline validation messages, loading/error states, and confirmation dialogs for risky actions.
- Every write calls the same validated domain services (`Projects`, `Subprojects`, `Tasks`, `Members`,
  `Skills`, `Issues`, `Milestones`, `Notifications`, `AutomationSettings`). There is no unvalidated write path.
- Mail is **never** sent from a browser callback. The UI only records intent and approval; the scheduled
  notification service performs delivery under the authorized account.
- `.claspignore` now packages HTML templates; `npm run validate` fails if a referenced template is missing.

## 4.2 Task assignment flow

The sidebar supports the required sequence: project → optional subproject → task name → owner → deadline →
optional start/estimate → acceptance criteria → priority → notification switch → review and confirm.
Saving produces a stable task ID, stores the assignment, writes an audit record, refreshes generated views and
leaves notification delivery to the automation service.

Deadline-only assignment is accepted; no start date or estimate is fabricated.

## 4.3 Member management

- Add/edit members, deactivate safely, review open tasks, overdue counts and next deadline.
- Deactivation is rejected while open (non-Done, non-Cancelled) tasks still belong to the member; tasks must be
  reassigned first.
- Deactivation preserves the member row and history.

## 4.4 Skill management

- Levels 0–4 (0 no experience … 4 can teach/review) validated as integers.
- Assessment date, assessor, evidence, training action and next review date are retained on `MEMBER_SKILLS`.
- `Skills.gaps()` compares the required level with the member's current level and recommends supervision or
  training. Gaps never block an assignment.
- Assessment writes require MANAGER; private details are only returned to MANAGER callers.
- `SKILL_MATRIX` remains a generated view.

## 4.5 Roles

`Roles.gs` defines `ADMIN` > `MANAGER` > `MEMBER` > `VIEWER` and resolves identity from the verified Google
session (`Session.getActiveUser()`), never from client input.

- Members created without a role get `MEMBER`; migrated rows keep a blank role which is treated as `VIEWER`
  (fail closed). No privilege is invented by a migration.
- Settings writes require MANAGER; enabling LIVE mail requires ADMIN.
- Unverified identity or an inactive member is rejected for every management surface.
- Documented limitation: Sheets editors and bound-script editors can change data and source, so this is an
  application control, not a security boundary. V1.1 assumes trusted managers.

## Gate 4 checklist

| Check | Result | Evidence |
| --- | --- | --- |
| Manager can create project through UI | PASS | `tests/gate4-ui.test.js` |
| Manager can create subproject through UI | PASS | `tests/gate4-ui.test.js` |
| Manager can assign a task through UI | PASS | `tests/gate4-ui.test.js` |
| Deadline-only assignment is supported | PASS | `tests/gate4-ui.test.js` (blank estimate and start) |
| Validation errors are shown clearly | PASS | `tests/gate4-ui.test.js` (Japanese messages, cross-project rejected) |
| Task modifications update existing records | PASS | `tests/gate4-ui.test.js` (progress update, Done invariants) |
| Skill matrix displays correctly | PASS | `tests/domain.test.js`, `tests/gate4-ui.test.js` |
| Skill-gap detection works | PASS | `tests/gate4-ui.test.js` (gap 1, supervision recommended) |
| Unauthorized configuration changes are rejected | PASS | `tests/gate4-ui.test.js`, `tests/gate5-automation.test.js` |
| UI does not bypass domain validation | PASS | All UI writes go through domain services |
| Apps Script deployment packaging includes HTML | PASS | `npm run validate` asserts templates and `.claspignore` |
| No standalone-only UI calls exist | PASS (guarded) | `Ui.show` throws a clear error outside a bound spreadsheet |

## Changed files

`src/Ui.gs` (new), `src/UiMenu.html` (new), `src/UiSettings.html` (new), `src/UiSystem.html` (new),
`src/Roles.gs` (new), `src/Members.gs`, `src/Skills.gs`, `.claspignore`, `scripts/validate-source.js`,
`tests/mocks/google.js` (HtmlService, sidebar), `tests/gate4-ui.test.js` (new).

## LIVE VERIFICATION REQUIRED

- Create the container-bound development project and confirm the menu appears.
- Confirm sidebar rendering, input behaviour and Japanese text in the real Sheets UI.
- Confirm role resolution against the real Workspace directory/account.
- Confirm that `clasp push` uploads the three HTML files to the bound project.

## Risks

- Sidebar HTML cannot be unit-tested for layout; only server-side behaviour is covered locally.
- A bound spreadsheet shared with untrusted editors is not a secure admin boundary.
- `google.script.run` payloads are trusted only after server-side role checks; the UI is not the control.

## Post-merge audit (production hardening)

Previously undiscovered issues:

1. **Role escalation through the UI.** `uiSaveMember` forwarded `payload.role`; a MANAGER could grant `ADMIN`, and
   any caller could change a role. Fixed: only ADMIN may grant/revoke `ADMIN`/`MANAGER`, self-change is refused and
   the last active administrator is protected.
2. **Task ownership was not checked.** `uiUpdateProgress` trusted the task ID. Fixed: MEMBER → own tasks only,
   MANAGER → own projects/subprojects and own tasks, ADMIN → all, VIEWER → none.
3. **Unsafe HTML rendering** of names, history and error messages via `innerHTML`. Fixed with `src/UiSafe.html`
   (DOM creation + `textContent`); enforced by source validation.
4. **Member data visibility** exposed every project, member record and assessment. Fixed: MEMBER sees only their own
   tasks/projects, a minimal directory and their own assessment row; documented in `docs/SECURITY_MODEL.md`.

New regression tests: `tests/gate-a-security.test.js`.

Remaining live verification: real browser rendering, real two-account behaviour, and the fact that Sheets editors
can still bypass the application entirely (documented limitation).
