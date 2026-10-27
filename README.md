# Engineering-HUB

Engineering project management using Google Sheets as the database, Google Apps Script as the application, and GitHub as the source-code history.

[日本語](README_JP.md) · [Architecture](ARCHITECTURE.md) · [Data schema](DATA_SCHEMA.md) · [Deployment](DEPLOYMENT.md) · [Backup and restore](BACKUP_RESTORE.md) · [Pre-trial checklist](docs/PRE_TRIAL_CHECKLIST.md) · [Manager workflow](docs/MANAGER_WORKFLOW.md) · [Automation settings](docs/AUTOMATION_SETTINGS.md) · [Shared dashboard](docs/dashboard/ARCHITECTURE.md) · [Dashboard data contract](docs/dashboard/DATA_CONTRACT.md) · [Workspace smoke test](docs/GOOGLE_WORKSPACE_SMOKE_TEST.md) · [Security model](docs/SECURITY_MODEL.md) · [Operations runbook](docs/OPERATIONS_RUNBOOK.md)

## Release status — NOT APPROVED FOR PRODUCTION

| Field | Value |
| --- | --- |
| Release | V1.4.1 (final pre-trial stabilization) on top of V1.4 (responsibilities, nested subprojects, UI refinement), V1.3 (planning, requests, Japanese/English UI), V1.2 (shared read-only dashboard) and V1.1 + production hardening |
| Version | `1.4.1` |
| Local test count | **328 passing** (`npm test`), 0 failing; `npm run lint` and `npm run validate` pass |
| Schema version | **6** — `006_responsibilities_and_nested_subprojects` (additive only; approval + verified backup required). V1.4.1 adds **no** schema change |
| Verified locally | Simplified role policy (ADMIN/MANAGER manage the whole department, MEMBER keeps own-task self-service), server-side re-checks on every global RPC wrapper, validated responsibility reordering, a single coordinated project edit (ordinary fields + responsibility transfer), bounded hierarchy walks on malformed data, ancestor-aware active-work and reminder eligibility, a bounded task selector with server search, project visibility controls, partial-patch project/task editing, stale-edit refusal, automatic request import with idempotency and lock, unknown-vs-zero estimates, deadline-only assignment, separated approval/schedule confirmation, weighted progress, deterministic health, safe DOM rendering, first-admin bootstrap, OFF/PREVIEW/LIVE matrix, reminder offsets and catch-up, weekly report, trigger drift recreation, ledger states, data preservation on upgrade, sanitized dashboard DTO allowlist, `INTERNAL`-only publication, A/B snapshot commit and rollback-on-failure, read-only viewer API, deadline wording in Asia/Tokyo |
| Known production blockers | No live Google Workspace execution of any kind; development/production projects not created; roles blank after migration until bootstrap; real Sheets quota/performance unmeasured; repository visibility undecided; dashboard deployment ACL, Drive ACLs and scheduled publication unverified; request submission flag intentionally OFF until the operator enables it |
| Google Workspace verification | **UNVERIFIED** — nothing in this repository has been run against a real Workspace |

The canonical release gate is [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md). It stays at
**NOT APPROVED FOR PRODUCTION** until recorded live evidence exists; a green CI run cannot change it.

For a first installation, follow [docs/PRE_TRIAL_CHECKLIST.md](docs/PRE_TRIAL_CHECKLIST.md) step by step.

## Two applications

| Application | Source | Purpose |
| --- | --- | --- |
| Manager (container-bound) | `src/` | Operational database, sidebars, automation, publication |
| Shared dashboard (standalone web app) | `dashboard-app/` | **Read-only** portfolio for all employees; reads only the sanitized snapshot |

The dashboard never reads the private management workbook and has no write, mail, Calendar or
trigger access. Only projects explicitly marked `Dashboard_Visibility = INTERNAL` are
published. See [docs/dashboard/ARCHITECTURE.md](docs/dashboard/ARCHITECTURE.md) and
[docs/dashboard/ACCESS_AND_SHARING.md](docs/dashboard/ACCESS_AND_SHARING.md).


