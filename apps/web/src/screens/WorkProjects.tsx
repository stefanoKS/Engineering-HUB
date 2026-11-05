/**
 * Read-only project explorer for MEMBER and VIEWER.
 *
 * One bounded page from `/api/work/projects`: the server applies the visibility policy, the
 * responsibility filter and the paging before the page is cut, and only allowlisted fields
 * (identity, description, owner name, status, deadline, TaskScope counts) reach the browser.
 * There is no create, edit, archive or delete control on this screen.
 */
import type { WorkProjectList } from '@eh/contracts';
import { api, queryString } from '../api/client';
import { useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { Badge, EmptyState, ErrorBox, Pagination, ProgressBar } from '../components/ui';
import { DeadlineCell, deadlineStateOf } from '../components/deadline';
import { ScheduleBadge } from '../components/project-schedule';
import { projectColor } from '@eh/domain';
import { useRouteMemoryState } from '../state/navigation';
import { useBusinessDate } from '../state/business-date';

const PAGE_SIZE = 24;

export function WorkProjectsScreen(): JSX.Element {
  const { t, label } = useI18n();
  // Search, responsibility and page survive navigation away and back, exactly like the manager list.
  const [query, setQuery] = useRouteMemoryState('explore:query', '');
  const [responsibilityId, setResponsibilityId] = useRouteMemoryState('explore:responsibility', '');
  const [page, setPage] = useRouteMemoryState('explore:page', 1);

  const today = useBusinessDate();
  const key = `work/projects${queryString({ query, responsibilityId, page })}:${today}`;
  const list = useQuery<WorkProjectList>(key, () =>
    api.get<WorkProjectList>(
      `/api/work/projects${queryString({ query, responsibilityId, page, pageSize: PAGE_SIZE })}`
    )
  );

  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <h2>{t('nav.projects')}</h2>
          <p className="muted small">{t('explore.intro')}</p>
        </div>
        <div className="filters">
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
          <select
            aria-label={t('filter.responsibility')}
            value={responsibilityId}
            onChange={(event) => {
              setResponsibilityId(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('filter.all')}</option>
            {(list.data?.responsibilities ?? []).map((entry) => (
              <option key={entry.responsibilityId} value={entry.responsibilityId}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ErrorBox error={list.error} onRetry={() => list.refresh()} />

      {!list.data ? (
        <p className="muted" role="status">
          {t('state.loading')}
        </p>
      ) : list.data.items.length === 0 ? (
        <EmptyState text={t('explore.empty')} />
      ) : (
        <div className="project-grid">
          {list.data.items.map((project) => {
            const accent = projectColor(project.projectId);
            const description = project.description.trim();
            return (
              <article
                key={project.projectId}
                className="card project-card"
                style={{ ['--project-accent' as string]: accent }}
              >
                <header className="project-card-head">
                  <span className="project-dot" style={{ background: accent }} aria-hidden="true" />
                  <h3>
                    <a href={`#/project/${project.projectId}`}>{project.projectName}</a>
                  </h3>
                </header>
                <p className="muted small project-card-meta">
                  {project.responsibilityName || t('overview.unassigned')} ·{' '}
                  {project.projectOwnerName || t('common.unset')}
                </p>
                <p className="project-card-badges">
                  <ScheduleBadge schedule={project.schedule} />
                  <Badge tone="neutral">{label('priority', project.priority)}</Badge>
                  <DeadlineCell
                    dueDate={project.committedDeadline}
                    state={deadlineStateOf(project.schedule)}
                  />
                </p>
                <ProgressBar value={project.progressPercent} />
                <p className="muted small">
                  {t('explore.activeTasks', { n: project.activeTaskCount })} ·{' '}
                  {t('explore.completedTasks', { n: project.completedTaskCount })}
                </p>
                <p className={description ? 'description-preview' : 'description-preview empty-description'}>
                  {description || t('common.noDescription')}
                </p>
                <div className="inline-actions">
                  <a className="button secondary" href={`#/project/${project.projectId}`}>
                    {t('explore.view')}
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {list.data ? (
        <Pagination
          page={list.data.page}
          totalPages={list.data.totalPages}
          total={list.data.total}
          onChange={setPage}
        />
      ) : null}
    </div>
  );
}
