# Shared dashboard data contract (V1.2)

The shared dashboard never reads the private management workbook. It reads one **sanitized
snapshot spreadsheet** whose structure is defined here. Everything in this document is
enforced by code and by tests:

- `src/SharedDashboardModel.gs` – allowlisted DTO construction and visibility rules.
- `src/SharedDashboardPublisher.gs` – writes the snapshot, verifies counts and hash, flips slots.
- `dashboard-app/DataService.gs` – reads the snapshot, validates headers, fails closed.
- `tests/v1_2-model.test.js`, `tests/v1_2-publisher.test.js`, `tests/v1_2-dashboard.test.js`.

Contract version: **1.2** (`PUBLISHED_META.CONTRACT_VERSION`). A reader that meets a different
contract version refuses to serve data instead of guessing.

## 1. Snapshot workbook layout

| Sheet | Content |
| --- | --- |
| `PUBLISHED_META` | Key/value metadata and the active slot pointer (commit point). |
| `PUBLISHED_PROJECTS_A` / `PUBLISHED_PROJECTS_B` | Project rows. |
| `PUBLISHED_SUBPROJECTS_A` / `_B` | Subproject rows. |
| `PUBLISHED_TASKS_A` / `_B` | Task rows. |
| `PUBLISHED_MILESTONES_A` / `_B` | Milestone rows. |

Two data slots (A/B) exist. A publication rewrites the **inactive** slot entirely, verifies
the read-back, and only then updates `PUBLISHED_META` in a single contiguous write. A failed
run therefore leaves the previously committed slot active and readable, and a partially
written slot is never marked active.

### Headers

Row 1 of every data sheet is the field list below, in this exact order. The viewer requires
an exact match; a mismatch is reported as `SNAPSHOT_CONTRACT_UNSUPPORTED`.

```text
PUBLISHED_PROJECTS
projectId projectName category ownerName status progress health committedDeadline
forecastDeadline summary lastUpdated terminal openTasks doneTasks overdueTasks
blockedTasks dueSoonTasks totalTasks

PUBLISHED_SUBPROJECTS
subprojectId projectId name ownerName status progress deadline terminal

PUBLISHED_TASKS
taskId projectId subprojectId name ownerName status priority plannedStart dueDate
progress publicNote

PUBLISHED_MILESTONES
milestoneId projectId subprojectId name targetDate actualDate status
```

`PUBLISHED_META` keys: `CONTRACT_VERSION`, `ACTIVE_SLOT`, `SNAPSHOT_VERSION`, `PUBLISHED_AT`,
`PUBLISHER_VERSION`, `CONTENT_HASH`, `AS_OF`, `PREVIOUS_SLOT`, `PROJECT_COUNT`,
`SUBPROJECT_COUNT`, `TASK_COUNT`, `MILESTONE_COUNT`, `RESULT`.

## 2. Field mapping and provenance

| Public field | Source | Notes |
| --- | --- | --- |
| `projectId` | `PROJECTS.Project_ID` | Stable ID, never a row number. |
| `projectName` | `PROJECTS.Project_Name` | |
| `category` | `PROJECTS.Category` | |
| `ownerName` | `MEMBERS.Name` via `PROJECTS.Project_Owner_ID` | Display name only. |
| `status` | `PROJECTS.Status` | |
| `progress` | computed | Effort-weighted rollup of published tasks (`Progress.rollup`). |
| `health` | computed | `Health.classify` with the persisted health thresholds. |
| `committedDeadline` | `PROJECTS.Committed_Deadline` | |
| `forecastDeadline` | `PROJECTS.Forecast_End` | |
| `summary` | `PROJECTS.Dashboard_Summary` | Approved public summary; never `Description`. |
| `lastUpdated` | `PROJECTS.Last_Updated` | Asia/Tokyo calendar date. |
| `terminal` | computed | `Completed`, `Cancelled` or `Archived`. |
| `openTasks` / `doneTasks` / `overdueTasks` / `blockedTasks` / `dueSoonTasks` / `totalTasks` | computed per project | Derived aggregates so the portfolio needs no task payload. Counted over published tasks only. |

