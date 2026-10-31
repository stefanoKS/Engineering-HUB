import { randomBytes, randomUUID } from 'node:crypto';

/**
 * Stable, human-typable identifiers for new records.
 *
 * A migrated V1 identifier is preserved verbatim; a V2-created record gets a prefix, the
 * business date and a short random suffix, so an identifier stays unique across imports and
 * never encodes a row position.
 */
export function newId(prefix: string, businessDate: string = new Date().toISOString().slice(0, 10)): string {
  const compact = businessDate.replace(/-/g, '');
  const suffix = randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${compact}-${suffix}`;
}

export function newUuid(): string {
  return randomUUID();
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}
