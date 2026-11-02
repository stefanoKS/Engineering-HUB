# V2 Stabilization Record

## Update — 2026-11-01

See [RELEASE_HARDENING.md](RELEASE_HARDENING.md) for the current UI, concurrency, delivery, Calendar and performance changes and unresolved release blockers. The dated records below are historical; they do not establish complete feature parity or production approval.


This document records the stabilization pass that turned the first V2 commit into a candidate that
can be built, started and exercised as a production artifact. It is deliberately conservative: a
check is **PASS** only with a recorded command and its actual result, and everything that needs a
real Google tenant, DNS, a company host or a real dataset is **BLOCKED** or **NOT_RUN**.

| Item | Value |
| --- | --- |
| Reviewed starting commit | `d369af9cba2ff39c774531f899caafdc34cbd12a` (`feat(v2): PostgreSQL-backed engineering platform (self-hosted)`) |
| Work branch | `stabilize/v2-production-candidate` |
| Host used for every measurement below | Windows 11, Node.js v24.21.0, npm 11.19.0, embedded PostgreSQL 18.6 (test binaries), AMD Ryzen 7 5700X, 15.9 GB RAM |
| Container runtime on the review host | **not available** — container build/start is BLOCKED here |
| Datasets | fixture `tools/migration/fixtures/v1-snapshot.json`; benchmark `small` (20 projects / 200 tasks / 20 members) |
| Production data touched | none |
| Date | 2026-10-31 |

## 1. Baseline at the reviewed commit

Every command below was run before any change, on the reviewed commit.

| Check | Result | Evidence |
| --- | --- | --- |
| `npm run typecheck` | PASS | all nine workspaces clean |
| `npm run lint` | PASS | V1 + V2 ESLint clean |
| `npm run test` | PASS | V1: 776 tests, 0 fail. V2: 101 tests in 8 files, 0 fail |
| `npm run validate` | PASS | V1 source validation + V2 governance |
| `npm run build` | PASS | `@eh/api`, `@eh/web`, `@eh/worker` produced `dist` |
| `node apps/api/dist/main.js` | **FAIL** | `ERR_MODULE_NOT_FOUND … packages/db/src/pool` imported from `packages/db/src/index.ts` |
| `docker` | NOT_RUN | no container runtime on the review host |

The build "passing" while the artifact could not start is exactly the failure mode this pass had to
remove: a passing build is not evidence that a deployment works.

## 2. Verified defects, fixes and regression tests

Severity is from the point of view of a deployment: **S1** = a documented production command does
not work, **S2** = data loss, duplicate delivery or a security boundary, **S3** = an operational or
contract defect, **S4** = a bench/advisory defect.

