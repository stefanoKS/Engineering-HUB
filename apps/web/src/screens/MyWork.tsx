/**
 * My Assigned Work: 自分の担当タスク.
 *
 * The list is always the signed-in member's own work, resolved on the server from the verified
 * session - never from a name, an employee number or a task owner sent by the browser. A manager
 * keeps this personal list beside the departmental one; a MEMBER, a MANAGER and an ADMIN report
 * completion here (a VIEWER sees the same list read-only).
 */
import { useEffect, useState } from 'react';
import type {
  Actor,
  MemberRequest,
  MemberRequests,
  MyWorkList,
  MyWorkProjectFilter,
  MyWorkProjectOptions
} from '@eh/contracts';
import { api, queryString } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { Badge, DataFreshness, ErrorBox, Menu } from '../components/ui';
import { DeadlineCell } from '../components/deadline';
import { TaskStatusBadge, WorkflowHint } from '../components/task-status';
import { MemberSubprojectForm } from '../components/member-subproject-form';
import { MemberTaskForm } from '../components/member-task-form';
import { RequestDialog } from '../components/request-dialog';
import { ConfirmDialog, RemoteSelect, useSave } from '../components/forms';
import { capabilitiesOf } from '../state/capabilities';
import { useRouteMemoryState } from '../state/navigation';

const PAGE_SIZE = 25;

type CreationTab = 'none' | 'task' | 'subproject';

