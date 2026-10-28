# Security model

## V1.6.1 review of the corrective release

No permission model, role matrix, scope, property or manifest changed. The release reviewed the paths it touched:

- **Deletion.** Still `Access.requireAdmin()` at the service layer and `{admin: true, confirm: true}` in the API
  allowlist, plus the typed `DELETE <id>` confirmation, a verified backup and the script lock. V1.6.1 adds a durable
  intent record before the removal and a tombstone before success is reported, so an interrupted removal can no
  longer produce an unrecorded row. The recovery entry point (`reconcileDeletions`, API `deletionReconcile`) is
  ADMIN-only, requires the fixed `RECONCILE DELETIONS` text and **can only append an audit row**; it has no delete
  capability, and a test asserts that a row that still exists is left untouched. Cascading removal — the only path
  that could remove more than one authorised record per confirmation — was removed.
- **Completion.** A container task can never be completed directly. The refusal is server-side on inbox import and
  again before the request is claimed, so a crafted inbox row cannot strand a request or force a container write.
- **Ownership history.** Attribution uses the immutable `Member_ID` and the audit actor. A self-reported requester
  name is never used, and the profile never returns a private field. The member view remains manager-only.
- **Employee app.** Still read-only, deployer-executed, allowlisted DTOs. `requestTarget` now also returns the
  container flag so the request service refuses a report a manager could never approve; nothing else is exposed.
- **Stored text.** Every new label is an i18n key; all stored values are rendered with `textContent`. `npm run
  validate` reports no `innerHTML`/`document.write` and no dashboard access to `MailApp`/`DriveApp`/`ScriptApp`.

Residual risks are unchanged: Google Sheets sharing means a manager with editor access to workbook A can read every
sheet, identity depends on the deployment ACL, and no live Workspace verification of any of the above was performed.

## V1.5 manager web security

The browser manager extends the existing internal departmental tool with no per-project, per-responsibility or per-subproject access control. Deploy USER_ACCESSING + DOMAIN. Active-session email must match MANAGER_WEB_ALLOWED_DOMAINS and an active ADMIN/MANAGER record. Browser actor claims are rejected. Authorization precedes DTO construction and is repeated for locked mutations. Sensitive role/owner/automation edits remain ADMIN-only; normal managers administer departmental work. A domain-only restriction is insufficient.

Trusted managers require underlying A/service permission in this mode. Ordinary employees must not receive A access. B/C and employee deployment remain separate. Cache is execution/page local; no shared private CacheService or persisted drafts. Read DTOs exclude deployment identifiers/custom private columns; unknown actions are refused. Existing global entrypoints retain their existing Access/Roles checks; manager RPCs do not expose Database or arbitrary function dispatch. Google identity and real sharing tests remain BLOCKED pending [DEV verification](MANAGER_WEB_APP_SMOKE_TEST.md). See [identity research and deployment tradeoff](MANAGER_WEB_APP_DEPLOYMENT.md).


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

Engineering-HUB is an internal departmental tool, so the policy is deliberately simple. There is no
per-project, per-responsibility or per-subproject access control: an ADMIN or MANAGER manages the
department's work, and ownership columns record accountability only.

| Capability | ADMIN | MANAGER | MEMBER | VIEWER |
| --- | --- | --- | --- | --- |
| Open the manager sidebar (`Ui.context`) | ✅ | ✅ | ⚠️ only with `ALLOW_MEMBER_SELF_SERVICE=true` (own scope) | ❌ |
| Create / edit / archive project or subproject | ✅ all | ✅ all | ❌ | ❌ |
| Create / edit / re-order / retire responsibilities | ✅ all | ✅ all (owner change is ADMIN-only) | ❌ | ❌ |
| Assign a task to someone | ✅ all | ✅ all | ❌ | ❌ |
| Update task progress | ✅ all tasks | ✅ all tasks | ⚠️ own tasks only, self-service opt-in | ❌ |
| Approve an assignment / confirm a schedule | ✅ all | ✅ all | ❌ | ❌ |
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

