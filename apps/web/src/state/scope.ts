/**
 * The one scope-transition policy for every list screen.
 *
 * When the division switch changes, a screen must not keep state that belonged to the previous
 * scope: the fetched page, the expanded branches and any selection that the new scope cannot
 * contain. What must survive is the independent presentation state (the sort order) and a filter
 * whose reference data is merely still loading - a slow or failed reference read is not evidence
 * that the selection became invalid.
 *
 * `useDivisionTransition` runs the reset exactly once per real change (never on the first render),
 * and the new scope is part of every request and cache key at the call site, so a late answer from
 * the previous scope can neither paint nor be joined by the new one.
 */
import { useEffect, useRef } from 'react';
import { useDivisionScope } from './division';

/** A stable signature of the selected division; `all` is a read scope, never a write scope. */
export function useDivisionScopeSignature(): string {
  const { selected } = useDivisionScope();
  return selected ?? 'all';
}

export function useDivisionTransition(onTransition: (scope: string) => void): string {
  const scope = useDivisionScopeSignature();
  const previous = useRef(scope);
  const handler = useRef(onTransition);
  handler.current = onTransition;
  useEffect(() => {
    if (previous.current === scope) return;
    previous.current = scope;
    handler.current(scope);
  }, [scope]);
  return scope;
}

/**
 * True when a selected identifier is no longer part of the offered reference list.
 *
 * An empty list means the reference data has not arrived (or failed): that is `unknown`, not
 * `incompatible`, so a valid selection is never cleared because a read is slow.
 */
export function isSelectionIncompatible(
  selected: string,
  options: readonly { id: string }[] | undefined
): boolean {
  if (!selected) return false;
  if (!options || options.length === 0) return false;
  return !options.some((entry) => entry.id === selected);
}
