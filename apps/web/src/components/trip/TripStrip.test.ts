import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import TripStrip from './TripStrip';

/* The Trip strip's Currencies (#729), rendered to static markup. */

const markup = (currencies?: string[], extra: Record<string, unknown> = {}) =>
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
  );
const strip = (currencies?: string[], extra: Record<string, unknown> = {}) =>
  text(markup(currencies, extra));

const STRIP = createAppTheme('light').palette.strip;

/** The style rules of the element whose only text is `shown`. */
function rulesOf(html: string, shown: string): string {
  const escaped = shown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const classes =
    new RegExp(`<\\w+\\b[^>]*class="([^"]*)"[^>]*>${escaped}<`).exec(html)?.[1]?.split(' ') ?? [];
  return [...html.matchAll(/\.(css-[\w-]+)\{([^}]*)\}/g)]
    .filter(([, name]) => classes.includes(name))
    .map(([, , rule]) => rule)
    .join('');
}

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
  it('shows Dates, the Members count and Currency, and never the invite code', () => {
    const shown = strip(['JPY'], { inviteCode: 'SECRET42' });
    expect(shown).toContain('Dates 2–12 Oct');
    expect(shown).toContain('Members 3');
    expect(shown).toContain('Currency JPY');
    expect(shown).not.toContain('Lisbon and Tokyo 2–12 Oct');
    expect(shown).not.toContain('SECRET42');
    expect(shown).not.toContain('Invite');
  });

  it('names the Currency even when the Group’s currencies weren’t given', () => {
    expect(strip(undefined)).toContain('Currency JPY');
  });

  it('draws each label small and muted, and each value bold at 16 px in the strip’s text colour', () => {
    const html = markup(['JPY']);
    for (const label of ['Dates', 'Members', 'Currency']) {
      const rules = rulesOf(html, label);
      expect(rules).toContain('font-size:0.75rem');
      expect(rules).toContain(`color:${STRIP.muted}`);
      expect(rules).not.toContain('font-weight:700');
    }
    for (const value of ['2–12 Oct', '3', 'JPY']) {
      const rules = rulesOf(html, value);
      expect(rules).toContain('font-size:1rem');
      expect(rules).toContain('font-weight:700');
      expect(rules).toContain(`color:${STRIP.text}`);
    }
  });

  it('wraps its items below 720 px with a 12 px row gap and a 40 px column gap, from the left', () => {
    const html = markup(['JPY']);
    const row =
      /<div\b[^>]*class="([^"]*)"[^>]*data-strip-items=""/.exec(html)?.[1].split(' ') ?? [];
    const media = /@media \(max-width:719\.95px\)\{\.(css-[\w-]+)\{([^}]*)\}/g;
    const narrow = [...html.matchAll(media)]
      .filter(([, name]) => row.includes(name))
      .map(([, , rule]) => rule)
      .join('');
    expect(narrow).toContain('row-gap:12px');
    expect(narrow).toContain('column-gap:40px');
    expect(narrow).toContain('justify-content:flex-start');
  });
});
