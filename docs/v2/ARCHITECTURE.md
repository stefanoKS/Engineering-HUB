# V2 Architecture

## Application shell, readable palette and first-screen productivity — 2026-11-06

**One shell, two navigation surfaces.** `App.tsx` renders a 64 px header (brand, language switch, one
account menu) and a 216 px grouped sidebar on a CSS grid; below 1100 px the sidebar is replaced by a
drawer, and `useDesktopNavigation` reads the same breakpoint the stylesheet uses so a window never
receives both. Sign-out and password change are menu items, not header buttons. The drawer closes on
navigation, on Escape and on a backdrop press, and returns focus to the button that opened it. The
route is still the single source of truth: `hashchange` drives the active entry, deep links, the Back
control and the scroll position, and the existing role filter decides which destinations exist.

**One disclosure contract.** `components/ui.tsx` exports `Menu`, a trigger plus a popup that is
removed while closed, closes on Escape (returning focus to the trigger) and on an outside press.
Task, project and personal rows use it for exceptional actions only — delete, administrator
correction, reopening, an extension request — so the primary action and Edit stay visible. A
destructive entry always sits below a `.menu-separator` with the danger tone.

**Palette and scale come from tokens.** `:root` defines the reading surface (`#F6F7F9`), text,
decorative and input borders, the burgundy primary (`#AD1535`), the ordinary link (`#245EA8`), the
danger, warning and success tones, a control height of 40 px and a 4/8/12/16/24/32 spacing scale. A
project identity colour still comes from `shared/project-colors.js` through `projectColor`, so a
project keeps its hue across navigation, filtering and sorting, and a status tone is never a project
colour. Primary buttons are filled burgundy, secondary buttons are neutral outlines, and ordinary
links are blue.

**My Work is a first screen, not a form.** The title, the total, the help disclosure and the freshness
note share one heading row; the search box and the project selector stay visible while the three
less-used filters sit behind a `絞り込み` disclosure that counts them and repeats the applied ones as
chips when closed. Explanatory paragraphs moved into `使い方`, state-specific warnings (submission
closed, a refused request) stay in the flow, and each row shows the task, its project context, the
derived status, the deadline and the primary action. `MyWorkList` items carry no assignee array, so a
personal row names the project path instead of inventing an assignment it was not given.

**Lists, detail and timeline.** Filter controls carry visible labels and the project selector offers
すべてのプロジェクト rather than 未設定; the task table uses a fixed column layout so the name takes the
remaining width and the owner, status, deadline and action columns keep one alignment.
`ProjectDetail` leads with one identity line and a five-field summary strip, puts the hierarchy
directly underneath, and keeps the schedule explanation and an empty description as compact
disclosures or one-line notes. A task detail collapses an empty deadline history and confirmation list
into a closed one-line disclosure, and the editor shows the selected assignees first with the stored
primary owner marked 主担当 and the searchable roster behind 担当者を追加. The timeline keeps one filter
row and one date row, and the two date inputs appear only in Custom mode while a preset states the
computed range.

**Nothing behind this change is new.** No endpoint, contract, migration, schema, counting rule,
authorization check or confirmation flow changed. The report that lists deadlines and task counts only
is now labelled 担当・期限レポート; its units and calculations are untouched.

## Member creation, shared presentation and corrective reopening — 2026-11-05

**Two data scopes, one presentation.** The manager list reads `/api/manager/projects` and the member
screen reads `/api/work/projects`; both map their row into the same `ProjectRowView` and render one
`ProjectTable` (identity colour, responsibility grouping, schedule badge, deadline cell, progress,
open/overdue counts, sortable headings, paging). `components/overview-sections.tsx` does the same for
the overview: KPI cards, overdue and upcoming work tables, responsibility cards and the empty state
are shared, while the manager page keeps its pending-request section and the member page keeps a
personal link. The browser never receives a manager payload and hides it, and no shared component
fetches anything itself.

**Capabilities are separate flags, not one `canManage`.** `state/capabilities.ts` derives
`canCreateProject`, `canCreateSubproject`, `canCreateTask`, `canEdit`, `canArchive`, `canDelete`,
`canReopenTask`, `canSubmitCompletionRequest` and `canSubmitExtensionRequest` from the role. A
MEMBER is add-only: it may file a project, a subproject and a task through the member endpoints, and
never edit, archive, delete or reopen a record — including one it created. A VIEWER gains nothing.
The manager screens compose `canCreateTask || canEdit` so their existing creation paths stay intact.
Every flag only decides what is rendered; the server re-checks the role on each command.

**Member creation is a narrow command.** `createMyProject` mirrors `createMySubproject`: the owner
is the verified session, the lifecycle is `Active`, the visibility is `INTERNAL`, the responsibility
must be active, the schema is strict, and one idempotency key produces one project. The same
`assertTaskPlacement` and `planTaskDeadline` rules validate a member task, so the hierarchy, cycle and
depth policies are not duplicated. Member subprojects stay flat: the server refuses a parent, and the
dialog no longer offers one.

