# V2 Security Model

## Member add-only creation, ADMIN reopening and modal requests — 2026-11-05

**Identity and role stay server-side.** The new member commands (`POST /api/employee/projects`,
`GET /api/employee/references`) read the role from the verified session. Their bodies are strict, so
`projectOwnerId`, `status`, `dashboardVisibility`, `role` or any other extra field is a validation
failure (400) rather than a silently ignored value; the owner is always the session member. The
reopen routes require ADMIN from the same verified session and accept no role, actor or owner from
the body.

**Capability flags are presentation only.** `canCreateProject`, `canCreateSubproject`,
`canCreateTask`, `canEdit`, `canArchive`, `canDelete`, `canReopenTask`, `canSubmitCompletionRequest`
and `canSubmitExtensionRequest` decide what a screen renders. Every command re-checks the role:
- MEMBER: may create new work; may not edit, archive, delete or reopen, including its own records.
- MANAGER: keeps its management commands and is refused by the reopen routes (403).
- VIEWER: may create nothing and may request nothing.
- ADMIN: holds the reopening correction; the destructive ADMIN paths keep their own preflight.

**No manager data is reused for member screens.** The member project list and overview read
`/api/work/*` only; `GET /api/employee/references` publishes only active responsibilities' identity
and label. Restricted and archived work is resolved on the server before any count, list or filter,
and a guessed identifier answers `404`. The member overview payload contains no `nextAction`,
`dashboardSummary`, notification setting, effort value or acceptance criterion.

**A reopening is auditable and reversible only by a new event.** The original completion request,
its approval and its audit rows are retained unchanged; the correction writes one `TASK_REOPENED`
row naming the actor, reason, before/after state and the reversed completion request, and one
`PROJECT_REOPENED` row when a parent project returns to `Active`. An archived or cancelled parent is
never silently reactivated: the command refuses with an actionable explanation. A repeated delivery
replays the stored answer instead of applying a second effect.

**Request dialogs do not weaken submission policy.** The dialog is a presentation shell around the
existing `POST /api/employee/requests`; the server re-checks visibility, role, assignment (for a
deadline change), container status, lifecycle, pending state and submission availability on every
submission, even when the action was offered earlier. No note, reason or draft is written to browser
storage.

## Completion reports by any authorized reporter, and the read-only timeline — 2026-11-05

**Approved policy change (narrow, deliberate).** A verified, active `MEMBER`, `MANAGER` or `ADMIN`
may file a `COMPLETION_REPORT` for a task they can already reach, whether or not they are assigned
to it. `VIEWER` remains read-only. This replaces the earlier assigned-member-only rule for
completion reports **only**:

* Reaching a task means "assigned to it" or "the project is readable under the documented
  visibility policy". Reporting never widens visibility, so a `RESTRICTED` project the reporter
  cannot read answers `404 NOT_FOUND` exactly like an unknown identifier.
* `DEADLINE_CHANGE` keeps its rule: the verified `MEMBER`, assigned to the task. A manager cannot
  file it, and a member who is not assigned cannot either.
* Reporting is not completing and not assigning. The request row keeps `requester_name` and
  `requester_member_id` from the session; the task keeps its owner, status, progress and revision
  until a manager approves, and the approval remains a separate `MANAGER`/`ADMIN` decision with
  separation of duty (`assertCompletionDecisionRole`). A reporter cannot approve their own report.
* Every refusal is a stable code from one shared function (`submissionBlockReasons`), and the
  capability endpoint (`GET /api/employee/tasks/:id/report-eligibility`) re-reads the same
  assessment the write re-checks inside its own request; a capability answer is never authority.
* A browser-supplied `requesterName` is ignored (the session name is stored), and
  `requesterMemberId`, `reporterRole` or `ownerMemberId` are rejected by the strict payload schema.
* A receipt key owned by another person answers `NOT_FOUND` before any eligibility or idempotency
  work, so the endpoint cannot be used to probe another person's submission.
* Legacy requests imported from the transition inbox carry no verified member; the manager queue
  labels them **self-reported (not a verified account)** instead of implying verification.

**Read-only timeline.** `GET /api/work/timeline` is available to every signed-in role and has no
write path. It reuses the existing visibility policy (`INTERNAL` only for `MEMBER`/`VIEWER`,
archived work only for a manager who asks) and the one counting rule (`taskScope`); it publishes
only allowlisted display fields (names, stored dates, status, progress and leaf counts). No e-mail
address, member identifier, description, acceptance criterion, note or request text is projected.
A `childRange` is derived on the server from dated descendants and is never written back.

