# Data schema

## V1.5 compatibility

Schema remains **6** and employee snapshot contract remains **1.4**. V1.5 adds no tables, fields, migrations or persisted revision columns. Web edit revisions are SHA-256 digests computed from schema-known record fields. IDs, operational custom columns and formulas remain preserved. Canonical date handling changes representation at the snapshot boundary, not the contract. Use the existing reviewed migration procedures only for older databases; a schema-6 code update must not initialize or migrate data.


## Contract and versions

`src/Schema.gs` is authoritative. The current schema version is **6**.

| Version | Migration | Adds |
| --- | --- | --- |
| 1 | — | Base tables and fields |
| 2 | `002_task_assignment_safety` | `TASKS.Assignment_Version`, `Assignment_Approved_At`, `Notification_Baseline` |
| 3 | `003_management_reliability` | `AUTOMATION_SETTINGS`, `PROJECT_PHASES`, `SCHEDULE_CONFIRMATIONS`, `PROJECTS.Notification_Enabled`, `MEMBERS.Role`, `NOTIFICATION_LOG.Reconciled_At`/`Reconciled_By`, seeded safe automation defaults (mail OFF) |
| 4 | `004_shared_dashboard` | `PROJECTS.Dashboard_Visibility`, `PROJECTS.Dashboard_Summary`, `TASKS.Public_Note` (additive; publishes nothing by itself) |
| 5 | `005_task_planning_and_requests` | `TASKS.Planned_Duration_Value`/`_Unit`/`_Basis`/`Planned_Start_Source`, `TASK_REQUESTS`, `TASK_DEADLINE_HISTORY` |
| 6 | `006_responsibilities_and_nested_subprojects` | `RESPONSIBILITIES` (new table), `PROJECTS.Responsibility_ID`, `SUBPROJECTS.Parent_Subproject_ID` (additive; seeds no responsibility and leaves every existing project unassigned) |

Approved migrations upgrade one version at a time, each with its own verified backup. Fresh empty workbooks
initialize directly to version 6. `SCHEMA_MIGRATIONS` records successful versions; changing code or a header
manually does not apply a migration.

The upgrade appends missing schema elements; it does not invent assignment approvals, roles or notification
baselines for historical rows. Blank historical safety fields must pass the normal activation/reconciliation,
approval and role-assignment flow.

Headers are exact, case-sensitive field names in row 1. Application operations use stable IDs, not row numbers.
Do not rename/delete headers, reorder only portions of a table, or edit operational log IDs. Custom columns are
preserved by migrations and targeted updates but are not accepted as application input.

## Tables and complete field lists

The first field in each list is the stable primary key. Relationships are described below.

### PROJECTS

```text
Project_ID Project_Name Description Category Responsibility_ID Project_Owner_ID Status Priority
Planned_Start Forecast_End Committed_Deadline Original_Deadline Actual_Completion
Progress_Percent Health Next_Milestone Next_Action Last_Updated Created_At Archived_At Notification_Enabled
Dashboard_Visibility Dashboard_Summary
```

Required: `Project_Name`, `Status`. `Project_Owner_ID` references `MEMBERS`; `Responsibility_ID` references
`RESPONSIBILITIES` and may be blank.

- `Responsibility_ID` is the organizational area (担当領域). Blank means 未分類. It is a grouping concept, not a
  permission boundary: any ADMIN or MANAGER may file or move a project here, and a change never rewrites
  `Project_Owner_ID`. `Category` is a separate, free-form classification and is unchanged by V1.4.

- `Original_Deadline` is captured at creation and is immutable; `Committed_Deadline` may change.
- `Progress_Percent` and `Health` are computed by refresh and may be overwritten.
- `Last_Updated` is application-managed: domain changes to tasks/subprojects/issues/milestones touch it; a
  dashboard refresh does not.
- `Notification_Enabled` is boolean. Blank keeps the previous behaviour (notifications allowed); `false` suppresses
  every notification for the project.
