# V2 Acceptance Record

## Division write-path corrections and V2 branding — 2026-11-11

**Local implementation and verification only.** No operational database was migrated, initialized,
mapped or reset; nothing was deployed, restarted, committed or pushed; no outbound service (mail,
Calendar, publication) was activated; and no account or authentication setting was changed.

Scope: the remaining division-management corrections (responsibility assignment, transfer reload,
transaction-time authorization for every listed mutation, responsibility reordering, retired-division
reads and retained grants, the overview switch, division creation/ordering) and the request to show
`シゴトモ` / `SHIGOTOMO` as the V2 product name. Schema 12, the employee contract, the migrations and
the project colours are unchanged, and **no new migration is required**.

| Check | Result | Evidence |
| --- | --- | --- |
| V2 branding, Japanese and English | PASS | `apps/web/test/branding.test.tsx` (4 tests): header `<h1>` and navigation `aria-label` read `シゴトモ`, `document.title` follows the language, a language switch keeps the same screen mounted and changes the title to `SHIGOTOMO`, the sign-in `<h1>` uses the brand while `companyLogo.png` keeps its own `alt`, and a division stored as `設計・開発課` still renders as `設計・開発課` beside the brand. |
| Dictionary parity kept, brand separated | PASS | `apps/web/test/ui.test.tsx` asserts `APP_NAME === '設計・開発課 管理'` (the generated V1 dictionary), `brandName('ja') === 'シゴトモ'` and `APP_BRAND.ja !== APP_NAME`, so regenerating `packages/i18n/src/dictionary.json` cannot silently revert the brand. |
| Responsibility assignment follows the division | PASS | `apps/api/test/division-writes.test.ts`: foreign owner at creation refused (`DIVISION_MEMBERSHIP_REQUIRED`) with no row written; a forged foreign additional member on an edit refused and the stored set unchanged; read-only access refused as an assignee; an inactive retained member and an unchanged owner preserved on an unrelated edit; the primary-owner change stays ADMIN-only (`403` for a manager, accepted for an ADMIN); a division change re-validates retained assignments and leaves the division and owner unchanged on refusal; an unmapped area refused to a manager (`DIVISION_REQUIRED`); a retired division refused (`INVALID_TRANSITION`). |
| Responsibility reordering stays in one division | PASS | Same file: a foreign-division neighbour with the same sort order is never mutated (row and revision byte-identical), a foreign `expectedNeighborId` is `409 EDIT_CONFLICT`, the boundary is refused, equal sort orders are separated deterministically, and a stale revision is `409`. |
| Transfer reloads the assignment set (real interleaving) | PASS | Same file: the request is observed queued on `pg_advisory_xact_lock(hashtext('member-divisions'))`, a DEV-only owner is committed on the holder connection, and the transfer then refuses `DIVISION_MEMBERSHIP_REQUIRED` with the project division and the new assignment unchanged. A separate case transfers `PRJ-FREE` from `DIV-DEV` to a **different** division `DIV-ENG` and asserts the audit row. |
| Transaction-time authorization | PASS | Same file: `MANAGER → MEMBER` and `MANAGER → VIEWER` while the `WORK` membership remains → `403` and no row; actor deactivation → `403`; assignment approval and project archive refused after a demotion with no audit row written; a demotion and a membership removal performed through `PATCH /api/manager/members/:id` (the real service path) make the next write `403`. |
| Division creation and ordering | PASS | Same file: three creations receive distinct sort orders and reorder correctly; a repeated creation replays instead of inserting a duplicate (`count = 1`); equal sort orders are separated without touching the retired row; a stale revision is `409`; the active/retired boundary is `409 INVALID_TRANSITION` and the retired row keeps its order and revision. |
| Retired divisions and retained grants | PASS | Same file: a retained grant to a retired division survives an unrelated member edit, a *new* grant there is `409`, a retained manager sees the retired division's project in the list, the detail and the overview total, a manager without the grant gets `404` on the detail, and new work there is refused. |
| False coverage corrected | PASS | `apps/api/test/division-concurrency.test.ts`: the "read-grant revocation" case now removes a stored `READ` row (and asserts it is stamped, not deleted) instead of adding one; the "successful transfer" case now moves a project between two different divisions and asserts the new `division_id`. |
| Overview follows the division switch | PASS | `apps/web/test/overview-division.test.tsx` (4 tests): the aggregate request carries no division, selecting `DIV-DEV`/`DIV-ENG` changes the cards and the drilldown hash, "all readable divisions" restores the aggregate, a responsibility outside the new division is cleared, only readable divisions are requested, and a late answer from an older selection does not repaint. |
| Requests and workload follow the switch | PASS | `apps/api/test/division-writes.test.ts`: a single-division manager gets `404` for `/api/manager/reports/workload?divisionId=<foreign>`, the aggregate counts its own task, a dual-division manager narrows to the other division and counts only that division's task, the drilldown refuses a foreign division the same way, and `/api/manager/requests?divisionId=<foreign>` is `404` while the readable division answers `200` with `total: 0`. The client sends the selection in `Requests.tsx` (queue plus the one page-entry import) and in the workload base parameters. |
| A replayed create is authorized again | PASS | Same file (service level, with a stale request identity as a real request carries): the first create is `replayed: false`, the identical replay is `replayed: true` with the same task id, and after a role demotion the same replay is refused `AUTHORIZATION_DENIED` with exactly one task row. `runIdempotent` runs the `authorize` guard before returning a stored answer and never re-executes the mutation. |
| `npm run lint:v2` | PASS | ESLint clean for `apps`, `packages`, `tools` after removing three unused bindings. |
| `npm run typecheck` | PASS | All V2 workspaces compile cleanly. |
| `npm run validate` | PASS | V1: 42 manager files, 3 dashboard files, both manifests, 989 translation keys. V2: 215 files (3 new files included). Deploy: compose, proxy, tunnel, images, CI, env. |
| V2 full test suite | PASS | `npx vitest run` against a real isolated PostgreSQL 18: 60 files, 675 passed, 1 skipped (baseline before this work: 57 files, 635 passed, 1 skipped). |
| `npm run build` | PASS | API, worker and migration CLI bundled, including the internal `@eh/*` workspaces. |
| `npm run smoke:prod` | PASS | Isolated PostgreSQL, migration CLI applied 0001–0012 (schema 12), `/healthz`, `/readyz` schema 12, development fixture session, authorized read and mutation, worker job completed, clean shutdown. |
| `npm run test:v1` | FAIL (pre-existing) | 775/776. `tests/v1_6_1-counting.test.js` "no open work item is overdue yet" fails because its fixture hard-codes `Due_Date: '2026-11-10'` and today is `2026-11-11`. `tests/`, `src/`, `dashboard-app/` and `shared/` are unmodified by this release (`git status` clean for them) and the test file was last changed 2026-10-28, so this is a date-rollover failure in the V1 suite, **not** a regression of this work. It was left untouched rather than edited to make the gate green. |
| Markdown tables and UTF-8 | PASS | A pipe-count check over `DIVISIONS.md`, `ARCHITECTURE.md`, `API.md`, `SECURITY.md`, `OPERATIONS.md`, `ACCEPTANCE.md`, `AGENTS.md` and `.github/copilot-instructions.md` reports 0 malformed tables after escaping the literal pipes in the API and acceptance rows. Japanese text (`課`, `廃止`, `再有効化`, `次長`, `シゴトモ`) is stored as UTF-8. |
| Rendered inspection (desktop and narrow layouts, keyboard focus) | NOT_RUN | No browser was opened by this run. The client behaviour above is asserted through jsdom component tests; real layout, focus order and screenshots were not captured and are not claimed. |
| Live Workspace / operational database verification | NOT_RUN | The operational database was deliberately left untouched (it was already migrated). No live evidence exists for this release. |

`docs/PRODUCTION_READINESS.md` stays **NOT APPROVED FOR PRODUCTION**.

## Division upgrade repair: sign-in, scope bypasses, transactional checks — 2026-11-10

**Local implementation and verification only.** No operational database was migrated, nothing was
deployed or committed, and no outbound service (mail, Calendar, publication) was activated.

**Verified root cause of the sign-in failure.** The LAN installation's `/readyz` answers
`503 DATABASE_MIGRATION_REQUIRED` with `schemaVersion: 11` while the running build requires 12, and
the request hook resolved a division scope for `/api/public-config`. The public endpoint therefore
failed for any request carrying a session cookie, and the sign-in screen reported
`サインイン設定を読み込めませんでした` with Google instructions even on a local-mode deployment. This
was a readiness/migration failure surfacing as an authentication failure, not a credential problem.