**One authorized overview snapshot.** `workOverview` applies the visibility policy and the
responsibility filter to a `TaskScope` pass before counting, listing or cutting a top-10/top-20 list,
so a container is never counted as work, completed and cancelled work are reported separately, and an
archived branch contributes nothing. The member payload carries no private project field.

**A reopen is one corrective transaction.** `reopenTask` validates the role, revision, lifecycle,
container status, parent project, typed phrase and reason before mutating, then reverses the current
completion, optionally returns a `Completed` parent to `Active`, and writes exactly one
`TASK_REOPENED` audit row plus one `PROJECT_REOPENED` row when the parent changed. The status becomes
`In Progress` and the progress `0`, because no reliable pre-completion value exists; the derived
display status (for example late) follows from the stored dates. The original request, approval and
audit rows are never rewritten, and a repeated idempotency key replays the stored answer.

**Requests are dialogs.** One `RequestDialog` shell (built on the existing native `<dialog>` `Modal`)
serves completion and extension requests from My Work and task detail. The background is inert, the
title names the task, project, subproject and current deadline, the body scrolls, the footer stays
reachable, Escape and Cancel close it, and focus returns to the invoking control. The draft stays in
component memory, the submission is non-blocking, a duplicate cannot be sent twice, and an
unobservable outcome is reported as unknown without being retried. Finished and container tasks are
not offered a request at all, while the reason is still explained.

## One task schedule display status — 2026-11-05

**One calculation, every screen.** `taskScheduleStatus` in `packages/domain/src/task-status.ts` is
the only place that turns a task's plan into a displayed status. It reports `DONE`, `CANCELLED`,
`INVALID_DATES`, `OVERDUE` (遅延 / Late), `PLANNED` (予定), `IN_PROGRESS` (進行中),
`START_NOT_SET`, `DATES_NOT_SET`, plus which plan boundary is missing (`NONE`, `START`, `FINISH`,
`BOTH`). Precedence is: stored `Done`, stored `Cancelled`, an unusable interval, late, planned, in
progress, start not set, and finally no dates at all.

Boundaries are explicit and date-only: the start day is already in progress, the finish day is
still in progress, and late begins the day after the finish. A same-day task is planned before
that day, in progress on it and late after it. A missing start never prevents a task from becoming
late after its finish, and a missing finish is stated as a detail line rather than becoming a fake
deadline. The business date is always the Asia/Tokyo calendar date.

**Schedule state versus workflow state.** The stored `tasks.status` value is a workflow fact
(assignment, blocking, completion) and is never rewritten by the passage of time. It is shown as a
secondary detail - `WorkflowHint` for `Blocked`/`On Hold`, and the explicitly labelled
"ワークフロー状態（保存値）" row in the technical section of the task detail. A legacy `Not Started`
or `Assigned` value is never presented as the primary schedule badge, and no column, migration,
background job or audit row is added by this rule.

**The contract carries the state and the detail.** `DisplayTaskStatus` in `packages/contracts` is
the one enum (`DONE`, `CANCELLED`, `INVALID_DATES`, `OVERDUE`, `PLANNED`, `IN_PROGRESS`,
`START_NOT_SET`, `DATES_NOT_SET`). `Task`, `TaskSummary`, `WorkloadTaskRow`, `MyWorkItem`,
`TimelineTaskRow` and `EmployeeTask` carry `displayStatus` plus an optional `scheduleMissing`
detail. Every server that builds one of them calls `taskScheduleStatus` with the row's
`planned_start` and `due_date`, so the manager list, the task detail, the project hierarchy, the
overview, the timeline, the workload drill-down and the employee snapshot cannot disagree.
`TaskStatusBadge` and `DeadlineCell` are the only presentation, and a compact deadline column
(`showLabel={false}`) sits beside the status badge without repeating it.

**Filtering matches the badge.** `TaskListQuery.displayStatus` accepts the same eight values and is
resolved in PostgreSQL before pagination; each branch mirrors the precedence above, so a filtered
page describes the whole scope and cannot disagree with the badge it prints. The existing values
keep their meaning and the new ones are additive. Sorting by `status` is unchanged.

**Counting is unchanged.** `TaskScope` stays the only counting rule: open work is every eligible
open leaf task, which includes planned and undated work; done and cancelled work is reported
separately and never as overdue; a container is not extra work; a shared task counts once. "Open"
is therefore never a synonym for "currently in progress". The overdue predicate (`dueDate < today`)
is independent of the display precedence, so a task with a reversed interval is warned about as
`INVALID_DATES` while the deadline accounting still sees it - the warning never conceals it.

