import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import PaymentsTable, { paymentWhen, type PaymentRead, type PaymentsState } from './PaymentsTable';

/*
 * Payments on the Balances tab (#312), rendered to static markup: the table's loading, error
 * and empty states, and each payment's date and time, who paid whom, amount, note and who
 * recorded it, by name only. Tests run in UTC (vitest.config.ts).
 */

const ALEX = { _id: 'a00000000000000000000001', name: 'Alex Rivera', email: 'alex@example.test' };
const SAM = { _id: 'a00000000000000000000002', name: 'Sam Chen', email: 'sam@example.test' };
const PRIYA = { _id: 'a00000000000000000000003', name: 'Priya Shah', email: 'priya@example.test' };

const payments: PaymentRead[] = [
  {
    _id: 'd00000000000000000000003',
    paidBy: PRIYA,
    paidTo: SAM,
    amount: 200,
    currency: 'INR',
    note: '',
    createdAt: '2026-09-27T18:15:00.000Z',
    createdBy: PRIYA,
  },
  {
    _id: 'd00000000000000000000002',
    paidBy: ALEX,
    paidTo: PRIYA,
    amount: 1150,
    currency: 'INR',
    note: 'August settle-up',
    createdAt: '2026-09-02T09:05:00.000Z',
    createdBy: ALEX,
  },
  {
    _id: 'd00000000000000000000001',
    paidBy: SAM,
    paidTo: ALEX,
    amount: 300,
    currency: 'INR',
    createdAt: '2025-08-10T21:40:00.000Z',
    // The recorder's account no longer exists, so the read can't name them.
    createdBy: null,
  },
];

function render(state: PaymentsState) {
  const html = renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme('light') },
      createElement(PaymentsTable, { state, viewerId: ALEX._id, onRetry: () => {} }),
    ),
  );
  return { html, text: text(html) };
}

/** Each body row's cells, as a screen reader hears them (what is aria-hidden left out). */
function rows(html: string) {
  const body = /<tbody>([\s\S]*)<\/tbody>/.exec(html)?.[1] ?? '';
  const heard = (cell: string) =>
    text(cell.replace(/<(span|div)\b[^>]*aria-hidden="true"[^>]*>[^<]*<\/\1>/g, ''));
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, row]) =>
    [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(([, cell]) => heard(cell)),
  );
}

describe('Payments', () => {
  it('lists every payment with its date and time, who paid whom, amount, note and recorder', () => {
    const { html, text: shown } = render({ status: 'ready', payments });
    expect(shown).toContain('Payments 3 recorded · already counted in the balances above');
    expect(
      [...html.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map(([, header]) => header),
    ).toEqual(['Date', 'From → to', 'Amount', 'Note', 'Recorded by']);
    expect(rows(html)).toEqual([
      [
        expect.stringMatching(/^Sun 27 Sep( 2026)? 6:15 PM$/),
        'Priya Shah to Sam Chen',
        '₹200.00',
        'No note',
        'Priya Shah',
      ],
      [
        expect.stringMatching(/^Wed 2 Sep( 2026)? 9:05 AM$/),
        'You to Priya Shah',
        '₹1,150.00',
        'August settle-up',
        'You',
      ],
      ['Sun 10 Aug 2025 9:40 PM', 'Sam Chen to You', '₹300.00', 'No note', 'Not known'],
    ]);
    expect(html).toContain('dateTime="2026-09-27T18:15:00.000Z"');
  });

  it('shows names only, never an email', () => {
    const { text: shown } = render({ status: 'ready', payments });
    expect(shown).not.toMatch(/@|example\.test/);
  });

  it('marks the viewer’s own initials, not "Y" for You', () => {
    const { html } = render({ status: 'ready', payments: [payments[1]] });
    expect(html).toMatch(/>AR<\/div>/);
  });

  it('names someone the read can’t identify as a former member', () => {
    const { html } = render({
      status: 'ready',
      payments: [{ ...payments[0], paidBy: null, paidTo: { _id: SAM._id } }],
    });
    expect(rows(html)[0][1]).toBe('Former member to Former member');
  });

  it('is loading, not empty, until the read answers', () => {
    const { html, text: shown } = render({ status: 'loading' });
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading payments"');
    expect(shown).not.toContain('No payments yet');
    expect(html).not.toContain('<table');
  });

  it('a failed read says so and offers Retry', () => {
    const { html, text: shown } = render({ status: 'error' });
    expect(html).toContain('role="alert"');
    expect(shown).toContain('Payments could not be loaded.');
    expect(shown).toContain('Retry');
  });

  it('says when nothing has been recorded yet', () => {
    const { html, text: shown } = render({ status: 'ready', payments: [] });
    expect(shown).toContain('No payments yet. Record one when someone pays.');
    expect(html).not.toContain('<table');
  });
});

describe('paymentWhen', () => {
  it('leaves the year out for this year’s payments only', () => {
    const now = new Date('2026-10-07T12:00:00.000Z');
    expect(paymentWhen('2026-09-27T18:15:00.000Z', now)).toEqual({
      date: 'Sun 27 Sep',
      time: '6:15 PM',
    });
    expect(paymentWhen('2025-09-27T08:15:00.000Z', now)).toEqual({
      date: 'Sat 27 Sep 2025',
      time: '8:15 AM',
    });
  });
});
