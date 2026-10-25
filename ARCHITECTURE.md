# Architecture

## Boundaries and source of truth

```text
Git / reviewed source → clasp push → environment-specific Apps Script project
                                          │
                                   Script Properties
                                          │ explicit environment + workbook binding
                                          ▼
                              Google Sheets operational tables
                              │                 │
                        generated views   restricted Drive snapshots
                              │
                   opt-in Mail / dedicated Calendar
```

`src/Schema.gs` is the executable field registry; `src/Migrations.gs` is the migration registry. Operational spreadsheet rows are the source of truth for business data. Generated sheets are disposable projections, not an alternative database. Git is the source of truth for code, not live data. Script Properties and trigger registrations are separately managed configuration.

## Modules

| Module | Responsibility |
| --- | --- |
| `Config.gs` | Validate explicit environment binding; parse conservative integration settings. |
| `Schema.gs` | Table names, stable IDs, field types, defaults, references, enums, generated-sheet allowlist. |
| `Database.gs` | Bound workbook access, header-based reads, validation, explicit-field updates, script lock, generated output. |
| `Migrations.gs` | Empty-workbook initialization, approved additive upgrades, preservation checks, version history. |
| `Backup.gs` | Private Drive snapshot, content/formula verification, backup result log. |
| `Projects.gs`, `Subprojects.gs`, `Tasks.gs` | Validated domain mutations and task assignment approval. |
| `Members.gs`, `Skills.gs` | Member/skill management and skill assessments. |
| `Milestones.gs`, `Issues.gs` | Gates, milestone state, and issue tracking. |
| `Planning.gs` | Holiday-aware reverse planning and weekly workload estimates. |
| `Dashboard.gs` | Management, timeline/Gantt, workload and skill views. |
| `Notifications.gs` | Explicit activation, assignment approval/baseline reconciliation, capped allowlisted mail. |
| `CalendarSync.gs` | Opt-in milestone synchronization to a dedicated secondary calendar. |
| `Triggers.gs`, `Main.gs` | Explicit authorized trigger installation and manual/scheduled entrypoints. |
| `AuditLog.gs` | Actor identity and append-oriented audit history. |

Apps Script loads `.gs` files into one global runtime; there is no module bundler or database server. The manifest defines runtime, timezone, and OAuth scopes. Local tooling executes source with mocked Google services; it is not a Workspace emulator.

## Data safety and concurrency

Records use stable IDs, never sheet row numbers as identity. Columns are found by header. Input types, foreign keys and domain rules are validated before application writes. User-supplied formula-looking strings are escaped when written as operational text.

High-level shared mutations use `LockService` through `Database.withLock`. Sheets is not a transactional database: a process can stop between cell writes, and a script lock does not prevent a human editor from modifying cells. Inspect partial failures; do not assume automatic rollback. Direct sheet editing also bypasses domain-level validation and auditing.

Low-level `Database.insert`/`update`/`updateMany` do not automatically acquire a lock; business wrappers must wrap shared mutations in `Database.withLock`. `updateMany(table, [{id: id, patch: patch}])` validates the whole batch before writing and groups consecutive explicit cells by column without rewriting untouched cells; it is still not a transaction. Inserts populate registry defaults and generate missing IDs; `Database.find` returns `null` when no matching record exists. `Config.require` accepts the uppercase Script Property name, for example `Config.require('BACKUP_FOLDER_ID')`.

Updates write explicit fields rather than replacing operational sheets. Reviewed migrations append missing schema elements, verify old values/formulas, and record success only after checks pass. Custom columns are preserved but are not supported application input fields. Generated sheets can have their contents cleared and rebuilt; do not store manual notes or unique data there.

## Versioning and recovery

Current schema version is 2. Version 1 contains the base tables and fields; `002_task_assignment_safety` adds the three task safety fields described in [Data schema](DATA_SCHEMA.md). A fresh empty workbook is initialized directly to the current version. Existing versioned workbooks use explicit migration approval. Unversioned workbooks require an administrator-reviewed import/migration design; they are not automatically adopted.

Migration backup and preservation checks are safeguards, not a transaction. On failure, keep the workbook and backup for inspection. Restore is manual to a new Drive copy and requires deliberate configuration rebinding.

## Automation semantics

Notification activation baselines existing tasks and clears stale approvals; it does not send historical assignments. Eligible notifications require current assignment approval, matching baseline, task opt-in, active member, open project, allowed recipient domain, global email enablement, and dry-run off. Assignment/due-date edits invalidate the baseline; other material assignment edits are handled by the domain layer.

The mail ledger reserves a notification key as `PENDING` before calling MailApp. Success changes it to `SENT`. A pending/uncertain outcome is not automatically resent. This avoids blind retries but can require manual reconciliation and can miss a delivery if execution stops before the send. Exactly-once email delivery is not guaranteed.

The scanner considers approved assignment notices, reminders exactly 7 or 2 days before the due date, and a weekly overdue summary for configured management recipients. It does not guarantee catch-up for reminder dates missed during an outage. Date bucketing in the scanner uses UTC; review boundary behavior against the workbook/script timezone before enabling production notifications.

Calendar synchronization uses stored event IDs, a workbook/milestone ownership marker, and a content hash. Missing or foreign events are skipped rather than blindly recreated. Cancelled milestones are marked, not deleted. A failure between external event creation and persistence of its ID can still need manual repair. The hourly `scheduledNotificationScan` handler also invokes Calendar sync, but Calendar remains disabled until explicitly configured and enabled.

## Planning and views

Reverse planning walks phase dependencies backward from a deadline, excluding weekends and `HOLIDAYS`, and includes phase buffers. Missing durations produce `DRAFT` output rather than invented dates. This is not a full resource-constrained optimization engine.

Weekly workload apportions remaining estimated hours across working days and reports unknown/undated work separately. It is an estimate, not a timesheet or guaranteed availability forecast. Dashboard health and rollups are management heuristics; users must review unknown estimates and stale inputs.

`TIMELINE_DATA` is a normal sheet suitable for manual native Timeline setup where Google supports it. `GANTT_OVERVIEW` is the fallback. No Google edition entitlement or native Timeline creation is assumed.

## Evidence and limitations

Local tests cover application behavior using mocks, not actual Google permission inheritance, OAuth consent, quotas, scheduling delays, or external delivery. No live verification, measured production throughput, previous prototype comparison, complete critical-path solver, or exactly-once guarantee is claimed.
