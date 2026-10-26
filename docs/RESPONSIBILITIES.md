# Responsibilities (担当領域) and nested subprojects

V1.4 adds two organizational tools to `設計・開発課 管理`:

1. **担当領域 / Responsibility** — a configurable area that groups projects.
2. **Nested subprojects** — one extra hierarchy level beneath a subproject.

Neither feature is a second database, a new deployment or a permission system. Both reuse the
existing tables, the existing audit log and the existing sanitized snapshot.

## 1. What a responsibility is

A responsibility represents an organizational area managed by a designated person, for example
製品設計 or 自動化・工程設計. The names are examples only: nothing in the code assumes a
particular set, a particular count, or the existence of any responsibility at all.

The manager can create, rename, describe, re-order, retire, reactivate and transfer between
responsibilities. A retirement is a status change; it never deletes a project, a task, a
milestone, an approval or a history row.

### Responsibility versus category

| | Responsibility (`PROJECTS.Responsibility_ID`) | Category (`PROJECTS.Category`) |
| --- | --- | --- |
| Purpose | Who organizes the work | What kind of work it is |
| Managed as | A table row with an owner and a status | Free text on the project |
| Retirement | Yes (kept for history) | Not applicable |
| Permission effect | None | None |

Both exist. V1.4 does not replace or remove the category.

## 2. Data model

`RESPONSIBILITIES`:

```text
Responsibility_ID Name Description Owner_Member_ID Status Sort_Order Created_At Updated_At Retired_At
```

- `Responsibility_ID` is generated as `RESP_<uuid>`, is immutable and is never reused. Renaming a
  responsibility therefore cannot rewrite historical project rows: projects reference the ID.
- `Status` is `Active` or `Retired`. `Retired_At` is stamped on retirement and cleared on
  reactivation. Both actions are audited.
- `Name` is required, at most 60 characters and unique among active rows. A retired name may be
  reused, because the retired row keeps its own identity for history.
- `Description` is internal only (at most 500 characters) and is never published to the shared
  dashboard.
- `Sort_Order` is the manager's display order. It never affects identity.

`PROJECTS.Responsibility_ID` is optional. Blank means 未分類 / Unassigned, which is how every
migrated project starts.

## 3. Authorization

The policy is defined once in `src/Access.gs` (`canManageResponsibility`) and used by every
entrypoint. Engineering-HUB is a single-department application, so authorization is
role-based and deliberately simple: there is no per-project, per-area or per-owner access
control.

| Role | Responsibility administration |
| --- | --- |
| ADMIN | Create, edit, re-order, retire, reactivate, change the owner, and transfer any project, including into a retired area with an extra confirmation. |
| MANAGER | Everything above except changing the owner: any manager administers any responsibility, and no ownership check stands between two collaborating managers. |
| MEMBER / VIEWER | None. |

Two invariants are deliberately preserved:

- **A responsibility is a grouping, never a permission.** Owning an area grants no extra
  access and restricts nothing; MANAGER access covers the department's projects because of
  the role, not because of an ownership column.
- **Changing `Responsibility_ID` never changes `Project_Owner_ID`.** The transfer writes one
  column plus the update timestamp and an audit record.

Everything is enforced on the server. A role, actor or owner value supplied by the browser is
data, never authority.

## 4. Operations

| Operation | Entry point | Notes |
| --- | --- | --- |
| Create | `Responsibilities.create` → `uiSaveResponsibility` | The creating manager becomes the owner. |
| Rename / describe | `Responsibilities.update` | The ID and history link are untouched. |
| Change owner | `Responsibilities.update` | ADMIN only. |
| Re-order | `Responsibilities.reorder` → `uiMoveResponsibility` | Every submitted ID is validated, duplicates and unknown IDs are refused, only changed `Sort_Order` values are written, and the result is recorded as `RESPONSIBILITY_REORDERED`. |
| Retire (廃止) | `Responsibilities.retire` → `uiRetireResponsibility` | Requires explicit confirmation; reports the number of open projects that remain. |
| Reactivate (再有効化) | `Responsibilities.reactivate` → `uiReactivateResponsibility` | Clears `Retired_At`. |
| Transfer a project | `Responsibilities.transferProject` → `uiUpdateProject` / `uiTransferProject` | Requires confirmation; recorded as `RESPONSIBILITY_TRANSFERRED` with both IDs and an optional reason. |

### Retirement behaviour (廃止)

The user-facing Japanese term is **廃止**, and the inverse action is **再有効化**; 退職/復職 are
reserved for people, never for organizational areas. The stored enum stays `Active` / `Retired`.

1. The manager sees the active-project count and confirms.
2. `Status` becomes `Retired` and `Retired_At` is stamped.
3. Every associated project, subproject, task, milestone, issue, approval and request row stays
   exactly as it was.
4. Projects still inside the retired area remain visible and actionable. The manager list marks
   them 「担当領域の再割当が必要です」, and they stay visible under the すべて filter.
