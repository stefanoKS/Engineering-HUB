# Engineering-HUB

## Current release — V1.7.4

**IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**

Application version **1.7.4** is a visual release. It refreshes the manager application and the
employee dashboard and gives every project a stable accent colour that its subprojects and tasks
inherit. Schema **8** and employee contract **1.6** are unchanged; there is no migration, no new Script
Property, no new backend read, no deployment and no change to authorization, publication, notification
or request logic.

- **One design language.** Both applications declare the same `--ui-*` tokens (background `#F6F8FB`,
  surface `#FFFFFF`, sidebar `#F0F4F8`, text `#253449`, muted text `#607086`, border `#DFE6EE`, primary
  `#365E80`, radius `10px`) with a Japanese-friendly system font stack, 16 px body text and a
  4/8/12/16/24 px spacing scale. The historical token names stay and resolve to the new values.
- **A stable accent per project.** `shared/project-colors.js` derives the accent from the stable
  `Project_ID` only — never from a list position, a filter or a sort order — and is copied to both
  projects by `npm run sync:colors`, so the manager page and the employee dashboard show the same
  colour for the same project. No spreadsheet column, migration or extra read is involved.
- **A project colour is not a status colour.** Warning, approval, completion and error states keep
  their semantic palette and a readable label. The employee dashboard moved its red/amber health
  emphasis into the health pill and a tinted card border, so the project strip stays stable.
- **Hierarchy inheritance.** Subproject cards and task cards (including subtasks) reuse the parent
  project's hue; depth changes indentation and strength, never the hue.
- **Only palette values reach CSS.** The helper exposes `--project-accent`, `--project-outline` and
  `--project-tint`; a project ID or name is never interpolated into a style.
- **No performance change.** Accents are computed in the browser from data the client already holds,
  so the 30-second authorized cache, request deduplication and bounded pagination are untouched.

Local verification: `npm run lint`, `npm test` (**666 tests, 666 pass, 0 fail, 0 skipped**),
`npm run validate` (42 manager files, 3 dashboard files, 970 translation keys) and
`node scripts/sync-project-colors.js --check` all pass. Local previews were checked at 375, 768, 1366,
1920 and 2560 px, at 125/150/200 % zoom, in Japanese and English, with no horizontal scrolling. Live
Workspace UI verification stays **BLOCKED / NOT_RUN**; see
[V1_7_4_GATE_1.md](docs/checkgates/V1_7_4_GATE_1.md),
[V1_7_4_GATE_2.md](docs/checkgates/V1_7_4_GATE_2.md),
[docs/UI_UX_GUIDELINES.md](docs/UI_UX_GUIDELINES.md) and
[docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md).

## Historical V1.7.3 release record

**IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**

Application version **1.7.3** is a corrective release: it fixes the remaining request-validation and
manager-editor defects and reduces the number of Google Sheets service calls the manager page makes.
Schema **8** and employee contract **1.6** are unchanged; there is no migration, no deployment and no
change to authorization, publication or notification policy.

- **A numeric `Snapshot_Version` cell no longer breaks a decision.** Google Sheets returns a cell typed
  as `1.5` as a number, and the whole-row re-validation before a decision failed with
  `Invalid text: Snapshot_Version`. The two opaque request identifiers (`Snapshot_Version`,
  `Task_Revision_At_Submission`) are now declared as text and normalized **when the row is read**;
  nothing else is coerced, no stored request is rewritten, and `Due_Date_At_Submission` stays a date.
- **An editor that answers late never opens.** Closing the form, navigating away or dismissing the
  native dialog with Escape discards the state **and** invalidates a pending editor-open read, so a
  response that arrives afterwards cannot reopen a form.
- **An edit starts from the stored row.** The form no longer reuses the list row: every edit reads the
  latest authorized row and its revision first (`EDIT_CONFLICT` is unchanged). Member, responsibility
  and subproject editors use a new narrow, allowlisted `editor` read instead of a list payload.
- **The release version is real.** One `APP_VERSION` constant (`1.7.3`) feeds the overview, the
  publication page and システム状態; the database schema, application, publisher and snapshot-contract
  versions remain separate values.
- **A parent task beyond one page is findable.** The parent selector uses a bounded server-side search
  (`parentOptions`, 200 rows + `total`/`complete`) with the same hierarchy and cycle rules, so a valid
  parent in a large project is no longer silently missing. The browser still never receives the whole
  task table.
- **The first page is one read.** The compact task index is read when タスク opens instead of during the
  first paint, so the initial load is one Apps Script execution.
- **One range read per table per execution.** `Database.data()` shares the raw `getDataRange()` values
  with the row cache for the length of one execution; a write invalidates them, so a write no longer
  reads the same table twice and no execution re-opens the workbook.
- **Writes are batched per row.** `Database.update()` writes one range per contiguous block of changed
  columns instead of one `setValue()` per field, while still writing only the patched cells (formulas,
  custom columns and untouched cells are preserved).
- **Measurement without exposure.** Read/write paths report execution time, workbook opens, range
  reads, writes, lock wait, binding time, serialization time, payload bytes and per-table read time —
  never a spreadsheet ID, e-mail address or cell value. 計測 gains a summarized table and a read-only
  **詳細計測を実行** run; ordinary responses keep the small measuring envelope.
