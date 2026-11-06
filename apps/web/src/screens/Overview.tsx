/**
 * Overview for every role.
 *
 * The manager overview reads the management projection; a MEMBER or VIEWER reads the narrow
 * `/api/work/overview` snapshot, which resolves the authorized scope before every aggregate and
 * top-N cut. Both roles share the same presentational sections, so the KPI cards, the work and
 * deadline lists, the responsibility summaries and the progress presentation cannot drift apart.
 * My Assigned Work stays its own screen; the member overview only links to it and never mixes a
 * personal count into a section-wide figure.
 */
import { useState } from 'react';
import type { Actor, MemberRequests, MyWorkList, Overview, Reference, WorkOverview } from '@eh/contracts';
import { api, queryString } from '../api/client';
import { keys, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { Badge, DataFreshness, EmptyState, ErrorBox, Section, statusTone } from '../components/ui';
import {
  OverviewKpis,
  OverdueWorkSection,
  UpcomingWorkSection,
  ResponsibilityCards
} from '../components/overview-sections';
import { navigate } from '../App';
import { useRouteMemoryState } from '../state/navigation';
import { useBusinessDate } from '../state/business-date';

type BootstrapShape = { references: { responsibilities: Reference[] } };

export function OverviewScreen({ actor }: { actor: Actor }): JSX.Element {
  const isManager = actor.role === 'ADMIN' || actor.role === 'MANAGER';
  return isManager ? <ManagerOverview /> : <MemberOverview actor={actor} />;
}

function ManagerOverview(): JSX.Element {
  const { t } = useI18n();
  const [responsibilityId, setResponsibilityId] = useState('');
  const [unassigned, setUnassigned] = useState(false);
  const [upcomingDays, setUpcomingDays] = useRouteMemoryState<7 | 14 | 30>('overview:upcomingDays', 7);

  const bootstrap = useQuery<BootstrapShape>(keys.bootstrap, () => api.get<BootstrapShape>('/api/manager/bootstrap'));
  // Overdue and upcoming figures are date-dependent: the Tokyo date is part of the cache identity.
  const today = useBusinessDate();
  const key = `${keys.overview}${queryString({ responsibilityId, unassigned, upcomingDays })}:${today}`;
  const overview = useQuery<Overview>(key, () =>
    api.get<Overview>(`/api/manager/overview${queryString({ responsibilityId, unassigned, upcomingDays })}`)
  );

  const data = overview.data;
  const responsibilities = bootstrap.data?.references?.responsibilities ?? [];

  return (
    <div className="screen">
      <div className="screen-header">
        <h2>{t('nav.overview')}</h2>
        <div className="filters">
          <label className="inline-field">
            <span>{t('overview.scope')}</span>
            <select
              value={unassigned ? '__unassigned__' : responsibilityId}
              onChange={(event) => {
                if (event.target.value === '__unassigned__') {
                  setUnassigned(true);
                  setResponsibilityId('');
                } else {
                  setUnassigned(false);
                  setResponsibilityId(event.target.value);
                }
              }}
            >
              <option value="">{t('filter.all')}</option>
              {responsibilities.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
              <option value="__unassigned__">{t('overview.unassigned')}</option>
            </select>
          </label>
        </div>
      </div>

      <ErrorBox error={overview.error} onRetry={() => overview.refresh()} />

      {!data ? (
        <p className="muted">{t('state.loading')}</p>
      ) : (
        <>
          <OverviewKpis
            counts={data.counts}
            onOpenWork={() => navigate(taskDestination({ workState: 'OPEN', responsibilityId, unassigned }))}
            onOverdue={() => navigate(taskDestination({ displayStatus: 'OVERDUE', responsibilityId, unassigned }))}
            onCompleted={() => navigate(taskDestination({ displayStatus: 'DONE', responsibilityId, unassigned }))}
          />

          <OverdueWorkSection
            tasks={data.overdue}
            total={data.overdueTotal}
            today={today}
            showPeriod
            onViewAll={() => navigate(taskDestination({ displayStatus: 'OVERDUE', responsibilityId, unassigned }))}
          />

          <UpcomingWorkSection
            tasks={data.upcoming}
            window={data.upcomingWindow}
            days={upcomingDays}
            onChangeDays={setUpcomingDays}
            onViewAll={() =>
              navigate(`all-work${queryString({ workState: 'OPEN', responsibilityId, unassigned })}`)
            }
          />

          <Section title={t('overview.pending')}>
            {data.pendingRequests.length === 0 ? (
              <EmptyState text={t('requests.empty')} />
            ) : (
              <ul className="list">
                {data.pendingRequests.map((request) => (
                  <li key={request.requestId}>
                    <Badge tone={statusTone(request.status)}>{t(`request.status.${request.status}`)}</Badge>
                    <span>{request.requesterName || t('common.unknown')}</span>
                    <span className="muted small">{request.requestType}</span>
                    <button type="button" className="link-button" onClick={() => navigate('requests')}>
                      {t('nav.requests')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Structure and history follow the actionable work. */}
          <ResponsibilityCards cards={data.responsibilities} />
        </>
      )}
    </div>
  );
}
function taskDestination(input: {
  workState?: 'OPEN';
  displayStatus?: 'OVERDUE' | 'DONE';
  responsibilityId: string;
  unassigned: boolean;
}): string {
  return `all-work${queryString(input)}`;
}

function MemberOverview({ actor }: { actor: Actor }): JSX.Element {
  void actor;
  const { t } = useI18n();
  const [responsibilityId, setResponsibilityId] = useRouteMemoryState('overview:responsibility', '');
  const [upcomingDays, setUpcomingDays] = useRouteMemoryState<7 | 14 | 30>('overview:workUpcomingDays', 7);
  const today = useBusinessDate();
  const key = `${keys.workOverview}${queryString({ responsibilityId, upcomingDays })}:${today}`;
  const overview = useQuery<WorkOverview>(key, () =>
    api.get<WorkOverview>(`/api/work/overview${queryString({ responsibilityId, upcomingDays })}`)
  );
  // The personal list is a separate authorized read: a personal total never becomes a section total.
  const mine = useQuery<MyWorkList>(`${keys.myWork}:overview`, () =>
    api.get<MyWorkList>('/api/employee/my-work?page=1&section=active')
  );
  const availability = useQuery<MemberRequests>(keys.myRequests, () =>
    api.get<MemberRequests>('/api/employee/requests/mine')
  );

  const data = overview.data;
  const personalActive = mine.data?.activeTotal ?? 0;
  const personalCompleted = mine.data?.completedTotal ?? 0;
  const requestsClosed = availability.data?.submissionEnabled === false;

  return (
    <div className="screen">
      <div className="screen-header">
        <h2>{t('nav.overview')}</h2>
        <div className="filters">
          <label className="inline-field">
            <span>{t('overview.scope')}</span>
            <select
              aria-label={t('overview.scope')}
              value={responsibilityId}
              onChange={(event) => setResponsibilityId(event.target.value)}
            >
              <option value="">{t('filter.all')}</option>
              {(data?.options ?? []).map((entry) => (
                <option key={entry.responsibilityId} value={entry.responsibilityId}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <DataFreshness snapshot={false} />
      <p className="muted small">{t('overview.authorizedScope')}</p>
      <ErrorBox error={overview.error} onRetry={() => overview.refresh()} />

      {!data ? (
        <p className="muted" role="status">
          {t('state.loading')}
        </p>
      ) : (
        <>
          <OverviewKpis
            counts={data.counts}
            onOpenWork={() => navigate(`all-work${queryString({ workState: 'OPEN', responsibilityId })}`)}
            onOverdue={() => navigate(`all-work${queryString({ displayStatus: 'OVERDUE', responsibilityId })}`)}
            onCompleted={() => navigate(`all-work${queryString({ displayStatus: 'DONE', responsibilityId })}`)}
          />

          <OverdueWorkSection
            tasks={data.overdue}
            total={data.overdueTotal}
            today={today}
            showPeriod
            onViewAll={() => navigate(`all-work${queryString({ displayStatus: 'OVERDUE', responsibilityId })}`)}
          />

          <UpcomingWorkSection
            tasks={data.upcoming}
            window={data.upcomingWindow}
            days={upcomingDays}
            onChangeDays={setUpcomingDays}
            onViewAll={() => navigate(`all-work${queryString({ workState: 'OPEN', responsibilityId })}`)}
          />

          <Section
            title={t('local.myWork')}
            actions={
              <a className="button secondary" href="#/my-work">
                {t('overview.openMyWork')}
              </a>
            }
          >
            <p className="muted small">{t('overview.personalNote')}</p>
            <dl className="mini-stats">
              <div>
                <dt>{t('myWork.activeTotalLabel')}</dt>
                <dd>{personalActive}</dd>
              </div>
              <div>
                <dt>{t('overview.completed')}</dt>
                <dd>{personalCompleted}</dd>
              </div>
            </dl>
            {requestsClosed ? <div className="banner warning">{t('myWork.requestsClosed')}</div> : null}
          </Section>

          {/* Structure and history follow the actionable work. */}
          <ResponsibilityCards
            cards={data.responsibilities}
            onOpen={(id) => setResponsibilityId(id)}
          />
        </>
      )}
    </div>
  );
}
