# Manager workflow

## V1.6.2 corrections to the daily workflow

These replace the V1.6/V1.6.1 steps they name; every other step is unchanged.

1. **A request is approved, not inherited.** A task that is already 完了/100% or already holds the requested deadline
   does not mean the request in front of you was applied. If another operation produced that state (an ADMIN
   correction, another approval, a manual edit), approving the request now shows it as 再確認 instead of recording
   it as an employee approval. Check the task history before deciding.
2. **What to do with 再確認.** Either reject/return it, or let the employee submit a fresh report. A request whose
   task changed after submission can never overwrite the newer deadline or assignee, even when the value looks
   right.
3. **When a decision says「手動確認が必要です」.** The execution was interrupted and no record ties the change to that
   request, so nothing was approved automatically and nothing was applied twice. Run
   `previewRequestDecisionReconciliation()` (read-only) to see the request, the task and whether the task really
   holds the requested state, then `reconcileRequestDecision(requestId, 'CONFIRM_APPLIED', note,
   'RECONCILE REQUESTS')` when it does, or `'MARK_STALE'` when it does not. Confirming never changes the task.
4. **When a decision says「監査記録の確定に失敗しました」.** The decision was stored but its audit record was not.
   Approve the same request once more; only the missing record and the receipt are written, and the completion
   timestamp is kept.
5. **When an ADMIN correction says「reconcileCompletionOverrides で確定してください」.** The task is already 完了 but
   the override record is missing. Run `reconcileCompletionOverrides('RECONCILE COMPLETIONS')`; it appends one record
   for a task verified 完了/100% and never touches the task.
6. **When an employee says the status is wrong.** Open 申請一覧 and press 申請状態の同期確認. The list shows 一致 /
   要再同期 / 受信箱に行がありません / タスクまたはプロジェクトが一致しません. Press 申請状態を再同期 to rewrite only the
   displayed status. A missing row or a mismatch is reported, not created or overwritten — investigate it.
7. **Read a member's profile correctly.** 本人の操作履歴 contains only actions performed by that member's verified
   account; 担当業務の変更履歴 also contains manager edits and reassignments by other people. A record whose
   contributor could not be verified says so.
8. **Filter the task list by responsibility.** 担当領域 is the first control of the task filter bar. It resolves the
   area through the task's project, so すべての担当領域, one area, 未分類 and a 廃止 area that still owns projects each
   show exactly their own tasks; the 案件 selector offers only projects of the selected area and returns to すべて when
   the current project cannot belong to the new area. 状態・担当者・優先度・期限 stay applied, the page returns to the
   first page, and the previous area's rows disappear while the new page loads. After moving a project to another
   area, open タスク again (or press 再読み込み) — the list is rebuilt from the project's current area instead of
   keeping the task under its previous responsibility.

## V1.6.1 corrections to the daily workflow

These replace the V1.6 steps they name; every other step is unchanged.

1. **Choose the area** (new behaviour). Selecting an area now resolves the scope on the server: the KPI row, the
   project list and the upcoming list all describe that area, and the totals are the area totals rather than the
   totals of the visible page. `未分類` is a real bucket, not "everything without a colour".
2. **Read the counts correctly.** A card shows 案件 / 未完了タスク / 期限超過 / 作業項目 and, when the area contains
   containers, 集計タスク. 未完了 and 期限超過 count open work items (never a container, never a done item, never a
   task under an archived branch). Completed work is reported separately.
3. **Structure the work** (stricter guard). A task with an approved assignment, a confirmed schedule, a request, a
   deadline history or recorded effort cannot become a container any more. Create a new parent task or a
   subproject instead. Moving a task under another task invalidates its assignment approval.
4. **Report and approve** (new refusal). A container task cannot be completed from a report: the employee form
   offers no completion action for it, the inbox import refuses the row, and an approval attempt is refused before
   the request is claimed, so the request stays 承認待ち instead of disappearing into 処理中. A deadline change on a
   container is still valid. If applying an approval fails, the request keeps the retry note and the audit row
   `REQUEST_APPROVAL_FAILED`; approve it again to finish it once.
5. **Review by member** (new). A member's profile keeps the work they did after a reassignment: the previous-work
   list shows the former assignment together with the current owner, and the reassignment itself is recorded
   (`TASK_REASSIGNED`). When no audit evidence exists the profile says the history is incomplete instead of
   guessing.
