import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getContrastRatio, ThemeProvider } from '@mui/material/styles';
import { expect, it } from 'vitest';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import { headerCard } from '@splitbook/shared/group-header';
import ecoCity from '@splitbook/shared/header-scenes/eco-city';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import HeaderSceneView from './HeaderSceneView';

const group = {
  name: 'Goa Friends Trip',
  category: 'trip' as const,
  defaultCurrency: 'INR',
  alternateCurrencies: ['EUR'],
  members: [{}, {}, {}],
  startDate: '2026-11-14',
  endDate: '2026-11-16',
};
const render = (
  category: 'trip' | 'home' = 'trip',
  mode: 'light' | 'dark' = 'light',
  today = '2026-11-15',
  time: 'morning' | 'day' | 'sunset' | 'night' = 'night',
) =>
  renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme(mode) },
      createElement(HeaderSceneView, {
        card: headerCard(
          { ...group, category, name: category === 'home' ? 'Maple House' : group.name },
          today,
          time,
        ),
        art: ecoCity,
        time,
      }),
    ),
  );
it('keeps a Trip’s route, dates, members, currencies and today as readable text', () => {
  const html = render();
  const words = text(html);
  for (const part of [
    'Goa Friends Trip',
    'Trip',
    'GOA',
    'TRI',
    '14–16 Nov 2026',
    'INR',
    'EUR',
    'Day 2 of 3',
  ])
    expect(words).toContain(part);
  expect(html).toContain('aria-current="date"');
  expect(html).toContain('aria-label="Day 2, today"');
  expect(html).not.toContain('<button');
});
it.each(['light', 'dark'] as const)(
  'shows a Household’s own facts without Trip facts in %s theme',
  (mode) => {
    const html = render('home', mode);
    const words = text(html);
    for (const part of ['Maple House', 'Household', 'INR', 'EUR']) expect(words).toContain(part);
    expect(words).not.toContain('GOA');
    expect(words).not.toContain('Dates');
    expect(html).not.toContain('aria-label="Trip days"');
  },
);
it('describes the scene in one sentence while its vector layers stay decorative', () => {
  const html = render();
  expect(html).toContain(`role="img" aria-label="${ecoCity.description}"`);
  expect(html).toContain('aria-hidden="true"');
});

it('shows the member count as a number that still reads as members', () => {
  const html = render();
  expect(html).toContain('aria-label="3\u00a0members"');
  expect(text(html)).toMatch(/Members 3 Currencies/);
});
it.each([
  ['2026-11-12', /Starts in 2\sdays/],
  ['2026-11-20', /Trip over\s· 3\sdays/],
])('on %s explains the empty day squares with “%s”', (today, caption) => {
  expect(text(render('trip', 'light', today))).toMatch(caption);
});
it('centres the island on a phone-width header instead of slicing it from the left', () => {
  const html = render();
  expect(html).toContain('calc(50% - 262.5px)');
});

it.each(['light', 'dark'] as const)(
  'uses shared card tone across all times in %s theme',
  (mode) => {
    for (const time of ['morning', 'day', 'sunset', 'night'] as const) {
      const html = render('trip', mode, '2026-11-15', time);
      const tone = headerCard(group, '2026-11-15', time).tone;
      expect(html).toContain(`data-scene-card="${tone}"`);
      if (tone === 'dark') {
        const dark = getSemanticTokens('dark');
        expect(getContrastRatio(dark.text, dark.surface)).toBeGreaterThanOrEqual(4.5);
        expect(getContrastRatio(dark.textSecondary, dark.surface)).toBeGreaterThanOrEqual(4.5);
        expect(html).toContain(`color:${dark.text}`);
        expect(html).toContain(`background-color:${dark.surface}`);
        expect(html).toContain(`color:${getSemanticTokens('dark').textSecondary}`);
        expect(html).toContain(`border-color:${getSemanticTokens('dark').border}`);
      }
    }
  },
);
