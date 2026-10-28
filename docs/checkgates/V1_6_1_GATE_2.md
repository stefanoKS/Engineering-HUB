# V1.6.1 gate 2 — Completion workflow integrity

Status: **PASS** (local) — **BLOCKED** for live verification
Date: 2026-10-29
Starting commit SHA: `ea3fbc9`
Branch: `fix/v1.6.1-stabilization`

## 1. Objective

Make the reviewed completion workflow impossible to strand: a completion report for a container task is refused
before it is claimed, and a failure while applying an approval leaves visible, retryable evidence instead of a
silent `PROCESSING` row.

## 2. Findings (audit of the V1.6 delivery)

1. `Requests.normalize` accepted a `COMPLETION_REPORT` for any task, and `Requests.applyApproval` called
   `Tasks.update({Status: 'Done'})`, which throws inside `TaskTree.validate` for a container. Because the request
   had already been set to `PROCESSING` in phase 1, the request stayed `PROCESSING` forever with no decision.
2. `dashboard-app/DataService.requestTarget` published no container flag and `RequestService.submit` accepted the
   report, so the employee form offered an action the manager could never approve.
3. A failure in phase 1 was not recorded at all: the error surfaced once and the request kept no reason.
4. `Requests.updateInboxState` swallowed a mirror failure with `console.warn` only.
5. `Requests.normalize` was not reachable for testing, so the import-time rule could not be asserted.

## 3. Required functionality

1. A container task can never receive an approved completion; a deadline change on a container stays valid.
2. The refusal happens before the request is claimed, so the row keeps a decidable state.
3. A phase-1 failure is recorded (`REQUEST_APPROVAL_FAILED`), keeps the claim for a safe retry, and a retry applies
   the effect exactly once.
4. A failed inbox mirror is recorded (`INBOX_MIRROR_FAILED`) when an inbox is configured.
5. The employee app refuses the report and hides the action with the reason.

## 4. Relevant source files

`src/Requests.gs` (`normalize` with the container check, `importInbox` container counter + audit, `decideLocked`
pre-claim refusal and recovery block, `updateInboxState` audit, `normalize` exported),
`dashboard-app/DataService.gs` (`requestTarget` returns `container` and `contract`), `dashboard-app/RequestService.gs`
(`REQUEST_CONTAINER_TASK` refusal), `dashboard-app/Client.html` (completion action disabled with the reason),
`shared/i18n.js` (`request.container`, `request.error.REQUEST_CONTAINER_TASK`).

## 5. Acceptance criteria

- `Requests.normalize` returns `CONTAINER_TASK` for a container and accepts a leaf task.
- `Ui.decideRequest` on a container completion returns an error, leaves the request `PENDING`, and never writes Done.
- The import result reports `containerRejected` and writes `REQUEST_CONTAINER_REFUSED`.
- A simulated phase-1 failure leaves `Status = PROCESSING`, a `Decision_Note` asking for a retry, one
  `REQUEST_APPROVAL_FAILED` row, and the retry completes the request exactly once.
- `DataService.requestTarget(...).container` is `true` for a container and `false` for a 1.4 snapshot.

## 6. Automated test cases

`tests/v1_6_1-requests.test.js` — 6 cases: refusal before the claim; import refusal for a container and acceptance
for a leaf; deadline change on a container still applies; phase-1 failure recorded and retried; resumed decision
applies no second effect; failed mirror recorded. `tests/v1_6_1-compatibility.test.js` covers the published
container flag reaching the employee request service.

## 7. Actual test results

PASS locally: 6/6 new cases plus the compatibility case; full suite **500 tests, 500 pass**.

## 8. Manual test cases (DEV, not executed)

1. Submit a completion report from a subtask and confirm the parent's drawer offers no completion action.
2. Craft an inbox row naming a container and confirm the import refuses it and the queue does not change.
3. Approve a leaf completion and confirm Done/100 % with `Completed_At`, then repeat and confirm the refusal.
4. Interrupt an approval (network failure) and confirm the request shows the retry note and can be approved once.

## 9. Performance results

No measurable change: the container check reads one cached task table and one tree index per decision
(`requestApproval` p50 2.41 / 11.78 / 33.15 ms for 10/100/300 projects).

## 10. Security review

Both refusals are server-side and use the verified task row, never a browser flag. The recovery block only writes
to the request row and the audit log, both manager-only, and it re-throws so no caller can mistake it for success.
`KNOWN limitation`: a `PROCESSING` row is deliberately not auto-retried — an ambiguous delivery must be reviewed by
a manager (AGENTS.md rule 13).

## 11. Problems found

The refusal was initially only placed in `applyApproval`, which is *after* the claim; that still stranded the
request. It moved ahead of the phase-1 `Database.update`.

## 12. Final gate status

**PASS** locally (implementation, tests, lint, validation) — **BLOCKED** for live Workspace verification.

### Remaining blockers

The employee round trip and the inbox mirror against a real spreadsheet are **BLOCKED** (no DEV deployment).

**IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**
