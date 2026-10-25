# V1.3 Gate 3 — Employee request interface

Scope: deadline-change and completion-report submission from the shared dashboard into the
separate request inbox.

## Result

Result: **PASS** (local) — live Google Workspace verification: **UNVERIFIED**

| Check | Result | Evidence |
| --- | --- | --- |
| Any internal worker can request a change for another worker's task | PASS | `DashboardRequests.submitDeadlineRequest` performs no owner comparison; `tests/v1_3-requests.test.js` submits as a non-owner |
| No owner-match requirement exists | PASS | same test asserts the request is accepted and stored |
| No login/password UI is introduced | PASS | no credential form in either project; `tests/v1_3-release.test.js` greps for password/auth input patterns |
| Workers have no write access to the private workbook | PASS | `npm run validate` proves `RequestService.gs` only opens the inbox property and only appends rows |
| Restricted tasks cannot receive requests | PASS | submission resolves the task in the active published snapshot; a restricted project never appears there |
| Invalid requests are rejected | PASS | date format, unchanged date, reason enum, length limits, unexpected fields, unknown task |
| Duplicate submissions are controlled | PASS | 24-hour duplicate guard; a same-token retry returns the original request ID |
| Rate limiting | PASS | 5 submissions per browser token per hour through `CacheService` |
| Serialized writes | PASS | `LockService.getScriptLock()` around read-check-append |
| Existing dashboard browsing remains functional | PASS | existing `tests/v1_2-dashboard.test.js` suites still pass |
| Receipt with a permanent request ID | PASS | `REQ-<timestamp>-<random>` returned and re-queryable via `requestSubmissionStatus` |

## Evidence

* `node --test tests/v1_3-requests.test.js`
* `npm run validate` — dashboard manifest scopes are exactly `spreadsheets` + `userinfo.email`; the web app stays `access: DOMAIN` and `executeAs: USER_DEPLOYING`.
* Inbox header contract is asserted in both applications.

## Notes and limits

Requester identity is self-reported and unverified by design. The dashboard deployment must
remain domain-restricted; anonymous access would allow arbitrary appends. Live submission,
scope re-authorisation and inbox creation are UNVERIFIED until recorded by an operator.
