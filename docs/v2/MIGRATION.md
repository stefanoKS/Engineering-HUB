# V1 → V2 Data Migration

The V1 workbook stays the authoritative source until you deliberately switch. The migration tool
only **reads** it and writes a fresh V2 database. It never edits, clears or migrates a live
workbook, and it never sends a notification.

## 0. Current schema: 12, and no new migration for the 2026-11-11 corrections

The latest migration is `0012_divisions.sql`; a build from this repository requires schema **12**.
The division/branding corrective release of 2026-11-11 adds **no** migration: it changes the write
path, the ordering it computes at runtime (`Sort_Order` is allocated and re-sequenced by the service,
never by a schema default), the client and the documentation. Nothing therefore needs to run against
an existing database for that release, and `0012_divisions.sql` must not be edited to change runtime
ordering - an applied migration file is immutable.

## 1. Commands

### Schema 10 → 11 on an existing installation (Windows LAN)

A deployment built from this repository requires **schema 11** (the last migration is
`0011_responsibility_deletions.sql`: it drops and re-adds the `record_deletions.entity_type`
CHECK so the reviewed ADMIN deletion path can tombstone a removed responsibility area as well as a
project, subproject or task). The constraint replacement rewrites no row and adds no column; every
stored responsibility, project, audit record and tombstone reads back exactly as before.
`/readyz` answers `503 DATABASE_MIGRATION_REQUIRED` until the ledger reaches 11, and the API still
never migrates at startup.

```powershell
# 1. Verified encrypted backup first (a failed backup stops the upgrade)
./deploy/windows/Backup-Now.cmd

# 2. Apply the reviewed additive migration; the prompt requires "APPLY MIGRATIONS"
./deploy/windows/Migrate-Lan.cmd

# 3. Confirm the ledger, readiness and data preservation
psql "$env:DATABASE_URL" -c "SELECT version, name FROM schema_migrations ORDER BY version;"
Invoke-RestMethod http://localhost:8050/readyz

# 4. Only after 1-3 pass, publish the new application build and start it
./deploy/windows/Start-Lan.cmd
```

### Schema 9 → 10 on an existing installation (Windows LAN)

