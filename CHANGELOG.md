# Changelog

## V1.6.2 — 2026-10-28

Corrective reliability release after an audit of V1.6.1. Every V1.6 and V1.6.1 capability is kept; no
schema, migration, permission, trigger, mail, Calendar, publication or feature change was added. Schema
stays **7** and the published employee contract stays **1.5**.

### Request integrity

- **`alreadyApplied` was removed.** It inferred an application from the task state (`Done`/`100 %`, or a
  `Due_Date` equal to the requested one), so an ADMIN override, a separate approval or a manual edit could
  be recorded as an employee approval, and it also bypassed the revision check. Evidence now comes from a
  request-specific journal in `AUDIT_LOG` — `REQUEST_DECISION_PREPARED` → `REQUEST_EFFECT_APPLIED` →
  `REQUEST_DECIDED` — keyed by `Request_ID`, so schema 7 needs no new column or table.
- **A changed task is stale even when the target matches.** The revision and original-deadline checks are
  no longer skipped, and a completion report or deadline request whose end state another operation produced
  becomes `STALE` instead of claiming it.
- **Ambiguity is explicit.** A `PROCESSING` approval with no request-specific evidence is never
  auto-approved and never applied twice. It stays open, one `REQUEST_RECONCILE_REQUIRED` row records why,
  and `previewRequestDecisionReconciliation` / `reconcileRequestDecision` (`CONFIRM_APPLIED` or
  `MARK_STALE`, confirmation `RECONCILE REQUESTS`) settle it without writing the task.
- **A guarded retry still works.** When the recorded failure and an unchanged revision prove the mutation
  never landed, the retry applies the effect once.

### Audit reliability

- **`REQUEST_DECIDED` is written once per accepted decision.** A decision whose audit write failed is
  repaired by repeating the same decision: only the missing record and the inbox mirror are completed, the
  reviewer, timestamp and acceptance value are kept, and the task is not written again. The former
  expectation of two `REQUEST_DECIDED` rows for one accepted decision was replaced with this rule.
- **The ADMIN completion override is journaled.** `COMPLETION_OVERRIDE_PREPARED` is written before the
  mutation, `COMPLETION_OVERRIDDEN` carries the same `Operation_ID`, and `reconcileCompletionOverrides`
  (`RECONCILE COMPLETIONS`) appends only the missing final record for a task verified `Done`/`100 %`.
  A preparation that cannot be written aborts the correction while the task is intact.

### Dates

- **`Requests.day()` no longer drops a Sheets date.** It converted the value to text before testing
  `instanceof Date`, so a real date cell became `''`. A `Date` is now resolved in Asia/Tokyo, a text
  `yyyy-MM-dd` keeps its written day, and an impossible calendar date (`2027-02-29`) is refused instead of
  being normalized.

### Employee receipt

- **`申請状態の同期確認` / `申請状態を再同期`.** A read-only preview compares the authoritative request status
  with the mirrored `Inbox_State` and reports `一致` / `要再同期` / `受信箱に行がありません` /
  `タスクまたはプロジェクトが一致しません`. The repair writes only `Inbox_State`, needs `RECONCILE REQUEST
  INBOX`, is idempotent, refuses a conflicting identity, never recreates a missing row, and is ADMIN or
  MANAGER only (`uiRequestInboxPreview`, `uiRequestInboxReconcile`, `Requests.previewInboxReconciliation`,
  `Requests.reconcileInboxStates`).

### Manager interface

- **History attribution.** `ManagerWeb.memberProfile` returns `memberActions` (verified sign-in identity
  only) separately from `taskHistory` (which may contain other actors), each entry carrying `attribution`
  (`MEMBER` / `OTHER` / `UNVERIFIED`) and `verified`. The profile renders `本人の操作履歴` and
  `担当業務の変更履歴` as separate sections; `activity` remains the documented alias of the task history.
- **Area switching.** `ManagerWeb.overview(actor, {areas:false})` omits the area selector and cards the
  browser already holds; the client asks for that shape once it has the snapshot, renders a scoped loading
  state instead of the previous area's figures, and keeps the stale-response guard.

## V1.6.1 — 2026-10-29

Corrective release after an audit of V1.6. Every V1.6 capability is kept; no schema, migration,
permission, trigger, mail, Calendar or publication change was added. Schema stays **7**, the published
employee contract stays **1.5** (the reader additionally accepts **1.4**).

### Correctness

- **One counting rule (`src/TaskScope.gs`).** Responsibility cards and overview KPIs counted container
  tasks while every rollup counted leaf work only. Containers are organisation; open/overdue counts are
  open leaf work in active work; completed work is reported separately (`web.areaWorkItems`, policy
  labels published with the DTO).
- **Scope before paging.** `ManagerWeb.overview(actor, input)` and `bootstrap(actor, input)` accept
  `responsibilityId` / `unassigned`, filter the project list before `page()`, derive the KPIs, the
  seven-day window and the top-five `upcoming` list from that scope, and return `counts` + `scope`. The
  browser no longer re-filters a 20-row page or a five-row cut.
- **Conversion guard.** `TaskTree.hasRecordedWork` also considers an assignment approval, a schedule
  confirmation, a recorded request and deadline/work history, so a task with history can no longer be
  turned into a container. `Parent_Task_ID` joins `Tasks.assignmentFields`, so reparenting bumps
  `Assignment_Version` and clears a stale approval.

### Completion workflow

- A `COMPLETION_REPORT` for a container task is refused on inbox import (`CONTAINER_TASK`), counted in
  the import result (`containerRejected`, audit `REQUEST_CONTAINER_REFUSED`) and refused before the
  request is claimed, so it can never be left in `PROCESSING`.
- A failure while applying an approval is recorded (`REQUEST_APPROVAL_FAILED`), the claim stays
  `PROCESSING` on purpose, and the manager is told to retry; the retry resumes through
  `alreadyApplied` without a second effect.
- A failed inbox mirror is recorded (`INBOX_MIRROR_FAILED`) instead of only logged.
- The employee request service refuses a container completion report (`REQUEST_CONTAINER_TASK`) and the
  dashboard hides the action with the reason.

