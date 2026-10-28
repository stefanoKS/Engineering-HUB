# V1.6 gate 6 — Completion reporting and approval

Status: **PASS** (local) — **BLOCKED** for live verification
Date: 2026-10-28
Starting commit SHA: `c769cb5006b13130e1358df3cbad436068a3c3f8`
Implementation commit SHA: 34a2bf1

## 1. Objective

A worker reporting completion never marks a task Done. Only a manager approval (or an explicit ADMIN correction)
writes Done / 100 %, and no other entrypoint can bypass it.

## 2. Relevant source files

`src/Completion.gs` (central guard, approval context, review state, ADMIN override), `src/Tasks.gs` (`validate`
wiring, `complete` refusal), `src/Ui.gs` (`updateProgress`, `assignTask`), `src/Requests.gs` (`applyApproval` inside
the approval context, `pendingCompletionStates`), `src/ManagerWebApi.gs` (`taskOverrideComplete`),
`src/ManagerWebClient.html` (review chips, admin correction panel), `src/SharedDashboardModel.gs` (`reviewState`),
`dashboard-app/DataService.gs` and `Client.html` (approval badge, completion date).

## 3. Required functionality

1. Lifecycle: In Progress → employee report → Pending review → Approved (Done/100 %) | Returned | Rejected.
2. Reuse `TASK_REQUESTS`, `Requests.decide`/`applyApproval`; no second approval system.
3. Block direct completion in `Tasks.complete`, `Tasks.update`, `Ui.updateProgress`, `Ui.assignTask` and the manager
   web form.
4. An ADMIN correction requires a reason, the exact confirmation and its own audit action.
5. Legacy completed rows stay valid; no approval event is invented.
6. Employee isolation is unchanged; a typed requester name is never identity.

## 4. Acceptance criteria

- Report leaves the task not Done and shows 承認待ち.
- Approval sets Done/100 % once; a repeated approval is refused.
- Return/reject never change the task; a stale report never overwrites changed work.
- Direct completion is refused everywhere with the lifecycle message.

## 5. Automated test cases

`tests/v1_6-completion.test.js` (report, approval, idempotency, return/reject, stale, every bypass entrypoint,
ADMIN override, legacy record, published review state without report text), `tests/v1_3-requests.test.js`,
`tests/gate4-ui.test.js` (progress 100 now refused, 90 allowed), `tests/v1_5-project-metrics.test.js`.

## 6. Actual test results

PASS locally. `gate4-ui.test.js` was retargeted because V1.6 intentionally removes the direct 100 % path it asserted;
the new assertion checks the refusal and that 90 % still saves.

## 7. Manual test cases (DEV, not executed)

Runbook steps 7.1–7.4 and 8.1–8.4: submit from the employee app, import once, approve once, second approval
refused, return/reject keep the task, ADMIN correction audited separately.

## 8. Performance results

`requestApproval` p50 2.32 / 11.73 / 32.80 ms (unchanged). The review state adds one cached `TASK_REQUESTS` read to
the task index (4 tables instead of 3) and 1 byte column.

## 9. Security review

The guard runs in the domain layer, inside the script lock, so it covers every entrypoint including triggers and the
sidebar. The approval context is execution-local and cannot be reached from a browser payload; the ADMIN override
requires a verified ADMIN, a reason and an exact confirmation, and writes `COMPLETION_OVERRIDDEN`.

## 10. Problems found

`Requests.decide` marked the task Done outside any approval context, which the new guard correctly refused. It now
wraps the write in `Completion.withApproval`.

## 11. Corrective actions

Approval path updated; `Completion` owns the review-state lookups instead of duplicating request queries.

## 12. Final gate status

**PASS** locally (implementation, tests, lint, validation) — **BLOCKED** for live Workspace verification.

### Remaining blockers

The live employee→manager round trip is **BLOCKED** (`REQUEST_SUBMISSION_ENABLED` stays OFF; no DEV inbox).

## 13. Commit SHA

Starting `c769cb5006b13130e1358df3cbad436068a3c3f8`; implementation SHA 34a2bf1.
**IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**