| # | Sev | Defect (verified at the starting commit) | User impact | Fix | Regression test | Validation |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | S1 | The API bundle externalized `@eh/db`, whose `exports` point at TypeScript source with extensionless imports | The documented production command, `node apps/api/dist/main.js`, exited with `ERR_MODULE_NOT_FOUND`; the same applied to the worker and the migration CLI (which had no build at all) | `apps/api/tsup.config.ts`, `apps/worker/tsup.config.ts`, `tools/migration/tsup.config.ts` compile the internal `@eh/*` workspaces into the artifact; `start:prod` scripts added; the migration CLI resolves `EH_MIGRATIONS_DIR`, the checkout path or a copied `migrations` directory and fails with an actionable message | `scripts/production-smoke.mjs` (`npm run smoke:prod`) builds, migrates, starts, reads, mutates and stops the **built** API | PASS — smoke output in §4 |
| 2 | S1 | Runtime images copied `node_modules` without the workspace directories the workspace links point at, and copied sources instead of only artifacts | A container built from `deploy/*.Dockerfile` would start a process whose imports could not resolve | `deploy/api.Dockerfile` / `deploy/worker.Dockerfile`: a `deps` stage installs production dependencies from manifests only, the runtime stage copies only `dist`, the reviewed SQL and `package.json`, runs as `node`, and declares a health check | `scripts/validate-deploy.mjs` asserts no source copy, the exact `CMD`, `USER node`, `npm ci` and no `--force` | PASS (static) / BLOCKED (container build: no runtime available) |
| 3 | S2 | A worker completed or failed a job by `job_id` only, and nothing renewed a lease | An expired worker could overwrite a newer worker's outcome; a long job could lose its lease and be executed twice | `outbox_jobs.lease_token` (migration `0006`), `completeJob`/`failJob`/`renewLease` require the token, `claimNext` returns it, the loop renews it every `LEASE_SECONDS/3` and logs `lease lost before completion` | `packages/db/test/integration.test.ts` — "refuses an outcome from a worker whose lease was reclaimed", "renews only a lease the caller still owns" | PASS |
| 4 | S2 | Email was sent before any durable attempt was recorded | A crash after Gmail accepted the message left a retryable job that could send a duplicate | Migration `0006` adds `attempt_id`/`attempt_started_at`/`attempt_owner`/`uncertain_at` and the `SENDING` ledger state. `claimDeliveryAttempt` claims one attempt atomically, `finishDeliveryAttempt` only records for the owning attempt, `releaseDeliveryAttempt` handles a definite transient failure, `reconcileInterruptedDeliveries` turns an abandoned attempt into `DELIVERY_UNCERTAIN`, and `authorizeDeliveryRetry` is the only path back | `integration.test.ts` delivery-attempt cases; `apps/worker/test/delivery.test.ts` (uncertain is never retried; transient failure returns to `PENDING`; capped run reports `RETRY`) | PASS |
| 5 | S2 | Only the first `REMINDER_OFFSETS` entry was read, and the 7-day and 2-day reminders shared a ledger key | A task received one reminder instead of the configured stages | `reminderOffsets`/`reminderCatchupDays`/`overdueFrequencyDays` in `packages/domain`; the scan evaluates every stage, catches up a missed stage within the allowance, honours the sending window and repeats overdue reminders at the configured interval; the ledger key includes the stage (`bucket`) | `packages/domain/test/domain.test.ts` — "gives every reminder stage and every request its own identity" | PASS |
| 6 | S2 | A `PREVIEW` ledger row blocked the later legitimate live send; two requests on one task shared one notification identity; recipients above the cap were dropped while the job reported `DONE` | After switching to LIVE, a previewed notification was never sent; request mails merged; overflow recipients were lost silently | `deliver()` treats `SENT`/`DELIVERY_UNCERTAIN`/`SENDING` as final and lets `PREVIEW` become `SENDING`; the request bucket carries the request id; a capped run returns `RETRY` with `DELIVERY_INCOMPLETE` and logs the deferred count | `apps/worker/test/delivery.test.ts` — "lets a later live send proceed after a preview", "reports deferred recipients…" | PASS |
| 7 | S3 | `REASSIGNMENT_EMAIL_ENABLED`, `DEADLINE_CHANGE_EMAIL_ENABLED` and the request-type switches had no producer or consumer | A manager could change a switch with no effect | Reassignment now uses `REASSIGNMENT_EMAIL_ENABLED`; an approved deadline change enqueues a `DEADLINE_CHANGE` notification gated by `DEADLINE_CHANGE_EMAIL_ENABLED`; a submitted request is gated by the switch that matches its type | `delivery.test.ts` — "honours the deadline-change switch…" | PASS |
| 8 | S2 | Deletion preflight and revision check ran **before** the transaction; the transaction only re-read the row | A concurrent relationship or revision change could be ignored and an eligible-by-stale-data record removed | `evaluatePreflight(..., { lock: true })` locks the target row (`SELECT … FOR UPDATE`) and re-evaluates every blocker and the revision inside the same transaction as tombstone + audits | `packages/domain` preflight tests (unchanged behaviour) and `services/deletion.ts` by review; **no independent-connection concurrency test yet** | PASS (static/logic) / NOT_RUN (cross-connection race test) |
| 9 | S3 | Reconciliation compared fields only for the seven `compare: true` tables, treated a blank source cell as a match, and the checksum described the source only | Tables such as milestones, issues, holidays, phases, requests, history, ledger and settings were count-only; blank-vs-default divergence was invisible | `tools/migration/src/reconcile.ts` compares every mapped column, compares a blank cell against the destination column default (from `information_schema`, volatile defaults reported as `skippedFields`), compares `task_assignees` / `responsibility_members` / `task_dependencies` as sets, compares settings against the documented safe overrides, and adds a deterministic destination checksum | `tools/migration/test/migration.test.ts` — tampering in members/ledger/settings is detected; a missing relationship row is detected; clean import still `ok` | PASS |
| 10 | S3 | Backups were deduplicated per business day | An hourly cadence was impossible although it is the agreed one | `schedule()` buckets the backup job by `BACKUP_INTERVAL_MINUTES` (setting, default 60) so the same interval never enqueues twice | `scripts/validate-deploy.mjs` requires the documented interval; scheduling is by review | PASS (logic) / NOT_RUN (live Drive run) |
| 11 | S1 | The Caddyfile nested the site block inside an anonymous global-options block | Caddy serves no site, so no browser reaches the application | `deploy/caddy/Caddyfile` has one top-level `{$APP_DOMAIN}` site block with the security headers and the API proxy | `scripts/validate-deploy.mjs` — first non-comment line must be the site block, braces balanced, proxy target, HSTS | PASS (static) / BLOCKED (`caddy validate` needs the image; CI runs it) |
| 12 | S1 | `db-data` was mounted at `/var/lib/postgresql/data` while the selected image is PostgreSQL 18 | In the official PostgreSQL 18 image `PGDATA` is `/var/lib/postgresql/18/docker`; the volume would not cover it and data would be lost on container recreation | `deploy/docker-compose.yml` mounts `/var/lib/postgresql`; `validate-deploy` derives the expected path from the image major version | `scripts/validate-deploy.mjs` | PASS (static) / NOT_RUN (container persistence test: no runtime) |
| 13 | S1 | `@embedded-postgres/windows-x64` was a required root dev dependency, and CI ran on Ubuntu | `npm ci` fails on a non-Windows runner, so the Linux CI could not install at all | The embedded packages are `optionalDependencies` for each supported platform; CI uses a real `postgres:18-alpine` service via `TEST_DATABASE_URL` | clean `npm ci` on Windows (**PASS**, §5) and the CI workflow | PASS on Windows / BLOCKED on Linux (no Linux host here) |
| 14 | S2 | A missing database made the integration suites skip while the gate reported success | A green CI run did not prove the SQL, triggers and locks | `REQUIRE_DATABASE=1` makes a missing database a hard failure in `vitest.setup.ts` and `expectDatabase`; CI sets it | CI workflow; local run with the embedded server still PASS | PASS |
| 15 | S2 | The login client ID and the dev-sign-in flag were build-time `VITE_*` values while Compose injected runtime variables | One image could not be deployed to two environments, and a missing client ID produced a silent empty login | `GET /api/public-config` returns only `appVersion`, `environment`, `googleClientId`, `authConfigured` and `devSignInEnabled`; `Login.tsx` loads it and shows an actionable message when no sign-in method is configured | `apps/api/test/api.test.ts` — public config exposes no secret; `apps/web/test/ui.test.tsx` — configured, unconfigured and unreadable configuration cases | PASS |
| 16 | S2 | A member was matched by e-mail only | A changed or recycled address could bind the wrong person | Migration `0006` adds `members.google_subject` (unique when set); a verified token is matched by subject first, the first verified sign-in links the subject once and writes `IDENTITY_LINKED`, and a different subject for a linked address is refused | `api.test.ts` — "binds a member to the verified subject and refuses a different one" | PASS |
| 17 | S2 | The client cache let an older response's `finally` replace a newer entry, and invalidation could leave a mounted query blank forever | Stale data could overwrite fresh data after a save; a screen could stay empty or stuck loading | `apps/web/src/state/cache.ts` gives every read ownership of its key (`entries.get(key) === entry`), invalidation refetches mounted queries once, `clear()` invalidates late completions, and a forced refresh supersedes an older read | `apps/web/test/cache.test.ts` — seven deterministic races (older success, older failure, forced refresh, export load, unrelated invalidation, mounted refetch, post-logout completion) | PASS |
| 18 | S3 | The benchmark's write depended on the wall-clock date and failed on a non-working deadline | The measurement harness failed on weekends | `acknowledgeNonWorking: true` on the measured create | `npm run benchmark -- --dataset small --iterations 10` | PASS (§6) |
| 19 | S3 | The production web build published source maps, and `setLedger`/`TRUSTED_PROXY_HEADER` were dead code/settings | Source maps disclose source; a documented setting had no effect | `vite.config.ts` emits maps only with `VITE_SOURCEMAP=true`; `setLedger` removed; `TRUSTED_PROXY_HEADER` removed | `npm run lint` (no unused code), `validate-deploy` (no `VITE_*` login config) | PASS |
| 20 | S3 | `TRUST_PROXY` was a boolean, i.e. trust every hop | A client reaching the API directly could spoof `X-Forwarded-For` and the rate-limit key | `TRUST_PROXY` accepts `true`/`false` or a trusted-proxy list; Compose defaults to `172.16.0.0/12` and publishes the API only on `127.0.0.1:8080` | `validate-deploy` (loopback binding, documented value); config parsing by review | PASS (static) |
| 21 | S3 | The API shutdown handler did not terminate the process | `docker stop` and `npm run smoke:prod` could hang until the kill timeout | `main.ts` closes the app and the pool, then exits explicitly, once | `smoke:prod` verifies the process ends on the signal | PASS |
| 22 | S3 | `development`-only fixtures were trusted through `DEV_AUTH_EMAILS` but the public configuration did not say whether they were available | The browser could not render the correct state | `devSignInEnabled` is `devAuthEnabled && !production`, so the form and the server agree | `ui.test.tsx`, `api.test.ts` | PASS |
| 23 | S3 | The first `/api/session` probe on a signed-out browser returned 401 and was classified as a lost session | The login page showed "セッションが失効しました" before the user had ever signed in | `api.get(path, { expectUnauthenticated: true })` performs the probe without emitting `session-lost`; a genuine denial on any other call still revokes | `apps/web/test/client.test.ts` — "does not treat the first session probe as a lost session" | PASS; verified in the built frontend |
| 24 | S3 | The CSP `style-src`/`img-src` did not allow the Google Identity stylesheet and button image | The Google sign-in button and its stylesheet were blocked in the built frontend | `apps/api/src/app.ts` allows `https://accounts.google.com` for `style-src` and `img-src` (it was already allowed for script/connect/frame) | Browser check of the built frontend: the button and its iframe render, and the CSP console error is gone | PASS (rendering) / BLOCKED (real client ID: the demo origin is refused by Google, as expected) |

