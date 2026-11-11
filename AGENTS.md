# Contributor safety rules

## V1.5 mandatory rules

- ManagerWeb is an HTML Service entrypoint in the existing src manager project; keep dashboard-app separate and retain the Sheets sidebar.
- Schema 6 and employee contract 1.4 stay unchanged. Do not add a migration for this release.
- Execute as the accessing user, domain restricted. MANAGER_WEB_ALLOWED_DOMAINS is mandatory. Active identity plus server Roles/Access must pass before every new manager read/write. Blank identity fails closed; never substitute the effective/deployer user.
- Keep explicit read/write allowlists, small paginated DTOs, ephemeral per-execution/per-page caches and no private browser persistence. Check edit revisions under the existing script lock. Nested domain calls reuse that lock; never acquire another script lock inside it.
- Keep explicit report refresh separate from ordinary web task saves. Preserve the sidebar's existing default behavior.
- Keep canonical publication date normalization on both publisher and employee reader; never weaken slot/hash verification.
- Run npm ci, npm run lint, npm test, npm run validate and the V1.5 mock benchmark. Update all ten V1_5_GATE documents with actual evidence; live-only criteria remain BLOCKED/NOT_RUN.
- No automatic live deployment, initialization, migration, triggers, mail/Calendar activation. Read docs/MANAGER_WEB_APP_DEPLOYMENT.md and the 20-case DEV smoke plan before authorized deployment work.


1. Keep development and production in separate Apps Script projects, spreadsheets, and local clasp configurations; never test against production.
2. Keep runtime settings in Script Properties; never commit credentials, tokens, real resource IDs, `.clasp.json`, or environment-specific clasp configuration.
3. Require `ENVIRONMENT` and `BOUND_ENVIRONMENT` to match before accessing the configured database; never silently select another workbook.
4. Initialize only an explicitly identified empty workbook using `INITIALIZATION_SPREADSHEET_ID` and the required confirmation; never clear an existing workbook.
5. Treat spreadsheet data as independent of source code: code deployment is not data deployment, migration, backup, or restoration.
6. Preserve existing rows and headers; change schemas only through reviewed, versioned migrations with explicit migration-ID approval.
7. Create and verify a restricted Drive backup before migrating or performing another risky production operation; do not bypass backup failures.
8. Never automatically delete sheets, rows, user data, or backup files; do not implement destructive reset or unattended restore operations.
9. Validate inputs, relationships, dates, and state transitions; use stable IDs rather than row numbers as identities.
10. Use the application lock and bounded bulk reads/writes for shared mutations; do not assume triggers or concurrent users execute serially.
11. Keep email and Calendar disabled by default and dry-run enabled; require environment validation, recipient-domain restrictions, and a per-run email cap before external sends.
12. Require explicit approval of the current task assignment version before assignment notifications; changing an assignee must invalidate stale approval.
13. Make automation retry-aware, keep audit/delivery records, and document uncertain external outcomes; never promise exactly-once delivery.
14. Run existing targeted tests and validation, use mocks locally, and verify authorization and Workspace behavior manually in development before production activation.
15. Update operating documentation for behavior changes, preserve manual recovery procedures, and state limitations honestly; never fabricate prototype evidence, benchmarks, or live verification.

## V1.1 mandatory rules

16. Feature switches must default safely (OFF for outbound mail, Calendar and automatic refresh).
17. Automation settings live in the workbook `AUTOMATION_SETTINGS` table and persist independently of source code; never hardcode manager preferences that the UI must edit.
18. No feature may bypass the centralized send authorization in `Notifications.gs`; `npm run validate` rejects `MailApp.sendEmail` anywhere else.
19. No UI may expose Script Properties, credentials, Calendar IDs or spreadsheet IDs.
20. No automation activation without an audit record (`SETTING_CHANGED`, `TRIGGERS_INSTALLED`, `ASSIGNMENT_APPROVED`, `DELIVERY_RECONCILED`).
21. Changes to notification logic require regression tests covering the OFF / PREVIEW / LIVE matrix and the per-project/per-task switches.
22. UI operations must call validated domain functions with server-side role checks; never add a browser write path.
23. New features must not overwrite operational data or user columns; generated sheets are the only replaceable output.
24. Check gates (`docs/checkgates/GATE_<n>.md`) are mandatory for future large upgrades and must record PASS, FAIL or BLOCKED with evidence.

## Hardening rules (post-merge audit)

25. Preserve operational records: never delete projects, tasks, members, skills, notification history or audit rows. Archive instead of deleting, and never clear an operational sheet.
26. Never bypass authorization. Every write reachable from the UI or a trigger must call `Access`/`Roles` on the server. A role, actor, owner or confirmation supplied by the browser is data, not authority.
27. Test every role privilege change: granting/revoking `ADMIN`/`MANAGER`, self-change, the last active administrator, cross-member task edits, department-wide manager access and VIEWER refusal.
28. Treat every stored string as untrusted browser text. Render with `textContent`/DOM creation; `innerHTML`, `outerHTML`, `insertAdjacentHTML` and `document.write` are prohibited in `src/*.html` and are rejected by `npm run validate`.
29. Keep email safe by default. OFF is the default, emergency stop is on, unconfigured workbooks fail closed, and any transition to an effective LIVE state requires ADMIN, the exact confirmation and a passing preflight.
30. Preserve migration compatibility: additive migrations only, verified backup first, cell-by-cell preservation checks, no schema change without a reviewed migration ID, and no initialization of an existing workbook.
31. Update documentation with every behavioural change: `README.md`, `README_JP.md`, `ARCHITECTURE.md`, `DATA_SCHEMA.md`, `DEPLOYMENT.md`, `BACKUP_RESTORE.md`, `docs/` and the relevant check gate.
32. Reopen a failed check gate instead of working around it. Record PASS, FAIL or BLOCKED plus evidence; keep earlier PASS records as historical local results.
33. Never fabricate live test evidence. Local mocks are not Workspace verification; `docs/PRODUCTION_READINESS.md` stays NOT APPROVED until recorded live evidence exists.

## V1.2 shared dashboard rules

