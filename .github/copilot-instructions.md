# Engineering-HUB instructions

Read and follow all twenty-four rules in `/AGENTS.md` before changing this repository.

This is a Google Apps Script application backed by Google Sheets. Treat code, spreadsheet data, Drive backups, Script Properties, installable triggers and the workbook `AUTOMATION_SETTINGS` table as separate operational state. Follow `/DATA_SCHEMA.md` for data contracts and `/DEPLOYMENT.md` for environment binding and explicit activation.

Keep changes narrow and testable. Do not add real IDs, credentials, destructive resets, automatic backup deletion, or automatic restore operations. Initialization must never be used to upgrade an existing database. Preserve conservative notification defaults, versioned assignment approval, and the separate schedule confirmation.

Use the existing Node.js 22 tools: `npm ci`, `npm run lint`, `npm test`, and `npm run validate`. Local test results are not evidence of live Workspace verification.

V1.1 rules:

- Outbound mail, Calendar sync and automatic refresh default to OFF; legacy `EMAIL_ENABLED` / `DRY_RUN` flags can never activate LIVE mail on their own once settings are configured.
- Only `src/Notifications.gs` may call `MailApp.sendEmail`; every notification, reminder and report passes that single gate.
- Manager preferences persist in `AUTOMATION_SETTINGS`, never as source constants, and every change is audited.
- The manager UI is container-bound; `Ui.gs` and `src/Ui*.html` must call validated domain services with server-side role checks and must never send mail from a browser callback.
- Generated sheets alone may be cleared (`Schema.generated`); operational tables, custom columns and formulas must survive every refresh.
- Notification changes require regression tests for the OFF/PREVIEW/LIVE matrix, per-project and per-task switches, deduplication and uncertain delivery.

Update the corresponding English/Japanese overview and operating documentation (including `docs/`) when changing public behavior.