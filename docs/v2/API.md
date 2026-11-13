# V2 HTTP API

## Member creation, shared presentation, ADMIN reopening and request dialogs — 2026-11-05

Member creation now reaches the project screens, both roles share one presentation built from
separate authorized reads, and a corrective reopening exists for accidentally completed work.
Every route re-checks the verified role; no capability flag from the browser is authority.

### Member creation

| Method | Route | Role | Body |
|---|---|---|---|
| `POST` | `/api/employee/projects` | MEMBER | `CreateMyProjectBody` |
| `GET` | `/api/employee/references` | MEMBER | — |
| `POST` | `/api/employee/subprojects` | MEMBER | `CreateMySubprojectBody` (unchanged, flat: a parent is refused) |
| `POST` | `/api/employee/my-work` | MEMBER | `CreateMyTaskBody` (unchanged) |

`CreateMyProjectBody` is `{ idempotencyKey, projectName, description?, responsibilityId, priority?,
plannedStart?, committedDeadline?, acknowledgeNonWorking? }` and is strict, so a browser-supplied
`projectOwnerId`, `status`, `dashboardVisibility`, `role` or any other field is a `VALIDATION_FAILED`
(400) instead of being ignored. The server sets the owner to the verified session, the lifecycle to
`Active` and the visibility to `INTERNAL`, requires an active responsibility
(`RESPONSIBILITY_REQUIRED`), audits `PROJECT_CREATED` with `creationChannel: "MEMBER"`, and replays a
repeated idempotency key instead of creating a second project.

`GET /api/employee/references` answers `{ projectCreationEnabled, responsibilities: [{ responsibilityId, name }] }`
for active responsibilities only. It exists so a member form never receives the manager bootstrap.

### Shared presentation, separate data

- `GET /api/work/projects` now takes `unassigned`, `schedule`, `sort` and `direction` in addition to
  `query`, `responsibilityId`, `page` and `pageSize`, all resolved server-side before the page is cut,
  and returns `groupTotals: [{ responsibilityId, total }]` for the authorized scope.
- `WorkProject` adds `responsibilityId` (the grouping key; `null` is 未分類) and `overdueTaskCount`.
  It still carries no `nextAction`, `dashboardSummary`, `notificationEnabled` or effort field.
- `GET /api/work/overview?responsibilityId&upcomingDays=7|14|30` answers a `WorkOverview`:
  `scope`, `counts` (`ScopeCounts`), `upcomingWindow`, `overdue[10]`, `overdueTotal`, `upcoming[20]`,
  `upcomingTotal`, `responsibilities` (label, colour, status, project count, open/overdue/completed
  and containers), `options` (the readable responsibilities for the filter) and `generatedAt`. The
  visibility policy (only `INTERNAL`, non-archived projects and subproject branches) is applied
  before every aggregate, list and top-N cut, and the responsibility filter is applied to the cards
  as well. A manager may read it, but the management overview stays `/api/manager/overview`.

### ADMIN corrective reopening

| Method | Route | Role |
|---|---|---|
| `GET` | `/api/manager/tasks/:id/reopen-eligibility` | ADMIN |
| `POST` | `/api/manager/tasks/:id/reopen` | ADMIN |

`ReopenEligibility` answers `{ taskId, eligible, reasons, projectId, projectName, projectStatus,
projectReopenRequired, completedAt, completionRequestId }`; `reasons` may contain `CONTAINER`,
`NOT_COMPLETED`, `PROJECT_ARCHIVED` or `PROJECT_CANCELLED`. There is no confirmation phrase: the
interface asks for one clearly labelled button. The capability answer never grants authority.

`POST …/reopen` takes `ReopenTaskBody`:
`{ idempotencyKey, revision, confirmed: true, reopenProject?, note? }`. In one transaction it:

- requires ADMIN (`AUTHORIZATION_DENIED` for MANAGER, MEMBER and VIEWER),
- refuses a stale `revision` (`EDIT_CONFLICT`), a non-`Done` task and a container
  (`INVALID_TRANSITION` / `CONTAINER_NOT_COMPLETABLE`), and an archived or cancelled parent project
  (`INVALID_TRANSITION`, with the reason stated),
- requires the explicit confirmation flag (`CONFIRMATION_REQUIRED`) and collects no reason; `note`
  is optional and is recorded only when a person wrote it,
- writes `status = "In Progress"`, `progress_percent = 0`, `completed_at = null` — no historical
  progress is invented,
- with `reopenProject: true` only, and only when the parent is `Completed`, writes the project back
  to `Active` in the same transaction and audits `PROJECT_REOPENED`,