- **A safe DEV benchmark.** `devBenchmarkManagerWeb()` runs read-only manager reads in a development
  project, with cold/warm p50/p95 and call counts. Real Workspace numbers stay **NOT_RUN** until it is
  actually executed there.
- **An experiment, not a default.** A DEV-only `DEV_SHEET_READ_BACKEND=BATCH_GET` reader can compare the
  Sheets API `batchGet` path with `SpreadsheetApp`; equivalence tests cover dates, booleans, numbers,
  blanks, formulas and request rows. `SpreadsheetApp` stays the production path and any failure falls
  back. No server-side cache was introduced.

Local verification: `npm run lint`, `npm test` (**649 tests, 649 pass, 0 fail, 0 skipped**),
`npm run validate` (42 manager files, 3 dashboard files, 970 translation keys) and
`BENCHMARK_OUTPUT=V1_7_3_PERFORMANCE.json node scripts/manager-web-benchmark.js` all pass. Live
Workspace verification stays **BLOCKED**; see
[V1_7_3_GATE_1.md](docs/checkgates/V1_7_3_GATE_1.md) through
[V1_7_3_GATE_5.md](docs/checkgates/V1_7_3_GATE_5.md),
[docs/MANAGER_WEB_APP_PERFORMANCE.md](docs/MANAGER_WEB_APP_PERFORMANCE.md) and
[docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md).

## Historical V1.7 release record (V1.7 / V1.7.1 / V1.7.2)

**IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**

Version **1.6.2** is a corrective reliability release: it keeps every V1.6 and V1.6.1 capability and fixes the
request, audit and date defects an audit of that delivery found. No schema, migration, deployment, permission or
feature was added.

- **A request only owns its own effect.** `alreadyApplied` inferred a prior application from the task state
  (`Done`/`100 %`, or a `Due_Date` that happened to match), so an ADMIN correction, a separate approval or a manual
  edit could be recorded as an employee approval. Evidence now comes from a request-specific journal
  (`REQUEST_DECISION_PREPARED` → `REQUEST_EFFECT_APPLIED` → `REQUEST_DECIDED`) keyed by `Request_ID`, and task
  state is never used as proof. A changed revision is no longer bypassed because the target value matches.
- **Ambiguity stays ambiguous.** A `PROCESSING` request with no request-specific evidence is never auto-approved
  and never applied twice. It keeps its open state, one `REQUEST_RECONCILE_REQUIRED` row explains why, and a manager
  settles it from a read-only preview (`previewRequestDecisionReconciliation`) with an explicit
  `reconcileRequestDecision` (`CONFIRM_APPLIED` or `MARK_STALE`). That repair never writes the task.
- **Decisions are audited exactly once.** `REQUEST_DECIDED` is written once per accepted decision. A decision whose
  audit write failed is repaired by repeating the same decision, which finishes only the missing record; a terminal
  request is never decided again.
- **The ADMIN completion override is journaled.** `COMPLETION_OVERRIDE_PREPARED` is written before the mutation and
  `COMPLETION_OVERRIDDEN` carries the same `Operation_ID`; an interrupted correction is reported instead of being
  shown as a success, and `reconcileCompletionOverrides` appends exactly the missing record, once.
- **Dates no longer disappear.** `Requests.day()` converted its input to text before testing `instanceof Date`, so a
  real Sheets date cell became an empty string. Real `Date` objects are now resolved in Asia/Tokyo, textual values
  keep their written `yyyy-MM-dd`, and an impossible calendar date is refused rather than normalized.
- **Receipts can be reconciled.** `申請状態の同期確認` shows, per request, whether the employee receipt matches the
  manager decision (`一致` / `要再同期` / `受信箱に行がありません` / `タスクまたはプロジェクトが一致しません`), and
  `申請状態を再同期` repairs only the mirrored `Inbox_State`. Missing or conflicting rows are reported, never
  recreated or overwritten, and request content is never rewritten or exposed.
- **History is attributed honestly.** A member profile separates `本人の操作履歴` (Member actions — verified sign-in
  identity only) from `担当業務の変更履歴` (Task history, which may contain other actors), and labels an unverified
  contributor instead of attributing it to the member.
- **Areas switch faster.** An area-scoped overview no longer recomputes and reships the area selector and cards the
  browser already holds, and the previous area's figures are replaced by a scoped loading state instead of being
  shown under the newly selected area.
- **Area colour is chosen visually.** The responsibility form no longer asks for a HEX string: twelve muted presets
  are clickable swatches with a check mark and `aria-pressed` state, a custom colour uses the browser's own picker,
  the HEX field is an optional advanced control, and a preview card shows the result immediately. `Color_Hex` stays
  the stored value, the server keeps validating it, an untouched colour is never rewritten, and a new area keeps its
  deterministic palette default (see [V1_6_2_GATE_6.md](docs/checkgates/V1_6_2_GATE_6.md)).