**Date-dependent display.** `useBusinessDate` re-reads the Tokyo date at the next Tokyo midnight
and on page focus; `useBusinessDateRefresh` in the application shell then invalidates
`DATE_DEPENDENT_PREFIXES`, so a tab left open overnight re-reads the server's date-derived answers
instead of keeping yesterday's badge. Nothing polls and nothing is written.

## Derived project status, deadline precedence and timeline bar geometry — 2026-11-05

**One derived status, one lifecycle.** `projectScheduleStatus` in `packages/domain` is the only
place that turns a plan into a displayed project status. It reports `ARCHIVED`, `CANCELLED`,
`COMPLETED` (explicit lifecycle), `INVALID_DATES` (start after finish), `LATE`, `PLANNED`,
`IN_PROGRESS`, `START_NOT_SET` or `DATES_NOT_SET`, plus which boundary is missing. Precedence is
lifecycle first, then unusable dates, then late, planned and in progress; a finish is inclusive, so
a project is not late during its own finish day. A missing start is stated as a missing start
instead of being read as "in progress". The business date is always the Asia/Tokyo calendar date.

`PROJECT_SCHEDULE_STATES` lives in `packages/contracts`; `Project`, `ProjectSummary`,
`Subproject`, `WorkProject`, `WorkSubproject` and the timeline rows carry `schedule: { state,
missing }`. The stored `projects.status` value stays, keeps its audit meaning and is never
rewritten by the passage of time; no migration, column, Script Property, background job or audit
row is added. A legacy `Planned`/`Active`/`On Hold` value is only ever an ordinary non-terminal
record, so it cannot override the badge.

Filtering and sorting by the derived state happen in PostgreSQL (`projectScheduleStateSql`) before
pagination, because a filtered page must describe the whole scope. That expression is a projection
of the same rule and cannot drift silently: `packages/db/test/integration.test.ts` compares it with
`projectScheduleStatus` for every status × start × finish combination.

**Lifecycle edits are explicit.** `assertProjectLifecycleChange` refuses an ordinary edit between
non-terminal states and refuses archive/reopen through the patch route; completion, cancellation and
reactivation require `confirmStatusChange`. `assertProjectCreationStatus` keeps a new project out of
a terminal state, so a creation request cannot bypass the completion workflow. A new project is
created `Active` and `INTERNAL`; visibility and status both remain overridable by an authorized
client, and an omitted field on a later patch preserves the stored value.

**Deadline precedence.** `DeadlineCell` requires an explicit state. It paints done first, then
cancelled/archived, then the authoritative overdue state, and only an open record falls back to the
Tokyo date comparison. A reversed interval is a warning tone, never a red current-overdue badge. A
completion after the deadline gets its own "completed late" label. The workload drill-down therefore
returns `displayStatus` next to the stored `status`, so a report row cannot be rendered from a date
alone.

**Timeline bars.** `TIMELINE_BAR` in `apps/web/src/components/timeline-dates.ts` is the single
geometry source: 12 CSS px height for every bar, a 3 px *horizontal* width for a deadline-only or
same-day point mark, and a 6 px minimum width for a very short real duration. `barGeometry` centres
a point mark in its day cell, clamps a boundary mark into the chart and returns `null` for work
that lies entirely outside the window, so no fake boundary mark appears. The bar is vertically
centred with `top: 50%` and `translateY(-50%)`, which keeps it on the row centre for a wrapped
name; the height comes from the `--tl-bar-height` token in `.timeline-screen`. The mark itself is
decorative (`aria-hidden`): the row's own Details control is the accessible target that shows the
exact dates, so nothing depends on clicking a 3 px strip. The chart keeps one bar per row - no
deadline diamond, dashed child range, completion symbol or five-symbol legend.

**Table cells stay table cells.** `display: flex` on a `<td>` removes it from the table layout and
splits the row separator. Every action cell is now `td.project-actions-cell > div.actions`, so the
cell keeps `display: table-cell` and the button row wraps inside it. The hierarchy header uses a
scoped `.hierarchy-toolbar` (centred items, wrapping, a count phrase that stays on one line) instead
of changing the shared card header for every screen.

**Date-dependent display.** `useBusinessDate` re-reads the Tokyo date at the next Tokyo midnight
and on page focus, and the project list, project detail and read-only explorer include that date in
their query identity. A tab left open overnight therefore re-reads the server answer instead of
keeping a stale badge, without polling and without a write.

## Flat folder timeline — 2026-11-05

The read-only timeline has one display schedule per row: `scheduleStart`, `scheduleFinish`,
`dateState`, and `dateSource`. Task Start/Finish are used directly; Finish-only work is rendered
as a same-day mark, Start-only and invalid records remain visible with an explanation, and no
display duration is invented. Container tasks derive from eligible descendant leaves. Folder rows
derive only from eligible leaf tasks assigned to that folder, while an explicit project schedule
remains explicit and otherwise falls back to eligible leaf work.

