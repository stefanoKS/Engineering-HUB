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
27. Test every role privilege change: granting/revoking `ADMIN`/`MANAGER`, self-change, the last active administrator, cross-member and cross-project task edits, and VIEWER refusal.
28. Treat every stored string as untrusted browser text. Render with `textContent`/DOM creation; `innerHTML`, `outerHTML`, `insertAdjacentHTML` and `document.write` are prohibited in `src/*.html` and are rejected by `npm run validate`.
29. Keep email safe by default. OFF is the default, emergency stop is on, unconfigured workbooks fail closed, and any transition to an effective LIVE state requires ADMIN, the exact confirmation and a passing preflight.
30. Preserve migration compatibility: additive migrations only, verified backup first, cell-by-cell preservation checks, no schema change without a reviewed migration ID, and no initialization of an existing workbook.
31. Update documentation with every behavioural change: `README.md`, `README_JP.md`, `ARCHITECTURE.md`, `DATA_SCHEMA.md`, `DEPLOYMENT.md`, `BACKUP_RESTORE.md`, `docs/` and the relevant check gate.
32. Reopen a failed check gate instead of working around it. Record PASS, FAIL or BLOCKED plus evidence; keep earlier PASS records as historical local results.
33. Never fabricate live test evidence. Local mocks are not Workspace verification; `docs/PRODUCTION_READINESS.md` stays NOT APPROVED until recorded live evidence exists.

