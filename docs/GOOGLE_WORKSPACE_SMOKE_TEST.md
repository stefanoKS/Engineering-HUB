# Google Workspace smoke test (development only)

**Status: EVERY ITEM IS UNVERIFIED.** No live Google Workspace test has been executed for this repository. Each
item below must be recorded as PASS / FAIL / BLOCKED with the date, account and observed evidence. Local unit tests
(`npm test`) are not evidence of live behaviour.

All steps are manual and must run in an isolated **development** Apps Script project and development spreadsheet.
Never run them against production. Never enable email or Calendar during setup.

## 0. Preparation

- [ ] UNVERIFIED — Development Apps Script project exists and is **container-bound** to the development spreadsheet.
- [ ] UNVERIFIED — `.clasp.dev.json` selected (`Copy-Item .clasp.dev.json .clasp.json -Force`) and its `scriptId`
      inspected.
- [ ] UNVERIFIED — `npm ci`, `npm run lint`, `npm test`, `npm run validate` pass for the deployed commit.
- [ ] UNVERIFIED — Development spreadsheet ID, backup folder ID and the developing account are recorded locally
      (not in Git).
- [ ] UNVERIFIED — OAuth consent reviewed for the account that will own the triggers.

## 1. Environment binding and initialization

- [ ] UNVERIFIED — `ENVIRONMENT=DEVELOPMENT`, `BOUND_ENVIRONMENT=DEVELOPMENT`, `SPREADSHEET_ID=<dev id>`,
      `BACKUP_FOLDER_ID=<restricted dev folder>`, `ALLOWED_RECIPIENT_DOMAINS=<dev-only domain>`.
- [ ] UNVERIFIED — initialization refuses a workbook that already contains any value or formula.
- [ ] UNVERIFIED — `SCHEMA_MIGRATIONS` shows `INITIALIZE_V3` and `Migrations.currentVersion()` is `3`.
- [ ] UNVERIFIED — no trigger, mail or Calendar event was created by initialization.

## 2. First administrator bootstrap

- [ ] UNVERIFIED — without `ADMIN_BOOTSTRAP_ALLOWLIST`, `bootstrapFirstAdministrator` refuses.
- [ ] UNVERIFIED — with the allowlist missing this account, it refuses.
- [ ] UNVERIFIED — with a wrong confirmation string, it refuses.
- [ ] UNVERIFIED — with the allowlist, an active member row and the exact `BOOTSTRAP ADMIN <email>` confirmation,
      the member becomes `ADMIN`, `ADMIN_BOOTSTRAPPED` appears in `AUDIT_LOG`, and
      `ADMIN_BOOTSTRAP_COMPLETED_AT` is set.
- [ ] UNVERIFIED — running it a second time is refused.
- [ ] UNVERIFIED — after creating a notification log row (or activating notifications), it is refused as an
      operational workbook.

## 3. Two-account permission enforcement

Prepare a second Google account with an active `MEMBER` row (and optionally one with `VIEWER`).

- [ ] UNVERIFIED — ADMIN sees every project, member e-mail and the full skill matrix.
- [ ] UNVERIFIED — the second account (MEMBER) is refused by default
      (`Member self-service is disabled: manager access is required`).
- [ ] UNVERIFIED — with `ALLOW_MEMBER_SELF_SERVICE=true`, that account opens the sidebar and sees only its own tasks
      and the projects of those tasks; other members show only id/name/active.
- [ ] UNVERIFIED — with `ALLOW_MEMBER_SELF_SERVICE=true`, the MEMBER still cannot see other people's skill
      assessments or the gap list.
- [ ] UNVERIFIED — a VIEWER account is refused even with self-service enabled (`Insufficient role: MEMBER required`).
- [ ] UNVERIFIED — a MANAGER account cannot grant `ADMIN` (error mentions `Insufficient role: ADMIN`).
- [ ] UNVERIFIED — an account cannot change its own role, even as ADMIN.
- [ ] UNVERIFIED — the last active ADMIN cannot be demoted or deactivated.

## 4. Cross-member task update rejection

- [ ] UNVERIFIED — as the MEMBER, updating a task owned by someone else is rejected with a scope error and the cell
      does not change.
- [ ] UNVERIFIED — as the MEMBER, sending extra `role: 'ADMIN'` / `actor` fields in the payload changes nothing.
- [ ] UNVERIFIED — as a MANAGER, a task in a project they do not own is rejected.
- [ ] UNVERIFIED — as ADMIN, the same update succeeds and is audited.

## 5. Sidebar HTML safety

Create fictional records containing `<img src=x onerror=alert(1)>` and `<script>alert(2)</script>` in a member
name, a project name, a task name, a notification-history row and an error message.

