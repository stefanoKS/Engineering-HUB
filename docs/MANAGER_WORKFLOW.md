# Manager workflow

This guide describes the intended V1.1 manager workflow in the bound Google Sheets project. All screens are
Japanese-first; the menu is **Engineering HUB**.

> Prerequisite: roles are assigned in `MEMBERS.Role` (`ADMIN`, `MANAGER`, `MEMBER`, `VIEWER`). A member without a
> role is treated as `VIEWER`; migrated rows are blank and must be assigned deliberately after the upgrade.
> Sheets editor access is not a security boundary — restrict the workbook to trusted managers.

## Create a project

1. **Engineering HUB → 新規プロジェクト**.
2. Enter プロジェクト名, 責任者, 確定期限, 状態.
3. **作成**. The stable `Project_ID` is generated, the audit log records `UI_PROJECT_CREATED`, and the dashboard
   refreshes automatically.

The original deadline is captured once (`Original_Deadline`) and is immutable; later deadline changes update
`Committed_Deadline` only.

## Create a subproject

1. Select the project, enter サブプロジェクト名, choose 担当者.
2. **作成**. The subproject must belong to the selected project; projects and subprojects are never deleted.

## Assign a task

1. Select プロジェクト and optionally サブプロジェクト.
2. Enter タスク名, 担当者, 期限 (required), and optionally 開始日, 見積時間, 完了条件, 優先度.
3. Choose whether メール通知 is enabled and whether to 承認 / 日程確定 immediately.
4. **登録して確認**.

Rules:

- A deadline-only assignment is valid. No start date or estimate is fabricated.
- 割当承認 (assignment approval) requires an active owner and a verified account. Progress updates do not revoke it;
  changing the owner, deadline, project, priority, acceptance criteria or estimate does.
- 日程確定 (schedule confirmation) additionally requires a deadline and a known estimate. Changing dates or the
  estimate supersedes the confirmation (history is retained).
- Mail is queued, never sent from the sidebar. Delivery follows [AUTOMATION_SETTINGS.md](AUTOMATION_SETTINGS.md).

## Update progress

1. **進捗更新**: select the task, enter 0–100 and optionally 次のアクション.
2. **更新**. 100 % sets the status to `Done`; a partial value cannot be marked `Done`.

## Check workload and schedule

- `TEAM_VIEW` shows assigned tasks, remaining estimated hours, capacity, utilisation, overdue tasks and unknown
  estimates per member.
- `WORKLOAD` lists weekly allocation; members over 100 % are marked `超過`.
- `GANTT_OVERVIEW` is the fallback Gantt (projects, subprojects, milestones, tasks, unscheduled markers).
  A native Google Timeline must be created manually if the Workspace edition supports it.
- `PROJECT_OVERVIEW` shows progress, health, next action and last update. A project with no schedule information
  is `日程不明`, never green.

## Maintain member skills

1. **メンバー**: create or edit a member, set 役割 and 週容量. Deactivation is refused while open tasks remain —
   reassign them first.
2. **スキル**: choose member, skill, level 0–4, assessor, evidence and next review date.
3. Skill gaps appear in the skill view with a recommended supervision/training action; they never block work.

## Configure reminders

See [AUTOMATION_SETTINGS.md](AUTOMATION_SETTINGS.md). Reminder offsets, catch-up window, overdue frequency,
weekday-only sending, execution window (JST) and report recipients are all managed there.

## Disable email immediately

**Engineering HUB → 自動化設定 → 緊急停止** (or set 配信モード to `OFF`) → **設定を保存**. The next scan sends
nothing, even if a trigger is still installed. Notification history is preserved.

## Enable email after safety checks

1. Confirm the environment binding, allowed recipient domains, notification activation and the legacy flags with
   the operator checklist in [DEPLOYMENT.md](../DEPLOYMENT.md).
2. Set 配信モード to `PREVIEW` and review **送信プレビュー**.
3. Set 配信モード to `LIVE`, turn off 緊急停止, type `ENABLE LIVE EMAIL`, and save. ADMIN role is required.
4. Enable only the feature switches you need (担当依頼通知 / 期限前通知 / 期限超過通知 / 週次レポート).

## View failed notifications

**自動化設定 → 履歴を表示** shows recent ledger rows with type, recipient, result and error. `PENDING` means the
outcome is unknown; `DELIVERY_UNCERTAIN` means it was reconciled and will not be retried. Do not delete rows to
force a retry.

## Restore from backup

See [BACKUP_RESTORE.md](../BACKUP_RESTORE.md). Restoration is manual, into a new Drive copy, with explicit
configuration rebinding. The application never restores automatically and never deletes backups.

## Update the software safely from GitHub

1. Pull the reviewed commit; run `npm ci`, `npm run lint`, `npm test`, `npm run validate`.
2. Review any new migration IDs and their documentation.
3. Push with the correct `.clasp.json` for the environment (never production by accident).
4. Take/verify a backup, approve only the reviewed migration IDs, run `upgradeExistingDatabase()`.
5. Re-check `システム状態`, assign roles if the migration appended blank roles, and re-run automation in PREVIEW.

`clasp push` never changes spreadsheet data, Script Properties, triggers or automation settings.
