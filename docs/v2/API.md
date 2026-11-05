# V2 HTTP API

## Completion reports by any authorized reporter, and a read-only timeline (2026-11-05)

Approved policy change: `POST /api/employee/requests` accepts a `COMPLETION_REPORT` from a verified,
active **MEMBER**, **MANAGER** or **ADMIN** who can already reach the task, whether or not they are
assigned to it. `DEADLINE_CHANGE` keeps the assigned-MEMBER rule, `VIEWER` stays read-only, and the
reporter is always the verified session. A report never completes, reassigns, or grants approval.

| Endpoint | Change | Why |
| --- | --- | --- |
| `GET /api/employee/tasks/:id/report-eligibility` | **new.** `{ taskId, eligible, reasons[], submissionEnabled, reporterName }`; an unreadable task is `404` | The action's availability and every blocked reason come from the server; a client never infers eligibility from a request-history page |
| `POST /api/employee/requests` | `COMPLETION_REPORT` accepts MEMBER/MANAGER/ADMIN for accessible work; the refusal set is unchanged otherwise | The approved exception; server re-checks the same assessment before writing |
| `GET /api/employee/my-work` | the body no longer carries `projects`; `pendingRequest` and `reviewState` describe the **task**, so any assignee sees a pending report | A foreign key → one task-level state instead of a per-reporter slice |
| `GET /api/employee/my-work/project-filter` | **new.** `query`, `page`, `pageSize`, `selectedId`; paged distinct projects of the caller's own work with `taskCount` and the `selected` option | Removes the fixed 200-project slice from the filter |
| `GET /api/manager/tasks/parent-options` | `query`, `page`, `pageSize`, `selectedId`; returns `{ items: [{ id, name, path, depth, parentTaskId, container, status }], total, page, pageSize, totalPages, selected }` | Search and paging apply to the eligible candidates, never to an already truncated list; `path` keeps same-named branches distinct |
| `GET /api/work/timeline` | **new, read-only, every signed-in role.** Without `projectId`: paged project summaries (`plannedStart`, `forecastEnd`, `committedDeadline`, `openWork`, `completedWork`, `childRange`) plus the readable `responsibilities`. With `projectId`: the project branch (`project`, `subprojects`, `tasks`, `truncated`, `taskTotal`) | One allowlisted timeline projection for all roles; plan, deadline and completion stay separate fields |

`childRange` is a display span the server derives from dated descendants inside the authorized
filter (`start`, `end`, `datedItems`, `totalItems`). It is never written to a record, never counted
as work, and never depends on the rendered page. `includeCompleted=false` hides completed tasks from
a branch; cancelled work and archived branches stay manager-only, matching the other read-only
screens.

Refusals stay stable codes: `ROLE`/`NOT_ASSIGNED` → `403 AUTHORIZATION_DENIED`, an unreadable task →
`404 NOT_FOUND`, `CONTAINER` → `409 CONTAINER_NOT_COMPLETABLE`, `COMPLETED`/`CANCELLED`/`PENDING`/
`ARCHIVED` → `409 INVALID_TRANSITION`, `SUBMISSION_DISABLED` → `403 REQUEST_SUBMISSION_CLOSED`.

## Usability release: guided forms, request context and My Work filters (2026-11-04)

No route was added, removed or re-authorized. Three existing projections were extended narrowly so
a screen does not need a per-row request:

| Endpoint | Addition | Why |
| --- | --- | --- |
| `GET /api/employee/my-work` | `query`, `projectId`, `overdue`, `dueThisWeek`, `awaitingReview` query flags; `unfilteredActiveTotal` and `projects` in the body | Filters resolve in SQL before `LIMIT`/`OFFSET`, and "nothing assigned" stays distinguishable from "no match" |
| `GET /api/manager/requests` (and the sync reply) | each item carries `taskName`, `projectName`, `subprojectName` | A reviewer judges a request without opening the task or issuing one request per row |
| `GET /api/manager/status` | `requestSubmissionEnabled` | The status screen reports a closed intake instead of implying it works |
| `GET /api/manager/tasks/:id`, `GET /api/work/tasks/:id` | `depth` | Child-task eligibility is explained from the stored hierarchy depth |
| `GET /api/manager/tasks/parent-options` | each item carries `parentTaskId` | The client renders a full parent path instead of an ambiguous name |

