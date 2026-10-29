# V1.7 GATE 5 — Manager interface and automatic request import

| Field | Value |
| --- | --- |
| Release | V1.7 |
| Scope | `src/ManagerWeb.gs`, `src/ManagerWebApi.gs`, `src/ManagerWebClient.html`, `src/ManagerWebStyles.html`, `src/Requests.gs` (read only) |
| Result | **PASS (local)**; real inbox round trip **BLOCKED / NOT_RUN** |

## Implemented

- **Members page shows Position / 職位** next to department and system role. The value comes from the
  existing `MEMBERS.Position` field through the existing member read; no schema or API change.
  A blank position renders `—`.
- **Opening 申請一覧 imports new requests exactly once.** `requestSync` is one authorized write
  (`Ui.requests` with `import: true`) that returns the refreshed queue, so the page needs one round
  trip. The manual Import button remains for retries, and a filter or language change never
  re-imports (`requestSync.state` guard, reset only when the page is entered again).
- **Import feedback is honest**: imported/skipped/rejected counts on success, an explicit failure
  message on error, and an "inbox not configured" state. Nothing reports success when the server
  reports an error or `configured:false`.
- **Type-aware request cards**: a completion report shows the reported time, the task status and the
  completion note instead of a meaningless deadline arrow; a deadline change shows current →
  requested, the day difference, the reason and the explanation. `PENDING`, `PROCESSING`,
  `APPROVED`, `REJECTED`, `RETURNED` and `STALE` are labelled through the dictionary. The decision
  engine is untouched.
- **Member filter on tasks** matches the primary owner *or* any additional assignee.
- **Task cards** name the additional assignees; **responsibility cards** separate the primary owner
  from the additional members.
- **Permanent deletion** asks once with a Yes/No dialog. The typed `DELETE <id>` field is gone; the
  client derives the exact confirmation from the selected record only after Yes. Reason, ADMIN
  authorization, dependency preflight, revision check, verified backup, tombstone and reconciliation
  are unchanged, and a double click cannot submit twice (the button is disabled while pending).

## Evidence

| Check | Result |
| --- | --- |
| `the Members page shows Position next to department and system role` | PASS |
| `permanent deletion asks once with Yes/No and never asks for a typed code` | PASS — No performs no write; Yes sends `confirmation: 'DELETE <id>'` with the reason |
| `the task editor offers an additional-assignee multi-select without the primary owner` | PASS |
| `the manager task index publishes assignees and the member filter matches any of them` | PASS |
| `a member profile separates primary work from additional work` | PASS |
| `older startup response cannot replace newer navigation and reads retry explicitly` | PASS (updated for the single `requestSync` round trip) |
| `request approval form records decision and displays deadline history` | PASS |
| `npm run validate` (no `innerHTML`, allowlisted actions) | PASS |

## Live items that remain BLOCKED

- Opening 申請一覧 against a real inbox with new rows and confirming one import per page entry.
  **NOT_RUN.**
- A real ADMIN deletion against a backed-up workbook. **NOT_RUN.**
