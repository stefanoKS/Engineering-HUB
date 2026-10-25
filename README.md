# Engineering-HUB

Engineering project management using Google Sheets as the database, Google Apps Script as the application, and GitHub as the source-code history.

[日本語](README_JP.md) · [Architecture](ARCHITECTURE.md) · [Data schema](DATA_SCHEMA.md) · [Deployment](DEPLOYMENT.md) · [Backup and restore](BACKUP_RESTORE.md) · [Manager workflow](docs/MANAGER_WORKFLOW.md) · [Automation settings](docs/AUTOMATION_SETTINGS.md) · [Workspace smoke test](docs/GOOGLE_WORKSPACE_SMOKE_TEST.md)

## Safety first

- Develop in a **separate Apps Script project and spreadsheet**. Never point development at production data.
- Deploying code does not migrate data. Git cannot restore spreadsheet rows, Drive files, Script Properties, or triggers.
- Initialization is only for an explicitly selected, empty workbook. Existing data requires reviewed, explicitly approved migrations.
- Email and Calendar integrations are disabled by default; dry-run is enabled by default.
- The V1.1 manager UI requires a **container-bound** Apps Script project; a standalone script cannot open a sidebar.
- Manager preferences live in the workbook `AUTOMATION_SETTINGS` table, so deployments never reset them, while credentials stay in Script Properties.
- Drive snapshots require a restricted backup folder. Backups are retained; the application does not automatically delete them.

## Quick start

Use Node.js 22 (at least 22.13.0) and PowerShell:

```powershell
npm ci
npm run lint
npm test
npm run validate
```

Then follow [Deployment](DEPLOYMENT.md) to create an isolated development project, configure Script Properties, authorize the script through the Apps Script editor, and initialize an empty spreadsheet. `config.example.json` is a reference for **Script Properties**, not credentials or an automatically loaded configuration file.

## V1.1 — Management usability, reliability and automation controls

Schema version 3 adds migration `003_management_reliability` (additive only; existing values are verified
unchanged before it is recorded as successful).

- **Unknown effort stays unknown.** `Estimated_Hours` defaults to blank; `0` is a deliberate zero. Workload,
  dashboards and the weekly report count unestimated tasks separately.
- **Assignment approval and schedule confirmation are separate.** A task can be assigned with only a deadline.
  Approval requires an active owner and a verified account; schedule confirmation additionally requires a known
  estimate. Progress updates do not revoke approval, material changes do.
- **One eligibility policy** (`Eligibility.gs`) keeps archived/cancelled work out of active workload, dashboards,
  reminders and reports while retaining all records.
- **Effort-weighted progress and deterministic health.** Progress writes only the computed columns; health is a
  documented heuristic with configurable thresholds (`GREEN`/`YELLOW`/`RED` plus `UNKNOWN`, `PLANNED`,
  `ON_HOLD`, `COMPLETED`, `CANCELLED`, `ARCHIVED`).
- **Japanese manager UI** (container-bound): menu, task assignment, progress, members, skills, issues,
  milestones, automation settings and system status. All writes go through the validated domain services.
- **Automation control center:** OFF/PREVIEW/LIVE mail mode, per-feature switches, per-project and per-task
  switches, configurable reminder offsets with bounded catch-up, weekly management report, Calendar and backup
  switches, persisted status and audit records. See [Automation settings](docs/AUTOMATION_SETTINGS.md).
- **Roles:** `ADMIN` > `MANAGER` > `MEMBER` > `VIEWER`, resolved from the verified Google session. A blank role
  (for example after migrating) is treated as `VIEWER` until a manager assigns it.
- **Reverse planning** persists a versioned plan per project in `PROJECT_PHASES`; re-planning one project never
  replaces another project's plan.
- **Reliability:** the mail ledger reserves `PENDING` before sending, never retries ambiguous delivery
  automatically, supports administrative reconciliation to `DELIVERY_UNCERTAIN`, and previews without consuming
  live dedupe keys.

Detailed gate evidence is in [docs/checkgates](docs/checkgates/GATE_1.md). The manual Google Workspace
verification guide is [docs/GOOGLE_WORKSPACE_SMOKE_TEST.md](docs/GOOGLE_WORKSPACE_SMOKE_TEST.md); it has not been
executed in a live Workspace as part of this repository.

