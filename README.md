# Engineering-HUB — 設計・開発課 管理

[日本語](README_JP.md)

Engineering-HUB manages a design and development department's projects, task hierarchy, deadlines,
progress and completion reviews. V2 runs a React application, TypeScript API and background worker
on your company LAN, with PostgreSQL as the database. Employee-ID/password sign-in needs no Google
account or email. Japanese is the default; every user can switch to English.

Managers organise responsibilities, projects, subprojects (four levels) and tasks (three levels),
review requests and monitor progress without counting parent tasks twice. A project page shows one
expandable tree — each subproject header with its tasks directly beneath it, nested subprojects
below, and project-direct tasks in their own section — so a task is found where it is stored, never
by guessing from names. Expand the arrow beside a parent task to show its children directly
underneath; click again to collapse the branch. Only an ADMIN can permanently remove a mistaken,
empty task or subproject: the control always runs the deletion preflight first, which refuses any
record that still owns work, history or a publication. Members create their own work and submit
completion reports; managers approve those reports or mark authorized work done directly. Task state
is derived from the plan dates and today (予定 / 進行中 / 遅延, plus 開始日未設定 / 日程未設定 for an
incomplete plan), so a stored "Not started" or "Assigned" value never decides the badge; skill grades
are letters A–D, and one searchable picker assigns several employees at once. Backups are encrypted
locally first, with an optional Google Drive copy. Mail, Calendar and publication remain optional and
off by default.

The read-only timeline fits the selected inclusive date range to the chart width. Choose 7 days,
2 weeks, 1 month or Custom; Reset dates returns to the current Tokyo month without clearing filters.
For the month preset, the finish is the day before the corresponding date in the next month, or
that month's last day when the corresponding date does not exist. These controls do not edit schedules.
Within an expanded project, a subproject's arrow independently shows or hides its own task tree.

A project's displayed status is derived, not chosen: the start date, the finish date and today's
Tokyo date decide between planned, in progress, late and a readable missing-date warning. Only an
explicit completion, cancellation or archive changes the stored lifecycle, so no nightly job
rewrites a status and a stored "On hold" value no longer overrides the badge. A deadline is never
shown as overdue once its task is done or cancelled, and a completion after its deadline is labelled
separately as *completed late*. The timeline draws one 12-pixel bar per row; a deadline-only or
same-day record is a 3-pixel point mark centred in its day. A new V2 project is `INTERNAL` by
default and can still be created as `RESTRICTED`; existing visibility values are untouched and a
change still appears at the next publication run.

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

| Role | Can do |
| --- | --- |
| ADMIN | Everything a manager can do, plus accounts, roles and automation |
| MANAGER | Manage every responsibility, project, subproject and task; assign several employees; approve, reject or return completion reports; complete authorized work directly; read their own My Work list |
| MEMBER | Read permitted work; create a task for themselves under an active project; submit a completion report for their own assigned work; never edit an existing task, change an assignee, change a deadline or approve anything |
| VIEWER | Read permitted work and their own assignments; no create, edit, delete, approval or request |

* **My Assigned Work (自分の担当タスク):** every role has one. It is resolved from the verified
  session, so a manager keeps a personal list beside the departmental one and never sees another
  person's personal list.
* **All Work (すべてのタスク):** the same server-paged, filterable, expandable list for everyone.
  MEMBER and VIEWER see it read-only, may open a permitted task and its project, and can filter the
  project picker; only ADMIN and MANAGER get edit, approve, complete and delete controls, and the
  server refuses those calls for the other roles regardless of the buttons. The default list hides
  completed, cancelled and archived work; choose 完了 (Done) in the status filter to review completed
  work, and managers may additionally include cancelled and archived records.
* **Creating work:** a MEMBER selects an active project and optional subproject, enters the name,
  description, deadline and priority, and becomes the owner. Nothing else is required; a deadline on
  a Saturday, Sunday or public holiday is accepted without a warning. Creation needs no approval.
* **Assigning work:** ADMIN and MANAGER use one two-panel picker (選択可能なメンバー /
  選択済みの担当者) with search by name or employee number. The current primary owner is kept while
  still selected; otherwise the lowest member ID in the selection becomes the primary owner, so the
  result never depends on click order. Every active assignee sees the task in their own My Work.
* **Completion:** a MEMBER submits a completion report with a note; pending requests never complete
  the task. A MANAGER or ADMIN approves, rejects or returns it, or marks authorized work done
  directly with a confirmation. A direct completion withdraws a pending report instead of leaving a
  misleading request. Containers cannot be completed, and progress is never counted twice.
* An administrator must enable REQUEST_SUBMISSION_ENABLED in **Automation** before submission
  (default false). Assigned work in restricted projects can also be reviewed. BACKUP_ONLY does
  not prevent requests or approvals; Google email is unnecessary.

## Why the database keeps legacy values

The display is simplified, but stored history is never rewritten:

* Skill levels stay integers (0 = not assessed, 1–4). The screens show A/B/C/D and 未評価 only.
* Task status keeps its historical vocabulary (Not Started, Assigned, In Progress, Blocked,
  On Hold, Done, Cancelled). One date-aware schedule state is derived at read time in Asia/Tokyo -
  予定 / 進行中 / 遅延, with 開始日未設定 / 日程未設定 / 日程データ要確認 when the plan is incomplete or
  reversed - so no scheduled job changes a row. The stored value stays visible as workflow history.
* Planned duration, estimated hours, actual hours and progress percentages remain stored for old
  records. They are simply no longer asked for on the task form and are never cleared by an
  ordinary edit.
* The primary owner column stays authoritative; additional assignees live in the assignment table.
  Readings merge both into one deduplicated assignment list.

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
| `/readyz` answers `DATABASE_MIGRATION_REQUIRED` | The build needs schema 8; create and verify a backup, then run the reviewed migration |
| Second PC cannot connect | PUBLIC_ORIGIN, HOST=0.0.0.0, approved firewall rule for TCP 8050 |
| Request cannot be sent | REQUEST_SUBMISSION_ENABLED, own assignment, unfinished leaf task, MEMBER role |
| Manager cannot edit or approve | The role must be ADMIN or MANAGER; a MEMBER request can be approved by either |
| An assignee is missing from My Work | They must be an active assignee; a removed assignee no longer sees the task |
| Backup fails | Status error, client executable paths, folder permissions and service-account configuration |
| Stale edit refused | Reload the current revision; do not overwrite newer work |

## Migrating an existing schema-7 installation

The reviewed order is: backup, migrate, verify, then create a new deployment version. Nothing
migrates at service startup, and readiness reports `DATABASE_MIGRATION_REQUIRED` until the ledger
reaches schema 8.

~~~powershell
# 1. Verified encrypted backup (never skip a failed backup)
./deploy/windows/Backup-Now.cmd

# 2. Apply the reviewed additive migrations, including 0008_member_created_work.sql
./deploy/windows/Migrate-Lan.cmd

# 3. Confirm the schema version and that existing rows survived
Invoke-RestMethod http://localhost:8050/readyz
node --env-file=C:/approved-recovery/worker.env apps/worker/dist/cli.js verify-restore C:/approved-recovery/backup.dump.enc

# 4. Only after 1-3 pass, publish the new application build
~~~

Rollback is a restore, not a reverse migration: stop the API and worker, restore the verified
backup into a fresh database, point DATABASE_URL at it and restart. See
[backup and recovery](docs/v2/BACKUP_RESTORE.md) and the
[migration guide](docs/v2/MIGRATION.md).

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
