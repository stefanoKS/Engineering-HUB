/**
 * Read-only timeline.
 *
 * One project or every permitted project, on a horizontal date axis or as a phone-sized agenda.
 * Nothing here writes: a bar is a single server-derived display schedule, a deadline marker is the
 * stored commitment and a completion marker is the recorded completion. Interaction is inspection
 * only.
 *
 * The screen keeps four independent facts apart, exactly as the server sends them:
 *
 * - the schedule span (`scheduleStart`→`scheduleFinish`, explicit or derived from eligible leaves);
 * - the committed deadline (`deadline`, never substituted for a schedule or a completion);
 * - the recorded completion (`completedAt`);
 * - the descendant-derived group span (`dateSource = DERIVED`), drawn as an outlined bracket.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ProjectAttention } from '@eh/contracts';
import type {
  Actor,
  DisplayTaskStatus,
  ProjectAttentionFilter,
  ReviewState,
  ScheduleMissingPart,
  TimelineProjectBranch,
  TimelineProjectPage,
  TimelineProjectRow,
  ProjectScheduleDisplay,
  TimelineSubprojectRow,
  TimelineTaskRow,
  WorkProjectList
} from '@eh/contracts';
import { projectColorVars } from '@eh/domain';
import { api, ApiFailure, queryString } from '../api/client';
import { useQuery } from '../state/cache';
import { useDivisionScope } from '../state/division';
import { useDivisionTransition } from '../state/scope';
import { useI18n } from '../i18n';
import { ErrorBox } from '../components/ui';
import { RemoteSelect } from '../components/forms';
import { ScheduleBadge } from '../components/project-schedule';
import { TaskStatusBadge } from '../components/task-status';
import { useRouteMemoryState } from '../state/navigation';
import { useBusinessDate } from '../state/business-date';
import { tokyoCalendarDate } from '../state/format';
import {
  axisTicks,
  axisContext,
  barGeometry,
  calendarMonthWindow,
  markerOf,
  navigateWindow,
  parseDate,
  presetWindow,
  spanOf,
  todayJst,
  todayWindow,
  toDate,
  windowOf,
  type TimelinePreset,
  type TimelineWindow
} from '../components/timeline-dates';

type ViewWindow = TimelineWindow;
type TimelineMode = 'chart' | 'agenda';

type Row = {
  key: string;
  kind: 'PROJECT' | 'SUBPROJECT' | 'TASK';
  depth: number;
  name: string;
  projectId: string;
  projectName: string;
  subprojectName: string | null;
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
  /** Derived schedule badge for a project or subproject row; a task uses its display status. */
  schedule?: ProjectScheduleDisplay;
  displayStatus?: DisplayTaskStatus;
  scheduleMissing?: ScheduleMissingPart;
  reviewState?: ReviewState;
  assigneeNames?: string[];
  taskId?: string;
  parentKey?: string;
  expandable: boolean;
  scheduleStart: string | null;
  scheduleFinish: string | null;
  dateState: 'RANGE' | 'FINISH_ONLY' | 'START_ONLY' | 'UNDATED' | 'INVALID';
  dateSource: 'EXPLICIT' | 'DERIVED' | 'NONE';
};

function projectRowOf(row: TimelineProjectRow): Row {
  return {
    key: `project:${row.projectId}`,
    kind: 'PROJECT',
    depth: 0,
    name: row.projectName,
    projectId: row.projectId,
    projectName: row.projectName,
    subprojectName: null,
    plannedStart: row.plannedStart,
    // A plan end and a commitment are different stored facts; the deadline keeps its own field.
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
    schedule: row.schedule,
    expandable: true,
    scheduleStart: row.scheduleStart,
    scheduleFinish: row.scheduleFinish,
    dateState: row.dateState,
    dateSource: row.dateSource
  };
}

function subprojectRowOf(row: TimelineSubprojectRow, projectName: string): Row {
  return {
    key: `subproject:${row.subprojectId}`,
    kind: 'SUBPROJECT',
    depth: row.depth,
    name: row.subprojectName,
    projectId: row.projectId,
    projectName,
    subprojectName: row.subprojectName,
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
    schedule: row.schedule,
    expandable: false,
    scheduleStart: row.scheduleStart ?? null,
    scheduleFinish: row.scheduleFinish ?? null,
    dateState: row.dateState ?? 'UNDATED',
    dateSource: row.dateSource ?? 'NONE'
  };
}

function taskRowOf(row: TimelineTaskRow, projectName: string, subprojectName: string | null): Row {
  return {
    key: `task:${row.taskId}`,
    kind: 'TASK',
    depth: row.depth,
    name: row.taskName,
    projectId: row.projectId,
    projectName,
    subprojectName,
    plannedStart: row.plannedStart,
    plannedEnd: null,
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
    displayStatus: row.displayStatus,
    scheduleMissing: row.scheduleMissing,
    reviewState: row.reviewState,
    assigneeNames: row.assigneeNames,
    taskId: row.taskId,
    expandable: false,
    scheduleStart: row.scheduleStart ?? null,
    scheduleFinish: row.scheduleFinish ?? null,
    dateState: row.dateState ?? 'UNDATED',
    dateSource: row.dateSource ?? 'NONE'
  };
}

function branchRows(branch: TimelineProjectBranch): Row[] {
  const projectName = branch.project.projectName;
  const subprojectNames = new Map(branch.subprojects.map((entry) => [entry.subprojectId, entry.subprojectName]));
  const subprojects = new Map(branch.subprojects.map((entry) => [entry.subprojectId, entry]));
  const tasks = new Map(branch.tasks.map((entry) => [entry.taskId, entry]));
  const subprojectRoots: TimelineSubprojectRow[] = [];
  for (const subproject of branch.subprojects) {
    // Legacy storage can retain a parent link, but timeline folders are deliberately flat.
    subprojectRoots.push(subproject);
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
    const parent = task.parentTaskId ? tasks.get(task.parentTaskId) : undefined;
    rows.push({
      ...taskRowOf(
        task,
        projectName,
        task.subprojectId ? (subprojectNames.get(task.subprojectId) ?? null) : null
      ),
      depth,
      parentKey: parent && parent.subprojectId === task.subprojectId
        ? `task:${parent.taskId}`
        : task.subprojectId && subprojects.has(task.subprojectId)
          ? `subproject:${task.subprojectId}`
          : undefined,
      expandable: children.length > 0
    });
    children.forEach((child) => appendTask(child, depth + 1));
  };
  const appendSubproject = (subproject: TimelineSubprojectRow, depth: number): void => {
    if (seenSubprojects.has(subproject.subprojectId)) return;
    seenSubprojects.add(subproject.subprojectId);
    rows.push({
      ...subprojectRowOf(subproject, projectName),
      depth: 1,
      parentKey: undefined,
      expandable: (taskRoots.get(subproject.subprojectId)?.length ?? 0) > 0
    });
    (taskRoots.get(subproject.subprojectId) ?? []).slice().sort(byName).forEach((task) => appendTask(task, depth + 1));
  };
  subprojectRoots.slice().sort(byName).forEach((subproject) => appendSubproject(subproject, 1));
  // Malformed parent links remain visible once at a bounded root instead of disappearing.
  branch.subprojects.filter((entry) => !seenSubprojects.has(entry.subprojectId)).sort(byName).forEach((entry) => appendSubproject(entry, 1));
  (taskRoots.get('') ?? []).slice().sort(byName).forEach((task) => appendTask(task, 1));
  branch.tasks.filter((entry) => !seenTasks.has(entry.taskId)).sort(byName).forEach((entry) => appendTask(entry, 1));
  return rows;
}

