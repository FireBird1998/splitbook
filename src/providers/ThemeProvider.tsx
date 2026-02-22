"use client";

import { ReactNode, createContext, useContext, useState, useMemo, useEffect } from "react";
import { ThemeProvider as MUIThemeProvider, createTheme, CssBaseline } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";

type ThemeMode = "light" | "dark";

interface ThemeContextValue {
  mode: ThemeMode;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "light",
  toggleTheme: () => {},
});

export function useThemeMode() {
  return useContext(ThemeContext);
}

const STORAGE_KEY = "splitwise-theme-mode";

function getInitialMode(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}

function getDesignTokens(mode: ThemeMode) {
  return createTheme({
    palette: {
      mode,
      primary: { main: "#6C63FF" },
      secondary: { main: "#00BFA5" },
      error: { main: "#FF5252" },
      warning: { main: "#FFA726" },
      success: { main: "#66BB6A" },
      ...(mode === "light"
        ? {
            background: { default: "#F5F5F5", paper: "#FFFFFF" },
            text: { primary: "#1A1A2E", secondary: "#6B7280" },
          }
        : {
            background: { default: "#121212", paper: "#1E1E2E" },
            text: { primary: "#E0E0E0", secondary: "#A0A0B0" },
          }),
    },
    typography: {
      fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
    },
    shape: {
      borderRadius: 12,
    },
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: "none",
            fontWeight: 600,
            borderRadius: 8,
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: ({ theme }) => ({
            boxShadow:
              mode === "light"
                ? "0 1px 3px rgba(0,0,0,0.08)"
                : `0 1px 3px ${alpha(theme.palette.common.black, 0.3)}`,
            borderRadius: 12,
          }),
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 16,
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 8,
          },
        },
      },
    },
  });
}

interface ThemeProviderProps {
  children: ReactNode;
}

export default function ThemeProvider({ children }: ThemeProviderProps) {
  const [mode, setMode] = useState<ThemeMode>(getInitialMode);

  const toggleTheme = () => {
    setMode((prev) => {
      const next = prev === "light" ? "dark" : "light";
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  };

  useEffect(() => {
    document.documentElement.style.colorScheme = mode;
    document.documentElement.setAttribute("data-theme", mode);
  }, [mode]);

  const theme = useMemo(() => getDesignTokens(mode), [mode]);

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