- `Dashboard_Visibility` is `INTERNAL` or `RESTRICTED` and defaults to `RESTRICTED`. Only `INTERNAL` projects are
  written to the shared dashboard snapshot; a blank value (every migrated row) is treated as `RESTRICTED`, so
  nothing is published until a manager reviews the project.
- `Dashboard_Summary` is the approved public summary. `Description`, `Next_Action` and `Next_Milestone` are never
  published. See [docs/dashboard/DATA_CONTRACT.md](docs/dashboard/DATA_CONTRACT.md).
- Since V1.3.1 the manager sidebar edits `Dashboard_Visibility` and `Dashboard_Summary` directly through
  `Ui.updateProject` → `Projects.update`. Every change is audited (`UI_PROJECT_UPDATED`) and only appears in the
  shared dashboard at the next publication; the API does not touch the snapshot.

### RESPONSIBILITIES

```text
Responsibility_ID Name Description Owner_Member_ID Status Sort_Order
Created_At Updated_At Retired_At
```

Required: `Name`, `Status` (`Active` / `Retired`). `Responsibility_ID` is generated (`RESP_<uuid>`), immutable and
never reused. `Owner_Member_ID` references `MEMBERS`.

- `Name` is unique among **active** rows only; a retired name may be reused because the retired row keeps its own ID.
- `Sort_Order` controls the manager's display order and never affects identity.
- `Retired_At` is set by retirement and cleared by reactivation; both are status changes, never deletions.
- Retirement keeps every project, task, milestone and history row. A retired responsibility stays visible in lists
  and filters and is no longer selectable for new work.
- `Owner_Member_ID` records who is accountable for the area. It grants no data access and never limits another
  manager: every ADMIN and MANAGER administers every responsibility (simplified V1.4.1 policy). Only an ADMIN may
  change this owner. See [docs/RESPONSIBILITIES.md](docs/RESPONSIBILITIES.md) and
  [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).

### SUBPROJECTS

```text
Subproject_ID Project_ID Parent_Subproject_ID Subproject_Name Owner_ID Status Planned_Start Planned_End
Deadline Progress_Percent Estimated_Hours Next_Action Last_Updated
```

Required: `Project_ID`, `Subproject_Name`, `Status`. Project, parent and owner reference `PROJECTS`, `SUBPROJECTS`
and `MEMBERS`. `Estimated_Hours` defaults to blank (unknown).

- `Parent_Subproject_ID` blank is a root subproject, so every pre-V1.4 row keeps its meaning.
- At most two subproject levels exist beneath a project. A parent and its child must belong to the same project,
  a subproject cannot parent itself and circular references are refused. Reparenting validates the whole affected
  subtree, so a move that would push a descendant to level three is rejected instead of flattened.
- A parent subproject's progress covers its own tasks plus every descendant task exactly once. It is never an
  average of child percentages.

### TASKS

```text
Task_ID Project_ID Subproject_ID Task_Name Description Owner_Member_ID Status
Priority Planned_Start Due_Date Estimated_Hours Actual_Hours Progress_Percent
Dependency_IDs Acceptance_Criteria Next_Action Required_Skill_ID Required_Skill_Level
Assignment_Version Assignment_Approved_At Notification_Enabled Notification_Baseline
Created_At Last_Updated Completed_At Public_Note
```

Required: `Project_ID`, `Task_Name`, `Owner_Member_ID`, `Status`. References: project → `PROJECTS`, subproject →
`SUBPROJECTS`, owner → `MEMBERS`, required skill → `SKILLS`. `Dependency_IDs` contains comma-separated task IDs;
the domain layer rejects missing, cross-project, and cyclic dependencies.

- `Estimated_Hours` defaults to **blank** = unknown. `0` is a known zero estimate. Unknown is never rewritten to
  zero and is reported separately in workload/progress/report output.