- audits one `TASK_REOPENED` row with the actor, `confirmationSource: 'BUTTON'`, the
  application-generated description, `userNote`, the before/after state and the approved
  completion request it reverses,
- replays the stored answer for a repeated idempotency key (so a retried delivery cannot repeat the
  effect) and leaves the original request, approval and audit rows untouched.

The task then accepts a genuinely new `COMPLETION_REPORT`; an old decided request still answers
`DUPLICATE_DECISION` and is never applied twice.

## Derived project schedule status and deadline display state — 2026-11-05

`Project`, `ProjectSummary`, `Subproject`, `WorkProject`, `WorkSubproject`,
`TimelineProjectRow` and `TimelineSubprojectRow` gain a required `schedule` object:

```json
"schedule": { "state": "LATE", "missing": "NONE" }
```

`state` is one of `ARCHIVED`, `CANCELLED`, `COMPLETED`, `INVALID_DATES`, `LATE`, `PLANNED`,
`IN_PROGRESS`, `START_NOT_SET`, `DATES_NOT_SET`; `missing` is `NONE`, `START`, `FINISH` or `BOTH`.
The value is calculated on the server from `plannedStart`, `committedDeadline`, the stored
lifecycle status and the Asia/Tokyo business date. It is never stored, never accepted from a
browser and is not a second lifecycle enum. The stored `status` remains in every payload so an
audit or a migration can still read the lifecycle fact.

| Endpoint | Change | Why |
| --- | --- | --- |
| `GET /api/manager/projects` | Accepts `schedule=<state>` and `sort=schedule`; both resolve in PostgreSQL before pagination, so `total` and `totalPages` describe the whole filtered scope | A derived status filter must never cut a page and then filter it |
| `GET /api/manager/projects`, `GET /api/work/projects`, `GET /api/work/timeline`, `GET /api/work/projects/:id` | Every project and folder row carries `schedule` | List, card, detail, timeline and the read-only explorer show one derived badge |
| `PATCH /api/manager/projects/:id` | `status` may only move to `Completed` or `Cancelled`, or from `Cancelled` back to `Active`, and requires `confirmStatusChange: true`. `Planned`, `Active` and `On Hold` are refused with `INVALID_TRANSITION` (409); archive keeps its own confirmed action | The schedule states are derived, so an ordinary edit must not write a lifecycle guess |
| `POST /api/manager/projects` | An omitted `status` defaults to `Active`; any explicit status other than `Active` or `Planned` is refused. An omitted `dashboardVisibility` defaults to `INTERNAL` (V2 policy change); an explicit `RESTRICTED` is respected | A new project starts as ordinary work, and a terminal state must go through its workflow |
| `GET /api/manager/reports/workload/tasks` | `WorkloadTaskRow` carries `displayStatus` alongside the stored `status`, plus the optional `scheduleMissing` detail | A completed or cancelled row must never be presented from the date alone |

`displayStatus` uses the one canonical `taskScheduleStatus` rule (done, cancelled, an unusable
interval, late, planned, in progress, start not set, no dates). Every task-shaped DTO -
`Task`, `TaskSummary`, `WorkloadTaskRow`, `MyWorkItem`, `TimelineTaskRow`, `EmployeeTask` - carries
it from the same domain call, together with the `scheduleMissing` detail (`NONE`, `START`, `FINISH`,
`BOTH`). The workload drill-down scope still excludes cancelled work and container tasks, and its
overdue figures still count open leaf work only.

## One task schedule display status — 2026-11-05

| Endpoint | Change | Why |
| --- | --- | --- |
| `GET /api/manager/tasks`, `GET /api/work/tasks` | `displayStatus` accepts the full set `PLANNED`, `IN_PROGRESS`, `OVERDUE`, `START_NOT_SET`, `DATES_NOT_SET`, `INVALID_DATES`, `DONE`, `CANCELLED`. Existing values keep their meaning; the new ones are additive | The filter must offer every state the badge can show |
| `GET /api/manager/tasks`, `GET /api/work/tasks`, `GET /api/manager/tasks/:id`, `GET /api/work/tasks/:id` | `TaskSummary` and `Task` carry `displayStatus` and the optional `scheduleMissing` | A list row and a detail page describe the same task identically |
| `GET /api/employee/my-work`, `GET /api/employee/snapshot`, `GET /api/work/timeline` | `MyWorkItem`, `EmployeeTask` and `TimelineTaskRow` use the same enum and detail | One rule for managers and employees |
| `GET /api/manager/overview`, `GET /api/manager/reports/workload*` | Unchanged figures; the rows they return carry the same state | Counting stays `TaskScope`; only the presentation is unified |