## 3. What was intentionally **not** changed

* No authorization, revision check, audit requirement, notification safeguard or durability setting
  was relaxed to make a check pass.
* The V1 application (`src/`, `dashboard-app/`, `shared/`) is untouched; all V1 check-gate records
  are unchanged.
* PostgreSQL remains the authoritative store. The migration and the new columns are additive.
* Mail, Calendar, Drive, Sheets and publication remain OFF by default and are not activated by any
  test, script or deployment template in this pass.
* Unrelated code was not refactored: the Fastify `disableRequestLogging` deprecation warning is
  still emitted, and the 514 KB web bundle is not split.

## 4. Production-artifact evidence

`npm run smoke:prod` (built artifacts only — no `tsx` from source):

```
PASS  isolated PostgreSQL is reachable
PASS  built migration CLI applied the schema (schema version 6; 6 migration(s) applied)
PASS  smoke fixture seeded
PASS  built API answered /healthz
PASS  built API answered /readyz (schema 6)
PASS  development fixture authenticated and issued a session
PASS  authorized manager read succeeded
PASS  authorized mutation created PRJ-20261031-9CAECD88
PASS  the created project is readable through the authorized list
PASS  built API stopped on the shutdown signal
PRODUCTION SMOKE: PASS
```

The worker's built entry point is verified by the same build and by
`apps/worker/test/delivery.test.ts` (handler-level behaviour). A **process-level** worker start
against a real outbox is **NOT_RUN** in this pass; the container start is BLOCKED (no runtime).