- **Tasks filter by their project's responsibility.** The task list resolves the area through
  `TASKS.Project_ID → PROJECTS.Responsibility_ID` (nothing is copied into `TASKS`), so one area, 未分類 and a retired
  area that still owns projects each return exactly their own tasks. The responsibility selector is the first control
  of the filter bar, the project selector only offers the selected area's projects (an incompatible selection is
  visibly reset), the browser snapshot and the server page apply the same rules, and moving a project to another area
  invalidates the task index and the area aggregates instead of leaving the work under its previous responsibility
  (see [V1_6_2_GATE_7.md](docs/checkgates/V1_6_2_GATE_7.md)).

Schema **7** and employee contract **1.5** are unchanged; there is no new migration, and no execute-as, trigger,
mail, Calendar or publication change.

Local verification: `npm ci`, `npm run lint`, `npm test`, `npm run validate` and
`node scripts/manager-web-benchmark.js` all pass; **567 tests, 567 pass, 0 fail, 0 skipped** (543 at the sealed
V1.6.2 delivery, ten colour-picker cases and fourteen task-filter cases) and the seven V1.6.2 checkgates record local
PASS results with their live criteria BLOCKED (see
[V1_6_2_GATE_5.md](docs/checkgates/V1_6_2_GATE_5.md), [V1_6_2_GATE_6.md](docs/checkgates/V1_6_2_GATE_6.md) and
[V1_6_2_GATE_7.md](docs/checkgates/V1_6_2_GATE_7.md)). Cached navigation stays at 1.2–2.5 ms and local filtering at
0.1–1.5 ms; `bootstrap` costs 7.5 / 49.1 / 142.9 ms and 11.2 / 57.9 / 153.3 KB for 10/100/300 projects, and the
area-scoped overview drops from 137.3 ms / 9.99 KB to 110.8 ms / 8.87 KB at 300 projects. A durable decision costs
one extra journal read and two journal rows, which is why approval measures 2.7 / 12.5 / 34.1 ms instead of
2.3 / 11.3 / 31.9 ms. Real Workspace latency, the DEV migration, the request round trip and production rendering
remain **NOT_RUN**.

Preview: npm run preview:manager-web → http://127.0.0.1:4175/ (synthetic data only). The 計測 / Diagnostics button
in the header shows the same timings without Chrome DevTools.

### V1.7.2 administration layout and editor lifecycle

The administration screens are purpose-built pages and the record editors no longer keep drafts.

- **Open → edit → save or close.** A form is built from the latest stored record; closing it, or
  navigating away, discards every entered value and reopening starts fresh. There is no autosave,
  no draft store, no draft question and no retained form data in memory or in `localStorage`. One
  save is one write, and a confirmed save closes the form.
- **Purpose-built administration pages.** 共有ダッシュボード公開 shows the publication state, the last
  successful run, the schedule, the published counts, the snapshot contract and the last error as
  cards, keeps the database schema, the application version, the publisher version and the snapshot
  contract clearly separate, and treats a newer publisher contract as an informational update
  (`更新あり`) rather than an error. システム状態 groups database/environment, application, operational
  status, integrations and the consistency result. 自動化 groups the unchanged settings under Mail
  notifications, Request synchronization, Scheduled reports, Snapshot publication and Emergency
  stop with explicit on/off badges. Technical metadata stays in expandable details blocks, and no
  page dumps a nested server payload.
- **Hierarchy by name.** 親サブプロジェクト and 親タスク are searchable selectors that display record
  names and the selected parent's ancestor path; a record is never offered as its own parent, and
  the server-side depth/cycle validation is unchanged.
- Backend, schema, migrations, publication contract, authorization and every server-side
  validation are unchanged. Local result: 622 tests, 622 pass (19 new in
  [tests/v1_7_2-admin-ui.test.js](tests/v1_7_2-admin-ui.test.js)), with
  [V1_7_2_GATE_1.md](docs/checkgates/V1_7_2_GATE_1.md) recording the evidence and the live criteria
  BLOCKED.

## Historical V1.6.1 release record

Version **1.6.1** fixed the correctness, integrity and compatibility defects an audit of V1.6 found: one counting
rule for every manager figure, scope resolved before paging, completion and deletion integrity, history that
survives reassignment, and contracts **1.4 and 1.5** read through their own header rows. Its local result was
**500 tests, 500 pass**; the six V1.6.1 checkgates and
[V1_6_1_PERFORMANCE.json](docs/checkgates/V1_6_1_PERFORMANCE.json) keep that release's local PASS results and
BLOCKED live criteria.

## V1.7 release record

V1.7 adds multi-assignee work and a worker-centred employee view without changing the ownership model:
`TASK_ASSIGNEES` and `RESPONSIBILITY_MEMBERS` hold additional members only, the primary owner columns
stay authoritative, and membership never grants authority. Schema **8**
(`008_task_and_responsibility_members`) and employee contract **1.6** (`assigneeNames`); both are
additive and neither is applied or published automatically. The manager now imports new requests with
one authorized operation when 申請一覧 opens, permanent deletion asks once with a Yes/No dialog, and the
Members list shows Position. On the employee side, submission is non-blocking with an explicit receipt
state (`送信中` / `受付完了` / `送信失敗` / `送信結果不明`) and `作業担当者別タスク / Tasks by Worker`
filters published work by any assignee. See [CHANGELOG.md](CHANGELOG.md),
[docs/dashboard/DATA_CONTRACT.md](docs/dashboard/DATA_CONTRACT.md) and
[docs/V1_7_DEPLOYMENT_RUNBOOK.md](docs/V1_7_DEPLOYMENT_RUNBOOK.md).

