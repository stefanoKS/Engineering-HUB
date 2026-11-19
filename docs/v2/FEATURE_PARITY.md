# V1 → V2 Feature Parity

## Project structure reveal and timeline usability — 2026-11-14

The project detail keeps one reveal operation for a completion notice, a subproject's completed
count and `?task=<id>`: a task is resolved by stable ID, the active or completed presentation is
opened, the ancestors it needs are expanded, a filter that would hide it is cleared with an explicit
notice, and focus moves only after the row exists. A background refresh never requests a reveal.
DOM ids are scoped by presentation, so a container that appears as context in both presentations is
addressable once. The project-specific assignee filter is the shared searchable, paginated picker
(every member reachable, selection preserved, no raw id labels). The summary states weighted
progress together with the completed-task count. The read-only timeline keeps the schedule span, the
committed deadline, the recorded completion and a derived group span as separate facts, draws each
with its own restrained mark and a legend, offers previous/today/next plus week / two weeks / month /
quarter / custom and fit, and resolves project-level attention filters (overdue, due in seven days,
awaiting review, missing dates) on the server from the whole authorized project scope. A non-modal
inspection panel and a phone agenda share the same scope, filters and dates. One additive read-only
endpoint (`GET /api/work/projects/:id/attention`) and two additive timeline fields (`assigneeNames`,
`reviewState`) are added; no migration, schema, authorization, counting, completion, notification or
publication rule changes. See [UI_CONVENTIONS.md](UI_CONVENTIONS.md) "Project structure reveal,
attention filters and timeline inspection", [API.md](API.md) and
[ARCHITECTURE.md](ARCHITECTURE.md).

## Active and completed project structure — 2026-11-13

The project detail keeps unfinished leaf work in the active structure and moves completed leaf work
into one collapsed section below it. Nothing is moved, archived, deleted or reparented. Container
tasks remain organisation (never an extra unit of work, and never completed from their stored
status), cancelled work stays separate and behind the existing inactive-work control, and the
`N active · M completed` counters use the same leaf counting as `TaskScope`/progress. The completed
count is an accessible button that opens and focuses the right group; `?task=<id>` reveals a
completed task's context; task-name search and a stable-member-id assignee filter find work in both
presentations; and a confirmed direct completion leaves one page-memory notice that reveals the
row. Row removal and subproject editing are in the ⋯ menu, with the existing role/division
capabilities, preflight, revision, confirmation, recovery and audit behaviour unchanged. No API,
contract, migration, schema, authorization, counting or publication change is involved. See
[UI_CONVENTIONS.md](UI_CONVENTIONS.md) "Project structure: active and completed work" and
[ARCHITECTURE.md](ARCHITECTURE.md) "Active and completed project structure".

## Member collaboration and manager recovery — 2026-11-13

Members may edit and recoverably remove tasks and subprojects, including colleagues' work, in a
visible project within a WORK division. READ access never authorizes a write. Managers may restore
removed tasks and subprojects in their WORK divisions; administrators may restore across divisions.
Removal and restoration require a confirmation button, not typed text. Permanent erasure and
reopening completed tasks remain ADMIN-only. See [SECURITY.md](SECURITY.md) and
[API.md](API.md) for the authorization and recovery safeguards.

## Member creation, shared presentation and corrective reopening — 2026-11-05

The following table is historical; the member editing and removal restrictions were superseded by
the member collaboration update above.

| Capability | V1 (Apps Script) | V2 now |
|---|---|---|
| A MEMBER files a project | manager-only creation | `POST /api/employee/projects`: owner = session, `Active`, `INTERNAL`, active responsibility, audited, idempotent |
| A MEMBER files a task / subproject | member self-service | unchanged endpoints, now offered from the project screens in a dialog |
| A MEMBER edits, archives, deletes or reopens a record | manager/ADMIN only | unchanged: MEMBER add-only, VIEWER read-only |
| Project list presentation | role-specific page | one `ProjectTable` for both roles, from role-specific authorized reads |
| Overview | employee card wall beside the manager overview | one shared presentation: KPI cards, overdue/upcoming lists, responsibility cards; personal counts stay separate |
| Request submission | inline form below the content | one accessible modal with the task, project, subproject and current deadline, non-blocking submission and unknown-outcome handling |
| Reopening an accidentally completed task | no inverse operation | `POST /api/manager/tasks/:id/reopen` (ADMIN): reason, typed confirmation, one corrective audit event, optional atomic parent project reopening, history retained |

