# Manager Web App — V1.5

**IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**

The application name is **設計・開発課 管理**. The manager opens a bookmarked browser URL; Google Sheets remains the private datastore. This is an additional HTML Service entrypoint in the existing container-bound manager project, not a new backend. The Sheets sidebar remains the fallback. Schema **6**, stable IDs and employee contract **1.4** are unchanged.

## Architecture

Manager browser → google.script.run → ManagerWeb.read / ManagerWebApi.write → existing Ui and domain services → private spreadsheet A. Employee browser → separate dashboard-app deployment → sanitized snapshot B and request inbox C. Only the manager imports C and decides requests against A.

- ManagerWeb.gs: doGet, active-session/domain authorization, compact DTOs, pagination, metrics.
- ManagerWebApi.gs: explicit action allowlist, confirmation, revision preconditions, existing domain dispatch.
- ManagerWebIndex.html / Styles / Client: Japanese-first responsive shell, five navigation choices, native dialog forms, shared API queue and draft handling.
- Database.gs: execution-local reads and workbook reuse, invalidation on writes and before lock acquisition, checked writes and safe reuse of the already-held script lock.
- Ui.gs: web task saves skip full report regeneration; sidebar default remains unchanged. Subproject reparent and ordinary edits use a single validated patch.
- Requests.gs: decision validation, effect and history now share one script lock. Nested domain calls reuse it rather than acquiring another lock.

Projects, Subprojects, Responsibilities, Tasks, Members, Skills, Planning, Progress, Requests, AuditLog, Access, Roles, AutomationSettings and SharedDashboardPublisher remain authoritative. No Node runtime, new database, paid service, React or build step is introduced in Apps Script. Node is used only for local tests and preview.

## Daily workflows

1. Overview: four KPI counts, project summaries, upcoming deadlines and pending count. Refresh reloads current data; it does not regenerate reports.
2. Projects: search and responsibility filter, paginated cards, create/edit, responsibility/deadline confirmations, explicit visibility and archive. New projects default RESTRICTED. Open a project to manage root/nested subprojects, reparent, archive/reactivate and open its task list. Root plus nested level is the existing maximum.
3. Tasks: search, project/responsibility/assignee/status/date filters, deadline/priority sorting and pagination. Opening a subproject scopes its tasks; creating from that list carries the project/subproject selection. Create/edit captures duration and deadline; Preview schedule calls existing planning. Planned start is derived when duration is supplied. Approval and schedule confirmation are separate explicit actions. The editor shows active confirmation and approval timestamps.
4. Requests: explicit Import requests, stored pending queue, deadline difference/reason/completion note, approve/reject/return, optional decided records and last 50 deadline-history records. Reads never import or change data. A stale decision is shown as stale rather than as approval success.
5. Administration: members, editable responsibilities and ordering, skills and assessments, automation settings, publication status/manual publish, system status, explicit report refresh. ADMIN changes roles, responsibility ownership and automation settings; MANAGER can use normal departmental workflows and emergency stop. Existing LIVE activation checks remain enforced.

## Read and write contracts

Read operations are explicit: overview, projects, project, tasks, task, references, members, responsibilities, skills, requests, automation, publication, status, plan. Project/task/member pages cap at 100 records (default 50); overview returns at most 20 project cards and 5 upcoming tasks. Reference choices contain no task bodies. Schema-field DTOs exclude custom columns; status excludes deployment IDs and Script Properties.

Writes use the action allowlist in ManagerWebApi.gs. Browser actor/email fields are rejected. Stable IDs identify rows. Edits carry a SHA-256 revision of the known fields, compared again after acquiring the existing script lock. Settings use a settings revision. Requests use the existing request/task revision and recovery rules. There are no new persisted revision columns or migrations.

Sheets writes are not database transactions. A quota failure after a partial external/service effect cannot be represented as a rollback; review current records/audit before retrying. Request processing retains PROCESSING recovery and deterministic history IDs.

## Browser state and errors

The client limits RPC concurrency to two and uses response sequence numbers. Read results remain in memory for 30 seconds; successful writes clear the cache. Cache entries are never shared across users or persisted. Every actual RPC checks current authorization. Already displayed data can remain visible until refresh after role revocation; it cannot authorize a write.

Create/edit drafts live only in a Map in the current page. Closing a dialog and ordinary navigation preserve them; language switching preserves values. Before unload warns for dirty drafts or pending writes. A forced reload/closed browser loses in-memory drafts. Only language preference is in localStorage. Do not add private draft persistence without an explicit privacy design.

Repeated clicks are suppressed while the same record/action is pending. No write is automatically retried. On a transport failure the result is uncertain: reload/search/audit before a manual retry, especially for creation. This release does not promise exactly-once create delivery. Conflict errors preserve the draft; Review latest record shows the server version, and Use latest explicitly discards the draft after confirmation.

## Local preview

Run npm ci, then npm run preview:manager-web. Open http://127.0.0.1:4175/. The server binds only loopback and uses synthetic in-memory fixtures; google.script.run is bridged to the actual manager APIs with mocked Google services. No credentials, real IDs or live Workspace writes are used. Restart resets changes.

Optional query scenarios: ?scenario=empty, ?scenario=large (300 projects / 3,000 tasks), ?scenario=slow (2 seconds per RPC), ?scenario=error (first RPC fails, Retry recovers). These are test-only server controls, absent from deployed HTML Service.

See [deployment](MANAGER_WEB_APP_DEPLOYMENT.md), [performance](MANAGER_WEB_APP_PERFORMANCE.md), [DEV smoke test](MANAGER_WEB_APP_SMOKE_TEST.md) and [final checkgate](checkgates/V1_5_GATE_10.md).
