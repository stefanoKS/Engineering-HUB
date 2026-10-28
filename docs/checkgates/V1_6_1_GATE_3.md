# V1.6.1 gate 3 — Deletion and audit integrity

Status: **PASS** (local) — **BLOCKED** for live verification
Date: 2026-10-29
Starting commit SHA: `ea3fbc9`
Branch: `fix/v1.6.1-stabilization`

## 1. Objective

Make the narrow ADMIN-only removal durable and recoverable: never report success without a written record, never
leave an interrupted removal unattributable, and never offer a bulk removal the UI cannot justify.

## 2. Findings (audit of the V1.6 delivery)

1. `Deletion.remove` deleted the row first and wrote the tombstone inside a `try/catch` that only called
   `console.error`, then returned `{deleted: true}`. A failed tombstone therefore produced a silent success and an
   identifier that could be reused.
2. The cascade existed in the backend, but `ManagerWebClient` disabled the action whenever dependencies existed, so
   the two layers disagreed and an unreachable but destructive path stayed reachable from a server call.
3. `ManagerWebClient` rendered the project delete control for every role (the server still enforced ADMIN).
4. `referencingTables('TASKS')` covered declared schema references only, so nested tasks were blocked by
   `Parent_Task_ID` but schedule confirmations, requests and deadline history were not treated as references.
5. `Deletion.assertFreshId` was never called from a create path.

## 3. Required functionality

1. Order: preflight → verified backup → durable intent (`RECORD_DELETE_PREPARED`) → row removal → tombstone
   (`RECORD_DELETED`). Success implies the tombstone exists.
2. An intent that cannot be written aborts the removal while the data is intact.
3. A tombstone failure raises an explicit reconciliation error, and the identifier is already reserved.
4. A reconciliation entry point finalizes an interrupted removal without ever deleting anything, and reports a row
   that still exists instead of touching it.
5. No cascading removal anywhere; the delete control is ADMIN-only in the browser.

## 4. Relevant source files

`src/Deletion.gs` (`INTENT_ACTION`, `TOMBSTONE_ACTION`, `RECONCILE_CONFIRMATION`, `isDeletedId`, `snapshotOf`,
`pendingOperations`, `reconcile`, `remove`, `referencingTables`, module documentation), `src/ManagerWebApi.gs`
(`deletionReconcile` action, `cascade` option removed), `src/ManagerWebClient.html` (cascade field removed,
ADMIN-only delete control, dependency hint, reconcile panel), `src/ManagerWeb.gs` (`deletion` read stays ADMIN),
`shared/i18n.js` (`web.deleteResolveChildren`, `web.deletionReconcile*`).

## 5. Acceptance criteria

- `remove` returns `finalized: true` only when both records exist.
- Patching the audit writer for `RECORD_DELETE_PREPARED` aborts the operation and the row survives.
- Patching it for `RECORD_DELETED` throws an error naming `reconcileDeletions`; the row is gone, the ID reserved.
- `reconcileDeletions('RECONCILE DELETIONS')` appends exactly one tombstone, is idempotent, and reports a present
  row without changing it.
- `cascade: true` is refused with a documented message and nothing is removed.
- The browser shows the project delete control for ADMIN only.

## 6. Automated test cases

`tests/v1_6_1-deletion.test.js` — 7 cases: intent-before-row ordering; abort on intent failure; tombstone failure →
reserve → reconcile → idempotent; reconcile never touches a present row; ADMIN + exact confirmation (API and direct);
nested child / schedule confirmation / request block a removal; ADMIN-only UI control.
`tests/v1_6-deletion.test.js` was retargeted: the cascade test now asserts the refusal and the child-by-child path.

## 7. Actual test results

PASS locally: 7/7 new cases and the retargeted historical test; full suite **500 tests, 500 pass**.

## 8. Manual test cases (DEV, not executed)

1. Remove a mistakenly created task and inspect `AUDIT_LOG`: `RECORD_DELETE_PREPARED` precedes `RECORD_DELETED`.
2. In a DEV copy, delete the tombstone row and run `reconcileDeletions('RECONCILE DELETIONS')`; confirm exactly one
   record is appended and nothing else changes.
3. Attempt a project delete with children and confirm the refusal plus the archive guidance.
4. Open the manager app as MANAGER and confirm no delete control is rendered.

## 9. Performance results

`taskDelete` and the preflight are unchanged (one cached read of `AUDIT_LOG` plus the reference tables); the
recovery path is a single pass over `AUDIT_LOG` per execution and is not on any hot path.

## 10. Security review

Still ADMIN-only at the service layer (`Access.requireAdmin`) and again at the API allowlist (`admin: true`,
`confirm: true`). The typed confirmation `DELETE <id>` and the fixed `RECONCILE DELETIONS` are checked server-side.
The recovery path can only append an audit row; it has no delete capability by construction, which is asserted by a
test. No new Script Property and no new scope.

## 11. Problems found

- `Database` has no `deleteRow`, so a test that tried to prune audit rows was replaced by a seed that never writes
  one; the limitation is now tested from a clean fixture instead of by mutation.
- The first draft of the reconcile report could list the same identifier twice when an intent was re-prepared after
  a failed finalization; the order list is now de-duplicated.

## 12. Final gate status

**PASS** locally (implementation, tests, lint, validation) — **BLOCKED** for live Workspace verification.

### Remaining blockers

A real interrupted removal in DEV (Drive backup + row removal + audit write) is **BLOCKED** (no DEV deployment).

**IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**
