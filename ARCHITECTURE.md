# Architecture

## V1.7.6 corrective architecture notes

Three properties describe this release.

**A request decision is a task write for invalidation purposes.** `requestDecide` changes authoritative
task data — `Status`/`Progress_Percent` for a completion approval, `Due_Date` for a deadline approval,
the pending-review indicator for any decision — so `afterWritePrefixes('requestDecide')` drops the
snapshot, the queue, the task index and the task pages, the project pages and the scoped overview
payloads, and `invalidateRequestDerived()` drops the store aggregates. `settle()` then re-reads the
narrowest authoritative dataset: the queue, plus one compact-index read only when the page already
holds the index (`refreshLoadedTaskIndex`). Nothing is rebuilt from a guessed summary, and no path
reloads the whole snapshot for a request decision.

**An import is measured by what it changed.** The server answer of `requests`/`requestSync` carries
`imported.imported`; `importedCount()` turns that into a number, and only a positive count calls
`requestChangedDerived()` — invalidation plus one index read for a page that already holds the index.
An import that confirmed "nothing new" costs no extra call, and the ordinary queue read (which also
imports server-side) follows the same rule.

**Invalidation supersedes the in-flight read, not only the cached payload.** `invalidatePrefixes()`
iterates the union of `cache` and `inflight`, so a read that started before a newer write cannot be
applied, cached, or joined by the refresh that replaced it. `fetchView()` re-reads once when its answer
was superseded instead of leaving a loading state, and the snapshot/query helpers return `null` for a
discarded answer so no caller builds a record from an older generation.

### Revocation

```
revoke() → revoked = true
         → sequence++                     (page/view generation)
         → drawerSequence++                (editor-open generation)
         → taskIndexState.generation += 1  (compact index)
         → requestSync.generation += 1     (申請一覧)
         → api.clear()                     (every cached payload and in-flight token)
         → store cleared, discardEditor(), content cleared, access-denied notice
```

Every asynchronous entry point verifies `revoked` (or a generation that the revocation advanced)
before it paints, caches, notifies or reopens a form: `render`, `repaintIfAllowed`, `success`,
`settle`, `act`, `fetchView`, `bootstrapFetch`, `fetchPublication`, `syncTaskIndex`, the request-sync
callbacks, the editor reads (`openEditor`, `loadSubprojects`, `loadParentTasks`) and the admin write
handlers. A server mutation already in flight is never cancelled and never replayed; only its answer is
discarded. Server-side authorization stays authoritative — the client guard prevents a repaint, not a
write.

### Response contracts added in this release

`readContract('automation')` requires `settings` (array) and `status` (object) and normalizes
`history`; the bound settings sidebar does the same with `EH.requireObject`/`EH.requireArray`. Both used
to read `data.settings.forEach` and `data.status.mode` directly, which turned a missing field into a
`TypeError` instead of one readable `INVALID_RESPONSE`.

## V1.7.5 corrective architecture notes

Three properties describe this release.

**A write response is authority for one row, not for the whole view.** The browser keeps an in-memory
snapshot of project and task summaries. A save patches only the fields the `TASKS`/`PROJECTS` row
determines directly; everything the server derives from other rows — container status, hierarchy
depth, the completion review state, the effective assignee list, the shared-assignment flag — keeps its
last authoritative value until the compact index answers. A record that is not in the index yet is
never invented locally.

**A write refreshes the narrowest dataset that can be authoritative.** A task save invalidates the
cached compact index (and the read of it that may still be in flight, `supersedeRead`), re-reads it
once, and marks the snapshot aggregates stale so the next page that shows them re-reads the snapshot.
A project save invalidates the area snapshot and both list scopes. No path replaces the whole snapshot
for a task page, and every refresh carries a generation token, so an answer produced before a newer
save is discarded instead of painted.

**Remote payloads are validated where they enter, not where they are rendered.** `readContract()`
describes the fields each operation must provide (`requireArray`/`requirePage`) and the fields that may
be absent (`optionalArray`); the bound sidebars do the same through `EH.requireArray`, and the shared
dashboard validates its portfolio and worker payloads. A broken contract becomes one readable
`INVALID_RESPONSE` message with a retry, a documented-optional field keeps its default, and a valid
empty list stays the empty state — a malformed answer can never masquerade as "no records".

### The 申請一覧 synchronization lifecycle

