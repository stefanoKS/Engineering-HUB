# V1.7 GATE 4 — Employee worker view and non-blocking submission

| Field | Value |
| --- | --- |
| Release | V1.7 |
| Scope | `dashboard-app/DataService.gs`, `dashboard-app/App.gs`, `dashboard-app/Client.html`, `dashboard-app/Index.html`, `dashboard-app/Styles.html` |
| Result | **PASS (local)**; real Workspace browser behaviour **BLOCKED / NOT_RUN** |

## Worker view

`dashboardWorkerTasks(request)` reads only the published snapshot, filters by worker (primary *or*
additional), responsibility, project, status group, priority, overdue, due-within-N-days and free
text, sorts overdue → today → upcoming → no deadline, and returns a bounded page (limit ≤ 100).

A shared task appears once per matching worker filter and once in `totals`, because the count comes
from a single filtered pass over published tasks. A worker name is a display filter, not
authentication; the limitation is published in the UI and in
[docs/dashboard/EMPLOYEE_WORKER_VIEW.md](../dashboard/EMPLOYEE_WORKER_VIEW.md).

## Non-blocking submission

The form closes immediately, `送信中 / Sending` is shown, and the central controller resolves to
`受付完了 / Received`, `送信失敗 / Failed` or `送信結果不明 / Outcome unknown`. Only receipt metadata
is persisted (`eh.submissions`, at most 20 records); request text is never stored. A stored `SENDING`
record becomes `OUTCOME_UNKNOWN` on the next load and is never retried automatically. A retry reuses
the same browser token, so the existing duplicate guard returns the original request ID.

## Evidence

`tests/v1_7-ui.test.js` — 7 tests, 7 pass:

| Test | Result |
| --- | --- |
| `the Members page shows Position next to department and system role` | PASS |
| `permanent deletion asks once with Yes/No and never asks for a typed code` | PASS |
| `the task editor offers an additional-assignee multi-select without the primary owner` | PASS |
| `the worker view lists a shared task with every assignee and filters by worker` | PASS |
| `submitting a request closes the form immediately and reports 受付完了 only after the acknowledgement` | PASS |
| `a failed submission is reported as a failure and never as success` | PASS |
| `an interrupted send is reported as an unknown outcome and is never silently retried` | PASS |

Server-side worker query (in `tests/v1_7-multi-assignee.test.js`):

| Test | Result |
| --- | --- |
| `a shared task appears under every assignee and is counted once` | PASS |
| `the worker query honours the status group, deadline window and pagination bounds` | PASS |

Existing employee behaviour is unchanged: `npm test` reports **592 tests, 592 pass**.

## Live items that remain BLOCKED

- Real browser behaviour on a Workspace-hosted deployment (drawer close, toast timing, `localStorage`
  availability, deployment ACL). **NOT_RUN.**
- A real inbox round trip proving the retry returns the original request ID. **NOT_RUN.**
