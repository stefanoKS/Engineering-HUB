/**
 * Date-based workload report.
 *
 * One request per report: the server resolves the period, counts tasks per bucket and per member,
 * and paginates the drilldown. Every figure is a task count over calendar dates - there is no
 * hour, capacity or utilisation value, and a task without an estimate is never counted as zero
 * workload. The employee table shows current assignments grouped by the selected dates.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
import type {
  Actor,
  WorkloadDrilldownKind,
  WorkloadEmployeeSort,
  WorkloadGranularity,
  WorkloadMode,
  WorkloadReport,
  WorkloadTaskPage
} from '@eh/contracts';
import { addDays, businessDate, resolveWorkloadPeriod, shiftAnchor, startOfWorkWeek } from '@eh/domain';
import { api, queryString } from '../api/client';
import { keys, useQuery } from '../state/cache';
import { useRouteMemoryState } from '../state/navigation';
import { useI18n } from '../i18n';
import { ErrorBox, Pagination, Section } from '../components/ui';
import { DeadlineCell } from '../components/deadline';
import { TaskStatusBadge, WorkflowHint } from '../components/task-status';

type BootstrapShape = {
  references: {
    members: { memberId: string; name: string }[];
    responsibilities: { id: string; name: string }[];
  };
  projects: { projectId: string; projectName: string }[];
};

type View = {
  mode: WorkloadMode;
  anchor: string;
  start: string;
  end: string;
  granularity: '' | WorkloadGranularity;
};

type Filters = {
  memberId: string;
  projectId: string;
  responsibilityId: string;
  sort: WorkloadEmployeeSort;
  ascending: boolean;
};

type Drill = {
  kind: WorkloadDrilldownKind;
  memberId?: string;
  memberName?: string;
  from?: string;
  to?: string;
  page: number;
};

const MODES: WorkloadMode[] = ['DAY', 'WEEK', 'MONTH', 'YEAR', 'CUSTOM'];
const CARD_KINDS: WorkloadDrilldownKind[] = ['DUE', 'COMPLETED', 'OVERDUE', 'UNDATED'];
const CARD_TONES = ['info', 'ok', 'danger', 'neutral'] as const;
const PAGE_SIZE = 20;

function defaultView(): View {
  const today = businessDate();
  const start = startOfWorkWeek(today);
  return { mode: 'WEEK', anchor: today, start, end: addDays(start, 6), granularity: '' };
}

export function WorkloadScreen({ actor }: { actor: Actor }): JSX.Element {
  void actor;
  const { t } = useI18n();
  const [view, setView] = useRouteMemoryState<View>('workload.view', defaultView);
  const [filters, setFilters] = useRouteMemoryState<Filters>('workload.filters', {
    memberId: '',
    projectId: '',
    responsibilityId: '',
    sort: 'overdue',
    ascending: false
  });
  const [search, setSearch] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const [drill, setDrill] = useState<Drill | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setMemberQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const bootstrap = useQuery<BootstrapShape>(keys.bootstrap, () => api.get<BootstrapShape>('/api/manager/bootstrap'));

  const resolved = useMemo(() => {
    try {
      return {
        period: resolveWorkloadPeriod({
          mode: view.mode,
          anchor: view.anchor,
          start: view.start,
          end: view.end,
          granularity: view.granularity || undefined
        })
      };
    } catch (error) {
      return { error: error as Error };
    }
  }, [view]);

  const baseParams = useMemo(
    () => ({
      mode: view.mode,
      anchor: view.mode === 'CUSTOM' ? undefined : view.anchor,
      start: view.mode === 'CUSTOM' ? view.start : undefined,
      end: view.mode === 'CUSTOM' ? view.end : undefined,
      granularity: view.mode === 'CUSTOM' ? view.granularity || undefined : undefined,
      memberId: filters.memberId,
      projectId: filters.projectId,
      responsibilityId: filters.responsibilityId,
      memberQuery,
      sort: filters.sort,
      direction: filters.ascending ? 'asc' : 'desc'
    }),
    [view, filters, memberQuery]
  );

  const key = `${keys.workload}${queryString(baseParams)}`;
  const report = useQuery<WorkloadReport>(
    key,
    () => api.get<WorkloadReport>(`/api/manager/reports/workload${queryString(baseParams)}`),
    { enabled: !resolved.error }
  );

  const changeMode = (mode: WorkloadMode): void => {
    setDrill(null);
    setExpanded(null);
    setView((current) => ({ ...current, mode, anchor: mode === 'CUSTOM' ? current.anchor : businessDate() }));
  };

  const shift = (amount: number): void => {
    setDrill(null);
    setExpanded(null);
    setView((current) => ({ ...current, anchor: shiftAnchor(current.mode, current.anchor, amount) }));
  };

  const jumpToNow = (): void => {
    const today = businessDate();
    const start = startOfWorkWeek(today);
    setDrill(null);
    setExpanded(null);
    setView((current) => ({ ...current, anchor: today, start, end: addDays(start, 6) }));
  };

  const data = report.data;
  const period = resolved.period;
  // A month is drawn as 28–31 daily columns, so only those labels switch to the bare day number.
  const compactTimeline = !!data && data.granularity === 'DAY' && data.buckets.length > 10;

  return (
    <div className="screen">
      <div className="screen-header">
        <h2>{t('workload.title')}</h2>
        {data ? (
          <span className="muted small">
            {t('workload.generatedAt')}: {data.generatedAt.replace('T', ' ').slice(0, 16)}
          </span>
        ) : null}
      </div>
      <p className="muted small">{t('workload.basisNote')}</p>

      <div className="workload-toolbar">
        <div className="mode-switch" role="group" aria-label={t('workload.range')}>
          {MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className={view.mode === mode ? 'mode-button active' : 'mode-button'}
              aria-pressed={view.mode === mode}
              onClick={() => changeMode(mode)}
            >
              {t(`workload.mode.${mode}`)}
            </button>
          ))}
        </div>

        {view.mode === 'CUSTOM' ? (
          <div className="filters workload-custom">
            <label className="inline-field">
              <span>{t('workload.custom.start')}</span>
              <input
                type="date"
                value={view.start}
                onChange={(event) => setView((current) => ({ ...current, start: event.target.value }))}
              />
            </label>
            <label className="inline-field">
              <span>{t('workload.custom.end')}</span>
              <input
                type="date"
                value={view.end}
                onChange={(event) => setView((current) => ({ ...current, end: event.target.value }))}
              />
            </label>
            <label className="inline-field">
              <span>{t('workload.custom.granularity')}</span>
              <select
                value={view.granularity}
                onChange={(event) =>
                  setView((current) => ({ ...current, granularity: event.target.value as View['granularity'] }))
                }
              >
                <option value="">{t('workload.custom.auto')}</option>
                <option value="DAY">{t('workload.granularity.DAY')}</option>
                <option value="WEEK">{t('workload.granularity.WEEK')}</option>
                <option value="MONTH">{t('workload.granularity.MONTH')}</option>
              </select>
            </label>
          </div>
        ) : (
          <div className="filters workload-nav">
            <button type="button" className="button secondary" onClick={() => shift(-1)}>
              {t('workload.previous')}
            </button>
            <button type="button" className="button secondary" onClick={jumpToNow}>
              {t(`workload.jump.${view.mode}`)}
            </button>
            <button type="button" className="button secondary" onClick={() => shift(1)}>
              {t('workload.next')}
            </button>
            <span className="muted small">
              {t('workload.range')}: {period ? `${period.start} ～ ${period.end}` : ''}
            </span>
          </div>
        )}
      </div>

      {resolved.error ? (
        <div className="banner warning" role="alert">
          {/366/.test(resolved.error.message) ? t('workload.custom.tooLong') : t('workload.custom.invalid')}
        </div>
      ) : null}

      <div className="filters workload-filters">
        <label className="inline-field">
          <span>{t('workload.search')}</span>
          <input
            type="search"
            value={search}
            placeholder={t('workload.search')}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="inline-field">
          <span>{t('workload.filter.member')}</span>
          <select
            value={filters.memberId}
            onChange={(event) => setFilters((current) => ({ ...current, memberId: event.target.value }))}
          >
            <option value="">{t('filter.all')}</option>
            {(bootstrap.data?.references.members ?? []).map((member) => (
              <option key={member.memberId} value={member.memberId}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          <span>{t('workload.filter.responsibility')}</span>
          <select
            value={filters.responsibilityId}
            onChange={(event) => setFilters((current) => ({ ...current, responsibilityId: event.target.value }))}
          >
            <option value="">{t('filter.all')}</option>
            {(bootstrap.data?.references.responsibilities ?? []).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          <span>{t('workload.filter.project')}</span>
          <select
            value={filters.projectId}
            onChange={(event) => setFilters((current) => ({ ...current, projectId: event.target.value }))}
          >
            <option value="">{t('filter.all')}</option>
            {(bootstrap.data?.projects ?? []).map((project) => (
              <option key={project.projectId} value={project.projectId}>
                {project.projectName}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ErrorBox error={report.error} onRetry={() => report.refresh()} />

      {!data ? (
        resolved.error ? null : <p className="muted">{t('state.loading')}</p>
      ) : (
        <>
          <div className="kpi-grid">
            {CARD_KINDS.map((kind, index) => {
              const figures = [
                data.summary.dueTasks,
                data.summary.completedTasks,
                data.summary.overdueTasks,
                data.summary.undatedTasks
              ];
              const cardKey = String(kind).toLowerCase();
              return (
                <button
                  key={kind}
                  type="button"
                  className={`kpi kpi-button ${CARD_TONES[index]}`}
                  title={t(`workload.card.${cardKey}Hint`)}
                  onClick={() => {
                    setExpanded(null);
                    setDrill({ kind, page: 1 });
                  }}
                >
                  <span className="kpi-value">{figures[index] ?? 0}</span>
                  <span className="kpi-label">{t(`workload.card.${cardKey}`)}</span>
                  <span className="kpi-hint">{t(`workload.card.${cardKey}Hint`)}</span>
                </button>
              );
            })}
          </div>

          <p className="muted small workload-extras">
            {t('workload.extra.overdueInPeriod')}: {data.summary.overdueWithinPeriod} ·{' '}
            {t('workload.extra.backlog')}: {data.summary.backlogBeforePeriod} · {t('workload.extra.unique')}:{' '}
            {data.summary.uniqueTasks} · {t('workload.extra.assignments')}: {data.summary.assignments}
          </p>

          {drill && !drill.memberId ? (
            <DrilldownPanel
              base={baseParams}
              drill={drill}
              onClose={() => setDrill(null)}
              onPage={(page) => setDrill((current) => (current ? { ...current, page } : current))}
            />
          ) : null}

          <Section
            title={t('workload.timeline')}
            actions={<span className="muted small">{t(`workload.granularity.${data.granularity}`)}</span>}
          >
            {/* The axis is always visible, so a bare number is never an unexplained figure. */}
            <div className="timeline-axis">
              <span className="timeline-axis-label">{t('workload.axis.count')}</span>
              <span className="timeline-axis-range">
                {t('workload.axis.date')} · {timelineRangeLabel(data.start, data.end, compactTimeline)}
              </span>
            </div>
            <div className={compactTimeline ? 'timeline compact' : 'timeline'} role="list">
              {data.buckets.map((bucket) => {
                const max = Math.max(1, ...data.buckets.map((entry) => entry.dueTasks));
                const bucketText = bucketLabel(bucket.start, bucket.end, data.granularity, compactTimeline);
                const bucketTitle = bucketLabel(bucket.start, bucket.end, data.granularity, false);
                const height = bucket.dueTasks === 0 ? 0 : Math.max(8, Math.round((bucket.dueTasks / max) * 100));
                const isToday = bucket.start <= data.today && data.today <= bucket.end;
                const tooltip = t('workload.timeline.tooltip', {
                  date: bucketTitle,
                  count: bucket.dueTasks,
                  overdue: bucket.overdueTasks
                });
                return (
                  <div className={isToday ? 'timeline-bar is-today' : 'timeline-bar'} role="listitem" key={bucket.key}>
                    <span className="timeline-value">
                      {t(bucket.dueTasks === 1 ? 'workload.timeline.countOne' : 'workload.timeline.count', {
                        n: bucket.dueTasks
                      })}
                    </span>
                    <div className="timeline-track-area">
                      {isToday ? <span className="timeline-today-line" aria-hidden="true" /> : null}
                      <button
                        type="button"
                        className={bucket.overdueTasks > 0 ? 'timeline-bar-button overdue' : 'timeline-bar-button'}
                        aria-label={`${t('workload.timeline.open', { label: bucketTitle })}: ${tooltip}`}
                        title={tooltip}
                        onClick={() => {
                          setExpanded(null);
                          setDrill({ kind: 'DUE', from: bucket.start, to: bucket.end, page: 1 });
                        }}
                      >
                        <span className="timeline-fill" style={{ height: `${height}%` }} />
                      </button>
                    </div>
                    <span className="timeline-label">{bucketText}</span>
                    {isToday ? (
                      <span className="timeline-today-label">{t('workload.timeline.today')}</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {data.today < data.start || data.today > data.end ? (
              <p className="muted small timeline-today-outside">{t('workload.timeline.todayOutside')}</p>
            ) : null}
          </Section>

          <Section
            title={t('workload.employees')}
            actions={
              <div className="filters workload-sort">
                <label className="inline-field">
                  <span>{t('workload.sort')}</span>
                  <select
                    value={filters.sort}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, sort: event.target.value as WorkloadEmployeeSort }))
                    }
                  >
                    <option value="overdue">{t('workload.sort.overdue')}</option>
                    <option value="due">{t('workload.sort.due')}</option>
                    <option value="name">{t('workload.sort.name')}</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="button secondary"
                  aria-label={t('workload.sort.toggle')}
                  title={filters.ascending ? t('workload.sort.ascending') : t('workload.sort.descending')}
                  onClick={() => setFilters((current) => ({ ...current, ascending: !current.ascending }))}
                >
                  {filters.ascending ? '↑' : '↓'}
                </button>
              </div>
            }
          >
            {data.employees.length === 0 ? (
              <p className="empty">{t('workload.noEmployees')}</p>
            ) : (
              <table className="table workload-table">
                <thead>
                  <tr>
                    <th>{t('workload.member')}</th>
                    <th>{t('workload.dueTasks')}</th>
                    <th>{t('workload.completedTasks')}</th>
                    <th>{t('workload.overdue')}</th>
                    <th>{t('workload.undated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.employees.map((employee) => {
                    const open = expanded === employee.memberId;
                    return (
                      <Fragment key={employee.memberId}>
                        <tr>
                          <td>
                            <button
                              type="button"
                              className="row-toggle"
                              aria-expanded={open}
                              aria-label={t(open ? 'workload.collapse' : 'workload.expand', { name: employee.memberName })}
                              onClick={() => {
                                setDrill(null);
                                setExpanded(open ? null : employee.memberId);
                              }}
                            >
                              <span aria-hidden="true">{open ? '▾' : '▸'}</span> {employee.memberName}
                            </button>
                          </td>
                          <td>{employee.dueTasks}</td>
                          <td>{employee.completedTasks}</td>
                          <td className={employee.overdueTasks > 0 ? 'danger-cell' : undefined}>{employee.overdueTasks}</td>
                          <td>{employee.undatedTasks}</td>
                        </tr>
                        {open ? (
                          <tr>
                            <td colSpan={5} className="drilldown-cell">
                              <DrilldownPanel
                                base={baseParams}
                                drill={{
                                  kind: 'DUE',
                                  memberId: employee.memberId,
                                  memberName: employee.memberName,
                                  page: 1
                                }}
                                onClose={() => setExpanded(null)}
                                onPage={() => undefined}
                                compact
                              />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

/** One paginated task list: a summary-card breakdown, a timeline bucket or an expanded member. */
function DrilldownPanel({
  base,
  drill,
  onClose,
  onPage,
  compact = false
}: {
  base: Record<string, string | number | undefined>;
  drill: Drill;
  onClose: () => void;
  onPage: (page: number) => void;
  compact?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const params = {
    ...base,
    kind: drill.kind,
    memberId: drill.memberId ?? base.memberId,
    from: drill.from,
    to: drill.to,
    page: drill.page,
    pageSize: PAGE_SIZE
  };
  const key = `${keys.workload}/tasks${queryString(params)}`;
  const page = useQuery<WorkloadTaskPage>(key, () =>
    api.get<WorkloadTaskPage>(`/api/manager/reports/workload/tasks${queryString(params)}`)
  );
  const title = `${t(`workload.drill.${drill.kind}`)}${drill.memberName ? ` · ${drill.memberName}` : ''}`;

  return (
    <Section
      title={title}
      actions={
        <button type="button" className="link-button" onClick={onClose}>
          {t('workload.drill.close')}
        </button>
      }
    >
      <ErrorBox error={page.error} onRetry={() => page.refresh()} />
      {!page.data ? (
        <p className="muted">{t('state.loading')}</p>
      ) : page.data.items.length === 0 ? (
        <p className="empty">{t('workload.drill.empty')}</p>
      ) : (
        <table className={compact ? 'table workload-tasks compact' : 'table workload-tasks'}>
          <thead>
            <tr>
              {compact ? null : <th>{t('workload.column.project')}</th>}
              {compact ? null : <th>{t('workload.column.subproject')}</th>}
              <th>{t('workload.column.task')}</th>
              <th>{t('workload.column.assignees')}</th>
              <th>{t('column.status')}</th>
              <th>{t('workload.column.deadline')}</th>
              <th>{t('workload.column.completedOn')}</th>
            </tr>
          </thead>
          <tbody>
            {page.data.items.map((task) => (
              <tr key={task.taskId}>
                {compact ? null : (
                  <td>
                    <a href={`#/project/${task.projectId}`}>{task.projectName}</a>
                  </td>
                )}
                {compact ? null : <td>{task.subprojectName ?? t('common.unset')}</td>}
                <td>
                  <a href={`#/task/${task.taskId}`}>{task.taskName}</a>
                </td>
                <td className="muted small">{task.assigneeNames.join('、') || t('common.unset')}</td>
                <td>
                  <TaskStatusBadge state={task.displayStatus} missing={task.scheduleMissing} showDetail />
                  <WorkflowHint status={task.status} />
                </td>
                <td>
                  <DeadlineCell
                    dueDate={task.dueDate}
                    state={task.displayStatus}
                    completedOn={task.completedDate}
                    showLabel={false}
                  />
                </td>
                <td>{task.completedDate ?? t('common.unset')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {page.data && page.data.total > PAGE_SIZE ? (
        <Pagination page={page.data.page} totalPages={page.data.totalPages} total={page.data.total} onChange={onPage} />
      ) : null}
    </Section>
  );
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * The visible date context for the timeline axis.
 *
 * A dense month keeps a bare day number under each bar, so the month and year are stated once
 * here instead of being repeated 31 times.
 */
function timelineRangeLabel(start: string, end: string, compact: boolean): string {
  const from = start.replace(/-/g, '/');
  const to = end.replace(/-/g, '/');
  if (compact) return from.slice(0, 7);
  return `${from} – ${to}`;
}

function bucketLabel(start: string, end: string, granularity: WorkloadGranularity, compact = false): string {
  if (granularity === 'MONTH') return start.slice(0, 7).replace('-', '/');
  if (granularity === 'WEEK') return `${start.slice(5).replace('-', '/')}–${end.slice(5).replace('-', '/')}`;
  if (compact) return String(Number(start.slice(8)));
  const weekday = WEEKDAYS[new Date(`${start}T00:00:00Z`).getUTCDay()] ?? '';
  return `${start.slice(5).replace('-', '/')} (${weekday})`;
}