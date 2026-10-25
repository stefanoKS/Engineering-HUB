# V1.3 Gate 4 — Manager approval and deadline history

Scope: import, queue, decision, stale detection, history and audit.

## Result

Result: **PASS** (local) — live Google Workspace verification: **UNVERIFIED**

| Check | Result | Evidence |
| --- | --- | --- |
| Request appears in the manager queue | PASS | `Requests.queue()`; UI in `src/UiRequests.html` |
| Approval applies the requested date exactly once | PASS | `PROCESSING` claim + `alreadyApplied` guard; `tests/v1_3-requests.test.js` approves twice and asserts a single change |
| Rejection leaves the deadline unchanged | PASS | rejection writes only request status/reviewer/note |
| Stale requests cannot overwrite newer changes | PASS | revision and previous-deadline comparison mark the request `STALE` |
| Derived start recalculates after an approved change | PASS | `Tasks.update` → `Planning.applyTaskPlan` |
| Original project deadline remains intact | PASS | no project write path exists in the decision |
| Every decision is audited | PASS | `REQUEST_DECIDED`, `REQUEST_STALE`, `REQUEST_IMPORTED` audit rows |
| Partial-processing recovery is tested | PASS | interrupted `PROCESSING` request re-finalises without a second effect |
| Deadline history preserved | PASS | `TASK_DEADLINE_HISTORY` row with previous/new deadline and start |
| Only authorized managers decide | PASS | `Roles.requireAtLeast('MANAGER')` plus the explicit `DECIDE REQUEST` confirmation |
| Idempotent import | PASS | import keyed on the permanent request ID |

## Evidence

* `node --test tests/v1_3-requests.test.js`
* Sidebar **申請一覧 / 承認待ち** calls only validated domain functions (`uiRequests`,
  `uiImportRequests`, `uiDecideRequest`) with server-side role checks.
* Inbox state is mirrored on the decision so the worker receipt reflects it.

## Notes and limits

`STALE` is a terminal reviewer signal: the manager must re-read the task and decide again.
A pending request never changes the deadline and never hides an overdue indicator.
Live behaviour (real inbox rows, real manager identity) is UNVERIFIED locally.
