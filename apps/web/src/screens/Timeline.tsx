/**
 * Read-only timeline.
 *
 * One project or every permitted project, on a horizontal date axis. Nothing here writes: a bar is
 * a stored plan, a diamond is a committed deadline, a dashed span is a child date range computed by
 * the server, and a tick marks a recorded completion. Interaction is inspection only.
 */
import { Fragment, useMemo } from 'react';
import type {
  Actor,
  TimelineProjectBranch,
  TimelineProjectPage,
  TimelineProjectRow,
  TimelineSubprojectRow,
  TimelineTaskRow,
  WorkProjectList
} from '@eh/contracts';
import { projectColorVars } from '@eh/domain';
import { api, queryString } from '../api/client';
import { useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { ErrorBox } from '../components/ui';
import { RemoteSelect } from '../components/forms';
import { useRouteMemoryState } from '../state/navigation';
import {
  DAY_WIDTH,
  markerOf,
  parseDate,
  shiftAnchor,
  spanOf,
  todayJst,
  scaleWindow,
  rangeOf,
  type TimelineScale
} from '../components/timeline-dates';

const SCALES: TimelineScale[] = ['WEEK', 'MONTH', 'QUARTER'];
const DAY_MS = 86_400_000;

type ViewWindow = { from: string; to: string; days: number };

type Row = {
  key: string;
  kind: 'PROJECT' | 'SUBPROJECT' | 'TASK';
  depth: number;
  name: string;
  /** The stored plan: a start and an end that both come from the record. */
  plannedStart: string | null;
  plannedEnd: string | null;
  /** A committed deadline, drawn as its own marker. */
  deadline: string | null;
  completedAt: string | null;
  childStart: string | null;
  childEnd: string | null;
  childDated: number;
  childTotal: number;
  undated: boolean;
  inconsistent: boolean;
  container: boolean;
  status: string;
  taskId?: string;
  projectId: string;
  expandable: boolean;
};

function projectRowOf(row: TimelineProjectRow): Row {
  return {
    key: `project:${row.projectId}`,
    kind: 'PROJECT',
    depth: 0,
    name: row.projectName,
    plannedStart: row.plannedStart,
    plannedEnd: row.forecastEnd,
    deadline: row.committedDeadline,
    completedAt: null,
    childStart: row.childRange.start,
    childEnd: row.childRange.end,
    childDated: row.childRange.datedItems,
    childTotal: row.childRange.totalItems,
    undated: row.undated,
    inconsistent: false,
    container: false,
    status: row.status,
    projectId: row.projectId,
    expandable: true
  };
}

function subprojectRowOf(row: TimelineSubprojectRow): Row {
  return {
    key: `subproject:${row.subprojectId}`,
    kind: 'SUBPROJECT',
    depth: row.depth,
    name: row.subprojectName,
    plannedStart: row.plannedStart,
    plannedEnd: row.plannedEnd,
    deadline: row.deadline,
    completedAt: null,
    childStart: row.childRange.start,
    childEnd: row.childRange.end,
    childDated: row.childRange.datedItems,
    childTotal: row.childRange.totalItems,
    undated: row.undated,
    inconsistent: false,
    container: false,
    status: row.status,
    projectId: row.projectId,
    expandable: false
  };
}

function taskRowOf(row: TimelineTaskRow): Row {
  return {
    key: `task:${row.taskId}`,
    kind: 'TASK',
    depth: row.depth,
    name: row.taskName,
    plannedStart: row.plannedStart,
    plannedEnd: row.dueDate,
    deadline: row.dueDate,
    completedAt: row.completedAt,
    childStart: row.container ? row.childRange.start : null,
    childEnd: row.container ? row.childRange.end : null,
    childDated: row.childRange.datedItems,
    childTotal: row.childRange.totalItems,
    undated: row.undated,
    inconsistent: row.inconsistent,
    container: row.container,
    status: row.status,
    taskId: row.taskId,
    projectId: row.projectId,
    expandable: false
  };
}

function branchRows(branch: TimelineProjectBranch): Row[] {
  const ordered = branch.tasks
    .slice()
    .sort((left, right) => left.depth - right.depth || left.taskId.localeCompare(right.taskId));
  return [...branch.subprojects.map(subprojectRowOf), ...ordered.map(taskRowOf)];
}

export function TimelineScreen({
  actor,
  initialProjectId,
  initialAnchor
}: {
  actor: Actor;
  initialProjectId?: string;
  /** A deep link may open a period; it is page memory afterwards. */
  initialAnchor?: string;
}): JSX.Element {
  const { t, language } = useI18n();
  const locale = language === 'ja' ? 'ja-JP' : 'en-US';
  const [projectId, setProjectId] = useRouteMemoryState('timeline:project', initialProjectId ?? '', {
    resetToInitial: !!initialProjectId
  });
  const [responsibilityId, setResponsibilityId] = useRouteMemoryState('timeline:responsibility', '');
  const [scale, setScale] = useRouteMemoryState<TimelineScale>('timeline:scale', 'MONTH');
  const [anchor, setAnchor] = useRouteMemoryState('timeline:anchor', initialAnchor ?? todayJst(), {
    resetToInitial: !!initialAnchor
  });
  const [includeCompleted, setIncludeCompleted] = useRouteMemoryState('timeline:include-completed', true);
  const [page, setPage] = useRouteMemoryState('timeline:page', 1);
  const [expanded, setExpanded] = useRouteMemoryState<string[]>('timeline:expanded', []);
  const [details, setDetails] = useRouteMemoryState<string | null>('timeline:details', null);

  const dayWidth = DAY_WIDTH[scale];
  const window: ViewWindow = useMemo(() => scaleWindow(scale, anchor), [scale, anchor]);
  const totalWidth = window.days * dayWidth;
  const todayOffset = markerOf(todayJst(), window, dayWidth);

  const overview = useQuery<TimelineProjectPage>(
    `work/timeline:overview:${responsibilityId}:${page}`,
    () =>
      api.get<TimelineProjectPage>(
        '/api/work/timeline' + queryString({ responsibilityId, page, pageSize: 25 })
      ),
    { enabled: !projectId }
  );
  const branch = useQuery<TimelineProjectBranch>(
    `work/timeline:branch:${projectId}:${includeCompleted}`,
    () =>
      api.get<TimelineProjectBranch>(
        '/api/work/timeline' + queryString({ projectId, includeCompleted: includeCompleted ? 'true' : 'false' })
      ),
    { enabled: !!projectId }
  );
  // The responsibility filter uses the same authorized option list as the read-only project screen.
  const responsibilities = useQuery<WorkProjectList>('work/projects:timeline-options', () =>
    api.get<WorkProjectList>('/api/work/projects?page=1&pageSize=1')
  );

  const projectRows = (overview.data?.items ?? []).map(projectRowOf);
  const selectedRows = branch.data ? branchRows(branch.data) : [];
  const rows = projectId ? selectedRows : projectRows;
  const undated = rows.filter((row) => row.undated);
  const dated = rows.filter((row) => !row.undated);
  const outsideCount = dated.filter(
    (row) =>
      spanOf(row.plannedStart, row.plannedEnd, window, dayWidth) === null &&
      markerOf(row.deadline, window, dayWidth) === null &&
      spanOf(row.childStart, row.childEnd, window, dayWidth) === null
  ).length;
  const filtersActive = !!projectId || !!responsibilityId || scale !== 'MONTH' || !includeCompleted;
  /** The stored dates of everything on screen, so "fit" never guesses a window. */
  const fitBounds = useMemo(
    () =>
      rangeOf(
        rows.flatMap((row) => [
          row.plannedStart,
          row.plannedEnd,
          row.deadline,
          row.completedAt ? row.completedAt.slice(0, 10) : null,
          row.childStart,
          row.childEnd
        ])
      ),
    [rows]
  );
  const fit = (): void => {
    if (!fitBounds) return;
    const start = parseDate(fitBounds.from);
    const end = parseDate(fitBounds.to);
    if (start === null || end === null) return;
    const days = Math.round((end - start) / DAY_MS) + 1;
    setAnchor(fitBounds.from);
    setScale(days <= 21 ? 'WEEK' : days <= 120 ? 'MONTH' : 'QUARTER');
  };

  const toggleExpanded = (key: string): void => {
    setExpanded((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]
    );
  };
  const reset = (): void => {
    setProjectId('');
    setResponsibilityId('');
    setScale('MONTH');
    setAnchor(todayJst());
    setIncludeCompleted(true);
    setPage(1);
    setExpanded([]);
    setDetails(null);
  };

  const loading =
    (!!projectId && branch.loading && !branch.data) || (!projectId && overview.loading && !overview.data);

  return (
    <div className="screen stack timeline-screen">
      <h2>{t('timeline.title')}</h2>
      <p className="muted small">{t('timeline.intro')}</p>

      <section className="card stack timeline-controls" aria-label={t('timeline.title')}>
        <div className="field-row">
          <div className="field">
            <span className="field-label">{t('timeline.scope.project')}</span>
            <RemoteSelect
              value={projectId}
              optionsKey="timeline:project-options"
              onChange={(value) => {
                setProjectId(value);
                setExpanded([]);
                setDetails(null);
              }}
              allowEmpty={t('timeline.scope.all')}
              searchLabel={t('picker.search')}
              selectLabel={t('timeline.scope.project')}
              load={async ({ query, page: optionPage }) => {
                const result = await api.get<WorkProjectList>(
                  '/api/work/projects' + queryString({ query, page: optionPage, pageSize: 25 })
                );
                return {
                  items: result.items.map((entry) => ({ value: entry.projectId, label: entry.projectName })),
                  total: result.total,
                  page: result.page,
                  totalPages: result.totalPages,
                  selected: projectId
                    ? {
                        value: projectId,
                        label:
                          result.items.find((entry) => entry.projectId === projectId)?.projectName ?? projectId
                      }
                    : null
                };
              }}
            />
          </div>
          <label className="field">
            <span className="field-label">{t('timeline.scope.responsibility')}</span>
            <select
              value={responsibilityId}
              onChange={(event) => {
                setResponsibilityId(event.target.value);
                setPage(1);
              }}
              disabled={!!projectId}
            >
              <option value="">{t('timeline.scope.allResponsibilities')}</option>
              {(responsibilities.data?.responsibilities ?? []).map((entry) => (
                <option key={entry.responsibilityId} value={entry.responsibilityId}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="field-row timeline-nav">
          <div className="segmented" role="group" aria-label={t('timeline.scale')}>
            {SCALES.map((value) => (
              <button
                key={value}
                type="button"
                className={scale === value ? 'segmented-button active' : 'segmented-button'}
                aria-pressed={scale === value}
                onClick={() => setScale(value)}
              >
                {t(`timeline.scale.${value.toLowerCase()}`)}
              </button>
            ))}
          </div>
          <div className="inline-actions">
            <button type="button" className="button secondary" onClick={() => setAnchor(shiftAnchor(scale, anchor, -1))}>
              {t('timeline.previous')}
            </button>
            <button type="button" className="button secondary" onClick={() => setAnchor(todayJst())}>
              {t('timeline.today')}
            </button>
            <button type="button" className="button secondary" onClick={() => setAnchor(shiftAnchor(scale, anchor, 1))}>
              {t('timeline.next')}
            </button>
            <button type="button" className="button secondary" disabled={!fitBounds} onClick={fit}>
              {t('timeline.fit')}
            </button>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={includeCompleted}
              onChange={(event) => setIncludeCompleted(event.target.checked)}
            />
            {t('timeline.includeCompleted')}
          </label>
          {filtersActive ? (
            <button type="button" className="link-button" onClick={reset}>
              {t('timeline.reset')}
            </button>
          ) : null}
        </div>

        <p className="muted small">
          {window.from} – {window.to} · {t('timeline.taskTotal', { n: rows.length })}
          {filtersActive ? ` · ${t('timeline.filter.active')}` : ''}
          {outsideCount > 0 ? ` · ${t('timeline.more', { n: outsideCount })}` : ''}
        </p>

        <ul className="timeline-legend" aria-label={t('timeline.legend.deadline')}>
          <li>
            <span className="tl-swatch tl-swatch-bar" aria-hidden="true" /> {t('timeline.legend.planned')}
          </li>
          <li>
            <span className="tl-swatch tl-swatch-deadline" aria-hidden="true" /> {t('timeline.legend.deadline')}
          </li>
          <li>
            <span className="tl-swatch tl-swatch-span" aria-hidden="true" /> {t('timeline.legend.childRange')}
          </li>
          <li>
            <span className="tl-swatch tl-swatch-done" aria-hidden="true" /> {t('timeline.legend.completed')}
          </li>
        </ul>
      </section>

      <ErrorBox
        error={overview.error ?? branch.error ?? responsibilities.error}
        onRetry={() => {
          overview.refresh();
          branch.refresh();
          responsibilities.refresh();
        }}
      />

      {loading ? <p className="muted">{t('timeline.loading')}</p> : null}

      {projectId && branch.data?.truncated ? (
        <div className="banner warning">
          {t('timeline.truncated', { shown: branch.data.tasks.length, total: branch.data.taskTotal })}
        </div>
      ) : null}

      {!projectId && overview.data && overview.data.items.length === 0 ? (
        <p className="muted">{t('timeline.noProjects')}</p>
      ) : null}

      {rows.length > 0 || (projectId && branch.data) ? (
        <div className="tl-scroller" role="table" aria-label={t('timeline.title')}>
          <div className="tl-row tl-head" role="row">
            <div className="tl-cell-name" role="columnheader">
              {t('timeline.title')}
            </div>
            <div className="tl-cell-track" style={{ width: totalWidth }} role="columnheader">
              {scale === 'QUARTER'
                ? monthLabels(window, dayWidth).map((entry) => (
                    <span key={entry.label} className="tl-scale-cell tl-scale-month" style={{ left: entry.left }}>
                      {entry.label}
                    </span>
                  ))
                : dayLabels(window, dayWidth, scale === 'WEEK', locale).map((entry) => (
                    <span
                      key={entry.label + entry.left}
                      className={entry.weekend ? 'tl-scale-cell weekend' : 'tl-scale-cell'}
                      style={{ left: entry.left, width: dayWidth }}
                    >
                      {entry.label}
                    </span>
                  ))}
            </div>
          </div>

          {projectId
            ? branch.data
              ? (
                  <>
                    <TimelineRow
                      row={{ ...projectRowOf(branch.data.project), expandable: false }}
                      window={window}
                      dayWidth={dayWidth}
                      totalWidth={totalWidth}
                      todayOffset={todayOffset}
                      expanded
                      detailsOpen={details === `project:${branch.data.project.projectId}`}
                      onToggle={() => undefined}
                      onDetails={() =>
                        setDetails(
                          details === `project:${branch.data?.project.projectId}`
                            ? null
                            : `project:${branch.data?.project.projectId}`
                        )
                      }
                    />
                    {/* The selected project starts expanded so its first subproject level is visible. */}
                    {selectedRows.map((row) => (
                      <TimelineRow
                        key={row.key}
                        row={row}
                        window={window}
                        dayWidth={dayWidth}
                        totalWidth={totalWidth}
                        todayOffset={todayOffset}
                        expanded={false}
                        detailsOpen={details === row.key}
                        onToggle={() => undefined}
                        onDetails={() => setDetails(details === row.key ? null : row.key)}
                      />
                    ))}
                  </>
                )
              : null
            : projectRows.map((row) => (
                <Fragment key={row.key}>
                  <TimelineRow
                    row={row}
                    window={window}
                    dayWidth={dayWidth}
                    totalWidth={totalWidth}
                    todayOffset={todayOffset}
                    expanded={expanded.includes(row.key)}
                    detailsOpen={details === row.key}
                    onToggle={() => toggleExpanded(row.key)}
                    onDetails={() => setDetails(details === row.key ? null : row.key)}
                  />
                  {expanded.includes(row.key) ? (
                    <ProjectBranchRows
                      projectId={row.projectId}
                      includeCompleted={includeCompleted}
                      window={window}
                      dayWidth={dayWidth}
                      totalWidth={totalWidth}
                      todayOffset={todayOffset}
                      details={details}
                      setDetails={setDetails}
                    />
                  ) : null}
                </Fragment>
              ))}
        </div>
      ) : null}

      {undated.length > 0 ? (
        <section className="card stack">
          <h3>{t('timeline.undated')}</h3>
          <p className="muted small">{t('timeline.undatedHint')}</p>
          <ul className="list">
            {undated.map((row) => (
              <li key={`undated-${row.key}`} style={{ paddingLeft: row.depth * 12 }}>
                {row.taskId ? <a href={`#/task/${row.taskId}`}>{row.name}</a> : row.name}
                <span className="muted small"> · {t('timeline.undated')}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!projectId && overview.data && overview.data.totalPages > 1 ? (
        <div className="inline-actions">
          <button type="button" className="button secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t('local.previous')}
          </button>
          <span>
            {overview.data.page} / {overview.data.totalPages} · {overview.data.total}
          </span>
          <button
            type="button"
            className="button secondary"
            disabled={page >= overview.data.totalPages}
            onClick={() => setPage(page + 1)}
          >
            {t('local.next')}
          </button>
        </div>
      ) : null}

      <details className="card timeline-list">
        <summary>{t('timeline.listView')}</summary>
        <table className="table">
          <thead>
            <tr>
              <th>{t('requests.task')}</th>
              <th>{t('timeline.dates.plan')}</th>
              <th>{t('timeline.dates.deadline')}</th>
              <th>{t('timeline.dates.completed')}</th>
              <th>{t('column.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`list-${row.key}`}>
                <td>
                  <span style={{ paddingLeft: row.depth * 12 }}>{row.name}</span>
                  {row.taskId ? (
                    <>
                      {' '}
                      <a href={`#/task/${row.taskId}`}>{t('timeline.openTask')}</a>
                    </>
                  ) : null}
                </td>
                <td className="muted small">
                  {row.plannedStart || row.plannedEnd
                    ? `${row.plannedStart ?? t('timeline.startNotSet')} → ${row.plannedEnd ?? '-'}`
                    : t('timeline.undated')}
                </td>
                <td className="muted small">{row.deadline ?? t('common.unset')}</td>
                <td className="muted small">{row.completedAt ? row.completedAt.slice(0, 10) : t('common.unset')}</td>
                <td className="muted small">{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      {actor.role === 'VIEWER' ? <p className="muted small">{t('timeline.intro')}</p> : null}
    </div>
  );
}

/** One expanded project in the all-project view loads its own authorized branch on demand. */
function ProjectBranchRows({
  projectId,
  includeCompleted,
  window,
  dayWidth,
  totalWidth,
  todayOffset,
  details,
  setDetails
}: {
  projectId: string;
  includeCompleted: boolean;
  window: ViewWindow;
  dayWidth: number;
  totalWidth: number;
  todayOffset: number | null;
  details: string | null;
  setDetails: (value: string | null) => void;
}): JSX.Element {
  const { t } = useI18n();
  const branch = useQuery<TimelineProjectBranch>(
    `work/timeline:branch:${projectId}:${includeCompleted}`,
    () =>
      api.get<TimelineProjectBranch>(
        '/api/work/timeline' + queryString({ projectId, includeCompleted: includeCompleted ? 'true' : 'false' })
      )
  );
  if (!branch.data) return <p className="muted small tl-branch-loading">{t('timeline.branchLoading')}</p>;
  return (
    <>
      {branch.data.truncated ? (
        <div className="banner warning tl-branch-loading">
          {t('timeline.truncated', { shown: branch.data.tasks.length, total: branch.data.taskTotal })}
        </div>
      ) : null}
      {branchRows(branch.data).map((row) => (
        <TimelineRow
          key={`${projectId}-${row.key}`}
          row={row}
          window={window}
          dayWidth={dayWidth}
          totalWidth={totalWidth}
          todayOffset={todayOffset}
          expanded={false}
          detailsOpen={details === `${projectId}-${row.key}`}
          onToggle={() => undefined}
          onDetails={() =>
            setDetails(details === `${projectId}-${row.key}` ? null : `${projectId}-${row.key}`)
          }
        />
      ))}
    </>
  );
}

function TimelineRow({
  row,
  window,
  dayWidth,
  totalWidth,
  todayOffset,
  expanded,
  detailsOpen,
  onToggle,
  onDetails
}: {
  row: Row;
  window: ViewWindow;
  dayWidth: number;
  totalWidth: number;
  todayOffset: number | null;
  expanded: boolean;
  detailsOpen: boolean;
  onToggle: () => void;
  onDetails: () => void;
}): JSX.Element {
  const { t } = useI18n();
  const planned = spanOf(row.plannedStart, row.plannedEnd, window, dayWidth);
  const childSpan = spanOf(row.childStart, row.childEnd, window, dayWidth);
  const deadline = markerOf(row.deadline, window, dayWidth);
  const completed = markerOf(row.completedAt ? row.completedAt.slice(0, 10) : null, window, dayWidth);
  const planLabel =
    row.plannedStart || row.plannedEnd
      ? `${row.plannedStart ?? t('timeline.startNotSet')} → ${row.plannedEnd ?? '-'}`
      : t('timeline.undated');
  return (
    <>
      <div
        className={`tl-row tl-kind-${row.kind.toLowerCase()}`}
        role="row"
        style={projectColorVars(row.projectId)}
      >
        <div className="tl-cell-name" role="rowheader">
          {row.expandable ? (
            <button
              type="button"
              className="tl-toggle link-button"
              aria-expanded={expanded}
              aria-label={expanded ? t('timeline.collapse') : t('timeline.expand')}
              onClick={onToggle}
            >
              {expanded ? '▼' : '▶'}
            </button>
          ) : (
            <span className="tl-toggle-spacer" aria-hidden="true" />
          )}
          <span className="tl-label" style={{ paddingLeft: row.depth * 10 }}>
            {row.taskId ? <a href={`#/task/${row.taskId}`}>{row.name}</a> : row.name}
          </span>
          {row.container ? <span className="badge info">{t('timeline.container')}</span> : null}
          {row.inconsistent ? <span className="badge danger">{t('timeline.inconsistent')}</span> : null}
          <button
            type="button"
            className="link-button tl-details-toggle"
            aria-expanded={detailsOpen}
            aria-label={`${t('timeline.details')}: ${row.name}`}
            onClick={onDetails}
          >
            {t('timeline.details')}
          </button>
        </div>
        <div className="tl-cell-track" style={{ width: totalWidth }} role="cell">
          {todayOffset !== null ? <span className="tl-today" style={{ left: todayOffset }} aria-hidden="true" /> : null}
          {childSpan ? (
            <span
              className="tl-span"
              title={`${t('timeline.childRange')}: ${row.childStart ?? '-'} → ${row.childEnd ?? '-'}`}
              style={{ left: childSpan.left, width: childSpan.width }}
            />
          ) : null}
          {planned ? (
            <span
              className="tl-bar"
              title={`${t('timeline.dates.plan')}: ${planLabel}`}
              style={{ left: planned.left, width: planned.width }}
            />
          ) : null}
          {deadline !== null ? (
            <span
              className="tl-deadline"
              title={`${t('timeline.dates.deadline')}: ${row.deadline}`}
              style={{ left: deadline }}
            />
          ) : null}
          {completed !== null ? (
            <span
              className="tl-done"
              title={`${t('timeline.dates.completed')}: ${row.completedAt?.slice(0, 10)}`}
              style={{ left: completed }}
            />
          ) : null}
        </div>
      </div>
      {detailsOpen ? (
        <div className="tl-detail" role="row">
          <dl className="request-summary">
            <dt>{t('timeline.dates.plan')}</dt>
            <dd>{planLabel}</dd>
            <dt>{t('timeline.dates.deadline')}</dt>
            <dd>{row.deadline ?? t('common.unset')}</dd>
            <dt>{t('timeline.dates.completed')}</dt>
            <dd>{row.completedAt ? row.completedAt.slice(0, 10) : t('common.unset')}</dd>
            <dt>{t('column.status')}</dt>
            <dd>{row.status}</dd>
            {row.childStart || row.childEnd ? (
              <>
                <dt>{t('timeline.childRange')}</dt>
                <dd>
                  {row.childStart ?? '-'} → {row.childEnd ?? '-'} · {t('timeline.childRangeHint')}
                </dd>
              </>
            ) : null}
          </dl>
        </div>
      ) : null}
    </>
  );
}

function dayLabels(
  window: ViewWindow,
  dayWidth: number,
  withWeekday: boolean,
  locale: string
): { label: string; left: number; weekend: boolean }[] {
  const start = parseDate(window.from);
  if (start === null) return [];
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' });
  return Array.from({ length: window.days }, (_, index) => {
    const value = new Date(start + index * DAY_MS);
    const day = value.getUTCDate();
    return {
      label: withWeekday ? `${day} ${weekday.format(value)}` : String(day),
      left: index * dayWidth,
      weekend: value.getUTCDay() === 0 || value.getUTCDay() === 6
    };
  });
}

function monthLabels(window: ViewWindow, dayWidth: number): { label: string; left: number }[] {
  const start = parseDate(window.from);
  if (start === null) return [];
  const first = new Date(start);
  return Array.from({ length: 3 }, (_, index) => {
    const date = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + index, 1));
    const offset = Math.round((date.getTime() - start) / DAY_MS);
    return {
      label: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`,
      left: offset * dayWidth
    };
  });
}

