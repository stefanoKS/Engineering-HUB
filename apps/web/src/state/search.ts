/**
 * One debounced server-search pattern.
 *
 * A search box keeps two values apart: what the user is typing (`input`) and the query that is
 * actually sent to the server (`applied`). Only `applied` belongs in a query key or a cache
 * identity, so an obsolete answer can never paint over a newer one - the two queries simply live
 * under different keys.
 *
 * Japanese input is the reason the debounce respects composition: while an IME candidate window is
 * open the characters are not Japanese text yet, so the timer is held until composition ends. The
 * applied query then updates once, instead of firing a request per intermediate character.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const SEARCH_DEBOUNCE_MS = 275;

export type DebouncedSearch = {
  /** The text in the box. Kept for a controlled input, including during IME composition. */
  input: string;
  /** The query the server should answer. Changes only after the debounce settles. */
  applied: string;
  /** True while the debounce is pending or an IME composition is open. */
  updating: boolean;
  composing: boolean;
  onChange: (value: string) => void;
  onCompositionStart: () => void;
  onCompositionEnd: (value?: string) => void;
  clear: () => void;
};

export function useDebouncedSearch(initial = '', delay: number = SEARCH_DEBOUNCE_MS): DebouncedSearch {
  const [input, setInput] = useState(initial);
  const [applied, setApplied] = useState(initial);
  const [composing, setComposing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (composing) return undefined;
    if (input === applied) return undefined;
    const pending = setTimeout(() => setApplied(input), delay);
    timer.current = pending;
    return () => clearTimeout(pending);
  }, [input, applied, composing, delay]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onChange = useCallback((value: string) => setInput(value), []);
  const onCompositionStart = useCallback(() => setComposing(true), []);
  const onCompositionEnd = useCallback((value?: string) => {
    setComposing(false);
    if (typeof value === 'string') setInput(value);
  }, []);
  const clear = useCallback(() => {
    setInput('');
    setApplied('');
  }, []);

  return {
    input,
    applied,
    composing,
    updating: composing || input !== applied,
    onChange,
    onCompositionStart,
    onCompositionEnd,
    clear
  };
}
