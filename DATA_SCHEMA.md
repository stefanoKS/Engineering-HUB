# Data schema

## Contract and versions

`src/Schema.gs` is authoritative. The current schema version is **2**. Version 1 has the base schema below except the following version-2 `TASKS` fields:

- `Assignment_Version` — numeric version, initially 1.
- `Assignment_Approved_At` — approval timestamp for the current assignment.
- `Notification_Baseline` — serialized assignment snapshot used to detect stale approvals.

Approved migration `002_task_assignment_safety` upgrades version 1 to 2. Fresh empty workbooks initialize directly to version 2. `SCHEMA_MIGRATIONS` records successful versions; changing code or a header manually does not apply a migration.

The upgrade appends missing schema elements; it does not invent assignment approvals for historical rows. Blank historical safety fields must pass the normal activation/reconciliation and approval flow before mail eligibility.

Headers are exact, case-sensitive field names in row 1. Application operations use stable IDs, not row numbers. Do not rename/delete headers, reorder only portions of a table, or edit operational log IDs. Custom columns are preserved by migrations and targeted updates but are not accepted as application input.

## Tables and complete field lists

The first field in each list is the stable primary key. Relationships are described below.

### PROJECTS

```text
Project_ID Project_Name Description Category Project_Owner_ID Status Priority
Planned_Start Forecast_End Committed_Deadline Original_Deadline Actual_Completion
Progress_Percent Health Next_Milestone Next_Action Last_Updated Created_At Archived_At
```

Required: `Project_Name`, `Status`. `Project_Owner_ID` references `MEMBERS`.

### SUBPROJECTS

```text
Subproject_ID Project_ID Subproject_Name Owner_ID Status Planned_Start Planned_End
Deadline Progress_Percent Estimated_Hours Next_Action Last_Updated
```

Required: `Project_ID`, `Subproject_Name`, `Status`. Project and owner reference `PROJECTS` and `MEMBERS`.

### TASKS

```text
Task_ID Project_ID Subproject_ID Task_Name Description Owner_Member_ID Status
Priority Planned_Start Due_Date Estimated_Hours Actual_Hours Progress_Percent
Dependency_IDs Acceptance_Criteria Next_Action Required_Skill_ID Required_Skill_Level
Assignment_Version Assignment_Approved_At Notification_Enabled Notification_Baseline
Created_At Last_Updated Completed_At
```

Required: `Project_ID`, `Task_Name`, `Owner_Member_ID`, `Status`. References: project → `PROJECTS`, subproject → `SUBPROJECTS`, owner → `MEMBERS`, required skill → `SKILLS`. `Dependency_IDs` contains comma-separated task IDs; the domain layer rejects missing, cross-project, and cyclic dependencies.

`Notification_Enabled` defaults to false. Approval and baseline fields are application-managed. Do not manually forge them to enable delivery.

### MILESTONES

```text
Milestone_ID Project_ID Subproject_ID Milestone_Name Owner_ID Target_Date Actual_Date
Gate_Type Status Acceptance_Criteria Verification_Result Calendar_Event_ID Calendar_Sync_Hash
```

Required: `Project_ID`, `Milestone_Name`. References: project → `PROJECTS`, subproject → `SUBPROJECTS`, owner → `MEMBERS`. Calendar fields are integration-managed.

### MEMBERS

```text
Member_ID Name Email Department Position Active Manager_ID Weekly_Capacity_Hours
```

Required: `Name`, `Email`, `Active`. `Active` is boolean and defaults to true; `Manager_ID` references another member. Deactivation preserves history rather than deleting members.

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

Required: `Member_ID`, `Skill_ID`, `Current_Level`. `Member_ID` and `Assessed_By` reference `MEMBERS`; `Skill_ID` references `SKILLS`. Preserve evidence and assessment history for review.

### ISSUES

```text
Issue_ID Project_ID Subproject_ID Task_ID Description Severity Status Owner_ID
Raised_Date Target_Close_Date Corrective_Action Last_Updated
```

Required: `Project_ID`, `Description`, `Status`. References point to the named project, subproject, task, and owner/member.

### NOTIFICATION_LOG

```text
Notification_ID Notification_Key Task_ID Recipient Notification_Type Assignment_Version
Created_At Sent_At Result Error_Details
```

Required: `Notification_Key`, `Result`. Keys distinguish task/owner/address/version/due-date and notification stage, or weekly management summary identity. `PENDING` is reserved before sending and remains unresolved after an uncertain send; `SENT` records confirmed return from MailApp, not confirmed recipient delivery. Do not delete pending rows to force a retry.

