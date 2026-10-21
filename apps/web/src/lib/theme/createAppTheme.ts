import { alertClasses } from '@mui/material/Alert';
import { buttonClasses } from '@mui/material/Button';
import { linkClasses } from '@mui/material/Link';
import { createTheme, darken, lighten, type Shadows, type Theme } from '@mui/material/styles';
// Types only: lets the theme style the charts (MuiChartsGrid, MuiChartsXAxis, …).
import type {} from '@mui/x-charts/themeAugmentation';
import { FONT_MONO, FONT_UI, RADIUS, getSemanticTokens, type ThemeMode } from './tokens';

declare module '@mui/material/styles' {
  interface Palette {
    status: {
      positive: string;
      negative: string;
      negativeHover: string;
      warning: string;
      info: string;
      infoHover: string;
    };
    surface: { muted: string; elevated: string; hover: string; shadowSm: string; shadowMd: string };
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
    chart: { series: string; seriesSoft: string; grid: string };
    inverse: { bg: string; text: string };
    diverging: { positive: string; negative: string };
  }

  interface PaletteOptions {
    status?: {
      positive?: string;
      negative?: string;
      negativeHover?: string;
      warning?: string;
      info?: string;
      infoHover?: string;
    };
    surface?: {
      muted?: string;
      elevated?: string;
      hover?: string;
      shadowSm?: string;
      shadowMd?: string;
    };
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
    chart?: { series?: string; seriesSoft?: string; grid?: string };
    inverse?: { bg?: string; text?: string };
    diverging?: { positive?: string; negative?: string };
  }

  interface TypographyVariants {
    money: React.CSSProperties;
    /** The landing page headline: 40 px on a phone, up to 72 px. */
    display: React.CSSProperties;
    /** A landing page call to action: 32 px on a phone, up to 52 px. */
    displaySmall: React.CSSProperties;
    /** The sentence under a landing page headline. */
    lead: React.CSSProperties;
  }

