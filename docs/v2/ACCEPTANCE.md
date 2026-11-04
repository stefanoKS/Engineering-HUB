# V2 Acceptance Record

## Back button position and alignment — 2026-11-04

Layout-only follow-up to the member explorer release above; no API route, contract, migration,
authorization or data change. The shared `BackButton` (one component, `apps/web/src/state/navigation.tsx`)
is the first child of the detail content column and now uses one explicit `.back-button` rule.

| Check | Result | Evidence |
| --- | --- | --- |
| Back button appears at far-left | PASS | `.back-button` sets `align-self: flex-start`; the column-flex parent previously stretched the button to the full width and the browser centred its label. Measured in Chromium: button box x equals the `<h2>` box x within 2 px at 1440, 1920 and 390 px |
| Button aligns with page content | PASS | `padding-left: 0` so the arrow glyph starts exactly at the title's left margin; no `justify-content`, `margin-left: auto` or `float` anywhere in the rule |
| Project Detail navigation works | PASS | `member-project-detail-{member,viewer}.png`; unit test asserts the control is the first child of `.screen` |
| Task Detail navigation works | PASS | `member-task-detail-{member,viewer}.png`; unit test asserts the same structure |
| Direct URL fallback works | PASS | `navigation.test.ts` "falls back to the member project explorer for a directly opened project" and the existing task-URL case |
| Browser Back/Forward still works | PASS | Browser journey clicks Back on the project detail and lands on the explorer it came from, with the search term `Edited` still in the box |
| No layout overlap or unwanted spacing | PASS | 0-120 px gap asserted between the control and the title; `documentElement.scrollWidth` never exceeds the viewport at 390/1366/1440/1920 |
| Existing navigation state preserved | PASS | Route memory, filters, expanded hierarchy and scroll offsets unchanged (only CSS and the class rule were touched); `npm run test:v2` **299 passed, 1 skipped (300)**; `npm run test:browser` PASS |

Gates: `npm run typecheck`, `npm run lint`, `npm run test:v2`, `npm run validate`, `npm run build`,
`npm run smoke:prod` and `npm run test:browser` all PASS. Production remains **NOT APPROVED FOR
PRODUCTION**; live host behaviour is NOT_RUN.

## MEMBER project explorer, descriptions and read-only details — 2026-11-04

Baseline `15325d90c03b8915ad1d2d85b671efb0add00a7f` with the uncommitted branding work preserved.
This release adds the member project explorer, project/subproject/task descriptions in the
read-only path and one additive migration. No deployment, migration of an operational database,
trigger, mail/Calendar activation or publication ran; every database used below was disposable and
created by the test/smoke harness.

| Gate | Result | Evidence |
| --- | --- | --- |
| 0 preflight | PASS | HEAD above; `apps/web/src/{App.tsx,state/navigation.tsx,screens/*}`, `apps/api/src/{routes,services}`, `packages/{contracts,db}` and the migration directory read before editing; baseline `npm run test:v2` = 20 files, **280 passed, 1 skipped** |
| 1 member navigation | PASS | `routeAllowed()` and the post-sign-in redirect accept `projects` for MEMBER and VIEWER; `App.tsx` renders `WorkProjectsScreen` for both reader roles and keeps `ProjectsScreen` for ADMIN/MANAGER; `apps/web/test/member-explorer.test.tsx` proves the Projects nav entry and a direct `#/projects` for both roles, and that `/api/manager/projects` is never called |
| 2 project explorer UI | PASS | `WorkProjectsScreen.tsx` calls `GET /api/work/projects` with server-side search (project name only, never the private next action), responsibility filter and paging (24/page); cards show name, responsibility, owner, status, priority, deadline, progress, open/completed counts, description preview and one "View details" link; loading, empty, error and retry states; no create/edit/archive/delete control |
| 3 read-only project detail | PASS | Existing `ProjectDetailScreen` + `ProjectHierarchy` reused; project information section renders name, description, responsibility, owner, status, priority and deadline; hierarchy keeps stable-ID expansion; management buttons absent for MEMBER and VIEWER (unit + browser assertions) |
| 4 project description API | PASS | `WorkProject.description` added to the allowlisted projection and filled from `PROJECTS.description`; the recorded key set (`activeTaskCount`, `committedDeadline`, `completedTaskCount`, `description`, `health`, `priority`, `projectId`, `projectName`, `progressPercent`, `projectOwnerName`, `responsibilityName`, `status`) is asserted in `roles-and-work.test.ts`; `dashboardSummary`, `nextAction`, notification settings, milestones and phases stay absent; RESTRICTED and guessed identifiers answer `404` and their description text never appears in the body |
| 5 subproject description | PASS | `0009_subproject_description.sql` (`ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`); `SubprojectRow`/`toSubproject`/`SUBPROJECT_SELECT`/insert/update updated; `Subproject`, `CreateSubprojectBody` (max 2000), `PatchSubprojectBody` and `WorkSubproject` extended; manager `SubprojectForm` has a multiline Description field; manager project form gained the previously unwired Description field |
| 6 subproject information UI | PASS | Row keeps name, status, deadline and active/done counts; a preview sits under the name with an in-place `詳細を見る / View details` toggle; `white-space: pre-wrap` and `overflow-wrap: anywhere` keep line breaks without horizontal overflow; nested subprojects inherit it |
| 7 task description | PASS | Dedicated `作業内容・説明 / Task description` section renders the full description with preserved line breaks; project name link, subproject path, assignees, deadline, derived status, priority and skill grade are shown; empty text renders `説明なし / No description`; manager-only history and schedule sections are not rendered for a reader |
| 8 navigation | PASS | Breadcrumbs on project and task detail link only to readable records; My Work links the project and offers "Open"; explorer search term and page survive leaving and returning (`useRouteMemoryState`); smart Back and scroll memory unchanged |
| 9 My Work integration | PASS | My Work stays the personal list; a reader gets task name, project link, subproject name, deadline, status and an Open link, and no complete/report action; MEMBER keeps task creation and completion requests, VIEWER keeps none |
| 10 read-only authorization | PASS | `roles-and-work.test.ts` "refuses project, subproject and task mutations from MEMBER and VIEWER": create subproject, patch subproject/project/task and delete subproject answer `403`, `PATCH /api/work/projects/:id` answers `404`, and the stored subproject description stays unchanged; guessed RESTRICTED identifiers answer `404` |
| 11 performance | PASS | One bounded page per explorer request; counts come from the memoized `TaskScope` pass, never one query per card; task detail loads only when opened; member keys (`work/projects`, `work/project/<id>`) stay separate from `manager/*`; no new global state library. Measured at 1 000 projects / 10 000 tasks (15 samples): explorer p50 26.8 ms / p95 51.6 ms / 10 db calls / 7.9 KB, project detail p50 26.7 ms / p95 40.1 ms, task detail p50 2.8 ms / p95 3.2 ms ([PERFORMANCE.md](PERFORMANCE.md), `bench/results-2026-11-04T04-49-44-012Z.json`) |
| 12 regression tests | PASS | API (+7 tests: descriptions, name-only search, member-created description, permission refusals), contracts (+2), db integration (+2, incl. applying 0009 to a table that already holds rows), web (+7) and updated navigation/hierarchy/workflow expectations; V2 suite **298 passed, 1 skipped (299)**; V1 suite 776 passed |
| 13 validation | PASS | `npm run typecheck`, `npm run lint`, `npm run test:v2`, `npm run validate` (V1 `validate:v1`, V2 142 files, deploy templates), `npm run build`, `npm run smoke:prod` (schema 9, `/readyz` schema 9), `npm run test:browser` (real Chromium, member/viewer/manager journeys) and `npm run benchmark -- --dataset large --iterations 15` |
| 14 delivery | PASS | Evidence screenshots in `work/screenshots/`: `member-project-explorer-{member,viewer}{,-1920,-mobile}.png`, `member-project-detail-{member,viewer}{,-mobile}.png`, `member-task-detail-{member,viewer}.png`; Windows LAN steps in the section below |