### Deletion and audit

- `Deletion.remove` writes `RECORD_DELETE_PREPARED` (full row, reason, actor, backup) **before** the row
  is removed and reports success only after `RECORD_DELETED` exists; a tombstone failure raises an
  explicit reconciliation error.
- `Deletion.reconcile` / `reconcileDeletions('RECONCILE DELETIONS')` finalizes an interrupted removal,
  appends only the missing record for a row that is verifiably gone, and never deletes anything.
  `ADMIN` plus the exact confirmation, exposed as the `deletionReconcile` API action.
- A prepared identifier is reserved (`isDeletedId`), and nested tasks, schedule confirmations, requests
  and deadline history now block a removal.
- Cascading removal was removed (server + panel); the project delete control is rendered for `ADMIN`
  only.

### Member history

- `ManagerWeb.memberProfile` reads ownership from the append-only audit evidence as well as the current
  owner, so reassigned work stays in the history of the member who did it; former assignments show the
  current owner and a limitation is stated when no audit evidence exists.
- `Tasks.update` writes `TASK_REASSIGNED` with both owners on an owner change.

### Compatibility and deployment

- `dashboard-app/DataService` reads contracts **1.4 and 1.5**, each through its own exact header row;
  unknown and mixed contracts still fail closed. `requestTarget` exposes `container` and `contract`.
- The publisher uses one `DATE_FIELDS` list for normalization and for the text column format, so
  `completedAt` is published as `yyyy-MM-dd` text.
- `docs/V1_6_DEPLOYMENT_RUNBOOK.md` names `createDatabaseBackup()`, pushes the head code before the
  migration runs, keeps the deployment untouched during it, documents the dual-contract behaviour and
  adds the deletion-recovery step.

### Evidence

- Six checkgates `docs/checkgates/V1_6_1_GATE_1..6.md`, `V1_6_1_VALIDATION.txt`,
  `V1_6_1_PERFORMANCE.json`; 500 tests. Live Workspace criteria remain **BLOCKED / NOT_RUN** and
  `docs/PRODUCTION_READINESS.md` stays **NOT APPROVED FOR PRODUCTION**.

## V1.6 — 2026-10-28

Responsibility-centered engineering management. Schema **7** (one additive, approval-gated migration),
employee contract **1.5**, no execute-as change, no trigger, mail or Calendar activation, and no
automatic deployment, migration or initialization.

### Responsibilities first

- The manager home opens with a responsibility section: one card per area (colour, owner, active
  project count, open/overdue task counts, weighted progress), `すべての担当領域` and
  `+ 担当領域を追加`. Selecting an area filters projects, tasks, KPIs and upcoming deadlines from
  the in-memory snapshot with no additional read RPC.
- `RESPONSIBILITIES.Color_Hex` is validated (`#RRGGBB`) and defaults from a documented palette; a
  legacy blank value falls back to its palette position. Colour is display metadata only.
- Projects created in the manager dashboard must name an active responsibility (server-set
  requirement). The legacy Sheets sidebar keeps the V1.4 unassigned (未分類) path.

### Hierarchy

- Subprojects nest to four levels (`Subprojects.MAX_DEPTH`); a fifth level, a self parent, a
  cross-project parent and a cycle are refused, and reparenting validates the whole subtree.
- Tasks nest to three levels via `TASKS.Parent_Task_ID` (same project **and** subproject). A task
  with children is a work container: progress and completion derive from leaf work and are never
  counted twice. A task with recorded work is never silently converted into a container.
  `Dependency_IDs` stays the separate sequencing constraint.

### Completion lifecycle

- A completion report no longer marks a task done. Only a manager approval of a
  `COMPLETION_REPORT` (or an explicit ADMIN correction with a reason, the exact confirmation and
  its own `COMPLETION_OVERRIDDEN` audit row) writes Done / 100 %.
- `Tasks.complete`, `Tasks.update`, `Ui.updateProgress`, `Ui.assignTask` and the manager web form
  now refuse the transition. Existing completed rows stay valid legacy records.

### Deletion (documented exception)

- ADMIN-only permanent removal of a mistaken, empty project/subproject/task: empty dependency
  preflight, exact `DELETE <id>` confirmation, required reason, verified backup, script lock and an
  immutable `RECORD_DELETED` tombstone. Archive stays the default; anything with history refuses
  deletion. `AGENTS.md` rule 78 records the intentional exception to the earlier no-delete rules.

### Member views and the shared dashboard

- Member profile: current work, previous work with original/actual completion dates and acceptance,
  and an activity list built only from existing audit/request/deadline-history rows. Attribution
  uses owner/task IDs, never a typed requester name.
- Snapshot contract **1.5** adds `responsibility.color`, `task.parentTaskId`, `container`,
  `reviewState` and `completedAt`. The employee app renders the nested hierarchy and an approval
  badge; report text is never published.

### Desktop design

- V1.6 tokens (surface/text/border and the documented accents), a prominent responsibility strip,
  collapsible hierarchy, text-plus-colour status badges and a deletion panel. System fonts first
  (Noto Sans JP / Inter fallbacks), no new dependency, desktop focus with normal resizing and zoom.

### Gates

- Local: `npm ci`, `npm run lint`, `npm test`, `npm run validate` and
  `node scripts/manager-web-benchmark.js` all pass; see the twelve
  [V1.6 checkgates](docs/checkgates/V1_6_GATE_12.md). Cached navigation 0.78–2.01 ms, local filtering
  0.07–1.50 ms; `bootstrap` 4.40 / 37.86 / 115.34 ms and 10.5 / 57.3 / 152.7 KB for 10/100/300 projects.
- Live Workspace verification, the DEV migration and the request round trip remain **BLOCKED /
  NOT_RUN**; `docs/PRODUCTION_READINESS.md` stays **NOT APPROVED FOR PRODUCTION**.
## V1.5.1 — 2026-10-28

Local-first performance release for the manager browser UI. No schema change (still **6**), no
employee contract change (still **1.4**), no migration, no execute-as change, no trigger, mail or
Calendar activation, and no change to the sidebar or the employee dashboard.

