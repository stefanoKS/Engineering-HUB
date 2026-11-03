/**
 * Skill grades.
 *
 * The database keeps the historical integer level (0 = not assessed, 1 = lowest ... 4 = highest)
 * so no stored value is rewritten. The interface only ever shows letter grades:
 * A = 4, B = 3, C = 2, D = 1, and 0 stays "not assessed" instead of becoming the lowest grade.
 */
import { DomainError } from './errors';

export const SKILL_GRADES = ['A', 'B', 'C', 'D'] as const;
export type SkillGrade = (typeof SKILL_GRADES)[number];

const GRADE_TO_LEVEL: Readonly<Record<SkillGrade, number>> = { A: 4, B: 3, C: 2, D: 1 };

export const SKILL_LEVEL_MIN = 0;
export const SKILL_LEVEL_MAX = 4;
export const NOT_ASSESSED_LEVEL = 0;

export function isSkillGrade(value: unknown): value is SkillGrade {
  return typeof value === 'string' && (SKILL_GRADES as readonly string[]).includes(value.toUpperCase());
}

export function isSkillLevel(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= SKILL_LEVEL_MIN &&
    value <= SKILL_LEVEL_MAX
  );
}

/** `A` -> 4 ... `D` -> 1. `NOT_ASSESSED`/blank -> 0. Anything else is refused. */
export function gradeToLevel(grade: unknown): number {
  const text = String(grade ?? '').trim().toUpperCase();
  if (!text || text === 'NOT_ASSESSED' || text === '0') return NOT_ASSESSED_LEVEL;
  if (!isSkillGrade(text)) {
    throw new DomainError('VALIDATION_FAILED', 'A skill grade must be A, B, C, D or "not assessed"', {
      grade: String(grade ?? '')
    });
  }
  return GRADE_TO_LEVEL[text];
}

/** 4 -> `A` ... 1 -> `D`; 0, null and undefined mean "not assessed" and are not a grade. */
export function levelToGrade(level: number | null | undefined): SkillGrade | null {
  if (level === null || level === undefined) return null;
  const value = Number(level);
  if (!Number.isInteger(value) || value === NOT_ASSESSED_LEVEL) return null;
  if (value < 1 || value > SKILL_LEVEL_MAX) {
    throw new DomainError('VALIDATION_FAILED', `A skill level must be 0-${SKILL_LEVEL_MAX}`, {
      level: String(level)
    });
  }
  const grade = (Object.keys(GRADE_TO_LEVEL) as SkillGrade[]).find((key) => GRADE_TO_LEVEL[key] === value);
  return grade ?? null;
}

/** Display text for a stored level. Never converts 0 into the lowest grade. */
export function formatSkillGrade(level: number | null | undefined, notAssessed = '未評価'): string {
  return levelToGrade(level) ?? notAssessed;
}

export function assertSkillLevel(level: number | null | undefined, field = 'skill level'): void {
  if (level === null || level === undefined) return;
  if (!isSkillLevel(Number(level))) {
    throw new DomainError('VALIDATION_FAILED', `A ${field} must be an integer 0-${SKILL_LEVEL_MAX}`, {
      level: String(level)
    });
  }
}