- `Notification_Enabled` defaults to false.
- `Assignment_Version` starts at 1 and increments on material assignment changes (owner, project, subproject,
  planned start, due date, estimate, task name, dependencies, priority, acceptance criteria, required skill and
  level). Progress updates do not increment it.
- `Assignment_Approved_At` requires a verified active account, an active owner and an explicit confirmation; it is
  cleared by material assignment changes. `Notification_Baseline` is an application-managed snapshot.
- Do not manually forge the approval/baseline fields to enable delivery.
- A deadline-only task (no `Planned_Start`, no `Estimated_Hours`) is valid.
- `Public_Note` is the only task free text that may be published to the shared dashboard. `Description`,
  `Acceptance_Criteria`, `Next_Action`, `Dependency_IDs`, `Estimated_Hours` and `Actual_Hours` are never published.
- `Last_Updated` is stamped by `Tasks.update` on every task write (V1.3.1). The manager sidebar echoes the value it
  loaded and `Ui.assignTask` refuses an update when the stored value changed, so an editing form cannot overwrite a
  newer save. It is not a published field.

### SCHEDULE_CONFIRMATIONS

```text
Schedule_Confirmation_ID Task_ID Active Version Planned_Start Due_Date Estimated_Hours
Confirmed_At Confirmed_By Notes
```

Required: `Task_ID`, `Confirmed_At`. `Task_ID` references `TASKS`. One active row per task; changing the task's
dates or estimate sets `Active=false` (history retained, never deleted) and the next confirmation increments
`Version`. Confirmation requires a deadline and a known estimate.

### MILESTONES

```text
Milestone_ID Project_ID Subproject_ID Milestone_Name Owner_ID Target_Date Actual_Date
Gate_Type Status Acceptance_Criteria Verification_Result Calendar_Event_ID Calendar_Sync_Hash
```

Required: `Project_ID`, `Milestone_Name`. References: project → `PROJECTS`, subproject → `SUBPROJECTS`, owner →
`MEMBERS`. Calendar fields are integration-managed.

### MEMBERS

```text
Member_ID Name Email Department Position Active Manager_ID Weekly_Capacity_Hours Role
```

Required: `Name`, `Email`, `Active`. `Active` defaults to true; `Manager_ID` references another member.
`Role` is one of `ADMIN`, `MANAGER`, `MEMBER`, `VIEWER` and defaults to `MEMBER` for new rows. A **blank** role
(existing/migrated rows) is treated as `VIEWER`: no privilege is invented by a migration. Deactivation preserves
history and is refused while open tasks remain.

Role changes are application-controlled: only `ADMIN` may grant or revoke `ADMIN`/`MANAGER`, a member cannot change
their own role record, and the last active `ADMIN` cannot be demoted or deactivated. The first administrator is
created by `bootstrapFirstAdministrator` (deployment allowlist + exact confirmation + audited). See
[SECURITY_MODEL.md](docs/SECURITY_MODEL.md).

Manual edits to `Role` bypass these checks — spreadsheet editors are trusted by definition. Use the UI or the
domain API.

### SKILLS

```text
Skill_ID Skill_Name Category Description Required_Level
```

Required: `Skill_Name`. Skill levels range from 0 through 4.

### MEMBER_SKILLS

```text
Member_Skill_ID Member_ID Skill_ID Current_Level Assessment_Date Assessed_By Evidence
Training_Action Next_Review_Date
```

Required: `Member_ID`, `Skill_ID`, `Current_Level`. `Member_ID` and `Assessed_By` reference `MEMBERS`; `Skill_ID`
references `SKILLS`. Preserve evidence and assessment history for review. Skill gaps are advisory.

### ISSUES

```text
Issue_ID Project_ID Subproject_ID Task_ID Description Severity Status Owner_ID
Raised_Date Target_Close_Date Corrective_Action Last_Updated
```

Required: `Project_ID`, `Description`, `Status`. References point to the named project, subproject, task, and
owner/member.

### NOTIFICATION_LOG