Legacy subproject parent links remain stored for history and archived-ancestor eligibility, but
the timeline and project detail project all folders as flat peers. New create/reparent commands
refuse nesting. No migration or database cleanup occurs.

## Responsive read-only timeline — 2026-11-05

The timeline has one inclusive Tokyo calendar-date display range in page memory. The 7-day and
2-week presets use the committed start plus 6 and 13 days; the one-month preset ends on the day
before the same date in the following month, or the end of that month when the date does not
exist. Custom preserves the current dates. Changing the start with a fixed preset recomputes its
finish; editing the finish selects Custom. Invalid drafts retain the last valid chart. Reset dates
selects the current Tokyo calendar month and Custom without changing filters or expansion; Fit
selection chooses Custom with bounded padding around known dates.

A callback ref measures the naturally sized drawing column when it actually mounts, including
after asynchronous data, and disconnects its `ResizeObserver` on replacement or unmount. Until
the measurement is positive the header says it is measuring. CSS sizes the aligned header and
rows; the measured width drives a shared pixels-per-day transform and adaptive two-level calendar
labels. The entire interval fits without a separate zoomed viewport. Zoom and pan were removed at
the user's request; ordinary browser zoom and scrolling remain. Controls are presentation-only,
issue no schedule writes, and do not persist private browser data.

Timeline visibility follows stable parent keys: a root task assigned to a subproject is a child
of that subproject for expansion, while a task with a parent in the same subproject is a child of
that task. Project-direct task roots remain visible independently of subproject expansion.

## Start / Finish schedule presentation and hierarchy timeline correction — 2026-11-05

Ordinary V2 forms now present the existing schedule fields as **Start date / Finish date**
(`plannedStart` / `committedDeadline` for projects, `plannedStart` / `deadline` for subprojects,
and `plannedStart` / `dueDate` for tasks). Finish is a scheduled deadline, not actual completion:
completion remains the separately recorded workflow history. Task Start is optional, a Finish is
still required for new tasks, and a supplied Start is stored with `MANUAL` provenance. Validation
rejects an explicit Start after Finish; same-day schedules remain valid. A duration never overwrites
a manual start, while old forecast/planned-end values remain historical fields and are not cleared
or silently adopted.

The read-only timeline traverses `parent_subproject_id`, `subproject_id`, and `parent_task_id`
using stable IDs. A branch renders each subproject and task once, retains malformed links as
bounded roots, and derives each schedule summary from task-tree roots, so project-direct work and
descendants are included without duplicate counting. No timeline path writes dates, changes a
workflow, or creates a new approval.

## Completion reporting by any authorized reporter, and the read-only timeline — 2026-11-05

**Reporting.** `canReportCompletion()` (`packages/domain/src/roles.ts`) allows a verified, active
MEMBER, MANAGER or ADMIN; `canRequestDeadlineChange()` keeps the MEMBER-only rule. One function,
`submissionBlockReasons()` (`packages/domain/src/requests.ts`), returns the ordered list of refusals
(`ROLE`, `NOT_VISIBLE`, `ARCHIVED`, `NOT_ASSIGNED`, `CONTAINER`, `COMPLETED`, `CANCELLED`,
`PENDING`, `SUBMISSION_DISABLED`), and `submissionRefusal()` maps the first one to the stable error
code. `GET /api/employee/tasks/:id/report-eligibility` and `POST /api/employee/requests` share one
assessment in `apps/api/src/services/requests.ts`, so the capability a screen shows and the write
the server accepts cannot disagree. Reaching the task means "assigned to it" or "the project is
readable under the existing visibility policy"; reporting never widens visibility, so an unreadable
task answers `404`. The reporter is written from the verified session into the existing
`requester_name`/`requester_member_id` columns and the `REQUEST_SUBMITTED` audit row (which also
records the role and whether the reporter is an assignee); no assignment, completion or approval
changes. A receipt key owned by another person answers `404` before any eligibility work.

**Personal work.** `pendingRequest` and `reviewState` in `GET /api/employee/my-work` now describe
the task, so every assignee sees a pending report whoever filed it; `GET /api/employee/requests/mine`
stays reporter-scoped. The project filter is its own paged, searchable endpoint, so no fixed slice
decides which of a member's projects can be reached.

**Parent selection.** `GET /api/manager/tasks/parent-options` applies search and paging to the
eligible candidates (self/descendant excluded, depth limit applied) and returns each candidate's
full `path`, the honest `total` and the selected option even when it is off-page. Save-time
validation (`assertTaskPlacement`) remains authoritative.