| Check | Result | Evidence |
| --- | --- | --- |
| Root cause identified from the running installation | PASS | `curl http://127.0.0.1:8050/readyz` → `503 {"code":"DATABASE_MIGRATION_REQUIRED","schemaVersion":11,"requiredSchemaVersion":12}`; `/healthz` 200; `/api/public-config` 200 without a cookie. No operational row, secret or setting was read or changed. |
| Sign-in configuration regression (real PostgreSQL) | PASS | `apps/api/test/sign-in.test.ts`: 7 cases — public configuration without a session, with a stale cookie, for an authenticated reader with no division grant, sign-in with a stale cookie, foreign-origin refusal, schema-behind readiness (503 while `/api/public-config` stays 200 and no cookie is issued), google-mode contract. |
| Manager query-scope bypasses | PASS | New cases in `apps/api/test/divisions.test.ts`: a foreign `divisionId` refused as `NOT_FOUND` on projects, tasks, tree, search, overview and work reads; unknown id indistinguishable; dual-division narrowing still works; ADMIN keeps the unrestricted filter. |
| Generic editor bypass | PASS | Same file: foreign task/project/subproject/responsibility → `404`; read-only division → `403`; member editor → `403` for a manager; detail endpoints cannot bypass. |
| WORK → READ treated as removal; retired-division creation | PASS | `division-concurrency.test.ts`: downgrade blocked with `reason: 'DOWNGRADE'`, plain read-grant revocation not blocked; unassigned creation in a retired division refused `409`. |
| Membership/history scoping | PASS | Member profile withholds a former assignment in another division and reports `ownership.previousHidden: 1`; ADMIN still sees it. |
| Deterministic concurrency (barrier, not sleep) | PASS | `apps/api/test/division-concurrency.test.ts`: 10 cases; a request observed queued on `pg_advisory_xact_lock(hashtext('member-divisions'))`, the conflicting change committed, then the request refused; no invalid assignment or unauthorized write persisted. |
| Publication fails closed | PASS | `apps/api/test/api.test.ts`: `publishNow` → `503 NOT_CONFIGURED`, no `published_snapshots` row written, employee snapshot still server-scoped; `publicationStatus.divisionIsolationSupported === false`. |
| Domain policy | PASS | `packages/domain/test/divisions.test.ts` (9 tests): `overseeAll` yields the mapped-division list (never `undefined`), ADMIN may remediate unmapped work, `scopedDivisionIds` refuses an unauthorized/empty case. |
| Client behaviour | PASS | `apps/web/test/division-ui.test.tsx` (7 tests) and `apps/web/test/ui.test.tsx`: division-scoped areas/owners, submit blocked without a concrete division, employee form in local mode, Google wording in google mode, readiness message with retry, no Google fallback on a failed load. |
| Lint / typecheck / validation / build | PASS | `npm run lint`, `npm run typecheck`, `npm run validate` (V1 42 files + 989 keys, V2 212 files, deploy templates), `npm run build`. |
| Full test suite (`REQUIRE_DATABASE=1 npm test`) | PASS | V1 776/776; V2 57 files, 635 passed, 1 skipped, against a real isolated PostgreSQL 18. |
| Production artifact smoke | PASS | `npm run smoke:prod`: migration CLI applied 0001–0012 (schema 12), API `/healthz` + `/readyz`, session, authorized read and mutation, worker job, clean shutdown. |
| Rendered inspection (local, isolated) | PASS | Focused Playwright run against the built bundle and two API instances (local + google) on an isolated database: 20/20 checks, 10 screenshots at 1440 and 390 px in Japanese and English, no horizontal overflow, keyboard focus reaching the division control, division-scoped options, assignee roster limited to the division and unmapped work refused. |
| Full `npm run test:browser` script | BLOCKED (pre-existing drift) | The script now reaches the manager journey and the responsibility area checks (previously blocked by a narrow-viewport header overflow, fixed here) but still drives a removed `View in timeline` entry point and fails there. The affected screens were verified by the focused rendered run above instead; the script was not weakened. |
| Operational database migration | NOT_RUN (not authorized) | The LAN database remains schema 11. The exact read-only inspection and the backup → migrate → verify → map procedure are recorded in `docs/v2/MIGRATION.md` §9.1 and `docs/v2/OPERATIONS.md`. |
| Deployment / commit / push / outbound activation | NOT_RUN | Nothing was deployed, committed or pushed; mail, Calendar and publication stay inactive. |

## Task assignee filtering — 2026-11-10

**BLOCKED / not accepted end to end.** The filter, bounded role-scoped references, hierarchy
context and screen control are implemented, but their real PostgreSQL integration and full release
checks have not been verified. The earlier project-grouping entry below is historical.

| Check | Result | Evidence |
| --- | --- | --- |
| Focused mock/unit tests | PASS | `vitest run packages/db/test/task-assignee-filter.test.ts apps/web/test/task-assignee-filter.test.tsx apps/web/test/workflows.test.tsx`, with `TEST_DATABASE_URL` set to an unused dummy URL to avoid migration setup: 21 tests. SQL shape, contract, list and branch parameters, navigation, stale response, invalid response and language covered; mocks do not prove PostgreSQL behavior. |
| Web, domain and contract suites | PASS | The same no-migration setup ran 31 files and 281 tests; a subsequent focused run included the final added invalid-response test. |
| V1 tests | PASS | `npm run test:v1`: 776 passed. |
| Lint, typecheck, validation, build | PASS | `npm run lint`, `npm run typecheck`, `npm run validate` and `npm run build` passed locally. |
| Mocked Chromium inspection | PASS with limits | Synthetic intercepted API responses: desktop and 390px selector placement, keyboard selection, two IDs, nested branch requests, language switch and clearing. This is not a real database, a screenshot, or live Workspace verification; real filtering and paging totals were not proven. |
| PostgreSQL filter and role integration | BLOCKED | Added integration coverage in `apps/api/test/roles-and-work.test.ts`, but `vitest.setup.ts` and `freshDatabase()` execute `runMigrations`; the request explicitly prohibits migration execution. No external or production database was accessed. |
| Full `npm test` and production smoke | BLOCKED | Both execute migrations on their database fixture (`vitest.setup.ts` / `scripts/production-smoke.mjs`). No database suite is represented as passing. |
| Live deployment / Workspace | NOT_RUN | No deployment or production access. Production readiness remains NOT APPROVED. |

## Project grouping (partial task-filter request) — 2026-11-10

**BLOCKED / incomplete overall.** This local change covers project grouping only. The requested
assignee filter, its role-safe reference projection, nested matching counts and its regression
coverage are not implemented. Do not treat this record as acceptance of the full request.

| Check | Result | Evidence |
| --- | --- | --- |
| Project grouping and archive menu tests | PASS | `project-grouping.test.tsx` and `project-schedule-ui.test.tsx`: 7 tests passed locally. |
| Full tests | PASS | `REQUIRE_DATABASE=1 npm test`: V2 50 files, 553 passed, 1 skipped; V1 suite passed. The final grouping sort adjustment was covered by the focused rerun. |
| Lint, typecheck, validation, build | PASS | `npm run lint`, `npm run typecheck`, `npm run validate` and `npm run build`; final web sort adjustment additionally passed V2 lint and web build. |
| Production artifact smoke | PASS | `npm run smoke:prod` against isolated local PostgreSQL, not a deployment. |
| Small local benchmark | PASS | Three in-process samples on 20 projects / 200 tasks; manager project p50 6.87 ms and p95 7.41 ms. Not a live latency measurement or a large-data gate. |
| Desktop/narrow rendered browser inspection | NOT_RUN | No isolated UI fixture inspection was completed for this change. |
| Complete requested action, bilingual and keyboard regression matrix | NOT_RUN | Focused component tests do not establish every requested interaction or viewport. |
| Task assignee filtering and requested regressions | NOT_RUN | Feature not implemented. |
| Live deployment and Workspace | NOT_RUN | No deployment or production access. Production readiness remains NOT APPROVED. |

## Member creation, shared presentation, ADMIN reopening and request dialogs — 2026-11-05

**Scope.** A MEMBER can file a project, a subproject and a task from the project screens; both roles
render one project table and one overview presentation from their own authorized reads; an ADMIN can
reopen an accidentally completed leaf task with a reason and a typed confirmation; completion and
extension requests open as accessible modal dialogs. No migration, schema column, Script Property,
background job or stored row is added, and no notification, Calendar, publication or deployment
becomes active.

### Gate results (actual, this machine)

| Gate | Result | Evidence |
|---|---|---|
| `npm run lint` | PASS | `lint:v1` (42 manager files, 3 dashboard files) and `lint:v2` (eslint over apps/packages/tools) completed with no findings. |
| `npm run typecheck` | PASS | contracts, db, domain, i18n, benchmark, migration, api and web all compiled. |
| `npm test` | PASS | 48 test files, 541 tests passed, 1 skipped. The new suites are `apps/api/test/reopen.test.ts` (10), `apps/api/test/work-overview.test.ts` (5) and the extended member-creation suite (11), plus the updated web suites. |
| `npm run validate` | PASS | V1 source validation (42 manager files, 3 dashboard files, 989 translation keys), V2 validation (194 files, i18n parity, no HTML sink, no private browser persistence, no `SELECT *`) and the deployment templates. |
| `npm run build` | PASS | Built API, worker, migration CLI and the web bundle. |
| `npm run smoke:prod` | PASS | Built migration CLI applied schema 11, `/healthz` and `/readyz` answered, the fixture authenticated, an authorized read and mutation succeeded, the worker completed an outbox job and the API stopped on the shutdown signal. |
| Local browser verification (ADMIN, MANAGER, MEMBER, VIEWER) | PASS | `work/verify-v2-ui.mjs` against an isolated embedded PostgreSQL fixture and the built artifacts: 12 recorded PASS lines, screenshots in `work/screenshots/`. |

### Browser evidence (local, isolated fixture — not a live Workspace run)

