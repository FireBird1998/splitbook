import { getContrastRatio } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { createAppTheme } from './createAppTheme';

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
});