### Built frontend check (manual, local)

The built web artifact was served by the built API and opened in a browser. The login screen
rendered the Japanese heading and the Google button (with its iframe and stylesheet) from the
**runtime** public configuration, showed the development fixture because the server enabled it, and
did **not** show a false "session expired" notice for the first signed-out probe. The Google client
ID used for the check was a placeholder, so Google itself refused the origin
(`GSI_LOGGER: The given origin is not allowed for the given client ID`) — that is the expected
BLOCKED state until a real client ID and origin are registered. No automated browser suite was run.

## 5. Gate commands after the changes

| Command | Result | Actual evidence |
| --- | --- | --- |
| `npm ci` | PASS | install from the updated lockfile with the optional platform packages |
| `npm run typecheck` | PASS | nine workspaces, no diagnostics |
| `npm run lint` | PASS | V1 + V2 ESLint clean |
| `npm test` | PASS | V1: 776 tests, 0 fail. V2: 128 tests in 10 files, 0 fail |
| `npm run validate` | PASS | V1 source validation, V2 governance (108 files), deployment templates |
| `npm run build` | PASS | `@eh/api`, `@eh/web`, `@eh/worker`, `@eh/migration` |
| `npm run smoke:prod` | PASS | §4 |
| `docker compose config` / `caddy validate` / image build | BLOCKED | no container runtime on the review host; CI runs `docker compose config` and `caddy validate` |
| `npm run benchmark` | PASS (small) | §6 |

