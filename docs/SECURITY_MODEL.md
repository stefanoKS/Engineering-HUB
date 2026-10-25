# Security model

This document describes what the V1.1 application actually enforces, what it does not enforce, and the residual
risks a deployment owner must accept. It reflects the code on branch `fix/v1.1-production-hardening`.

## 1. Trust boundaries

| Boundary | Reality |
| --- | --- |
| Google identity | `Session.getActiveUser().getEmail()` is the only identity source. It is treated as verified only when Google returns a non-empty address. |
| Browser payload | Untrusted. `google.script.run` arguments may contain any role, actor, owner or confirmation text; none of them grant privileges. |
| Workbook data | Trusted for structure (headers validated), untrusted for content: every stored string is rendered with `textContent`, never as markup. |
| Script Properties | Deployment-controlled configuration (environment binding, IDs, master safety flags, bootstrap allowlist). Never exposed by the UI. |
| Spreadsheet editors | **Not** a security boundary. An editor can change any cell, including `MEMBERS.Role`, audit rows, and computed columns. |
| Bound script editors | **Not** a security boundary either. An editor who can open the bound project can change code and bypass the application entirely. |
| Installable triggers | Run as their creator. Another editor may not see or repair them. |

Consequence: V1.1 is designed for **trusted managers**. It prevents privilege escalation *through the
application*, not privilege escalation by someone who can edit the spreadsheet or the script source.

## 2. Role permission matrix

`MEMBERS.Role` holds `ADMIN`, `MANAGER`, `MEMBER` or `VIEWER`. A blank role (for example after migrating a V1
workbook) is treated as `VIEWER` — no privilege is invented by a migration.

| Capability | ADMIN | MANAGER | MEMBER | VIEWER |
| --- | --- | --- | --- | --- |
| Open the manager sidebar (`Ui.context`) | ✅ | ✅ | ⚠️ only with `ALLOW_MEMBER_SELF_SERVICE=true` (own scope) | ❌ |
| Create project / subproject | ✅ all | ✅ | ❌ | ❌ |
| Assign a task to someone | ✅ all | ✅ own projects | ❌ | ❌ |
| Update task progress | ✅ all tasks | ✅ own projects and own tasks | ⚠️ own tasks only, self-service opt-in | ❌ |
| Approve an assignment / confirm a schedule | ✅ all | ✅ own projects and own tasks | ❌ | ❌ |
| View member directory | ✅ full | ✅ full | ⚠️ id/name/active only (+ own record) | ❌ |
| View skill matrix | ✅ full | ✅ full | ⚠️ own row only | ❌ |
| Edit skill assessments | ✅ | ✅ | ❌ | ❌ |
| Maintain member records | ✅ | ✅ (no role change) | ❌ | ❌ |
| Grant/revoke `ADMIN` or `MANAGER` | ✅ (never self) | ❌ | ❌ | ❌ |
| Deactivate a member | ✅ (not the last admin) | ✅ (not the last admin) | ❌ | ❌ |
| Change automation settings | ✅ | ✅ (never activate LIVE) | ❌ | ❌ |
| Enable LIVE mail | ✅ + confirmation + preflight | ❌ | ❌ | ❌ |
| Stop mail (OFF / emergency stop) | ✅ | ✅ | ❌ | ❌ |
| Install triggers | ✅ (creator account only) | ✅ (creator account only) | ❌ | ❌ |
| Bootstrap the first administrator | ✅ one-time, allowlisted | ❌ | ❌ | ❌ |

**Default posture:** the sidebar is trusted-manager only. `ALLOW_MEMBER_SELF_SERVICE` defaults to `false`, so a
MEMBER/VIEWER caller is refused with `Member self-service is disabled: manager access is required`. The scoped
member code path exists and is tested, but enabling it requires accepting that the member can already read every
sheet in the workbook — the application scope then adds no confidentiality.

"Own tasks" means `TASKS.Owner_Member_ID` equals the caller's verified `Member_ID`. "Own projects" means
`PROJECTS.Project_Owner_ID` or `SUBPROJECTS.Owner_ID` equals the caller's `Member_ID`.

## 3. Privilege-escalation prevention

- `Members.guardRoleChange` refuses any change to `ADMIN`/`MANAGER` unless the verified caller is `ADMIN`, refuses
  any self-change of a member's role (a second administrator must perform it), and refuses demotion or
  deactivation of the last active administrator.
- `Roles.requireValidRole` rejects unknown role text instead of silently downgrading it to `VIEWER`.
- Every UI bridge (`src/Ui.gs`) re-derives identity from the session and calls `Access` before touching a record.
  A payload claiming `role: 'ADMIN'` or `actor: '<someone else>'` has no effect.