`GET /api/employee/my-work` still resolves the member from the verified session only; a
`memberId`, `ownerId` or similar browser parameter is neither read nor honoured. Every flag is a
bounded filter: `query` is ≤120 characters, `projectId` ≤64, and the three flags accept only the
exact strings `true`/`false`. The requested `section` keeps its own `total`, while
`unfilteredActiveTotal` is the active-work count without filters. `projects` lists at most 200
projects that occur in the caller's own work and is the only valid set of `projectId` values.
*(Superseded on 2026-11-05: `projects` was removed and replaced by the paged, searchable
`GET /api/employee/my-work/project-filter`, so no row cap decides which project is reachable.)*

## Manager Overview and All Work filters (2026-11-04)

`GET /api/manager/overview` remains `ADMIN`/`MANAGER` only and accepts:

| Parameter | Values | Notes |
| --- | --- | --- |
| `upcomingDays` | `7`, `14`, `30` | Default `7`; any other value is `400 VALIDATION_FAILED` |
| `responsibilityId` | identifier | Filters counts and both preview lists before their limits |
| `unassigned` | exact `true` or `false` | Selects projects with no responsibility |

The server uses the Asia/Tokyo business date. The inclusive end is `today + 6`, `+13` or `+29`;
weekends are ordinary dates. `upcomingWindow` returns `days`, `from` and `to`. `upcoming` is a
nearest-deadline-first preview (20 rows) with `upcomingTotal`; `overdue` is an oldest-deadline-first
preview (10 rows) with `overdueTotal`. Both contain leaf work only, exclude Done, Cancelled,
archived/deleted work and archived subproject ancestry, and apply responsibility scope in SQL
before the limit.

`GET /api/manager/tasks` and the signed-in read-only `GET /api/work/tasks` accept the existing
responsibility filters plus `workState=OPEN`. OPEN is unfinished active leaf work and includes
overdue work. `displayStatus=OVERDUE` returns that subset due before today;
`displayStatus=DONE` is completed leaf history and does not include Cancelled or archived work.
With `tree=true`, `matchedTotal` counts matching work units while `items`/`total` may also contain
ancestor containers needed for navigation.

## Date-based workload report (2026-11-04)

`GET /api/manager/reports/workload` is now a date-based task-count report instead of a fixed
four-week utilisation table. `ADMIN` and `MANAGER` only; `MEMBER`, `VIEWER` and an unauthenticated
caller are refused before any query runs.

| Parameter | Values | Notes |
| --- | --- | --- |
| `mode` | `DAY`, `WEEK`, `MONTH`, `YEAR`, `CUSTOM` | Default `WEEK` |
| `anchor` | `YYYY-MM-DD` | Defaults to the business date; ignored by `CUSTOM` |
| `start`, `end` | `YYYY-MM-DD` | Required by `CUSTOM`, inclusive, start ≤ end, at most 366 days |
| `granularity` | `DAY`, `WEEK`, `MONTH` | `CUSTOM` only; otherwise derived (≤14 days daily, 15–90 weekly, >90 monthly) |
| `memberId`, `projectId`, `responsibilityId` | identifier | Applied inside PostgreSQL, before anything is aggregated |
| `memberQuery` | text (max 100) | Member-table name filter |
| `sort`, `direction` | `overdue` \| `due` \| `name`; `asc` \| `desc` | Default `overdue` descending, then most due |

A week is Monday–Sunday. Saturday and Sunday are ordinary calendar days and no Japanese public
holiday is filtered. Every period is resolved on the server in Asia/Tokyo terms, and a validation
failure is `400 VALIDATION_FAILED` with the offending field in `details`.

The response carries `mode`, the resolved `start`/`end`, `today`, `granularity`, `summary`,
`buckets`, `employees`, `assignmentBasis: 'CURRENT_ASSIGNMENTS'` and `generatedAt`. Every figure is
a task count; no hour, capacity or utilisation field exists.

| Figure | Definition |
| --- | --- |
| `dueTasks` | Current due date inside the period (cancelled work excluded) |
| `completedTasks` | Stored completion instant inside the period (Asia/Tokyo date) |
| `overdueTasks` | Unfinished, current due date before today |
| `undatedTasks` | Unfinished, no due date |
| `overdueWithinPeriod` | Unfinished, due inside the period, already overdue today |
| `backlogBeforePeriod` | Unfinished, due before the period starts |
| `uniqueTasks` | Distinct tasks behind the four cards — never the sum of the member rows |
| `assignments` | Employee–task pairs of those tasks; a shared task counts once per active assignee |

`GET /api/manager/reports/workload/tasks` returns one paginated list behind a figure:
`kind` (`DUE`, `COMPLETED`, `OVERDUE`, `OVERDUE_IN_PERIOD`, `UNDATED`, `BACKLOG`), the same period
parameters plus optional `from`/`to` bucket bounds, `page` (default 1) and `pageSize` (default 25,
maximum 100). `POST /api/manager/reports/refresh` accepts the same query and returns the report for
that period.