34. Keep the two applications separate: the manager project (`src/`, container-bound) and the shared dashboard project (`dashboard-app/`, standalone web app) use different clasp targets, different Script Properties and different deployments. Never push one root directory into the other project, and never reuse the manager project as the employee-facing app.
35. The dashboard is read-only. It must contain no create/update/delete path, no `MailApp`, `GmailApp`, `CalendarApp`, `ScriptApp`, `UrlFetchApp` or `DriveApp` usage, and no import of manager modules. `npm run validate` rejects all of them.
36. The dashboard may read only the sanitized snapshot workbook named by `SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID`. It has no access to the management workbook, and publication refuses the management workbook as a destination.
37. Publish only allowlisted fields. `SharedDashboardModel` constructs explicit DTOs; raw source rows, e-mail addresses, skills assessments, capacity/HR data, logs, settings, OAuth tokens, private descriptions, acceptance criteria and internal error details must never reach the snapshot or a viewer response.
38. Projects are published only when `Dashboard_Visibility` is exactly `INTERNAL`; blank and unknown values are `RESTRICTED`. Migration `004_shared_dashboard` must publish nothing and must preserve every existing cell, formula, custom column and ID behind a verified backup.
39. Publication must stay transactional: write the inactive A/B slot, verify headers, row counts and the content hash, then commit by a single `PUBLISHED_META` write. A failure must leave the previously committed snapshot readable and be recorded in `AUTOMATION_SETTINGS` and `AUDIT_LOG`.
40. Publication defaults to OFF (`SHARED_DASHBOARD_PUBLISH_ENABLED = false`), is independent of the mail mode, requires ADMIN plus `ENABLE SHARED DASHBOARD PUBLICATION` to enable, and installs a trigger only while it is ON. The destination spreadsheet ID stays in Script Properties and is never returned by an API or UI.
41. Never present browser-side hiding as access control. Access comes from the deployment ACL (`access: DOMAIN`, execute as deployer, read-only scope) plus a server-side domain check. Do not claim live Workspace verification for the dashboard: `docs/dashboard/SMOKE_TEST.md` starts UNVERIFIED.


## V1.3 mandatory rules

35. Keep the V1 application's user-visible name exactly `設計・開発課 管理`. The **V2** application
    (apps/ + packages/) is branded `シゴトモ` (ja) / `SHIGOTOMO` (en); see rule 195. Branding is a
    product name only: never rename internal identifiers (worksheets, functions, Script Properties,
    migration history, public APIs, package names, environment variables) for branding, and never
    rename a division record because the product name changed.
36. Deadline + required duration are the primary task schedule inputs; the planned start is derived. Duration is a schedule length, never labour hours, and `Estimated_Hours` is never derived from it.
37. Never add workload-overlap validation, duration-based capacity limits, automatic reassignment or conflict blocking. The manager decides whether a deadline and duration are feasible, and overlapping assignments must remain possible.
38. A committed deadline is never changed silently. A non-working deadline raises a warning and requires explicit acknowledgement; it is not moved automatically.
39. Only `src/Notifications.gs` may send mail. Request notifications default to OFF and obey the master mode, the emergency stop, allowed domains, the ledger and the per-run cap.
40. The dashboard project may only append validated request rows to the separate request inbox. It must never read the private workbook or write to the published snapshot; `npm run validate` enforces both.
41. Any published task may receive a request from any internal viewer. Never add an owner-match check, a login form, a password, a personal token or an employee account for requests.
42. A pending, rejected or returned request never changes `Due_Date`. Only a manager approval applies a change, at most once, with history and audit records.
43. Detect staleness: when the task revision or deadline changed after submission, mark the request `STALE` instead of overwriting the newer value.
44. Never publish request text. Only a boolean pending indicator may appear on the shared dashboard.
45. Translation lives in `shared/i18n.js` and is copied into both projects by `npm run sync:i18n`. Never translate stored spreadsheet text, identifiers or enum values; only display labels are localized.
46. Japanese is the default UI language. The `日本語 | English` switch must exist on every screen listed in `docs/UI_LOCALIZATION.md` and must preserve the current screen, project, task and filter state.
47. The language preference is browser-local (`localStorage`). Do not store it in the workbook and do not rely on server-side `UserProperties` for the shared dashboard.
48. Record PASS, FAIL or BLOCKED with evidence in `docs/checkgates/V1_3_GATE_<n>.md`, and keep live Workspace verification separate from local results.

## V1.3.1 mandatory rules (pre-trial stabilization)

49. Keep one form per record type: creation and editing share it. An edit sends a partial patch, so a field the manager did not address keeps its stored value. Never recreate a record to change a field, and never rewrite an unrelated column with a blank or default.
50. `Project_ID`, `Task_ID`, `Original_Deadline`, `Created_At` and the audit/migration identifiers are immutable. `Ui.updateProject` and `Ui.assignTask` verify the stored `Last_Updated` against the value the editor loaded and refuse a stale save instead of overwriting newer data.
51. New projects are `RESTRICTED` unless a manager deliberately selects `INTERNAL`, and only the allowlisted snapshot is published. A visibility change is announced as taking effect at the next publication; the UI must never suggest the shared dashboard is live.
52. A project created without an owner belongs to the verified creating manager's `Member_ID`. Never invent an owner ID and never treat a browser-supplied role, actor or owner as authorization.
53. Opening 申請一覧 imports the inbox automatically under the script lock, keyed by the permanent inbox request ID. Repeated or simultaneous opens must not duplicate a request. A failed import is a warning that keeps the imported requests visible and never claims success.
54. `REQUEST_SUBMISSION_ENABLED` must be exactly `true` in the dashboard project before a request is accepted; an absent property means closed, and the user-visible state must agree with it.
55. A committed deadline change requires an explicit confirmation, and a project can only be marked `Completed` when its tasks are all done.
56. Record PASS, FAIL or BLOCKED with evidence in `docs/checkgates/V1_3_1_GATE_<n>.md` for this release, and keep live Workspace verification separate from local results.

## V1.4 mandatory rules

57. Responsibilities are configurable data in the `RESPONSIBILITIES` table, never source constants, and the number of responsibilities is never assumed. Keep `PROJECTS.Category`; a responsibility is a different concept.
58. A blank `PROJECTS.Responsibility_ID` means 未分類. Never seed example responsibilities or assign historical projects automatically, and never invent an owner `Member_ID`.
59. Retirement is a status change, never a deletion: keep every project, task, milestone, approval and history row, keep the area visible in lists and filters, and keep its projects actionable and marked for reassignment.
60. Ownership is accountability, not permission. `ADMIN` and `MANAGER` manage every project, subproject, task and responsibility; `MEMBER` keeps only the own-task boundary. `PROJECTS.Project_Owner_ID`, `SUBPROJECTS.Owner_ID` and `RESPONSIBILITIES.Owner_Member_ID` never gate a write, and a responsibility change never rewrites the owner, the deadline or the status.
61. A responsibility transfer requires explicit confirmation and an `AUDIT_LOG` record containing the previous ID, the new ID, the actor and the reason if supplied. Do not add a parallel history table.
62. Nested subprojects stop at two levels beneath a project. Reject a self-parent, a cross-project parent and a circular link, and validate the whole subtree on reparent instead of flattening it.
63. Archiving a subproject cascades nothing. Descendant eligibility follows the whole ancestor chain, and only explicit actions move tasks or reassign work.
64. Rollups count each task exactly once: keep the existing weight rules (known estimate, the documented fallback for unknown effort, `Cancelled` excluded) and never invent hours.
65. Publish only the responsibility label, the hierarchy and the hierarchy progress. Never publish a responsibility description, its owner, or a private project field, and never read an older snapshot contract as the new one.
66. The request form must honour `REQUEST_SUBMISSION_ENABLED` and fail closed while loading or on error. Unsent request data stays in memory across a language switch, a validation error and a temporary failure, and is never written to a spreadsheet.
67. Record PASS, FAIL or BLOCKED with evidence in `docs/checkgates/V1_4_GATE_<n>.md`, keep live Workspace verification separate from local results, and keep `docs/PRODUCTION_READINESS.md` NOT APPROVED until that evidence exists.

