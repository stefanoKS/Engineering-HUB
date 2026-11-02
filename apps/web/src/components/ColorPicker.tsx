/** Deliberate responsibility colours; custom hex values stay validated by the API. */
import { useI18n } from '../i18n';
const PALETTE = ['#4F46E5', '#2563EB', '#0891B2', '#0D9488', '#15803D', '#A16207', '#C2410C', '#BE185D', '#9333EA', '#475569'];
export function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }): JSX.Element {
  const { t } = useI18n();
  return <div className="stack">
    <span className="field-label">{t('responsibilities.color')}</span>
    <div className="colour-options" role="group" aria-label={t('color.choose')}>
      {PALETTE.map(color => <button type="button" key={color} className="colour-option" style={{ backgroundColor: color }} aria-label={color} aria-pressed={value.toUpperCase() === color} onClick={() => onChange(color)}>{value.toUpperCase() === color ? '✓' : ''}</button>)}
    </div>
    <div className="inline-actions colour-custom">
      <input type="color" aria-label={t('color.choose')} value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#4F46E5'} onChange={e => onChange(e.target.value)} />
      <input aria-label={t('responsibilities.color')} value={value} placeholder="#4F46E5" maxLength={7} onChange={e => onChange(e.target.value)} />
      <button type="button" className="link-button" onClick={() => onChange('')}>{t('color.clear')}</button>
    </div>
  </div>;
}
