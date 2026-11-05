/**
 * Read-only timeline.
 *
 * One project or every permitted project, on a horizontal date axis. Nothing here writes: a bar is
 * a stored plan, a diamond is a committed deadline, a dashed span is a child date range computed by
 * the server, and a tick marks a recorded completion. Interaction is inspection only.
 */
import { Fragment, useEffect, useMemo, useState } from 'react';
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
  calendarMonthWindow,
  markerOf,
  parseDate,
  spanOf,
  todayJst,
  scaleForRange,
  rangeOf,
  type TimelineScale
} from '../components/timeline-dates';

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
  parentKey?: string;
  expandable: boolean;
};

function projectRowOf(row: TimelineProjectRow): Row {
  return {
    key: `project:${row.projectId}`,
    kind: 'PROJECT',
    depth: 0,
    name: row.projectName,
    plannedStart: row.plannedStart,
    plannedEnd: row.committedDeadline,
    deadline: null,
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
    plannedEnd: row.deadline,
    deadline: null,
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
    deadline: null,
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
  const subprojects = new Map(branch.subprojects.map((entry) => [entry.subprojectId, entry]));
  const tasks = new Map(branch.tasks.map((entry) => [entry.taskId, entry]));
  const subprojectChildren = new Map<string, TimelineSubprojectRow[]>();
  const subprojectRoots: TimelineSubprojectRow[] = [];
  for (const subproject of branch.subprojects) {
    const parent = subproject.parentSubprojectId ? subprojects.get(subproject.parentSubprojectId) : undefined;
    if (!parent) {
      subprojectRoots.push(subproject);
      continue;
    }
    const children = subprojectChildren.get(parent.subprojectId) ?? [];
    children.push(subproject);
    subprojectChildren.set(parent.subprojectId, children);
  }
  const taskChildren = new Map<string, TimelineTaskRow[]>();
  const taskRoots = new Map<string, TimelineTaskRow[]>();
  for (const task of branch.tasks) {
    const parent = task.parentTaskId ? tasks.get(task.parentTaskId) : undefined;
    if (parent && parent.subprojectId === task.subprojectId) {
      const children = taskChildren.get(parent.taskId) ?? [];
      children.push(task);
      taskChildren.set(parent.taskId, children);
      continue;
    }
    const key = task.subprojectId ?? '';
    const roots = taskRoots.get(key) ?? [];
    roots.push(task);
    taskRoots.set(key, roots);
  }
  const byName = <T extends { taskName?: string; subprojectName?: string; taskId?: string; subprojectId?: string | null }>(
    left: T,
    right: T
  ): number =>
    (left.taskName ?? left.subprojectName ?? '').localeCompare(right.taskName ?? right.subprojectName ?? '', 'ja') ||
    (left.taskId ?? left.subprojectId ?? '').localeCompare(right.taskId ?? right.subprojectId ?? '');
  const rows: Row[] = [];
  const seenSubprojects = new Set<string>();
  const seenTasks = new Set<string>();
  const appendTask = (task: TimelineTaskRow, depth: number): void => {
    if (seenTasks.has(task.taskId)) return;
    seenTasks.add(task.taskId);
    const children = (taskChildren.get(task.taskId) ?? []).slice().sort(byName);
    rows.push({
      ...taskRowOf(task),
      depth,
      parentKey: task.parentTaskId && tasks.has(task.parentTaskId) ? `task:${task.parentTaskId}` : undefined,
      expandable: children.length > 0
    });
    children.forEach((child) => appendTask(child, depth + 1));
  };
  const appendSubproject = (subproject: TimelineSubprojectRow, depth: number): void => {
    if (seenSubprojects.has(subproject.subprojectId)) return;
    seenSubprojects.add(subproject.subprojectId);
    const children = (subprojectChildren.get(subproject.subprojectId) ?? []).slice().sort(byName);
    rows.push({
      ...subprojectRowOf(subproject),
      depth,
      parentKey:
        subproject.parentSubprojectId && subprojects.has(subproject.parentSubprojectId)
          ? `subproject:${subproject.parentSubprojectId}`
          : undefined,
      expandable: children.length > 0 || (taskRoots.get(subproject.subprojectId)?.length ?? 0) > 0
    });
    children.forEach((child) => appendSubproject(child, depth + 1));
    (taskRoots.get(subproject.subprojectId) ?? []).slice().sort(byName).forEach((task) => appendTask(task, depth + 1));
  };
  subprojectRoots.slice().sort(byName).forEach((subproject) => appendSubproject(subproject, 1));
  // Malformed parent links remain visible once at a bounded root instead of disappearing.
  branch.subprojects.filter((entry) => !seenSubprojects.has(entry.subprojectId)).sort(byName).forEach((entry) => appendSubproject(entry, 1));
  (taskRoots.get('') ?? []).slice().sort(byName).forEach((task) => appendTask(task, 1));
  branch.tasks.filter((entry) => !seenTasks.has(entry.taskId)).sort(byName).forEach((entry) => appendTask(entry, 1));
  return rows;
}

function visibleBranchRows(rows: Row[], expanded: readonly string[]): Row[] {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return rows.filter((row) => {
    let parentKey = row.parentKey;
    const seen = new Set<string>();
    while (parentKey) {
      if (seen.has(parentKey) || !expanded.includes(parentKey)) return false;
      seen.add(parentKey);
      parentKey = byKey.get(parentKey)?.parentKey;
    }
    return true;
  });
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
  const initialWindow = useMemo(() => calendarMonthWindow(initialAnchor ?? todayJst()), [initialAnchor]);
  const [displayStart, setDisplayStart] = useRouteMemoryState('timeline:display-start', initialWindow.from, {
    resetToInitial: !!initialAnchor
  });
  const [displayFinish, setDisplayFinish] = useRouteMemoryState('timeline:display-finish', initialWindow.to, {
    resetToInitial: !!initialAnchor
  });
  const [draftStart, setDraftStart] = useState(displayStart);
  const [draftFinish, setDraftFinish] = useState(displayFinish);
  const [subprojectId, setSubprojectId] = useRouteMemoryState('timeline:subproject', '');
  const [includeCompleted, setIncludeCompleted] = useRouteMemoryState('timeline:include-completed', true);
  const [page, setPage] = useRouteMemoryState('timeline:page', 1);
  const [expanded, setExpanded] = useRouteMemoryState<string[]>('timeline:expanded', []);
  const [details, setDetails] = useRouteMemoryState<string | null>('timeline:details', null);

  useEffect(() => setDraftStart(displayStart), [displayStart]);
  useEffect(() => setDraftFinish(displayFinish), [displayFinish]);
  const window: ViewWindow = useMemo(() => {
    const from = parseDate(displayStart);
    const to = parseDate(displayFinish);
    if (from === null || to === null || from > to) return initialWindow;
    return { from: displayStart, to: displayFinish, days: Math.round((to - from) / DAY_MS) + 1 };
  }, [displayStart, displayFinish, initialWindow]);
  const scale: TimelineScale = scaleForRange(window.days);
  const dayWidth = DAY_WIDTH[scale];
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
    `work/timeline:branch:${projectId}:${subprojectId}:${includeCompleted}`,
    () =>
      api.get<TimelineProjectBranch>(
        '/api/work/timeline' + queryString({ projectId, subprojectId, includeCompleted: includeCompleted ? 'true' : 'false' })
      ),
    { enabled: !!projectId }
  );
  const subprojectOptions = useQuery<TimelineProjectBranch>(
    `work/timeline:subproject-options:${projectId}`,
    () => api.get<TimelineProjectBranch>('/api/work/timeline' + queryString({ projectId })),
    { enabled: !!projectId }
  );
  // The responsibility filter uses the same authorized option list as the read-only project screen.
  const responsibilities = useQuery<WorkProjectList>('work/projects:timeline-options', () =>
    api.get<WorkProjectList>('/api/work/projects?page=1&pageSize=1')
  );

  const projectRows = (overview.data?.items ?? []).map(projectRowOf);
  const selectedRows = branch.data ? visibleBranchRows(branchRows(branch.data), expanded) : [];
  const rows = projectId ? selectedRows : projectRows;
  const undated = rows.filter((row) => row.undated);
  const dated = rows.filter((row) => !row.undated);
  const outsideCount = dated.filter(
    (row) =>
      spanOf(row.plannedStart, row.plannedEnd, window, dayWidth) === null &&
      markerOf(row.deadline, window, dayWidth) === null &&
      spanOf(row.childStart, row.childEnd, window, dayWidth) === null
  ).length;
  const filtersActive = !!projectId || !!subprojectId || !!responsibilityId || !includeCompleted;
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
    const padding = days === 1 ? 1 : Math.min(Math.max(2, Math.ceil(days * 0.05)), 14);
    setDisplayStart(new Date(start - padding * DAY_MS).toISOString().slice(0, 10));
    setDisplayFinish(new Date(end + padding * DAY_MS).toISOString().slice(0, 10));
  };
  const applyDates = (start: string, finish: string): void => {
    const parsedStart = parseDate(start);
    const parsedFinish = parseDate(finish);
    if (parsedStart !== null && parsedFinish !== null && parsedStart <= parsedFinish) {
      setDisplayStart(start);
      setDisplayFinish(finish);
    }
  };
  const datesValid = parseDate(draftStart) !== null && parseDate(draftFinish) !== null && draftStart <= draftFinish;

  const toggleExpanded = (key: string): void => {
    setExpanded((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]
    );
  };
  const reset = (): void => {
    setProjectId('');
    setResponsibilityId('');
    const month = calendarMonthWindow();
    setDisplayStart(month.from);
    setDisplayFinish(month.to);
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
                setSubprojectId('');
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
            <span className="field-label">{t('timeline.scope.subproject')}</span>
            <select
              value={subprojectId}
              disabled={!projectId}
              onChange={(event) => {
                setSubprojectId(event.target.value);
                setExpanded([]);
                setDetails(null);
              }}
            >
              <option value="">{projectId ? t('timeline.scope.allSubprojects') : t('timeline.scope.selectProject')}</option>
              {(subprojectOptions.data?.subprojects ?? []).map((entry) => (
                <option key={entry.subprojectId} value={entry.subprojectId}>
                  {'　'.repeat(Math.max(0, entry.depth - 1))}{entry.subprojectName}
                </option>
              ))}
            </select>
          </label>
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
          <label className="field">
            <span className="field-label">{t('timeline.displayStart')}</span>
            <input type="date" value={draftStart} onChange={(event) => { setDraftStart(event.target.value); applyDates(event.target.value, draftFinish); }} />
          </label>
          <label className="field">
            <span className="field-label">{t('timeline.displayFinish')}</span>
            <input type="date" value={draftFinish} onChange={(event) => { setDraftFinish(event.target.value); applyDates(draftStart, event.target.value); }} />
          </label>
          <div className="inline-actions">
            <button type="button" className="button secondary" onClick={() => {
              const month = calendarMonthWindow();
              setDisplayStart(month.from);
              setDisplayFinish(month.to);
            }}>
              {t('timeline.resetDates')}
            </button>
            <button type="button" className="button secondary" disabled={!fitBounds} onClick={fit}>
              {t('timeline.fit')}
            </button>
          </div>
          {!datesValid ? <p className="field-hint error-help">{t('timeline.invalidDates')}</p> : null}
          <p className="field-hint">{t('timeline.dateHint')}</p>
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
        error={overview.error ?? branch.error ?? subprojectOptions.error ?? responsibilities.error}
        onRetry={() => {
          overview.refresh();
          branch.refresh();
          subprojectOptions.refresh();
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
                        expanded={expanded.includes(row.key)}
                        detailsOpen={details === row.key}
                        onToggle={() => toggleExpanded(row.key)}
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
                      expanded={expanded}
                      onToggle={toggleExpanded}
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
  setDetails,
  expanded,
  onToggle
}: {
  projectId: string;
  includeCompleted: boolean;
  window: ViewWindow;
  dayWidth: number;
  totalWidth: number;
  todayOffset: number | null;
  details: string | null;
  setDetails: (value: string | null) => void;
  expanded: readonly string[];
  onToggle: (key: string) => void;
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
      {visibleBranchRows(branchRows(branch.data), expanded).map((row) => (
        <TimelineRow
          key={`${projectId}-${row.key}`}
          row={row}
          window={window}
          dayWidth={dayWidth}
          totalWidth={totalWidth}
          todayOffset={todayOffset}
          expanded={expanded.includes(row.key)}
          detailsOpen={details === `${projectId}-${row.key}`}
          onToggle={() => onToggle(row.key)}
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
  const planned = row.plannedStart ? spanOf(row.plannedStart, row.plannedEnd, window, dayWidth) : null;
  const childSpan = spanOf(row.childStart, row.childEnd, window, dayWidth);
  const deadline = markerOf(row.deadline ?? (!row.plannedStart ? row.plannedEnd : null), window, dayWidth);
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
