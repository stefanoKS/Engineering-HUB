# Manager Web App — V1.6

**IMPLEMENTED — DEV MIGRATION AND WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**

## V1.6 additions

- **Responsibility section** at the top of the home screen: one card per area with colour, owner, active projects,
  open and overdue tasks and weighted progress; `すべての担当領域`, `未分類` and `+ 担当領域を追加`.
- **Global area filter** in page memory (`Responsibility_ID`): projects, tasks, KPIs and upcoming deadlines narrow
  locally, with no additional `google.script.run` call. The area select in the toolbar drives the same filter.
- **Create project** asks for the responsibility first and requires an active one; the current area is preselected.
- **Subproject tree** collapses and expands, renders four levels and keeps every orphan visible.
- **Nested tasks** indent by depth, show a container chip and a 承認待ち / 再報告が必要 review chip, and offer
  `サブタスクを追加` while the three-level limit allows it.
- **Completion** is never set from this screen: 完了 requires the employee report plus a manager approval in 申請.
  An ADMIN can record an explicit correction with a reason; it is audited as `COMPLETION_OVERRIDDEN`.
- **Members** view: メンバー → profile with current work, previous approved work and recorded activity.
- **Deletion (ADMIN)**: 完全削除 shows the dependency preflight, requires a reason and `DELETE <id>`, and tells the
  manager that the shared dashboard changes only at the next publication.
- **Diagnostics** (`計測`) is unchanged and still shows only numeric timings and cache state.

Everything below about data flow, caching, revocation and pagination is still accurate for V1.6.

The application name is **設計・開発課 管理**. The manager opens a bookmarked browser URL; Google Sheets remains the private datastore. This is an additional HTML Service entrypoint in the existing container-bound manager project, not a new backend. The Sheets sidebar remains the fallback. Schema **6**, stable IDs and employee contract **1.4** are unchanged.

V1.5.1 adds no feature to the workflows below; it changes how quickly they are answered. Ordinary navigation, filtering, sorting and reopening a visited record are served from an authorized in-memory snapshot, and the header shows when it was last updated and whether a refresh is running.

## Architecture

Manager browser → google.script.run → ManagerWeb.read / ManagerWebApi.write → existing Ui and domain services → private spreadsheet A. Employee browser → separate dashboard-app deployment → sanitized snapshot B and request inbox C. Only the manager imports C and decides requests against A.

- ManagerWeb.gs: doGet, active-session/domain authorization, compact DTOs, pagination, metrics, the `bootstrap` snapshot and the `taskIndex` compact index.
- ManagerWebApi.gs: explicit action allowlist, confirmation, revision preconditions, existing domain dispatch.
- ManagerWebIndex.html / Styles / Client: Japanese-first responsive shell, five navigation choices plus a 計測/Diagnostics view, native dialog forms, in-memory snapshot store, deduplicated request queue and draft handling.
- Database.gs: execution-local reads and workbook reuse, invalidation on writes and before lock acquisition, checked writes and safe reuse of the already-held script lock.
- Ui.gs: web task saves skip full report regeneration; sidebar default remains unchanged. Subproject reparent and ordinary edits use a single validated patch.
- Requests.gs: decision validation, effect and history now share one script lock. Nested domain calls reuse it rather than acquiring another lock.

Projects, Subprojects, Responsibilities, Tasks, Members, Skills, Planning, Progress, Requests, AuditLog, Access, Roles, AutomationSettings and SharedDashboardPublisher remain authoritative. No Node runtime, new database, paid service, React or build step is introduced in Apps Script. Node is used only for local tests and preview.

## Daily workflows

1. Overview: four KPI counts, project summaries, upcoming deadlines and pending count. Refresh reloads current data; it does not regenerate reports. Progress, health, task counts and deadline wording are derived from current rows on every read (`Dashboard.projectMetrics`), not read from the stored `PROJECTS` columns, so a task save is reflected immediately even though Task saves skip the report refresh. Each source table is read once per request and the paginated list recalculates only its visible page.
2. Projects: search and responsibility filter, paginated cards, create/edit, responsibility/deadline confirmations, explicit visibility and archive. New projects default RESTRICTED. Each card shows an accessible progress bar (`role="progressbar"` with `aria-valuenow` and the visible percentage), one health pill, the committed deadline with translated remaining/overdue wording and a plain-text overdue-task count. Open a project to manage root/nested subprojects, reparent, archive/reactivate and open its task list. Root plus nested level is the existing maximum.
3. Tasks: search, project/responsibility/assignee/status/date filters, deadline/priority sorting and pagination. Opening a subproject scopes its tasks; creating from that list carries the project/subproject selection. Create/edit captures the deadline (required) and the required duration (optional); Preview schedule calls existing planning. A supplied duration back-plans the planned start; a deadline-only task keeps an unknown (blank) planned start, matching the sidebar and `Ui.assignTask`. Approval and schedule confirmation are separate explicit actions. The editor shows active confirmation and approval timestamps.
4. Requests: explicit Import requests, stored pending queue, deadline difference/reason/completion note, approve/reject/return, optional decided records and last 50 deadline-history records. Reads never import or change data. A stale decision is shown as stale rather than as approval success.
5. Administration: members, editable responsibilities and ordering, skills and assessments, automation settings, publication status/manual publish, system status, explicit report refresh. ADMIN changes roles, responsibility ownership and automation settings; MANAGER can use normal departmental workflows and emergency stop. Existing LIVE activation checks remain enforced.