`displayStatus` is derived, never accepted from a browser, and never written. Each filter branch
mirrors the precedence of `taskScheduleStatus` and resolves in PostgreSQL before `LIMIT`/`OFFSET`,
so `total` and the rows on the page always describe the same scope. The one deliberate overlap is
a reversed interval whose finish has already passed: it is listed as `INVALID_DATES` and keeps its
place in the canonical overdue accounting, so the warning never conceals overdue work.
`workState=OPEN` still means every eligible open leaf task, which includes planned and undated work;
"open" is not a synonym for "currently in progress".

## Flat timeline display schedules — 2026-11-05

`GET /api/work/timeline` returns `scheduleStart`, `scheduleFinish`, `dateState`, and
`dateSource` for every project, folder and task row, plus a bounded `fitRange`. The all-project
request accepts `includeCompleted` and applies it to displayed schedules and fit metadata.
`fitRange` is derived before branch expansion; it never includes completion timestamps.

The endpoint remains read-only. Folder schedules are leaf-derived, container schedules exclude
their stored dates, and invalid or incomplete task schedules return an explanatory state instead
of a fabricated interval.

## Start / Finish fields — 2026-11-05

`plannedStart` remains an optional `YYYY-MM-DD` task input on `POST /api/manager/tasks`,
`PATCH /api/manager/tasks/:id`, and `POST /api/employee/my-work`. The existing required task
`deadline` remains its Finish date. Server validation evaluates a patch against the effective
stored record and rejects an explicit Start after Finish; it does not invent a start for
deadline-only historical records. A manual start remains manual when legacy duration fields are
present or a Finish is later edited.

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
| `GET /api/work/timeline` | **read-only, every signed-in role.** Without `projectId`: paged project summaries (`plannedStart`, `forecastEnd`, `committedDeadline`, `openWork`, `completedWork`, `childRange`) plus the readable `responsibilities`. With `projectId`: the project branch (`project`, `subprojects`, `tasks`, `truncated`, `taskTotal`); optional `subprojectId` is verified against that project and scopes the branch to the selected subtree. | One allowlisted timeline projection for all roles; plan, deadline and completion stay separate fields |

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
overdue, planned and undated work. `displayStatus=OVERDUE` returns the canonically overdue subset
(finish before today); a reversed interval is listed there *and* under `displayStatus=INVALID_DATES`,
so the warning never removes a row from the deadline accounting; `displayStatus=PLANNED` the work
whose start is still ahead; `displayStatus=START_NOT_SET`, `DATES_NOT_SET` and `INVALID_DATES` the
documented schedule gaps; `displayStatus=IN_PROGRESS` the work that has started and is not past its
finish; `displayStatus=DONE` is completed leaf history and does not include Cancelled or archived
work. With `tree=true`, `matchedTotal` counts matching work units while `items`/`total` may also
contain ancestor containers needed for navigation.

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
| GET | `/api/manager/overview` | `responsibilityId`, `unassigned`, `divisionId`, `upcomingDays=7\|14\|30` |
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
| GET | `/api/manager/removal/preflight` | `entityType=TASKS\|SUBPROJECTS`, `entityId` (ADMIN only); returns active child/dependency/workflow blockers, the current revision and whether retained task history requires an administrative reason |

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
| POST | `/api/manager/subprojects/:id/remove` | **Recoverable removal**: ADMIN anywhere, MANAGER inside a writable division. `revision`, `confirmed: true`, optional `reason`; sets `deleted_at`, increments the revision and writes `RECORD_REMOVED` without deleting history |
| POST | `/api/admin/subprojects/:id/purge` | ADMIN advanced permanent erasure: `revision`, `confirmed: true`, optional `reason` |
| GET | `/api/admin/subprojects/:id/restore-preflight` | ADMIN: restore eligibility, blockers and the current revision |
| POST | `/api/admin/subprojects/:id/restore` | ADMIN: `revision`, `confirmed: true`; restores the same row and identifier (`RECORD_RESTORED`) |
| POST | `/api/manager/tasks` | `idempotencyKey`, `projectId`, `taskName`, `deadline`, optional planning fields, `assigneeIds`, `dependencyIds` |
| PATCH | `/api/manager/tasks/:id` | `revision` + fields, `confirmDeadlineChange`, `acknowledgeNonWorking` |
| POST | `/api/manager/tasks/:id/approve` | `revision`, `confirmed` |
| POST | `/api/manager/tasks/:id/confirm-schedule` | `revision`, `confirmed`, `notes?` |
| POST | `/api/manager/tasks/:id/complete` | MANAGER/ADMIN: `revision`, `confirmed: true`, `note?`. Direct completion; the container, cancelled and already-done refusals still apply, and a pending completion report is withdrawn |
| POST | `/api/manager/tasks/:id/override-complete` | ADMIN: `revision`, `reason`, `confirmation: "COMPLETE <id>"` |
| DELETE | `/api/manager/tasks/:id` | Compatibility physical-purge route; ADMIN, as projects |
| POST | `/api/manager/tasks/:id/remove` | **Recoverable removal**: ADMIN anywhere, MANAGER inside a division where it holds `WORK` membership. `revision`, `confirmed: true`, optional `reason`. Stamps `deleted_at`, keeps the row and all history, queues A/B publication reconciliation. No typed phrase and no mandatory reason |
| POST | `/api/admin/tasks/:id/purge` | ADMIN advanced permanent erasure: `revision`, `confirmed: true`, optional `reason`. Every physical-erasure preflight safeguard is unchanged |
| GET | `/api/admin/tasks/:id/restore-preflight` | ADMIN: `{ entityType, entityId, name, restorable, blockers, revision }` for a recoverably removed task |
| POST | `/api/admin/tasks/:id/restore` | ADMIN: `revision`, `confirmed: true`. Restores the same row and identifier, clears `deleted_at`, increments the revision and audits `RECORD_RESTORED` |
| GET | `/api/admin/deleted-records` | ADMIN: bounded, searchable page of recoverably removed tasks and subprojects (`entityType`, `query`, `page`, `pageSize`) |
| POST | `/api/manager/members` | ADMIN for `role`/`active` |
| PATCH | `/api/manager/members/:id` | `revision` + fields (role/active ADMIN only) |
| POST | `/api/manager/responsibilities` | `name`, `divisionId` (nullable; `null` is ADMIN-only), `ownerMemberId`, `additionalMemberIds`, `colorHex`, `sortOrder`, `idempotencyKey?`; the owner and every member must hold an active `WORK` membership in that division |
| PATCH | `/api/manager/responsibilities/:id` | `revision` + fields (partial patch: an omitted field is never rewritten). A changed owner or a newly added member must be a `WORK` member of the division, an unchanged relationship is preserved, and a division change re-validates every retained relationship |
| PATCH | `/api/manager/responsibilities/:id/order` | `revision`, `direction: UP\|DOWN`, `expectedNeighborId`; neighbours come from the same status group **and the same division** |
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