## Member self-service and completion approval — 2026-11-03

* A member may create a task **for themselves only**. The owner is the verified `memberId`, the
  status starts as `Not Started` and progress at 0. The request body cannot carry an owner, an
  assignee, a status, a progress value or a parent task; those fields are rejected as unknown by
  the strict schema, and no browser-supplied role, owner or actor is ever read. The path is limited
  to the `MEMBER` role — a manager uses the manager task form, which carries the assignment,
  hierarchy and scheduling controls this path deliberately lacks.
* Creation is a dedicated employee service (`apps/api/src/services/my-work.ts`). The manager task
  command keeps `MANAGER` authorization; its requirement was not lowered, so a member cannot reach
  assignment, hierarchy, project or completion powers through the new endpoint.
* A request is accepted only for work the member is assigned to (primary owner or an active
  additional assignee). The request records `requester_member_id` from the session, never from the
  body.
* A receipt is readable by its requester or a manager; another member receives `NOT_FOUND`, so the
  endpoint cannot be used to enumerate requests.
* Completion of a task created by a member requires an **ADMIN** decision. The refusal happens
  before the request is claimed, so a refused decision leaves the request `PENDING` and the task
  untouched. Legacy and manager-created tasks keep the manager decision.
* `REQUEST_SUBMISSION_ENABLED` stays off by default; the employee screen states that submissions
  are closed and offers no completion action while it is off.

## Local LAN update — 2026-11-02

[LOCAL_LAN.md](LOCAL_LAN.md) specifies the employee-ID/password mode, schema 7, optional email, first-login change, administrator reset, employee-owned progress editing, Windows launcher, durable local backup and optional Shared Drive upload. It supersedes Google-only or Linux-only assumptions below for this mode. [Verification record](LOCAL_LAN_ACCEPTANCE.md).

Scope: the whole V2 deployment — the web application, the API, the worker, PostgreSQL, the
Google integrations and the network path. This document states what is enforced, what is not,
and what has not been verified live.

## 1. Trust boundaries

```
browser ──TLS──► reverse proxy ──► API (stateless, same origin) ──► PostgreSQL
                                        │
                                        └──► outbox ──► worker ──► Google APIs
```

* The browser is untrusted. Every field it sends is data: role, actor, owner, confirmation,
  timestamp, revision and identifier.
* The API is the only writer to PostgreSQL, and the only component that decides authorization.
* The worker holds the Google credentials. The API never sends mail and never calls Google on
  behalf of a request.
* PostgreSQL is never published to the host network. Only the API and the worker reach it.

## 2. Identity

* Sign-in accepts a **Google ID token** and verifies: signature against Google's keys (fetched
  through Google's public JWKS endpoint), `iss` in `accounts.google.com` /
  `https://accounts.google.com`, `aud` equals `GOOGLE_CLIENT_ID`, `exp`/`iat` inside tolerance,
  `email_verified === true`, and the e-mail domain inside `MANAGER_WEB_ALLOWED_DOMAINS`
  (mandatory, fails closed when unset).
* The verified e-mail is mapped to exactly one `members` row. An unknown, inactive or
  role-less identity is refused with `AUTHORIZATION_DENIED`; no record is created implicitly.
* The Google **subject** (`sub`) is the stable binding: a member is matched by
  `members.google_subject` first. On the first verified sign-in an unlinked member is linked once
  and `IDENTITY_LINKED` is written to `AUDIT_LOG`; a token whose subject differs from the stored
  one is refused rather than silently re-bound. This survives an address change without trusting
  a recycled address.
* The role comes from the database at session start **and** is re-read on every request
  (`loadActorRole`), so a role change or deactivation takes effect without a new sign-in;
  deactivation also revokes the sessions.
* The deployment never accepts an identity from a header, a cookie other than the session
  token, or a query parameter.

**Development fixture.** `DEV_AUTH_ENABLED=true` is refused when `NODE_ENV=production`; it
requires an explicit `DEV_AUTH_EMAILS` allowlist and is refused for an unknown address. It
exists only for local and test runs.

## 3. Sessions

* The cookie is an opaque 32-byte random token, `HttpOnly`, `SameSite=Lax`, `Secure` in
  production, `Path=/`, and it expires after `SESSION_TTL_MINUTES` (default 720 minutes).
  Only the SHA-256 hash is stored, so a database reader cannot replay a token.
* Every unsafe request must send `x-csrf-token` matching the session's CSRF token (constant-time
  compare). A missing or wrong token is `AUTHORIZATION_DENIED`.
