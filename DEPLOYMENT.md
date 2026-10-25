# Deployment and activation

## Prerequisites

- Node.js 22 (at least 22.13.0), npm, PowerShell, and a Google account allowed to create Apps Script projects.
- Separate development and production Apps Script projects and spreadsheets. The V1.1 manager UI must be a
  **container-bound** project created from the spreadsheet (Extensions → Apps Script); a standalone project cannot
  show a sidebar.
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

In the Apps Script web editor, create one development project and one production project. For each environment,
create the Apps Script project **from the spreadsheet** (Extensions → Apps Script) so the bound manager UI works;
create a separate empty spreadsheet for each. Record their IDs locally, not in Git. Create restricted backup folders
and verify their membership. Enable the Google Apps Script API for the deploying account at
<https://script.google.com/home/usersettings> if clasp reports that access is disabled.

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
| `ADMIN_BOOTSTRAP_ALLOWLIST` | Comma-separated deployment administrator allowlist for the one-time bootstrap; remove after use. |
| `ALLOW_LEGACY_EMAIL_CONFIG` | Optional, default unset. `true` is the only way an unconfigured (pre-V1.1) workbook may use the legacy `EMAIL_ENABLED`/`DRY_RUN` mapping. `false`/unset means mail stays `OFF`. |
| `ALLOW_MEMBER_SELF_SERVICE` | Optional, default unset (`false`). `true` lets a `MEMBER` open the sidebar with own-task scope. It does not make the workbook confidential (a member with spreadsheet access can read every sheet). |
| `NOTIFICATION_ACTIVATION_AT` | Application-written activation timestamp; do not manually prepopulate it. |
| `NOTIFICATION_AUTHORIZED_BY` | Application-written activating account; do not manually forge it. |
| `SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID` | V1.2. ID of the **sanitized snapshot** workbook used by the shared dashboard. Must never be the management workbook; publication refuses that. Never exposed by a UI or API. |

Manager-editable automation preferences (mail mode, feature switches, reminder offsets, recipients, backup and
dashboard switches) are **not** Script Properties. They live in the workbook `AUTOMATION_SETTINGS` table and are
edited through the UI or `AutomationSettings.save`. See [docs/AUTOMATION_SETTINGS.md](docs/AUTOMATION_SETTINGS.md).
Credentials and Google identifiers stay in Script Properties and are never exposed by the UI.

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

For an existing database, take a verified backup, inspect the migration code, add only reviewed IDs to `APPROVED_MIGRATIONS`, and run `upgradeExistingDatabase()` from an editor wrapper. Inspect the migration log and schema afterward; remove temporary approvals. `002_task_assignment_safety` upgrades version 1 to 2; `003_management_reliability` upgrades version 2 to 3 (additive tables/columns plus safe mail-OFF automation defaults). Each approved migration takes its own verified backup.

After a version-3 upgrade, assign `MEMBERS.Role` deliberately (`ADMIN` for the operator, `MANAGER` for delegated
managers). Migrated roles are blank and are treated as `VIEWER` until assigned; this is intended fail-closed
behaviour, not a bug.

Do not assume `clasp run` is ready: remote execution needs additional API executable deployment and permissions. Editor authorization is the supported setup path here.

## 5. Production release gate

- [ ] Local lint, tests, and validation pass for the reviewed commit.
- [ ] Development smoke tests have exercised representative projects, members, tasks, assignments, and schedules.
- [ ] Production IDs, `ENVIRONMENT=PRODUCTION`, and `BOUND_ENVIRONMENT=PRODUCTION` have been independently checked.
- [ ] Backup folder ACL is restricted and a new snapshot can be opened by the recovery operator.
- [ ] Migration changes and their exact approvals are reviewed; existing data is never initialized.
- [ ] Email remains disabled (`EMAIL_MODE=OFF` or `PREVIEW`) and dry-run enabled during deployment and migration.
- [ ] Roles are assigned after the version-3 migration (`ADMIN` for the operator, `MANAGER` for delegates).
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

Complete migration and read-only inspections before turning on external effects. Set `EMAIL_ENABLED=true` and `DRY_RUN=false` only after a controlled, explicitly approved delivery test, and keep the persisted mode at `OFF`/`PREVIEW` until the same review is complete. Enable Calendar separately. Never use a real production send to test development.

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

