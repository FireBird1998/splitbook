import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import CurrencySwitch from './CurrencySwitch';

describe('the shared currency switch (#757)', () => {
  it('keeps caller-provided figures, names, selection and panel links in light and dark', () => {
    for (const mode of ['light', 'dark'] as const) {
      const html = renderToStaticMarkup(
        createElement(
          ThemeProvider,
          { theme: createAppTheme(mode) },
          createElement(CurrencySwitch, {
            tabs: [
              {
                currency: 'INR',
                main: true,
                id: 'balances-tab-INR',
                figure: 'Settled up',
                accessibleName: 'INR, main currency, you’re settled up',
              },
              {
                currency: 'EUR',
                main: false,
                id: 'balances-tab-EUR',
                figure: 'You owe €20.00',
                accessibleName: 'EUR, you owe €20.00',
              },
            ],
            value: 'EUR',
            onChange: () => {},
            label: 'Balances in',
            panelId: 'balances-panel',
            note: 'Nothing is converted.',
            noteMaxWidth: 300,
          }),
        ),
      );
      expect(html).toMatch(/<div\b(?=[^>]*role="tablist")(?=[^>]*aria-label="Balances in")/);
      expect(text(html)).toContain(
        'INR · main Settled up EUR You owe €20.00 Nothing is converted.',
      );
      const tabs = [...html.matchAll(/<button\b[^>]*role="tab"[^>]*>/g)].map(([tab]) => ({
        id: /\bid="([^"]*)"/.exec(tab)?.[1],
        name: /aria-label="([^"]*)"/.exec(tab)?.[1],
        panel: /aria-controls="([^"]*)"/.exec(tab)?.[1],
        selected: /aria-selected="true"/.test(tab),
      }));
      expect(tabs).toEqual([
        {
          id: 'balances-tab-INR',
          name: 'INR, main currency, you’re settled up',
          panel: 'balances-panel',
          selected: false,
        },
        {
          id: 'balances-tab-EUR',
          name: 'EUR, you owe €20.00',
          panel: 'balances-panel',
          selected: true,
        },
      ]);
    }
  });
});