* When a browser supplies `Origin`, it must equal `PUBLIC_ORIGIN` or an entry in
  `ALLOWED_ORIGINS`; otherwise the request is refused, which blocks a cross-site form post.
* Sign-out revokes the row and clears the cookie. A refused request returns
  `AUTHORIZATION_DENIED`; the browser then clears its cache and shows the access-denied screen
  instead of continuing to repaint.

## 4. Authorization matrix

| Area | ADMIN | MANAGER | MEMBER | VIEWER |
| --- | --- | --- | --- | --- |
| Projects, subprojects, responsibilities, tasks: create/edit/archive/delete | yes | yes | create own subproject only (`/api/employee/subprojects`); no edit, archive or delete | no |
| Reports, workload, member profile, automation, publication, status | yes | read; changes need ADMIN for live activation | no | no |
| Read permitted work (`/api/work/*`, All Work) | yes | yes | yes, read-only | yes, read-only |
| My Assigned Work (own assignments only) | yes | yes | yes | yes, read-only |
| Create a task for oneself under an active project | not through self-service | not through self-service | yes | no |
| Create a subproject (and a nested subproject) under an active project | through the manager form | through the manager form | yes, immediately; owner is the verified member and the status is `Active` | no |
| Edit any existing task, assignment or deadline | yes | yes | no, even for a self-created task | no |
| Progress / actual-hours edit | through the manager form | through the manager form | no (removed path) | no |
| Submit a completion report | no (completes directly) | no (completes directly) | own assigned work only | no |
| Approve / reject / return a completion report | yes | yes | no | no |
| Complete authorized work directly | yes | yes | no | no |
| Completion override (`COMPLETE <id>` + reason) | yes | no | no | no |
| Role / activation change | yes, never self, never the last active admin | no | no | no |
| Responsibility owner change | yes | no | no | no |
| Login accounts: create, link, reset password | yes | no | no | no |
| Request decision (deadline / completion) | yes | yes | no | no |
| Employee snapshot, submit request | yes | yes | yes | yes (read; submission follows the switch) |

Ownership (`projects.owner_member_id`, `subprojects.owner_id`,
`responsibilities.owner_member_id`, `tasks.owner_member_id`) is accountability, never permission.
Being assigned a task grants neither a manager capability nor an edit right. There are no
per-project, per-responsibility or per-subproject ACLs.

Readability and editability are independent: a MEMBER or a VIEWER may read permitted active work,
including another employee's task, without gaining the right to change it, reassign it or report
completion for it. A new project is `RESTRICTED` until a manager selects `INTERNAL`, and only
`INTERNAL` projects reach the employee snapshot.

### 4.1 Visibility policy for the shared lists

| Reader | `/api/work/tasks`, `/api/work/tasks/:id` | `/api/work/projects`, `/:id` | `includeInactive=true` |
| --- | --- | --- | --- |
| ADMIN, MANAGER | every task, including `RESTRICTED` and archived | every project | allowed |
| MEMBER, VIEWER | only `INTERNAL`, non-archived projects/subprojects | only `INTERNAL`, non-archived | `403 AUTHORIZATION_DENIED` |

A blank or unknown `dashboard_visibility` is treated as `RESTRICTED`. A resource the reader may not
see answers `404` - never `403` - so a guessed task or project identifier reveals nothing. The
default list excludes `Done`, `Cancelled`, archived and deleted work; completed work is available
only through the explicit `displayStatus=DONE` filter. The manager routes keep their existing
behaviour and management controls.

### 4.2 Read-only projections carry no private field

The member explorer, the read-only project detail and the read-only task detail are built from
explicit allowlists, not from a stored row:

- `WorkProject` carries identity, name, `description`, responsibility name, owner *name*, status,
  priority, deadline, derived progress and the `TaskScope` counts. `dashboard_summary`,
  `next_action`, `notification_enabled`, milestones, phases and internal notes are absent.
- `WorkSubproject` carries identity, name, `description`, parent identifier, status, deadline,
  depth and the rollup.
- `TaskDetail.context` carries the project name and the subproject chain (names only).

There is no write path under `/api/work/*`: a `MEMBER` or `VIEWER` request to create, patch or
delete project, subproject or task data answers `403` on the manager route, and the read-only route
answers `404` for a method it does not serve. Hiding a button is never the control.