| Screenshot (`work/screenshots/`) | Proves |
|---|---|
| `member-overview-ja.png`, `member-overview-en.png` | The member overview is the shared KPI + overdue/upcoming + responsibility presentation, states the authorized scope and shows personal counts separately, in both languages. |
| `member-projects-ja.png`, `member-project-dialog-ja.png`, `member-project-created-ja.png` | The member project list uses the shared table with no edit/delete column; "New project" opens a dialog over the page, creates the project and keeps the list context. |
| `member-task-dialog-ja.png` | The contextual "New task" inside a subproject folder shows the destination and focuses the task name. |
| `member-completion-dialog-ja.png`, `member-completion-received-ja.png` | A completion request is filed from a modal and the durable receipt appears on the page. |
| `member-extension-dialog-ja.png`, `member-extension-dialog-mobile-ja.png` | The extension dialog identifies the deadline and fits a 390×844 viewport without horizontal scrolling. |
| `viewer-project-detail-ja.png` | A VIEWER sees the shared presentation with no creation, edit or delete control. |
| `manager-projects-ja.png`, `manager-task-detail-ja.png` | A MANAGER keeps the management table and never receives the reopening action. |
| `admin-task-completed-ja.png`, `admin-reopen-dialog-ja.png`, `admin-task-reopened-ja.png` | The ADMIN reopening dialog states the reversal, the retained history and the resulting state; after confirmation the task is `In Progress` with 0% and the action is gone. |

Database evidence captured by the same run: exactly one `TASK_REOPENED` audit row, the task at
`In Progress` / `0.00` / `completed_at = null`, and the original approved request still `APPROVED`.

### What this record does not prove

- **Not live Workspace verification.** `docs/PRODUCTION_READINESS.md` stays **NOT APPROVED FOR
  PRODUCTION** until recorded Google Workspace evidence exists.
- **No operational data was migrated or modified.** Schema 11 is unchanged; the fixture database was
  created and destroyed by the verification run.
- **The in-dialog language switch is not exercised in the browser**, because a native modal correctly
  makes the header inert. The draft is component state, so a language change outside the dialog
  leaves it intact; this is covered by component behaviour rather than a live switch.
- **Manager Overview pending-request section** and the manager decision workflow are unchanged and
  were not re-verified here.
- **The previous employee-overview task wall is gone.** Request actions now live on My Work and task
  detail, so the old per-task receipt cards (and the `eh.receipts` metadata they wrote) are no longer
  shown on the overview; the durable acknowledgement appears as a page status and the request history
  on My Work still comes from `/api/employee/requests/mine`. No note or reason is written to browser
  storage.
- No notification, Calendar or publication activation happened; nothing was deployed.

## One task schedule display status — 2026-11-05

The workload breakdown printed the stored `tasks.status` while its Deadline column printed the
derived `displayStatus`, so one row could read "Not started" or "Assigned" next to a derived
deadline state, and the shared rule itself ignored the planned start. One canonical, date-aware
calculation (`taskScheduleStatus`) now serves the manager list, task detail, project hierarchy,
overview, timeline, workload drill-down and employee snapshot, with the missing plan boundary
carried as a separate detail. The stored workflow value stays stored, is never rewritten by time,
and is shown as a labelled secondary detail.

| Gate | Result |
| --- | --- |
| Domain rule regression (`packages/domain/test/task-schedule-status.test.ts`) | PASS locally — 11 tests: before/on/between/on-finish/after, same-day, finish-only, start-only, neither date, reversed interval, done with a past finish and without a completion timestamp, cancelled, legacy Assigned/Not Started, Tokyo midnight from a UTC instant |
| Existing derived-status and skill-grade suite | PASS locally — 11 tests (expectations updated to the canonical rule) |
| API boundary (`apps/api/test/task-schedule-display.test.ts`) | PASS locally — 6 tests against a real PostgreSQL: DTO state and `scheduleMissing`, terminal precedence, filter-before-paging with the scope total, open-work scope including planned and undated work, the reversed-interval warning coexisting with the canonical overdue accounting, workload drilldown state and private-field allowlist, overview counts excluding done/cancelled from overdue |
| UI (`apps/web/test/task-schedule-ui.test.tsx`) | PASS locally — 8 tests: Status and Deadline columns agree, a stored Not Started/Blocked value never overrides the badge, the same task reads the same on task detail, done never carries a current late badge, reversed interval is a warning tone, Japanese and English labels, due-today hint, and the Tokyo-midnight refresh invalidating the date-dependent reads |
| `npm run test:v2` | PASS locally — 46 files, 520 passed, 1 skipped (the backup test that needs `pg_dump`) |
| `npm run typecheck`, `npm run lint`, `npm run validate`, `npm run build` | PASS locally; V2 validation checked 186 files, V1 validation checked 42 manager files, 3 dashboard files and 989 translation keys |
| Real browser check (disposable embedded PostgreSQL + `dev:api` + `dev:web`) | PASS — the workload breakdown showed 完了 / 遅延 / 進行中 / 開始日未設定 for the five scenarios, all-work showed 予定 for an `Assigned` row and 開始日未設定 for a `Not Started` row, task detail showed 予定 with ワークフロー状態（保存値）= 割当済, and the English switch showed Done / Late / In progress / Start not set. Synthetic records only; the fixture script, servers and database were removed afterwards. |
| Deployment, production data, migrations, mail/Calendar/publication | NOT_RUN — nothing was deployed, no operational row was rewritten, and no migration was added |
| Production readiness | **NOT APPROVED FOR PRODUCTION** until recorded live Workspace evidence exists |

## Flat folder timeline correction — 2026-11-05

| Gate | Result |
| --- | --- |
| Flat display schedule API and timeline tests | PASS locally — 17 focused tests |
| `npm run test:v2` | PASS locally — 40 files, 462 passed, 1 skipped |
| `npm run typecheck`, `npm run lint:v2`, `npm run validate:v2`, `npm run build` | PASS locally; V2 validation checked 176 files |
| Real-browser screenshots / isolated browser smoke | NOT_RUN in this session |
| Deployment, production data and integrations | NOT_RUN |
| Production readiness | **NOT APPROVED FOR PRODUCTION** |

The correction uses a single display schedule line per dated row, retains incomplete/invalid
records in place, derives folders and containers from eligible leaf work, and projects legacy
subproject links as peer folders without changing stored data. Responsibility movement now swaps
an expected adjacent peer inside its Active/Retired group under a transaction lock; ordinary
milestone and phase UI sections were removed while historical rows remain untouched.

## Timeline folder expansion correction — 2026-11-05

The folder chevron now controls root tasks assigned to that subproject through their stable
parent key; nested task expansion remains independent. No stored relationships are changed.
This is only one part of the requested timeline and work-list simplification, not a completed
implementation of either specification.

| Gate | Result |
| --- | --- |
| Folder expansion regression | PASS locally; the regression failed before the correction and passed afterward |
| Timeline component suite | PASS locally — 2 tests, including the existing asynchronous measurement test |
| V2 baseline before the correction | 40 files, 461 passed, 1 skipped; the skipped backup test is not a passing gate |
| `npm run typecheck`, `npm run lint:v2`, `npm run validate:v2`, `npm run build` | PASS locally on Node 24.21.0 |
| Remaining requested functionality and browser evidence | NOT_RUN / incomplete |
| Live deployment, production data and integrations | NOT_RUN |
| Production readiness | **NOT APPROVED FOR PRODUCTION** |

## Timeline fit-to-width and date header correction — 2026-11-05

This supersedes the zoom/pan behavior recorded immediately below. The timeline is read-only and
uses one inclusive, page-memory display range. Presets are 7 days, 2 weeks, one calendar month
and Custom. One month ends the day before the same numbered date next month, or on that month's
last day if it has no such date. An invalid draft retains the committed range; changing a fixed
preset's start recalculates its finish. Reset dates selects the current Tokyo month without
changing filters or expansion; Fit selection selects Custom. Zoom and pan were removed at the
user's request. A mount-aware observer measures the naturally sized track and the full interval
fits that width, with a two-band header; a start without a finish is a marker, not a duration.

| Gate | Result |
| --- | --- |
| `npm run typecheck`, `npm run lint:v2`, `npm run validate:v2`, `npm run build` | PASS locally; Node 24.21.0 |
| Targeted timeline geometry, component and API tests | PASS — 16 tests, including delayed mount, observer cleanup, empty/populated transitions, preset changes and the API's role/read-only cases |
| `npm run test:v2` | PASS — 40 files, 461 passed, 1 skipped; the backup test requiring `pg_dump` was not run because the embedded server lacks client tools. This suite ran before the final start-only marker and boundary alignment adjustments; targeted tests were run afterward. |
| Isolated Chromium | PASS — delayed timeline response, preset and long-range geometry, label bounds/collisions, header/row alignment, sticky header, resize, desktop and narrow viewport, English and Japanese. Screenshots of the week, two-week, month, long-range and mobile views were visually inspected. The browser harness uses synthetic data and a disposable database. |
| Live deployment, production data and integrations | NOT_RUN; no activation or deployment. Local browser smoke creates test records only in its disposable database. |
| Production readiness | **NOT APPROVED FOR PRODUCTION** |

## Responsive timeline viewport — 2026-11-05

