# V2 Acceptance Record

## Responsibility area removal: hide retired areas and ADMIN deletion — 2026-11-04

Implemented on reviewed HEAD `fab33c355b84879aba9c03cdac061d25627c8950` with a clean worktree. No
production database, deployment, publication, mail or external service was accessed. Every database
test used the repository's disposable PostgreSQL (`freshDatabase()` truncation, embedded smoke
cluster) and the schema-11 migration was applied only there.

The 分野 screen now hides retired areas by default (`廃止済みを表示` / **Show retired**, remembered in
route memory), keeps retire/reactivate as status changes that rewrite no project, and offers an
ADMIN-only **分野を削除** action. The delete path is a new server-checked preflight plus
`DELETE /api/admin/responsibilities/:id`, gated by `record_deletions` (schema 11) and the same
append-only audit contract as project/subproject/task deletion.

| Gate | Result | Evidence |
| --- | --- | --- |
| Gate 0 inspection | PASS | inspected `Responsibilities.tsx`, `i18n.tsx`, `services/directory.ts`, `routes/manager.ts`, `repo/directory.ts`, every migration, the contracts, and every downstream reference to `responsibilities.responsibility_id` (`projects`, `responsibility_members`, `audit_log`, `record_deletions`, `published_snapshots`, `outbox_jobs`) |
| Gate 1 hide retired | PASS | `visibleResponsibilities()` filters the default list; retired rows are never deleted or rewritten; the toggle is route memory (`responsibilities:showRetired`); `responsibility-filter.test.ts` (4) and `responsibilities-screen.test.tsx` "hides retired areas by default and reveals them with the toggle"; browser smoke retires an area and proves it disappears and returns through **Show retired**; `responsibility-deletion.test.ts` retires and reactivates an area while the referencing project keeps its responsibility |
| Gate 1 empty state | PASS | `responsibilities-screen.test.tsx` "shows an actionable empty state when every area is retired"; a filtered-empty view uses a separate message |
| Gate 2 ADMIN delete control | PASS | `responsibilities-screen.test.tsx` "offers the delete action to ADMIN only": ADMIN sees 分野を削除, MANAGER keeps 編集/廃止 and never receives the delete control; the endpoint refuses MANAGER, MEMBER and VIEWER with `AUTHORIZATION_DENIED` (`responsibility-deletion.test.ts`) |
| Gate 3 preflight | PASS | `GET /api/admin/responsibilities/:id/delete-preflight` returns `projectCount`, `archivedProjectCount`, `deletedProjectCount`, `activeMemberCount`, `historicalMemberCount`, `auditReferenceCount`, `publishedReferenceCount`, `activeJobCount`, `erasePlan`, `confirmationText` and the revision; active, archived and logically deleted projects all block; membership links alone do not; an unknown/already deleted identifier reports `NOT_FOUND_OR_DELETED` |
| Gate 4 deletion endpoint | PASS | `DELETE /api/admin/responsibilities/:id` validates the id, revision, confirmation and optional reason, re-runs the preflight under `FOR UPDATE` inside the transaction, writes `RECORD_DELETE_PREPARED`, the tombstone (with the member-link snapshot), removes only `responsibility_members` and the responsibility row, then writes `RECORD_DELETED`; no `ON DELETE CASCADE` exists and no project, task or member row is touched |
| Gate 4 concurrency | PASS | `responsibility-deletion.test.ts` "refuses a stale revision, a wrong phrase and a project added after the preflight" and "reports a repeated deletion instead of double-deleting" (one tombstone, one `RECORD_DELETED`) |
| Gate 5 confirmation UI | PASS | eligible dialog: 分野を削除 with 「…」を削除しますか？この操作は元に戻せません。 and キャンセル / 削除 (the client derives `DELETE <id>`); blocked dialog: 削除できません。 + 関連プロジェクト: {n}件 + キャンセル / 廃止する and no delete button; success closes the dialog, shows the notice and invalidates responsibilities, references, overview, projects, tasks and employee caches |
| Gate 6 terminology | PASS | Japanese 分野 / 新規分野 / 分野を編集 / 分野を削除 / 廃止済みを表示; English Responsibility / New responsibility / Edit responsibility / Delete responsibility / Show retired; no table, identifier, API field or stored status renamed |
| Gate 7 regression | PASS | `responsibility-deletion.test.ts` (**9**), `responsibility-filter.test.ts` (**4**), `responsibilities-screen.test.tsx` (**5**) plus the updated `readability.test.tsx` retired-label check |
| `npm run typecheck` | PASS | api, web, worker, contracts, db, domain, i18n, benchmark, migration |
| `npm run lint:v2` | PASS | ESLint clean |
| `npm run test:v2` (`REQUIRE_DATABASE=1`) | PASS | **385 passed, 1 skipped** across **31** files against real PostgreSQL; no suite skipped |
| `npm run validate:v2` | PASS | **162 files checked** |
| `npm run build` | PASS | `@eh/api`, `@eh/web`, `@eh/worker`, `@eh/migration` |
| `npm run smoke:prod` | PASS | built migration CLI applied schema **11**; built API health/readiness/session/read/mutation; built worker job; clean stop |
| `npm run test:browser` | PASS | Chromium: existing journeys plus "Responsibility areas: retired hidden by default, ADMIN deletes an unused area" |
| Migration / schema | PASS | new additive `0011_responsibility_deletions.sql` (extends the `record_deletions` entity allowlist, rewrites no row); `REQUIRED_SCHEMA_VERSION` and `DB_SCHEMA_VERSION` are 11; `/readyz` refuses a schema-10 database |
| Live Workspace / Google / production | NOT_RUN | no credential, tenant, mailbox, Drive or production database was used; no deployment or migration of an operational database was performed |

