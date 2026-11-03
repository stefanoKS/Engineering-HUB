# V2 Acceptance Record

## Corrective follow-up and expandable task tree — 2026-11-03

Reviewed latest origin/main at 7f5d9e2 with a clean starting worktree; during continuation,
HEAD advanced to 5581a1e containing the earlier self-service/backup changes. Those changes were
preserved; the tree and compatibility follow-up build on that head. This is a source/build update,
not a deployment. No new migration: schema 8 and the existing checksummed migrations are unchanged.
V1 runtime and historical gate files are unchanged. Operational database URLs were removed from
validation subprocesses; database tests used isolated embedded PostgreSQL with REQUIRE_DATABASE=1.

| Gate | Result | Evidence |
| --- | --- | --- |
| npm ci | PASS | Locked install; Node 24.21.0. npm reports 17 moderate dependency advisories; no forced dependency upgrade applied. |
| npm test | PASS | 776 V1 tests; 190 V2 tests across 15 files, zero skipped with TEST_PG_BIN_DIR pointing to PostgreSQL 18 clients. |
| Targeted follow-up | PASS | API suite 37 tests after legacy idempotency replay preservation; UI workflow suite 9 tests after container-feedback correction. |
| npm run build | PASS | API, web, worker and migration artifacts built. |
| npm run validate | PASS | V1/V2 governance and deployment templates. |
| npm run lint / typecheck | PASS | Final checks include tree fixtures and backward-compatible creation replay; explicit required-date fixtures corrected. |
| Built artifact and Chromium local-login smoke | PASS | Isolated schema-8 migration; API health/readiness/auth/mutation; worker job; local account provisioning and password change; child-task create, placement, collapse/reopen; responsive overview and sign-out. |
| Task tree API/UI | PASS | Server-side ancestry before paging, root pages, 27-child branch pagination, MEMBER refusal, nested expansion retention and cached reopening. |
| Member workflows | PASS | Repeated creation (including HTTP-LAN randomUUID fallback), identity-scoped keys, legacy-key replay, receipt isolation, verified requester, restricted-project submission, ADMIN-only member-created completion. |
| Drive transport | PASS (mock) | 11 cases include 9 MiB upload, interrupted chunk, persisted session, expired session, reserved file ID and 409 reconciliation, folder permissions and missing Range. Local checkpoint stays out of database status. |
| Encrypted custom-format restore | PASS (local) | pg_dump -> AES-GCM file -> read-back -> pg_restore into a separate scratch database; restored data checked and source retained. Scratch removed afterwards. |
| Real Drive upload/download | NOT_RUN | Requires real service account and Shared Drive. Local file read-back is not a cloud download. |
| Physical LAN installation | NOT_RUN | Second PC, firewall, reboot, scheduled backup and recovery-host rehearsal require operator verification. |

Browser evidence: work/screenshots/task-tree-desktop.png. Local command logs were retained outside
the repository under the operator's .codex directory (eh-complete-tests, eh-ready-browser,
eh-legacy-compat and final verification logs). Initial SQL-placeholder and browser-locator failures
were corrected and the relevant suites rerun successfully. Earlier records below remain historical.
Production remains **NOT APPROVED FOR PRODUCTION**.


## Member self-service, completion approval and Drive backup — 2026-11-03

Schema **8** (migration `0008_member_created_work`, additive). Employee contract 1.6, migrations
0001–0007, the V1 Apps Script project and the published contracts are unchanged.