## Historical V1.6 release record

V1.6 made responsibilities the top organisational level of the manager dashboard and finished the work hierarchy:
area cards with colour, owner and progress, four subproject levels, three task levels with work containers, a
reviewed completion workflow, the first narrow ADMIN-only deletion, member history and contract 1.5. Schema **7**
(`007_responsibility_hierarchy_and_lifecycle`). Its local result was **462 tests, 462 pass**; the twelve V1.6
checkgates keep that release's local PASS results and BLOCKED live criteria, and measurements stay in
[V1_6_PERFORMANCE.json](docs/checkgates/V1_6_PERFORMANCE.json) as historical evidence.

## Historical V1.5.1 release record

V1.5.1 added one authorized snapshot (`bootstrap`) plus a compact task index, so ordinary navigation, filtering,
sorting and previously opened records render from memory instead of waiting for `google.script.run`. Its local
result at that release was **406 tests, 406 pass**; measurements stay in
[V1_5_1_PERFORMANCE.json](docs/checkgates/V1_5_1_PERFORMANCE.json) as historical evidence, and
[the ten V1.5.1 checkgates](docs/checkgates/V1_5_1_GATE_10.md) keep that release's local results and BLOCKED status.

## Historical V1.5 release record

V1.5 added the standalone manager browser UI (5 routes, ja/en, one form per record type, current project
health/progress derived on read, employee requests and controlled administration) on top of the private workbook.
Its implementation and review-correction SHAs are recorded in
[the ten V1.5 checkgates](docs/checkgates/V1_5_GATE_1.md); its measurements stay in
[V1_5_PERFORMANCE.json](docs/checkgates/V1_5_PERFORMANCE.json) as historical evidence.


## Historical V1.4.1 release record

The following release table is retained as historical evidence, not the current validation count.


Engineering project management using Google Sheets as the database, Google Apps Script as the application, and GitHub as the source-code history.

[日本語](README_JP.md) · [Architecture](ARCHITECTURE.md) · [Data schema](DATA_SCHEMA.md) · [Deployment](DEPLOYMENT.md) · [V1.6 runbook](docs/V1_6_DEPLOYMENT_RUNBOOK.md) · [Backup and restore](BACKUP_RESTORE.md) · [Pre-trial checklist](docs/PRE_TRIAL_CHECKLIST.md) · [Manager workflow](docs/MANAGER_WORKFLOW.md) · [Automation settings](docs/AUTOMATION_SETTINGS.md) · [Shared dashboard](docs/dashboard/ARCHITECTURE.md) · [Dashboard data contract](docs/dashboard/DATA_CONTRACT.md) · [Workspace smoke test](docs/GOOGLE_WORKSPACE_SMOKE_TEST.md) · [Security model](docs/SECURITY_MODEL.md) · [Operations runbook](docs/OPERATIONS_RUNBOOK.md)

## Release status — NOT APPROVED FOR PRODUCTION

| Field | Value |
| --- | --- |
| Release | V1.4.1 (final pre-trial stabilization) on top of V1.4 (responsibilities, nested subprojects, UI refinement), V1.3 (planning, requests, Japanese/English UI), V1.2 (shared read-only dashboard) and V1.1 + production hardening |
| Version | `1.4.1` |
| Local test count | **328 passing** (`npm test`), 0 failing; `npm run lint` and `npm run validate` pass |
| Schema version | **8** — `008_task_and_responsibility_members` (additive only; approval + verified backup required) |
| Verified locally | Simplified role policy (ADMIN/MANAGER manage the whole department, MEMBER keeps own-task self-service), server-side re-checks on every global RPC wrapper, validated responsibility reordering, a single coordinated project edit (ordinary fields + responsibility transfer), bounded hierarchy walks on malformed data, ancestor-aware active-work and reminder eligibility, a bounded task selector with server search, project visibility controls, partial-patch project/task editing, stale-edit refusal, automatic request import with idempotency and lock, unknown-vs-zero estimates, deadline-only assignment, separated approval/schedule confirmation, weighted progress, deterministic health, safe DOM rendering, first-admin bootstrap, OFF/PREVIEW/LIVE matrix, reminder offsets and catch-up, weekly report, trigger drift recreation, ledger states, data preservation on upgrade, sanitized dashboard DTO allowlist, `INTERNAL`-only publication, A/B snapshot commit and rollback-on-failure, read-only viewer API, deadline wording in Asia/Tokyo |
| Known production blockers | No live Google Workspace execution of any kind; development/production projects not created; roles blank after migration until bootstrap; real Sheets quota/performance unmeasured; repository visibility undecided; dashboard deployment ACL, Drive ACLs and scheduled publication unverified; request submission flag intentionally OFF until the operator enables it |
| Google Workspace verification | **UNVERIFIED** — nothing in this repository has been run against a real Workspace |

The canonical release gate is [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md). It stays at
**NOT APPROVED FOR PRODUCTION** until recorded live evidence exists; a green CI run cannot change it.

