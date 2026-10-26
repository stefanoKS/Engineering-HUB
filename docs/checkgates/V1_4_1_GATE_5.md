# V1.4.1 gate 5 — shared dashboard, requests and reliability

Status: **PASS (local only)** — live publication and delivery remain UNVERIFIED.

Scope: `src/SharedDashboardModel.gs`, `src/SharedDashboardPublisher.gs`,
`dashboard-app/DataService.gs`, `dashboard-app/RequestService.gs`, `src/Requests.gs`.

## Dashboard contract 1.4

Unchanged by this release: `dashboard-app/DataService.gs` and `src/SharedDashboardModel.gs` still
agree on `1.4` and on every public field list (`tests/v1_4-release.test.js` → "the publisher and
the viewer agree on contract 1.4").

| Check | Evidence |
| --- | --- |
| Only `Dashboard_Visibility = INTERNAL` projects are published | `tests/v1_2-model.test.js`, `tests/v1_2-publisher.test.js` |
| A/B slots, header/row-count/hash verification and commit-by-meta-write | `tests/v1_2-publisher.test.js` |
| A failed publication leaves the previous snapshot readable | `tests/v1_2-publisher.test.js` |
| An older contract is rejected, never read as 1.4 | `tests/v1_4-hierarchy.test.js` |
| No description, owner, e-mail, note or audit data reaches the snapshot | `tests/v1_4-hierarchy.test.js` → "the snapshot never publishes a responsibility description or owner" |
| Each nested task appears exactly once in the viewer | "a published snapshot counts only active work and never duplicates a nested task" |
| Active-work counts exclude a task beneath an archived subproject | same test |
| A retired responsibility stays filterable and keeps its published projects | `tests/v1_4-ui.test.js` (（廃止）label), `tests/v1_2-dashboard.test.js` |

The publisher version string is now `1.4.1`; the contract version stays `1.4`, so a V1.4 viewer
continues to read the snapshot.

## Requests

| Check | Evidence |
| --- | --- |
| A repeated import never duplicates a request | `tests/v1_4_1-stabilization.test.js` → "an approved request applies its deadline once and records one history row" |
| Approval applies the deadline once and records one history row | same test |
| A second decision is refused (`already decided`) | same test |
| A stale request never overwrites a newer deadline | `tests/v1_3-requests.test.js` → "a request submitted before a newer change becomes STALE…" |
| Rejection/return never change the deadline or write history | `tests/v1_3-requests.test.js` |
| `REQUEST_SUBMISSION_ENABLED` disabled/failure states fail closed | `tests/v1_3-requests.test.js`, `tests/v1_4-ui.test.js` |
| A language switch keeps the draft and never auto-submits | `tests/v1_4-ui.test.js` |

## Reliability

- `Ui.updateProject` performs one validated write (see gate 2), so a failure cannot leave a
  partially applied project edit.
- `Responsibilities.reorder` validates the batch before `Database.updateMany` writes it.
- No new retry loop was introduced; no non-idempotent write is retried automatically.
- The scheduled backup no longer depends on an interactive identity: `scheduledDailyBackup`
  calls `Database.withLock(Backup.create)` directly while `createDatabaseBackup()` stays
  ADMIN-only.

## Not verified here

Real publication to a Workspace snapshot, the deployment ACL, and live mail/Calendar delivery.
