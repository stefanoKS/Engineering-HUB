# Operations runbook

Day-to-day operation of a deployed Engineering-HUB workbook. All screens are in the bound spreadsheet menu
**Engineering HUB**. Never enable live mail in a workbook you are not responsible for.

## Daily routine

1. Open the workbook and choose **Engineering HUB → ダッシュボード**.
2. Read the dashboard attention block: 承認待ちタスク, 担当者未設定タスク, 日程不明プロジェクト, 期限超過タスク,
   ブロック中タスク, 重大未解決課題, 更新停滞プロジェクト, 要注意プロジェクト.
3. Confirm 有効モード in **自動化設定** is the mode you expect (`OFF` / `PREVIEW` / `LIVE`).

## Dashboard refresh

- **Engineering HUB → ダッシュボード更新** (or `refreshManagement()`) recalculates progress and health and
  rebuilds `DASHBOARD`, `PROJECT_OVERVIEW`, `TEAM_VIEW`, `GANTT_OVERVIEW`, `TIMELINE_DATA`, `WORKLOAD`,
  `SKILL_MATRIX`, `BACKPLAN`, `AUTOMATION_STATUS`.
- Manual refresh always works, even when automatic refresh is disabled.
- A refresh never clears operational sheets and never marks a project as recently updated.

## Task assignment

1. **Engineering HUB → タスク割当**: project → optional subproject → task name → owner → deadline.
2. Optional: start date, estimate, acceptance criteria, priority, notification switch.
3. Save. A deadline-only assignment is valid; do not invent start dates or estimates.
4. Approve (割当を承認) if the assignment is final; confirm the schedule (日程確定) only when the deadline *and*
   a known estimate are realistic.

Changing the owner, deadline, estimate, priority, acceptance criteria or dependencies revokes approval; a
progress update does not.

## Weekly report

- Enable 週次レポート and set 曜日 / 時刻 (Asia/Tokyo) plus recipients.
- Re-run **installAuthorizedTriggers** (or the documented editor wrapper) so the schedule change is applied.
- `システム状態` shows トリガー設定の一致; if it says 再インストールが必要, the settings changed but the triggers did not.
- An empty report is not sent; the same week is never sent twice to the same recipient.

## Stop email immediately

1. **自動化設定 → 緊急停止** and save, or set 配信モード to `OFF`.
2. Any manager can do this; no confirmation is required.
3. Optionally disable individual feature switches.
4. Confirm 有効モード shows `OFF` (`EMERGENCY_STOP` or `EMAIL_MODE_OFF`).

The next scan sends nothing even if triggers remain installed. Notification history is preserved.

## Re-enabling mail

1. Verify bindings, allowed domains, notification activation and legacy flags
   (`healthCheck()` / システム状態).
2. Set 配信モード to `PREVIEW`, save, run 送信プレビュー, and review the candidate list.
3. Set 配信モード to `LIVE`, clear 緊急停止, type `ENABLE LIVE EMAIL`, save. **ADMIN role is required.**
4. Enable only the feature switches you need; run one scan and confirm a single ledger row.
5. MANAGER cannot perform step 3 — ask an administrator.

## Diagnosing missing reminders

1. 設定: is `DEADLINE_REMINDER_ENABLED` on, are the offsets correct, is the execution window (JST) open, is today a
   weekday if 平日のみ送信 is on?
2. Task: is `Notification_Enabled` true, is the assignment approved *after* activation, is the status still
   eligible (not Done/Cancelled), is the owner active with an allowed domain?
3. Project: is the project Active/Planned and its `Notification_Enabled` not false?
4. Ledger: does `NOTIFICATION_LOG` already contain the same notification key (dedupe)?
5. If the reminder stage was missed entirely, the bounded catch-up window sends only the most relevant stage; a
   stage older than `REMINDER_CATCHUP_DAYS` is intentionally not backfilled.

## Checking triggers

- `システム状態` lists installed, missing, obsolete and duplicate handlers plus トリガー設定の一致.
- `Triggers.diagnostics()` returns the same data for the editor.
- Triggers execute as their creator. If the creator leaves, reinstall with the new authorised account and expect
  a short gap.

## Backup failures

- `BACKUP_LOG` and `AUTOMATION_SETTINGS.LAST_BACKUP_RESULT` record the outcome.
- A failure blocks migrations: do not bypass it. Check the backup folder ACL, Drive quota, and that the folder is
  not link-shared.
- Do not delete old backups; retention is a reviewed manual decision.

## Notification delivery uncertainty

1. A `PENDING` row older than ~15 minutes means the outcome is unknown.
2. Run **不確定配信を確認済みにする** (`reconcileUncertainDeliveries`) to mark it `DELIVERY_UNCERTAIN` with actor and
   timestamp. Nothing is resent automatically.
3. Decide manually whether the recipient needs a direct follow-up. Never delete rows to force a retry.

## Restoring operational service

1. Stop triggers/mail (above).
2. Follow [BACKUP_RESTORE.md](../BACKUP_RESTORE.md) to restore into a **new** copy and rebind configuration.
3. Force `EMAIL_MODE=OFF`/`PREVIEW`, keep the emergency stop on, review roles.
4. Reconcile the ledger and Calendar events before re-enabling automation.

## Administrator handover

1. Promote (or bootstrap) a second ADMIN — the last administrator can never be demoted or deactivated.
2. Transfer trigger ownership by installing triggers while signed in as the new sending account.
3. Transfer the backup folder ownership and the property inventory (outside Git).
4. Record the handover in the operations log; update [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) approvers.