- [ ] UNVERIFIED — the text is displayed literally in メンバー, タスク割当, 自動化設定 → 履歴 and システム状態.
- [ ] UNVERIFIED — no alert/dialog appears and no element is injected (inspect the DOM).
- [ ] UNVERIFIED — setting a status error with a script-like string shows it as plain text.

## 6. Email OFF / PREVIEW / LIVE

- [ ] UNVERIFIED — default `EMAIL_MODE=OFF`: approve a task, run the scan, confirm zero e-mails and zero `SENT` rows.
- [ ] UNVERIFIED — `PREVIEW`: the scan records `PREVIEW` rows, sends nothing, and a second scan the same day does
      not duplicate them.
- [ ] UNVERIFIED — switching PREVIEW → LIVE sends exactly one already-eligible notification and does not replay
      history.
- [ ] UNVERIFIED — `EMAIL_ENABLED=false` or `DRY_RUN=true` blocks LIVE with the reason
      `LEGACY_SAFETY_FLAGS_BLOCK_LIVE`.
- [ ] UNVERIFIED — with automation settings absent and `ALLOW_LEGACY_EMAIL_CONFIG` unset, the effective mode is
      `OFF` (`LEGACY_CONFIGURATION_BLOCKED`) and nothing is sent.

## 7. Admin-only email reactivation

- [ ] UNVERIFIED — as ADMIN: LIVE → emergency stop shows `OFF` immediately, without confirmation.
- [ ] UNVERIFIED — as MANAGER: clearing the emergency stop is refused (confirmation, then `Insufficient role:
      ADMIN`).
- [ ] UNVERIFIED — as ADMIN: clearing the emergency stop with `ENABLE LIVE EMAIL` succeeds, writes
      `EMAIL_LIVE_ACTIVATED`, and a rescan sends no duplicate.
- [ ] UNVERIFIED — as MANAGER: setting the mode to `OFF` works immediately.

## 8. Report scheduling and trigger ownership

- [ ] UNVERIFIED — enable 週次レポート with MONDAY 08:30; reinstall triggers; the weekly trigger exists once and
      システム状態 shows 一致.
- [ ] UNVERIFIED — change the time to 14:45; システム状態 shows 再インストールが必要; after reinstalling, only one
      weekly trigger remains and it fires near 14:45 JST.
- [ ] UNVERIFIED — change the weekday; after reinstalling, the trigger fires on that weekday only.
- [ ] UNVERIFIED — disable the report; after reinstalling, the weekly trigger is gone and unrelated triggers remain.
- [ ] UNVERIFIED — a trigger created by a different account is invisible/unrepairable from this account (documented
      behaviour), and installing with a non-matching account is refused.

## 9. Data preservation

- [ ] UNVERIFIED — create two projects, two subprojects, a direct task and a subproject task with fictional data.
- [ ] UNVERIFIED — add a manual column with a formula to `TASKS`; run ダッシュボード更新; the formula and every
      operational value survive and the IDs are unchanged.
- [ ] UNVERIFIED — confirm no operational sheet was cleared and `DASHBOARD` shows the refresh time.
- [ ] UNVERIFIED — archive a project; its tasks/issues/milestones remain and it is excluded from active views.

## 10. Backups and restore drill

- [ ] UNVERIFIED — `createDatabaseBackup()` returns a Drive copy ID; the copy is private and matches the source.
- [ ] UNVERIFIED — `BACKUP_LOG` records `VERIFIED` and `LAST_BACKUP_RESULT` is updated.
- [ ] UNVERIFIED — disabling `DAILY_BACKUP_ENABLED` skips the scheduled job, but a migration still creates a backup.
- [ ] UNVERIFIED — restore into a new copy per [BACKUP_RESTORE.md](../BACKUP_RESTORE.md): new ID, rebinding,
      ledger reconciliation and sign-off.

## 11. Calendar synchronization

- [ ] UNVERIFIED — with `CALENDAR_ENABLED=false`, sync reports disabled and creates nothing.
- [ ] UNVERIFIED — with a dedicated secondary calendar enabled, one milestone creates exactly one owned event and
      the last-sync status is persisted.
- [ ] UNVERIFIED — a manually created unrelated event is never modified.
- [ ] UNVERIFIED — disabling the setting stops syncing and deletes nothing.

## 12. Notification delivery uncertainty

- [ ] UNVERIFIED — force a send failure; the ledger keeps the row `PENDING` and a rescan does not retry it.
- [ ] UNVERIFIED — `reconcileUncertainDeliveries` marks it `DELIVERY_UNCERTAIN` with actor/timestamp and nothing is
      resent.

## 13. Close-out

- [ ] UNVERIFIED — temporary editor wrappers, allowlist entries and test records removed.
- [ ] UNVERIFIED — results recorded here and summarised in [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md).
- [ ] UNVERIFIED — no development values copied into production settings.