Assignment tables record who is assigned now, so the answer states
`assignmentBasis: 'CURRENT_ASSIGNMENTS'`: it groups current assignments by the selected dates and
never claims to reconstruct a historical as-of assignment. Removed assignees contribute nothing;
a container task is organisation and is never counted as work.

Schema 10 adds `tasks_completed_at_idx` (additive, partial) for the completion filter.

## Member project explorer (2026-11-04)

`MEMBER` and `VIEWER` now have a Projects navigation entry that opens a read-only explorer backed
by `GET /api/work/projects` (never `/api/manager/projects`). The explorer searches by project name,
filters by responsibility on the server, pages the result and shows only allowlisted fields:
project name, description, responsibility name, owner name, status, priority, committed deadline,
derived progress and the `TaskScope` counts of open and completed work. `GET /api/work/projects/:id`
adds the project description and each subproject's description to the same narrow projection, and
`GET /api/work/tasks/:id` adds a display-only `context` (project name and the subproject chain).
Schema 9 adds `subprojects.description` (additive, default `''`). There is no write path on any
`/api/work/*` route: a MEMBER or VIEWER still cannot create, patch, delete, reassign, approve or
change a deadline.

## Local LAN update — 2026-11-02

[LOCAL_LAN.md](LOCAL_LAN.md) specifies the employee-ID/password mode, schema 7, optional email, first-login change, administrator reset, employee-owned progress editing, Windows launcher, durable local backup and optional Shared Drive upload. It supersedes Google-only or Linux-only assumptions below for this mode. [Verification record](LOCAL_LAN_ACCEPTANCE.md).

## Request queue pagination (2026-11-01)

Manager request reads and sync accept page (default 1), pageSize (default 25, maximum 100), and includeDecided (boolean or the exact strings true/false). Responses include page, pageSize, totalPages and the total count. Out-of-range pages clamp to the last available page. Reference entries include projectId for scoped selectors.


Base URL: the deployment origin (same origin as the web application). All responses are JSON.

## 1. Envelope

Success:

```json
{ "ok": true, "data": { }, "meta": { "correlationId": "…", "executionMs": 12, "dbCalls": 4 } }
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "EDIT_CONFLICT",
    "message": "Reload and review; your draft is preserved",
    "details": { "expected": 3, "stored": 4 },
    "retryable": false,
    "correlationId": "…"
  }
}
```

`x-correlation-id` is echoed on every response; a client may supply a safe value (8–80
characters) and it is otherwise generated.

## 2. Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `UNAUTHENTICATED` | 401 | No valid session |
| `AUTHORIZATION_DENIED` | 403 | Verified identity lacks the role, or CSRF/origin refusal |
| `VALIDATION_FAILED` | 400 | Structured field errors in `details.fields` |
| `NOT_FOUND` | 404 | Unknown record or endpoint |
| `EDIT_CONFLICT` | 409 | Revision mismatch; the client keeps the draft |
| `CONFIRMATION_REQUIRED` | 400 | A confirmation or acknowledgement is missing |
| `IMMUTABLE_FIELD` | 400 | An identity/creation field was supplied |
| `INVALID_TRANSITION` | 409 | The request state or lifecycle rule forbids the change |
| `STALE_REQUEST` | 409 | The task changed after the request was submitted |
| `DUPLICATE_DECISION` | 409 | The request was already decided |
| `CONTAINER_NOT_COMPLETABLE` | 409 | A task with children cannot be completed directly |
| `HIERARCHY_CYCLE`, `HIERARCHY_DEPTH`, `HIERARCHY_INVALID` | 400 | Hierarchy rule violation |
| `DEPENDENCY_CYCLE`, `DEPENDENCY_INVALID` | 400 | Sequencing rule violation |
| `RESPONSIBILITY_REQUIRED` | 400 | A project must name an active responsibility |
| `REQUEST_SUBMISSION_CLOSED` | 403 | `REQUEST_SUBMISSION_ENABLED` is not `true` |
| `IDEMPOTENCY_REPLAY` | 409 | The key is in progress or reused for a different request |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `PAYLOAD_TOO_LARGE` | 413 | Body limit (256 KB default) exceeded |
| `NOT_CONFIGURED` | 503 | A required integration is not configured |
| `INTERNAL_ERROR` | 500 | Unexpected failure (development builds add `details.reason`) |

