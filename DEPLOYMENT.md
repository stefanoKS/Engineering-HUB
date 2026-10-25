# Deployment and activation

## Prerequisites

- Node.js 22 (at least 22.13.0), npm, PowerShell, and a Google account allowed to create Apps Script projects.
- Separate development and production Apps Script projects and spreadsheets.
- A restricted Drive backup folder per environment; check inherited/shared-drive access as well as direct sharing.
- Review of the Apps Script manifest OAuth scopes and the permissions of the executing account.

No live Workspace deployment or authorization is claimed by this repository.

## 1. Reproduce local validation

Run from the repository root in PowerShell:

```powershell
npm ci
npm run lint
npm test
npm run validate
```

Use the lockfile; do not replace `npm ci` with an unreviewed dependency update.

## 2. Create independent Google resources

In the Apps Script web editor, create one development project and one production project. Create a separate empty spreadsheet for each. Record their IDs locally, not in Git. Create restricted backup folders and verify their membership. Enable the Google Apps Script API for the deploying account at <https://script.google.com/home/usersettings> if clasp reports that access is disabled.

Create the following local clasp configurations. These files and the active `.clasp.json` must remain ignored.

```powershell
@'
{
  "scriptId": "REPLACE_WITH_DEVELOPMENT_SCRIPT_ID",
  "rootDir": "src"
}
'@ | Set-Content -Encoding ascii .clasp.dev.json

@'
{
  "scriptId": "REPLACE_WITH_PRODUCTION_SCRIPT_ID",
  "rootDir": "src"
}
'@ | Set-Content -Encoding ascii .clasp.prod.json

npx clasp login
Copy-Item .clasp.dev.json .clasp.json -Force
Get-Content .clasp.json
npx clasp push
```

Replace placeholders before pushing. The explicit copy selects the destination; do not assume a `clasp --project` option. Inspect the selected `scriptId` every time. `clasp push` updates source files; it does not install triggers, configure Script Properties, migrate data, or authorize services.

## 3. Configure Script Properties

In **Project Settings → Script Properties**, enter the following string values. The application does not automatically import `config.example.json`.

| Property | Meaning |
| --- | --- |
| `ENVIRONMENT` | Exactly `DEVELOPMENT` or `PRODUCTION`. |
| `BOUND_ENVIRONMENT` | Must equal `ENVIRONMENT`; records the intended environment binding. |
| `SPREADSHEET_ID` | Explicit database spreadsheet ID for this environment. |
| `INITIALIZATION_SPREADSHEET_ID` | Set only when intentionally initializing this same, empty workbook. Remove after successful initialization. |
| `BACKUP_FOLDER_ID` | Restricted Drive folder used for snapshots. |
| `APPROVED_MIGRATIONS` | Comma-separated reviewed migration IDs; normally empty. Example: `002_task_assignment_safety`. |
| `EMAIL_ENABLED` | Default `false`; enable only after production checks. |
| `DRY_RUN` | Default `true`; external effects remain suppressed. |
| `ALLOWED_RECIPIENT_DOMAINS` | Comma-separated allowed mail domains; use development-only domains in development. |
| `MAX_EMAILS_PER_RUN` | Integer per-run cap from 1 to 50; default `10`. |
| `CALENDAR_ENABLED` | Default `false`; enable only after reviewing the Calendar behavior. |
| `CALENDAR_ID` | Dedicated secondary calendar ID (`…@group.calendar.google.com`); not `primary`. |
| `MANAGEMENT_RECIPIENTS` | Optional comma-separated weekly overdue-summary recipients; each must also be an active member with an allowed domain. |
| `NOTIFICATION_ACTIVATION_AT` | Application-written activation timestamp; do not manually prepopulate it. |
| `NOTIFICATION_AUTHORIZED_BY` | Application-written activating account; do not manually forge it. |

Matching environment strings alone do not prove the selected IDs are correct. Independently inspect the spreadsheet, script project, folder ACL, and calendar. Do not copy production resource IDs into development settings.

## 4. Authorize and initialize

Open the correct Apps Script project in the web editor. Use an editor wrapper to call functions requiring arguments; top-level editor Run does not supply arguments. Review the OAuth consent for the account that will run scheduled jobs.

For a newly created, empty workbook only, set `INITIALIZATION_SPREADSHEET_ID` to its ID as well as `SPREADSHEET_ID`, then run a temporary editor wrapper:

```javascript
function initializeDevelopmentFromEditor() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  initializeNewDatabase('INITIALIZE ' + id);
}
```

