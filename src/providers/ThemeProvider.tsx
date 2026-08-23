'use client';

import { ReactNode, createContext, useContext, useState, useMemo, useEffect } from 'react';
import { ThemeProvider as MUIThemeProvider, CssBaseline } from '@mui/material';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import type { ThemeMode } from '@/lib/theme/tokens';

interface ThemeContextValue {
  mode: ThemeMode;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'light',
  toggleTheme: () => {},
});

export function useThemeMode() {
  return useContext(ThemeContext);
}

const STORAGE_KEY = 'splitbook-theme-mode';

function getInitialMode(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

interface ThemeProviderProps {
  children: ReactNode;
}

export default function ThemeProvider({ children }: ThemeProviderProps) {
  // SSR and the first client render must agree, so start from a deterministic
  // value; the stored/system preference is adopted right after hydration.
  // (Initializing from getInitialMode() during hydration leaves React with a
  // mismatch it refuses to patch — theme state and document attribute diverge.)
  const [mode, setMode] = useState<ThemeMode>('light');

  useEffect(() => {
    // Defer out of the effect phase: adopting the preference synchronously
    // here would cascade a render during hydration settlement.
    const frame = requestAnimationFrame(() => setMode(getInitialMode()));
    return () => cancelAnimationFrame(frame);
  }, []);

  const toggleTheme = () => {
    setMode((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  };

  useEffect(() => {
    document.documentElement.style.colorScheme = mode;
    document.documentElement.setAttribute('data-theme', mode);
  }, [mode]);

  const theme = useMemo(() => createAppTheme(mode), [mode]);

  const contextValue = useMemo(() => ({ mode, toggleTheme }), [mode]);

  return (
    <ThemeContext.Provider value={contextValue}>
      <AppRouterCacheProvider options={{ enableCssLayer: true }}>
        <MUIThemeProvider theme={theme}>
          <CssBaseline />
          {children}
        </MUIThemeProvider>
      </AppRouterCacheProvider>
    </ThemeContext.Provider>
  );
}