6. **Remove a mistake** (new). A record with dependants cannot be removed at all — there is no cascading delete.
   Clear the children one by one if they are also mistakes, or archive the parent. The panel shows a durable
   record before and after the removal; if the second record could not be written the manager is told to run the
   ADMIN recovery (`削除記録の確定`) in 自動化設定, which appends the missing record and never deletes anything.

## V1.6 workflow

1. **Choose the area.** The manager home opens with the responsibility section. Selecting 製品設計 filters every
   list and KPI to that area; `すべての担当領域` restores the overview.
2. **Create the project.** 案件 → 新規作成 asks for 担当領域 first (required, active only, preselected from the
   current area), then name, owner, description, committed deadline, priority, status and visibility.
3. **Structure the work.** Add subprojects to four levels, then tasks (three levels). A task with children is a
   container: its progress comes from its leaf work. A parent that already has hours, a progress value, an approval
   or a completion is refused as a container — start a new container task or use a subproject instead.
4. **Assign.** Owner, deadline and required duration remain the schedule inputs; duration is a schedule length, not
   labour hours. Assignment approval and schedule confirmation stay separate.
5. **Report and approve.** A worker reports completion from the shared dashboard. The manager sees 承認待ち in the
   task list and in 申請. Approving is the only way to Done / 100 %; returning or rejecting keeps the task open.
   An ADMIN correction needs a reason and is recorded separately (`COMPLETION_OVERRIDDEN`).
6. **Review by member.** メンバー → a member shows current work, previous (approved) work with its dates and
   acceptance, and the recorded activity. Attribution uses owner/task IDs, never a typed name.
7. **Remove a mistake.** Archive is the default. A genuinely empty mistaken project/subproject/task may be deleted
   by an ADMIN after the dependency preflight, with a reason, the typed `DELETE <id>` confirmation and a verified
   backup; the shared dashboard only changes at the next publication.
8. **Publish.** Publication stays explicit, A/B transactional and OFF by default; a visibility change appears in the
   shared dashboard at the next publication, never instantly.

## V1.5 browser workflow (historical)

Open/bookmark the manager DEV /exec URL provided by the administrator. The header displays your verified actor/role and V1.5. Use Overview, Projects, Tasks, Requests and Administration. You do not need Sheets open for daily CRUD. Projects open the two-level subproject hierarchy; its task button scopes the task list. Task creation asks for duration and deadline and uses the existing backward schedule. Confirm assignment and schedule separately. Requests import explicitly, then show reasons/dates/notes and approval controls/history.

Forms retain drafts during navigation/language changes and reject stale revisions. A transport failure has an uncertain outcome: reload the record/list/audit before retrying a create. Forced reload loses in-memory drafts after a browser warning. Reports/publication are explicit actions. Managers can stop automation; ADMIN handles sensitive settings and roles. The existing Sheets menu is the fallback. [Complete browser guide](MANAGER_WEB_APP.md).


This guide describes the intended V1.1 manager workflow in the bound Google Sheets project. All screens are
Japanese-first; the menu is **設計・開発課 管理**.

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
| Manage responsibilities (create / rename / re-order / 廃止 / 再有効化) | ✅ | ✅ (owner change is ADMIN-only) | ❌ | ❌ |
| Assign a task | ✅ | ✅ all | ❌ | ❌ |
| Update progress | ✅ all tasks | ✅ all tasks | ⚠️ own tasks only (self-service opt-in) | ❌ |
| Approve an assignment | ✅ | ✅ | ❌ | ❌ |
| Confirm a schedule | ✅ | ✅ | ❌ | ❌ |
| Review the skill matrix / gaps | ✅ | ✅ | ⚠️ own row only | ❌ |
| Modify skill assessments | ✅ | ✅ | ❌ | ❌ |
| Modify member records | ✅ | ✅ (roles unchanged) | ❌ | ❌ |
| Modify member roles | ✅ (never own) | ❌ | ❌ | ❌ |
| Enable LIVE email | ✅ + confirmation | ❌ | ❌ | ❌ |
| Stop email (OFF / emergency stop) | ✅ | ✅ | ❌ | ❌ |
| Install triggers | ✅ creator account | ✅ creator account | ❌ | ❌ |
| Publish the shared dashboard snapshot | ✅ | ✅ (manual) | ❌ | ❌ |
| Enable scheduled dashboard publication | ✅ + confirmation | ❌ | ❌ | ❌ |
| Change `Dashboard_Visibility` / `Dashboard_Summary` | ✅ | ✅ (domain API) | ❌ | ❌ |

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