- **One authorized snapshot.** New read operations `bootstrap` (overview values, reference
  choices, every project summary, task count) and `taskIndex` (compact columnar task summaries).
  Both run inside the existing read context, so each source table is read at most once:
  `bootstrap` reads the same nine tables the overview did (10 range reads including the
  environment marker) and `taskIndex` reads three. Every call still re-checks identity, the
  allowed domains and `Access.requireManager()`.
- **Bounded, all-or-nothing datasets.** `TASK_INDEX_LIMIT = 3000` and `PROJECT_INDEX_LIMIT = 1000`.
  Above a bound the response reports `complete: false` and carries no rows, so the browser keeps
  the paginated `tasks`/`projects` operations instead of a silently truncated list. Task
  summaries carry only id/name/project/subproject/owner/responsibility ids, deadline, status,
  progress and priority — never descriptions, acceptance criteria, estimates or notes.
- **Client-side snapshot store.** The manager page keeps the snapshot in memory for the session
  (no localStorage/IndexedDB, no server cache), deduplicates identical in-flight reads, discards
  superseded responses, and keeps unrelated cached views when one record changes.
- **Instant navigation.** Overview → projects → tasks, page changes, sorting and filtering render
  synchronously from the store with no `google.script.run` call. The 30-second cache policy is
  replaced by a 30-second *freshness* window per dataset: cached data still paints immediately and
  is revalidated in the background.
- **Local filtering with an authoritative search.** Typing narrows by name, ID, project, owner,
  status, responsibility and deadline range; pressing 検索 still runs the server search, which also
  covers description and acceptance criteria, so a description-only match cannot be missed.
- **Fast editing.** Forms open immediately from a cached record and refresh the server copy in the
  background; an untouched draft adopts a newer revision, an edited draft keeps its original
  revision so the server refuses a stale save. A successful save patches the affected summaries,
  invalidates only the affected detail/aggregates, repaints locally and revalidates — no page
  reload — and "Saved" is shown only after the server confirms. A failed save keeps the draft and
  the error, and never retries by itself.
- **Background synchronisation.** 最終更新/更新中… indicators, manual refresh, tab focus and
  `visibilitychange` revalidation, a clear server-error banner with retry while cached data stays
  visible, and a DEV 計測/Diagnostics view (RPC count, local reuse, discarded stale responses, p50/p95,
  table reads, explicit cache clear).
- **Revocation fails closed.** `MANAGER_ACCESS_DENIED` / `Insufficient role` clears every cached
  view and unsent draft, blocks further requests and shows the access-denied message.
- **Smaller task read.** `Tasks.list` loads PROJECTS/SUBPROJECTS only for the ancestor-aware
  active-work rule, so the paginated `tasks` operation reads three tables instead of four.
- **Measured locally (mocked services, NOT live):** previous client needed 4 read RPCs for
  overview→projects→tasks and 2.58–35.97 ms per navigation; V1.5.1 needs 0 RPCs after the first
  load, with navigation p50 0.57–1.45 ms, local filter p50 0.06–1.80 ms, cached project open
  ≤0.08 ms and responsiveness under a pending request. First load carries the snapshot:
  `bootstrap` 8.5/48.7/130.9 KB and `taskIndex` 15.1/152.7/467.5 KB at 10/100/300 projects.
  Real Workspace latency, browser paint timing and native 200% zoom remain NOT_RUN.
- 406 local tests pass; benchmark raw data in `docs/checkgates/V1_5_1_PERFORMANCE.json`, ten
  V1.5.1 checkgates and updated operating documentation. **NOT APPROVED FOR PRODUCTION.**

## V1.5 — 2026-10-28

- Browser manager in the existing src project: focused authorized APIs, responsive Japanese/English navigation and complete normal manager forms.
- Execution-local read reuse, paginated tasks, draft/response ordering safety, locked revision checks and explicit report refresh.
- Request decisions hold a single reusable script lock through effect/history; ordinary subproject edits/reparent validate together.
- Publisher and employee reader normalize known Date fields without weakening A/B verification or snapshot hashes.
- Schema 6 and contract 1.4 unchanged; sidebar retained. No live deployment, migration, trigger installation or mail/Calendar activation.
- **Review correction 1 — project summary freshness.** `ManagerWeb` no longer returns the stored
  `PROJECTS.Progress_Percent` / `PROJECTS.Health` columns. `Dashboard.projectMetrics` derives
  progress (`Progress.rollup`), health (`Health.classify`), task counts and the neutral deadline
  state from current rows, grouping tasks by project once per request. Because a task save still
  skips `Dashboard.refresh`, the overview, KPI counts and project cards now change immediately
  after a save without regenerating any generated sheet. The paginated project list recalculates
  only its visible page.
- **Review correction 2 — deadline-only tasks restored.** `ManagerWebApi` requires a deadline on
  create and no longer requires a duration; the web form marks the required duration optional and
  explains that a blank duration leaves the planned start unset (unknown start). A supplied
  duration still back-plans the start through `Planning.applyTaskPlan`.
- **Review correction 3 — project card usability.** Cards show an accessible progress bar
  (`role="progressbar"`, `aria-valuenow`, visible percentage), one health pill, a deadline with
  translated remaining/overdue wording and a plain-text overdue-task count. Japanese/English
  labels come from the shared dictionary; stored text is never translated.
- 387 local tests pass; detailed benchmark, screenshots, ten checkgates and 20-case DEV verification plan. Native 200% zoom and real Workspace checks remain unverified. NOT APPROVED FOR PRODUCTION.

## V1.4.2 — checkbox-only rows are never records (database correctness patch)

No schema change (still **6**) and no dashboard contract change (still **1.4**). This is a
database correctness patch found during live Google Workspace testing; no feature was added.

- **Root cause.** Google Sheets materializes an unchecked checkbox as `FALSE`, so a freshly
  initialized table already "ends" at row 1000 with 999 `FALSE` values and no stable IDs.
  `Database.read` treated any non-empty value as a record, so `FALSE !== ''` made those 999
  preformatted rows look like 999 members and `createFirstOperatorFromEditor` reported
  `Members already exist`. The same defect affected every table with a checkbox column.
