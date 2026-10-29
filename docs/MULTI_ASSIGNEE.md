# Multiple assignees and multiple responsibility members (V1.7)

## 1. Model

| Concept | Where it lives | Who may change it |
| --- | --- | --- |
| Primary task assignee | `TASKS.Owner_Member_ID` | ADMIN / MANAGER |
| Additional task assignees | `TASK_ASSIGNEES` (`Removed_At` blank) | ADMIN / MANAGER |
| Primary responsibility owner | `RESPONSIBILITIES.Owner_Member_ID` | **ADMIN only** |
| Additional responsibility members | `RESPONSIBILITY_MEMBERS` (`Removed_At` blank) | ADMIN / MANAGER |
| Project owner | `PROJECTS.Project_Owner_ID` | ADMIN / MANAGER (accountability only) |

**Effective task assignees** = the primary owner plus every active relationship row.
**Effective responsibility members** = the primary owner plus every active relationship row.

The relationship tables hold *additional* members only. The primary columns are never copied into
them, so there is exactly one authoritative primary per record and no comma-separated identifier list
is stored anywhere.

## 2. Rules

- **Duplicate prevention.** A repeated identifier in one request is refused; the primary owner is
  never accepted as an additional member.
- **Inactive members.** A *new* assignment must name an existing, active member. An existing
  relationship survives a later deactivation, so an unrelated edit cannot drop it.
- **Removal keeps history.** Removing an additional member stamps `Removed_At` and `Removed_By`.
  Re-adding the same member reactivates the existing row instead of inserting a duplicate.
- **Approval is reconsidered.** Changing the assignee list bumps `Assignment_Version` and clears
  `Assignment_Approved_At`, exactly like any other material assignment change. A task assignment
  version already approved is never silently preserved.
- **Staleness.** Because the assignment version is part of the published task revision, a pending
  deadline change submitted before the membership change becomes `STALE` on approval instead of
  overwriting newer work.
- **Membership is not authorization.** An additional assignee or an additional responsibility member
  gains no manager capability. Every entrypoint still checks `Access`/`Roles` on the server, and
  ownership remains accountability, not permission.
- **Retirement preserves assignments.** Retiring a responsibility changes its status only; every
  membership row stays so the assignment history survives.
- **Deleting a record.** A task with any assignee row (even a removed one) is not permanently
  deletable, because the relationship is history. The dependency preflight reports it as a blocking
  `REFERENCE`.
- **Audit.** Each membership change writes one `TASK_ASSIGNEES_CHANGED` or
  `RESPONSIBILITY_MEMBERS_CHANGED` row to `AUDIT_LOG` with the added and removed identifiers.

## 3. Shared tasks stay one task

A task with several assignees is **one** task: one ID, one deadline, one status, one progress value
and one manager approval. Progress is never divided per assignee and no individual completion
percentage is invented. Any assigned worker may submit a completion report under the existing shared
viewer rules; the manager approval marks the shared task `Done` for everyone.

The manager task list shows the task once. The employee worker view shows it once per matching worker
filter, and `totals` counts it once, because counts come from a single filtered pass over published
tasks.

## 4. Performance

`src/Assignees.gs` builds one index per execution (`Database.memo`) from `TASK_ASSIGNEES`/
`RESPONSIBILITY_MEMBERS` plus `MEMBERS`. The manager task index, the member profile, the
responsibility list and the published snapshot all read through that index, so a 3,000-task list
performs one relationship read rather than one per task. The index is discarded on every write inside
the same execution.

## 5. Interface

- Task editor: primary assignee select + searchable "追加担当者" multi-select with removable chips.
- Responsibility editor: primary owner select + searchable "追加メンバー" multi-select.
- Task cards show a shared-assignment chip naming the additional assignees.
- Responsibility cards show the primary owner and the additional members separately.
- Task filtering accepts a member and matches the primary owner **or** any additional assignee.
- Member profile separates primary work, additional (shared) work, former work and recorded activity.