```
navigate('requests') → enterRequests()            (generation += 1, state = idle)
render → state === 'idle' → requestImport(key)    (key = OPEN | ALL, captured at dispatch)
       → response → generation unchanged AND key still selected AND view === 'requests'
                    ? paint the authoritative queue
                    : discard (no paint, no error, no retry)
```

The import is a page lifecycle operation rather than a record edit: the server import is idempotent per
permanent inbox request ID, an entry that follows an abandoned one is not blocked by the single-write
guard, and exactly one automatic import happens per entry.

### The compact task index

```
syncTaskIndex(force) → generation += 1 → api.read('taskIndex')
  hydrateTasks(payload)          valid?           → replace rows, total, complete, loaded together
                                 above the bound? → complete:false, paginated list answers the page
                                 unusable?        → recoverTaskIndex()
  recoverTaskIndex() → 1st failure: snapshot refresh, then one retry
                     → 2nd failure: paginated `tasks` read
```

A record count that differs from the snapshot is expected concurrent modification (a task was created
or deleted between the two reads), so the newer index is accepted. The failure counter resets on
success and on a user-initiated visit, which bounds the recovery without allowing a refresh loop.

## V1.7.3 corrective architecture notes

Three properties describe this release.

**Reading a row is not a schema change.** A Sheets cell typed as a number is returned as a number, and
`Database.validate()` is strict about text fields. `Schema` may therefore mark an *opaque identifier*
field `coerceText`; `Database.declaredText()` converts only those fields, and only while building a
record from the sheet (`read()` and the `updateMany` row build). Everything else stays strict, stored
rows are never rewritten for a read, and a write still patches only the addressed cells.

**The execution is the cache boundary.** `Database.withReadContext()` holds, for one Apps Script
execution only: mapped rows (`tables`), the raw `getDataRange()` values (`raw`), a derived memo
(`memo`) and the measured service-call counters. `book()` opens the workbook once and re-verifies the
environment marker once. `withLock()` and every write clear `tables` and `raw`, so a second operation
in the same execution never sees values the first one changed. There is no `CacheService` entry, no
cross-user cache and no browser persistence — Google Sheets remains the only source of truth.

**Measurement is an envelope, not data.** `ManagerWeb.response()` returns
`{data, metrics}`. The compact envelope (`executionMs`, `tableReads`, `payloadBytes`) is always sent;
the detailed one adds workbook opens, range reads, writes, cells written, lock wait, binding time,
serialization time, the read backend and per-table read time — only when the caller passes
`diagnostics: true` (the 計測 page). No metric ever contains a spreadsheet ID, e-mail address, cell
value or record text.

### The manager edit path

```
click 編集 → openEditor(type, id)
           → ++drawerSequence                 (this open owns the drawer)
           → discardEditor()                  (no sequence change: the own fetch stays valid)
           → api.read('task' | 'project' | 'editor', {id[, type]}, fresh)
           → response arrives → seq === drawerSequence ? renderEditor() + showModal() : discard
close / navigate / Escape → drawerSequence++ → discardEditor()  (a late response is ignored)
```

`detail()` maps the record type to its read: task and project have their own detail operations,
member/responsibility/subproject use the narrow allowlisted `editor` read
(`EDITOR_TABLES`). Every save still re-checks the revision under the script lock.

### The experimental read backend

`SheetReadBackend` sits in front of `Database.data()`. It returns `getDataRange().getValues()` unless
`DEV_SHEET_READ_BACKEND=BATCH_GET`, `ENVIRONMENT=DEVELOPMENT`, the advanced Sheets service exists and
the spreadsheet timezone is `Asia/Tokyo`. In that case it calls
`spreadsheets.values.batchGet` with `UNFORMATTED_VALUE`/`SERIAL_NUMBER`, converts serials only for
columns whose `Schema` type is `date`/`datetime`, pads rows to the header width and falls back to
`SpreadsheetApp` on any error. Equivalence with the production path is a test requirement; the
production path itself is unchanged.

## V1.6.2 corrective architecture notes

V1.6.2 adds no layer, table, column, endpoint scope or migration. It repairs one integrity boundary, one
finalization rule and two presentation rules:

- **Request ownership of an effect.** `src/Requests.gs` no longer infers "already applied" from the task row.
  `Requests.evidence(requestId)` reads the request-specific journal in `AUDIT_LOG` and is the only source of that
  claim: `REQUEST_DECISION_PREPARED` (intent, pre-mutation revision) → `REQUEST_EFFECT_APPLIED` (the mutation
  belongs to this request) → `REQUEST_DECIDED` (one per accepted decision). The request ID is the idempotency key,
  which is why schema 7 needs no new column or table. `reviewRequired` keeps an unattributable attempt in
  `PROCESSING` with one `REQUEST_RECONCILE_REQUIRED` row; `resolveDecision` settles it from
  `previewDecisionReconciliation` without writing a task. The decision entrypoints are
  `Requests.decide` (unchanged signature) and the new `previewRequestDecisionReconciliation` /
  `reconcileRequestDecision`.
