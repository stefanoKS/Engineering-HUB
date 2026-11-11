/**
 * The division switch in the authenticated shell (課).
 *
 * It narrows what the screens ask for; it never widens access. "All readable divisions" is an
 * aggregate read view and is never offered as a creation destination - a creation form always
 * needs one concrete division.
 */
import { useI18n } from '../i18n';
import { selectDivision, useDivisionScope } from '../state/division';

export function DivisionScopeBar(): JSX.Element | null {
  const { t } = useI18n();
  const scope = useDivisionScope();
  if (scope.readable.length === 0) {
    return (
      <span className="division-scope muted small" role="status">
        {t('division.none')}
      </span>
    );
  }
  if (scope.readable.length === 1 && scope.readable[0]) {
    return (
      <span className="division-scope" title={t('division.singleHint')}>
        <span className="division-scope-label">{t('division.label')}</span>{' '}
        <strong>{scope.readable[0].name}</strong>
      </span>
    );
  }
  return (
    <label className="division-scope">
      <span className="division-scope-label">{t('division.label')}</span>
      <select
        aria-label={t('division.select')}
        value={scope.selected ?? ''}
        onChange={(event) => selectDivision(event.target.value || null)}
      >
        <option value="">{t('division.all')}</option>
        {scope.readable.map((division) => (
          <option key={division.divisionId} value={division.divisionId}>
            {division.name}
          </option>
        ))}
      </select>
    </label>
  );
}
