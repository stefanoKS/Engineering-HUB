/**
 * One identity for one attempted correction.
 *
 * A corrective command carries an idempotency key, so a retried delivery returns the stored answer
 * instead of a second effect. The key therefore belongs to the *attempt*, not to a render: it is
 * created once when the confirmation dialog opens and every submission of that same attempt reuses
 * it. A dismissed dialog starts a new attempt with a new key; nothing here regenerates a key after
 * an uncertain outcome, because an uncertain operation is never retried automatically.
 *
 * The shape matches the server contract (`^[A-Za-z0-9:_-]{8,120}$`).
 */
export function newAttemptKey(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  // The prefix and the random part are both restricted to the contract's safe alphabet.
  return `${prefix}:${random}`.replace(/[^A-Za-z0-9:_-]/g, '').slice(0, 120);
}
