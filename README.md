# Engineering-HUB

Engineering project management using Google Sheets as the database, Google Apps Script as the application, and GitHub as the source-code history.

[日本語](README_JP.md) · [Architecture](ARCHITECTURE.md) · [Data schema](DATA_SCHEMA.md) · [Deployment](DEPLOYMENT.md) · [Backup and restore](BACKUP_RESTORE.md)

## Safety first

- Develop in a **separate Apps Script project and spreadsheet**. Never point development at production data.
- Deploying code does not migrate data. Git cannot restore spreadsheet rows, Drive files, Script Properties, or triggers.
- Initialization is only for an explicitly selected, empty workbook. Existing data requires reviewed, explicitly approved migrations.
- Email and Calendar integrations are disabled by default; dry-run is enabled by default.
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

## Capabilities and boundaries

The application manages projects, members, skills, tasks, assignments, scheduling, and management views. Workspace automation is opt-in and must be reviewed before activation. The source and local tests are the implementation reference; local mocks do not prove that a live Google Workspace deployment, permissions, quotas, trigger delivery, or mail delivery works.

Google Sheets native Timeline availability depends on your Workspace edition and permissions. Set it up manually when supported; use the ordinary task and schedule sheets otherwise. Do not rely on automatic creation of a native Timeline.

This repository is a new implementation. No earlier prototype is included. There are no independently measured production performance benchmarks, claims of a complete resource-constrained critical-path solver, or guarantees of exactly-once external delivery.

## Typical development workflow

After initialization, run an editor wrapper like this **once in development**. These are example records, not production seed data; rerunning is not an upsert and may fail duplicate-email validation.

```javascript
function developmentExample() {
  var member = createMember({
    Name: 'Example Engineer', Email: 'engineer@example.invalid',
    Active: true, Weekly_Capacity_Hours: 35
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
  approveTaskAssignment(task.Task_ID);
  refreshDashboard();
  refreshWorkload();
  return {projectId: project.Project_ID, taskId: task.Task_ID};
}
```

Use returned stable IDs with `updateProject(id, patch)`, `updateMember(id, patch)`, and `updateTask(id, patch)`. Set task `Status: 'Done'` together with `Progress_Percent: 100`. Reassign open tasks before deactivating a member; archive projects rather than deleting their history. Assignment approval is not permission to send mail: notification activation and delivery gates are separate.

For reverse planning, populate `PHASE_TEMPLATES` and `HOLIDAYS`, then call `reversePlan(projectId, '2030-06-28')`. Review `BACKPLAN` for `DRAFT` phases and do not invent missing estimates. View refreshes replace generated output; keep manual notes elsewhere. See [Deployment](DEPLOYMENT.md) for exact activation and trigger entrypoints.

## Operations

1. Make and validate changes in development.
2. Review code and any migration separately.
3. Create and verify a restricted Drive backup before production data changes.
4. Deploy the reviewed source to the correct Apps Script project.
5. Apply only explicitly approved migrations, then inspect the resulting data.
6. Activate notifications and scheduled work only after the production checks in [Deployment](DEPLOYMENT.md).

See [AGENTS.md](AGENTS.md) for mandatory contributor safety rules and [CHANGELOG.md](CHANGELOG.md) for release notes.
