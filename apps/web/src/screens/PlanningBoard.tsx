/**
 * Planning Board (計画ボード).
 *
 * One page owns the whole plan: an editable hierarchy table on the left and a Gantt chart on the
 * right, rendered from the same draft object. Typing a name updates its bar label, a valid date
 * edit updates the bar, and a bar drag changes only dates. Manual order is separate from dates.
 *
 * Everything here is client-local until a save. No pointer move, keystroke or drag sends a request.
 * The plan is private to its author, and creating operational records is a separate, reviewed
 * command (`Review & Create`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Actor,
  PlanDraft,
  PlanExportResult,
  PlanItem,
  PlanList,
  PlanReview,
  PlanScheduleMode,
  WorkProjectList
} from '@eh/contracts';
import { PLAN_LIMITS } from '@eh/contracts';
import { projectColorVars, resolvePlanItemSchedule, type PlanRow } from '@eh/domain';
import { api, ApiFailure, queryString } from '../api/client';
import { queryCache, useQuery } from '../state/cache';
import { commitMutation } from '../state/mutation';
import { useDivisionScope } from '../state/division';
import { useRouteMemoryState } from '../state/navigation';
import { useBusinessDate } from '../state/business-date';
import { useI18n } from '../i18n';
import { Badge, EmptyState, ErrorBox, Menu, Modal, SaveState, Section } from '../components/ui';
import { createIdempotencyKey, RequiredTag, TextInput } from '../components/forms';
import { RemoteSelect } from '../components/forms';
import {
  axisTicks,
  addDays,
  dayDiff,
  parseDate,
  pixelToDate,
  spanOf,
  toDate,
  todayJst,
  windowOf,
  type TimelineWindow
} from '../components/timeline-dates';
import {
  addItem,
  assignItems,
  childCount,
  dragPatch,
  emptyPlanState,
  indentItem,
  itemById,
  localPlanProblems,
  moveItem,
  outdentItem,
  planBodyOf,
  planRange,
  planRows,
  planStateFromDraft,
  removeSubtree,
  reparentItem,
  reorderItem,
  siblingsOf,
  updateItem,
  usePlanHistory,
  type DragKind,
  type PlanState
} from '../state/planning';

type Scale = 'day' | 'week' | 'month';
const PIXELS_PER_DAY: Record<Scale, number> = { day: 30, week: 10, month: 4 };
const ROW_HEIGHT = 38;

type ReferenceMember = {
  memberId: string;
  name: string;
  active: boolean;
  role: string;
  employeeId?: string;
  divisionNames: string[];
  workDivisionIds: string[];
};

type ReferenceResponsibility = {
  id: string;
  name: string;
  status: string;
  divisionId: string | null;
};

type References = {
  responsibilities: ReferenceResponsibility[];
  members: ReferenceMember[];
};

type ItemDragState = {
  itemId: string;
  kind: DragKind;
  pointerId: number;
  startX: number;
  original: PlanItem;
  deltaDays: number;
};

type DrawState = {
  rowKey: string;
  parentItemId: string | null;
  anchorDate: string;
  startDate: string;
  finishDate: string;
};

type ReorderState = {
  itemId: string;
  parentItemId: string | null;
  targetIndex: number;
  y: number;
};

/** Date-only arithmetic: the timeline helpers work on UTC milliseconds, never on a local Date. */
function capturePointer(element: Element | null, pointerId: number): void {
  const target = element as (Element & { setPointerCapture?: (pointerId: number) => void }) | null;
  target?.setPointerCapture?.(pointerId);
}

function shiftIsoDate(value: string, days: number): string {
  const parsed = parseDate(value);
  return parsed === null ? value : toDate(addDays(parsed, days));
}

function formatRange(state: PlanState): string {
  const range = planRange(state);
  return range ? `${range.from} – ${range.to}` : '';
}

