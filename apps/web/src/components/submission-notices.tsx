/**
 * Page-level submission feedback.
 *
 * Rendered once by the application shell, so a request that was started in a dialog keeps
 * reporting after that dialog was closed and after the person navigated to another screen. The
 * tracker is session-bound: a sign-out clears it, so a notice can never leak into the next user's
 * session.
 */
import { useI18n } from '../i18n';
import { dismissSubmission, isClaimed, useSubmissions, type SubmissionAttempt } from '../state/submissions';

const VISIBLE = 3;

function toneOf(state: SubmissionAttempt['outcome']): { tone: 'info' | 'ok' | 'warning' | 'danger'; role: 'status' | 'alert' } {
  switch (state) {
    case 'SENDING':
      return { tone: 'info', role: 'status' };
    case 'RECEIVED':
      return { tone: 'ok', role: 'status' };
    case 'UNKNOWN':
      return { tone: 'warning', role: 'alert' };
    default:
      return { tone: 'danger', role: 'alert' };
  }
}

export function SubmissionNotices(): JSX.Element | null {
  const { t } = useI18n();
  const submissions = useSubmissions();
  if (submissions.length === 0) return null;
  // A dismissed notice is hidden without deleting the attempt: the attempt is what prevents an
  // uncertain submission from being sent twice. A submission an open dialog reports is not
  // repeated here either.
  const visible = submissions
    .filter((entry) => !entry.dismissed && !entry.reported && !isClaimed(entry.attemptId))
    .slice(0, VISIBLE);
  if (visible.length === 0) return null;
  return (
    <div className="submission-notices">
      {visible.map((entry) => {
        const { tone, role } = toneOf(entry.outcome);
        const text =
          entry.outcome === 'SENDING'
            ? t('submission.sending')
            : entry.outcome === 'RECEIVED'
              ? t('submission.received', { id: entry.requestId })
              : entry.outcome === 'UNKNOWN'
                ? `${t('request.transport.OUTCOME_UNKNOWN')} ${t('submission.unknown')}`
                : `${t('submission.refused')} ${entry.message}`.trim();
        return (
          <div key={entry.attemptId} className={`banner ${tone} submission-notice`} role={role}>
            <span>{text}</span>
            {entry.outcome === 'UNKNOWN' ? (
              <a className="link-button" href="#/my-work">
                {t('submission.checkRequests')}
              </a>
            ) : null}
            <button
              type="button"
              className="link-button submission-dismiss"
              aria-label={t('submission.dismiss')}
              onClick={() => dismissSubmission(entry.attemptId)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
