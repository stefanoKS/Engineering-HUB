/**
 * The division the manager is looking at.
 *
 * This is page memory only - never `localStorage`, `sessionStorage` or IndexedDB - and it is a
 * *display* narrowing of the scope the server already resolved: a division the caller may not read
 * is not offered here, and the API refuses one that is sent anyway. `null` means "all readable
 * divisions", which is a valid read scope and never a valid creation destination.
 */
import { useSyncExternalStore } from 'react';

export type DivisionOption = { divisionId: string; name: string; status: string };

export type DivisionScopeState = {
  readable: DivisionOption[];
  writable: DivisionOption[];
  allDivisions: boolean;
  selected: string | null;
  /**
   * Whether a session has resolved the scope. An unloaded scope is *unknown*, which is different
   * from an empty one: an action is never hidden and an empty state is never claimed merely
   * because the reference data has not arrived yet.
   */
  loaded: boolean;
};

const EMPTY: DivisionScopeState = {
  readable: [],
  writable: [],
  allDivisions: false,
  selected: null,
  loaded: false
};

let state: DivisionScopeState = EMPTY;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Called once per session load; a selection that is no longer readable falls back to "all". */
export function setDivisionScope(input: {
  readable: DivisionOption[];
  writable: DivisionOption[];
  allDivisions: boolean;
  defaultDivisionId?: string | null;
}): void {
  const readable = input.readable ?? [];
  const writable = input.writable ?? [];
  const stillReadable = state.selected && readable.some((entry) => entry.divisionId === state.selected);
  const selected = stillReadable
    ? state.selected
    : readable.length === 1
      ? readable[0]!.divisionId
      : null;
  state = { readable, writable, allDivisions: input.allDivisions === true, selected, loaded: true };
  emit();
}

/** Sign-out clears the selection together with every other private payload. */
export function clearDivisionScope(): void {
  state = EMPTY;
  emit();
}

export function selectDivision(divisionId: string | null): void {
  if (divisionId && !state.readable.some((entry) => entry.divisionId === divisionId)) return;
  state = { ...state, selected: divisionId };
  emit();
}

export function currentDivision(): string | null {
  return state.selected;
}

/** `&divisionId=...` for a list query, or an empty string for the aggregate scope. */
export function divisionQuery(): string {
  return state.selected ? `&divisionId=${encodeURIComponent(state.selected)}` : '';
}

export function subscribeDivision(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDivisionScope(): DivisionScopeState {
  return useSyncExternalStore(subscribeDivision, () => state, () => EMPTY);
}