**Timeline.** `apps/api/src/services/timeline.ts` is a read-only projection for every signed-in
role. It reuses the documented visibility policy (`canSeeRestrictedWork`, `INTERNAL`-only for others,
archived hidden unless a manager asks) and the one counting rule (`taskScope`), so a project row's
`openWork`/`completedWork` are leaf counts and never raw task rows. Dates keep their stored meaning:
`plannedStart`/`forecastEnd`/`plannedEnd` are a plan, `committedDeadline`/`deadline` are commitments,
`completedAt` is the recorded completion, and no date is invented from `createdAt`, today or an
effort figure. A `childRange` is computed on the server from dated descendants inside the authorized
filter (never from the rendered page), is labelled as a child range in the UI and is never counted
as work or written back. A branch is bounded (`TIMELINE_TASK_LIMIT`) and reports `truncated` with
the real `taskTotal`; project rows are paged with a real `total`.

No migration, schema version, contract version or V1 file is involved.

## Corrective follow-up — 2026-11-03

Member creation and request idempotency scopes include the verified member ID. Request authors
come from server identity; another member cannot recover a receipt by reusing a client request ID.
Assigned work may be submitted from RESTRICTED projects without publishing it. The department-wide
role model permits self-owned creation in active projects; no new project ACL is introduced.
My Work exposes the server container flag and disables direct container actions. Successful task
creation rotates its form idempotency key; failures retain the key for safe recovery.

Drive checkpoints and reserved file IDs live beside the encrypted artifact, outside API status
payloads. No new database migration is needed; existing schema 8 and migrations remain unchanged.

## Member self-service — 2026-11-03

A member files their own work through `POST /api/employee/my-work`
(`apps/api/src/services/my-work.ts`). The path reuses the same domain rules as the manager command
(`assertTaskPlacement`, `planTaskDeadline`, `runIdempotent`, hierarchy limits, audit and outbox) but
a narrower contract, so creation never becomes a way to assign other people or to bypass review.
Migration `0008_member_created_work` adds `tasks.created_by_member_id`, `tasks.creation_channel`
(`LEGACY|MANAGER|MEMBER`, default `LEGACY`) and `task_requests.requester_member_id`; existing rows
keep their meaning. `assertCompletionDecisionRole` in `packages/domain` makes an ADMIN decision
mandatory for a member-created task's completion.

## Member subproject creation and UI readability — 2026-11-04

`POST /api/employee/subprojects` (`createMySubproject` in `apps/api/src/services/my-work.ts`) lets a
MEMBER file a subproject immediately, with no creation approval. The owner is the verified session,
the status is `Active`, `estimatedHours` stays empty and the audit row is `SUBPROJECT_CREATED`; the
browser cannot send an owner, role, status, progress or approval because `CreateMySubprojectBody` is
strict. `validateSubprojectParent` plus an ancestor walk reuse the existing four-level policy, so a
cross-project, archived or too-deep placement is refused before the single insert. The idempotency
scope is `employee.subproject.create:<memberId>` and `POST /api/manager/subprojects` stays
manager-only. Completion still requires the reviewed decision; creation is not a workflow.

`GET /api/employee/my-work/projects` now carries `parentSubprojectId` and `depth` per subproject so
the member form can show a hierarchical parent path without a second read. The My Assigned Work
screen keeps both creation forms in one collapsible panel (one open at a time), shows the deadline
in its own labelled region with overdue/today tone, and collapses the request history behind a
count summary. Overview responsibility cards show project, open, overdue and completed counts
instead of a percentage, and the Japanese label is 分野. No migration, column or Script Property was
added for any of this; schema 10 and published contract 1.6 are unchanged.

## Local LAN update — 2026-11-02

[LOCAL_LAN.md](LOCAL_LAN.md) specifies the employee-ID/password mode, schema 7, optional email, first-login change, administrator reset, employee-owned progress editing, Windows launcher, durable local backup and optional Shared Drive upload. It supersedes Google-only or Linux-only assumptions below for this mode. [Verification record](LOCAL_LAN_ACCEPTANCE.md).

Status: implemented locally. Live Workspace verification is **NOT RUN** (see
[ACCEPTANCE.md](./ACCEPTANCE.md)).

## 1. Decision summary

| Decision | Choice | Why |
| --- | --- | --- |
| Repository shape | TypeScript monorepo, npm workspaces | One language across API, worker, web and migration tooling; shared contracts prevent drift |
| Authoritative store | PostgreSQL 18 | Transactions, constraints, row locks, `FOR UPDATE SKIP LOCKED`, recursive queries |
| Database access | Plain SQL through `pg` and explicit repository modules | Every statement is inspectable and reviewable; no ORM-generated schema |
| Migrations | Ordered `.sql` files + checksummed runner with an advisory lock | Additive, reviewable, fail-closed on a changed applied file |
| API | Fastify 5, JSON envelope, zod validation | Small surface, structured errors, strict bodies |
| Web | React 19 + Vite 8 | In-memory snapshot, targeted invalidation, no browser persistence of private data |
| Background work | Worker process + PostgreSQL outbox table | No Redis/broker; every job is claimed with a lease token, and a crashed worker's lease is reclaimed without letting it overwrite a newer owner |
| Production artifacts | `tsup` bundles each application, internal `@eh/*` workspaces included | One self-contained artifact; the runtime image needs no TypeScript sources and the documented `node dist/…` command actually starts |
| Public browser configuration | `GET /api/public-config` | One built web artifact per environment; the OAuth client ID is not compiled in |
| Email / Calendar / Drive / Sheets | Google REST APIs through adapter interfaces | Testable doubles; nothing external runs in automated tests |
| Remote access | Company VPN **or** Cloudflare Tunnel + Access | Two documented paths; no automatic DNS or tunnel creation |