## Read and write contracts

Read operations are explicit: bootstrap, taskIndex, overview, projects, project, tasks, task, references, members, responsibilities, skills, requests, automation, publication, status, plan. Project/task/member pages cap at 100 records (default 50); overview returns at most 20 project cards and 5 upcoming tasks. Reference choices contain no task bodies. Schema-field DTOs exclude custom columns; status excludes deployment IDs and Script Properties.

`bootstrap` returns overview values, reference choices, every project summary and the task count in one executed read context; `taskIndex` returns compact columnar task summaries. Both report `complete: false` and carry no rows above `TASK_INDEX_LIMIT = 3000` tasks or `PROJECT_INDEX_LIMIT = 1000` projects, and the browser then uses the paginated operations below. A task summary contains only `id`, `name`, `projectId`, `project`, `subprojectId`, `ownerId`, `owner`, `responsibilityId`, `deadline`, `status`, `progress`, `priority` — never description, acceptance criteria, estimates, notes or request text.

A project card carries only allowlisted summary fields: `id`, `name`, `responsibilityId`, `responsibility`, `ownerId`, `owner`, `status`, `deadline`, `deadlineKind`, `daysRemaining`, `progress`, `health`, `healthReasons`, `totalTasks`, `doneTasks`, `overdueTasks`. `progress` and `health` are derived per request; `deadlineKind` is a neutral enum (`none`/`done`/`closed`/`today`/`overdue`/`future`) that the browser localizes. No private project field, description or acceptance criteria is included.

Writes use the action allowlist in ManagerWebApi.gs. Browser actor/email fields are rejected. Stable IDs identify rows. Edits carry a SHA-256 revision of the known fields, compared again after acquiring the existing script lock. Settings use a settings revision. Requests use the existing request/task revision and recovery rules. There are no new persisted revision columns or migrations.

Sheets writes are not database transactions. A quota failure after a partial external/service effect cannot be represented as a rollback; review current records/audit before retrying. Request processing retains PROCESSING recovery and deterministic history IDs.

## Browser state and errors

The client limits RPC concurrency to two, deduplicates identical in-flight reads and uses response tokens so a superseded response never overwrites newer data. The authorized snapshot (projects, task summaries, references, visited details) stays in memory for the session; each dataset is revalidated in the background once it is older than 30 seconds, after tab focus/visibility, and after a relevant write. Nothing is persisted: there is no localStorage/IndexedDB record cache and no server-side cache. The 計測/Diagnostics view has an explicit ローカルデータを破棄/Clear local data action.

The toolbar of every list shows 最終更新 (local time of the last applied data) and 更新中… while a refresh runs; 再読み込み forces one. A failed refresh keeps the cached view visible, adds an error banner with 再試行, and never clears the user's draft.

If the server stops authorizing the session (`MANAGER_ACCESS_DENIED` or `Insufficient role`), the client drops every cached view and unsent draft, stops issuing requests and shows the access-denied message. Without that response, already displayed data can remain on screen; it can never authorize a write, because every write re-checks the verified role.

Create/edit drafts live only in a Map in the current page. Closing a dialog and ordinary navigation preserve them; language switching preserves values. A form opens from the cached record, refreshes the server copy in the background, and only an untouched draft adopts a newer revision — an edited draft keeps its original revision so a stale save is refused rather than silently overwriting. Before unload warns for dirty drafts or pending writes. A forced reload/closed browser loses in-memory drafts. Only language preference is in localStorage. Do not add private draft persistence without an explicit privacy design.

Repeated clicks are suppressed while the same record/action is pending. No write is automatically retried. On a transport failure the result is uncertain: reload/search/audit before a manual retry, especially for creation. This release does not promise exactly-once create delivery. Conflict errors preserve the draft; Review latest record shows the server version, and Use latest explicitly discards the draft after confirmation.

## Search behaviour

Typing in a list filter narrows the locally held snapshot by name, ID, project, subproject, owner, responsibility, status and deadline range, and re-sorts instantly. The task index does not carry descriptions, so pressing 検索 runs the server search, which also covers description and acceptance criteria; use it when a record may match on text that is not in the list. Above the dataset bounds the list always uses the server, and the filter bar says so on screen.

## Local preview

Run npm ci, then npm run preview:manager-web. Open http://127.0.0.1:4175/. The server binds only loopback and uses synthetic in-memory fixtures; google.script.run is bridged to the actual manager APIs with mocked Google services. No credentials, real IDs or live Workspace writes are used. Restart resets changes.

Optional query scenarios: ?scenario=empty, ?scenario=large (300 projects / 3,000 tasks), ?scenario=slow (2 seconds per RPC), ?scenario=error (first RPC fails, Retry recovers). These are test-only server controls, absent from deployed HTML Service.

See [deployment](MANAGER_WEB_APP_DEPLOYMENT.md), [performance](MANAGER_WEB_APP_PERFORMANCE.md), [DEV smoke test](MANAGER_WEB_APP_SMOKE_TEST.md) and [final checkgate](checkgates/V1_5_1_GATE_10.md).