## Safety first

- Develop in a **separate Apps Script project and spreadsheet**. Never point development at production data.
- Deploying code does not migrate data. Git cannot restore spreadsheet rows, Drive files, Script Properties, or triggers.
- Initialization is only for an explicitly selected, empty workbook. Existing data requires reviewed, explicitly approved migrations.
- Email and Calendar integrations are disabled by default; dry-run is enabled by default.
- The V1.1 manager UI requires a **container-bound** Apps Script project; a standalone script cannot open a sidebar.
- Manager preferences live in the workbook `AUTOMATION_SETTINGS` table, so deployments never reset them, while credentials stay in Script Properties.
- Drive snapshots require a restricted backup folder. Backups are retained; the application does not automatically delete them.

## Quick start

Use Node.js 22 (at least 22.13.0) and PowerShell:

```powershell
npm ci
npm run lint
npm test
npm run validate
```

Then follow [docs/PRE_TRIAL_CHECKLIST.md](docs/PRE_TRIAL_CHECKLIST.md) to create an isolated
development project, push the two clasp targets, configure Script Properties, initialize an empty
spreadsheet, bootstrap the first administrator, publish a snapshot and deploy the dashboard.
[DEPLOYMENT.md](DEPLOYMENT.md) is the reference chapter for each area (and the only place for the
production gate); where the two differ, the checklist wins. `config.example.json` is a reference for
**Script Properties**, not credentials or an automatically loaded configuration file.

## V1.1 — Management usability, reliability and automation controls

Schema version 3 adds migration `003_management_reliability` (additive only; existing values are verified
unchanged before it is recorded as successful).

- **Unknown effort stays unknown.** `Estimated_Hours` defaults to blank; `0` is a deliberate zero. Workload,
  dashboards and the weekly report count unestimated tasks separately.
- **Assignment approval and schedule confirmation are separate.** A task can be assigned with only a deadline.
  Approval requires an active owner and a verified account; schedule confirmation additionally requires a known
  estimate. Progress updates do not revoke approval, material changes do.
- **One eligibility policy** (`Eligibility.gs`) keeps archived/cancelled work out of active workload, dashboards,
  reminders and reports while retaining all records.
- **Effort-weighted progress and deterministic health.** Progress writes only the computed columns; health is a
  documented heuristic with configurable thresholds (`GREEN`/`YELLOW`/`RED` plus `UNKNOWN`, `PLANNED`,
  `ON_HOLD`, `COMPLETED`, `CANCELLED`, `ARCHIVED`).
- **Japanese manager UI** (container-bound): menu, task assignment, progress, members, skills, issues,
  milestones, automation settings and system status. All writes go through the validated domain services.
- **Automation control center:** OFF/PREVIEW/LIVE mail mode, per-feature switches, per-project and per-task
  switches, configurable reminder offsets with bounded catch-up, weekly management report, Calendar and backup
  switches, persisted status and audit records. See [Automation settings](docs/AUTOMATION_SETTINGS.md).
- **Roles:** `ADMIN` > `MANAGER` > `MEMBER` > `VIEWER`, resolved from the verified Google session and enforced
  server-side. A blank role (for example after migrating) is treated as `VIEWER` until a manager assigns it. The
  sidebar is manager-only by default; a `MEMBER` gets own-task scope only when `ALLOW_MEMBER_SELF_SERVICE=true`,
  and that is not a confidentiality boundary (see [Security model](docs/SECURITY_MODEL.md)).
- **Reverse planning** persists a versioned plan per project in `PROJECT_PHASES`; re-planning one project never
  replaces another project's plan.
- **Reliability:** the mail ledger reserves `PENDING` before sending, never retries ambiguous delivery
  automatically, supports administrative reconciliation to `DELIVERY_UNCERTAIN`, and previews without consuming
  live dedupe keys.

Detailed gate evidence is in [docs/checkgates](docs/checkgates/GATE_1.md). The manual Google Workspace
verification guide is [docs/GOOGLE_WORKSPACE_SMOKE_TEST.md](docs/GOOGLE_WORKSPACE_SMOKE_TEST.md); it has not been
executed in a live Workspace as part of this repository.

