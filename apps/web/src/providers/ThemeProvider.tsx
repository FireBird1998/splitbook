'use client';

import { ReactNode, createContext, useContext, useState, useMemo, useEffect } from 'react';
import { ThemeProvider as MUIThemeProvider, CssBaseline } from '@mui/material';
import { createTheme } from '@mui/material/styles';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import type { ThemeMode } from '@/lib/theme/tokens';
import { THEME_STORAGE_KEY } from '@/lib/product';

declare module '@mui/material/styles' {
  interface CssThemeVariables {
    enabled: true;
  }
}

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

function getInitialMode(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
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
  const [preference, setMode] = useState<ThemeMode | null>(null);
  const mode = preference ?? 'light';

  useEffect(() => {
    // Defer out of the effect phase: adopting the preference synchronously
    // here would cascade a render during hydration settlement.
    const frame = requestAnimationFrame(() => setMode(getInitialMode()));
    return () => cancelAnimationFrame(frame);
  }, []);

  const toggleTheme = () => {
    setMode((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      localStorage.setItem(THEME_STORAGE_KEY, next);
      return next;
    });
  };

  useEffect(() => {
    // Preserve the pre-paint script’s choice until hydration adopts the real preference.
    // The deterministic light render is not a member preference.
    if (preference === null) return;
    document.documentElement.style.colorScheme = mode;
    document.documentElement.setAttribute('data-theme', mode);
  }, [mode, preference]);

  const theme = useMemo(
    () =>
      createTheme({
        ...createAppTheme(mode),
        // Both palettes must be in the server CSS: the pre-paint attribute can then
        // select dark colours before React adopts the preference.
        cssVariables: { colorSchemeSelector: '[data-theme="%s"]' },
        colorSchemes: {
          light: { palette: createAppTheme('light').palette },
          dark: { palette: createAppTheme('dark').palette },
        },
      }),
    [mode],
  );

  const contextValue = useMemo(() => ({ mode, toggleTheme }), [mode]);

  return (
    <ThemeContext.Provider value={contextValue}>
      <AppRouterCacheProvider options={{ enableCssLayer: true }}>
        <MUIThemeProvider
          theme={theme}
          // This provider owns the preference; MUI only emits the two CSS palettes.
          colorSchemeNode={null}
          storageManager={null}
          defaultMode="light"
        >
          <CssBaseline />
          {children}
        </MUIThemeProvider>
      </AppRouterCacheProvider>
    </ThemeContext.Provider>
  );
}