Production remains **NOT APPROVED FOR PRODUCTION**.

## Corrected logical removal of tasks with retained history — 2026-11-04

Implemented on reviewed HEAD `595b13356401d3743e9fe5255a98459f4ba51961` while preserving the
pre-existing dirty worktree. No production database, deployment, migration, publication, mail or
external service was accessed. PostgreSQL validation used the repository's freshly migrated,
disposable test/smoke databases.

| Gate | Result | Evidence |
| --- | --- | --- |
| Root cause | PASS | `evaluateRemoval()` treated `Done`, nonzero `actual_hours` and `assignment_approved_at` as logical-removal blockers, even though logical removal retains the row and its evidence. |
| Normal ADMIN removal | PASS | `POST /api/admin/tasks/:id/remove` now permits retained completion, assignment-approval, schedule-confirmation, audit and effort evidence. Active children, inbound dependencies, pending requests and pending/leased notification work still block the transactionally re-evaluated removal. |
| Audit and data preservation | PASS | Successful removal writes `tasks.deleted_at`, increments `revision`, retains all historical rows, records `RECORD_REMOVED` with reason, actor, previous status and previous revision, and enqueues the deduplicated publication outbox job. |
| UI | PASS | The shared dialog offers an ordinary task removal confirmation without a typed ID. A task with retained completion/approval evidence shows the completed-task warning and requires an administrative reason; the Task Detail screen exposes the same ADMIN-only dialog. Permanent erasure remains a separate advanced action. |
| Regression coverage | PASS | `apps/api/test/deletion.test.ts` (23 tests) now covers a Done task with assignment approval, schedule confirmation, recorded effort, and `ASSIGNMENT_APPROVED`, `SCHEDULE_CONFIRMED`, `TASK_COMPLETED_DIRECT` and `COMPLETION_OVERRIDDEN` audit records; logical removal succeeds while evidence remains and physical purge remains separately protected. |
| Required checks | PASS | `npm run typecheck`; `npm run lint:v2`; `npm run test:v2` (**349 passed, 1 skipped**, 26 files); `npm run validate:v2` (**152 files checked**); `npm run build`; `npm run smoke:prod`; `npm run test:browser`. Smoke and browser checks used isolated PostgreSQL and completed successfully. |
| Production / deployment | NOT_RUN | No production data was touched, no migration was run against an operational database, and no deployment was performed. |

Production remains **NOT APPROVED FOR PRODUCTION**.

## Unified task removal and mistaken-record purge — 2026-11-04