For a first installation, follow [docs/PRE_TRIAL_CHECKLIST.md](docs/PRE_TRIAL_CHECKLIST.md) step by step.

## Two applications

| Application | Source | Purpose |
| --- | --- | --- |
| Manager (container-bound) | `src/` | Operational database, sidebars, automation, publication |
| Shared dashboard (standalone web app) | `dashboard-app/` | **Read-only** portfolio for all employees; reads only the sanitized snapshot |

The dashboard never reads the private management workbook and has no write, mail, Calendar or
trigger access. Only projects explicitly marked `Dashboard_Visibility = INTERNAL` are
published. See [docs/dashboard/ARCHITECTURE.md](docs/dashboard/ARCHITECTURE.md) and
[docs/dashboard/ACCESS_AND_SHARING.md](docs/dashboard/ACCESS_AND_SHARING.md).


## Safety first

- Develop in a **separate Apps Script project and spreadsheet**. Never point development at production data.
- Deploying code does not migrate data. Git cannot restore spreadsheet rows, Drive files, Script Properties, or triggers.
- Initialization is only for an explicitly selected, empty workbook. Existing data requires reviewed, explicitly approved migrations.
- Email and Calendar integrations are disabled by default; dry-run is enabled by default.
- The V1.1 manager UI requires a **container-bound** Apps Script project; a standalone script cannot open a sidebar.
- Manager preferences live in the workbook `AUTOMATION_SETTINGS` table, so deployments never reset them, while credentials stay in Script Properties.
- Drive snapshots require a restricted backup folder. Backups are retained; the application does not automatically delete them.

## Quick start

Use Node.js 22 (at least 22.13.0) and PowerShell:

```powershell
npm ci
npm run lint
npm test
npm run validate
```

Then follow [docs/PRE_TRIAL_CHECKLIST.md](docs/PRE_TRIAL_CHECKLIST.md) to create an isolated
development project, push the two clasp targets, configure Script Properties, initialize an empty
spreadsheet, bootstrap the first administrator, publish a snapshot and deploy the dashboard.
[DEPLOYMENT.md](DEPLOYMENT.md) is the reference chapter for each area (and the only place for the
production gate); where the two differ, the checklist wins. `config.example.json` is a reference for
**Script Properties**, not credentials or an automatically loaded configuration file.

## V1.1 — Management usability, reliability and automation controls

Schema version 3 adds migration `003_management_reliability` (additive only; existing values are verified
unchanged before it is recorded as successful).

- **Unknown effort stays unknown.** `Estimated_Hours` defaults to blank; `0` is a deliberate zero. Workload,
  dashboards and the weekly report count unestimated tasks separately.
- **Assignment approval and schedule confirmation are separate.** A task can be assigned with only a deadline.
  Approval requires an active owner and a verified account; schedule confirmation additionally requires a known
  estimate. Progress updates do not revoke approval, material changes do.
- **One eligibility policy** (`Eligibility.gs`) keeps archived/cancelled work out of active workload, dashboards,
  reminders and reports while retaining all records.
- **Effort-weighted progress and deterministic health.** Progress writes only the computed columns; health is a
  documented heuristic with configurable thresholds (`GREEN`/`YELLOW`/`RED` plus `UNKNOWN`, `PLANNED`,
  `ON_HOLD`, `COMPLETED`, `CANCELLED`, `ARCHIVED`).
- **Japanese manager UI** (container-bound): menu, task assignment, progress, members, skills, issues,
  milestones, automation settings and system status. All writes go through the validated domain services.
- **Automation control center:** OFF/PREVIEW/LIVE mail mode, per-feature switches, per-project and per-task
  switches, configurable reminder offsets with bounded catch-up, weekly management report, Calendar and backup
  switches, persisted status and audit records. See [Automation settings](docs/AUTOMATION_SETTINGS.md).
- **Roles:** `ADMIN` > `MANAGER` > `MEMBER` > `VIEWER`, resolved from the verified Google session and enforced
  server-side. A blank role (for example after migrating) is treated as `VIEWER` until a manager assigns it. The
  sidebar is manager-only by default; a `MEMBER` gets own-task scope only when `ALLOW_MEMBER_SELF_SERVICE=true`,
  and that is not a confidentiality boundary (see [Security model](docs/SECURITY_MODEL.md)).
- **Reverse planning** persists a versioned plan per project in `PROJECT_PHASES`; re-planning one project never
  replaces another project's plan.
- **Reliability:** the mail ledger reserves `PENDING` before sending, never retries ambiguous delivery
  automatically, supports administrative reconciliation to `DELIVERY_UNCERTAIN`, and previews without consuming
  live dedupe keys.

Detailed gate evidence is in [docs/checkgates](docs/checkgates/GATE_1.md). The manual Google Workspace
verification guide is [docs/GOOGLE_WORKSPACE_SMOKE_TEST.md](docs/GOOGLE_WORKSPACE_SMOKE_TEST.md); it has not been
executed in a live Workspace as part of this repository.

### Production hardening (post-merge audit)

Five confirmed defects were corrected after the first V1.1 merge, each with new regression tests:

1. **Role escalation** — a MANAGER could grant `ADMIN`, and any caller could change a role through the UI payload.
   Roles are now guarded server-side (`Members.guardRoleChange`, `Access`), self-change is refused, and the last
   active administrator cannot be demoted or deactivated.
