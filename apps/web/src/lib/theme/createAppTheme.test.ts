import { getContrastRatio, getLuminance, hexToRgb } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { createAppTheme } from './createAppTheme';

/** A `#rrggbb` colour's hue, in degrees. */
function hue(color: string): number {
  const [r, g, b] = hexToRgb(color)
    .match(/\d+/g)!
    .map((channel) => Number(channel) / 255);
  const max = Math.max(r, g, b);
  const range = max - Math.min(r, g, b);
  if (range === 0) return 0;
  const sector =
    max === r ? (g - b) / range : max === g ? (b - r) / range + 2 : (r - g) / range + 4;
  return (sector * 60 + 360) % 360;
}

describe.each(['light', 'dark'] as const)('%s visual theme', (mode) => {
  it('keeps small status text readable on its tint and ordinary surfaces', () => {
    const theme = createAppTheme(mode);
    for (const tone of ['positive', 'negative', 'warning', 'info'] as const) {
      const foreground = theme.palette.status[tone];
      for (const background of [
        theme.palette.tint[tone],
        theme.palette.background.paper,
        theme.palette.background.default,
      ]) {
        expect(
          getContrastRatio(foreground, background),
          `${tone} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps the shell sidebar readable on its hover and current fills', () => {
    const { palette } = createAppTheme(mode);
    const pairs = {
      'link on the sidebar': [palette.text.secondary, palette.surface.elevated],
      'hovered link': [palette.text.primary, palette.surface.hover],
      'current link': [palette.primary.main, palette.tint.brand],
      'current Group, you owe': [palette.status.negative, palette.tint.brand],
      'current Group, owed': [palette.status.positive, palette.tint.brand],
      'current Group, settled': [palette.text.secondary, palette.tint.brand],
      'hovered Group, you owe': [palette.status.negative, palette.surface.hover],
      'hovered Group, owed': [palette.status.positive, palette.surface.hover],
    };
    for (const [pair, [foreground, background]] of Object.entries(pairs))
      expect(getContrastRatio(foreground, background), pair).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps chart text readable and the series colour visible', () => {
    const { palette } = createAppTheme(mode);
    const text = {
      'tooltip text on the inverse surface': [palette.inverse.text, palette.inverse.bg],
      'y-axis labels on a card': [palette.text.disabled, palette.background.paper],
      'x-axis labels on a card': [palette.text.secondary, palette.background.paper],
    };
    for (const [pair, [foreground, background]] of Object.entries(text))
      expect(getContrastRatio(foreground, background), pair).toBeGreaterThanOrEqual(4.5);
    // A graphic, not text: WCAG 1.4.11 asks 3:1 against what is next to it.
    expect(getContrastRatio(palette.chart.series, palette.background.paper)).toBeGreaterThanOrEqual(
      3,
    );
  });

  it('keeps the soft series visible on a card, softer than the series, in the same hue (#308)', () => {
    const { palette } = createAppTheme(mode);
    const { series, seriesSoft } = palette.chart;
    // The columns that aren't in focus are graphics too: 3:1 on a card and on the sidebar.
    for (const surface of [palette.background.paper, palette.surface.elevated])
      expect(getContrastRatio(seriesSoft, surface), surface).toBeGreaterThanOrEqual(3);
    // Still plainly not the series colour: the current Month stands out.
    expect(getContrastRatio(series, seriesSoft)).toBeGreaterThanOrEqual(1.5);
    const towardCard = (color: string) =>
      Math.abs(getLuminance(color) - getLuminance(palette.background.paper));
    expect(towardCard(seriesSoft)).toBeLessThan(towardCard(series));
    // One hue: a lighter or darker series colour, never a second colour.
    expect(Math.abs(hue(seriesSoft) - hue(series))).toBeLessThanOrEqual(2);
  });

  it('styles every chart from the theme: grid, axes and tooltip', () => {
    const { components, palette } = createAppTheme(mode);
    expect(components?.MuiChartsGrid?.styleOverrides?.line).toMatchObject({
      stroke: palette.chart.grid,
    });
    expect(components?.MuiChartsTooltip?.styleOverrides?.paper).toMatchObject({
      backgroundColor: palette.inverse.bg,
      color: palette.inverse.text,
    });
  });

  it('draws owed and owes bars that stay visible on a card, in the status hues (#313)', () => {
    const { palette } = createAppTheme(mode);
    const { positive, negative } = palette.diverging;
    // Bars are graphics, not text: WCAG 1.4.11 asks 3:1 against the card they sit on.
    for (const [bar, color] of Object.entries({ positive, negative }))
      expect(getContrastRatio(color, palette.background.paper), bar).toBeGreaterThanOrEqual(3);
    // The same meaning as everywhere else: owed is the positive hue, owes the negative one.
    expect(positive).toBe(palette.success.main);
    expect(negative).toBe(palette.error.main);
    expect(positive).not.toBe(negative);
  });
});
