# Gate 5 — Automation control center

Status: **PASS (automated) / LIVE VERIFICATION REQUIRED (real mail, Calendar, triggers, quotas)**

## 5.1 Persistence and effective mode

`AutomationSettings.gs` stores manager preferences in the `AUTOMATION_SETTINGS` table inside the workbook:
`schema`, values, `Updated_At`, `Updated_By`. `git pull` / `clasp push` never resets them. Credentials and Google
resource identifiers stay in Script Properties and are intentionally absent from the UI and the generated status
sheet.

One resolver (`AutomationSettings.emailState`) decides the effective mode:

| Situation | Effective mode |
| --- | --- |
| Configured, `EMERGENCY_STOP = true` | `OFF` (`EMERGENCY_STOP`) |
| Configured, `EMAIL_MODE = OFF` | `OFF` (`EMAIL_MODE_OFF`) |
| Configured, `EMAIL_MODE = PREVIEW` | `PREVIEW` |
| Configured, `EMAIL_MODE = LIVE` but legacy `EMAIL_ENABLED` is false or `DRY_RUN` is true | `OFF` (`LEGACY_SAFETY_FLAGS_BLOCK_LIVE`) |
| Configured, `EMAIL_MODE = LIVE` and legacy flags allow sending | `LIVE` |
| No `EMAIL_MODE` row (pre-V1.1 workbook) | legacy mapping (`OFF` / `PREVIEW` / `LIVE` from `EMAIL_ENABLED` + `DRY_RUN`), reported as `LEGACY_CONFIGURATION` |

Enabling `LIVE` requires ADMIN, the exact confirmation `ENABLE LIVE EMAIL`, the emergency stop off, and a
passing preflight (legacy flags, allowed domains, notification activation, execution window). A migration seeds
`OFF` defaults, so upgraded workbooks can never be activated by legacy flags alone.

## 5.2 Feature switches

`ASSIGNMENT_EMAIL_ENABLED`, `REASSIGNMENT_EMAIL_ENABLED`, `DEADLINE_CHANGE_EMAIL_ENABLED`,
`DEADLINE_REMINDER_ENABLED`, `OVERDUE_REMINDER_ENABLED`, `WEEKLY_MANAGER_REPORT_ENABLED` — all default `OFF`.
On top of them: global emergency stop, per-project `PROJECTS.Notification_Enabled`, per-task
`TASKS.Notification_Enabled`. The most restrictive applicable switch wins. Turning a switch off never deletes
notification history.

## 5.3 Reminder settings

- Configurable offsets (default `[7, 2]`), validated as unique positive integers ≤ 365, max five entries.
- Bounded catch-up: only the most relevant unsent stage inside `REMINDER_CATCHUP_DAYS` is sent; stale stages are
  never sent together.
- Overdue reminders with configurable frequency (default weekly), weekday-only option, configurable JST execution
  window, configurable management recipients.
- Deduplication uses persistent ledger keys based on task, owner, recipient, assignment version, due date, type
  and stage.

## 5.4 Weekly management report

`Reports.weekly` builds the content (active/at-risk projects, completed tasks, overdue, blocked, upcoming
deadlines, stale projects, critical issues, high-load members, unscheduled/unestimated work). Delivery is done
by the centralized notification service with the same mode, switches, allowlist and cap; empty reports and
duplicate weekly sends are skipped. A single weekly trigger is installed only when the feature is enabled.

## 5.5 Calendar and 5.6 backup

- `CALENDAR_SYNC_ENABLED` defaults false and is combined with the legacy `CALENDAR_ENABLED` master switch.
  Last sync time and status are persisted. Turning it off never deletes existing events.
- `DAILY_BACKUP_ENABLED` defaults false for the scheduled job only. Migration backups are unconditional and
  cannot be disabled; the migration test proves a backup is still taken with the daily switch off.
- Backups are never deleted automatically.

## 5.7 Dashboard settings

`AUTO_DASHBOARD_REFRESH_ENABLED`, `AUTO_WORKLOAD_REFRESH_ENABLED`, `PROJECT_STALE_ALERT_ENABLED`,
`PROJECT_STALE_DAYS`. Manual refresh always works; turning automatic refresh off never clears generated data;
the last refresh time is persisted and shown.

