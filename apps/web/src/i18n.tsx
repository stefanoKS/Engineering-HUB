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
  'error.details': { ja: '詳細', en: 'Details' }
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
