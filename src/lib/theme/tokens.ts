/**
 * SplitWise private-beta semantic design tokens.
 * Source of truth: docs/design/private-beta/css/tokens.css
 * Light and dark are designed together — every semantic key exists in both.
 */

export type ThemeMode = 'light' | 'dark';

export interface SemanticTokens {
  mode: ThemeMode;
  /** Brand / identity (indigo) */
  brand: { main: string; dark: string; bg: string; contrastText: string };
  /** Informational actions (sky) */
  info: { main: string; bg: string; contrastText: string };
  /** Settled / owed to you (mint) */
  positive: { main: string; bg: string };
  /** Attention / you owe (coral) */
  negative: { main: string; bg: string };
  warning: { main: string; bg: string };
  bg: string;
  bgElevated: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;
  focus: string;
  focusRing: string;
  /** Boarding-pass trip strip */
  strip: {
    bg: string;
    text: string;
    muted: string;
    perforation: string;
    stub: string;
  };
  shadowSm: string;
  shadowMd: string;
}

export const lightTokens: SemanticTokens = {
  mode: 'light',
  brand: { main: '#3d4fcf', dark: '#3240b0', bg: '#e8ebff', contrastText: '#ffffff' },
  info: { main: '#0b8fd9', bg: '#e3f4fd', contrastText: '#ffffff' },
  positive: { main: '#1a9a6e', bg: '#e3f7ef' },
  negative: { main: '#e04f3d', bg: '#fde9e6' },
  warning: { main: '#c47a0a', bg: '#fef3e0' },
  bg: '#f4f5f9',
  bgElevated: '#ffffff',
  surface: '#ffffff',
  surfaceMuted: '#eef0f6',
  border: '#dce0ec',
  borderStrong: '#c5cbdb',
  text: '#151828',
  textSecondary: '#4a5168',
  textMuted: '#6b7289',
  textInverse: '#ffffff',
  focus: '#3d4fcf',
  focusRing: 'rgba(61, 79, 207, 0.35)',
  strip: {
    bg: 'linear-gradient(135deg, #2f3db8 0%, #3d4fcf 55%, #4a62e0 100%)',
    text: '#ffffff',
    muted: 'rgba(255, 255, 255, 0.72)',
    perforation: 'rgba(244, 245, 249, 0.95)',
    stub: 'rgba(255, 255, 255, 0.12)',
  },
  shadowSm: '0 1px 2px rgba(21, 24, 40, 0.05)',
  shadowMd: '0 4px 16px rgba(21, 24, 40, 0.07)',
};

export const darkTokens: SemanticTokens = {
  mode: 'dark',
  brand: { main: '#7b8cff', dark: '#6a7cf0', bg: '#232849', contrastText: '#0e1016' },
  info: { main: '#4db4ef', bg: '#163246', contrastText: '#0e1016' },
  positive: { main: '#3dca96', bg: '#17362b' },
  negative: { main: '#f07162', bg: '#3a221f' },
  warning: { main: '#e0a73a', bg: '#322614' },
  bg: '#0e1016',
  bgElevated: '#161922',
  surface: '#181b26',
  surfaceMuted: '#222634',
  border: '#2c3142',
  borderStrong: '#3d445a',
  text: '#f0f2f8',
  textSecondary: '#b4bace',
  textMuted: '#858da3',
  textInverse: '#151828',
  focus: '#9aa6ff',
  focusRing: 'rgba(123, 140, 255, 0.45)',
  strip: {
    bg: 'linear-gradient(135deg, #252f7a 0%, #3544a8 55%, #3f52c4 100%)',
    text: '#f5f7ff',
    muted: 'rgba(245, 247, 255, 0.7)',
    perforation: 'rgba(14, 16, 22, 0.95)',
    stub: 'rgba(255, 255, 255, 0.08)',
  },
  shadowSm: '0 1px 2px rgba(0, 0, 0, 0.35)',
  shadowMd: '0 6px 20px rgba(0, 0, 0, 0.4)',
};

export function getSemanticTokens(mode: ThemeMode): SemanticTokens {
  return mode === 'dark' ? darkTokens : lightTokens;
}

/** Typography + structure constants shared by both modes. */
export const FONT_UI = 'var(--font-outfit), "Segoe UI", sans-serif';
export const FONT_MONO = 'var(--font-plex-mono), "SFMono-Regular", ui-monospace, monospace';

export const NAV_HEIGHT = 56;
export const SIDEBAR_WIDTH = 240;

export const RADIUS = { sm: 8, md: 12, lg: 16 } as const;