Local V2 presentation-only implementation. Display dates remain inclusive Asia/Tokyo calendar
dates and define the selected range; zoom and pan define only a clamped, in-memory visible range.
The timeline now measures its drawing track and fits the visible interval to it, with adaptive
calendar labels, pointer-centred Alt + wheel zoom, button zoom/reset and background drag or
keyboard pan. Timeline interactions do not send a write request or modify schedules, schema,
contracts, permissions, production systems or integrations.

| Gate | Result |
| --- | --- |
| `npm run typecheck` | PASS — all workspaces |
| `npm run lint:v2` | PASS |
| `npm run validate:v2` | PASS — 175 files checked |
| `npm run build` | PASS — API, web, worker and migration artifacts |
| `npx vitest run apps/web/test/timeline-dates.test.ts apps/web/test/usability-corrections.test.tsx` | PASS — 18 tests; disposable PostgreSQL fixture |
| `npm run test:v2` | PASS — 39 files, 462 passed, 1 skipped |
| `npm run test:browser` | FAIL — isolated database, built migration/API/worker and authorized flow passed, then the browser smoke timed out locating the `Deadline` dialog field; no timeline layout measurement or screenshot evidence was produced |
| Production readiness | **NOT APPROVED FOR PRODUCTION** |

## Timeline display-range and schedule validation correction — 2026-11-05

Local V2 implementation only. The timeline remains read-only: `Display start` and `Display finish`
are inclusive Tokyo calendar dates in page memory, never mutation inputs. An incomplete or invalid
draft keeps the last valid chart. Reset restores the current Tokyo month without clearing scope
filters; Fit selection adds bounded display-only padding. A selected subproject is server-verified
against the selected project and includes its descendants while excluding project-direct siblings.

Timeline bars now use the same Finish as the forms: project `committedDeadline`, subproject
`deadline`, and task `dueDate`; historical forecast/planned-end fields remain stored context.
Finish-only items render as markers, complete bars do not gain a redundant deadline marker, and
the branch no longer truncates at 2,000 tasks. Legacy inconsistent schedules remain editable for
unrelated changes, while every actual date/duration mutation validates the effective date pair.
No migration, deployment, production access, activation, or live integration operation occurred.

| Gate | Result |
| --- | --- |
| `npm run typecheck` | PASS — all workspaces |
| `npm run lint:v2` | PASS |
| `npx vitest run apps/api/test/timeline.test.ts apps/web/test/usability-corrections.test.tsx` | PASS — 21 tests, disposable PostgreSQL fixture |
| `npm run validate:v2` | PASS — 174 files |
| `npm run build` | PASS — API, web, worker, migration |
| Browser screenshots / live verification | NOT RUN; production remains **NOT APPROVED FOR PRODUCTION** |

## Schedule terminology and timeline hierarchy correction — 2026-11-05

Local implementation only; no migration, deployment, production access, activation, or live
integration operation occurred. The V2 forms expose Start / Finish using the existing canonical
fields, retain forecast/planned-end fields as historical context, and do not infer completion from
a Finish. Task starts are optional and explicit manual starts survive duration-based planning.
Timeline hierarchy ordering uses stored stable IDs and its read-only projection includes
project-direct task trees in schedule summaries without counting descendants twice.

Verification: `npm run typecheck`, `npm run lint:v2`, `npm run test:v2` (**38 files, 454 passed,
1 skipped**), `npm run validate:v2` (174 files), and `npm run build` all passed locally. Browser
screenshots and live Workspace evidence are **NOT RUN**; production remains **NOT APPROVED FOR
PRODUCTION**.

## Usability corrections: reporting by any authorized user, restored search, bounded selectors and a read-only timeline — 2026-11-05

Implemented on local `HEAD f87fbde` (clean worktree at start, uncommitted changes at the end) after
reading `AGENTS.md` and the V2 documents. Scope is V2 only: no V1 Apps Script file (`src/`,
`dashboard-app/`, `shared/`, `scripts/`), no migration, no schema or contract version change, no
Script Property, no deployment, no publication, no mail or Calendar activation and no live database
was touched. The application name stays `設計・開発課 管理`; every database test used the
disposable PostgreSQL fixture.

**Approved completion-report policy change (the only authorization change)**

| Role | Before | After |
| --- | --- | --- |
| MEMBER, assigned | may report completion | may report completion |
| MEMBER, not assigned | refused | **may report completion for a task they can already reach** |
| MANAGER, ADMIN | refused (MEMBER only) | **may report completion for accessible work** |
| VIEWER | refused | refused (read-only) |
| DEADLINE_CHANGE | assigned MEMBER only | unchanged |
| Approval, direct completion, editing, reassignment, visibility | — | unchanged |

The reporter is the verified session. `requester_name`/`requester_member_id` and the
`REQUEST_SUBMITTED` audit row (with role and assignee flag) record who actually reported; the task
owner, status, progress and revision do not change, and approval stays a separate
`MANAGER`/`ADMIN` decision with separation of duty. The manager queue and the decision dialog show
the reporter, and a legacy inbox request with no verified member is labelled *self-reported (not a
verified account)*.

**Behaviour changes by request**

| Area | Before | After |
| --- | --- | --- |
| Completion report availability | member-only, task detail derived it from the member's own request history page | server-derived `GET /api/employee/tasks/:id/report-eligibility`; loading or a failed read leaves the action unavailable and states why |
| Pending report indicator | visible only to the reporter | task-level: every authorized assignee sees `PENDING`, and a decision on a foreign report also refreshes their list |
| My Work search | the visible box reset to empty on return while results stayed filtered | the input initialises from the remembered applied query; a mount-time debounce can no longer clear it |
| My Work pagination | only the active page reset on a filter change | active **and** completed pages reset; a stale response cannot replace the current filtered results (filter identity is part of the cache key) |
| My Work characters | `笆ｾ`/`笆ｸ`/`ﾂｷ` mojibake in arrows and separators | `▶`/`▼` and `·`, with no repository-wide rewrite |
| My Work project filter | first 200 projects plus a client-side select | paged, searchable `project-filter` endpoint with the honest total and the selected project kept readable |
| Change location | editing controls were always rendered | the collapsed section shows only the readable path, and the controls exist only while expanded (task **and** subproject forms); opening or closing changes nothing |
| Contextual project name | after changing away from the opening project the name could stay blank/original | the name is read for the newly selected project |
| Parent task selector | every task of the project downloaded into a client-side select | bounded server search/paging over eligible candidates, full paths, honest total, the selected option kept off-page, depth/exclusion rules applied on the server |
| Modal focus | the first DOM match, which could be the header close button | explicit preferred target → first enabled field → footer action → other control; disabled/hidden fields skipped; focus returns to the invoker |
| Navigation | `部門の作業` / Department work | `課の業務` / Section work (labels only; keys, routes and stored values unchanged) |
| Timeline | none | **new** read-only screen under Section work: project summaries, an expandable project → subproject → task hierarchy, week/month/quarter, previous/today/next/fit, a legend, a today line, a text list, undated and inconsistent-date reporting, and a `View in timeline` entry on project detail |

**API/contract additions (no migration, no schema change)**

`GET /api/employee/tasks/:id/report-eligibility`, `GET /api/employee/my-work/project-filter` and
`GET /api/work/timeline` are new; `POST /api/employee/requests` accepts MEMBER/MANAGER/ADMIN for
`COMPLETION_REPORT`; `GET /api/employee/my-work` returns task-level `pendingRequest`/`reviewState`
and no longer a fixed `projects` array; `GET /api/manager/tasks/parent-options` is paged and
searchable. Documented in [API.md](API.md), [ARCHITECTURE.md](ARCHITECTURE.md),
[SECURITY.md](SECURITY.md) and [PERFORMANCE.md](PERFORMANCE.md).

**Gate results (executed locally, 2026-11-05)**

| Gate | Command | Result |
| --- | --- | --- |
| Type check | `npm run typecheck` | PASS — api, web, worker, contracts, db, domain, i18n, benchmark, migration |
| Lint (V2) | `npm run lint:v2` | PASS |
| Unit/integration tests | `npm test` (`REQUIRE_DATABASE=1`) | PASS — V2 **38 files, 453 passed, 1 skipped** (the pre-existing backup-container skip) and the untouched V1 suite **776 tests, 0 failed** |
| Source validation | `npm run validate:v2` | PASS — 174 files |
| Build | `npm run build` | PASS — api, web, worker, migration |
| Production-artifact and browser smoke | `npm run test:browser` | PASS — migrated schema 11 artifact, booted API, worker job, and Chromium journeys including the new read-only timeline (project entry, hierarchy, legend, all-project summaries, 390 px labels) |
| Reporting matrix | `apps/api/test/reporting.test.ts` (14) | PASS — assigned and non-assigned MEMBER, MANAGER, ADMIN, VIEWER refusal, restricted `404`, spoofing rejected, reporter ≠ assignee, task unchanged, deadline rule, container/completed/cancelled refusal, closed switch, capability reasons, pending independent of history paging, idempotent replay, foreign replay `404`, separate approval |
| Timeline | `apps/api/test/timeline.test.ts` (9) | PASS — permitted projects only, plan/deadline/counting/range separate, page-size-independent range, manager restricted + archived opt-in, responsibility filter, hierarchy with direct/nested/deadline-only/undated/inconsistent rows, cancelled manager-only, completed toggle, `404` for restricted, no mutation |
| Selectors | `apps/api/test/parent-options.test.ts` (6) | PASS — paging without loss, search beyond page 1, full paths for identical names, self/descendant exclusion, selected option off-page, depth limit, MEMBER refused, validation |
| Policy units | `packages/domain/test/submission-policy.test.ts` (7) | PASS |
| Usability and timeline UI | `apps/web/test/usability-corrections.test.tsx` (11), `apps/web/test/task-parent-selector.test.tsx` (1) | PASS — search restoration and page resets, clean characters, collapsed location, renamed-project resolution, modal focus order/disabled fields/preferred target, timeline summaries/expansion/undated/inconsistent/text list, no write request |
| Updated existing suites | `apps/api/test/api.test.ts`, `apps/api/test/roles-and-work.test.ts`, `apps/web/test/usability.test.tsx`, `apps/web/test/workflows.test.tsx`, `apps/web/test/readability.test.tsx` | PASS — assertions updated for the approved policy, the task-level pending indicator, the new project-filter endpoint, the collapsed location section, the Section work label and the manager's additional report action |