Documented differences and limitations:
- A member-created project has no category, summary or notification controls, because those are
  manager decisions; the server sets the visibility to `INTERNAL` and the owner to the creator.
- A member subproject stays flat; nested subprojects remain a manager capability.
- Reopening sets the task to `In Progress` with 0 progress: no reliable pre-completion progress is
  recorded, so none is invented. The derived late state follows from the stored finish date.
- Reopening never reactivates an archived or cancelled parent project; that remains a separate
  lifecycle action.

## Local LAN update — 2026-11-02

[LOCAL_LAN.md](LOCAL_LAN.md) specifies the employee-ID/password mode, schema 7, optional email, first-login change, administrator reset, employee-owned progress editing, Windows launcher, durable local backup and optional Shared Drive upload. It supersedes Google-only or Linux-only assumptions below for this mode. [Verification record](LOCAL_LAN_ACCEPTANCE.md).

## Update — 2026-11-01

See [RELEASE_HARDENING.md](RELEASE_HARDENING.md) for the current UI, concurrency, delivery, Calendar and performance changes and unresolved release blockers. The dated records below are historical; they do not establish complete feature parity or production approval.


Status legend: **PASS** = implemented and verified locally (unit/integration/API test);
**PARTIAL** = implemented with a documented limitation; **BLOCKED** = needs a credential,
Workspace, DNS or deployment that this environment cannot provide; **NOT_RUN** = not measured.

Every V1 entry point was read from `src/`, `dashboard-app/` and `shared/`. The V1 workbooks and
scripts are unchanged; V2 is a separate codebase that keeps the identifiers, rules and visible
workflows.

## 0. Stabilization review (2026-10-31) — read this before the tables

The tables below describe what was implemented. They are **not** a complete reachable-workflow
audit. The stabilization pass downgraded or qualified these rows; see
[STABILIZATION.md](./STABILIZATION.md) for the evidence:

| Area | Revised status | Why |
| --- | --- | --- |
| Notification reminder stages and preview | PASS (fixed) | Every configured stage is sent, identities are per stage/request, and a preview no longer blocks a live send |
| Notification switches | PASS for assignment, reassignment, deadline change, deadline/overdue reminder and request type; PARTIAL for a separate recurring pending-request reminder | The switches now have producers and consumers; the pending-request reminder is represented by the request-submission notification |
| Calendar synchronisation | PARTIAL | A task deadline change is enqueued and handled; **milestones have no producer** |
| Weekly report | PARTIAL | Producer and handler exist and are switch-gated; only unit-level delivery evidence |
| Backup/restore | PARTIAL | Interval scheduling and the logical restore test exist; `pg_dump`/`pg_restore` round trip and Drive upload/restore are NOT_RUN |
| Browser workflows (save → list update, conflict recovery, unknown outcome, rapid navigation) | NOT_RUN | No browser automation in this pass; jsdom and API injection only |
| Project/task editor open guards | PARTIAL | The query layer drops superseded reads; the per-form open/detail generation guard was not implemented or tested |

Treat every remaining **PASS** below as "implemented and covered by the named local test", not as
"exercised in a browser against a live tenant".

## 1. Manager features