The normal Delete action in All Work, Task Detail and Project Detail uses
`POST /api/manager/.../remove`; it is one explicit button confirmation and never asks for a typed
task ID or a free-text reason. The separate **Permanently erase mistaken record** advanced action
(ADMIN only, never offered to a manager) uses `POST /api/admin/.../purge` with the same no-typing
confirmation. The older physical `DELETE` routes remain compatibility aliases, are not used by the
normal UI, and have the same strict policy. A physical purge is ADMIN-only, re-runs the preflight
under a row lock inside the same transaction, and answers the stored `tombstoneId` only after
`RECORD_DELETE_PREPARED`, the row removal and `RECORD_DELETED` all succeed.

The `POST /api/manager/.../remove` commands are deliberately separate from these physical
`DELETE` commands. Recoverable removal keeps the task/subproject row and all foreign-key evidence,
stamps `deleted_at`, increments `revision`, and records the verified actor, that actor's role, the
previous and resulting state and `confirmationSource: 'BUTTON'` in `RECORD_REMOVED`. `reason` is
optional: when nobody wrote one the audit carries the application-generated description and
`userNote: null`, so the evidence never claims a person explained the action. A repeat after
success returns `alreadyRemoved: true` and does not append another audit event. Child
tasks/subprojects, active dependants, pending/processing requests, pending or leased
notification/calendar jobs still block task removal; routine edits, audit rows, deadline history,
historical assignees, decided requests and prior publication do not.

Authorization for recoverable removal is resolved twice: a request-level pre-check and the
authoritative transaction-time re-read of the actor's role, activation and division relationships
under the canonical lock order. A record in a division the caller may not read answers `NOT_FOUND`;
a readable division without `WORK` membership answers `AUTHORIZATION_DENIED`. A general manager, a
member and a viewer never pass.