**Defects found and fixed during this release**

| Finding | Evidence | Fix |
| --- | --- | --- |
| A second task form in the same session offered no parent, because the option list was served from a cache entry that predated the task the same session had just created | `npm run test:browser` failed at `selectOption` with an option list of 0 while the server returned 1 candidate in a direct call | `keys.parentOptions` is invalidated by every task save (and on removal), and the selector issues no request until a project is chosen |
| The same stale-cache class applied to the timeline after a task or project change | inspection of the invalidation lists | `keys.timeline` is invalidated by task, project and decision saves |
| A long row name collapsed to one character next to a badge in the timeline name column | mobile screenshot of the timeline journey | `.tl-label` keeps a readable minimum width and badges no longer shrink |

**Not run / limitations**

- `npm run test:lan` was not run (needs the LAN host and a live LAN database).
- No live Workspace, Google, mailbox, Drive or production database was used; nothing was deployed,
  migrated or activated.
- Completion reports are verified by API and component tests plus the existing manager journey, not
  by a clicked browser scenario for each role; the timeline *is* covered by a Chromium journey.
- The timeline shows a child summary span derived from dated descendants; it is a display range, not
  a stored plan, and tasks with no stored dates appear in a separate undated section.
- `docs/PRODUCTION_READINESS.md` remains **NOT APPROVED FOR PRODUCTION**.

## Usability release: guided creation, contextual work, findability and readable administration — 2026-11-04

Implemented on local `HEAD 4690f42` (uncommitted working tree) after reading `AGENTS.md` and the
V2 documents. No V1 Apps Script file (`src/`, `dashboard-app/`, `shared/`, `scripts/`), no
migration, schema, script property, authorization rule, deployment, publication, mail, Calendar
job or live database was touched. Every database test used the disposable PostgreSQL fixture.

**Behaviour changes**

| Area | Role | Before | After |
| --- | --- | --- | --- |
| Task creation/editing | MANAGER, ADMIN | one long form, Save/Cancel at the bottom of the body | location path + name + deadline + assignees + compact description first; priority/skill/parent in one optional section; Save/Create/Cancel reachable in a sticky footer; disabled actions state their reasons |
| Repeated task entry | MANAGER, ADMIN | reopen the form per task | **続けて作成** keeps project/subproject/assignees/priority, clears name/description/deadline, rotates the idempotency key and focuses the name field; a refresh failure never repeats the create |
| Subproject creation/editing | MANAGER, ADMIN | planning fields mixed into the main form | name, location, owner, optional deadline and compact description first; planned dates, effort, status and next action in **計画の詳細**; deadline ≠ forecast ≠ effort is explicit |
| Hierarchy selection | MANAGER, ADMIN | ambiguous repeated names | subproject and parent-task options show their full path; project options add the responsibility only when a name repeats; bounded search above 8 options; depth limits explained |
| Child tasks | MANAGER, ADMIN | no contextual action | **子タスクを追加** on eligible task detail, preselected project/subproject/parent, depth and finished-state restrictions explained, children refreshed after success |
| Request review | MANAGER, ADMIN | task ID/type/reporter table | task name, project/subproject, reporter, submitted time, proposed change and state; task opens in a separate tab; Reject and Return explain their effect; IDs stay secondary |
| Completion report | MEMBER | only from My Assigned Work | the same shared panel on eligible task detail; container/Done/pending/closed reasons are specific; no new member power |
| Personal work | MEMBER, MANAGER, ADMIN, VIEWER | long single list | task search, project, overdue, due-this-week and awaiting-review filters resolved in SQL; matching and unfiltered totals; Reset filters; "nothing assigned" separated from "no matches" |
| Navigation | all | flat row | group headings (My work / Department work / People / Administration) with every link still direct |
| Automation | MANAGER, ADMIN | raw text inputs, manager could type edits | typed controls from the documented key; ADMIN-only mutation; configured value, effective state and consequence shown apart; duplicate saves blocked; emergency stop kept |
| Status | MANAGER, ADMIN | internals first | backup, request intake, email and publication health first; hashes, slots, contract version, outbox and row counts in one disclosure; disabled ≠ not configured ≠ failed |
| Errors | all | code-first banner | plain-language title and recovery first; conflict has no blind retry; unknown outcome says it was not retried; code and correlation ID secondary |

**API/contract additions (no new route, no authorization change)**

`GET /api/employee/my-work` accepts `query`, `projectId`, `overdue`, `dueThisWeek`,
`awaitingReview` and returns `unfilteredActiveTotal` and `projects`. `TaskRequest` items carry
`taskName`, `projectName`, `subprojectName`. `StatusView` carries `requestSubmissionEnabled`.
`TaskDetail` carries `depth`. `parent-options` items carry `parentTaskId`. Documented in
[docs/v2/API.md](API.md).

**Gate results (executed locally, 2026-11-04)**

| Gate | Command | Result |
| --- | --- | --- |
| Type check | `npm run typecheck` | PASS |
| Lint (V2) | `npm run lint:v2` | PASS |
| Unit/integration tests | `npm run test:v2` | PASS — 32 files, 405 passed, 1 skipped (pre-existing backup-container skip) |
| Source validation | `npm run validate:v2` | PASS — 165 files |
| Build | `npm run build` | PASS |
| Production artifact smoke | `npm run smoke:prod` | PASS — migrated, booted, authorized read/write, worker job, graceful shutdown |
| Browser smoke | `npm run test:browser` | PASS — Chromium, Japanese login and language switch, project create/edit, contextual task and child-task creation, nested subproject, blocked and ADMIN-only removal, workload, manager/member/viewer journeys, responsive 1440/1366/390 widths, sign-out |

New tests: `apps/web/test/usability.test.tsx` (16 cases: create-and-add-another key rotation,
disabled reasons, contextual child task, depth refusal, member report and its refusals, VIEWER
absence, server-side My Work filters and totals, request context and decision help, manager
read-only vs ADMIN typed automation, health-first status, conflict/unknown/denied errors, grouped
navigation) and four API cases in `apps/api/test/api.test.ts` (filter totals and identity,
bounded filter validation, reviewer request context, status intake flag).

One pre-existing test fixture was made date-independent: the workload timeline fixture used
Monday–Wednesday buckets and therefore failed whenever the suite ran on Thursday–Sunday because
today fell outside the window. The window is now three days ending after today; no assertion was
removed or relaxed.

**Browser evidence**

Executed by `npm run test:browser`; screenshots under `work/screenshots/` (desktop and 390 px
mobile for each role journey). Static inspection or unit tests alone are never reported as
browser evidence.

**Not run / limitations**

- `npm run test:lan` was not run: it needs the LAN host and a live LAN database.
- The new My Work filter controls, the member completion panel on task detail and the automation
  read-only view were verified by component tests, not clicked in the browser smoke.
- Manager data still lives only in page memory; filters and navigation state stay in route memory.
- `docs/PRODUCTION_READINESS.md` remains **NOT APPROVED FOR PRODUCTION**; no live Workspace
  verification was produced by this release.

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
| My Assigned Work sections | PASS (local) | Session-scoped endpoint accepts `section=active\|completed`; separate bounded queries and counts prevent completed work from hiding active work. Active rows sort nearest deadline first; Done rows sort newest completion first, with null timestamps deterministic. Cancelled work remains excluded. |
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

## Status, deadline and layout corrections — 2026-11-05

Schema 11, employee contract 1.6, every migration and the V1 Apps Script project remain unchanged.
No column, Script Property, background job or dependency was added.

Root causes: the timeline bar height and the point-mark width were the same 3 px value; a
`<td className="actions">` was a flex container, which removed every action cell from the table
layout; the card-header action row had no vertical alignment; and `DeadlineCell` received no
lifecycle state from the workload breakdown, so it compared dates and painted a finished task as
overdue. The stored project lifecycle was still an editable dropdown whose value drove the badge.