| Feature | V1 implementation / entry points | V1 authorization | Invariants and tests | V2 location | Migration | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Project list/create/edit | `Ui.createProject`, `Ui.updateProject`, `Projects.gs`, `ManagerWeb` `projects`/`project` | ADMIN, MANAGER | Partial patch, revision check, immutable IDs; `contracts.test`, `api.test` (create once, stale edit) | `apps/web/src/screens/Projects.tsx`, `apps/api/src/services/projects.ts`, `projects` table | PRESERVED IDs | PASS |
| Project/subproject descriptions | `PROJECTS.Description`; no subproject field in V1 | ADMIN, MANAGER write; every role reads | Project description allowlisted in the read-only projection; `subprojects.description` additive (schema 9, default `''`); a partial patch keeps untouched text; `contracts.test`, `integration.test`, `roles-and-work.test` | `apps/web/src/screens/Projects.tsx`, `SubprojectForm.tsx`, `WorkProjects.tsx`, `services/work.ts` | Additive column | PASS |
| Project archive | `Projects.archive`, `projectArchive` | ADMIN, MANAGER + confirmation | Status change only, history kept; `domain.test` lifecycle, `api.test` archive-not-called (UI), DB trigger `projects_archived_marker` | `archiveProjectCommand` | PRESERVED | PASS |
| Project delete (mistaken empty record) | `Deletion.gs`, `projectDelete` | ADMIN only, typed `DELETE <id>`, reason, backup | Empty preflight, tombstone, `RECORD_DELETE_PREPARED`/`RECORD_DELETED`; `deletion.ts`, `domain.test` | `apps/api/src/services/deletion.ts`, `record_deletions` | PRESERVED | PASS |
| Project completion rule | — | ADMIN, MANAGER | All tasks Done before `Completed`; `domain.test` | `assertProjectCompletable` | — | PASS |
| Nested subprojects (4 levels) | `Subprojects.gs` | ADMIN, MANAGER | Self/cross-project/cycle/depth; domain + DB trigger; `domain.test`, `integration.test` | `subprojects` table, `eh_subproject_guard` | PRESERVED tree | PASS |
| Member subproject creation | — (V1 had no member creation path) | MEMBER, immediately, no approval; ADMIN/MANAGER keep the manager form | `POST /api/employee/subprojects`; owner is the verified member, status `Active`, `SUBPROJECT_CREATED` audit, member-scoped idempotency key, whole-subtree validation (active project/parent, same project, four levels, no cycle); `member-creation.test` | `services/my-work.ts` `createMySubproject`, `components/member-subproject-form.tsx` | No migration | PASS |
| Task hierarchy (3 levels) | `TaskTree.gs` | ADMIN, MANAGER | Self/cross-project/cross-subproject/cycle/depth; domain + DB trigger; `domain.test`, `integration.test`, `api.test` (parent options) | `tasks.parent_task_id`, `eh_task_guard` | PRESERVED tree | PASS |
| Task create/edit (partial patch) | `Ui.assignTask`, `Tasks.gs` | ADMIN, MANAGER; MEMBER own task in the sidebar | Revision check, deadline confirmation, non-working acknowledgement, assignment version bump; `api.test`, `integration.test` | `tasks` table, `services/tasks.ts`, `TaskForm.tsx` | PRESERVED | PASS |
| Dependencies (cycle prevention) | `Dependency_IDs` column | ADMIN, MANAGER | Graph cycle refusal; `task_dependencies` + trigger; `domain.test`, `integration.test` | `task_dependencies` | Parsed into rows | PASS |
| Primary + additional assignees | `TASKS.Owner_Member_ID`, `TASK_ASSIGNEES` | ADMIN, MANAGER | Soft removal, reactivation, one audit row, approval invalidation; `integration.test` | `task_assignees` | PRESERVED | PASS |
| Responsibility members | `RESPONSIBILITY_MEMBERS` | ADMIN, MANAGER | Same soft relationship; `directory.ts` | `responsibility_members` | PRESERVED | PASS |
| Responsibilities CRUD/order/retire | `Responsibilities.gs`, `saveResponsibility`, `moveResponsibility`, retire/reactivate | ADMIN, MANAGER; owner change ADMIN only | Retirement is a status change, colour validation, owner change audited; retired areas are hidden by default in the manager table (`廃止済みを表示` reveals them); `domain.test`, `services/directory.ts` | `responsibilities` | PRESERVED | PASS |
| Responsibility delete (unused mistaken area) | — (V2 addition) | ADMIN only, typed `DELETE <id>` | `GET /api/admin/responsibilities/:id/delete-preflight` + `DELETE /api/admin/responsibilities/:id`; every project row (active, archived, logically deleted), a stored publication reference or a pending job blocks and the manager retires instead; member links are snapshotted into the tombstone and then removed; `responsibility-deletion.test` | `services/deletion.ts`, `record_deletions` | `0011_responsibility_deletions` | PASS |
| Members, roles, activation | `Members.gs`, `saveMember` | ADMIN for role/activation | No self-change, last active administrator protected, sessions revoked on deactivation; `domain.test`, `api.test` | `members` | PRESERVED | PASS |
| Skills and assessments | `Skills.gs` | ADMIN, MANAGER | Assessment upsert, manager-only matrix; `skills` route | `skills`, `member_skills` | PRESERVED | PASS |
| Planning: deadline + duration | `Planning.planFromDuration`, `planningWarnings` | ADMIN, MANAGER | Working/calendar basis, holidays, warnings with acknowledgement; `domain.test` | `packages/domain/src/planning.ts` | Date/time migration | PASS |
| Phase back-planning | `Planning.schedulePhases` | ADMIN, MANAGER | Bounded dependencies, DRAFT propagation; `domain.test` | `planning.ts`, `project_phases` | PRESERVED | PASS |
| Progress rollup | `Progress.rollup`, `Progress.refresh` | — | Known estimate weight, unknown fallback 1, cancelled excluded, containers excluded; `domain.test` | `packages/domain/src/progress.ts`, `views.ts` | Recalculated from tasks | PASS |
| Task scope counting | `TaskScope.gs` | — | One policy for cards, KPIs, reports; container/archived exclusion; `domain.test` | `packages/domain/src/scope.ts` | — | PASS |
| Derived task schedule status | `Client.html` "status" cell (stored value) | — | One date-aware rule (`PLANNED`/`IN_PROGRESS`/`OVERDUE`/`START_NOT_SET`/`DATES_NOT_SET`/`INVALID_DATES`/`DONE`/`CANCELLED`) plus the missing-boundary detail, used by every list, detail, timeline, report and employee DTO; the stored workflow value stays stored and is labelled as such; `task-schedule-status.test`, `task-schedule-display.test`, `task-schedule-ui.test.tsx` | `packages/domain/src/task-status.ts`, `components/task-status.tsx` | No migration; no stored row rewritten | PASS |
| Eligibility (archive-aware) | `Eligibility.gs` | — | Whole ancestor chain, bounded walk; `domain.test`, `db` integration | `eligibility.ts` | — | PASS |
| Dashboard/overview | `ManagerWeb` `overview`, `Client.html` | MANAGER | Bounded scope, upcoming window, area cards, pending requests; `api.test` bootstrap/overview | `screens/Overview.tsx`, `buildOverview` | — | PASS |
| Workload report | `ManagerWeb` `member`, `Planning.workloadData` | MANAGER | Date-based task counts for day/week/month/year/custom, per-member table, paginated drilldown, no hours or utilisation; `Workload.tsx`, `workloadReport` | `services/workload.ts`, `repo/reports.ts` | — | PASS |
| Member profile | `ManagerWeb` `member` | MANAGER | Current/previous work, audit attribution, no invented events; `buildMemberProfile` | `MemberProfile.tsx` | — | PASS |
| Assignment approval | `approveAssignment`, `taskApprove` | ADMIN, MANAGER + confirmation | Version-bound approval, notification enqueued only after approval; `api.test`, `integration.test` | `services/tasks.ts`, outbox | — | PASS |
| Schedule confirmation | `confirmSchedule`, `SCHEDULE_CONFIRMATIONS` | ADMIN, MANAGER | One active confirmation, version increments; `schedule_confirmations` | `confirmScheduleCommand` | PRESERVED | PASS |
| Deadline change approval | `Requests.gs`, `decideRequest` | ADMIN, MANAGER + confirmation | Applies once, history + audit, stale detection; `api.test` (apply once, stale) | `services/requests.ts` | PRESERVED state | PASS |
| Completion report | `Completion.gs`, `REQUEST_APPROVED` | ADMIN, MANAGER | Container refusal, manager decision writes `Done`; `api.test` container refusal | `completion.ts`, `decideRequest` | PRESERVED | PASS |
| Completion override | `Completion.override` | ADMIN + reason + `COMPLETE <id>` | Refuses container/cancelled, audited `COMPLETION_OVERRIDDEN`; `domain.test` | `overrideComplete` | — | PASS |
| 申請一覧 import/sync | `Requests.importRequests`, `requestSync` | MANAGER | One import per page entry, idempotent on inbox ID, failure is a warning; `Requests.tsx`, `importRequests` | `apps/api/src/.../requests.ts` | Inbox adapter | PASS (legacy inbox adapter untested live) |
| Delete reconciliation | `Deletion.reconcile` | ADMIN + typed phrase | Appends a missing record only; `reconcileDeletions` | `deletion.ts` | — | PASS |
| Automation settings UI | `AutomationSettings.gs`, `UiSettings.html` | ADMIN for changes | Revision, confirmations, live preflight; `domain.test`, `api.test` (typed phrase) | `Automation.tsx`, `automation.ts` | Settings imported with automation forced OFF | PASS |
| Emergency stop | `EMERGENCY_STOP` | ADMIN | Forces `EMAIL_MODE=OFF`, audited; `automation.ts` | `automation.ts` | PRESERVED | PASS |
| Status/diagnostics | `Health.gs`, `Ui.status` | MANAGER | Row counts, outbox, last backup, mode; `Status.tsx` | `/api/manager/status` | — | PASS |
| Publication status/publish | `SharedDashboardPublisher.gs`, `publishPublicationNow` | ADMIN + confirmation | A/B slot, hash verification, previous snapshot readable; `api.test` | `services/publication.ts` | — | PASS |
| Project colours | `shared/project-colors.js` | — | Stable ID hash, palette only, CSS variables; `domain.test` | `packages/domain/src/colors.ts` | — | PASS |
| Japanese/English switch | `shared/i18n.js` | — | ja default, `localStorage`, identical key set; `ui.test.tsx` | `packages/i18n`, `apps/web/src/i18n.tsx` | Dictionary generated from V1 | PASS |