V1 (Google Apps Script + Sheets) remains in the repository unchanged as historical evidence and
for the migration source. Its gates and benchmark records are historical and are never rewritten.

## 2. Runtime topology

```
Browser (React SPA)
   │  HTTPS, same-origin cookies, CSRF header
   ▼
Reverse proxy (Caddy) ── optional external path: Cloudflare Tunnel + Access
   │
   ├── apps/api   Fastify: sessions, authorization, reads, commands
   │        │
   ├── apps/worker  outbox loop: mail, calendar, backup, export, publication
   │        │
   ▼        ▼
PostgreSQL 18 (authoritative)  ── hourly pg_dump ──► AES-256-GCM ──► Google Drive
                               └─ one-way reporting export ─────────► Google Sheets
```

The interactive application performs ordinary reads, creates, edits, approvals, navigation and
permission checks against PostgreSQL and never calls Apps Script or Sheets.

## 3. Packages

| Path | Responsibility |
| --- | --- |
| `packages/domain` | Pure business rules: hierarchy, eligibility, counting, progress, planning, requests, completion, notifications, publication allowlist, project colours |
| `packages/contracts` | zod schemas for enums, DTOs, screens, mutations and the published contract |
| `packages/db` | Pool, per-request context, migration runner, row map, repositories, demo seed |
| `packages/i18n` | Dictionary generated from the V1 translation source (970 keys, ja/en parity) |
| `apps/api` | Fastify application, session/CSRF, routes, services, developer-only fixtures |
| `apps/worker` | Outbox loop, transports, backup/restore helpers, scheduler |
| `apps/web` | React screens, query cache, localization, project accents |
| `tools/migration` | Inventory, export, dry run, import, reconciliation |
| `deploy` | Docker Compose, Caddy, cloudflared example, operations scripts |
| `docs/v2` | Architecture, API, migration, security, performance, Workspace, self-hosting, remote access, backup, operations, acceptance, feature parity |

## 4. Request lifecycle

1. `onRequest` assigns a correlation ID and a **per-request** database context (its own query
   counter), so `meta.dbCalls` describes this request only.
2. `preHandler` resolves the session cookie (stored as a SHA-256 hash), loads the member row and
   builds the verified identity. A mutation additionally requires the session CSRF token and,
   when a browser sends `Origin`, an allowed origin.
3. The route validates the body/query with zod (strict objects), calls a service, and returns
   `{ ok: true, data, meta }` or `{ ok: false, error: { code, message, details, retryable,
   correlationId } }`.
4. Authorization is re-checked in the service (`requireRole`). A browser-supplied role, actor or
   owner is never authority; strict schemas reject such fields outright.

## 5. Transaction and concurrency model

* One logical operation is one transaction: record change + relationship change + approval
  invalidation + history + audit + outbox row commit together.
* Revision-checked updates: `UPDATE … WHERE id = $1 AND revision = $2` and no row means
  `EDIT_CONFLICT`; the browser keeps the draft.
* `SELECT … FOR UPDATE` serializes two decisions on the same request.
* Cross-record invariants are enforced twice: in the domain layer before the write and by
  PostgreSQL triggers (`tasks_hierarchy_guard`, `eh_subproject_guard`, dependency cycle guard,
  container-completion guard) so a concurrent writer cannot slip a cycle in.
* Hierarchy reparenting takes a targeted advisory lock per aggregate, not one global lock.
* `FOR UPDATE SKIP LOCKED` on the outbox lets several workers run concurrently.

## 6. Read model and caching

* The browser keeps one authorized snapshot plus narrow page reads; it never persists private
  manager data (no `localStorage`/IndexedDB for manager state).
* The query cache deduplicates in-flight reads, serves cached data and revalidates in the
  background, and invalidates by prefix. Invalidation increments a generation, so a read started
  before a save cannot paint or be joined by the newer refresh.
* Mutations return the authoritative record; the screen invalidates the narrowest datasets
  (task list + task + project + aggregates) instead of reloading the whole snapshot.