| Gate | Result | Evidence |
| --- | --- | --- |
| `npm run typecheck` (all workspaces) | PASS | `tsc -p` clean for contracts, domain, db, i18n, api, web, worker, migration, benchmark |
| `npm run lint` (V1 + V2) | PASS | `eslint src dashboard-app shared scripts tests` and `eslint apps packages tools` clean |
| `npm test` | PASS | V1 **776 pass, 0 fail**; V2 **177 pass, 1 skipped** across 15 files (real PostgreSQL 18.6) |
| `npm run validate` | PASS | V1 source (42 manager files, 3 dashboard files, 970 keys), V2 governance (128 files), deployment templates |
| `npm run build` | PASS | `@eh/api`, `@eh/web`, `@eh/worker`, `@eh/migration` |
| `npm run smoke:prod` | PASS | built migration CLI applied schema 8 (including 0008), built API health/readiness/session/read/mutation, built worker outbox job, clean stop |
| `npm run test:browser` | PASS | Chromium: Japanese login, language switch, project create/edit, task create, list refresh, responsive layout, sign-out |
| Member task creation (API) | PASS | `api.test.ts` — ownership from the session, `Not Started`/0 %, visible in My Work and the manager list, idempotent replay, strict payload refusal, VIEWER/MANAGER/archived/cross-project refusal, active-project options only |
| Completion requests (API) | PASS | pending does not complete; MANAGER refused for a member-created task and the request stays `PENDING`; ADMIN approval completes; rejection leaves work unfinished; receipts isolated per member |
| Google Drive upload | PASS (mock) / NOT_RUN (live) | resumable chunk upload, resume after a lost chunk, permission and folder-type errors, no duplicate copy, local backup kept — `apps/worker/test/drive.test.ts`, `persistent-backup.test.ts`. Real service account, Shared Drive and live download are **NOT_RUN**. |
| Restore verification | PASS (logical + refusal) / NOT_RUN (client tools) | `backup.test.ts` logical round trip and production-target refusal; `pg_restore` from a downloaded file is **NOT_RUN** on a host without client tools |
| Physical Windows-host checks (firewall, second PC, reboot, scheduled backup) | NOT_RUN | requires the real host |

No live Google credential, Workspace tenant, Drive folder or deployment host was used.

## Local LAN update — 2026-11-02

[LOCAL_LAN.md](LOCAL_LAN.md) specifies the employee-ID/password mode, schema 7, optional email, first-login change, administrator reset, employee-owned progress editing, Windows launcher, durable local backup and optional Shared Drive upload. It supersedes Google-only or Linux-only assumptions below for this mode. [Verification record](LOCAL_LAN_ACCEPTANCE.md).

## Update — 2026-11-01

See [RELEASE_HARDENING.md](RELEASE_HARDENING.md) for the current UI, concurrency, delivery, Calendar and performance changes and unresolved release blockers. The dated records below are historical; they do not establish complete feature parity or production approval.

Current local verification: typecheck and lint PASS; V1 regression PASS; V2 **142 passed, 1 skipped** across 12 files. The skipped test requires unavailable pg_dump client binaries. V1/V2/deployment-template validation PASS. Production build PASS; Chromium built-artifact workflow smoke PASS, including worker outbox processing. No live tenant or deployment host was tested. Fastify emits a disableRequestLogging deprecation warning; this remains a maintenance item before a major framework upgrade.


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
| `npm test` | PASS | V1: **776 pass, 0 fail**; V2: **128 pass, 0 fail** across 10 files (real PostgreSQL 18.6) |
| `npm run validate` | PASS | V1 source validation (42 manager files, 3 dashboard files, manifests, 970 keys), V2 governance (108 files) and deployment templates (`validate:deploy`) |
| `npm run build` | PASS | `@eh/api`, `@eh/web`, `@eh/worker`, `@eh/migration` |
| `npm run smoke:prod` | PASS | built migration CLI + built API: health, readiness, session fixture, authorized read, authorized mutation, clean stop |
| `npm run benchmark` | PASS (small dataset) | measured, recorded in [PERFORMANCE.md](./PERFORMANCE.md) and [STABILIZATION.md](./STABILIZATION.md) |
| `npm run migration -- …` on the fixture snapshot | PASS | see §5 |
| Container build / `docker compose config` / `caddy validate` | BLOCKED (local) | no container runtime on the review host; CI runs the compose and Caddy validation and the image build |

The detailed defect-by-defect record of the stabilization pass (fix locations, regression tests and
the remaining PARTIAL/BLOCKED items) is [STABILIZATION.md](./STABILIZATION.md). A passing build was
previously mistaken for a working artifact; that specific gap is now closed and proven by
`npm run smoke:prod`.

## 2. Product requirements

