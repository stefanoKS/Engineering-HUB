# Employee-ID LAN installation — 2026-11-02

This mode runs on the host Windows PC and serves colleagues through a browser. PostgreSQL is authoritative. Google is optional and used only for encrypted backup uploads. No Google email or Workspace sign-in is needed for application users. Implementation is locally verified; deployment, live Drive and physical recovery are separate gates. **NOT APPROVED FOR PRODUCTION** until the host checks below pass.

## Accounts and permissions

- AUTH_MODE=local accepts only employee ID + password. Google tokens and development identities cannot log in to this mode.
- Employee IDs are case-sensitive text (letters, digits, underscore, hyphen; 1–32 characters). Leading zeros are preserved. IDs are unique and immutable through the UI.
- Passwords require 4–128 characters and use salted scrypt (N=131072, r=8, p=1), following the [OWASP recommendation](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Passwords/hashes are never returned in account lists or audit payloads.
- Five wrong passwords lock an account for 15 minutes; the login endpoint also limits attempts by IP. A correct password resets the failure counter after the lock expires. A reset clears the lock.
- Administrators create local accounts, attach credentials to existing member IDs, and reset another employee's password. New/reset accounts must change the temporary password before accessing any work API. Password change/reset invalidates all old sessions.
- Roles/activation remain in Members. Administrators manage these fields; existing self-change/last-administrator guards remain. Register a second administrator for recovery. There is no default password or public registration endpoint.
- Managers retain the project, task, assignment and review screens. Members receive My assigned work and a read-only All Work list; they may create a task for themselves and submit a completion request, but they cannot edit an existing task, change an assignee or deadline, or complete work. ADMIN and MANAGER both decide completion requests, and either may complete authorized work directly.
- VIEWER retains the existing published read-only projection; publication must already be configured/populated. A fresh local installation does not automatically publish company data. Use MEMBER for employees who need assigned work.
- Account linking retains an existing member's name/role and IDs; it does not duplicate project relationships. Existing Google bindings remain stored but are not used in local mode.

## 1. Host prerequisites

Use an always-on Windows host, Node.js 22.13+ and an installed PostgreSQL 18 server with pg_dump/pg_restore. Node 24 is the local tested runtime. PostgreSQL should run as a Windows service, listen on localhost only, and require password authentication. Do not use the temporary test database or its trust authentication for real work.

Have IT reserve the host IP (example 10.1.6.253). Confirm the approved LAN ranges. Do not expose PostgreSQL port 5432 or forward application port 8050 from the internet. No firewall, service, scheduled task or live database has been installed by these repository changes.

## 2. Create a dedicated database

In PostgreSQL's administrative console, create a dedicated role and database, replacing the password placeholder. Do not reuse your PostgreSQL superuser account for the application.

~~~sql
CREATE ROLE ehub LOGIN PASSWORD 'REPLACE_WITH_A_GENERATED_PASSWORD';
CREATE DATABASE engineering_hub OWNER ehub;
~~~

Use a URL-safe generated password or percent-encode it in DATABASE_URL. Ensure pg_hba.conf uses scram-sha-256 for this local login. Existing company databases must not be used as an empty-install target.

## 3. Build and configure

From the Engineering-HUB repository root:

~~~powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test:v2
npm.cmd run validate
npm.cmd run build
New-Item -ItemType Directory -Force data/lan
Copy-Item deploy/windows/api.env.example data/lan/api.env
Copy-Item deploy/windows/worker.env.example data/lan/worker.env
~~~

Do not overwrite an existing populated environment file. Edit the copies:

| File / variable | Value |
| --- | --- |
| api.env: DATABASE_URL | Dedicated local PostgreSQL connection |
| api.env: PUBLIC_ORIGIN | Exact browser origin, e.g. http://10.1.6.253:8050 |
| api.env: HOST / PORT | 0.0.0.0 / 8050 for LAN access |
| api.env: AUTH_MODE | local |
| api.env: DEV_AUTH_ENABLED | false |
| worker.env: DATABASE_URL | Same database; never put Google credentials in api.env |
| worker.env: BACKUP_DIRECTORY | Persistent folder, default data/backups |
| worker.env: BACKUP_INSTANCE_ID | Unique stable installation name; use a different name for staging |
| worker.env: PG_DUMP_PATH / PG_RESTORE_PATH | Installed PostgreSQL client executables; quote paths containing spaces |
| worker.env: BACKUP_ENCRYPTION_KEY | Base64-encoded 32 random bytes |
| worker.env: BACKUP_ONLY | true — suppresses mail, Calendar, Sheets/publication and other non-backup jobs |

Generate a key locally with Node; save it into worker.env and in a separate protected recovery location. Never send it through chat or commit it:

~~~powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
~~~

Restrict data/lan and data/backups Windows ACLs to the service operator and administrators. JavaScript mode bits do not configure Windows ACLs. data/ is gitignored. Ordinary users need neither filesystem access nor database credentials.

### HTTP versus HTTPS

The example explicitly sets ALLOW_INSECURE_LAN_HTTP=true to support the requested private-IP HTTP URL. This means passwords and sessions travel unencrypted over the LAN. Use only on a trusted, approved network. For HTTPS, put an approved TLS proxy in front, change PUBLIC_ORIGIN to the HTTPS origin, remove that override, and bind the API to loopback if the proxy runs on the same host. Secure cookies follow the configured HTTPS origin. Do not enable TRUST_PROXY=true for a directly reachable API.

## 4. Apply schema and create your administrator

Migration 0007_local_accounts.sql permits members without email, adds local credential records and session credential versions. Migration 0008_member_created_work.sql (2026-11-03) adds the member task-creation channel and the recorded request author; it is additive and rewrites no existing column. Both preserve existing IDs/records and do not rewrite prior migration files. For an existing database, first create and verify a backup, then review/apply the new migration.

Run deploy/windows/Migrate-Lan.cmd and type APPLY MIGRATIONS when ready. This is an explicit one-shot action; startup never migrates.

Run in PowerShell:

~~~powershell
./deploy/windows/Bootstrap-Admin.ps1
~~~

It prompts for employee ID, name and a hidden temporary password, pipes JSON to the built bootstrap command, and refuses if local accounts already exist. No password is placed in command-line arguments. Use the script under your normal company script policy; do not bypass organizational controls. It does not provision Google or Windows accounts.

## 5. Start and access

Double-click deploy/windows/Start-Lan.cmd, or run npm.cmd run start:lan. The supervisor starts the API and worker with separate environment files and stops the other process if either fails. Keep the window running; Ctrl+C stops both. PostgreSQL runs independently as its installed service.

Open http://10.1.6.253:8050/ (replace with the reserved address). Use the same PUBLIC_ORIGIN address on the host as on client PCs. Sign in with the bootstrapped employee ID and temporary password, change the password, and sign in again.

Have IT add a firewall rule for TCP 8050 only from approved LAN ranges, on the applicable Domain/Private profiles. No rule is added automatically. Verify from a second PC before inviting staff. Prevent the host from sleeping during working hours.

For automatic start, an operator can create a Windows Task Scheduler task that runs node.exe with scripts/lan-host.mjs (absolute path), starts in this repository, runs whether the operator is logged in or not, and restarts on failure. Run as a dedicated restricted Windows account with access to the environment files and backup directory. Test a real reboot. Do not run the scheduled task and the manual launcher simultaneously. A PID guard refuses duplicate launch; if a crash leaves a stale PID file, verify no host process is running before removing data/lan/host.pid.

## 6. Register staff

Use Accounts to create employee IDs, names, roles and temporary passwords, or to link a login to an existing member picked from the searchable list. Deliver each password privately. Use Members to change roles or disable employees; do not delete their historical records. Linking to an existing member keeps its name and role; the form cannot overwrite them. Users change their own password from the header. Resetting another user's password revokes their current sessions and requires another first-login change.

Create responsibility areas, then projects and tasks. Assign employees as primary/additional assignees so their My assigned work screen contains the appropriate tasks. Save conflicts require a fresh read; another user's update is never silently overwritten.

### Member self-service and manager authority (updated 2026-11-03)

* A member creates work from 自分の担当タスク: choose an active project, an optional subproject, a name, a
  description, a deadline and a priority. The owner is the signed-in member and the task starts as
  `Not Started` with 0 % progress. No administrator approval is needed to create it, and it appears
  immediately in the member's list and the manager's task list. The deadline may fall on a weekend
  or a public holiday; no duration, working-day acknowledgement or effort estimate is requested.
* A member does **not** edit progress, actual hours, a deadline or an existing task. The only way to
  finish work is 完了報告 with a required note. The former progress endpoint was removed.
* `REQUEST_SUBMISSION_ENABLED` (Automation → 自動化設定, default **false**) must be `true` before any
  request is accepted. The screen shows that submissions are closed and offers no request action
  while it is off.
* A pending request never changes the task. A **MANAGER** or an **ADMIN** decision writes `Done`
  exactly once, for member-created, manager-created and legacy tasks alike. Rejection or return
  leaves the task unfinished.
* A MANAGER or ADMIN may also complete authorized work directly from すべてのタスク or the task detail
  (完了にする). Containers, cancelled and already-done work are refused; a pending completion report
  is withdrawn with a recorded reason and a `TASK_COMPLETED_DIRECT` audit row.
* The displayed state is derived: 完了 when done, 期限超過 when the Asia/Tokyo date is past the
  deadline, otherwise 進行中. Nothing is persisted by a nightly job and the stored legacy status is
  kept.
* The member sees 承認待ち / 承認済 / 却下 / 差戻し / 再確認が必要 for their own requests only; another
  member's receipt is not readable.

### Accounts and assignment (updated 2026-11-03)

* Accounts offers two ways to create a login: **create a new employee** (employee number, name, role,
  temporary password) or **link an existing member** chosen from a searchable picker of members that
  have no login yet. Linking never rewrites the member's name, role, assignments or history, and one
  member can only ever have one login.
* One two-panel picker replaces the old primary-owner and additional-assignee controls: search by
  name or employee number at the top, selected employees as removable chips below. The current
  primary owner is kept while still selected; otherwise the lowest member ID in the selection
  becomes primary, so click order never decides ownership.
* My Assigned Work is available to ADMIN, MANAGER, MEMBER and VIEWER and is always resolved from the
  verified session; only a MEMBER may create a task or submit a request from it.

## 7. Hourly local backups

First run deploy/windows/Backup-Now.cmd. It must report a local encrypted dump path. Check Status and the local backup directory. There is no fallback that claims an in-memory archive is a persistent backup.

In Automation, enable DAILY_BACKUP_ENABLED and set BACKUP_INTERVAL_MINUTES=60. Despite the legacy daily label, the interval controls the cadence. SCHEDULE_ENABLED=true starts the worker scheduler but does not itself bypass the database feature switch. Email, Calendar, exports and publication remain off in the backup-only setup.

Each backup saves an AES-256-GCM encrypted custom pg_dump archive and JSON manifest. The file checksum is checked before upload/retry; local files survive Google failure. A failed upload is logged as FAILED with localSaved=true and retried through the durable outbox. Exhausted retries remain visible in Status; files are retained for manual recovery. No backups are automatically deleted. Monitor disk space and define a manual retention policy. One-hour recovery-point expectations apply only while scheduled backups succeed.

## 8. Optional Google Drive destination

Use a company-owned Shared Drive folder shared with the service account, where company policy permits. Enable Drive API and put one-line service-account JSON into GOOGLE_SERVICE_ACCOUNT_JSON in worker.env. Configure DRIVE_BACKUP_FOLDER_ID. The code supports Shared Drive API flags and queries app-owned backup identities to recover an interrupted upload. Ordinary employees never sign into Google through this application.

If policy instead requires impersonating a Workspace user, configure GOOGLE_DRIVE_DELEGATED_USER and have a Workspace super administrator approve the drive.file delegation scope. Do not authorize Gmail/Calendar/Sheets for this backup-only setup. The code accepts JSON content, not a path to a JSON key file. Store keys server-side only.

Live permissions, storage policy and uploads are NOT_RUN until tested on the actual tenant. Restart the worker after environment changes. Prove one upload, download the encrypted file through authorized Drive access, and use the recovery command below. Separate staging/production folders and BACKUP_INSTANCE_ID values. Do not rotate the backup key without retaining old keys for old files.

## 9. Restore verification

Use the actual encrypted file, either local or downloaded from Drive:

~~~powershell
node --env-file=data/lan/worker.env apps/worker/dist/cli.js verify-restore "C:/approved-recovery/backup.dump.enc"
~~~

The verification operator's PostgreSQL login needs permission to create/drop a scratch database. Use an operator-only environment file if the application's database login lacks that permission; do not give all application users database administration privileges. The command creates a fresh scratch database, decrypts the supplied file, runs pg_restore with --exit-on-error and --single-transaction, queries member/task/account counts, reports them and drops only the generated scratch database. Compare counts and inspect representative restored records before declaring recovery proven. It never restores over the configured source database.

Without a file argument, verify-restore performs only a logical archive test of current data; that is not evidence that stored dump files or Drive recovery work. Full operational restoration and service cutover require an operator-reviewed recovery plan. Missing pg_dump/pg_restore is a failure, never a successful production backup.

## Verification status

Automated evidence is in LOCAL_LAN_ACCEPTANCE.md. Required host checks: PostgreSQL service and persistent storage, Windows ACLs, second-PC network/firewall access, restart/reboot behavior, scheduled hourly backup, actual pg_dump restore, and live Drive upload/download. No real credentials or company data were used in automated tests.

## Member name edits — 2026-11-03

The member editor sends only changed fields. A name-only edit does not submit unchanged role or activation fields, so editing your own display name does not invoke the self-permission-change guard. The repository preserves omitted role, manager and weekly-capacity fields (undefined is omission; explicit null remains a clear). Explicit self-role/activation changes remain refused. Employee ID and password are unchanged by a display-name edit.

Deploy both the rebuilt web bundle and API together, then restart the LAN host and reload the browser. A source edit alone does not update the running host. No migration or operational-data repair is required for the rejected name edit.
