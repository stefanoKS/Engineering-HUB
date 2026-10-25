# Architecture

## Boundaries and source of truth

```text
Git / reviewed source → clasp push → environment-specific Apps Script project (container-bound for the UI)
                                          │
                     Script Properties (environment, IDs, master safety flags)
                                          │ explicit environment + workbook binding
                                          ▼
                              Google Sheets operational tables
                              │                 │
                    generated views      AUTOMATION_SETTINGS table
                              │                 │
                   opt-in Mail / dedicated Calendar / restricted Drive snapshots
```

`src/Schema.gs` is the executable field registry; `src/Migrations.gs` is the migration registry. Operational spreadsheet rows are the source of truth for business data. Generated sheets are disposable projections, not an alternative database. Git is the source of truth for code, not live data. Script Properties and trigger registrations are separately managed configuration. Manager automation preferences are operational data in `AUTOMATION_SETTINGS`, so a deployment cannot reset them.

## Modules

| Module | Responsibility |
| --- | --- |
| `Config.gs` | Validate explicit environment binding; parse conservative integration settings from Script Properties. |
| `Schema.gs` | Table names, stable IDs, field types, defaults, references, enums, generated-sheet allowlist, schema version. |
| `Database.gs` | Bound workbook access, header-based reads, validation, explicit-field and bounded batch updates, script lock, generated output. |
| `Migrations.gs` | Empty-workbook initialization, approved additive upgrades, preservation checks, version history. |
| `Backup.gs` | Private Drive snapshot, content/formula verification, backup result log. |
| `AutomationSettings.gs` | Persisted manager preferences, validation, audit records, effective mail-mode resolver, safe defaults. |
| `Roles.gs` | Server-side role resolution (`ADMIN`/`MANAGER`/`MEMBER`/`VIEWER`) from the verified Google account. |
| `Access.gs` | Authorization policy: identity, member/manager/admin gates, task and project scope, member directory and skill visibility, one-time administrator bootstrap. |
| `Eligibility.gs` | One policy for active work, notification eligibility and archived/cancelled exclusion. |
| `Estimates.gs` | Known versus unknown effort; unknown is never coerced to zero. |
| `Progress.gs` | Effort-weighted task/subproject/project rollup with the documented fallback weight 1. |
| `Health.gs` | Deterministic health labels, reason codes, staleness and configurable thresholds. |
| `Projects.gs`, `Subprojects.gs`, `Tasks.gs`, `ScheduleConfirmations.gs` | Validated domain mutations, separate assignment approval and schedule confirmation, freshness tracking, task queries. |
| `Members.gs`, `Skills.gs` | Member lifecycle with safe deactivation, role field, skill assessments and gap detection. |
| `Milestones.gs`, `Issues.gs` | Gates, milestone state, issue tracking. |
| `Planning.gs` | Holiday-aware reverse planning with persisted per-project plans, and weekly workload estimates. |
| `Dashboard.gs` | Portfolio/attention metrics, project overview, team view, Gantt fallback, generated views. |
| `Reports.gs` | Weekly management report content. |
| `Notifications.gs` | Single send gate: mode resolution, feature switches, ledger, reminders, weekly report delivery, reconciliation. |
| `CalendarSync.gs` | Opt-in milestone synchronization to a dedicated secondary calendar. |
| `Triggers.gs`, `Main.gs` | Explicit authorized trigger installation, diagnostics and manual/scheduled entrypoints. |
| `Ui.gs`, `UiMenu.html`, `UiSettings.html`, `UiSystem.html` | Container-bound Japanese manager UI; delegates every write to domain services. |
| `UiSafe.html` | Shared client-side renderer; builds DOM nodes with `textContent` only and never interpolates markup. |
| `AuditLog.gs` | Actor identity and append-oriented audit history. |
| `SharedDashboardModel.gs` | V1.2. Pure projection from operational rows to allowlisted public DTOs: visibility, reference integrity, aggregates, content hash. |
| `SharedDashboardPublisher.gs` | V1.2. Snapshot destination guard, serialized publication into A/B slots, read-back verification, metadata commit, status/preview/settings, snapshot initialization. |
| `dashboard-app/` | V1.2. **Separate** read-only Apps Script web app (`App.gs`, `DataService.gs`, `Index.html`, `Styles.html`, `Client.html`). Reads only the sanitized snapshot workbook. |