Data preservation and rollback:

- The migration is additive and one-shot: `ALTER TABLE subprojects ADD COLUMN IF NOT EXISTS
  description TEXT NOT NULL DEFAULT ''`. No prior migration file was edited and no column is
  rewritten. `packages/db/test/integration.test.ts` drops the column and the ledger row from a
  database that already holds a subproject, re-applies the migration and asserts the identifier,
  project link, revision, next action and the new empty description.
- Rollback is a restore, not a reverse migration: verify the backup, stop the API and worker,
  restore into a fresh database, point `DATABASE_URL` at it and restart ([MIGRATION.md](MIGRATION.md)).

Remaining limitations:

- Colour reuse means the project accent is an identity aid, not a unique identifier; the project
  name is always visible.
- The explorer shows the project owner *name* only; member identifiers, e-mail addresses, roles and
  the private `MEMBERS` table are never exposed to a reader.
- A very long description is clamped on a card and fully readable on the detail page; there is no
  rich-text rendering by design (plain React text only).
- Live Workspace/LAN host behaviour, Google sign-in and physical recovery remain **NOT_RUN**: no
  live host, real credentials or company data were used. Production stays **NOT APPROVED FOR
  PRODUCTION**.

### Windows LAN rebuild and migration steps for this release

```powershell
# 0. From the repository root, with the release code checked out
npm ci
npm run typecheck
npm run lint:v2
npm run test:v2
npm run validate:v2
npm run build

# 1. Verified encrypted backup FIRST (a failure stops the upgrade)
./deploy/windows/Backup-Now.cmd

# 2. Apply the reviewed additive migration (schema 8 -> 9); type "APPLY MIGRATIONS"
./deploy/windows/Migrate-Lan.cmd

# 3. Confirm the ledger, readiness and preservation
psql "$env:DATABASE_URL" -c "SELECT version, name FROM schema_migrations ORDER BY version;"
Invoke-RestMethod http://localhost:8050/readyz      # 200, schemaVersion 9
node --env-file=data/lan/worker.env apps/worker/dist/cli.js verify-restore "C:/approved-recovery/backup.dump.enc"

# 4. Start (or restart) the LAN host only after 0-3 pass
./deploy/windows/Start-Lan.cmd
```

No step above was executed against an operational database during this review.

## Branding assets: company logo on sign-in, department logo in the header — 2026-11-04

Source/build-only visual change. No migration, schema, API route, authorization, notification or
publication change; no deployment, and no operational database was accessed. The supplied PNG files
are used as delivered: they are not redrawn, recoloured, cropped or resized on disk.