`AUTHORIZATION_DENIED` and `UNAUTHENTICATED` are the only codes that make the browser clear its
session and cache. A timeout, network failure, `EDIT_CONFLICT` or validation error never does.

## 3. Sessions

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/session` | `{ idToken }` (Google) or `{ devEmail }` (development fixture only). Sets an HttpOnly, SameSite=Lax cookie and returns the CSRF token |
| GET | `/api/session` | Returns the actor, CSRF token and expiry |
| DELETE | `/api/session` | Revokes the session and clears the cookie |

Every non-safe request must send `x-csrf-token` with the session token. When a browser sends
`Origin`, it must match `PUBLIC_ORIGIN` or a configured allowed origin.

## 4. Manager endpoints (ADMIN/MANAGER unless noted)

### Reads

| Method | Path | Query / notes |
| --- | --- | --- |
| GET | `/api/manager/bootstrap` | Actor, references, bounded project index, compact task index |
| GET | `/api/manager/overview` | `responsibilityId`, `unassigned`, `upcomingDays=7|14|30` |
| GET | `/api/manager/projects` | `responsibilityId`, `unassigned`, `status`, `query`, `page`, `pageSize`, `sort`, `direction` |
| GET | `/api/manager/projects/:id` | Record, rollup, subprojects with rollup, task summaries, milestones, phases |
| GET | `/api/manager/subprojects` | `projectId` |
| GET | `/api/manager/tasks` | `projectId`, `subprojectId`, `responsibilityId`, `unassigned`, `workState=OPEN`, `displayStatus`, `status`, `ownerMemberId`, `query`, `containerOnly`, paging, sorting |
| GET | `/api/manager/tasks/parent-options` | `projectId`, `subprojectId?`, `excludeTaskId?`, `query`, `page`, `pageSize`, `selectedId`; search and paging apply to the eligible candidates and each item carries its `path` |
| GET | `/api/manager/tasks/:id` | Record, effective assignees, history, confirmations, deadline history, children |
| GET | `/api/manager/task-index` | Compact navigation index (bounded) |
| GET | `/api/manager/search/tasks` | `query`, `limit` ≤ 50 |
| GET | `/api/manager/editor` | `type` (task/project/member/responsibility/subproject), `id`; narrow record + `_revision` |
| GET | `/api/manager/references` | Responsibilities, members, skills, subprojects |
| GET | `/api/manager/members` | `query`, paging |
| GET | `/api/manager/members/:id/profile` | `403` for MEMBER/VIEWER |
| GET | `/api/manager/responsibilities` | Includes members and colour |
| GET | `/api/manager/skills` | Skills + assessments |
| GET | `/api/manager/requests` | `includeDecided` |
| GET | `/api/manager/automation` | Settings, revision, effective mode, LIVE requirements |
| GET | `/api/manager/publication` | Slot, contract, hash, row counts, last error |
| GET | `/api/manager/status` | Version, schema, counts, outbox, backup (local / Drive / latest failure) |
| GET | `/api/manager/reports/workload` | Date-based task counts for `DAY`/`WEEK`/`MONTH`/`YEAR`/`CUSTOM` (see above) |
| GET | `/api/manager/reports/workload/tasks` | Paginated drilldown behind a card, a timeline bucket or a member row |
| GET | `/api/manager/plan/preview` | `deadline`, `durationValue`, `durationUnit`, `durationBasis` |
| GET | `/api/manager/deletion/preflight` | `entityType`, `entityId` (ADMIN only) |
| GET | `/api/admin/responsibilities/:id/delete-preflight` | ADMIN only; eligibility, project/reference counts, blockers, `erasePlan`, `confirmationText` and the current revision |
| GET | `/api/manager/removal/preflight` | `entityType=TASKS|SUBPROJECTS`, `entityId` (ADMIN only); returns active child/dependency/workflow blockers, the current revision and whether retained task history requires an administrative reason |

### Commands

| Method | Path | Body highlights |
| --- | --- | --- |
| POST | `/api/manager/projects` | `idempotencyKey`, `projectName`, `responsibilityId`, optional fields |
| PATCH | `/api/manager/projects/:id` | `revision` + changed fields, `confirmDeadlineChange`, `acknowledgeNonWorking` |
| POST | `/api/manager/projects/:id/archive` | `revision`, `confirmed: true`, `reason?` |
| DELETE | `/api/manager/projects/:id` | `revision`, `confirmed`, `reason`, `confirmation: "DELETE <id>"` |
| POST | `/api/manager/subprojects` | `idempotencyKey`, `projectId`, `parentSubprojectId?`, `subprojectName`, `description?` (max 2000) |
| PATCH | `/api/manager/subprojects/:id` | `revision` + partial fields; an omitted `description` keeps the stored text |
| POST | `/api/manager/subprojects/:id/archive` \| `/reactivate` | `revision`, `confirmed`, `reason?` |
| DELETE | `/api/manager/subprojects/:id` | Compatibility physical-purge route; as projects |
| POST | `/api/admin/subprojects/:id/remove` | ADMIN logical removal: `revision`, `confirmed: true`; sets `deleted_at`, increments the revision and writes `RECORD_REMOVED` without deleting history |
| POST | `/api/admin/subprojects/:id/purge` | ADMIN advanced permanent erasure: `revision`, `confirmed`, required `reason`, `confirmation: "DELETE <id>"` |
| POST | `/api/manager/tasks` | `idempotencyKey`, `projectId`, `taskName`, `deadline`, optional planning fields, `assigneeIds`, `dependencyIds` |
| PATCH | `/api/manager/tasks/:id` | `revision` + fields, `confirmDeadlineChange`, `acknowledgeNonWorking` |
| POST | `/api/manager/tasks/:id/approve` | `revision`, `confirmed` |
| POST | `/api/manager/tasks/:id/confirm-schedule` | `revision`, `confirmed`, `notes?` |
| POST | `/api/manager/tasks/:id/complete` | MANAGER/ADMIN: `revision`, `confirmed: true`, `note?`. Direct completion; the container, cancelled and already-done refusals still apply, and a pending completion report is withdrawn |
| POST | `/api/manager/tasks/:id/override-complete` | ADMIN: `revision`, `reason`, `confirmation: "COMPLETE <id>"` |
| DELETE | `/api/manager/tasks/:id` | Compatibility physical-purge route; ADMIN, as projects |
| POST | `/api/admin/tasks/:id/remove` | ADMIN logical removal: `revision`, `confirmed: true`, `reason?`; removes the task from normal views while preserving requests, completion/approval/schedule/audit/effort history and queues A/B publication reconciliation. `reason` is required when retained completion or approval evidence exists. |
| POST | `/api/admin/tasks/:id/purge` | ADMIN advanced permanent erasure: `revision`, `confirmed`, required `reason`, `confirmation: "DELETE <id>"` |
| POST | `/api/manager/members` | ADMIN for `role`/`active` |
| PATCH | `/api/manager/members/:id` | `revision` + fields (role/active ADMIN only) |
| POST | `/api/manager/responsibilities` | `name`, `ownerMemberId`, `additionalMemberIds`, `colorHex`, `sortOrder` |
| PATCH | `/api/manager/responsibilities/:id` | `revision` + fields |
| PATCH | `/api/manager/responsibilities/:id/order` | `revision`, `sortOrder` |
| POST | `/api/manager/responsibilities/:id/retire` \| `/reactivate` | `revision`, `confirmed`, `reason?` |
| DELETE | `/api/admin/responsibilities/:id` | ADMIN only, unused areas only: `revision`, `confirmed: true`, `confirmation: "DELETE <id>"`, optional `reason`; writes the tombstone and `RECORD_DELETE_PREPARED`/`RECORD_DELETED` |
| POST | `/api/manager/skills` | `skillName`, `category`, `description`, `requiredLevel` |
| POST | `/api/manager/skills/assess` | `memberId`, `skillId`, `currentLevel`, `evidence`, `trainingAction` |
| POST | `/api/manager/requests/sync` | `includeDecided`; performs at most one import per call |
| POST | `/api/manager/requests/:id/decide` | `decision` (APPROVE/REJECT/RETURN), `revision`, `note?`, `confirmed` |
| PUT | `/api/manager/automation` | `revision`, `changes`, `confirmed`, `confirmation?` (LIVE / publication phrases) |
| POST | `/api/manager/automation/emergency-stop` | ADMIN |
| POST | `/api/manager/publication/publish` | ADMIN, `confirmed` |
| POST | `/api/manager/reports/refresh` | MANAGER |
| POST | `/api/manager/deletion/reconcile` | ADMIN, `confirmed`, `confirmation: "RECONCILE DELETIONS"` |

The normal Delete action in All Work and Project Detail always uses
`POST /api/admin/.../remove`; it is a simple explicit confirmation and never asks for a typed task
ID. The separate **Permanently erase mistaken record** advanced action uses
`POST /api/admin/.../purge`. The older physical `DELETE` routes remain compatibility aliases, are
not used by the normal UI, and have the same strict policy. A physical purge is ADMIN-only, re-runs
the preflight under a row lock inside the same transaction, and answers the stored `tombstoneId`
only after `RECORD_DELETE_PREPARED`, the row removal and `RECORD_DELETED` all succeed.

The POST `/api/admin/.../remove` commands are deliberately separate from these physical DELETE
commands. Ordinary administrative removal keeps the task/subproject row and all foreign-key
evidence, stamps `deleted_at`, increments `revision`, and records the verified actor and the
standard mistaken-record reason in `RECORD_REMOVED`. A repeat after success returns
`alreadyRemoved: true` and does not append another audit event. Child tasks/subprojects, active
dependants, pending/processing requests, pending or leased notification/calendar jobs, current
assignment approval, completed work and recorded effort block task removal. Routine edits, audit
rows, deadline history, historical assignees, decided requests and prior publication do not.
`GET /api/manager/deletion/preflight` is the read-only physical-purge companion. It reports
`deletable`, exact blocker details, `confirmationText` and `erasePlan`. For a task, `erasePlan`
enumerates the task row plus the task's assignee and outgoing-dependency relationship rows; audit
rows are append-only and are never in the erase plan. Children (including logically removed
children), incoming dependencies, completion requests, deadline history, schedule decisions,
notifications, active worker jobs, issues, Calendar links, protected audit actions and stored
publication-snapshot references block the purge, so no foreign-key row is blindly cascaded.

An `INTERNAL` project setting alone is not publication evidence: a purge is blocked only when a
stored A/B snapshot actually references the task. `actual_hours > 0` is also not automatically
called genuine work. A value corroborated by an audited task update is `RECORDED_EFFORT`; a
completed task or approved completion request is protected completed work; a nonzero imported
value without corroboration is reported separately as `UNVERIFIED_LEGACY_EFFORT` and retained
rather than silently erased. Routine `TASK_UPDATED` history does not itself block a purge, while
unknown or operational audit actions do. Audit checks query the complete history, not a capped
recent page.

### Responsibility areas (分野)

`GET /api/manager/responsibilities` returns every stored area, active and retired, because the
manager table filters them in the browser: the default view lists active areas only and the
`廃止済みを表示` / **Show retired** checkbox reveals the rest. That preference lives in route
memory, never in the workbook. Retiring or reactivating an area is a status change only - no
project, task, owner, deadline or colour is rewritten - and the refreshed list simply moves the row
between the two views.

`DELETE /api/admin/responsibilities/:id` is the reviewed permanent deletion for an **unused** area,
and `GET /api/admin/responsibilities/:id/delete-preflight` is its read-only companion. The
preflight answers `projectCount` (active, archived and logically deleted projects all count),
`archivedProjectCount`, `deletedProjectCount`, `activeMemberCount`, `historicalMemberCount`,
`auditReferenceCount`, `publishedReferenceCount`, `activeJobCount`, `erasePlan`,
`confirmationText` and the current revision. Any project reference blocks the deletion with
`PROJECTS_REFERENCED` (HTTP 409, `details.projectCount`), as do a stored publication reference and a
pending worker job. Nothing is reassigned or cascaded; the manager moves the projects first or
retires the area instead. Only `responsibility_members` links are administrative: they do not
block, they are captured in the tombstone snapshot and then removed with the row, while the
append-only `audit_log` rows stay. The deletion re-runs the preflight under a row lock inside the
deleting transaction, refuses a stale revision with `EDIT_CONFLICT`, and answers the stored
`tombstoneId` only after `RECORD_DELETE_PREPARED`, the row removal and `RECORD_DELETED` all
succeed. A deleted identifier is never reused, so a repeated deletion answers
`INVALID_TRANSITION` without a second tombstone.

## 5. Employee / member endpoints

`MEMBER` and above may read. Creation and request submission are member self-service; a `VIEWER`
is refused those mutations but keeps its own read-only list. The owner of a created task, the
request author and the deadline/status effect are decided on the server.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/employee/snapshot` | Published contract 1.6, `INTERNAL` projects only, `submissionEnabled` |
| GET | `/api/employee/my-work` | `page`, `section`, `query`, `projectId`, `overdue`, `dueThisWeek`, `awaitingReview`; My Assigned Work for **any** signed-in role, resolved from the verified session. Never another member's work. `pendingRequest`/`reviewState` are task-level |
| GET | `/api/employee/my-work/project-filter` | Paged, searchable distinct projects of the caller's own work (`query`, `page`, `pageSize`, `selectedId`); each item carries `taskCount`, and `selected` keeps a chosen project readable off-page |
| GET | `/api/employee/my-work/projects` | MEMBER only. Active projects and non-archived subprojects a member may file work under: id, name and responsibility name per project, and `subprojectId`, `subprojectName`, `parentSubprojectId`, `depth` per subproject (hierarchy metadata only) |
| POST | `/api/employee/my-work` | MEMBER only. `idempotencyKey`, `projectId`, `subprojectId?`, `taskName`, `description?`, `deadline`, `priority?`. The owner is the verified member, the status is `Not Started` and progress is 0. An owner, assignee, status or progress sent by the browser is rejected by the strict contract. A MANAGER or ADMIN uses the manager task form instead |
| POST | `/api/employee/subprojects` | MEMBER only. `idempotencyKey`, `projectId`, `parentSubprojectId?`, `subprojectName`, `description?`, `deadline?`. Creation is **not** an approval step: the owner is the verified member, the status is `Active`, `estimatedHours` is empty and the audit row is `SUBPROJECT_CREATED`. The whole subtree is validated (active project, active parent, same project, four-level limit, no cycle) and a retry with the same key returns the first subproject. `POST /api/manager/subprojects` stays MANAGER/ADMIN only |
| POST | `/api/employee/requests` | MEMBER, MANAGER or ADMIN for `COMPLETION_REPORT` on accessible work; MEMBER only and assigned for `DEADLINE_CHANGE`. `clientRequestId`, `taskId`, `requestType`, `requestedDueDate?`, `reason?`, `explanation?`, `completionNote?`; idempotent; the reporter is the verified session |
| GET | `/api/employee/tasks/:id/report-eligibility` | The server-derived completion-report capability: `eligible`, every `reasons` code, `submissionEnabled` and the verified `reporterName`; an unreadable task is `404` |
| GET | `/api/employee/requests/mine` | The caller's own requests with `submissionEnabled`; state and decision note only |
| GET | `/api/employee/requests/:id` | Receipt state only; another member's receipt is `404` |