Latest local working tree; pre-existing uncommitted Overview, workload, navigation, database and
documentation changes were preserved. No production database or deployment was accessed. All
database tests used `freshDatabase()` and disposable PostgreSQL.

| Gate | Result | Evidence |
| --- | --- | --- |
| Gate 0 inspection | PASS | inspected All Work, Project Detail, deletion service/routes, lifecycle policy, workflow repository, every PostgreSQL task foreign key, append-only audit/deadline triggers and existing dirty worktree |
| Gate 1 normal deletion | PASS | shared `DeleteEntityDialog`; both screens call removal preflight + `POST /api/admin/tasks/:id/remove`; no typed ID/reason; ADMIN-only controls and server role check; success invalidates All Work, project structure, My Work, Overview, workload and employee projections |
| Gate 2 effort classification | PASS | Done/approved completion/audited hours are protected; an uncorroborated nonzero legacy value is `UNVERIFIED_LEGACY_EFFORT` with its exact value and is retained rather than assumed or erased |
| Gate 3 physical purge | PASS | separate **Permanently erase mistaken record** UI; exact erase plan; reason + typed confirmation; row lock and second preflight in the deleting transaction; task-assignee/outgoing-dependency rows only; durable tombstone plus prepared/deleted audit |
| Integrity evidence | PASS | child rows (including removed rows), incoming dependencies, requests, deadline history, schedule confirmations, notifications, active jobs, issues, Calendar links, protected audit and stored publication snapshot references block purge; INTERNAL alone does not |
| Focused web tests | PASS | `project-hierarchy.test.tsx` + `workflows.test.tsx`: **37 passed**; includes shared logical removal, no physical DELETE call, advanced erase plan and purge request |
| Focused PostgreSQL tests | PASS | `deletion.test.ts`: **23 passed** against disposable PostgreSQL, including transaction cleanup, tombstone/audit retention, publication classification and effort classification |
| Full V2 tests | PASS | `REQUIRE_DATABASE=1 npm run test:v2`: **349 passed, 1 skipped** across 26 files; database suites were required rather than silently skipped |
| Typecheck / lint / build | PASS | `npm run typecheck`; `npm run lint:v2`; `npm run build` for API, web, worker and migration CLI |
| Validation | PASS | `npm run validate:v2`: **152 files checked** |
| Production artifact smoke | PASS | `npm run smoke:prod`: built migration CLI applied schema 10 to isolated PostgreSQL; built API health/readiness/session/read/mutation and built worker claim/completion passed |
| Browser regression | PASS | `npm run test:browser`: Chromium hierarchy, contextual creation, blocked deletion, ADMIN logical removal, manager/member/viewer journeys, list refresh and responsive flow |
| Production / deployment | NOT_RUN | no live production database, deployment, mailbox, Drive, Calendar or publication operation was used |

Production remains **NOT APPROVED FOR PRODUCTION**.

## Crimson Overview, deadline windows and KPI navigation — 2026-11-04

Implemented on HEAD `b457a39dedb463c1638ffb44c5c405bd28b24f1b` while preserving the
pre-existing uncommitted workload, branding, hierarchy and operating-document changes. Baseline
before this feature: `npm run typecheck` PASS and `npm run test:v2` **332 passed, 1 skipped** across
24 files. No schema, migration or operational PostgreSQL data changed; all database validation
used `freshDatabase()` or the smoke harness's disposable PostgreSQL instance.