2. **Task ownership** — `updateProgress` trusted the task ID from the browser. MEMBER is now limited to their own
   tasks, MANAGER to projects/subprojects they own, ADMIN to everything, VIEWER to nothing.
3. **Unsafe HTML** — sidebars interpolated spreadsheet text into `innerHTML`. All rendering now uses DOM creation
   with `textContent` (`src/UiSafe.html`), and `npm run validate` rejects unsafe HTML APIs in templates.
4. **LIVE mail reactivation** — clearing the emergency stop while `EMAIL_MODE=LIVE` restarted delivery without an
   ADMIN check. LIVE is now authorized on the *effective-state transition*, so only an administrator with the
   exact confirmation and a passing preflight can restart it. Unmigrated workbooks now fail closed unless
   `ALLOW_LEGACY_EMAIL_CONFIG=true` is set deliberately.
5. **Weekly report schedule** — the trigger ignored `WEEKLY_REPORT_TIME` and weekday changes. The schedule is now
   derived from settings, drift is detected through a stored signature, and obsolete managed triggers are removed
   without touching unrelated ones.

Two management-correctness bugs were also fixed: `Health.staleDays` returned the thresholds object instead of a
number, and the dashboard reported every non-green project as having an unknown schedule. See
[SECURITY_HARDENING.md](docs/checkgates/SECURITY_HARDENING.md),
[AUTOMATION_HARDENING.md](docs/checkgates/AUTOMATION_HARDENING.md) and
[CORRECTNESS_HARDENING.md](docs/checkgates/CORRECTNESS_HARDENING.md).

Security posture and residual risks: [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).
Day-to-day operation: [docs/OPERATIONS_RUNBOOK.md](docs/OPERATIONS_RUNBOOK.md).

## Capabilities and boundaries

The application manages projects, members, skills, tasks, assignments, scheduling, progress, health and management views. Workspace automation is opt-in and must be reviewed before activation. The source and local tests are the implementation reference; local mocks do not prove that a live Google Workspace deployment, permissions, quotas, trigger delivery, or mail delivery works.

The bound manager UI is a Google Sheets menu with Japanese sidebars. Google Sheets editor access is not an
administrator boundary, so V1.1 assumes trusted managers only; a separate employee-facing application would be a
later release.

Google Sheets native Timeline availability depends on your Workspace edition and permissions. Set it up manually when supported; use the generated `GANTT_OVERVIEW` and `TIMELINE_DATA` sheets otherwise. Do not rely on automatic creation of a native Timeline.

This repository is a new implementation. No earlier prototype is included. There are no independently measured production performance benchmarks, claims of a complete resource-constrained critical-path solver, or guarantees of exactly-once external delivery. The local scale test uses mocks only.

## Typical development workflow

After initialization, run an editor wrapper like this **once in development**. These are example records, not production seed data; rerunning is not an upsert and may fail duplicate-email validation.

```javascript
function developmentExample() {
  var member = createMember({
    Name: 'Example Engineer', Email: 'engineer@example.invalid',
    Active: true, Role: 'MEMBER', Weekly_Capacity_Hours: 35
  });
  var project = createProject({
    Project_Name: 'Development example', Status: 'Active',
    Project_Owner_ID: member.Member_ID, Committed_Deadline: '2030-06-28'
  });
  var task = createTask({
    Project_ID: project.Project_ID, Task_Name: 'Review design',
    Owner_Member_ID: member.Member_ID, Planned_Start: '2030-06-03',
    Due_Date: '2030-06-07', Estimated_Hours: 8,
    Notification_Enabled: false
  });
  // Notifications must be activated once before assignment approval is accepted.
  activateNotifications('manager@example.invalid', 'ACTIVATE NOTIFICATIONS');
  approveTaskAssignment(task.Task_ID, 'manager@example.invalid', 'APPROVE ASSIGNMENT');
  confirmTaskSchedule(task.Task_ID, 'manager@example.invalid', 'CONFIRM SCHEDULE');
  refreshManagement();
  return {projectId: project.Project_ID, taskId: task.Task_ID};
}
```

`createMember` now defaults `Role` to `MEMBER`; assign `MANAGER`/`ADMIN` deliberately for operators. `refreshManagement()`
recalculates progress/health and refreshes dashboard, workload and skill views.

Use returned stable IDs with `updateProject(id, patch)`, `updateMember(id, patch)`, and `updateTask(id, patch)`. Set task `Status: 'Done'` together with `Progress_Percent: 100`. Reassign open tasks before deactivating a member; archive projects rather than deleting their history. Assignment approval is not permission to send mail: notification activation and the OFF/PREVIEW/LIVE gates are separate. Deadline-only assignment is valid; do not invent start dates or estimates.

For reverse planning, populate `PHASE_TEMPLATES` and `HOLIDAYS`, then call `reversePlan(projectId, '2030-06-28')`. Each project's plan is persisted in `PROJECT_PHASES`; review `BACKPLAN` for `DRAFT` phases and do not invent missing estimates. View refreshes replace generated output; keep manual notes elsewhere. See [Deployment](DEPLOYMENT.md) for exact activation and trigger entrypoints and [Manager workflow](docs/MANAGER_WORKFLOW.md) for the UI steps.

