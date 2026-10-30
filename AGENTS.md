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

35. Keep the user-visible application name exactly `設計・開発課 管理`. Never rename internal identifiers (worksheets, functions, Script Properties, migration history, public APIs) for branding.
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
