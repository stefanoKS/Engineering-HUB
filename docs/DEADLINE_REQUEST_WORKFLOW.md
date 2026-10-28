# Deadline change request workflow

Any employee who can open the shared dashboard may request a deadline change for **any
published task**, and may report that a task is finished. Neither action changes the
authoritative task: only a manager decision does.

## 1. Who can request what

| Action | Who | Constraint |
| --- | --- | --- |
| Request a deadline change | any viewer of the internal dashboard | the task must be in the current published snapshot; the requester is *not* required to be the owner |
| Report completion | any viewer of the internal dashboard | same rule |
| Approve / reject / return | `MANAGER` or `ADMIN`, verified server-side | no browser-supplied role is trusted |

No login page, password, personal token or employee account is introduced. The requester
name is **unverified self-reported information** and is stored and displayed as such
(`申請者名（自己申告）`).

## 2. Submission (dashboard application)

Server function: `submitDeadlineRequest(payload)` / `submitCompletionReport(payload)`
(`dashboard-app/RequestService.gs`).

Validation at submission:

1. The viewer passes the domain-restricted deployment check.
2. Request submission must be configured (`REQUEST_INBOX_SPREADSHEET_ID`) and enabled.
3. Only the documented payload keys are accepted; anything else is refused.
4. The task ID must resolve in the **active published snapshot** — a restricted or unknown
   task can never receive a request.
5. The requested date must be a valid `yyyy-MM-dd` and must differ from the current
   deadline (earlier or later are both allowed).
6. The reason must be one of the six canonical values; text fields are length-limited.
7. The requester/reporter name is mandatory (≤ 120 characters).
8. A rate limit (5 submissions per browser token per hour) and a 24-hour duplicate guard
   apply. A retry from the same browser token returns the original request ID instead of
   creating a second request.
9. The row is appended under the script lock to the **separate request inbox** workbook.

The dashboard never receives the private workbook ID and has no update or delete path.

The user receives a permanent request ID (`REQ-<timestamp>-<random>`), the receipt text and
the current request state. The same ID can be looked up later with
`requestSubmissionStatus(requestId)`.

## 3. Request status values

| Status | Meaning |
| --- | --- |
| `PENDING` | imported, waiting for a manager |
| `PROCESSING` | a decision is being applied (recovery marker) |
| `APPROVED` | approved and applied |
| `REJECTED` | rejected; the deadline is unchanged |
| `RETURNED` | sent back for more information; the deadline is unchanged |
| `STALE` | the task changed after submission; re-review required |
| `WITHDRAWN` | reserved for a future withdrawal flow |

A pending or rejected request **never** changes `Due_Date`, and a pending request never
removes the overdue indicator on the dashboard.

## 4. Manager decision

Server function: `Requests.decide(requestId, action, note, 'DECIDE REQUEST')`.

New rows reach the manager application when the queue is opened: `Ui.requests()` calls
`Requests.importInbox()` before it lists the queue. The import runs inside
`Database.withLock`, so two managers opening **申請一覧** at the same moment cannot both claim
the same inbox row, and the inbox `Request_ID` is the permanent key. A failed import is
reported as a warning while the already imported requests stay visible; the manual
**申請を取り込む** button (`importRequestInbox()`) retries it.

Before applying an approval the manager application:

1. re-reads the task,
2. revalidates the project and task identifiers,
3. refuses a request that is already decided,
4. compares the task revision captured at submission with the current revision
   (owner + deadline + assignment version, published as an opaque hash),
5. compares the deadline at submission with the current deadline,
6. validates the requested date,
7. then applies the decision with an audit record.

If the task was reassigned or its deadline changed after submission, the request becomes
`STALE` and nothing is overwritten. The manager decides again.

### Approval effects (deadline change)

* `TASKS.Due_Date` is set to the requested date.
* `Planned_Start` is recalculated when a duration is known.
* The previous deadline and start are written to `TASK_DEADLINE_HISTORY`.
* `Assignment_Version` is incremented and `Assignment_Approved_At` cleared by the normal
  task rules, so a stale assignment approval can never notify.
* The active schedule confirmation is invalidated.
* The project committed deadline is **not** touched.

### Approval effects (completion report)

* `TASKS.Status = Done` and `Progress_Percent = 100`.
* `TASK_REQUESTS.Reported_Completion_At` keeps the worker-reported time;
  `Accepted_Completion_At` records the manager acceptance time. They are always distinct.

### Rejection and return

Neither writes to the task. Only status, reviewer, decision time and note are recorded.

## 5. Idempotency and recovery

Import is keyed on the permanent request ID, so a repeated import never duplicates a request.

### V1.6.2 — a request only owns its own effect

A decision is journaled in the append-only `AUDIT_LOG`, keyed by `Request_ID`, so no schema or table was
added:

| Action | Written | Meaning |
| --- | --- | --- |
| `REQUEST_DECISION_PREPARED` | before the task is touched | the intent, the pre-mutation revision and deadline, the reviewer |
| `REQUEST_EFFECT_APPLIED` | after the mutation returns | proof that *this* request produced the effect |
| `REQUEST_DECIDED` | once per accepted decision | the decision record |
| `REQUEST_APPROVAL_FAILED` | when applying the effect throws | the attempt failed and the claim was kept |
| `REQUEST_RECONCILE_REQUIRED` | when the outcome is ambiguous | a manager must settle it by hand |

Matching values are **not** evidence. `Done`/`100 %` or a `Due_Date` equal to the requested one may have been
produced by another completion report, an ADMIN `COMPLETION_OVERRIDDEN`, a separate approval or a manual edit. Such
a request becomes `STALE` (`Task was completed by another operation` / `Deadline was changed by another operation`)
instead of being recorded as an employee approval, and the revision check is never skipped because the target value
matches.

Recovery rules:

* **Pending** request → revision, assignment and original deadline are checked; a changed task is `STALE`.
* **Processing** request with `REQUEST_EFFECT_APPLIED` (or `REQUEST_DECIDED`) → the finalization is completed. The
  task is not written again and the history row uses `HIST-<requestId>`.
* **Processing** request with a recorded failure whose revision is unchanged → the effect provably never landed, so
  the retry applies it once.
* **Processing** request in any other state → never auto-approved and never applied twice. It stays `PROCESSING`
  (an open, visible state) with one `REQUEST_RECONCILE_REQUIRED` row. An ADMIN/MANAGER settles it with
  `previewRequestDecisionReconciliation()` (read-only) and then
  `reconcileRequestDecision(requestId, 'CONFIRM_APPLIED' | 'MARK_STALE', note, 'RECONCILE REQUESTS')`. Confirming
  requires the task to genuinely hold the requested end state; the confirmation is recorded as
  `REQUEST_EFFECT_APPLIED` with `reconciled: true` and the task is never written. `MARK_STALE` closes the request
  without approving it.
* **Terminal** request (`APPROVED`/`REJECTED`/`RETURNED`/`WITHDRAWN`) → a retry reports the existing state, or
  completes a missing `REQUEST_DECIDED` record when the audit write failed. It never applies the effect again.

The decision is mirrored to the inbox row (`Inbox_State`) so the worker receipt shows it. A failure to write the
inbox never rolls back an accepted decision; open **申請一覧** and use `申請状態の同期確認` / `申請状態を再同期` to
compare and repair the receipt (see [REQUEST_INBOX_DEPLOYMENT.md](REQUEST_INBOX_DEPLOYMENT.md) §6).

**Limitation:** Google Sheets cannot write the task row, the request row and the audit row atomically. The
implementation narrows the window and makes an ambiguous result visible and reviewable; it does not promise
exactly-once delivery for an interrupted execution.

### Dates

`Requests.day()` accepts a real `Date` (resolved in Asia/Tokyo, so a date cell is never shifted), a `yyyy-MM-dd`
text value (kept as written) and an ISO timestamp (its written day). Empty, `null`, `undefined`, an invalid `Date`
and an impossible calendar date such as `2027-02-29` normalize to "no date" instead of becoming a wrong one.

## 6. Notifications

Three optional switches exist in `AUTOMATION_SETTINGS`, all **OFF** by default:

* `DEADLINE_REQUEST_EMAIL_ENABLED`
* `COMPLETION_REPORT_EMAIL_ENABLED`
* `PENDING_REQUEST_REMINDER_ENABLED`

They only take effect through the centralized gate in `src/Notifications.gs`: master mode
`OFF` sends nothing, `PREVIEW` records previews without sending, `LIVE` requires the
emergency stop to be off, an activated notification account, allowed recipient domains, the
deduplication ledger and the per-run cap. Request text is never published to the dashboard;
only a pending indicator (a boolean) is published for a task with an open request.

## 7. Operator checklist

1. Configure `REQUEST_INBOX_SPREADSHEET_ID` and run `initializeRequestInbox('INITIALIZE
   REQUEST INBOX')` once as an administrator from a temporary no-argument editor wrapper (see
   [REQUEST_INBOX_DEPLOYMENT.md](REQUEST_INBOX_DEPLOYMENT.md) §3).
2. Set `REQUEST_SUBMISSION_ENABLED=true` in the dashboard project. Since V1.3.1 an absent
   property (or any value other than `true`) means submissions are closed, and
   `requestSubmissionConfig()` reports that state to the page.
3. Open the manager sidebar **申請一覧** (it imports automatically) or run
   `importRequestInbox()` before reviewing.
4. Decide each request in the sidebar; approve only after checking the task.
5. Publish the dashboard snapshot so approved deadlines appear for viewers.
