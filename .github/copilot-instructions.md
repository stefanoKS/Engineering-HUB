# Engineering-HUB instructions

Read and follow all forty-one rules in [AGENTS.md](../AGENTS.md) before changing this repository.

This is a Google Apps Script application backed by Google Sheets. Treat code, spreadsheet data, Drive backups, Script Properties, installable triggers and the workbook `AUTOMATION_SETTINGS` table as separate operational state. Follow `/DATA_SCHEMA.md` for data contracts and `/DEPLOYMENT.md` for environment binding and explicit activation.

## Security (non-negotiable)

- Identity comes only from `Session.getActiveUser()`; role, actor, owner and confirmation values from the browser are data, never authority. Every write path calls `Access`/`Roles` server-side.
- Only ADMIN may grant or revoke `ADMIN`/`MANAGER`; nobody may change their own role; the last active administrator can never be demoted or deactivated.
- Task writes: MEMBER only own tasks, MANAGER only their projects/subprojects and own tasks, ADMIN all, VIEWER none.
- Stored spreadsheet text is untrusted output: use `textContent`/DOM creation. `innerHTML`, `outerHTML`, `insertAdjacentHTML` and `document.write` are prohibited in `src/*.html` and fail `npm run validate`.
- The first administrator is created once by `bootstrapFirstAdministrator` (deployment allowlist + exact confirmation + audit). Never add another bootstrap route.
- Google Sheets editor access is not a security boundary. Do not claim production-grade role separation; see [docs/SECURITY_MODEL.md](../docs/SECURITY_MODEL.md).

## Migration and data preservation

- Additive migrations only, reviewed IDs in `APPROVED_MIGRATIONS`, verified backup first, cell-by-cell preservation checks before recording success.
- Never initialize, reset or clear an existing workbook; never delete operational rows, backups or history.
- Only `Schema.generated` sheets may be cleared; operational tables, custom columns and formulas must survive every refresh.

## Notification safety

- Only `src/Notifications.gs` may call `MailApp.sendEmail`. Every notification, reminder and report passes that gate.
- OFF by default, emergency stop on, unconfigured workbooks fail closed. Any transition to an effective LIVE state requires ADMIN, `ENABLE LIVE EMAIL` and a passing preflight.
- Ledger states `PENDING`/`SENT`/`PREVIEW`/`DELIVERY_UNCERTAIN`; never auto-retry an ambiguous delivery; never replay history.
- Notification changes require regression tests for the OFF/PREVIEW/LIVE matrix, per-project/per-task switches, deduplication and uncertain delivery.
- Manager preferences live in `AUTOMATION_SETTINGS` (never source constants) and every change is audited.

## Shared dashboard (V1.2)

- `dashboard-app/` is a **separate**, read-only Apps Script web app with its own clasp target and Script Properties. It never reads the management workbook, has no write path, and may not use `MailApp`, `GmailApp`, `CalendarApp`, `ScriptApp`, `UrlFetchApp`, `DriveApp` or manager modules. `npm run validate` rejects them.
- Publish only allowlisted fields through `SharedDashboardModel`; `Dashboard_Visibility` must be exactly `INTERNAL`. Never publish e-mail addresses, skills, HR capacity, logs, settings, private descriptions or acceptance criteria.
- Publication is A/B transactional, defaults OFF, is independent of the mail mode, and requires ADMIN plus `ENABLE SHARED DASHBOARD PUBLICATION`. A failed run must leave the previous snapshot readable.
- The snapshot spreadsheet ID lives in `SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID` and is never returned to a browser.
- Access is the deployment ACL (`access: DOMAIN`, execute as deployer, `spreadsheets.readonly`), not client-side hiding. Dashboard Workspace behaviour is UNVERIFIED until [docs/dashboard/SMOKE_TEST.md](../docs/dashboard/SMOKE_TEST.md) is completed.

## Testing and release

- Use the Node.js 22 tools: `npm ci`, `npm run lint`, `npm test`, `npm run validate`. Never delete or weaken a test to make a gate pass, and keep earlier gate records intact.
- Local mocks are not live verification. [docs/PRODUCTION_READINESS.md](../docs/PRODUCTION_READINESS.md) stays **NOT APPROVED FOR PRODUCTION** until recorded Workspace evidence exists; never fabricate it.
- Update the English/Japanese overviews and the operating docs (including `docs/`) with every behavioural change.

## V1.3 rules (deadline planning, worker requests, bilingual UI)

Follow `/AGENTS.md` rules 35–48 in addition to the rules above.

- The user-visible name is exactly `設計・開発課 管理`; internal identifiers stay unchanged.
- Deadline + required duration drive the schedule; duration is never converted to labour hours.
- No workload-overlap validation, capacity limit, automatic reassignment or conflict blocking.
- Only `src/Notifications.gs` sends mail; request notifications default to OFF.
- The dashboard may only append validated rows to the separate request inbox; never read the
  private workbook and never write the published snapshot.
- Any internal viewer may request a deadline change or report completion for any published
  task. Never add a login/password UI or an owner-match check for requests.
- Only a manager approval changes `Due_Date`, once, with history and audit rows; a changed
  task makes the pending request `STALE`.
- Translation lives in `shared/i18n.js` (copied by `npm run sync:i18n`). Never translate
  stored text, identifiers or enum values. Japanese is the default; keep the
  `日本語 | English` switch on every listed screen and keep the language in `localStorage`.
- Run `npm ci`, `npm run lint`, `npm test` and `npm run validate` before opening a PR, and
  record the V1.3 check gates.

## V1.3.1 rules (pre-trial stabilization)

Follow `/AGENTS.md` rules 49–56. These protect the first trial installation.

- Create and edit share one form per record type. An edit is a **partial patch**: a field the
  manager did not address is never rewritten with a blank, default or recomputed value.
- `Project_ID`, `Task_ID`, `Original_Deadline`, `Created_At` and the audit/migration
  identifiers are never editable. An edit never recreates a record.
- `Ui.updateProject` and `Ui.assignTask` refuse an update whose loaded timestamp no longer
  matches the stored row, and never write through a browser-supplied role.
- A new project is `RESTRICTED` until a manager selects `INTERNAL`; only the allowlisted
  sanitized snapshot is published, and the UI must state that a visibility change appears at
  the next publication. Never imply the shared dashboard updates instantly.
- A project created without an owner belongs to the verified creating manager; never invent an
  owner ID.
- Opening 申請一覧 imports new inbox rows under the script lock with the inbox request ID as the
  permanent ID. An import failure is a warning: it must never hide already imported requests
  or claim success.
- `REQUEST_SUBMISSION_ENABLED` must be exactly `true` for the dashboard to accept a request;
  absent means closed and the UI state must match.

