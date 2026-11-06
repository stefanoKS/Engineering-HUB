/**
 * Presentational overview sections shared by the manager overview and the member overview.
 *
 * Both roles see the same KPI cards, the same work/deadline tables, the same responsibility
 * summaries and the same progress and schedule presentation. The sections never fetch and never
 * decide scope: every figure and row they render was resolved on the server inside the reader's
 * authorized scope. Only the surrounding page differs, because a manager has decisions and a
 * member has creation and request entry points.
 */
import type { ReactNode } from 'react';
import type { ScopeCounts, TaskSummary } from '@eh/contracts';
import { useI18n } from '../i18n';
import { Badge, EmptyState, Section } from './ui';
import { DeadlineCell } from './deadline';
import { TaskStatusBadge } from './task-status';

export type OverviewResponsibilityCard = {
  responsibilityId: string;
  name: string;
  color: string;
  status: string;
  projectCount: number;
  openWork: number;
  overdueWork: number;
  completedWork: number;
  /** Manager-only accountability field; it is simply absent in the member payload. */
  ownerName?: string;
};

export function taskAssignees(task: { ownerName: string; assigneeNames: string[] }, unset: string): string {
  const names = [...new Set([task.ownerName, ...task.assigneeNames].filter(Boolean))];
  return names.join(', ') || unset;
}

export function daysBetween(dueDate: string | null, today: string): number {
  if (!dueDate) return 0;
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
}

export function Kpi({
  label,
  value,
  tone,
  onClick
}: {
  label: string;
  value: number;
  tone: 'info' | 'danger' | 'ok' | 'neutral';
  onClick?: () => void;
}): JSX.Element {
  const content = (
    <>
      <span className="kpi-value">{value}</span>
      <span className="kpi-label">{label}</span>
    </>
  );
  return onClick ? (
    <button type="button" className={`kpi kpi-button ${tone}`} onClick={onClick} aria-label={`${label}: ${value}`}>
      {content}
    </button>
  ) : (
    <div className={`kpi ${tone}`}>{content}</div>
  );
}

export function OverviewKpis({
  counts,
  onOpenWork,
  onOverdue,
  onCompleted
}: {
  counts: ScopeCounts;
  onOpenWork?: () => void;
  onOverdue?: () => void;
  onCompleted?: () => void;
}): JSX.Element {
  const { t } = useI18n();
  // The two numbers a reader acts on come first; history and structure stay a quiet second line.
  return (
    <div className="overview-summary">
      <div className="kpi-grid kpi-primary">
        <Kpi label={t('overview.openWork')} value={counts.openWork} tone="info" onClick={onOpenWork} />
        <Kpi label={t('overview.overdue')} value={counts.overdueWork} tone="danger" onClick={onOverdue} />
      </div>
      <div className="kpi-grid kpi-secondary">
        <Kpi label={t('overview.completed')} value={counts.completedWork} tone="ok" onClick={onCompleted} />
        <Kpi label={t('overview.containers')} value={counts.containers} tone="neutral" />
      </div>
    </div>
  );
}

