import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type * as t from '@/types';
import { readThemePreference, writeThemePreference, subscribeToTheme } from '@/utils';

const ThemeContext = createContext<t.ThemeContextValue | null>(null);

function getSystemTheme(): t.ResolvedTheme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyClassesToDOM(preference: t.ThemeOption) {
  const root = document.documentElement;
  root.classList.remove('dark', 'light');
  if (preference === 'dark' || preference === 'light') {
    root.classList.add(preference);
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<t.ThemeOption>(readThemePreference);
  const [systemTheme, setSystemTheme] = useState<t.ResolvedTheme>(getSystemTheme);

  const setTheme = useCallback((next: t.ThemeOption) => {
    setThemeState(next);
    writeThemePreference(next);
    applyClassesToDOM(next);
  }, []);

  useEffect(() => {
    applyClassesToDOM(theme);
  }, [theme]);

  useEffect(() => {
    const sync = () => setThemeState(readThemePreference());
    const unsubscribe = subscribeToTheme(sync);
    sync();
    return unsubscribe;
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const resolvedTheme: t.ResolvedTheme = useMemo(
    () => (theme === 'system' ? systemTheme : theme),
    [theme, systemTheme],
  );

  const value = useMemo(
    () => ({ theme, resolvedTheme, systemTheme, setTheme }),
    [theme, resolvedTheme, systemTheme, setTheme],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): t.ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