## V1.4.1 mandatory rules (pre-trial hardening)

68. Keep authorization simple and role-based. `ADMIN` and `MANAGER` manage the whole department; `MEMBER` keeps the own-task boundary and `VIEWER` stays read-only. Never add per-project, per-responsibility or per-subproject ACLs, owner barriers for `MANAGER`, permission inheritance or approval chains for ordinary edits.
69. Every callable entrypoint re-checks the verified role on the server. A record-mutating top-level Apps Script function must call `Access` before delegating to a domain service, and a manager-only read entrypoint must be gated. A role, actor, owner or confirmation supplied by the browser is data, never authority.
70. One logical operation is one write. Validate every input, the concurrency marker, the destination and the confirmations before mutating, then apply a single row update. Never report failure after part of the change was already committed, and never claim multi-row atomicity that Google Sheets cannot provide.
71. Reordering must validate every submitted ID, refuse duplicates and unknown IDs, preserve identity/owner/status and write only the `Sort_Order` values that change.
72. Hierarchy and subtree walks must be bounded. Malformed parent links raise a documented error instead of recursing, and a task is never placed into a subproject whose ancestor is archived.
73. One ancestor-aware eligibility rule serves active work, reminders, reports and published aggregates. Archiving changes no stored progress on its own and marks no task done.
74. The sidebar may bound the task list it loads, but it must report the total, never truncate silently, and keep every task reachable through a server-side search that preserves the selected task.
75. Japanese user-facing terms for organizational areas are 廃止 / 再有効化; 退職 / 復職 are reserved for people. Never change the stored enum values.
76. A fresh workbook initializes at schema 6 and records `INITIALIZE_V6`; `006_responsibilities_and_nested_subprojects` exists only for an existing V5 workbook. Never use initialization to upgrade an existing database.
77. Record PASS, FAIL or BLOCKED with evidence in `docs/checkgates/V1_4_1_GATE_<n>.md` for this release, and keep `docs/PRODUCTION_READINESS.md` NOT APPROVED until live evidence exists.



## V1.6 mandatory rules (responsibility-centered engineering management)

78. **Documented, narrowly scoped exception to the earlier no-delete rules (25, 59).** `Deletion.gs` is the only
    module allowed to remove a row, and only for a `PROJECTS`, `SUBPROJECTS` or `TASKS` record that is demonstrably a
    mistaken, empty entry: ADMIN only, empty dependency preflight, exact typed confirmation (`DELETE <id>`), required
    reason, verified backup in the same operation, script lock, and an immutable `RECORD_DELETED` tombstone.
    Operational history, recorded effort, approvals, requests, notifications, dependencies, published visibility and
    archived records always refuse deletion and fall back to archive. A removed identifier is never reused. Nothing
    else in this repository may call a destructive Sheets API.
79. Responsibilities stay the top organisational level and the only grouping of projects; the relationship is the
    stable `PROJECTS.Responsibility_ID`. Never duplicate project tables per area, never rename stored IDs, and never
    auto-assign a historical project to an area. A new project created in the manager dashboard must name an active
    responsibility; the legacy Sheets sidebar keeps the documented unassigned (未分類) path.
80. Subprojects nest at most four levels beneath a project (`Subprojects.MAX_DEPTH`) and tasks at most three
    (`TaskTree.MAX_DEPTH`). Both limits are defined once. Reject self parents, cross-project parents, cross-subproject
    task parents and cycles with a documented error, and validate the whole subtree before a reparent.
81. A task with children is a work container, never an extra unit of work. Its progress and completion are derived
    from leaf work and are never counted twice in a project, subproject, report or published aggregate; its stored
    `Status`/`Progress_Percent` are not authoritative and are not silently rewritten. A task that already carries
    recorded effort, approval or completion is never converted into a container.
82. `Status = Done` is written only by the reviewed completion workflow: a manager decision on a `COMPLETION_REPORT`,
    or an explicit ADMIN correction with a required reason, the exact confirmation and its own
    `COMPLETION_OVERRIDDEN` audit evidence. Every other entrypoint (`Tasks.complete`, `Tasks.update`,
    `Ui.updateProgress`, `Ui.assignTask`, the manager web form) refuses the transition. Existing completed rows stay
    valid legacy records; do not invent approval events for them.
83. `Parent_Task_ID` is organisation and `Dependency_IDs` is sequencing. Never derive one from the other, and keep
    the existing dependency cycle rule.
84. Filtering, sorting and history use stable IDs. Attribute a member's work through the owner ID and the task ID,
    never through a typed requester name, and never invent an event when no record exists. An unverified identity
    stays labelled as self-reported.
85. Publish only the allowlisted V1.6 fields (responsibility `color`, `parentTaskId`, `container`, `reviewState`,
    `completedAt`). Never publish a report note, a reporter name, a private description, acceptance criteria, effort
    or capacity data. An older contract version fails closed instead of being read as the new one.
86. Keep the local-first behaviour: one authorized snapshot, in-memory task index, in-flight deduplication,
    stale-while-revalidate, selective invalidation and revision-checked writes. Do not restore per-click server reads,
    and never persist private manager data in `localStorage`, `sessionStorage` or IndexedDB. The selected
    responsibility filter stays in page memory only.
87. A fresh workbook initializes at schema 7 and records `INITIALIZE_V7`; `007_responsibility_hierarchy_and_lifecycle`
    exists only for an existing V6 workbook. Never use initialization to upgrade an existing database, and never run
    schema-7 writes against a schema-6 workbook without the approved migration and its verified backup.
