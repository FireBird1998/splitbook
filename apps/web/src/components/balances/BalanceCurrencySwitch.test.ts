import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import BalanceCurrencySwitch from './BalanceCurrencySwitch';

/* The Balances currency switch (#724), rendered to static markup. */

const LISBON_AND_TOKYO = [
  { currency: 'INR', main: true, balance: -1480 },
  { currency: 'EUR', main: false, balance: -20 },
  { currency: 'JPY', main: false, balance: 8400 },
];

const render = (value = 'INR', tabs = LISBON_AND_TOKYO) =>
  renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme('light') },
      createElement(BalanceCurrencySwitch, { tabs, value, onChange: () => {} }),
    ),
  );

/** Each tab's accessible name and whether it is the one shown, in order. */
const tabsOf = (html: string) =>
  [...html.matchAll(/<button\b[^>]*role="tab"[^>]*>/g)].map(([tab]) => ({
    name: /aria-label="([^"]*)"/.exec(tab)?.[1],
    selected: /aria-selected="true"/.test(tab),
  }));

describe('the Balances currency switch (#724)', () => {
  it('shows each currency with the member’s own position in it, the main currency marked', () => {
    const html = render();
    expect(html).toMatch(/<div\b(?=[^>]*role="tablist")(?=[^>]*aria-label="Balances in")/);
    expect(text(html)).toContain(
      'INR · main You owe ₹1,480.00 EUR You owe €20.00 JPY You’re owed ¥8,400',
    );
    expect(tabsOf(html)).toEqual([
      { name: 'INR, main currency, you owe ₹1,480.00', selected: true },
      { name: 'EUR, you owe €20.00', selected: false },
      { name: 'JPY, you’re owed ¥8,400', selected: false },
    ]);
  });

  it('marks the currency shown, and says a currency the member is settled in is settled up', () => {
    const html = render('JPY', [
      { currency: 'INR', main: true, balance: 0 },
      { currency: 'JPY', main: false, balance: 8400 },
    ]);
    expect(text(html)).toContain('INR · main Settled up JPY You’re owed ¥8,400');
    expect(tabsOf(html)).toEqual([
      { name: 'INR, main currency, you’re settled up', selected: false },
      { name: 'JPY, you’re owed ¥8,400', selected: true },
    ]);
  });

  it('says nothing is converted', () => {
    expect(text(render())).toContain(
      'Each currency keeps its own balances, Debts and payments. Nothing is converted.',
    );
  });
});