| Gate | Result | Evidence |
| --- | --- | --- |
| 0 baseline and preservation | PASS | HEAD above; dirty tree recorded before edits; supplied `companyLogo.png` and `designTeam.png` remained unmodified; no migration/deployment/operational write |
| 1 crimson theme | PASS | approved `#A8182F` / `#871326` / `#FBECEF` brand palette and warm surface/border/text values in `styles.css`; prior V2 blue/indigo brand literals are absent; semantic info `#176B87`, overdue red, completed green and pending amber remain distinct; stable project accents unchanged |
| 2 deadline selector | PASS | first visit 7 days; 7/14/30 options kept in page-only route memory; exact inclusive windows are `today + 6/13/29`, weekends included; API returns `upcomingWindow { days, from, to }` |
| 3 strict Overview API | PASS | `OverviewQuery` accepts only `7`, `14`, `30` and exact boolean scope; unsupported `365` returns 400; responsibility predicates and leaf/active-work predicates execute in PostgreSQL before the 20-row limit |
| 4 overdue section | PASS | independent of selected upcoming window, oldest deadline first, 10-row server limit plus `overdueTotal` and View all; task/project links, assignees, deadline, days overdue, derived red status and pending-request badge |
| 5 clickable KPI cards | PASS | real buttons with focus/accessible names; Open → `workState=OPEN`, Overdue → `displayStatus=OVERDUE`, Completed → `displayStatus=DONE`; container card intentionally remains non-clickable |
| 6 responsibility scope | PASS | responsibility ID or `unassigned=true` is encoded in KPI destinations and available in All Work for every signed-in role; unit test covers scoped navigation |
| 7 navigation state | PASS | existing hash router now retains validated query strings; an explicit destination atomically clears remembered project/search/inactive/page filters, preserves scope, and browser history recognizes a query-bearing All Work route |
| 8 count consistency | PASS | disposable PostgreSQL test asserts Overview `openWork`, `overdueWork`, `completedWork` equal All Work tree `matchedTotal`; OPEN includes overdue; leaf tasks count once, while ancestor containers remain navigation rows |
| 9 Overview layout | PASS | order is title/scope → KPI cards → Overdue → Upcoming/period → responsibilities → requests; obsolete upcoming progress bars removed; exact date range shown |
| 10 authorization | PASS | Overview API 200 for ADMIN and MANAGER; 403 for MEMBER and VIEWER; generic `/api/work/tasks` remains read-only and existing visibility predicates remain server-side |
| 11 performance | PASS | upcoming/overdue reads are bounded and apply scope before limit; All Work remains paginated ≤100; assignee names use the existing aggregate projection (no per-row query); cache key includes period and responsibility scope |
| 12 tests | PASS | `overview.test.ts` (9 PostgreSQL tests), `overview.test.tsx` (3 UI/theme tests), and the query-bearing Back case in `navigation.test.ts`; final `npm run test:v2`: **345 passed, 1 skipped** across 26 files |
| 13 validation | PASS | `npm run typecheck`; `npm run lint:v2`; `npm run validate:v2` (151 files); `npm run build`; `npm run smoke:prod`; final `npm run test:browser`; `npm run test:lan` |
| 14 visual evidence | PASS | local stub-data preview at 1920×1280, 1366×768 and 390×844; no page-level horizontal overflow at any viewport; narrow tables scroll inside their card; screenshots were attached to the implementation session |
| Evidence limit | DOCUMENTED | screenshots prove rendering/layout only and use allowlisted stub data; production browser and LAN smoke used disposable data; no live operational host, production database or Workspace deployment was accessed |

The first browser-smoke attempt exposed an accessible-name collision while navigating away from
Overview (the newly clickable project name matched the project explorer link). Overview project
links now have contextual `Open project: …` accessible names; the rebuilt browser and LAN journeys
both pass. Production remains **NOT APPROVED FOR PRODUCTION**.

## Date-based workload report — 2026-11-04

