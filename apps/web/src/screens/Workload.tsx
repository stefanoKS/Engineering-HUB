/** Weekly workload report. Utilisation is an indicator, never an assignment limit. */
import type { Actor, WorkloadReport } from '@eh/contracts';
import { api } from '../api/client';
import { keys, useQuery } from '../state/cache';
import { useI18n } from '../i18n';
import { Badge, EmptyState, ErrorBox, Section } from '../components/ui';

export function WorkloadScreen({ actor }: { actor: Actor }): JSX.Element {
  const { t } = useI18n();
  void actor;
  const report = useQuery<WorkloadReport>(keys.workload, () => api.get<WorkloadReport>('/api/manager/reports/workload'));
  if (report.error) return <ErrorBox error={report.error} onRetry={() => report.refresh()} />;
  if (!report.data) return <p className="muted">{t('state.loading')}</p>;

  return (
    <div className="screen">
      <div className="screen-header">
        <h2>{t('nav.workload')}</h2>
        <span className="muted small">{report.data.asOf}</span>
      </div>
      <p className="muted small">{t('workload.note')}</p>
      {report.data.weeks.map((week) => {
        const rows = report.data?.rows.filter((row) => row.weekStart === week) ?? [];
        return (
          <Section key={week} title={`${t('workload.week')} ${week}`}>
            {rows.length === 0 ? (
              <EmptyState />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('workload.member')}</th>
                    <th>{t('workload.remaining')}</th>
                    <th>{t('workload.capacity')}</th>
                    <th>{t('workload.utilization')}</th>
                    <th>{t('workload.unknown')}</th>
                    <th>{t('workload.overdue')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${week}:${row.memberId}`}>
                      <td>{row.memberName}</td>
                      <td>{row.remainingHours}</td>
                      <td>{row.capacityHours || t('common.unset')}</td>
                      <td>
                        {row.utilization === null ? (
                          t('common.unset')
                        ) : row.overloadWarning ? (
                          <Badge tone="danger">{Math.round(row.utilization * 100)}%</Badge>
                        ) : (
                          `${Math.round(row.utilization * 100)}%`
                        )}
                      </td>
                      <td>{row.unknownEstimateTasks}</td>
                      <td>{row.overdueTasks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        );
      })}
    </div>
  );
}
