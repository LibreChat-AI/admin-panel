export type ThemeOption = 'system' | 'light' | 'dark';

export type ResolvedTheme = 'dark' | 'light';

export interface ThemeContextValue {
  theme: ThemeOption;
  resolvedTheme: ResolvedTheme;
  systemTheme: ResolvedTheme;
  setTheme: (theme: ThemeOption) => void;
}
