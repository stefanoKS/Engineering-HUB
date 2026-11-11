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
import { useEffect, useState } from 'react';
import type { Actor, MemberRequests, MyWorkList, Overview, Reference, WorkOverview } from '@eh/contracts';
import { UnmappedMappingView } from '@eh/contracts';
import { ApiFailure, api, queryString } from '../api/client';
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
import { useDivisionScope } from '../state/division';

type BootstrapShape = { references: { responsibilities: Reference[] } };

export function OverviewScreen({ actor }: { actor: Actor }): JSX.Element {
  const isManager = actor.role === 'ADMIN' || actor.role === 'MANAGER';
  return isManager ? <ManagerOverview actor={actor} /> : <MemberOverview actor={actor} />;
}

function ManagerOverview({ actor }: { actor: Actor }): JSX.Element {
  const { t } = useI18n();
  const [responsibilityId, setResponsibilityId] = useState('');
  const [unassigned, setUnassigned] = useState(false);
  const [upcomingDays, setUpcomingDays] = useRouteMemoryState<7 | 14 | 30>('overview:upcomingDays', 7);
  // The division switch narrows every figure on this screen. `null` means "all readable
  // divisions", which is a read scope only; it is never a creation destination.
  const division = useDivisionScope();
  const divisionId = division.selected ?? undefined;

  const bootstrap = useQuery<BootstrapShape>(keys.bootstrap, () => api.get<BootstrapShape>('/api/manager/bootstrap'));
  // Overdue and upcoming figures are date-dependent: the Tokyo date is part of the cache identity.
  const today = useBusinessDate();
  // The selected division is part of the request and of the cache key, so a late answer from an
  // older selection can neither paint nor be joined by the newer one.
  const key = `${keys.overview}${queryString({ responsibilityId, unassigned, upcomingDays, divisionId })}:${today}`;
  const overview = useQuery<Overview>(key, () =>
    api.get<Overview>(
      `/api/manager/overview${queryString({ responsibilityId, unassigned, upcomingDays, divisionId })}`
    )
  );

  // Unmapped work is invisible to everybody but ADMIN, so only an ADMIN sees the remediation hint.
  // The payload is the mapping preview contract: a missing count is an invalid response, never zero.
  const unmapped = useQuery<UnmappedMappingView>(
    `${keys.divisions}/unmapped-banner`,
    async () => {
      const payload = await api.get<unknown>('/api/admin/divisions/unmapped?pageSize=1');
      const parsed = UnmappedMappingView.safeParse(payload);
      if (!parsed.success) {
        throw new ApiFailure({ code: 'INVALID_RESPONSE', message: 'Invalid unmapped work response', retryable: true });
      }
      return parsed.data;
    },
    { enabled: actor.role === 'ADMIN' }
  );
  // A failed remediation read is not an overview failure: the cards keep their own state and the hint
  // stays hidden instead of claiming that nothing is unmapped.
  const unmappedPending = unmapped.data
    ? unmapped.data.counts.projects + unmapped.data.counts.responsibilities
    : 0;

  const data = overview.data;
  // Only the areas of the selected division are offered; an unmapped area belongs to the ADMIN
  // remediation view and is never mixed into a concrete division.
  const responsibilities = (bootstrap.data?.references?.responsibilities ?? []).filter(
    (entry) => !divisionId || entry.divisionId === divisionId
  );
  // A selection that the new division does not contain is cleared, so the cards and the lists can
  // never describe two different scopes.
  useEffect(() => {
    if (!responsibilityId) return;
    if (!responsibilities.some((entry) => entry.id === responsibilityId)) setResponsibilityId('');
  }, [divisionId, responsibilityId, responsibilities]);

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

      {actor.role === 'ADMIN' && unmappedPending > 0 ? (
        <div className="banner warning" role="status">
          <p>{t('mapping.overviewBanner', { n: unmappedPending })}</p>
          <a className="button secondary" href="#/divisions">
            {t('mapping.overviewLink')}
          </a>
        </div>
      ) : null}

      {!data ? (
        <p className="muted">{t('state.loading')}</p>
      ) : (
        <>
          <OverviewKpis
            counts={data.counts}
            onOpenWork={() => navigate(taskDestination({ workState: 'OPEN', responsibilityId, unassigned, divisionId }))}
            onOverdue={() => navigate(taskDestination({ displayStatus: 'OVERDUE', responsibilityId, unassigned, divisionId }))}
            onCompleted={() => navigate(taskDestination({ displayStatus: 'DONE', responsibilityId, unassigned, divisionId }))}
          />

          <OverdueWorkSection
            tasks={data.overdue}
            total={data.overdueTotal}
            today={today}
            showPeriod
            onViewAll={() => navigate(taskDestination({ displayStatus: 'OVERDUE', responsibilityId, unassigned, divisionId }))}
          />

          <UpcomingWorkSection
            tasks={data.upcoming}
            window={data.upcomingWindow}
            days={upcomingDays}
            onChangeDays={setUpcomingDays}
            onViewAll={() =>
              // The drilldown keeps the question the card answered: the same scope *and* the same
              // deadline window, both applied by the server before paging and totals.
              navigate(
                taskDestination({
                  workState: 'OPEN',
                  responsibilityId,
                  unassigned,
                  divisionId,
                  dueFrom: data.upcomingWindow.from,
                  dueTo: data.upcomingWindow.to
                })
              )
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
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => navigate(`requests${queryString({ requestId: request.requestId })}`)}
                    >
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
  divisionId?: string;
  dueFrom?: string;
  dueTo?: string;
}): string {
  return `all-work${queryString(input)}`;
}

function MemberOverview({ actor }: { actor: Actor }): JSX.Element {
  void actor;
  const { t } = useI18n();
  const [responsibilityId, setResponsibilityId] = useRouteMemoryState('overview:responsibility', '');
  const [upcomingDays, setUpcomingDays] = useRouteMemoryState<7 | 14 | 30>('overview:workUpcomingDays', 7);
  const division = useDivisionScope();
  const divisionId = division.selected ?? undefined;
  const today = useBusinessDate();
  const key = `${keys.workOverview}${queryString({ responsibilityId, upcomingDays, divisionId })}:${today}`;
  const overview = useQuery<WorkOverview>(key, () =>
    api.get<WorkOverview>(`/api/work/overview${queryString({ responsibilityId, upcomingDays, divisionId })}`)
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
  const responsibilityOptions = data?.options ?? [];
  // A responsibility that is not part of the newly selected division is cleared, so the figures and
  // the visible lists always describe the same scope.
  useEffect(() => {
    if (!responsibilityId) return;
    if (!responsibilityOptions.some((entry) => entry.responsibilityId === responsibilityId)) {
      setResponsibilityId('');
    }
  }, [divisionId, responsibilityId, responsibilityOptions, setResponsibilityId]);

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
              {responsibilityOptions.map((entry) => (
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
            onOpenWork={() => navigate(`all-work${queryString({ workState: 'OPEN', responsibilityId, divisionId })}`)}
            onOverdue={() => navigate(`all-work${queryString({ displayStatus: 'OVERDUE', responsibilityId, divisionId })}`)}
            onCompleted={() => navigate(`all-work${queryString({ displayStatus: 'DONE', responsibilityId, divisionId })}`)}
          />

          <OverdueWorkSection
            tasks={data.overdue}
            total={data.overdueTotal}
            today={today}
            showPeriod
            onViewAll={() => navigate(`all-work${queryString({ displayStatus: 'OVERDUE', responsibilityId, divisionId })}`)}
          />

          <UpcomingWorkSection
            tasks={data.upcoming}
            window={data.upcomingWindow}
            days={upcomingDays}
            onChangeDays={setUpcomingDays}
            onViewAll={() =>
              // Same scope and the same deadline window the card counted.
              navigate(
                `all-work${queryString({
                  workState: 'OPEN',
                  responsibilityId,
                  divisionId,
                  dueFrom: data.upcomingWindow.from,
                  dueTo: data.upcomingWindow.to
                })}`
              )
            }
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