Apps Script loads `.gs` files into one global runtime; there is no module bundler or database server. The manifest defines runtime, timezone, and OAuth scopes. Local tooling executes source with mocked Google services; it is not a Workspace emulator. `npm run validate` additionally enforces that only `Notifications.gs` calls `MailApp.sendEmail` and that HTML templates are packaged by `.claspignore`.

## Two applications, one operational database (V1.2)

```text
manager project (src/, container-bound)
        │  reads
        ▼
management workbook  ──▶  SharedDashboardModel (allowlist)  ──▶  snapshot workbook
                                                                  PUBLISHED_*_A / _B + META
                                                                          │ read-only
                                                                          ▼
                                                          dashboard-app (separate web app)
```

The management workbook stays the only operational database. The snapshot workbook is a
derived projection of allowlisted fields, written into the inactive of two data slots and
committed by a single metadata write, so readers never see a partial publication. The
dashboard project has no code path to the management workbook, no write API and no mail,
Calendar, Drive or trigger access; `npm run validate` enforces those constraints.

Details: [docs/dashboard/ARCHITECTURE.md](docs/dashboard/ARCHITECTURE.md) ·
[docs/dashboard/DATA_CONTRACT.md](docs/dashboard/DATA_CONTRACT.md).

## Data safety and concurrency

Records use stable IDs, never sheet row numbers as identity. Columns are found by header. Input types, foreign keys and domain rules are validated before application writes. User-supplied formula-looking strings are escaped when written as operational text.

High-level shared mutations use `LockService` through `Database.withLock`. Sheets is not a transactional database: a process can stop between cell writes, and a script lock does not prevent a human editor from modifying cells. Inspect partial failures; do not assume automatic rollback. Direct sheet editing also bypasses domain-level validation and auditing.

Low-level `Database.insert`/`update`/`updateMany` do not automatically acquire a lock; business wrappers must wrap shared mutations in `Database.withLock`. `updateMany(table, [{id, patch}])` validates the whole batch before writing and groups consecutive explicit cells per column without rewriting untouched cells; it is still not a transaction. Inserts populate registry defaults and generate missing IDs; `Database.find` returns `null` when no matching record exists. `Config.require` accepts the uppercase Script Property name.

Updates write explicit fields rather than replacing operational sheets. Reviewed migrations append missing schema elements, verify old values/formulas, and record success only after checks pass. Custom columns are preserved but are not supported application input fields. Generated sheets can have their contents cleared and rebuilt; do not store manual notes or unique data there.

Notification baselines are written through `Database.updateMany` for the changed rows only, not by rewriting every task's system cells.

## Versioning and recovery

Current schema version is **3**.

- Version 1: base tables and fields.
- `002_task_assignment_safety` (1 → 2): task assignment version, approval timestamp, notification baseline.
- `003_management_reliability` (2 → 3): `AUTOMATION_SETTINGS`, `PROJECT_PHASES`, `SCHEDULE_CONFIRMATIONS`, `PROJECTS.Notification_Enabled`, `MEMBERS.Role`, notification reconciliation columns, and seeded safe automation defaults (mail OFF).

A fresh empty workbook is initialized directly to the current version. Existing versioned workbooks use explicit migration approval. Unversioned workbooks require an administrator-reviewed import/migration design; they are not automatically adopted.

Migration backup and preservation checks are safeguards, not a transaction. Every approved migration takes its own verified backup; the `DAILY_BACKUP_ENABLED` switch cannot bypass that. On failure, keep the workbook and backup for inspection. Restore is manual to a new Drive copy and requires deliberate configuration rebinding.

## Automation semantics

