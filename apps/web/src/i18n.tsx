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
  'nav.overview': { ja: '概要', en: 'Overview' },
  'nav.projects': { ja: 'プロジェクト', en: 'Projects' },
  'nav.tasks': { ja: 'タスク', en: 'Tasks' },
  'nav.responsibilities': { ja: '担当領域', en: 'Responsibilities' },
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
  'login.domain': { ja: '会社の Google アカウントでサインインしてください。', en: 'Sign in with your company Google account.' },
  'overview.openWork': { ja: '未完了の作業', en: 'Open work' },
  'overview.overdue': { ja: '期限超過', en: 'Overdue' },
  'overview.completed': { ja: '完了（履歴）', en: 'Completed (history)' },
  'overview.containers': { ja: '親タスク（作業単位外）', en: 'Containers (not work units)' },
  'overview.upcoming': { ja: '今後14日の期限', en: 'Due in the next 14 days' },
  'overview.areas': { ja: '担当領域', en: 'Responsibility areas' },
  'overview.pending': { ja: '未処理の申請', en: 'Pending requests' },
  'overview.scope': { ja: '表示範囲', en: 'Scope' },
  'overview.unassigned': { ja: '未分類', en: 'Unassigned' },
  'projects.new': { ja: '新規プロジェクト', en: 'New project' },
  'projects.edit': { ja: 'プロジェクトを編集', en: 'Edit project' },
  'projects.name': { ja: 'プロジェクト名', en: 'Project name' },
  'projects.description': { ja: '説明', en: 'Description' },
  'projects.category': { ja: '区分', en: 'Category' },
  'projects.responsibility': { ja: '担当領域', en: 'Responsibility' },
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
  'projects.delete': { ja: '完全削除（管理者）', en: 'Delete permanently (ADMIN)' },
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
  'responsibilities.new': { ja: '新規担当領域', en: 'New responsibility' },
  'responsibilities.edit': { ja: '担当領域を編集', en: 'Edit responsibility' },
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
  'workload.member': { ja: 'メンバー', en: 'Member' },
  'workload.week': { ja: '週', en: 'Week' },
  'workload.remaining': { ja: '残作業（時間）', en: 'Remaining hours' },
  'workload.capacity': { ja: '容量', en: 'Capacity' },
  'workload.utilization': { ja: '負荷率', en: 'Utilisation' },
  'workload.unknown': { ja: '未見積タスク', en: 'Unestimated tasks' },
  'workload.overdue': { ja: '期限超過', en: 'Overdue' },
  'workload.note': { ja: '負荷は目安であり、割当の制限ではありません。', en: 'Utilisation is an indicator, never an assignment limit.' },
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
  'filter.responsibility': { ja: '担当領域', en: 'Responsibility' },
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
