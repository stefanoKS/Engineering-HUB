# Backup and manual restore

## V1.5 web-app recovery

The manager web UI and sidebar share the same A. Code deployment does not back up, migrate or roll back data. Preserve the existing restricted backups and audit/history; no V1.5 migration is required. For a web UI failure, return to the Sheets sidebar and disable/reselect the web deployment as described in [manager deployment rollback](docs/MANAGER_WEB_APP_DEPLOYMENT.md). Review uncertain writes before retrying. Do not reset operational sheets or restore data automatically. A deployment-version rollback does not change editor source or spreadsheet rows.


## Independent state

Git versions source code only. Spreadsheet rows, formulas and views, Script Properties, installable triggers, Calendar events, sent mail, Drive sharing, and Drive snapshots are separate state. A code rollback cannot undo a mail send, restore rows, or reverse a migration.

## Backup policy

Configure an environment-specific `BACKUP_FOLDER_ID` with restricted access. The implementation checks folder sharing and rejects publicly/link-shared destinations; this is not a substitute for an administrator reviewing inherited access, group membership, shared-drive policies, and the resulting file ACL.

Run `createDatabaseBackup()` from the Apps Script editor to create a manual verified snapshot; it returns the Drive copy ID. Approved migration execution also creates its own pre-change snapshot and this cannot be disabled by the `DAILY_BACKUP_ENABLED` automation switch. The scheduled daily backup is opt-in (`DAILY_BACKUP_ENABLED=false` by default) and reports its result in `AUTOMATION_SETTINGS` (`LAST_BACKUP_TIME`, `LAST_BACKUP_RESULT`) and `BACKUP_LOG`. Create a snapshot before risky production changes. The implementation compares sheet names, values, and formulas in the copy and source; an operator must still verify that the snapshot opens and is accessible to the designated recovery operator. Record its ID, time, environment, schema version, and source workbook ID in an appropriately restricted operations record.

Backups are not automatically deleted. Retention and any deletion are reviewed manual operator decisions. Do not add a cleanup trigger. A spreadsheet snapshot is not a complete backup of Script Properties, triggers, authorization, Calendar events, or sent mail; maintain a separate secure configuration and operations inventory.

If backup creation or access verification fails, stop the risky operation. Do not suppress the error and continue.

## Recovery: manual only

There is no automatic restore implementation or unattended overwrite operation.

1. Pause installable triggers and disable email/Calendar. Keep `DRY_RUN=true`.
2. Record the current workbook ID and configuration securely. Preserve the current workbook for investigation; do not clear or delete it.
3. Select a verified snapshot with a known timestamp and schema version. Review what changes and external effects occurred after it.
4. Use Drive's **Make a copy** to create a recovery workbook in a restricted location. **The copy has a new spreadsheet ID.** Verify its sharing, sheets, headers, rows, formulas, and schema metadata.
5. Check out a code revision compatible with that schema. Never use initialization on the restored workbook. If an upgrade is required, back up the recovery workbook and apply only explicitly reviewed migrations.
6. In the correct Apps Script project, manually change `SPREADSHEET_ID` to the recovery copy's ID. Recheck `ENVIRONMENT` and `BOUND_ENVIRONMENT`. Do not set `INITIALIZATION_SPREADSHEET_ID` for a restored workbook.
7. Check backup folder and Calendar bindings separately. A copied workbook does not imply that those settings or trigger ownership changed.
8. Run read-only inspections, then a controlled development-equivalent smoke test with external effects disabled.
9. Reconcile notifications and Calendar events against audit/delivery records. A restored ledger can predate mail already sent; blindly replaying it may duplicate delivery. An uncertain external outcome requires manual investigation.
10. Review the restored `AUTOMATION_SETTINGS` table: the snapshot contains the automation preferences as they were when the backup was taken. Force the restart state to `EMAIL_MODE=OFF` (or `PREVIEW`), keep the emergency stop on, confirm `MEMBERS.Role` values, and re-run the preflight before enabling automation again.
11. Obtain operator approval before resuming triggers and external effects. Retain the original workbook and recovery notes until the recovery is accepted.

Practice this procedure in development. There is no claimed live restore drill, recovery-time objective, or recovery-point guarantee in this repository.

## Recovery ownership and permissions

- **Recovery owner**: a named administrator per environment (recorded in the operations log, not in Git). The
  owner must be an active `ADMIN` in the workbook and the creator account of the installable triggers.
- **Backup folder**: `BACKUP_FOLDER_ID` must be a restricted folder whose editors are only the recovery owner and
  the executing script account. The application rejects publicly/link-shared folders; it cannot detect inherited
  access, shared-drive policies or group membership — verify those manually.
- **Second operator**: an independent reviewer confirms the restored copy before service resumes.
- **No automatic deletion**: the application never deletes backups. Retention is a documented manual decision.

## Required verification evidence