### Production hardening (post-merge audit)

Five confirmed defects were corrected after the first V1.1 merge, each with new regression tests:

1. **Role escalation** — a MANAGER could grant `ADMIN`, and any caller could change a role through the UI payload.
   Roles are now guarded server-side (`Members.guardRoleChange`, `Access`), self-change is refused, and the last
   active administrator cannot be demoted or deactivated.
2. **Task ownership** — `updateProgress` trusted the task ID from the browser. MEMBER is now limited to their own
   tasks, MANAGER to projects/subprojects they own, ADMIN to everything, VIEWER to nothing.
3. **Unsafe HTML** — sidebars interpolated spreadsheet text into `innerHTML`. All rendering now uses DOM creation
   with `textContent` (`src/UiSafe.html`), and `npm run validate` rejects unsafe HTML APIs in templates.
4. **LIVE mail reactivation** — clearing the emergency stop while `EMAIL_MODE=LIVE` restarted delivery without an
   ADMIN check. LIVE is now authorized on the *effective-state transition*, so only an administrator with the
   exact confirmation and a passing preflight can restart it. Unmigrated workbooks now fail closed unless
   `ALLOW_LEGACY_EMAIL_CONFIG=true` is set deliberately.
5. **Weekly report schedule** — the trigger ignored `WEEKLY_REPORT_TIME` and weekday changes. The schedule is now
   derived from settings, drift is detected through a stored signature, and obsolete managed triggers are removed
   without touching unrelated ones.

Two management-correctness bugs were also fixed: `Health.staleDays` returned the thresholds object instead of a
number, and the dashboard reported every non-green project as having an unknown schedule. See
[SECURITY_HARDENING.md](docs/checkgates/SECURITY_HARDENING.md),
[AUTOMATION_HARDENING.md](docs/checkgates/AUTOMATION_HARDENING.md) and
[CORRECTNESS_HARDENING.md](docs/checkgates/CORRECTNESS_HARDENING.md).

Security posture and residual risks: [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).
Day-to-day operation: [docs/OPERATIONS_RUNBOOK.md](docs/OPERATIONS_RUNBOOK.md).

## Capabilities and boundaries

The application manages projects, members, skills, tasks, assignments, scheduling, progress, health and management views. Workspace automation is opt-in and must be reviewed before activation. The source and local tests are the implementation reference; local mocks do not prove that a live Google Workspace deployment, permissions, quotas, trigger delivery, or mail delivery works.

The bound manager UI is a Google Sheets menu with Japanese sidebars. Google Sheets editor access is not an
administrator boundary, so V1.1 assumes trusted managers only; a separate employee-facing application would be a
later release.

Google Sheets native Timeline availability depends on your Workspace edition and permissions. Set it up manually when supported; use the generated `GANTT_OVERVIEW` and `TIMELINE_DATA` sheets otherwise. Do not rely on automatic creation of a native Timeline.

This repository is a new implementation. No earlier prototype is included. There are no independently measured production performance benchmarks, claims of a complete resource-constrained critical-path solver, or guarantees of exactly-once external delivery. The local scale test uses mocks only.

## Typical development workflow

After initialization, run an editor wrapper like this **once in development**. These are example records, not production seed data; rerunning is not an upsert and may fail duplicate-email validation.

```javascript
function developmentExample() {
  var member = createMember({
    Name: 'Example Engineer', Email: 'engineer@example.invalid',
    Active: true, Role: 'MEMBER', Weekly_Capacity_Hours: 35
  });
  var project = createProject({
    Project_Name: 'Development example', Status: 'Active',
    Project_Owner_ID: member.Member_ID, Committed_Deadline: '2030-06-28'
  });
  var task = createTask({
    Project_ID: project.Project_ID, Task_Name: 'Review design',
    Owner_Member_ID: member.Member_ID, Planned_Start: '2030-06-03',
    Due_Date: '2030-06-07', Estimated_Hours: 8,
    Notification_Enabled: false
  });
  // Notifications must be activated once before assignment approval is accepted.
  activateNotifications('manager@example.invalid', 'ACTIVATE NOTIFICATIONS');
  approveTaskAssignment(task.Task_ID, 'manager@example.invalid', 'APPROVE ASSIGNMENT');
  confirmTaskSchedule(task.Task_ID, 'manager@example.invalid', 'CONFIRM SCHEDULE');
  refreshManagement();
  return {projectId: project.Project_ID, taskId: task.Task_ID};
}
```

