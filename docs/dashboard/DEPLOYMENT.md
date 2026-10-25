# Shared dashboard deployment (V1.2)

Everything below is a manual, operator-driven procedure. **Nothing in this repository has
been deployed or executed against a real Google Workspace tenant.** Treat every step as
UNVERIFIED until the corresponding smoke test is recorded in [SMOKE_TEST.md](SMOKE_TEST.md).

## 1. Resources

Four independent Google resources per environment (three spreadsheets + two Apps Script projects,
one of which is bound to the first spreadsheet):

| # | Resource | Environment-bound | Notes |
| --- | --- | --- | --- |
| 1 | Manager Apps Script project | yes | Container-bound to the management workbook |
| 2 | Management spreadsheet | yes | Private operational database |
| 3 | Snapshot spreadsheet | yes | New, empty; never the management workbook |
| 4 | Request inbox spreadsheet (V1.3) | yes | Third file; never the management workbook or the snapshot |
| 5 | Dashboard Apps Script project (standalone) | yes | Web app; not container-bound |

Development and production must not share any of these resources. The management, snapshot and
inbox spreadsheets are **three different files**; publication refuses the management workbook as a
destination and the inbox refuses it too. For a first installation follow
[../PRE_TRIAL_CHECKLIST.md](../PRE_TRIAL_CHECKLIST.md).

## 2. Separate clasp targets

The two applications are pushed from different `rootDir` values. `.clasp.json` and
`.clasp.*.json` are git-ignored and must never be committed.

```powershell
# Manager (development)
@'
{ "scriptId": "REPLACE_WITH_MANAGER_DEV_SCRIPT_ID", "rootDir": "src" }
'@ | Set-Content -Encoding ascii .clasp.manager-dev.json

# Shared dashboard (development)
@'
{ "scriptId": "REPLACE_WITH_DASHBOARD_DEV_SCRIPT_ID", "rootDir": "dashboard-app" }
'@ | Set-Content -Encoding ascii .clasp.dashboard-dev.json

Copy-Item .clasp.manager-dev.json .clasp.json -Force
Get-Content .clasp.json        # rootDir must be "src"
npx clasp status               # only src/ files may be listed
npx clasp push

Copy-Item .clasp.dashboard-dev.json .clasp.json -Force
Get-Content .clasp.json        # rootDir must be "dashboard-app"
npx clasp status               # only dashboard-app/ files may be listed
npx clasp push
```

Repeat with `-prod` files for production. The manager project always uses `"rootDir": "src"`;
**never** `"rootDir": "."`, and never upload both applications into the same Apps Script project.
Verify `rootDir` and the `clasp status` file list every time: pushing `src/` into the dashboard
project (or the reverse) is the failure mode this split exists to prevent.

## 3. Manager Script Properties added for V1.2

| Property | Meaning |
| --- | --- |
| `SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID` | ID of the sanitized snapshot workbook. Never exposed by any UI or API. |
| `APPROVED_MIGRATIONS` | Must include `004_shared_dashboard` for the version 3 → 4 upgrade. |

Publication preferences are **not** Script Properties: they live in `AUTOMATION_SETTINGS`
(`SHARED_DASHBOARD_PUBLISH_ENABLED`, `SHARED_DASHBOARD_PUBLISH_INTERVAL_MINUTES`) and are
edited through `SharedDashboardPublisher.saveSettings`.

## 4. Dashboard Script Properties

| Property | Required | Meaning |
| --- | --- | --- |
| `SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID` | yes | Snapshot workbook the viewer may read. |
| `SHARED_DASHBOARD_ALLOWED_DOMAIN` | recommended | Company Workspace domain, e.g. `example.com`. |
| `SHARED_DASHBOARD_REQUIRE_EMAIL` | optional | `true` refuses viewers whose address cannot be resolved. **Leave unset for a first trial:** the web app runs as its deployer, an employee address may be unavailable, and enabling this before verifying resolution can lock employees out. |
| `SHARED_DASHBOARD_STALE_HOURS` | optional | Age in hours after which the page warns (default `24`). |