`SUBPROJECTS` maps `Subproject_ID`, `Project_ID`, `Subproject_Name`, `Owner_ID` → `MEMBERS.Name`,
`Status`, computed `progress`, `Deadline` (falling back to `Planned_End`), `terminal`.

`TASKS` maps `Task_ID`, `Project_ID`, `Subproject_ID`, `Task_Name`, `Owner_Member_ID` →
`MEMBERS.Name`, `Status`, `Priority`, `Planned_Start`, `Due_Date`, computed `progress`
(`Progress.percent`) and **`Public_Note` only** as free text.

`MILESTONES` maps `Milestone_ID`, `Project_ID`, `Subproject_ID`, `Milestone_Name`,
`Target_Date`, `Actual_Date`, `Status`.

## 3. Visibility rules

- A project is published only when `PROJECTS.Dashboard_Visibility` is exactly `INTERNAL`.
- Blank, unknown and `RESTRICTED` values are all treated as `RESTRICTED`.
- Migrated workbooks leave the column blank, so **nothing is published until a manager
  reviews each project**. Migration `004_shared_dashboard` never publishes anything.
- A subproject is published only when its project is published.
- A task or milestone is published only when its project is published.
- A cross-project reference (a task or milestone whose subproject belongs to a *different*
  source project) is withheld and reported as `TASK_CROSS_PROJECT_REFERENCE` /
  `MILESTONE_CROSS_PROJECT_REFERENCE`.
- An unknown or unpublished subproject reference keeps the task visible under
  `全体タスク` and reports `TASK_UNKNOWN_SUBPROJECT` / `MILESTONE_UNKNOWN_SUBPROJECT`.
- Aggregates and progress are computed from published rows only, so a restricted sibling
  can never change a published number.

## 4. Prohibited fields

The following must never appear in the snapshot, in a viewer response or in a viewer log:

- E-mail addresses (`MEMBERS.Email`), `MEMBERS.Weekly_Capacity_Hours`, `MEMBERS.Position`,
  `MEMBERS.Manager_ID`, `MEMBERS.Department`.
- `MEMBER_SKILLS`, `SKILLS` assessment evidence, training actions and review dates.
- `NOTIFICATION_LOG`, `AUDIT_LOG`, `AUTOMATION_SETTINGS`, `SETTINGS`, `BACKUP_LOG`,
  `SCHEMA_MIGRATIONS`, `SCHEDULE_CONFIRMATIONS`, `PROJECT_PHASES`, `ISSUES`.
- Script Properties, OAuth tokens, deployment IDs, spreadsheet IDs, trigger IDs.
- `PROJECTS.Description`, `PROJECTS.Next_Action`, `PROJECTS.Next_Milestone`,
  `TASKS.Description`, `TASKS.Acceptance_Criteria`, `TASKS.Next_Action`,
  `TASKS.Dependency_IDs`, `TASKS.Estimated_Hours`, `TASKS.Actual_Hours`,
  `TASKS.Assignment_*`, private issue text and raw internal error details.

Two tests scan the published workbook and the viewer payload for these strings, so a new
column cannot be published by accident.

## 5. Viewer API surface

`google.script.run` in `dashboard-app` exposes exactly three functions:

| Function | Returns |
| --- | --- |
| `dashboardPortfolio({query})` | `{meta, indicators, projects[], filters}` – project summaries only. |
| `dashboardProject(projectId, {limit})` | project summary, subprojects with counts, bounded task list, milestones, counts. |
| `dashboardTask(projectId, taskId)` | one task plus its project/subproject names, `canEdit: false`. |

Every response is `{ok: true, data}` or `{ok: false, error: {code, message}}`. Codes:
`DASHBOARD_NOT_CONFIGURED`, `VIEWER_NOT_ALLOWED`, `SNAPSHOT_NOT_PUBLISHED`,
`SNAPSHOT_UNREADABLE`, `SNAPSHOT_CONTRACT_UNSUPPORTED`, `NOT_FOUND`, `UNEXPECTED_ERROR`.
Unknown exceptions are logged server-side and replaced with `UNEXPECTED_ERROR`, so internal
stack traces never reach a browser.

