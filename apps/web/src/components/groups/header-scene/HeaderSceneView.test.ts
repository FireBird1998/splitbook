import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { expect, it } from 'vitest';
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
const render = (category: 'trip' | 'home' = 'trip', mode: 'light' | 'dark' = 'light') =>
  renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme(mode) },
      createElement(HeaderSceneView, {
        card: headerCard(
          { ...group, category, name: category === 'home' ? 'Maple House' : group.name },
          '2026-11-15',
        ),
        art: ecoCity,
        time: 'night',
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
    '3 members',
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
    for (const part of ['Maple House', 'Household', '3 members', 'INR', 'EUR'])
      expect(words).toContain(part);
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