## Capabilities and boundaries

The application manages projects, members, skills, tasks, assignments, scheduling, progress, health and management views. Workspace automation is opt-in and must be reviewed before activation. The source and local tests are the implementation reference; local mocks do not prove that a live Google Workspace deployment, permissions, quotas, trigger delivery, or mail delivery works.

The bound manager UI is a Google Sheets menu with Japanese sidebars. Google Sheets editor access is not an
administrator boundary, so V1.1 assumes trusted managers only; a separate employee-facing application would be a
later release.

Google Sheets native Timeline availability depends on your Workspace edition and permissions. Set it up manually when supported; use the generated `GANTT_OVERVIEW` and `TIMELINE_DATA` sheets otherwise. Do not rely on automatic creation of a native Timeline.

This repository is a new implementation. No earlier prototype is included. There are no independently measured production performance benchmarks, claims of a complete resource-constrained critical-path solver, or guarantees of exactly-once external delivery. The local scale test uses mocks only.

## Typical development workflow

After initialization, run an editor wrapper like this **once in development**. These are example records, not production seed data; rerunning is not an upsert and may fail duplicate-email validation.

```javascript
function developmentExample() {
  var member = createMember({
    Name: 'Example Engineer', Email: 'engineer@example.invalid',
    Active: true, Role: 'MEMBER', Weekly_Capacity_Hours: 35
  });
  var project = createProject({
    Project_Name: 'Development example', Status: 'Active',
    Project_Owner_ID: member.Member_ID, Committed_Deadline: '2030-06-28'
  });
  var task = createTask({
    Project_ID: project.Project_ID, Task_Name: 'Review design',
    Owner_Member_ID: member.Member_ID, Planned_Start: '2030-06-03',
    Due_Date: '2030-06-07', Estimated_Hours: 8,
    Notification_Enabled: false
  });
  // Notifications must be activated once before assignment approval is accepted.
  activateNotifications('manager@example.invalid', 'ACTIVATE NOTIFICATIONS');
  approveTaskAssignment(task.Task_ID, 'manager@example.invalid', 'APPROVE ASSIGNMENT');
  confirmTaskSchedule(task.Task_ID, 'manager@example.invalid', 'CONFIRM SCHEDULE');
  refreshManagement();
  return {projectId: project.Project_ID, taskId: task.Task_ID};
}
```

`createMember` now defaults `Role` to `MEMBER`; assign `MANAGER`/`ADMIN` deliberately for operators. `refreshManagement()`
recalculates progress/health and refreshes dashboard, workload and skill views.

Use returned stable IDs with `updateProject(id, patch)`, `updateMember(id, patch)`, and `updateTask(id, patch)`. Set task `Status: 'Done'` together with `Progress_Percent: 100`. Reassign open tasks before deactivating a member; archive projects rather than deleting their history. Assignment approval is not permission to send mail: notification activation and the OFF/PREVIEW/LIVE gates are separate. Deadline-only assignment is valid; do not invent start dates or estimates.

For reverse planning, populate `PHASE_TEMPLATES` and `HOLIDAYS`, then call `reversePlan(projectId, '2030-06-28')`. Each project's plan is persisted in `PROJECT_PHASES`; review `BACKPLAN` for `DRAFT` phases and do not invent missing estimates. View refreshes replace generated output; keep manual notes elsewhere. See [Deployment](DEPLOYMENT.md) for exact activation and trigger entrypoints and [Manager workflow](docs/MANAGER_WORKFLOW.md) for the UI steps.

## Operations

1. Make and validate changes in development.
2. Review code and any migration separately.
3. Create and verify a restricted Drive backup before production data changes.
4. Deploy the reviewed source to the correct Apps Script project.
5. Apply only explicitly approved migrations, then inspect the resulting data.
6. Activate notifications and scheduled work only after the production checks in [Deployment](DEPLOYMENT.md).

See [AGENTS.md](AGENTS.md) for mandatory contributor safety rules and [CHANGELOG.md](CHANGELOG.md) for release notes.
