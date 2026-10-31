# Operations Runbook (V2)

Day-to-day operation of a self-hosted V2 installation. The V1 Apps Script runbook stays valid for
the V1 project while it is still deployed.

## 1. Services

| Service | Role | Fails how |
| --- | --- | --- |
| `api` | HTTP API + built web bundle | `/healthz` fails; the proxy returns 502 |
| `worker` | outbox: notifications, reminders, Calendar, backups, exports, publication, maintenance | jobs pile up in `outbox_jobs`; no user-visible outage |
| `db` | PostgreSQL, the authoritative store | everything fails; restore from backup |
| `caddy` / `cloudflared` | TLS and ingress | the site is unreachable; the stack keeps running |

The API never contacts Google. The worker never serves HTTP. Only the worker holds the service
account.

## 2. Daily checks

| Check | How | Expected |
| --- | --- | --- |
| API alive | `curl -fsS https://<APP_DOMAIN>/api/version` | version JSON |
| API ready | `curl -fsS https://<APP_DOMAIN>/readyz` | database ok, schema version current |
| Worker progress | `docker compose logs --since 1h worker \| grep 'job failed'` | no permanent failures |
| Outbox backlog | 状態 screen, or `SELECT count(*) FROM outbox_jobs WHERE status IN ('PENDING','LEASED')` | small and draining |
| Backup | `backup_log` latest row | `OK`, checksum present, `verify-restore` PASS monthly |
| Ledger | `notification_ledger` for `DELIVERY_UNCERTAIN` / `FAILED` | reviewed, not silently retried |
| Disk | `df -h` | above 20 % free |
| Certificate | browser / `curl -vI` | valid, renewed |

## 3. Routine tasks

**Create or change members.** ADMIN on メンバー. Role changes are ADMIN-only, cannot be applied
to yourself, and cannot demote or deactivate the last active administrator.

**Change automation settings.** ADMIN on 自動化. Every change is revision-checked and audited.
Turning e-mail to LIVE requires the exact phrase and a passing preflight; the emergency stop
always wins.

**Approve a deadline change or a completion report.** 申請一覧 → review → decide. The decision is
applied once; a second decision is refused. A request whose task changed after submission becomes
`STALE` and is never applied over the newer value.

**Publish the shared dashboard.** ADMIN → 公開 → publish (confirm). The inactive slot is written
and verified, then committed with one metadata write. A failure leaves the previous snapshot
readable and is recorded.

**Delete a mistaken, empty project/subproject/task.** ADMIN only, 削除: the preflight must show no
dependencies, the reason is required, the confirmation is a single Yes/No dialog and the server
derives `DELETE <id>`. A record with history is refused and must be archived instead.

## 4. Incident playbooks

### The site is down
1. `docker compose ps` — is `api` running?
2. `docker compose logs --tail 200 api` — configuration error or database failure?
3. `curl -fsS http://127.0.0.1:8080/healthz` — is the process alive behind the proxy?
4. `docker compose exec db pg_isready` — is the database up?
5. If the database is corrupt or lost, follow the restore procedure in
   [BACKUP_RESTORE.md](./BACKUP_RESTORE.md), then restart `api` and `worker`.

### Mail is being sent when it should not be
1. 自動化 → 緊急停止 (ADMIN). This forces `EMAIL_MODE=OFF` and is audited.
2. Inspect `notification_ledger` for the affected window: `SENT`, `PREVIEW`,
   `DELIVERY_UNCERTAIN`.
3. Fix the cause (mode, switch, recipients, template), then re-enable LIVE only with the phrase.
4. Never delete ledger rows: they are the evidence.

### A job keeps failing
1. `SELECT job_id, kind, attempts, last_error FROM outbox_jobs WHERE status = 'FAILED'`.
2. `NOT_CONFIGURED` means a missing credential — fix the environment, not the job.
3. A permanently failing job stays `FAILED`; it is never retried forever.
4. `tsx src/cli.ts run-once` drains the outbox once for a controlled retry.

### An ambiguous delivery
`DELIVERY_UNCERTAIN` is never retried automatically. Check the mailbox/calendar for the item, then
either record the reconciliation or enqueue a fresh, distinct message. Do not "resend the job".

### A stale edit conflict
The browser keeps the draft and reports `EDIT_CONFLICT`. Reload the record, review the newer
values, re-apply the intended changes. Never overwrite blindly and never bypass the revision
check.

### Unexpected authorization failures after a role change
Authorization is re-read per request, so a role change takes effect immediately. Confirm the
member row (`role`, `active`) in the database and the `audit_log` entry for the change.

## 5. Change management

1. Branch, implement, run `npm ci`, `npm run lint`, `npm test`, `npm run validate`.
2. For a behavioural change, update the docs (`docs/v2/*`, the operating docs) and record the
   check gate.
3. Before deploying a migration: `backup-now`, `verify-restore` PASS, then the one-shot `migrate`.
4. Deploy code after the migration, then verify `/readyz` and the 状態 screen.
5. Record what was deployed, when, by whom, and the backup ID.

## 6. Data hygiene

* Never edit rows in production to fix a mistake without a recorded reason and an audit note.
* Never delete audit, ledger, deadline-history, request or backup rows.
* Never clear a table; `verify-restore` creates and drops its own scratch database only.
* Exports and snapshots are outputs; they are regenerated, never edited by hand.

## 7. Scheduled jobs

| Job | Trigger | Setting |
| --- | --- | --- |
| `backup.database` | daily when enabled | `DAILY_BACKUP_ENABLED` |
| `notification.reminder-scan` | daily | `DEADLINE_REMINDER_ENABLED`, `OVERDUE_REMINDER_ENABLED`, `REMINDER_OFFSETS` |
| `publication.run` | hourly while enabled | `SHARED_DASHBOARD_PUBLISH_ENABLED`, `SHARED_DASHBOARD_PUBLISH_INTERVAL_MINUTES` |
| `calendar.task` | on a task change | `CALENDAR_SYNC_ENABLED` |
| `maintenance.sessions` | daily | — (expired session cleanup) |
| `export.sheets` | on demand | `EXPORT_SPREADSHEET_ID` |

Dedupe keys make a duplicate enqueue harmless. A crashed worker's lease expires and the job is
claimed again; a notification is never sent twice because the ledger key is checked inside the
job.

## 8. What this runbook does not cover

Live Google Workspace setup (see [GOOGLE_WORKSPACE.md](./GOOGLE_WORKSPACE.md)), the DNS/tunnel
setup (see [REMOTE_ACCESS.md](./REMOTE_ACCESS.md)) and the V1 → V2 cut-over (see
[MIGRATION.md](./MIGRATION.md)). None of those has been executed against a live environment.