88. Record PASS, FAIL, BLOCKED or NOT_RUN with evidence in `docs/checkgates/V1_6_GATE_<n>.md`, follow
    [docs/V1_6_DEPLOYMENT_RUNBOOK.md](docs/V1_6_DEPLOYMENT_RUNBOOK.md) for any DEV work, and keep
    `docs/PRODUCTION_READINESS.md` **NOT APPROVED FOR PRODUCTION** until recorded live Workspace evidence exists.

## V1.6.1 mandatory rules (corrective stabilization)

89. One counting rule for every manager figure: `TaskScope` decides what a number means. A container task is
    organisation only; open and overdue counts are open leaf work in active work; completed and cancelled work are
    reported separately and never mixed into a workload figure. Never count a raw task row in a card or a KPI, and
    never introduce a second definition of "open" or "overdue".
90. Resolve a scope on the server, before paging and before any top-N cut. Never filter an already paged list, an
    already cut list or an already aggregated figure in the browser, and always report the scope total next to the
    visible page.
91. A container task can never be completed directly. Refuse a container completion report on inbox import, refuse
    it again **before** the request is claimed, and never leave a request in `PROCESSING` without a recorded reason.
    A phase-1 failure records `REQUEST_APPROVAL_FAILED` and stays retryable; never auto-retry an ambiguous delivery.
92. A permanent removal writes a durable intent (`RECORD_DELETE_PREPARED`) before the row disappears and reports
    success only after `RECORD_DELETED` exists. `reconcileDeletions` may append a missing record for a row that is
    verifiably gone and must never delete anything. Offer no cascading removal, and render the delete control for
    `ADMIN` only.
93. Ownership history is append-only. A member's work stays in that member's history after a reassignment, a former
    assignment shows the current owner, an owner change writes `TASK_REASSIGNED`, and the absence of audit evidence is
    stated as a limitation instead of being filled in.
94. Keep the published contracts readable across an application update: the employee reader accepts contract 1.4 and
    1.5, each validated against its own exact header row, and an unknown or mixed contract still fails closed. Every
    contract date field is normalized and written into a text-formatted column through the one field list.
95. Keep the deployment order honest: push the head code, verify the backup, run the migration, verify preservation,
    then create a new deployment version. Name only entry points that exist (`createDatabaseBackup`,
    `upgradeExistingDatabase`, `reconcileDeletions`), and never claim a live result a local run cannot produce.
96. Record PASS, FAIL or BLOCKED with evidence in `docs/checkgates/V1_6_1_GATE_<n>.md`, keep the V1.6 gate records
    unchanged, and keep `docs/PRODUCTION_READINESS.md` **NOT APPROVED FOR PRODUCTION**.
## V1.7 mandatory rules (multiple assignees, worker view, non-blocking submission)

97. Additional assignees and additional responsibility members live only in `TASK_ASSIGNEES` and
    `RESPONSIBILITY_MEMBERS`. The primary owner columns (`TASKS.Owner_Member_ID`,
    `RESPONSIBILITIES.Owner_Member_ID`) stay authoritative and are never copied into a relationship
    table. Never store a comma separated identifier list.
98. Removal is a soft relationship change: stamp `Removed_At`/`Removed_By`, never delete the row.
    Re-adding a former member reactivates the existing row instead of inserting a duplicate.
99. A new assignment must name an existing, active member. An existing relationship survives a later
    deactivation; never drop it because of an unrelated edit.
100. A membership change is a material assignment change: bump `Assignment_Version`, clear
    `Assignment_Approved_At` and write one audit row. Never silently preserve an approval.
101. Membership is never authorization. Only an ADMIN may change the primary responsibility owner;
    additional members grant no manager capability, and ownership remains accountability only.
102. Read membership through one indexed pass per execution (`src/Assignees.gs` + `Database.memo`).
    Never perform one Sheets read per task or per member.
103. Publish only display names. Contract 1.6 appends `assigneeNames` and keeps `ownerName`; never
    publish member identifiers, e-mail addresses, roles or any other member field, and never publish
    the private `MEMBERS` table to support worker filtering.
104. A shared task stays one task: one ID, one deadline, one status, one progress value and one
    manager approval. Never divide progress per assignee or invent individual completion percentages.
105. The employee worker filter is a display filter, not authentication. Never claim it verifies a
    worker, and document that two people who share a display name cannot be distinguished.
106. Employee submission is non-blocking: validate, show `送信中`, close the form, and report
    `受付完了` only after a durable server acknowledgement. An unobservable outcome is
    `送信結果不明` and is never retried automatically or reported as success.
107. Persist only non-sensitive receipt metadata in the employee browser (task, type, time, state,
    request ID). Never persist explanation text, completion notes or manager data, and never add
    browser persistence to the manager application.
108. Opening 申請一覧 performs exactly one authorized import per page entry. A filter, language or
    render change must never re-import, and import feedback must never claim success on an error or
    `configured:false`.
109. The permanent-deletion confirmation is one Yes/No dialog. The client derives `DELETE <id>` from
    the selected record only after Yes; never weaken the ADMIN check, dependency preflight, revision
    check, verified backup, tombstone or reconciliation, and never allow a duplicate submission.
110. Record PASS, FAIL or BLOCKED with evidence in `docs/checkgates/V1_7_GATE_<n>.md`, keep every
    earlier gate file unchanged, and keep `docs/PRODUCTION_READINESS.md` NOT APPROVED FOR PRODUCTION
    until recorded live evidence exists.
## V1.7.3 mandatory rules (corrective fixes and measured Sheets performance)

111. `Snapshot_Version` is a logical text identifier. Normalize only the fields a schema entry marks
    `coerceText` (today `TASK_REQUESTS.Snapshot_Version` and `Task_Revision_At_Submission`) when a row
    is read; never coerce other string fields, never rewrite a stored request row merely to normalize
    a read, and keep `Due_Date_At_Submission` a date.
112. A decision is applied at most once. A repeated decision must be refused (or repaired) without a
    second task effect, second history row or second audit record, whatever the stored cell types are.
113. Closing an editor, navigating away or dismissing the native dialog (Escape) discards the form
    **and** invalidates a pending editor-open read. A late response must never open a form.
114. An edit always starts from the latest authorized row and its revision. Never build an edit form
    from a list row, never add a second concurrency scheme, and keep `EDIT_CONFLICT` as the refusal.
    Member, responsibility and subproject editors use the narrow allowlisted `editor` read.
115. The application version comes from one constant (`APP_VERSION`). The database schema version,
    the application version, the publisher version and the snapshot contract stay separate values.
116. A parent task must stay discoverable beyond one page through a bounded server search. Never load
    the whole task table into the browser and never relax the hierarchy, cycle or permission rules.
