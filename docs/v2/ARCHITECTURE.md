# V2 Architecture

Status: implemented locally. Live Workspace verification is **NOT RUN** (see
[ACCEPTANCE.md](./ACCEPTANCE.md)).

## 1. Decision summary

| Decision | Choice | Why |
| --- | --- | --- |
| Repository shape | TypeScript monorepo, npm workspaces | One language across API, worker, web and migration tooling; shared contracts prevent drift |
| Authoritative store | PostgreSQL 18 | Transactions, constraints, row locks, `FOR UPDATE SKIP LOCKED`, recursive queries |
| Database access | Plain SQL through `pg` and explicit repository modules | Every statement is inspectable and reviewable; no ORM-generated schema |
| Migrations | Ordered `.sql` files + checksummed runner with an advisory lock | Additive, reviewable, fail-closed on a changed applied file |
| API | Fastify 5, JSON envelope, zod validation | Small surface, structured errors, strict bodies |
| Web | React 19 + Vite 8 | In-memory snapshot, targeted invalidation, no browser persistence of private data |
| Background work | Worker process + PostgreSQL outbox table | No Redis/broker; a crashed worker's lease is reclaimed |
| Email / Calendar / Drive / Sheets | Google REST APIs through adapter interfaces | Testable doubles; nothing external runs in automated tests |
| Remote access | Company VPN **or** Cloudflare Tunnel + Access | Two documented paths; no automatic DNS or tunnel creation |

V1 (Google Apps Script + Sheets) remains in the repository unchanged as historical evidence and
for the migration source. Its gates and benchmark records are historical and are never rewritten.

## 2. Runtime topology

```
Browser (React SPA)
   │  HTTPS, same-origin cookies, CSRF header
   ▼
Reverse proxy (Caddy) ── optional external path: Cloudflare Tunnel + Access
   │
   ├── apps/api   Fastify: sessions, authorization, reads, commands
   │        │
   ├── apps/worker  outbox loop: mail, calendar, backup, export, publication
   │        │
   ▼        ▼
PostgreSQL 18 (authoritative)  ── hourly pg_dump ──► AES-256-GCM ──► Google Drive
                               └─ one-way reporting export ─────────► Google Sheets
```

The interactive application performs ordinary reads, creates, edits, approvals, navigation and
permission checks against PostgreSQL and never calls Apps Script or Sheets.

## 3. Packages

| Path | Responsibility |
| --- | --- |
| `packages/domain` | Pure business rules: hierarchy, eligibility, counting, progress, planning, requests, completion, notifications, publication allowlist, project colours |
| `packages/contracts` | zod schemas for enums, DTOs, screens, mutations and the published contract |
| `packages/db` | Pool, per-request context, migration runner, row map, repositories, demo seed |
| `packages/i18n` | Dictionary generated from the V1 translation source (970 keys, ja/en parity) |
| `apps/api` | Fastify application, session/CSRF, routes, services, developer-only fixtures |
| `apps/worker` | Outbox loop, transports, backup/restore helpers, scheduler |
| `apps/web` | React screens, query cache, localization, project accents |
| `tools/migration` | Inventory, export, dry run, import, reconciliation |
| `deploy` | Docker Compose, Caddy, cloudflared example, operations scripts |
| `docs/v2` | Architecture, API, migration, security, performance, Workspace, self-hosting, remote access, backup, operations, acceptance, feature parity |

## 4. Request lifecycle

1. `onRequest` assigns a correlation ID and a **per-request** database context (its own query
   counter), so `meta.dbCalls` describes this request only.
2. `preHandler` resolves the session cookie (stored as a SHA-256 hash), loads the member row and
   builds the verified identity. A mutation additionally requires the session CSRF token and,
   when a browser sends `Origin`, an allowed origin.
3. The route validates the body/query with zod (strict objects), calls a service, and returns
   `{ ok: true, data, meta }` or `{ ok: false, error: { code, message, details, retryable,
   correlationId } }`.
4. Authorization is re-checked in the service (`requireRole`). A browser-supplied role, actor or
   owner is never authority; strict schemas reject such fields outright.

## 5. Transaction and concurrency model

* One logical operation is one transaction: record change + relationship change + approval
  invalidation + history + audit + outbox row commit together.
* Revision-checked updates: `UPDATE … WHERE id = $1 AND revision = $2` and no row means
  `EDIT_CONFLICT`; the browser keeps the draft.
* `SELECT … FOR UPDATE` serializes two decisions on the same request.
* Cross-record invariants are enforced twice: in the domain layer before the write and by
  PostgreSQL triggers (`tasks_hierarchy_guard`, `eh_subproject_guard`, dependency cycle guard,
  container-completion guard) so a concurrent writer cannot slip a cycle in.
* Hierarchy reparenting takes a targeted advisory lock per aggregate, not one global lock.
* `FOR UPDATE SKIP LOCKED` on the outbox lets several workers run concurrently.

## 6. Read model and caching

* The browser keeps one authorized snapshot plus narrow page reads; it never persists private
  manager data (no `localStorage`/IndexedDB for manager state).
* The query cache deduplicates in-flight reads, serves cached data and revalidates in the
  background, and invalidates by prefix. Invalidation increments a generation, so a read started
  before a save cannot paint or be joined by the newer refresh.
* Mutations return the authoritative record; the screen invalidates the narrowest datasets
  (task list + task + project + aggregates) instead of reloading the whole snapshot.
* The API memoizes table reads for the lifetime of one request (`ReadCtx`), so assembling a
  screen does not re-read a table. There is no cross-user server cache of the private data.

## 7. Background processing

```
command ──► outbox_jobs (PENDING, dedupe_key) ──► worker claim (LEASE) ──► handler
                                                     │
                                     ┌───────────────┼───────────────┐
                                     ▼               ▼               ▼
                                  Gmail API      Calendar API     pg_dump + Drive
```

* Lease claim, bounded retries with backoff, permanent-failure and uncertain-outcome states.
* A notification's identity is what it announces (kind, task, recipient, deadline, assignment
  version), so a retry cannot send a second mail for the same event.
* An ambiguous provider outcome becomes `DELIVERY_UNCERTAIN` and is **never** retried
  automatically.
* The save path only enqueues; it never waits for Gmail, Calendar, Drive or Sheets.

## 8. Published employee projection

* One allowlist in `packages/domain/src/publication.ts` produces the only fields that leave the
  private database.
* Only projects whose `dashboard_visibility` is exactly `INTERNAL` are published.
* The snapshot is written into the inactive A/B slot, verified (header set, row count, SHA-256 of
  the canonical JSON) and committed by a single metadata write; a failed run leaves the previous
  snapshot readable.
* The employee reader never touches the management tables and never publishes request text; only
  a boolean pending indicator is included.

## 9. Versions

Application (`APP_VERSION` / `@eh/contracts`), database schema (`schema_migrations` max version),
API version, publisher version and published contract (`1.6`) are separate values and are reported
separately.

## 10. Deliberate non-goals

* No Kubernetes, no Redis, no message broker, no paid SaaS requirement.
* No workload-overlap validation, capacity blocking or automatic reassignment.
* No second bootstrap route, no browser write path outside the documented commands.
* No claim that a single office server is highly available.