```text
Notification_ID Notification_Key Task_ID Recipient Notification_Type Assignment_Version
Created_At Sent_At Result Error_Details Reconciled_At Reconciled_By
```

Required: `Notification_Key`, `Result`. Keys distinguish task/owner/address/version/due-date and notification
stage, or weekly management summary/report identity. Preview keys are prefixed `PREVIEW:`.

Result values:

| Result | Meaning |
| --- | --- |
| `PENDING` | Reserved before the send; still unresolved after an ambiguous failure |
| `SENT` | MailApp returned successfully (not proof of recipient delivery) |
| `PREVIEW` | Preview mode; never sent and never consumes live keys |
| `DELIVERY_UNCERTAIN` | Reconciled administrative state; never automatically resent |
| `DRY_RUN` | Legacy dry-run counter (no row is written in legacy mode) |

Do not delete pending rows to force a retry.

### AUDIT_LOG

```text
Audit_ID Timestamp Entity_Type Entity_ID Action Previous_Value New_Value Actor Result
```

Application history is not a tamper-proof security log: spreadsheet editors can modify it. Restrict access
accordingly. V1.1 actions include `SETTING_CHANGED`, `SCHEDULE_CONFIRMED`, `SCHEDULE_CONFIRMATION_INVALIDATED`,
`TRIGGERS_INSTALLED`, `DELIVERY_RECONCILED`, `UI_PROJECT_CREATED`, `UI_SUBPROJECT_CREATED`, `UI_TASK_ASSIGNED`,
`ADMIN_BOOTSTRAPPED`, `EMAIL_LIVE_ACTIVATED`, `EMAIL_LIVE_DEACTIVATED`. V1.2 adds
`SHARED_DASHBOARD_INITIALIZED`, `SHARED_DASHBOARD_PUBLICATION_APPROVED`,
`SHARED_DASHBOARD_PUBLICATION_DISABLED`, `SHARED_DASHBOARD_PUBLISHED` and
`SHARED_DASHBOARD_PUBLICATION_FAILED`.

### SCHEMA_MIGRATIONS

```text
Migration_ID Applied_At Previous_Version New_Version Result Backup_Reference
```

Required: `Result`. Successful entries determine the schema version; failed entries retain the last version and
backup reference for inspection.

### BACKUP_LOG

```text
Backup_ID Created_At Schema_Version Backup_Reference Result Error_Details
```

Required: `Result`. `Backup_Reference` is a Drive snapshot ID. This log alone does not prove that a backup is
still accessible or retained.

### HOLIDAYS

```text
Holiday_ID Date Name
```

Required: `Date`. Planning excludes these dates and weekends.

### PHASE_TEMPLATES

```text
Phase_ID Phase_Name Duration_Days Buffer_Days Dependency_IDs
```

Required: `Phase_Name`. Dependencies refer to phase IDs, not task IDs. Reverse planning requires explicit unique
phase IDs; known durations are positive integers and buffers are nonnegative integers. Missing duration means
draft planning.

### PROJECT_PHASES

```text
Project_Phase_ID Project_ID Phase_ID Phase_Name Phase_Order Duration_Days Buffer_Days
Dependency_IDs Planned_Start Planned_End Status Committed_Deadline Plan_Version Active Created_At
```

Required: `Project_ID`, `Phase_Name`, `Status` (`DRAFT` or `PLANNED`). This is the persistent, project-linked
plan. Re-planning a project supersedes only that project's active rows (`Active=false`) and increments
`Plan_Version`; other projects keep their plans. `Committed_Deadline` keeps the committed deadline separate from
generated dates. Rows are never deleted by planning.

### AUTOMATION_SETTINGS

```text
Setting_ID Value Description Updated_At Updated_By
```

`Setting_ID` is the setting key. `Value` is JSON text. Application-managed status keys
(`LAST_DASHBOARD_REFRESH_AT`, `LAST_BACKUP_TIME`, …) cannot be written from the settings form. See
[AUTOMATION_SETTINGS.md](docs/AUTOMATION_SETTINGS.md) for the full key list, defaults and the effective-mode
resolver. This table is operational data: deployments do not reset it, and backups include it.

