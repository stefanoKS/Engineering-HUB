# V1.6.1 gate 4 — Member history that survives reassignment

Status: **PASS** (local) — **BLOCKED** for live verification
Date: 2026-10-29
Starting commit SHA: `ea3fbc9`
Branch: `fix/v1.6.1-stabilization`

## 1. Objective

Keep the work a member actually did visible in that member's history after the task was reassigned, without
inventing attribution and without rewriting the past.

## 2. Findings (audit of the V1.6 delivery)

1. `ManagerWeb.memberProfile` selected tasks by the current `Owner_Member_ID`, so a reassigned task disappeared from
   the previous owner's profile entirely — including an approved completion.
2. Nothing recorded that an owner change happened; only the generic `TASKS/UPDATE` audit row (with the whole row
   before and after) could be inspected.
3. The previous-work list showed no current owner, so a manager could not tell "this person did it, somebody else
   owns it now" from "this person still owns it and it is done".

## 3. Required functionality

1. Ownership is historical: the current owner column plus the append-only audit evidence.
2. An owner change writes an explicit `TASK_REASSIGNED` record containing both owners.
3. A former assignment shows the current owner and stays in the previous-work list.
4. Completed work keeps its completion and acceptance dates after a reassignment.
5. When no audit evidence exists at all, the profile states the limitation instead of implying completeness.

## 4. Relevant source files

`src/ManagerWeb.gs` (`memberProfile`: ownership map, audit evidence parsing, previous/current split, `ownership`
block), `src/Tasks.gs` (`update` writes `TASK_REASSIGNED`), `src/ManagerWebClient.html` (`memberProfileView`:
former assignment, current owner, limitation), `shared/i18n.js` (`web.formerAssignment`, `web.currentOwner`,
`web.historyLimitation`).

## 5. Acceptance criteria

- After `Tasks.update(id, {Owner_Member_ID: other})` the task appears in the previous owner's `previous` list with
  `formerAssignment: true` and the new owner's name, and in the new owner's `current` list.
- Exactly one `TASK_REASSIGNED` row with `previousOwner` and `newOwner`; an unrelated edit adds none.
- A completed-then-reassigned task keeps `completedAt` and an acceptance marker.
- `ownership.limitation` is `AUDIT_LOG_EMPTY` when the profile has history but no audit rows.
- No private field (acceptance criteria, description, next action) is returned.

## 6. Automated test cases

`tests/v1_6_1-history.test.js` — 5 cases: reassignment keeps history and shows the new owner; the explicit audit
record; completed work stays attributed; the stated limitation; allowlisted fields only.
`tests/v1_6-member-history.test.js` keeps its original V1.6 cases.

## 7. Actual test results

PASS locally: 5/5 new cases plus the 4 historical cases; full suite **500 tests, 500 pass**.

## 8. Manual test cases (DEV, not executed)

1. Complete a task as a member, reassign it to another member, and confirm both profiles show it in the right
   section.
2. Open the member view from メンバー and confirm the former assignment row shows the current owner.
3. Inspect `AUDIT_LOG` for one `TASK_REASSIGNED` row per change.

## 9. Performance results

`memberProfile` parses every task-related audit row once per call (no new table read beyond the existing
`AUDIT_LOG`); the profile is a manager-only drill-down and is not part of the navigation snapshot.

## 10. Security review

The profile is a manager-only read (`managerWebRead('member')` → `Access.requireManager`). Attribution uses the
immutable `Member_ID` and the audit actor only; a self-reported requester name is never used, which the historical
V1.6 test still asserts. Only allowlisted task summary fields are returned.

## 11. Problems found

- The `current` list was first sorted with `taskOrder`, which expects `Task_ID` while compact summaries carry `id`;
  the comparator is now explicit and covered by the tests.

## 12. Final gate status

**PASS** locally (implementation, tests, lint, validation) — **BLOCKED** for live Workspace verification.

### Remaining blockers

Historical attribution for work recorded before audit logging existed cannot be verified in live data without a
DEV workbook; the profile states the limitation instead of guessing (**BLOCKED**).

**IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**