Activation is one-time: it baselines existing assignments and clears previous notification approvals without sending historical mail. Review the current task assignment, set its `Notification_Enabled` to true through the task API, then approve the current version. Run `scanNotifications()` with the persisted mode still `OFF`/`PREVIEW` and inspect its result before a controlled real send. Preview is not a mail transport test. Reassignment or changed due dates require new approval.

Enabling LIVE mail requires the worksheet settings path: `EMAIL_MODE=LIVE`, emergency stop off, ADMIN role, the
exact confirmation `ENABLE LIVE EMAIL`, and a passing preflight (legacy flags, allowed domains, activation). The
legacy flags alone cannot enable LIVE once automation settings are configured.

`installAuthorizedTriggers` requires the active and effective accounts to match. It installs hourly notification
scanning with optional Calendar sync, hourly management refresh, and daily backup around 02:00 in the configured
script timezone. The weekly report handler is added only when `WEEKLY_MANAGER_REPORT_ENABLED` is true. It removes
duplicate managed triggers visible to the installing account; other users' triggers may not be visible. Inventory
trigger owners manually to prevent duplicates across accounts. `Triggers.diagnostics()` reports installed, missing
and duplicated handlers.

Calendar synchronization runs as part of the hourly `scheduledNotificationScan()` handler **only when enabled**. First call `syncMilestoneCalendar()` manually with dry-run enabled after independent Calendar review; then perform a controlled real sync before leaving hourly Calendar automation enabled. Cancelled events are marked rather than deleted; a missing stored event is skipped for deliberate repair. Avoid scheduling `dailyAutomation()` in addition to the managed triggers: it combines notification, Calendar, management, and backup work and may duplicate existing schedules.

Use `healthCheck()` for binding/integration flags and `validateSystem()` for operational table counts and basic ID, required-field, enum, type, and reference errors. These checks do not certify every domain invariant, Drive ACLs, mail delivery, or Workspace quotas. For a manual verified backup, run `createDatabaseBackup()` and record the returned snapshot ID.

## 7. Manager UI and manual verification

- After `clasp push`, reload the spreadsheet and confirm the **設計・開発課 管理** menu appears (container-bound).
- Review [docs/MANAGER_WORKFLOW.md](docs/MANAGER_WORKFLOW.md) for the operator steps.
- Complete [docs/GOOGLE_WORKSPACE_SMOKE_TEST.md](docs/GOOGLE_WORKSPACE_SMOKE_TEST.md) in development before any
  production activation. That checklist is the only accepted evidence of live behaviour; this repository has not
  executed it.

## 8. V1.2 shared dashboard (separate Apps Script project)

V1.2 adds a second, independent application: `dashboard-app/`. It is a **read-only** web app
that reads only the sanitized snapshot workbook and never the management workbook.

| Concern | Manager application | Shared dashboard |
| --- | --- | --- |
| Source directory | `src/` | `dashboard-app/` |
| clasp target | one project per environment | a different project per environment |
| Workbook read | the management workbook | the sanitized snapshot only |
| Write APIs | full domain API | none |
| Mail / Calendar / triggers | yes | no |
| Deployment | container-bound, sidebars | standalone web app, `access: DOMAIN` |

```powershell
@'
{ "scriptId": "REPLACE_WITH_DASHBOARD_DEV_SCRIPT_ID", "rootDir": "dashboard-app" }
'@ | Set-Content -Encoding ascii .clasp.dashboard-dev.json

Copy-Item .clasp.dashboard-dev.json .clasp.json -Force
Get-Content .clasp.json      # confirm rootDir = dashboard-app before pushing
npx clasp push
```

The dashboard project needs its own Script Properties (`SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID`,
optional `SHARED_DASHBOARD_ALLOWED_DOMAIN` / `SHARED_DASHBOARD_REQUIRE_EMAIL` /
`SHARED_DASHBOARD_STALE_HOURS`) and must never contain `SPREADSHEET_ID`; `npm run validate`
rejects that. The version 3 → 4 upgrade (`004_shared_dashboard`) must be approved and backed up
like any other migration and publishes nothing by itself.

