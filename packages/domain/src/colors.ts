/**
 * Deterministic project accent colours (ported from the tested V1 helper).
 *
 * The colour is derived from the stable project identifier only, never from a list position or
 * a filter, so a project keeps its accent across navigation, sorting and refresh. Only palette
 * values can reach a CSS colour; a project name or identifier is never interpolated into one.
 * A project colour is an identity marker, never a status.
 */
const PALETTE = [
  '#52799B', '#438579', '#796D9B', '#AB8249',
  '#B16E69', '#667FAD', '#758854', '#9B6B88',
  '#4E7E8C', '#8C6A4E', '#6C7080', '#5F7A6B',
  '#949257', '#568D53', '#8A5794', '#995667'
] as const;

const MAX_ID_LENGTH = 120;

export function normalizeProjectId(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  return text.length > MAX_ID_LENGTH ? text.slice(0, MAX_ID_LENGTH) : text;
}

function hashOf(id: string): number {
  let left = 0xdeadbeef;
  let right = 0x41c6ce57;
  for (let index = 0; index < id.length; index += 1) {
    const code = id.charCodeAt(index);
    left = Math.imul(left ^ code, 2654435761);
    right = Math.imul(right ^ code, 1597334677);
  }
  left = Math.imul(left ^ (left >>> 16), 2246822507) ^ Math.imul(right ^ (right >>> 13), 3266489909);
  right = Math.imul(right ^ (right >>> 16), 2246822507) ^ Math.imul(left ^ (left >>> 13), 3266489909);
  return left >>> 0;
}

export function projectColorIndex(value: unknown): number {
  const id = normalizeProjectId(value);
  if (!id) return -1;
  return hashOf(id) % PALETTE.length;
}

export function projectColor(value: unknown): string {
  const index = projectColorIndex(value);
  return index < 0 ? '' : (PALETTE[index] ?? '');
}

function channels(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ];
}

export function projectOutline(value: unknown): string {
  const color = projectColor(value);
  if (!color) return '';
  const [r, g, b] = channels(color);
  return `rgba(${r},${g},${b},0.45)`;
}

export function projectTint(value: unknown): string {
  const color = projectColor(value);
  if (!color) return '';
  const [r, g, b] = channels(color);
  return `rgba(${r},${g},${b},0.08)`;
}

/** CSS custom properties for one project; empty when there is no identifier. */
export function projectColorVars(value: unknown): Record<string, string> {
  const accent = projectColor(value);
  if (!accent) return {};
  return {
    '--project-accent': accent,
    '--project-outline': projectOutline(value),
    '--project-tint': projectTint(value)
  };
}

export const PROJECT_COLOR_PALETTE = PALETTE;