`createMember` now defaults `Role` to `MEMBER`; assign `MANAGER`/`ADMIN` deliberately for operators. `refreshManagement()`
recalculates progress/health and refreshes dashboard, workload and skill views.

Use returned stable IDs with `updateProject(id, patch)`, `updateMember(id, patch)`, and `updateTask(id, patch)`. Set task `Status: 'Done'` together with `Progress_Percent: 100`. Reassign open tasks before deactivating a member; archive projects rather than deleting their history. Assignment approval is not permission to send mail: notification activation and the OFF/PREVIEW/LIVE gates are separate. Deadline-only assignment is valid; do not invent start dates or estimates.

For reverse planning, populate `PHASE_TEMPLATES` and `HOLIDAYS`, then call `reversePlan(projectId, '2030-06-28')`. Each project's plan is persisted in `PROJECT_PHASES`; review `BACKPLAN` for `DRAFT` phases and do not invent missing estimates. View refreshes replace generated output; keep manual notes elsewhere. See [Deployment](DEPLOYMENT.md) for exact activation and trigger entrypoints and [Manager workflow](docs/MANAGER_WORKFLOW.md) for the UI steps.

## Operations

1. Make and validate changes in development.
2. Review code and any migration separately.
3. Create and verify a restricted Drive backup before production data changes.
4. Deploy the reviewed source to the correct Apps Script project.
5. Apply only explicitly approved migrations, then inspect the resulting data.
6. Activate notifications and scheduled work only after the production checks in [Deployment](DEPLOYMENT.md).

See [AGENTS.md](AGENTS.md) for mandatory contributor safety rules and [CHANGELOG.md](CHANGELOG.md) for release notes.

## V1.3 — deadline + duration planning, worker requests and Japanese/English UI

V1.3 keeps the V1.2 architecture and adds five things:

1. **Branding**: every user-visible name is exactly `設計・開発課 管理` (browser title, dashboard
   heading, Sheets menu, settings and system screens). Internal identifiers are unchanged.
2. **Deadline + duration planning**: the manager enters a deadline, a required duration, the
   unit (days/weeks) and the basis (working days/calendar days). The planned start is
   calculated; the start date is no longer a primary input. The range is inclusive of the
   deadline, holidays are respected and the committed deadline is never changed silently.
   Duration is **not** labour hours. See [Task duration policy](docs/TASK_DURATION_POLICY.md).
3. **Worker requests**: any viewer of the internal dashboard may request a deadline change
   (earlier or later) or report completion for **any published task**. Submissions are
   validated and appended to a separate request inbox spreadsheet; the private workbook is
   never reachable from the dashboard. See
   [Deadline request workflow](docs/DEADLINE_REQUEST_WORKFLOW.md) and
   [Request inbox deployment](docs/REQUEST_INBOX_DEPLOYMENT.md).
4. **Manager approval**: the sidebar queue **申請一覧 / 承認待ち** imports, approves, rejects or
   returns requests. Only an approval changes `Due_Date`; every change is recorded in
   `TASK_DEADLINE_HISTORY` and audited. A request submitted before a newer change becomes
   `STALE` and cannot overwrite it.
5. **Japanese/English UI**: Japanese is the default, `日本語 | English` switches every static
   label immediately, and stored spreadsheet text is never translated. See
   [UI localization](docs/UI_LOCALIZATION.md).