## 2. Employee features

| Feature | V1 implementation | V2 location | Status |
| --- | --- | --- | --- |
| Published task list | `dashboard-app/` + `SharedDashboardModel.gs`, contract 1.6 | `GET /api/employee/snapshot`, `EmployeeHome` | PASS (contract fields allowlisted, `api.test`) |
| Worker display filter | dashboard filter | `EmployeeHome` select | PASS (display filter only, documented) |
| Deadline change request | dashboard form → request inbox | `POST /api/employee/requests` | PASS |
| Completion report | dashboard form | `POST /api/employee/requests` | PASS (container refused) |
| Submission states | 送信中 / 受付完了 / 送信結果不明 | `EmployeeHome`, receipt metadata in `localStorage` | PASS (receipt limited to task/type/time/state/ID) |
| Submission switch | `REQUEST_SUBMISSION_ENABLED` | Same setting key, fails closed | PASS |
| Member task creation | not available in V1 | `POST /api/employee/my-work`, 自分の担当タスク | PASS (owner from the session, `Not Started`/0 %, no approval needed to create) |
| Member completion request | completion report in the dashboard | 完了報告 in My Work, same request queue | PASS (pending never completes; a member-created task needs an ADMIN decision) |
| Privacy boundary | allowlisted snapshot | One allowlist in `publication.ts`; `contracts.test` | PASS |
| Member project browsing | the sidebar showed permitted work only; no project explorer for employees | `Projects` tab → `WorkProjectsScreen`, `GET /api/work/projects`, `GET /api/work/projects/:id`, `GET /api/work/tasks/:id` | PASS (read-only, INTERNAL only, descriptions allowlisted, `roles-and-work.test`, `member-explorer.test.tsx`, browser journeys) |

