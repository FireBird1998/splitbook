import { describe, expect, it } from 'vitest';
import {
  CONTENT_MAX_WIDTH,
  SIDEBAR_WIDTH,
  TOPBAR_HEIGHT,
  darkTokens,
  getSemanticTokens,
  lightTokens,
  type SemanticTokens,
} from './tokens';

function leafKeys(value: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, val]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (val !== null && typeof val === 'object') {
      return leafKeys(val as Record<string, unknown>, path);
    }
    return [path];
  });
}

describe('semantic design tokens', () => {
  it('defines the exact same semantic keys for light and dark', () => {
    const lightKeys = leafKeys(lightTokens as unknown as Record<string, unknown>).sort();
    const darkKeys = leafKeys(darkTokens as unknown as Record<string, unknown>).sort();
    expect(darkKeys).toEqual(lightKeys);
  });

  it('pins the approved brand palette', () => {
    expect(lightTokens.brand.main).toBe('#3d4fcf');
    expect(lightTokens.info.main).toBe('#0b8fd9');
    expect(lightTokens.negative.main).toBe('#e04f3d');
    expect(lightTokens.positive.main).toBe('#1a9a6e');
    expect(darkTokens.brand.main).toBe('#7b8cff');
    expect(darkTokens.info.main).toBe('#4db4ef');
    expect(darkTokens.negative.main).toBe('#f07162');
    expect(darkTokens.positive.main).toBe('#3dca96');
  });

  it('pins the approved semantic surfaces and text', () => {
    expect(lightTokens.bg).toBe('#f4f5f9');
    expect(lightTokens.surface).toBe('#ffffff');
    expect(lightTokens.border).toBe('#dce0ec');
    expect(lightTokens.text).toBe('#151828');
    expect(darkTokens.bg).toBe('#0e1016');
    expect(darkTokens.surface).toBe('#181b26');
    expect(darkTokens.border).toBe('#2c3142');
    expect(darkTokens.text).toBe('#f0f2f8');
  });

  it('pins the web shell from the design canvas', () => {
    expect(lightTokens.surfaceHover).toBe('#f6f7fb');
    expect(darkTokens.surfaceHover).toBe('#1d2130');
    expect({ SIDEBAR_WIDTH, TOPBAR_HEIGHT, CONTENT_MAX_WIDTH }).toEqual({
      SIDEBAR_WIDTH: 248,
      TOPBAR_HEIGHT: 68,
      CONTENT_MAX_WIDTH: 1320,
    });
  });

  it('pins the chart tokens from the design canvas: one series colour, a grid, an inverse tooltip', () => {
    expect(lightTokens.chart).toEqual({
      series: '#3d4fcf',
      seriesSoft: '#c9cff7',
      grid: '#e6e9f2',
    });
    expect(darkTokens.chart).toEqual({
      series: '#6f80f5',
      seriesSoft: '#343c6e',
      grid: '#262a39',
    });
    expect(lightTokens.inverse).toEqual({ bg: '#151828', text: '#f4f5f9' });
    expect(darkTokens.inverse).toEqual({ bg: '#f0f2f8', text: '#151828' });
  });

  it('uses light-on-dark text for contained buttons in dark mode', () => {
    expect(lightTokens.brand.contrastText).toBe('#ffffff');
    expect(darkTokens.brand.contrastText).toBe('#0e1016');
    expect(darkTokens.info.contrastText).toBe('#0e1016');
  });

  it('keeps the boarding-pass strip indigo in both modes', () => {
    for (const tokens of [lightTokens, darkTokens]) {
      expect(tokens.strip.bg).toContain('linear-gradient');
      expect(tokens.strip.perforation).toBeTruthy();
      expect(tokens.strip.stub).toBeTruthy();
    }
    expect(lightTokens.strip.bg).not.toBe(darkTokens.strip.bg);
  });

  it('returns the token set matching the requested mode', () => {
    const light: SemanticTokens = getSemanticTokens('light');
    const dark: SemanticTokens = getSemanticTokens('dark');
    expect(light.mode).toBe('light');
    expect(dark.mode).toBe('dark');
    expect(getSemanticTokens('light')).toBe(lightTokens);
    expect(getSemanticTokens('dark')).toBe(darkTokens);
  });
});