## Operations

1. Make and validate changes in development.
2. Review code and any migration separately.
3. Create and verify a restricted Drive backup before production data changes.
4. Deploy the reviewed source to the correct Apps Script project.
5. Apply only explicitly approved migrations, then inspect the resulting data.
6. Activate notifications and scheduled work only after the production checks in [Deployment](DEPLOYMENT.md).

See [AGENTS.md](AGENTS.md) for mandatory contributor safety rules and [CHANGELOG.md](CHANGELOG.md) for release notes.

## V1.3 — deadline + duration planning, worker requests and Japanese/English UI

V1.3 keeps the V1.2 architecture and adds five things:

1. **Branding**: every user-visible name is exactly `設計・開発課 管理` (browser title, dashboard
   heading, Sheets menu, settings and system screens). Internal identifiers are unchanged.
2. **Deadline + duration planning**: the manager enters a deadline, a required duration, the
   unit (days/weeks) and the basis (working days/calendar days). The planned start is
   calculated; the start date is no longer a primary input. The range is inclusive of the
   deadline, holidays are respected and the committed deadline is never changed silently.
   Duration is **not** labour hours. See [Task duration policy](docs/TASK_DURATION_POLICY.md).
3. **Worker requests**: any viewer of the internal dashboard may request a deadline change
   (earlier or later) or report completion for **any published task**. Submissions are
   validated and appended to a separate request inbox spreadsheet; the private workbook is
   never reachable from the dashboard. See
   [Deadline request workflow](docs/DEADLINE_REQUEST_WORKFLOW.md) and
   [Request inbox deployment](docs/REQUEST_INBOX_DEPLOYMENT.md).
4. **Manager approval**: the sidebar queue **申請一覧 / 承認待ち** imports, approves, rejects or
   returns requests. Only an approval changes `Due_Date`; every change is recorded in
   `TASK_DEADLINE_HISTORY` and audited. A request submitted before a newer change becomes
   `STALE` and cannot overwrite it.
5. **Japanese/English UI**: Japanese is the default, `日本語 | English` switches every static
   label immediately, and stored spreadsheet text is never translated. See
   [UI localization](docs/UI_LOCALIZATION.md).

What V1.3 deliberately does **not** do: no login or password system, no workload-overlap
validation, no duration-based capacity limits, no automatic reassignment and no blocking of
overlapping assignments. The manager decides whether a schedule is feasible.

Schema **5** adds `005_task_planning_and_requests`: the TASKS planning fields plus the
`TASK_REQUESTS` and `TASK_DEADLINE_HISTORY` tables. The migration is additive and requires
explicit approval; existing rows, dates, formulas and custom columns are preserved.

## V1.3.1 — final pre-trial stabilization

No schema change. V1.3.1 makes the existing features usable and safe for a first trial.

1. **Project visibility is a manager decision.** The project panel now carries
   社内ダッシュボードに表示する / *Show on internal dashboard* (`RESTRICTED` by default,
   `INTERNAL` only when a manager selects it) and 共有用概要 / *Dashboard summary*. The
   private `Description`, acceptance criteria, notes, skills and logs are still never
   published; only the allowlisted sanitized snapshot is. A save states that the change
   appears after the next publication, and the panel offers 共有ダッシュボードを今すぐ公開 /
   *Publish the shared dashboard now*, which calls the same `SharedDashboardPublisher.publish`
   that the automation settings screen uses (manual publication needs no activation switch;
   the scheduled trigger still requires ADMIN plus `ENABLE SHARED DASHBOARD PUBLICATION`).
2. **New projects have an owner.** A manager who creates a project without choosing an owner
   becomes the owner (their verified `Member_ID`). Another owner can still be selected; the
   server never invents an owner and never trusts a browser-supplied role.
3. **Projects and tasks can be edited.** 案件編集 / *Edit project* and タスク編集 / *Edit task*
   load the current values into the same form. The record ID is preserved, `Original_Deadline`
   is immutable, and `Projects.update` / `Tasks.update` receive a **partial patch**: an
   untouched field (owner, dates, duration, estimate, notification preference, actual hours,
   progress, completion state) is never overwritten with a blank default. A record that
   changed after the form was loaded is refused with a reload message instead of being
   overwritten. A committed-deadline change needs an explicit confirmation.
4. **The request queue imports by itself.** Opening 申請一覧 / *Pending requests* imports new
   inbox rows first, under the script lock, with the inbox request ID as the permanent ID, so
   repeated or simultaneous opens never duplicate a request. An unavailable inbox produces a
   warning and never hides requests that were already imported. 申請を取り込む / *Import
   requests* remains as the manual fallback.
5. **Request submission is explicitly OFF.** A configured inbox is no longer permission to
   accept submissions: the dashboard project must set `REQUEST_SUBMISSION_ENABLED=true`
   deliberately. See [Request inbox deployment](docs/REQUEST_INBOX_DEPLOYMENT.md).