What V1.3 deliberately does **not** do: no login or password system, no workload-overlap
validation, no duration-based capacity limits, no automatic reassignment and no blocking of
overlapping assignments. The manager decides whether a schedule is feasible.

Schema **5** adds `005_task_planning_and_requests`: the TASKS planning fields plus the
`TASK_REQUESTS` and `TASK_DEADLINE_HISTORY` tables. The migration is additive and requires
explicit approval; existing rows, dates, formulas and custom columns are preserved.

## V1.3.1 — final pre-trial stabilization

No schema change. V1.3.1 makes the existing features usable and safe for a first trial.

1. **Project visibility is a manager decision.** The project panel now carries
   社内ダッシュボードに表示する / *Show on internal dashboard* (`RESTRICTED` by default,
   `INTERNAL` only when a manager selects it) and 共有用概要 / *Dashboard summary*. The
   private `Description`, acceptance criteria, notes, skills and logs are still never
   published; only the allowlisted sanitized snapshot is. A save states that the change
   appears after the next publication, and the panel offers 共有ダッシュボードを今すぐ公開 /
   *Publish the shared dashboard now*, which calls the same `SharedDashboardPublisher.publish`
   that the automation settings screen uses (manual publication needs no activation switch;
   the scheduled trigger still requires ADMIN plus `ENABLE SHARED DASHBOARD PUBLICATION`).
2. **New projects have an owner.** A manager who creates a project without choosing an owner
   becomes the owner (their verified `Member_ID`). Another owner can still be selected; the
   server never invents an owner and never trusts a browser-supplied role.
3. **Projects and tasks can be edited.** 案件編集 / *Edit project* and タスク編集 / *Edit task*
   load the current values into the same form. The record ID is preserved, `Original_Deadline`
   is immutable, and `Projects.update` / `Tasks.update` receive a **partial patch**: an
   untouched field (owner, dates, duration, estimate, notification preference, actual hours,
   progress, completion state) is never overwritten with a blank default. A record that
   changed after the form was loaded is refused with a reload message instead of being
   overwritten. A committed-deadline change needs an explicit confirmation.
4. **The request queue imports by itself.** Opening 申請一覧 / *Pending requests* imports new
   inbox rows first, under the script lock, with the inbox request ID as the permanent ID, so
   repeated or simultaneous opens never duplicate a request. An unavailable inbox produces a
   warning and never hides requests that were already imported. 申請を取り込む / *Import
   requests* remains as the manual fallback.
5. **Request submission is explicitly OFF.** A configured inbox is no longer permission to
   accept submissions: the dashboard project must set `REQUEST_SUBMISSION_ENABLED=true`
   deliberately. See [Request inbox deployment](docs/REQUEST_INBOX_DEPLOYMENT.md).

Gate evidence: [docs/checkgates/V1_3_1_GATE_1.md](docs/checkgates/V1_3_1_GATE_1.md) … 
[V1_3_1_GATE_7.md](docs/checkgates/V1_3_1_GATE_7.md). Installation steps:
[docs/PRE_TRIAL_CHECKLIST.md](docs/PRE_TRIAL_CHECKLIST.md).

## V1.4 — responsibilities, nested subprojects and UI refinement

Schema version **6** (`006_responsibilities_and_nested_subprojects`). Additive only; nothing is
deployed or migrated automatically.

1. **担当領域 / Responsibility** groups projects as a configurable area with an owner, a status and
   a display order. Create, rename, re-order, retire, reactivate and transfer from 管理. Retirement
   keeps every project: the area stays visible and its projects are marked as needing a new one.
   Categories are unchanged and separate.
2. **Projects can move between areas** with a confirmation. The owner, deadline, status, progress,
   subprojects, tasks and history are not touched, and the transfer is recorded in the audit log.
3. **Two subproject levels.** A subproject can contain one nested subproject; a third level, a
   self-parent and a cross-project parent are refused. Reparenting validates the subtree instead
   of flattening it, and archiving cascades nothing.
4. **Progress stays honest.** A parent subproject rolls up its own and descendant tasks exactly
   once; unknown estimates stay unknown and are never turned into hours.