A deployment built from this repository requires **schema 10** (the last migration is the
unchanged, checksummed `0010_workload_report_indexes.sql`: one additive partial index,
`tasks_completed_at_idx` on `tasks (completed_at) WHERE deleted_at IS NULL AND completed_at IS NOT
NULL`, which serves the date-based workload report's completion filter). `0009_subproject_description.sql`
remains as recorded: `ALTER TABLE subprojects ADD COLUMN IF NOT EXISTS description TEXT NOT NULL
DEFAULT ''`. `/readyz` answers `503 DATABASE_MIGRATION_REQUIRED` until the ledger reaches 10; the
API never migrates at startup. No column, row, formula or stored value is rewritten by 0010, so
every existing record reads back exactly as before.

```powershell
# 1. Verified encrypted backup first (a failed backup stops the upgrade)
./deploy/windows/Backup-Now.cmd

# 2. Apply the reviewed additive migrations; the prompt requires "APPLY MIGRATIONS"
./deploy/windows/Migrate-Lan.cmd

# 3. Confirm the ledger, readiness and data preservation
psql "$env:DATABASE_URL" -c "SELECT version, name FROM schema_migrations ORDER BY version;"
Invoke-RestMethod http://localhost:8050/readyz
node --env-file=C:/approved-recovery/worker.env apps/worker/dist/cli.js verify-restore C:/approved-recovery/backup.dump.enc

# 4. Only after 1-3 pass, publish the new application build and start it
./deploy/windows/Start-Lan.cmd
```

Rollback is a restore, not a reverse migration: stop the API and worker, restore the verified
backup into a fresh database, point `DATABASE_URL` at it and restart. An already-applied migration
whose file changed is refused rather than re-run, so no recorded checksum may be edited - a schema
change always needs a new numbered migration.

### V1 workbook → V2 database

```bash
export DATABASE_URL=postgres://eh:…@localhost:5432/eh
npm run db:migrate                       # create the V2 schema first

# read-only export of the workbook (service account with spreadsheets.readonly)
MIGRATION_SPREADSHEET_ID=… MIGRATION_SERVICE_ACCOUNT="$(cat sa.json)" \
  npm run migration -- export --out v1-export.json

npm run migration -- inventory --snapshot v1-export.json                    # custom columns/formulas
npm run migration -- validate  --snapshot v1-export.json                    # blocking errors only
npm run migration -- import    --snapshot v1-export.json --dry-run          # full import, rolled back
npm run migration -- import    --snapshot v1-export.json --run v1-2024-06   # real import
npm run migration -- reconcile --snapshot v1-export.json --run v1-2024-06   # counts + checksums
```

`--snapshot <file>` uses a JSON export; without it the CLI reads the workbook through
`MIGRATION_SPREADSHEET_ID` + `MIGRATION_SERVICE_ACCOUNT`. Every command except `export`,
`inventory` and `validate` needs `DATABASE_URL`.

## 2. Source inventory

`inventory` reports, per sheet: the known V1 headers, any **custom column** (a header the V2 map
does not know), any **formula** cell, row counts and blank rows. Custom columns and formulas are
listed and are **not** migrated, because V2 has no spreadsheet formula layer; the report is the
record of what a manager must decide. The tool refuses to guess.

## 3. Table map

| V1 sheet | V2 table | Notes |
| --- | --- | --- |
| `MEMBERS` | `members` | `Member_ID` preserved; role/active preserved; manager links resolved in a second pass |
| `RESPONSIBILITIES` | `responsibilities` | ID, colour, order, status preserved |
| `PROJECTS` | `projects` | `Project_ID` preserved; owner and responsibility links; blank `Dashboard_Visibility` → `RESTRICTED`; unknown responsibility → 未分類 |
| `SUBPROJECTS` | `subprojects` | Parent chain preserved with two passes; depth re-validated (max 4) |
| `TASKS` | `tasks` | `Task_ID` preserved; parent and owner resolved in the second pass; `Dependency_IDs` split into `task_dependencies` |
| `TASK_ASSIGNEES` | `task_assignees` | Primary owner stays on `tasks.owner_member_id`; additional assignees become rows |
| `RESPONSIBILITY_MEMBERS` | `responsibility_members` | Soft rows preserved (`Removed_At`/`Removed_By`) |
| `SKILLS`, `MEMBER_SKILLS` | `skills`, `member_skills` | Levels and evidence preserved |
| `HOLIDAYS` | `holidays` | Working-day calendar preserved |
| `MILESTONES` | `milestones` | Target dates preserved |
| `ISSUES` | `issues` | Notes and state preserved |
| `PHASE_TEMPLATES` | `phase_templates` | Order and offsets preserved |
| `PROJECT_PHASES` | `project_phases` | Imported after phases exist; `Dependency_IDs` becomes an array column |
| `SCHEDULE_CONFIRMATIONS` | `schedule_confirmations` | Preserved |
| `TASK_REQUESTS` | `task_requests` | Inbox request ID is the permanent key; `Snapshot_Version`/`Task_Revision_At_Submission` become text columns |
| `TASK_DEADLINE_HISTORY` | `task_deadline_history` | Append-only |
| `AUDIT_LOG` | `audit_log` | Append-only; the V1 serial `audit_id` is **not** preserved, timestamps/actions/actors are |
| `NOTIFICATION_LOG` | `notification_ledger` | States mapped to the V2 ledger |
| `AUTOMATION_SETTINGS` | `app_settings` | Values imported, **automation forced OFF** (`EMAIL_MODE=OFF`, `EMERGENCY_STOP=true`, publication, Calendar and daily backup off) |
| generated sheets (`Schema.generated`, exports) | — | Not migrated; they are derived |

## 4. Transformation rules

* **Identifiers are never regenerated.** Project, task, subproject, member, responsibility, skill
  and request identifiers keep their V1 strings so links, bookmarks and audit text stay valid.
* **Two passes** for records whose reference may point to a row imported later (members,
  managers, owners, parents). An unresolvable reference is an `ERROR` in `validate` and a
  refusal in `import`, never a silent `NULL`.
* **Dates** are parsed with the documented V1 formats and written with the Asia/Tokyo convention.
  An unparseable date is an error, not "today".
* **Booleans/enums** are validated against the V2 enum list; an unknown value is an error.
* **Blank cells** are skipped rather than written as `false`/`0`/empty, so database defaults and
  migration-added columns keep their meaning.
* **Timestamps** are written inside `eh.preserve_timestamps` so the audit trigger does not stamp
  the import time over the original `created_at`/`updated_at`.
* **Automation is forced OFF** regardless of the workbook values. Re-enabling live mail is a
  separate ADMIN action with a preflight (see [OPERATIONS.md](./OPERATIONS.md)).
* **Progress and rollups are recomputed** from the imported tasks; they are never copied from a
  cached cell.

## 5. Validation (`validate`, exit code 1 on any ERROR)

| Check | Severity |
| --- | --- |
| Blank identifier, or duplicate identifier in one sheet | ERROR |
| Unparseable date or number | ERROR |
| Value outside the mapped enum set (for example an unknown status or basis) | ERROR |
| Reference not found (project, subproject, member, responsibility, skill, task) | ERROR |
| Subproject parent in another project, cyclic, or deeper than 4 | ERROR |
| Task parent in another project or subproject, cyclic, or deeper than 3 | ERROR |
| Dependency cycle | ERROR |
| Request without `Task_Revision_At_Submission` | WARNING |
| Custom column or formula present | WARNING (reported by `inventory`, not migrated) |

## 6. Safety guarantees

1. **Fresh database only.** `import` refuses to start when validation reports an `ERROR`, and it
   refuses a database that already holds `members` unless `--allow-populated` is supplied. The
   schema must already exist (`npm run db:migrate`); the import never creates or alters it.
2. **Dry run first.** `--dry-run` performs the entire import inside one transaction and rolls it
   back. The test suite asserts that no row survives.
3. **One transaction per run.** Every insert, the `import_runs` row and the
   `MIGRATION_IMPORTED` audit row commit together. A failure rolls the whole run back, so no
   partial import and no misleading `COMPLETED` run row can exist.
4. **Reconciliation.** `reconcile --run <id>` compares **every mapped table** (not only tasks and
   projects): source row count, imported row count, every mapped column of every row, and a
   deterministic destination checksum of the stored rows. A blank source cell is compared against
   the destination column default (read from `information_schema`), so a blank-vs-default
   divergence is a mismatch; a volatile default (`now()`, a sequence) is reported as
   `skippedFields` instead of being counted as a match. The relationship tables
   (`task_assignees`, `responsibility_members`, `task_dependencies`) are compared as sets, and
   the settings are compared against their documented safe overrides (`EMAIL_MODE=OFF`,
   `EMERGENCY_STOP=true`, publication/Calendar/backup OFF). The report carries both the source
   checksum and the destination checksum and exits non-zero on any mismatch.
5. **The workbook is untouched.** The source adapter issues `values.get` only. There is no
   write path, and Drive backups of the workbook are never modified.

## 7. Cut-over and rollback

The V1 workbook and Script Properties stay in place, unmodified, as the rollback source.

1. Take a verified V1 backup (`createDatabaseBackup` in the V1 project) and record its file ID.
2. Run `validate`; resolve every ERROR.
3. Run `import --dry-run`; record the output.
4. Stop manager writes in V1 (tell managers to stop editing), then run the real `import`.
5. Run `reconcile`; require `ok: true`.
6. Run the V2 smoke checklist in [ACCEPTANCE.md](./ACCEPTANCE.md) against the migrated database.
7. Only then point users at V2. Keep V1 read-only for at least one reporting cycle.

**Rollback** is a return to V1: the workbook is unchanged, so no data restore is needed for
anything entered before the cut-over. Data entered in V2 after the cut-over must be exported
before a rollback (`pg_dump`), because V1 cannot read it.

## 8. Verification status

| Criterion | Status | Evidence |
| --- | --- | --- |
| Mapping, validation, dry-run, real import, reconciliation on a fixture snapshot | **PASS** | `tools/migration/test/migration.test.ts` (10 tests, real PostgreSQL): full import of `fixtures/v1-snapshot.json`, identifier preservation, dependency rows, automation forced OFF, dry run leaves no rows, duplicate/unknown-reference/cycle errors, reconciliation mismatch detection for a task, a member, the notification ledger, a setting, and a missing relationship row |
| Reading the **real** V1 workbook | **BLOCKED** | Needs a service account with `spreadsheets.readonly` on the production workbook; not available in this environment |
| Importing the production dataset | **BLOCKED** | Same credential, plus an approved change window |
| Field-by-field reconciliation against production | **BLOCKED** | Depends on the production import |
| Measured import duration for the production volume | **NOT_RUN** | No production dataset locally |

No live data was read, migrated or written while building V2.

## 9. Schema 12: divisions (課)

`0012_divisions.sql` is additive and seeds nothing:

* `DIVISIONS` (stable `division_id`, name, `Active`/`Retired`, sort order, revision);
* `MEMBER_DIVISIONS` (`WORK` membership or `READ` additional access, soft removal, one active
  relationship per member and division);
* `MEMBERS.all_divisions_read` and the extended `MEMBERS.role` check (`GENERAL_MANAGER`);
* `PROJECTS.division_id` and `RESPONSIBILITIES.division_id`, both nullable so historical rows keep
  their unmapped state;
* `eh_check_project_division` / `eh_check_responsibility_division` and the supporting indexes.

The approved bootstrap is `bootstrapDivisions` (`packages/db/src/divisions-bootstrap.ts`): a fresh
deployment records 設計・開発課 / 設計・技術課 / 生産・技術課 once. It is never called at startup and
never overwrites an existing name.

Mapping existing data is a separate, explicit step. The dry-run report must list every unmapped
project, every unmapped area, every inconsistent area/project pair and every member with no
membership; the administrator supplies the mapping; apply it on an isolated copy; verify identifier
and row preservation; then remediate what remains unmapped (ADMIN-only until mapped). Nothing is
inferred from a name, a free-text department, a role, an owner or a task assignment. See
[DIVISIONS.md](./DIVISIONS.md) §5 for the procedure and §8 for the publication boundary.

### 9.1 Schema 11 → 12 on an existing installation — and the current LAN state (2026-11-10)

The LAN trial installation was running a build that requires schema 12 against a schema-11 database.
That mismatch is what produced the sign-in symptom: `/readyz` answered
`503 DATABASE_MIGRATION_REQUIRED`, and any page that resolved a division scope failed, which hid
`/api/public-config` behind the same failure. **The repair in this repository fixes the code path;
it does not migrate that database.** Migration 0012 has **not** been applied to it by this work.

Read-only inspection (no secret is printed, nothing is written):

```powershell
# Schema state only: version numbers and file names from the ledger.
psql "$env:DATABASE_URL" -c "SELECT version, name, applied_at FROM schema_migrations ORDER BY version;"
# Readiness of the running build.
Invoke-RestMethod http://localhost:8050/readyz
# The three tables/columns the division feature owns; their absence means "not migrated".
psql "$env:DATABASE_URL" -c "SELECT to_regclass('public.divisions') AS divisions, to_regclass('public.member_divisions') AS member_divisions, to_regclass('public.projects') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='division_id') AS projects_division;"
```

Applying it (only with separate, explicit authorization) is the documented order:

```powershell
# 1. Verified encrypted backup first; a failed backup stops the upgrade.
./deploy/windows/Backup-Now.cmd

# 2. Apply the reviewed additive migration; the prompt requires "APPLY MIGRATIONS".
./deploy/windows/Migrate-Lan.cmd

# 3. Verify the ledger, readiness and preservation of the existing rows.
psql "$env:DATABASE_URL" -c "SELECT version, name FROM schema_migrations ORDER BY version;"
psql "$env:DATABASE_URL" -c "SELECT (SELECT count(*) FROM projects) AS projects, (SELECT count(*) FROM tasks) AS tasks, (SELECT count(*) FROM members) AS members, (SELECT count(*) FROM local_accounts) AS logins, (SELECT count(*) FROM sessions) AS sessions;"
Invoke-RestMethod http://localhost:8050/readyz

# 4. Record the initial divisions once (bootstrapDivisions) and run the reviewed mapping.
#    Nothing is seeded or mapped automatically, and no account, password or session is touched.

# 5. Only after 1-4 pass, publish the new build and start it.
./deploy/windows/Start-Lan.cmd
```

`0012` is additive: it creates two tables, adds three columns, widens one CHECK and installs two
triggers. It rewrites no row, so accounts, password hashes, password versions, sessions and all
operational work survive it. Do not edit an applied migration; a correction is the next migration
ID. Until the mapping is complete the installation is **not** operationally ready: every existing
project has a blank division and is therefore ADMIN-only.