## 3. Integrations and operations

| Feature | V1 | V2 | Status |
| --- | --- | --- | --- |
| Email notifications | `Notifications.gs` (MailApp) | `worker` + Gmail API adapter, outbox, ledger | PASS locally with transport doubles; BLOCKED live (mailbox/OAuth) |
| Calendar sync | `CalendarSync.gs` | `worker` calendar job, `calendar_links` | BLOCKED live (Workspace) |
| Backups | Drive backup of the workbook | `pg_dump`/logical archive + AES-256-GCM + Drive adapter + `backup_log` | PASS (encryption + logical restore tested; resumable Drive upload tested with a transport double); pg_dump path and live Drive NOT_RUN (client tools and credentials absent locally) |
| Reporting export | generated sheets | one-way append to a dedicated sheet | BLOCKED live (Sheets credentials) |
| Shared dashboard publication | A/B snapshot workbook | A/B slots in PostgreSQL, same allowlist | PASS locally; BLOCKED against the real snapshot spreadsheet |
| Triggers | installable Apps Script triggers | worker scheduler + outbox | PASS (dedupe keys, lease reclaim) |

## 4. Documented differences

1. **Sign-in for every screen.** V1 relied on the Apps Script deployment ACL for the employee
   dashboard. V2 is reachable outside the office, so every screen requires a verified company
   Google account. There is still no login form, no password and no owner-match check for
   requests; any authenticated internal member may request a change. Recorded in
   [SECURITY.md](./SECURITY.md).
