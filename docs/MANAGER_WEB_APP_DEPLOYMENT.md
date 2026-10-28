# Manager Web App DEV deployment — V1.5

**NOT APPROVED FOR PRODUCTION. These steps are a manual DEV plan, not an executed deployment.** Use the existing DEVELOPMENT workbook and its existing manager Apps Script project. No migration or initialization is required for a schema-6 database. Do not rerun initialization on existing data.

## Identity decision

Deploy the manager web app as **User accessing the web app**, with access restricted to the Workspace domain. The manifest expresses executeAs USER_ACCESSING and access DOMAIN. Verify the settings in the actual deployment dialog; source alone does not prove the live deployment configuration.

Google documents that execution as the accessing user uses that user's authority; Session active identity can be unavailable in other contexts. The manager server uses Session.getActiveUser().getEmail(), an exact domain allowlist and existing Access/Roles checks. It never treats getEffectiveUser as the visitor. A blank identity fails closed. Execute-as-deployer is not an approved fallback. If domain policy prevents verified active identities or required authorization, gate 2 remains BLOCKED.

Sources reviewed: [Google web-app execution modes](https://developers.google.com/apps-script/guides/web), [Google Session identity restrictions](https://developers.google.com/apps-script/reference/base/session).

Trusted ADMIN and MANAGER accounts need sufficient underlying permission to A and the services they invoke, even though they do not need to open Sheets for daily work. Give only the required trusted accounts edit access to A. This is an internal departmental tool, not a barrier against trusted managers directly editing A. Ordinary employees, MEMBER and VIEWER accounts must not have access to A. Publication/import users also need the appropriate B/C permissions. Keep employee deployment settings separate and unchanged.

## Preparation and safe source update

1. Record the current manager script ID, bound DEV workbook ID, deployment ID, version and URL in private deployment notes. Inspect the existing source and back up using the approved process. Do not commit IDs or local clasp files.
2. Confirm ENVIRONMENT=DEVELOPMENT, BOUND_ENVIRONMENT=DEVELOPMENT and the workbook environment marker. SPREADSHEET_ID must point to the existing DEV A. Verify schema 6 with the existing status/check procedure. Stop on mismatch; do not auto-migrate.
3. Verify npm ci, npm run lint, npm test and npm run validate at the intended commit.
4. Select the ignored local manager DEV clasp configuration with rootDir src. Inspect the script ID locally and run npm run clasp -- status. Confirm only src files target the existing manager project. Never use rootDir '.' and never select the dashboard-app target for manager files.
5. After human review of the DEV target, run npm run clasp -- push. This uploads source; it does not create/update a versioned web-app deployment, migrate records, install triggers or activate automation.
6. In the Apps Script editor, verify the uploaded files and manifest. Keep the existing OAuth scope set; the web-app metadata adds no new scopes.

## Environment-specific settings

| Setting | Required DEV value / action |
| --- | --- |
| ENVIRONMENT / BOUND_ENVIRONMENT | DEVELOPMENT / DEVELOPMENT |
| SPREADSHEET_ID | Existing private DEV A; never sent to browser |
| MANAGER_WEB_ALLOWED_DOMAINS | Comma-separated exact authorized Workspace domains, without @; mandatory, blank fails closed |
| ALLOWED_RECIPIENT_DOMAINS | Existing membership/mail policy; distinct from web login domain setting |
| EMAIL_ENABLED / CALENDAR_ENABLED | false / false |
| DRY_RUN | true |
| AUTOMATION_SETTINGS EMAIL_MODE / EMERGENCY_STOP | OFF / true |
| SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID | Existing DEV B only; configure through existing admin process |
| REQUEST_INBOX_SPREADSHEET_ID | Existing DEV C only, distinct from A/B |
| BACKUP_FOLDER_ID | Existing restricted DEV backup folder when relevant |

Do not copy production Script Properties to DEV. Do not install triggers, enable mail/Calendar or initialize B/C as part of this code update. Existing initialized DEV B/C and publication configuration must be reviewed separately for the publication smoke test.

## Deploy and open

1. Deploy → New deployment → Web app in the existing manager project.
2. Description: V1.5.0 DEV plus the reviewed Git SHA. Execute as: User accessing the web app. Who has access: the Workspace domain. If these options cannot enforce the required identity model, stop.
3. Authorize only the reviewed services for the ADMIN test account. Record deployment version/URL privately. Open the /exec URL directly with Sheets closed, verify the actor and role, and bookmark it as 設計・開発課 管理 (DEV).
4. Test a different MANAGER account in a separate browser profile, then each refused account class. Never use a browser payload or deployer email as identity evidence. Verify the audit actor after each write.
5. Follow all 20 tests in MANAGER_WEB_APP_SMOKE_TEST.md. The header shows V1.5 and System status returns 1.5.0; these indicate code version, not Git SHA or deployment ID. Match the deployment description and version in Apps Script to the recorded SHA.

## Updates and rollback

For an update, review the same manager target, upload source, then Manage deployments → Edit → New version. Recheck execute-as/access settings, record the new version and smoke-test the existing /exec URL. A clasp push alone does not update a versioned /exec deployment. Use separate rootDir dashboard-app and its own existing DEV project only when uploading the employee date-reader fix; do not copy manager files into it.

For a web UI problem, stop using its URL and open the existing Sheets menu/sidebar. It uses the same A without data conversion. Archive/disable the failing web deployment or select the previously verified Apps Script version through Manage deployments. Restoring a prior web deployment does not roll back spreadsheet data or the editor source used by the sidebar. If source rollback is necessary, upload the reviewed prior source to the correct DEV target and create a reviewed deployment version; preserve data, audit and backups. Never reset/delete sheets. Reconcile uncertain writes before resuming.

No live authorization, sharing change, clasp upload, Apps Script deployment or production operation was performed for this release.