`GET /api/admin/deleted-records` and `POST /api/admin/:type/:id/restore` are the ADMIN restoration
workflow. The list is one bounded page with an optional search over the record name and its project;
each row reports the type, name, project, subproject location, deletion time, the recorded deleting
actor (a display name, `null` when the audit row is missing), the recorded removal note, whether the
confirmation came from the dialog button, and the current restore availability with its blockers.
A restoration returns the *same* row and identifier: only `deleted_at` is cleared, the revision is
incremented and `RECORD_RESTORED` is appended. A removed parent, an archived or cancelled project or
a hierarchy that no longer fits is reported as a blocker instead of being repaired silently; a
completed task comes back completed, and a permanently erased record answers `NOT_FOUND` with an
explicit "cannot be restored" message.
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
| GET | `/api/work/tasks` | Server-paged active work. `projectId`, `subprojectId`, `responsibilityId`, `unassigned`, `status`, `displayStatus` (`PLANNED`/`IN_PROGRESS`/`OVERDUE`/`START_NOT_SET`/`DATES_NOT_SET`/`INVALID_DATES`/`DONE`/`CANCELLED`), `ownerMemberId`, `query`, `containerOnly`, `overdueOnly`, `includeInactive`, `tree`, `treeParentId`, paging and sorting |
| GET | `/api/work/tasks/:id` | Task detail for MEMBER/VIEWER: an allowlisted record plus the display-only `context` (project name and subproject chain, root first), assignees and children |
| GET | `/api/work/projects` | Member project explorer. `query` (project name only), `responsibilityId`, `page`, `pageSize`; each item carries `description` and the `TaskScope` counts `activeTaskCount`/`completedTaskCount`, and the page carries the `responsibilities` that group at least one readable project |
| GET | `/api/work/projects/:id` | Read-only project detail: allowlisted record (with `description` and the two counts), rollup, subprojects (with `description` and the stored `parentSubprojectId`) and the tasks of the visible branches |
| GET | `/api/work/timeline` | Read-only timeline. Without `projectId`: paged project summaries with `plannedStart`, `forecastEnd`, `committedDeadline`, `openWork`, `completedWork` and a server-derived `childRange`, plus the readable `responsibilities`. With `projectId`: the project branch (project, subprojects, tasks, `truncated`, `taskTotal`); `subprojectId` is an optional server-verified subtree scope. `responsibilityId`, `query`, `page`, `pageSize`, `includeCompleted`, `includeArchived` (managers only) |

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
| GET | `/readyz` | `200` with the schema version, or `503` `DATABASE_MIGRATION_REQUIRED` when the ledger is older than the schema this build requires (12) |
| GET | `/api/version` | Application/API/contract versions |
| GET | `/api/public-config` | Public, non-secret runtime configuration (no authentication, no session, no division scope) |

`/api/public-config` exists so one built web artifact can be deployed to several environments. It
returns exactly:

```json
{
  "appVersion": "2.0.0",
  "environment": "PRODUCTION",
  "authMode": "local",
  "googleClientId": "",
  "authConfigured": true,
  "devSignInEnabled": false
}
```

`googleClientId` is public by definition. The endpoint never returns a database URL, a session,
a service-account value, a spreadsheet identifier or any other secret. `devSignInEnabled` is
`DEV_AUTH_ENABLED && !production`, so the browser and the server agree.

Neither this endpoint nor `POST /api/session` resolves a session or a division scope, so a stale
cookie, an expired session, an account with no division grant and a database that still needs its
migration all reach the sign-in screen. When a build needs a schema the database does not have, an
undefined table/column/function is reported as `503 DATABASE_MIGRATION_REQUIRED` with a safe
message (no table, database or connection detail); the detail stays in the sanitized server log.

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

## Division (課) endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/manager/divisions` | ADMIN only; every division including retired, with `_revision` |
| POST | `/api/admin/divisions` | `name`, `sortOrder?` (allocated inside the write when omitted), `idempotencyKey?`; the identifier is generated once and never changes, and a retried request replays instead of inserting a duplicate |
| PATCH | `/api/admin/divisions/:id` | `revision`, `name?`, `sortOrder?`; a rename keeps every identifier |
| PATCH | `/api/admin/divisions/:id/order` | `revision`, `direction: UP\|DOWN`, `expectedNeighborId`; writes only the `Sort_Order` values that change inside the division status group |
| POST | `/api/admin/divisions/:id/retire` / `reactivate` | `revision`, `confirmed: true`, `reason?`; 廃止 / 再有効化, never a deletion |
| POST | `/api/admin/projects/:id/transfer-division` | `revision`, `divisionId`, `confirmed: true`, `reason?`; takes the division lock first, re-reads the actor, the project revision and the destination, and re-queries the complete assignment set inside the transaction; refuses the whole move when any relationship would become ineligible |
| GET | `/api/admin/divisions/unmapped` | ADMIN only; `page`, `pageSize` (≤ 50), `includeArchived`, `entityType=ALL\|RESPONSIBILITY\|PROJECT`, `divisionId?`, `responsibilityId?`, `projectId?`; the bounded read model of unmapped work with counts, proposal state, evidence and the backup status |
| POST | `/api/admin/divisions/mapping/preview` | ADMIN only; the same read model with an explicit selection (`divisionId?`, `responsibilityIds?` ≤ 50, `projectIds?` ≤ 50) |
| POST | `/api/admin/divisions/mapping/apply` | ADMIN only; `idempotencyKey`, `batch[]` (`entityType`, `entityId`, `divisionId`, `revision`), `confirmed: true`, `confirmation: "MAP <n> RECORD(S)"`, `reason?`; one transaction, projects before responsibilities, refused without a verified backup (`409 MAPPING_BACKUP_REQUIRED`) |

