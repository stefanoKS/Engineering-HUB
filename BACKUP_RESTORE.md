# Backup and manual restore

## Independent state

Git versions source code only. Spreadsheet rows, formulas and views, Script Properties, installable triggers, Calendar events, sent mail, Drive sharing, and Drive snapshots are separate state. A code rollback cannot undo a mail send, restore rows, or reverse a migration.

## Backup policy

Configure an environment-specific `BACKUP_FOLDER_ID` with restricted access. The implementation checks folder sharing and rejects publicly/link-shared destinations; this is not a substitute for an administrator reviewing inherited access, group membership, shared-drive policies, and the resulting file ACL.

Run `createDatabaseBackup()` from the Apps Script editor to create a manual verified snapshot; it returns the Drive copy ID. Approved migration execution also creates its own pre-change snapshot. Create a snapshot before risky production changes. The implementation compares sheet names, values, and formulas in the copy and source; an operator must still verify that the snapshot opens and is accessible to the designated recovery operator. Record its ID, time, environment, schema version, and source workbook ID in an appropriately restricted operations record.

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
10. Obtain operator approval before resuming triggers and external effects. Retain the original workbook and recovery notes until the recovery is accepted.

Practice this procedure in development. There is no claimed live restore drill, recovery-time objective, or recovery-point guarantee in this repository.
