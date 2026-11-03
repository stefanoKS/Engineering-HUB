# Engineering-HUB

**Design and development department management** — projects, subprojects, tasks, deadlines,
completion review and backups, running on a company LAN with a PostgreSQL database.

The current platform is **V2**: a TypeScript API, a background worker and a React application.
The legacy V1 Google Apps Script application (`src/`, `dashboard-app/`, `shared/`) stays in the
repository as historical reference and as the migration source; this documentation does not change
it. Its user-visible name is 設計・開発課 管理, and its release records — the V1.2 shared dashboard,
V1.3 planning and request work, and V1.4–V1.7 — are kept in [CHANGELOG.md](CHANGELOG.md), with the
V1 design notes in [ARCHITECTURE.md](ARCHITECTURE.md) and
[docs/TASK_DURATION_POLICY.md](docs/TASK_DURATION_POLICY.md). Release history for V2 lives in the
same changelog.

> Status: implemented and verified locally. A production deployment is **not** approved until the
> checks in [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) have recorded evidence on
> the real host.

---

## 1. What you can do with it

**Managers and administrators**

* Organise work by responsibility area → project → subproject (up to four levels) → task (up to three levels).
* Create and edit projects, subprojects, tasks, members, skills and responsibility areas.
* Deadlines plus a required duration drive the schedule; a non-working deadline raises a warning.
* Review employee requests (completion reports, deadline changes) and approve, reject or return them.
* See each task exactly once in counts and progress: a parent task is organisation, never extra work.
* Configure automation (mail, calendar, publication, backups) with safe defaults: everything outbound is off.

**Members**

* 自分の担当タスク (My Work): your own tasks only, with progress and actual hours.
* Create a task for yourself under an active project, then report progress.
* Submit a completion report and follow its state: 承認待ち / 承認済 / 却下 / 差戻し / 再確認が必要.

**Everyone**

* Japanese by default with a 日本語 | English switch; stored text, IDs and enum values are never translated.
* A stable colour per project so a project stays recognisable across screens.

---

## 2. Prerequisites

| Requirement | Detail |
| --- | --- |
| Host | An always-on Windows PC for the LAN installation (Linux/containers are documented separately) |
| Node.js | 22.13 or newer (Node 24 is the tested runtime) |
| PostgreSQL | 18, installed as a Windows service, listening on localhost only, `scram-sha-256` authentication |
| PostgreSQL tools | `pg_dump` and `pg_restore` on the host (path configured explicitly) |
| Network | A reserved LAN address for the app host; port 8050 reachable from approved LAN ranges only |
| Google (optional) | A service account only if you want encrypted backups copied to Google Drive |

Do not expose PostgreSQL port 5432 or the application port to the internet.

---

## 3. Install on a Windows LAN host

```powershell
cd C:\path\to\Engineering-HUB
npm.cmd ci
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test:v2
npm.cmd run validate
npm.cmd run build
```

Then create the two environment files from the templates and edit them:

```powershell
New-Item -ItemType Directory -Force data/lan
Copy-Item deploy/windows/api.env.example data/lan/api.env
Copy-Item deploy/windows/worker.env.example data/lan/worker.env
```

| Variable | File | Value |
| --- | --- | --- |
| `DATABASE_URL` | api.env, worker.env | Your dedicated database |
| `PUBLIC_ORIGIN` | api.env | The exact origin staff will open, e.g. `http://10.1.6.253:8050` |
| `HOST` / `PORT` | api.env | `0.0.0.0` / `8050` for LAN access |
| `AUTH_MODE` | api.env | `local` (employee ID + password) |
| `DEV_AUTH_ENABLED` | api.env | `false` |
| `BACKUP_DIRECTORY` | worker.env | Persistent folder, e.g. `data/backups` |
| `BACKUP_INSTANCE_ID` | worker.env | One stable name per installation |
| `PG_DUMP_PATH` / `PG_RESTORE_PATH` | worker.env | Installed client executables |
| `BACKUP_ENCRYPTION_KEY` | worker.env | Base64 of 32 random bytes |
| `BACKUP_ONLY` | worker.env | `true` until you deliberately enable mail/calendar/publication |

