import { createTheme, type Shadows, type Theme } from '@mui/material/styles';
import {
  FONT_MONO,
  FONT_UI,
  RADIUS,
  getSemanticTokens,
  type ThemeMode,
} from './tokens';

declare module '@mui/material/styles' {
  interface Palette {
    surface: { muted: string; elevated: string };
    border: { strong: string };
    tint: {
      brand: string;
      info: string;
      positive: string;
      negative: string;
      warning: string;
    };
    strip: {
      bg: string;
      text: string;
      muted: string;
      perforation: string;
      stub: string;
    };
    focus: { main: string; ring: string };
  }

  interface PaletteOptions {
    surface?: { muted?: string; elevated?: string };
    border?: { strong?: string };
    tint?: {
      brand?: string;
      info?: string;
      positive?: string;
      negative?: string;
      warning?: string;
    };
    strip?: {
      bg?: string;
      text?: string;
      muted?: string;
      perforation?: string;
      stub?: string;
    };
    focus?: { main?: string; ring?: string };
  }

  interface TypographyVariants {
    money: React.CSSProperties;
  }

  interface TypographyVariantsOptions {
    money?: React.CSSProperties;
  }
}

/**
 * Build the MUI theme from the shared semantic tokens so light and dark
 * always set the same keys. Components must consume tokens, never hex.
 */
export function createAppTheme(mode: ThemeMode): Theme {
  const tokens = getSemanticTokens(mode);
  const base = createTheme();
  const shadows = base.shadows.map((shadow, index) => {
    if (index === 1) return tokens.shadowSm;
    if (index === 2 || index === 3) return tokens.shadowMd;
    return shadow;
  }) as Shadows;

  return createTheme({
    palette: {
      mode,
      primary: {
        main: tokens.brand.main,
        dark: tokens.brand.dark,
        contrastText: tokens.brand.contrastText,
      },
      secondary: {
        main: tokens.info.main,
        contrastText: tokens.info.contrastText,
      },
      info: {
        main: tokens.info.main,
        contrastText: tokens.info.contrastText,
      },
      error: { main: tokens.negative.main },
      success: { main: tokens.positive.main },
      warning: { main: tokens.warning.main },
      background: {
        default: tokens.bg,
        paper: tokens.surface,
      },
      text: {
        primary: tokens.text,
        secondary: tokens.textSecondary,
        disabled: tokens.textMuted,
      },
      divider: tokens.border,
      surface: { muted: tokens.surfaceMuted, elevated: tokens.bgElevated },
      border: { strong: tokens.borderStrong },
      tint: {
        brand: tokens.brand.bg,
        info: tokens.info.bg,
        positive: tokens.positive.bg,
        negative: tokens.negative.bg,
        warning: tokens.warning.bg,
      },
      strip: { ...tokens.strip },
      focus: { main: tokens.focus, ring: tokens.focusRing },
    },
    typography: {
      fontFamily: FONT_UI,
      h5: { fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 },
      h6: { fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.25 },
      subtitle1: { fontWeight: 600 },
      subtitle2: { fontWeight: 600 },
      button: { fontWeight: 600, textTransform: 'none' },
      overline: { fontWeight: 600, letterSpacing: '0.04em', lineHeight: 1.5 },
      money: {
        fontFamily: FONT_MONO,
        fontWeight: 500,
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '-0.01em',
      },
    },
    shape: { borderRadius: RADIUS.md },
    shadows,
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          '@keyframes panel-in': {
            from: { opacity: 0, transform: 'translateY(8px)' },
            to: { opacity: 1, transform: 'translateY(0)' },
          },
          '@keyframes balance-settle': {
            from: { opacity: 0.4 },
            to: { opacity: 1 },
          },
          ':focus-visible': {
            outline: `2px solid ${tokens.focus}`,
            outlineOffset: 2,
            boxShadow: `0 0 0 4px ${tokens.focusRing}`,
          },
          '@media (prefers-reduced-motion: reduce)': {
            '*, *::before, *::after': {
              animationDuration: '0.01ms !important',
              animationIterationCount: '1 !important',
              transitionDuration: '0.01ms !important',
              scrollBehavior: 'auto !important',
            },
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: RADIUS.sm,
            minHeight: 44,
          },
          sizeSmall: { minHeight: 36 },
          sizeLarge: { minHeight: 48 },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            [theme.breakpoints.down('sm')]: {
              minWidth: 44,
              minHeight: 44,
            },
          }),
        },
      },
      MuiPaper: {
        styleOverrides: {
          outlined: {
            borderColor: tokens.border,
            borderRadius: RADIUS.md,
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: RADIUS.md,
            boxShadow: tokens.shadowSm,
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: { borderRadius: RADIUS.lg },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 999,
            fontWeight: 600,
          },
        },
      },
      MuiTabs: {
        styleOverrides: {
          root: {
            minHeight: 0,
            width: 'fit-content',
            maxWidth: '100%',
            padding: 3,
            borderRadius: RADIUS.sm,
            backgroundColor: tokens.surfaceMuted,
          },
          indicator: { display: 'none' },
          flexContainer: { gap: 2 },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            minHeight: 40,
            minWidth: 0,
            padding: '8px 14px',
            borderRadius: 6,
            fontWeight: 600,
            color: tokens.textSecondary,
            '&.Mui-selected': {
              color: tokens.text,
              backgroundColor: tokens.surface,
              boxShadow: tokens.shadowSm,
            },
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: RADIUS.sm,
            minHeight: 44,
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 600,
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: RADIUS.sm,
          },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: RADIUS.md,
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: RADIUS.md,
            border: `1px solid ${tokens.border}`,
          },
        },
      },
    },
  });
}