- **`Database.read`** now derives the checkbox columns from `Schema` (no hardcoded table or
  column) and ignores rows that hold nothing but blank cells and `FALSE` checkbox values. A row
  with a stable ID is always read, including records whose boolean fields are `FALSE`; `0`,
  `TRUE`, text, dates and formulas stay meaningful. A row carrying data but no stable ID is
  reported as `Malformed record in <table> at row <n>` instead of being silently dropped.
- **`Database.insert`** writes to the first reusable row (row 2 on a preformatted sheet, then
  3, …) instead of `getLastRow() + 1`. Rows holding data, custom values or formulas are never
  overwritten, and no sheet row is deleted.
- **`Migrations`** validation uses the same rule, so fresh V6 initialization and approved
  V5→V6 upgrades accept preformatted checkbox rows while still rejecting missing stable IDs,
  duplicate IDs, malformed records and missing headers.
- Regression tests reproduce the live behaviour in the project mocks (999 `FALSE` rows, first
  and second insert position, `Active = FALSE` records, preformatted formulas and custom
  columns, duplicate IDs, V5→V6 upgrade).

Nothing was deployed, migrated or emailed; live Workspace verification remains outstanding.

## V1.4.1 — simplified authorization and pre-trial hardening

No schema change (still **6**) and no snapshot contract change (still **1.4**). Every change was
validated locally with mocks and a static browser preview; nothing was deployed, migrated or
emailed, and live Google Workspace behaviour remains unverified.

Authorization (simplified)

- One role policy: ADMIN and MANAGER manage every project, subproject, task and responsibility in
  the department; MEMBER keeps own-task self-service; VIEWER stays read-only. Responsibility,
  project and subproject owners are accountability labels, never permission boundaries, so two
  managers can always collaborate on the same work.
- Removed the manager ownership check from `Access.requireProjectWrite`, `Access.canEditTask`,
  `Access.visibleTasks` and `Access.canManageResponsibility`. `Access.managedProjectIds` is gone.
- A retired responsibility is now a valid transfer destination for a manager once the extra
  confirmation is supplied; the ADMIN-only gate was an unnecessary permission error.
- Every record-mutating top-level Apps Script function (`createProject`, `updateProject`,
  `archiveProject`, `createSubproject`, `updateSubproject`, `reparentSubproject`,
  `archiveSubproject`, `reactivateSubproject`, `createTask`, `updateTask`, `reassignTask`,
  `completeTask`, `recordTaskBlocker`, `createResponsibility`, `updateResponsibility`,
  `retireResponsibility`, `reactivateResponsibility`, `reorderResponsibilities`,
  `transferProjectResponsibility`, `createMember`, `updateMember`, `deactivateMember`,
  `createIssue`, `updateIssue`, `createMilestone`, `updateMilestone`, `createSkill`, `updateSkill`,
  `setMemberSkill`, `createDatabaseBackup`) re-checks the verified role, so
  `google.script.run` and the editor cannot bypass a sidebar guard.
- Manager-only read entrypoints are gated (`listMembers`, `listResponsibilities`,
  `pendingRequests`, `healthCheck`, `validateSystem`, `analyzeManagement`), and `listProjects` /
  `listTasks` return only rows visible to the caller.
- `createMember` still accepts the first row of an empty workbook: no role can exist yet, and it
  is the documented bootstrap step. The scheduled backup calls the service directly so a
  time-driven trigger without an interactive user keeps working.

Correctness

- `Ui.updateProject` now validates the ordinary fields, the optimistic-concurrency marker, the
  responsibility destination and its confirmation, the retired-destination confirmation and the
  deadline before writing, then applies one coordinated project row update. A refused transfer no
  longer leaves earlier fields committed.
- `Responsibilities.reorder` validates every submitted ID, rejects duplicates and unknown IDs,
  preserves identity, owner, description, status and `Retired_At`, writes only the `Sort_Order`
  values that change, is deterministic on a repeated call and records the resulting order.
- Responsibility changes that touch the owner stay ADMIN-only, with a clear Japanese message.

Hierarchy and eligibility

- `Subprojects.heightOf`, `Subprojects.descendants` and `Progress.subtreeTasks` are bounded, and
  `Subprojects.archivedChain` treats a cycle as unsafe, so malformed hierarchy data raises the
  documented error instead of recursing without end.
- A task can no longer be created or moved into a subproject whose ancestor is archived. An
  existing task inside an archived branch stays editable so it can be finished or moved out.
- `Eligibility.subprojectInActiveWork` is the single ancestor-aware rule, reused by active work,
  reminders (`Eligibility.taskNotifiable`), the weekly report and the published snapshot
  aggregates. Archived work leaves the active figures exactly once, and historic progress is not
  rewritten by an archive.

Usability

- The sidebar task picker still loads a bounded, deterministic 300-task window, but now reports
  `taskTotal` / `tasksTruncated`, shows a hint with the total, and offers a server-side
  「タスク名で絞り込み」 search that reaches any task. The selected task keeps its identity through
  a re-render and a language switch.
- Organizational areas are 廃止 / 再有効化 in Japanese; 退職 / 復職 are no longer used for areas.
  The stored enum is unchanged (`Active` / `Retired`).

Documentation

- `INITIALIZE_V6` (schema 6) replaces the stale `INITIALIZE_V5` instructions in `DEPLOYMENT.md`
  and `docs/PRE_TRIAL_CHECKLIST.md`, including which migration IDs an existing V1.1/V1.2/V1.3.1
  workbook must approve.
- Simplified-authorization statements updated in `AGENTS.md`, `ARCHITECTURE.md`, `DATA_SCHEMA.md`,
  `README.md`, `README_JP.md`, `docs/MANAGER_WORKFLOW.md`, `docs/RESPONSIBILITIES.md` and
  `docs/SECURITY_MODEL.md`.
- Local test total: **328 passing**, 0 failing. `docs/PRODUCTION_READINESS.md` stays
  **NOT APPROVED FOR PRODUCTION**.
