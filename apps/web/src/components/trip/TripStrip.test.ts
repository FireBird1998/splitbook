import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import TripStrip from './TripStrip';

/* The Trip strip's Currencies (#729), rendered to static markup. */

const strip = (currencies?: string[]) =>
  text(
    renderToStaticMarkup(
      createElement(
        ThemeProvider,
        { theme: createAppTheme('light') },
        createElement(TripStrip, {
          name: 'Lisbon and Tokyo',
          currency: 'JPY',
          variant: 'full',
          dateLabel: '2–12 Oct',
          memberCount: 3,
          currencies,
          tripTotal: { amount: 2500, currency: 'JPY' },
        }),
      ),
    ),
  );

describe('the Trip strip (#729)', () => {
  it('lists the Group’s currencies when it has more than one, and its total in the currency shown', () => {
    expect(strip(['INR', 'EUR', 'JPY'])).toContain('Currencies INR · EUR · JPY');
    expect(strip(['INR', 'EUR', 'JPY'])).toContain('¥2,500');
  });

  it('lists no currencies for a Group with one', () => {
    expect(strip(['INR'])).not.toContain('Currencies');
  });
});