* Hash navigation records only routes created during the current page lifetime. Detail Back uses
  browser history only when the previous entry is a known, role-authorized application route;
  otherwise it replaces the URL with Projects or All Work. Route filters, expanded hierarchy
  nodes, pagination and scroll offsets are kept in page memory only, never browser storage.
  Overview KPI links encode a validated `workState`/`displayStatus` and responsibility scope in the
  existing hash query. All Work applies those values atomically, resets incompatible project,
  search and page state, and records the full query-bearing route so Back/Forward returns to the
  same list.
  One shared `BackButton` renders as the first child of the detail content column; `.back-button`
  keeps it compact and self-aligned (`align-self: flex-start`, no left padding), so its arrow starts
  exactly at the page-title left margin at every viewport width instead of stretching to the column
  width and centring its label.
* The API memoizes table reads for the lifetime of one request (`ReadCtx`), so assembling a
  screen does not re-read a table. There is no cross-user server cache of the private data.
* Overview's 7/14/30-day deadline period is resolved from the Asia/Tokyo business date on the
  server. Upcoming and overdue projections apply leaf-work, active hierarchy and responsibility
  predicates in PostgreSQL before their 20/10-row limits. The same task repository predicates back
  All Work `OPEN`, `OVERDUE` and `DONE`; tree ancestors remain navigation rows and never increase
  `matchedTotal`.
* The date-based workload report follows the same rule with SQL aggregation instead of an
  in-memory computation: `packages/domain/src/workload-period.ts` resolves the period and its
  buckets, and `packages/db/src/repo/reports.ts` counts inside PostgreSQL over one shared
  `scope` CTE (open leaf work in a working project and whole subproject chain, attributed through
  the effective assignment set). Date filtering happens before rows leave the database, the
  drilldown is paginated, and the browser receives counts it cannot recompute differently. The
  report carries no hour, capacity or utilisation figure, because the task system no longer
  requires an estimate and a missing estimate is never zero workload.

## 7. Background processing

```
command ──► outbox_jobs (PENDING, dedupe_key) ──► worker claim (LEASE) ──► handler
                                                     │
                                     ┌───────────────┼───────────────┐
                                     ▼               ▼               ▼
                                  Gmail API      Calendar API     pg_dump + Drive
```

* Lease claim, bounded retries with backoff, permanent-failure and uncertain-outcome states.
* A notification's identity is what it announces (kind, task, recipient, deadline, assignment
  version), so a retry cannot send a second mail for the same event.
* An ambiguous provider outcome becomes `DELIVERY_UNCERTAIN` and is **never** retried
  automatically.
* The save path only enqueues; it never waits for Gmail, Calendar, Drive or Sheets.

## 7.1 Administrative removal versus physical purge

Ordinary ADMIN removal is a revision-checked transaction that locks the task/subproject, rechecks
active blockers, sets `deleted_at`, increments `revision` and appends `RECORD_REMOVED`. The row,
stable ID, assignees, requests, deadline history and audit evidence remain in PostgreSQL. Active
queries and workers already require `deleted_at IS NULL`, so removed work cannot be edited,
assigned, requested, reminded or republished. Task removal queues a deduplicated
`publication.run`; the worker rebuilds and commits the next allowlisted A/B snapshot.

All Work and Project Detail share the same logical-removal dialog and invalidate All Work, project
structure, My Work, Overview, workload and employee projection cache keys after success. The
separate **Permanently erase mistaken record** action loads the physical preflight, displays its
exact erase plan, and requires a reason plus typed `DELETE <id>` confirmation before the ADMIN
`POST /api/admin/.../purge` command. Compatibility `DELETE` routes retain the same service policy
but are not used for normal deletion.

Physical eligibility is evidence-based. Project `INTERNAL` visibility is not evidence that a
particular task was published; stored A/B snapshot rows are checked instead. Completed state,
approved completion requests and audited actual-hours changes are protected work. A nonzero
uncorroborated legacy hours value is classified separately and retained because its provenance
cannot be proven. Routine create/edit/removal audit rows may coexist with a purge, but operational
or unknown audit actions, children, incoming foreign keys and workflow evidence block it. The
transaction explicitly removes only the enumerated task-assignee and outgoing-dependency rows,
writes the durable tombstone and audit records, and then removes the task. No migration is needed.

### Responsibility area lifecycle

A responsibility area has three states the manager controls: edit, retire (a status change that
keeps every project, task and history row) and, for an unused area, permanent deletion. The
manager table lists active areas only and the `廃止済みを表示` preference - held in route memory, not
in the database - reveals retired ones; retiring an area therefore only moves the row between the
two views and the Overview cards and project filters keep resolving the stored identifier.

`DELETE /api/admin/responsibilities/:id` is the only removal path for an area, and it reuses the
tombstone contract of `record_deletions` (schema 11 extends its entity allowlist). Any project row
that still names the area - active, archived or logically deleted - refuses the deletion with
`PROJECTS_REFERENCED`, as do a stored publication reference and a pending worker job; the manager
moves the projects first or retires the area instead, and nothing is reassigned or cascaded. The
only administrative relationship is `responsibility_members`: its rows are snapshotted into the
tombstone and then removed, while append-only `audit_log` rows stay. The deletion re-runs the
preflight under a row lock inside the deleting transaction and answers the tombstone ID only after
`RECORD_DELETE_PREPARED`, the row removal and `RECORD_DELETED` all succeed.