| Gate | Result | Evidence |
| --- | --- | --- |
| 0 assets | PASS | `apps/web/public/branding/companyLogo.png` (1672×941, RGBA) and `designTeam.png` (2172×724, RGB) are readable PNGs, not ignored by Git, and appear in `apps/web/dist/branding/` after `npm run build`. Supplied capitalisation is `companyLogo.png`, not `companylogo.png`; the code uses the real name |
| 1 sign-in | PASS | `/branding/companyLogo.png` renders above the local employee-ID/password form; Google sign-in and the development fixture paths are unchanged; the department logo never appears here |
| 2 authenticated header | PASS | `/branding/designTeam.png` replaces the `brand-symbol` span for ADMIN, MANAGER, MEMBER and VIEWER; language switch, account name, role pill, password change and sign out stay visible |
| 3 responsive | PASS | measured at 1920×1280, 1366×768 (ja and en) and 390×844: rendered aspect ratios equal the intrinsic ratios (1.777 and 3.000), brand and header actions never overlap, `documentElement.scrollWidth` never exceeds the viewport, header height 94 px desktop / 174 px narrow |
| 4 favicon | NOT_RUN | optional; both originals keep wide, mixed-scale lockups that are unreadable at 16 px, and no separate favicon asset was added |
| 5 compatibility | PASS | no change to PostgreSQL, API, authentication, roles, projects, tasks, assignment, completion, navigation or backup behaviour; Japanese and English both render |
| 6 verification | PASS | `npm run typecheck`, `npm run lint:v2`, `npm run validate:v2`, `npm run test:v2` (**280 pass, 1 skipped**) and `npm run build`; layout captured from a local Vite preview with a stubbed API (UI evidence, not a live run) |
| Live Workspace / LAN browser | NOT_RUN | no live host, deployment or real credentials were used for this review |

Production remains **NOT APPROVED FOR PRODUCTION**.

## ADMIN logical removal and smart Back — 2026-11-04

Baseline `80ed41bdf8b7847a464c4f8dbd836f77115788c3` with a clean working tree. Source/build
update only: migrations 0001–0008 and schema 8 are unchanged, no operational database was
accessed, no deployment was performed, and every PostgreSQL verification used the disposable
`freshDatabase()` or production-smoke database.

| Gate | Result | Evidence |
| --- | --- | --- |
| Gate 0 baseline | PASS | pre-change `npm test`; V1 and V2 suites green |
| Logical task removal | PASS | `deletion.test.ts`: INTERNAL task with edit audit, approved request, deadline history and historical assignee is marked `deleted_at`, revision 4→5, and disappears from active search |
| Evidence preservation | PASS | task row, audit, deadline, request and assignee rows remain; one `RECORD_REMOVED` records verified actor/reason; no foreign-key deletion |
| Role boundary | PASS | ADMIN succeeds; MANAGER, MEMBER, VIEWER receive `AUTHORIZATION_DENIED`; unauthenticated caller receives 401; hierarchy controls are ADMIN-only |
| Active blockers | PASS | named child task, active dependant, pending request, pending/leased outbox, approved assignment, Done/recorded effort; empty edited subproject succeeds while active child subproject/task/milestone refuses |
| Concurrency/idempotency | PASS | stale revision is `EDIT_CONFLICT`; row is locked and blockers rechecked in the transaction; repeat after success returns `alreadyRemoved` with one audit event |
| Background/publication safety | PASS | normal reads, request writes, reminders and Calendar reads require `deleted_at IS NULL`; task removal atomically queues deduplicated `publication.run` for the next verified A/B snapshot |
| Smart Back | PASS | unit cases cover Projects→Project, Project→Task, All Work→Task, My Work→Task, direct fallback, role-authorized fallback and external-route refusal |
| State preservation | PASS | filters, pagination, expanded task/subproject sets and scroll offsets use in-memory route state only; Chromium verifies Project→Task→Back with the expanded branch retained |
| Modal safety | PASS | Back is disabled while project/task editors, action dialogs or removal confirmation are open |
| Focused regressions | PASS | `deletion.test.ts` **21 pass**; hierarchy/navigation web tests **28 pass** |
| `npm run typecheck` | PASS | all workspaces |
| `npm run lint` | PASS | V1 and V2 ESLint |
| `npm test` | PASS | V1 **776 pass**; V2 **278 pass, 1 skipped** across 20 files |
| `npm run validate` | PASS | V1 source, V2 governance (**139 files**), deployment templates |
| `npm run build` | PASS | API, web, worker and migration production artifacts |
| `npm run smoke:prod` | PASS | schema 8, health/readiness/session/read/mutation, worker claim/completion and clean stop |
| `npm run test:browser` | PASS | Chromium hierarchy, smart Back, blocked removal, ADMIN logical removal, MANAGER/MEMBER/VIEWER journeys |
| `npm run test:lan` | PASS | local employee credentials, account onboarding, hierarchy/removal/navigation and all role journeys |
| Live production / Google Workspace | NOT_RUN | no production database, mailbox, Drive, Calendar or deployment was accessed |

Production remains **NOT APPROVED FOR PRODUCTION**.

## Project detail hierarchy and ADMIN-only permanent removal — 2026-11-04

Baseline `main @ 46a24f4`. Source/build update only: migrations 0001–0008 and their checksums are
unchanged, no new migration, no live database was touched and no deployment was performed. Every
database test used a disposable database (`freshDatabase()` truncation, `smoke:prod` isolated /
embedded PostgreSQL).

The project page is now one expandable hierarchy built only from the stored links
(`subprojects.parent_subproject_id`, `tasks.subproject_id`, `tasks.parent_task_id`). A subproject is
a header with its tasks immediately beneath it, nested subprojects follow, and tasks without a
subproject stay in a separate **Direct project tasks** section; nothing is grouped by name or by
render order and a task is never re-bucketed. ADMIN removes an eligible empty task or subproject
through the existing preflight, typed confirmation and reason; MANAGER keeps edit and create but
never receives a delete control, and MEMBER/VIEWER see a read-only tree.

The deletion preflight now treats `SUBPROJECT_CREATED` and `SUBPROJECT_UPDATED` as the complete
allowlist of non-operational subproject audit actions. It asks PostgreSQL whether any other action
exists across the full audit history; unknown actions remain blockers and no audit row is changed or
removed.

