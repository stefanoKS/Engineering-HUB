# Manager Web App — V1.6.1

**IMPLEMENTED — DEV MIGRATION AND WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**

## V1.7.2 administration layout and editor lifecycle

- **Open → edit → save or close.** `src/ManagerWebClient.html` no longer keeps a `drafts` map. A
  form is built from the latest stored record (`detail(type, id, true)`), a confirmed save closes
  it, and closing — or navigating away, or a revoked identity — discards every entered value.
  Reopening always creates a new form, so an abandoned edit can never reappear. There is no
  autosave, no draft recovery and no "keep draft" question, and `web.close` is now
  `閉じる / Close`.
- **One write per save.** A submit while a save is in flight is ignored, a confirmed save closes
  the form, and a refused save (`EDIT_CONFLICT`) keeps the open form with its values and sends no
  second request.
- **Deletion and request panels forget their input.** The deletion reason lives only while the
  panel is open; reopening starts empty and the Yes/No confirmation is unchanged. An unsent request
  decision note is dropped when the page is left. Submitted operations, employee receipts and audit
  rows are unaffected.
- **Purpose-built administration pages.** `共有ダッシュボード公開` is a card page (state, last success,
  automatic publication, published counts, snapshot contract, last error) that keeps the database
  schema, the application version, the publisher version and the snapshot contract separate; a
  publisher supporting a newer contract than the published snapshot is an informational `更新あり`
  notice, the reverse is a warning, and technical metadata sits in a `<details>` block.
  `システム状態` groups database/environment, application, operational status, integrations and the
  consistency result, with record counts behind a details block. `自動化` groups the unchanged
  settings under Mail notifications, Request synchronization, Scheduled reports, Snapshot
  publication and Emergency stop with on/off badges; the payload, the ADMIN check and the settings
  revision check are unchanged, and publication enabling stays with the sidebar approval
  procedure. The generic nested key/value dump (`structured`) is gone.
- **Hierarchy by name.** `親サブプロジェクト / Parent subproject` and `親タスク / Parent task` are
  searchable selectors that show record names and the selected parent's ancestor path. The record
  itself (and its own descendants) is never offered, a task parent is limited to the same project
  and subproject, and the server-side depth, cycle, archived-branch and container validation is
  untouched. The client sends the stable ID, never a typed name.
- Publication is read live (`publication` + `status`) instead of from the cached snapshot, so the
  version card is never served from stale data.

## V1.6.1 corrections

- **Area selection is server-resolved.** Choosing an area sends `{responsibilityId}` (or `{unassigned: true}`) to
  `overview` and renders the returned scope: the KPI row, the project page and the upcoming list are computed for
  that scope before paging. The browser no longer filters a 20-row page or a five-row cut. The unscoped overview and
  the local filtering of the project/task *lists* behave exactly as in V1.6.
- **Area cards distinguish work from containers.** Each card shows 案件 / 未完了タスク / 期限超過 / 作業項目 and,
  when present, 集計タスク, described by `responsibilityCards.policy`.
- **Deletion panel** no longer offers a cascade. It explains that dependants must be cleared one by one or the parent
  archived, keeps the ADMIN-only control (nothing is rendered for MANAGER), and the new
  `削除記録の確定（管理者）` block in 自動化設定 runs the recovery with the typed `RECONCILE DELETIONS`.
- **Member profile** shows a former assignment together with its current owner and states the history limitation
  when no audit evidence exists.
- **Container tasks** show 集計タスク and explain that completion comes from their subtasks; the screen never offers
  a direct Done.
- **Diagnostics** (`計測`) is unchanged and still shows only numeric timings and cache state.

## V1.6 additions

- **Responsibility section** at the top of the home screen: one card per area with colour, owner, active projects,
  open and overdue tasks and weighted progress; `すべての担当領域`, `未分類` and `+ 担当領域を追加`.
- **Global area filter** in page memory (`Responsibility_ID`): projects, tasks, KPIs and upcoming deadlines narrow
  to that area. The area select in the toolbar drives the same filter.
- **Create project** asks for the responsibility first and requires an active one; the current area is preselected.
- **Subproject tree** collapses and expands, renders four levels and keeps every orphan visible.
- **Nested tasks** indent by depth, show a container chip and a 承認待ち / 再報告が必要 review chip, and offer
  `サブタスクを追加` while the three-level limit allows it.
- **Completion** is never set from this screen: 完了 requires the employee report plus a manager approval in 申請.
  An ADMIN can record an explicit correction with a reason; it is audited as `COMPLETION_OVERRIDDEN`.
- **Members** view: メンバー → profile with current work, previous approved work and recorded activity.
- **Deletion (ADMIN)**: 完全削除 shows the dependency preflight, requires a reason and `DELETE <id>`, and tells the
  manager that the shared dashboard changes only at the next publication.

Everything below about data flow, caching, revocation and pagination is still accurate for V1.6.1.

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
5. Administration: members, editable responsibilities and ordering, skills and assessments, automation settings (grouped by purpose with on/off badges), publication status/manual publish (cards, version separation, expandable technical details), system status (database, application, health, integrations, consistency, errors) and explicit report refresh. ADMIN changes roles, responsibility ownership and automation settings; MANAGER can use normal departmental workflows and emergency stop. Publication is enabled only through the existing sidebar approval procedure. Existing LIVE activation checks remain enforced.

