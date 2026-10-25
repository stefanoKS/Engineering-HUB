# Manager workflow

This guide describes the intended V1.1 manager workflow in the bound Google Sheets project. All screens are
Japanese-first; the menu is **Engineering HUB**.

> Prerequisite: roles are assigned in `MEMBERS.Role` (`ADMIN`, `MANAGER`, `MEMBER`, `VIEWER`). A member without a
> role is treated as `VIEWER`; migrated rows are blank and must be assigned deliberately after the upgrade.
> Sheets editor access is not a security boundary — restrict the workbook to trusted managers. V1.1 is
> manager-only by default; member self-service requires `ALLOW_MEMBER_SELF_SERVICE=true` and is documented as
> non-confidential.

## Who may do what

| Operation | ADMIN | MANAGER | MEMBER | VIEWER |
| --- | --- | --- | --- | --- |
| Open the sidebar | ✅ | ✅ | ⚠️ `ALLOW_MEMBER_SELF_SERVICE=true` のときのみ（自分の範囲） | ❌ |
| Create a project | ✅ | ✅ | ❌ | ❌ |
| Create a subproject | ✅ | ✅ | ❌ | ❌ |
| Assign a task | ✅ | ✅ own projects | ❌ | ❌ |
| Update progress | ✅ all tasks | ✅ own projects and own tasks | ⚠️ own tasks only (self-service opt-in) | ❌ |
| Approve an assignment | ✅ | ✅ own scope | ❌ | ❌ |
| Confirm a schedule | ✅ | ✅ own scope | ❌ | ❌ |
| Review the skill matrix / gaps | ✅ | ✅ | ⚠️ own row only | ❌ |
| Modify skill assessments | ✅ | ✅ | ❌ | ❌ |
| Modify member records | ✅ | ✅ (roles unchanged) | ❌ | ❌ |
| Modify member roles | ✅ (never own) | ❌ | ❌ | ❌ |
| Enable LIVE email | ✅ + confirmation | ❌ | ❌ | ❌ |
| Stop email (OFF / emergency stop) | ✅ | ✅ | ❌ | ❌ |
| Install triggers | ✅ creator account | ✅ creator account | ❌ | ❌ |
| Publish the shared dashboard snapshot | ✅ | ✅ (manual) | ❌ | ❌ |
| Enable scheduled dashboard publication | ✅ + confirmation | ❌ | ❌ | ❌ |
| Change `Dashboard_Visibility` / `Dashboard_Summary` | ✅ | ✅ own projects (domain API) | ❌ | ❌ |

The first administrator must be created once with `bootstrapFirstAdministrator` (deployment allowlist + exact
confirmation). The last active administrator can never be demoted or deactivated.

## Worked examples (fictional)

### 1. 新規プロジェクトと初回割当 (manager)

> 「検査装置の案件を12月末納期で立ち上げ、機構設計を田中さんに依頼したい」

1. 新規プロジェクト: プロジェクト名「検査装置 2026」, 責任者=自分, 確定期限=`2026-12-31`, 状態=進行中。
2. 新規サブプロジェクト: 「機構設計」。
3. タスク割当: タスク名「カメラ選定」, 担当者=田中, 期限=`2026-11-20`, 見積=未入力のまま,
   完了条件「候補3社の比較表」, 通知=ON, 割当を承認=ON。
4. 保存後、ダッシュボードの「承認待ちタスク」から消え、「見積未設定タスク」に残る（見積は未見積のまま）。

期限だけでも割当は成立する。開始日や見積を推測で埋めない。

### 2. 担当者の進捗報告 (member)

> 「自分の作業は60%まで進んだ。次は図面レビュー」

1. 進捗更新: タスク=カメラ選定, 進捗率=60, 次のアクション「図面レビュー」。
2. 保存。担当者本人のタスクのみ更新できる。他人のタスクを指定すると拒否される。

100%にすると状態は自動で `Done` になる。100%未満を `Done` にすることはできない。

### 3. 納期遅延の報告 (manager)

> 「部品メーカーの納期が2週間遅れる。ブロッカーとして記録し、課題も起票したい」

1. タスク割当で対象タスクを開き、状態=ブロック, 次のアクション「代替供应商の見積待ち」。
2. 課題: 重要度=High, 内容「部品納期遅延（2週間）」, 対応期限=`2026-11-10`。
3. ダッシュボードの「ブロック中タスク」「期限超過タスク」に反映され、プロジェクトの健全性が黄/赤になる。

### 4. スキルギャップの確認 (manager)

> 「新人の山田さんに要求レベル3の設計を割り当てたが、本人はレベル2」

スキル画面で対象メンバー・スキル・レベル2、評価者・根拠・次回レビュー日を記録すると、ギャップ1として
「監督者同行または研修の検討」が表示される。割当自体は止めない（助言的）。

### 5. 週次レポートの設定 (admin)

> 「月曜8:30に部長へ週次レポートを送りたい」

1. 自動化設定: 週次レポート=ON, 送信先=部長のアドレス, 曜日=MONDAY, 時刻=08:30 で保存。
2. 権限を持つアカウントでトリガーを再インストール（設定変更だけでは実スケジュールは変わらない）。
3. システム状態で「トリガー設定の一致」を確認。

### 6. メールの即時停止と再開

> 「誤送信が怖いので今すぐ止めたい」 → 自動化設定で緊急停止をON（または配信モードOFF）。確認は不要。
>
> 「原因を直したので再開したい」 → 管理者が PREVIEW で内容確認 → LIVE を選択し、緊急停止を解除し、
> `ENABLE LIVE EMAIL` を入力して保存。MANAGER は再開できない。

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
3. Set 配信モード to `LIVE`, turn off 緊急停止, type `ENABLE LIVE EMAIL`, and save. **ADMIN role is required** —
   a MANAGER receives an authorization error.
4. Enable only the feature switches you need (担当依頼通知 / 期限前通知 / 期限超過通知 / 週次レポート).

Clearing 緊急停止 while `EMAIL_MODE` is already `LIVE` is treated as a re-activation and needs the same ADMIN
confirmation and preflight.

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
