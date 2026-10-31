# Performance

All numbers below were **measured locally** with the repository's own harness. They are not
evidence about a production deployment, and `docs/PRODUCTION_READINESS.md` stays **NOT APPROVED
FOR PRODUCTION**.

## 1. Targets and result

| Target (stated) | Target | Measured (10 000 tasks) | Status |
| --- | --- | --- | --- |
| Manager read endpoint, warm p95 | ≤ 300 ms | worst 227 ms (workload), overview 64 ms | PASS |
| Manager list page p95 (50 rows) | ≤ 300 ms | 23–56 ms | PASS |
| Task detail p95 | ≤ 200 ms | 5 ms | PASS |
| Manager write p95 | ≤ 400 ms | 28 ms | PASS |
| Employee snapshot p95 | ≤ 500 ms | 198 ms | PASS |
| Employee snapshot payload | ≤ 1 MB | 808 KB | PASS |
| Database calls per read (no per-row read) | bounded, ≤ 10 | 1–9 | PASS |
| Cold first request (process/page cache cold) | ≤ 500 ms | 187 ms | PASS |

## 2. Method

```
npm run benchmark                    # all three datasets, 15 samples per endpoint
npm run benchmark -- --dataset large --iterations 30
```

* Harness: `tools/benchmark` — starts the embedded PostgreSQL 18.6 server, applies the real
  migrations, seeds a deterministic dataset through the real schema (triggers included), then
  calls the **real** Fastify routes with `app.inject`.
* Transport: in-process HTTP injection. No TLS, no reverse proxy, no network — a real deployment
  adds the proxy hop and the client RTT, so treat these as server-side processing times.
* Each endpoint: one cold sample (first request on a fresh app and connection pool) then N warm
  samples. `coldMs` is that first request; `p50/p95/p99` come from the warm samples. With 15
  samples the p95/p99 columns collapse toward the maximum, so read `p50` and `max` as the honest
  pair; use `--iterations 50` for tighter tails.
* `db calls` is the API's own per-request counter (`meta.dbCalls`), i.e. queries, not rows.
* `bytes` is the response body size, with compression **off** (injection measures the payload the
  server produces; `@fastify/compress` applies on a real socket).
* Nothing measured identifies a record: only timings, counts and sizes are recorded, and the
  result file contains no spreadsheet ID, e-mail address or cell value.

### Dataset shapes (`tools/benchmark/src/seed.ts`)

| Dataset | Members | Responsibilities | Projects | Tasks | Open requests | Task assignees |
| --- | --- | --- | --- | --- | --- | --- |
| small | 20 | 8 | 20 | 200 | 10 | 40 |
| medium | 50 | 8 | 200 | 2 000 | 100 | 400 |
| large | 120 | 8 | 1 000 | 10 000 | 500 | 2 000 |

Status mix per task: `Done` every 7th, `In Progress` every 5th, `Blocked` every 11th, otherwise
`Not Started`; owners rotate across members; every project is `Active` and `INTERNAL`.

### Environment

| Item | Value |
| --- | --- |
| CPU | AMD Ryzen 7 5700X (8 cores / 16 threads) |
| Memory | 15.9 GB |
| OS | Windows 11 (10.0.22000) |
| Node.js | v24.21.0 |
| PostgreSQL | 18.6, embedded test binaries, `fsync=on`, `synchronous_commit=on`, Asia/Tokyo |
| Date | 2026-10-30 |

## 3. Large dataset, measured

| Endpoint | p50 ms | p95 ms | max ms | cold ms | DB calls | Response bytes |
| --- | --- | --- | --- | --- | --- | --- |
| GET /api/manager/overview | 54.75 | 63.81 | 63.81 | 187.16 | 9 | 43 064 |
| GET /api/manager/projects (50) | 34.21 | 56.26 | 56.26 | 31.92 | 9 | 20 462 |
| GET /api/manager/tasks (50) | 20.92 | 23.20 | 23.20 | 20.97 | 2 | 24 872 |
| GET /api/manager/tasks/:id | 2.77 | 4.95 | 4.95 | 4.57 | 5 | 1 224 |
| GET /api/manager/references | 8.25 | 47.33 | 47.33 | 11.54 | 6 | 10 551 |
| GET /api/manager/requests | 4.37 | 16.04 | 16.04 | 4.62 | 1 | 290 237 |
| GET /api/manager/reports/workload | 199.28 | 227.39 | 227.39 | 219.89 | 5 | 106 602 |
| GET /api/manager/status | 1.96 | 2.71 | 2.71 | 5.50 | 4 | 646 |
| GET /api/employee/snapshot | 181.80 | 197.72 | 197.72 | 181.37 | 2 | 808 311 |
| POST /api/manager/tasks | 11.44 | 27.54 | 27.54 | 18.15 | 9 | 913 |

## 4. Growth trend (same endpoints, three sizes)

| Endpoint | p50 small | p50 medium | p50 large | Trend |
| --- | --- | --- | --- | --- |
| overview | 4.93 | 21.22 | 54.75 | grows with open work (scope aggregate) |
| projects page | 3.32 | 11.02 | 34.21 | grows with project count (count + page) |
| tasks page | 3.25 | 6.81 | 20.92 | bounded page, grows with filter scan |
| task detail | 2.40 | 3.13 | 2.77 | flat (indexed by ID) |
| workload | 2.89 | 24.30 | 199.28 | grows with 4-week work volume |
| employee snapshot | 4.88 | 33.95 | 181.80 | grows with published rows |
| task create | 3.25 | 5.39 | 11.44 | grows with reference validation |

Interpretation: point reads are flat; list endpoints are bounded by the page size and cost a
constant number of queries; the three endpoints that aggregate the whole active scope
(overview, workload, employee snapshot) scale with the volume of open/published work. At 10 000
tasks they remain inside the stated targets, but they are the first candidates for a cached
aggregate if the dataset grows by an order of magnitude.

## 5. Why the numbers hold

* **One range read per table per execution** (`Database.withReadContext` / `Database.memo`), so a
  page never performs a query per row: 1–9 queries per request in the table above.
* **Bounded pages**: 100 rows maximum, project index 500, task index 2 000, search 50.
* **Server-side scope**: filtering, counting and the top-N cut happen in SQL, before paging, so
  the browser never receives a truncated list it silently filters.
* **No Sheets call on a read path**: the API never contacts Google; only the worker does, from an
  outbox job.
* **Compact index** for navigation: one query instead of one per project.
* **Response compression** is enabled on real connections (threshold 1 KB), so the 808 KB JSON
  snapshot is materially smaller over TLS.

## 6. Known costs and limits

1. The workload report and the employee snapshot are O(open work); above roughly 50 000 open
   tasks expect them to leave the target range without an aggregate cache.
2. `GET /api/manager/requests` transfers up to 500 request rows (290 KB at the large dataset)
   because the queue is not paginated. Paginate it if the queue routinely exceeds a few hundred
   rows.
3. These measurements exclude TLS, the reverse proxy, real network RTT and a shared host. Add
   them before quoting a user-visible latency.
4. `pg_dump`-based backup timing and restore timing (RTO) are **NOT_RUN** locally: the embedded
   PostgreSQL distribution ships no client tools.
5. Google Workspace call latency (Gmail, Calendar, Drive, Sheets) is **NOT_RUN** live; only the
   local transport doubles were exercised.
6. No load test with concurrent users was performed. The API is stateless and the pool is
   bounded (`PG_POOL_MAX`, default 10 per instance), so concurrency behaviour on a 2 vCPU host
   remains to be measured with a real client.

Raw results: `docs/v2/bench/results-<timestamp>.json` (written by the harness).