Never commit an environment file. Restrict `data/lan` and `data/backups` to the service operator
and administrators; `data/` is gitignored.

Generate the backup key locally and also store it in a separate protected recovery location:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

The example LAN configuration uses plain HTTP on a private address, which means passwords travel
unencrypted inside that network. Use it only on a trusted, approved LAN, or put an approved TLS
proxy in front and set `PUBLIC_ORIGIN` to the HTTPS address.

---

## 4. Initial database and account setup

1. Create a dedicated role and database (never reuse the superuser):

   ```sql
   CREATE ROLE ehub LOGIN PASSWORD 'REPLACE_WITH_A_GENERATED_PASSWORD';
   CREATE DATABASE engineering_hub OWNER ehub;
   ```

2. Apply the reviewed migrations **once, explicitly** — start-up never migrates:

   ```powershell
   ./deploy/windows/Migrate-Lan.cmd
   ```

   Type `APPLY MIGRATIONS` when asked. For an existing database, create and verify a backup first.

3. Create the first administrator:

   ```powershell
   ./deploy/windows/Bootstrap-Admin.ps1
   ```

   It asks for employee ID, name and a hidden temporary password, and refuses when accounts already
   exist. There is no default password and no public sign-up.

4. Register further staff in **Accounts**: employee ID, name, role and a temporary password. Every
   new or reset account must change its password at the next sign-in, and a reset ends existing
   sessions. Register a second administrator for recovery.

---

## 5. Start and use

```powershell
./deploy/windows/Start-Lan.cmd     # or: npm.cmd run start:lan
```

The supervisor starts the API and the worker and stops both if either fails. Leave the window
running; PostgreSQL keeps running as a service. Open the `PUBLIC_ORIGIN` address from a second PC
and sign in with the employee ID and temporary password, then change it.

Ask IT to allow inbound TCP 8050 from approved LAN ranges only, and verify access from a second PC
before inviting staff.

---

## 6. Admin and member workflows

**Administrator**

1. Create responsibility areas, then projects (a project must name an active responsibility).
2. Add subprojects and tasks with a deadline, then assign a primary owner and, if needed, additional assignees.
3. Create employee accounts and keep roles in **Members**. Only ADMIN may grant `ADMIN`/`MANAGER`,
   nobody can change their own role, and the last active administrator cannot be demoted.
4. Review 申請一覧. A decision is applied once; a changed task makes a pending request `STALE`
   instead of overwriting the newer value.
5. Turn on optional automation in **Automation** — mail, calendar, shared-dashboard publication —
   only when you are ready. All of them default to off.

**Manager**

Same project/task work as an administrator except role changes, permanent deletion, member
administration limits and completion overrides, which stay ADMIN-only.

**Member**

1. 自分の担当タスク shows your own tasks only.
2. Create a task for yourself: pick an active project, optionally a subproject, then name,
   description, deadline and priority. You become the owner; the task starts as `Not Started` with
   0 % progress and appears immediately for managers too.
3. Update progress and actual hours on your own active leaf work, then send 完了報告 with a note.
4. Follow the state of your own requests. Nothing changes until a manager approves, and a task you
   created is completed only by an administrator.
5. Completion and deadline changes always go through review; a parent task completes through its
   child tasks.

Requests are accepted only while the automation setting `REQUEST_SUBMISSION_ENABLED` is `true`
(default `false`). The screen states clearly when submissions are closed.

---

## 7. Backups

A backup is one AES-256-GCM encrypted PostgreSQL archive written locally first, optionally copied
to Google Drive. A Drive outage never costs the local backup.