Baseline `b457a39` with a clean working tree; the pre-change V2 suite was **299 passed, 1 skipped**
across 21 files. The fixed four-week utilisation table is replaced by a date-based task-count
report: `apps/web/src/screens/Workload.tsx`, `apps/api/src/services/workload.ts`,
`packages/db/src/repo/reports.ts` and `packages/domain/src/workload-period.ts`. V1 (`src/`,
`dashboard-app/`, `shared/`, `scripts/`) is untouched; no operational database, deployment, trigger,
mail/Calendar activation or publication ran. Every database below was disposable
(`freshDatabase()`, the smoke harness or the benchmark's own embedded server).

| Gate | Result | Evidence |
| --- | --- | --- |
| 0 baseline and safety | PASS | clean tree at `b457a39`; pre-change `npm run test:v2` 299 pass / 1 skipped; AGENTS.md rules 150–162, 89–90 and 136–144 applied; local branding, navigation and other screens untouched |
| 1 date modes | PASS | `resolveWorkloadPeriod` covers DAY, WEEK (Mon–Sun), MONTH, YEAR and CUSTOM (inclusive, start ≤ end, ≤ 366 days); previous/next/this-period controls and two date inputs; the mode and anchor survive leaving and reopening the screen (`useRouteMemoryState`, web test "keeps the selected mode") |
| 2 metrics | PASS | `dueTasks`, `completedTasks`, `overdueTasks`, `undatedTasks`, `overdueWithinPeriod`, `backlogBeforePeriod`, `uniqueTasks`, `assignments`; no remaining-hours, capacity, utilisation, overload or unestimated-task field exists in the contract or payload (`workload-report.test` asserts the payload has none) |
| 3 summary cards | PASS | four cards (対象期限タスク / 期間内完了 / 期限超過 / 期限未設定) with info/ok/danger/neutral tones, each card opens its paginated breakdown |
| 4 timeline | PASS | DAY/WEEK = seven daily columns, MONTH = 28–31 numbered daily columns, YEAR = twelve monthly columns, CUSTOM picks daily ≤14 days, weekly 15–90 and monthly >90 with a manual override; a bar opens that bucket's task list; CSS-only chart with `aria-label` and `title` per bar |
| 5 member table | PASS | member search (server `memberQuery`), member/project/responsibility filters, sort by overdue/due/name with a direction toggle, default most-overdue-then-most-due on the server; a row expands into project, subproject, task, deadline, status, completion date and task links |
| 6 multi-assignee | PASS | effective set = `tasks.owner_member_id` ∪ `task_assignees WHERE removed_at IS NULL`; `uniqueTasks` 1 against `assignments` 2 for one shared task, a removed assignee counts 0 (`workload-report.test` "counts a shared task once…") |
| 7 API | PASS | `GET /api/manager/reports/workload`, `GET /api/manager/reports/workload/tasks`, `POST /api/manager/reports/refresh`; Zod validates mode, dates, inclusive range, 366-day cap and filter IDs; ADMIN/MANAGER 200, MEMBER/VIEWER `403 AUTHORIZATION_DENIED`, unauthenticated 401, invalid input `400 VALIDATION_FAILED` |
| 8 PostgreSQL | PASS | three date-filtered SQL aggregates over one shared scope CTE, parameterized, bounded (`LIMIT 500` member rows, paginated drilldown ≤100); migration `0010_workload_report_indexes.sql` adds `tasks_completed_at_idx`; large-dataset benchmark: p50 **173.66 ms**, p95 **223.00 ms**, 3 DB calls, 18 003 bytes |
| 9 date and status correctness | PASS | deadline today is not overdue, yesterday is; Done is not overdue; undated is neither due nor overdue; container tasks are excluded and their leaf children counted; archived projects and cancelled work excluded; completion uses the stored instant converted to Asia/Tokyo |
| 10 UI/UX | PASS | order = title → mode → navigation and filters → cards → timeline → member table → expandable details; Japanese default with English labels; measured `documentElement.scrollWidth == clientWidth` at 1920, 1366, 1024 and 820 CSS px; no page-level horizontal overflow, month columns stay inside the card |
| 11 regression tests | PASS | `packages/domain/test/workload-period.test.ts` (9), `apps/api/test/workload-report.test.ts` (18), `apps/web/test/workload.test.tsx` (6) and the replaced contract test in `api.test.ts`; the obsolete remaining-hours assertion was replaced by task-count assertions, not deleted |
| 12 full validation | PASS | `npm run typecheck`, `npm run lint` (V1 + V2), `npm run test:v2` **332 passed, 1 skipped** across 24 files, `npm run validate` (V1 42 files / 970 keys, V2 149 files, deploy templates), `npm run build`, `npm run smoke:prod` (schema 10), `npm run test:browser` and `npm run test:lan` (Chromium, schema 10) |
| Evidence limit | DOCUMENTED | the UI screenshots (day/week/month/year/custom, drilldown) were captured from the built application served with a **stub API** in a local preview; they show layout and labels, not live data |
| Live Workspace / LAN | NOT_RUN | no production database, mailbox, Drive, Calendar or deployment was accessed; live latency and Workspace behaviour remain unverified |

The previous four-week utilisation figures are no longer produced. `docs/v2/PERFORMANCE.md` and
`docs/v2/RELEASE_HARDENING.md` keep their historical measurements and mark the superseded
implementation as such; the new report's numbers above are local, in-process measurements.

Production remains **NOT APPROVED FOR PRODUCTION**.

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
## Task, project and personal-work usability — 2026-11-04

Schema **8**, published employee contract 1.6 and all historical migrations remain unchanged.

| Gate | Result | Evidence |
| --- | --- | --- |
| All Work actions | PASS (local) | Everyday rows retain Edit and eligible Mark Done; assignment approval, schedule confirmation and ADMIN correction remain in Task Detail’s Advanced section. The approval command continues to write its audit record and assignment notification job; schedule confirmation remains its own audited command. |
| All Work sorting | PASS (local) | `TaskListQuery` allows due date, name, project, owner, derived status, priority and update time; repository applies allowlisted SQL order before pagination, with Tokyo overdue derivation, nulls last and task-ID tie-breaker. Tree children receive the same sort query. |
| Project sorting and grouping | PASS (local) | `ProjectListQuery` permits deadline, name, responsibility, owner, status, priority and update time; repository sorts before pagination with nulls last and project-ID tie-breaker. The API returns matching responsibility totals; the UI groups the bounded page, preserves collapse state, displays complete group totals and marks groups that continue on another page. A selected responsibility or Unassigned filter is flat. |
| My Assigned Work sections | PASS (local) | Session-scoped endpoint accepts `section=active|completed`; separate bounded queries and counts prevent completed work from hiding active work. Active rows sort nearest deadline first; Done rows sort newest completion first, with null timestamps deterministic. Cancelled work remains excluded. |
| Compact personal rows | PASS (local) | Personal tasks use responsive grid rows with project/subproject subtitle, compact status and actions; completed rows stay collapsed until requested. No manager browser persistence was added. |
| `npm ci` | PASS | Lockfile dependencies restored after a transient native PostgreSQL DLL lock. |
| `npm run typecheck` | PASS | All V2 workspaces compile cleanly after the release changes. |
| `npm run lint:v2` | PASS | ESLint completed cleanly for `apps`, `packages` and `tools`. |
| `npm run test:v2` | PASS | Full Vitest suite exited 0 after dependency restoration. |
| `npm run validate:v2` | PASS | V2 source validation passed; 152 files checked. |
| `npm run build` | PASS | API, web, worker and migration CLI artifacts built successfully. |
| `npm run smoke:prod` | PASS | Disposable PostgreSQL schema 10 migration, built API readiness/read/mutation and worker outbox flow all passed. |
| `npm run test:browser` | PASS | Built-artifact Chromium journeys passed for manager, member and viewer, including responsive layout. |
| Live deployment / LAN test | NOT_RUN | No deployment, database migration, live LAN database or external service was touched. |

No live Google resource, deployment host or production database was used. `docs/PRODUCTION_READINESS.md` remains **NOT APPROVED FOR PRODUCTION**.

## Member creation, readability and workload timeline - 2026-11-04

Schema 10, published employee contract 1.6, every historical migration and the V1 Apps Script project
remain unchanged. No Script Property, column or index was added.

| Gate | Result | Evidence |
| --- | --- | --- |
| Member task creation | PASS (local) | The existing `POST /api/employee/my-work` path is unchanged: owner is the verified member, status `Not Started`, no approval record. Covered by `roles-and-work.test` and `workflows.test`. |
| Member subproject creation | PASS (local) | `POST /api/employee/subprojects` (`CreateMySubprojectBody`, `createMySubproject`): MEMBER only, active project, active non-archived parent chain, same project, four-level limit and cycle refusal, owner = verified member, status `Active`, `SUBPROJECT_CREATED` audit, member-scoped idempotency key returning the first record on retry. `member-creation.test` (9 tests) proves immediate creation, nested creation, immediate task placement under the new subproject, no approval row, privileged-field refusal, archived project/parent refusal, depth refusal, MANAGER/ADMIN/VIEWER refusal and the unchanged project-creation/completion refusals. |
| Hierarchy metadata for the member form | PASS (local) | `GET /api/employee/my-work/projects` adds only `parentSubprojectId` and `depth`; `member-creation.test` asserts the new subproject appears with its parent and level. |
| Member creation UI | PASS (local) | My Assigned Work keeps `新規タスク` and `新規サブプロジェクト` in one panel, one open at a time, with a hierarchical parent path, an optional deadline, a duplicate-safe submit and a "create a task under it" follow-up. A MEMBER also gets a contextual create control on the project screen they may read; `readability.test` and the Chromium member/viewer journeys cover it. |
| Deadline prominence | PASS (local) | One `DeadlineCell` region labelled 納期/Deadline, red + `期限超過` badge when overdue, amber + `今日` when due today, dark text otherwise, `未設定` when absent; applied to My Assigned Work, All Work, task detail, project detail, the read-only explorer, the project list and the overview tables. `readability.test` covers the tone matrix and the region. |
| Collapsible request history | PASS (local) | `自分の申請` is collapsed by default, shows the total and the pending count, expands through the remembered route state, and opens decision/stale notes per row instead of printing paragraphs. Pending completion indicators stay on the task rows and the manager Requests queue is untouched. `readability.test`, `workflows.test`. |
| 分野 terminology and overview counts | PASS (local) | Japanese labels read 分野 for navigation, overview, project filter, workload filter and responsibility management; English keeps Responsibility. The overview responsibility card shows project, open, overdue and completed counts and no percentage bar. `readability.test` asserts the counts and the absence of a progress element. |
| Name typography | PASS (local) | `.my-work-row h3` 1.15rem, project card 1.1rem, area card 1.075rem, hierarchy name 1.02rem, screen/task heading `clamp(1.25rem, 1.1rem + 0.4vw, 1.5rem)`; secondary labels stay 12–14px. Columns stack at 700px and no rule clips a long Japanese name. |
| Localized statuses | PASS (local) | `shared/i18n.js` gains `task.status.*`, `project.status.*`, `responsibility.status.*`, `phase.status.*`, `request.status.PROCESSING` and `request.type.*`; the V2 dictionary was regenerated and the V1/dashboard copies synced. Stored enum values are untouched. `readability.test` asserts 廃止 and the absence of `Retired`. |
| Workload today marker | PASS (local) | The marker uses `data.today` (Asia/Tokyo business date from the server) and highlights the bucket whose range contains it; a period without today states `今日は選択期間外です。` instead of drawing a marker. `readability.test` covers the day case and the outside case. |
| Workload axis and labels | PASS (local) | Visible axis labels `期限タスク数（件）` / `日付`, a unit on every count including zero (`1 task` / `3 tasks` / `3件`), a date under every bucket (`11/04 (水)`, `11/02–11/08`, `2026/11`), month context for a dense month, and a tooltip with the date plus due and overdue counts. An all-zero period keeps its buckets and dates. `readability.test`. |
| `npm run typecheck` | PASS | All V2 workspaces compile cleanly. |
| `npm run lint` | PASS | V1 and V2 ESLint both exit 0. |
| `npm run test:v2` | PASS | `REQUIRE_DATABASE=1`, 28 files, 367 passed / 1 skipped. Baseline before the change was 349 passed / 1 skipped. |
| `npm run validate` | PASS | V1 source validation (989 translation keys, both synced copies), V2 validation (156 files) and the deployment templates. |
| `npm run build` | PASS | API, web, worker and migration CLI artifacts built. |
| `npm run smoke:prod` | PASS | Disposable PostgreSQL, built migration CLI to schema 10, built API read/mutation, worker outbox flow. |
| `npm run test:browser` | PASS | Built-artifact Chromium journeys: manager, member and viewer, Japanese login and language switch, responsive widths, the member-only create control expectation, the workload axis/`Today` marker assertions, and screenshots under `work/screenshots` (`my-work-*`, `workload-timeline*`). |
| Live deployment / Workspace / LAN | NOT_RUN | No deployment, production database, Workspace tenant or live LAN host was touched. |
| Production approval | **NOT APPROVED** | `docs/PRODUCTION_READINESS.md` is unchanged; no live evidence exists. |