117. Google Sheets stays the authoritative database. Keep the execution-local read context
    (`Database.withReadContext` / `Database.memo`): one range read per table per execution and no
    second workbook open, but never introduce a cross-user server cache of the private workbook.
118. A write stays a partial patch: one range write per contiguous run of changed columns, never a
    full-row rewrite, never a formula cell, custom column or untouched cell. One logical operation is
    still one write.
119. Measurement must not expose data. Metrics may contain timings, service-call counts and payload
    sizes only — never a spreadsheet ID, e-mail address, cell value or request text. Send the detailed
    envelope only when the caller asks for it.
120. The `batchGet` reader is an experiment: `DEV_SHEET_READ_BACKEND=BATCH_GET` plus
    `ENVIRONMENT=DEVELOPMENT`, SpreadsheetApp stays the production path, any failure falls back, and
    the equivalence tests stay green. Never enable an additional OAuth scope or advanced service in
    production automatically.
121. Never replace a local benchmark with a claim about live latency. Record the DEV measurement or
    mark it `NOT_RUN`; keep `docs/PRODUCTION_READINESS.md` **NOT APPROVED FOR PRODUCTION**.
122. Record PASS, FAIL or BLOCKED with evidence in `docs/checkgates/V1_7_3_GATE_<n>.md`, keep every
    earlier gate file unchanged, and update the performance, architecture and deployment documents
    with every behavioural change.

## V1.7.4 mandatory rules (visual refresh and project colour hierarchy)

123. This is a client-side visual release. Do not add a migration, a spreadsheet column, a Script
    Property, a new backend read or a new API call for a colour, and do not change request, approval,
    assignment, audit, notification or publication logic.
124. A project accent comes from the stable `Project_ID` through `shared/project-colors.js`. Never
    derive it from a list position, a filtered index, a sort order or the rendered order, so a project
    keeps its colour across navigation, filtering, sorting and refresh.
125. Only palette values may reach a CSS colour. A project ID or name is never interpolated into a
    style, and the helper exposes CSS custom properties (`--project-accent`, `--project-outline`,
    `--project-tint`) rather than raw colour input.
126. Every subproject and every task (including a nested task) of one project carries the same hue.
    Depth changes indentation and strength, never the hue, and the hierarchy IDs and relationships do
    not change.
127. A project colour is an identity marker, never a status. Warning, approval, completion and error
    states keep the semantic palette and a readable text label, and the employee dashboard keeps its
    health warning next to the stable identity colour.
128. Reuse of a palette entry is acceptable and must never be documented or presented as a globally
    unique project identity. The project name is always visible, so colour is never the only signal.
129. The manager client and the employee dashboard keep one identical copy of the shared helper
    (`npm run sync:colors`); `npm run validate` fails on drift, on a non-palette value or on an
    empty-ID colour.
130. Record PASS, FAIL or BLOCKED with evidence in `docs/checkgates/V1_7_4_GATE_<n>.md`, keep earlier
    gate files unchanged, and keep live Workspace verification separate from local preview evidence.

## V1.7.5 mandatory rules (stability, data integrity and logic corrections)

131. A task summary is patched from the authoritative write response, never rebuilt. Copy only fields
    the write determines directly; `container`, `depth`, `reviewState`, the effective assignee list and
    the shared-assignment flag are server-derived and keep their last authoritative value until the
    compact index answers. Never append a summary a partial row cannot describe.
132. A save refreshes the narrowest authoritative dataset. A task save re-reads the compact index and
    marks the snapshot aggregates stale for the page that shows them; it never replaces the whole
    snapshot for a task page, and it never guesses an aggregate.
133. An answer produced before a newer save is discarded. A refresh carries a generation token, and a
    superseded read is dropped with its cached payload (`supersedeRead`) so it can neither paint nor
    be joined by the newer refresh.
134. 申請一覧 synchronization is identified by the page entry **and** the selected filter. A response or
    failure from an abandoned entry or a superseded filter never paints and never sets the error state;
    the one automatic import per entry stays, and the server import stays idempotent.
135. A compact index whose record count differs from the snapshot is expected concurrent modification:
    accept the newer authoritative count. An unusable payload recovers through one snapshot read, one
    retry and then the paginated server list, and never leaves the task page loading or looping.
136. Validate remote payloads at the API boundary (`readContract` / `EH.requireArray`). A required field
    that is missing or of the wrong type is reported as `INVALID_RESPONSE` with a retry — never rendered
    as an empty result and never left as an unhandled `TypeError`; a documented-optional field keeps its
    documented default. Never blanket-replace a required array access with a defaulting fallback, which
    would hide a real contract failure as an empty list.
137. The task form persists the hierarchy it displays. `Parent_Task_ID` is written on create and on
    edit, and the existing self/cross-project/cycle/depth validation stays authoritative.
138. Record PASS, FAIL or BLOCKED with evidence in `docs/checkgates/V1_7_5_GATE_<n>.md`; keep schema 8,
    employee contract 1.6, the migrations, the authorization rules and the project colours unchanged,
    and keep `docs/PRODUCTION_READINESS.md` **NOT APPROVED FOR PRODUCTION** until live evidence exists.

## V1.7.6 mandatory rules (request consistency and asynchronous-state safety)

139. A request decision is a task write for invalidation purposes. Approving, rejecting, returning or a
    stale outcome invalidates the compact index, the task and project pages, the scoped overview
    payloads and the snapshot aggregates, and the derived values are re-read from the server. Never
    rebuild a task summary, deadline, progress or review badge from a guessed value, and never reload the
    whole snapshot for a decision.
140. An import is measured by what it changed. Only `imported > 0` invalidates derived data and re-reads
    an index the page already holds; an import that created nothing costs no extra call. The rule applies
    to `requestSync` and to the ordinary queue read, which also imports server-side.
141. Revocation advances every asynchronous generation. `revoke()` invalidates the page, editor, compact
    index and request-sync generations, drops the private caches and the open form, and supersedes every
    in-flight read. Every asynchronous entry point verifies `revoked` (or its generation) before it
    paints, caches, notifies or reopens a form. Never cancel or replay a server mutation because a
    response was discarded; server-side authorization stays authoritative.
142. Invalidation supersedes the in-flight read, not only the cached payload. `invalidatePrefixes()`
    considers the union of cached and in-flight keys so a read started before a newer write can neither
    paint nor be joined by the newer refresh, and a superseded view read is re-read once instead of
    leaving a loading state.
143. A required response field is validated at the API boundary in the manager application **and** in the
    bound sidebars. `automation.status` and `automation.settings` are required; a missing field is one
    readable `INVALID_RESPONSE`, never a `TypeError` from inside an error handler and never a silently
    empty form.