| Requirement | Status | Evidence |
| --- | --- | --- |
| Every V1 manager feature exists in V2 | PARTIAL | [FEATURE_PARITY.md](./FEATURE_PARITY.md) — the per-workflow audit is incomplete; see [STABILIZATION.md](./STABILIZATION.md) §7. A table or a domain function alone is not accepted as a feature. |
| Every V1 employee feature exists (list, filter, deadline request, completion report, submission states, switch) | PASS | `apps/web/src/screens/Overview.tsx`, `POST /api/employee/requests`, `api.test.ts` |
| Identifiers, enum values and Japanese terms unchanged | PASS | migration preserves IDs; `packages/domain` enums match V1; 廃止/再有効化 and 退職/復職 kept |
| Permission model preserved (ADMIN/MANAGER/MEMBER/VIEWER, no self-change, last admin) | PASS | `packages/domain/src/roles.ts` + `api.test.ts` role tests |
| Counting, progress, hierarchy, planning and request rules preserved | PASS | `packages/domain/test/domain.test.ts` (39 tests) |
| Data model complete in PostgreSQL | PASS | `packages/db/src/migrations/0001…0006`, `integration.test.ts` (19 tests) |
| V1 → V2 migration tool with dry run, reconciliation, preservation | PASS (fixture) | `tools/migration/test/migration.test.ts` (10 tests); every mapped table and the relationship tables are reconciled |
| Employee publication allowlist and privacy boundary | PASS | `packages/contracts/test/contracts.test.ts`, `api.test.ts` |
| Notifications gated, logged, deduplicated, uncertain never retried | PASS (transport doubles) | `apps/worker/src/jobs.ts`, `apps/worker/test/delivery.test.ts`, `domain.test.ts` policy tests |
| Crash-safe delivery attempts and worker leases | PASS | `packages/db/test/integration.test.ts` (lease ownership, attempt ownership, reconciliation, explicit retry) |
| Backups encrypted and restorable | PARTIAL | `apps/worker/test/backup.test.ts` (4 tests, logical path); `pg_dump`/`pg_restore` round trip and Drive upload/restore are NOT_RUN |
| Response time targets | PASS locally (small dataset) | [PERFORMANCE.md](./PERFORMANCE.md) and [STABILIZATION.md](./STABILIZATION.md) §6; office-LAN, remote and proxy measurements are NOT_RUN |
| Responsive, Japanese-first UI with the language switch | PASS | `apps/web`, `apps/web/test/ui.test.tsx` |
| Self-hosting and remote access configuration | PASS (templates) / BLOCKED (live) | `deploy/`, `npm run validate`; live TLS and tunnel are BLOCKED |
| Documentation complete | PASS | twelve `docs/v2` documents plus root README/README_JP/AGENTS/ARCHITECTURE/DATA_SCHEMA/DEPLOYMENT/BACKUP_RESTORE/CHANGELOG updates |

## 3. Security requirements

| Requirement | Status | Evidence |
| --- | --- | --- |
| Identity from a verified Google ID token, then a database role | PASS (local verification logic, dev fixture) | `apps/api/src/auth/auth.ts` verifies signature, issuer, audience, expiry, verified address and hosted domain; live Google exchange BLOCKED |
| Stable identity binding | PASS | `members.google_subject` (migration `0006`); a first verified sign-in links once with `IDENTITY_LINKED`, a different subject is refused (`api.test.ts`) |
| Authorization re-checked server-side on every entry point | PASS | `api.test.ts`: unauthenticated 401, MEMBER refused on a manager read, role change effective immediately |
| CSRF header and origin check on every mutation | PASS | `api.test.ts` |
| Revision-checked partial patch, `EDIT_CONFLICT` | PASS | `integration.test.ts`, `api.test.ts` |
| Idempotent create | PASS | `api.test.ts` (same key returns the first result) |
| No browser-supplied authority | PASS | request schemas reject actor/role/owner; `validate-v2` scans persistence keys |
| Container completion refused in domain, import and trigger | PASS | `domain.test.ts`, `integration.test.ts`, `api.test.ts` |
| Append-only audit and deadline history | PASS | `integration.test.ts` (trigger refusal) |
| Deletion limited to empty records with tombstone | PASS | `domain.test.ts` (preflight blockers incl. deadline/schedule history), `services/deletion.ts`; the target row is locked and re-evaluated inside the deleting transaction |
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

## Member self-rename correction — 2026-11-03

- PASS: targeted API/local-authentication suites, 36 tests, using isolated embedded PostgreSQL with REQUIRE_DATABASE=1 and external database URLs removed. The regression confirms a name-only self-edit preserves ADMIN, active state, manager and capacity, keeps the current session usable, and continues to refuse explicit self-demotion.
- PASS: ESLint for the three changed source/test files; npm run typecheck; npm run validate.
- NOT_RUN: updated browser flow on the live LAN host; no rebuild, restart or live database mutation performed.
- Earlier evidence remains historical. Production readiness remains NOT APPROVED FOR PRODUCTION.
