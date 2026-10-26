# Contributor safety rules

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