`POST /api/session` and `GET /api/session` additionally answer `divisions`
(`readable`, `writable`, `allDivisions`, `defaultDivisionId`) so the shell can offer a switch. It is
a display aid only: every request re-resolves the scope, and a `divisionId` query parameter narrows
the resolved scope or is refused (`NOT_FOUND`) when it is not authorized.

`POST /api/manager/projects` and `POST /api/employee/projects` require `divisionId`; a project
cannot be created without an active division, and a scoped responsibility must agree with it
(`VALIDATION_FAILED`). `PATCH /api/manager/projects/:id` deliberately accepts no division: moving a
persisted project is the ADMIN transfer command.

### Division repair (2026-11-10)

* `divisionId` is accepted as a narrowing filter by `/api/manager/projects`, `/api/manager/tasks`
  (list and tree), `/api/manager/overview`, `/api/work/overview`, `/api/work/tasks`,
  `/api/work/projects`, `/api/work/timeline` and `/api/manager/timeline`. One function,
  `scopedDivisionIds`, decides it: an unauthorized or unknown identifier answers `404 NOT_FOUND`
  before paging, totals, aggregates or the tree are built.
* `GET /api/manager/editor?type=…&id=…` authorizes the entity before returning it: a task or
  subproject through its project division, a project and a responsibility through their own
  division, and the member editor only for `ADMIN`. Read access alone is not an edit form
  (`403 AUTHORIZATION_DENIED` when the division is readable but not writable; `404` when it is not
  readable).
* `GET /api/manager/references` adds `divisionId` to each responsibility and `workDivisionIds` /
  `divisionNames` to each member, so a form can offer only the options eligible for the selected
  division. The server still re-validates every submitted identifier.
* `GET /api/manager/subprojects` requires a readable `projectId`, or restricts the list to the
  caller's readable divisions.
* `GET /api/manager/members/:id/profile` withholds a former assignment in a division the reader may
  not see and reports `ownership.previousHidden` instead.
* `GET /api/manager/publication` adds `divisionIsolationSupported` (`false` in this release) and
  `POST /api/manager/publication/publish` fails closed with `503 NOT_CONFIGURED` while the
  company-wide snapshot cannot enforce per-division isolation.

### Division corrections (2026-11-11)

* **Every division-scoped write re-authorizes inside its transaction.** The stored role, activation
  and division relationships are re-read and the canonical capability re-applied
  (`authorizeMutation`), so a manager demoted to `MEMBER` or `VIEWER` while keeping a `WORK`
  membership is refused (`403 AUTHORIZATION_DENIED`) even when the request started with manager
  authority. This now covers project create/edit/archive, subproject create/edit/move/archive/
  reactivate, task create/edit, assignment approval, schedule confirmation, direct completion,
  ADMIN override, reopening, request submission/decision, responsibility create/edit/reorder/
  lifecycle, division administration/transfer and member/account routes.
* **The lock order is `member-divisions` then `members:role-and-activation`** for every one of those
  paths, and no path takes the pair in the reverse order.
* **A retired division stays readable history.** `GET /api/session` answers a retired division in
  `readable` for a caller who may already read it (retained relationship or documented oversight)
  and never in `writable`; a retained grant survives an unrelated `PATCH /api/manager/members/:id`,
  while a new grant in a retired division answers `409 INVALID_TRANSITION`.
* **Ordering is deterministic.** A division or responsibility move accepts
  `direction` + `expectedNeighborId`, refuses a stale `revision` (`409 EDIT_CONFLICT`) and a foreign
  neighbour, and writes only the rows whose `Sort_Order` changes.
