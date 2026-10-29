# V1.7 GATE 1 — Schema 8 and the reviewed additive migration

| Field | Value |
| --- | --- |
| Release | V1.7 |
| Scope | `src/Schema.gs`, `src/Migrations.gs`, `DATA_SCHEMA.md` |
| Result | **PASS (local)**; live Workspace migration **BLOCKED / NOT_RUN** |

## What was implemented

- Schema version **7 → 8**.
- Two additive tables: `TASK_ASSIGNEES` (`Assignment_ID`, `Task_ID`, `Member_ID`, `Assigned_At`,
  `Assigned_By`, `Removed_At`, `Removed_By`) and `RESPONSIBILITY_MEMBERS`
  (`Assignment_ID`, `Responsibility_ID`, `Member_ID`, `Assigned_At`, `Assigned_By`, `Removed_At`,
  `Removed_By`).
- One reviewed migration identifier: `008_task_and_responsibility_members` (`from: 7, to: 8`).
  It is never implied by an earlier approval.
- The primary owner columns stay authoritative; the migration copies no owner into a relationship
  table, creates no assignment, publishes nothing and enables no automation.
- The uncommitted local edit that had replaced the `TASK_REQUESTS.Task_Revision_At_Submission` type
  override with a `Due_Date_At_Submission` override was reverted: the task revision is an opaque
  digest and must keep the `string` type it had before.

## Evidence

| Check | Result |
| --- | --- |
| `migration 008 adds the relationship tables and assigns nobody` | PASS — returns `8`, both sheets exist, 0 relationship rows, exactly 1 verified backup |
| `each migration refuses to run without its own explicit approval and takes a verified backup` | PASS — approving only `007` still raises `not approved: 008...`; 3 backups from v5 |
| `approved upgrade preserves project, task ownership, skill records and existing cell positions` | PASS — 7 backups, every pre-existing cell preserved |
| `a version 5 workbook with preformatted checkbox rows upgrades additively` | PASS |
| `a new workbook records INITIALIZE_V8 and never pretends to have migrated` | PASS |
| `npm run validate` | PASS |

## Live items that remain BLOCKED

- Running `upgradeExistingDatabase()` against a real schema-7 DEV workbook, and confirming the
  cell-by-cell preservation check and the backup reference. **NOT_RUN.**
- Confirming the two new sheets appear with the documented headers in a real workbook. **NOT_RUN.**

See [V1_7_DEPLOYMENT_RUNBOOK.md](../V1_7_DEPLOYMENT_RUNBOOK.md) for the exact DEV procedure.