`PATCH /api/employee/my-work/:id` no longer exists. A MEMBER cannot rewrite progress, actual hours
or a stored status; the only completion path is the reviewed request below.

### Read-only work browsing (any signed-in role)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/work/tasks` | Server-paged active work. `projectId`, `subprojectId`, `responsibilityId`, `unassigned`, `status`, `displayStatus` (`IN_PROGRESS`/`OVERDUE`/`DONE`/`CANCELLED`), `ownerMemberId`, `query`, `containerOnly`, `overdueOnly`, `includeInactive`, `tree`, `treeParentId`, paging and sorting |
| GET | `/api/work/tasks/:id` | Task detail for MEMBER/VIEWER: an allowlisted record plus the display-only `context` (project name and subproject chain, root first), assignees and children |
| GET | `/api/work/projects` | Member project explorer. `query` (project name only), `responsibilityId`, `page`, `pageSize`; each item carries `description` and the `TaskScope` counts `activeTaskCount`/`completedTaskCount`, and the page carries the `responsibilities` that group at least one readable project |
| GET | `/api/work/projects/:id` | Read-only project detail: allowlisted record (with `description` and the two counts), rollup, subprojects (with `description` and the stored `parentSubprojectId`) and the tasks of the visible branches |
| GET | `/api/work/timeline` | Read-only timeline. Without `projectId`: paged project summaries with `plannedStart`, `forecastEnd`, `committedDeadline`, `openWork`, `completedWork` and a server-derived `childRange`, plus the readable `responsibilities`. With `projectId`: the project branch (project, subprojects, tasks, `truncated`, `taskTotal`). `responsibilityId`, `query`, `page`, `pageSize`, `includeCompleted`, `includeArchived` (managers only) |