2. **Google Sheets is no longer authoritative.** Projects, tasks, requests, audit and
   notifications live in PostgreSQL. Sheets is a one-way report target only.
3. **The request inbox is optional.** New submissions write straight to PostgreSQL. The Sheets
   inbox adapter exists only for a transition period and is inert when unconfigured.
4. **`TASK_ASSIGNEES`/`RESPONSIBILITY_MEMBERS` keep `Removed_At`.** Behaviour matches V1; the
   rows are read through one query per request, not per task.
5. **Browser cache.** The V2 client keeps a bounded in-memory snapshot with targeted
   invalidation. No private manager data is persisted in the browser.

## 5. Not implemented (explicit)

* Apps Script sidebar (`Client.html`) — replaced by the web application; the V1 file is retained
  for reference and is not served by V2.
* Google Sheets editing from the browser — the database is PostgreSQL.
* Workload-overlap validation, capacity blocking, automatic reassignment — excluded by the
  product rules and never added.

## Planning Board (計画ボード)

Added as a separate management screen; the read-only Timeline is unchanged and remains available.

* One editable hierarchy table and one synchronized Gantt chart rendered from one draft, with
  in-place names and dates, bar drawing/moving/resizing, manual order with drag and explicit
  structural actions, day/week/month scales, Today and Fit.
* A private, versioned PostgreSQL draft (author-only) with a debounced revision-checked save, visible
  save states and conflict preservation.
* An in-page `Review & Create` bound to the reviewed content, and one transactional export that
  creates a new project or appends to an existing one, maps every draft identifier and stores a
  durable receipt.
* Assignments use the existing eligible-member data (active member with a `WORK` membership in the
  division); primary owner and additional assignees keep their existing meanings.

Deliberately **not** added: member planning access, project-sharing of drafts, branch-wide
rescheduling when a parent bar moves, automatic dependency rescheduling, capacity blocking, labour
hour inference, and any planner write to an existing operational schedule. Export never completes
work, approves an assignment, notifies, touches Calendar or publishes.
