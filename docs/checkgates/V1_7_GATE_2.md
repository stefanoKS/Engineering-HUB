# V1.7 GATE 2 — Multiple assignees and multiple responsibility members

| Field | Value |
| --- | --- |
| Release | V1.7 |
| Scope | `src/Assignees.gs`, `src/Tasks.gs`, `src/Responsibilities.gs`, `src/Ui.gs`, `src/Deletion.gs` |
| Result | **PASS (local)** |

## Rules verified

- Additional members live only in the relationship tables; the primary owner columns are never
  copied and no comma separated identifier list is stored.
- A repeated identifier is refused instead of being silently dropped.
- A **new** assignment refuses an unknown or inactive member; an existing relationship survives a
  later deactivation so an unrelated edit cannot drop it.
- Removing an additional member stamps `Removed_At`/`Removed_By`; re-adding reactivates the same row
  instead of inserting a duplicate.
- A membership change bumps `Assignment_Version` and clears `Assignment_Approved_At`, and writes one
  `TASK_ASSIGNEES_CHANGED` / `RESPONSIBILITY_MEMBERS_CHANGED` audit row.
- Only an ADMIN may change the primary responsibility owner; any ADMIN/MANAGER manages additional
  members. Membership grants no manager capability.
- Retirement preserves every membership row.
- A task with any assignee row is reported as a blocking `REFERENCE` by the deletion preflight.
- Reads are one indexed pass per execution (`Database.memo`); a 3,000-task list performs one
  relationship read, not one per task.

## Evidence

`tests/v1_7-multi-assignee.test.js` — 18 tests, 18 pass:

| Test | Result |
| --- | --- |
| `a task without an additional assignee has exactly one effective assignee` | PASS |
| `additional assignees are relationship rows, never a stored column` | PASS |
| `a repeated additional assignee is refused instead of silently dropped` | PASS |
| `a new assignment refuses an unknown or inactive member` | PASS |
| `a deactivated additional assignee survives an unrelated edit` | PASS |
| `an assignment membership change invalidates an existing approval` | PASS |
| `removing an additional assignee keeps history and re-adding reactivates it` | PASS |
| `changing the primary assignee never duplicates the effective membership` | PASS |
| `additional responsibility members are recorded; only an ADMIN may move the primary owner` | PASS |
| `retiring a responsibility keeps its membership history` | PASS |
| `a task with any assignee row is no longer permanently deletable` | PASS |

Full suite: **592 tests, 592 pass, 0 fail**.

## Not done in this release (documented limitation)

- Additional assignees do not receive their own assignment e-mail. The notification engine still
  keys one ledger row per task and primary assignee, so adding an additional assignee cannot create a
  duplicate notification. Extending the recipient list requires a new reviewed ledger key design.
- Individual contribution tracking is explicitly out of scope: a shared task keeps one progress value.
