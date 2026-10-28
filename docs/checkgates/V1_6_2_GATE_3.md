# V1.6.2 gate 3 — Employee inbox status reconciliation

Status: **PASS** (local) — **BLOCKED** for live verification
Date: 2026-10-28
Starting commit SHA: `40c3ed6c422074b801056b96c04769051d14ca53`
Branch: `fix/v1.6.2-reliability`

## 1. Objective

Make the receipt the employee sees agree with the manager's authoritative decision, without changing the original
request content, the task row or the decision — and without giving the employee application any access to the
private workbook.

## 2. Confirmed root cause

`Requests.updateInboxState` wrote the mirrored `Inbox_State` inside a `try/catch` and, on failure, only recorded
`INBOX_MIRROR_FAILED` (plus a `console.warn`). There was **no recovery path**: once `TASK_REQUESTS.Status` was
`APPROVED` and the receipt still said `RECEIVED`, nothing in the product could repair it, and no preview told the
manager that the employee saw a stale status. The request was also terminal, so re-deciding was refused.

## 3. Before behavior

| State | V1.6.1 |
| --- | --- |
| Manager `APPROVED`, inbox `RECEIVED` | Permanently inconsistent; only a manual sheet edit fixed it |
| Request missing from the inbox | Undetected |
| Inbox row with a different `Task_ID` | Undetected |
| Inbox unavailable during a decision | Recorded warning only |

## 4. Corrected behavior

Two narrowly scoped, separately authorized operations in `src/Requests.gs`:

- `previewInboxReconciliation()` — read-only. Reads the inbox once (bounded by `INBOX_SCAN_LIMIT = 5000`, with a
  `truncated` flag), matches rows by the stable `Request_ID`, verifies the `Task_ID` / `Project_ID` identity and
  classifies each mirrored request: `ALREADY_SYNCED`, `NEEDS_SYNC`, `MISSING_INBOX_ROW`, `IDENTITY_MISMATCH`. The
  payload contains the request id, the task/project identity and the two states only — no requester, reason,
  explanation or completion note. Only `APPROVED`, `REJECTED`, `RETURNED` and `STALE` are considered, so the
  internal `PENDING`/`PROCESSING` states are never mirrored.
- `reconcileInboxStates(confirmation)` — requires `RECONCILE REQUEST INBOX`, runs under the existing script lock,
  and writes only the `Inbox_State` cell of a `NEEDS_SYNC` row. A missing row is reported and never recreated, a
  conflicting identity is refused and never overwritten, an already matching row is not written, the second run
  reports `updated: 0`, and one summary row `REQUEST_INBOX_RECONCILED` records the attempt. An unavailable inbox
  changes nothing in the manager workbook.
- Sidebar UI in `src/UiRequests.html`: `申請状態の同期確認` (preview) and `申請状態を再同期` (repair, with an explicit
  confirmation), rendering `一致` / `要再同期` / `受信箱に行がありません` / `タスクまたはプロジェクトが一致しません`.
  Entrypoints: `uiRequestInboxPreview`, `uiRequestInboxReconcile` → `Ui.requestInboxPreview` /
  `Ui.requestInboxReconcile`, each of which calls `Access.requireManager()`.

## 5. Source files modified

`src/Requests.gs` (`MIRRORED_STATUSES`, `INBOX_SCAN_LIMIT`, `inboxIndex`, `compareInbox`,
`previewInboxReconciliation`, `reconcileInboxStatesLocked`, `reconcileInboxStates`, exports and the globals
`previewRequestInboxReconciliation` / `reconcileRequestInbox`), `src/Ui.gs` (`requestInboxPreview`,
`requestInboxReconcile`, exports, `uiRequestInboxPreview`, `uiRequestInboxReconcile`), `src/UiRequests.html`
(fieldset and rendering), `shared/i18n.js` (+ generated `src/I18n.html`, `dashboard-app/I18n.html`),
`tests/v1_6_2-inbox.test.js` (new).

## 6. Test cases

`tests/v1_6_2-inbox.test.js` — 9 cases:

- A/B/C. `APPROVED`, `REJECTED` and `RETURNED` with a `RECEIVED` receipt are repaired; the request and the task are
  unchanged.
- D. An already matching receipt writes nothing.
- E. A missing `Request_ID` is reported as `MISSING_INBOX_ROW`; no row is appended.
- F. A mismatched `Task_ID` is `IDENTITY_MISMATCH`; the conflicting cell keeps its value.
- G. An unavailable inbox makes the preview `available: false` and the repair throw while the authoritative
  decision survives.
- H. Two attempts: the first updates one row, the second updates none; both are audited.
- I/J. A MANAGER may repair; a MEMBER and a VIEWER are refused through both the domain and the sidebar entrypoint.
- K. The preview and repair payloads contain no requester, reason, explanation or completion note.
- L. Reconciliation works while the employee submission flag is closed, and the flag is never read or written.

## 7. Actual test results

PASS locally — `tests/v1_6_2-inbox.test.js`: 9 tests, 9 pass, 0 fail. Full suite **543 tests, 543 pass**.

## 8. Security implications

- Spreadsheet A is never exposed to the employee application; the reconciliation runs entirely inside the manager
  project and reads Spreadsheet C, which the employee project only appends to.
- Authorization is server-side in both layers (`Access.requireManager()` then
  `Roles.requireAtLeast('MANAGER', AuditLog.actor())`) and the exact confirmation is required. A browser-supplied
  role, actor or confirmation is data only.
- Only `Inbox_State` is written: requester names, reasons, explanations and completion notes are never modified or
  returned, which keeps the employee's private text out of the manager payload and out of the audit record.
- A conflicting or missing row is reported instead of being "fixed", so reconciliation cannot be used to point an
  employee receipt at a different request.

## 9. Performance implications

The preview is one inbox read plus one `TASK_REQUESTS` read; the repair reuses the same single read (the script lock
is held for the duration). Not measured as a navigation path: it is a rare administrative action.

## 10. Known limitations

- The preview reports all mirrored requests, so a very large inbox makes the payload grow; items are capped at 500
  and the total is reported.
- A receipt that is missing from the inbox must be investigated; the product will not recreate it, because doing so
  would invent a request the employee never submitted.
- `INBOX_MIRROR_FAILED` still records an individual failed mirror during a decision; reconciliation complements it,
  it does not replace the immediate attempt.

## 11. Remaining blockers

Verification against a real Spreadsheet C (separate deployment, real quota failure) is **BLOCKED** (no DEV
deployment).

## 12. Final gate status

**PASS** locally (implementation, 9 gate tests, lint, validation) — **BLOCKED** for live Workspace verification.

Implementation commit SHA: sealed in the release-sealing commit of `fix/v1.6.2-reliability`.

**IMPLEMENTED — DEV WORKSPACE VERIFICATION PENDING. NOT APPROVED FOR PRODUCTION.**