"Own tasks" means `TASKS.Owner_Member_ID` equals the caller's verified `Member_ID`. That is the only
ownership test left in an authorization decision; `PROJECTS.Project_Owner_ID`, `SUBPROJECTS.Owner_ID`
and `RESPONSIBILITIES.Owner_Member_ID` are accountability labels that never gate a write.

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

## 10. Shared dashboard (V1.2)

The employee-facing dashboard is a **separate** application with a deliberately smaller
surface.

| Control | Implementation | Limit |
| --- | --- | --- |
| No write path | The dashboard project contains no spreadsheet write, mail, Calendar, Drive, trigger or fetch call; `npm run validate` rejects them, and the only client-callable functions are `dashboardPortfolio`, `dashboardProject`, `dashboardTask`. | A person with Apps Script edit access to the dashboard project could add code. Restrict project access. |
| No management workbook access | The dashboard reads only `SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID`; the master property is not readable from that project and is rejected by validation. | The deployment account must not otherwise hold edit rights on the master workbook — an organisational control. |
| Data minimisation | Explicit allowlisted DTOs; e-mail addresses, skills, capacity/HR data, logs, settings, private descriptions and acceptance criteria are excluded by construction and asserted by tests. | A future field added to the allowlist needs review. |
| Publication safety | A/B slots, read-back verification (headers, counts, SHA-256), single metadata commit, script lock, master-workbook refusal, `INTERNAL`-only visibility, ADMIN + exact confirmation to enable. | Publication is a projection; it cannot fix a wrong visibility decision. |
| Viewer access | Web app ACL `access: DOMAIN`, execute as deployer, read-only scope. An optional server-side domain check adds defence in depth. | `Session.getActiveUser().getEmail()` may be empty for execute-as-deployer apps, so the ACL is the real control. Client-side hiding is never used. |
| Viewer identity | The address stays server-side; the API returns only `{ok}`. | Per-user filtering is intentionally **not** implemented: every authorised viewer sees the same approved portfolio. |

Residual dashboard risks: the deployment ACL is misconfigured to "Anyone"; the snapshot
workbook is shared more widely than intended; a manager marks the wrong project `INTERNAL`;
or nobody reviews publication freshness. Each has a documented mitigation in
[dashboard/ACCESS_AND_SHARING.md](dashboard/ACCESS_AND_SHARING.md) and
[dashboard/SMOKE_TEST.md](dashboard/SMOKE_TEST.md), and none has been verified live.

## V1.3 — worker requests and localization

### Trust boundaries

| Boundary | Control |
| --- | --- |
| Browser → dashboard server | domain-restricted deployment, viewer check, whitelisted payload keys, length limits, rate limit, duplicate guard, script lock |
| Dashboard → inbox workbook | the only permitted write is an appended, validated request row; the private workbook ID is never present in that project |
| Inbox → manager application | the manager imports rows and revalidates every value; nothing from the inbox is treated as authority |
| Manager → private workbook | the existing role check (`Roles.requireAtLeast('MANAGER')`), revision/staleness checks and an explicit `DECIDE REQUEST` confirmation |

### What a request cannot do

* A request cannot change a deadline. Only a manager approval can, once.
* A request cannot carry a role, approval flag, owner ID or task version that the server
  trusts.
* A requester name is unverified self-reported text and is labelled as such in the UI.
* A request never exposes request text on the shared dashboard: only a boolean pending
  indicator is published.

### Localization safety

* Translation is a display concern: no server decision depends on the selected language.
* Stored text, identifiers and enum values are never translated, so a language switch cannot
  change data and cannot be used to smuggle content.
* The dictionary is static, local and contains no network access, so no data leaves the
  tenant through the UI.
* No credential, token or account is introduced by the language feature; the preference is
  browser-local only.

### Residual risks

* The dashboard deployment can append to the inbox; a compromised deployment or an
  employee with editor rights on that spreadsheet could add rows. Manager review, revision
  checks and rate limits bound the impact, and no row can change a task on its own.
