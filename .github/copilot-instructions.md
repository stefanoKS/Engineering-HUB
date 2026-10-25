# Engineering-HUB instructions

Read and follow all thirty-three rules in [AGENTS.md](../AGENTS.md) before changing this repository.

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

## Testing and release

- Use the Node.js 22 tools: `npm ci`, `npm run lint`, `npm test`, `npm run validate`. Never delete or weaken a test to make a gate pass, and keep earlier gate records intact.
- Local mocks are not live verification. [docs/PRODUCTION_READINESS.md](../docs/PRODUCTION_READINESS.md) stays **NOT APPROVED FOR PRODUCTION** until recorded Workspace evidence exists; never fabricate it.
- Update the English/Japanese overviews and the operating docs (including `docs/`) with every behavioural change.