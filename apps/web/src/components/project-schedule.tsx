/**
 * The displayed project schedule status.
 *
 * The value is derived on the server from the plan dates and the Asia/Tokyo business date, so the
 * browser only localizes it. A stored non-terminal lifecycle value (Planned, Active, On hold) no
 * longer overrides the badge: only an explicit completion, cancellation or archive does, and those
 * are the same states the derived calculation reports.
 */
import type { ProjectScheduleDisplay, ProjectScheduleState } from '@eh/contracts';
import { useI18n } from '../i18n';
import { Badge } from './ui';

type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info';

export function scheduleTone(state: ProjectScheduleState): Tone {
  switch (state) {
    case 'COMPLETED':
      return 'ok';
    case 'LATE':
      return 'danger';
    case 'INVALID_DATES':
      return 'warn';
    case 'IN_PROGRESS':
      return 'info';
    default:
      return 'neutral';
  }
}

export function scheduleLabel(
  t: (key: string) => string,
  schedule: ProjectScheduleDisplay | undefined
): string {
  if (!schedule) return '';
  return t(`project.schedule.${schedule.state}`);
}

/** The missing boundary is stated next to the badge instead of being folded into a state. */
export function scheduleDetail(
  t: (key: string) => string,
  schedule: ProjectScheduleDisplay | undefined
): string | null {
  switch (schedule?.missing) {
    case 'FINISH':
      return t('project.schedule.missingFinish');
    case 'START':
      return t('project.schedule.missingStart');
    case 'BOTH':
      return t('project.schedule.missingBoth');
    default:
      return null;
  }
}

export function ScheduleBadge({
  schedule,
  showDetail = false
}: {
  schedule: ProjectScheduleDisplay | undefined;
  showDetail?: boolean;
}): JSX.Element | null {
  const { t } = useI18n();
  if (!schedule) return null;
  const detail = showDetail ? scheduleDetail(t, schedule) : null;
  return (
    <span className="schedule-badge">
      <Badge tone={scheduleTone(schedule.state)}>{scheduleLabel(t, schedule)}</Badge>
      {detail ? <span className="schedule-detail muted small">{detail}</span> : null}
    </span>
  );
}