- `Access.requireTaskWrite` loads the task from the workbook and compares it with the caller's scope; a task ID
  that belongs to another member or another manager's project is rejected.
- Enabling LIVE mail is a *transition* check: it triggers on the effective state (including clearing the
  emergency stop while `EMAIL_MODE=LIVE`) and requires ADMIN, the exact confirmation `ENABLE LIVE EMAIL`, and a
  passing preflight. A MANAGER can stop mail immediately but can never restart it.
- The `AUTOMATION_SETTINGS` status keys (last run, last backup, last refresh) cannot be written from the settings
  form, so a caller cannot forge automation evidence.

## 4. First-administrator bootstrap

`bootstrapFirstAdministrator(actorEmail, confirmation)` requires, in order:

1. a valid environment binding (`Config.get()`);
2. `actorEmail` equal to the verified session address;
3. the exact confirmation `BOOTSTRAP ADMIN <email>`;
4. `ADMIN_BOOTSTRAP_ALLOWLIST` (Script Property, deployment-controlled) containing that address;
5. no previous bootstrap (`ADMIN_BOOTSTRAP_COMPLETED_AT` unset);
6. an initialized workbook whose schema version equals `Schema.version`;
7. the `DATABASE_ENVIRONMENT` marker row;
8. notifications not yet activated and an empty `NOTIFICATION_LOG`;
9. no active administrator;
10. an existing, active member record with that email.

It then sets the role to `ADMIN`, records `ADMIN_BOOTSTRAP_COMPLETED_AT`, and writes an `ADMIN_BOOTSTRAPPED`
audit row. Re-running it fails, so it is not a reusable back door and cannot be applied to an operational
workbook.

## 5. Employee data visibility

| Data | MEMBER | MANAGER/ADMIN |
| --- | --- | --- |
| Other members' email, department, position, capacity, role | hidden (`id`, `name`, `active` only) | visible |
| Own record | visible | visible |
| Skill assessments (level, evidence, training, reviewer) | own only | all |
| Skill gaps for other people's tasks | hidden | visible |
| Projects and tasks | only those the member owns a task in | manager scope / all |

The generated `SKILL_MATRIX` sheet is a workbook artifact; anyone who can open the spreadsheet can read it. Do
not share the workbook with staff who must not see assessments — see §6.

## 6. Google Sheets sharing limitations

- Anyone with **edit** access can change operational data, rewrite roles, edit the audit log, and read every
  sheet, including assessments and notification history.
- Anyone with **view** access reads everything too. Cell-level hiding is cosmetic only.
- A bound script's source is editable by users granted edit rights on the Apps Script project; they can bypass
  the application.
- Therefore V1.1 explicitly restricts staff-facing use: keep the workbook restricted to trusted managers and do
  not advertise per-employee role separation as a security guarantee.
- A future employee-facing application (separate deployment, its own authorization) is the correct place for
  broader self-service access.

## 7. Audit log limitations

`AUDIT_LOG` is append-oriented application history, **not** tamper-proof: spreadsheet editors can delete or edit
rows, and the actor is whatever `Session.getActiveUser()` returned (blank when Google cannot disclose it, for
example a consumer account). Treat it as an operational record, not forensic evidence.

## 8. Threat assumptions

In scope (application-level):

- A manager or member with legitimate access attempting something their role does not allow.
- A crafted `google.script.run` payload that claims a different role, actor, owner or confirmation.
- Spreadsheet content containing HTML/script text that reaches another user's sidebar.
- Accidental activation of live mail or a forgotten emergency stop.
- Accidental loss of the last administrator.

Out of scope (deployment-level):

- Anyone with spreadsheet or script edit rights intentionally bypassing the application.
- Google account compromise, Workspace admin abuse, OAuth scope abuse.
- A compromised deployment machine holding `clasp` credentials.
- Denial of service, quota exhaustion, or mail provider delivery failures.

## 9. Residual risks

| Risk | Mitigation / status |
| --- | --- |
| Spreadsheet editors bypass all checks | Documented; restrict sharing to trusted managers |
| Trigger owner leaves the organisation | Documented handover: reinstall triggers with the new account |
| Ambiguous mail delivery | Ledger `PENDING` → `DELIVERY_UNCERTAIN`; never auto-retried; manual reconciliation |
| Health/progress heuristics mislead | Documented thresholds, unknown counts reported separately, human review |
| Legacy compatibility path still allows unmigrated workbooks to send | Only with explicit `ALLOW_LEGACY_EMAIL_CONFIG=true`; default is fail-closed |
| No live Workspace verification in this repository | See [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) |
