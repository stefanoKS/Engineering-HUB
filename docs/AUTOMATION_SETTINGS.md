# Automation settings

Manager-controlled automation lives in the `AUTOMATION_SETTINGS` worksheet. The table is part of the database, so
`git pull`, `clasp push`, and redeployments never reset it. Script Properties still hold environment bindings and
Google resource identifiers, which are deliberately not editable from the UI.

## Effective mail mode

One resolver decides the mode (`AutomationSettings.emailState`):

| Situation | Effective mode | Reason |
| --- | --- | --- |
| `EMERGENCY_STOP = true` (configured workbook) | `OFF` | `EMERGENCY_STOP` |
| `EMAIL_MODE = OFF` | `OFF` | `EMAIL_MODE_OFF` |
| `EMAIL_MODE = PREVIEW` | `PREVIEW` | preview only |
| `EMAIL_MODE = LIVE` with legacy `EMAIL_ENABLED` false or `DRY_RUN` true | `OFF` | `LEGACY_SAFETY_FLAGS_BLOCK_LIVE` |
| `EMAIL_MODE = LIVE` with legacy flags allowing sends | `LIVE` | — |
| No `EMAIL_MODE` row (not yet configured) | legacy mapping of `EMAIL_ENABLED` + `DRY_RUN` | `LEGACY_CONFIGURATION` |

`LIVE` additionally requires: ADMIN role, the exact confirmation `ENABLE LIVE EMAIL`, the emergency stop off, and a
passing preflight (legacy flags, allowed recipient domains, notification activation, execution window order).

## Keys

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `EMAIL_MODE` | `OFF`/`PREVIEW`/`LIVE` | `OFF` | Master mode |
| `EMERGENCY_STOP` | boolean | `true` | Blocks every outgoing message |
| `ASSIGNMENT_EMAIL_ENABLED` | boolean | `false` | New assignment notices |
| `REASSIGNMENT_EMAIL_ENABLED` | boolean | `false` | Owner change notices |
| `DEADLINE_CHANGE_EMAIL_ENABLED` | boolean | `false` | Deadline change notices |
| `DEADLINE_REMINDER_ENABLED` | boolean | `false` | Reminder stages |
| `OVERDUE_REMINDER_ENABLED` | boolean | `false` | Overdue reminders and overdue summaries |
| `WEEKLY_MANAGER_REPORT_ENABLED` | boolean | `false` | Weekly report |
| `REMINDER_OFFSETS` | integer array | `[7, 2]` | Unique, 1–365, max five |
| `REMINDER_CATCHUP_DAYS` | integer | `3` | Bounded catch-up window |
| `OVERDUE_FREQUENCY_DAYS` | integer | `7` | Overdue repetition |
| `WEEKDAY_ONLY_SENDING` | boolean | `true` | Suppress reminder mail at weekends |
| `EXECUTION_WINDOW_START` / `EXECUTION_WINDOW_END` | `HH:mm` | `08:00` / `20:00` | Asia/Tokyo |
| `MANAGEMENT_REPORT_RECIPIENTS` | string array | `[]` | Must be allowed domains; membership is re-checked at send time |
| `WEEKLY_REPORT_DAY` / `WEEKLY_REPORT_TIME` | weekday / `HH:mm` | `MONDAY` / `08:30` | One trigger, not one per recipient |
| `CALENDAR_SYNC_ENABLED` | boolean | `false` | Combined with legacy `CALENDAR_ENABLED` |
| `DAILY_BACKUP_ENABLED` | boolean | `false` | Scheduled backup only |
| `AUTO_DASHBOARD_REFRESH_ENABLED` / `AUTO_WORKLOAD_REFRESH_ENABLED` | boolean | `false` | Manual refresh always works |
| `PROJECT_STALE_ALERT_ENABLED` | boolean | `true` | Staleness warning |
| `PROJECT_STALE_DAYS` | integer | `7` | 1–365 |
| `HEALTH_MILESTONE_APPROACH_DAYS` | integer | `14` | 0–365 |
| `HEALTH_DELAY_TOLERANCE_DAYS` | integer | `0` | 0–365 |
| `LAST_DASHBOARD_REFRESH_AT`, `LAST_WORKLOAD_REFRESH_AT`, `LAST_BACKUP_TIME`, `LAST_BACKUP_RESULT`, `CALENDAR_LAST_SYNC_AT`, `CALENDAR_LAST_SYNC_STATUS`, `LAST_WEEKLY_REPORT_AT` | status | — | Written by the application only |

Values are stored as JSON text in the `Value` column. Status keys cannot be written from the form.

## How to change settings

1. Open the bound spreadsheet → **Engineering HUB → 自動化設定**.
2. Change switches, offsets, recipients, schedule.
3. **設定を保存** writes only the changed keys through `AutomationSettings.save` and appends an audit record
   (`SETTING_CHANGED`, old value, new value, actor, timestamp).
4. Use **送信プレビュー** to review what would be sent; it never sends and never consumes live dedupe keys.
5. Enabling `LIVE` shows a confirmation dialog and requires typing `ENABLE LIVE EMAIL`.

Equivalent editor call:

```javascript
AutomationSettings.save({ASSIGNMENT_EMAIL_ENABLED: true}, 'manager@example.com');
```

## Behavioural guarantees

- Every outgoing message passes the single send gate in `Notifications.gs`. `npm run validate` rejects
  `MailApp.sendEmail` anywhere else.
- OFF and PREVIEW never call `MailApp`. PREVIEW rows in `NOTIFICATION_LOG` are marked `PREVIEW` and do not
  consume live keys.
- Delivery is reserved as `PENDING` before the send. An ambiguous failure stays `PENDING`; after
  `reconcileUncertain` it becomes `DELIVERY_UNCERTAIN`. Automatic resend never happens. Exactly-once delivery is
  not promised.
- Turning a switch off suppresses side effects even if the trigger still exists.
- Migrations always create a verified backup; `DAILY_BACKUP_ENABLED` cannot bypass it.
- Automation status is written to the generated `AUTOMATION_STATUS` sheet without identifiers or secrets.