### SETTINGS

```text
Setting_ID Name Description
```

Required: `Name`. This table is not a substitute for runtime Script Properties. Initialization writes the reserved
row `Setting_ID=DATABASE_ENVIRONMENT`, whose `Name` is the environment. Workbook access rejects a mismatching or
duplicate marker when present; do not edit this marker or copy a production database into development.
Independently verify bindings for older workbooks without a marker.

## Types, defaults and validation

- Primary keys are required and immutable. Application inserts generate IDs if omitted.
- Strings default to empty. `Created_At`, `Last_Updated`, and `Timestamp` default to the insertion time.
- Calendar dates use ISO `YYYY-MM-DD`; timestamps use `Date` objects or ISO datetimes. The workbook timezone is
  `Asia/Tokyo`.
- `Progress_Percent` is numeric, bounded 0–100. Project/subproject progress is computed.
- Hour fields are nonnegative numbers. `Estimated_Hours` defaults to **blank (unknown)** in `TASKS` and
  `SUBPROJECTS`; `Actual_Hours` and capacity default to 0. Level fields are integers 0–4.
- Boolean fields require actual booleans through the application API, not arbitrary text.
- Task status: `Not Started`, `Assigned`, `In Progress`, `Blocked`, `On Hold`, `Done`, `Cancelled`.
- Project/subproject status: `Planned`, `Active`, `On Hold`, `Completed`, `Cancelled`, `Archived`.
- Priority and issue severity: `Low`, `Medium`, `High`, `Critical`. Issue status: `Open`, `In Progress`, `Closed`.
- Member role: `ADMIN`, `MANAGER`, `MEMBER`, `VIEWER`.
- Phase status: `DRAFT`, `PLANNED`.

The registry assigns `datetime` to names ending `_At` and to `Last_Updated`/`Timestamp`; it assigns `date` to names
ending `_Date`, `_Start`, `_End`, or `Deadline`, and to `HOLIDAYS.Date`. `Assignment_Version`, `Plan_Version`,
`Phase_Order`, migration version fields, `Schema_Version`, `Duration_Days`, and `Buffer_Days` are numbers. `Active`
and `Notification_Enabled` are booleans.

Computed versus manually editable:

| Field | Owner |
| --- | --- |
| `PROJECTS.Progress_Percent`, `SUBPROJECTS.Progress_Percent`, `PROJECTS.Health` | Computed by refresh; manual edits are overwritten |
| `PROJECTS.Last_Updated` | Application-managed (domain changes only, never a dashboard refresh) |
| `TASKS.Assignment_Version`, `Assignment_Approved_At`, `Notification_Baseline`, `Completed_At` | Application-managed |
| `SCHEDULE_CONFIRMATIONS.*` | Application-managed |
| `NOTIFICATION_LOG.*`, `AUDIT_LOG.*`, `BACKUP_LOG.*`, `SCHEMA_MIGRATIONS.*` | Application-managed logs |
| `AUTOMATION_SETTINGS` status keys (`LAST_*`, `CALENDAR_LAST_SYNC_*`) | Application-managed |
| Everything else | Operator-maintained |

The hardening release changed **no schema**: version 3 is unchanged from the previous V1.1 release. The trigger
schedule signature (`MANAGED_TRIGGER_SIGNATURE`) and the bootstrap marker (`ADMIN_BOOTSTRAP_COMPLETED_AT`) are
Script Properties, not columns.

Primary IDs, creation/update timestamps, and project/subproject progress are marked non-editable in registry
metadata; application-managed state must not be treated as arbitrary user input. Metadata alone is not an
access-control system.

Use the domain APIs for cross-field rules, ownership checks, lifecycle transitions, and audit records. Spreadsheet
data-validation controls are helpful but do not enforce every application invariant. Direct edits bypass the
application and can invalidate relationships.

