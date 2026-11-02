/** Editor reads are owned by the most recent open/close intent, including sign-out. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { sessionEvents } from '../api/client';
export function useEditorState<T>(initial: T) {
  const [value, update] = useState(initial);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const invalidate = (): void => { generation.current++; };
    sessionEvents.addEventListener('session-lost', invalidate);
    return () => { mounted.current = false; invalidate(); sessionEvents.removeEventListener('session-lost', invalidate); };
  }, []);
  const setValue = useCallback((next: T) => { generation.current++; update(next); setError(null); setLoading(false); }, []);
  const load = useCallback(async (read: () => Promise<T>) => {
    const owner = ++generation.current;
    setError(null); setLoading(true);
    const owns = (): boolean => mounted.current && owner === generation.current;
    try { const next = await read(); if (owns()) update(next); }
    catch (failure) { if (owns()) setError(failure); }
    finally { if (owns()) setLoading(false); }
  }, []);
  return [value, setValue, load, error, loading] as const;
}