| Gate | Result | Evidence |
| --- | --- | --- |
| Timeline bar geometry | PASS (local browser) | Measured in Chromium against the built app: every `.tl-bar` is 12 px tall, a deadline-only/same-day row is `.tl-bar.is-point` at 3 px wide and 12 px tall, and every bar centres within 0.5 px of its row centre, including a wrapped container name. `barGeometry` keeps a 6 px minimum for a very short range, clamps a boundary mark inside the chart and returns null for work entirely outside the window. Unit cases in `apps/web/test/timeline-dates.test.ts`. |
| Single-bar presentation | PASS (local browser) | One bar per row, no deadline diamond, dashed child range, completion symbol or five-symbol legend; `npm run test:browser` asserts the bar height, the absence of `.timeline-legend`/`.tl-swatch` and the project entry point. |
| Project table layout | PASS (local browser) | `td.project-actions-cell > div.actions` in Projects, Tasks, Members, Requests and Responsibilities; the browser journey asserts every project cell keeps `display: table-cell` and that all cells of a row share one bottom edge. `apps/web/test/project-schedule-ui.test.tsx` covers the structure. |
| Hierarchy header alignment | PASS (local browser) | Scoped `.hierarchy-toolbar` with `align-items: center`, a count phrase that stays on one line and intentional wrapping; the browser journey compares the vertical centres when the items share a line and asserts no horizontal overflow when they wrap. The empty hierarchy renders one New task action. |
| Deadline display state | PASS (local) | `DeadlineCell` requires a state; done wins over overdue, cancelled/archived is never current, and a late completion gets its own label. `apps/web/test/deadline-state.test.tsx` pins the reported case (status Done, deadline 2026-11-04, completion 2026-11-04, viewed 2026-11-05). The workload drill-down returns `displayStatus` (`apps/api/test/workload-report.test.ts`) and the browser capture of 期間内完了 shows a green date with no overdue badge. |
| Derived project schedule status | PASS (local) | `projectScheduleStatus` covers archived, cancelled, completed, reversed dates, late, planned, in progress and both missing-date cases with the Tokyo business date and an inclusive finish. Filtering and sorting use `projectScheduleStateSql` before pagination; `packages/db/test/integration.test.ts` proves the SQL projection equals the domain rule for 96 status/date combinations and that a filtered, sorted second page continues the order. `apps/api/test/api.test.ts` covers the HTTP filter, pagination total and derived payload. |
| Project status is no longer editable | PASS (local) | The project form has no Planned/In progress/On hold selector; `assertProjectLifecycleChange` refuses those transitions and archive through the patch route, and requires `confirmStatusChange` for completion, cancellation and reactivation (`apps/api/test/api.test.ts`). Completion still requires every task to be done or cancelled. Legacy stored values are untouched. |
| New project INTERNAL default | PASS (local) | Form and service default to INTERNAL, an explicit RESTRICTED is honoured, existing projects and blank visibility are unchanged and publication still gates on ADMIN plus the exact phrase. `apps/api/test/api.test.ts`, `packages/contracts/test/contracts.test.ts`, `apps/web/test/project-schedule-ui.test.tsx`. |
| Date-dependent display | PASS (local) | `useBusinessDate` refreshes at the next Tokyo midnight and on focus; the project list, detail and read-only explorer include the business date in their query identity. No polling and no write. |
| `npm ci` | NOT_RUN | No dependency manifest changed; the existing install was used. |
| `npm run typecheck` | PASS | All V2 workspaces compile cleanly. |
| `npm run lint` | PASS | V1 and V2 ESLint both exit 0. |
| `npm run test` | PASS | V1 776/776; V2 43 files, 495 passed / 1 skipped (new: project-schedule domain, timeline bar geometry, deadline state, project schedule UI). |
| `npm run validate` | PASS | V1 source validation (42 manager files, 3 dashboard files, 989 translation keys), V2 validation (182 files) and the deployment templates. |
| `npm run build` | PASS | API, web, worker and migration CLI artifacts built. |
| `npm run smoke:prod` | PASS | Disposable PostgreSQL, built migration CLI to schema 11, built API read/mutation, worker outbox flow. |
| `npm run test:browser` | PASS | Built-artifact Chromium journeys (manager, member, viewer) now also assert the table-cell layout, the derived schedule badge, the hierarchy toolbar alignment, the single-bar timeline with a 12 px bar and no legend. Two stale expectations were corrected to the already documented behaviour: the flat-folder policy (no nested create control) and the simplified single-bar legend. |
| Local screenshot review | PASS (local) | Japanese and English captures at 1480 px and 640 px for the project list, project detail/hierarchy, project form and timeline, plus the workload overdue and completed breakdowns. Stored outside the repository; not live Workspace evidence. |
| Live deployment / Workspace / LAN | NOT_RUN | No deployment, production database, Workspace tenant or live LAN host was touched. |
| Production approval | **NOT APPROVED** | `docs/PRODUCTION_READINESS.md` is unchanged; no live evidence exists. |
## UI refresh: application shell, readable palette and first-screen productivity — 2026-11-06

A client-side release of `apps/web` only. No endpoint, request/response contract, database schema,
migration, counting rule, capability, confirmation flow or publication behaviour changed, and no
localStorage/sessionStorage/IndexedDB key was added for manager data (the language preference stays the
only browser key, plus the existing non-sensitive request receipts).

What changed: a 64 px header with one account menu (sign-out and password change moved into it), a
216 px grouped sidebar (日常業務 / チーム / 管理) that becomes a focus-returning drawer below 1100 px, a
token-based palette (`#F6F7F9` surface, `#172033` text, `#AD1535` primary, `#245EA8` link) with 40 px
desktop controls and 44 px touch targets, a compact My Work first screen (title + total + 使い方 on one
row, visible search, 絞り込み disclosure that repeats the applied filters as chips), a fixed-layout task
table with visible filter labels and すべてのプロジェクト, an overview that puts open/overdue first and
history/structure second, a project summary strip with the hierarchy directly beneath it, compact task
detail metadata with 主担当 marked and exceptional actions behind その他, a task editor whose untouched
state reads 変更はありません, and a timeline with one filter row and one date row (custom inputs only in
Custom mode). The deadline/task-count report is labelled 担当・期限レポート; its units did not change.

| Gate | Result | Evidence |
| --- | --- | --- |
| `npm ci` | NOT_RUN | No dependency manifest changed; the existing install was used. |
| `npm run typecheck` | PASS | All V2 workspaces compile cleanly, including `@eh/web`. |
| `npm run lint` | PASS | V1 and V2 ESLint both exit 0. |
| `npm test` | PASS | V1 776/776; V2 49 files, 550 passed / 1 skipped (new file `apps/web/test/shell-and-disclosures.test.tsx`). |
| `npm run validate` | PASS | V1 source validation (42 manager files, 3 dashboard files, 989 translation keys), V2 validation (195 files) and the deployment templates. |
| `npm run build` | PASS | API, web (Vite), worker and migration CLI artifacts built. |
| Role-based navigation | PASS (local browser + jsdom) | `App.tsx` keeps the previous role filter unchanged (a MEMBER and a VIEWER still see only 概要, 自分の担当タスク, すべてのタスク, プロジェクト and タイムライン, and local account administration stays ADMIN + local only). The ADMIN capture shows the three groups and every destination; `apps/web/test/usability.test.tsx` asserts each manager destination is reachable under its group heading, and `member-explorer.test.tsx` still asserts the MEMBER navigation. |
| Drawer and menus | PASS (local browser + jsdom) | `apps/web/test/shell-and-disclosures.test.tsx`: the sidebar exists at >=1100 px and not below it, the drawer closes on Escape with focus back on the menu button, navigation closes it, and `Menu` closes on Escape (focus to trigger) and on an outside press. |
| My Work first task before scrolling | PASS (local browser) | 1366x768 capture: six task rows and their primary actions are visible without scrolling. The heading row carries the title, the total and 使い方; the three less-used filters are behind 絞り込み and their applied values repeat as chips. |
| No page-level horizontal overflow | PASS (local browser) | Measured `documentElement.scrollWidth === clientWidth` on Overview, My Work, All tasks, Projects, Project detail, Task detail, Task editor, Timeline and the three 390x844 screens. |
| Timeline/table scroll containment | PASS (local browser) | The timeline chart keeps its own `.tl-scroller`; the task list uses a fixed column layout inside the content column at every reviewed width. |
| Filters, paging, sorting and totals | PASS | Server paging, filtering, sorting, scope totals and the explicit-filter navigation are unchanged; `apps/web/test/overview.test.tsx`, `usability.test.tsx`, `workload.test.tsx` and `project-schedule-ui.test.tsx` still assert them. |
| Editor open/dismiss performs no mutation | PASS (local browser) | The task editor capture comes from an unmodified row; no write request is issued while opening or closing it, and the untouched form states 変更はありません with Save disabled. |
| Language switch preserves state | PASS | Route, filter and dialog state stay in page memory; only the language is written to `localStorage`. |
| Existing destructive confirmations | PASS (local browser + jsdom) | Delete moved into その他 but keeps its dialog, dependency preflight, ADMIN check and revision handling; `apps/web/test/workflows.test.tsx` opens the menu and still asserts the logical-removal endpoint and the absence of a DELETE call. |
| Local screenshot review | PASS (local) | Fixture-backed Chromium captures at 1440x900, 1366x768 and 390x844 for Overview, My Work, All tasks, Projects, Project detail, Task detail, Task editor, Timeline and the mobile drawer. Served from the Vite dev server with every `/api/*` answer mocked in memory; no database, no session and no live record was involved. Stored under `work/screenshots/` (local evidence, not committed). |
| Live deployment / Workspace / LAN | NOT_RUN | Nothing was deployed, migrated, initialized or restarted, and no live account or record was used. |
| Production approval | **NOT APPROVED** | `docs/PRODUCTION_READINESS.md` is unchanged; no live evidence exists. |

