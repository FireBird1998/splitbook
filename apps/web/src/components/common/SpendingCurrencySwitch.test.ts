import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import SpendingCurrencySwitch from './SpendingCurrencySwitch';

/* The Spending in switch of Insights and the Trip summary (#729), rendered to static markup. */

const LISBON_AND_TOKYO = [
  { currency: 'INR', expenseCount: 3, spentMinor: 4_860_000 },
  { currency: 'EUR', expenseCount: 11, spentMinor: 124_000 },
  { currency: 'JPY', expenseCount: 24, spentMinor: 186_000 },
];

const render = (value = 'JPY', note?: string) =>
  renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme('light') },
      createElement(SpendingCurrencySwitch, {
        currencies: LISBON_AND_TOKYO,
        mainCurrency: 'INR',
        value,
        onChange: () => {},
        note,
      }),
    ),
  );

/** Each tab's accessible name and whether it is the one shown, in order. */
const tabsOf = (html: string) =>
  [...html.matchAll(/<button\b[^>]*role="tab"[^>]*>/g)].map(([tab]) => ({
    name: /aria-label="([^"]*)"/.exec(tab)?.[1],
    selected: /aria-selected="true"/.test(tab),
  }));

describe('the Spending in switch (#729)', () => {
  it('shows each currency with what was spent in it, the main currency marked', () => {
    const html = render();
    expect(html).toMatch(/<div\b(?=[^>]*role="tablist")(?=[^>]*aria-label="Spending in")/);
    expect(text(html)).toContain('INR · main ₹48,600.00 EUR €1,240.00 JPY ¥186,000');
    expect(tabsOf(html)).toEqual([
      { name: 'INR, main currency, ₹48,600.00 spent in 3 Expenses', selected: false },
      { name: 'EUR, €1,240.00 spent in 11 Expenses', selected: false },
      { name: 'JPY, ¥186,000 spent in 24 Expenses', selected: true },
    ]);
  });

  it('says one Expense, and shows the note it is given', () => {
    const html = renderToStaticMarkup(
      createElement(
        ThemeProvider,
        { theme: createAppTheme('light') },
        createElement(SpendingCurrencySwitch, {
          currencies: [
            { currency: 'INR', expenseCount: 0, spentMinor: 0 },
            { currency: 'JPY', expenseCount: 1, spentMinor: 2_500 },
          ],
          mainCurrency: 'INR',
          value: 'JPY',
          onChange: () => {},
          note: 'Opened on JPY, the currency with the most Expenses (1).',
        }),
      ),
    );
    expect(tabsOf(html)[1].name).toBe('JPY, ¥2,500 spent in 1 Expense');
    expect(tabsOf(html)[0].name).toBe('INR, main currency, ₹0.00 spent in 0 Expenses');
    expect(text(html)).toContain('Opened on JPY, the currency with the most Expenses (1).');
  });
});