## Generated sheets: replaceable output

`DASHBOARD`, `PROJECT_OVERVIEW`, `TEAM_VIEW`, `TIMELINE_DATA`, `GANTT_OVERVIEW`, `WORKLOAD`, `SKILL_MATRIX`,
`BACKPLAN`, and `AUTOMATION_STATUS` are generated. Refreshing them may clear and replace their contents. Keep user
notes and original records in operational tables or separate user-owned sheets.

Native Timeline creation is manual and edition-dependent: select the timeline source columns, use Sheets
**Insert → Timeline** if available, and map start/end/title/group columns. Verify that Google recognizes the
start/end columns as dates; use a separate derived range if conversion is needed so a view refresh does not
overwrite manual work. Otherwise use `TIMELINE_DATA` and `GANTT_OVERVIEW` as ordinary sheets.

## Schema version 5 — task planning and worker requests

Migration `005_task_planning_and_requests` (from 4 to 5) is additive. It appends columns and
tables, takes a verified backup first, and requires explicit approval through
`APPROVED_MIGRATIONS`. No existing cell, formula or custom column is rewritten, and no
historical duration is inferred from old dates.

### TASKS (added columns)

| Column | Type | Meaning |
| --- | --- | --- |
| `Planned_Duration_Value` | integer ≥ 0, blank allowed | required duration; blank means unknown |
| `Planned_Duration_Unit` | `DAY` / `WEEK` | duration unit |
| `Planned_Duration_Basis` | `WORKING_DAYS` / `CALENDAR_DAYS` | calendar basis |
| `Planned_Start_Source` | `DERIVED` / `LEGACY` / `MANUAL` / blank | how `Planned_Start` was produced |

`Planned_Start` is recalculated only when a duration and a deadline are present. A blank
source on a pre-V5 row means `LEGACY`: the stored start stays valid and is not relabelled by
an unrelated update.

### TASK_REQUESTS (new)

| Column | Meaning |
| --- | --- |
| `Request_ID` | permanent ID, equal to the inbox request ID |
| `Request_Type` | `DEADLINE_CHANGE` or `COMPLETION_REPORT` |
| `Task_ID`, `Project_ID` | targets (validated references) |
| `Requester_Name` | unverified self-reported name |
| `Submitted_At` | submission timestamp (from the dashboard) |
| `Original_Due_Date`, `Requested_Due_Date` | deadline at submission and requested deadline |
| `Reason`, `Explanation`, `Completion_Note` | stored free text, never translated |
| `Status` | `PENDING`, `PROCESSING`, `APPROVED`, `REJECTED`, `RETURNED`, `WITHDRAWN`, `STALE` |
| `Reviewer`, `Decided_At`, `Decision_Note` | decision record |
| `Task_Revision_At_Submission` | opaque task revision for staleness detection |
| `Due_Date_At_Submission` | deadline at import time |
| `Reported_Completion_At`, `Accepted_Completion_At` | worker report vs manager acceptance |
| `Inbox_Request_ID`, `Imported_At`, `Snapshot_Version` | idempotent import bookkeeping |

`PROCESSING` is an internal recovery marker, not a user-facing state.

### TASK_DEADLINE_HISTORY (new)

`History_ID`, `Task_ID`, `Request_ID`, `Previous_Due_Date`, `New_Due_Date`,
`Previous_Planned_Start`, `New_Planned_Start`, `Reason`, `Changed_At`, `Changed_By`,
`Source`. Rows are never deleted; superseded history is retained.

### Automation settings

`DEADLINE_REQUEST_EMAIL_ENABLED`, `COMPLETION_REPORT_EMAIL_ENABLED` and
`PENDING_REQUEST_REMINDER_ENABLED` default to `false`, plus the status keys
`LAST_REQUEST_IMPORT_AT` and `LAST_PENDING_REQUEST_REMINDER_AT`.