| Gate | Result | Evidence |
| --- | --- | --- |
| `npm run typecheck` | PASS | contracts, domain, db, i18n, api, web, worker, benchmark, migration |
| `npm run lint` | PASS | V1 and V2 ESLint clean |
| focused deletion/hierarchy tests | PASS | **38 pass** across `deletion.test.ts` and `project-hierarchy.test.tsx` |
| `npm test` | PASS | V1 **776 pass, 0 fail**; V2 **267 pass, 1 skipped** across 19 files (real PostgreSQL) |
| `npm run validate` | PASS | V1 source, V2 governance (137 files), deployment templates |
| `npm run build` | PASS | `@eh/api`, `@eh/web`, `@eh/worker`, `@eh/migration` |
| `npm run smoke:prod` | PASS | built CLI applied schema 8; health/readiness/session/read/mutation; worker job; clean stop |
| `npm run test:browser` | PASS | Chromium: hierarchy, contextual creation, blocked deletion, ADMIN removal, plus manager/member/viewer journeys |
| `npm run test:lan` | PASS | local auth journeys including the manager, member and viewer hierarchy checks |
| GATE 1 unified hierarchy | PASS | `project-hierarchy.test.ts` "project hierarchy model": task under subproject, direct task, nested subproject, nested task, multi-level nesting, siblings, empty subproject, no duplicate rendering, counts through nested subprojects, cancelled/archived filtering, archived ancestor hides its descendants |
| GATE 1 payload links | PASS | `deletion.test.ts` "project detail hierarchy payload": stored `parentSubprojectId`/`subprojectId` returned, MEMBER reader gets the links without restricted fields, archived branch withheld |
| GATE 2 presentation | PASS | tree renders header counts, deadline, badges, indented task rows and a task link; no per-row percentage bar; role-based action visibility asserted |
| GATE 3 contextual creation | PASS | browser smoke: "New task" inside a subproject opens the form with the subproject preselected and the task lands in that branch; project-level creation stays project-direct |
| GATE 4 permissions | PASS | ADMIN sees delete, MANAGER sees edit/create only, MEMBER and VIEWER see no action; `deletion.test.ts` "deletion authorization" refuses preflight and removal for MANAGER/MEMBER/VIEWER with `AUTHORIZATION_DENIED` and the row survives |
| GATE 4 deletion workflow | PASS | preflight dialog shows the target, the blockers and the exact confirmation; `deletion.test.ts` proves a newly created empty subproject and empty subprojects after one or three edits are removed with their complete audit history preserved, the correct snapshot in the tombstone, and `RECORD_DELETE_PREPARED` + `RECORD_DELETED` |
| GATE 4 blockers | PASS | subproject with tasks or a milestone (`HAS_TASKS`), nested children (`HAS_DESCENDANTS`), and an unknown disallowed action older than 101 allowed updates (`AUDIT_HISTORY`) are refused; task effort, publication and archive blockers remain covered |
| GATE 5 errors and refresh | PASS | stale revision and an edit after preflight return `EDIT_CONFLICT` with no removal, wrong phrase `CONFIRMATION_REQUIRED` and blank reason are refused, repeated removal reports `NOT_FOUND_OR_DELETED`, expansion state survives refresh, and successful deletion invalidates hierarchy/detail/list/index/reference caches |
| Deletion tombstone identity | PASS | the reported `tombstoneId` is now the stored `record_deletions` primary key instead of a derived label |
| Migrations / schema | PASS | no migration added or edited; `0001`–`0008` checksums unchanged; schema 8 remains required |
| Live Google Workspace / Drive / mail | NOT_RUN | no credential, tenant or mailbox was used |
| Physical second-PC LAN rehearsal | NOT_RUN | requires the operator host |

Production remains **NOT APPROVED FOR PRODUCTION**.

## Regression fixes: visibility, role-aware UI, list behaviour, partial edits — 2026-11-04

Baseline `main @ 3bc47fc`. Source/build update only: migrations 0001–0008 and their checksums are
unchanged, no live database was touched, and no deployment was performed. Every database test used a
disposable database (`freshDatabase()` truncation, `smoke:prod` isolated/embedded PostgreSQL).

| Gate | Result | Evidence |
| --- | --- | --- |
| `npm run typecheck` | PASS | contracts, domain, db, i18n, api, web, worker, benchmark, migration |
| `npm run lint` (V1 + V2) | PASS | eslint clean for both trees |
| `npm test` | PASS | V1 **776 pass, 0 fail**; V2 **229 pass, 1 skipped** across 17 files |
| `npm run validate` | PASS | V1 source, V2 governance (135 files), deployment templates |
| `npm run build` | PASS | API, web, worker, migration artifacts |
| `npm run smoke:prod` | PASS | built CLI applied schema 8; health/readiness/session/read/mutation; worker job; clean stop |
| `npm run test:browser` | PASS | Chromium: admin journey plus **MEMBER and VIEWER** read-only journeys |
| `npm run test:lan` | PASS | local auth: account provisioning, forced change, plus MEMBER and VIEWER journeys |
| GATE 1 visibility (API, real PostgreSQL) | PASS | `roles-and-work.test.ts` "project visibility policy": INTERNAL visible, RESTRICTED/archived/guessed IDs `404`, manager sees all, `includeInactive` `403` for MEMBER/VIEWER, allowlisted project record keys |
| GATE 1 DTO allowlist | PASS | read-only task record rebuilt from an allowlist; project record keys asserted exactly |
| GATE 2 read-only project endpoints | PASS | `/api/work/projects` paginated and role-filtered; `/api/work/projects/:id` `404` for RESTRICTED/archived/guessed |
| GATE 2 role-aware UI | PASS | `workflows.test.tsx` project-picker scope, manager My Work actions, MEMBER restrictions; browser journeys per role |
| GATE 3 list behaviour | PASS | "active list behaviour": Done excluded by default for MEMBER and MANAGER, `displayStatus=DONE` returns it, pagination total 30 across 2 pages, tree `matchedTotal` 1 with the parent retained |
| GATE 4 partial patch | PASS | "partial edits preserve recorded data": name-only patch keeps deadline, planned start, hours, progress, duration, assignment; deadline change without duration keeps the stored start |
| GATE 4 inactive assignee | PASS | existing inactive assignee preserved; new inactive assignment refused and writes nothing |
| GATE 4 requester filter | PASS | submitter sees `pendingRequest`/`reviewState`, the other assignee does not |
| GATE 5 startup | PASS | `schema readiness` test: `503 DATABASE_MIGRATION_REQUIRED` when the ledger is behind, `200` after restore |
| Live Google Workspace / Drive / mail | NOT_RUN | no credential, tenant or mailbox was used |
| Physical second-PC LAN rehearsal | NOT_RUN | requires the operator host |