export function MyWorkScreen({ actor }: { actor: Actor }): JSX.Element {
  const { t } = useI18n();
  const [page, setPage] = useRouteMemoryState('my-work:active-page', 1);
  const [completedPage, setCompletedPage] = useRouteMemoryState('my-work:completed-page', 1);
  const [completedExpanded, setCompletedExpanded] = useRouteMemoryState('my-work:completed-expanded', false);
  // Filters live in route memory only: a filter is never persisted in the browser.
  // The visible input starts from the remembered applied query, so returning from a task detail
  // restores the search box instead of clearing the results it describes.
  const [query, setQuery] = useRouteMemoryState('my-work:query', '');
  const [search, setSearch] = useState(query);
  const [projectId, setProjectId] = useRouteMemoryState('my-work:project', '');
  const [overdue, setOverdue] = useRouteMemoryState('my-work:overdue', false);
  const [dueThisWeek, setDueThisWeek] = useRouteMemoryState('my-work:due-this-week', false);
  const [awaitingReview, setAwaitingReview] = useRouteMemoryState('my-work:awaiting-review', false);
  const capabilities = capabilitiesOf(actor);
  const canCreate = capabilities.canCreateTask;

  // A debounced search change resets both sections: a page number from the previous result set
  // never addresses the new one.
  useEffect(() => {
    if (search === query) return undefined;
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
      setCompletedPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, query, setQuery, setPage, setCompletedPage]);

  const filterParams = {
    query: query || undefined,
    projectId: projectId || undefined,
    overdue: overdue ? 'true' : undefined,
    dueThisWeek: dueThisWeek ? 'true' : undefined,
    awaitingReview: awaitingReview ? 'true' : undefined
  };
  const filterKey = JSON.stringify(filterParams);
  const filterQuery = Object.entries(filterParams)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');
  const filtersActive = !!filterQuery;
  const resetFilters = (): void => {
    setSearch('');
    setQuery('');
    setProjectId('');
    setOverdue(false);
    setDueThisWeek(false);
    setAwaitingReview(false);
    setPage(1);
    setCompletedPage(1);
  };

  const [createTab, setCreateTab] = useState<CreationTab>('none');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warning' | 'danger'; text: string } | null>(null);
  const [createdSubproject, setCreatedSubproject] = useState<{
    projectId: string;
    subprojectId: string;
    name: string;
  } | null>(null);

  const list = useQuery<MyWorkList>(`${keys.myWork}:${page}:${filterKey}`, () =>
    api.get<MyWorkList>(`/api/employee/my-work?page=${page}&section=active${filterQuery ? `&${filterQuery}` : ''}`)
  );
  const completed = useQuery<MyWorkList>(
    `${keys.myWork}:completed:${completedPage}:${completedExpanded}:${filterKey}`,
    () =>
      completedExpanded
        ? api.get<MyWorkList>(
            `/api/employee/my-work?page=${completedPage}&section=completed${filterQuery ? `&${filterQuery}` : ''}`
          )
        : Promise.resolve({
            items: [],
            total: 0,
            activeTotal: list.data?.activeTotal ?? 0,
            completedTotal: list.data?.completedTotal ?? 0,
            unfilteredActiveTotal: list.data?.unfilteredActiveTotal ?? 0
          })
  );
  const projects = useQuery<MyWorkProjectOptions>(keys.myProjects, () =>
    canCreate
      ? api.get<MyWorkProjectOptions>('/api/employee/my-work/projects')
      : Promise.resolve({ items: [], taskCreationEnabled: false })
  );
  const requests = useQuery<MemberRequests>(keys.myRequests, () =>
    api.get<MemberRequests>('/api/employee/requests/mine')
  );

  const refreshAll = (): void => {
    queryCache.invalidate([keys.myWork, keys.myRequests]);
  };

  // A new subproject or task changes the hierarchy every screen shows, so the member-visible
  // project payloads and the overview aggregates are invalidated as well as the options this
  // dialog selects from.
  const refreshAfterCreation = (): void => {
    queryCache.invalidate([
      keys.myWork,
      keys.myProjects,
      keys.myRequests,
      keys.workOverview,
      'work/projects',
      'work/project/',
      'manager/projects',
      'manager/overview'
    ]);
  };

  const total = list.data?.activeTotal ?? 0;
  const completedTotal = list.data?.completedTotal ?? 0;
  const unfilteredTotal = list.data?.unfilteredActiveTotal ?? total;
  const items = list.data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canReport = capabilities.canSubmitCompletionRequest || capabilities.canSubmitExtensionRequest;
  // Only the filters hidden behind the disclosure are counted: a visible search box and the
  // project selector already describe themselves.
  const hiddenFilterCount = [overdue, dueThisWeek, awaitingReview].filter(Boolean).length;
  const activeFilterLabels = [
    overdue ? t('myWork.filter.overdue') : '',
    dueThisWeek ? t('myWork.filter.dueThisWeek') : '',
    awaitingReview ? t('myWork.filter.awaitingReview') : ''
  ].filter(Boolean);

  return (
    <div className="screen stack">
      <div className="page-heading">
        <h2>{t('local.myWork')}</h2>
        <span className="page-count">{t('myWork.total', { n: total })}</span>
        <details className="disclosure usage-help">
          <summary>{t('myWork.help')}</summary>
          <div className="disclosure-body">
            <p className="muted small">{canCreate ? t('myWork.intro') : t('myWork.derivedNote')}</p>
            <p className="muted small">{canCreate ? t('myWork.memberOnlyCreate') : t('myWork.managerNote')}</p>
            {items.some((item) => item.creationChannel === 'MEMBER') ? (
              <p className="muted small">{t('myWork.adminApprovalNote')}</p>
            ) : null}
            <DataFreshness snapshot={false} />
          </div>
        </details>
      </div>

      {requests.data && !requests.data.submissionEnabled && canReport ? (
        <div className="banner warning">
          <strong>{t('myWork.requestsClosed')}</strong>
          <p className="muted small">{t('myWork.requestsClosedHint')}</p>
        </div>
      ) : null}

      {notice ? (
        <div className={`banner ${notice.tone}`} role={notice.tone === 'danger' ? 'alert' : 'status'}>
          {notice.text}
        </div>
      ) : null}

      {canCreate && createTab === 'task' ? (
        <MemberTaskForm
          projects={projects.data?.items ?? []}
          loading={projects.loading}
          initialProjectId={createdSubproject?.projectId ?? ''}
          initialSubprojectId={createdSubproject?.subprojectId ?? ''}
          onClose={() => setCreateTab('none')}
          onCreated={() => {
            setCreateTab('none');
            setNotice({ tone: 'ok', text: t('myWork.created') });
            refreshAfterCreation();
          }}
        />
      ) : null}

      {canCreate && createTab === 'subproject' ? (
        <MemberSubprojectForm
          projects={projects.data?.items ?? []}
          loading={projects.loading}
          onClose={() => setCreateTab('none')}
          onCreated={(created) => {
            setCreateTab('none');
            setCreatedSubproject(created);
            setNotice({ tone: 'ok', text: t('myWork.subprojectCreated') });
            refreshAfterCreation();
          }}
        />
      ) : null}

      <ErrorBox
        error={list.error ?? completed.error ?? (canCreate ? projects.error : null) ?? requests.error}
        onRetry={() => {
          list.refresh();
          completed.refresh();
          if (canCreate) projects.refresh();
          requests.refresh();
        }}
      />

      <div className="compact-toolbar my-work-filters" role="group" aria-label={t('myWork.filter.more')}>
        <label className="field grow">
          <span className="field-label">{t('myWork.filter.task')}</span>
          <input
            type="search"
            aria-label={t('myWork.filter.task')}
            value={search}
            placeholder={t('myWork.filter.task')}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="field">
          <span className="field-label">{t('myWork.filter.project')}</span>
          <RemoteSelect
            value={projectId}
            optionsKey="my-work:project-filter"
            onChange={(value) => {
              setProjectId(value);
              setPage(1);
              setCompletedPage(1);
            }}
            allowEmpty={t('filter.allProjects')}
            searchLabel={t('myWork.filter.projectSearch')}
            selectLabel={t('myWork.filter.project')}
            load={async ({ query: projectQuery, page: projectPage }) => {
              const result = await api.get<MyWorkProjectFilter>(
                '/api/employee/my-work/project-filter' +
                  queryString({
                    query: projectQuery,
                    page: projectPage,
                    pageSize: 25,
                    selectedId: projectId
                  })
              );
              return {
                items: result.items.map((entry) => ({ value: entry.projectId, label: entry.projectName })),
                total: result.total,
                page: result.page,
                totalPages: result.totalPages,
                selected: result.selected
                  ? { value: result.selected.projectId, label: result.selected.projectName }
                  : null
              };
            }}
          />
        </div>
        <details className="disclosure">
          <summary>
            {hiddenFilterCount > 0
              ? t('myWork.filter.moreActive', { n: hiddenFilterCount })
              : t('myWork.filter.more')}
          </summary>
          <div className="disclosure-body filters">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={overdue}
                onChange={(event) => {
                  setOverdue(event.target.checked);
                  setPage(1);
                  setCompletedPage(1);
                }}
              />
              {t('myWork.filter.overdue')}
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={dueThisWeek}
                onChange={(event) => {
                  setDueThisWeek(event.target.checked);
                  setPage(1);
                  setCompletedPage(1);
                }}
              />
              {t('myWork.filter.dueThisWeek')}
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={awaitingReview}
                onChange={(event) => {
                  setAwaitingReview(event.target.checked);
                  setPage(1);
                  setCompletedPage(1);
                }}
              />
              {t('myWork.filter.awaitingReview')}
            </label>
            {filtersActive ? (
              <button type="button" className="link-button" onClick={resetFilters}>
                {t('myWork.filter.reset')}
              </button>
            ) : null}
          </div>
        </details>

        {canCreate ? (
          <>
            <button type="button" className="button" onClick={() => setCreateTab('task')}>
              {t('myWork.newTask')}
            </button>
            <button type="button" className="button secondary" onClick={() => setCreateTab('subproject')}>
              {t('myWork.newSubproject')}
            </button>
            {createdSubproject ? (
              <button type="button" className="link-button" onClick={() => setCreateTab('task')}>
                {t('myWork.createTaskUnder')}
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      {activeFilterLabels.length > 0 ? (
        <p className="active-filter-summary">
          <span>{t('myWork.filter.active')}:</span>
          {activeFilterLabels.map((labelText) => (
            <span className="filter-chip" key={labelText}>
              {labelText}
            </span>
          ))}
          <span>
            {t('myWork.matching', { n: total })} · {t('myWork.allActive', { n: unfilteredTotal })}
          </span>
        </p>
      ) : null}

      {list.loading && !list.data ? <p className="muted">{t('myWork.loading')}</p> : null}

      {!list.loading && items.length === 0 ? (
        <p className="muted">
          {filtersActive && unfilteredTotal > 0 ? t('myWork.noMatches') : t('myWork.noAssignments')}
        </p>
      ) : null}

      <div className="my-work-list" aria-label={t('local.myWork')}>
      {items.map((item) => (
        <WorkRow
          key={`${item.taskId}:${item.revision}`}
          item={item}
          canReportCompletion={capabilities.canSubmitCompletionRequest}
          canRequestExtension={capabilities.canSubmitExtensionRequest}
          canManage={capabilities.canEdit}
          submissionEnabled={requests.data?.submissionEnabled ?? false}
          onChanged={refreshAll}
          onStatus={(status) => setNotice(status)}
        />
      ))}
      </div>

      <div className="inline-actions">
        <button type="button" className="button secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          {t('local.previous')}
        </button>
        <span>
          {page} / {totalPages}
        </span>
        <button type="button" className="button secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
          {t('local.next')}
        </button>
      </div>

      <section className="completed-work">
        <button
          type="button"
          className="completed-work-toggle"
          aria-expanded={completedExpanded}
          onClick={() => setCompletedExpanded((value) => !value)}
        >
          {completedExpanded ? '▼' : '▶'} {t('projects.completedTasks')} ({completedTotal})
        </button>
        {completedExpanded ? (
          <>
            {completed.data?.items.length === 0 ? <p className="muted small">{t('myWork.requestsEmpty')}</p> : null}
            <div className="my-work-list">
              {(completed.data?.items ?? []).map((item) => (
                <WorkRow
                  key={`${item.taskId}:${item.revision}`}
                  item={item}
                  canReportCompletion={false}
                  canRequestExtension={false}
                          canManage={false}
                  submissionEnabled={false}
                  onChanged={refreshAll}
                  onStatus={(status) => setNotice(status)}
                />
              ))}
            </div>
            <div className="inline-actions">
              <button type="button" className="button secondary" disabled={completedPage <= 1} onClick={() => setCompletedPage(completedPage - 1)}>
                {t('local.previous')}
              </button>
              <span>{completedPage} / {Math.max(1, Math.ceil((completed.data?.total ?? completedTotal) / PAGE_SIZE))}</span>
              <button type="button" className="button secondary" disabled={completedPage >= Math.max(1, Math.ceil((completed.data?.total ?? completedTotal) / PAGE_SIZE))} onClick={() => setCompletedPage(completedPage + 1)}>
                {t('local.next')}
              </button>
            </div>
          </>
        ) : null}
      </section>

      <MyRequestsCard requests={requests.data?.items ?? []} />
    </div>
  );
}

function WorkRow({
  item,
  canReportCompletion,
  canRequestExtension,
  canManage,
  submissionEnabled,
  onChanged,
  onStatus
}: {
  item: MyWorkList['items'][number];
  canReportCompletion: boolean;
  canRequestExtension: boolean;
  canManage: boolean;
  submissionEnabled: boolean;
  onChanged: () => void;
  onStatus: (status: { tone: 'ok' | 'warning' | 'danger'; text: string }) => void;
}): JSX.Element {
  const { t, label } = useI18n();
  const [requestType, setRequestType] = useState<'DEADLINE_CHANGE' | 'COMPLETION_REPORT' | null>(null);
  const [completing, setCompleting] = useState(false);
  const save = useSave();

  const finished = ['DONE', 'CANCELLED'].includes(item.displayStatus);
  // A finished or container task never offers a request: the server refuses one, so the control
  // would only promise an action that cannot exist. Extension eligibility stays separate from
  // completion eligibility and is still re-checked on the server at submission.
  const requestable = !finished && !item.container && !item.pendingRequest;
  const blockedReasons: string[] = [];
  if (item.pendingRequest) blockedReasons.push(t('report.blocked.pending'));
  if (!submissionEnabled) blockedReasons.push(t('report.blocked.disabled'));
  const review = reviewKey(item.reviewState);
  const canReport = canReportCompletion || canRequestExtension;
  // Only the additional request belongs behind その他: the primary action and the OPEN link stay put.
  const showMore = canRequestExtension && requestable;

  return (
    <article className="my-work-row">
      <div className="my-work-row-title">
        <h3>
          <a href={`#/task/${item.taskId}`}>{item.taskName}</a>
        </h3>
        <p className="my-work-row-meta muted small">
          <a href={`#/project/${item.projectId}`}>{item.projectName}</a>
          {item.subprojectName ? ` / ${item.subprojectName}` : ''} · {label('priority', item.priority)}
        </p>
      </div>
      <div className="my-work-row-status">
        <span className="row-status-line">
          <TaskStatusBadge state={item.displayStatus} missing={item.scheduleMissing} showDetail />
          <WorkflowHint status={item.status} />
          {item.pendingRequest && item.reviewState !== 'PENDING' ? (
            <Badge tone="warn">{t('myWork.pendingBadge')}</Badge>
          ) : null}
        </span>
        {/* A neutral "no request" badge adds noise; only a real review state is stated. */}
        {canReport && item.reviewState !== 'NONE' ? <Badge tone={review.tone}>{t(review.label)}</Badge> : null}
      </div>
      <div className="my-work-row-due">
        <DeadlineCell dueDate={item.dueDate} state={item.displayStatus} completedOn={item.completedAt} showStateBadge={false} />
      </div>

      <div className="my-work-row-actions">
        {canReportCompletion && requestable ? (
          <button type="button" className="button" onClick={() => setRequestType('COMPLETION_REPORT')}>
            {t('myWork.reportCompletion')}
          </button>
        ) : null}
        {canManage && !finished && !item.container ? (
          <button
            type="button"
            className={canReportCompletion && requestable ? 'button secondary' : 'button'}
            onClick={() => setCompleting(true)}
          >
            {t('tasks.completeDirect')}
          </button>
        ) : null}
        <a className="button secondary" href={`#/task/${item.taskId}`}>{t('action.open')}</a>
        {showMore ? (
          <Menu label={t('action.more')} className="row-menu">
            {(close) => (
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  close();
                  setRequestType('DEADLINE_CHANGE');
                }}
              >
                {t('request.action.deadline')}
              </button>
            )}
          </Menu>
        ) : null}
        {finished ? <span className="muted small">{t('myWork.noRequestForFinished')}</span> : null}
      </div>

      {canReport && requestable && blockedReasons.length > 0 ? (
        <div className="validation-summary" role="status">
          <ul>
            {blockedReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <ErrorBox error={save.error} onRetry={onChanged} />

      {completing ? (
        <ConfirmDialog
          title={t('tasks.completeDirectTitle')}
          message={t('tasks.completeDirectBody')}
          destructive={false}
          onCancel={() => setCompleting(false)}
          onConfirm={async () => {
            await save.run(
              () =>
                api.post(`/api/manager/tasks/${item.taskId}/complete`, {
                  revision: item.revision,
                  confirmed: true
                }),
              {
                onSuccess: () => {
                  setCompleting(false);
                  queryCache.invalidate([
                    keys.myWork,
                    keys.tasks,
                    keys.taskIndex,
                    keys.overview,
                    keys.task(item.taskId),
                    keys.project(item.projectId),
                    keys.timeline
                  ]);
                  onChanged();
                }
              }
            );
          }}
        />
      ) : null}

      {requestType ? (
        <RequestDialog
          key={`${item.taskId}:${requestType}`}
          taskId={item.taskId}
          taskName={item.taskName}
          projectName={item.projectName}
          subprojectName={item.subprojectName || undefined}
          currentDeadline={item.dueDate}
          requestType={requestType}
          submissionEnabled={submissionEnabled}
          blockedReasons={blockedReasons}
          onClose={() => setRequestType(null)}
          onResult={(status) => onStatus(status)}
        />
      ) : null}
    </article>
  );
}

function reviewKey(reviewState: MyWorkList['items'][number]['reviewState']): { label: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' } {
  switch (reviewState) {
    case 'PENDING':
      return { label: 'myWork.review.pending', tone: 'warn' };
    case 'APPROVED':
      return { label: 'myWork.review.approved', tone: 'ok' };
    case 'REJECTED':
      return { label: 'myWork.review.rejected', tone: 'danger' };
    case 'RETURNED':
      return { label: 'myWork.review.returned', tone: 'warn' };
    case 'STALE':
      return { label: 'myWork.review.stale', tone: 'warn' };
    default:
      return { label: 'myWork.review.none', tone: 'neutral' };
  }
}

function MyRequestsCard({ requests }: { requests: MemberRequest[] }): JSX.Element {
  const { t, label } = useI18n();
  const [expanded, setExpanded] = useRouteMemoryState('my-work:requests-expanded', false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const pending = requests.filter((request) => ['PENDING', 'PROCESSING'].includes(request.status)).length;

  return (
    <section className="card stack requests-panel">
      <button
        type="button"
        className="requests-toggle"
        aria-expanded={expanded}
        aria-label={t('myWork.requestsToggle')}
        onClick={() => setExpanded((value) => !value)}
      >
        <span aria-hidden="true">{expanded ? '▼' : '▶'}</span> {t('myWork.requestsHeading')} (
        {t('myWork.requestsSummary', { total: requests.length })})
        <span className="muted small"> · {t('myWork.requestsPendingSummary', { n: pending })}</span>
      </button>
      {expanded ? (
        requests.length === 0 ? (
          <p className="muted">{t('myWork.requestsEmpty')}</p>
        ) : (
          <ul className="list request-list">
            {requests.map((request) => {
              const open = openRow === request.requestId;
              const hasDetails = !!(request.decisionNote || request.staleReason);
              return (
                <li key={request.requestId}>
                  <div className="request-row">
                    <strong>{request.taskName || request.taskId}</strong>
                    <span className="muted small">
                      {t(`myWork.requestType.${request.requestType}`)} · {label('request.status', request.status)} ·{' '}
                      {request.submittedAt.slice(0, 10)}
                    </span>
                    <span className="muted request-id">{request.requestId}</span>
                    {hasDetails ? (
                      <button
                        type="button"
                        className="link-button"
                        aria-expanded={open}
                        onClick={() => setOpenRow(open ? null : request.requestId)}
                      >
                        {t(open ? 'myWork.requestHideDetails' : 'myWork.requestDetails')}
                      </button>
                    ) : null}
                  </div>
                  {open && request.decisionNote ? (
                    <div className="request-detail muted small">
                      {t('myWork.decisionNote')}: {request.decisionNote}
                    </div>
                  ) : null}
                  {open && request.staleReason ? (
                    <div className="request-detail muted small">
                      {t('myWork.review.stale')}: {request.staleReason}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </section>
  );
}