5. **The manager sidebar is simpler.** 案件 / タスク / 管理 with one section at a time, collapsed
   詳細設定 panels, a compact subproject tree, and a menu entry that opens the right section.
6. **The dashboard gains a responsibility filter and a nested hierarchy view.** Unsent request
   data survives a language switch, and the request form is only offered when the backend says
   submission is open.

Details: [docs/RESPONSIBILITIES.md](docs/RESPONSIBILITIES.md),
[docs/UI_UX_GUIDELINES.md](docs/UI_UX_GUIDELINES.md). Gate evidence:
[docs/checkgates/V1_4_GATE_1.md](docs/checkgates/V1_4_GATE_1.md) …
[V1_4_GATE_6.md](docs/checkgates/V1_4_GATE_6.md). Upgrade steps:
[DEPLOYMENT.md](DEPLOYMENT.md#v14-upgrade-5--6).

## V1.4.2 — checkbox-only rows are never records (database correctness patch)

No schema change (still **6**) and no dashboard contract change (still **1.4**).

1. **Phantom records removed.** Google Sheets materializes an unchecked checkbox as `FALSE`, so a
   freshly initialized table ends at row 1000 with 999 `FALSE` values and no stable IDs. Those
   preformatted rows are no longer read as records, and `Database.read` derives the checkbox
   columns from `Schema` instead of a hardcoded table or column.
2. **Records survive their own booleans.** A row with a stable ID is read even when every boolean
   field is `FALSE`; `0`, `TRUE`, text, dates and formulas are never treated as empty.
3. **No silent data loss.** A row holding data without a stable ID is reported as
   `Malformed record in <table> at row <n>` and is never discarded or overwritten.
4. **Correct insert position.** New records reuse the first preformatted row (row 2, then 3, …)
   instead of `getLastRow() + 1`. Formulas, custom columns and existing values are preserved, and
   no sheet row is deleted.
5. **Migrations unchanged in intent.** Fresh V6 initialization and approved V5→V6 upgrades still
   reject missing or duplicate stable IDs on meaningful rows and still preserve every legacy cell.

Live Google Workspace verification of this patch is still outstanding. Regression tests:
`tests/v1_4_2-checkbox-rows.test.js`.

## V1.4.1 — simplified authorization and pre-trial hardening

No schema change (still **6**) and no dashboard contract change (still **1.4**). This release
makes the application simpler to operate and closes the defects found in the final code review.

1. **One simple role policy.** ADMIN and MANAGER manage every project, subproject, task and
   responsibility in the department; MEMBER keeps own-task self-service and VIEWER stays
   read-only. Responsibility, project and subproject owners are accountability labels, not
   permission boundaries, so two managers can always collaborate.
2. **Every callable entrypoint re-checks the role.** The global Apps Script functions that write
   records now call `Access` before delegating to the domain service, so `google.script.run` and
   the editor cannot bypass a sidebar check.
3. **One coordinated project save.** A name/summary/deadline edit and a responsibility transfer
   are validated together and written as one project row update, so a refused transfer no longer
   leaves earlier fields committed.
4. **Reordering is deterministic.** Every submitted responsibility ID is validated, duplicates
   and unknown IDs are refused, and only rows whose `Sort_Order` actually changes are written.
5. **Hierarchy safety.** Malformed parent links can no longer recurse without bound, and a task
   is never placed inside an archived branch by accident.
6. **One eligibility rule.** Active work, reminders, reports and the published snapshot all use
   the same ancestor-aware subproject test.
7. **Task selection at scale.** The sidebar loads a bounded task window but tells the manager how
   many tasks exist and offers a server-side name search, so no task is silently unreachable.
8. **Clearer Japanese.** Organizational areas are 廃止 / 再有効化, never 退職 / 復職.

Gate evidence: [docs/checkgates/V1_4_1_GATE_1.md](docs/checkgates/V1_4_1_GATE_1.md) …
[V1_4_1_GATE_6.md](docs/checkgates/V1_4_1_GATE_6.md).