function visibleBranchRows(rows: Row[], expanded: readonly string[], expandAll = false): Row[] {
  // A filtered inspection view shows every match with the ancestors that explain it.
  if (expandAll) return rows;
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

function hasScheduleSpan(row: Row): boolean {
  return !!row.scheduleStart && !!row.scheduleFinish;
}

function isOutside(row: Row, window: ViewWindow, pixelsPerDay: number): boolean {
  if (!hasScheduleSpan(row)) return false;
  return spanOf(row.scheduleStart, row.scheduleFinish, window, pixelsPerDay) === null;
}

/** Why a row has no drawable position: the actual stored condition, never a guess. */
function undatedReason(row: Row): string {
  if (row.dateState === 'INVALID') return 'timeline.reason.invalid';
  if (row.dateState === 'START_ONLY') return 'timeline.reason.finishMissing';
  if (row.dateState === 'FINISH_ONLY') return 'timeline.reason.startMissing';
  if (!row.plannedStart && !row.deadline && !row.completedAt) return 'timeline.reason.none';
  if (!row.scheduleStart && !row.scheduleFinish) return 'timeline.reason.notPlaced';
  return 'timeline.reason.none';
}

function defaultMode(): TimelineMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'chart';
  return window.matchMedia('(max-width: 720px)').matches ? 'agenda' : 'chart';
}

const ATTENTION_FILTERS: ProjectAttentionFilter[] = ['ALL', 'OVERDUE', 'DUE_SOON', 'REVIEW', 'MISSING_DATES'];