`AutomationSettings.emailState` is the single effective-mode resolver. A configured workbook is governed by the persisted `EMAIL_MODE` plus the legacy `EMAIL_ENABLED`/`DRY_RUN` safety flags (which must also allow sending for `LIVE`). A workbook without an `EMAIL_MODE` row keeps the legacy flag mapping and is reported as `LEGACY_CONFIGURATION`; a version-3 migration seeds `OFF` defaults, so upgraded workbooks cannot be activated by legacy flags alone.

Eligible notifications require current assignment approval, matching baseline, task opt-in, project opt-in, an open project/subproject, active member, allowed recipient domain, an enabled feature switch, and a non-OFF mode. Assignment/due-date edits invalidate the baseline; other material assignment edits are handled by the domain layer. Progress updates keep approval.

The mail ledger reserves a notification key as `PENDING` before calling MailApp. Success changes it to `SENT`. A pending/uncertain outcome is not automatically resent; `reconcileUncertain` marks stale rows `DELIVERY_UNCERTAIN` with actor and timestamp. This avoids blind retries but can require manual reconciliation and can miss a delivery if execution stops before the send. Exactly-once email delivery is not guaranteed.

PREVIEW evaluates eligibility, records `PREVIEW` rows and never calls MailApp or consumes live dedupe keys. Reminder offsets, catch-up window, overdue frequency, weekday-only sending and the JST execution window are configurable. Only the most relevant unsent stage is sent inside the catch-up window.

Calendar synchronization uses stored event IDs, a workbook/milestone ownership marker, and a content hash. Missing or foreign events are skipped rather than blindly recreated. Cancelled milestones are marked, not deleted. A failure between external event creation and persistence of its ID can still need manual repair. The hourly `scheduledNotificationScan` handler also invokes Calendar sync, but Calendar remains disabled until both `CALENDAR_ENABLED` and `CALENDAR_SYNC_ENABLED` allow it.

Installable triggers execute as their creator. `Triggers.diagnostics()` inspects installed, missing and duplicated handlers for the current account; another editor may not see them. Turning a feature off suppresses its side effects even when the trigger still exists. The weekly report handler is installed only when the feature is enabled.

## Planning, progress and views

Reverse planning walks phase dependencies backward from a deadline, excluding weekends and `HOLIDAYS`, and includes phase buffers. Missing durations produce `DRAFT` output rather than invented dates. The resulting rows are persisted per project in `PROJECT_PHASES` with `Plan_Version` and `Active`; superseded rows are kept as history, and `BACKPLAN` is a replaceable overview of all active phases. This is not a full resource-constrained optimization engine.

Effort-weighted progress uses known positive estimates as weights, excludes cancelled work, and gives unknown estimates the documented fallback weight 1 while reporting them separately. A project without tasks reports `未計算`. Health is a deterministic heuristic with configurable thresholds and is never `GREEN` when schedule information is missing.

Weekly workload apportions remaining estimated hours across working days, reports actual hours separately, and flags over-capacity members. It is an estimate, not a timesheet or guaranteed availability forecast. Staleness uses `Last_Updated`, which only application-managed changes update — a dashboard refresh does not.

`TIMELINE_DATA` is a normal sheet suitable for manual native Timeline setup where Google supports it. `GANTT_OVERVIEW` is the fallback portfolio/detailed view. No Google edition entitlement or native Timeline creation is assumed.

## Roles and the manager UI

The manager UI requires a container-bound Apps Script project. `onOpen` adds a menu only; it never installs triggers. Every sidebar action calls a `google.script.run` bridge in `Ui.gs`, which performs a server-side role check and then calls the same validated domain service used by the editor and triggers. Mail is never sent from a browser callback.

Google Sheets editor access is not an administrator boundary: an editor can change the workbook and, if allowed, the bound script. V1.1 therefore assumes trusted managers, keeps private assessment details out of member-level views, and does not claim production-grade role separation.

## GitHub versus live state