Production remains **NOT APPROVED FOR PRODUCTION**.

## Unified account, role, task and UI simplification — 2026-11-03

Baseline `main @ c0cee21201531ffd2b6c13cca6de79b160ed6b96` with a clean worktree. This is a
source/build update, not a deployment. **No new migration**: schema 8 (including the unchanged
checksummed `0008_member_created_work`) is the required schema, and no operational database was
touched. V1 Apps Script code, the published employee contract 1.6 and every earlier gate record
are unchanged.

| Gate | Result | Evidence |
| --- | --- | --- |
| `npm run typecheck` (all workspaces) | PASS | contracts, domain, db, i18n, api, web, worker, benchmark, migration |
| `npm run lint` (V1 + V2) | PASS | `eslint src dashboard-app shared scripts tests` and `eslint apps packages tools` clean |
| `npm test` | PASS | V1 **776 pass, 0 fail**; V2 **213 pass, 1 skipped** across 17 files (real PostgreSQL 18.6) |
| `npm run validate` | PASS | V1 source, V2 governance (135 files), deployment templates |
| `npm run build` | PASS | `@eh/api`, `@eh/web`, `@eh/worker`, `@eh/migration` |
| `npm run smoke:prod` | PASS | built migration CLI applied schema 8; `readyz` reported schema 8; session, authorized read and mutation, worker job, clean stop |
| Accounts: create, link, duplicates, leading zeros | PASS | `apps/api/test/roles-and-work.test.ts`, `local-auth.test.ts` — new employee + login atomically, link to an existing member keeps name/role/count, duplicate employee number and second login refused, `0050`/`0001` preserved, idempotent retry replays |
| Account authorization | PASS | ADMIN-only create/list/reset; MANAGER, MEMBER and VIEWER refused (403); password hashes never returned |
| My Work isolation | PASS | per-role personal lists from the session identity; a removed assignee loses visibility; a re-added assignee regains it |
| Role matrix (read/write) | PASS | MEMBER reads `/api/work/tasks` but every manager write is 403 and a forged `assigneeIds` payload is a 400; VIEWER read-only, cannot request or complete; unauthenticated caller refused by the session middleware |
| Completion authority | PASS | MANAGER approves a member-created request exactly once; MANAGER completes own and other authorized tasks directly; MEMBER direct completion 403; container completion 409 |
| Direct completion reconciliation | PASS | pending completion report becomes `WITHDRAWN`; `TASK_COMPLETED_DIRECT` audit row records actor, role, source and final state |
| Multi-assignee | PASS | deterministic primary owner (lowest member ID, current owner preserved), one logical patch, historical row retained as a soft removal, every assignee sees the task |
| Derived status | PASS | yesterday/today/tomorrow, month/year boundary, Saturday/Sunday, Culture Day, Done-over-Overdue, legacy statuses, Tokyo instant boundary; stored status unchanged |
| A-D skill grades | PASS | A=4…D=1, 0/null/undefined stay not assessed, unknown grade and out-of-range level refused |
| Weekend/holiday deadline | PASS | no `NON_WORKING_DEADLINE` warning and no acknowledgement requirement |
| Schema compatibility | PASS | `/readyz` answers `503 DATABASE_MIGRATION_REQUIRED` with `requiredSchemaVersion: 8` when the ledger is older, and `200` after it is restored |
| `npm run test:browser` | PASS | Chromium against the built app and isolated schema-8 database: Japanese sign-in, language switch, project create/edit, task create with parent, expandable tree collapse/reopen, responsive overview, sign-out |
| `npm run test:lan` | PASS | Local mode: administrator account creation for `0009`, forced temporary-password change, employee sign-in landing on My assigned work without the Accounts link |
| Real Google Workspace / Drive / mail | NOT_RUN | no credential, tenant or mailbox was used |

Production remains **NOT APPROVED FOR PRODUCTION**.

## Corrective follow-up and expandable task tree — 2026-11-03

Reviewed latest origin/main at 7f5d9e2 with a clean starting worktree; during continuation,
HEAD advanced to 5581a1e containing the earlier self-service/backup changes. Those changes were
preserved; the tree and compatibility follow-up build on that head. This is a source/build update,
not a deployment. No new migration: schema 8 and the existing checksummed migrations are unchanged.
V1 runtime and historical gate files are unchanged. Operational database URLs were removed from
validation subprocesses; database tests used isolated embedded PostgreSQL with REQUIRE_DATABASE=1.