- Gate evidence: `docs/checkgates/V1_4_1_GATE_1.md` … `V1_4_1_GATE_6.md`.

## V1.4 — responsibilities, nested subprojects and UI refinement

Schema version **6** (`006_responsibilities_and_nested_subprojects`). Additive only: a new
`RESPONSIBILITIES` table, `PROJECTS.Responsibility_ID` and `SUBPROJECTS.Parent_Subproject_ID`.
No row, formula, custom column or stable ID is rewritten, no example responsibility is seeded and
every migrated project stays 未分類. Work was done directly on `main`; nothing was pushed,
deployed, migrated or emailed.

Responsibilities (担当領域)

- New configurable areas with a name, an internal description, an owner, a status and a display
  order. `RESPONSIBILITY_ID` is generated, immutable and never reused, so renaming never rewrites
  a project.
- Create, rename, describe, re-order, retire, reactivate and transfer between areas. Retirement is
  a status change: projects, tasks, milestones, approvals and history stay, the area stays visible
  in lists and filters, and its projects are marked as needing reassignment.
- Authorization lives in `Access.canManageResponsibility`: ADMIN and MANAGER administer every area
  (V1.4.1 simplified this from an owner-only MANAGER scope), MEMBER and VIEWER none. Owning an
  area never grants or restricts project access, and a transfer never changes `Project_Owner_ID`.
- A retired area cannot be chosen for a new project, and only an ADMIN may move a project into one
  (with an extra confirmation).
- Transfers are recorded in the existing `AUDIT_LOG` (`RESPONSIBILITY_TRANSFERRED` with the previous
  and new IDs, the actor and an optional reason); no parallel history table was added.

Nested subprojects

- Two subproject levels beneath a project. A blank `Parent_Subproject_ID` is a root subproject, so
  every pre-V1.4 row keeps its meaning.
- Parent/child validation: same project, no self-parent, no cycles, maximum depth two, and a
  reparent is rejected when it would push a descendant to level three instead of flattening the
  tree.
- Archiving a subproject cascades nothing; descendant tasks leave active-work figures because
  `Eligibility` walks the whole ancestor chain, and return on reactivation.
- Moving a task is explicit and confirmed, stays inside the project and keeps the task's identity,
  schedule and history. `Subproject_ID` is an existing material assignment field, so the existing
  rule increments `Assignment_Version` once and clears the stale approval.

Calculations and integrations

- Parent subproject progress is the effort-weighted rollup of its own tasks plus every descendant
  task, counted exactly once. The project rollup keeps its own grouping, so nothing is double
  counted. Unknown estimates keep the documented fallback weight and are never turned into hours.
- The management dashboard, Gantt fallback, workload/eligibility and the sanitized snapshot all use
  the same helper (`Progress.subtreeTasks`), so the numbers agree.
- The generated `DASHBOARD` sheet gained a 担当領域 column.

Manager UI

- The sidebar is reorganised into 案件 / タスク / 管理 with one section visible at a time, designed
  for the real ~300px width. Roughly used fields moved into collapsed 詳細設定 panels that keep
  their stored values. Unified colour tokens and typography.
- Every Sheets menu entry now opens the correct section and control (`Ui.show(fileName, {view,
  action})` passes template values, not globals).
- New 担当領域 panel: list with owner, open/at-risk counts and Active/Retired state, plus add,
  edit, re-order, retire (with the remaining project count) and reactivate.
- The project form gained 担当領域 (未分類 + active areas, and the current area even when retired);
  a change asks 「担当領域を変更しますか？ プロジェクトの担当者や期限は変更されません。」.
- A compact subproject tree with indentation, plus create child / edit / reparent / archive /
  reactivate actions on the selected node only.
- 申請一覧 now leads with the request type, project, task, current and requested deadline, the
  difference, the reason and the requester; IDs and timestamps are secondary and shown once.
- 自動化設定 shows the effective mail mode and the emergency stop as labelled badges and groups
  the reminder, weekly-report and integration switches under 詳細設定. システム状態 shows readable
  sections and keeps the full diagnostic dump.

Dashboard

- Responsibility filter (always visible) with a 未分類-aware label and a （退職）marker for retired
  areas; category, owner and risk moved under 詳細フィルター; active filters are listed as tags.
- Project cards and the detail view show the responsibility name; nested subprojects are indented
  under their parent and a parent reports its descendant task count.
- The request form now honours `REQUEST_SUBMISSION_ENABLED`: loading, disabled and failure states
  offer no active button and explain themselves; the backend stays the source of truth.
- Unsent request data lives in memory and survives a language switch, a client or server
  validation error and a temporary failure. A successful submission shows a receipt with the
  request ID and clears only that draft; discarding a filled form asks first.
- Snapshot contract **1.4** adds `PUBLISHED_RESPONSIBILITIES`, project responsibility labels and
  subproject parent/level/rollup fields. An older contract is rejected rather than misread.

Tests and documentation

- 45 new tests (302 total): responsibilities CRUD/authorization/transfer, hierarchy validation,
  rollups, migration 5→6 preservation and idempotency, snapshot contract 1.4, sidebar navigation,
  the responsibility panel, the request approval layout and the dashboard request form.
- New [docs/RESPONSIBILITIES.md](docs/RESPONSIBILITIES.md) and
  [docs/UI_UX_GUIDELINES.md](docs/UI_UX_GUIDELINES.md); updated schema, architecture, deployment,
  contract and workflow documentation plus the V1.4 check gates.
- `docs/PRODUCTION_READINESS.md` stays **NOT APPROVED**: no live Google Workspace verification was
  performed for this release.

## V1.3.1 — final pre-trial stabilization

No schema change: the workbook stays at version **5**. V1.3.1 makes the existing features
usable and safe for a first Google Workspace development trial. Work was done directly on
`main`; nothing was pushed or deployed.

Project creation and visibility

- The プロジェクト作成 / 編集 panel exposes 社内ダッシュボードに表示する
  (`Dashboard_Visibility`: `RESTRICTED` by default, `INTERNAL` only when a manager selects it)
  and 共有用概要 (`Dashboard_Summary`). `Description` stays private.