Visibility is resolved on the server before a page is cut:

- A `MEMBER` or `VIEWER` sees only tasks whose project is `INTERNAL` and whose project, subproject
  and task are not archived. `RESTRICTED`, archived, cancelled and deleted work is invisible, and a
  guessed identifier answers `404` so existence is not disclosed.
- `includeInactive=true` (archived/cancelled history) is a manager capability and answers `403`
  `AUTHORIZATION_DENIED` for the other roles.
- The default list excludes `Done`, `Cancelled`, archived and deleted work. Completed work stays
  reachable through the explicit `displayStatus=DONE` filter (and `Cancelled` through
  `displayStatus=CANCELLED` with `includeInactive=true`).
- The read-only task record carries identity, name, description, owner, derived state, priority,
  deadline, skill requirement and revision. Recorded effort, progress, duration, planned start,
  notifications, notes, acceptance criteria and confirmation/deadline history are not copied.
- The read-only project record carries identity, name, responsibility, owner name, status,
  priority, deadline, progress and health. Notification settings, the dashboard summary,
  milestones, phases and internal notes are absent.
- The read-only project detail keeps the stored hierarchy (`subprojects[].parentSubprojectId`,
  `tasks[].subprojectId`, `tasks[].parentTaskId`) so a reader rebuilds the same tree the manager
  sees. Completed work inside a visible project stays readable so the completed count is real; the
  tasks of an archived branch are withheld entirely instead of being re-attached as direct work.