The dashboard project must never contain `SPREADSHEET_ID`; `npm run validate` rejects it.

## 5. Initialize the snapshot workbook

1. Create a new, empty spreadsheet for the environment.
2. Set `SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID` in the **manager** project properties.
3. Run this wrapper in the manager editor as a signed-in administrator:

```javascript
function initializeSharedDashboardFromEditor() {
  var id = PropertiesService.getScriptProperties().getProperty('SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID');
  return initializeSharedDashboardSnapshot('INITIALIZE SHARED DASHBOARD ' + id);
}
```

Refusals (by design): wrong confirmation, destination equal to the master workbook, any
existing value or formula in the destination, or a destination containing operational
tables. Initialization never touches the management workbook.

The workbook keeps its default empty `Sheet1`; delete it manually if you prefer a tidy
workbook (the application never deletes sheets).

## 6. Approve project visibility

1. Run the migration (section 7) first.
2. For each project that may be shared, set `Dashboard_Visibility = INTERNAL` through the
   domain API/UI and fill `Dashboard_Summary` with text that is safe to publish.
3. Fill `TASKS.Public_Note` for tasks that should show a public note. `Description`,
   `Acceptance_Criteria` and `Next_Action` are never published, whatever they contain.
4. Leave everything else `RESTRICTED`. Blank means "not reviewed" and is excluded.

## 7. Migration 3 → 4 (`004_shared_dashboard`)

```javascript
function upgradeToV4FromEditor() {
  return upgradeExistingDatabase();
}
```

Requirements: a verified backup folder, `004_shared_dashboard` in `APPROVED_MIGRATIONS`,
and a reviewed migration. The migration is additive: it appends `Dashboard_Visibility`,
`Dashboard_Summary` (PROJECTS) and `Public_Note` (TASKS), preserves every existing cell,
formula, custom column and ID, and publishes nothing. Take the approval out of
`APPROVED_MIGRATIONS` afterwards.

## 8. Enable publication

Publication settings are also available in the manager sidebar
(**設計・開発課 管理 → 自動化設定 → 共有ダッシュボード公開**): status, interval, ON/OFF,
"今すぐ公開" and "公開差分を確認". The sidebar calls the same validated domain functions and a
MEMBER is refused every one of them.

From the editor (ADMIN account):

```javascript
function enablePublicationFromEditor() {
  return SharedDashboardPublisher.saveSettings(
    { SHARED_DASHBOARD_PUBLISH_ENABLED: true, SHARED_DASHBOARD_PUBLISH_INTERVAL_MINUTES: 30 },
    Session.getActiveUser().getEmail(), 'ENABLE SHARED DASHBOARD PUBLICATION');
}
```

ADMIN only, requires an initialized destination and the exact confirmation. Then run a first
publication and inspect it:

```javascript
function publishFromEditor() { return publishSharedDashboard(); }
function statusFromEditor() { return sharedDashboardPublicationStatus(); }
function previewFromEditor() { return previewSharedDashboardPublication(); }
```

`previewSharedDashboardPublication()` writes nothing and reports counts, exclusions, warnings
and whether the projection differs from the committed snapshot.

## 9. Publish on a schedule

```javascript
function installTriggersFromEditor() {
  var actor = Session.getActiveUser().getEmail();
  return installAuthorizedTriggers(actor, 'INSTALL AUTHORIZED TRIGGERS');
}
```

The publication handler `scheduledSharedDashboardPublish` is part of the managed trigger set
**only while publication is ON**. Its cadence is derived from
`SHARED_DASHBOARD_PUBLISH_INTERVAL_MINUTES`, rounded down to an Apps Script-supported value
(1, 5, 10, 15 or 30 minutes, or 1, 2 or 4 hours). Re-running `installAuthorizedTriggers`
removes the handler when publication is disabled.

## 10. Deploy the web app