| Concern | Source of truth | Changed by |
| --- | --- | --- |
| Application source | This Git repository | Reviewed commits + `clasp push` |
| Operational records (projects, tasks, members, skills, issues, milestones, phases) | Workbook sheets | Domain services, or direct spreadsheet edits |
| Manager automation preferences | Workbook `AUTOMATION_SETTINGS` | UI / `AutomationSettings.save` (audited) |
| Environment binding, IDs, master safety flags, bootstrap allowlist, trigger signature | Script Properties | Deployment operator only |
| Installable triggers | Apps Script project, owned by their creator | `Triggers.install` |
| Backups | Restricted Drive folder | Manual or scheduled `Backup.create` |
| Notification/audit evidence | `NOTIFICATION_LOG`, `AUDIT_LOG` | Application only (editable by spreadsheet editors) |

`clasp push` replaces code only. It never migrates data, never changes Script Properties, never installs triggers
and never resets automation settings. A code rollback is not a data rollback.

## Authorization architecture (hardening)

- Identity is read only from `Session.getActiveUser()`. `Roles.describe` resolves the member record, role and
  active flag; a blank role is `VIEWER`.
- `Access.gs` is the single policy layer. UI bridges call `Access.requireUiAccess`, `requireManager`,
  `requireTaskWrite` or `requireProjectWrite` *before* touching a record, then delegate to the validated domain
  service. No bridge reads a role, actor or owner from `google.script.run` arguments for authorization.
- Scope: ADMIN → all; MANAGER → tasks they own plus projects/subprojects they own; MEMBER → only tasks they own
  (and only when `ALLOW_MEMBER_SELF_SERVICE=true`); VIEWER → no sidebar surfaces.
- Privilege changes: only ADMIN may grant/revoke `ADMIN`/`MANAGER`; nobody may change their own role; the last
  active administrator cannot be demoted or deactivated.
- The first ADMIN is created only by `bootstrapFirstAdministrator`, which needs a deployment allowlist, the exact
  confirmation, an initialized current-schema workbook and no prior bootstrap/activation.

## Trust limits of the bound UI

A Sheets-bound Apps Script project is **not** an administrative security boundary: anyone who can edit the
spreadsheet can change operational cells (including roles and the audit log), and anyone who can edit the bound
script can bypass the application entirely. V1.1 therefore restricts the UI to trusted managers, hides other
people's assessment details from MEMBER callers *within the application*, and documents that per-employee
separation requires a separate access-controlled application. See [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).

All spreadsheet-derived text is untrusted output: `UiSafe.html` renders with `textContent`, and
`npm run validate` rejects `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write` in `src/*.html`.

## Trigger ownership and execution account

- Triggers execute as their creator. `Triggers.install` requires the active and effective accounts to match and
  refuses to run for a different account.
- The desired schedule is derived from settings (hourly scan, hourly management refresh, daily backup at 02:00, and
  a weekly report only when enabled). It is serialised into `MANAGED_TRIGGER_SIGNATURE`; a mismatch, duplicate,
  missing or obsolete managed handler causes a full managed-trigger recreation. Unrelated triggers are never
  touched.
- Apps Script fires time-based triggers approximately; the configured minute is a target.
- Disabling a feature suppresses its side effects even while the trigger still exists (the handlers re-check the
  settings), and the obsolete weekly trigger is removed on the next installation.

## Failure modes and preservation

- A process can stop between cell writes; a script lock does not protect against simultaneous human edits. Partial
  writes are inspected, not rolled back automatically.
- Only generated sheets are cleared on refresh. Operational tables, custom columns and formulas are preserved;
  migrations verify cell values and formulas before recording success.
- A migration always creates a verified backup; the daily-backup switch cannot bypass it.
- Mail delivery is at-most-once from the application's perspective: `PENDING` before send, `SENT` on return,
  `DELIVERY_UNCERTAIN` after administrative reconciliation. Nothing is retried automatically.
- An unconfigured (pre-V1.1) workbook resolves to `OFF` and sends nothing; the legacy flag path requires the
  explicit `ALLOW_LEGACY_EMAIL_CONFIG=true` opt-in.

## Evidence and limitations

