# V2 release hardening — 2026-11-01

**NOT APPROVED FOR PRODUCTION.** Local implementation on top of ec54c78289d184a8d2aa0c4175354a0c56450579. No deployment, production migration, live mail or Google resource changes were performed. This record supersedes the October 31 findings only for the changes described below.

## Implemented

- Refreshed indigo/teal interface, clear navigation and focus states, responsive tables, reusable accessible color swatches, and code-split screens. Japanese remains the default. Project colors remain stable.
- Direct project editing, subproject create/edit, and task creation from project detail. Searchable, paginated project selection removes the first-100-project selector limitation. Parent task choices respect project/subproject scope.
- Editor generation guards reject stale detail responses after another editor opens or closes. Employee request drafts survive rejected/unknown results, retries preserve their request identity, and duplicate in-flight submissions are blocked.
- Request queues have validated server pagination with a consistent count/page snapshot. Explicit includeDecided=false now means false.
- Administrator role/activation mutations serialize and revalidate the actor to prevent concurrent demotions from removing every administrator.
- Logical backups read all tables from one repeatable-read snapshot. pg_dump passwords are removed from command arguments; pg_restore stops on error and runs in one transaction. Missing client binaries are reported as a skipped test.
- Notification recipient caps resume at eligible recipients instead of repeatedly visiting completed deliveries. Pending request reminders have their own daily producer and delivery-time status check. Weekly reports use canonical scope and a Monday-based deduplication bucket.
- Calendar scanning includes tasks and milestones. Deterministic event identities, ownership checks, conditional updates and exclusive all-day end dates protect retries. Missing or foreign linked events fail safely. Google calls are tested with mocks, not a live tenant.
- Workload computation indexes tasks by assigned member, subtracts actual hours, and deduplicates primary/additional ownership. Actual hours are cumulative task effort for overlapping weeks, not a timesheet attribution; multi-week tasks still contribute their remaining effort to each overlapping week. *(Superseded 2026-11-04 by the date-based workload report: task counts per selected period, no hour or utilisation figure. See [ACCEPTANCE.md](ACCEPTANCE.md) and [API.md](API.md).)*

## Local evidence

Final verification results are recorded in ACCEPTANCE.md. Chromium smoke exercises built artifacts and isolated PostgreSQL: Japanese login, English switch, project create/edit, subproject creation, task creation, list refresh, desktop/mobile layout and sign-out. The same harness starts the built worker and verifies an outbox job completes. Unit tests cover editor races and uncertain request outcomes; these failure paths are not yet full browser/network fault tests.

Benchmark: 1,000 projects, 10,000 tasks, 120 members, 30 samples per endpoint, concurrency 5. Windows, Ryzen 7 5700X, embedded PostgreSQL 18.6; in-process Fastify injection, without TLS/network. Results are observations, not service-level guarantees.

| Endpoint | p95 ms |
| --- | ---: |
| Task create | 55.43 |
| Task list | 28.74 |
| Task detail | 17.59 |
| Project list | 180.14 |
| Overview | 276.28 |
| Workload | 205.84 |
| Request queue | 3.85 |
| Employee snapshot | 283.06 |

Workload p95 was 964.98 ms before the indexing change under the same benchmark configuration. Raw results: [before](bench/results-2026-11-01T08-28-34-391Z.json), [after](bench/results-2026-11-01T08-29-31-770Z.json). End-to-end submillisecond responses are not a realistic browser/network requirement. Measure office and remote p95 under expected load before setting a production target.

## Remaining release blockers

1. Complete reachable-workflow parity: member own-task updates, milestone editing, and phase-planning application remain incomplete or unverified. Historical PASS rows for domain functions do not prove complete UI workflows.
2. Run deployment containers, HTTPS/OAuth login, role checks and remote access on the intended host. Docker is unavailable on this review PC.
3. Perform encrypted pg_dump/pg_restore recovery into a separate database on the deployment host, verify records and application behavior, and retain the recovery key independently. The logical archive test is not a replacement for this drill.
4. Verify Google Calendar ownership/retry behavior, mail recipient policy and Drive backup/recovery in an approved test tenant. Keep automation off until those checks pass.
5. Reconcile an approved real-data migration, validate rollback, assign an operator, and test office/remote latency and expected concurrent use.
6. Scope-loading helpers still cap some aggregate queries (2,000 projects / 20,000 tasks). Larger datasets require complete SQL aggregation or explicit truncation reporting; the 10,000-task benchmark does not certify larger datasets. The employee snapshot is about 808 KB at this scale and needs further payload/paging work if office tests show slow downloads.

## Compatibility and operations

No database migration was added or existing migration rewritten. V1 source is untouched. Request queue responses add page, pageSize and totalPages; callers can pass page/pageSize and includeDecided. References include projectId. Coordinate rollout of web/API artifacts. Existing project/task IDs and database records are retained.

Calendar identity is scoped by APP_ENV, entity type and ID. Changing the environment or destination requires reviewed reconciliation. A missing/foreign stored event is an operator investigation, not permission to clear links blindly. The hourly calendar scan may enqueue changes only when Calendar sync is enabled. Pending reminders likewise require their own switch and existing notification eligibility gates.

Review screenshots are generated under ignored work/screenshots by npm run test:browser. They contain synthetic fixture data.
