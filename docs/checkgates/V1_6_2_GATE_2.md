# V1.6.2 gate 2 — Date handling and audit reliability

Status: **PASS** (local) — **BLOCKED** for live verification
Date: 2026-10-28
Starting commit SHA: `40c3ed6c422074b801056b96c04769051d14ca53`
Branch: `fix/v1.6.2-reliability`

## 1. Objective

Correct the Google Sheets `Date` conversion in the request module and make a completed management operation carry
its required audit evidence — recoverable when the write fails, never duplicated when it is retried.

## 2. Confirmed root cause

1. **`Requests.day(value)`** read `var raw = text(value);` and then `if (raw instanceof Date)`. `text()` always
   returns a string, so the `Date` branch was unreachable. A real date cell returned by
   `Range.getValues()` therefore failed the `yyyy-MM-dd` regex and became `''`: the stored current deadline, the
   request's original deadline and every comparison derived from it silently lost the value.
2. **`Requests.decideLocked`** finalized in the order *task → request status → `REQUEST_DECIDED` → inbox mirror*. If
   the audit write failed, the request was already terminal, so the ordinary retry threw `Request already
   decided` and the missing record could never be written.
3. **`Completion.override`** wrote `Tasks.update(Done)` and *then* `AuditLog.write('COMPLETION_OVERRIDDEN')`. A
   failed audit write left a completed task with no override evidence, reported as a plain exception.

## 3. Before behavior

| Input / scenario | V1.6.1 result |
| --- | --- |
| A Sheets date cell (`Date` object) | `''` — the deadline disappeared |
| `''`, `null`, `undefined` | `''` (correct) |
| `2027-02-29` | `''` (correct) |
| Audit write fails after the request is finalized | Request terminal, no `REQUEST_DECIDED`, retry refused |
| Audit write fails after the override | Task `Done`, no `COMPLETION_OVERRIDDEN`, recovery undocumented |

## 4. Corrected behavior

- `day()` tests `instanceof Date` **first**. A `Date` is formatted in `Asia/Tokyo` (an invalid `Date` yields `''`).
  A text value keeps its written `yyyy-MM-dd`, so an ISO timestamp is never re-derived into another day. An
  impossible calendar date is refused instead of being normalized.
- `finalizeLocked` writes `REQUEST_DECIDED` once, guarded so a repeat never duplicates it. When that write fails the
  caller gets an explicit message naming the remedy; repeating the same decision repairs **only** the missing
  record and the inbox mirror, keeps `Reviewer`/`Decided_At`/`Accepted_Completion_At`, and does not touch the task.
- `Completion.override` writes `COMPLETION_OVERRIDE_PREPARED` (with a generated `Operation_ID`) before the mutation.
  If it fails, the correction aborts and the task is untouched. If the final `COMPLETION_OVERRIDDEN` write fails,
  the caller is told to run `reconcileCompletionOverrides`; that entry point appends only the missing final row, and
  only for a task verified `Done` / `100 %`, once per `Operation_ID`.

## 5. Source files modified

`src/Requests.gs` (`day`, `message`, `finalizeLocked` audit guard), `src/Completion.gs` (`PREPARED_ACTION`,
`FINAL_ACTION`, `RECONCILED_ACTION`, `detail`, `override`, `pendingOperations`, `reconcileOverrides`, exports,
globals `previewCompletionOverrideReconciliation` / `reconcileCompletionOverrides`),
`tests/v1_6_2-requests.test.js` and `tests/v1_6_2-completion.test.js` (new).
No schema change: the override journal reuses `AUDIT_LOG` (`Entity_Type = 'TASK'`, `Entity_ID = Task_ID`).

## 6. Test cases

Dates (`tests/v1_6_2-requests.test.js`):

- A. A real `Date` from a mock spreadsheet cell imports as `2026-12-16` for the instant `2026-12-15T15:00Z`
  (Asia/Tokyo), proving the branch is reachable and the day is not shifted.
- B. `2026-12-15` (ISO date) and C. `2026-12-15T00:00:00.000Z` (ISO timestamp) keep their written day.
- D. `2028-02-29` accepted, `2027-02-29` refused with `INVALID_DATE`.
- E. JST midnight boundary — the same `Date` as (A); a UTC slice would have produced the previous day.
- F. A `Date` in `TASKS.Due_Date` is read correctly by `Requests.queue()`.
- G. `Date` values in `TASK_DEADLINE_HISTORY` are read correctly by `Requests.history()`.
- Empty string, `null`, `undefined`, an invalid `Date` and `2026-13-01` all normalize to `''` without becoming a
  valid date.

Audit reliability:

- H. The `REQUEST_DECIDED` write fails after the task mutation → the caller sees the explicit message, the request
  is `APPROVED` with no decision row.
- I. Repeating the decision writes exactly one `REQUEST_DECIDED`, keeps `Completed_At`/`Assignment_Version`, and a
  further retry is refused.
- J. The override preparation fails → the task is untouched and no final record exists.
- K. The override finalization fails → the task is `Done`, the preview lists the operation, reconciliation appends
  the record once, `Completed_At` is unchanged.
- L. Reconciliation is idempotent, and a preparation whose task is not `Done` is reported as `notDone`, never
  confirmed.
- M. A legacy completion (Done without an approval record) stays readable and produces no override rows.

## 7. Actual test results

PASS locally — `tests/v1_6_2-requests.test.js`: 14/14; `tests/v1_6_2-completion.test.js`: 5/5. Full suite **543
tests, 543 pass, 0 fail**.

## 8. Security implications

- Both reconciliation entrypoints call `Access.requireAdmin()` and then `Roles.requireAtLeast('ADMIN', …)` through
  `Access.requireAdmin()` inside the service; the confirmation strings `RECONCILE COMPLETIONS` are exact matches.
- Reconciliation never deletes an audit row and never writes a task; it can only append the missing record for a
  state that already exists, so it cannot be used to fabricate a correction.
- A blank identity still matches no member (`AuditLog.actor()` returns `''`), so an override cannot be recorded
  against a guessed actor.

## 9. Performance implications

No measurable effect on ordinary paths. Override reconciliation is a rare ADMIN operation that reads `AUDIT_LOG`
once plus the tasks it must verify.

## 10. Known limitations

- The audit write and the row write remain two separate Sheets operations. The implementation narrows and surfaces
  the window; it does not make it atomic, and no exactly-once or automatic recovery is claimed.
- `Requests.day()` treats a *textual* ISO timestamp as the date it names, and a `Date` object as the day in
  Asia/Tokyo. These are deliberately different rules for different inputs; the gate records that explicitly rather
  than pretending one conversion fits both.
- A leftover preparation whose task is not `Done` stays pending and needs a human decision.

## 11. Remaining blockers

Live verification of a real Sheets date cell and of a real audit-write failure is **BLOCKED** (no DEV deployment).

## 12. Final gate status

**PASS** locally (implementation, 19 gate tests, lint, validation) — **BLOCKED** for live Workspace verification.

Implementation commit SHA: `bae3897650ed2a85cdd144b8c2476a6abab5c2c3` (recorded by this evidence commit).

**IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**