- **Finalization and override audit.** `finalizeLocked` writes the decision record once and repairs a missing one.
  `Completion.override` uses the same prepare/finalize shape with its own actions
  (`COMPLETION_OVERRIDE_PREPARED` / `COMPLETION_OVERRIDDEN` + `Operation_ID` /
  `COMPLETION_OVERRIDE_RECONCILED`), so `reconcileCompletionOverrides` can append only what is missing. Neither
  path shares deletion-specific logic.
- **Receipt reconciliation.** `Requests.previewInboxReconciliation` / `reconcileInboxStates` read Spreadsheet C and
  write only `Inbox_State`; the sidebar exposes them as `申請状態の同期確認` / `申請状態を再同期`
  (`Ui.requestInboxPreview` / `Ui.requestInboxReconcile`). Spreadsheet A stays private and no employee path gained a
  write.
- **Presentation.** `ManagerWeb.memberProfile` returns verified `memberActions` separately from `taskHistory`, and
  `ManagerWeb.overview(actor, {areas:false})` lets the browser reuse the area snapshot it already holds; the client
  paints a scoped loading state instead of the previous area's figures.
- **Task area resolution.** `ManagerWeb.taskList` resolves the organisation area of a task through
  `TASKS.Project_ID -> PROJECTS.Responsibility_ID` (`inArea` / `responsibilityOf`) and understands the 未分類 scope;
  nothing is copied into `TASKS`. The status filter compares the displayed status (`TaskTree.viewIn`), which is what
  the browser compares locally, and every filter runs before `page()`. A project write drops the compact task index
  and the scoped overview (`invalidateAreaSnapshot`) and patches the project summary from the returned row, because
  each task summary repeats its project's responsibility.

## V1.6.1 corrective architecture notes

V1.6.1 adds no layer, table, endpoint or scope. It repairs four boundaries and one compatibility rule:

- **Counting policy.** `src/TaskScope.gs` is the only place that decides what a manager number means
  (`create`, `summarise`, `summariseBy`, `upcoming`). `ManagerWeb.responsibilitySummaries` and
  `ManagerWeb.overviewCore` both read from it, so an area card, an overview KPI and a progress rollup
  cannot disagree. Containers are organisation; open/overdue are open leaf work in active work;
  completed work is reported separately.
- **Scope before paging.** `ManagerWeb.overview(actor, input)` (and `bootstrap`) accept
  `responsibilityId` / `unassigned`, filter the project list first, and derive the KPIs, the seven-day
  window and the top-five upcoming list from that scope. The browser asks for a scoped overview
  instead of filtering a 20-row page in memory (`viewFilters` now includes `overview`).
- **Durable removal.** `Deletion` writes `RECORD_DELETE_PREPARED` before the row disappears and
  reports success only after `RECORD_DELETED`. `Deletion.reconcile` (entry point
  `reconcileDeletions('RECONCILE DELETIONS')`, API action `deletionReconcile`) appends a missing record
  for a row that is verifiably gone and never deletes. Cascading removal is gone.
- **Historical ownership.** `ManagerWeb.memberProfile` combines the current owner column with the
  append-only audit evidence, and `Tasks.update` writes `TASK_REASSIGNED` on an owner change.
- **Contract compatibility.** `dashboard-app/DataService` holds one exact field list per published
  contract (1.4, 1.5) and validates the snapshot header against the list named by
  `PUBLISHED_META.CONTRACT_VERSION`; unknown or mixed snapshots still fail closed.

## V1.6 current manager architecture

V1.6 keeps the V1.5.1 browser-first manager UI (`doGet` → ManagerWebIndex/Styles/Client → `google.script.run` →
ManagerWeb/ManagerWebApi → existing Ui/domain services → private A) and adds an organisation layer:

- **Responsibilities first.** `ManagerWeb.responsibilitySummaries` computes per-area counts and weighted progress
  from the same authorised read as the overview; the browser renders them as a strip, keeps the selected
  `Responsibility_ID` in page memory and filters the snapshot locally. There is no per-area ACL — ADMIN and
  MANAGER keep department-wide access (AGENTS.md rule 79).