Full procedure, activation, emergency disable and rollback:
[docs/dashboard/DEPLOYMENT.md](docs/dashboard/DEPLOYMENT.md). Access model:
[docs/dashboard/ACCESS_AND_SHARING.md](docs/dashboard/ACCESS_AND_SHARING.md). Nothing in it has
been executed against a real Workspace tenant.

## Rollback

Deploying older code does **not** reverse a schema migration or recover overwritten data. Inspect compatibility first. For data recovery follow [Backup and restore](BACKUP_RESTORE.md); keep automation disabled until restored state and delivery history have been reconciled.

## 8. Exact Windows 11 PowerShell procedure

Run every command from the repository root in **Windows PowerShell 5.1 or PowerShell 7**. Paths assume
`C:\Users\<you>\Documents\Engineering-HUB`; adjust to your checkout.

> **Warning:** `clasp push` uploads source only. It does **not** migrate spreadsheet data, change Script
> Properties, install triggers, or reset `AUTOMATION_SETTINGS`. Older code may not be schema-compatible with a
> migrated workbook.

### 8.1 Local validation

```powershell
Set-Location C:\Users\<you>\Documents\Engineering-HUB
git fetch origin
git switch main
git pull --ff-only
npm ci
npm run lint
npm test
npm run validate
```

If `npm` is blocked by the execution policy, call `npm.cmd` instead (for example `& npm.cmd test`).

### 8.2 Development clasp selection

```powershell
@'
{ "scriptId": "REPLACE_WITH_DEVELOPMENT_SCRIPT_ID", "rootDir": "src" }
'@ | Set-Content -Encoding ascii .clasp.dev.json

Copy-Item .clasp.dev.json .clasp.json -Force
Get-Content .clasp.json     # verify the scriptId before pushing
```

`.clasp.json` and `.clasp.dev.json` are git-ignored. Never commit them.

### 8.3 Development deployment

```powershell
npx clasp login                       # once per machine
npx clasp status                      # shows the files that will be pushed
npx clasp push --force                # updates source in the development project
```

The bound project must be created from the spreadsheet (**Extensions → Apps Script**) so the sidebar works.

### 8.4 Script Properties (development)

Project Settings → Script Properties. Required keys:

| Property | Example |
| --- | --- |
| `ENVIRONMENT` / `BOUND_ENVIRONMENT` | `DEVELOPMENT` / `DEVELOPMENT` |
| `SPREADSHEET_ID` | development workbook ID |
| `BACKUP_FOLDER_ID` | restricted Drive folder ID |
| `ALLOWED_RECIPIENT_DOMAINS` | `example.test` (development-only domain) |
| `MAX_EMAILS_PER_RUN` | `1` while testing |
| `EMAIL_ENABLED` / `DRY_RUN` | `false` / `true` until the LIVE review |
| `ADMIN_BOOTSTRAP_ALLOWLIST` | your development address (remove after bootstrap) |
| `APPROVED_MIGRATIONS` | empty until a migration is reviewed |
| `CALENDAR_ENABLED` / `CALENDAR_ID` | `false` / empty until reviewed |

### 8.5 Safe initialization (empty workbook only)

```javascript
function initializeDevelopmentFromEditor() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  initializeNewDatabase('INITIALIZE ' + id);
}
```

Set `INITIALIZATION_SPREADSHEET_ID` to the same ID first, run once, then delete both the wrapper and the property.
Initialization refuses any workbook that already contains a value or formula.

### 8.6 First administrator bootstrap

```javascript
function bootstrapFromEditor() {
  var actor = Session.getActiveUser().getEmail();
  return bootstrapFirstAdministrator(actor, 'BOOTSTRAP ADMIN ' + actor);
}
```

Requirements: `ADMIN_BOOTSTRAP_ALLOWLIST` contains the account, an active member row exists for it, the workbook is
initialized at the current schema, and no administrator/bootstrap/notification history exists. It is one-time and
audited (`ADMIN_BOOTSTRAPPED`). Remove the allowlist entry afterwards.

### 8.7 Existing workbook migration

Take and verify a backup first (see 8.8), then run the migration from the editor:

```javascript
function migrateFromEditor() {
  return upgradeExistingDatabase();   // requires APPROVED_MIGRATIONS to list the reviewed IDs
}
```

