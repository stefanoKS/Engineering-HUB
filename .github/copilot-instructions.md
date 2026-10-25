# Engineering-HUB instructions

Read and follow all fifteen rules in `/AGENTS.md` before changing this repository.

This is a Google Apps Script application backed by Google Sheets. Treat code, spreadsheet data, Drive backups, Script Properties, and installable triggers as separate operational state. Follow `/DATA_SCHEMA.md` for data contracts and `/DEPLOYMENT.md` for environment binding and explicit activation.

Keep changes narrow and testable. Do not add real IDs, credentials, destructive resets, automatic backup deletion, or automatic restore operations. Initialization must never be used to upgrade an existing database. Preserve conservative notification defaults and versioned assignment approval.

Use the existing Node.js 22 tools: `npm ci`, `npm run lint`, `npm test`, and `npm run validate`. Local test results are not evidence of live Workspace verification. Update the corresponding English/Japanese overview and operating documentation when changing public behavior.
