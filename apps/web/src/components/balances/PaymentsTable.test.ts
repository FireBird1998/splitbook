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
 * recorded it, by name only.
 *
 * A payment is an instant, shown in the viewer's own time zone, and the unit tests also run in
 * zones from UTC−11 to UTC+14 (#227). So the expected date and time are worked out here from
 * each instant's local calendar fields, never written for one zone.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Sun 27 Sep" (with the year when it isn't `nowYear`) and "6:15 PM", from the instant's
 * calendar fields in the zone the tests run in: an oracle that doesn't use the table's code.
 */
function localWhen(createdAt: string, nowYear = new Date().getFullYear()) {
  const at = new Date(createdAt);
  const year = at.getFullYear() === nowYear ? '' : ` ${at.getFullYear()}`;
  const hours = at.getHours();
  return {
    date: `${WEEKDAYS[at.getDay()]} ${at.getDate()} ${MONTHS[at.getMonth()]}${year}`,
    time: `${hours % 12 || 12}:${String(at.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`,
  };
}
const shownWhen = (createdAt: string) => {
  const { date, time } = localWhen(createdAt);
  return `${date} ${time}`;
};

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
        shownWhen(payments[0].createdAt),
        'Priya Shah to Sam Chen',
        '₹200.00',
        'No note',
        'Priya Shah',
      ],
      [
        shownWhen(payments[1].createdAt),
        'You to Priya Shah',
        '₹1,150.00',
        'August settle-up',
        'You',
      ],
      [shownWhen(payments[2].createdAt), 'Sam Chen to You', '₹300.00', 'No note', 'Not known'],
    ]);
    // Each date reads as weekday, day and month, then the time; last year's has its year.
    expect(rows(html).map(([when]) => when)).toEqual([
      expect.stringMatching(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}( \d{4})? \d{1,2}:\d{2} [AP]M$/),
      expect.stringMatching(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}( \d{4})? \d{1,2}:\d{2} [AP]M$/),
      expect.stringMatching(/^[A-Z][a-z]{2} \d{1,2} Aug 2025 \d{1,2}:\d{2} [AP]M$/),
    ]);
    // The instant itself, whatever the zone, for the browser and assistive technology.
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
  // Mid-June instants and a mid-July "now": the same year and month in every zone from
  // UTC−12 to UTC+14, so the year rule is tested away from any year's edges.
  const now = new Date('2026-07-15T12:00:00.000Z');

  it('leaves the year out for this year’s payments only', () => {
    const thisYear = paymentWhen('2026-06-15T12:00:00.000Z', now);
    const lastYear = paymentWhen('2025-06-15T12:00:00.000Z', now);
    expect(thisYear.date).toMatch(/^[A-Z][a-z]{2} \d{1,2} Jun$/);
    expect(lastYear.date).toMatch(/^[A-Z][a-z]{2} \d{1,2} Jun 2025$/);
    expect(thisYear).toEqual(localWhen('2026-06-15T12:00:00.000Z', 2026));
    expect(lastYear).toEqual(localWhen('2025-06-15T12:00:00.000Z', 2026));
  });

  it('shows the viewer’s own date and 12-hour time, wherever the instant falls in UTC', () => {
    for (const instant of [
      '2026-06-15T00:05:00.000Z',
      '2026-06-15T11:59:00.000Z',
      '2026-06-15T12:00:00.000Z',
      '2026-06-15T23:30:00.000Z',
    ]) {
      const when = paymentWhen(instant, now);
      expect(when).toEqual(localWhen(instant, 2026));
      expect(when.time).toMatch(/^(1[0-2]|[1-9]):[0-5]\d [AP]M$/);
    }
  });
});