Local tests cover application behavior using mocks, not actual Google permission inheritance, OAuth consent, quotas, scheduling delays, or external delivery. No live verification, measured production throughput, previous prototype comparison, complete critical-path solver, or exactly-once guarantee is claimed.

## V1.3 — planning, requests and localization

Three additions keep the V1.1/V1.2 boundaries intact:

```
manager application (src/)
  Planning.gs        pure deadline + duration calculation, warnings, task plan application
  Requests.gs        inbox import, queue, idempotent decision, deadline history
  I18n.html          generated translation dictionary (client side only)

shared dashboard (dashboard-app/)
  RequestService.gs  validated append to the separate request inbox (the only write path)
  I18n.html          generated translation dictionary (identical copy)

shared/i18n.js       canonical dictionary (one source of truth for both projects)
```

* `Planning.planFromDuration` is pure: it takes a deadline, a duration, a unit, a basis and
  the holiday rows, and returns the derived start. `Tasks.validate` applies it so every write
  path (UI, request approval, script) derives the same schedule.
* `Requests` is the only module that reads the request inbox and the only one that turns a
  request into an authoritative task change. The dashboard never sees the private workbook.
* The published snapshot contract is `1.3`: `PUBLISHED_TASKS` gains the opaque
  `revision` (staleness detection) and the boolean `pendingRequest` (indicator only).
* Localization is a client concern. Server responses stay language-neutral (enum values and
  `{kind, days}` deadline pairs); the browser renders localized labels from the dictionary.
  Correctness does not depend on the selected language.
* Schema `5` (`005_task_planning_and_requests`) is additive: TASKS planning columns plus
  `TASK_REQUESTS` and `TASK_DEADLINE_HISTORY`. Generated sheets remain the only replaceable
  output.

## V1.3.1 — create/edit symmetry and implicit import

V1.3.1 keeps the same modules and adds no schema. It closes four usability gaps without
introducing a new write path.

```
manager sidebar (UiMenu.html)
  project form      create + edit (projectPick selects a record)   -> uiCreateProject / uiUpdateProject
  task form         create + edit (taskPick selects a record)      -> uiAssignTask
  publish button    manual snapshot publication                    -> uiPublishPublicationNow
  request sidebar   imports on open, then lists the queue          -> uiRequests -> Requests.importInbox
```

* **One adapter per record type.** `Ui.createProject` and `Ui.updateProject` both end in the
  validated `Projects` service; `Ui.assignTask` ends in `Tasks.create` or `Tasks.update`.
  Authorization stays server-side: `Access.requireManager`, `Access.requireProjectWrite` and
  `Access.requireTaskWrite`. Moving a task into another project additionally requires write
  rights on the destination project, so a task edit cannot be used to escape a scope.
* **Partial patches.** `taskPatch()` (and the field-by-field patch in `updateProject`) only
  include the keys the caller supplied. `Domain.save` merges the patch over the stored row,
  so an untouched owner, date, duration, estimate, notification preference, actual hours,
  progress or completion state is never rewritten. `Tasks.update` now stamps `Last_Updated`,
  which is what the optimistic-concurrency check compares.
* **Staleness guard.** The DTOs returned to the sidebar carry `updatedAt`. A save echoes it
  back; `Ui.updateProject` / `Ui.assignTask` refuse the write when the stored value changed,
  so a second manager cannot be silently overwritten.
* **Visibility is explicit.** `SharedDashboardModel.visibility()` treats blank/unknown as
  `RESTRICTED`; the sidebar exposes the decision (`Dashboard_Visibility`) and the public text
  (`Dashboard_Summary`) separately from the private `Description`. Publication still runs
  through the unchanged `SharedDashboardPublisher` A/B commit, and the UI states that a
  change appears at the next publication.
* **Import on open.** `Ui.requests()` calls `Requests.importInbox()` before reading the queue.
  The import runs inside `Database.withLock`, treats the inbox `Request_ID` as the permanent
  key, and converts a duplicate-ID collision into "skipped". A read failure is returned as
  `importError`; the queue is still rendered from the workbook.

