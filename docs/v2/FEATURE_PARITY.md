# V1 → V2 Feature Parity

Status legend: **PASS** = implemented and verified locally (unit/integration/API test);
**PARTIAL** = implemented with a documented limitation; **BLOCKED** = needs a credential,
Workspace, DNS or deployment that this environment cannot provide; **NOT_RUN** = not measured.

Every V1 entry point was read from `src/`, `dashboard-app/` and `shared/`. The V1 workbooks and
scripts are unchanged; V2 is a separate codebase that keeps the identifiers, rules and visible
workflows.

## 1. Manager features

| Feature | V1 implementation / entry points | V1 authorization | Invariants and tests | V2 location | Migration | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Project list/create/edit | `Ui.createProject`, `Ui.updateProject`, `Projects.gs`, `ManagerWeb` `projects`/`project` | ADMIN, MANAGER | Partial patch, revision check, immutable IDs; `contracts.test`, `api.test` (create once, stale edit) | `apps/web/src/screens/Projects.tsx`, `apps/api/src/services/projects.ts`, `projects` table | PRESERVED IDs | PASS |
| Project archive | `Projects.archive`, `projectArchive` | ADMIN, MANAGER + confirmation | Status change only, history kept; `domain.test` lifecycle, `api.test` archive-not-called (UI), DB trigger `projects_archived_marker` | `archiveProjectCommand` | PRESERVED | PASS |
| Project delete (mistaken empty record) | `Deletion.gs`, `projectDelete` | ADMIN only, typed `DELETE <id>`, reason, backup | Empty preflight, tombstone, `RECORD_DELETE_PREPARED`/`RECORD_DELETED`; `deletion.ts`, `domain.test` | `apps/api/src/services/deletion.ts`, `record_deletions` | PRESERVED | PASS |
| Project completion rule | — | ADMIN, MANAGER | All tasks Done before `Completed`; `domain.test` | `assertProjectCompletable` | — | PASS |
| Nested subprojects (4 levels) | `Subprojects.gs` | ADMIN, MANAGER | Self/cross-project/cycle/depth; domain + DB trigger; `domain.test`, `integration.test` | `subprojects` table, `eh_subproject_guard` | PRESERVED tree | PASS |
| Task hierarchy (3 levels) | `TaskTree.gs` | ADMIN, MANAGER | Self/cross-project/cross-subproject/cycle/depth; domain + DB trigger; `domain.test`, `integration.test`, `api.test` (parent options) | `tasks.parent_task_id`, `eh_task_guard` | PRESERVED tree | PASS |
| Task create/edit (partial patch) | `Ui.assignTask`, `Tasks.gs` | ADMIN, MANAGER; MEMBER own task in the sidebar | Revision check, deadline confirmation, non-working acknowledgement, assignment version bump; `api.test`, `integration.test` | `tasks` table, `services/tasks.ts`, `TaskForm.tsx` | PRESERVED | PASS |
| Dependencies (cycle prevention) | `Dependency_IDs` column | ADMIN, MANAGER | Graph cycle refusal; `task_dependencies` + trigger; `domain.test`, `integration.test` | `task_dependencies` | Parsed into rows | PASS |
| Primary + additional assignees | `TASKS.Owner_Member_ID`, `TASK_ASSIGNEES` | ADMIN, MANAGER | Soft removal, reactivation, one audit row, approval invalidation; `integration.test` | `task_assignees` | PRESERVED | PASS |
| Responsibility members | `RESPONSIBILITY_MEMBERS` | ADMIN, MANAGER | Same soft relationship; `directory.ts` | `responsibility_members` | PRESERVED | PASS |
| Responsibilities CRUD/order/retire | `Responsibilities.gs`, `saveResponsibility`, `moveResponsibility`, retire/reactivate | ADMIN, MANAGER; owner change ADMIN only | Retirement is a status change, no deletion, colour validation, owner change audited; `domain.test`, `services/directory.ts` | `responsibilities` | PRESERVED | PASS |
| Members, roles, activation | `Members.gs`, `saveMember` | ADMIN for role/activation | No self-change, last active administrator protected, sessions revoked on deactivation; `domain.test`, `api.test` | `members` | PRESERVED | PASS |
| Skills and assessments | `Skills.gs` | ADMIN, MANAGER | Assessment upsert, manager-only matrix; `skills` route | `skills`, `member_skills` | PRESERVED | PASS |
| Planning: deadline + duration | `Planning.planFromDuration`, `planningWarnings` | ADMIN, MANAGER | Working/calendar basis, holidays, warnings with acknowledgement; `domain.test` | `packages/domain/src/planning.ts` | Date/time migration | PASS |
| Phase back-planning | `Planning.schedulePhases` | ADMIN, MANAGER | Bounded dependencies, DRAFT propagation; `domain.test` | `planning.ts`, `project_phases` | PRESERVED | PASS |
| Progress rollup | `Progress.rollup`, `Progress.refresh` | — | Known estimate weight, unknown fallback 1, cancelled excluded, containers excluded; `domain.test` | `packages/domain/src/progress.ts`, `views.ts` | Recalculated from tasks | PASS |
| Task scope counting | `TaskScope.gs` | — | One policy for cards, KPIs, reports; container/archived exclusion; `domain.test` | `packages/domain/src/scope.ts` | — | PASS |
| Eligibility (archive-aware) | `Eligibility.gs` | — | Whole ancestor chain, bounded walk; `domain.test`, `db` integration | `eligibility.ts` | — | PASS |
| Dashboard/overview | `ManagerWeb` `overview`, `Client.html` | MANAGER | Bounded scope, upcoming window, area cards, pending requests; `api.test` bootstrap/overview | `screens/Overview.tsx`, `buildOverview` | — | PASS |
| Workload report | `ManagerWeb` `member`, `Planning.workloadData` | MANAGER | Weekly utilisation, unknown estimates, no capacity blocking; `Workload.tsx`, `workloadReport` | `automation.ts` | — | PASS |
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
| Privacy boundary | allowlisted snapshot | One allowlist in `publication.ts`; `contracts.test` | PASS |

## 3. Integrations and operations

| Feature | V1 | V2 | Status |
| --- | --- | --- | --- |
| Email notifications | `Notifications.gs` (MailApp) | `worker` + Gmail API adapter, outbox, ledger | PASS locally with transport doubles; BLOCKED live (mailbox/OAuth) |
| Calendar sync | `CalendarSync.gs` | `worker` calendar job, `calendar_links` | BLOCKED live (Workspace) |
| Backups | Drive backup of the workbook | `pg_dump`/logical archive + AES-256-GCM + Drive adapter + `backup_log` | PASS (encryption + logical restore tested); pg_dump path NOT_RUN (client tools absent locally) |
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