Gate evidence: [docs/checkgates/V1_3_1_GATE_1.md](docs/checkgates/V1_3_1_GATE_1.md) … 
[V1_3_1_GATE_7.md](docs/checkgates/V1_3_1_GATE_7.md). Installation steps:
[docs/PRE_TRIAL_CHECKLIST.md](docs/PRE_TRIAL_CHECKLIST.md).

## V1.4 — responsibilities, nested subprojects and UI refinement

Schema version **6** (`006_responsibilities_and_nested_subprojects`). Additive only; nothing is
deployed or migrated automatically.

1. **担当領域 / Responsibility** groups projects as a configurable area with an owner, a status and
   a display order. Create, rename, re-order, retire, reactivate and transfer from 管理. Retirement
   keeps every project: the area stays visible and its projects are marked as needing a new one.
   Categories are unchanged and separate.
2. **Projects can move between areas** with a confirmation. The owner, deadline, status, progress,
   subprojects, tasks and history are not touched, and the transfer is recorded in the audit log.
3. **Two subproject levels.** A subproject can contain one nested subproject; a third level, a
   self-parent and a cross-project parent are refused. Reparenting validates the subtree instead
   of flattening it, and archiving cascades nothing.
4. **Progress stays honest.** A parent subproject rolls up its own and descendant tasks exactly
   once; unknown estimates stay unknown and are never turned into hours.
5. **The manager sidebar is simpler.** 案件 / タスク / 管理 with one section at a time, collapsed
   詳細設定 panels, a compact subproject tree, and a menu entry that opens the right section.
6. **The dashboard gains a responsibility filter and a nested hierarchy view.** Unsent request
   data survives a language switch, and the request form is only offered when the backend says
   submission is open.

Details: [docs/RESPONSIBILITIES.md](docs/RESPONSIBILITIES.md),
[docs/UI_UX_GUIDELINES.md](docs/UI_UX_GUIDELINES.md). Gate evidence:
[docs/checkgates/V1_4_GATE_1.md](docs/checkgates/V1_4_GATE_1.md) …
[V1_4_GATE_6.md](docs/checkgates/V1_4_GATE_6.md). Upgrade steps:
[DEPLOYMENT.md](DEPLOYMENT.md#v14-upgrade-5--6).

## V1.4.2 — checkbox-only rows are never records (database correctness patch)

No schema change (still **6**) and no dashboard contract change (still **1.4**).

1. **Phantom records removed.** Google Sheets materializes an unchecked checkbox as `FALSE`, so a
   freshly initialized table ends at row 1000 with 999 `FALSE` values and no stable IDs. Those
   preformatted rows are no longer read as records, and `Database.read` derives the checkbox
   columns from `Schema` instead of a hardcoded table or column.
2. **Records survive their own booleans.** A row with a stable ID is read even when every boolean
   field is `FALSE`; `0`, `TRUE`, text, dates and formulas are never treated as empty.
3. **No silent data loss.** A row holding data without a stable ID is reported as
   `Malformed record in <table> at row <n>` and is never discarded or overwritten.
4. **Correct insert position.** New records reuse the first preformatted row (row 2, then 3, …)
   instead of `getLastRow() + 1`. Formulas, custom columns and existing values are preserved, and
   no sheet row is deleted.
5. **Migrations unchanged in intent.** Fresh V6 initialization and approved V5→V6 upgrades still
   reject missing or duplicate stable IDs on meaningful rows and still preserve every legacy cell.

Live Google Workspace verification of this patch is still outstanding. Regression tests:
`tests/v1_4_2-checkbox-rows.test.js`.

## V1.4.1 — simplified authorization and pre-trial hardening

No schema change (still **6**) and no dashboard contract change (still **1.4**). This release
makes the application simpler to operate and closes the defects found in the final code review.

1. **One simple role policy.** ADMIN and MANAGER manage every project, subproject, task and
   responsibility in the department; MEMBER keeps own-task self-service and VIEWER stays
   read-only. Responsibility, project and subproject owners are accountability labels, not
   permission boundaries, so two managers can always collaborate.
2. **Every callable entrypoint re-checks the role.** The global Apps Script functions that write
   records now call `Access` before delegating to the domain service, so `google.script.run` and
   the editor cannot bypass a sidebar check.
3. **One coordinated project save.** A name/summary/deadline edit and a responsibility transfer
   are validated together and written as one project row update, so a refused transfer no longer
   leaves earlier fields committed.
4. **Reordering is deterministic.** Every submitted responsibility ID is validated, duplicates
   and unknown IDs are refused, and only rows whose `Sort_Order` actually changes are written.
5. **Hierarchy safety.** Malformed parent links can no longer recurse without bound, and a task
   is never placed inside an archived branch by accident.
6. **One eligibility rule.** Active work, reminders, reports and the published snapshot all use
   the same ancestor-aware subproject test.
7. **Task selection at scale.** The sidebar loads a bounded task window but tells the manager how
   many tasks exist and offers a server-side name search, so no task is silently unreachable.
8. **Clearer Japanese.** Organizational areas are 廃止 / 再有効化, never 退職 / 復職.

Gate evidence: [docs/checkgates/V1_4_1_GATE_1.md](docs/checkgates/V1_4_1_GATE_1.md) …
[V1_4_1_GATE_6.md](docs/checkgates/V1_4_1_GATE_6.md).