## 6. Bounds

| Bound | Value | Reason |
| --- | --- | --- |
| Portfolio projects per response | all published projects (~100 at the target scale) | summaries only; measured at ~38 KB for 80 projects in mock tests |
| Tasks per project response | 500 default, 1 000 maximum | `truncated` is reported; counts still cover every task |
| Search query length | 80 characters | bounded input |
| Cache entry size | 90 000 characters | CacheService key limit; larger payloads are not cached |
| Cache TTL | 300 s | keyed by snapshot version, date and query hash |

## 7. Deadline wording

All date arithmetic uses **Asia/Tokyo calendar dates**.

| Condition | Label |
| --- | --- |
| completed / terminal | `完了` |
| due today | `本日期限` |
| overdue | `<n>日超過` |
| no due date | `期限未設定` |
| otherwise | `あと<n>日` |

## Contract 1.3

Two fields are added to the published task table; no other field changes.

| Field | Type | Meaning |
| --- | --- | --- |
| `revision` | opaque string (16 hex chars) | hash of task ID, owner, deadline and assignment version; used to detect a stale request |
| `pendingRequest` | boolean (`TRUE`/`FALSE`) | a request is open for this task; no request text is published |

`PUBLISHED_TASKS` therefore becomes:

```
taskId, projectId, subprojectId, name, ownerName, status, priority, plannedStart,
dueDate, progress, publicNote, revision, pendingRequest
```

The viewer fails closed when `PUBLISHED_META.CONTRACT_VERSION` is not `1.3`, so an old
deployment keeps reading an older snapshot until a new publication happens.


## Contract 1.4

Contract 1.4 adds the responsibility label and the nested-subproject hierarchy. **The viewer
fails closed when `PUBLISHED_META.CONTRACT_VERSION` is not `1.4`**, so a snapshot written by an
older release is reported as `SNAPSHOT_CONTRACT_UNSUPPORTED` instead of being read as if it had
the new fields. Republish after deploying V1.4.

### New sheet

```text
PUBLISHED_RESPONSIBILITIES
responsibilityId name sortOrder retired
```

- Only responsibilities that label at least one **published** project appear, so no unpublished
  organizational area leaks through the filter metadata.
- `name` is the stored display name and is never translated. `retired` is `TRUE`/`FALSE`; a
  retired area stays published so historical projects keep their grouping and stay filterable.
- The description and the owner are internal and are never published.

### Changed sheets

```text
PUBLISHED_PROJECTS
projectId projectName category responsibilityId responsibilityName ownerName status progress
health committedDeadline forecastDeadline summary lastUpdated terminal openTasks doneTasks
overdueTasks blockedTasks dueSoonTasks totalTasks

PUBLISHED_SUBPROJECTS
subprojectId projectId parentSubprojectId level name ownerName status progress directTasks
totalTasks deadline terminal
```

| Field | Type | Meaning |
| --- | --- | --- |
| `responsibilityId` / `responsibilityName` | string | The published label; both are empty when the project is 未分類 |
| `parentSubprojectId` | string | Empty for a root subproject |
| `level` | number | 1 = root subproject, 2 = nested subproject |
| `directTasks` | number | Tasks assigned directly to this node |
| `totalTasks` | number | Tasks of this node plus every descendant node (counted once) |
| `progress` | number or empty | Effort-weighted rollup of `totalTasks`, using the same weights as the manager |

`PUBLISHED_TASKS` is unchanged from 1.3, and `PUBLISHED_MILESTONES` is unchanged from 1.2.

`PUBLISHED_META` gains `RESPONSIBILITY_COUNT` and keeps every earlier key.

### Viewer behaviour

- `dashboardPortfolio` returns `filters.responsibilities` as
  `{responsibilityId, name, retired}`, containing only areas used by a visible project.
- `dashboardProject` returns `subprojects` in hierarchy order (a child follows its parent) with
  `parentSubprojectId`, `level`, `totalTasks` and the hierarchical `progress`.
- No task row is ever duplicated, and a restricted project still publishes nothing — including
  its responsibility, unless another published project uses the same area.