/** The overdue list, with the days-overdue column and an optional drill-down action. */
export function OverdueWorkSection({
  tasks,
  total,
  today,
  onViewAll,
  showPeriod
}: {
  tasks: readonly TaskSummary[];
  total: number;
  today: string;
  onViewAll?: () => void;
  showPeriod: boolean;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <Section
      title={t('overview.overdueWork')}
      className={tasks.length > 0 ? 'section-overdue' : 'section-quiet'}
      actions={
        showPeriod && total > tasks.length && tasks.length > 0 && onViewAll ? (
          <button type="button" className="link-button" onClick={onViewAll}>
            {t('overview.viewAll')}
          </button>
        ) : undefined
      }
    >
      {tasks.length === 0 ? (
        <p className="empty-inline">{t('overview.noOverdue')}</p>
      ) : (
        <table className="table overview-work-table">
          <thead>
            <tr>
              <th>{t('column.name')}</th>
              <th>{t('nav.projects')}</th>
              <th>{t('column.owner')}</th>
              <th>{t('column.deadline')}</th>
              <th>{t('overview.daysOverdue')}</th>
              <th>{t('column.status')}</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.taskId}>
                <td>
                  <a href={`#/task/${task.taskId}`}>{task.taskName}</a>
                </td>
                <td>
                  <a href={`#/project/${task.projectId}`} aria-label={t('overview.openProject', { name: task.projectName })}>
                    {task.projectName}
                  </a>
                </td>
                <td>{taskAssignees(task, t('common.unset'))}</td>
                <td>
                  <DeadlineCell dueDate={task.dueDate} state={task.displayStatus} showLabel={false} />
                </td>
                <td>{daysBetween(task.dueDate, today)}</td>
                <td>
                  <TaskStatusBadge state={task.displayStatus} missing={task.scheduleMissing} showDetail />
                  {task.reviewState === 'PENDING' ? <Badge tone="warn">{t('overview.extensionPending')}</Badge> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

/** The "due in the next N days" list; the period is a server-side query parameter. */
export function UpcomingWorkSection({
  tasks,
  window,
  days,
  onChangeDays,
  onViewAll
}: {
  tasks: readonly TaskSummary[];
  window: { from: string; to: string };
  days: 7 | 14 | 30;
  onChangeDays: (days: 7 | 14 | 30) => void;
  onViewAll?: () => void;
}): JSX.Element {
  const { t } = useI18n();
  return (
    <Section
      title={t('overview.upcoming')}
      actions={
        <div className="inline-actions">
          {onViewAll ? (
            <button type="button" className="link-button" onClick={onViewAll}>
              {t('overview.viewAll')}
            </button>
          ) : null}
          <label className="inline-field">
            <span>{t('overview.period')}</span>
            <select
              value={days}
              onChange={(event) => onChangeDays(Number(event.target.value) as 7 | 14 | 30)}
              aria-label={t('overview.period')}
            >
              <option value={7}>{t('overview.days7')}</option>
              <option value={14}>{t('overview.days14')}</option>
              <option value={30}>{t('overview.days30')}</option>
            </select>
          </label>
        </div>
      }
    >
      <p className="muted small overview-date-range">
        {window.from} – {window.to}
      </p>
      {tasks.length === 0 ? (
        <EmptyState />
      ) : (
        <table className="table overview-work-table">
          <thead>
            <tr>
              <th>{t('column.name')}</th>
              <th>{t('nav.projects')}</th>
              <th>{t('column.owner')}</th>
              <th>{t('column.deadline')}</th>
              <th>{t('column.status')}</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.taskId}>
                <td>
                  <a href={`#/task/${task.taskId}`}>{task.taskName}</a>
                </td>
                <td>
                  <a href={`#/project/${task.projectId}`} aria-label={t('overview.openProject', { name: task.projectName })}>
                    {task.projectName}
                  </a>
                </td>
                <td>{taskAssignees(task, t('common.unset'))}</td>
                <td>
                  <DeadlineCell dueDate={task.dueDate} state={task.displayStatus} showLabel={false} />
                </td>
                <td>
                  <TaskStatusBadge state={task.displayStatus} missing={task.scheduleMissing} showDetail />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

/** Responsibility summaries: the same card for both roles, without any private area field. */
export function ResponsibilityCards({
  cards,
  onOpen
}: {
  cards: readonly OverviewResponsibilityCard[];
  onOpen?: (responsibilityId: string) => void;
}): JSX.Element {
  const { t, label } = useI18n();
  return (
    <Section title={t('overview.areas')}>
      {cards.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="card-grid">
          {cards.map((card) => (
            <div key={card.responsibilityId} className="area-card" style={{ borderColor: card.color || undefined }}>
              <h3>
                {onOpen ? (
                  <button type="button" className="link-button" onClick={() => onOpen(card.responsibilityId)}>
                    {card.name}
                  </button>
                ) : (
                  card.name
                )}
              </h3>
              <p className="muted small">
                {card.ownerName ? `${card.ownerName} · ` : null}
                {card.status === 'Active' ? null : <span>{label('responsibility.status', card.status)} · </span>}
                {card.projectCount} {t('nav.projects')}
              </p>
              <dl className="mini-stats">
                <div>
                  <dt>{t('overview.openWork')}</dt>
                  <dd>{card.openWork}</dd>
                </div>
                <div>
                  <dt>{t('overview.overdue')}</dt>
                  <dd className={card.overdueWork > 0 ? 'danger-cell' : undefined}>{card.overdueWork}</dd>
                </div>
                <div>
                  <dt>{t('overview.completedWork')}</dt>
                  <dd>{card.completedWork}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

export function PageStatus({ status }: { status: { tone: string; text: string } | null }): ReactNode {
  if (!status) return null;
  return (
    <div className={`banner ${status.tone}`} role={status.tone === 'danger' ? 'alert' : 'status'}>
      {status.text}
    </div>
  );
}