- Saving states 「変更内容は次回のダッシュボード公開時に反映されます。」 and the panel offers
  **共有ダッシュボードを今すぐ公開** (`uiPublishPublicationNow`), which reuses
  `SharedDashboardPublisher.publish`. Scheduled publication still requires ADMIN plus the
  typed confirmation.
- A project created without an owner belongs to the verified creating manager's `Member_ID`;
  another owner can still be chosen and is honoured by the authorization scope.

Project and task editing

- New 案件編集 / タスク編集 modes load existing values into the same form and preserve the record
  ID. `Ui.updateProject` and `Ui.assignTask` are authorized by `Access.requireProjectWrite` /
  `Access.requireTaskWrite` (moving a task to another project also needs rights on the
  destination).
- Updates are partial patches: untouched fields are never rewritten. `Project_ID`,
  `Original_Deadline`, `Created_At` and audit/migration identifiers are not editable.
- A committed-deadline change needs an explicit confirmation; a project can only be marked
  `Completed` when its tasks are all done.
- `Tasks.update` now stamps `Last_Updated` and both edit paths compare the loaded timestamp
  with the stored row, refusing a stale save instead of overwriting newer data.
- The sidebar prevents accidental double submission and no longer clears a form before a
  successful save. Switching 日本語 | English keeps every typed value.

Request handling

- Opening 申請一覧 imports new inbox rows automatically (`Ui.requests` →
  `Requests.importInbox`). The import runs under `Database.withLock`, uses the inbox request ID
  as the permanent key and counts a duplicate-ID collision as skipped, so concurrent or
  repeated opens never duplicate a request.
- An unavailable inbox is reported as a warning and the already imported requests stay
  visible; it never claims success. **申請を取り込む** remains as the manual fallback.

Safety and configuration

- `REQUEST_SUBMISSION_ENABLED` must be exactly `true` in the dashboard project for a request
  to be accepted. An absent property (the previous default) now means closed, and
  `requestSubmissionConfig()` reports the same state the page renders.
- `scripts/sync-i18n.js` and `npm run validate` compare the generated dictionaries
  newline-insensitively, so a Windows CRLF checkout no longer reports false drift.

Documentation

- New `docs/PRE_TRIAL_CHECKLIST.md` (27 steps from prerequisites to stopping the trial) and
  `docs/checkgates/V1_3_1_GATE_1..7.md`; updated README/README_JP, ARCHITECTURE, DATA_SCHEMA,
  DEPLOYMENT, AGENTS, `.github/copilot-instructions.md`, PRODUCTION_READINESS,
  MANAGER_WORKFLOW, DEADLINE_REQUEST_WORKFLOW, REQUEST_INBOX_DEPLOYMENT,
  dashboard/DEPLOYMENT and dashboard/SMOKE_TEST.
- Installation review corrections (same release, no behaviour change):
  - two clasp targets with explicit `rootDir` (`src`, `dashboard-app`) and target selection
    through `.clasp.json`; `"rootDir": "."` is prohibited, and both applications are never
    pushed into one project;
  - every argument-taking function is run through a documented no-argument editor wrapper
    (`initializeDevelopmentFromEditor`, `createFirstOperatorFromEditor`, `bootstrapFromEditor`,
    `initializeSnapshotFromEditor`, `initializeInboxFromEditor`, `backupFromEditor`);
  - the first operator member is created with `Members.create` (generated `Member_ID`) and
    verified before the bootstrap, instead of hand-writing a partial `MEMBERS` row;
  - `SHARED_DASHBOARD_REQUIRE_EMAIL` is documented as optional and as a lockout risk when the
    deployer-run web app cannot resolve the viewer address; the deployment ACL remains the
    primary control and "Anyone" is never recommended;
  - the backup recipe expects `BACKUP_LOG` `Result = VERIFIED` (not `SUCCESS`), which is what
    `Backup.createVerified()` writes;
  - `ALLOWED_RECIPIENT_DOMAINS` guidance corrected to a real domain (a placeholder blocks
    member creation);
  - one guide is primary (`docs/PRE_TRIAL_CHECKLIST.md`), cross-referenced from DEPLOYMENT.md and
    both READMEs, with new installation, existing-database upgrade and production kept separate.
  A regression test guards these installation facts.

Tests

- 257 local tests pass (`npm test`), 0 failing; `npm run lint` and `npm run validate` pass.
  New suites: `tests/v1_3_1-stabilization.test.js` (24) and `tests/v1_3_1-ui.test.js` (16,
  including a sidebar client harness). Local mocks are not Workspace verification.

## V1.3 planning, worker requests and Japanese/English UI

Schema version **5** — additive migration `005_task_planning_and_requests` (approval and
verified backup required; no existing cell, formula or custom column is modified).

Branding

- Every user-visible name is exactly `設計・開発課 管理` (browser title, dashboard heading, Sheets
  menu, settings and system screens). Internal identifiers, worksheet names and migration
  history are unchanged.

Deadline + duration planning

- The manager enters a deadline, a required duration, a unit (days/weeks) and a basis
  (working days/calendar days); `Planned_Start` is derived by the pure
  `Planning.planFromDuration`. Ranges are inclusive of the deadline and respect weekends and
  `HOLIDAYS`.
- Duration is a schedule length, not labour hours: `Estimated_Hours` is never derived from it.
- Warnings cover a missing deadline or duration, a past deadline, a past start, a non-working
  deadline and related milestones. A non-working deadline requires explicit acknowledgement
  and is never moved automatically.
- Legacy rows keep their stored start; no historical duration is inferred and no overlap
  validation, capacity limit or automatic reassignment exists.

Worker requests

- Any viewer of the internal dashboard can request a deadline change (earlier or later) or
  report completion for any published task, with a self-reported requester name, a permanent
  request ID and a receipt/status lookup.
- Submissions are validated against the active published snapshot, length-limited, rate
  limited, duplicate-guarded, serialized with the script lock and appended to a **separate**
  request inbox spreadsheet. The dashboard never receives the private workbook ID and has no
  update or delete path.