Run only after verifying the environment and workbook. Delete the wrapper and remove `INITIALIZATION_SPREADSHEET_ID` afterward. Never use initialization for an existing workbook.

For an existing database, take a verified backup, inspect the migration code, add only reviewed IDs to `APPROVED_MIGRATIONS`, and run `upgradeExistingDatabase()` from an editor wrapper. Inspect the migration log and schema afterward; remove temporary approvals. Migration `002_task_assignment_safety` upgrades the version-1 task schema to version 2.

Do not assume `clasp run` is ready: remote execution needs additional API executable deployment and permissions. Editor authorization is the supported setup path here.

## 5. Production release gate

- [ ] Local lint, tests, and validation pass for the reviewed commit.
- [ ] Development smoke tests have exercised representative projects, members, tasks, assignments, and schedules.
- [ ] Production IDs, `ENVIRONMENT=PRODUCTION`, and `BOUND_ENVIRONMENT=PRODUCTION` have been independently checked.
- [ ] Backup folder ACL is restricted and a new snapshot can be opened by the recovery operator.
- [ ] Migration changes and their exact approvals are reviewed; existing data is never initialized.
- [ ] Email remains disabled and dry-run enabled during deployment and migration.
- [ ] Authorized execution account, scopes, Workspace quotas, domain restrictions, and email cap are reviewed.
- [ ] Calendar target and shared access are reviewed before enabling Calendar.
- [ ] Trigger ownership, frequency, and duplicate-trigger checks are reviewed before installing scheduled jobs.
- [ ] Logs, operator ownership, backup retention, and the manual recovery procedure are agreed.

Select production explicitly:

```powershell
Copy-Item .clasp.prod.json .clasp.json -Force
Get-Content .clasp.json
npx clasp push
```

Complete migration and read-only inspections before turning on external effects. Set `EMAIL_ENABLED=true` and `DRY_RUN=false` only after a controlled, explicitly approved delivery test. Enable Calendar separately. Never use a real production send to test development.

## 6. Explicit activation and scheduled work

Keep email disabled and dry-run enabled while setting up. Run wrappers in the editor under the intended operator account. Account strings must match the verified active account; use an account whose email Apps Script can resolve.

```javascript
function activateFromEditor() {
  var actor = Session.getActiveUser().getEmail();
  return activateNotifications(actor, 'ACTIVATE NOTIFICATIONS');
}

function approveNotificationFromEditor() {
  var actor = Session.getActiveUser().getEmail();
  return approveTaskNotifications(
    'REPLACE_WITH_REVIEWED_TASK_ID', actor, 'APPROVE ASSIGNMENT');
}

function installTriggersFromEditor() {
  var actor = Session.getActiveUser().getEmail();
  return installAuthorizedTriggers(actor, 'INSTALL AUTHORIZED TRIGGERS');
}
```

Activation is one-time: it baselines existing assignments and clears previous notification approvals without sending historical mail. Review the current task assignment, set its `Notification_Enabled` to true through the task API, then approve the current version. Run `scanNotifications()` with dry-run still enabled and inspect its result before a controlled real send. Dry-run is not a mail transport test. Reassignment or changed due dates require new approval.

`installAuthorizedTriggers` requires the active and effective accounts to match. It installs hourly notification scanning with optional Calendar sync, hourly management refresh, and daily backup around 02:00 in the configured script timezone. It removes duplicate managed triggers visible to the installing account; other users' triggers may not be visible. Inventory trigger owners manually to prevent duplicates across accounts.

Calendar synchronization runs as part of the hourly `scheduledNotificationScan()` handler **only when enabled**. First call `syncMilestoneCalendar()` manually with dry-run enabled after independent Calendar review; then perform a controlled real sync before leaving hourly Calendar automation enabled. Cancelled events are marked rather than deleted; a missing stored event is skipped for deliberate repair. Avoid scheduling `dailyAutomation()` in addition to the managed triggers: it combines notification, Calendar, management, and backup work and may duplicate existing schedules.

Use `healthCheck()` for binding/integration flags and `validateSystem()` for operational table counts and basic ID, required-field, enum, type, and reference errors. These checks do not certify every domain invariant, Drive ACLs, mail delivery, or Workspace quotas. For a manual verified backup, run `createDatabaseBackup()` and record the returned snapshot ID.

## Rollback

Deploying older code does **not** reverse a schema migration or recover overwritten data. Inspect compatibility first. For data recovery follow [Backup and restore](BACKUP_RESTORE.md); keep automation disabled until restored state and delivery history have been reconciled.
