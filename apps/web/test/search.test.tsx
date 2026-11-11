// @vitest-environment jsdom
/**
 * Debounced, IME-aware server search.
 *
 * The two properties that matter are that the *applied* query changes once after the pause, and
 * that a Japanese composition never emits an intermediate request.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDebouncedSearch, SEARCH_DEBOUNCE_MS } from '../src/state/search';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('debounced search', () => {
  it('applies the query once after the debounce, not on every keystroke', () => {
    const { result } = renderHook(() => useDebouncedSearch(''));
    act(() => result.current.onChange('配'));
    act(() => result.current.onChange('配線'));
    act(() => result.current.onChange('配線図'));
    expect(result.current.applied).toBe('');
    expect(result.current.updating).toBe(true);
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(result.current.applied).toBe('配線図');
    expect(result.current.updating).toBe(false);
  });

  it('holds the timer while an IME composition is open', () => {
    const { result } = renderHook(() => useDebouncedSearch(''));
    act(() => result.current.onCompositionStart());
    act(() => result.current.onChange('はい'));
    act(() => result.current.onChange('はいせ'));
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 3);
    });
    // No request is issued for a candidate window that is still open.
    expect(result.current.applied).toBe('');
    expect(result.current.composing).toBe(true);
    act(() => result.current.onCompositionEnd('配線設計'));
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(result.current.applied).toBe('配線設計');
    expect(result.current.composing).toBe(false);
  });

  it('clears the applied query immediately', () => {
    const { result } = renderHook(() => useDebouncedSearch(''));
    act(() => result.current.onChange('abc'));
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    expect(result.current.applied).toBe('abc');
    act(() => result.current.clear());
    expect(result.current.input).toBe('');
    expect(result.current.applied).toBe('');
  });
});