## 6. Performance evidence (this pass)

Harness: `tools/benchmark`, in-process `app.inject`, no TLS and no network; embedded PostgreSQL
18.6; 10 samples per endpoint; dataset `small` (20 projects, 200 tasks, 20 members). Result file:
`docs/v2/bench/results-2026-10-31T11-35-51-989Z.json`.

| Endpoint | p50 ms | p95 ms | max ms | DB calls | bytes |
| --- | --- | --- | --- | --- | --- |
| manager overview | 5.39 | 12.5 | 12.5 | 9 | 16 349 |
| projects page (50) | 3.11 | 3.43 | 3.43 | 9 | 8 178 |
| tasks page (50) | 3.32 | 5.03 | 5.03 | 2 | 24 343 |
| task detail | 2.61 | 4.60 | 4.60 | 5 | 1 224 |
| requests | 0.96 | 1.15 | 1.15 | 1 | 6 035 |
| workload report | 2.70 | 4.79 | 4.79 | 5 | 17 798 |
| employee snapshot | 4.76 | 5.28 | 5.28 | 2 | 80 454 |
| task create (write) | 4.12 | 7.06 | 7.06 | 10 | 913 |

These are server-processing numbers on a small dataset, with no proxy and no network. They are **not**
evidence for the stated office-LAN, remote or initial-page targets, which stay **NOT_RUN**. The
`large` dataset, concurrency, cold/warm cache comparison with a production build behind the proxy,
and remote latency were **not measured in this pass**.

## 7. Remaining defects and limitations (honest list)