| Gate | Result | Evidence |
| --- | --- | --- |
| npm ci | PASS | Locked install; Node 24.21.0. npm reports 17 moderate dependency advisories; no forced dependency upgrade applied. |
| npm test | PASS | 776 V1 tests; 190 V2 tests across 15 files, zero skipped with TEST_PG_BIN_DIR pointing to PostgreSQL 18 clients. |
| Targeted follow-up | PASS | API suite 37 tests after legacy idempotency replay preservation; UI workflow suite 9 tests after container-feedback correction. |
| npm run build | PASS | API, web, worker and migration artifacts built. |
| npm run validate | PASS | V1/V2 governance and deployment templates. |
| npm run lint / typecheck | PASS | Final checks include tree fixtures and backward-compatible creation replay; explicit required-date fixtures corrected. |
| Built artifact and Chromium local-login smoke | PASS | Isolated schema-8 migration; API health/readiness/auth/mutation; worker job; local account provisioning and password change; child-task create, placement, collapse/reopen; responsive overview and sign-out. |
| Task tree API/UI | PASS | Server-side ancestry before paging, root pages, 27-child branch pagination, MEMBER refusal, nested expansion retention and cached reopening. |
| Member workflows | PASS | Repeated creation (including HTTP-LAN randomUUID fallback), identity-scoped keys, legacy-key replay, receipt isolation, verified requester, restricted-project submission, ADMIN-only member-created completion. |
| Drive transport | PASS (mock) | 11 cases include 9 MiB upload, interrupted chunk, persisted session, expired session, reserved file ID and 409 reconciliation, folder permissions and missing Range. Local checkpoint stays out of database status. |
| Encrypted custom-format restore | PASS (local) | pg_dump -> AES-GCM file -> read-back -> pg_restore into a separate scratch database; restored data checked and source retained. Scratch removed afterwards. |
| Real Drive upload/download | NOT_RUN | Requires real service account and Shared Drive. Local file read-back is not a cloud download. |
| Physical LAN installation | NOT_RUN | Second PC, firewall, reboot, scheduled backup and recovery-host rehearsal require operator verification. |

Browser evidence: work/screenshots/task-tree-desktop.png. Local command logs were retained outside
the repository under the operator's .codex directory (eh-complete-tests, eh-ready-browser,
eh-legacy-compat and final verification logs). Initial SQL-placeholder and browser-locator failures
were corrected and the relevant suites rerun successfully. Earlier records below remain historical.
Production remains **NOT APPROVED FOR PRODUCTION**.


## Member self-service, completion approval and Drive backup — 2026-11-03

Schema **8** (migration `0008_member_created_work`, additive). Employee contract 1.6, migrations
0001–0007, the V1 Apps Script project and the published contracts are unchanged.

| Gate | Result | Evidence |
| --- | --- | --- |
| `npm run typecheck` (all workspaces) | PASS | `tsc -p` clean for contracts, domain, db, i18n, api, web, worker, migration, benchmark |
| `npm run lint` (V1 + V2) | PASS | `eslint src dashboard-app shared scripts tests` and `eslint apps packages tools` clean |
| `npm test` | PASS | V1 **776 pass, 0 fail**; V2 **177 pass, 1 skipped** across 15 files (real PostgreSQL 18.6) |
| `npm run validate` | PASS | V1 source (42 manager files, 3 dashboard files, 970 keys), V2 governance (128 files), deployment templates |
| `npm run build` | PASS | `@eh/api`, `@eh/web`, `@eh/worker`, `@eh/migration` |
| `npm run smoke:prod` | PASS | built migration CLI applied schema 8 (including 0008), built API health/readiness/session/read/mutation, built worker outbox job, clean stop |
| `npm run test:browser` | PASS | Chromium: Japanese login, language switch, project create/edit, task create, list refresh, responsive layout, sign-out |
| Member task creation (API) | PASS | `api.test.ts` — ownership from the session, `Not Started`/0 %, visible in My Work and the manager list, idempotent replay, strict payload refusal, VIEWER/MANAGER/archived/cross-project refusal, active-project options only |
| Completion requests (API) | PASS | pending does not complete; MANAGER refused for a member-created task and the request stays `PENDING`; ADMIN approval completes; rejection leaves work unfinished; receipts isolated per member |
| Google Drive upload | PASS (mock) / NOT_RUN (live) | resumable chunk upload, resume after a lost chunk, permission and folder-type errors, no duplicate copy, local backup kept — `apps/worker/test/drive.test.ts`, `persistent-backup.test.ts`. Real service account, Shared Drive and live download are **NOT_RUN**. |
| Restore verification | PASS (logical + refusal) / NOT_RUN (client tools) | `backup.test.ts` logical round trip and production-target refusal; `pg_restore` from a downloaded file is **NOT_RUN** on a host without client tools |
| Physical Windows-host checks (firewall, second PC, reboot, scheduled backup) | NOT_RUN | requires the real host |

No live Google credential, Workspace tenant, Drive folder or deployment host was used.

## Local LAN update — 2026-11-02

[LOCAL_LAN.md](LOCAL_LAN.md) specifies the employee-ID/password mode, schema 7, optional email, first-login change, administrator reset, employee-owned progress editing, Windows launcher, durable local backup and optional Shared Drive upload. It supersedes Google-only or Linux-only assumptions below for this mode. [Verification record](LOCAL_LAN_ACCEPTANCE.md).

## Update — 2026-11-01

See [RELEASE_HARDENING.md](RELEASE_HARDENING.md) for the current UI, concurrency, delivery, Calendar and performance changes and unresolved release blockers. The dated records below are historical; they do not establish complete feature parity or production approval.

Current local verification: typecheck and lint PASS; V1 regression PASS; V2 **142 passed, 1 skipped** across 12 files. The skipped test requires unavailable pg_dump client binaries. V1/V2/deployment-template validation PASS. Production build PASS; Chromium built-artifact workflow smoke PASS, including worker outbox processing. No live tenant or deployment host was tested. Fastify emits a disableRequestLogging deprecation warning; this remains a maintenance item before a major framework upgrade.


Status vocabulary: **PASS** (verified locally with the stated evidence), **FAIL** (verified and
broken), **BLOCKED** (cannot be verified here — missing credential, Workspace, DNS or host),
**NOT_RUN** (not attempted).

