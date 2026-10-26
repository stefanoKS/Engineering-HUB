# V1.4.1 gate 1 — simplified authorization policy

Status: **PASS (local only)** — live Google Workspace behaviour remains UNVERIFIED.

Scope: the role policy in `src/Access.gs`, the call sites in `src/Ui.gs`,
`src/Projects.gs`, `src/Subprojects.gs`, `src/Tasks.gs`, `src/Responsibilities.gs` and
`src/Members.gs`, and the global Apps Script entrypoints.

## Policy as implemented

```text
ADMIN   -> every record + privileged administration (roles, migrations, automation, backups)
MANAGER -> every project, subproject, task and responsibility in the department
MEMBER  -> only the tasks assigned to their own verified member record
VIEWER  -> read-only
```

`PROJECTS.Project_Owner_ID`, `SUBPROJECTS.Owner_ID`, `RESPONSIBILITIES.Owner_Member_ID` and
`TASKS.Owner_Member_ID` (for a manager) are accountability labels. The only ownership value that
still gates a write is `TASKS.Owner_Member_ID` for a `MEMBER`.

## What was checked

| Check | Evidence |
| --- | --- |
| ADMIN and MANAGER create/edit/archive a project, a subproject and a task | `tests/v1_4_1-stabilization.test.js` → "ADMIN and MANAGER both manage every project, subproject and task" |
| A manager edits a project owned by another manager | "ADMIN and MANAGER both manage every project, subproject and task"; `tests/v1_3_1-stabilization.test.js` → "any manager can edit a project owned by another manager" |
| A manager administers every responsibility regardless of its owner | `tests/v1_4-responsibilities.test.js` → "every manager may administer every responsibility, but the owner stays an ADMIN decision" |
| Responsibility ownership is accountability, not project permission | `tests/v1_4-responsibilities.test.js` → "responsibility ownership labels accountability without becoming a project permission" |
| A manager may transfer any project, including another manager's | `tests/v1_4-responsibilities.test.js` → "a transfer requires confirmation and a known target project for any manager" |
| MEMBER and VIEWER cannot change project structure | "MEMBER and VIEWER cannot change the project structure" |
| A MEMBER still updates progress on their own task only | "a MEMBER still updates progress on their own assigned task only" |
| Unverified identity and browser-supplied roles cannot authorize a write | "an unverified identity and browser-supplied roles cannot authorize a write" |
| Direct RPC entrypoints re-check the role | "direct RPC entrypoints re-check the role instead of trusting the caller" |
| Granting/revoking ADMIN or MANAGER stays ADMIN-only, self-change refused | "granting or revoking ADMIN and MANAGER stays an ADMIN decision"; `tests/gate-a-security.test.js` |
| The scheduled backup still runs without an interactive user | `tests/automation.test.js` → `scheduledDailyBackup` cases (the trigger path calls the service directly) |
| Tasks outside a manager's own projects are now editable | `tests/gate-a-security.test.js` → "members may update only their own tasks while managers cover the whole department" |

## Global entrypoints

Every record-mutating top-level function re-checks the role before delegating:
`createProject`, `updateProject`, `archiveProject`, `createSubproject`, `updateSubproject`,
`reparentSubproject`, `archiveSubproject`, `reactivateSubproject`, `createTask`, `updateTask`,
`reassignTask`, `completeTask`, `recordTaskBlocker`, `createResponsibility`,
`updateResponsibility`, `retireResponsibility`, `reactivateResponsibility`,
`reorderResponsibilities`, `transferProjectResponsibility`, `createMember`, `updateMember`,
`deactivateMember`, `createIssue`, `updateIssue`, `createMilestone`, `updateMilestone`,
`createSkill`, `updateSkill`, `setMemberSkill`, `createDatabaseBackup`.

Manager-only reads are gated (`listMembers`, `listResponsibilities`, `pendingRequests`,
`healthCheck`, `validateSystem`, `analyzeManagement`); `listProjects` and `listTasks` filter to the
caller's visible rows.

`createMember` accepts the first row of an empty workbook because no role can exist yet; that is
the documented bootstrap step in [DEPLOYMENT.md](../../DEPLOYMENT.md) and every later member needs
a manager. `Access.bootstrapAdministrator` still requires the allowlist, the exact confirmation and
an active member row.

## Not verified here

Real Google identities, `Session.getActiveUser()` in a Workspace domain, and the sidebar sandbox
were not exercised. Verify with at least one ADMIN, one MANAGER, one MEMBER and one VIEWER account
in a development deployment.