## 5.8 Settings UI and audit

`UiSettings.html` provides Japanese controls (自動化設定 / メール通知 / 担当依頼通知 / 期限前通知 /
期限超過通知 / 週次レポート / カレンダー同期 / 自動バックアップ / ダッシュボード自動更新 / テストモード /
本番送信 / 最終実行結果), a LIVE confirmation dialog, safe defaults, effective status, recent results,
notification history and a preview action. Every change writes an audit record (setting, old value, new value,
actor, timestamp). Status keys are not writable from the form. Settings fail closed when the identity cannot be
verified.

## 5.9 Email reliability

- Ledger results: `PENDING` (reserved before sending, unresolved after an ambiguous failure), `SENT`, `PREVIEW`,
  `DELIVERY_UNCERTAIN`, and legacy `DRY_RUN`. Pending rows are never retried automatically.
- `Notifications.reconcileUncertain(actor, 'RECONCILE DELIVERY')` marks old `PENDING` rows as
  `DELIVERY_UNCERTAIN` with actor/timestamp and never resends. Exactly-once delivery is not promised.
- Preview mode does not call `MailApp.sendEmail` and does not consume live dedupe keys.
- Trigger diagnostics report installed, missing and duplicated handlers and state that installable triggers run
  as their creator.

### Automation test matrix

| Required combination | Test |
| --- | --- |
| Master OFF + all features ON → no mail | `OFF mode suppresses every outgoing message…` |
| Master PREVIEW + all ON → preview only | `PREVIEW evaluates eligibility…` |
| LIVE + assignment OFF → no assignment mail | `individual feature toggles work independently…` |
| LIVE + assignment ON + approved task → one mail | same test |
| LIVE + reminder OFF → no reminder | same test |
| LIVE + project switch OFF → no mail | `per-project and per-task switches…` |
| Task switch OFF → no mail | same test |
| Completed task → no reminder | `completed tasks, archived projects…` |
| Archived project → no reminder | same test |
| Invalid recipient → no mail | same test |
| Repeated scan → no duplicate | `individual feature toggles…`, `weekly management report…` |
| Switch OFF then ON → no replay | `switching a feature off and on again…` |
| Configuration persists across runs | `automation settings persist in the workbook…` |
| Failed send recorded correctly | `ambiguous delivery is recorded…` |
| Ambiguous delivery not retried | same test |
| Unauthorized actor cannot enable LIVE | `LIVE requires administrator role…` |

## Gate 5 checklist

| Check | Result |
| --- | --- |
| Manager can change automation settings without code edits | PASS |
| Settings persist across application upgrades | PASS (`AUTOMATION_SETTINGS` table) |
| OFF suppresses all outgoing emails | PASS |
| PREVIEW sends zero real emails | PASS |
| LIVE requires verified explicit approval | PASS |
| Individual feature toggles work independently | PASS |
| Per-project/per-task notification controls work | PASS |
| Reminder offsets are configurable | PASS |
| Missed reminder windows handled safely | PASS |
| Weekly manager report implemented | PASS |
| Calendar ON/OFF functions safely | PASS (mock) / LIVE VERIFICATION REQUIRED |
| Daily backup ON/OFF works | PASS |
| Mandatory migration backup cannot be bypassed | PASS |
| Duplicate notification prevention works | PASS |
| Notification history preserved | PASS |
| Trigger diagnostics available | PASS |
| All automation tests pass | PASS |

## Changed files

`src/AutomationSettings.gs` (new), `src/Notifications.gs`, `src/Reports.gs` (new), `src/Triggers.gs`,
`src/CalendarSync.gs`, `src/Main.gs`, `src/Schema.gs`, `src/Ui.gs`, `src/UiSettings.html`,
`tests/gate5-automation.test.js` (new).

## Risks

- Legacy (unconfigured) workbooks still follow the previous master flags until a manager saves settings once;
  the UI and the status sheet label this as `LEGACY_CONFIGURATION`.
- Mail delivery, quota and trigger timing cannot be verified locally.
- A trigger created by another account is invisible to a different editor; the sending account must own it.
