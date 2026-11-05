import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import TripStrip from './TripStrip';

/* The Trip strip's Currencies (#729), rendered to static markup. */

const strip = (currencies?: string[], extra: Record<string, unknown> = {}) =>
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
          ...extra,
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

describe('the full Trip strip (#646)', () => {
  it('shows Dates, Members and Currency, and never the invite code', () => {
    const shown = strip(['JPY'], { memberNames: ['You', 'Sam', 'Priya'], inviteCode: 'SECRET42' });
    expect(shown).toContain('Dates 2–12 Oct');
    expect(shown).toContain('Members You · Sam · Priya');
    expect(shown).toContain('Currency JPY');
    expect(shown).not.toContain('Lisbon and Tokyo 2–12 Oct');
    expect(shown).not.toContain('SECRET42');
    expect(shown).not.toContain('Invite');
  });

  it('names the Currency even when the Group’s currencies weren’t given', () => {
    expect(strip(undefined)).toContain('Currency JPY');
  });
});
