# Automation settings

Manager-controlled automation lives in the `AUTOMATION_SETTINGS` worksheet. The table is part of the database, so
`git pull`, `clasp push`, and redeployments never reset it. Script Properties still hold environment bindings and
Google resource identifiers, which are deliberately not editable from the UI.

## Desired versus effective mode

`EMAIL_MODE` is the **desired** mode stored in the workbook. The **effective** mode is what the application will
actually do, after the safety checks:

| Desired | Condition | Effective | Reason code |
| --- | --- | --- | --- |
| any | `EMERGENCY_STOP = true` | `OFF` | `EMERGENCY_STOP` |
| `OFF` | — | `OFF` | `EMAIL_MODE_OFF` |
| `PREVIEW` | — | `PREVIEW` | — |
| `LIVE` | legacy `EMAIL_ENABLED` false or `DRY_RUN` true | `OFF` | `LEGACY_SAFETY_FLAGS_BLOCK_LIVE` |
| `LIVE` | legacy flags allow sending | `LIVE` | — |
| (no `EMAIL_MODE` row) | `ALLOW_LEGACY_EMAIL_CONFIG` not set | `OFF` | `LEGACY_CONFIGURATION_BLOCKED` |
| (no `EMAIL_MODE` row) | `ALLOW_LEGACY_EMAIL_CONFIG=true` | legacy flags decide | `LEGACY_CONFIGURATION_OPT_IN` |

The effective mode and its reason are shown in **自動化設定**, in `AUTOMATION_STATUS` and in `healthCheck()`.

## LIVE authorization and safe reactivation

A LIVE authorization is required whenever an operation makes the effective mode `LIVE`. That includes the obvious
`OFF → LIVE` / `PREVIEW → LIVE` change **and** clearing the emergency stop while `EMAIL_MODE` is already `LIVE`
(the hardening fix). It requires all of:

1. a verified active `ADMIN` member (a MANAGER is refused);
2. the exact confirmation text `ENABLE LIVE EMAIL`;
3. the emergency stop off;
4. a passing preflight: `EMAIL_ENABLED=true`, `DRY_RUN=false`, non-empty `ALLOWED_RECIPIENT_DOMAINS`,
   activated notifications, a bound spreadsheet, execution window end after start.

Each activation/deactivation writes `EMAIL_LIVE_ACTIVATED` / `EMAIL_LIVE_DEACTIVATED` to `AUDIT_LOG`.

## Emergency stop and immediate shutdown

`EMERGENCY_STOP` (default `true`) forces `OFF` for every feature regardless of the other switches. Setting it, or
setting the mode to `OFF`, needs no confirmation and is available to any MANAGER. It takes effect on the next scan
even while triggers remain installed, and it never deletes notification history.

## Individual settings

See the key table above. Behavioural notes:

- Feature switches are ANDed with the project switch (`PROJECTS.Notification_Enabled`, blank = allowed) and the
  task switch (`TASKS.Notification_Enabled`, must be `true`). The most restrictive wins.
- `REMINDER_OFFSETS` must be unique integers 1–365 (max five). `REMINDER_CATCHUP_DAYS` bounds the catch-up: only
  the most relevant unsent stage is sent, never several stale stages at once.
- `WEEKDAY_ONLY_SENDING` and the JST execution window apply to reminders and the overdue summary.
- `MANAGEMENT_REPORT_RECIPIENTS` must use allowed domains and are re-validated (active member + domain) at send
  time.

## Weekly report timing and trigger reinstallation

- `WEEKLY_REPORT_DAY` and `WEEKLY_REPORT_TIME` define the installed weekly trigger (one trigger for all
  recipients, not one per recipient). Apps Script fires time-based triggers approximately, so the minute is a
  target.
- Changing the day, the time, or enabling/disabling the report changes the desired schedule. `Triggers.install`
  compares the stored `MANAGED_TRIGGER_SIGNATURE` plus the installed handlers, then recreates only the managed
  triggers when they drifted, are duplicated, are missing, or are obsolete. Unrelated triggers are never touched.
- システム状態 / `Triggers.diagnostics()` shows `トリガー設定の一致` (`scheduleMatches`). If it is false after a
  settings change, run the installation again with the authorised sending account.
- A disabled weekly report sends nothing even if its handler still fires (`WEEKLY_REPORT_DISABLED`).

## Notification reconciliation