| Area | Status | Detail |
| --- | --- | --- |
| Editor generation guards (project/task/member/skill forms) | PARTIAL / NOT_RUN | The cache and query layer now drops superseded reads and a closed editor cannot be reopened by a late read through that layer; the per-form open/detail generation guard described in the brief was **not** implemented or tested in this pass. A late `/api/manager/editor` response could still be painted by a form that is already open. |
| Browser end-to-end workflow tests (save updates list, conflict recovery, unknown outcome, rapid navigation) | NOT_RUN | Only jsdom unit tests and the API injection tests exist. No browser automation was run. |
| Concurrency tests with independent connections (hierarchy, dependencies, last administrator, request-vs-edit) | PARTIAL | Deletion now locks and rechecks; the same pattern was not proven with two real connections, and the other invariants keep their existing single-connection tests. |
| Milestone calendar synchronisation | PARTIAL | A task deadline change now has a `calendar.task` producer; milestones still have no producer. |
| Weekly report | PARTIAL | Producer and handler exist and are switch-gated; delivery is covered by unit-level tests only. Pending-request reminders are represented by the request-submission notification switch, not by a separate recurring reminder. |
| Hourly backup | PARTIAL | Interval scheduling is implemented; `pg_dump → encrypt → decrypt → pg_restore` round trip and Drive upload/restore remain NOT_RUN (no client tools, no Drive). |
| Notification regression matrix | PARTIAL | Delivery states and reminder identities are covered; the full V1 OFF/PREVIEW/LIVE × per-project/per-task × dedupe matrix is not reproduced end-to-end on V2. |
| Feature parity | PARTIAL | `docs/v2/FEATURE_PARITY.md` still needs a per-workflow audit against reachable UI/API; a database table is not a feature. |
| Live Google sign-in, Gmail, Calendar, Drive, Sheets | BLOCKED | No tenant, client ID or service account on the review host. |
| TLS, Cloudflare Tunnel, DNS, company host install | BLOCKED | No DNS, no host, no tunnel. Container start BLOCKED (no runtime). |
| Real dataset migration and restore drill | BLOCKED / NOT_RUN | Fixture only; the real workbook has not been read. |
| Accessibility and browser matrix | NOT_RUN | Not attempted. |

## 8. Deployment-candidate checklist

Run in this order on the target host. Nothing in this repository performs these steps
automatically.

1. **Artifacts** — `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run validate`,
   `npm run build`, `npm run smoke:prod` all pass on the build host.
2. **Configuration** — copy `deploy/.env.example` to `deploy/.env`; set `POSTGRES_PASSWORD`,
   `APP_DOMAIN`, `PUBLIC_ORIGIN`, `GOOGLE_CLIENT_ID`, `MANAGER_WEB_ALLOWED_DOMAINS`; keep
   `DEV_AUTH_ENABLED=false`; keep every automation switch OFF; set `TRUST_PROXY` to the container
   network only.
3. **Database** — start `db`; verify the volume is mounted at `/var/lib/postgresql`; run
   `docker compose --profile tools run --rm migrate` as a separate step (never at boot); verify
   `schema version 6`.
4. **Backup before anything else** — configure `DRIVE_BACKUP_FOLDER_ID` and
   `BACKUP_ENCRYPTION_KEY`; run `backup-now`; record the `backup_id` and manifest checksum; verify a
   restore into a scratch database with `verify-restore`.
5. **Services** — start `api`, `worker`, `caddy`; check `/healthz`, `/readyz`,
   `/api/public-config`; confirm the API port is bound to loopback only.
6. **Google sign-in** — test the real tenant: signature, issuer, audience, expiry, verified e-mail,
   hosted domain, active member, and the refusal for an address outside the allowlist. Record the
   result as live evidence.
7. **Access paths** — office LAN/VPN first; then the Cloudflare Tunnel profile with an Access policy
   on the same hostname; confirm that the application still authorizes behind Access and that no
   direct-origin route bypasses it.
8. **Notifications** — stay OFF; run a PREVIEW pass and inspect the ledger; then activate LIVE only
   with an ADMIN, the exact confirmation and a passing preflight.
9. **Operations** — confirm the hourly backup interval, the last-successful backup and failed-job
   visibility; confirm `authorize-delivery-retry` is understood as the only retry for an uncertain
   delivery.
10. **Pilot** — migrate a copy of the real dataset, run the 20-case DEV smoke plan, measure office
    and remote latency, then decide.

## 9. Release recommendation

**Ready for a controlled development/office pilot; not a production candidate yet.**

The build and start path is now real, the crash-safety and cache-race defects have deterministic
tests, and the migration reconciliation is materially stronger. What still separates this from a
production candidate is evidence, not code: no container build/start, no real Google tenant, no
restore drill, no browser workflow tests, and several parity and concurrency items that are
PARTIAL. `docs/PRODUCTION_READINESS.md` stays **NOT APPROVED FOR PRODUCTION**.
