# V1.6.2 gate 1 — Request-specific approval integrity

Status: **PASS** (local) — **BLOCKED** for live verification
Date: 2026-10-28
Starting commit SHA: `40c3ed6c422074b801056b96c04769051d14ca53`
Branch: `fix/v1.6.2-reliability`

## 1. Objective

A task that happens to hold the requested end state must never prove that a particular employee request was
applied. Only evidence that belongs to the exact `Request_ID` may do that, an interrupted attempt must stay
explicitly ambiguous until a manager settles it, and a terminal request must never apply its effect again.

## 2. Confirmed root cause

`Requests.alreadyApplied(request, task)` derived "already applied" from the task row alone:

- `COMPLETION_REPORT`: `Status == 'Done' && Progress_Percent == 100`.
- `DEADLINE_CHANGE`: `Due_Date == Requested_Due_Date`.

It was used in two places. `applyApproval` returned the untouched task instead of applying anything, and
`decideLocked` used `!alreadyApplied(...)` to **skip the revision and original-deadline checks**. Any other
operation that produced the same end state — an ADMIN `COMPLETION_OVERRIDDEN`, a separate deadline approval, a
direct manager correction, a manual edit — was therefore recorded as an ordinary employee approval, and a stale
request could overwrite newer work whenever the target value happened to match.

A second defect compounded it: `PROCESSING` had no request-specific evidence at all, so a resumed decision could
only guess.

## 3. Before behavior

| Scenario | V1.6.1 result |
| --- | --- |
| ADMIN overrides the completion, then the manager approves the older report | `APPROVED`, `Accepted_Completion_At` written, no task mutation — a false attribution |
| Another operation sets the requested deadline, then the manager approves | `APPROVED` with no history row of its own — a false attribution |
| Task revision changed after submission but the target value matches | Stale checks bypassed, request applied |
| Crash after the task update, no record | Silently treated as applied (`APPROVED`) |
| Two managers approve | Second refused (already correct) |

## 4. Corrected behavior

- The state guess is gone. `Requests.evidence(requestId)` reads the append-only journal in `AUDIT_LOG` for the
  exact `Entity_ID` and returns `prepared` (`REQUEST_DECISION_PREPARED`), `applied`
  (`REQUEST_EFFECT_APPLIED`), `decided` (`REQUEST_DECIDED`), `failed` (`REQUEST_APPROVAL_FAILED`) and `review`
  (`REQUEST_RECONCILE_REQUIRED`). The first preparation wins, because a later one would already record the
  post-mutation revision.
- **Phase 1** writes `REQUEST_DECISION_PREPARED` (revision, previous deadline, expected mutation, reviewer)
  *before* the claim. If that write fails the request is left untouched and the operation aborts.
- **Phase 2** applies the mutation and writes `REQUEST_EFFECT_APPLIED` before the status change, so a later retry
  can finish the record instead of repeating the effect.
- **CASE A (pending):** the revision and original-deadline checks are never bypassed. Additionally a request whose
  end state already exists without request evidence becomes `STALE` ("Task was completed by another operation" /
  "Deadline was changed by another operation").
- **CASE B (processing):** `decided` or `applied` evidence resumes the finalization only. A recorded failure plus an
  unchanged revision (`unchangedSincePreparation`) proves the mutation never landed, so a guarded retry is allowed.
  Anything else calls `reviewRequired`, which keeps `PROCESSING`, writes one `REQUEST_RECONCILE_REQUIRED` row and
  throws — never an automatic `APPROVED`.
- **CASE C (terminal):** the same status plus a `REQUEST_DECIDED` row is refused; the same status without one is a
  repair (see gate 2).
- **Recovery:** `previewRequestDecisionReconciliation()` (read-only) and
  `reconcileRequestDecision(requestId, 'CONFIRM_APPLIED' | 'MARK_STALE', note, 'RECONCILE REQUESTS')`. Confirming
  requires the task to genuinely hold the requested end state; the reviewing manager's confirmation becomes the
  `REQUEST_EFFECT_APPLIED` evidence and the request is finalized. The task is never written by that path.
  `MARK_STALE` refuses when an applied record exists.

## 5. Source files modified