Known limitation: `MyWorkList` items carry no assignee array, so a personal row shows the project path
("project / subproject · priority") rather than inventing an assignment the payload does not contain.
Adding assignees would change a response contract, which this release deliberately does not do.

## Divisions (課), membership scope and same-division assignment - 2026-11-10

What changed: administrator-managed divisions with a stable identifier, a member/division
relationship (`WORK` membership / `READ` additional access), one canonical division per project and
per area, an explicit read-only oversight role (`GENERAL_MANAGER` / 次長), server-side scope on every
list, total, search, tree, report, request queue, employee snapshot and publication source, and
same-division assignment validation. The design, the role matrix, the mapping procedure and the
route inventory are in [DIVISIONS.md](./DIVISIONS.md); the contributor rules are AGENTS.md 174-184.

This narrows one earlier statement: a `MANAGER` no longer manages the whole department, only its own
divisions plus any division granted as additional read access. `ADMIN` keeps the department-wide
administrative view.

| Gate | Result | Evidence |
| --- | --- | --- |
| `npm ci` | NOT_RUN | No dependency manifest changed; the existing install was used. |
| `npm run lint` | PASS | `eslint src dashboard-app shared scripts tests` and `eslint apps packages tools` both exit 0. |
| `npm run typecheck` | PASS | All V2 workspaces compile cleanly (contracts, domain, db, api, web, worker, tools). |
| `npm test` | PASS | V1 suite unchanged; V2 55 files, 600 passed / 1 skipped against a real PostgreSQL 18 instance. |
| `npm run validate` | PASS | V1 source validation (42 manager files, 3 dashboard files, 989 keys), V2 validation (210 files) and the deployment templates. |
| `npm run build` | PASS | API, web (Vite), worker and migration CLI artifacts built. |
| `npm run smoke:prod` | PASS | Isolated PostgreSQL; 12 migrations applied (schema 12); health, readiness, authenticated read, project creation with an explicit division, list read-through, worker job and shutdown all pass. |
| Migration `0012_divisions` | PASS (local) | Additive only: two tables, two nullable columns, one flag, the extended role check, two consistency triggers and indexes. Applied locally and in `smoke:prod`; the applied checksums are unchanged. No division is seeded and no default is set by the migration. |
| Authorization (14 required cases) | PASS | `apps/api/test/divisions.test.ts`: single/dual-division manager, read-only access cannot write, oversight cannot mutate, VIEWER read-only, MEMBER keeps only member capabilities, INTERNAL does not bypass the division, empty membership fails closed, unknown role fails closed, a revoked membership refuses the next request, totals/search/tree respect the scope, member history does not leak current foreign work. |
| Assignment (15 required cases) | PASS | Same-division owner and additional assignee accepted; cross-division owner, additional assignee and project owner refused; a mixed set commits nothing; read access and the ADMIN/oversight role alone never qualify; a dual-division member qualifies in both; a removed membership cannot receive a new assignment; an unrelated edit preserves the historical assignment; the assignment version bumps, the approval clears and `TASK_REASSIGNED` is audited; a blocked membership removal answers `DIVISION_MEMBERSHIP_BLOCKED`. |
| Migration constraints (6 required cases) | PASS | Existing identifiers and operational rows preserved; unmapped work stays `NULL` and ADMIN-only; a mismatched area/project is refused by trigger; applied migrations unchanged; the unique active relationship and the access-kind check are enforced; a project cannot be created without a division through the API. |
| Client behaviour | PASS (jsdom) | `apps/web/test/task-assignee-filter.test.tsx`: no raw `MEM-` identifier in a label, the identifier stays the option value, duplicate names are told apart by division. `apps/web/test/division-ui.test.tsx`: one readable division renders as a name, the switch offers only readable divisions, no readable division is stated plainly, the oversight role gets no write capability. `apps/web/test/ui.test.tsx`: the authenticated header uses `/branding/industrialName.png` with the matching alternative text. |
| Header image | PASS (source + jsdom) | `industrialName.png` (2172x724, the same aspect ratio as the previous lockup) is rendered with `object-fit: contain`, a 64/46 px height and a 360/240 px width cap, so it is never stretched or cropped; the sign-in logo is unchanged. |
| Desktop and narrow-screen layout | NOT_RUN | No browser capture was taken for this release; the layout assertions are jsdom only and the CSS keeps the existing breakpoints. |
| Live Workspace / production database | NOT_RUN | No deployment, migration, initialization, trigger install or mail/Calendar activation was performed. |
| Shared-dashboard division isolation | BLOCKED | The V1 snapshot workbook is a company-wide `INTERNAL` allowlist with no per-viewer identity; per-division isolation needs a separate release. Publication stays OFF by default, requires ADMIN plus the exact phrase, skips unmapped work and publishes no membership or private field. See [DIVISIONS.md](./DIVISIONS.md) §8. |
| Production approval | **NOT APPROVED** | `docs/PRODUCTION_READINESS.md` is unchanged; no live evidence exists. |

## Unmapped work mapping and account-based visibility - 2026-11-11

What changed: an ADMIN-only read model, preview and reviewed apply for legacy work that carries no
division (`apps/api/src/services/division-mapping.ts`, `packages/db/src/repo/division-mapping.ts`,
`packages/contracts/src/mapping.ts`), the 未分類の割り当て panel in 課の管理, an ADMIN overview hint,
and new-work division defaults that never turn a read-only shell selection into a creation default.
No migration, table, column, trigger or lock was added; the write reuses the existing division lock,
the transaction-time re-authorization, the idempotent replay and the audit helper. Division 課
therefore remains schema 12. Design, rules and the operator procedure are in
[DIVISIONS.md](./DIVISIONS.md) §12, [API.md](./API.md), [SECURITY.md](./SECURITY.md) §17 and
[OPERATIONS.md](./OPERATIONS.md).

| Gate | Result | Evidence |
| --- | --- | --- |
| `npm ci` | NOT_RUN | No dependency manifest changed; the existing install was used. |
| `npm run lint` | PASS | `eslint src dashboard-app shared scripts tests` and `eslint apps packages tools --ext .ts,.tsx` both exit 0. |
| `npm run typecheck` | PASS | Every V2 workspace compiles cleanly (contracts, domain, db, api, web, worker, benchmark, migration). |
| `npm run test:v2` | PASS | 62 files, 708 passed / 1 skipped, real PostgreSQL 18 (`apps/api/test/division-mapping.test.ts` 22, `apps/web/test/division-mapping-ui.test.tsx` 8, `apps/web/test/overview-division.test.tsx` 8 including 4 new banner cases). |
| `npm run validate` | PASS | V1 source validation (42 manager files, 3 dashboard files, 989 keys), V2 validation (221 files) and the deployment templates. |
| `npm run build` | PASS | API, web (Vite), worker and migration CLI artifacts built. |
| `npm run smoke:prod` | PASS | Isolated PostgreSQL; 12 migrations applied (schema 12); health, readiness, authenticated read, project creation with an explicit division, list read-through, worker job and shutdown all pass. |
| `npm run test:v1` | 775/776 (pre-existing) | The single failure is `tests/v1_6_1-counting.test.js` "a container task is never an extra unit of work in an area card", caused by its fixed fixture date being in the past for the current business date. The file and every V1 source file are unchanged by this release; the failure is recorded, not silenced. |
| Migration | NONE NEEDED | The release adds no schema object. `0012_divisions` is unchanged and its applied checksum is untouched; no operational database was opened, migrated or mapped. |
| Preview correctness | PASS | `apps/api/test/division-mapping.test.ts`: counts and the archived split, one proposal per record with its rule, linked projects of an area, the retained historical assignment, and the pure rule table (explicit wins, area division wins over membership, contradictions are `CONFLICT`, no evidence is `UNRESOLVED`). |
| Authorization | PASS | Non-ADMIN preview refused, non-ADMIN apply refused, and a role demotion that commits while the apply waits for the `member-divisions` lock still refuses (`403 AUTHORIZATION_DENIED`, nothing written). |
| Automatic visibility | PASS | The end-to-end case proves the mapping rule: unmapped work is invisible to a DEV-scoped manager **and** to an all-division manager, visible to ADMIN, and visible to the DEV manager immediately after the apply with no new grant and no new session; narrowing the same manager to ENG still excludes it. |
| Atomicity and review binding | PASS | A stale revision, an already mapped record, an ineligible active assignee, a responsibility whose projects disagree, a wrong phrase and a duplicate entity each refuse the whole batch with no row written; the batch limit of 100 is enforced; a replayed idempotency key applies once and returns the stored answer after the ADMIN re-check. |
| Backup gate | PASS | Without a `backup_log` row (`result = 'OK'`, checksum, younger than 24 h) the apply answers `409 MAPPING_BACKUP_REQUIRED` and writes nothing; the panel shows the same status instead of enabling the button. |
| Audit | PASS | `PROJECT_DIVISION_MAPPED`, `RESPONSIBILITY_DIVISION_MAPPED` and `DIVISION_MAPPING_APPLIED` rows are asserted, and the mapped rows keep their identifiers, owners and assignments. |
| Client behaviour (jsdom) | PASS | The panel is read-only until the exact phrase, sends the reviewed IDs and revisions, keeps the selection across a language switch, distinguishes a successful empty answer from a failed read, and shows the ADMIN overview hint for a positive count only. |
| Desktop and narrow-screen browser check | NOT_RUN | No browser was opened for this release; the jsdom rendering is not a browser verification. |
| Live deployment / Workspace / LAN | NOT_RUN | Nothing was deployed, migrated, initialized or restarted, no trigger was installed, no mail or Calendar was activated and no operational record was mapped. |
| Production approval | **NOT APPROVED** | `docs/PRODUCTION_READINESS.md` is unchanged; no live evidence exists. |

