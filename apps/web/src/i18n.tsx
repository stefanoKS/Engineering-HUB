/**
 * Localization for the V2 screens.
 *
 * Shared interface strings come from the generated V1 dictionary (`@eh/i18n`); screen-specific
 * labels that did not exist in V1 are declared here with an identical ja/en pair. Stored text,
 * identifiers and enum values are never translated - only presentation labels are.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { APP_NAME, DEFAULT_LANGUAGE, LANGUAGES, STORAGE_KEY, isLanguage, label as dictLabel, t as dictT, type Language } from '@eh/i18n';

export const V2_LABELS = {
 'nav.back': { ja: '← 戻る', en: '← Back' },
 'hierarchy.title': { ja: 'プロジェクト構成', en: 'Project structure' },
 'hierarchy.directTasks': { ja: 'プロジェクト直下のタスク', en: 'Direct project tasks' },
 'hierarchy.counts': { ja: '進行中 {active} · 完了 {done}', en: '{active} active · {done} done' },
 'hierarchy.expand': { ja: '{name} を開く', en: 'Expand {name}' },
 'hierarchy.collapse': { ja: '{name} を閉じる', en: 'Collapse {name}' },
 'hierarchy.newSubproject': { ja: '子サブプロジェクト', en: 'Nested subproject' },
 'hierarchy.deleteTask': { ja: '{name} を削除', en: 'Delete {name}' },
 'hierarchy.deleteSubproject': { ja: '{name} を削除', en: 'Delete {name}' },
 'hierarchy.emptySubproject': { ja: 'このサブプロジェクトにはタスクがありません。', en: 'This subproject has no tasks.' },
 'hierarchy.empty': { ja: 'サブプロジェクトもタスクもまだありません。', en: 'No subprojects or tasks yet.' },
 'hierarchy.emptyDirect': { ja: 'プロジェクト直下のタスクはありません。', en: 'No direct project tasks.' },
 'hierarchy.showInactive': { ja: '取消・アーカイブを表示', en: 'Show cancelled and archived' },
 'hierarchy.container': { ja: '作業単位外', en: 'Container' },
 'hierarchy.hiddenTasks': { ja: '非表示のタスク: {n} 件', en: '{n} hidden tasks' },
 'delete.target': { ja: '対象', en: 'Target' },
 'delete.confirmTitle': { ja: 'タスクを削除', en: 'Remove task' },
 'delete.completedTitle': { ja: '完了済みタスクを削除', en: 'Remove completed task' },
 'delete.checking': { ja: '削除できるか確認しています…', en: 'Checking whether this can be removed…' },
 'delete.allowed': {
   ja: '操作履歴は監査用に保持されます。',
   en: 'The operation history will be retained for audit.'
 },
 'delete.confirmTask': { ja: 'このタスクを一覧から削除しますか？', en: 'Remove this task from normal application views?' },
 'delete.completedTask': {
   ja: 'このタスクには完了・承認履歴があります。削除後は通常の一覧に表示されませんが、履歴は監査用に保持されます。',
   en: 'This task has completion or approval history. It will disappear from normal views, but its historical evidence will be retained.'
 },
 'delete.confirmSubproject': { ja: 'このサブプロジェクトを削除しますか？', en: 'Remove this subproject?' },
 'delete.blocked': { ja: 'この記録は削除できません。', en: 'This record cannot be removed.' },
 'delete.blockedHint': {
   ja: '表示された進行中の関係またはワークフローを先に解決してください。子タスクや子サブプロジェクトは自動では削除されません。',
   en: 'Resolve the listed active relationships or workflows first. Child tasks and subprojects are never removed automatically.'
 },
 'delete.revealChildren': { ja: '子を表示', en: 'Show children' },
 'delete.submit': { ja: '削除する', en: 'Delete' },
 'delete.staleRevision': {
   ja: '他の更新により内容が変わりました。画面を再読み込みしてから、もう一度お試しください。',
   en: 'The record changed after you loaded it. Reload the page and try again.'
 },
 'delete.done': { ja: '一覧から削除しました。監査履歴は保持されています。', en: 'Removed from active lists; audit history was retained.' },
 'delete.blocker.HAS_DESCENDANTS': { ja: '子サブプロジェクトまたは子タスクが残っています', en: 'Child subprojects or tasks remain' },
 'delete.blocker.HAS_TASKS': { ja: 'タスクが残っています', en: 'Tasks remain' },
 'delete.blocker.AUDIT_HISTORY': { ja: '監査履歴があるため削除できません（アーカイブを使用）', en: 'Audit history exists; archive instead' },
 'delete.blocker.PUBLISHED': { ja: '共有ダッシュボードに公開されています', en: 'Published to the shared dashboard' },
 'delete.blocker.RECORDED_EFFORT': { ja: '記録済みの実績があります', en: 'Recorded effort exists' },
 'delete.blocker.UNVERIFIED_LEGACY_EFFORT': { ja: '未確認の旧実績値が保持されています', en: 'An unverified legacy effort value is retained' },
 'delete.blocker.APPROVALS': { ja: '承認履歴があります', en: 'Assignment or schedule approvals exist' },
 'delete.blocker.REQUESTS': { ja: '申請履歴があります', en: 'Employee requests exist' },
 'delete.blocker.NOTIFICATIONS': { ja: '通知履歴があります', en: 'Notification history exists' },
 'delete.blocker.DEADLINE_HISTORY': { ja: '期限変更の履歴があります', en: 'Deadline history exists' },
 'delete.blocker.SCHEDULE_CONFIRMATIONS': { ja: '日程確定の記録があります', en: 'A schedule decision exists' },
 'delete.blocker.ARCHIVED_RECORD': { ja: 'アーカイブ済みの記録は保持されます', en: 'An archived record is retained' },
 'delete.blocker.DEPENDENCY_REFERENCED': { ja: '他の作業がこの記録に依存しています', en: 'Other work depends on this record' },
 'delete.blocker.ACTIVE_WORKFLOW': { ja: '進行中の業務処理があります', en: 'An active operational workflow remains' },
 'delete.blocker.NOT_FOUND_OR_DELETED': { ja: '既に削除されています', en: 'Already removed' },
 'delete.blocker.generic': { ja: '削除できません', en: 'Removal is not allowed' },
 'delete.permanentAction': { ja: '誤作成記録を完全に消去', en: 'Permanently erase mistaken record' },
 'delete.permanentTitle': { ja: '誤作成記録の完全消去', en: 'Permanently erase mistaken record' },
 'delete.checkingPermanent': { ja: '完全消去の適格性を確認しています…', en: 'Checking permanent-erasure eligibility…' },
 'delete.permanentWarning': { ja: '{name} を物理的に消去します。この操作は元に戻せません。', en: 'Physically erase {name}. This cannot be undone.' },
 'delete.erasePlan': { ja: '消去される行', en: 'Rows that will be erased' },
 'delete.auditRetained': { ja: '最小限の削除記録と監査証跡は保持されます。', en: 'A minimal deletion tombstone and audit evidence will be retained.' },
 'delete.permanentBlockedHint': { ja: '業務証跡は物理消去できません。通常の削除で一覧から除外してください。', en: 'Operational evidence cannot be physically erased. Use normal removal to hide the record from active lists.' },
 'delete.useLogicalRemoval': { ja: '通常の削除に戻る', en: 'Return to normal removal' },
 'tasks.noChanges': { ja: '変更はありません。', en: 'No changes to save.' },
 'assignee.inactive': { ja: '無効', en: 'Inactive' },
 'action.open': { ja: '詳細を開く', en: 'Open' },
 'deadline.label': { ja: '納期', en: 'Deadline' },
 'deadline.todayBadge': { ja: '今日', en: 'Today' },
 'nav.allWork': { ja: 'すべてのタスク', en: 'All work' },
 'allWork.intro': {
   ja: '社内で共有されている作業を閲覧できます。閲覧のみで、変更はできません。',
   en: 'Browse the work shared inside the company. This view is read-only.'
 },
 'allWork.managerIntro': {
   ja: 'すべての作業を検索・編集できます。自分の担当は「自分の担当タスク」に表示されます。',
   en: 'Search and manage all work. Your own assignments stay under My assigned work.'
 },
 'allWork.scope': { ja: '表示中の {n} 件 / 全 {total} 件', en: '{n} shown of {total}' },
 'taskStatus.IN_PROGRESS': { ja: '進行中', en: 'In progress' },
 'taskStatus.OVERDUE': { ja: '期限超過', en: 'Overdue' },
 'taskStatus.DONE': { ja: '完了', en: 'Done' },
 'taskStatus.CANCELLED': { ja: '取消', en: 'Cancelled' },
 'tasks.includeInactive': { ja: '取消・アーカイブも表示', en: 'Include cancelled and archived' },
 'tasks.completeDirect': { ja: '完了にする', en: 'Mark done' },
 'tasks.completeDirectTitle': { ja: 'タスクを完了にします', en: 'Mark the task done' },
 'tasks.completeDirectBody': {
   ja: 'このタスクを完了にします。承認待ちの完了報告がある場合は取り下げられます。',
   en: 'This task will be marked done. Any pending completion report is withdrawn.'
 },
 'tasks.completeNote': { ja: '完了メモ（任意）', en: 'Completion note (optional)' },
 'tasks.completed': { ja: '完了にしました。', en: 'The task is done.' },
 'tasks.deadlineChangedConfirm': {
   ja: '期限を変更します。内容を確認して保存してください。',
   en: 'This changes the deadline. Review it before saving.'
 },
 'schedule.start': { ja: '開始日', en: 'Start date' },
 'schedule.finish': { ja: '終了日', en: 'Finish date' },
 'schedule.explanation': {
   ja: '開始日と終了日は作業の日程です。完了報告・承認とは別です。',
   en: 'These dates describe the schedule. Completion is recorded separately.'
 },
 'schedule.order': {
   ja: '開始日は終了日以前にしてください。',
   en: 'Start date must be on or before finish date.'
 },
 'schedule.forecastHistory': {
   ja: '過去の完了見込み',
   en: 'Historical forecast end'
 },
 'schedule.adoptForecast': {
   ja: 'この見込み日を終了日に採用',
   en: 'Use this forecast as Finish'
 },
 'tasks.noDurationNote': {
   ja: '期限だけを登録します。所要期間や工数の入力は不要です。',
   en: 'Only the deadline is recorded. No duration or effort estimate is required.'
 },
 'assignee.heading': { ja: '担当者', en: 'Assignees' },
 'assignee.available': { ja: '選択可能なメンバー', en: 'Available employees' },
 'assignee.selected': { ja: '選択済みの担当者', en: 'Selected assignees' },
 'assignee.search': { ja: '氏名・社員番号で検索', en: 'Search by name or employee ID' },
 'assignee.empty': { ja: '未選択', en: 'No one selected' },
 'assignee.none': { ja: '該当するメンバーがいません', en: 'No matching employee' },
 'assignee.hint': {
   ja: 'メンバーを選ぶと下の欄に移動します。×で外すと元の位置に戻ります。',
   en: 'Select an employee to move them down. Use × to return them to the list.'
 },
 'assignee.remove': { ja: '{name} を外す', en: 'Remove {name}' },
 'assignee.ownerNote': {
   ja: '先頭の担当者が主担当として記録されます。担当者は権限ではなく、作業の責任者を表します。',
   en: 'The first assignee is stored as the primary owner. Assignment is accountability, not permission.'
 },
 'skills.grade': { ja: '技能グレード', en: 'Skill grade' },
 'skills.notAssessed': { ja: '未評価', en: 'Not assessed' },
 'skills.gradeHint': {
   ja: 'A=4、B=3、C=2、D=1。未評価は 0 のまま保持されます。',
   en: 'A=4, B=3, C=2, D=1. Not-assessed values stay 0.'
 },
 'myWork.status': { ja: '状態', en: 'Status' },
 'myWork.memberOnlyCreate': {
   ja: 'タスクの作成と完了報告はメンバー（MEMBER）が行えます。',
   en: 'Task creation and completion reports are available to the MEMBER role.'
 },
 'myWork.managerNote': {
   ja: '管理者は「すべてのタスク」から作成・編集・完了を行えます。',
   en: 'Managers create, edit and complete work from All work.'
 },
 'myWork.derivedNote': {
   ja: '状態は期限と完了状況から自動で決まります（進行中・期限超過・完了）。',
   en: 'The state is derived from the deadline and completion (in progress, overdue, done).'
 },
 'myWork.pendingBadge': { ja: '承認待ち', en: 'Awaiting approval' },
 'local.linkExisting': { ja: '既存メンバーにログインを追加', en: 'Link a login to an existing member' },
 'local.newMember': { ja: '新しい社員として登録', en: 'Create a new employee' },
 'local.memberSearch': { ja: '既存メンバーを検索（氏名・メンバーID）', en: 'Search existing members (name or member ID)' },
 'local.memberSelected': { ja: '選択中のメンバー', en: 'Selected member' },
 'local.noLinkable': { ja: 'ログインを追加できる有効なメンバーがいません。', en: 'No active member is waiting for a login.' },
 'local.roleFromMember': {
   ja: '既存メンバーの氏名と権限は変更しません。',
   en: 'The existing name and role are never overwritten.'
 },
 'local.accountExists': { ja: 'この社員番号は既に登録されています。', en: 'This employee number already has a login.' },
 'local.list': { ja: '登録済みアカウント', en: 'Existing accounts' },
 'local.mustChange': { ja: '仮パスワード', en: 'Temporary password' },
 'local.noAccounts': { ja: '登録済みアカウントはありません。', en: 'No account exists yet.' },
 'local.employeeNumberHint': {
   ja: '社員番号はログインIDです。先頭の0は保持されます。',
   en: 'The employee ID is the login identifier; leading zeros are preserved.'
 },
 'tasks.expandBranch': { ja: '{name} の子タスクを開く', en: 'Expand subtasks of {name}' },
 'tasks.collapseBranch': { ja: '{name} の子タスクを閉じる', en: 'Collapse subtasks of {name}' },
 'tasks.treeScope': { ja: '条件に一致するタスク: {n} 件。下のページ切替は最上位タスク単位です。親タスクを開くと子タスクを表示します。', en: '{n} matching tasks. Pagination below is by top-level task. Expand a parent to show its subtasks.' },
 'tasks.childScope': { ja: '{name} の子タスク: {n} 件（現在の条件）', en: 'Subtasks of {name}: {n} (current filters)' },
 'local.myWork': {ja:'自分の担当タスク',en:'My assigned work'},
 'local.progressHint': {ja:'進捗は0～99%。完了と期限の変更は管理者の確認が必要です。',en:'Progress is 0–99%. Completion and deadline changes require manager review.'}, 'local.actualHours': {ja:'実績工数（時間）',en:'Actual hours'},
 'local.progress': {ja:'進捗（%）',en:'Progress (%)'},
  'local.employeeId': { ja: '社員番号', en: 'Employee ID' },
  'local.password': { ja: 'パスワード', en: 'Password' },
  'local.current': { ja: '現在のパスワード', en: 'Current password' },
  'local.newPassword': { ja: '新しいパスワード（4～128文字）', en: 'New password (4–128 characters)' },
  'local.repeat': { ja: '新しいパスワードを再入力', en: 'Repeat new password' },
  'local.signIn': { ja: 'ログイン', en: 'Sign in' },
  'local.intro': { ja: '社員番号とパスワードでログインしてください。', en: 'Sign in with your employee ID and password.' },
  'local.change': { ja: 'パスワード変更', en: 'Change password' },
  'local.required': { ja: '仮パスワードを変更してからご利用ください。変更後は再ログインします。', en: 'Change your temporary password before continuing. Sign in again after changing it.' },
  'local.accounts': { ja: 'アカウント管理', en: 'Accounts' },
  'local.create': { ja: 'アカウント作成', en: 'Create account' },
  'local.temporary': { ja: '仮パスワード（4～128文字）', en: 'Temporary password (4–128 characters)' },
  'local.reset': { ja: 'パスワードを再設定', en: 'Reset password' },
  'local.resetConfirm': { ja: '全セッションを終了し、次回ログイン時にパスワード変更を必須にします。', en: 'Revoke all sessions and require a password change at the next login.' },
  'local.linkMember': { ja: '既存メンバーID（任意・権限を維持）', en: 'Existing member ID (optional; preserves role)' },
  'local.saved': { ja: '保存しました。仮パスワードを本人に安全に伝えてください。', en: 'Saved. Deliver the temporary password securely to the employee.' },
  'local.next': { ja: '次へ', en: 'Next' },
  'local.previous': { ja: '前へ', en: 'Previous' },
   'myWork.intro': {
     ja: '自分の作業を登録し、進捗と完了報告を管理します。承認されるまで期限や状態は変わりません。',
     en: 'File your own work and manage progress and completion reports. Nothing changes until a request is approved.'
   },
   'myWork.newTask': { ja: '新規タスク', en: 'New task' },
   'myWork.newSubproject': { ja: '新規サブプロジェクト', en: 'New subproject' },
   'myWork.createGroup': { ja: '作成する内容', en: 'What to create' },
   'myWork.createSubproject': { ja: 'サブプロジェクトを作成', en: 'Create subproject' },
   'myWork.subprojectCreated': {
     ja: 'サブプロジェクトを作成しました。すぐにタスクを登録できます。',
     en: 'Subproject created. You can file a task under it immediately.'
   },
   'myWork.subprojectName': { ja: 'サブプロジェクト名', en: 'Subproject name' },
   'myWork.parentSubproject': { ja: '親サブプロジェクト（任意）', en: 'Parent subproject (optional)' },
   'myWork.parentSubprojectNone': { ja: '指定しない（最上位）', en: 'No parent (top level)' },
   'myWork.subprojectOwnerNote': {
     ja: '作成したサブプロジェクトの担当者はあなたになり、すぐに利用できます。承認は不要です。',
     en: 'You own the subproject you create and it is usable immediately. No approval is required.'
   },
   'myWork.createTaskUnder': { ja: 'このサブプロジェクトにタスクを作成', en: 'Create a task under this subproject' },
   'myWork.deadlineOptional': { ja: '納期（任意）', en: 'Deadline (optional)' },
   'myWork.project': { ja: 'プロジェクト', en: 'Project' },
   'myWork.subproject': { ja: 'サブプロジェクト（任意）', en: 'Subproject (optional)' },
   'myWork.subprojectNone': { ja: '指定しない', en: 'No subproject' },
   'myWork.taskName': { ja: 'タスク名', en: 'Task name' },
   'myWork.description': { ja: '説明（任意）', en: 'Description (optional)' },
   'myWork.priority': { ja: '優先度', en: 'Priority' },
   'myWork.deadline': { ja: '期限', en: 'Deadline' },
   'myWork.create': { ja: 'タスクを作成', en: 'Create task' },
   'myWork.created': {
     ja: 'タスクを作成しました。自分の作業一覧と管理者のタスク一覧に表示されます。',
     en: 'Task created. It appears in your work list and in the manager task list.'
   },
   'myWork.ownerNote': {
     ja: '作成したタスクの担当者はあなたになります。期限は作成後に自分では変更できません。',
     en: 'You become the owner of the task you create. The deadline can no longer be changed by you afterwards.'
   },
   'myWork.projectsEmpty': {
     ja: '作業を登録できる有効なプロジェクトがありません。管理者にプロジェクトの有効化を依頼してください。',
     en: 'No active project is available. Ask an administrator to activate a project.'
   },
   'myWork.projectsLoading': { ja: 'プロジェクトを読み込み中…', en: 'Loading projects…' },
   'myWork.dueSoonWarning': {
     ja: '期限が本日以前、または休業日にあたります。内容を確認してください。',
     en: 'The deadline is today or earlier, or falls on a non-working day. Please review it.'
   },
   'myWork.acknowledge': { ja: 'この期限で作成する', en: 'Create with this deadline' },
   'myWork.reportCompletion': { ja: '完了報告', en: 'Report completion' },
   'myWork.completionHeading': { ja: '完了報告の提出', en: 'Submit a completion report' },
   'myWork.completionNote': { ja: '完了した内容（必須）', en: 'What was completed (required)' },
   'myWork.submitCompletion': { ja: '報告を送信', en: 'Send report' },
   'myWork.reviewLabel': { ja: '完了報告の状況', en: 'Completion review' },
   'myWork.review.none': { ja: '申請なし', en: 'No request' },
   'myWork.review.pending': { ja: '承認待ち', en: 'Pending review' },
   'myWork.review.approved': { ja: '承認済（完了）', en: 'Approved' },
   'myWork.review.rejected': { ja: '却下', en: 'Rejected' },
   'myWork.review.returned': { ja: '差戻し', en: 'Returned' },
   'myWork.review.stale': { ja: '再確認が必要', en: 'Needs resubmission' },
   'myWork.adminApprovalNote': {
     ja: '自分で作成したタスクの完了は管理者（ADMIN）が承認します。',
     en: 'Completion of a task you created is approved by an administrator (ADMIN).'
   },
   'myWork.requestsHeading': { ja: '自分の申請', en: 'My requests' },
   'myWork.requestsSummary': { ja: '{total}件', en: '{total} total' },
   'myWork.requestsPendingSummary': { ja: '承認待ち {n}件', en: '{n} awaiting approval' },
   'myWork.requestsToggle': { ja: '自分の申請を開閉', en: 'Expand or collapse my requests' },
   'myWork.requestDetails': { ja: '詳細を表示', en: 'Show details' },
   'myWork.requestHideDetails': { ja: '詳細を閉じる', en: 'Hide details' },
   'myWork.requestSubmitted': { ja: '申請日', en: 'Submitted' },
   'myWork.requestsEmpty': { ja: '申請はまだありません。', en: 'No requests yet.' },
   'myWork.requestsClosed': {
     ja: '現在、申請の受付は停止しています。管理者に連絡してください。',
     en: 'Request submission is currently closed. Contact an administrator.'
   },
   'myWork.requestsClosedHint': {
     ja: '受付は自動化設定の REQUEST_SUBMISSION_ENABLED が true のときだけ有効です（既定は停止）。',
     en: 'Submissions are accepted only while the automation setting REQUEST_SUBMISSION_ENABLED is true (off by default).'
   },
   'myWork.containerNote': { ja: '親タスクは子タスクの完了から完了します。', en: 'A parent task completes through its child tasks.' },
   'myWork.doneNote': { ja: '完了済みのタスクです。', en: 'This task is already Done.' },
   'myWork.total': { ja: '全 {n} 件', en: '{n} total' },
   'myWork.requestType.DEADLINE_CHANGE': { ja: '納期変更申請', en: 'Deadline change' },
   'myWork.requestType.COMPLETION_REPORT': { ja: '完了報告', en: 'Completion report' },
   'myWork.decisionNote': { ja: '判断メモ', en: 'Decision note' },
   'myWork.submittedAt': { ja: '申請日時', en: 'Submitted' },
  'subprojects.new': { ja: '新規サブプロジェクト', en: 'New subproject' },
  'subprojects.edit': { ja: 'サブプロジェクトを編集', en: 'Edit subproject' },
  'subprojects.name': { ja: 'サブプロジェクト名', en: 'Subproject name' },
  'subprojects.parent': { ja: '親サブプロジェクト', en: 'Parent subproject' },
  'subprojects.description': { ja: '説明', en: 'Description' },
  'subprojects.details': { ja: '詳細を見る', en: 'View details' },
  'subprojects.hideDetails': { ja: '詳細を閉じる', en: 'Hide details' },
  'explore.intro': {
    ja: '社内で共有されているプロジェクトを閲覧できます。表示のみで、編集はできません。',
    en: 'Browse the projects shared inside the company. This view is read-only.'
  },
  'explore.search': { ja: 'プロジェクト名で検索', en: 'Search by project name' },
  'explore.empty': { ja: '表示できるプロジェクトがありません。', en: 'No projects to show.' },
  'explore.activeTasks': { ja: '未完了 {n}', en: '{n} open' },
  'explore.completedTasks': { ja: '完了 {n}', en: '{n} completed' },
  'explore.view': { ja: '詳細を見る', en: 'View details' },
  'project.info': { ja: 'プロジェクト情報', en: 'Project information' },
  'project.structure': { ja: 'プロジェクト構成', en: 'Project structure' },
  'common.noDescription': { ja: '説明なし', en: 'No description' },
  'breadcrumb.label': { ja: '現在地', en: 'Breadcrumb' },
  'tasks.descriptionTitle': { ja: '作業内容・説明', en: 'Task description' },
  'tasks.project': { ja: 'プロジェクト', en: 'Project' },
  'tasks.subprojectPath': { ja: 'サブプロジェクト', en: 'Subproject' },
  'tasks.priority': { ja: '優先度', en: 'Priority' },
  'tasks.info': { ja: 'タスク情報', en: 'Task information' },
  'plan.check': { ja: '日程を確認', en: 'Check schedule' },

  'picker.search': { ja: 'プロジェクトを検索', en: 'Search projects' },
  'state.unknown': { ja: '保存結果を確認できません。入力は保持されています。最新の記録を確認してから再試行してください。', en: 'The save outcome is unknown. Your draft is preserved. Check the latest record before retrying.' },
  'nav.skip': { ja: 'メイン画面へ移動', en: 'Skip to content' },
  'overview.intro': { ja: '今日の優先事項を確認し、次の作業へ進みましょう。', en: 'See what needs attention and keep your team moving.' },
  'color.choose': { ja: '色を選択', en: 'Choose a colour' },
  'color.clear': { ja: '既定の色に戻す', en: 'Use default colour' },
  'requests.includeDecided': { ja: '処理済みの申請も表示', en: 'Include reviewed requests' },

  'nav.overview': { ja: '概要', en: 'Overview' },
  'nav.projects': { ja: 'プロジェクト', en: 'Projects' },
  'nav.tasks': { ja: 'タスク', en: 'Tasks' },
  'nav.responsibilities': { ja: '分野', en: 'Responsibilities' },
  'nav.members': { ja: 'メンバー', en: 'Members' },
  'nav.skills': { ja: 'スキル', en: 'Skills' },
  'nav.requests': { ja: '申請一覧', en: 'Requests' },
  'nav.workload': { ja: '工数レポート', en: 'Workload' },
  'nav.automation': { ja: '自動化設定', en: 'Automation' },
  'nav.status': { ja: '状態・公開', en: 'Status & publication' },
  'nav.signOut': { ja: 'サインアウト', en: 'Sign out' },
  'login.title': { ja: '設計・開発課 管理にサインイン', en: 'Sign in to Engineering Management' },
  'login.google': { ja: 'Google でサインイン', en: 'Sign in with Google' },
  'login.dev': { ja: '開発用サインイン（この環境のみ）', en: 'Development sign-in (this environment only)' },
  'login.email': { ja: '会社のメールアドレス', en: 'Company e-mail address' },
  'login.failed': { ja: 'サインインできませんでした。', en: 'Sign-in failed.' },
  'login.unconfigured': {
    ja: 'この環境では Google サインインが未設定です。管理者に GOOGLE_CLIENT_ID の設定を依頼してください。',
    en: 'Google sign-in is not configured for this deployment. Ask an administrator to set GOOGLE_CLIENT_ID.'
  },
  'login.configError': {
    ja: 'サインイン設定を読み込めませんでした。再読み込みしてください。',
    en: 'The sign-in configuration could not be loaded. Reload the page.'
  },
  'login.domain': { ja: '会社の Google アカウントでサインインしてください。', en: 'Sign in with your company Google account.' },
  'overview.openWork': { ja: '未完了の作業', en: 'Open work' },
  'overview.completedWork': { ja: '完了タスク', en: 'Completed' },
  'overview.overdue': { ja: '期限超過', en: 'Overdue' },
  'overview.completed': { ja: '完了（履歴）', en: 'Completed (history)' },
  'overview.containers': { ja: '親タスク（作業単位外）', en: 'Containers (not work units)' },
  'overview.overdueWork': { ja: '期限超過の作業', en: 'Overdue Work' },
  'overview.upcoming': { ja: '今後の期限', en: 'Upcoming Deadlines' },
  'overview.period': { ja: '表示期間', en: 'Period' },
  'overview.days7': { ja: '7日', en: '7 Days' },
  'overview.days14': { ja: '14日', en: '14 Days' },
  'overview.days30': { ja: '1か月', en: '30 Days' },
  'overview.daysOverdue': { ja: '超過日数', en: 'Days overdue' },
  'overview.extensionPending': { ja: '申請保留中', en: 'Request pending' },
  'overview.viewAll': { ja: 'すべて表示', en: 'View all' },
  'overview.openProject': { ja: 'プロジェクトを開く: {name}', en: 'Open project: {name}' },
  'overview.areas': { ja: '分野', en: 'Responsibility areas' },
  'overview.pending': { ja: '未処理の申請', en: 'Pending requests' },
  'overview.scope': { ja: '表示範囲', en: 'Scope' },
  'overview.unassigned': { ja: '未分類', en: 'Unassigned' },
  'projects.groupContinues': { ja: '· 続きは他のページに表示されます。', en: '· More projects appear on other pages.' },
  'projects.completedTasks': { ja: '完了したタスク', en: 'Completed tasks' },
  'tasks.advanced': { ja: '詳細操作', en: 'Advanced' },
  'tasks.advancedHint': {
    ja: '割当承認と日程確定は監査・通知のワークフローを保持します。',
    en: 'Assignment approval and schedule confirmation retain their audit and notification workflows.'
  },
  'projects.new': { ja: '新規プロジェクト', en: 'New project' },
  'projects.edit': { ja: 'プロジェクトを編集', en: 'Edit project' },
  'projects.name': { ja: 'プロジェクト名', en: 'Project name' },
  'projects.description': { ja: '説明', en: 'Description' },
  'projects.category': { ja: '区分', en: 'Category' },
  'projects.responsibility': { ja: '分野', en: 'Responsibility' },
  'projects.owner': { ja: '責任者', en: 'Owner' },
  'projects.status': { ja: '状態', en: 'Status' },
  'projects.priority': { ja: '優先度', en: 'Priority' },
  'projects.deadline': { ja: '確定期限', en: 'Committed deadline' },
  'projects.forecast': { ja: '完了見込み', en: 'Forecast end' },
  'projects.plannedStart': { ja: '計画開始', en: 'Planned start' },
  'projects.visibility': { ja: '共有ダッシュボード公開', en: 'Shared dashboard visibility' },
  'projects.visibilityHint': { ja: '公開範囲の変更は次回の公開処理から反映されます。', en: 'A visibility change appears at the next publication.' },
  'projects.summary': { ja: '公開サマリー', en: 'Published summary' },
  'projects.nextAction': { ja: '次のアクション', en: 'Next action' },
  'projects.archive': { ja: 'アーカイブ', en: 'Archive' },
  'projects.delete': { ja: '削除', en: 'Delete' },
  'projects.progress': { ja: '進捗', en: 'Progress' },
  'projects.subprojects': { ja: 'サブプロジェクト', en: 'Subprojects' },
  'projects.tasks': { ja: 'タスク', en: 'Tasks' },
  'projects.milestones': { ja: 'マイルストーン', en: 'Milestones' },
  'projects.phases': { ja: 'フェーズ計画', en: 'Phases' },
  'tasks.new': { ja: '新規タスク', en: 'New task' },
  'tasks.edit': { ja: 'タスクを編集', en: 'Edit task' },
  'tasks.name': { ja: 'タスク名', en: 'Task name' },
  'tasks.owner': { ja: '主担当', en: 'Primary owner' },
  'tasks.assignees': { ja: '追加担当', en: 'Additional assignees' },
  'tasks.deadline': { ja: '期限', en: 'Deadline' },
  'tasks.duration': { ja: '必要日数', en: 'Required duration' },
  'tasks.durationUnit': { ja: '単位', en: 'Unit' },
  'tasks.durationBasis': { ja: '日数基準', en: 'Day basis' },
  'tasks.plannedStart': { ja: '計画開始（自動計算）', en: 'Planned start (derived)' },
  'tasks.estimate': { ja: '見積時間', en: 'Estimate (hours)' },
  'tasks.actual': { ja: '実績時間', en: 'Actual (hours)' },
  'tasks.progress': { ja: '進捗率', en: 'Progress %' },
  'tasks.dependencies': { ja: '依存タスク', en: 'Dependencies' },
  'tasks.parent': { ja: '親タスク', en: 'Parent task' },
  'tasks.subproject': { ja: 'サブプロジェクト', en: 'Subproject' },
  'tasks.acceptance': { ja: '受入条件', en: 'Acceptance criteria' },
  'tasks.approve': { ja: '割当を承認', en: 'Approve assignment' },
  'tasks.confirmSchedule': { ja: '日程を確定', en: 'Confirm schedule' },
  'tasks.override': { ja: '管理者による完了訂正', en: 'ADMIN completion correction' },
  'tasks.review': { ja: '完了申請', en: 'Completion review' },
  'tasks.deadlineConfirmed': { ja: '期限変更を確認しました', en: 'I confirm the deadline change' },
  'tasks.ackNonWorking': { ja: '非稼働日に設定することを確認しました', en: 'I acknowledge a non-working deadline' },
  'tasks.history': { ja: '期限の変更履歴', en: 'Deadline history' },
  'tasks.children': { ja: '子タスク', en: 'Child tasks' },
  'tasks.containerNote': { ja: '子タスクを持つタスクは作業単位ではありません。進捗は子タスクから算出されます。', en: 'A task with children is organisation only; progress comes from its leaf work.' },
  'responsibilities.new': { ja: '新規分野', en: 'New responsibility' },
  'responsibilities.edit': { ja: '分野を編集', en: 'Edit responsibility' },
  'responsibilities.name': { ja: '名称', en: 'Name' },
  'responsibilities.owner': { ja: '主担当者', en: 'Primary owner' },
  'responsibilities.members': { ja: '追加メンバー', en: 'Additional members' },
  'responsibilities.color': { ja: '色', en: 'Colour' },
  'responsibilities.retire': { ja: '廃止', en: 'Retire' },
  'responsibilities.reactivate': { ja: '再有効化', en: 'Reactivate' },
  'responsibilities.order': { ja: '表示順', en: 'Order' },
 'responsibilities.showRetired': { ja: '廃止済みを表示', en: 'Show retired' },
 'responsibilities.emptyActive': {
   ja: '有効な分野がありません。「廃止済みを表示」で廃止した分野を確認できます。',
   en: 'No active responsibilities. Turn on "Show retired" to see retired areas.'
 },
 'responsibilities.emptyFiltered': {
   ja: '条件に一致する分野がありません。',
   en: 'No responsibilities match the current filter.'
 },
 'responsibilities.delete': { ja: '分野を削除', en: 'Delete responsibility' },
 'responsibilities.deleteWarning': {
   ja: '「{name}」を削除しますか？この操作は元に戻せません。',
   en: 'Delete "{name}"? This cannot be undone.'
 },
 'responsibilities.deleteChecking': {
   ja: '削除できるか確認しています…',
   en: 'Checking whether this responsibility can be deleted…'
 },
 'responsibilities.deleteBlocked': { ja: '削除できません。', en: 'This responsibility cannot be deleted.' },
 'responsibilities.deleteProjectCount': { ja: '関連プロジェクト: {n}件', en: 'Related projects: {n}' },
 'responsibilities.deleteBlockedHint': {
   ja: 'この分野には関連プロジェクトがあります。先にプロジェクトの分野を変更してください。',
   en: 'This responsibility is still referenced by projects. Move the projects to another responsibility first.'
 },
 'responsibilities.deleteRetireInstead': { ja: '廃止する', en: 'Retire instead' },
 'responsibilities.deleteMembersNote': {
   ja: '担当メンバーの関連付けと削除理由は、削除記録と監査証跡として保持されます。',
   en: 'Member links and the deletion reason are retained in the deletion record and the audit trail.'
 },
 'responsibilities.deleted': { ja: '「{name}」を削除しました。', en: 'Deleted "{name}".' },
 'responsibilities.blocker.PROJECTS_REFERENCED': {
   ja: '関連プロジェクトが残っています',
   en: 'Projects still reference this responsibility'
 },
 'responsibilities.blocker.PUBLISHED': {
   ja: '共有ダッシュボードの公開データが参照しています',
   en: 'A published snapshot references this responsibility'
 },
 'responsibilities.blocker.ACTIVE_WORKFLOW': {
   ja: '進行中のバックグラウンド処理があります',
   en: 'A pending background job references this responsibility'
 },
 'responsibilities.blocker.ALREADY_DELETED': {
   ja: 'この識別子は既に削除済みです',
   en: 'This identifier was already deleted and is never reused'
 },
 'responsibilities.blocker.NOT_FOUND_OR_DELETED': {
   ja: '既に削除されています',
   en: 'Already deleted'
 },
 'responsibilities.blocker.generic': { ja: '削除できません', en: 'Deletion is not allowed' },
  'members.new': { ja: '新規メンバー', en: 'New member' },
  'members.edit': { ja: 'メンバーを編集', en: 'Edit member' },
  'members.name': { ja: '氏名', en: 'Name' },
  'members.email': { ja: 'メール', en: 'E-mail' },
  'members.department': { ja: '部署', en: 'Department' },
  'members.position': { ja: '役職', en: 'Position' },
  'members.role': { ja: 'ロール', en: 'Role' },
  'members.capacity': { ja: '週容量（時間）', en: 'Weekly capacity (hours)' },
  'members.active': { ja: '有効', en: 'Active' },
  'members.profile': { ja: 'プロフィール', en: 'Profile' },
  'members.current': { ja: '現在の担当', en: 'Current work' },
  'members.previous': { ja: '過去の担当', en: 'Previous work' },
  'members.activity': { ja: '活動履歴', en: 'Recorded activity' },
  'skills.new': { ja: '新規スキル', en: 'New skill' },
  'skills.assess': { ja: '評価を記録', en: 'Record assessment' },
  'skills.level': { ja: 'レベル', en: 'Level' },
  'skills.evidence': { ja: '根拠', en: 'Evidence' },
  'requests.decide': { ja: '申請を処理', en: 'Decide request' },
  'requests.approve': { ja: '承認', en: 'Approve' },
  'requests.reject': { ja: '却下', en: 'Reject' },
  'requests.return': { ja: '差し戻し', en: 'Return' },
  'requests.note': { ja: '判断メモ', en: 'Decision note' },
  'requests.sync': { ja: '受信箱を同期', en: 'Sync inbox' },
  'requests.imported': { ja: '{n} 件を取り込みました', en: 'Imported {n} request(s)' },
  'requests.empty': { ja: '未処理の申請はありません。', en: 'No pending requests.' },
  'requests.stale': { ja: 'タスクが変更されたため最新ではありません', en: 'The task changed after submission' },
  'automation.save': { ja: '設定を保存', en: 'Save settings' },
  'automation.revision': { ja: '設定リビジョン', en: 'Settings revision' },
  'automation.emergency': { ja: '緊急停止', en: 'Emergency stop' },
  'automation.mode': { ja: 'メールモード', en: 'Mail mode' },
  'automation.liveRequirements': { ja: 'LIVE の前提条件', en: 'LIVE requirements' },
  'automation.confirmLive': { ja: 'LIVE を有効にするには「ENABLE LIVE EMAIL」と入力してください。', en: 'Type "ENABLE LIVE EMAIL" to activate live email.' },
  'automation.confirmPublish': { ja: '公開を有効にするには「ENABLE SHARED DASHBOARD PUBLICATION」と入力してください。', en: 'Type "ENABLE SHARED DASHBOARD PUBLICATION" to enable publication.' },
  'publication.publishNow': { ja: '今すぐ公開', en: 'Publish now' },
  'publication.activeSlot': { ja: '公開スロット', en: 'Active slot' },
  'publication.contract': { ja: '公開契約', en: 'Contract' },
  'publication.hash': { ja: '内容ハッシュ', en: 'Content hash' },
  'status.counts': { ja: '件数', en: 'Row counts' },
  'status.outbox': { ja: '送信キュー', en: 'Outbox' },
  'status.backup': { ja: '最終バックアップ', en: 'Last backup' },
  'status.backupLocal': { ja: 'ローカルバックアップ', en: 'Local backup' },
  'status.backupDrive': { ja: 'Google Drive への最終アップロード', en: 'Last Drive upload' },
  'status.backupFailures': { ja: '直近のバックアップ失敗', en: 'Latest backup failure' },
  'workload.title': { ja: '工数レポート', en: 'Workload report' },
  'workload.basisNote': {
    ja: '現在の割当を、選択した日付で集計しています。過去の割当履歴を復元したものではありません。',
    en: 'Groups current assignments by the selected dates. It is not a reconstructed assignment history.'
  },
  'workload.mode.DAY': { ja: '日', en: 'Day' },
  'workload.mode.WEEK': { ja: '週', en: 'Week' },
  'workload.mode.MONTH': { ja: '月', en: 'Month' },
  'workload.mode.YEAR': { ja: '年', en: 'Year' },
  'workload.mode.CUSTOM': { ja: 'カスタム', en: 'Custom' },
  'workload.previous': { ja: '前へ', en: 'Previous' },
  'workload.next': { ja: '次へ', en: 'Next' },
  'workload.jump.DAY': { ja: '今日', en: 'Today' },
  'workload.jump.WEEK': { ja: '今週', en: 'This week' },
  'workload.jump.MONTH': { ja: '今月', en: 'This month' },
  'workload.jump.YEAR': { ja: '今年', en: 'This year' },
  'workload.jump.CUSTOM': { ja: '今週', en: 'This week' },
  'workload.range': { ja: '対象期間', en: 'Period' },
  'workload.custom.start': { ja: '開始日', en: 'Start date' },
  'workload.custom.end': { ja: '終了日', en: 'End date' },
  'workload.custom.granularity': { ja: '集計単位', en: 'Aggregation' },
  'workload.custom.auto': { ja: '自動', en: 'Auto' },
  'workload.custom.invalid': {
    ja: '開始日は終了日以前の日付を指定してください。',
    en: 'The start date must be on or before the end date.'
  },
  'workload.custom.tooLong': {
    ja: 'カスタム期間は366日以内で指定してください。',
    en: 'A custom range is limited to 366 days.'
  },
  'workload.granularity.DAY': { ja: '日次', en: 'Daily' },
  'workload.granularity.WEEK': { ja: '週次', en: 'Weekly' },
  'workload.granularity.MONTH': { ja: '月次', en: 'Monthly' },
  'workload.card.due': { ja: '対象期限タスク', en: 'Tasks due' },
  'workload.card.completed': { ja: '期間内完了', en: 'Completed' },
  'workload.card.overdue': { ja: '期限超過', en: 'Overdue' },
  'workload.card.undated': { ja: '期限未設定', en: 'No deadline' },
  'workload.card.dueHint': {
    ja: '選択期間に現在の期限があるタスク（取消を除く）',
    en: 'Tasks whose current due date falls inside the period (cancelled work excluded)'
  },
  'workload.card.completedHint': {
    ja: '選択期間に完了したタスク（完了日時で判定）',
    en: 'Tasks whose stored completion falls inside the period'
  },
  'workload.card.overdueHint': {
    ja: '未完了で期限が本日より前のタスク',
    en: 'Unfinished tasks whose due date is before today'
  },
  'workload.card.undatedHint': { ja: '期限が設定されていない未完了タスク', en: 'Unfinished tasks with no due date' },
  'workload.extra.overdueInPeriod': { ja: '期間内で期限超過', en: 'Overdue within the period' },
  'workload.extra.backlog': { ja: '期間前からの持ち越し', en: 'Backlog before the period' },
  'workload.extra.unique': { ja: '一意のタスク', en: 'Unique tasks' },
  'workload.extra.assignments': { ja: '割当（延べ）', en: 'Employee-task assignments' },
  'workload.timeline': { ja: '日付別のタスク', en: 'Tasks by date' },
  'workload.timeline.open': { ja: '{label} のタスクを表示', en: 'Show tasks for {label}' },
  'workload.timeline.overdueLegend': { ja: '期限超過を含む', en: 'Includes overdue' },
  'workload.axis.count': { ja: '期限タスク数（件）', en: 'Tasks due (count)' },
  'workload.axis.date': { ja: '日付', en: 'Date' },
  'workload.timeline.count': { ja: '{n}件', en: '{n} tasks' },
  'workload.timeline.countOne': { ja: '{n}件', en: '{n} task' },
  'workload.timeline.today': { ja: '今日', en: 'Today' },
  'workload.timeline.todayOutside': {
    ja: '今日は選択期間外です。',
    en: 'Today is outside the selected period.'
  },
  'workload.timeline.tooltip': {
    ja: '{date}／期限タスク: {count}件／期限超過を含む: {overdue}件',
    en: '{date} / Tasks due: {count} / Includes overdue: {overdue}'
  },
  'workload.employees': { ja: 'メンバー別の内訳', en: 'By member' },
  'workload.member': { ja: 'メンバー', en: 'Member' },
  'workload.dueTasks': { ja: '対象期限', en: 'Due' },
  'workload.completedTasks': { ja: '期間内完了', en: 'Completed' },
  'workload.overdue': { ja: '期限超過', en: 'Overdue' },
  'workload.undated': { ja: '期限未設定', en: 'Undated' },
  'workload.search': { ja: 'メンバー名で検索', en: 'Search member' },
  'workload.filter.member': { ja: 'メンバー', en: 'Member' },
  'workload.filter.project': { ja: 'プロジェクト', en: 'Project' },
  'workload.filter.responsibility': { ja: '分野', en: 'Responsibility' },
  'workload.sort': { ja: '並び順', en: 'Sort' },
  'workload.sort.overdue': { ja: '期限超過が多い順', en: 'Most overdue first' },
  'workload.sort.due': { ja: '対象期限が多い順', en: 'Most due first' },
  'workload.sort.name': { ja: 'メンバー名順', en: 'Member name' },
  'workload.sort.toggle': { ja: '昇順と降順を切り替える', en: 'Toggle sort direction' },
  'workload.sort.ascending': { ja: '昇順', en: 'Ascending' },
  'workload.sort.descending': { ja: '降順', en: 'Descending' },
  'workload.expand': { ja: '{name} のタスクを表示', en: 'Show tasks for {name}' },
  'workload.collapse': { ja: '{name} のタスクを閉じる', en: 'Hide tasks for {name}' },
  'workload.allMembers': { ja: '全メンバー', en: 'All members' },
  'workload.noEmployees': { ja: '該当するメンバーはいません。', en: 'No members match this filter.' },
  'workload.drill.DUE': { ja: '対象期限タスク', en: 'Tasks due in the period' },
  'workload.drill.COMPLETED': { ja: '期間内に完了したタスク', en: 'Tasks completed in the period' },
  'workload.drill.OVERDUE': { ja: '現在期限超過のタスク', en: 'Tasks overdue now' },
  'workload.drill.OVERDUE_IN_PERIOD': { ja: '期間内で期限超過のタスク', en: 'Tasks overdue within the period' },
  'workload.drill.UNDATED': { ja: '期限未設定のタスク', en: 'Tasks with no deadline' },
  'workload.drill.BACKLOG': { ja: '期間前からの持ち越しタスク', en: 'Tasks carried over from before the period' },
  'workload.drill.close': { ja: '内訳を閉じる', en: 'Close breakdown' },
  'workload.drill.empty': { ja: '該当するタスクはありません。', en: 'No tasks match this figure.' },
  'workload.column.project': { ja: 'プロジェクト', en: 'Project' },
  'workload.column.subproject': { ja: 'サブプロジェクト', en: 'Subproject' },
  'workload.column.task': { ja: 'タスク', en: 'Task' },
  'workload.column.assignees': { ja: '担当', en: 'Assignees' },
  'workload.column.deadline': { ja: '期限', en: 'Deadline' },
  'workload.column.completedOn': { ja: '完了日', en: 'Completed' },
  'workload.generatedAt': { ja: '集計時刻', en: 'Generated' },
  'state.saving': { ja: '保存中…', en: 'Saving…' },
  'state.saved': { ja: '保存しました', en: 'Saved' },
  'state.failed': { ja: '保存に失敗しました', en: 'Save failed' },
  'state.conflict': { ja: '他の更新と競合しました。再読み込みして確認してください。', en: 'This record changed. Reload and review.' },
  'state.unknownOutcome': { ja: '送信結果が不明です。自動で再送しません。', en: 'The outcome is unknown. It was not retried automatically.' },
  'state.loading': { ja: '読み込み中…', en: 'Loading…' },
  'state.empty': { ja: '該当するデータがありません。', en: 'Nothing to show.' },
  'state.denied': { ja: '権限がありません。', en: 'You are not authorised for this action.' },
  'state.sessionLost': { ja: 'サインインが失効しました。再度サインインしてください。', en: 'Your session ended. Sign in again.' },
  'state.retry': { ja: '再試行', en: 'Retry' },
  'action.create': { ja: '作成', en: 'Create' },
  'action.save': { ja: '保存', en: 'Save' },
  'action.cancel': { ja: 'キャンセル', en: 'Cancel' },
  'action.edit': { ja: '編集', en: 'Edit' },
  'action.confirm': { ja: '確認', en: 'Confirm' },
  'action.search': { ja: '検索', en: 'Search' },
  'action.next': { ja: '次へ', en: 'Next' },
  'action.previous': { ja: '前へ', en: 'Previous' },
  'filter.all': { ja: 'すべて', en: 'All' },
  'filter.status': { ja: '状態', en: 'Status' },
  'filter.responsibility': { ja: '分野', en: 'Responsibility' },
  'filter.query': { ja: 'キーワード', en: 'Keyword' },
  'column.name': { ja: '名称', en: 'Name' },
  'column.status': { ja: '状態', en: 'Status' },
  'column.owner': { ja: '担当', en: 'Owner' },
  'column.deadline': { ja: '期限', en: 'Deadline' },
  'column.progress': { ja: '進捗', en: 'Progress' },
  'column.actions': { ja: '操作', en: 'Actions' },
  'pagination.total': { ja: '全 {n} 件', en: '{n} total' },
  'confirm.archiveTitle': { ja: 'アーカイブの確認', en: 'Confirm archive' },
  'confirm.deleteTitle': { ja: '完全削除の確認', en: 'Confirm permanent removal' },
  'confirm.deleteReason': { ja: '理由（必須）', en: 'Reason (required)' },
  'confirm.type': { ja: '{text} と入力してください', en: 'Type {text}' },
  'confirm.blocked': { ja: '削除できません。アーカイブを使用してください。', en: 'This record cannot be removed; archive it instead.' },
  'error.correlation': { ja: '問い合わせID', en: 'Correlation ID' },
  'error.details': { ja: '詳細', en: 'Details' },

  // Usability release: shared form guidance.
  'common.required': { ja: '必須', en: 'Required' },
  'common.optional': { ja: '任意', en: 'Optional' },
  'common.notConfigured': { ja: '未設定', en: 'Not configured' },
  'common.optionCount': { ja: '{n} 件', en: '{n} options' },
  'common.disabled': { ja: '無効', en: 'Disabled' },
  'common.failed': { ja: '失敗', en: 'Failed' },
  'common.ok': { ja: '正常', en: 'OK' },
  'form.optionalSection': { ja: '任意の設定', en: 'Optional details' },
  'form.optionalHint': {
    ja: '日常の作成では通常使いません。必要なときだけ開いてください。',
    en: 'Usually not needed for routine creation. Open this only when required.'
  },
  'form.blockedReasons': { ja: 'このままでは登録できません', en: 'This cannot be submitted yet' },
  'form.noChanges': { ja: '変更された項目はありません。', en: 'No field has changed.' },
  'form.readOnly': { ja: '参照のみ', en: 'Read-only' },

  'taskForm.location': { ja: '作成先', en: 'Location' },
  'taskForm.changeLocation': { ja: '作成先を変更', en: 'Change location' },
  'taskForm.keepLocation': { ja: 'この作成先のまま', en: 'Keep this location' },
  'taskForm.projectRequired': { ja: 'プロジェクトを選択してください。', en: 'Select a project.' },
  'taskForm.nameRequired': { ja: 'タスク名を入力してください。', en: 'Enter a task name.' },
  'taskForm.deadlineRequired': { ja: '期限を入力してください。', en: 'Enter a deadline.' },
  'taskForm.assigneeHint': { ja: '担当者は任意です。後から追加できます。', en: 'Assignees are optional and can be added later.' },
  'taskForm.createAnother': { ja: '続けて作成', en: 'Create and add another' },
  'taskForm.createdAnother': {
    ja: '作成しました。作成先・担当者・優先度を引き継いでいます。',
    en: 'Created. The location, assignees and priority were kept for the next task.'
  },
  'taskForm.retainedAssignees': { ja: '担当: {names}', en: 'Assignees: {names}' },
  'taskForm.retainedPriority': { ja: '優先度: {value}', en: 'Priority: {value}' },
  'taskForm.retainedHint': { ja: '次のタスクに引き継いだ値', en: 'Kept for the next task' },
  'taskForm.parentHint': {
    ja: '親タスクはタスクの所属を示します。依存関係とは別の項目です。',
    en: 'The parent task shows where the task belongs; it is not a dependency.'
  },
  'taskForm.depthLimit': {
    ja: 'タスクは3階層までです。これ以上深いタスクは親に選べません。',
    en: 'Tasks nest up to three levels; a deeper task cannot be a parent.'
  },
  'taskForm.noParentOptions': { ja: 'この作成先には親にできるタスクがありません。', en: 'No eligible parent task in this location.' },
  'taskForm.parentSearch': { ja: '親タスクを検索', en: 'Search parent tasks' },
  'taskForm.parentTotal': { ja: '候補 {n} 件', en: '{n} eligible parents' },
  'taskForm.parentPage': { ja: '{page} / {pages}', en: '{page} / {pages}' },
  'taskForm.keepLocationHint': {
    ja: '作成先を変えるときだけ「作成先を変更」を押してください。',
    en: 'Press "Change location" only when this task belongs somewhere else.'
  },
  'taskForm.contextPath': { ja: '作成先: {path}', en: 'Location: {path}' },

  'subForm.planning': { ja: '計画の詳細', en: 'Planning details' },
  'projects.deadlineHint': {
    ja: '期限は約束した日付です。予定終了日は見込みで、工数は作業時間です。',
    en: 'The deadline is the committed date; the forecast end is an estimate and effort is work hours.'
  },  'subForm.planningHint': {
    ja: '期限・予定終了日・工数は別々の項目です。予定終了日は見込みで、工数は作業時間です。',
    en: 'The deadline, the forecast end and the effort are separate. The forecast is an estimate; effort is work hours.'
  },
  'subForm.estimateHint': { ja: '予定の長さから工数を自動計算しません。', en: 'Estimated hours are never derived from the schedule.' },
  'subForm.parentHint': { ja: 'サブプロジェクトは4階層までです。深い位置のものは親に選べません。', en: 'Subprojects nest up to four levels; a deeper one cannot be a parent.' },
  'subForm.contextPath': { ja: '作成先: {path}', en: 'Location: {path}' },
  'subForm.nameRequired': { ja: 'サブプロジェクト名を入力してください。', en: 'Enter a subproject name.' },

  'tasks.addChild': { ja: '子タスクを追加', en: 'Add child task' },
  'tasks.addChildCreated': { ja: '子タスクを作成しました。', en: 'Child task created.' },
  'tasks.addChildBlockedDepth': {
    ja: 'タスクは3階層までです。このタスクには子タスクを追加できません。',
    en: 'Tasks nest up to three levels, so this task cannot have a child.'
  },
  'tasks.addChildBlockedFinished': { ja: '完了または取消のタスクには子タスクを追加できません。', en: 'A completed or cancelled task cannot receive a child task.' },
  'tasks.addChildBlockedContainer': {
    ja: 'このタスクは作業単位ではありません。子タスクの完了は子タスク側で報告してください。',
    en: 'This task is a container. Report completion on the child task instead.'
  },
  'tasks.technical': { ja: '内部情報', en: 'Technical details' },
  'tasks.technicalHint': { ja: '保存値と版番号は通常の確認では使いません。', en: 'Stored values and revision numbers are not needed for everyday work.' },

  'report.heading': { ja: '完了を報告', en: 'Report completion' },
  'report.note': { ja: '完了報告の内容', en: 'Completion note' },
  'report.submit': { ja: '報告を送信', en: 'Send report' },
  'report.submitting': { ja: '送信中…', en: 'Sending…' },
  'report.dismiss': { ja: '閉じる', en: 'Close' },
  'report.blocked.container': {
    ja: '子タスクを持つタスクは直接完了できません。子タスクを完了してください。',
    en: 'A task with child tasks cannot be completed directly. Complete the child tasks instead.'
  },
  'report.blocked.done': { ja: 'このタスクは完了済みです。', en: 'This task is already complete.' },
  'report.blocked.cancelled': { ja: '取消のタスクには報告できません。', en: 'A cancelled task cannot receive a report.' },
  'report.blocked.pending': { ja: '承認待ちの申請があります。結果をお待ちください。', en: 'A request is awaiting review. Wait for the outcome.' },
  'report.blocked.disabled': { ja: '現在、完了報告の受付は停止しています。', en: 'Completion reports are currently closed.' },
  'report.blocked.role': { ja: '閲覧のみのアカウントは完了報告できません。', en: 'A read-only account cannot report completion.' },
  'report.blocked.notVisible': { ja: 'このタスクは閲覧できません。', en: 'This task is not visible to you.' },
  'report.blocked.archived': { ja: '廃止された作業には報告できません。', en: 'Archived work cannot receive a report.' },
  'report.blocked.notAssigned': { ja: '期限変更は担当メンバーのみ申請できます。', en: 'Only the assigned member may request a deadline change.' },
  'report.reporter': { ja: '完了報告者: {name}', en: 'Reported by: {name}' },
  'report.reporterHint': {
    ja: '報告者として記録されるのは、サインイン中のあなた自身です。担当者の変更やタスクの完了は行われません。',
    en: 'You are recorded as the reporter. The assignee is not changed and the task is not completed.'
  },
  'report.eligibilityLoading': { ja: '報告できるか確認しています…', en: 'Checking whether you can report this task…' },
  'report.eligibilityUnavailable': {
    ja: '報告の可否を確認できないため、いまは報告できません。再読み込みしてください。',
    en: 'Reporting stays unavailable because eligibility could not be confirmed. Reload and try again.'
  },
  'report.assignedTo': { ja: '担当: {names}', en: 'Assigned to: {names}' },
  'report.notAssigned': { ja: '担当者以外からの報告です。', en: 'Reported by someone who is not an assignee.' },
  'report.submittedBy': { ja: '報告者', en: 'Reported by' },
  'report.reviewedBy': { ja: '確認者: {name}', en: 'Reviewed by: {name}' },
  'report.noAssignee': { ja: '担当者は未設定です。', en: 'No assignee is set.' },
  'report.state.pending': { ja: '承認待ち', en: 'Awaiting review' },
  'report.state.approved': { ja: '承認済み', en: 'Approved' },
  'report.state.rejected': { ja: '却下', en: 'Rejected' },
  'report.state.returned': { ja: '差し戻し', en: 'Returned' },
  'report.state.stale': { ja: '内容が変わったため再申請が必要です', en: 'The task changed; submit again' },

  'requests.task': { ja: 'タスク', en: 'Task' },
  'requests.context': { ja: 'プロジェクト / サブプロジェクト', en: 'Project / subproject' },
  'requests.reporter': { ja: '完了報告者', en: 'Reported by' },
  'requests.selfReported': {
    ja: '自己申告（検証されたアカウントではありません）',
    en: 'Self-reported (not a verified account)'
  },
  'requests.submitted': { ja: '申請日時', en: 'Submitted' },
  'requests.state': { ja: '申請の状態', en: 'Request state' },
  'requests.openTask': { ja: 'タスクを別タブで開く', en: 'Open the task in a new tab' },
  'requests.rejectHelp': {
    ja: '却下はこの申請を終了します。タスクの期限や状態は変わりません。',
    en: 'Reject closes this request. The task deadline and status do not change.'
  },
  'requests.returnHelp': {
    ja: '差し戻しは申請者に再提出を求めます。タスクは変更されません。',
    en: 'Return asks the reporter to submit again. The task is not changed.'
  },
  'requests.approveHelp': { ja: '承認すると、この申請が示す変更を一度だけ適用します。', en: 'Approve applies the requested change once.' },

  'myWork.filter.task': { ja: 'タスク名で検索', en: 'Search task name' },
  'myWork.filter.project': { ja: 'プロジェクト', en: 'Project' },
  'myWork.filter.overdue': { ja: '期限超過', en: 'Overdue' },
  'myWork.filter.dueThisWeek': { ja: '今週期限', en: 'Due this week' },
  'myWork.filter.awaitingReview': { ja: '承認待ち', en: 'Awaiting review' },
  'myWork.filter.reset': { ja: '絞り込みを解除', en: 'Reset filters' },
  'myWork.filter.active': { ja: '絞り込み中', en: 'Filtered' },
  'myWork.noAssignments': { ja: '担当タスクはありません。', en: 'You have no assigned tasks.' },
  'myWork.noMatches': { ja: '条件に一致するタスクはありません。', en: 'No tasks match these filters.' },
  'myWork.matching': { ja: '一致 {n} 件', en: '{n} matching' },
  'myWork.allActive': { ja: '未完了 {n} 件', en: '{n} active' },
  'myWork.loading': { ja: '読み込み中…', en: 'Loading…' },
  'myWork.filter.projectSearch': { ja: 'プロジェクト名で検索', en: 'Search project name' },
  'myWork.filter.projectMore': { ja: '他に {n} 件のプロジェクト', en: '{n} more projects' },
  'myWork.filter.projectSelected': { ja: '選択中: {name}', en: 'Selected: {name}' },

  'nav.group.myWork': { ja: '自分の作業', en: 'My work' },
  'nav.group.department': { ja: '課の業務', en: 'Section work' },
  'nav.group.people': { ja: 'メンバーと分野', en: 'People' },
  'nav.group.admin': { ja: '管理', en: 'Administration' },

  'nav.timeline': { ja: 'タイムライン', en: 'Timeline' },
  'timeline.title': { ja: 'タイムライン', en: 'Timeline' },
  'timeline.intro': {
    ja: '計画と期限を横並びで確認できます。読み取り専用で、ここから期限や日程は変更しません。',
    en: 'Plans and deadlines side by side. Read-only: nothing here changes a deadline or a schedule.'
  },
  'timeline.scope.all': { ja: 'すべてのプロジェクト', en: 'All permitted projects' },
  'timeline.scope.project': { ja: 'プロジェクトを選択', en: 'Select a project' },
  'timeline.scope.subproject': { ja: 'サブプロジェクトを選択', en: 'Select a subproject' },
  'timeline.scope.allSubprojects': { ja: 'すべてのサブプロジェクト', en: 'All subprojects' },
  'timeline.scope.selectProject': { ja: '先にプロジェクトを選択してください', en: 'Select a project first' },
  'timeline.scope.responsibility': { ja: '分野で絞り込み', en: 'Filter by responsibility' },
  'timeline.scope.allResponsibilities': { ja: 'すべての分野', en: 'All responsibilities' },
  'timeline.scale': { ja: '表示単位', en: 'Scale' },
  'timeline.scale.week': { ja: '週', en: 'Week' },
  'timeline.scale.month': { ja: '月', en: 'Month' },
  'timeline.scale.quarter': { ja: '四半期', en: 'Quarter' },
  'timeline.previous': { ja: '前へ', en: 'Previous period' },
  'timeline.today': { ja: '今日', en: 'Today' },
  'timeline.next': { ja: '次へ', en: 'Next period' },
  'timeline.fit': { ja: '全体を表示', en: 'Fit selection' },
  'timeline.displayStart': { ja: '表示開始日', en: 'Display start' },
  'timeline.displayFinish': { ja: '表示終了日', en: 'Display finish' },
  'timeline.resetDates': { ja: '表示期間をリセット', en: 'Reset dates' },
  'timeline.invalidDates': { ja: '開始日は終了日以前の日付を入力してください。現在の表示は変更されません。', en: 'Enter complete dates with start on or before finish. The current chart remains unchanged.' },
  'timeline.dateHint': { ja: '表示期間は閲覧専用です。保存済みの予定は変更されません。', en: 'Display dates are read-only filters and never change stored schedules.' },
  'timeline.includeCompleted': { ja: '完了した作業も表示', en: 'Show completed work' },
  'timeline.filter.active': { ja: '絞り込み中', en: 'Filtered' },
  'timeline.reset': { ja: '条件を解除', en: 'Reset' },
  'timeline.legend.planned': { ja: '予定（開始〜終了）', en: 'Planned span' },
  'timeline.legend.deadline': { ja: '期限', en: 'Deadline' },
  'timeline.legend.childRange': { ja: '子項目の期間', en: 'Child date range' },
  'timeline.legend.completed': { ja: '完了日', en: 'Recorded completion' },
  'timeline.undated': { ja: '日付未設定', en: 'No dates' },
  'timeline.undatedHint': {
    ja: '日付が保存されていないため、この行は期間を表示しません。',
    en: 'No stored date, so this row has no span.'
  },
  'timeline.startNotSet': { ja: '開始日未設定', en: 'Start date not set' },
  'timeline.inconsistent': {
    ja: '開始日が期限より後になっています。値は自動で修正しません。',
    en: 'The start date falls after the deadline. Nothing is corrected automatically.'
  },
  'timeline.childRange': { ja: '子項目の期間', en: 'Child date range' },
  'timeline.childRangeHint': {
    ja: '配下の日付から算出した表示上の期間です。作業量としては数えません。',
    en: 'A display span derived from dated descendants. It is never counted as work.'
  },
  'timeline.container': { ja: '入れ物', en: 'Container' },
  'timeline.expand': { ja: '展開', en: 'Expand' },
  'timeline.collapse': { ja: '折りたたむ', en: 'Collapse' },
  'timeline.loading': { ja: '読み込み中…', en: 'Loading…' },
  'timeline.empty': { ja: '表示できるプロジェクトがありません。', en: 'No project is available to show.' },
  'timeline.branchLoading': { ja: '階層を読み込み中…', en: 'Loading the hierarchy…' },
  'timeline.more': { ja: '他に {n} 件あります', en: '{n} more results' },
  'timeline.taskTotal': { ja: '表示 {n} 行', en: '{n} rows' },
  'timeline.truncated': {
    ja: 'タスクが多いため、先頭 {shown} 件のみ表示しています（全 {total} 件）。',
    en: 'Only the first {shown} of {total} tasks are shown because the branch is large.'
  },
  'timeline.openTask': { ja: 'タスクを開く', en: 'Open the task' },
  'timeline.details': { ja: '内容', en: 'Details' },
  'timeline.listView': { ja: '一覧で確認', en: 'Text list' },
  'timeline.projectLink': { ja: 'タイムラインで表示', en: 'View in timeline' },
  'timeline.noProjects': { ja: 'この分野に表示できるプロジェクトはありません。', en: 'No project in this responsibility is available.' },
  'timeline.scope.filtered': { ja: 'この表示は絞り込み後の範囲です。', en: 'This view shows the filtered scope.' },
  'timeline.dates.plan': { ja: '予定', en: 'Planned' },
  'timeline.dates.deadline': { ja: '期限', en: 'Deadline' },
  'timeline.dates.completed': { ja: '完了日', en: 'Completed' },

  'automation.configured': { ja: '設定値', en: 'Configured' },
  'automation.effective': { ja: '実効状態', en: 'Effective' },
  'automation.readOnlyHint': { ja: '管理者のみ変更できます。表示は現在の設定値です。', en: 'Only ADMIN can change these. The values shown are the current settings.' },
  'automation.consequence': { ja: '影響', en: 'Consequence' },
  'automation.valueNotSet': { ja: '未設定（安全側で動作）', en: 'Not set (fails safe)' },
  'automation.consequence.EMAIL_MODE': {
    ja: 'LIVE は実際にメールを送信します。PREVIEW は記録のみ、OFF は送信しません。',
    en: 'LIVE sends real mail. PREVIEW only records, and OFF sends nothing.'
  },
  'automation.consequence.EMERGENCY_STOP': { ja: 'ON の間はすべての送信が停止します。', en: 'While ON, every outbound send is stopped.' },
  'automation.consequence.SHARED_DASHBOARD_PUBLISH_ENABLED': {
    ja: 'ON にすると次回の公開で共有ダッシュボードが更新されます。即時反映ではありません。',
    en: 'Turning this ON updates the shared dashboard at the next publication, not immediately.'
  },
  'automation.consequence.MAX_EMAILS_PER_RUN': { ja: '1回の実行で送る上限です。超えた分は次回に回ります。', en: 'Cap per run; anything above it is deferred.' },
  'automation.consequence.COUNT': { ja: '数値で指定します。', en: 'Enter a number.' },
  'automation.consequence.TOGGLE': { ja: '有効／無効を切り替えます。', en: 'Switches the feature on or off.' },
  'automation.consequence.DEFAULT': { ja: '既存の設定値をそのまま保存します。', en: 'Stores the same setting value.' },
  'automation.emergencyAccess': { ja: '緊急停止', en: 'Emergency stop' },

  'status.health': { ja: '運用状態', en: 'Operational health' },
  'status.health.backup': { ja: 'バックアップ', en: 'Backup' },
  'status.health.requests': { ja: '申請の受付', en: 'Request intake' },
  'status.health.email': { ja: 'メール送信', en: 'Email delivery' },
  'status.health.publication': { ja: '共有ダッシュボード公開', en: 'Shared dashboard publication' },
  'status.diagnostics': { ja: '内部情報', en: 'Diagnostics' },
  'status.diagnosticsHint': { ja: 'ハッシュ・スロット・契約版・件数は通常の確認では使いません。', en: 'Hashes, slots, contract versions and row counts are not needed for routine checks.' },
  'status.memberRecord': { ja: 'メンバー情報へ', en: 'Member record' },
  'status.accountAdmin': { ja: 'アカウント管理へ', en: 'Account administration' },

  'local.memberRecord': { ja: 'メンバー登録', en: 'Member record' },
  'local.loginConfigured': { ja: 'ログイン設定あり', en: 'Login configured' },
  'local.loginMissing': { ja: 'ログイン未設定', en: 'No login configured' },
  'local.profileLink': { ja: 'プロフィールを開く', en: 'Open profile' },

  'error.title': { ja: '処理できませんでした', en: 'This could not be completed' },
  'error.conflictTitle': { ja: '新しい版が保存されています', en: 'A newer version was saved' },
  'error.conflictHelp': {
    ja: 'この画面を開いた後に他の変更が保存されました。上書きせず、再読み込みして最新の内容を確認してください。',
    en: 'Someone saved a change after you opened this screen. Nothing was overwritten; reload and review the latest values.'
  },
  'error.unknownTitle': { ja: '結果を確認できませんでした', en: 'The outcome could not be confirmed' },
  'error.unknownHelp': {
    ja: '通信の問題で結果が不明です。自動では再送しません。一覧を再読み込みして状態を確認してください。',
    en: 'The result is unknown because the connection failed. It was not retried automatically. Reload the list to check the current state.'
  },
  'error.deniedTitle': { ja: '権限がありません', en: 'Not authorised' },
  'error.retryTitle': { ja: '一時的な問題', en: 'Temporary problem' },
  'error.reload': { ja: '再読み込み', en: 'Reload' },
  'error.codeLabel': { ja: 'コード', en: 'Code' },

  'freshness.snapshot': {
    ja: 'この画面は公開スナップショットを表示しています。最終公開時点の内容で、リアルタイムではありません。',
    en: 'This screen shows the published snapshot as of the last publication. It is not live data.'
  },
  'freshness.live': { ja: 'この画面は保存済みの最新データを表示しています。', en: 'This screen shows the latest saved data.' },
  'freshness.stale': {
    ja: '公開スナップショットが最新ではありません。再公開をお待ちください。',
    en: 'The published snapshot is not current; wait for the next publication.'
  }
} as const;

export type V2LabelKey = keyof typeof V2_LABELS;

const CONTEXT = createContext<{
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  label: (group: string, value: string) => string;
} | null>(null);

function readStoredLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // localStorage can be unavailable in private mode; the default language still works.
  }
  return DEFAULT_LANGUAGE;
}

export function I18nProvider({ children }: { children: ReactNode }): JSX.Element {
  const [language, setLanguageState] = useState<Language>(readStoredLanguage);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // A browser without storage keeps the language for this page only.
    }
  }, []);

  const value = useMemo(() => {
    const translate = (key: string, vars?: Record<string, string | number>): string => {
      const local = (V2_LABELS as Record<string, { ja: string; en: string }>)[key];
      if (local) {
        const text = local[language];
        if (!vars) return text;
        return text.replace(/\{(\w+)\}/g, (match, name: string) =>
          Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
        );
      }
      return dictT(language, key, vars);
    };
    return {
      language,
      setLanguage,
      t: translate,
      label: (group: string, value: string) => dictLabel(language, group, value)
    };
  }, [language, setLanguage]);

  return <CONTEXT.Provider value={value}>{children}</CONTEXT.Provider>;
}

export function useI18n() {
  const value = useContext(CONTEXT);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}

export { APP_NAME, LANGUAGES };