Everything below was produced on a local Windows development host on 2026-10-30/31. No production
system, Google resource or real mailbox was touched. `docs/PRODUCTION_READINESS.md` stays
**NOT APPROVED FOR PRODUCTION**.

## 1. Gate commands

| Command | Result | Evidence |
| --- | --- | --- |
| `npm ci` | PASS | workspace install, lockfile in sync |
| `npm run typecheck` (all workspaces) | PASS | `tsc -p` clean for contracts, domain, db, i18n, api, web, worker, migration, benchmark |
| `npm run lint` (V1 + V2) | PASS | `eslint src dashboard-app shared scripts tests` and `eslint apps packages tools` clean |
| `npm test` | PASS | V1: **776 pass, 0 fail**; V2: **128 pass, 0 fail** across 10 files (real PostgreSQL 18.6) |
| `npm run validate` | PASS | V1 source validation (42 manager files, 3 dashboard files, manifests, 970 keys), V2 governance (108 files) and deployment templates (`validate:deploy`) |
| `npm run build` | PASS | `@eh/api`, `@eh/web`, `@eh/worker`, `@eh/migration` |
| `npm run smoke:prod` | PASS | built migration CLI + built API: health, readiness, session fixture, authorized read, authorized mutation, clean stop |
| `npm run benchmark` | PASS (small dataset) | measured, recorded in [PERFORMANCE.md](./PERFORMANCE.md) and [STABILIZATION.md](./STABILIZATION.md) |
| `npm run migration -- …` on the fixture snapshot | PASS | see §5 |
| Container build / `docker compose config` / `caddy validate` | BLOCKED (local) | no container runtime on the review host; CI runs the compose and Caddy validation and the image build |

The detailed defect-by-defect record of the stabilization pass (fix locations, regression tests and
the remaining PARTIAL/BLOCKED items) is [STABILIZATION.md](./STABILIZATION.md). A passing build was
previously mistaken for a working artifact; that specific gap is now closed and proven by
`npm run smoke:prod`.

## 2. Product requirements

| Requirement | Status | Evidence |
| --- | --- | --- |
| Every V1 manager feature exists in V2 | PARTIAL | [FEATURE_PARITY.md](./FEATURE_PARITY.md) — the per-workflow audit is incomplete; see [STABILIZATION.md](./STABILIZATION.md) §7. A table or a domain function alone is not accepted as a feature. |
| Every V1 employee feature exists (list, filter, deadline request, completion report, submission states, switch) | PASS | `apps/web/src/screens/Overview.tsx`, `POST /api/employee/requests`, `api.test.ts` |
| Identifiers, enum values and Japanese terms unchanged | PASS | migration preserves IDs; `packages/domain` enums match V1; 廃止/再有効化 and 退職/復職 kept |
| Permission model preserved (ADMIN/MANAGER/MEMBER/VIEWER, no self-change, last admin) | PASS | `packages/domain/src/roles.ts` + `api.test.ts` role tests |
| Counting, progress, hierarchy, planning and request rules preserved | PASS | `packages/domain/test/domain.test.ts` (39 tests) |
| Data model complete in PostgreSQL | PASS | `packages/db/src/migrations/0001…0006`, `integration.test.ts` (19 tests) |
| V1 → V2 migration tool with dry run, reconciliation, preservation | PASS (fixture) | `tools/migration/test/migration.test.ts` (10 tests); every mapped table and the relationship tables are reconciled |
| Employee publication allowlist and privacy boundary | PASS | `packages/contracts/test/contracts.test.ts`, `api.test.ts` |
| Notifications gated, logged, deduplicated, uncertain never retried | PASS (transport doubles) | `apps/worker/src/jobs.ts`, `apps/worker/test/delivery.test.ts`, `domain.test.ts` policy tests |
| Crash-safe delivery attempts and worker leases | PASS | `packages/db/test/integration.test.ts` (lease ownership, attempt ownership, reconciliation, explicit retry) |
| Backups encrypted and restorable | PARTIAL | `apps/worker/test/backup.test.ts` (4 tests, logical path); `pg_dump`/`pg_restore` round trip and Drive upload/restore are NOT_RUN |
| Response time targets | PASS locally (small dataset) | [PERFORMANCE.md](./PERFORMANCE.md) and [STABILIZATION.md](./STABILIZATION.md) §6; office-LAN, remote and proxy measurements are NOT_RUN |
| Responsive, Japanese-first UI with the language switch | PASS | `apps/web`, `apps/web/test/ui.test.tsx` |
| Self-hosting and remote access configuration | PASS (templates) / BLOCKED (live) | `deploy/`, `npm run validate`; live TLS and tunnel are BLOCKED |
| Documentation complete | PASS | twelve `docs/v2` documents plus root README/README_JP/AGENTS/ARCHITECTURE/DATA_SCHEMA/DEPLOYMENT/BACKUP_RESTORE/CHANGELOG updates |

## 3. Security requirements