Run only with the reviewed migration IDs in `APPROVED_MIGRATIONS` (for example `003_management_reliability`), then
inspect `SCHEMA_MIGRATIONS`, `validateSystem()` and the roles. Remove the temporary approvals.

### 8.8 Backup verification

```javascript
function backupFromEditor() {
  return createDatabaseBackup();      // returns the Drive copy ID
}
```

Record the returned ID, timestamp, environment and schema version. Open the copy as the recovery operator and
confirm it is restricted. A failed backup blocks the migration — do not continue.

### 8.9 Trigger installation

```javascript
function installTriggersFromEditor() {
  var actor = Session.getActiveUser().getEmail();
  return installAuthorizedTriggers(actor, 'INSTALL AUTHORIZED TRIGGERS');
}
```

Then check `Triggers.diagnostics()` (or システム状態): no duplicates, no missing handlers, no obsolete handlers and
`scheduleMatches === true`. Weekly report day/time come from the settings — change them first, then reinstall.

### 8.10 Controlled production promotion

```powershell
Copy-Item .clasp.prod.json .clasp.json -Force
Get-Content .clasp.json            # verify the PRODUCTION scriptId
npx clasp push
```

Then, in the production project: confirm `ENVIRONMENT=PRODUCTION` and `BOUND_ENVIRONMENT=PRODUCTION`, take a verified
backup, migrate with reviewed IDs only, bootstrap/assign roles, keep `EMAIL_MODE=OFF`, run the smoke test, and only
then consider PREVIEW → LIVE (ADMIN + confirmation + preflight).

### 8.11 Rollback

```powershell
git switch main
git log --oneline -5               # pick the last known-good commit
git checkout <known-good-sha>
Copy-Item .clasp.prod.json .clasp.json -Force
npx clasp push                     # deploys the older source only
git switch main
```

Code rollback does not revert data. If data must be reverted, follow [Backup and restore](BACKUP_RESTORE.md): new
copy, explicit rebinding, ledger reconciliation, operator sign-off.

## V1.3 deployment steps (delta only)

V1.3 does not change the binding rules: development and production stay in separate
Apps Script projects, spreadsheets and clasp configurations, and every activation is explicit.

1. **Upgrade the workbook (additive)**

   ```js
   // Script Properties (manager project)
   APPROVED_MIGRATIONS = 002_task_assignment_safety,003_management_reliability,004_shared_dashboard,005_task_planning_and_requests
   ```

   Then run `upgradeExistingDatabase()`. Migration 005 takes a verified backup, appends the
   TASKS planning columns and creates `TASK_REQUESTS` and `TASK_DEADLINE_HISTORY`. Existing
   cells, formulas and custom columns are preserved; the migration refuses to run without the
   approval entry.

2. **Create the request inbox** (separate spreadsheet, never the master or the snapshot):
   see [Request inbox deployment](docs/REQUEST_INBOX_DEPLOYMENT.md). Set
   `REQUEST_INBOX_SPREADSHEET_ID` in **both** projects and run
   `initializeRequestInbox('INITIALIZE REQUEST INBOX')` once as an administrator.

3. **Dashboard project**: the manifest now requests
   `https://www.googleapis.com/auth/spreadsheets` (snapshot read + inbox append) and
   `userinfo.email`. Re-authorise the deployment, keep `access: DOMAIN` and
   `executeAs: USER_DEPLOYING`, and publish a new version. Set
   `REQUEST_SUBMISSION_ENABLED=false` to close submissions temporarily.

4. **Publish the new contract**: run `publishSharedDashboard()` (or the sidebar action) so
   the snapshot is written with contract `1.3`. An older snapshot keeps working until then;
   the viewer refuses a contract it does not know.

5. **Notification switches** (all default OFF):
   `DEADLINE_REQUEST_EMAIL_ENABLED`, `COMPLETION_REPORT_EMAIL_ENABLED`,
   `PENDING_REQUEST_REMINDER_ENABLED`. Enabling them never changes the master mode; real
   mail still requires `LIVE`, no emergency stop, an activated notification account and
   allowed recipient domains.

6. **Verify**: `npm ci`, `npm run lint`, `npm test`, `npm run validate`. Then follow
   [docs/dashboard/SMOKE_TEST.md](docs/dashboard/SMOKE_TEST.md) and the V1.3 gates; local
   results are not Workspace evidence.

