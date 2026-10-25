# Google Workspace smoke test (development only)

All steps are **manual**. They must be executed in an isolated development Apps Script project and development
spreadsheet. Never run them against production. Never enable email or Calendar during setup.

Record the result of each step (PASS / FAIL / BLOCKED) with the date, account and observed evidence. Local unit
tests are not evidence of live Workspace behaviour.

## 0. Preparation

- [ ] Development Apps Script project exists and is **container-bound** to the development spreadsheet.
- [ ] `.clasp.dev.json` selected (`Copy-Item .clasp.dev.json .clasp.json -Force`) and its `scriptId` inspected.
- [ ] `npm ci`, `npm run lint`, `npm test`, `npm run validate` pass for the deployed commit.
- [ ] Development spreadsheet ID, backup folder ID and the developing account are recorded locally (not in Git).
- [ ] OAuth consent reviewed for the account that will own the triggers.

## 1. Environment binding and initialization

- [ ] `ENVIRONMENT=DEVELOPMENT`, `BOUND_ENVIRONMENT=DEVELOPMENT`, `SPREADSHEET_ID=<dev id>`,
      `BACKUP_FOLDER_ID=<restricted dev folder>`, `ALLOWED_RECIPIENT_DOMAINS=<dev-only domain>`.
- [ ] `INITIALIZATION_SPREADSHEET_ID` set to the same development ID.
- [ ] Run `initializeNewDatabase('INITIALIZE <dev id>')` once on an **empty** workbook.
- [ ] Confirm initialization refuses a workbook that already contains any value or formula.
- [ ] Confirm `SCHEMA_MIGRATIONS` shows `INITIALIZE_V3` and `Migrations.currentVersion()` is `3`.
- [ ] Remove `INITIALIZATION_SPREADSHEET_ID` and any temporary editor wrapper.
- [ ] Confirm no trigger, mail or Calendar event was created.

## 2. Manager UI

- [ ] Reload the spreadsheet; the **Engineering HUB** menu is present (container-bound only).
- [ ] ダッシュボード sidebar opens; Japanese labels render; no error toast.
- [ ] 自動化設定 sidebar shows 有効モード = `OFF` and 旧設定互換モード = いいえ.
- [ ] システム状態 shows environment, modes, activation state, trigger list and row counts.

## 3. Data preservation

- [ ] Create two projects, two subprojects, a direct project task and a subproject task with fictional data.
- [ ] Add a manual column with a formula to `TASKS` and confirm it survives refresh.
- [ ] Run **ダッシュボード更新**; confirm `PROJECT_OVERVIEW`, `TEAM_VIEW`, `GANTT_OVERVIEW`, `TIMELINE_DATA`,
      `WORKLOAD`, `SKILL_MATRIX`, `BACKPLAN`, `AUTOMATION_STATUS` are populated.
- [ ] Confirm operational rows, IDs and the manual formula are unchanged (compare a snapshot).
- [ ] Confirm `DASHBOARD` displays last refresh and that no operational sheet was cleared.

## 4. Protected operational columns

- [ ] Confirm `Progress_Percent` and `Health` on `PROJECTS` change only through refresh.
- [ ] Confirm direct edits to `Assignment_Approved_At` / `Notification_Baseline` cannot trigger mail.
- [ ] Confirm archiving a project keeps its tasks, issues and milestones.

## 5. Roles and UI permissions

- [ ] Set `MEMBERS.Role` for the operator (`ADMIN`) and for a second test account (`MEMBER`).
- [ ] With the MEMBER account, confirm the settings form and member administration are rejected.
- [ ] With an account that is not an active member, confirm every management surface is rejected.
- [ ] Confirm a migrated row with a blank role is treated as `VIEWER`.

## 6. Email preview

- [ ] Set `EMAIL_MODE=PREVIEW`, disable 緊急停止, enable 担当依頼通知, save.
- [ ] Approve one task assignment (割当を承認) and confirm `Assignment_Approved_At` and
      `Notification_Baseline` are set.
- [ ] Run the scan (`scanNotifications()`); confirm `NOTIFICATION_LOG` gets a `PREVIEW` row.
- [ ] Confirm **zero** emails were sent and no `SENT` row exists.
- [ ] Confirm a second scan the same day does not duplicate the preview row.

## 7. Authorized single test email

- [ ] Confirm `EMAIL_ENABLED=true`, `DRY_RUN=false`, `ALLOWED_RECIPIENT_DOMAINS` contains only the test domain,
      `MAX_EMAILS_PER_RUN` is small (for example 1), and notifications were activated
      (`activateNotifications('<admin>', 'ACTIVATE NOTIFICATIONS')`).
- [ ] Set `EMAIL_MODE=LIVE`, type `ENABLE LIVE EMAIL`, save.
- [ ] Run one scan; confirm exactly one test email arrived at the approved address and one `SENT` ledger row.
- [ ] Run the scan again; confirm no duplicate delivery.
- [ ] Confirm the current trigger owner is the authorized sending account.

## 8. Notification triggers

- [ ] `installAuthorizedTriggers('<authorized account>', 'INSTALL AUTHORIZED TRIGGERS')`.
- [ ] `Triggers.diagnostics()` reports installed handlers, no missing handlers and no duplicates.
- [ ] Enable 週次レポート and re-run the installation; confirm the weekly handler is added once.
- [ ] Confirm a different account cannot see or repair the other account's triggers.
- [ ] Turn a feature off and confirm the next run sends nothing even though the trigger still exists.
- [ ] Force a failure (temporary invalid recipient) and confirm the ledger records the failure/`PENDING` state.
- [ ] Reconcile: `reconcileUncertainDeliveries('<admin>', 'RECONCILE DELIVERY')` marks stale `PENDING` rows
      `DELIVERY_UNCERTAIN` and nothing is resent.

## 9. Calendar synchronization

- [ ] Create a dedicated secondary calendar; set `CALENDAR_ENABLED=true` and `CALENDAR_ID=<secondary id>`.
- [ ] With `CALENDAR_SYNC_ENABLED=false`, confirm the sync reports disabled and creates no event.
- [ ] Enable the setting, add one milestone, run `syncMilestoneCalendar()`; confirm one owned event and the
      persisted last-sync status.
- [ ] Modify an unrelated event manually; confirm it is never modified.
- [ ] Turn the setting off; confirm sync stops and existing events are not deleted.

## 10. Backup creation

- [ ] Enable 自動バックアップ and run `scheduledDailyBackup()`; confirm a private Drive copy exists with the
      expected name and `BACKUP_LOG` shows `VERIFIED`.
- [ ] Disable the switch and confirm the scheduled job skips; confirm a migration would still create a backup.
- [ ] Confirm the backup folder is not shared by link.

## 11. Backup restore drill (manual)

- [ ] Follow [BACKUP_RESTORE.md](../BACKUP_RESTORE.md) to restore into a **new** Drive copy.
- [ ] Rebind configuration explicitly to the restored copy (`SPREADSHEET_ID`, environment marker check).
- [ ] Confirm records and IDs match the backup reference and no automatic restore occurred.

## 12. Close-out

- [ ] Remove temporary editor wrappers and test records that are not needed.
- [ ] Record which claims are verified and which remain unverified.
- [ ] Do not copy development results into production settings.