- **Two bounded hierarchies.** `Subprojects.MAX_DEPTH = 4` and `TaskTree.MAX_DEPTH = 3` are the only limits.
  `TaskTree.buildIndex` builds one parent/child index per response; every walk is visited-set and depth guarded and
  raises on malformed data instead of recursing.
- **Containers are not work.** `Progress.rollup` excludes any task that has children; a container's own progress
  and status are derived from its leaf work for display only. The stored columns are never rewritten, so each write
  stays one row update.
- **One completion policy.** `Completion.guard` runs inside `Tasks.validate` and therefore covers `Tasks.complete`,
  `Tasks.update`, `Ui.updateProgress`, `Ui.assignTask`, the manager web form, the sidebar and triggers. Only
  `Requests.decide` (via `Completion.withApproval`) and the explicit ADMIN override can write Done.
- **Narrow deletion.** `Deletion.gs` is the single module that may remove a row: ADMIN, empty dependency preflight,
  exact typed confirmation, required reason, verified backup, script lock and a `RECORD_DELETED` tombstone. Every
  other module is still rejected by `npm run validate` if it touches a destructive Sheets API.
- **Contract 1.5.** The publisher/reader pair adds the responsibility colour, the parent task, the container flag,
  the review state and the completion date, with the same A/B slot commit, header check, row-count and hash
  verification.

Ordinary navigation is still answered from an authorized in-memory snapshot. `managerWebRead('bootstrap')` returns
the overview values, the responsibility cards, the reference choices, every project summary and the task count in one
execution; `managerWebRead('taskIndex')` returns the compact columnar task summaries including the hierarchy fields.
Both run inside `Database.withReadContext`, so each source table is read at most once per call and nothing is written.
The browser keeps that snapshot for the session (no localStorage/IndexedDB, no server-side cache), paints cached
views synchronously, deduplicates identical in-flight reads, discards superseded responses and revalidates in the
background once a dataset is older than 30 seconds or after a relevant write. Datasets stay all-or-nothing
(`TASK_INDEX_LIMIT = 3000`, `PROJECT_INDEX_LIMIT = 1000`): above a bound the server reports `complete: false` and
the browser falls back to the paginated `tasks`/`projects` operations. Free-text search remains a server operation
(it also covers description and acceptance criteria). Every call re-checks `Session.getActiveUser()`, the allowed
domains and `Access.requireManager()`; a revocation clears the snapshot and the open form.

`ManagerWebClient` keeps no draft store (V1.7.2). A record form is built from the latest server copy, saved or closed,
and a close, a navigation or a revocation discards every entered value, so nothing about a form can be restored from
page memory or from `localStorage`. The administration views (`共有ダッシュボード公開`, `システム状態`, `自動化`) are
purpose-built cards over the same authorized reads; the publication page pairs the `publication` and `status`
operations so the schema version, the application version, the publisher version and the snapshot contract are
reported separately, and no view dumps a nested server payload.

`ManagerWeb` never returns the stored `PROJECTS.Progress_Percent` / `PROJECTS.Health` columns:
`Dashboard.projectMetrics` derives progress (leaf-only), health, task counts and the neutral deadline state from the
current TASKS/MILESTONES/ISSUES rows on each read. The stored columns remain the output of the explicit report
refresh only. Sheets writes remain nontransactional; see [full manager architecture](docs/MANAGER_WEB_APP.md),
[performance](docs/MANAGER_WEB_APP_PERFORMANCE.md) and the [V1.6 runbook](docs/V1_6_DEPLOYMENT_RUNBOOK.md).

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
| `Assignees.gs` | One indexed read of the additional task assignees and additional responsibility members, membership validation and synchronisation, membership audit. |
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

Current schema version is **8** (V1.7); the table below records the additive history.