export function TimelineScreen({
  actor,
  initialProjectId,
  initialSubprojectId,
  initialAnchor
}: {
  actor: Actor;
  initialProjectId?: string;
  /** A deep link may name a subproject; it is page memory afterwards. */
  initialSubprojectId?: string;
  /** A deep link may open a period; it is page memory afterwards. */
  initialAnchor?: string;
}): JSX.Element {
  const { t, language } = useI18n();
  const locale = language === 'ja' ? 'ja-JP' : 'en-US';
  const today = useBusinessDate();
  const [projectId, setProjectId] = useRouteMemoryState('timeline:project', initialProjectId ?? '', {
    resetToInitial: !!initialProjectId
  });
  const [responsibilityId, setResponsibilityId] = useRouteMemoryState('timeline:responsibility', '');
  // The shell's division switch narrows the timeline summaries; it is a display filter that the
  // server re-narrows against the resolved scope.
  const { selected: selectedDivision } = useDivisionScope();
  const divisionKey = selectedDivision ?? 'all';
  const initialWindow = useMemo(() => calendarMonthWindow(initialAnchor ?? todayJst()), [initialAnchor]);
  const [displayStart, setDisplayStart] = useRouteMemoryState('timeline:display-start', initialWindow.from, {
    resetToInitial: !!initialAnchor
  });
  const [displayFinish, setDisplayFinish] = useRouteMemoryState('timeline:display-finish', initialWindow.to, {
    resetToInitial: !!initialAnchor
  });
  const [preset, setPreset] = useRouteMemoryState<TimelinePreset>('timeline:preset', 'custom', {
    resetToInitial: !!initialAnchor
  });
  const [draftStart, setDraftStart] = useState(displayStart);
  const [draftFinish, setDraftFinish] = useState(displayFinish);
  // The subproject segment of `#/timeline/<project>/<subproject>` initializes the filter, so a
  // shared link opens exactly the branch it names - also when the screen is already mounted.
  const [subprojectId, setSubprojectId] = useRouteMemoryState('timeline:subproject', initialSubprojectId ?? '', {
    resetToInitial: !!initialSubprojectId
  });
  const [includeCompleted, setIncludeCompleted] = useRouteMemoryState('timeline:include-completed', true);
  const [page, setPage] = useRouteMemoryState('timeline:page', 1);
  // Presentation is page memory: a phone starts on the agenda, and the user's choice is kept.
  const [mode, setMode] = useRouteMemoryState<TimelineMode>('timeline:mode', defaultMode);
  const [attentionKey, setAttentionKey] = useRouteMemoryState<ProjectAttentionFilter>(
    'timeline:attention',
    'ALL'
  );
  const [panelKey, setPanelKey] = useRouteMemoryState<string | null>('timeline:panel', null);
  const panelInvoker = useRef<HTMLElement | null>(null);
  // Division switching clears a project selection that belonged to the previous scope: a
  // project-focused timeline must never keep displaying division-A work under a division-B label.
  // The selection is re-validated by the server if it is still reachable, and the period, sort and
  // expansion are presentation state that survive.
  useDivisionTransition(() => {
    setProjectId('');
    setSubprojectId('');
    setPage(1);
    setAttentionKey('ALL');
    setPanelKey(null);
  });
  const [expanded, setExpanded] = useRouteMemoryState<string[]>('timeline:expanded', []);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const trackRef = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    setTrackWidth(0);
    if (!element) return;
    let active = true;
    const measure = (): void => {
      if (!active) return;
      const width = element.getBoundingClientRect().width;
      if (width > 0) setTrackWidth((current) => current === width ? current : width);
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      observerRef.current = observer;
    }
    return () => {
      active = false;
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, []);

  useEffect(() => setDraftStart(displayStart), [displayStart]);
  useEffect(() => setDraftFinish(displayFinish), [displayFinish]);

  const window: ViewWindow = useMemo(() => {
    return windowOf(displayStart, displayFinish) ?? initialWindow;
  }, [displayStart, displayFinish, initialWindow]);
  // A hidden track has no drawable width yet, but date semantics must remain renderable until it is measured.
  const pixelsPerDay = trackWidth > 0 ? trackWidth / window.days : 1;
  const dayWidth = pixelsPerDay;
  const totalWidth = trackWidth;
  const todayOffset = markerOf(todayJst(), window, dayWidth);

  const overview = useQuery<TimelineProjectPage>(
    `work/timeline:overview:${responsibilityId}:${includeCompleted}:${page}:${divisionKey}`,
    () =>
      api.get<TimelineProjectPage>(
        '/api/work/timeline' +
          queryString({
            responsibilityId,
            page,
            pageSize: 25,
            includeCompleted: includeCompleted ? 'true' : 'false',
            divisionId: selectedDivision ?? undefined
          })
      ),
    { enabled: !projectId }
  );
  const branch = useQuery<TimelineProjectBranch>(
    `work/timeline:branch:${projectId}:${subprojectId}:${includeCompleted}:${divisionKey}`,
    () =>
      api.get<TimelineProjectBranch>(
        '/api/work/timeline' +
          queryString({
            projectId,
            subprojectId: subprojectId || undefined,
            includeCompleted: includeCompleted ? 'true' : 'false',
            divisionId: selectedDivision ?? undefined
          })
      ),
    { enabled: !!projectId }
  );
  const subprojectOptions = useQuery<TimelineProjectBranch>(
    `work/timeline:subproject-options:${projectId}:${divisionKey}`,
    () =>
      api.get<TimelineProjectBranch>(
        '/api/work/timeline' + queryString({ projectId, divisionId: selectedDivision ?? undefined })
      ),
    { enabled: !!projectId }
  );
  // The responsibility filter uses the same authorized option list as the read-only project screen.
  const responsibilities = useQuery<WorkProjectList>(
    `work/projects:timeline-options:${divisionKey}`,
    () =>
      api.get<WorkProjectList>(
        '/api/work/projects' + queryString({ page: 1, pageSize: 1, divisionId: selectedDivision ?? undefined })
      )
  );
  // Attention counts are resolved on the server from the whole authorized project scope. They are
  // never derived from the loaded chart rows, a collapsed branch or the visible period.
  const attention = useQuery<ProjectAttention>(
    `work/project-attention:${projectId}:${divisionKey}:${today}`,
    async () => {
      const parsed = ProjectAttention.safeParse(
        await api.get<unknown>(
          `/api/work/projects/${projectId}/attention` +
            (selectedDivision ? `?divisionId=${encodeURIComponent(selectedDivision)}` : '')
        )
      );
      if (!parsed.success) {
        throw new ApiFailure({
          code: 'INVALID_RESPONSE',
          message: 'Invalid attention response',
          retryable: true
        });
      }
      return parsed.data;
    },
    { enabled: !!projectId }
  );
  const attentionBucket = attention.data?.buckets?.find((bucket) => bucket.key === attentionKey);
  const attentionActive = attentionKey !== 'ALL';

  /**
   * Apply one server-provided attention bucket to the authorized branch. The matching work and its
   * ancestor context come from the server; the client only selects the rows it may draw.
   */
  const scopedBranch = useMemo<TimelineProjectBranch | null>(() => {
    if (!branch.data) return null;
    if (!attentionActive || !attentionBucket) return branch.data;
    const taskIds = new Set<string>([...attentionBucket.taskIds, ...attentionBucket.contextTaskIds]);
    const tasks = branch.data.tasks.filter((task) => taskIds.has(task.taskId));
    const subprojectIds = new Set<string>(attentionBucket.contextSubprojectIds);
    for (const task of tasks) if (task.subprojectId) subprojectIds.add(task.subprojectId);
    return {
      ...branch.data,
      tasks,
      subprojects: branch.data.subprojects.filter((subproject) => subprojectIds.has(subproject.subprojectId))
    };
  }, [branch.data, attentionActive, attentionBucket]);

  const projectRows = (overview.data?.items ?? []).map(projectRowOf);
  const selectedRows = scopedBranch
    ? visibleBranchRows(branchRows(scopedBranch), expanded, attentionActive)
    : [];
  const rows = projectId ? selectedRows : projectRows;
  const dated = rows.filter((row) => row.scheduleStart && row.scheduleFinish);
  const outsideCount = dated.filter((row) => isOutside(row, window, dayWidth)).length;
  const undatedRows = rows.filter((row) => !hasScheduleSpan(row) && !row.deadline && !row.completedAt);
  // A selected project is the scope itself; only a narrowing control counts as a filter.
  const narrowing = !!subprojectId || !!responsibilityId || !includeCompleted || attentionActive;
  const filtersActive = !!projectId || narrowing;
  /** The server calculates this before pagination and independently of expanded folders. */
  const fitBounds = projectId ? branch.data?.fitRange ?? null : overview.data?.fitRange ?? null;
  const applyDates = (start: string, finish: string): void => {
    const next = windowOf(start, finish);
    if (next) {
      setDisplayStart(start);
      setDisplayFinish(finish);
      setDraftStart(start);
      setDraftFinish(finish);
    }
  };
  const fit = (): void => {
    if (!fitBounds) return;
    const start = parseDate(fitBounds.start);
    const end = parseDate(fitBounds.end);
    if (start === null || end === null) return;
    const days = Math.round((end - start) / 86_400_000) + 1;
    const padding = days === 1 ? 1 : Math.min(Math.max(2, Math.ceil(days * 0.05)), 14);
    setPreset('custom');
    applyDates(
      new Date(start - padding * 86_400_000).toISOString().slice(0, 10),
      new Date(end + padding * 86_400_000).toISOString().slice(0, 10)
    );
  };
  const datesValid = parseDate(draftStart) !== null && parseDate(draftFinish) !== null && draftStart <= draftFinish;
  const selectPreset = (next: TimelinePreset): void => {
    setPreset(next);
    if (next === 'custom') return;
    const range = presetWindow(displayStart, next);
    if (range) applyDates(range.from, range.to);
  };
  const shiftPeriod = (direction: -1 | 1): void => {
    const next = navigateWindow(window, preset, direction);
    if (next.from === window.from && next.to === window.to) return;
    applyDates(next.from, next.to);
  };
  const goToday = (): void => {
    const next = todayWindow(window, preset, todayJst());
    if (next.from === window.from && next.to === window.to) return;
    applyDates(next.from, next.to);
  };
  /** Deliberately bring one row's authoritative span into view. */
  const showRow = (row: Row): void => {
    const start = row.scheduleStart ?? row.deadline;
    const finish = row.scheduleFinish ?? row.deadline;
    const startMs = start ? parseDate(start) : null;
    const endMs = finish ? parseDate(finish) : null;
    if (startMs === null || endMs === null) return;
    const days = Math.round((endMs - startMs) / 86_400_000) + 1;
    const padding = days === 1 ? 2 : Math.min(Math.max(2, Math.ceil(days * 0.1)), 14);
    setPreset('custom');
    applyDates(toDate(startMs - padding * 86_400_000), toDate(endMs + padding * 86_400_000));
    setMode('chart');
  };
  const openPanel = (key: string): void => {
    panelInvoker.current = (typeof document === 'undefined' ? null : document.activeElement) as HTMLElement | null;
    setPanelKey(key);
  };
  const closePanel = (): void => {
    setPanelKey(null);
    const invoker = panelInvoker.current;
    panelInvoker.current = null;
    if (invoker && typeof invoker.focus === 'function') invoker.focus();
  };

  const toggleExpanded = (key: string): void => {
    setExpanded((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]
    );
  };
  const reset = (): void => {
    setProjectId('');
    setResponsibilityId('');
    setSubprojectId('');
    setAttentionKey('ALL');
    const month = calendarMonthWindow();
    setPreset('custom');
    applyDates(month.from, month.to);
    setIncludeCompleted(true);
    setPage(1);
    setExpanded([]);
    setPanelKey(null);
  };

  const loading =
    (!!projectId && branch.loading && !branch.data) || (!projectId && overview.loading && !overview.data);
  const panelRow = panelKey ? rows.find((row) => row.key === panelKey) ?? null : null;
  const agendaTotal = projectId ? branch.data?.taskTotal ?? rows.length : overview.data?.total ?? rows.length;

  return (
    <div className="screen stack timeline-screen">
      <h2>{t('timeline.title')}</h2>
      <p className="muted small">{t('timeline.intro')}</p>

      <section className="card stack timeline-controls" aria-label={t('timeline.title')}>
        {/* One compact navigation row: the period controls the reader touches every day. */}
        <div className="compact-toolbar timeline-nav" role="group" aria-label={t('timeline.period')}>
          <div className="timeline-nav-buttons">
            <button type="button" className="button secondary" onClick={() => shiftPeriod(-1)}>
              <span aria-hidden="true">‹</span> {t('timeline.previous')}
            </button>
            <button type="button" className="button secondary" onClick={goToday}>
              {t('timeline.today')}
            </button>
            <button type="button" className="button secondary" onClick={() => shiftPeriod(1)}>
              {t('timeline.next')} <span aria-hidden="true">›</span>
            </button>
          </div>
          <div className="segmented" role="group" aria-label={t('timeline.period')}>
            {(['week', 'fortnight', 'month', 'quarter', 'custom'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={preset === value ? 'segmented-button active' : 'segmented-button'}
                aria-pressed={preset === value}
                onClick={() => selectPreset(value)}
              >
                {t(`timeline.preset.${value}`)}
              </button>
            ))}
          </div>
          <button type="button" className="button secondary" disabled={!fitBounds} onClick={fit}>
            {t('timeline.fit')}
          </button>
          {preset !== 'custom' ? (
            <span className="timeline-range muted small">{`${window.from} – ${window.to}`}</span>
          ) : null}
        </div>

        {preset === 'custom' ? (
          <div className="compact-toolbar timeline-custom">
            <label className="field">
              <span className="field-label">{t('timeline.displayStart')}</span>
              <input
                type="date"
                value={draftStart}
                onChange={(event) => {
                  const start = event.target.value;
                  setDraftStart(start);
                  if (parseDate(start) && parseDate(draftFinish) && start <= draftFinish) {
                    applyDates(start, draftFinish);
                  }
                }}
              />
            </label>
            <label className="field">
              <span className="field-label">{t('timeline.displayFinish')}</span>
              <input
                type="date"
                value={draftFinish}
                onChange={(event) => {
                  const finish = event.target.value;
                  setDraftFinish(finish);
                  if (parseDate(draftStart) && parseDate(finish) && draftStart <= finish) {
                    applyDates(draftStart, finish);
                  }
                }}
              />
            </label>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                const month = calendarMonthWindow();
                setPreset('custom');
                applyDates(month.from, month.to);
              }}
            >
              {t('timeline.resetDates')}
            </button>
          </div>
        ) : (
          <p className="muted small timeline-preset-hint">{t('timeline.presetHint')}</p>
        )}
        {!datesValid ? <p className="field-hint error-help">{t('timeline.invalidDates')}</p> : null}

        {/* Secondary scope controls are progressive disclosure: they do not crowd the toolbar. */}
        <details className="disclosure timeline-scope">
          <summary>
            {t('timeline.filters')}
            {narrowing ? ` (${t('timeline.filter.active')})` : ''}
          </summary>
          <div className="disclosure-body compact-toolbar">
            <div className="field">
              <span className="field-label">{t('timeline.scope.project')}</span>
              <RemoteSelect
                value={projectId}
                optionsKey={`timeline:project-options:${divisionKey}`}
                onChange={(value) => {
                  setProjectId(value);
                  setSubprojectId('');
                  setExpanded([]);
                  setAttentionKey('ALL');
                  setPanelKey(null);
                }}
                allowEmpty={t('timeline.scope.all')}
                searchLabel={t('picker.search')}
                selectLabel={t('timeline.scope.project')}
                load={async ({ query, page: optionPage }) => {
                  const result = await api.get<WorkProjectList>(
                    '/api/work/projects' +
                      queryString({
                        query,
                        page: optionPage,
                        pageSize: 25,
                        divisionId: selectedDivision ?? undefined
                      })
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
                  setPanelKey(null);
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
        </details>

        <div className="compact-toolbar timeline-view-switch">
          <div className="segmented" role="group" aria-label={t('timeline.view')}>
            <button
              type="button"
              className={mode === 'chart' ? 'segmented-button active' : 'segmented-button'}
              aria-pressed={mode === 'chart'}
              onClick={() => setMode('chart')}
            >
              {t('timeline.view.chart')}
            </button>
            <button
              type="button"
              className={mode === 'agenda' ? 'segmented-button active' : 'segmented-button'}
              aria-pressed={mode === 'agenda'}
              onClick={() => setMode('agenda')}
            >
              {t('timeline.view.agenda')}
            </button>
          </div>
          <p className="muted small timeline-view-note">
            {`${window.from} – ${window.to}`}
            {' · '}{t('timeline.taskTotal', { n: agendaTotal })}
            {narrowing ? ` · ${t('timeline.filter.active')}` : ''}
            {outsideCount > 0 ? ` · ${t('timeline.more', { n: outsideCount })}` : ''}
          </p>
        </div>
      </section>

      {projectId ? (
        <section className="card stack attention-filters" aria-label={t('timeline.attention.label')}>
          <div className="attention-filter-row" role="group" aria-label={t('timeline.attention.label')}>
            {ATTENTION_FILTERS.map((key) => {
              const bucket = attention.data?.buckets?.find((entry) => entry.key === key);
              return (
                <button
                  key={key}
                  type="button"
                  className={attentionKey === key ? 'attention-filter active' : 'attention-filter'}
                  aria-pressed={attentionKey === key}
                  onClick={() => setAttentionKey(key)}
                >
                  <span>{t(`timeline.attention.${key}`)}</span>
                  <span className="attention-count">
                    {bucket ? bucket.count : attention.loading ? '…' : '—'}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="muted small">
            {attention.data
              ? t('timeline.attention.scopeNote', {
                  from: attention.data.dueSoon.from,
                  to: attention.data.dueSoon.to
                })
              : attention.loading
                ? t('state.loading')
                : t('timeline.attention.unavailable')}
          </p>
          {attention.error ? <ErrorBox error={attention.error} onRetry={() => attention.refresh()} /> : null}
        </section>
      ) : null}

      <ErrorBox
        error={overview.error ?? branch.error ?? subprojectOptions.error ?? responsibilities.error}
        onRetry={() => {
          overview.refresh();
          branch.refresh();
          subprojectOptions.refresh();
          responsibilities.refresh();
          attention.refresh();
        }}
      />

      {loading ? <p className="muted">{t('timeline.loading')}</p> : null}

      {projectId && branch.data?.truncated ? (
        <div className="banner warning">
          {t('timeline.truncated', { shown: branch.data.tasks.length, total: branch.data.taskTotal })}
        </div>
      ) : null}

      {attentionActive && projectId && !loading ? (
        rows.length === 0 && !branch.error ? (
          <div className="empty attention-empty" role="status">
            <p>{t('timeline.attention.noMatch')}</p>
            <button type="button" className="link-button" onClick={() => setAttentionKey('ALL')}>
              {t('timeline.attention.showAll')}
            </button>
          </div>
        ) : (
          <p className="muted small attention-applied" role="status">
            {t('timeline.attention.applied', { n: attentionBucket?.count ?? 0 })}
          </p>
        )
      ) : null}

      {!projectId && overview.data && overview.data.items.length === 0 ? (
        <p className="muted">{t('timeline.noProjects')}</p>
      ) : null}

      {mode === 'chart' ? (
        <div className="timeline-chart">
          <TimelineLegend />
          {rows.length > 0 || (projectId && scopedBranch) ? (
            <div className="tl-scroller" role="table" aria-label={t('timeline.chartHelp')} tabIndex={0}>
              <div className="tl-row tl-head" role="row">
                <div className="tl-cell-name" role="columnheader">
                  {t('timeline.title')}
                </div>
                <div ref={trackRef} className="tl-cell-track tl-axis" role="columnheader">
                  {trackWidth <= 0 ? <span className="tl-measuring">{t('timeline.measuring')}</span> : null}
                  {axisContext(window, totalWidth, locale).map((entry) => (
                    <span key={entry.key} className="tl-scale-cell tl-context" style={{ left: entry.left }}>{entry.label}</span>
                  ))}
                  {axisTicks(window, totalWidth, locale).map((entry) => (
                    <span
                      key={entry.key}
                      className={`tl-scale-cell${entry.weekend ? ' weekend' : ''}${entry.major ? ' tl-scale-major' : ''}${entry.alignEnd ? ' tl-scale-end' : ''}`}
                      style={{ left: entry.left }}
                    >
                      {entry.label}
                    </span>
                  ))}
                  {todayOffset !== null ? (
                    <span className="tl-today-label" style={{ left: todayOffset }}>{t('timeline.today')}</span>
                  ) : null}
                </div>
              </div>

              {projectId
                ? scopedBranch
                  ? (
                      <>
                        <TimelineRow
                          row={{ ...projectRowOf(scopedBranch.project), expandable: false }}
                          window={window}
                          dayWidth={dayWidth}
                          todayOffset={todayOffset}
                          expanded
                          panelOpen={panelKey === `project:${scopedBranch.project.projectId}`}
                          onToggle={() => undefined}
                          onInspect={() => openPanel(`project:${scopedBranch.project.projectId}`)}
                          onShow={showRow}
                        />
                        {/* The selected project starts expanded so its first subproject level is visible. */}
                        {selectedRows.map((row) => (
                          <TimelineRow
                            key={row.key}
                            row={row}
                            window={window}
                            dayWidth={dayWidth}
                            todayOffset={todayOffset}
                            expanded={expanded.includes(row.key)}
                            panelOpen={panelKey === row.key}
                            onToggle={() => toggleExpanded(row.key)}
                            onInspect={() => openPanel(row.key)}
                            onShow={showRow}
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
                        todayOffset={todayOffset}
                        expanded={expanded.includes(row.key)}
                        panelOpen={panelKey === row.key}
                        onToggle={() => toggleExpanded(row.key)}
                        onInspect={() => openPanel(row.key)}
                        onShow={showRow}
                      />
                      {expanded.includes(row.key) ? (
                        <ProjectBranchRows
                          projectId={row.projectId}
                          projectName={row.projectName}
                          includeCompleted={includeCompleted}
                          divisionId={selectedDivision}
                          window={window}
                          dayWidth={dayWidth}
                          todayOffset={todayOffset}
                          panelKey={panelKey}
                          onInspect={openPanel}
                          onShow={showRow}
                          expanded={expanded}
                          onToggle={toggleExpanded}
                        />
                      ) : null}
                    </Fragment>
                  ))}
            </div>
          ) : null}

          {undatedRows.length > 0 ? (
            <section className="card undated-work" aria-label={t('timeline.undatedSection')}>
              <h3>{t('timeline.undatedSection')}</h3>
              <p className="muted small">{t('timeline.undatedHint')}</p>
              <ul className="undated-list">
                {undatedRows.map((row) => (
                  <li key={`undated-${row.key}`}>
                    <span className="undated-name">
                      {row.kind === 'TASK' ? (
                        <a href={`#/task/${row.taskId}`}>{row.name}</a>
                      ) : (
                        <span>{row.name}</span>
                      )}
                    </span>
                    <span className="muted small">
                      {t(undatedReason(row))}
                      {row.kind !== 'PROJECT' ? ` · ${row.projectName}` : ''}
                      {row.subprojectName ? ` · ${row.subprojectName}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : (
        <TimelineAgenda
          rows={rows}
          total={agendaTotal}
          page={projectId ? 1 : overview.data?.page ?? 1}
          totalPages={projectId ? 1 : overview.data?.totalPages ?? 1}
          onInspect={openPanel}
          onShow={showRow}
        />
      )}

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
                  {row.plannedStart || row.scheduleStart || row.scheduleFinish
                    ? `${row.plannedStart ?? row.scheduleStart ?? t('timeline.startNotSet')} → ${row.scheduleFinish ?? row.plannedEnd ?? '-'}`
                    : t('timeline.undated')}
                  {row.dateSource === 'DERIVED' ? (
                    <span className="muted small"> · {t('timeline.derived')}</span>
                  ) : null}
                </td>
                <td className="muted small">{row.deadline ?? t('common.unset')}</td>
                <td className="muted small">{row.completedAt ? row.completedAt.slice(0, 10) : t('common.unset')}</td>
                <td className="muted small">
                  {row.kind === 'TASK'
                    ? row.displayStatus
                      ? <TaskStatusBadge state={row.displayStatus} missing={row.scheduleMissing} />
                      : row.status
                    : <ScheduleBadge schedule={row.schedule} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      {panelRow ? <TimelinePanel row={panelRow} onClose={closePanel} /> : null}

      {actor.role === 'VIEWER' ? <p className="muted small">{t('timeline.intro')}</p> : null}
    </div>
  );
}

/** The chart's visual language in one compact legend; project hue is identity, never status. */
function TimelineLegend(): JSX.Element {
  const { t } = useI18n();
  return (
    <ul className="timeline-legend" aria-label={t('timeline.legend')}>
      <li><span className="legend-mark legend-schedule" aria-hidden="true" />{t('timeline.legend.planned')}</li>
      <li><span className="legend-mark legend-group" aria-hidden="true" />{t('timeline.legend.childRange')}</li>
      <li><span className="legend-mark legend-deadline" aria-hidden="true" />{t('timeline.legend.deadline')}</li>
      <li><span className="legend-mark legend-completed" aria-hidden="true">✓</span>{t('timeline.legend.completed')}</li>
      <li><span className="legend-mark legend-today" aria-hidden="true" />{t('timeline.legend.today')}</li>
    </ul>
  );
}

/** One expanded project in the all-project view loads its own authorized branch on demand. */
function ProjectBranchRows({
  projectId,
  projectName,
  includeCompleted,
  divisionId,
  window,
  dayWidth,
  todayOffset,
  panelKey,
  onInspect,
  onShow,
  expanded,
  onToggle
}: {
  projectId: string;
  projectName: string;
  includeCompleted: boolean;
  divisionId: string | null;
  window: ViewWindow;
  dayWidth: number;
  todayOffset: number | null;
  panelKey: string | null;
  onInspect: (key: string) => void;
  onShow: (row: Row) => void;
  expanded: readonly string[];
  onToggle: (key: string) => void;
}): JSX.Element {
  const { t } = useI18n();
  const branch = useQuery<TimelineProjectBranch>(
    `work/timeline:branch:${projectId}:${includeCompleted}:${divisionId ?? 'all'}`,
    () =>
      api.get<TimelineProjectBranch>(
        '/api/work/timeline' +
          queryString({
            projectId,
            includeCompleted: includeCompleted ? 'true' : 'false',
            divisionId: divisionId ?? undefined
          })
      )
  );
  // A failed branch read is an error with a retry, never an endless "loading" label.
  if (branch.error) {
    return (
      <div className="tl-branch-state">
        <ErrorBox error={branch.error} onRetry={() => branch.refresh()} />
      </div>
    );
  }
  if (!branch.data) return <p className="muted small tl-branch-loading">{t('timeline.branchLoading')}</p>;
  return (
    <>
      {branch.data.truncated ? (
        <div className="banner warning tl-branch-loading">
          {t('timeline.truncated', { shown: branch.data.tasks.length, total: branch.data.taskTotal })}
        </div>
      ) : null}
      {visibleBranchRows(
        branchRows({ ...branch.data, project: { ...branch.data.project, projectName } }),
        expanded
      ).map((row) => (
        <TimelineRow
          key={`${projectId}-${row.key}`}
          row={row}
          window={window}
          dayWidth={dayWidth}
          todayOffset={todayOffset}
          expanded={expanded.includes(row.key)}
          panelOpen={panelKey === `${projectId}-${row.key}`}
          onToggle={() => onToggle(row.key)}
          onInspect={() => onInspect(`${projectId}-${row.key}`)}
          onShow={onShow}
        />
      ))}
    </>
  );
}

/**
 * One chart row.
 *
 * Marks stay restrained and distinguishable: a solid bar is the schedule span, an outlined bracket
 * is a descendant-derived group span, a diamond is the committed deadline, a check is the recorded
 * completion and a labelled line is today. A point bar (one-day work) is a narrow tick, so a
 * deadline-only record is never drawn as if it had a schedule.
 */
function TimelineRow({
  row,
  window,
  dayWidth,
  todayOffset,
  expanded,
  panelOpen,
  onToggle,
  onInspect,
  onShow
}: {
  row: Row;
  window: ViewWindow;
  dayWidth: number;
  todayOffset: number | null;
  expanded: boolean;
  panelOpen: boolean;
  onToggle: () => void;
  onInspect: () => void;
  onShow: (row: Row) => void;
}): JSX.Element {
  const { t } = useI18n();
  const derived = row.dateSource === 'DERIVED';
  // A derived span belongs to a group: it is drawn as an outlined bracket, never as a solid plan.
  const schedule = derived ? null : barGeometry(row.scheduleStart, row.scheduleFinish, window, dayWidth);
  const groupSpan = derived
    ? barGeometry(row.scheduleStart, row.scheduleFinish, window, dayWidth)
    : null;
  // A finish-only record has no stored start: its date is a commitment, so it gets the diamond.
  const deadlineOnly = row.dateState === 'FINISH_ONLY' || (!row.plannedStart && !!row.deadline);
  const deadlineMark = markerOf(row.deadline, window, dayWidth);
  const completionMark = markerOf(row.completedAt ? tokyoCalendarDate(row.completedAt) : null, window, dayWidth);
  const startOnlyMark = markerOf(row.dateState === 'START_ONLY' ? row.plannedStart : null, window, dayWidth);
  const outside = isOutside(row, window, dayWidth);
  const scheduleLabel =
    row.dateState === 'START_ONLY'
      ? `${row.plannedStart ?? t('timeline.startNotSet')} · ${t('timeline.finishNotSet')}`
      : row.dateState === 'INVALID'
        ? t('timeline.inconsistent')
        : row.scheduleStart && row.scheduleFinish
          ? `${row.scheduleStart} → ${row.scheduleFinish}`
          : row.deadline
            ? t('timeline.deadlineOnly', { date: row.deadline })
            : t('timeline.undated');
  const overdue = row.kind === 'TASK' && row.displayStatus === 'OVERDUE';
  const awaitingReview = row.reviewState === 'PENDING';
  return (
    <div
      className={`tl-row tl-kind-${row.kind.toLowerCase()}${outside ? ' is-outside' : ''}`}
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
          {row.taskId ? <a href={`#/task/${row.taskId}`}>{row.name}</a> :
            row.kind === 'PROJECT' ? <a href={`#/project/${row.projectId}`}>{row.name}</a> :
              <a href={`#/timeline/${row.projectId}/${row.key.replace('subproject:', '')}`}>{row.name}</a>}
        </span>
        {row.container ? <span className="badge info">{t('timeline.container')}</span> : null}
        {row.inconsistent ? <span className="badge danger">{t('timeline.inconsistent')}</span> : null}
        {overdue ? <span className="badge danger">{t('taskStatus.OVERDUE')}</span> : null}
        {awaitingReview ? <span className="badge warn">{t('tasks.review')}</span> : null}
        {outside ? (
          <>
            <span className="badge neutral">{t('timeline.outside')}</span>
            <button type="button" className="link-button tl-show" onClick={() => onShow(row)}>
              {t('timeline.showInTimeline')}
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="link-button tl-details-toggle"
          aria-expanded={panelOpen}
          aria-label={`${t('timeline.details')}: ${row.name}`}
          onClick={onInspect}
        >
          {t('timeline.details')}
        </button>
      </div>
      <div className="tl-cell-track" role="cell">
        {todayOffset !== null ? <span className="tl-today" style={{ left: todayOffset }} aria-hidden="true" /> : null}
        {schedule ? (
          <>
            <span
              className={`tl-bar${schedule.point ? ' is-point' : ''}${schedule.clampedStart ? ' is-clamped-start' : ''}${schedule.clampedEnd ? ' is-clamped-end' : ''}${deadlineOnly ? ' is-deadline-only' : ''}${row.kind === 'TASK' && row.status === 'Done' ? ' is-done' : ''}`}
              title={scheduleLabel}
              aria-hidden="true"
              style={{ left: schedule.left, width: schedule.width }}
            >
              {deadlineOnly ? <span className="tl-bar-diamond" aria-hidden="true" /> : null}
            </span>
            <button
              type="button"
              className="tl-hit"
              aria-label={`${row.name}: ${scheduleLabel}`}
              aria-expanded={panelOpen}
              title={scheduleLabel}
              onClick={onInspect}
              style={{
                left: schedule.left - Math.max(0, 24 - schedule.width) / 2,
                width: Math.max(schedule.width, 24)
              }}
            />
          </>
        ) : null}
        {groupSpan ? (
          <>
            <span
              className={`tl-bar is-group${groupSpan.clampedStart ? ' is-clamped-start' : ''}${groupSpan.clampedEnd ? ' is-clamped-end' : ''}`}
              title={`${t('timeline.childRange')}: ${scheduleLabel}`}
              aria-hidden="true"
              style={{ left: groupSpan.left, width: Math.max(groupSpan.width, 6) }}
            />
            <button
              type="button"
              className="tl-hit"
              aria-label={`${row.name}: ${t('timeline.childRange')} ${row.scheduleStart ?? '-'} → ${row.scheduleFinish ?? '-'}`}
              aria-expanded={panelOpen}
              onClick={onInspect}
              style={{
                left: groupSpan.left - Math.max(0, 24 - Math.max(groupSpan.width, 6)) / 2,
                width: Math.max(groupSpan.width, 6, 24)
              }}
            />
          </>
        ) : null}
        {deadlineMark !== null && !deadlineOnly ? (
          <span
            className="tl-marker tl-marker-deadline"
            style={{ left: deadlineMark }}
            title={`${t('timeline.dates.deadline')}: ${row.deadline}`}
            aria-hidden="true"
          />
        ) : null}
        {completionMark !== null ? (
          <span
            className="tl-marker tl-marker-completed"
            style={{ left: completionMark }}
            title={`${t('timeline.dates.completed')}: ${row.completedAt?.slice(0, 10)}`}
            aria-hidden="true"
          >
            ✓
          </span>
        ) : null}
        {startOnlyMark !== null ? (
          <span
            className="tl-marker tl-marker-start"
            style={{ left: startOnlyMark }}
            title={`${t('timeline.dates.plan')}: ${row.plannedStart}`}
            aria-hidden="true"
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * The inspection panel.
 *
 * A non-modal dialog so the chart keeps its place: Escape and Close dismiss it, focus starts on the
 * heading and returns to the control that opened it. Nothing here writes.
 */
function TimelinePanel({ row, onClose }: { row: Row; onClose: () => void }): JSX.Element {
  const { t } = useI18n();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useRef(`tl-panel-${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    headingRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);
  const kindLabel = t(`timeline.panel.kind.${row.kind}`);
  const scheduleText = row.scheduleStart && row.scheduleFinish
    ? `${row.scheduleStart} → ${row.scheduleFinish}`
    : row.dateState === 'START_ONLY'
      ? `${row.plannedStart ?? t('timeline.startNotSet')} · ${t('timeline.finishNotSet')}`
      : t('timeline.undated');
  const source = row.dateSource === 'EXPLICIT'
    ? t('timeline.panel.source.explicit')
    : row.dateSource === 'DERIVED'
      ? t('timeline.panel.source.derived')
      : t('timeline.panel.source.none');
  return (
    <aside className="tl-panel" role="dialog" aria-modal="false" aria-labelledby={titleId.current}>
      <header className="tl-panel-header">
        <span className="badge neutral">{kindLabel}</span>
        <h3 id={titleId.current} ref={headingRef} tabIndex={-1}>{row.name}</h3>
        <button type="button" className="link-button" onClick={onClose} aria-label={t('common.close')}>
          ×
        </button>
      </header>
      <dl className="request-summary tl-panel-body">
        <dt>{t('timeline.panel.project')}</dt>
        <dd>{row.projectName}</dd>
        {row.subprojectName ? (
          <>
            <dt>{t('timeline.scope.subproject')}</dt>
            <dd>{row.subprojectName}</dd>
          </>
        ) : null}
        {row.kind === 'TASK' && row.assigneeNames && row.assigneeNames.length > 0 ? (
          <>
            <dt>{t('task.assigneeHeading')}</dt>
            <dd>{row.assigneeNames.join(', ')}</dd>
          </>
        ) : null}
        <dt>{t('timeline.dates.plan')}</dt>
        <dd>{scheduleText}</dd>
        <dt>{t('timeline.panel.source')}</dt>
        <dd>{source}</dd>
        <dt>{t('timeline.dates.deadline')}</dt>
        <dd>{row.deadline ?? t('common.unset')}</dd>
        <dt>{t('column.status')}</dt>
        <dd>
          {row.kind === 'TASK' ? (
            row.displayStatus ? (
              <TaskStatusBadge state={row.displayStatus} missing={row.scheduleMissing} showDetail />
            ) : (
              row.status
            )
          ) : (
            <ScheduleBadge schedule={row.schedule} showDetail />
          )}
        </dd>
        {row.kind === 'TASK' ? (
          <>
            <dt>{t('tasks.review')}</dt>
            <dd>{t(`timeline.panel.review.${row.reviewState ?? 'NONE'}`)}</dd>
          </>
        ) : null}
        <dt>{t('timeline.dates.completed')}</dt>
        <dd>{row.completedAt ? row.completedAt.slice(0, 10) : t('common.unset')}</dd>
      </dl>
      <footer className="tl-panel-actions">
        {row.taskId ? (
          <a className="button" href={`#/task/${row.taskId}`} onClick={onClose}>
            {t('timeline.openTask')}
          </a>
        ) : (
          <a className="button" href={`#/project/${row.projectId}`} onClick={onClose}>
            {t('timeline.panel.openProject')}
          </a>
        )}
        <button type="button" className="button secondary" onClick={onClose}>
          {t('common.close')}
        </button>
      </footer>
      <p className="muted small tl-panel-note">{t('timeline.panel.readOnly')}</p>
    </aside>
  );
}

type AgendaEntry = { date: string; kind: 'DUE' | 'COMPLETED' | 'SCHEDULE'; row: Row };

function agendaEntries(rows: readonly Row[]): { dated: AgendaEntry[]; undated: Row[] } {
  const dated: AgendaEntry[] = [];
  const undated: Row[] = [];
  for (const row of rows) {
    const completed = row.completedAt ? tokyoCalendarDate(row.completedAt) : '';
    if (completed) {
      dated.push({ date: completed, kind: 'COMPLETED', row });
      continue;
    }
    if (row.deadline) {
      dated.push({ date: row.deadline, kind: 'DUE', row });
      continue;
    }
    if (row.scheduleFinish || row.scheduleStart) {
      dated.push({ date: (row.scheduleFinish ?? row.scheduleStart) as string, kind: 'SCHEDULE', row });
      continue;
    }
    undated.push(row);
  }
  dated.sort((left, right) => left.date.localeCompare(right.date) || left.row.name.localeCompare(right.row.name, 'ja'));
  return { dated, undated };
}

/** A phone-sized presentation of the same authorized scope and the same filters. */
function TimelineAgenda({
  rows,
  total,
  page,
  totalPages,
  onInspect,
  onShow
}: {
  rows: readonly Row[];
  total: number;
  page: number;
  totalPages: number;
  onInspect: (key: string) => void;
  onShow: (row: Row) => void;
}): JSX.Element {
  const { t } = useI18n();
  const { dated, undated } = agendaEntries(rows);
  const groups = useMemo(() => {
    const result: { date: string; entries: AgendaEntry[] }[] = [];
    for (const entry of dated) {
      const current = result[result.length - 1];
      if (current && current.date === entry.date) current.entries.push(entry);
      else result.push({ date: entry.date, entries: [entry] });
    }
    return result;
  }, [dated]);
  return (
    <section className="card stack timeline-agenda" aria-label={t('timeline.view.agenda')}>
      <p className="muted small">
        {t('timeline.agendaTotal', { shown: rows.length, total, page, pages: Math.max(1, totalPages) })}
      </p>
      {groups.length === 0 && undated.length === 0 ? <p className="muted">{t('timeline.empty')}</p> : null}
      <ol className="agenda-list">
        {groups.map((group) => (
          <li key={group.date} className="agenda-group">
            <h3 className="agenda-date">{group.date}</h3>
            <ul>
              {group.entries.map((entry) => (
                <li key={`${entry.kind}-${entry.row.key}`} className={`agenda-item agenda-${entry.kind.toLowerCase()}`}>
                  <span className="agenda-kind">{t(`timeline.agenda.${entry.kind}`)}</span>
                  <button type="button" className="link-button agenda-name" onClick={() => onInspect(entry.row.key)}>
                    {entry.row.name}
                  </button>
                  <span className="muted small agenda-context">
                    {entry.row.projectName}
                    {entry.row.subprojectName ? ` · ${entry.row.subprojectName}` : ''}
                  </span>
                  {entry.row.kind === 'TASK' ? (
                    <span className="agenda-status">
                      {entry.row.displayStatus ? (
                        <TaskStatusBadge state={entry.row.displayStatus} missing={entry.row.scheduleMissing} />
                      ) : null}
                    </span>
                  ) : null}
                  {entry.row.deadline && entry.kind !== 'DUE' ? (
                    <span className="muted small">{`${t('timeline.dates.deadline')}: ${entry.row.deadline}`}</span>
                  ) : null}
                  {entry.row.completedAt && entry.kind !== 'COMPLETED' ? (
                    <span className="muted small">{`${t('timeline.dates.completed')}: ${entry.row.completedAt.slice(0, 10)}`}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {undated.length > 0 ? (
        <div className="agenda-undated">
          <h3>{t('timeline.undatedSection')}</h3>
          <p className="muted small">{t('timeline.undatedHint')}</p>
          <ul>
            {undated.map((row) => (
              <li key={`agenda-undated-${row.key}`}>
                <button type="button" className="link-button" onClick={() => onInspect(row.key)}>
                  {row.name}
                </button>
                <span className="muted small">
                  {t(undatedReason(row))} · {row.projectName}
                </span>
                {hasScheduleSpan(row) ? (
                  <button type="button" className="link-button" onClick={() => onShow(row)}>
                    {t('timeline.showInTimeline')}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
