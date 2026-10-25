# Gate A — Security & authorization hardening

Status: **PASS (local tests)** — live Workspace behaviour remains UNVERIFIED.

Baseline audited commit: `05d42b667ed8490d360301a961a4cbd6a6f6fa05`. Branch: `fix/v1.1-production-hardening`.

## A1. Privileged role management

Root cause: role edits were accepted as ordinary member data. `Ui.saveMember` forwarded `payload.role` straight to
`Members.update`, and `Members.validate` never checked who was changing the role. A MANAGER could therefore grant
`ADMIN`, and nothing prevented the last administrator from disappearing.

Corrections:

- `src/Access.gs` (new) centralises identity, scope and permission checks; `Roles.gs` gained `isAdmin`,
  `isManager`, `activeAdministrators` and `requireValidRole`.
- `Members.guardRoleChange` (new) runs inside domain validation:
  - creating a member with `ADMIN`/`MANAGER` requires a verified ADMIN actor;
  - changing any role to or from `ADMIN`/`MANAGER` requires ADMIN;
  - a member can never change the role of their own record (a second administrator must do it);
  - the last active administrator cannot be demoted or deactivated (also enforced in `Members.deactivate`).
- Unknown role text is rejected instead of silently becoming `VIEWER`.
- `Ui.saveMember` treats `role` as data only; authorization always comes from the session.

Tests: `tests/gate-a-security.test.js` — role grants, self-elevation through the UI payload, manager self-change,
last-admin demotion/deactivation, invalid role text.

## A2. Task ownership authorization

Root cause: `Ui.updateProgress` only required the caller to be an active member and then updated any task ID
supplied by the browser.

Corrections:

- `Access.canEditTask` / `Access.requireTaskWrite`: ADMIN → all tasks; MANAGER → tasks they own or tasks in
  projects/subprojects they own; MEMBER → only tasks where `Owner_Member_ID` equals their verified member ID;
  VIEWER → none.
- `Ui.updateProgress`, `Ui.approveAssignment`, `Ui.confirmSchedule` call `requireTaskWrite`; `Ui.assignTask` uses
  `requireProjectWrite` for new tasks and `requireTaskWrite` for existing ones.
- No endpoint reads an actor, role or owner from the payload for authorization. A forged `actor`, `role` or
  `ownerId` field has no effect.

Tests: own/foreign task updates, VIEWER rejection, manager cross-project rejection, manager own-project success,
ADMIN override, forged payload fields.

## A3. Unsafe HTML insertion

Root cause: sidebars built strings from spreadsheet data and inserted them with `innerHTML`
(`memberList`, notification history, preview lines, status text).

Corrections:

- New `src/UiSafe.html` partial exposes `EH` helpers that only use `document.createElement` + `textContent`
  (`renderLines`, `renderRecords`, `fillSelect`, `setStatus`). It never builds markup.
- `UiMenu.html`, `UiSettings.html` and `UiSystem.html` include it via `<?!= include('UiSafe') ?>` and no longer
  contain any `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`.
- `Ui.show` now evaluates a template so the partial is included; `include()` is defined in `Ui.gs`.
- `scripts/validate-source.js` fails the build if any template contains those APIs or references a missing partial.

Tests: `tests/gate-a-security.test.js` renders each sidebar against a DOM shim that throws on `innerHTML`, using
`<img src=x onerror=...><script>` payloads in member names, project names, task names, notification history and
error messages; the text is asserted verbatim.

## A4. Data visibility

Members previously received every project, member record and skill assessment.

Corrections (documented in [`docs/SECURITY_MODEL.md`](../SECURITY_MODEL.md)):

- MEMBER scope: only tasks they own, only the projects of those tasks, a directory limited to `id`/`name`/`active`
  for other people, own record details, and only their own skill row (no other assessments, no gap list).
- MANAGER/ADMIN: full directory, full skill matrix and gaps.
- Default posture is manager-only: `Access.requireUiAccess` refuses MEMBER/VIEWER with
  `Member self-service is disabled: manager access is required`. `ALLOW_MEMBER_SELF_SERVICE=true` enables the
  own-scope MEMBER path; a VIEWER is then refused with `Insufficient role: MEMBER required`.
- The workbook is still readable by anyone with spreadsheet access; V1.1 therefore remains manager-focused and
  documents that Sheets sharing is not a role boundary.

- Open the sidebar requires MANAGER/ADMIN by default (`requireUiAccess`). A MEMBER is refused unless the deployment
  sets `ALLOW_MEMBER_SELF_SERVICE=true`, in which case the caller gets own-scope data only; VIEWER is always refused.

## A5. First-administrator bootstrap

New `Access.bootstrapAdministrator` / `bootstrapFirstAdministrator`:

- requires the verified session address, the exact `BOOTSTRAP ADMIN <email>` confirmation, and membership in the
  deployment-controlled `ADMIN_BOOTSTRAP_ALLOWLIST` property;
- requires a current schema, the `DATABASE_ENVIRONMENT` marker, no prior bootstrap, no active administrator, no
  notification activation and an empty notification log (so an operational workbook is refused);
- writes `ADMIN_BOOTSTRAPPED` to the audit log and sets `ADMIN_BOOTSTRAP_COMPLETED_AT` so it cannot be reused.

Tests: missing/incorrect confirmation, non-allowlisted account, missing allowlist, success + audit, reuse,
existing administrator, operational workbook, already-activated notifications, missing member record.

## Gate A acceptance

| Criterion | Result |
| --- | --- |
| All relevant security tests pass | PASS (10 tests in `tests/gate-a-security.test.js`) |
| No role escalation through UI parameters | PASS |
| No unauthorized task updates | PASS |
| No unsafe operational-text HTML rendering | PASS |
| No reusable admin bootstrap route | PASS |

## Remaining live verification

- Two-account tests in a real Workspace (ADMIN vs MEMBER) — UNVERIFIED.
- Sidebar rendering in a real browser — UNVERIFIED (server behaviour and template structure are covered).
- Whether Google discloses the identity for the deployment's accounts — UNVERIFIED.