1. Run `./deploy/windows/Backup-Now.cmd` once and confirm the reported local file exists.
2. In **Automation** enable `DAILY_BACKUP_ENABLED` and set `BACKUP_INTERVAL_MINUTES` (60 for hourly).
3. Check **Status** for the last local backup, the last Drive upload and any failure.
   `npm.cmd run --workspace @eh/worker tsx src/cli.ts backup-status` prints the same from the host.
4. Verify a backup before you rely on it — a fresh logical check, or a downloaded file into a
   scratch database:

   ```powershell
   node --env-file=data/lan/worker.env apps/worker/dist/cli.js verify-restore "C:/approved-recovery/backup.dump.enc"
   ```

   It creates a scratch database, restores, prints row counts, reports `PASS`/`FAIL`, and drops the
   scratch database. It never restores over the configured database.

Never rotate the encryption key without keeping the old key for old files, and never delete backups
automatically — the application reports retention but never removes a file.

Google Drive (optional): create a company Shared Drive folder, share it with the service account as
Editor, put the service-account JSON (content, not a path) in `GOOGLE_SERVICE_ACCOUNT_JSON` and set
`DRIVE_BACKUP_FOLDER_ID`. Large backups upload resumably and a retry never creates a second copy.
Restart the worker after changing the environment.

---

## 8. Troubleshooting

| Symptom | Check |
| --- | --- |
| Sign-in fails for everyone | `DATABASE_URL` reachable, `AUTH_MODE=local`, API and PostgreSQL services running |
| Sign-in works on the host but not from another PC | `HOST=0.0.0.0`, `PUBLIC_ORIGIN` uses the LAN address, Windows firewall rule for TCP 8050 |
| "Change your temporary password" loop | Reset the password in **Accounts**; a reset ends old sessions |
| Deadline is refused | A non-working or past deadline needs explicit acknowledgement; it is never moved automatically |
| A member cannot send a completion report | `REQUEST_SUBMISSION_ENABLED` must be `true`; the member must be assigned to the task |
| A manager cannot approve a member-created completion | By design — only ADMIN completes a task the member created |
| Backup job fails, Drive | The local file is kept; check the failure text in **Status** (folder shared, folder type, credentials) |
| `pg_dump` not found | Set `PG_DUMP_PATH` to the installed executable, quoting paths with spaces |
| Page shows an old value after an edit | Reload; a save on a stale revision is refused rather than overwriting |

---

## 9. Documentation

| Topic | Document |
| --- | --- |
| Windows LAN installation and operation | [docs/v2/LOCAL_LAN.md](docs/v2/LOCAL_LAN.md) |
| Architecture and decisions | [docs/v2/ARCHITECTURE.md](docs/v2/ARCHITECTURE.md) |
| HTTP API | [docs/v2/API.md](docs/v2/API.md) |
| Security model and limits | [docs/v2/SECURITY.md](docs/v2/SECURITY.md) |
| Backup and restore | [docs/v2/BACKUP_RESTORE.md](docs/v2/BACKUP_RESTORE.md) |
| Daily operations | [docs/v2/OPERATIONS.md](docs/v2/OPERATIONS.md) |
| V1 → V2 migration | [docs/v2/MIGRATION.md](docs/v2/MIGRATION.md) |
| Self-hosting (Compose, Caddy) | [docs/v2/SELF_HOSTING.md](docs/v2/SELF_HOSTING.md) |
| Remote access | [docs/v2/REMOTE_ACCESS.md](docs/v2/REMOTE_ACCESS.md) |
| Google Workspace setup | [docs/v2/GOOGLE_WORKSPACE.md](docs/v2/GOOGLE_WORKSPACE.md) |
| Performance measurement | [docs/v2/PERFORMANCE.md](docs/v2/PERFORMANCE.md) |
| Acceptance evidence | [docs/v2/ACCEPTANCE.md](docs/v2/ACCEPTANCE.md) |
| Production readiness | [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) |
| Release history | [CHANGELOG.md](CHANGELOG.md) |

Contributor rules are in [AGENTS.md](AGENTS.md).