export function PlanningBoardScreen({ actor }: { actor: Actor }): JSX.Element {
  const { t } = useI18n();
  useBusinessDate();
  const scope = useDivisionScope();
  const writableDivisions = scope.writable;

  const [selectedPlanId, setSelectedPlanId] = useRouteMemoryState<string | null>('planning:plan', null);
  const [scale, setScale] = useRouteMemoryState<Scale>('planning:scale', 'week');
  const [viewFrom, setViewFrom] = useRouteMemoryState<string>('planning:from', () => todayJst());
  const [selectedItemId, setSelectedItemId] = useRouteMemoryState<string | null>('planning:item', null);
  const [collapsed, setCollapsed] = useRouteMemoryState<string[]>('planning:collapsed', []);
  const [checked, setChecked] = useState<string[]>([]);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'failed' | 'conflict' | 'unknown'>('idle');
  const [saveError, setSaveError] = useState<unknown>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [notice, setNotice] = useState('');
  const [review, setReview] = useState<PlanReview | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<unknown>(null);
  const [exportResult, setExportResult] = useState<PlanExportResult | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [bulkOwner, setBulkOwner] = useState('');
  const [bulkAssignees, setBulkAssignees] = useState<string[]>([]);
  const [bulkPreview, setBulkPreview] = useState<string | null>(null);
  const [drag, setDrag] = useState<ItemDragState | null>(null);
  const [draw, setDraw] = useState<DrawState | null>(null);
  const [reorder, setReorder] = useState<ReorderState | null>(null);
  // The pointer state is mirrored in refs so a commit is computed once, outside a state updater
  // (React may invoke an updater twice in StrictMode).
  const dragRef = useRef<ItemDragState | null>(null);
  const drawRef = useRef<DrawState | null>(null);
  const reorderRef = useRef<ReorderState | null>(null);

  const initial = useMemo(
    () => emptyPlanState(t('planning.untitled'), writableDivisions[0]?.divisionId ?? ''),
    // The starting draft is created once per mount; a later language or scope change must not reset it.
    []
  );
  const history = usePlanHistory(initial);
  const state = history.present;
  const savedSnapshot = useRef<string>(JSON.stringify(planBodyOf(initial)));
  const saveTimer = useRef<number | null>(null);
  const saveInFlight = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const plans = useQuery<PlanList>('manager/plans', () =>
    api.get<PlanList>('/api/manager/plans?status=ALL&pageSize=50')
  );
  const references = useQuery<References>('manager/references', () =>
    api.get<References>('/api/manager/references')
  );

  const dirty = JSON.stringify(planBodyOf(state)) !== savedSnapshot.current;
  const problems = localPlanProblems(state);
  const rows = planRows(state);

  const membersForDivision = useMemo(() => {
    const members = references.data?.members ?? [];
    const divisionId = state.divisionId;
    return members.filter(
      (member) => member.active && (!divisionId || member.workDivisionIds.includes(divisionId))
    );
  }, [references.data, state.divisionId]);

  const responsibilitiesForDivision = useMemo(
    () =>
      (references.data?.responsibilities ?? []).filter(
        (entry) => entry.status === 'Active' && (!state.divisionId || entry.divisionId === state.divisionId)
      ),
    [references.data, state.divisionId]
  );

  /* ------------------------------ loading ------------------------------- */

  const loadPlan = useCallback(
    async (planId: string) => {
      setLoadingPlan(true);
      setLoadError(null);
      try {
        const response = await api.get<{ plan: PlanDraft }>(`/api/manager/plans/${encodeURIComponent(planId)}`);
        const next = planStateFromDraft(response.plan);
        history.reset(next);
        savedSnapshot.current = JSON.stringify(planBodyOf(next));
        setSaving('idle');
        setSaveError(null);
        setChecked([]);
        setReview(null);
        setExportResult(null);
        setUncertain(false);
      } catch (error) {
        setLoadError(error);
      } finally {
        setLoadingPlan(false);
      }
    },
    [history]
  );

  useEffect(() => {
    if (selectedPlanId) void loadPlan(selectedPlanId);
    // A plan is opened once per selection; a re-render must not discard an in-progress edit.
  }, [selectedPlanId]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /* -------------------------------- save -------------------------------- */

  const applySavedPlan = useCallback(
    (plan: PlanDraft) => {
      const next = planStateFromDraft(plan);
      history.reset(next);
      savedSnapshot.current = JSON.stringify(planBodyOf(next));
      setSaving('saved');
      setSaveError(null);
      if (!selectedPlanId) setSelectedPlanId(plan.planId);
      queryCache.invalidate(['manager/plans']);
    },
    [history, selectedPlanId, setSelectedPlanId]
  );

  const saveNow = useCallback(async () => {
    if (saveInFlight.current) return;
    const current = stateRef.current;
    if (localPlanProblems(current).length) {
      setSaving('failed');
      return;
    }
    const body = planBodyOf(current);
    saveInFlight.current = true;
    setSaving('saving');
    setSaveError(null);
    try {
      if (!current.planId) {
        const outcome = await commitMutation(
          () =>
            api.post<{ plan: PlanDraft }>('/api/manager/plans', {
              ...body,
              idempotencyKey: createIdempotencyKey()
            }),
          ['manager/plans']
        );
        if (outcome.status === 'superseded') return;
        applySavedPlan(outcome.value.plan);
      } else {
        const outcome = await commitMutation(
          () =>
            api.patch<{ plan: PlanDraft }>(`/api/manager/plans/${encodeURIComponent(current.planId as string)}`, {
              ...body,
              revision: current.revision
            }),
          ['manager/plans']
        );
        if (outcome.status === 'superseded') return;
        applySavedPlan(outcome.value.plan);
      }
    } catch (error) {
      if (error instanceof ApiFailure && error.isConflict) setSaving('conflict');
      else if (error instanceof ApiFailure && ['NETWORK', 'INVALID_RESPONSE'].includes(error.code)) {
        setSaving('unknown');
      } else setSaving('failed');
      setSaveError(error);
    } finally {
      saveInFlight.current = false;
    }
  }, [applySavedPlan]);

  // Debounced, coalesced save of an existing plan. A brand-new plan is saved deliberately the
  // first time, so opening the screen never creates a row by itself.
  useEffect(() => {
    if (!state.planId || !dirty || problems.length) return undefined;
    if (saving === 'conflict' || saving === 'unknown') return undefined;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void saveNow();
    }, 1200);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    };
  }, [state, dirty, problems.length, saving, saveNow]);

  const startNewPlan = (): void => {
    const next = emptyPlanState(t('planning.untitled'), writableDivisions[0]?.divisionId ?? '');
    history.reset(next);
    savedSnapshot.current = JSON.stringify(planBodyOf(next));
    setSelectedPlanId(null);
    setSaving('idle');
    setSaveError(null);
    setChecked([]);
    setReview(null);
    setExportResult(null);
    setUncertain(false);
    setNotice('');
  };

  const change = (next: PlanState): void => {
    lastEdit.current = null;
    history.commit(next);
  };

  /**
   * A keystroke coalesces with the previous edit of the same field (within 800 ms), so undo returns
   * to the value before typing instead of stepping back one character at a time.
   */
  const lastEdit = useRef<{ key: string; at: number } | null>(null);
  const editItem = (itemId: string, patch: Partial<PlanItem>): void => {
    const key = `${itemId}:${Object.keys(patch).sort().join(',')}`;
    const now = Date.now();
    const next = updateItem(stateRef.current, itemId, patch);
    if (lastEdit.current?.key === key && now - lastEdit.current.at < 800) history.replace(next);
    else history.commit(next);
    lastEdit.current = { key, at: now };
  };

  /* ------------------------------ structure ----------------------------- */

  const addRootSubproject = (): void => {
    try {
      const result = addItem(state, { type: 'SUBPROJECT', parentItemId: null });
      change(result.state);
      setSelectedItemId(result.itemId);
    } catch (error) {
      setNotice((error as Error).message);
    }
  };

  const addDirectTask = (): void => {
    try {
      const result = addItem(state, { type: 'TASK', parentItemId: null });
      change(result.state);
      setSelectedItemId(result.itemId);
    } catch (error) {
      setNotice((error as Error).message);
    }
  };

  const addChild = (parent: PlanItem): void => {
    const type = parent.type === 'SUBPROJECT' ? 'TASK' : 'TASK';
    try {
      const result = addItem(state, { type, parentItemId: parent.itemId });
      change(result.state);
      setSelectedItemId(result.itemId);
      setCollapsed((current) => current.filter((id) => id !== parent.itemId));
    } catch (error) {
      setNotice((error as Error).message);
    }
  };

  const addNestedSubproject = (parent: PlanItem): void => {
    try {
      const result = addItem(state, { type: 'SUBPROJECT', parentItemId: parent.itemId });
      change(result.state);
      setSelectedItemId(result.itemId);
      setCollapsed((current) => current.filter((id) => id !== parent.itemId));
    } catch (error) {
      setNotice((error as Error).message);
    }
  };

  const deleteItem = (item: PlanItem): void => {
    const descendants = childCount(state, item.itemId);
    if (descendants > 0) {
      const confirmed = window.confirm(t('planning.confirmDeleteSubtree', { n: descendants }));
      if (!confirmed) return;
    }
    const result = removeSubtree(state, item.itemId);
    change(result.state);
    setChecked((current) => current.filter((id) => !result.removed.includes(id)));
    if (selectedItemId && result.removed.includes(selectedItemId)) setSelectedItemId(null);
  };

  const structural = (action: () => PlanState): void => {
    try {
      change(action());
    } catch (error) {
      setNotice((error as Error).message);
    }
  };

  /* ------------------------------- review ------------------------------- */

  const openReview = async (): Promise<void> => {
    const current = stateRef.current;
    if (!current.planId || dirty) {
      setNotice(t('planning.review.saveFirst'));
      return;
    }
    setReviewBusy(true);
    setReviewError(null);
    // One review dialog is one export attempt: a new attempt gets a new idempotency identity.
    exportAttempt.current = createIdempotencyKey();
    try {
      const response = await api.get<{ review: PlanReview }>(
        `/api/manager/plans/${encodeURIComponent(current.planId)}/review?revision=${current.revision}`
      );
      setReview(response.review);
    } catch (error) {
      setReviewError(error);
      setNotice(t('planning.review.unavailable'));
    } finally {
      setReviewBusy(false);
    }
  };

  const exportAttempt = useRef<string>(createIdempotencyKey());

  const runExport = async (): Promise<void> => {
    const current = stateRef.current;
    if (!current.planId || !review) return;
    setReviewBusy(true);
    setReviewError(null);
    setUncertain(false);
    try {
      const outcome = await commitMutation(
        () =>
          api.post<PlanExportResult>(`/api/manager/plans/${encodeURIComponent(current.planId as string)}/export`, {
            revision: current.revision,
            idempotencyKey: exportAttempt.current,
            reviewToken: review.reviewToken,
            confirmed: true
          }),
        ['manager/plans', 'manager/projects', 'manager/tasks', 'manager/task-index', 'work/projects', 'work/timeline']
      );
      if (outcome.status === 'superseded') return;
      setReview(null);
      plans.refresh();
      // Reload first: the plan is now EXPORTED, and the receipt must survive that reset.
      await loadPlan(current.planId);
      setExportResult(outcome.value);
    } catch (error) {
      if (error instanceof ApiFailure && ['NETWORK', 'INVALID_RESPONSE'].includes(error.code)) {
        setUncertain(true);
      }
      setReviewError(error);
    } finally {
      setReviewBusy(false);
    }
  };

  const retrieveReceipt = async (): Promise<void> => {
    const current = stateRef.current;
    if (!current.planId) return;
    setReviewBusy(true);
    try {
      const response = await api.get<PlanExportResult>(
        `/api/manager/plans/${encodeURIComponent(current.planId)}/exports`
      );
      setUncertain(false);
      setReview(null);
      await loadPlan(current.planId);
      setExportResult(response);
    } catch (error) {
      setReviewError(error);
    } finally {
      setReviewBusy(false);
    }
  };

  const archiveCurrent = async (): Promise<void> => {
    const current = stateRef.current;
    if (!current.planId) return;
    if (!window.confirm(t('planning.confirmArchive'))) return;
    try {
      await commitMutation(
        () =>
          api.post<{ plan: PlanDraft }>(`/api/manager/plans/${encodeURIComponent(current.planId as string)}/archive`, {
            revision: current.revision,
            confirmed: true
          }),
        ['manager/plans']
      );
      plans.refresh();
      await loadPlan(current.planId);
    } catch (error) {
      setSaveError(error);
      setSaving('failed');
    }
  };

  /* ------------------------------ rendering ----------------------------- */

  const planOptions = plans.data?.items ?? [];
  const canEdit = state.status === 'DRAFT';
  const title = t('planning.title');

  return (
    <div className="screen stack planning-screen">
      <h2>{title}</h2>
      <p className="muted small">{t('planning.intro')}</p>

      <Section
        title={t('planning.section.plan')}
        actions={
          <>
            <SaveState state={saving} />
            <button
              type="button"
              className="button"
              onClick={() => void saveNow()}
              disabled={!dirty || problems.length > 0 || saving === 'saving' || !canEdit}
            >
              {t('common.save')}
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={openReview}
              disabled={!state.planId || dirty || reviewBusy || state.status !== 'DRAFT'}
            >
              {t('planning.review.open')}
            </button>
            {state.planId && state.status !== 'ARCHIVED' ? (
              <button type="button" className="button secondary" onClick={() => void archiveCurrent()}>
                {t('planning.archive')}
              </button>
            ) : null}
          </>
        }
      >
        <div className="stack">
          <div className="compact-toolbar">
            <label className="field">
              <span className="field-label">{t('planning.plan')}</span>
              <select
                value={selectedPlanId ?? ''}
                onChange={(event) => setSelectedPlanId(event.target.value || null)}
              >
                <option value="">{t('planning.plan.newOption')}</option>
                {planOptions.map((entry) => (
                  <option key={entry.planId} value={entry.planId}>
                    {`${entry.title} · ${entry.status} · ${t('planning.itemCount', { n: entry.itemCount })}`}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="button secondary" onClick={startNewPlan}>
              {t('planning.new')}
            </button>
            <label className="field planning-title-field">
              <span className="field-label">
                {t('planning.planTitle')}
                <RequiredTag />
              </span>
              <input
                value={state.title}
                maxLength={PLAN_LIMITS.maxTitleLength}
                onChange={(event) => change({ ...state, title: event.target.value })}
                disabled={!canEdit}
              />
            </label>
            <span className="muted small">
              {state.planId
                ? state.status === 'EXPORTED'
                  ? t('planning.status.exported')
                  : state.status === 'ARCHIVED'
                    ? t('planning.status.archived')
                    : dirty
                      ? t('planning.unsaved')
                      : t('planning.saved', { revision: state.revision })
                : t('planning.localDraft')}
            </span>
            <div className="inline-actions">
              <button type="button" className="button secondary" onClick={history.undo} disabled={!history.canUndo}>
                {t('planning.undo')}
              </button>
              <button type="button" className="button secondary" onClick={history.redo} disabled={!history.canRedo}>
                {t('planning.redo')}
              </button>
            </div>
          </div>

          <div className="compact-toolbar">
            <label className="field">
              <span className="field-label">{t('planning.division')}</span>
              <select
                value={state.divisionId}
                onChange={(event) =>
                  change({
                    ...state,
                    divisionId: event.target.value,
                    responsibilityId: '',
                    projectOwnerId: '',
                    destinationProjectId: ''
                  })
                }
                disabled={!canEdit}
              >
                <option value="">{t('planning.choose')}</option>
                {writableDivisions.map((division) => (
                  <option key={division.divisionId} value={division.divisionId}>
                    {division.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">{t('planning.responsibility')}</span>
              <select
                value={state.responsibilityId}
                onChange={(event) => change({ ...state, responsibilityId: event.target.value })}
                disabled={!canEdit || state.destinationMode !== 'NEW_PROJECT'}
              >
                <option value="">{t('planning.choose')}</option>
                {responsibilitiesForDivision.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="field planning-radio">
              <legend className="field-label">{t('planning.destination')}</legend>
              <label className="checkbox">
                <input
                  type="radio"
                  name="planning-destination"
                  checked={state.destinationMode === 'NEW_PROJECT'}
                  onChange={() =>
                    change({ ...state, destinationMode: 'NEW_PROJECT', destinationProjectId: '' })
                  }
                  disabled={!canEdit}
                />
                {t('planning.destination.new')}
              </label>
              <label className="checkbox">
                <input
                  type="radio"
                  name="planning-destination"
                  checked={state.destinationMode === 'EXISTING_PROJECT'}
                  onChange={() => change({ ...state, destinationMode: 'EXISTING_PROJECT' })}
                  disabled={!canEdit}
                />
                {t('planning.destination.existing')}
              </label>
            </fieldset>
            {state.destinationMode === 'EXISTING_PROJECT' ? (
              <div className="field planning-project-field">
                <span className="field-label">{t('planning.project')}</span>
                <RemoteSelect
                  value={state.destinationProjectId}
                  optionsKey={`planning:projects:${state.divisionId}`}
                  onChange={(value) => change({ ...state, destinationProjectId: value })}
                  allowEmpty={t('planning.choose')}
                  searchLabel={t('picker.search')}
                  selectLabel={t('planning.project')}
                  disabled={!canEdit}
                  load={async ({ query, page }) => {
                    const result = await api.get<WorkProjectList>(
                      '/api/work/projects' +
                        queryString({
                          query,
                          page,
                          pageSize: 25,
                          divisionId: state.divisionId || undefined
                        })
                    );
                    return {
                      items: result.items.map((entry) => ({ value: entry.projectId, label: entry.projectName })),
                      total: result.total,
                      page: result.page,
                      totalPages: result.totalPages,
                      selected: state.destinationProjectId
                        ? { value: state.destinationProjectId, label: state.destinationProjectId }
                        : null
                    };
                  }}
                />
              </div>
            ) : (
              <>
                <label className="field">
                  <span className="field-label">{t('planning.visibility')}</span>
                  <select
                    value={state.dashboardVisibility}
                    onChange={(event) =>
                      change({ ...state, dashboardVisibility: event.target.value as 'INTERNAL' | 'RESTRICTED' })
                    }
                    disabled={!canEdit}
                  >
                    <option value="RESTRICTED">{t('planning.visibility.restricted')}</option>
                    <option value="INTERNAL">{t('planning.visibility.internal')}</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">{t('planning.owner')}</span>
                  <select
                    value={state.projectOwnerId}
                    onChange={(event) => change({ ...state, projectOwnerId: event.target.value })}
                    disabled={!canEdit}
                  >
                    <option value="">{t('planning.owner.default')}</option>
                    {membersForDivision.map((member) => (
                      <option key={member.memberId} value={member.memberId}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <fieldset className="field planning-radio">
              <legend className="field-label">{t('planning.scheduleMode')}</legend>
              <label className="checkbox">
                <input
                  type="radio"
                  name="planning-mode"
                  checked={state.scheduleMode === 'MANUAL'}
                  onChange={() => change({ ...state, scheduleMode: 'MANUAL' })}
                  disabled={!canEdit}
                />
                {t('planning.mode.manual')}
              </label>
              <label className="checkbox">
                <input
                  type="radio"
                  name="planning-mode"
                  checked={state.scheduleMode === 'DURATION'}
                  onChange={() => change({ ...state, scheduleMode: 'DURATION' })}
                  disabled={!canEdit}
                />
                {t('planning.mode.duration')}
              </label>
            </fieldset>
            <div className="inline-actions">
              <button type="button" className="button secondary" onClick={addRootSubproject} disabled={!canEdit}>
                {t('planning.add.subproject')}
              </button>
              <button type="button" className="button secondary" onClick={addDirectTask} disabled={!canEdit}>
                {t('planning.add.directTask')}
              </button>
            </div>
          </div>

          <div className="compact-toolbar planning-view-toolbar">
            <div className="segmented" role="group" aria-label={t('planning.scale')}>
              {(['day', 'week', 'month'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={scale === value ? 'segmented-button active' : 'segmented-button'}
                  aria-pressed={scale === value}
                  onClick={() => setScale(value)}
                >
                  {t(`planning.scale.${value}`)}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="button secondary"
              onClick={() => setViewFrom(shiftIsoDate(todayJst(), -3))}
            >
              {t('timeline.today')}
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                const range = planRange(state);
                if (range) setViewFrom(shiftIsoDate(range.from, -2));
              }}
              disabled={!planRange(state)}
            >
              {t('planning.fit')}
            </button>
            <button type="button" className="button secondary" onClick={() => setViewFrom(shiftIsoDate(viewFrom, -14))}>
              ‹
            </button>
            <button type="button" className="button secondary" onClick={() => setViewFrom(shiftIsoDate(viewFrom, 14))}>
              ›
            </button>
            <span className="muted small">
              {t('planning.itemCount', { n: state.items.length })}
              {planRange(state) ? ` · ${formatRange(state)}` : ''}
              {state.items.length >= PLAN_LIMITS.maxItems ? ` · ${t('planning.limitReached')}` : ''}
            </span>
          </div>

          {notice ? (
            <div className="banner warning" role="status">
              {notice}
              <button type="button" className="link-button" onClick={() => setNotice('')}>
                {t('common.close')}
              </button>
            </div>
          ) : null}
          {problems.length ? (
            <div className="banner warning" role="alert">
              <strong>{t('planning.localProblems')}</strong>
              <ul>
                {problems.slice(0, 8).map((problem, index) => (
                  <li key={`${problem.itemId ?? 'plan'}:${problem.field}:${index}`}>
                    {t(problem.messageKey)}
                    {problem.itemId ? ` · ${itemById(state, problem.itemId)?.name || problem.itemId}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <ErrorBox error={loadError ?? saveError} onRetry={selectedPlanId ? () => void loadPlan(selectedPlanId) : undefined} />
          {saving === 'conflict' ? (
            <div className="banner danger" role="alert">
              <strong>{t('planning.conflict.title')}</strong>
              <span>{t('planning.conflict.help')}</span>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  if (selectedPlanId) void loadPlan(selectedPlanId);
                }}
              >
                {t('planning.conflict.reload')}
              </button>
            </div>
          ) : null}
        </div>
      </Section>
      {/* The editor itself is rendered below. */}
      {loadingPlan ? <p className="muted">{t('state.loading')}</p> : null}
      {checked.length ? (
        <BulkAssignmentBar
          count={checked.length}
          members={membersForDivision}
          owner={bulkOwner}
          assignees={bulkAssignees}
          preview={bulkPreview}
          onOwner={(value) => {
            setBulkOwner(value);
            setBulkPreview(null);
          }}
          onAssignees={(value) => {
            setBulkAssignees(value);
            setBulkPreview(null);
          }}
          onPreview={() => {
            const owner = membersForDivision.find((member) => member.memberId === bulkOwner);
            const assigneeNames = membersForDivision
              .filter((member) => bulkAssignees.includes(member.memberId))
              .map((member) => member.name);
            setBulkPreview(
              t('planning.bulk.preview', {
                n: checked.length,
                owner: owner?.name ?? t('planning.bulk.keepOwner'),
                assignees: assigneeNames.length ? assigneeNames.join(', ') : t('planning.bulk.none')
              })
            );
          }}
          onApply={() => {
            change(
              assignItems(state, checked, {
                ownerMemberId: bulkOwner ? bulkOwner : undefined,
                assigneeIds: bulkAssignees
              })
            );
            setChecked([]);
            setBulkPreview(null);
          }}
          onClear={() => {
            setChecked([]);
            setBulkPreview(null);
          }}
        />
      ) : null}
      <PlanEditor
        state={state}
        rows={rows}
        scale={scale}
        viewFrom={viewFrom}
        collapsed={collapsed}
        selectedItemId={selectedItemId}
        checked={checked}
        members={membersForDivision}
        canEdit={canEdit}
        drag={drag}
        draw={draw}
        reorder={reorder}
        onSelect={(itemId) => setSelectedItemId(itemId)}
        onCheck={(itemId, value) =>
          setChecked((current) =>
            value ? [...new Set([...current, itemId])] : current.filter((id) => id !== itemId)
          )
        }
        onToggleCollapse={(itemId) =>
          setCollapsed((current) =>
            current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId]
          )
        }
        onPatch={editItem}
        onAddChild={addChild}
        onAddNestedSubproject={addNestedSubproject}
        onDelete={deleteItem}
        onMove={(itemId, direction) => structural(() => moveItem(stateRef.current, itemId, direction))}
        onIndent={(itemId) => structural(() => indentItem(stateRef.current, itemId))}
        onOutdent={(itemId) => structural(() => outdentItem(stateRef.current, itemId))}
        onReparent={(itemId, parentId) =>
          structural(() => reparentItem(stateRef.current, itemId, parentId))
        }
        onDragStart={(itemId, kind, pointerId, clientX) => {
          const item = itemById(stateRef.current, itemId);
          if (!item) return;
          const next = { itemId, kind, pointerId, startX: clientX, original: item, deltaDays: 0 };
          dragRef.current = next;
          setDrag(next);
        }}
        onDragMove={(clientX) => {
          const current = dragRef.current;
          if (!current) return;
          const deltaDays = Math.round((clientX - current.startX) / PIXELS_PER_DAY[scale]);
          if (deltaDays === current.deltaDays) return;
          const next = { ...current, deltaDays };
          dragRef.current = next;
          setDrag(next);
        }}
        onDragEnd={(commit) => {
          const current = dragRef.current;
          dragRef.current = null;
          setDrag(null);
          if (!current || !commit || current.deltaDays === 0) return;
          const patch = dragPatch(current.original, stateRef.current.scheduleMode, current.kind, current.deltaDays);
          if (Object.keys(patch).length) change(updateItem(stateRef.current, current.itemId, patch));
        }}
        onDrawStart={(rowParentId, anchorDate) => {
          const next = {
            rowKey: rowParentId ?? 'root',
            parentItemId: rowParentId,
            anchorDate,
            startDate: anchorDate,
            finishDate: anchorDate
          };
          drawRef.current = next;
          setDraw(next);
        }}
        onDrawMove={(date) => {
          const current = drawRef.current;
          if (!current) return;
          const next = {
            ...current,
            startDate: date < current.anchorDate ? date : current.anchorDate,
            finishDate: date < current.anchorDate ? current.anchorDate : date
          };
          drawRef.current = next;
          setDraw(next);
        }}
        onDrawEnd={(commit) => {
          const current = drawRef.current;
          drawRef.current = null;
          setDraw(null);
          if (!current || !commit) return;
          const result = addItem(stateRef.current, {
            type: 'TASK',
            parentItemId: current.parentItemId,
            startDate: current.startDate,
            finishDate: current.finishDate
          });
          change(result.state);
          setSelectedItemId(result.itemId);
        }}
        onReorderStart={(itemId, clientY) => {
          const item = itemById(stateRef.current, itemId);
          if (!item) return;
          const next = { itemId, parentItemId: item.parentItemId, targetIndex: item.order, y: clientY };
          reorderRef.current = next;
          setReorder(next);
        }}
        onReorderMove={(clientY) => {
          const current = reorderRef.current;
          if (!current) return;
          const siblings = siblingsOf(stateRef.current, current.parentItemId);
          const index = siblings.findIndex((entry) => entry.itemId === current.itemId);
          const delta = Math.round((clientY - current.y) / ROW_HEIGHT);
          const target = Math.max(0, Math.min(siblings.length - 1, index + delta));
          if (target === current.targetIndex) return;
          const next = { ...current, targetIndex: target };
          reorderRef.current = next;
          setReorder(next);
        }}
        onReorderEnd={(commit) => {
          const current = reorderRef.current;
          reorderRef.current = null;
          setReorder(null);
          if (!current || !commit) return;
          change(reorderItem(stateRef.current, current.itemId, current.targetIndex));
        }}
        onEscape={() => {
          dragRef.current = null;
          drawRef.current = null;
          reorderRef.current = null;
          setDrag(null);
          setDraw(null);
          setReorder(null);
        }}
      />

      {selectedItemId && itemById(state, selectedItemId) ? (
        <PlanItemDetails
          item={itemById(state, selectedItemId) as PlanItem}
          state={state}
          members={membersForDivision}
          canEdit={canEdit}
          onPatch={(patch) => editItem(selectedItemId, patch)}
          onReparent={(parentId) => structural(() => reparentItem(stateRef.current, selectedItemId, parentId))}
          onClose={() => setSelectedItemId(null)}
        />
      ) : null}

      {review ? (
        <ReviewDialog
          review={review}
          busy={reviewBusy}
          error={reviewError}
          uncertain={uncertain}
          onClose={() => {
            setReview(null);
            setReviewError(null);
            setUncertain(false);
            exportAttempt.current = createIdempotencyKey();
          }}
          onConfirm={() => void runExport()}
          onRetrieve={() => void retrieveReceipt()}
          onFocusItem={(itemId) => {
            setSelectedItemId(itemId);
            const row = document.querySelector<HTMLElement>(`[data-plan-item="${itemId}"]`);
            row?.scrollIntoView({ block: 'center' });
            row?.querySelector<HTMLElement>('input')?.focus();
          }}
        />
      ) : null}

      {exportResult ? (
        <Section title={t('planning.export.done')}>
          <p>{t('planning.export.counts', {
            subprojects: exportResult.receipt.counts.subprojects,
            tasks: exportResult.receipt.counts.tasks
          })}</p>
          <ul className="planning-links">
            {exportResult.receipt.created.projectId ? (
              <li>
                <a href={`#/project/${exportResult.receipt.created.projectId}`}>
                  {exportResult.receipt.destination.projectName}
                </a>
              </li>
            ) : (
              <li>
                <a href={`#/project/${exportResult.receipt.destination.projectId}`}>
                  {exportResult.receipt.destination.projectName}
                </a>
              </li>
            )}
            {exportResult.receipt.created.taskIds.slice(0, 20).map((taskId) => (
              <li key={taskId}>
                <a href={`#/task/${taskId}`}>{taskId}</a>
              </li>
            ))}
          </ul>
          <p className="muted small">{t('planning.export.historyNote')}</p>
        </Section>
      ) : null}

      {actor.role === 'ADMIN' || actor.role === 'MANAGER' ? null : (
        <p className="muted small">{t('planning.managerOnly')}</p>
      )}
    </div>
  );
}

/* ------------------------------- editor ---------------------------------- */

type PlanEditorProps = {
  state: PlanState;
  rows: ReturnType<typeof planRows>;
  scale: Scale;
  viewFrom: string;
  collapsed: string[];
  selectedItemId: string | null;
  checked: string[];
  members: ReferenceMember[];
  canEdit: boolean;
  drag: ItemDragState | null;
  draw: DrawState | null;
  reorder: ReorderState | null;
  onSelect: (itemId: string) => void;
  onCheck: (itemId: string, value: boolean) => void;
  onToggleCollapse: (itemId: string) => void;
  onPatch: (itemId: string, patch: Partial<PlanItem>) => void;
  onAddChild: (parent: PlanItem) => void;
  onAddNestedSubproject: (parent: PlanItem) => void;
  onDelete: (item: PlanItem) => void;
  onMove: (itemId: string, direction: -1 | 1) => void;
  onIndent: (itemId: string) => void;
  onOutdent: (itemId: string) => void;
  onReparent: (itemId: string, parentItemId: string | null) => void;
  onDragStart: (itemId: string, kind: DragKind, pointerId: number, clientX: number) => void;
  onDragMove: (clientX: number) => void;
  onDragEnd: (commit: boolean) => void;
  onDrawStart: (parentItemId: string | null, date: string) => void;
  onDrawMove: (date: string) => void;
  onDrawEnd: (commit: boolean) => void;
  onReorderStart: (itemId: string, clientY: number) => void;
  onReorderMove: (clientY: number) => void;
  onReorderEnd: (commit: boolean) => void;
  onEscape: () => void;
};

type PlanItemDetailsProps = {
  item: PlanItem;
  state: PlanState;
  members: ReferenceMember[];
  canEdit: boolean;
  onPatch: (patch: Partial<PlanItem>) => void;
  onReparent: (parentItemId: string | null) => void;
  onClose: () => void;
};

function PlanItemDetails(props: PlanItemDetailsProps): JSX.Element {
  const { t } = useI18n();
  const { item, state } = props;
  const schedule = resolvePlanItemSchedule(item, state.scheduleMode);
  const length =
    schedule.start && schedule.finish
      ? Math.round(
          (Date.parse(`${schedule.finish}T00:00:00Z`) - Date.parse(`${schedule.start}T00:00:00Z`)) / 86_400_000
        ) + 1
      : null;
  const rows = planRows(state);
  const excluded = new Set<string>([item.itemId]);
  let growing = true;
  while (growing) {
    growing = false;
    for (const entry of state.items) {
      if (entry.parentItemId && excluded.has(entry.parentItemId) && !excluded.has(entry.itemId)) {
        excluded.add(entry.itemId);
        growing = true;
      }
    }
  }
  const parents = rows.filter((row) => !excluded.has(row.item.itemId));

  return (
    <Section
      title={t('planning.details.title')}
      actions={
        <button type="button" className="link-button" onClick={props.onClose}>
          {t('common.close')}
        </button>
      }
    >
      <div className="compact-toolbar planning-details">
        <label className="field">
          <span className="field-label">{t('planning.itemName')}</span>
          <TextInput
            value={item.name}
            onChange={(value) => props.onPatch({ name: value })}
            disabled={!props.canEdit}
          />
        </label>
        <label className="field">
          <span className="field-label">{t('planning.start')}</span>
          <TextInput
            type="date"
            value={item.startDate ?? ''}
            onChange={(value) => props.onPatch({ startDate: value || null })}
            disabled={!props.canEdit || state.scheduleMode === 'DURATION'}
          />
        </label>
        <label className="field">
          <span className="field-label">{t('planning.finish')}</span>
          <TextInput
            type="date"
            value={item.finishDate ?? ''}
            onChange={(value) => props.onPatch({ finishDate: value || null })}
            disabled={!props.canEdit}
          />
        </label>
        {state.scheduleMode === 'DURATION' ? (
          <>
            <label className="field">
              <span className="field-label">{t('planning.duration')}</span>
              <TextInput
                type="number"
                value={item.durationValue === null ? '' : String(item.durationValue)}
                onChange={(value) => props.onPatch({ durationValue: value ? Number(value) : null })}
                disabled={!props.canEdit}
              />
            </label>
            <label className="field">
              <span className="field-label">{t('planning.durationUnit')}</span>
              <select
                value={item.durationUnit ?? 'DAY'}
                disabled={!props.canEdit}
                onChange={(event) => props.onPatch({ durationUnit: event.target.value as 'DAY' | 'WEEK' })}
              >
                <option value="DAY">{t('planning.unit.day')}</option>
                <option value="WEEK">{t('planning.unit.week')}</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">{t('planning.durationBasis')}</span>
              <select
                value={item.durationBasis ?? 'WORKING_DAYS'}
                disabled={!props.canEdit}
                onChange={(event) =>
                  props.onPatch({ durationBasis: event.target.value as 'WORKING_DAYS' | 'CALENDAR_DAYS' })
                }
              >
                <option value="WORKING_DAYS">{t('planning.basis.working')}</option>
                <option value="CALENDAR_DAYS">{t('planning.basis.calendar')}</option>
              </select>
            </label>
          </>
        ) : null}
        <label className="field">
          <span className="field-label">{t('planning.owner')}</span>
          <select
            value={item.ownerMemberId ?? ''}
            disabled={!props.canEdit}
            onChange={(event) => props.onPatch({ ownerMemberId: event.target.value || null })}
          >
            <option value="">{t('common.unset')}</option>
            {props.members.map((member) => (
              <option key={member.memberId} value={member.memberId}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t('planning.assignees')}</span>
          <select
            multiple
            size={4}
            value={item.assigneeIds}
            disabled={!props.canEdit}
            onChange={(event) =>
              props.onPatch({
                assigneeIds: [...event.target.options]
                  .filter((option) => option.selected)
                  .map((option) => option.value)
                  .filter((id) => id !== item.ownerMemberId)
              })
            }
          >
            {props.members
              .filter((member) => member.memberId !== item.ownerMemberId)
              .map((member) => (
                <option key={member.memberId} value={member.memberId}>
                  {member.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t('planning.move.to')}</span>
          <select
            value={item.parentItemId ?? ''}
            disabled={!props.canEdit}
            onChange={(event) => props.onReparent(event.target.value || null)}
          >
            <option value="">{t('planning.move.root')}</option>
            {parents.map((parent) => (
              <option key={parent.item.itemId} value={parent.item.itemId}>
                {parent.path.join(' / ')}
              </option>
            ))}
          </select>
        </label>
      </div>
      <dl className="planning-detail-facts">
        <div>
          <dt>{t('planning.details.resolvedStart')}</dt>
          <dd>
            {schedule.start ?? t('common.unset')}
            {schedule.startDerived ? ` · ${t('planning.derived')}` : ''}
          </dd>
        </div>
        <div>
          <dt>{t('planning.details.resolvedFinish')}</dt>
          <dd>{schedule.finish ?? t('common.unset')}</dd>
        </div>
        <div>
          <dt>{t('planning.details.length')}</dt>
          <dd>{length === null ? t('common.unset') : t('planning.details.days', { n: length })}</dd>
        </div>
        <div>
          <dt>{t('planning.details.exportTarget')}</dt>
          <dd>{item.type === 'SUBPROJECT' ? t('planning.export.subproject') : t('planning.export.task')}</dd>
        </div>
      </dl>
      {schedule.problems.length ? (
        <div className="banner warning" role="status">
          {schedule.problems.map((problem) => (
            <span key={problem} className="planning-problem">
              {t(`planning.problem.${problem}`)}
            </span>
          ))}
        </div>
      ) : null}
      <p className="muted small">{t('planning.details.mappingNote')}</p>
    </Section>
  );
}

type PlanRowViewProps = {
  row: PlanRow;
  item: PlanItem;
  scheduleMode: PlanScheduleMode;
  window: TimelineWindow;
  pixelsPerDay: number;
  todayOffset: number | null;
  children: number;
  collapsed: boolean;
  selected: boolean;
  checked: boolean;
  members: ReferenceMember[];
  canEdit: boolean;
  dragging: boolean;
  indicator: 'before' | 'after' | null;
  drawing: DrawState | null;
  colorProjectId: string | null;
  onSelect: () => void;
  onCheck: (value: boolean) => void;
  onToggleCollapse: () => void;
  onPatch: (patch: Partial<PlanItem>) => void;
  onAddChild: () => void;
  onAddNestedSubproject: () => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
  onIndent: () => void;
  onOutdent: () => void;
  onDragStart: (kind: DragKind, pointerId: number, clientX: number) => void;
  onDragMove: (clientX: number) => void;
  onDragEnd: (commit: boolean) => void;
  onDrawStart: (date: string) => void;
  onDrawMove: (date: string) => void;
  onDrawEnd: (commit: boolean) => void;
  onReorderStart: (clientY: number) => void;
  onReorderMove: (clientY: number) => void;
  onReorderEnd: (commit: boolean) => void;
};

function PlanRowView(props: PlanRowViewProps): JSX.Element {
  const { t } = useI18n();
  const { item, row, window, pixelsPerDay, scheduleMode, canEdit } = props;
  const schedule = resolvePlanItemSchedule(item, scheduleMode);
  const span =
    schedule.start && schedule.finish && schedule.start <= schedule.finish
      ? spanOf(schedule.start, schedule.finish, window, pixelsPerDay)
      : null;
  const drawingSpan = props.drawing
    ? spanOf(props.drawing.startDate, props.drawing.finishDate, window, pixelsPerDay)
    : null;
  const colorStyle = props.colorProjectId ? projectColorVars(props.colorProjectId) : undefined;
  const reorderPointer = useRef<number | null>(null);
  const drawPointer = useRef<number | null>(null);
  const hasProblem = schedule.problems.length > 0;

  return (
    <div
      className={[
        'pb-row',
        props.selected ? 'selected' : '',
        props.dragging ? 'dragging' : '',
        props.indicator ? `drop-${props.indicator}` : ''
      ]
        .filter(Boolean)
        .join(' ')}
      role="row"
      data-plan-item={item.itemId}
      aria-selected={props.selected}
    >
      <div
        className="pb-cell-name"
        style={{ paddingLeft: (row.depth - 1) * 14 }}
        onFocus={props.onSelect}
      >
        <input
          type="checkbox"
          checked={props.checked}
          aria-label={t('planning.selectRow', { name: item.name || t('planning.unnamed') })}
          onChange={(event) => props.onCheck(event.target.checked)}
        />
        <button
          type="button"
          className="pb-handle"
          aria-label={t('planning.reorder')}
          title={t('planning.reorder')}
          onPointerDown={(event) => {
            if (!canEdit) return;
            event.preventDefault();
            reorderPointer.current = event.pointerId;
            capturePointer(event.currentTarget, event.pointerId);
            props.onReorderStart(event.clientY);
          }}
          onPointerMove={(event) => {
            if (reorderPointer.current === event.pointerId) props.onReorderMove(event.clientY);
          }}
          onPointerUp={(event) => {
            if (reorderPointer.current !== event.pointerId) return;
            reorderPointer.current = null;
            props.onReorderEnd(true);
          }}
          onPointerCancel={() => {
            reorderPointer.current = null;
            props.onReorderEnd(false);
          }}
        >
          ⋮⋮
        </button>
        {props.children > 0 ? (
          <button
            type="button"
            className="pb-toggle"
            aria-expanded={!props.collapsed}
            aria-label={
              props.collapsed
                ? t('hierarchy.expand', { name: item.name || t('planning.unnamed') })
                : t('hierarchy.collapse', { name: item.name || t('planning.unnamed') })
            }
            onClick={props.onToggleCollapse}
          >
            {props.collapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span className="pb-toggle-spacer" aria-hidden="true" />
        )}
        <span className={`pb-type ${item.type === 'SUBPROJECT' ? 'sub' : 'task'}`} aria-hidden="true">
          {item.type === 'SUBPROJECT' ? 'S' : 'T'}
        </span>
        <input
          className="pb-name"
          value={item.name}
          maxLength={PLAN_LIMITS.maxNameLength}
          aria-label={t('planning.itemName')}
          placeholder={t('planning.namePlaceholder')}
          onChange={(event) => props.onPatch({ name: event.target.value })}
          disabled={!canEdit}
        />
        <input
          className="pb-date"
          type="date"
          value={item.startDate ?? ''}
          aria-label={t('planning.start')}
          disabled={!canEdit || scheduleMode === 'DURATION'}
          onChange={(event) => props.onPatch({ startDate: event.target.value || null })}
        />
        <input
          className="pb-date"
          type="date"
          value={item.finishDate ?? ''}
          aria-label={t('planning.finish')}
          disabled={!canEdit}
          onChange={(event) => props.onPatch({ finishDate: event.target.value || null })}
        />
        {scheduleMode === 'DURATION' ? (
          <input
            className="pb-duration"
            type="number"
            min={1}
            max={10000}
            value={item.durationValue ?? ''}
            aria-label={t('planning.duration')}
            disabled={!canEdit}
            onChange={(event) =>
              props.onPatch({ durationValue: event.target.value ? Number(event.target.value) : null })
            }
          />
        ) : null}
        <select
          className="pb-owner"
          value={item.ownerMemberId ?? ''}
          aria-label={t('planning.owner')}
          disabled={!canEdit}
          onChange={(event) => props.onPatch({ ownerMemberId: event.target.value || null })}
        >
          <option value="">{t('common.unset')}</option>
          {props.members.map((member) => (
            <option key={member.memberId} value={member.memberId}>
              {member.name}
            </option>
          ))}
        </select>
        {item.assigneeIds.length ? (
          <span
            className="pb-assignees"
            title={item.assigneeIds
              .map((id) => props.members.find((member) => member.memberId === id)?.name ?? id)
              .join(', ')}
          >
            +{item.assigneeIds.length}
          </span>
        ) : null}
        {hasProblem || props.dragging ? (
          <Badge tone={hasProblem ? 'danger' : 'info'}>
            {hasProblem ? t('planning.invalid') : t('planning.dragging')}
          </Badge>
        ) : null}
        <Menu
          label="⋯"
          ariaLabel={t('planning.rowActions', { name: item.name || t('planning.unnamed') })}
          className="pb-row-menu"
        >
          {(close) => (
            <>
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  close();
                  props.onAddChild();
                }}
              >
                {t('planning.add.child')}
              </button>
              {item.type === 'SUBPROJECT' ? (
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    close();
                    props.onAddNestedSubproject();
                  }}
                >
                  {t('planning.add.nestedSubproject')}
                </button>
              ) : null}
              <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); props.onMove(-1); }}>
                {t('planning.move.up')}
              </button>
              <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); props.onMove(1); }}>
                {t('planning.move.down')}
              </button>
              <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); props.onIndent(); }}>
                {t('planning.move.indent')}
              </button>
              <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); props.onOutdent(); }}>
                {t('planning.move.outdent')}
              </button>
              <button
                type="button"
                role="menuitem"
                className="menu-item danger"
                onClick={() => {
                  close();
                  props.onDelete();
                }}
              >
                {t('planning.remove')}
              </button>
            </>
          )}
        </Menu>
      </div>

      <div
        className="pb-cell-track"
        onPointerDown={(event) => {
          if (!canEdit || event.target !== event.currentTarget) return;
          const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
          const date = pixelToDate(event.clientX - rect.left, window, pixelsPerDay);
          if (!date) return;
          drawPointer.current = event.pointerId;
          capturePointer(event.currentTarget, event.pointerId);
          props.onDrawStart(date);
        }}
        onPointerMove={(event) => {
          if (drawPointer.current !== event.pointerId) return;
          const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
          const date = pixelToDate(event.clientX - rect.left, window, pixelsPerDay);
          if (date) props.onDrawMove(date);
        }}
        onPointerUp={(event) => {
          if (drawPointer.current !== event.pointerId) return;
          drawPointer.current = null;
          props.onDrawEnd(true);
        }}
        onPointerCancel={() => {
          drawPointer.current = null;
          props.onDrawEnd(false);
        }}
      >
        {props.todayOffset !== null && props.todayOffset >= 0 ? (
          <span className="pb-today-line" style={{ left: props.todayOffset }} aria-hidden="true" />
        ) : null}
        {drawingSpan ? (
          <span
            className="pb-draw"
            style={{ left: drawingSpan.left, width: Math.max(4, drawingSpan.width) }}
            aria-hidden="true"
          />
        ) : null}
        {span ? (
          <div
            className={`pb-bar${props.dragging ? ' dragging' : ''}${hasProblem ? ' invalid' : ''}`}
            style={{ left: span.left, width: Math.max(10, span.width), ...colorStyle }}
            title={item.name || t('planning.unnamed')}
            onPointerDown={(event) => {
              if (!canEdit) return;
              event.preventDefault();
              event.stopPropagation();
              capturePointer(event.currentTarget, event.pointerId);
              props.onDragStart('move', event.pointerId, event.clientX);
            }}
            onPointerMove={(event) => {
              if (!props.dragging) return;
              event.stopPropagation();
              props.onDragMove(event.clientX);
            }}
            onPointerUp={(event) => {
              if (!props.dragging) return;
              event.stopPropagation();
              props.onDragEnd(true);
            }}
            onPointerCancel={(event) => {
              if (!props.dragging) return;
              event.stopPropagation();
              props.onDragEnd(false);
            }}
          >
            {canEdit ? (
              <span
                className="pb-bar-handle start"
                role="separator"
                aria-label={t('planning.resizeStart')}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  capturePointer(event.currentTarget.parentElement, event.pointerId);
                  props.onDragStart('resize-start', event.pointerId, event.clientX);
                }}
              />
            ) : null}
            <span className="pb-bar-label">{item.name || t('planning.unnamed')}</span>
            {canEdit ? (
              <span
                className="pb-bar-handle end"
                role="separator"
                aria-label={t('planning.resizeFinish')}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  capturePointer(event.currentTarget.parentElement, event.pointerId);
                  props.onDragStart('resize-finish', event.pointerId, event.clientX);
                }}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

type BulkAssignmentBarProps = {
  count: number;
  members: ReferenceMember[];
  owner: string;
  assignees: string[];
  preview: string | null;
  onOwner: (value: string) => void;
  onAssignees: (value: string[]) => void;
  onPreview: () => void;
  onApply: () => void;
  onClear: () => void;
};

function BulkAssignmentBar(props: BulkAssignmentBarProps): JSX.Element {
  const { t } = useI18n();
  return (
    <section className="card planning-bulk" aria-label={t('planning.bulk.title')}>
      <h3>{t('planning.bulk.title')}</h3>
      <div className="compact-toolbar">
        <label className="field">
          <span className="field-label">{t('planning.owner')}</span>
          <select value={props.owner} onChange={(event) => props.onOwner(event.target.value)}>
            <option value="">{t('planning.bulk.keepOwner')}</option>
            {props.members.map((member) => (
              <option key={member.memberId} value={member.memberId}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t('planning.assignees')}</span>
          <select
            multiple
            size={4}
            value={props.assignees}
            onChange={(event) =>
              props.onAssignees([...event.target.options].filter((option) => option.selected).map((option) => option.value))
            }
          >
            {props.members
              .filter((member) => member.memberId !== props.owner)
              .map((member) => (
                <option key={member.memberId} value={member.memberId}>
                  {member.name}
                </option>
              ))}
          </select>
        </label>
        <div className="stack">
          <button type="button" className="button secondary" onClick={props.onPreview}>
            {t('planning.bulk.previewAction')}
          </button>
          <button type="button" className="button" onClick={props.onApply}>
            {t('planning.bulk.apply', { n: props.count })}
          </button>
          <button type="button" className="link-button" onClick={props.onClear}>
            {t('planning.bulk.clear')}
          </button>
        </div>
      </div>
      {props.preview ? <p className="banner info">{props.preview}</p> : null}
    </section>
  );
}

type ReviewDialogProps = {
  review: PlanReview;
  busy: boolean;
  error: unknown;
  uncertain: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onRetrieve: () => void;
  onFocusItem: (itemId: string) => void;
};

function ReviewDialog(props: ReviewDialogProps): JSX.Element {
  const { t } = useI18n();
  const { review } = props;
  return (
    <Modal
      title={t('planning.review.title')}
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className="button secondary" onClick={props.onClose} disabled={props.busy}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="button"
            onClick={props.onConfirm}
            disabled={props.busy || review.errors.length > 0 || props.uncertain}
          >
            {props.busy ? t('state.processing') : t('planning.review.create')}
          </button>
        </>
      }
    >
      <div className="stack planning-review">
        <dl className="planning-review-summary">
          <div>
            <dt>{t('planning.review.destination')}</dt>
            <dd>
              {review.destination.mode === 'NEW_PROJECT'
                ? t('planning.destination.new')
                : t('planning.destination.existing')}
              {' · '}
              {review.destination.projectName || t('planning.unnamed')}
            </dd>
          </div>
          <div>
            <dt>{t('planning.division')}</dt>
            <dd>{review.destination.divisionName || t('common.unset')}</dd>
          </div>
          <div>
            <dt>{t('planning.responsibility')}</dt>
            <dd>{review.destination.responsibilityName || t('common.unset')}</dd>
          </div>
          <div>
            <dt>{t('planning.visibility')}</dt>
            <dd>{review.destination.visibility}</dd>
          </div>
          <div>
            <dt>{t('planning.scheduleMode')}</dt>
            <dd>{review.scheduleMode === 'DURATION' ? t('planning.mode.duration') : t('planning.mode.manual')}</dd>
          </div>
        </dl>
        <p>
          {t('planning.review.counts', {
            subprojects: review.counts.subprojects,
            tasks: review.counts.tasks,
            undated: review.counts.undated,
            unassigned: review.counts.unassigned
          })}
        </p>
        {review.errors.length ? (
          <div className="banner danger" role="alert">
            <strong>{t('planning.review.errors', { n: review.errors.length })}</strong>
            <ul>
              {review.errors.slice(0, 40).map((issue, index) => (
                <li key={`${issue.itemId ?? 'plan'}:${issue.code}:${index}`}>
                  {issue.itemId ? (
                    <button type="button" className="link-button" onClick={() => props.onFocusItem(issue.itemId as string)}>
                      {issue.message}
                    </button>
                  ) : (
                    issue.message
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="banner ok" role="status">
            {t('planning.review.ready')}
          </div>
        )}
        {review.warnings.length ? (
          <details className="disclosure">
            <summary>{t('planning.review.warnings', { n: review.warnings.length })}</summary>
            <ul className="disclosure-body">
              {review.warnings.map((warning, index) => (
                <li key={`${warning.itemId ?? 'plan'}:${warning.code}:${index}`}>{warning.message}</li>
              ))}
            </ul>
          </details>
        ) : null}
        <table className="table planning-review-table">
          <thead>
            <tr>
              <th>{t('planning.column.name')}</th>
              <th>{t('planning.start')}</th>
              <th>{t('planning.finish')}</th>
              <th>{t('planning.owner')}</th>
              <th>{t('planning.assignees')}</th>
              <th>{t('planning.review.target')}</th>
            </tr>
          </thead>
          <tbody>
            {review.items.map((item) => (
              <tr key={item.itemId}>
                <td>
                  <span style={{ paddingLeft: (item.depth - 1) * 12 }}>{item.path.join(' / ') || t('planning.unnamed')}</span>
                </td>
                <td>
                  {item.startDate ?? t('common.unset')}
                  {item.startDerived ? <span className="muted small"> · {t('planning.derived')}</span> : null}
                </td>
                <td>{item.finishDate ?? t('common.unset')}</td>
                <td>{item.ownerName || t('common.unset')}</td>
                <td>{item.assigneeNames.length ? item.assigneeNames.join(', ') : t('common.none')}</td>
                <td>{item.exportTarget === 'SUBPROJECT' ? t('planning.export.subproject') : t('planning.export.task')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">{t('planning.review.mapping')}</p>
        {props.uncertain ? (
          <div className="banner warning" role="alert">
            <strong>{t('planning.review.uncertain')}</strong>
            <button type="button" className="link-button" onClick={props.onRetrieve} disabled={props.busy}>
              {t('planning.review.retrieve')}
            </button>
          </div>
        ) : null}
        <ErrorBox error={props.error} />
      </div>
    </Modal>
  );
}

function PlanEditor(props: PlanEditorProps): JSX.Element {
  const { t, language } = useI18n();
  const locale = language === 'ja' ? 'ja-JP' : 'en-US';
  const { state, rows, scale, drag, draw, reorder } = props;
  const [trackWidth, setTrackWidth] = useState(0);
  const [nameWidth, setNameWidth] = useState(620);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const observerRef = useRef<ResizeObserver | null>(null);
  const trackRef = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setTrackWidth((current) => (Math.abs(current - width) > 1 ? width : current));
    });
    observer.observe(element);
    observerRef.current = observer;
    setTrackWidth(element.getBoundingClientRect().width);
  }, []);

  const pixelsPerDay = PIXELS_PER_DAY[scale];
  const days = Math.max(7, Math.min(400, Math.floor((trackWidth || 800) / pixelsPerDay)));
  const window: TimelineWindow =
    windowOf(props.viewFrom, shiftIsoDate(props.viewFrom, days - 1)) ??
    (windowOf(todayJst(), shiftIsoDate(todayJst(), 13)) as TimelineWindow);
  const todayOffset = (() => {
    const start = parseDate(window.from);
    const day = parseDate(todayJst());
    return start === null || day === null ? null : dayDiff(start, day) * pixelsPerDay;
  })();

  const collapsedSet = useMemo(() => new Set(props.collapsed), [props.collapsed]);
  const visibleRows = useMemo(() => {
    const byId = new Map(state.items.map((item) => [item.itemId, item]));
    const hidden = new Set<string>();
    for (const row of rows) {
      let parentId = row.item.parentItemId;
      let guard = 0;
      let hiddenByAncestor = false;
      while (parentId && guard < 32) {
        if (collapsedSet.has(parentId)) {
          hiddenByAncestor = true;
          break;
        }
        parentId = byId.get(parentId)?.parentItemId ?? null;
        guard += 1;
      }
      if (hiddenByAncestor) hidden.add(row.item.itemId);
    }
    return rows.filter((row) => !hidden.has(row.item.itemId));
  }, [rows, state.items, collapsedSet]);

  useEffect(() => {
    if (!drag && !draw && !reorder) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      props.onEscape();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [drag, draw, reorder, props]);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  const resize = (clientX: number): void => {
    if (!splitRef.current) return;
    const next = Math.max(320, Math.min(980, splitRef.current.startWidth + (clientX - splitRef.current.startX)));
    setNameWidth(next);
  };

  const maybeScroll = (clientY: number): void => {
    const container = scrollerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (clientY < rect.top + 28) container.scrollTop -= 18;
    else if (clientY > rect.bottom - 28) container.scrollTop += 18;
  };

  const indicators = new Map<string, 'before' | 'after'>();
  if (reorder) {
    const siblings = siblingsOf(state, reorder.parentItemId);
    const target = siblings[reorder.targetIndex];
    if (target) indicators.set(target.itemId, 'before');
    else {
      const last = siblings[siblings.length - 1];
      if (last) indicators.set(last.itemId, 'after');
    }
  }

  const ticks = trackWidth > 0 ? axisTicks(window, trackWidth, locale) : [];

  return (
    <div
      className="pb-scroller"
      ref={scrollerRef}
      style={{ ['--pb-name-width' as string]: `${nameWidth}px` }}
      role="table"
      aria-label={t('planning.tableLabel')}
      tabIndex={0}
    >
      <div className="pb-row pb-head" role="row">
        <div className="pb-cell-name" role="columnheader">
          <span>{t('planning.column.name')}</span>
          <span className="muted small">{t('planning.column.startFinish')}</span>
          <span
            className="pb-splitter"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('planning.resizeColumns')}
            tabIndex={0}
            onPointerDown={(event) => {
              splitRef.current = { startX: event.clientX, startWidth: nameWidth };
              capturePointer(event.currentTarget, event.pointerId);
            }}
            onPointerMove={(event) => {
              if (splitRef.current) resize(event.clientX);
            }}
            onPointerUp={() => {
              splitRef.current = null;
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') setNameWidth((value) => Math.max(320, value - 20));
              if (event.key === 'ArrowRight') setNameWidth((value) => Math.min(980, value + 20));
            }}
          />
        </div>
        <div ref={trackRef} className="pb-cell-track pb-axis" role="columnheader">
          {trackWidth <= 0 ? <span className="muted small">{t('timeline.measuring')}</span> : null}
          {ticks.map((tick) => (
            <span
              key={tick.key}
              className={`pb-tick${tick.weekend ? ' weekend' : ''}${tick.major ? ' major' : ''}`}
              style={{ left: tick.left }}
            >
              {tick.label}
            </span>
          ))}
          {todayOffset !== null && todayOffset >= 0 && todayOffset < trackWidth ? (
            <span className="pb-today-label" style={{ left: todayOffset }}>
              {t('timeline.today')}
            </span>
          ) : null}
        </div>
      </div>

      {visibleRows.length === 0 ? (
        <EmptyState text={t('planning.empty')} />
      ) : (
        visibleRows.map((row) => {
          const previewItem =
            drag && drag.itemId === row.item.itemId
              ? { ...drag.original, ...dragPatch(drag.original, state.scheduleMode, drag.kind, drag.deltaDays) }
              : row.item;
          const drawing = draw && draw.rowKey === (row.item.itemId ?? 'root') ? draw : null;
          return (
            <PlanRowView
              key={row.item.itemId}
              row={row}
              item={previewItem}
              scheduleMode={state.scheduleMode}
              window={window}
              pixelsPerDay={pixelsPerDay}
              todayOffset={todayOffset}
              children={props.state.items.filter((entry) => entry.parentItemId === row.item.itemId).length}
              collapsed={collapsedSet.has(row.item.itemId)}
              selected={props.selectedItemId === row.item.itemId}
              checked={props.checked.includes(row.item.itemId)}
              members={props.members}
              canEdit={props.canEdit}
              colorProjectId={state.destinationProjectId || null}
              dragging={drag?.itemId === row.item.itemId}
              indicator={indicators.get(row.item.itemId) ?? null}
              drawing={drawing}
              onSelect={() => props.onSelect(row.item.itemId)}
              onCheck={(value) => props.onCheck(row.item.itemId, value)}
              onToggleCollapse={() => props.onToggleCollapse(row.item.itemId)}
              onPatch={(patch) => props.onPatch(row.item.itemId, patch)}
              onAddChild={() => (row.item.type === 'SUBPROJECT' ? props.onAddChild(row.item) : props.onAddChild(row.item))}
              onAddNestedSubproject={() => props.onAddNestedSubproject(row.item)}
              onDelete={() => props.onDelete(row.item)}
              onMove={(direction) => props.onMove(row.item.itemId, direction)}
              onIndent={() => props.onIndent(row.item.itemId)}
              onOutdent={() => props.onOutdent(row.item.itemId)}
              onDragStart={(kind, pointerId, clientX) => props.onDragStart(row.item.itemId, kind, pointerId, clientX)}
              onDragMove={(clientX) => {
                // Edge auto-scrolling keeps a drag usable when the plan is wider than the viewport.
                const container = scrollerRef.current;
                if (container) {
                  const rect = container.getBoundingClientRect();
                  if (clientX < rect.left + 40) container.scrollLeft -= 14;
                  else if (clientX > rect.right - 40) container.scrollLeft += 14;
                }
                props.onDragMove(clientX);
              }}
              onDragEnd={(commit) => props.onDragEnd(commit)}
              onDrawStart={(date) =>
                props.onDrawStart(row.item.type === 'SUBPROJECT' ? row.item.itemId : row.item.parentItemId, date)
              }
              onDrawMove={(date) => props.onDrawMove(date)}
              onDrawEnd={(commit) => props.onDrawEnd(commit)}
              onReorderStart={(clientY) => props.onReorderStart(row.item.itemId, clientY)}
              onReorderMove={(clientY) => {
                maybeScroll(clientY);
                props.onReorderMove(clientY);
              }}
              onReorderEnd={(commit) => props.onReorderEnd(commit)}
            />
          );
        })
      )}
    </div>
  );
}