## 8. Published employee projection

* One allowlist in `packages/domain/src/publication.ts` produces the only fields that leave the
  private database.
* Only projects whose `dashboard_visibility` is exactly `INTERNAL` are published.
* The snapshot is written into the inactive A/B slot, verified (header set, row count, SHA-256 of
  the canonical JSON) and committed by a single metadata write; a failed run leaves the previous
  snapshot readable.
* The employee reader never touches the management tables and never publishes request text; only
  a boolean pending indicator is included.

## 9. Versions

Application (`APP_VERSION` / `@eh/contracts`), database schema (`schema_migrations` max version),
API version, publisher version and published contract (`1.6`) are separate values and are reported
separately.

## 10. Deliberate non-goals

* No Kubernetes, no Redis, no message broker, no paid SaaS requirement.
* No workload-overlap validation, capacity blocking or automatic reassignment.
* No second bootstrap route, no browser write path outside the documented commands.
* No claim that a single office server is highly available.

## Branding assets

The supplied logo files live in `apps/web/public/branding/` and are referenced by absolute URL
(`/branding/companyLogo.png`, `/branding/designTeam.png`); Vite copies `public/` unchanged into
`dist/branding/`. The sign-in card shows only the company lockup (`company-login-logo`); the
authenticated shell shows only the department lockup (`design-team-logo`) in place of the former
`brand-symbol` box, for every role, next to the application name. Both images keep their intrinsic
aspect ratio (`width`/`height` auto on one axis with `object-fit: contain`), so they are never
cropped or stretched; the files themselves are not modified. The header logo shrinks below 850 px,
and the header wraps instead of hiding the language switch, identity, role or sign-out controls.
Assets and styles carry no data, authorization or publication meaning.

## Expandable task hierarchy

The task screen pages root tasks and loads bounded child pages through the same authorized manager
endpoint. A recursive SQL ancestor projection is bounded by the domain MAX_TASK_DEPTH. It resolves
search/filter ancestry before paging. Parent_Task_ID is unchanged; collapse changes only page-memory
expansion state. Child queries share the normal task-cache invalidation prefix and reopening uses
cached rows. Nested expansion survives collapsing and reopening its parent within the screen.

## Member project explorer (read-only browsing)

`MEMBER` and `VIEWER` reach projects through one read-only screen (`WorkProjectsScreen`) backed by
`GET /api/work/projects`. It is a separate component from the management `ProjectsScreen`, so the
member tree never imports the manager list, the archive/edit/delete controls or the create form.
The explorer, the project detail and the task detail all read `/api/work/*`; `routeAllowed()` and the
post-sign-in redirect accept `projects` for both reader roles, and a direct `#/projects` address
renders the explorer instead of bouncing to My Work.

* One bounded page per request. Search (`query`) and responsibility (`responsibilityId`) are
  resolved by the server before paging and before the top-N cut; the page reports its total.
  The responsibility list in the response is limited to areas that group at least one readable
  project, so the filter cannot disclose an area with no visible work.
* Cards reuse the stable `Project_ID` accent and show only allowlisted fields: name, description,
  responsibility name, owner name, status, priority, deadline, derived progress and the two
  `TaskScope` counts (`openWork`, `completedWork`). A container task is never counted, and completed
  work is never mixed into the open figure.
* Description rendering uses React text with `white-space: pre-wrap`; a card clamps the preview and
  the detail page shows the full text. An empty description renders `説明なし / No description`
  instead of a blank panel. Subproject descriptions use the same preview plus an in-place
  `詳細を見る / View details` toggle, so a short description never needs its own page.
* Project detail and task detail keep the existing `ProjectHierarchy` and `ProjectDetailScreen`
  components; a reader gets no edit, create, delete, reassign or deadline control, and the task
  detail renders no manager-only history or schedule section at all. A breadcrumb
  (`プロジェクト / project / subproject path / task`) links only to records the reader could already
  open.
* Cache keys stay separated: the member list uses the `work/projects` prefix and the detail
  `work/project/<id>`, while manager reads keep `manager/*`. Nothing private is written to the
  browser: search, filter, page and expansion state live in page memory only.

`subprojects.description` is a schema-9 additive column (`TEXT NOT NULL DEFAULT ''`). The manager
form edits it; the read-only projection copies it into `WorkSubproject.description`; a partial
`PATCH` that omits it keeps the stored text.

## Task detail context

`GET /api/manager/tasks/:id` and `GET /api/work/tasks/:id` share one `TaskDetail` contract that adds
`context` (project name and the subproject chain, root first). The chain is one bounded recursive
query (`depth < 8`) over `subprojects`, carrying names only - no owner, deadline or private column -
so both the manager and the read-only task screen can show the same breadcrumb.