* **Overview reads carry the switch.** `divisionId` is part of the request and of the client cache
  key for both `/api/manager/overview` and `/api/work/overview`.
* `PATCH /api/manager/members/:id` treats `WORK → READ` as a membership removal: a downgrade with
  active work is refused `409 DIVISION_MEMBERSHIP_BLOCKED` with `details.blocked[].reason`
  `DOWNGRADE` (removal: `REMOVAL`). Revoking a `READ` grant is never blocked by existing work.

### Unmapped work mapping (2026-11-11)

Unmapped work (a blank `PROJECTS.division_id` / `RESPONSIBILITIES.division_id`) is readable by
`ADMIN` only, so the remediation is three ADMIN routes rather than a spreadsheet edit:

* **Read model.** `GET /api/admin/divisions/unmapped` and `POST /api/admin/divisions/mapping/preview`
  answer `counts` (responsibilities, projects, archived responsibilities, archived projects, tasks,
  subprojects), `items`, `page`, `pageSize`, `total`, `totalPages`, `selection`, `divisions`,
  `backup`, `batchLimit` (100) and `generatedAt`. Each item carries its `state`
  (`SUGGESTED`/`AMBIGUOUS`/`CONFLICT`/`UNRESOLVED`), the `rule` that produced it
  (`EXPLICIT`/`RESPONSIBILITY`/`COMMON_MEMBERSHIP`/`NONE`), `candidates`,
  `proposedDivisionId`, `blockers`, `unresolved`, `linkedProjects`, `revision` and `assignments`
  (active with `eligible`, and historical with `historical: true`). The read is bounded and
  paginated; it never loads the table.
* **Proposal order.** explicit target (A) → the area's division (B) → the intersection of the active
  assignees' `WORK` divisions (C). An explicit target never bypasses eligibility; a historical
  (inactive or removed) assignment is evidence and never a blocker.
* **Apply.** `POST /api/admin/divisions/mapping/apply` requires the exact phrase
  `MAP <n> RECORD` / `MAP <n> RECORDS` for the submitted batch size, a verified `backup_log` row
  newer than 24 hours (`409 MAPPING_BACKUP_REQUIRED` otherwise), the revision the screen displayed
  (`409 EDIT_CONFLICT`), and a record that is still unmapped (`409 INVALID_TRANSITION`). A
  responsibility target validates its whole area scope before the write. Projects are written before
  responsibilities, because `eh_check_responsibility_division` compares a scoped area against its
  projects. One bad record commits nothing.
* **Audit.** `PROJECT_DIVISION_MAPPED` and `RESPONSIBILITY_DIVISION_MAPPED` per mapped record, and
  `DIVISION_MAPPING_APPLIED` once per batch with the batch identifier, the reason, the backup and the
  actor. A repeated `idempotencyKey` returns the stored answer after the ADMIN re-check.
* **Visibility is automatic and account-based.** Dividing the work is the whole authorization: the
  members who already hold that division see it, a manager scoped elsewhere does not, and nothing is
  granted. Unmapped work stays invisible to every non-ADMIN, including an all-division manager.

## Record-level write availability — 2026-11-11

`GET /api/manager/tasks`, `GET /api/manager/tasks/:id`, `GET /api/manager/projects` and
`GET /api/manager/projects/:id` now return an allowlisted boolean `canWrite` on each record (and on
the detail payload). It is derived on the server from the caller's resolved division scope through
`canWriteDivision(scope, project.divisionId)` before paging - never from a request parameter and
never from the shell's selected division.

| Field | Type | Meaning |
| --- | --- | --- |
| `TaskSummary.canWrite` | `boolean?` | Whether *this* task may be written by the caller, resolved through its project's division. Absent on a read-only projection (`/api/work/*`, the employee snapshot). |
| `ProjectSummary.canWrite` | `boolean?` | The same for a project record. |
| `TaskDetail.canWrite` / `ProjectDetail.canWrite` | `boolean?` | The same for one record. |

The flag is a **presentation aid**, and the contract says so: every command still calls
`assertWritableDivision` inside its transaction, so a forged flag grants nothing. `ADMIN` gets `true`
for unmapped work because `canWriteDivision` is true for the remediation view; a `MANAGER` with
`READ` access in a division gets `false` there while the record stays readable.

The lookup costs no extra query per row: the division of every project comes from the request-local
directory read that the page already performs (`taskScope` → `directory`, memoised per request).

## Deadline window filter — 2026-11-11