- Ledger states: `PENDING` (reserved before send), `SENT`, `PREVIEW`, `DELIVERY_UNCERTAIN`, legacy `DRY_RUN`.
- An ambiguous failure leaves `PENDING`. `reconcileUncertainDeliveries(actor, 'RECONCILE DELIVERY')` marks rows
  older than ~15 minutes as `DELIVERY_UNCERTAIN` with actor/timestamp. Nothing is resent automatically; decide
  manually whether a follow-up is needed.
- Preview rows are prefixed `PREVIEW:` and never consume live dedupe keys.

## Audit records

| Action | Written when |
| --- | --- |
| `SETTING_CHANGED` | Every saved key, with old/new value and actor |
| `EMAIL_LIVE_ACTIVATED` / `EMAIL_LIVE_DEACTIVATED` | Effective-mode transitions |
| `TRIGGERS_INSTALLED` | Every installation, including the recreation reason |
| `DELIVERY_RECONCILED` | Each row marked uncertain |
| `ASSIGNMENT_APPROVED`, `SCHEDULE_CONFIRMED`, `SCHEDULE_CONFIRMATION_INVALIDATED` | Assignment/schedule workflow |
| `ADMIN_BOOTSTRAPPED` | One-time first administrator |

`AUDIT_LOG` is application history, not tamper-proof evidence: spreadsheet editors can modify it.

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

1. Open the bound spreadsheet → **設計・開発課 管理 → 自動化設定**.
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

## V1.2 shared dashboard publication settings

Publication of the sanitized employee dashboard is configured in the same table but is
completely independent of the mail mode: changing it never enables mail and changing the
mail mode never affects publication.

| Key | Default | Meaning |
| --- | --- | --- |
| `SHARED_DASHBOARD_PUBLISH_ENABLED` | `false` | Publish the sanitized snapshot on a schedule. Manual publication stays available either way. |
| `SHARED_DASHBOARD_PUBLISH_INTERVAL_MINUTES` | `30` | Target cadence, clamped to 5–1440 and rounded down to an Apps Script-supported cadence. |
| `LAST_SHARED_DASHBOARD_PUBLISH_AT` | status | Last successful publication (application-written). |
| `LAST_SHARED_DASHBOARD_PUBLISH_RESULT` | status | `SUCCESS` / `FAILED`. |
| `LAST_SHARED_DASHBOARD_PUBLISH_VERSION` | status | Snapshot version currently published. |
| `LAST_SHARED_DASHBOARD_PUBLISH_ERROR` | status | Last failure message, truncated to 200 characters. |
| `SHARED_DASHBOARD_PUBLISH_APPROVED_BY` | status | Verified account that last enabled publication. |

- Enabling requires a verified `ADMIN`, the exact confirmation
  `ENABLE SHARED DASHBOARD PUBLICATION`, a configured destination and an initialized snapshot
  workbook. Disabling is available to a manager and needs no confirmation.
- Enabling writes `SHARED_DASHBOARD_PUBLICATION_APPROVED`; disabling writes
  `SHARED_DASHBOARD_PUBLICATION_DISABLED`; every save also writes `SETTING_CHANGED`.
- Status keys are application-written and cannot be set through `AutomationSettings.save`.
- The destination spreadsheet ID is **not** a setting here; it lives in Script Properties
  (`SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID`) and is never returned by any UI or API.
- See [dashboard/DEPLOYMENT.md](dashboard/DEPLOYMENT.md) for the activation procedure.

## V1.3 request notification switches

| Key | Default | Effect |
| --- | --- | --- |
| `DEADLINE_REQUEST_EMAIL_ENABLED` | `false` | notify managers when a deadline change request is imported |
| `COMPLETION_REPORT_EMAIL_ENABLED` | `false` | notify managers when a completion report is imported |
| `PENDING_REQUEST_REMINDER_ENABLED` | `false` | send one bounded daily reminder while requests wait for approval |

All three pass through the single gate in `src/Notifications.gs`:

* `EMAIL_MODE = OFF` (or the emergency stop) sends nothing.
* `PREVIEW` records a preview row in `NOTIFICATION_LOG` and sends no mail.
* `LIVE` additionally requires `EMAIL_ENABLED=true`, `DRY_RUN=false`, an activated
  notification account, allowed recipient domains, an unused deduplication key and the
  per-run cap.

Status keys written by the application: `LAST_REQUEST_IMPORT_AT` and
`LAST_PENDING_REQUEST_REMINDER_AT`. They cannot be set through the settings UI.

Request notifications go to the configured management recipients only. They contain the
request ID, task/project identifiers, the self-reported requester name, the dates and the
stored reason/explanation. They never contain the private workbook ID or any credential.

