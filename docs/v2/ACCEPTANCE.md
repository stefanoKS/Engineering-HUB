# V2 Acceptance Record

Status vocabulary: **PASS** (verified locally with the stated evidence), **FAIL** (verified and
broken), **BLOCKED** (cannot be verified here — missing credential, Workspace, DNS or host),
**NOT_RUN** (not attempted).

Everything below was produced on a local Windows development host on 2026-10-30/31. No production
system, Google resource or real mailbox was touched. `docs/PRODUCTION_READINESS.md` stays
**NOT APPROVED FOR PRODUCTION**.

## 1. Gate commands

| Command | Result | Evidence |
| --- | --- | --- |
| `npm ci` | PASS | workspace install, lockfile in sync |
| `npm run typecheck` (all workspaces) | PASS | `tsc -p` clean for contracts, domain, db, i18n, api, web, worker, migration, benchmark |
| `npm run lint` (V1 + V2) | PASS | `eslint src dashboard-app shared scripts tests` and `eslint apps packages tools` clean |
| `npm test` | PASS | V1: **776 pass, 0 fail**; V2: **101 pass, 0 fail** across 8 files (real PostgreSQL 18.6) |
| `npm run validate` | PASS | V1 source validation (42 manager files, 3 dashboard files, manifests, 970 keys) and V2 governance (Apps Script ban, HTML sinks, secrets, one allowlist, destructive SQL, `SELECT *`, storage keys, i18n parity, required docs, Compose, migration order) |
| `npm run build` | PASS | `@eh/api`, `@eh/web` (515 KB JS bundle), `@eh/worker` |
| `npm run benchmark` | PASS | measured, recorded in [PERFORMANCE.md](./PERFORMANCE.md) |
| `npm run migration -- …` on the fixture snapshot | PASS | see §5 |

## 2. Product requirements

| Requirement | Status | Evidence |
| --- | --- | --- |
| Every V1 manager feature exists in V2 | PASS | [FEATURE_PARITY.md](./FEATURE_PARITY.md) — each row names the V1 entry point, the V2 location and the test |
| Every V1 employee feature exists (list, filter, deadline request, completion report, submission states, switch) | PASS | `apps/web/src/screens/Overview.tsx`, `POST /api/employee/requests`, `api.test.ts` |
| Identifiers, enum values and Japanese terms unchanged | PASS | migration preserves IDs; `packages/domain` enums match V1; 廃止/再有効化 and 退職/復職 kept |
| Permission model preserved (ADMIN/MANAGER/MEMBER/VIEWER, no self-change, last admin) | PASS | `packages/domain/src/roles.ts` + `api.test.ts` role tests |
| Counting, progress, hierarchy, planning and request rules preserved | PASS | `packages/domain/test/domain.test.ts` (39 tests) |
| Data model complete in PostgreSQL | PASS | `packages/db/src/migrations/0001…0005`, `integration.test.ts` (14 tests) |
| V1 → V2 migration tool with dry run, reconciliation, preservation | PASS (fixture) | `tools/migration/test/migration.test.ts` (8 tests) |
| Employee publication allowlist and privacy boundary | PASS | `packages/contracts/test/contracts.test.ts`, `api.test.ts` |
| Notifications gated, logged, deduplicated, uncertain never retried | PASS (transport doubles) | `apps/worker/src/jobs.ts`, `apps/worker/test/backup.test.ts`, `domain.test.ts` policy tests |
| Backups encrypted and restorable | PASS (logical path) | `apps/worker/test/backup.test.ts` (4 tests) |
| Response time targets | PASS locally | [PERFORMANCE.md](./PERFORMANCE.md): worst manager read p95 227 ms, employee snapshot p95 198 ms / 808 KB at 10 000 tasks |
| Responsive, Japanese-first UI with the language switch | PASS | `apps/web`, `apps/web/test/ui.test.tsx` |
| Self-hosting and remote access configuration | PASS (templates) / BLOCKED (live) | `deploy/`, `npm run validate`; live TLS and tunnel are BLOCKED |
| Documentation complete | PASS | twelve `docs/v2` documents plus root README/README_JP/AGENTS/ARCHITECTURE/DATA_SCHEMA/DEPLOYMENT/BACKUP_RESTORE/CHANGELOG updates |

## 3. Security requirements