## Read and write contracts

Read operations are explicit: bootstrap, taskIndex, overview, projects, project, tasks, task, references, members, responsibilities, skills, requests, automation, publication, status, plan. Project/task/member pages cap at 100 records (default 50); overview returns at most 20 project cards and 5 upcoming tasks. Reference choices contain no task bodies. Schema-field DTOs exclude custom columns; status excludes deployment IDs and Script Properties.

`bootstrap` returns overview values, reference choices, every project summary and the task count in one executed read context; `taskIndex` returns compact columnar task summaries. Both report `complete: false` and carry no rows above `TASK_INDEX_LIMIT = 3000` tasks or `PROJECT_INDEX_LIMIT = 1000` projects, and the browser then uses the paginated operations below. A task summary contains only `id`, `name`, `projectId`, `project`, `subprojectId`, `ownerId`, `owner`, `responsibilityId`, `deadline`, `status`, `progress`, `priority` — never description, acceptance criteria, estimates, notes or request text.

A project card carries only allowlisted summary fields: `id`, `name`, `responsibilityId`, `responsibility`, `ownerId`, `owner`, `status`, `deadline`, `deadlineKind`, `daysRemaining`, `progress`, `health`, `healthReasons`, `totalTasks`, `doneTasks`, `overdueTasks`. `progress` and `health` are derived per request; `deadlineKind` is a neutral enum (`none`/`done`/`closed`/`today`/`overdue`/`future`) that the browser localizes. No private project field, description or acceptance criteria is included.

Writes use the action allowlist in ManagerWebApi.gs. Browser actor/email fields are rejected. Stable IDs identify rows. Edits carry a SHA-256 revision of the known fields, compared again after acquiring the existing script lock. Settings use a settings revision. Requests use the existing request/task revision and recovery rules. There are no new persisted revision columns or migrations.

Sheets writes are not database transactions. A quota failure after a partial external/service effect cannot be represented as a rollback; review current records/audit before retrying. Request processing retains PROCESSING recovery and deterministic history IDs.

## Browser state and errors

The client limits RPC concurrency to two, deduplicates identical in-flight reads and uses response tokens so a superseded response never overwrites newer data. The authorized snapshot (projects, task summaries, references, visited details) stays in memory for the session; each dataset is revalidated in the background once it is older than 30 seconds, after tab focus/visibility, and after a relevant write. Nothing is persisted: there is no localStorage/IndexedDB record cache and no server-side cache. The 計測/Diagnostics view has an explicit ローカルデータを破棄/Clear local data action.

The toolbar of every list shows 最終更新 (local time of the last applied data) and 更新中… while a refresh runs; 再読み込み forces one. A failed refresh keeps the cached view visible, adds an error banner with 再試行, and never discards an open form.

If the server stops authorizing the session (`MANAGER_ACCESS_DENIED` or `Insufficient role`), the client drops every cached view and the open form, stops issuing requests and shows the access-denied message. Without that response, already displayed data can remain on screen; it can never authorize a write, because every write re-checks the verified role.

A record form exists only while it is open (V1.7.2). Opening it reads the latest stored record, closing it (or navigating away) discards every entered value, and reopening builds a new form from the stored data — an unfinished edit is never restored and is never written to `localStorage`. There is no autosave and no before-unload draft prompt. A save is refused when the stored revision changed after the form was loaded, and the refused form stays open with its values. Only the language preference is in localStorage. Do not add private draft persistence without an explicit privacy design.

Repeated clicks are suppressed while the same record/action is pending. No write is automatically retried. On a transport failure the result is uncertain: reload/search/audit before a manual retry, especially for creation. This release does not promise exactly-once create delivery. A conflict error (`EDIT_CONFLICT`) keeps the open form and asks the manager to reload; nothing is merged or overwritten automatically.

## Search behaviour

Typing in a list filter narrows the locally held snapshot by name, ID, project, subproject, owner, responsibility, status and deadline range, and re-sorts instantly. The task index does not carry descriptions, so pressing 検索 runs the server search, which also covers description and acceptance criteria; use it when a record may match on text that is not in the list. Above the dataset bounds the list always uses the server, and the filter bar says so on screen.

## Local preview

Run npm ci, then npm run preview:manager-web. Open http://127.0.0.1:4175/. The server binds only loopback and uses synthetic in-memory fixtures; google.script.run is bridged to the actual manager APIs with mocked Google services. No credentials, real IDs or live Workspace writes are used. Restart resets changes.

Optional query scenarios: ?scenario=empty, ?scenario=large (300 projects / 3,000 tasks), ?scenario=slow (2 seconds per RPC), ?scenario=error (first RPC fails, Retry recovers). These are test-only server controls, absent from deployed HTML Service.

See [deployment](MANAGER_WEB_APP_DEPLOYMENT.md), [performance](MANAGER_WEB_APP_PERFORMANCE.md), [DEV smoke test](MANAGER_WEB_APP_SMOKE_TEST.md) and [final checkgate](checkgates/V1_5_1_GATE_10.md).