Personal work (`/api/employee/my-work`) is a separate boundary: it is resolved from the verified
session and shows the caller's own assignments. Because an assignment is itself the authorization,
it does not apply the `INTERNAL` filter, and it still excludes archived projects, subtasks and
cancelled work. The pending-completion indicator is filtered by the authenticated requester, so one
assignee never sees another assignee's request state.

Rules that are enforced in code **and** re-checked by a database trigger where a mistake would
be destructive: task/subproject hierarchy limits and cycles, container tasks cannot be `Done`,
`audit_log` and `deadline_history` are append-only, a project delete requires an empty
dependency graph.

## 5. Write safety

* Every manager route loads the actor, checks the role server-side and then calls one domain
  service. The body never carries an actor, a role or an owner.
* A mutation carries the `revision` the editor loaded. The update is a conditional
  `UPDATE … WHERE revision = $n`; zero rows affected produces `EDIT_CONFLICT` and the browser
  keeps the draft.
* Immutable fields (`Project_ID`, `Task_ID`, `created_at`, `original_deadline`, audit and
  migration identifiers) are rejected as `IMMUTABLE_FIELD` rather than ignored.
* Create commands require `idempotencyKey`; the key is stored with the result so a retry returns
  the first result and never creates a second record.
* One logical operation is one transaction. Confirmations (`confirmed`, typed phrases) are
  validated before the first write.
* The delete path (ADMIN only) requires an empty dependency preflight, a typed
  `DELETE <id>`, a reason, a verified backup, and it writes `RECORD_DELETE_PREPARED` before the
  row disappears and `RECORD_DELETED` after, so a crash is detectable and reconcilable. The
  preflight is repeated **inside** the deleting transaction after `SELECT … FOR UPDATE` on the
  target row, so a concurrent relationship, revision bump or publication cannot be missed between
  the check and the removal.

## 6. Employee boundary and privacy

* The employee reader receives only the published contract (18 allowlisted headers). Member
  names are display names; no e-mail address, role, skill, capacity, private description,
  acceptance criterion, note or identifier of another member is published.
* A project is published only when its visibility is exactly `INTERNAL`; blank or unknown is
  treated as `RESTRICTED`.
* Any authenticated internal identity may submit a request for any published task. There is no
  login form, password, personal token or owner-match check — the requirement is deliberately
  not an identity proof, and the UI says so.
* Submission fails closed: while the switch is loading or on error, the form is disabled.
  `REQUEST_SUBMISSION_ENABLED` must be exactly `true`.
* The browser may persist only receipt metadata (task, type, time, state, request ID). No
  explanation text and no manager data is written to `localStorage`, `sessionStorage` or
  IndexedDB; `scripts/validate-v2.js` rejects additional keys.

## 7. Notifications

* Only the worker sends mail, and only through the Gmail adapter. Defaults are `EMAIL_MODE=OFF`
  and `EMERGENCY_STOP=true`; the worker re-reads the settings inside the job, so a mid-run change
  is honoured.
* LIVE requires ADMIN, the exact typed phrase and a passing preflight; the change is audited.
* Recipients are limited to `ALLOWED_RECIPIENT_DOMAINS` and `MAX_EMAILS_PER_RUN` per run.
* Every send is a ledger row: `PENDING`/`SENDING`/`PREVIEW`/`SENT`/`DELIVERY_UNCERTAIN`/`FAILED`/
  `SKIPPED`. A dedupe key (including the reminder stage or the request id) prevents a second send
  for the same event. The attempt is claimed durably **before** Gmail is contacted; an interrupted
  or ambiguous attempt is reconciled to `DELIVERY_UNCERTAIN`, is never retried automatically, and
  only an explicit operator command (`authorize-delivery-retry`) can make it sendable again.
* A preview never consumes the live-send identity, and a capped run reports the deferred
  recipients instead of silently dropping them.
* Bodies are rendered from a fixed template from allowlisted fields; no stored text is
  interpolated as HTML and no spreadsheet content is used as a sender.

## 8. Secrets and configuration

| Secret | Location | Notes |
| --- | --- | --- |
| `DATABASE_URL` | environment / Compose secret file | never logged |
| `GOOGLE_CLIENT_ID` | environment | public value |
| Google service-account JSON (Gmail, Calendar, Drive, Sheets) | mounted file or environment | worker only; domain-wide delegation scoped to the four APIs |
| `SESSION_SECRET`, `ENCRYPTION_KEY` | environment | ≥32 bytes; rotate by restarting with a new value (sessions are then invalidated) |
| `BACKUP_ENCRYPTION_KEY` | environment | AES-256-GCM key for every backup artifact |