### AUDIT_LOG

```text
Audit_ID Timestamp Entity_Type Entity_ID Action Previous_Value New_Value Actor Result
```

Application history is not a tamper-proof security log: spreadsheet editors can modify it. Restrict access accordingly.

### SCHEMA_MIGRATIONS

```text
Migration_ID Applied_At Previous_Version New_Version Result Backup_Reference
```

Required: `Result`. Successful entries determine the schema version; failed entries retain the last version and backup reference for inspection.

### BACKUP_LOG

```text
Backup_ID Created_At Schema_Version Backup_Reference Result Error_Details
```

Required: `Result`. `Backup_Reference` is a Drive snapshot ID. This log alone does not prove that a backup is still accessible or retained.

### HOLIDAYS

```text
Holiday_ID Date Name
```

Required: `Date`. Planning excludes these dates and weekends.

### PHASE_TEMPLATES

```text
Phase_ID Phase_Name Duration_Days Buffer_Days Dependency_IDs
```

Required: `Phase_Name`. Dependencies refer to phase IDs, not task IDs. Reverse planning requires explicit unique phase IDs; known durations are positive integers and buffers are nonnegative integers. Missing duration means draft planning.

### SETTINGS

```text
Setting_ID Name Description
```

Required: `Name`. This table is not a substitute for runtime Script Properties. Initialization writes the reserved row `Setting_ID=DATABASE_ENVIRONMENT`, whose `Name` is the environment. Workbook access rejects a mismatching or duplicate marker when present; do not edit this marker or copy a production database into development. Independently verify bindings for older workbooks without a marker.

## Types, defaults and validation

- Primary keys are required and immutable. Application inserts generate IDs if omitted.
- Strings default to empty. `Created_At`, `Last_Updated`, and `Timestamp` default to the insertion time.
- Calendar dates use ISO `YYYY-MM-DD`; timestamps use `Date` objects or ISO datetimes. The workbook timezone is `Asia/Tokyo`. Scheduling and notification date boundaries should be checked during the development smoke test.
- `Progress_Percent` is numeric, defaults to 0, and is bounded 0–100.
- Hour fields are nonnegative numbers defaulting to 0; level fields are integers 0–4.
- Boolean fields require actual booleans through the application API, not arbitrary text.
- Task status: `Not Started`, `Assigned`, `In Progress`, `Blocked`, `On Hold`, `Done`, `Cancelled`.
- Project/subproject status: `Planned`, `Active`, `On Hold`, `Completed`, `Cancelled`, `Archived`.
- Priority and issue severity: `Low`, `Medium`, `High`, `Critical`.
- Issue status: `Open`, `In Progress`, `Closed`.

The registry assigns `datetime` to names ending `_At` and to `Last_Updated`/`Timestamp`; it assigns `date` to names ending `_Date`, `_Start`, `_End`, or `Deadline`, and to `HOLIDAYS.Date`. `Assignment_Version`, migration version fields, `Schema_Version`, `Duration_Days`, and `Buffer_Days` are numbers. `Active` and `Notification_Enabled` are booleans. Other fields are strings unless the rules above specify otherwise. The domain layer additionally normalizes date-like business fields such as `Actual_Completion`.

Primary IDs, creation/update timestamps, and project/subproject progress are marked non-editable in registry metadata; application-managed state must not be treated as arbitrary user input. Metadata alone is not an access-control system.

Use the domain APIs for cross-field rules, ownership checks, lifecycle transitions, and audit records. Spreadsheet data-validation controls are helpful but do not enforce every application invariant. Direct edits bypass the application and can invalidate relationships.

## Generated sheets: replaceable output

`DASHBOARD`, `TIMELINE_DATA`, `GANTT_OVERVIEW`, `WORKLOAD`, `SKILL_MATRIX`, and `BACKPLAN` are generated. Refreshing them may clear and replace their contents. Keep user notes and original records in operational tables or separate user-owned sheets.

Native Timeline creation is manual and edition-dependent: select the timeline source columns, use Sheets **Insert → Timeline** if available, and map start/end/title/group columns. Verify that Google recognizes the start/end columns as dates; use a separate derived range if conversion is needed so a view refresh does not overwrite manual work. Otherwise use `TIMELINE_DATA` and `GANTT_OVERVIEW` as ordinary sheets.