Managers use `/api/manager/tasks` and `/api/manager/projects` for the same data with management
controls; the server refuses every manager write for MEMBER and VIEWER.

### Completion approval rules

* A pending, rejected or returned request never changes the task.
* `APPROVE` on a `COMPLETION_REPORT` writes `Done` once, whether the request came from a
  member-created, manager-created or legacy task. A `MANAGER` and an `ADMIN` are both authorized;
  anything below them is refused before the request is claimed, so the request stays `PENDING`.
* A manager may also complete authorized work directly with
  `POST /api/manager/tasks/:id/complete` (`revision`, `confirmed: true`, `note?`). Containers,
  `Cancelled` and already-`Done` work are refused. Any pending completion report for that task is
  finalized as `WITHDRAWN`, and a `TASK_COMPLETED_DIRECT` audit row records the task, the acting
  member, the acting role, the timestamp, `completionSource: DIRECT`, the withdrawn request IDs and
  the previous/final state.
* `REQUEST_SUBMISSION_ENABLED` must be exactly `true`; the default is `false` (closed) and the
  employee screen states that submissions are closed.

## 6. Health and public configuration

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/healthz` | Liveness |
| GET | `/readyz` | `200` with the schema version, or `503` `DATABASE_MIGRATION_REQUIRED` when the ledger is older than schema 8 |
| GET | `/api/version` | Application/API/contract versions |
| GET | `/api/public-config` | Public, non-secret runtime configuration (no authentication) |

`/api/public-config` exists so one built web artifact can be deployed to several environments. It
returns exactly:

```json
{
  "appVersion": "2.0.0",
  "environment": "PRODUCTION",
  "googleClientId": "…apps.googleusercontent.com",
  "authConfigured": true,
  "devSignInEnabled": false
}
```

`googleClientId` is public by definition. The endpoint never returns a database URL, a session,
a service-account value, a spreadsheet identifier or any other secret. `devSignInEnabled` is
`DEV_AUTH_ENABLED && !production`, so the browser and the server agree.

## 7. Limits and privacy

* Body limit 256 KB; rate limit 300 requests/minute per address (configurable).
* `no-store` on every API response; strict security headers; no permissive CORS.
* Pages are bounded: 100 rows per page maximum, task index 2 000 entries, project index 500.
* Logs redact cookies, authorization and CSRF headers. Metrics may contain timings, call counts
  and payload sizes only — never an identifier, address or cell value.

## Member self-service correction (2026-11-03)

My Work rows include the server-derived `container` boolean. Assigned tasks in RESTRICTED projects
may submit requests without changing project publication. Request author names are server-verified;
client names are ignored. Employee create/request idempotency is scoped to the authenticated member,
and a client request ID already owned by another member returns NOT_FOUND.

## Expandable task list

`GET /api/manager/tasks?tree=true` pages root tasks. Add `treeParentId=<taskId>` to page
direct children. Filters are resolved before paging; matching ancestors are retained as context
so a child matching a query cannot disappear behind an excluded parent. `total` counts siblings
at the requested level, while `matchedTotal` counts matching records across the filter scope.
The default endpoint without `tree=true` retains its existing flat-list behavior.

## Administrator account endpoints (local authentication, ADMIN only)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/admin/accounts` | `query`, `page`, `pageSize`; employee number, member, role, active state and temporary-password flag. Never a password hash |
| GET | `/api/admin/accounts/linkable` | `query`, `limit`; active members without a login, for the linking picker |
| POST | `/api/admin/accounts` | `idempotencyKey`, `employeeId`, `password`, `name?`, `role?`, `memberId?`. Without `memberId` a member and its login are created together; with `memberId` the login is attached to that existing member and its name, role and history are untouched. A duplicate employee number or a second login for the same member is `400` |
| POST | `/api/admin/accounts/:memberId/reset-password` | `password`, `confirmed: true`; sets a temporary password, bumps the password version and revokes every session |

Atomicity and authorization are server-side: one transaction per command, an advisory lock on
role/activation changes, a re-read of the acting administrator's stored role, and an audit row
(`LOCAL_ACCOUNT_CREATED`, `LOCAL_ACCOUNT_LINKED`, `PASSWORD_RESET`).