`TaskListQuery` accepts `dueFrom` and `dueTo` (inclusive `IsoDate` bounds). They are applied in
`taskWhere` before paging and before every total, so an overview drilldown ("next 7 days") answers
the same question the card counted instead of filtering an already-fetched page in the browser. The
bounds are compared with the stored `due_date`; the derived schedule state stays the server's
business and is untouched.

## Request queue synchronisation — 2026-11-11

`POST /api/manager/requests/sync` is unchanged in shape; the client now sends the selected
`divisionId` on both the page-entry import and the manual control, and reads
`imported.configured/imported/failed` to decide between success, partial import, not configured and
failure. Only `imported > 0` triggers a re-read of the affected queue and derived views.

## Corrections to the interface stabilization release — 2026-11-11

`GET /api/manager/requests/:id` (ADMIN/MANAGER) returns `{ request: TaskRequest }` for one request,
resolved by id with the same division boundary as the queue: a request whose work is outside the
caller's readable divisions, or one that does not exist, is `NOT_FOUND`. It is the bounded lookup a
deep link and a conflict reload use - the queue is never scanned and no page is fetched to find one
record.

`TaskRequest` now carries an allowlisted `canDecide` (`boolean?`), resolved per request from
`canWriteDivision(scope, division-of-the-work)` before paging:

| Field | Type | Meaning |
| --- | --- | --- |
| `TaskRequest.canDecide` | `boolean?` | Whether *this* request may be decided by the caller. Absent means "not decidable" in the interface. |

It is a presentation aid: `POST /api/manager/requests/:id/decide` re-checks the division inside its
transaction, so a forged flag is refused and the request stays `PENDING`.

`POST /api/employee/requests` acknowledges with a fixed shape, now published as
`RequestSubmissionReceipt` in `packages/contracts` and validated by the client before anything is
reported as received:

```json
{ "requestId": "REQ-…", "state": "RECEIVED|DUPLICATE", "requestType": "DEADLINE_CHANGE|COMPLETION_REPORT", "taskId": "TSK-…", "submittedAt": "…" }
```

`requestId` is a non-empty identifier (≤ 64 characters). `state` is exactly one of the two
acknowledgement values. `submittedAt` is display-only: a different textual form is not evidence that
the write failed, so it is validated as a non-empty string rather than a strict instant. Any other
success payload is an unknown outcome, never a success.

The idempotency contract is unchanged: a replay with the same `clientRequestId` and the same content
returns the stored receipt (`DUPLICATE`); the same key with different content answers
`IDEMPOTENCY_REPLAY`. A refusal raised before the idempotency step (validation, eligibility,
authorization) reserves no key, so a corrected attempt may use a new identity.


## Member collaboration and manager recovery — 2026-11-13

This user-approved policy supersedes earlier statements that members cannot edit/remove existing
tasks or subprojects, and that restoration is ADMIN-only. MEMBER may edit ordinary task and
subproject fields and recoverably delete either record regardless of owner, within a WORK division
and an INTERNAL, non-archived project they may see. READ-only grants never allow a write.
MANAGER may restore tasks/subprojects in WORK divisions; ADMIN retains cross-division recovery.
Projects/responsibilities, approvals, direct completion, notification settings, permanent erasure
and completed-task reopening retain their existing separate permissions. Members do not restore.

The member opens a task detail to edit/delete it, or a project hierarchy to edit/delete a
subproject. Editors fetch fresh narrow records and revisions; saves are partial patches. A red
confirmation panel requires one explicit button and no typing. Deletion retains the row/history,
children/dependencies and existing blockers; recovery restores the same ID and status. Completed
work stays completed. Managers reach Deleted Items through the management navigation.

Server authorization is repeated under the existing division/role advisory locks. Deleted Items
filters both records and totals by writable divisions before pagination. Member edit APIs retain
project visibility and field allowlists and do not expose manager-only history or settings.
No schema change, operational migration, deployment or outbound activation is required or performed.

Member editing uses GET /api/work/editor/tasks/:id and /api/work/editor/subprojects/:id,
GET /api/work/editor/projects/:id, GET /api/work/editor/references?projectId=...,
and GET /api/work/editor/parent-options. PATCH /api/work/tasks/:id and
PATCH /api/work/subprojects/:id reuse the domain patch services with MEMBER authorization.
GET /api/work/removal/preflight and POST /api/work/{tasks|subprojects}/:id/remove reuse the
recoverable removal workflow. Ordinary fields only; forbidden workflow/settings patches refuse.
The existing /api/admin/deleted-records and /api/admin/{tasks|subprojects}/:id/restore[-preflight]
URLs are retained for compatibility but now authorize MANAGER with WORK scope as well as ADMIN.
Their historical URL prefix is not the authorization boundary.