1. **設計・開発課 管理 → 新規プロジェクト**.
2. Enter プロジェクト名, 担当領域, 責任者, 確定期限, 状態. カテゴリ, 優先度, 社内ダッシュボードに
   表示する and 共有用概要 live under 詳細設定.
3. Choose 社内ダッシュボードに表示する (see [Edit a project](#edit-a-project)) and enter the
   共有用概要 that may be published.
4. **作成**. The stable `Project_ID` is generated, the audit log records `UI_PROJECT_CREATED`, and the dashboard
   refreshes automatically.

担当領域 is optional; leaving it empty means 未分類, and a retired area cannot be chosen for a new
project. カテゴリ is a different, free-form classification and is unchanged by the area.

When you leave 責任者 empty, **you become the owner** (your verified `Member_ID`). Another
owner can be selected; after that, only that owner (or an administrator) can edit the project.
The original deadline is captured once (`Original_Deadline`) and is immutable; later deadline
changes update `Committed_Deadline` only.

## Edit a project

1. **プロジェクト作成 / 編集 → 編集するプロジェクト** → select the project. The form loads the stored
   name, owner, category, deadline, status, visibility, summary and private description; the button changes to
   **保存**.
2. Change only what is needed and press **保存** (`uiUpdateProject` → `Projects.update`).
   * Only the fields you leave in the form are written. Nothing else is blanked.
   * The `Project_ID`, the original deadline and the created timestamp never change.
   * A committed-deadline change asks for confirmation first.
   * If somebody saved the project after you loaded it, the save is refused: reload the project and re-apply.
3. `社内ダッシュボードに表示する` controls publication:
   * **表示しない（社内のみ）** keeps the project (and its subprojects and tasks) private. This is the default
     for every new project.
   * **表示する（社内ダッシュボード）** publishes it at the *next* publication. The form says so; the shared
     dashboard never updates instantly.
4. `共有用概要` is the only project free text that is published. The private `説明`, acceptance criteria, notes,
   skills and logs are never published.
5. To refresh the shared dashboard immediately, press **共有ダッシュボードを今すぐ公開**
   (`uiPublishPublicationNow` → `SharedDashboardPublisher.publish`). It requires an initialized snapshot workbook
   and reports how many projects/tasks were written. Scheduled publication still needs ADMIN and the typed
   confirmation.

## Create a subproject

1. In 案件, choose the project and press **新規作成** (or select an existing node first and press
   **子サブプロジェクトを追加** to nest under it).
2. Enter サブプロジェクト名, 担当者. The tree above the form shows the current hierarchy.
3. **作成**. The subproject must belong to the selected project; projects and subprojects are never deleted.

Only two levels exist: プロジェクト → サブプロジェクト → サブプロジェクト. A third level, a parent in
another project, and making a node its own parent are all refused. Changing a parent asks for
confirmation and never moves tasks by itself. **アーカイブ** keeps the child subprojects and every
task; while a parent is archived its descendants stop counting as active work, and
**アーカイブ解除** restores them.

## Manage responsibilities (担当領域)

1. **設計・開発課 管理 → 担当領域の管理** opens 管理. The list shows each area with its owner, its
   project counts and its Active/Retired state.
2. **担当領域を追加** creates one and makes you its owner; **保存** renames it or edits the internal
   description. **上へ / 下へ** change the display order only.
3. **廃止にする** asks for confirmation and tells you how many open projects stay in the area. It
   keeps every project, task and history row; the area stays visible and filterable and its
   projects are marked 「担当領域の再割当が必要です」. **再有効化** restores it. 廃止 / 再有効化
   describe an organizational area; 退職 / 復職 are never used for one.
4. Any ADMIN or MANAGER administers any area — two managers can always collaborate. The owner
   column records accountability, not permission, and changing a project's area never changes
   its owner.

## Navigate the sidebar (V1.4)

The sidebar is roughly 300px wide and shows **one section at a time**: 案件 (project and
subproject), タスク (assign/edit and progress), 管理 (responsibilities, members, skills). Rarely
used fields live under **詳細設定**, and a collapsed panel keeps the stored value. Each Sheets menu
entry opens the right section for you.

## Assign a task

1. Select プロジェクト and optionally サブプロジェクト.
2. Enter タスク名, 担当者, 期限 (required), and optionally 開始日, 見積時間, 完了条件, 優先度.
3. Choose whether メール通知 is enabled and whether to 承認 / 日程確定 immediately.
4. **登録して確認**.

The タスク picker loads a bounded window (300 tasks) so the sidebar opens quickly. When the
workbook holds more, the hint under the picker says how many exist; type part of a task name in
**タスク名で絞り込み** to reach any task, including one outside the window. The selected task keeps
its identity through a language switch and a re-render.

Rules:

- A deadline-only assignment is valid. No start date or estimate is fabricated.
- 割当承認 (assignment approval) requires an active owner and a verified account. Progress updates do not revoke it;
  changing the owner, deadline, project, priority, acceptance criteria or estimate does.
- 日程確定 (schedule confirmation) additionally requires a deadline and a known estimate. Changing dates or the
  estimate supersedes the confirmation (history is retained).
- Mail is queued, never sent from the sidebar. Delivery follows [AUTOMATION_SETTINGS.md](AUTOMATION_SETTINGS.md).

## Edit a task

1. **タスク割当 / 編集 → 編集するタスク** → select the task. Every supported value loads into the form and the
   button changes to **保存**.
2. Change what is needed and press **保存** (`uiAssignTask` → `Tasks.update`).
   * The update is a partial patch: owner, dates, duration, estimate, notification preference, actual hours,
     progress and completion state are kept unless you change them.
   * `Task_ID` never changes and no task is recreated.
   * Changing the deadline or the duration recalculates `Planned_Start`; you never type a start date while a
     duration exists.
   * Renaming a task, changing the owner/priority/acceptance criteria or changing the schedule bumps
     `Assignment_Version` and invalidates a previous assignment approval by design. Re-approve when you are ready.
   * If somebody saved the task after you loaded it, the save is refused and asks you to reload.
3. `メール通知を有効にする` is only changed when you toggle it; leaving it as loaded keeps the stored preference.
   No mail is sent from the sidebar.

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

**設計・開発課 管理 → 自動化設定 → 緊急停止** (or set 配信モード to `OFF`) → **設定を保存**. The next scan sends
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

## V1.3 — deadline planning and the request queue

### Assign a task with a deadline and a duration

1. Open **設計・開発課 管理 → 新規タスク** (or タスク割当) in the bound spreadsheet.
2. Choose the project, optional subproject, task name and assignee.
3. Enter the **完了期限**, the **必要期間**, the **単位** (日/週) and the **計算方法**
   (営業日/暦日). The form shows the calculated **開始予定日 → 完了期限** before saving.
4. Read the warnings. A past deadline, a past start or a milestone conflict is a warning
   only. A deadline that is not a working day requires the acknowledgement checkbox; the
   deadline itself is not changed.
5. Optionally enter 見積工数（時間）. Duration and effort are different numbers and are never
   converted into each other.
6. Save. The planned start is stored with the source `DERIVED`, any existing schedule
   confirmation is invalidated and the assignment version is bumped.

Overlapping assignments are allowed: the manager decides whether the schedule is feasible.

### Process worker requests

1. **設計・開発課 管理 → 申請一覧**. Opening the screen imports new inbox rows automatically
   and reports 「N 件を取り込みました」.
2. If the inbox cannot be read, the screen shows a warning (「申請を取り込めませんでした…」) and
   keeps listing the requests that were already imported. **申請を取り込む** retries the import.
   Repeated opens and two managers opening the queue at the same time never duplicate a request.
3. Review each card: request ID, project, task, current assignee, self-reported requester,
   current and requested deadline, difference, reason and explanation.
4. Enter a decision note and press **承認**, **却下** or **差戻し** and confirm.
   * 承認 changes the deadline once, recalculates the planned start, invalidates the old
     schedule confirmation and assignment approval, and records the deadline history.
   * 却下 / 差戻し never change the task.
5. If a card is marked as re-review required (`STALE`), the task changed after submission.
   Re-read the task and decide again.
6. A 完了報告 card completes the task (`Done`, 100%) only when approved.

### Language

Use `日本語 | English` at the top of every sidebar. The choice is remembered per browser and
never changes stored data.