- Version 1: base tables and fields.
- `002_task_assignment_safety` (1 → 2): task assignment version, approval timestamp, notification baseline.
- `003_management_reliability` (2 → 3): `AUTOMATION_SETTINGS`, `PROJECT_PHASES`, `SCHEDULE_CONFIRMATIONS`, `PROJECTS.Notification_Enabled`, `MEMBERS.Role`, notification reconciliation columns, and seeded safe automation defaults (mail OFF).
- `004_shared_dashboard` (3 → 4): `PROJECTS.Dashboard_Visibility`, `PROJECTS.Dashboard_Summary`, `TASKS.Public_Note`.
- `005_task_planning_and_requests` (4 → 5): planned duration/start columns, `TASK_REQUESTS`, `TASK_DEADLINE_HISTORY`.
- `006_responsibilities_and_nested_subprojects` (5 → 6): `RESPONSIBILITIES`, `PROJECTS.Responsibility_ID`, `SUBPROJECTS.Parent_Subproject_ID`.
- `007_responsibility_hierarchy_and_lifecycle` (6 → 7): nested tasks, area colour, deletion markers.
- `008_task_and_responsibility_members` (7 → 8, V1.7): `TASK_ASSIGNEES`, `RESPONSIBILITY_MEMBERS` — additional
  members only, with the primary owner columns still authoritative. It creates no assignment and publishes
  nothing.

## Multi-assignee work (V1.7)

A task keeps one authoritative primary assignee (`TASKS.Owner_Member_ID`) and a normalised list of
additional assignees in `TASK_ASSIGNEES`; a responsibility keeps one primary owner and additional
members in `RESPONSIBILITY_MEMBERS`. `src/Assignees.gs` owns the one indexed read (execution-local
`Database.memo`), the validation and the synchronisation, and every consumer — the manager task index,
the member profile, the responsibility list and the published snapshot — reads through it, so no path
performs one Sheets read per task. A membership change is a material assignment change: it bumps
`Assignment_Version`, clears `Assignment_Approved_At` and writes one audit row. Removal stamps
`Removed_At` instead of deleting the row, so assignment history survives.

The employee snapshot advertises the effective assignees as an allowlisted display-name list
(contract 1.6 `assigneeNames`), which powers `作業担当者別タスク / Tasks by Worker`. The employee app
still reads only the published snapshot; worker filtering is a display filter, not authentication.

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

## V1.7.4 — project identity colours

One deterministic, shared helper gives every project a stable accent, and both clients carry an
identical generated copy of it:

```
shared/project-colors.js   palette + hash of the stable Project_ID (no spreadsheet data)
src/ProjectColors.html     generated copy (manager application, included by ManagerWebIndex)
dashboard-app/ProjectColors.html   generated copy (shared dashboard, included by Index)
```

* `EH_PROJECT_COLORS.colorFor(id)` returns a palette value; `styleFor(id)` returns the
  `--project-accent` / `--project-outline` / `--project-tint` custom properties. An empty ID yields
  `''`, so the CSS falls back to the neutral `--ui-*` tokens.
* The derivation uses the stable `Project_ID` only. A list position, a filter state or a sort order
  never influences it, so the colour survives navigation, filtering, sorting and refresh, and the
  manager application and the dashboard agree for the same project.
* `npm run sync:colors` regenerates both copies and `npm run validate` fails on drift, on a value
  outside the palette or on a colour derived from an empty ID.
* Nothing is read from or written to the workbook: the identifier the client already holds is enough,
  so the 30-second authorized cache, request deduplication and pagination are unchanged.

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

## V1.4 — responsibilities, nested subprojects and UI refinement

Schema version **6** (`006_responsibilities_and_nested_subprojects`), additive only.

```text
RESPONSIBILITIES (new)            -> src/Responsibilities.gs
PROJECTS.Responsibility_ID        -> optional area; blank = 未分類
SUBPROJECTS.Parent_Subproject_ID  -> blank = root; at most two levels
```

* **Responsibilities are data, not code.** `Responsibilities` owns validation, the unique-name
  rule for active rows, re-ordering, retirement and transfer. `Access.canManageResponsibility`
  is the single policy: ADMIN and MANAGER administer every area, and nobody gains or loses
  project access from an area. A transfer ends in `Projects.update` with one column
  changed plus an `AUDIT_LOG` entry (`RESPONSIBILITY_TRANSFERRED`).
* **A bounded hierarchy.** `Subprojects.validateHierarchy` builds the parent map once, rejects a
  self-parent, a cross-project parent, a cycle and any level beyond two, and validates the whole
  subtree on reparent. `Subprojects.moveTask` is the only way a task changes node, and it needs
  confirmation and the same project.
* **One rollup helper.** `Progress.subtreeTasks` feeds `Progress.refresh`, the management
  dashboard, the workload/eligibility check and the snapshot, so a parent subproject, the Gantt
  fallback and the shared dashboard cannot disagree. Weights stay as documented (known estimate,
  the fallback of 1 for unknown effort, `Cancelled` excluded). Tables are read once per refresh
  and the hierarchy is built in memory.