  interface TypographyVariantsOptions {
    money?: React.CSSProperties;
    display?: React.CSSProperties;
    displaySmall?: React.CSSProperties;
    lead?: React.CSSProperties;
  }
}

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    display: true;
    displaySmall: true;
    lead: true;
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
      surface: {
        muted: tokens.surfaceMuted,
        elevated: tokens.bgElevated,
        hover: tokens.surfaceHover,
        shadowSm: tokens.shadowSm,
        shadowMd: tokens.shadowMd,
      },
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
      status: {
        ...tokens.status,
        negativeHover:
          mode === 'light'
            ? darken(tokens.status.negative, 0.15)
            : lighten(tokens.status.negative, 0.1),
        infoHover:
          mode === 'light' ? darken(tokens.status.info, 0.15) : lighten(tokens.status.info, 0.1),
      },
      chart: { ...tokens.chart },
      inverse: { ...tokens.inverse },
      diverging: { ...tokens.diverging },
    },
    typography: {
      fontFamily: FONT_UI,
      h5: { fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 },
      h6: { fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.25 },
      subtitle1: { fontWeight: 600 },
      subtitle2: { fontWeight: 600 },
      button: { fontWeight: 600, textTransform: 'none' },
      overline: { fontWeight: 600, letterSpacing: '0.04em', lineHeight: 1.5 },
      display: {
        fontFamily: FONT_UI,
        fontSize: 'clamp(2.5rem, 5.6vw, 4.5rem)',
        fontWeight: 700,
        lineHeight: 1.02,
        letterSpacing: '-0.035em',
        textWrap: 'balance',
      },
      displaySmall: {
        fontFamily: FONT_UI,
        fontSize: 'clamp(2rem, 4vw, 3.25rem)',
        fontWeight: 700,
        lineHeight: 1.08,
        letterSpacing: '-0.03em',
        textWrap: 'balance',
      },
      lead: { fontFamily: FONT_UI, fontSize: '1.1875rem', lineHeight: 1.55 },
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
        styleOverrides: (theme) => ({
          '@keyframes panel-in': {
            from: { opacity: 0, transform: 'translateY(8px)' },
            to: { opacity: 1, transform: 'translateY(0)' },
          },
          '@keyframes balance-settle': {
            from: { opacity: 0.4 },
            to: { opacity: 1 },
          },
          ':focus-visible': {
            outline: `2px solid ${(theme.vars ?? theme).palette.focus.main}`,
            outlineOffset: 2,
            boxShadow: `0 0 0 4px ${(theme.vars ?? theme).palette.focus.ring}`,
          },
          '@media (prefers-reduced-motion: reduce)': {
            '*, *::before, *::after': {
              animationDuration: '0.01ms !important',
              animationDelay: '0ms !important',
              animationIterationCount: '1 !important',
              transitionDuration: '0.01ms !important',
              transitionDelay: '0ms !important',
              scrollBehavior: 'auto !important',
            },
          },
        }),
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: RADIUS.sm,
            minHeight: 44,
            variants: [
              {
                props: { variant: 'contained', color: 'info' },
                style: {
                  backgroundColor: (theme.vars ?? theme).palette.status.info,
                  color: (theme.vars ?? theme).palette.info.contrastText,
                  '&:hover': {
                    backgroundColor: (theme.vars ?? theme).palette.status.infoHover,
                  },
                },
              },
            ],
          }),
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
          outlined: ({ theme }) => ({
            borderColor: (theme.vars ?? theme).palette.divider,
            borderRadius: RADIUS.md,
          }),
        },
      },
      MuiCard: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: RADIUS.md,
            boxShadow: (theme.vars ?? theme).palette.surface.shadowSm,
          }),
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
          root: ({ theme }) => ({
            minHeight: 0,
            width: 'fit-content',
            maxWidth: '100%',
            padding: 3,
            borderRadius: RADIUS.sm,
            backgroundColor: (theme.vars ?? theme).palette.surface.muted,
          }),
          indicator: { display: 'none' },
          flexContainer: { gap: 2 },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: ({ theme }) => ({
            minHeight: 40,
            minWidth: 0,
            padding: '8px 14px',
            borderRadius: 6,
            fontWeight: 600,
            color: (theme.vars ?? theme).palette.text.secondary,
            '&.Mui-selected': {
              color: (theme.vars ?? theme).palette.text.primary,
              backgroundColor: (theme.vars ?? theme).palette.background.paper,
              boxShadow: (theme.vars ?? theme).palette.surface.shadowSm,
            },
          }),
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
      MuiFormLabel: {
        styleOverrides: {
          root: ({ theme }) => ({
            '&.Mui-error': { color: (theme.vars ?? theme).palette.status.negative },
          }),
        },
      },
      MuiFormHelperText: {
        styleOverrides: {
          root: ({ theme }) => ({
            '&.Mui-error': { color: (theme.vars ?? theme).palette.status.negative },
          }),
        },
      },
      MuiAlert: {
        styleOverrides: {
          // A standard banner takes its status tint, its text the primary colour and its icon
          // the status colour, as the canvas's banner does: MUI's own tint is near black in dark
          // mode (#772). Its text buttons and links take the status colour too, as the canvas and
          // Android draw banner actions: each passes on its own tint, where brand blue on the dark
          // info or success tint doesn't quite (#782). As variants, so a banner's own sx still wins.
          root: ({ theme }) => {
            const { palette } = theme.vars ?? theme;
            const tones = {
              info: 'info',
              warning: 'warning',
              error: 'negative',
              success: 'positive',
            } as const;
            return {
              borderRadius: RADIUS.md,
              variants: Object.entries(tones).map(([colorSeverity, tone]) => ({
                props: { variant: 'standard', colorSeverity },
                style: {
                  backgroundColor: palette.tint[tone],
                  color: palette.text.primary,
                  [`& .${alertClasses.icon}, & .${buttonClasses.text}, & .${linkClasses.root}`]: {
                    color: palette.status[tone],
                  },
                },
              })),
            };
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: ({ theme }) => ({
            borderRadius: RADIUS.md,
            border: `1px solid ${(theme.vars ?? theme).palette.divider}`,
          }),
        },
      },
      // Charts (design canvas "Web portal"): a hairline grid, a baseline in the strong border,
      // tick labels in text colours, and tooltips on the inverse surface. Series colours come
      // from `palette.chart` in each chart.
      MuiChartsGrid: {
        styleOverrides: {
          line: ({ theme }) => ({
            stroke: (theme.vars ?? theme).palette.chart.grid,
            shapeRendering: 'crispEdges',
          }),
        },
      },
      MuiChartsXAxis: {
        styleOverrides: {
          root: ({ theme }) => ({
            '& .MuiChartsAxis-line': { stroke: (theme.vars ?? theme).palette.border.strong },
            '& .MuiChartsAxis-tickLabel': { fill: (theme.vars ?? theme).palette.text.secondary },
          }),
        },
      },
      MuiChartsYAxis: {
        styleOverrides: {
          root: ({ theme }) => ({
            '& .MuiChartsAxis-line': { stroke: (theme.vars ?? theme).palette.border.strong },
            '& .MuiChartsAxis-tickLabel': { fill: (theme.vars ?? theme).palette.text.disabled },
          }),
        },
      },
      MuiChartsTooltip: {
        styleOverrides: {
          paper: ({ theme }) => ({
            backgroundColor: (theme.vars ?? theme).palette.inverse.bg,
            color: (theme.vars ?? theme).palette.inverse.text,
            border: 0,
            borderRadius: 10,
            boxShadow: (theme.vars ?? theme).palette.surface.shadowMd,
          }),
        },
      },
    },
  });
}
