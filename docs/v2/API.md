# V2 HTTP API

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
| GET | `/api/manager/overview` | `responsibilityId`, `unassigned` |
| GET | `/api/manager/projects` | `responsibilityId`, `unassigned`, `status`, `query`, `page`, `pageSize`, `sort`, `direction` |
| GET | `/api/manager/projects/:id` | Record, rollup, subprojects with rollup, task summaries, milestones, phases |
| GET | `/api/manager/subprojects` | `projectId` |
| GET | `/api/manager/tasks` | `projectId`, `subprojectId`, `responsibilityId`, `status`, `ownerMemberId`, `query`, `containerOnly`, `overdueOnly`, paging, sorting |
| GET | `/api/manager/tasks/parent-options` | `projectId`, `subprojectId?`, `excludeTaskId?` |
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
| GET | `/api/manager/reports/workload` | Four weeks of utilisation |
| GET | `/api/manager/plan/preview` | `deadline`, `durationValue`, `durationUnit`, `durationBasis` |
| GET | `/api/manager/deletion/preflight` | `entityType`, `entityId` (ADMIN only) |

### Commands

| Method | Path | Body highlights |
| --- | --- | --- |
| POST | `/api/manager/projects` | `idempotencyKey`, `projectName`, `responsibilityId`, optional fields |
| PATCH | `/api/manager/projects/:id` | `revision` + changed fields, `confirmDeadlineChange`, `acknowledgeNonWorking` |
| POST | `/api/manager/projects/:id/archive` | `revision`, `confirmed: true`, `reason?` |
| DELETE | `/api/manager/projects/:id` | `revision`, `confirmed`, `reason`, `confirmation: "DELETE <id>"` |
| POST | `/api/manager/subprojects` | `idempotencyKey`, `projectId`, `parentSubprojectId?`, `subprojectName` |
| PATCH | `/api/manager/subprojects/:id` | `revision` + fields |
| POST | `/api/manager/subprojects/:id/archive` \| `/reactivate` | `revision`, `confirmed`, `reason?` |
| DELETE | `/api/manager/subprojects/:id` | As projects |
| POST | `/api/manager/tasks` | `idempotencyKey`, `projectId`, `taskName`, `deadline`, optional planning fields, `assigneeIds`, `dependencyIds` |
| PATCH | `/api/manager/tasks/:id` | `revision` + fields, `confirmDeadlineChange`, `acknowledgeNonWorking` |
| POST | `/api/manager/tasks/:id/approve` | `revision`, `confirmed` |
| POST | `/api/manager/tasks/:id/confirm-schedule` | `revision`, `confirmed`, `notes?` |
| POST | `/api/manager/tasks/:id/override-complete` | ADMIN: `revision`, `reason`, `confirmation: "COMPLETE <id>"` |
| DELETE | `/api/manager/tasks/:id` | ADMIN, as projects |
| POST | `/api/manager/members` | ADMIN for `role`/`active` |
| PATCH | `/api/manager/members/:id` | `revision` + fields (role/active ADMIN only) |
| POST | `/api/manager/responsibilities` | `name`, `ownerMemberId`, `additionalMemberIds`, `colorHex`, `sortOrder` |
| PATCH | `/api/manager/responsibilities/:id` | `revision` + fields |
| PATCH | `/api/manager/responsibilities/:id/order` | `revision`, `sortOrder` |
| POST | `/api/manager/responsibilities/:id/retire` \| `/reactivate` | `revision`, `confirmed`, `reason?` |
| POST | `/api/manager/skills` | `skillName`, `category`, `description`, `requiredLevel` |
| POST | `/api/manager/skills/assess` | `memberId`, `skillId`, `currentLevel`, `evidence`, `trainingAction` |
| POST | `/api/manager/requests/sync` | `includeDecided`; performs at most one import per call |
| POST | `/api/manager/requests/:id/decide` | `decision` (APPROVE/REJECT/RETURN), `revision`, `note?`, `confirmed` |
| PUT | `/api/manager/automation` | `revision`, `changes`, `confirmed`, `confirmation?` (LIVE / publication phrases) |
| POST | `/api/manager/automation/emergency-stop` | ADMIN |
| POST | `/api/manager/publication/publish` | ADMIN, `confirmed` |
| POST | `/api/manager/reports/refresh` | MANAGER |
| POST | `/api/manager/deletion/reconcile` | ADMIN, `confirmed`, `confirmation: "RECONCILE DELETIONS"` |

## 5. Employee / member endpoints

`MEMBER` and above may read. Creation, progress and request submission are member self-service; a
`VIEWER` is refused. The owner of a created task, the request author and the deadline/status effect
are decided on the server.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/employee/snapshot` | Published contract 1.6, `INTERNAL` projects only, `submissionEnabled` |
| GET | `/api/employee/my-work` | `page`; the signed-in member's own tasks with review state, never another member's work |
| GET | `/api/employee/my-work/projects` | Active projects and non-archived subprojects a member may file work under (id, name, responsibility name only) |
| POST | `/api/employee/my-work` | MEMBER only. `idempotencyKey`, `projectId`, `subprojectId?`, `taskName`, `description?`, `deadline`, `priority?`, `acknowledgeNonWorking?`. The owner is the verified member, the status is `Not Started` and progress is 0. A MANAGER or ADMIN uses the manager task form instead |
| PATCH | `/api/employee/my-work/:id` | `revision`, `progressPercent` (0–99), `actualHours`; own active leaf work only |
| POST | `/api/employee/requests` | `clientRequestId`, `taskId`, `requestType`, `requestedDueDate?`, `reason?`, `explanation?`, `completionNote?`; idempotent; only for work the member is assigned to |
| GET | `/api/employee/requests/mine` | The member's own requests with `submissionEnabled`; state and decision note only |
| GET | `/api/employee/requests/:id` | Receipt state only; another member's receipt is `404` |

### Completion approval rules

* A pending, rejected or returned request never changes the task.
* `APPROVE` on a `COMPLETION_REPORT` writes `Done` once.
* A task created by a member (`creationChannel: MEMBER`) is completed by an **ADMIN** decision; a
  `MANAGER` decision is refused with `AUTHORIZATION_DENIED` before the request is claimed, so the
  request stays `PENDING`. Legacy and manager-created tasks keep the ordinary manager decision.
* `REQUEST_SUBMISSION_ENABLED` must be exactly `true`; the default is `false` (closed) and the
  employee screen states that submissions are closed.

## 6. Health and public configuration

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/healthz` | Liveness |
| GET | `/readyz` | Database and schema version |
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
