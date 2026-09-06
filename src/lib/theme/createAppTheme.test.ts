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
});