5. The retired area remains available in lists and dashboard filters, and is not selectable for a
   new project.

### Transfer history

No extra history table was added: `AUDIT_LOG` already stores the entity, the action, the actor,
the previous and the new value in structured JSON. A transfer writes
`RESPONSIBILITY_TRANSFERRED` with `previousResponsibilityId`, `newResponsibilityId`, `reason` and
`actor`, which satisfies the V1.4 requirement without a second source of truth.

## 5. Nested subprojects

```text
Responsibility
    └── Project
         ├── Subproject            (level 1, Parent_Subproject_ID = "")
         │    ├── Nested subproject (level 2, Parent_Subproject_ID = <level 1>)
         │    │    └── Task
         │    └── Task
         └── Task
```

Rules, enforced by `Subprojects.validateHierarchy`:

1. Blank parent means a root subproject.
2. The parent must exist.
3. Parent and child must belong to the same project.
4. A subproject cannot parent itself.
5. Circular relationships are refused.
6. Maximum depth is two levels beneath the project; a third level is rejected.
7. Reparenting validates the whole affected subtree: moving a root that has children under
   another subproject is refused rather than silently flattened.
8. Existing `Subproject_ID` values and parent links are preserved by the migration.

Tasks may belong directly to the project, to a root subproject or to a nested subproject.

### Archiving

Archiving a subproject changes its own `Status` only. Child subprojects, tasks, owners, progress
and history all survive, nothing is cascaded and no descendant task is marked `Done`. Because
`Eligibility.taskInActiveWork` walks the whole ancestor chain, descendant tasks stop contributing
to active-work figures while the parent is archived, and return when it is reactivated.

### Moving a task

A task move is explicit (`Subprojects.moveTask` → `uiMoveTask`), needs confirmation, must stay in
the same project and must not target an archived subproject. The task keeps its ID, owner, dates,
duration, progress and history. `Subproject_ID` is one of the existing material assignment fields,
so the existing rule increments `Assignment_Version` once and clears `Assignment_Approved_At`;
the confirmed schedule is not a schedule change and survives.

## 6. Progress rollups

- A nested subproject reflects its directly assigned tasks.
- A parent subproject reflects its own tasks plus every descendant task.
- A project reflects every eligible task exactly once (its own task grouping).
- Weights are the existing ones: a known positive estimate is the weight, an unknown estimate
  keeps the documented fallback weight of 1 and is counted as unknown, zero-hour estimates carry
  no weight but are counted, and `Cancelled` tasks are excluded. No new weighting system and no
  invented hours.
- The calculation is batched: tables are read once, the hierarchy is built in memory, then the
  aggregates are produced. There is no recursive spreadsheet read.

## 7. Shared dashboard

Snapshot contract **1.4** adds:

- `PUBLISHED_RESPONSIBILITIES`: `responsibilityId`, `name`, `sortOrder`, `retired` — only for
  responsibilities that label at least one published project. The description and the owner are
  never published.
- `projects[].responsibilityId` / `responsibilityName`.
- `subprojects[].parentSubprojectId`, `level`, `directTasks`, `totalTasks` and hierarchical
  `progress`.

An older contract is rejected (`SNAPSHOT_CONTRACT_UNSUPPORTED`) rather than read as if it had the
new fields. The A/B slot, the content-hash verification and the single metadata commit are
unchanged. See [dashboard/DATA_CONTRACT.md](dashboard/DATA_CONTRACT.md).

## 8. Migration (5 → 6)

`006_responsibilities_and_nested_subprojects` is additive and uses the existing approved
workflow:

1. `APPROVED_MIGRATIONS` must contain the migration ID; otherwise nothing runs.
2. A restricted Drive backup is created and verified first.
3. Only missing tables/columns are appended; no existing cell, formula, custom column or ID is
   rewritten (`verifyPreserved`).
4. `RESPONSIBILITIES` is created empty. No example responsibility is seeded, and no project is
   assigned to one.
5. Existing projects get a blank `Responsibility_ID` (未分類); existing subprojects get a blank
   `Parent_Subproject_ID` (root).
6. Repeating the migration changes nothing and duplicates no column.

A new workbook initializes directly at version 6 with the same tables. Initialization is never a
way to upgrade an existing database.

## 9. Known limitations

- Responsibilities have no per-project ordering of their own; projects are ordered by their
  deadline/health rules inside each area, as before.
- The dashboard publishes the responsibility label only. It cannot be renamed from the viewer,
  and a retired label stays visible for historical projects.
- Responsibility ownership is an accountability label, not an administration scope or a data
  scope: it neither grants nor restricts access, and every manager sees the whole department.
- Everything in this document was verified with local mocks. Live Google Workspace behaviour
  (sidebar fit, menu routing, Drive backup permissions) still needs a development deployment; see
  [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md), which stays **NOT APPROVED**.