`src/Requests.gs` — constants `PREPARED_ACTION` / `APPLIED_ACTION` / `DECIDED_ACTION` / `FAILED_ACTION` /
`REVIEW_ACTION` / `TERMINAL_STATUSES` / `RESOLUTIONS`; `evidence`, `taskShowsEffect`, `unchangedSincePreparation`,
`ensureHistory`, `reviewRequired`, `finalizeLocked`, `applyApproval`, `decideLocked`,
`previewDecisionReconciliation`, `resolveDecision`/`resolveDecisionLocked`, and the globals
`previewRequestDecisionReconciliation` / `reconcileRequestDecision`. `tests/v1_6_2-requests.test.js` (new),
`tests/v1_3-requests.test.js` and `tests/v1_6_1-requests.test.js` (unsafe expectations replaced).
No schema, table, migration or Script Property was added: the journal reuses `AUDIT_LOG`, whose `Entity_ID` is
already the request ID.

## 6. Test cases

`tests/v1_6_2-requests.test.js` — gate 1:

1. An ADMIN completion override is never attributed to an older employee report → `STALE`, no `REQUEST_DECIDED`,
   no `REQUEST_EFFECT_APPLIED`, `Accepted_Completion_At` empty.
2. A deadline reached by another operation → `STALE`, no history row, no decision row.
3. A changed revision is not bypassed because the target matches → `STALE`, task untouched.
4. `PROCESSING` with `REQUEST_EFFECT_APPLIED` evidence → safe finalization, one history row, one applied row.
5. `PROCESSING` with the expected state and no evidence → refused, stays `PROCESSING`, one review row, then a
   manager `CONFIRM_APPLIED` finalizes without a second write; the task is not modified.
6. `CONFIRM_APPLIED` is refused when the task does not show the effect; `MARK_STALE` closes it without approving.
7. A terminal request cannot be decided again and writes no audit row.
8. Two managers cannot both approve; one history row, one decision row.
9. A reassignment after submission stops an older report from approving newer work.
10. A preparation that cannot be written aborts before the mutation and leaves the request `PENDING`.

Replaced expectations (documented rationale in the test files):

- `tests/v1_3-requests.test.js`: "an interrupted decision is finalised without applying the change twice" asserted
  that a matching deadline alone justified an automatic approval — the exact false attribution this gate removes.
  It now asserts explicit reconciliation.
- `tests/v1_6_1-requests.test.js`: "a resumed decision never applies the effect twice" asserted two
  `REQUEST_DECIDED` rows for one accepted decision; it now asserts one row (see gate 2).

## 7. Actual test results

PASS locally — `node --test tests/v1_6_2-requests.test.js`: 14 tests, 14 pass, 0 fail. Full suite **543 tests, 543
pass, 0 fail, 0 skipped** (baseline V1.6.1: 500 pass).

## 8. Security implications

- The journal is written server-side only; a request ID, actor, role or confirmation from the browser remains data.
  `decide`, `resolveDecision` and both previews re-check `Roles.requireAtLeast('MANAGER', AuditLog.actor())`, and
  the top-level entrypoints call `Access.requireManager()` before delegating (AGENTS.md rule 69).
- A request can no longer be used to claim work another operation performed, and a stale request can no longer
  overwrite a newer revision — the two integrity properties this gate exists for.
- `MARK_STALE` cannot be used to discard a known applied effect, and `CONFIRM_APPLIED` cannot assert an effect the
  task does not show.

## 9. Performance implications

`scripts/manager-web-benchmark.js`, `requestApproval` p50: 4.12 / 11.98 / 32.39 ms for 10/100/300 projects (V1.6.1:
2.34 / 11.34 / 31.94 ms). The cost is one extra bounded `AUDIT_LOG` read and two journal rows per decision — the
price of durability. `requestReconciliation` (12 ambiguous requests) measures 5.22 / 38.41 / 114.40 ms p50 and is a
rare administrative read.

## 10. Known limitations

- Google Sheets cannot write a task row and its journal row atomically. The window is narrowed to
  "mutation applied, `REQUEST_EFFECT_APPLIED` not yet written"; that state is reported as ambiguous and cannot be
  auto-confirmed. No exactly-once claim is made.
- `evidence()` scans `AUDIT_LOG` once per decision. That is bounded and linear in the audit log; a very large log
  makes the read slower, not incorrect.
- A request left `PROCESSING` by V1.6.1 has no preparation row and is therefore always ambiguous, by design.

## 11. Remaining blockers

Live verification of the DEV request round trip (inbox import → decision → receipt) is **BLOCKED** (no DEV
deployment).

## 12. Final gate status

**PASS** locally (implementation, 14 gate tests, lint, validation) — **BLOCKED** for live Workspace verification.

Implementation commit SHA: `bae3897650ed2a85cdd144b8c2476a6abab5c2c3` (recorded by this evidence commit).

**IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**
