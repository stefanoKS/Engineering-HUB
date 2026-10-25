# V1.3.1 Gate 3 — Simplifying worker request handling

Scope: automatic import when the manager opens the approval queue, concurrency and
idempotency, and behaviour when the inbox is unavailable.

## Result

Result: **PASS** (local) — live Google Workspace verification: **UNVERIFIED**

| Check | Result | Evidence |
| --- | --- | --- |
| Opening 申請一覧 imports new inbox rows before showing the queue | PASS | `Ui.requests()` → `Requests.importInbox()`; tests "opening the request queue imports new inbox rows and is idempotent" and the sidebar harness test |
| 申請を取り込む / *Import requests* remains as a manual fallback | PASS | `#import` button → `uiImportRequests`; unchanged |
| No new background trigger | PASS | No trigger code changed; `docs/checkgates` and `src/Triggers.gs` untouched |
| No automatic approval | PASS | Import only inserts `PENDING` rows; only `Requests.decide` changes a task |
| The request workflow order is unchanged | PASS | `docs/DEADLINE_REQUEST_WORKFLOW.md` §2–§5 unchanged apart from the import trigger |
| Any employee may request a change for any published task | PASS | `dashboard-app/RequestService.gs` unchanged; no owner-match check |
| Requester name stays self-reported; no login or password | PASS | test "no login, password or browser write path was introduced" |
| Two managers opening the queue cannot duplicate a request | PASS | `Requests.importInbox` runs inside `Database.withLock`; duplicate-ID collision counted as `skipped`; test "a concurrent import collision is counted as skipped, not as a failure" |
| Import is idempotent | PASS | Inbox `Request_ID` is the permanent key; second open reports `imported: 0, skipped: 1` |
| An unavailable inbox does not crash the UI | PASS | `Ui.requests` catches the import error; test "an unavailable inbox is reported and the stored queue stays readable" and the sidebar harness test |
| Previously imported requests stay visible | PASS | Same tests assert `data.requests.length === 1` after a broken header |
| The UI never claims a failed import succeeded | PASS | `importError` is rendered as `申請を取り込めませんでした: …`; `importRequests()` returns the error instead of `imported` counts |
| Request statuses remain `PENDING / PROCESSING / APPROVED / REJECTED / RETURNED / STALE` | PASS | `Schema` enum unchanged |
| An extension never changes the deadline before approval | PASS | Test asserts `TASKS.Due_Date` unchanged after the import |
| Completion reports stay pending until acceptance | PASS | Existing `tests/v1_3-requests.test.js` suite |
| Duplicate decisions and deadline history are preserved | PASS | Existing `tests/v1_3-requests.test.js` suite |
| No unnecessary scheduled job added | PASS | No change in `src/Triggers.gs` or `AutomationSettings` defaults |

## Evidence

* `npm test` — includes `tests/v1_3-requests.test.js` (16) plus the V1.3.1 import tests.
* `npm run lint` / `npm run validate` — clean.

## Notes and limits

The import and the queue read are two steps; a request appended between them appears on the
next render, which is why the manual button stays. Local lock behaviour is mocked: real
`LockService` contention has not been observed in a live Workspace.
