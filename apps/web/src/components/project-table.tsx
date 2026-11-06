/**
 * One project table for both authorized scopes.
 *
 * The manager list and the member project screen render exactly the same table: the same
 * responsibility grouping, project identity colour, derived schedule badge, deadline cell,
 * progress bar, open/overdue counts and paging. Only the data adapter and the action cell differ,
 * because a MEMBER may create new work while a manager edits, archives or removes. The component
 * never fetches anything: every figure it shows was resolved on the server inside the reader's
 * authorized scope.
 */
import type { ReactNode } from 'react';
import type { Priority, ProjectScheduleDisplay } from '@eh/contracts';
import { projectColor } from '@eh/domain';
import { useI18n } from '../i18n';
import { ProgressBar } from './ui';
import { DeadlineCell, deadlineStateOf } from './deadline';
import { ScheduleBadge } from './project-schedule';
import { SortHeader } from './sort-header';

export type ProjectSort =
  | 'deadline'
  | 'name'
  | 'responsibility'
  | 'owner'
  | 'schedule'
  | 'priority'
  | 'updated';

export type ProjectRowView = {
  projectId: string;
  projectName: string;
  responsibilityId: string | null;
  responsibilityName: string;
  schedule: ProjectScheduleDisplay;
  priority: Priority;
  committedDeadline: string | null;
  progressPercent: number | null;
  openWork: number;
  overdueWork: number;
  /** The manager list shows the recorded next action; the member projection never carries it. */
  nextAction?: string;
  /** Authorized actions for this reader; absent means no action cell at all. */
  actions?: ReactNode;
};

export type ProjectTableProps = {
  items: readonly ProjectRowView[];
  /** Real totals per responsibility across the authorized scope, not the visible page size. */
  groupTotals?: readonly { responsibilityId: string | null; total: number }[];
  /** Group by responsibility; off while a responsibility filter is active. */
  grouped: boolean;
  sort: ProjectSort;
  direction: 'asc' | 'desc';
  onSort: (next: ProjectSort) => void;
  collapsedGroups: ReadonlySet<string>;
  onToggleGroup: (group: string) => void;
  showActions: boolean;
  emptyText?: string;
};

const UNASSIGNED_GROUP = '__unassigned__';

export function ProjectTable(props: ProjectTableProps): JSX.Element {
  const { t } = useI18n();
  const { items, showActions } = props;
  const columns = showActions ? 6 : 5;
  const groups = props.grouped
    ? Array.from(
        items.reduce((map, project) => {
          const key = project.responsibilityId ?? UNASSIGNED_GROUP;
          const existing = map.get(key) ?? {
            name: project.responsibilityName || t('overview.unassigned'),
            items: [] as ProjectRowView[]
          };
          existing.items.push(project);
          map.set(key, existing);
          return map;
        }, new Map<string, { name: string; items: ProjectRowView[] }>())
      )
    : [];
  const totalOf = (groupKey: string, displayed: number): number =>
    props.groupTotals?.find((total) => (total.responsibilityId ?? UNASSIGNED_GROUP) === groupKey)?.total ??
    displayed;

  const row = (project: ProjectRowView): JSX.Element => (
    <tr key={project.projectId} style={{ ['--project-accent' as string]: projectColor(project.projectId) }}>
      <td>
        <span className="project-dot" style={{ background: projectColor(project.projectId) }} aria-hidden="true" />
        <a href={`#/project/${project.projectId}`}>{project.projectName}</a>
        {project.nextAction ? <div className="muted small">{project.nextAction}</div> : null}
      </td>
      <td>{project.responsibilityName || t('overview.unassigned')}</td>
      <td>
        <ScheduleBadge schedule={project.schedule} />
      </td>
      <td>
        <DeadlineCell
          dueDate={project.committedDeadline}
          state={deadlineStateOf(project.schedule)}
          showLabel={false}
        />
      </td>
      <td>
        <ProgressBar value={project.progressPercent} />
        <div className="muted small">
          {t('overview.openWork')}: {project.openWork} · {t('overview.overdue')}: {project.overdueWork}
        </div>
      </td>
      {showActions ? <td className="project-actions-cell">{project.actions}</td> : null}
    </tr>
  );

  return (
    <table className="table">
      <thead>
        <tr>
          <th>
            <SortHeader label={t('column.name')} sortKey="name" current={props.sort} direction={props.direction} onSort={props.onSort} />
          </th>
          <th>
            <SortHeader
              label={t('projects.responsibility')}
              sortKey="responsibility"
              current={props.sort}
              direction={props.direction}
              onSort={props.onSort}
            />
          </th>
          <th>
            <SortHeader label={t('column.status')} sortKey="schedule" current={props.sort} direction={props.direction} onSort={props.onSort} />
          </th>
          <th>
            <SortHeader
              label={t('column.deadline')}
              sortKey="deadline"
              current={props.sort}
              direction={props.direction}
              onSort={props.onSort}
            />
          </th>
          <th>{t('column.progress')}</th>
          {showActions ? <th>{t('column.actions')}</th> : null}
        </tr>
      </thead>
      {groups.length
        ? groups.map(([groupKey, group]) => (
            <tbody key={groupKey}>
              <tr className="project-group-heading">
                <th colSpan={columns}>
                  <button
                    type="button"
                    className="link-button"
                    aria-expanded={!props.collapsedGroups.has(groupKey)}
                    onClick={() => props.onToggleGroup(groupKey)}
                  >
                    {props.collapsedGroups.has(groupKey) ? '▸' : '▾'} {group.name} (
                    {totalOf(groupKey, group.items.length)})
                  </button>
                  {totalOf(groupKey, group.items.length) > group.items.length ? (
                    <span className="muted small">{t('projects.groupContinues')}</span>
                  ) : null}
                </th>
              </tr>
              {props.collapsedGroups.has(groupKey) ? null : group.items.map(row)}
            </tbody>
          ))
        : (
            <tbody>{items.map(row)}</tbody>
          )}
    </table>
  );
}