* **Archived work leaves the active figures, not the workbook.** `Eligibility.taskInActiveWork`
  walks the ancestor chain, so descendants of an archived subproject stop contributing and come
  back on reactivation. No row is deleted and nothing is marked done automatically.
* **The sidebar is sectioned for a real 300px.** 案件 / タスク / 管理, one visible section,
  collapsed 詳細設定 for rarely used fields, and a compact subproject tree. `Ui.show(fileName,
  {view, action})` passes the initial section as a template value, and the Sheets menu maps each
  entry to its own handler instead of reusing one.
* **Snapshot contract 1.4.** `PUBLISHED_RESPONSIBILITIES` (id, name, order, retired),
  `projects[].responsibilityId` / `responsibilityName`, and `subprojects[].parentSubprojectId` /
  `level` / `directTasks` / `totalTasks` / hierarchical `progress`. Descriptions and owners are
  never published, and an older contract is rejected (`SNAPSHOT_CONTRACT_UNSUPPORTED`) rather than
  misread.
* **The request form honours the switch.** Loading, `REQUEST_SUBMISSION_ENABLED=false` and a
  configuration failure all offer no active submission button and explain why. Unsent values live
  in memory, survive a language switch and a validation error, and are cleared only after a
  successful submission that shows the request ID.

Details: [docs/RESPONSIBILITIES.md](docs/RESPONSIBILITIES.md),
[docs/UI_UX_GUIDELINES.md](docs/UI_UX_GUIDELINES.md). Gates:
[docs/checkgates/V1_4_GATE_1.md](docs/checkgates/V1_4_GATE_1.md) …
[V1_4_GATE_6.md](docs/checkgates/V1_4_GATE_6.md).

## V1.4.1 — simplified authorization and pre-trial hardening

No schema change (still **6**) and no snapshot contract change (still **1.4**).

```text
ADMIN   -> every record + privileged administration (roles, migrations, automation)
MANAGER -> every project, subproject, task and responsibility in the department
MEMBER  -> only the tasks assigned to their own verified member record
VIEWER  -> read-only
```

* **Ownership is accountability, not permission.** `Access.requireProjectWrite` admits any
  verified ADMIN or MANAGER for any project; `Access.canEditTask` returns true for both roles and
  keeps the MEMBER own-task boundary. `PROJECTS.Project_Owner_ID`,
  `SUBPROJECTS.Owner_ID` and `RESPONSIBILITIES.Owner_Member_ID` never gate a write.
* **Every callable path re-checks the role.** The top-level Apps Script functions
  (`createProject`, `updateTask`, `createSubproject`, `createResponsibility`, `createMember`, …)
  call `Access` before delegating to the domain service, so `google.script.run` and the editor
  cannot skip a sidebar guard. The domain services stay internal and are reached through these
  guarded entrypoints or through other already-authorized domain code.
* **One write for one logical operation.** `Ui.updateProject` validates the ordinary fields, the
  concurrency marker, the responsibility destination, the retirement confirmation and the
  deadline together, then applies a single project row update. Google Sheets has no multi-row
  transaction, so nothing is written before every check passes.
* **Deterministic reordering.** `Responsibilities.reorder` rejects duplicates and unknown IDs,
  preserves identity/owner/status/`Retired_At`, writes only the `Sort_Order` values that change,
  and records `RESPONSIBILITY_REORDERED` with the resulting order.
* **Bounded hierarchy walks.** `Subprojects.heightOf`, `descendants`, `Progress.subtreeTasks` and
  `Eligibility.subprojectInActiveWork` all carry a visited set or depth guard, so a hand-edited
  cycle raises the documented error instead of recursing forever.
* **One eligibility rule.** `Eligibility.subprojectInActiveWork` walks the ancestor chain and is
  reused by active work, reminders (`taskNotifiable`), reports and the published snapshot
  aggregates. Historic progress is never recomputed by an archive.
* **Sidebar scale.** `Ui.context` returns a deterministic 300-task window plus `taskTotal` and
  `tasksTruncated`; `Ui.taskOptions` (bridge `uiTaskOptions`) searches by name on the server, so
  an older task is reachable without loading thousands of rows.

Details: [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md),
[docs/RESPONSIBILITIES.md](docs/RESPONSIBILITIES.md). Gates:
[docs/checkgates/V1_4_1_GATE_1.md](docs/checkgates/V1_4_1_GATE_1.md) …
[V1_4_1_GATE_6.md](docs/checkgates/V1_4_1_GATE_6.md).