| Requirement | Status | Evidence |
| --- | --- | --- |
| Identity from a verified Google ID token, then a database role | PASS (local verification logic, dev fixture) | `apps/api/src/auth/auth.ts`; live Google exchange BLOCKED |
| Authorization re-checked server-side on every entry point | PASS | `api.test.ts`: unauthenticated 401, MEMBER refused on a manager read, role change effective immediately |
| CSRF header and origin check on every mutation | PASS | `api.test.ts` |
| Revision-checked partial patch, `EDIT_CONFLICT` | PASS | `integration.test.ts`, `api.test.ts` |
| Idempotent create | PASS | `api.test.ts` (same key returns the first result) |
| No browser-supplied authority | PASS | request schemas reject actor/role/owner; `validate-v2` scans persistence keys |
| Container completion refused in domain, import and trigger | PASS | `domain.test.ts`, `integration.test.ts`, `api.test.ts` |
| Append-only audit and deadline history | PASS | `integration.test.ts` (trigger refusal) |
| Deletion limited to empty records with tombstone | PASS | `domain.test.ts` (preflight blockers incl. deadline/schedule history), `services/deletion.ts` |
| No stored text rendered as HTML | PASS | React only; `validate-v2` HTML-sink rule |
| Secrets never committed | PASS | `validate-v2` secret scan, `.env.example` placeholders, `.gitignore` |
| Mail OFF by default, emergency stop, LIVE preflight, uncertain never retried | PASS (policy) | `domain.test.ts` OFF/PREVIEW/LIVE matrix, ledger states |
| BACKUP encryption with an external key | PASS | `backup.test.ts` (wrong key refused) |
| Penetration test | NOT_RUN | outside this work |

## 4. Data and migration requirements

| Requirement | Status | Evidence |
| --- | --- | --- |
| Schema, constraints, triggers applied by a checksummed migration runner | PASS | `packages/db/test/integration.test.ts`, `db:migrate` |
| An applied migration file cannot change silently | PASS | checksum comparison raises an error |
| Import refuses a populated database unless explicitly allowed | PASS | `migration.test.ts` |
| Dry run leaves no row behind | PASS | `migration.test.ts` |
| Identifier, timestamp and history preservation | PASS (fixture) | `migration.test.ts` reconciliation |
| Automation forced OFF after import | PASS | `migration.test.ts` |
| Custom columns and formulas reported, not dropped silently | PASS | `inventory` report, `migration.test.ts` |
| Reading the real V1 workbook | BLOCKED | needs `spreadsheets.readonly` service account |
| Production import and cut-over | NOT_RUN | needs an approved change window |

## 5. Migration evidence detail

* Fixture: `tools/migration/fixtures/v1-snapshot.json` (members, responsibilities, projects,
  subprojects, tasks with dependencies, assignees, skills, requests, deadline history, audit,
  settings).
* `inventory` lists known headers, custom columns and formula cells.
* `validate` reports zero ERROR on the fixture; the negative tests inject a duplicate ID, an unknown
  reference, a bad date and a cycle and expect exit code 1.
* `import` (fresh database) inserts every row in one transaction, then `reconcile --run <id>`
  returns `ok: true` with per-table counts and a field checksum; a tampered row is detected.
* `import --dry-run` performs the same work and rolls back; the test asserts the tables are empty.

## 6. What is not verified (explicit)

| Item | Status | Why |
| --- | --- | --- |
| Google sign-in against the real OAuth client | BLOCKED | no client ID/secret and no Workspace |
| Gmail send, Calendar event, Drive upload, Sheets append | BLOCKED | no service account with delegation |
| Notification delivery, reminder and Calendar behaviour in a live mailbox | BLOCKED | same |
| Published snapshot in the real spreadsheet | BLOCKED | no destination spreadsheet |
| Public TLS certificate, Cloudflare Tunnel, external device access | BLOCKED | no DNS, no host, no tunnel |
| `pg_dump`/`pg_restore` backup and restore, and RTO | NOT_RUN | embedded PostgreSQL ships no client tools |
| Production dataset volume, concurrency and load test | NOT_RUN | local benchmark only, single client |
| Live Workspace latency and quotas | NOT_RUN | requires a live tenant |
| Browser compatibility matrix (Safari/iOS/Android) | NOT_RUN | only the build and jsdom tests ran |
| Accessibility audit | NOT_RUN | outside this work |
| Production approval | **NOT APPROVED** | see `docs/PRODUCTION_READINESS.md` |

## 7. Known limitations accepted for this record

1. The employee request path is authenticated by the company Google account but has no
   owner-match check — a deliberate product rule, not a defect.
2. Rate limiting is per process; a multi-instance deployment should move it to the proxy.
3. No WAL archiving: RPO equals the last successful backup.
4. The workload report, the requests queue (unpaginated) and the employee snapshot grow with open
   or published volume; see the growth table in [PERFORMANCE.md](./PERFORMANCE.md).
5. `audit_id` serial values are not preserved from V1 (timestamps, actors, actions and values are).
6. The root `package.json` keeps the V1 release version because the V1 release tests read it; the
   V2 version is `APP_VERSION` in `packages/contracts`.

## 8. Sign-off

| Role | Name | Date | Decision |
| --- | --- | --- | --- |
| Implementation (AI assistant, Copilot SDK in VS Code) | — | 2026-10-31 | Local implementation complete; live verification **BLOCKED**; production **NOT APPROVED** |
| Reviewer | _pending_ | — | — |
| Deployment authorisation | _pending_ | — | — |