- New manager sidebar **申請一覧 / 承認待ち**: import, review and decide. Approval applies the
  requested deadline once (recalculating the derived start and invalidating stale approvals
  and schedule confirmations) and records `TASK_DEADLINE_HISTORY`; rejection and return never
  change a task. A task changed after submission makes the request `STALE`.
- Completion reports mark a task `Done`/`100%` only after manager approval, with the reported
  and accepted timestamps kept distinct.
- New switches `DEADLINE_REQUEST_EMAIL_ENABLED`, `COMPLETION_REPORT_EMAIL_ENABLED` and
  `PENDING_REQUEST_REMINDER_ENABLED` default to OFF and obey the centralized send gate.
- The snapshot contract becomes `1.3` and adds the opaque task `revision` and a boolean
  `pendingRequest`; no request text is published.

Localization

- Japanese is the default interface language; `日本語 | English` switches every static label
  immediately on the dashboard, project/task detail, request forms, manager sidebar, approval
  queue, automation settings and system status without losing the current screen state.
- The dictionary lives in `shared/i18n.js` and is copied into both projects by
  `npm run sync:i18n`; `npm run validate` rejects drift, missing keys or a missing translation.
- Stored spreadsheet text, identifiers and enum values are never translated.
- The preference is stored in `localStorage`; no login, password or `UserProperties` is added.

Documentation

- New: `docs/UI_LOCALIZATION.md`, `docs/TASK_DURATION_POLICY.md`,
  `docs/DEADLINE_REQUEST_WORKFLOW.md`, `docs/REQUEST_INBOX_DEPLOYMENT.md` and
  `docs/checkgates/V1_3_GATE_1..7.md`.


## V1.2 shared dashboard (employee-facing read-only web app)

Schema version **4** — additive migration `004_shared_dashboard` (approval and verified
backup required; no existing cell, formula, custom column or ID is modified).

Shared dashboard

- New separate read-only Apps Script web app (`dashboard-app/`) for every authorised company
  viewer: Japanese-first portfolio, project drill-down, task drawer, search, filters and
  Asia/Tokyo deadline wording (`完了` / `本日期限` / `X日超過` / `期限未設定`).
- `doGet()` serves a single page; the only server functions are `dashboardPortfolio`,
  `dashboardProject` and `dashboardTask`. There is no write path, no mail, no Calendar and no
  trigger API in that project.
- Deployment restricted to the Workspace domain and executed as the deployer
  (`appsscript.json`), with read-only spreadsheet scope; `npm run validate` enforces both.

Publication

- `SharedDashboardModel` builds explicit allowlisted DTOs from operational rows; source rows
  are never forwarded and e-mail addresses, skills, HR capacity, logs and settings are
  excluded by construction.
- `SharedDashboardPublisher` copies the projection into a sanitized snapshot workbook using
  two data slots (A/B) plus `PUBLISHED_META`. Data is written to the inactive slot, verified
  (headers, row counts, SHA-256 content hash) and only then committed by one metadata write,
  so a failed publication leaves the previous snapshot readable.
- New entrypoints: `publishSharedDashboard()`, `previewSharedDashboardPublication()`,
  `sharedDashboardPublicationStatus()`, `saveSharedDashboardSettings()`,
  `initializeSharedDashboardSnapshot()`, `scheduledSharedDashboardPublish()`.
- Destination guard refuses the private master workbook and any workbook that looks
  operational (`PROJECTS`, `MEMBERS`, `AUTOMATION_SETTINGS`, `NOTIFICATION_LOG`, `AUDIT_LOG`).
- Publication is serialized with the script lock, idempotent for readers, blanks stale
  trailing rows, and records `SHARED_DASHBOARD_PUBLISHED` / `SHARED_DASHBOARD_PUBLICATION_FAILED`.

Visibility and schema

- `PROJECTS.Dashboard_Visibility` (`INTERNAL` / `RESTRICTED`, default `RESTRICTED`) and
  `PROJECTS.Dashboard_Summary`; `TASKS.Public_Note` is the only publishable task free text.
- Migrated projects keep a blank visibility and are therefore **not** published until a
  manager reviews them.

Settings and scheduling

- `AUTOMATION_SETTINGS` gains `SHARED_DASHBOARD_PUBLISH_ENABLED` (default **false**),
  `SHARED_DASHBOARD_PUBLISH_INTERVAL_MINUTES` and publication status keys. Publication
  never affects the mail mode.
- The optional `scheduledSharedDashboardPublish` trigger exists only while publication is ON.

Tooling and documentation

- `npm run validate` now also validates the dashboard project: no spreadsheet writes, no mail
  / Calendar / trigger / Drive APIs, no manager modules, no `SPREADSHEET_ID` property, and a
  domain-restricted, read-only manifest.
- New `scripts/dashboard-preview.js` builds an offline static preview from fictional data for
  browser review and visual regression.
- New documentation: `docs/dashboard/*` (architecture, data contract, access and sharing,
  deployment, smoke test, visual spec) and `docs/checkgates/V1_2_GATE_1..5.md`.

## V1.1 production hardening (security fixes, release gates, documentation)

Schema version stays **3** (no migration required for this release).

Security

- Server-side authorization layer (`src/Access.gs`): identity from the verified session only; role, actor, owner
  and confirmation values supplied by the browser are data, never authority.
- Role management guarded: only ADMIN may grant/revoke `ADMIN`/`MANAGER`, self-role-change is refused, unknown role
  text is rejected, and the last active administrator cannot be demoted or deactivated.
- Task ownership enforced: MEMBER → own tasks, MANAGER → own projects/subprojects and own tasks, ADMIN → all,
  VIEWER → none.
- One-time, allowlisted, audited first-administrator bootstrap (`bootstrapFirstAdministrator`); refused on an
  operational workbook and not reusable.
- Member-scoped data visibility: MEMBER sees only own tasks/projects, a minimal member directory and own
  assessment; no other people's assessment details.
- Sidebar rendering rewritten with DOM creation and `textContent` (`src/UiSafe.html`); `innerHTML`, `outerHTML`,
  `insertAdjacentHTML` and `document.write` are rejected by `npm run validate`.

Automation