144. Record PASS, FAIL or BLOCKED with evidence in `docs/checkgates/V1_7_6_GATE_<n>.md`; keep schema 8,
    employee contract 1.6, the migrations, the authorization rules and the project colours unchanged,
    and keep `docs/PRODUCTION_READINESS.md` **NOT APPROVED FOR PRODUCTION** until live evidence exists.

## V1.7.7 mandatory rules (authorization denial and request synchronization)

145. A refused authorization is recognized by a stable code, not by wording. `Roles.denied` marks the
    refusal, `ManagerWeb.response` returns `code: 'AUTHORIZATION_DENIED'`, and the browser classifies an
    answer through one classifier and revokes through one path. Never add a second revocation mechanism
    and never infer a denial from arbitrary English text when the code is available.
146. Only a genuine denial revokes the client. A timeout, a network failure, `EDIT_CONFLICT`, an invalid
    form value, a missing optional record, an unavailable request inbox, a failed notification and an
    ambiguous write keep their existing safe error handling and must never drop the page.
147. After a revocation no callback may repaint, re-cache, notify, reopen a form or replace the
    access-denied message. Every asynchronous entry point — read, write, request decision or import,
    editor detail, administration and diagnostics — verifies `revoked` or its generation first.
148. An import that created requests refreshes the filter the manager is looking at. The server's
    `imported.imported` decides it, the current filter is re-read at most once, the answer is applied only
    while its page generation and filter are current, a read already running is superseded instead of
    duplicated, and an import that created nothing adds no call. Never re-import to refresh a list.
149. Record PASS, FAIL or BLOCKED with evidence in `docs/checkgates/V1_7_7_GATE_<n>.md`; keep schema 8,
    employee contract 1.6, the migrations, the authorization rules and the project colours unchanged,
    and keep `docs/PRODUCTION_READINESS.md` **NOT APPROVED FOR PRODUCTION** until live evidence exists.

## V2 mandatory rules (PostgreSQL platform)

These rules apply to the V2 runtime (`apps/`, `packages/`, `tools/`, `deploy/`, `docs/v2/`).
The rules above stay in force for the V1 Apps Script project (`src/`, `dashboard-app/`,
`shared/`, `scripts/`); V2 does not modify, deploy or migrate that project automatically.

150. **Google Sheets is not the V2 database.** PostgreSQL is authoritative for projects,
     subprojects, tasks, requests, approvals, audit and notifications. The workbook is read-only
     for migration and is a one-way report/output target. Never add a spreadsheet write path to
     the manager application, and never present a Sheets editor as an authorization boundary.
151. **V1 rules carry over unchanged in meaning.** Counting (`TaskScope`), progress weights,
     hierarchy limits (4 subproject levels, 3 task levels), container tasks, completion workflow,
     request decisions, staleness, soft relationships, audit and notification gating exist once in
     `packages/domain`. Never duplicate a rule in a route, a component or a trigger without the
     domain function, and never introduce a second definition of "open", "overdue" or "progress".
152. **Identity is server-verified.** In local mode (authorized 2026-11-02), use employee ID + password, hashed with scrypt; no email is required. Temporary credentials require a password change before work data access. Local mode must never accept development/Google credentials. In Google mode, verify ID token signature, issuer, audience, expiry,
     `email_verified` and the company domain, then a database member row. A browser-supplied role,
     member ID, owner or confirmation is data, never authority. A missing or unverified identity
     fails closed; never substitute the deployer or a default user.
153. **A write is one logical operation and one transaction.** Validate inputs, the revision, the
     hierarchy and the confirmations before the first mutation. Create commands require an
     idempotency key. A mutation carries the revision the editor loaded and a mismatch is
     `EDIT_CONFLICT`, never a silent overwrite.
154. **Nothing destructive is automatic.** Only the reviewed ADMIN deletion path may remove a row,
     and only for a demonstrably empty record, after the preflight, the typed phrase, a reason and
     the tombstone. Deadline history, schedule decisions, requests, notifications, recorded effort,
     approvals and published records always block removal. Retention is reported, never enforced.
155. **`MailApp`, `GmailApp`, `CalendarApp`, `ScriptApp`, `UrlFetchApp` and `DriveApp` are V1
     names.** V2 reaches Google only from the worker through its REST transports. Off is the
     default (`EMAIL_MODE=OFF`, `EMERGENCY_STOP=true`), an unconfigured mailbox fails closed, LIVE
     requires ADMIN, the exact phrase and a passing preflight, and an ambiguous delivery becomes
     `DELIVERY_UNCERTAIN` and is never retried automatically.
156. **Publication stays one allowlisted contract.** Only `packages/contracts/src/published.ts`
     defines the headers; only `INTERNAL` projects are published; the snapshot is written A/B and
     verified before a single metadata commit; an older contract fails closed. Never publish an
     e-mail address, member identifier, role, skill, capacity figure, private description,
     acceptance criterion, note or request text.
157. **Browser text is untrusted output.** React text rendering only; `innerHTML`, `outerHTML`,
     `insertAdjacentHTML` and `document.write` are rejected by `npm run validate`. Never persist
     manager data in `localStorage`, `sessionStorage` or IndexedDB; the only browser keys are the
     language and non-sensitive request receipts.
158. **Measure, never claim.** The benchmark harness produces timings, call counts and payload
     sizes only. Local numbers are not production latency, live Workspace behaviour stays
     BLOCKED/NOT_RUN until recorded evidence exists, and `docs/PRODUCTION_READINESS.md` stays
     **NOT APPROVED FOR PRODUCTION**.
159. **Migrations are additive, ordered and checksummed.** An applied file is immutable; a change
     requires a new migration. Verify a backup before a migration, apply it as an explicit
     one-shot step, verify preservation afterwards, and never let a service migrate at boot.
160. **Deployment is separate.** `deploy/` targets a self-hosted stack with the database private,
     TLS at the proxy, secrets only in the environment and the service account only in the worker.
     Nothing in this repository deploys, initializes a workbook, installs a trigger or activates
     mail, Calendar, backup or publication on its own.
