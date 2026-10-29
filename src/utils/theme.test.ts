import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readThemePreference, writeThemePreference, subscribeToTheme } from '@/utils';

describe('theme change listeners', () => {
  let unsubscribe = () => {};
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'cookieStore', { value: undefined, configurable: true });
    document.cookie = 'aimo-theme=; Path=/; Max-Age=0';
  });
  afterEach(() => {
    unsubscribe();
    vi.restoreAllMocks();
    vi.useRealTimers();
    Reflect.deleteProperty(window, 'cookieStore');
  });

  it('detects native and local changes, ignores duplicates and removes listeners', () => {
    const store = new EventTarget();
    Object.defineProperty(window, 'cookieStore', { value: store, configurable: true });
    const changed = vi.fn();
    unsubscribe = subscribeToTheme(changed);
    writeThemePreference('dark');
    store.dispatchEvent(new Event('change'));
    expect(changed).toHaveBeenCalledTimes(1);
    document.cookie = 'aimo-theme=; Path=/; Max-Age=0';
    store.dispatchEvent(new Event('change'));
    expect(readThemePreference()).toBe('system');
    expect(changed).toHaveBeenCalledTimes(2);
    unsubscribe();
    writeThemePreference('light');
    store.dispatchEvent(new Event('change'));
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('polls visible pages, catches up after hiding and stops on cleanup', () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const changed = vi.fn();
    unsubscribe = subscribeToTheme(changed);
    document.cookie = 'aimo-theme=dark; Path=/';
    vi.advanceTimersByTime(2000);
    expect(changed).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('hidden');
    document.cookie = 'aimo-theme=light; Path=/';
    vi.advanceTimersByTime(2000);
    expect(changed).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(changed).toHaveBeenCalledTimes(2);
    unsubscribe();
    document.cookie = 'aimo-theme=dark; Path=/';
    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new Event('focus'));
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
