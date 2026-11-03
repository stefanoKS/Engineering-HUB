# Engineering-HUB — 設計・開発課 管理

[日本語](README_JP.md)

Engineering-HUB manages a design and development department's projects, task hierarchy, deadlines,
progress and completion reviews. V2 runs a React application, TypeScript API and background worker
on your company LAN, with PostgreSQL as the database. Employee-ID/password sign-in needs no Google
account or email. Japanese is the default; every user can switch to English.

Managers organise responsibilities, projects, subprojects (four levels) and tasks (three levels),
review requests and monitor progress without counting parent tasks twice. Expand the arrow beside
a parent task to show its children directly underneath; click again to collapse the branch. Members create their own
work, update progress and submit completion reports. Backups are encrypted locally first, with an
optional Google Drive copy. Mail, Calendar and publication remain optional and off by default.

## Install on Windows LAN

Use an always-on Windows PC, Node.js 22.13+ (tested with Node 24), PostgreSQL 18 running as a service,
and matching pg_dump/pg_restore tools. Reserve a LAN address. PostgreSQL should listen on localhost
with scram-sha-256 authentication; allow application port 8050 only from approved LAN ranges.

From the repository root:

~~~powershell
npm.cmd ci
npm.cmd run build
New-Item -ItemType Directory -Force data/lan
Copy-Item deploy/windows/api.env.example data/lan/api.env
Copy-Item deploy/windows/worker.env.example data/lan/worker.env
~~~

Edit the copied files using [the Windows LAN guide](docs/v2/LOCAL_LAN.md):

| Setting | Where / purpose |
| --- | --- |
| DATABASE_URL | Both files; a dedicated PostgreSQL database |
| AUTH_MODE=local, DEV_AUTH_ENABLED=false | API; employee-ID/password sign-in |
| HOST=0.0.0.0, PORT=8050, PUBLIC_ORIGIN | API; exact address staff open |
| BACKUP_ONLY=true | Worker; backups without mail, Calendar or publication |
| BACKUP_DIRECTORY, BACKUP_INSTANCE_ID | Worker; protected persistent folder and unique stable installation name |
| PG_DUMP_PATH, PG_RESTORE_PATH | Worker; installed client executable paths |
| BACKUP_ENCRYPTION_KEY | Worker; base64 of 32 random bytes, also kept in a separate protected recovery location |

Generate the key locally:

~~~powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
~~~

Never commit credentials or environment files. Restrict data/lan and the backup directory to the
operator and administrators. Plain HTTP exposes passwords within the LAN: use only an approved,
trusted LAN or configure a TLS proxy and an HTTPS PUBLIC_ORIGIN. Do not expose either port online.

## Set up the database and accounts

Create a dedicated database role using PostgreSQL's administration tools:

~~~sql
CREATE ROLE ehub LOGIN PASSWORD 'REPLACE_WITH_A_GENERATED_PASSWORD';
CREATE DATABASE engineering_hub OWNER ehub;
~~~

Set DATABASE_URL to that database, then run:

~~~powershell
./deploy/windows/Migrate-Lan.cmd
./deploy/windows/Bootstrap-Admin.ps1
./deploy/windows/Start-Lan.cmd
~~~

Migration requires the exact confirmation APPLY MIGRATIONS. For an existing installation, create
and verify a backup first; services never migrate at startup. Bootstrap prompts for employee ID,
name and a hidden temporary password and refuses an installation that already has accounts.

Open PUBLIC_ORIGIN, change the temporary password and create staff accounts in **Accounts**.
Create a second administrator for recovery. New/reset accounts must change their temporary
password before accessing work. Start-Lan supervises the API and worker; keep its window running.
Verify sign-in from a second PC before inviting staff.

## Daily workflows

* **ADMIN / MANAGER:** create responsibility areas and active projects, assign work, and review
  completion or deadline-change requests. ADMIN manages accounts and automation.
* **MEMBER:** open **My Work**, select an active project and optional subproject, enter the task,
  description, deadline and priority. The server assigns you as owner with Not Started / 0%.
  Creation needs no approval. All active projects are available under the department-wide role
  model; publication visibility does not grant editing rights.
* Update your assigned leaf work and send a completion report with a note. Pending requests do
  not complete the task. Only ADMIN can approve completion of member-created tasks; existing
  tasks retain manager review. Follow Pending, Approved, Rejected, Returned or Stale in My Work.
* An administrator must enable REQUEST_SUBMISSION_ENABLED in **Automation** before submission
  (default false). Assigned work in restricted projects can also be reviewed. BACKUP_ONLY does
  not prevent requests or approvals; Google email is unnecessary.

## Configure and verify backups

1. Run **deploy/windows/Backup-Now.cmd** and confirm the local encrypted file exists.
2. In **Automation**, enable DAILY_BACKUP_ENABLED and choose BACKUP_INTERVAL_MINUTES (60 is hourly).
3. Check **Status** for the last local backup, last Drive upload and failures. A Drive outage keeps
   the local backup. Preserve the encryption key for every retained backup.
4. Optional Drive: share a company Shared Drive folder with the service account, set
   GOOGLE_SERVICE_ACCOUNT_JSON (JSON content) and DRIVE_BACKUP_FOLDER_ID in the worker environment,
   then restart the worker. Uploads checkpoint their progress and reuse the same file identity.
5. Download an encrypted backup and verify it using a separate recovery environment file and a
   PostgreSQL role allowed to create scratch databases:

~~~powershell
node --env-file=C:/approved-recovery/worker.env apps/worker/dist/cli.js verify-restore C:/approved-recovery/backup.dump.enc
~~~

This restores into a new scratch database, reports counts and removes only that scratch database.
It never restores over the configured database. Follow the complete
[backup and recovery procedure](docs/v2/BACKUP_RESTORE.md), including comparison with expected
counts. Backups are never automatically deleted. Real Drive and physical LAN checks still require
operator verification; [production approval remains pending](docs/PRODUCTION_READINESS.md).

## Troubleshooting and further reading

| Problem | Check |
| --- | --- |
| Cannot sign in | PostgreSQL/API running, DATABASE_URL, AUTH_MODE=local; change temporary password |
| Second PC cannot connect | PUBLIC_ORIGIN, HOST=0.0.0.0, approved firewall rule for TCP 8050 |
| Request cannot be sent | REQUEST_SUBMISSION_ENABLED, own assignment, unfinished leaf task |
| Manager cannot approve completion | A member-created task requires ADMIN |
| Backup fails | Status error, client executable paths, folder permissions and service-account configuration |
| Stale edit refused | Reload the current revision; do not overwrite newer work |

[LAN installation](docs/v2/LOCAL_LAN.md) · [Operations](docs/v2/OPERATIONS.md) ·
[Architecture](docs/v2/ARCHITECTURE.md) · [API](docs/v2/API.md) · [Security](docs/v2/SECURITY.md) ·
[Migration](docs/v2/MIGRATION.md) · [Container hosting](docs/v2/SELF_HOSTING.md) ·
[Remote access](docs/v2/REMOTE_ACCESS.md) · [Google setup](docs/v2/GOOGLE_WORKSPACE.md) ·
[Validation evidence](docs/v2/ACCEPTANCE.md)

Development checks: npm run typecheck, npm run lint, npm test, npm run validate,
npm run build and npm run test:browser. Contributor rules: [AGENTS.md](AGENTS.md).

Legacy V1 is preserved separately. V1.2 / V1.3 and later release history belongs in
[CHANGELOG.md](CHANGELOG.md); legacy [architecture](ARCHITECTURE.md) and
[duration policy](docs/TASK_DURATION_POLICY.md) remain available.