161. **Documentation and gates move with the behaviour.** Every behavioural change updates
     `docs/v2/*` and the operating docs, and records PASS, FAIL, BLOCKED or NOT_RUN with evidence
     in `docs/v2/ACCEPTANCE.md` (or the release's gate file). Keep earlier gate records unchanged.
162. **Keep the two applications separate.** `dashboard-app/` remains a standalone Apps Script
     web app for as long as V1 is deployed. Never push V2 code into it, never reuse its clasp
     target, and never make V2 depend on a V1 Script Property.

## V2 stabilization rules (2026-10-31)

163. **A build that cannot start is not a build.** The API, worker and migration CLI artifacts must
     start from their documented `node dist/…` command. Internal `@eh/*` workspaces are bundled
     into the artifact; a runtime image must not need source directories. `npm run smoke:prod` is
     the gate for a production artifact and must keep working.
164. **A job outcome belongs to the lease that produced it.** Every claim carries a lease token;
     completion, failure and renewal require it. Never complete or fail a job by `job_id` alone.
165. **An external send is claimed before it happens.** Persist the delivery attempt, record the
     outcome only for that attempt, treat an interrupted attempt as `DELIVERY_UNCERTAIN`, and keep
     `authorize-delivery-retry` as the only path back. Never auto-retry an ambiguous delivery and
     never claim exactly-once Gmail delivery.
166. **Notification identity names the event.** Reminder stage and request id are part of the
     ledger key. A preview never consumes a live send, and a capped run reports the deferred
     recipients instead of silently dropping them.
167. **A destructive check and the removal share one transaction.** The target row is locked and
     the blockers and revision are re-evaluated inside the deleting transaction.
168. **Reconciliation compares the destination, not the source.** Every mapped table, blank cells
     against destination defaults, relationship tables as sets, settings against their documented
     safe overrides, plus a destination checksum. Report volatile defaults as skipped, never as a
     match.
169. **Public browser configuration is runtime, never build-time.** Auth mode (local/google) is also an allowlisted non-secret configuration field. `GET /api/public-config` may
     expose only the OAuth client ID, the release marker and whether the development fixture is
     available. Never compile a `VITE_*` login secret and never expose a database URL, token,
     spreadsheet id or service-account value.
170. **A verified Google subject is the identity binding.** Link it once, audit `IDENTITY_LINKED`,
     and refuse a different subject for an already-linked address.
171. **A read owns its cache key.** An older completion may not replace, recreate or clear a newer
     entry; invalidation refetches mounted queries; sign-out rejects late completions.
172. **Tests must fail when the database is absent.** CI runs a real PostgreSQL service with
     `REQUIRE_DATABASE=1`. A skipped database suite is not a passing gate.
173. **Deployment templates are validated, not assumed.** `npm run validate:deploy` checks the
     Compose topology (private database, PostgreSQL 18 volume path, explicit migrate profile),
     the top-level Caddy site block, the tunnel example and the container build definitions. A
     static pass is not a live deployment.


## V2 division rules (responsibility-centred account, 2026-11-10)

These rules narrow one earlier statement: a `MANAGER` no longer manages the whole department. A
`MANAGER` manages work inside the divisions (課) where they hold a `WORK` membership. Additional
`READ` access from an `ADMIN` grants observation only - never a creation, an edit, an approval or an
assignment. Rule 68's "department-wide" wording applies to `ADMIN` and to the administrative view
only; every other rule stands unchanged.

174. **A division is administrator-managed data, never a source enum.** `DIVISIONS` carries a
     stable `division_id`, a name, an active/retired status, a sort order and a revision. Renaming
     keeps every identifier; retiring (廃止) and reactivating (再有効化) never delete a row, a
     project, a task or a history entry.
175. **Role, membership and visibility stay separate.** `ROLE` decides what an account may do.
     `WORK` membership decides where it may create, manage, approve and be assigned. `READ`
     access decides where it may only observe. Membership implies reading, and additional read
     access never grants a creation, an edit, an approval or an assignment.
176. **One division policy enforces every path.** `packages/domain/src/divisions.ts` is the only
     place that answers "may this account read/write this division?". It is applied before
     paging, totals, top-N cuts, search suggestions, hierarchy projection, reports, exports and the
     employee snapshot. A client-supplied `divisionId` narrows the resolved scope and is refused
     when it is not authorized; an empty authorisation set is never global access. The separate
     company-wide publication source is not a per-viewer read and fails closed (rule 193).
177. **Work has one canonical division.** `PROJECTS.division_id` holds it; a task or subproject
     derives it through its project and never stores a second editable value. A scoped
     `RESPONSIBILITIES.division_id` must agree with every project of that area, enforced by a
     database trigger. `TASKS.Owner_Member_ID`, the additional assignees, the subproject owner and
     the responsibility owner/members are all assignment relationships, never division grants.
178. **Assignment needs membership, not a role.** A person may be newly assigned only when they
     are active and hold a `WORK` membership in the work's division. `ADMIN` status,
     `GENERAL_MANAGER` oversight and additional read access never qualify anybody. A mixed
     valid/invalid selection is one failed operation; nothing is partially saved, and an existing
     relationship survives a later deactivation.
179. **`GENERAL_MANAGER` (次長) is read-only oversight.** It sits BELOW `MEMBER` in
     `ROLE_ORDER` so no comparison can grant it a write. It may read every division (or an
     ADMIN-selected list), including restricted work, but it never creates, edits, approves,
     archives, deletes, reopens, manages accounts or activates notifications, and it never receives
     private HR, credential or settings data. Unknown or blank roles fail closed.
180. **Membership removal is a preflighted soft change.** Removing a membership with unresolved
     active work in that division is refused with a summary; nothing is silently unassigned, moved,
     deleted or archived. The relationship row is stamped, never deleted, and a re-added member
     reactivates it. Only an `ADMIN` changes membership or oversight, and every change is audited.
181. **Unmapped work fails closed.** A project whose division is blank is readable and editable by
     `ADMIN` only, so it can be mapped deliberately. The reviewed mapping for existing projects,
     areas, members and assignments is an explicit input; nothing is inferred from a name, a free
     text department, a role, an owner or a task assignment, and no historical row is silently put
     into the first division. A retired division accepts no new project, subproject or task even
     when the request carries no assignee, and publication is refused entirely while the snapshot
     cannot enforce division isolation.
182. **Division transfer and retirement are explicit.** Ordinary project editing never exposes a
     persisted division. An `ADMIN` transfer validates the responsibility, every owner, assignee
     and subproject owner, refuses the whole move when an assignment would become ineligible, and
     records the previous and new division. A retired division accepts no new work or assignment
     and keeps its history readable.
183. **The employee snapshot is scoped on the server.** `/api/employee/snapshot` returns the
     `INTERNAL` work of the divisions the caller may read; it is never a company-wide payload
     filtered in the browser. The separate V1 shared-dashboard workbook remains a company-wide,
     allowlisted `INTERNAL` publication; per-division isolation of that workbook is BLOCKED in
     this release and is documented as such rather than claimed.
184. **Record evidence.** Behavioural changes update `docs/v2/DIVISIONS.md` and the operating docs,
     and record PASS, FAIL, BLOCKED or NOT_RUN in `docs/v2/ACCEPTANCE.md`. Keep
     `docs/PRODUCTION_READINESS.md` **NOT APPROVED FOR PRODUCTION** until recorded live
     Workspace evidence exists.

## V2 division repair rules (2026-11-10)

These rules record the corrective work on the division release. They narrow nothing above; they
make the earlier division rules actually true for every path.

185. **Sign-in configuration is session-independent.** `GET /api/public-config` and
     `POST /api/session` never resolve a session or a division scope. A stale cookie, an expired
     session, an account with no grant and a database that still needs its migration must all reach
     the sign-in screen. A failed configuration load never implies an authentication mode, and the
     sign-in call issues no cookie when its payload cannot be built.
186. **A missing schema is one readiness failure.** An undefined table, column or function is
     `503 DATABASE_MIGRATION_REQUIRED` with safe wording and a sanitized server log line. Never
     present it as a credential problem, never switch `AUTH_MODE` to make a screen load, and never
     migrate automatically.
187. **One narrowing mechanism.** `scopedDivisionIds(scope, requestedDivisionId)` in
     `packages/domain/src/divisions.ts` is the only place a client-supplied `divisionId` narrows a
     query, and it runs before paging, totals, top-N cuts, tree projection and aggregation. A route
     never builds `[divisionId]` itself, and an unauthorized or unknown identifier is `NOT_FOUND`.
188. **`overseeAll` is not `manageAll`.** Only `ADMIN` gets the unrestricted SQL filter; an
     all-division `GENERAL_MANAGER` reads every *mapped* division and never unmapped work.
     `canWriteDivision(scope, null)` is true for `ADMIN` alone, which is what makes the remediation
     of unmapped work possible.
189. **The generic editor authorizes the entity.** `/api/manager/editor` resolves the record and
     then authorizes its division (task/subproject through the project; project and responsibility
     directly) and requires edit capability, not read access. The member editor is `ADMIN` only.
     No editor, detail or reference endpoint may return a record its division boundary forbids.
190. **Every division-scoped write re-checks inside its transaction.** Re-read the acting member
     (role, activation, relationships), the project's current division and its lifecycle state, and
     every newly added assignee's membership through the transaction handle, under the
     `member-divisions` advisory lock, which is taken first and is the only division lock. A check
     made before the transaction is a pre-check, never the authorization.
191. **Membership changes compare the access kind.** `WORK -> READ` is a membership removal and runs
     the active-work blocker (`reason: 'DOWNGRADE'`); `READ -> absent` is only a read revocation and
     never blocks. Removal stays soft and no work is silently unassigned, transferred or archived.
192. **History is authorized, never erased.** A former assignment in a division the reader may not
     see is withheld and counted (`ownership.previousHidden`), never described.
193. **The company-wide snapshot fails closed.** While the V1 shared-dashboard snapshot cannot scope
     rows to a reader's divisions, `publishNow` refuses at execution with `NOT_CONFIGURED` (not only
     in the UI) and `publicationStatus.divisionIsolationSupported` is `false`. A previously
     published snapshot is not revoked by that refusal and must be handled as a separate, explicit
     rollout decision.
