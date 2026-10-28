# V1.6 deployment runbook (DEV first, never automatic)

Status: **NOT EXECUTED** — this document is a procedure only. Nothing was deployed, migrated, initialized,
triggered or published from this repository session. Live Workspace verification remains **BLOCKED**.

Read [MANAGER_WEB_APP_DEPLOYMENT.md](MANAGER_WEB_APP_DEPLOYMENT.md),
[REQUEST_INBOX_DEPLOYMENT.md](REQUEST_INBOX_DEPLOYMENT.md) and
[dashboard/DEPLOYMENT.md](dashboard/DEPLOYMENT.md) first. Keep development and production in separate Apps
Script projects, spreadsheets and clasp configurations.

## 0. Prerequisites

- Node.js 22 tools: `npm ci`, `npm run lint`, `npm test`, `npm run validate`,
  `node scripts/manager-web-benchmark.js` all green locally.
- `APPROVED_MIGRATIONS` in DEV contains exactly `007_responsibility_hierarchy_and_lifecycle` (in addition to any
  earlier approved IDs still pending for that workbook).
- `BACKUP_FOLDER_ID` points at a restricted Drive folder that the operating account can write to.
- DEV `.clasp.json` targets the DEV manager project; `.clasp.dashboard-dev.json` targets the DEV employee
  project. Neither may be production.

**Order matters.** Apps Script serves the *deployed* version while the *head* version holds the pushed code. The
migration below is part of the new code, so the new code is pushed to the head **before** the migration runs, and
the deployment is only replaced after the migration was verified. Doing it the other way round either runs a
migration that does not exist yet or exposes the new code to users before its schema exists.

## 1. Manager code push (head only, deployment unchanged)

1. `git fetch` and confirm the delivery commit; `git status` clean apart from intended files.
2. Record the current `SCHEMA_MIGRATIONS` version (expect 6) and the live DEV deployment version.
3. `npx clasp status`, then `npx clasp push` into the **DEV** manager project. Do **not** create a deployment
   version yet: the running deployment still serves the previous code.
4. Confirm `src/appsscript.json` still has `webapp.access = DOMAIN`, `executeAs = USER_ACCESSING` and no new scope.

## 2. DEV backup and schema migration

1. From the editor (head version), run `createDatabaseBackup()` as an ADMIN. It writes a *verified* private copy
   in `BACKUP_FOLDER_ID` and a `BACKUP_LOG` row; a failed backup **stops** the migration. Record the reference.
2. Run `upgradeExistingDatabase()` once. It takes its own verified backup as well.
3. Confirm `SCHEMA_MIGRATIONS` shows one new `SUCCESS` row and the version is 7.
4. Confirm `TASKS`, `PROJECTS`, `SUBPROJECTS` and `RESPONSIBILITIES` gained only the documented new columns, the
   row counts are unchanged and spot-checked cells plus manual columns/formulas are intact.
5. Re-run `upgradeExistingDatabase()`: it must be a no-op with no extra backup.
6. Open `SCHEMA_MIGRATIONS`/`AUTOMATION_SETTINGS`: nothing was published, no trigger installed, mail still OFF.

Recovery: if a step fails, stop. Do not edit headers by hand. Restore from the verified backup file recorded in
`SCHEMA_MIGRATIONS`/`BACKUP_LOG` and reopen the failed step; see [BACKUP_RESTORE.md](../BACKUP_RESTORE.md).

## 3. Manager web-app deployment

1. Create a **new** deployment version from the verified head code; never edit the existing deployment in place.
2. Keep `MANAGER_WEB_ALLOWED_DOMAINS` set for the DEV domain before opening the URL.
3. Open as ADMIN: the responsibility section appears above the KPIs and the twelve new labels render in Japanese.
4. Switch to English and confirm the same screen keeps its selected responsibility, project and filters.
5. Select one area and confirm the KPI, project and upcoming figures change together (the scope is resolved
   server-side before paging; a container task never adds to the open or overdue count).
6. Open as MANAGER: everything except member/skill administration is usable. The permanent-delete control is only
   rendered for ADMIN.
7. Open as an employee account outside the allowlist: `MANAGER_ACCESS_DENIED`, no data.

## 4. Employee contract compatibility

1. The manager publisher writes `CONTRACT_VERSION = 1.5`.
2. The employee app in this release reads contracts **1.4 and 1.5**, each through its own exact header row, so a
   snapshot published before the manager upgrade stays readable.
