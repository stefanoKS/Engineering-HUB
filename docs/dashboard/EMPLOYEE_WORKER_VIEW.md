# Employee worker view and request receipts (V1.7)

This document describes the employee-facing behaviour added in V1.7. The employee app
(`dashboard-app/`) is still read-only apart from the single validated append to the separate request
inbox. It never reads the private management workbook.

## 1. 作業担当者別タスク / Tasks by Worker

`dashboardWorkerTasks(request)` returns a bounded, paginated list built **only** from the published
snapshot (contract 1.6 publishes `assigneeNames`).

| Filter | Field | Notes |
| --- | --- | --- |
| Worker | `worker` | Matches the primary owner *or* any additional assignee display name |
| Responsibility | `responsibilityId` | `__none__` selects projects without a responsibility |
| Project | `projectId` | |
| Status group | `group` | `open` (default), `completed`, `all` |
| Priority | `priority` | Stored enum value |
| Overdue only | `overdue` | `dueDate < today` and not `Done`/`Cancelled` |
| Due within | `dueWithin` | Days ahead; the UI sends 7 |
| Text | `query` | Task ID, task name, project name, subproject name |

Ordering is deterministic: overdue, then today, then the nearest deadline, then work without a
deadline; ties break on the task ID. The page size is capped at 100 (the UI uses 20).

A shared task appears once per matching worker filter, and **once** in `totals`, because the list is
built from published tasks and only filtered — the assignee list never multiplies a row.

### Identity limitation (must not be overstated)

The worker name is a **published display name**, not a verified identity. Selecting a name does not
prove who is using the dashboard, and two people who share a display name cannot be distinguished.
Contract 1.6 deliberately publishes no member identifier to make that separation possible, because a
stable public worker ID would be a new privacy surface. Any future individual contribution tracking
requires a separate, explicitly approved design.

## 2. Task status versus approval status

The published task carries `status`, `progress`, `pendingRequest`, `reviewState` and `completedAt`.
The worker view shows them separately:

- **Status** — the task's own `status` (`作業中 / In Progress` …).
- **Approval** — `完了承認待ち / Awaiting completion approval` when `reviewState = PENDING`,
  `再確認が必要 / Review required` when `STALE`, and `申請中` when only `pendingRequest` is true.

`pendingRequest` is a boolean and is never interpreted as a particular request type. A local receipt
(`受付完了`) describes the acknowledgement of *this browser's* submission; it never changes the
published task and is never shown as a task state.

A manager approval remains the only path to `Done`. A completion report is refused for a container
task (the existing `REQUEST_CONTAINER_TASK` rule), so a worker can never be invited to complete a task
whose progress is derived from its children.

## 3. Non-blocking submission

When Submit is pressed:

1. The form validates locally.
2. The drawer closes immediately and `送信中 / Sending` is shown.
3. The RPC continues in one central controller while the viewer navigates freely.
4. On a durable server acknowledgement the receipt becomes `受付完了 / Received` with the request ID.
5. On a rejected submission it becomes `送信失敗 / Failed` with the server's message.
6. On an ambiguous transport failure it becomes `送信結果不明 / Outcome unknown`.

This is an asynchronous browser interaction, not a server-side background job. If the browser closes
before the acknowledgement, the outcome cannot be known locally; on the next load the stored
`SENDING` receipt is reported as `OUTCOME_UNKNOWN` and is **never** silently retried.

### What is stored in the browser

Only receipt metadata: attempt ID, request type, task ID, task display name, submission time,
transport state, request ID and the last server status. Explanation text, completion notes, requester
names and any manager data are **never** persisted. `localStorage` keeps at most 20 records under
`eh.submissions`; the manager application never uses browser storage.

### Duplicate protection

The inbox keeps its existing 15-column contract. A retry reuses the same browser token, so the
existing duplicate guard returns the original request ID instead of creating a second row, and the
per-browser rate limit still applies. Two genuinely different deadline requests (different requested
dates) remain possible within the window.

## 4. Receipt states

| Transport state | Meaning |
| --- | --- |
| `LOCAL_PENDING` | Validated, not yet sent (transient) |
| `SENDING` | The RPC is in flight |
| `RECEIVED` | The inbox stored the row; `requestId` is authoritative |
| `FAILED` | The server refused it; the message is shown |
| `OUTCOME_UNKNOWN` | The browser could not observe the result |

Server request states (`RECEIVED`, `PENDING`, `PROCESSING`, `APPROVED`, `REJECTED`, `RETURNED`,
`STALE`) are shown through the existing dictionary. Inbox `RECEIVED` is never presented as a manager
approval.
