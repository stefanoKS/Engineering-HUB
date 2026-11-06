/**
 * Project list for MEMBER and VIEWER.
 *
 * The same table, grouping, identity colours, schedule badge, deadline cell, progress and counts
 * as the manager list, built from one authorized read: `GET /api/work/projects` applies the
 * visibility policy, the responsibility filter, the sort and the paging on the server before a
 * page is cut. A MEMBER may create a new project from here; nobody sees an edit, archive or delete
 * control, because those are manager capabilities. A VIEWER has no creation control either.
 */
import { useState } from 'react';
import type { Actor, MyWorkProjectFormOptions, WorkProject, WorkProjectList } from '@eh/contracts';
import { PROJECT_SCHEDULE_STATES } from '@eh/contracts';
import { api, queryString } from '../api/client';
import { keys, queryCache, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { EmptyState, ErrorBox, Pagination } from '../components/ui';
import { SelectInput } from '../components/forms';
import { ProjectTable, type ProjectRowView, type ProjectSort } from '../components/project-table';
import { MemberProjectForm } from '../components/member-project-form';
import { capabilitiesOf } from '../state/capabilities';
import { useRouteMemoryState } from '../state/navigation';
import { useBusinessDate } from '../state/business-date';

const PAGE_SIZE = 24;
const SCHEDULE_STATES = [...PROJECT_SCHEDULE_STATES];

export function WorkProjectsScreen({ actor }: { actor: Actor }): JSX.Element {
  const { t } = useI18n();
  const capabilities = capabilitiesOf(actor);
  // Search, responsibility, sort and page survive navigation away and back, exactly like the
  // manager list. A filter is never persisted in the browser.
  const [query, setQuery] = useRouteMemoryState('explore:query', '');
  const [responsibilityId, setResponsibilityId] = useRouteMemoryState('explore:responsibility', '');
  const [unassigned, setUnassigned] = useRouteMemoryState('explore:unassigned', false);
  const [schedule, setSchedule] = useRouteMemoryState('explore:schedule', '');
  const [page, setPage] = useRouteMemoryState('explore:page', 1);
  const [sort, setSort] = useRouteMemoryState<ProjectSort>('explore:sort', 'deadline');
  const [direction, setDirection] = useRouteMemoryState<'asc' | 'desc'>('explore:direction', 'asc');
  const [collapsedGroups, setCollapsedGroups] = useRouteMemoryState<Set<string>>(
    'explore:collapsed-groups',
    () => new Set()
  );
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{ projectId: string; projectName: string } | null>(null);

  const today = useBusinessDate();
  const key = `${keys.workProjects}${queryString({ query, responsibilityId, unassigned, schedule, sort, direction, page })}:${today}`;
  const list = useQuery<WorkProjectList>(key, () =>
    api.get<WorkProjectList>(
      `/api/work/projects${queryString({
        query,
        responsibilityId,
        unassigned,
        schedule,
        sort,
        direction,
        page,
        pageSize: PAGE_SIZE
      })}`
    )
  );
  const formOptions = useQuery<MyWorkProjectFormOptions>(keys.myProjectForm, () =>
    capabilities.canCreateProject
      ? api.get<MyWorkProjectFormOptions>('/api/employee/references')
      : Promise.resolve({ projectCreationEnabled: false, responsibilities: [] })
  );

  const setSortOrder = (next: ProjectSort): void => {
    setDirection(next === sort ? (direction === 'asc' ? 'desc' : 'asc') : 'asc');
    setSort(next);
    setPage(1);
  };
  const toggleGroup = (group: string): void =>
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  const toRow = (project: WorkProject): ProjectRowView => ({
    projectId: project.projectId,
    projectName: project.projectName,
    responsibilityId: project.responsibilityId,
    responsibilityName: project.responsibilityName,
    schedule: project.schedule,
    priority: project.priority,
    committedDeadline: project.committedDeadline,
    progressPercent: project.progressPercent,
    openWork: project.activeTaskCount,
    overdueWork: project.overdueTaskCount
  });

  const refreshAfterCreation = (): void => {
    queryCache.invalidate([
      keys.workProjects,
      keys.workOverview,
      keys.myProjects,
      keys.myWork,
      keys.timeline,
      'manager/projects',
      'manager/overview'
    ]);
  };

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <h2>{t('nav.projects')}</h2>
          <p className="muted small">{t('explore.intro')}</p>
          <p className="muted small">{t('overview.authorizedScope')}</p>
        </div>
        <div className="filters">
          <SelectInput
            value={unassigned ? '__unassigned__' : responsibilityId}
            onChange={(value) => {
              setUnassigned(value === '__unassigned__');
              setResponsibilityId(value === '__unassigned__' ? '' : value);
              setPage(1);
            }}
            allowEmpty={t('filter.all')}
            options={(list.data?.responsibilities ?? []).map((entry) => ({
              value: entry.responsibilityId,
              label: entry.name
            }))}
          />
          <SelectInput
            value={schedule}
            onChange={(value) => {
              setSchedule(value);
              setPage(1);
            }}
            allowEmpty={t('filter.all')}
            options={SCHEDULE_STATES.map((value) => ({ value, label: t(`project.schedule.${value}`) }))}
          />
          <input
            type="search"
            placeholder={t('explore.search')}
            aria-label={t('explore.search')}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
          {capabilities.canCreateProject ? (
            <button type="button" className="button" onClick={() => setCreating(true)}>
              {t('projects.new')}
            </button>
          ) : null}
        </div>
      </div>

      {notice ? (
        <div className="banner ok" role="status">
          {t('myWork.projectCreated', { name: notice.projectName })}{' '}
          <a href={`#/project/${notice.projectId}`}>{t('explore.view')}</a>
        </div>
      ) : null}

      <ErrorBox error={list.error} onRetry={() => list.refresh()} />

      {!list.data ? (
        <p className="muted" role="status">
          {t('state.loading')}
        </p>
      ) : list.data.items.length === 0 ? (
        <EmptyState text={t('explore.empty')} />
      ) : (
        <ProjectTable
          items={list.data.items.map(toRow)}
          groupTotals={list.data.groupTotals}
          grouped={!responsibilityId && !unassigned}
          sort={sort}
          direction={direction}
          onSort={setSortOrder}
          collapsedGroups={collapsedGroups}
          onToggleGroup={toggleGroup}
          showActions={false}
        />
      )}

      {list.data ? (
        <Pagination
          page={list.data.page}
          totalPages={list.data.totalPages}
          total={list.data.total}
          onChange={setPage}
        />
      ) : null}

      {creating ? (
        <MemberProjectForm
          options={formOptions.data}
          loading={formOptions.loading}
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            setNotice(created);
            refreshAfterCreation();
          }}
        />
      ) : null}
    </div>
  );
}