Known limitation carried over: `npm run test:v1` reports 775/776 with
`tests/v1_6_1-counting.test.js` "a container task is never an extra unit of work in an area card"
failing on its fixed fixture date (the fixture's due date is in the past for the current business
date). The file is unchanged by this release, no V1 source was touched, and the failure is recorded
rather than silenced.

## V2 interface stabilization: capability, scope, requests and async state - 2026-11-11

An incremental stabilization release of the V2 web and API applications. No migration, table,
column, Script Property, trigger or lock was added; schema 12 and employee contract 1.6 are
unchanged. Nothing was deployed, initialized, migrated or activated, and no operational record was
read or written outside the disposable test database.

What changed:

- **Record-level write availability.** `TaskSummary`, `ProjectSummary`, `TaskDetail` and
  `ProjectDetail` carry an allowlisted `canWrite`, resolved on the server through
  `canWriteDivision` before paging. The list screens offer a write action only when the role and the
  record scope agree, and show a localized "閲覧のみ" marker otherwise. Creation requires a concrete
  writable destination; an unloaded division scope is treated as unknown, not empty.
- **One scope-transition policy.** `state/scope.ts` restarts a list at page 1 and clears selections,
  expansion, project focus and drilldowns that belonged to the previous division, while keeping the
  sort order and the search text. The project-focused timeline clears an incompatible selection
  instead of showing division-A work under a division-B label.
- **Complete request review context.** The review summary renders the task and project context, the
  type, the current and requested deadline (or the completion note), the requester's reason and
  explanation, the request state, the specific stale reason, and the decision details of a decided
  request - as text, with line breaks preserved.
- **One request-synchronisation path.** Page entry and the manual control share one implementation:
  the selected scope is sent, a concurrent submission is refused synchronously, the busy state is
  shown, and success, partial import, not configured and failure are distinguished. A failure keeps
  the queue visible, and only `imported > 0` re-reads anything.
- **Submission tracking independent of the dialog.** `state/submissions.ts` owns the client request
  id, the state machine and the outcome. Closing the form no longer silences a delayed
  acknowledgement, an unobservable answer stays `UNKNOWN` and is never retried, and a definite
  refusal stays distinguishable. The shell reports an outcome that the form could not.
- **Mutation completion independent of the editor.** `state/mutation.ts` applies a write's cache
  effect inside the session, so a dialog closing mid-flight cannot suppress the refresh, and a
  result from an ended session has no effect.
- **Debounced, IME-aware search** shared by All Work, Projects and My Work.
- **Honest freshness and read states.** The query cache exposes `loading`, `refreshing`,
  `updatedAt` and `stale`; a mounted key keeps its payload while it refetches, a background failure
  is shown as older data plus a warning, and "最終更新 HH:mm (Tokyo)" never claims live data.
- **Drilldowns keep the question.** The overview's upcoming card links to the task list with the
  same scope *and* the same deadline window, through new validated `dueFrom`/`dueTo` list fields
  applied before paging and totals. A pending-request link names the request and opens it.
- **Keyboard and layout corrections.** The drawer takes focus, contains Tab, closes on Escape,
  returns focus and drops its state on resize; menus implement ArrowUp/ArrowDown/Home/End/Escape;
  sortable headers carry `aria-sort`; the task table has one canonical width rule and moves
  secondary row actions into the row menu.
- **One route table** (`APP_ROUTES`) shared by the renderer, the role guard and the Back behaviour;
  route memory is cleared on sign-out and a late write from an ended session is ignored.
- **Tokyo-time display formatting** for instants, with date-only values never shifted.

Behaviour that was already correct and is now covered by a test rather than changed: the single
automatic import per page entry, the revision-checked decision, the idempotency identity of a
request, the cache's superseded-read ownership, and the "no silent zero" rule for a failed total.

| Gate | Result | Evidence |
| --- | --- | --- |
| `npm ci` | NOT_RUN | No dependency manifest changed; the existing install was used. |
| `npm run lint` | PASS | `lint:v1` and `lint:v2` both exit 0 (8 introduced errors were fixed; none suppressed). |
| `npm run typecheck` | PASS | Every workspace compiles (contracts, domain, db, i18n, api, web, worker, benchmark, migration). |
| `npm run test:v2` | PASS | 68 files, 753 passed / 1 skipped, real PostgreSQL 18. New: `format.test.ts` (8), `search.test.tsx` (3), `query-state.test.tsx` (10), `capability-and-scope.test.tsx` (6), `submissions.test.tsx` (5), `request-sync.test.tsx` (8, including conflict recovery), and 4 `canWrite` cases in `apps/api/test/divisions.test.ts`. |
| `npm run test:v1` | 775/776 (pre-existing) | The single failure is `tests/v1_6_1-counting.test.js` "a container task is never an extra unit of work in an area card": its fixed fixture due date (2026-11-10) is in the past for the 2026-11-11 business date. Identical to the baseline before this release; no V1 file was touched and the failure is recorded, not silenced. |
| `npm run validate` | PASS | V1 source (42 manager files, 3 dashboard files, 989 keys), V2 (235 files) and the deployment templates. |
| `npm run build` | PASS | API, web (Vite), worker and migration CLI artifacts built. |
| `npm run smoke:prod` | NOT_RUN | No production artifact was started for this release; the build gate above covers compilation only. |
| `WORK` vs `READ` action availability | PASS | `apps/web/test/capability-and-scope.test.tsx` (task and project, ADMIN unmapped) and `apps/api/test/divisions.test.ts` (a manager with WORK in one division and READ in another sees `canWrite` per record; the write is still refused). |
| Division change with page/selection | PASS | Same file: page 2 plus a project selection, then a division change - the next request has neither, and the superseded scope answer never paints. |
| Review context | PASS | `apps/web/test/request-sync.test.tsx`: reason, explanation, stale reason and decision details, with a Tokyo timestamp (2026-10-01T09:00Z shown as 2026-10-01 18:00). |
| Manual sync busy/partial/not-configured/failure | PASS | Same file: 5 cases including "partial import is never reported as success" and "the queue stays visible on failure". |
| Submit, close dialog, delayed success | PASS | `apps/web/test/submissions.test.tsx`: the notice appears after the form closed and exactly one POST was sent. |
| Submit, navigate, unknown outcome | PASS | Same file: `UNKNOWN` is kept, a repeat with the same identity is not re-sent, and a refusal is `REFUSED`. |
| Save, close editor, cache refresh | PASS (behaviour) | `apps/web/test/submissions.test.tsx`: `commitMutation` applies the effect with no observer and performs none after the session ended; `TaskForm` now routes its save through it, so the invalidation no longer depends on the form being mounted. A form-level integration case was NOT_RUN. |
| Sign-out during a pending write | PASS | `apps/web/test/submissions.test.tsx` (session epoch) and `apps/web/test/query-state.test.tsx` (cache cleared, private payload not restored). |
| Debounced Japanese IME search | PASS | `apps/web/test/search.test.tsx`: no intermediate query while composing, one applied query after `compositionEnd`. |
| Initial error vs background error | PASS | `apps/web/test/query-state.test.tsx`: Retry on an initial failure, data plus warning on a background failure, no permanent loading line. |
| Overview drilldown filters and totals | PARTIAL | The window and scope are carried into the list and applied by the server (`dueFrom`/`dueTo` before paging and totals); the browser-level comparison of a card figure against the drilldown total was NOT_RUN. |
| Keyboard drawer/menu | PASS (menu) / NOT_RUN (drawer) | Menu arrows/Home/End/Escape/wrap and focus return are tested; the drawer's focus containment and inert background are implemented but only covered by the existing jsdom shell tests. |
| Timestamp timezone boundary | PASS | `apps/web/test/format.test.ts`: 2026-11-10T16:30Z renders as 2026-11-11 01:30, and a date-only value never shifts. |
| Long content / zoom / narrow layout | NOT_RUN | No browser was opened. The width rules and wrapping are structural changes, not measured ones. |
| Browser smoke (1366px, 125-150% zoom, JA/EN) | NOT_RUN | `scripts/browser-smoke.mjs` was inspected but not run: it targets an isolated stack, and no browser verification is claimed. |
| Live Workspace / deployment | NOT_RUN | Nothing was deployed, migrated, initialized, activated or read from an operational system. |
| Production approval | **NOT APPROVED** | `docs/PRODUCTION_READINESS.md` is unchanged; no live evidence exists. |

Conventions introduced here are recorded in [UI_CONVENTIONS.md](./UI_CONVENTIONS.md); the API
surface in [API.md](./API.md), the client-state model in [ARCHITECTURE.md](./ARCHITECTURE.md) and
the flag's security properties in [SECURITY.md](./SECURITY.md) §18.
