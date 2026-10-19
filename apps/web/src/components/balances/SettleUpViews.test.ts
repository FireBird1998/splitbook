import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import SettleUpViews, { type Debt } from './SettleUpViews';

const alex = { _id: 'alex', name: 'Alex Rivera' };
const sam = { _id: 'sam', name: 'Sam Chen' };
const priya = { _id: 'priya', name: 'Priya Shah' };
const debts: Debt[] = [
  { from: alex, to: sam, amount: 880 },
  { from: alex, to: priya, amount: 600 },
  { from: priya, to: sam, amount: 180 },
];
function render(
  initialView: 'suggested' | 'before' = 'suggested',
  list: Debt[] | undefined = debts,
  suggestedCount = 2,
  viewerId = 'alex',
  legacy = false,
) {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme('light') },
      createElement(
        SettleUpViews,
        {
          currency: 'INR',
          viewerId,
          debts: legacy ? undefined : list,
          suggestedCount,
          initialView,
        },
        suggestedCount === 0
          ? createElement('p', null, 'Everyone is settled up in INR.')
          : createElement(
              'ul',
              { 'aria-label': 'Suggested payments' },
              createElement(
                'li',
                null,
                'You pay Sam Chen ₹1,060.00',
                createElement('button', null, 'Record'),
              ),
            ),
      ),
    ),
  );
}

describe('Settle up views', () => {
  it('shows the paid-payment subtitle only in Suggested', () => {
    expect(text(render())).toContain('INR · Record one once it’s paid');
    expect(text(render('before'))).not.toContain('Record one once it’s paid');
    expect(text(render('before', debts, 0))).not.toContain('Record one once it’s paid');
    expect(text(render('before', undefined, 2, 'alex', true))).toContain(
      'Record one once it’s paid',
    );
  });
  it('keeps the settled-up message and hides the switch even if pairwise Debts form a cycle', () => {
    const html = render('before', debts, 0);
    expect(text(html)).toContain('Everyone is settled up in INR.');
    expect(html).not.toContain('aria-pressed');
  });
  it('starts on Suggested with a labelled toggle and preserves the existing actions', () => {
    const html = render();
    expect(html).toContain('aria-label="Settle up view"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>Suggested</);
    expect(html).toContain('aria-label="Suggested payments"');
    expect(text(html)).toContain('You pay Sam Chen ₹1,060.00 Record');
    expect(html).not.toContain('aria-label="Debts before simplifying"');
  });
  it('shows each Debt as a sentence with exact amounts and no Record action', () => {
    const html = render('before');
    expect(html).toContain('aria-label="Debts before simplifying"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>Before simplifying</);
    expect(text(html)).toContain('You owe Sam Chen ₹880.00');
    expect(text(html)).toContain('You owe Priya Shah ₹600.00');
    expect(text(html)).toContain('Priya Shah owes Sam Chen ₹180.00');
    expect(text(html)).not.toContain('Record');
    expect(html).not.toContain('aria-label="Suggested payments"');
  });
  it.each(['suggested', 'before'] as const)(
    'shows the fewer-payments note as plain text in %s',
    (view) => {
      const html = render(view);
      expect(text(html)).toContain(
        '2 payments settle the same 3 debts. Everyone ends settled up either way.',
      );
      expect(html).not.toContain('aria-live');
      expect(html).not.toContain('role="status"');
    },
  );
  it('uses you as the recipient and the singular payment form', () => {
    const html = render('before', debts, 1, 'sam');
    expect(text(html)).toContain('Priya Shah owes you ₹180.00');
    expect(text(html)).toContain('1 payment settles the same 3 debts.');
  });
  it('hides the note when simplifying does not save payments', () => {
    expect(text(render('before', debts, 3))).not.toContain('Everyone ends settled up either way.');
  });
  it('keeps old replies on Suggested without a switch or note', () => {
    const html = render('before', undefined, 2, 'alex', true);
    expect(html).not.toContain('aria-pressed');
    expect(html).toContain('aria-label="Suggested payments"');
    expect(text(html)).not.toContain('Everyone ends settled up either way.');
  });
});