194. **Record evidence.** Update `docs/v2/DIVISIONS.md`, `SECURITY.md`, `ARCHITECTURE.md`, `API.md`,
     `MIGRATION.md`, `OPERATIONS.md` and `docs/v2/ACCEPTANCE.md`, keep earlier gate records
     unchanged, and keep `docs/PRODUCTION_READINESS.md` **NOT APPROVED FOR PRODUCTION**.

## V2 division and branding corrections (2026-11-11)

These rules record the corrective release described in `docs/v2/DIVISIONS.md` §11. They narrow
nothing above; they make rules 174-194 true for the paths that still bypassed them.

195. **The V2 product name is a brand, not a division.** The authenticated header, the sign-in title,
     the browser document title and the accessible application name read `シゴトモ` (ja) or
     `SHIGOTOMO` (en), and the language switch updates all of them without losing the route, the
     filters, an open editor or a selection. A division named `設計・開発課` (or any other) is stored
     data and is rendered exactly as stored. Branding never renames a table, an identifier, a
     package, an API, an environment variable, a migration, a stored role or historical audit text,
     and the V1 application keeps its own name until it is separately retired.
196. **Two advisory locks, one order.** `lockDivisionMutation` acquires `member-divisions` and then
     `members:role-and-activation`, and every division-scoped write, membership change, role change,
     activation change and account mutation takes exactly that order. No path acquires the pair in
     the opposite order, so the protocol cannot deadlock. A lock taken after a mutation, or a lock
     acquired in the reverse order, is a defect.
197. **The role is re-read, not remembered.** A transaction-time authorization re-reads the actor's
     stored role and activation *and* its division relationships, then re-applies the canonical role
     capability. A `MEMBER` or `VIEWER` that still holds a `WORK` membership never passes a manager
     mutation after a downgrade, and a division membership is never an action capability.
198. **A responsibility assignment follows the division.** A new or changed owner and every newly
     added member must be an active `WORK` member of the area's division; a division change
     re-validates every retained relationship against the destination; an unchanged relationship
     survives a later deactivation and is never removed by an unrelated edit. Unmapped areas are
     ADMIN remediation only, and a manager never creates or edits one to bypass the rule.
199. **Ordering is scoped and deterministic.** Division ordering is the active/retired group, the
     stored sort order, the name and the identifier, computed once in `listDivisions`; responsibility
     ordering is the same status group *and the same division*. A move reads its neighbours from that
     one order, refuses a foreign neighbour, never writes a row in another division, separates equal
     sort orders without rewriting unchanged rows, and bumps the revision of every row it writes.
     A new division receives the next free sort order inside its group.
200. **Retired divisions are read, never written.** A retired division stays readable for history to
     every account that may already read it (a retained `WORK`/`READ` relationship or documented
     oversight), and it is never offered as a new-work destination. A retained grant survives an
     unrelated member edit; a *new* grant in a retired division is refused. Unmapped work stays
     invisible to oversight.
201. **The overview follows the switch.** Both overview variants send the selected division with their
     request, key their cache entry with it, clear an incompatible responsibility selection and carry
     it into the open/overdue/upcoming drilldowns, so the cards, the lists and a drilldown always
     describe the same scope; a late answer for an older selection can neither paint nor be joined.
202. **Record evidence.** Update `docs/v2/DIVISIONS.md`, `ARCHITECTURE.md`, `API.md`, `SECURITY.md`,
     `OPERATIONS.md`, `docs/v2/ACCEPTANCE.md` and the branding documentation, keep earlier gate
     records unchanged, and keep `docs/PRODUCTION_READINESS.md` **NOT APPROVED FOR PRODUCTION**.
