/**
 * One presentation for the derived task schedule state.
 *
 * The state arrives from the server (it is calculated from the plan dates and the Asia/Tokyo
 * business date), so this module only maps it to a localized label and a tone. Every screen uses
 * it, which is what keeps the Status column, the Deadline column and the task detail from
 * describing the same task differently.
 *
 * The stored workflow value is a *secondary* detail: a Blocked or On Hold row still says so, but
 * it never replaces the schedule badge, and a caller that intentionally shows workflow history
 * must label it as such.
 */
import type { DisplayTaskStatus, ScheduleMissingPart } from '@eh/contracts';
import { useI18n } from '../i18n';
import { Badge } from './ui';

type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info';

export function taskStatusTone(state: DisplayTaskStatus): Tone {
  switch (state) {
    case 'DONE':
      return 'ok';
    case 'OVERDUE':
      return 'danger';
    case 'INVALID_DATES':
      return 'warn';
    case 'IN_PROGRESS':
    case 'PLANNED':
      return 'info';
    default:
      return 'neutral';
  }
}

/** The missing plan boundary, stated as a detail instead of being folded into the state. */
export function taskStatusDetail(
  t: (key: string) => string,
  missing: ScheduleMissingPart | undefined
): string | null {
  switch (missing) {
    case 'START':
      return t('task.schedule.missingStart');
    case 'FINISH':
      return t('task.schedule.missingFinish');
    case 'BOTH':
      return t('task.schedule.missingBoth');
    default:
      return null;
  }
}

export function TaskStatusBadge({
  state,
  missing,
  showDetail = false
}: {
  state: DisplayTaskStatus;
  /** The server-derived detail; absent payloads simply show no extra line. */
  missing?: ScheduleMissingPart;
  showDetail?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const stateLabel = t(`taskStatus.${state}`);
  const detail = showDetail ? taskStatusDetail(t, missing) : null;
  // A state such as START_NOT_SET already says the start date is missing: repeating the same
  // sentence beside it is noise, so the detail is shown only when it adds information.
  const extra = detail && detail !== stateLabel ? detail : null;
  return (
    <span className="task-status-badge">
      <Badge tone={taskStatusTone(state)}>{stateLabel}</Badge>
      {extra ? <span className="task-status-detail muted small">{extra}</span> : null}
    </span>
  );
}

/**
 * Workflow information that the schedule state cannot express.
 *
 * Only the blocked and on-hold values are shown here: a "Not Started" or "Assigned" value is an
 * artefact of how the row was created, not something a reader acts on.
 */
export function WorkflowHint({ status }: { status: string }): JSX.Element | null {
  const { t, label } = useI18n();
  if (status !== 'Blocked' && status !== 'On Hold') return null;
  return (
    <span className="task-status-workflow muted small">
      {t('task.schedule.workflowHint', { status: label('task.status', status) })}
    </span>
  );
}