`.env.example` contains placeholders only. `scripts/validate-v2.js` fails on a committed
`.env`, on a real Google identifier pattern and on `.clasp.json`. Configuration is validated by
zod at boot and the process exits when a required value is missing; there is no silent default
for the database URL, allowed domains or Google client ID.

## 9. Network and hosting

* TLS terminates at Caddy (automatic certificates) or at the Cloudflare tunnel. The API binds
  `127.0.0.1` inside the Compose network; PostgreSQL has no published port.
* Security headers (from `@fastify/helmet`): a CSP that allows only same-origin assets plus the
  Google Identity host (`script-src`/`connect-src`/`frame-src`), `frame-ancestors 'none'`,
  `object-src 'none'`, HSTS, `X-Content-Type-Options: nosniff`, a Referrer-Policy, and
  `no-store` on API responses.
* Rate limiting (300 requests/minute/address by default), a 256 KB body limit and request
  timeouts bound abuse.
* The server holds no VPN dependency; exposure is controlled by the reverse proxy and, for the
  tunnel option, by a Cloudflare Access policy. See [REMOTE_ACCESS.md](./REMOTE_ACCESS.md).

## 10. Data protection

* Backups are AES-256-GCM containers with a per-artifact random nonce; the key is supplied at
  runtime and never stored with the artifact. A restore verifies the authentication tag before
  writing anything into a staging schema.
* `pg_dump` uses `--no-owner --no-privileges`; the archive is encrypted and only then uploaded.
* Retention keeps at least the most recent verified backup; a failed backup never deletes the
  previous one.
* Logs redact cookies, authorization, CSRF headers and connection strings. Metrics carry
  timings, call counts and payload sizes only.

## 11. Threat summary

| Threat | Control |
| --- | --- |
| Stolen cookie | HttpOnly, Secure, 12-hour expiry, hashed at rest, CSRF token required |
| Cross-site request | Origin allowlist + CSRF header + SameSite=Lax |
| Forged identity | ID-token signature/audience/domain verification, database role lookup |
| Privilege escalation from the browser | No role/actor/owner field is trusted; role re-read per request |
| Stale overwrite / lost update | Revision-checked conditional update, `EDIT_CONFLICT` |
| Duplicate submission | Idempotency key with stored result; inbox request ID is the permanent key |
| Container marked done | Domain refusal, request-import refusal, database trigger |
| Injection | Parameterised SQL everywhere; no string-built query; ESLint/validate check |
| Stored XSS | React text rendering; no `innerHTML`; `validate-v2` rejects sinks |
| Accidental destructive operation | Tombstone + backup + typed confirmation; no cascading delete |
| Mail storm | OFF default, emergency stop, per-run cap, dedupe, domain restriction |
| Release of private data | One allowlisted publication contract, tested in `contracts.test` |
| Backup theft | AES-256-GCM with an external key |

## 12. Limitations (stated, not hidden)

1. **Live Workspace behaviour is not verified here.** Google sign-in, Gmail, Calendar, Drive and
   Sheets were exercised against local doubles only. `docs/v2/ACCEPTANCE.md` records those rows
   as BLOCKED.
2. **The deployment ACL is the reverse proxy.** There is no per-user network rule; identity is
   the Google sign-in. A user with a valid company account can reach the login page.
3. **CSRF relies on a same-origin browser.** A non-browser client holding the session cookie and
   the CSRF token can act, exactly as in any cookie-based application.
4. **The employee receive path is authenticated but not ownership-matched.** Any internal
   account may submit a request for any published task; this is a product requirement.
5. **PostgreSQL row-level security is not used.** Authorization is enforced in one application
   layer plus triggers for destructive invariants. Direct database access is a trusted operator
   capability.
6. **Rate limiting is per process.** A multi-instance deployment should move the limit to the
   reverse proxy.
7. **No penetration test has been performed.** Local mocks are not a security verification.

## 13. Security-relevant test coverage (local, real PostgreSQL)

* `apps/api/test/api.test.ts`: unauthenticated refusal, wrong-CSRF refusal, MEMBER refusal on a
  manager read, role change taking effect, idempotent create, stale edit conflict, container
  completion refusal, publication allowlist, submission switch fail-closed.
* `packages/db/test/integration.test.ts`: append-only audit and deadline history, container
  `Done` refusal, hierarchy depth/cycle refusals, revision conflict, soft relationship removal.
* `packages/contracts/test/contracts.test.ts`: the publication contract exposes exactly the
  allowlisted fields.