| Requirement | Status | Evidence |
| --- | --- | --- |
| Identity from a verified Google ID token, then a database role | PASS (local verification logic, dev fixture) | `apps/api/src/auth/auth.ts` verifies signature, issuer, audience, expiry, verified address and hosted domain; live Google exchange BLOCKED |
| Stable identity binding | PASS | `members.google_subject` (migration `0006`); a first verified sign-in links once with `IDENTITY_LINKED`, a different subject is refused (`api.test.ts`) |
| Authorization re-checked server-side on every entry point | PASS | `api.test.ts`: unauthenticated 401, MEMBER refused on a manager read, role change effective immediately |
| CSRF header and origin check on every mutation | PASS | `api.test.ts` |
| Revision-checked partial patch, `EDIT_CONFLICT` | PASS | `integration.test.ts`, `api.test.ts` |
| Idempotent create | PASS | `api.test.ts` (same key returns the first result) |
| No browser-supplied authority | PASS | request schemas reject actor/role/owner; `validate-v2` scans persistence keys |
| Container completion refused in domain, import and trigger | PASS | `domain.test.ts`, `integration.test.ts`, `api.test.ts` |
| Append-only audit and deadline history | PASS | `integration.test.ts` (trigger refusal) |
| Deletion limited to empty records with tombstone | PASS | `domain.test.ts` (preflight blockers incl. deadline/schedule history), `services/deletion.ts`; the target row is locked and re-evaluated inside the deleting transaction |
| No stored text rendered as HTML | PASS | React only; `validate-v2` HTML-sink rule |
| Secrets never committed | PASS | `validate-v2` secret scan, `.env.example` placeholders, `.gitignore` |
| Mail OFF by default, emergency stop, LIVE preflight, uncertain never retried | PASS (policy) | `domain.test.ts` OFF/PREVIEW/LIVE matrix, ledger states |
| BACKUP encryption with an external key | PASS | `backup.test.ts` (wrong key refused) |
| Penetration test | NOT_RUN | outside this work |

## 4. Data and migration requirements

| Requirement | Status | Evidence |
| --- | --- | --- |
| Schema, constraints, triggers applied by a checksummed migration runner | PASS | `packages/db/test/integration.test.ts`, `db:migrate` |
| An applied migration file cannot change silently | PASS | checksum comparison raises an error |
| Import refuses a populated database unless explicitly allowed | PASS | `migration.test.ts` |
| Dry run leaves no row behind | PASS | `migration.test.ts` |
| Identifier, timestamp and history preservation | PASS (fixture) | `migration.test.ts` reconciliation |
| Automation forced OFF after import | PASS | `migration.test.ts` |
| Custom columns and formulas reported, not dropped silently | PASS | `inventory` report, `migration.test.ts` |
| Reading the real V1 workbook | BLOCKED | needs `spreadsheets.readonly` service account |
| Production import and cut-over | NOT_RUN | needs an approved change window |

## 5. Migration evidence detail

* Fixture: `tools/migration/fixtures/v1-snapshot.json` (members, responsibilities, projects,
  subprojects, tasks with dependencies, assignees, skills, requests, deadline history, audit,
  settings).
* `inventory` lists known headers, custom columns and formula cells.
* `validate` reports zero ERROR on the fixture; the negative tests inject a duplicate ID, an unknown
  reference, a bad date and a cycle and expect exit code 1.
* `import` (fresh database) inserts every row in one transaction, then `reconcile --run <id>`
  returns `ok: true` with per-table counts and a field checksum; a tampered row is detected.
* `import --dry-run` performs the same work and rolls back; the test asserts the tables are empty.

## 6. What is not verified (explicit)

| Item | Status | Why |
| --- | --- | --- |
| Google sign-in against the real OAuth client | BLOCKED | no client ID/secret and no Workspace |
| Gmail send, Calendar event, Drive upload, Sheets append | BLOCKED | no service account with delegation |
| Notification delivery, reminder and Calendar behaviour in a live mailbox | BLOCKED | same |
| Published snapshot in the real spreadsheet | BLOCKED | no destination spreadsheet |
| Public TLS certificate, Cloudflare Tunnel, external device access | BLOCKED | no DNS, no host, no tunnel |
| `pg_dump`/`pg_restore` backup and restore, and RTO | NOT_RUN | embedded PostgreSQL ships no client tools |
| Production dataset volume, concurrency and load test | NOT_RUN | local benchmark only, single client |
| Live Workspace latency and quotas | NOT_RUN | requires a live tenant |
| Browser compatibility matrix (Safari/iOS/Android) | NOT_RUN | only the build and jsdom tests ran |
| Accessibility audit | NOT_RUN | outside this work |
| Production approval | **NOT APPROVED** | see `docs/PRODUCTION_READINESS.md` |

## 7. Known limitations accepted for this record

1. The employee request path is authenticated by the company Google account but has no
   owner-match check — a deliberate product rule, not a defect.
2. Rate limiting is per process; a multi-instance deployment should move it to the proxy.
3. No WAL archiving: RPO equals the last successful backup.
4. The workload report, the requests queue (unpaginated) and the employee snapshot grow with open
   or published volume; see the growth table in [PERFORMANCE.md](./PERFORMANCE.md).
5. `audit_id` serial values are not preserved from V1 (timestamps, actors, actions and values are).
6. The root `package.json` keeps the V1 release version because the V1 release tests read it; the
   V2 version is `APP_VERSION` in `packages/contracts`.

## 8. Sign-off

| Role | Name | Date | Decision |
| --- | --- | --- | --- |
| Implementation (AI assistant, Copilot SDK in VS Code) | — | 2026-10-31 | Local implementation complete; live verification **BLOCKED**; production **NOT APPROVED** |
| Reviewer | _pending_ | — | — |
| Deployment authorisation | _pending_ | — | — |

## Member self-rename correction — 2026-11-03

- PASS: targeted API/local-authentication suites, 36 tests, using isolated embedded PostgreSQL with REQUIRE_DATABASE=1 and external database URLs removed. The regression confirms a name-only self-edit preserves ADMIN, active state, manager and capacity, keeps the current session usable, and continues to refuse explicit self-demotion.
- PASS: ESLint for the three changed source/test files; npm run typecheck; npm run validate.
- NOT_RUN: updated browser flow on the live LAN host; no rebuild, restart or live database mutation performed.
- Earlier evidence remains historical. Production readiness remains NOT APPROVED FOR PRODUCTION.
