# V1 → V2 Data Migration

The V1 workbook stays the authoritative source until you deliberately switch. The migration tool
only **reads** it and writes a fresh V2 database. It never edits, clears or migrates a live
workbook, and it never sends a notification.

## 1. Commands

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
4. **Reconciliation.** `reconcile --run <id>` compares, per table, the source row count, the
   imported row count, the unchanged identifiers, and a field-by-field checksum of the mapped
   columns. It exits non-zero on any mismatch. Blank source cells are excluded from the field
   comparison because they were deliberately not written.
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
| Mapping, validation, dry-run, real import, reconciliation on a fixture snapshot | **PASS** | `tools/migration/test/migration.test.ts` (8 tests, real PostgreSQL): full import of `fixtures/v1-snapshot.json`, identifier preservation, dependency rows, automation forced OFF, dry run leaves no rows, duplicate/unknown-reference/cycle errors, reconciliation mismatch detection |
| Reading the **real** V1 workbook | **BLOCKED** | Needs a service account with `spreadsheets.readonly` on the production workbook; not available in this environment |
| Importing the production dataset | **BLOCKED** | Same credential, plus an approved change window |
| Field-by-field reconciliation against production | **BLOCKED** | Depends on the production import |
| Measured import duration for the production volume | **NOT_RUN** | No production dataset locally |

No live data was read, migrated or written while building V2.