Record for every backup: creation time, environment, schema version, source spreadsheet ID, Drive copy ID, file
name (`HK-<ENV>-v<schema>-<timestamp>`), `BACKUP_LOG` result and who verified it. A backup without a verified
restore drill is not evidence of recoverability.

## Backup test procedure (development)

1. Open the development workbook; confirm `AUTOMATION_SETTINGS.DAILY_BACKUP_ENABLED` state.
2. Run `createDatabaseBackup()` (or wait for the scheduled run).
3. Confirm the returned Drive copy exists, is private, and its sheet names, values and formulas match the source.
4. Confirm `BACKUP_LOG` shows `VERIFIED` (or `FAILED` with an error) and `LAST_BACKUP_RESULT` is updated.
5. Open the copy as the recovery owner to prove access.

## Restore drill into a new copy

1. Pick a verified snapshot and note its timestamp/schema version.
2. Drive → **Make a copy** into the restricted recovery location (the copy gets a **new** spreadsheet ID).
3. Verify sharing, sheet names, headers, row counts, formulas and the environment marker.
4. Do **not** run initialization on the restored workbook. If an upgrade is needed, back up the copy first and apply
   only reviewed migrations.
5. Rebind configuration explicitly: set `SPREADSHEET_ID` to the new ID, keep `ENVIRONMENT`/`BOUND_ENVIRONMENT`
   matching, and leave `INITIALIZATION_SPREADSHEET_ID` unset.
6. Recheck the backup folder and Calendar bindings separately; a copied workbook does not move those settings.

## Environment rebinding checklist

- [ ] `SPREADSHEET_ID` points at the restored copy.
- [ ] `ENVIRONMENT` equals `BOUND_ENVIRONMENT`.
- [ ] The restored `SETTINGS` marker `DATABASE_ENVIRONMENT` matches the environment.
- [ ] `EMAIL_MODE` is `OFF` or `PREVIEW`; emergency stop engaged.
- [ ] `ADMIN_BOOTSTRAP_ALLOWLIST` is empty (bootstrap is not reusable).
- [ ] Roles reviewed; at least one active `ADMIN` exists.
- [ ] `MANAGED_TRIGGER_SIGNATURE` cleared or triggers reinstalled with the current account.

## Notification-ledger reconciliation

A restored ledger may predate mail that was actually sent, and mail sent after the snapshot is missing.

1. Treat every restored `PENDING` row as unknown; run `reconcileUncertainDeliveries(actor, 'RECONCILE DELIVERY')`
   to mark them `DELIVERY_UNCERTAIN`. Never delete rows to force a resend.
2. Compare `SENT` rows after the snapshot time with the mail actually received; do not replay them.
3. Re-enable features one at a time, starting with PREVIEW, and confirm no historical mass sending occurs.
4. Calendar: reconcile owned events using the stored event IDs and the `Engineering-HUB:<spreadsheetId>:<milestone>`
   marker; missing events are repaired deliberately, never recreated in bulk.

## Recovery sign-off

| Field | Value |
| --- | --- |
| Incident / reason | |
| Snapshot used (Drive ID, time, schema) | |
| Restored workbook ID | |
| Data loss accepted (rows, timespan) | |
| Notification reconciliation result | |
| Calendar reconciliation result | |
| Automation state after recovery | `OFF` / `PREVIEW` |
| Recovery owner | |
| Independent reviewer | |
| Approved to resume triggers | yes / no + date |

Until this record is complete, continue with automation disabled.

## V2 backup and restore (PostgreSQL)

The V1 backup procedure above (a restricted Drive copy of the workbook, `createDatabaseBackup`,
verified before a migration) is unchanged and remains the protection for the deployed system.

V2 backs up PostgreSQL instead:

* the worker writes an AES-256-GCM encrypted container (`EHBAK1` magic, random nonce, auth tag) of
  either a `pg_dump` custom archive or the portable `eh-logical-v1` JSON archive, records it in
  `backup_log` with its checksum and manifest, and uploads it to `DRIVE_BACKUP_FOLDER_ID`;
* `DAILY_BACKUP_ENABLED` (default **false**) schedules one run per business day, and
  `backup-now` creates one on demand — run it before any risky operation;
* `verify-restore` restores the archive into a scratch database, compares every table's row count
  and prints `PASS`/`FAIL`; it refuses a populated target and drops only the scratch database it
  created;
* retention is reported (an audit row), never enforced: this codebase deletes no backup file;
* a restore is always an explicit operator action into a new database — there is no unattended
  restore and no WAL/continuous archiving, so the RPO is the last successful backup.

The full procedure, the failure table and the stated limitations (no second-level RPO, the
`pg_dump` path `NOT_RUN` locally because the embedded test distribution has no client tools) are in
[docs/v2/BACKUP_RESTORE.md](docs/v2/BACKUP_RESTORE.md).