3. An employee app still deployed at V1.5 (`CONTRACT_VERSION = 1.4` expected) shows
   `SNAPSHOT_CONTRACT_UNSUPPORTED` against a 1.5 snapshot — fail closed, never partial data. Record the observed
   message, then deploy the matching employee app (step 5).
4. Confirm an unknown or mixed contract (`1.3`, or a 1.4 header with a 1.5 column) still fails closed.

## 5. Employee dashboard upload/deployment

1. `npx clasp push` with the DEV dashboard configuration and create a new deployment version.
2. Confirm `SHARED_DASHBOARD_SNAPSHOT_SPREADSHEET_ID` and `REQUEST_INBOX_SPREADSHEET_ID` exist only in the
   respective Script Properties and are never shown in the UI.
3. Confirm `REQUEST_SUBMISSION_ENABLED` matches the intended DEV state (absent means closed).

## 6. Publication verification

1. As ADMIN with a reviewed `INTERNAL` project, run one publication.
2. Confirm `PUBLISHED_META.CONTRACT_VERSION` is `1.5`, the active slot flipped, and counts/hash match.
3. Confirm a nested subproject and a subtask render nested in the employee app, and that a `RESTRICTED` project
   and a `PENDING` completion note are absent.
4. Change one field and confirm the shared dashboard does **not** change until the next publication.

## 7. Worker request testing

1. From the employee app, submit a deadline change and a completion report.
2. As MANAGER open 申請一覧: both are imported once, with the inbox request ID as the permanent ID.
3. Approve the deadline change once; a second approval must be refused. Confirm `TASK_DEADLINE_HISTORY` and
   `AUDIT_LOG` rows.
4. Return and reject a completion: the task must not become Done.

## 8. Completion approval testing

1. Confirm the employee report leaves the task In Progress / Assigned and shows 承認待ち.
2. Approve it: the task becomes Done / 100 % with `Completed_At`, and the pending state clears.
3. Confirm `Tasks.complete`, the progress field, the sidebar and the manager web form all refuse Done.
4. As ADMIN, record one `COMPLETION_OVERRIDDEN` correction with a reason and confirm the separate audit row.
5. A container task (a task with subtasks) offers no completion report in the employee app, the inbox import
   refuses one, and an approval attempt is refused **before** the request is claimed: the request stays
   PENDING/STALE, never PROCESSING. Record the observed message.
6. Confirm a deadline change on a container task is still accepted and applied once.

## 9. Role verification

1. ADMIN can grant/revoke ADMIN/MANAGER; a manager cannot; nobody can change their own role; the last active
   administrator cannot be demoted or deactivated.
2. A MEMBER cannot reach the manager web app; a VIEWER cannot write anything.
3. A browser-supplied `role`, `actor`, `owner` or `confirmed` value changes nothing.

## 10. Deletion recovery verification

1. As ADMIN, preflight a mistakenly created task: the dependencies are listed and, when none exist, the action is
   available. Confirm `RECORD_DELETE_PREPARED` is written before the row disappears and `RECORD_DELETED` after it.
2. Confirm a project with children cannot be removed at all (no cascade is offered) and that the documented
   alternative is archiving.
3. Simulate an interrupted removal in a DEV copy only: prepare the intent, stop before the tombstone, then run
   `reconcileDeletions('RECONCILE DELETIONS')`. Confirm it appends the missing record for a row that is gone and
   leaves a row that still exists untouched. Record the observed result.
4. Confirm the removed identifier cannot be reused.

## 11. Rollback and recovery

1. **Code**: redeploy the previous Apps Script deployment version. Schema 7 columns stay in place and are ignored
   by the previous code where blank; do not drop columns.
2. **Data**: restore the pre-migration backup into a *new* spreadsheet and re-point DEV only with the documented
   procedure. Never clear or re-initialize the existing workbook.
3. **Snapshot**: republish from the restored workbook once it is verified; the previous snapshot stays readable
   until a successful publication flips the slot.
4. Record the rollback reason, the deployment version and the backup reference in `AUTOMATION_SETTINGS`/audit.

## Evidence to record

For every step: date, account, dataset size, deployment version, execution ID, observed result and any error text.
Live evidence belongs in [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) and the relevant
`docs/checkgates/V1_6_GATE_<n>.md`; local mock results are never a substitute.
