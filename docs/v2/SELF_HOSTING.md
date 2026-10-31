# Self-Hosting V2

V2 is one Docker Compose stack: PostgreSQL, the API (which also serves the built web app), the
worker and a reverse proxy. It runs on a single Linux host and needs no Google Cloud resource of
its own — only an OAuth client and a service account for Workspace.

## 1. Prerequisites

| Requirement | Minimum | Notes |
| --- | --- | --- |
| Host | 2 vCPU, 4 GB RAM, 40 GB SSD | `db` is capped at 2 GB / 2 CPU, `api` 1 GB / 2 CPU, `worker` 1 GB / 1 CPU |
| OS | any Linux with Docker Engine 24+ and Compose v2 | Windows/macOS are development only |
| DNS | one host name pointing at the host | `APP_DOMAIN`, for example `engineering-hub.example.co.jp` |
| Ports | 80 and 443 inbound | only the proxy is exposed; the API binds `127.0.0.1:8080` on the host |
| Time zone | Asia/Tokyo for the database | set in Compose; business dates use the same zone |
| Backups | a Drive folder shared with the worker's service account | see [BACKUP_RESTORE.md](./BACKUP_RESTORE.md) |

## 2. First installation

```bash
git clone <repository> engineering-hub
cd engineering-hub
npm ci
npm run typecheck
npm test                       # needs the embedded PostgreSQL; see §7
npm run build                  # @eh/api, @eh/web, @eh/worker

cp deploy/.env.example deploy/.env
# fill in: POSTGRES_PASSWORD, APP_DOMAIN, PUBLIC_ORIGIN, MANAGER_WEB_ALLOWED_DOMAINS,
#          GOOGLE_CLIENT_ID, VITE_GOOGLE_CLIENT_ID, BACKUP_ENCRYPTION_KEY,
#          GOOGLE_SERVICE_ACCOUNT_JSON, GMAIL_SENDER, CALENDAR_ID, DRIVE_BACKUP_FOLDER_ID
```

The web bundle takes `VITE_*` values at **build** time, so rebuild the image after changing the
client ID:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env build
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d
```

Then:

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env --profile tools run --rm migrate
```

The `migrate` service applies the reviewed SQL migrations in order inside an advisory lock and
records the checksums. It never seeds, resets or clears data. It is a deliberate one-shot
service: the API and worker never migrate at boot.

## 3. The first administrator

V2 has **no** bootstrap route, no self-registration and no default account. Create the first
administrator explicitly, once:

```sql
INSERT INTO members (member_id, name, email, department, position, role, active)
VALUES ('MEM-ADMIN-1', 'Administrator', 'admin@example.co.jp', '設計・開発課', '管理者', 'ADMIN', true);

INSERT INTO audit_log (entity_type, entity_id, action, new_value, actor_email)
VALUES ('MEMBER', 'MEM-ADMIN-1', 'INITIAL_ADMIN_CREATED', '{"source":"operator"}', 'operator');
```

Sign in with that Google account, then create the other members in the UI. Everyone else is
created by a manager; an unknown e-mail is refused, never auto-provisioned.

## 4. Verify the installation

| Check | Command / screen | Expected |
| --- | --- | --- |
| Liveness | `curl -fsS http://127.0.0.1:8080/healthz` | `{"ok":true,...}` |
| Readiness | `curl -fsS http://127.0.0.1:8080/readyz` | database reachable, schema version current |
| Version | `curl -fsS http://127.0.0.1:8080/api/version` | application/API/contract versions |
| Sign-in | `https://<APP_DOMAIN>` | Google button, then the overview |
| Manager screens | Overview, 案件, タスク, 申請一覧, 自動化, 状態 | no console error; Japanese default; `日本語 \| English` present |
| Employee view | `/` employee screen | published tasks only, no private fields |
| Automation | 自動化 screen | `EMAIL_MODE=OFF`, emergency stop on after a fresh migration |
| Backup | `node apps/worker/dist/cli.js verify-restore` | `result: PASS` |

## 5. Upgrades

```bash
git pull
npm ci
npm run lint && npm run typecheck && npm test && npm run validate
docker compose build
docker compose exec worker node apps/worker/dist/cli.js backup-now
docker compose --profile tools run --rm migrate      # additive, checksummed, one-shot
docker compose up -d
```

Order matters: build and verify the backup **before** the migration, then migrate, then run the
new code. A migration that would rewrite or drop data is not allowed in this repository.

## 6. Operations

| Task | Command |
| --- | --- |
| Logs | `docker compose logs -f api worker` |
| Restart one service | `docker compose restart api` |
| Run the outbox once (cron) | `docker compose exec worker node apps/worker/dist/cli.js run-once` |
| Backup now | `docker compose exec worker node apps/worker/dist/cli.js backup-now` |
| Verify a backup | `docker compose exec worker node apps/worker/dist/cli.js verify-restore` |
| Database console | `docker compose exec db psql -U ehub engineering_hub` |

The API and worker have no shell access to Google from the browser side; only the worker holds
the service account. Do not mount the service-account key into the `api` service.

## 7. Running the test suite without Docker

The repository's `vitest` setup installs `@embedded-postgres/windows-x64` (or the platform
equivalent) and starts a real PostgreSQL instance in a temporary directory, so `npm test` works
without Docker. That embedded distribution ships `initdb`/`pg_ctl`/`postgres` only — it has no
`pg_dump`/`pg_restore`/`psql`, which is why the logical backup path is the verified one locally
and the `pg_dump` path is recorded as **NOT_RUN**.

## 8. Capacity and limits

* A page is capped at 100 rows; the compact task index at 2 000 entries; the project index at 500.
* The API pools at `PG_POOL_MAX` (default 10) connections per instance; the worker uses 3.
* Rate limit 300 requests/minute per address per instance, body limit 256 KB.
* Measured local numbers and the method are in [PERFORMANCE.md](./PERFORMANCE.md). They are not a
  promise about your host.

## 9. Hardening checklist

- [ ] `NODE_ENV=production`, `DEV_AUTH_ENABLED=false`, `DEV_AUTH_EMAILS` empty.
- [ ] `MANAGER_WEB_ALLOWED_DOMAINS` lists only the company domain.
- [ ] `POSTGRES_PASSWORD` and `BACKUP_ENCRYPTION_KEY` are generated, unique and stored in a
      secret manager; `deploy/.env` is never committed.
- [ ] Port 5432 is not published; only 80/443 are open.
- [ ] TLS certificate issued; HSTS header present.
- [ ] `EMAIL_MODE=OFF` and `EMERGENCY_STOP=true` until the live checklist in
      [GOOGLE_WORKSPACE.md](./GOOGLE_WORKSPACE.md) is complete.
- [ ] A verified backup exists and `verify-restore` returned PASS.
- [ ] Host patching, log rotation and disk monitoring assigned to an owner.