* Exactly-once mail delivery is not promised; ambiguous deliveries are recorded and resolved
  manually.


## V1.4 — responsibilities and hierarchy

### Responsibility administration scope

`Access.canManageResponsibility` is the only policy, applied on the server for every entrypoint:

| Actor | Scope |
| --- | --- |
| ADMIN | every responsibility, including ownership changes |
| MANAGER | every responsibility; may create one (becoming its owner) but may not change an owner |
| MEMBER / VIEWER | none |

A responsibility is an organizational grouping, **not** a permission boundary. It neither grants
nor restricts access: `Access.requireProjectWrite` admits any verified ADMIN or MANAGER for any
project, so two managers can always collaborate and no ownership column stands between them and
the department's work. A project transfer writes `Responsibility_ID` only, so `Project_Owner_ID`,
deadlines, status and progress are unchanged.

### New write paths

| Entry point | Server check | Audit |
| --- | --- | --- |
| `uiSaveResponsibility` | `Access.requireManager` + `canManageResponsibility` (+ ADMIN for an owner change) | `CREATE` / `UPDATE` on `RESPONSIBILITIES` |
| `uiMoveResponsibility` | `Access.requireManager`; validated, de-duplicated ID list | `RESPONSIBILITY_REORDERED` |
| `uiRetireResponsibility` / `uiReactivateResponsibility` | `Access.requireManager` | `RETIRE` / `REACTIVATE` |
| `uiTransferProject` / `uiUpdateProject` | `Access.requireProjectWrite` | `RESPONSIBILITY_TRANSFERRED` with both IDs, actor and reason |
| `uiSaveSubproject` / `uiArchiveSubproject` / `uiReactivateSubproject` | `Access.requireManager` | `REPARENT` / `ARCHIVE` / `REACTIVATE` |
| `uiMoveTask` | `Access.requireManager` + `Access.requireTaskWrite` | `TASK_MOVED` |

A confirmation flag supplied by the browser is a user-intent gate, never authority: every one of
these paths re-checks the role and the record scope on the server.

### Direct callable surface

Apps Script exposes every top-level function to the editor and to `google.script.run`. The
record-mutating globals (`createProject`, `updateProject`, `archiveProject`, `createSubproject`,
`updateSubproject`, `reparentSubproject`, `archiveSubproject`, `reactivateSubproject`,
`createTask`, `updateTask`, `reassignTask`, `completeTask`, `recordTaskBlocker`,
`createResponsibility`, `updateResponsibility`, `retireResponsibility`,
`reactivateResponsibility`, `reorderResponsibilities`, `transferProjectResponsibility`,
`createMember`, `updateMember`, `deactivateMember`, `createIssue`, `updateIssue`,
`createMilestone`, `updateMilestone`, `createSkill`, `updateSkill`, `setMemberSkill`,
`createDatabaseBackup`) re-check the verified role before delegating to the domain service.
Read entrypoints that expose manager-only data (`listMembers`, `listResponsibilities`,
`pendingRequests`, `healthCheck`, `validateSystem`, `analyzeManagement`) are manager-gated, and
`listProjects` / `listTasks` return only rows visible to the caller. `createMember` accepts the
first row of an empty workbook, because no role can exist yet; that is the documented bootstrap
step and every later member requires a manager.

### Published risk surface

The snapshot publishes only the responsibility ID, its display name, its display order and a
retired flag — only for areas that label a published project. The internal description, the owner,
private project text and every log stay private. An older snapshot contract is rejected
(`SNAPSHOT_CONTRACT_UNSUPPORTED`) rather than read as if it had the new fields.

### Residual risks

- A Google Sheets editor can still change the workbook and a container-bound script's source; the
  application controls are not a substitute for Drive permissions.
- Responsibility names are user text. They are rendered with `textContent` only, and the
  publisher escapes a leading `=`, `+`, `-` or `@`, but a manager can still publish a confusing
  label to every employee. Review names before enabling publication.
- Live Workspace behaviour (session identity, sidebar sandbox, Drive ACLs) remains unverified for
  V1.4; see [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).