- LIVE authorization is evaluated on the **effective-state** transition, so clearing the emergency stop while
  `EMAIL_MODE=LIVE` requires ADMIN, the exact confirmation and a passing preflight. Activation/deactivation is
  audited (`EMAIL_LIVE_ACTIVATED`, `EMAIL_LIVE_DEACTIVATED`).
- Unmigrated workbooks fail closed (`OFF`, `LEGACY_CONFIGURATION_BLOCKED`); the legacy flag mapping requires the
  explicit `ALLOW_LEGACY_EMAIL_CONFIG=true` opt-in.
- Weekly report scheduling derives weekday and time from settings, detects drift through
  `MANAGED_TRIGGER_SIGNATURE`, recreates only managed triggers, and removes obsolete ones without touching
  unrelated triggers.

Management correctness

- `Health.staleDays` returns a numeric age; thresholds moved to `thresholds`.
- Dashboard attention categories are independent (`unknownScheduleProjects`, `atRiskProjects`, `overdueTasks`,
  `blockedTasks`, `criticalIssues`, `staleProjects`).

Documentation

- Updated `README.md`, `README_JP.md`, `ARCHITECTURE.md`, `DATA_SCHEMA.md`, `DEPLOYMENT.md`, `BACKUP_RESTORE.md`,
  `AGENTS.md`, `.github/copilot-instructions.md`, `docs/AUTOMATION_SETTINGS.md`, `docs/MANAGER_WORKFLOW.md`,
  `docs/GOOGLE_WORKSPACE_SMOKE_TEST.md`, and added post-merge audit sections to `docs/checkgates/GATE_1..6.md`.
- New: `docs/PRODUCTION_READINESS.md` (canonical gate, **NOT APPROVED FOR PRODUCTION**),
  `docs/SECURITY_MODEL.md`, `docs/OPERATIONS_RUNBOOK.md`,
  `docs/checkgates/SECURITY_HARDENING.md`, `docs/checkgates/AUTOMATION_HARDENING.md`,
  `docs/checkgates/CORRECTNESS_HARDENING.md`.

Tests: 105 local tests pass (84 before hardening + 21 new). No live Google Workspace verification is claimed.

## V1.1 — Management usability, reliability & automation controls

Schema version 3, migration `003_management_reliability` (additive; each approved migration takes its own verified
backup).

Unknown effort and approval

- `Estimated_Hours` defaults to blank (unknown) in `TASKS`/`SUBPROJECTS`; `0` is a deliberate zero. Existing values
  are never rewritten.
- Workload, dashboards, progress and the weekly report count unknown estimates separately.
- Assignment approval and schedule confirmation are separate concepts; deadline-only assignment is supported.
- `ScheduleConfirmations` records versioned confirmations per task; date/estimate changes supersede them without
  deleting history.
- Progress updates no longer require or revoke approval; material assignment changes still do.

Policy, progress and health

- `Eligibility.gs` is the single policy for active work, notifications and archived/cancelled exclusion.
- `Progress.gs` provides effort-weighted rollups with the documented fallback weight 1 and `未計算` for empty
  projects.
- `Health.gs` provides deterministic health labels, reason codes and configurable thresholds; unknown schedule is
  never green.
- Project `Last_Updated` is maintained by application changes and never by dashboard refreshes.

Views and workload

- New generated views: `PROJECT_OVERVIEW`, `TEAM_VIEW`, `AUTOMATION_STATUS`; rewritten `DASHBOARD`,
  `GANTT_OVERVIEW`, `TIMELINE_DATA`, `WORKLOAD`.
- Portfolio/detailed Gantt fallback keeps unscheduled tasks visible.
- Workload separates planned and actual hours, flags over-capacity members and excludes archived work.

Manager UI and roles

- Container-bound Japanese manager UI (`Ui.gs`, `UiMenu.html`, `UiSettings.html`, `UiSystem.html`) with menu,
  task assignment, progress, members, skills, issues, milestones, automation settings and system status.
- `Roles.gs` (`ADMIN`/`MANAGER`/`MEMBER`/`VIEWER`) enforced server-side; blank roles fail closed to `VIEWER`.
- Skill assessment metadata and advisory gap detection.
- `.claspignore` packages HTML templates; source validation enforces it.

Automation control center

- New `AUTOMATION_SETTINGS` table with validated, audited, deployment-independent manager preferences.
- OFF/PREVIEW/LIVE mail mode with a single effective-mode resolver, emergency stop and preflight.
- Per-feature, per-project and per-task notification switches with most-restrictive-wins semantics.
- Configurable reminder offsets, bounded catch-up, overdue frequency, weekday-only sending and JST execution
  window.
- Weekly management report with deduplication and empty-report suppression.
- Calendar and daily-backup switches; migration backups remain unconditional.
- Notification states include `PREVIEW` and `DELIVERY_UNCERTAIN`; ambiguous delivery is never retried
  automatically. `reconcileUncertain` records administrative reconciliation.
- Trigger diagnostics for installed, missing and duplicated handlers.

Planning

- `PROJECT_PHASES` persists versioned per-project plans; re-planning one project cannot replace another.

Repository

- New documentation: `docs/AUTOMATION_SETTINGS.md`, `docs/MANAGER_WORKFLOW.md`,
  `docs/GOOGLE_WORKSPACE_SMOKE_TEST.md`, `docs/checkgates/GATE_1.md` … `GATE_6.md`.
- `AGENTS.md` extended with V1.1 mandatory rules; `.github/copilot-instructions.md` updated.

## Unreleased — initial implementation

- Introduced a new Google Sheets / Apps Script engineering project-management implementation.
- Added environment-bound configuration, explicit empty-workbook initialization, restricted Drive backups, and approved versioned schema migrations.
- Established schema version 1 and migration `002_task_assignment_safety` to version 2 for assignment-version approval and notification baselines.
- Added conservative email/Calendar defaults and local validation tooling.
- Documented isolated deployment, manual recovery, and contributor safety requirements.

No previous prototype, production deployment, benchmark, or live Google Workspace verification is included in this
release record. The V1.1 scale measurement is a local mock benchmark, not a Workspace benchmark.