1. Open the dashboard project → **Deploy → New deployment → Web app**.
2. Execute as **Me** (the authorized deployment account).
3. Who has access: **Anyone within `<company domain>`**.
4. Deploy, then open the URL with a normal employee account and with a manager account.
5. Only after an employee account can open the page may you optionally set
   `SHARED_DASHBOARD_REQUIRE_EMAIL=true` (fail closed) and re-test; remove it if a legitimate
   employee is refused.

Do not use "Anyone" access. Do not reuse the manager project as the employee app. The deployment
ACL is the primary access control; the server-side domain check is defence in depth because the
deployer-run web app may not expose the viewer's address.

## 11. Emergency publication disable

Publication never affects mail, Calendar or the manager UI. To stop publishing:

```javascript
function disablePublicationFromEditor() {
  return SharedDashboardPublisher.saveSettings(
    { SHARED_DASHBOARD_PUBLISH_ENABLED: false }, Session.getActiveUser().getEmail());
}
```

Disabling is available to a manager and is audited (`SHARED_DASHBOARD_PUBLICATION_DISABLED`).
Scheduled runs then return `PUBLICATION_DISABLED` and write nothing. Existing readers keep
seeing the last committed snapshot. To remove the cadence trigger entirely, disable
publication and re-run `installAuthorizedTriggers`.

## 12. Rollback

| Goal | Action |
| --- | --- |
| Stop publishing | Disable publication (section 11). The last snapshot stays readable. |
| Hide one project again | Set `Dashboard_Visibility = RESTRICTED` and publish. The next snapshot omits it. |
| Revert dashboard code | Deploy the previous dashboard version from the Apps Script deployment history. The snapshot format is unchanged by UI deployments. |
| Revert the manager schema | Not supported by `clasp push`. Restore from a verified backup into a new workbook and rebind properties; see [BACKUP_RESTORE.md](../../BACKUP_RESTORE.md). |
| Recover from a bad snapshot | Publish again from the manager project. Both slots are rewritten from source; no manual repair of the snapshot is needed. |

## 13. Failure modes to expect

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| Page says the dashboard is not configured | `SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID` missing in the **dashboard** project | Set the property and redeploy. |
| Page says no data has been published | Snapshot not initialized or never published | Initialize, enable publication, publish once. |
| Page says the format is unsupported | `CONTRACT_VERSION` mismatch between deployed apps | Deploy both projects from the same commit. |
| Page shows a stale-data banner | Last publication older than `SHARED_DASHBOARD_STALE_HOURS` | Check `sharedDashboardPublicationStatus()` and the scheduled trigger. |
| Manager sees "publication destination must never be the private master workbook" | Property points at the management workbook | Correct the property; never point at the master. |

## V1.3: request submission

1. Create the request inbox spreadsheet — a **third** file, different from the management
   workbook and from the snapshot — and configure `REQUEST_INBOX_SPREADSHEET_ID` in both
   projects (see [../REQUEST_INBOX_DEPLOYMENT.md](../REQUEST_INBOX_DEPLOYMENT.md)).
2. Run `initializeRequestInbox('INITIALIZE REQUEST INBOX')` once in the manager project through a
   temporary no-argument wrapper (the editor Run button cannot pass arguments; example in
   [docs/REQUEST_INBOX_DEPLOYMENT.md](docs/REQUEST_INBOX_DEPLOYMENT.md)).
3. The dashboard manifest now asks for `https://www.googleapis.com/auth/spreadsheets` plus
   `userinfo.email`. Re-authorise, keep `access: DOMAIN` and `executeAs: USER_DEPLOYING`, and
   deploy a new version.
4. Publish a snapshot with contract `1.3` after upgrading the workbook; the viewer refuses
   an unknown contract.
5. Set `REQUEST_SUBMISSION_ENABLED=true` **after** the inbox is ready. Since V1.3.1 an absent
   property (or any value other than `true`) keeps submissions closed; verify the state with
   `requestSubmissionConfig()` in the dashboard project and set it to `false` to close
   submissions without redeploying.

