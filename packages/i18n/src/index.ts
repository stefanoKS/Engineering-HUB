/**
 * Shared localization.
 *
 * The dictionary is generated from the V1 source of truth (`shared/i18n.js`) so every label a
 * manager already learned stays identical. Only display labels are translated: identifiers,
 * stored enum values and free text are rendered exactly as stored.
 */
import dictionary from './dictionary.json';

export type Language = 'ja' | 'en';

export const LANGUAGES: readonly Language[] = ['ja', 'en'];
export const DEFAULT_LANGUAGE: Language = 'ja';
export const STORAGE_KEY = 'eh.lang';
export const APP_NAME = (dictionary.ja as Record<string, string>)['app.name'] ?? '設計・開発課 管理';

type Dictionary = Record<string, string>;

const DICTS: Record<Language, Dictionary> = {
  ja: dictionary.ja as Dictionary,
  en: dictionary.en as Dictionary
};

export function isLanguage(value: unknown): value is Language {
  return value === 'ja' || value === 'en';
}

export function t(language: Language, key: string, vars?: Record<string, string | number>): string {
  const value = DICTS[language][key] ?? DICTS.ja[key] ?? key;
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  );
}

/** Display label for a stored enum value: `group.Value`, then `group.value`, then the value. */
export function label(language: Language, group: string, value: string): string {
  if (!value) return '';
  const direct = DICTS[language][`${group}.${value}`] ?? DICTS.ja[`${group}.${value}`];
  if (direct) return direct;
  const lower = DICTS[language][`${group}.${value.toLowerCase()}`] ?? DICTS.ja[`${group}.${value.toLowerCase()}`];
  return lower ?? value;
}

export function dictionarySize(language: Language = 'ja'): number {
  return Object.keys(DICTS[language]).length;
}
