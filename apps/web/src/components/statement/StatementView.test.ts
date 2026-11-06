import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { buildStatement } from '@splitbook/shared/statement';
import type { BackupExpenseInput, BackupGroupInput } from '@splitbook/shared/export-backup';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { images, stylesOf, text } from '@/lib/test-utils/markup';
import StatementView from './StatementView';
import { statementSummary } from './statement-summary';

/*
 * A whole-trip statement (#319, opened from Share wrap-up), rendered as the server renders it:
 * Expenses dated outside the Trip's dates count in Spent and are named as the Trip summary
 * names them (#316), "Before the trip" and "After the trip". Fictional people and figures.
 */

const STATEMENT_CSS = fileURLToPath(
  new URL('../../app/(main)/groups/[id]/statement/statement.css', import.meta.url),
);
const ALEX = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';

function expense(
  id: string,
  day: string,
  description: string,
  minor: number,
  [category, tag] = ['transport', 'Transport'],
) {
  return {
    id,
    date: `${day}T00:00:00.000Z`,
    description,
    category,
    tag,
    currency: 'INR',
    amountMinor: minor,
    splitMethod: 'equal',
    paidBy: [{ userId: ALEX, amountMinor: minor }],
    splitBetween: [
      { userId: ALEX, amountMinor: minor / 2 },
      { userId: SAM, amountMinor: minor / 2 },
    ],
  } satisfies BackupExpenseInput;
}

const TRIP: BackupGroupInput = {
  id: 'c00000000000000000000001',
  name: 'Ferry to the islands',
  theme: 'trip',
  currency: 'INR',
  startDate: '2026-09-17T00:00:00.000Z',
  endDate: '2026-09-20T00:00:00.000Z',
  members: [
    { id: ALEX, name: 'Alex Rivera' },
    { id: SAM, name: 'Sam Chen' },
  ],
  names: { [ALEX]: 'Alex Rivera', [SAM]: 'Sam Chen' },
  tags: [],
  expenses: [
    expense('e1', '2026-08-30', 'Ferry tickets, booked early', 60000),
    expense('e2', '2026-09-18', 'Island guesthouse', 120000, ['food', 'Food']),
    expense('e3', '2026-09-22', 'Late taxi refund share', 4000),
  ],
  settlements: [
    {
      id: 'p1',
      at: '2026-09-22T12:00:00.000Z',
      fromId: ALEX,
      toId: SAM,
      amountMinor: 40000,
      currency: 'INR',
      recordedById: ALEX,
      note: 'Settled after returning home',
    },
  ],
};

function render(wholeTrip: boolean) {
  const statement = buildStatement(TRIP, {
    timeZone: 'Asia/Kolkata',
    wholeTrip,
    ...(wholeTrip ? { from: '2026-09-17', to: '2026-09-20' } : {}),
  });
  return text(
    renderToStaticMarkup(
      createElement(
        ThemeProvider,
        { theme: createAppTheme('light') },
        createElement(StatementView, { statement }),
      ),
    ),
  );
}

describe('a whole-trip statement', () => {
  it('counts Expenses outside the Trip’s dates in Spent, named as the Trip summary names them', () => {
    const page = render(true);
    expect(page).toContain('Ferry to the islands · Statement');
    expect(page).toContain('17 Sep 2026 – 20 Sep 2026 · INR · Asia/Kolkata');
    expect(page).toContain('Whole trip, including Expenses before and after the Trip’s dates.');
    expect(page).toContain('Spent ₹1,840.00 Expenses 3 Payments ₹400.00 1 payment');
    expect(page).toContain('Before the trip: ₹600.00 · 1 Expense, counted in Spent');
    expect(page).toContain('After the trip: ₹40.00 · 1 Expense, counted in Spent');
    expect(page).toContain('30 Aug 2026 Before the trip Ferry tickets, booked early');
    expect(page).toContain('18 Sep 2026 Island guesthouse');
    expect(page).toContain('22 Sep 2026 After the trip Late taxi refund share');
    expect(page).not.toMatch(/\bYou\b/);
  });

  it('names each Expense’s Category as the Expense panel and CSV do, beside its Tag (#509)', () => {
    const page = render(true);
    expect(page).toContain('18 Sep 2026 Island guesthouse Food & Drink · Food');
    expect(page).toContain('Ferry tickets, booked early Transport · Transport');
  });

  it('names nothing outside the Trip’s dates in a statement for a period', () => {
    const page = render(false);
    expect(page).toContain('All time');
    expect(page).not.toMatch(/Before the trip|After the trip|Whole trip/);
    expect(page).toContain('Spent ₹1,840.00 Expenses 3 Payments ₹400.00 1 payment');
  });

  it('lists and marks a post-trip Payment with its recorder and whole-trip scope', () => {
    const payments = render(true).split('Payments by date')[1];
    expect(payments).toContain(
      'Every recorded payment, including those before and after the trip.',
    );
    expect(payments).toContain(
      'Tue 22 Sep 2026, 5:30 PM After the trip Alex Rivera Sam Chen ₹400.00 Settled after returning home Alex Rivera',
    );
    expect(render(true)).toContain('Payments ₹400.00 1 payment');
  });
});

// #646 (W2): the printed statement as the board draws it: the 24 px logo above the title, a row
// of figures for the summary, and the Export preview's table headings.
describe('the printed statement’s look', () => {
  const html = () =>
    renderToStaticMarkup(
      createElement(
        ThemeProvider,
        { theme: createAppTheme('light') },
        createElement(StatementView, {
          statement: buildStatement(TRIP, { timeZone: 'Asia/Kolkata' }),
        }),
      ),
    );

  it('has the 24 px logo, light and dark, above the title', () => {
    const page = html();
    const logos = images(page);
    expect(logos.map((logo) => [logo.src, logo.alt, logo.style.height])).toEqual([
      [expect.stringContaining('logo-light.svg'), 'Splitbook', '24px'],
      [expect.stringContaining('logo-dark.svg'), 'Splitbook', '24px'],
    ]);
    expect(page.indexOf('logo-light.svg')).toBeLessThan(page.indexOf('<h1'));
    expect(page).toContain('class="statement-logo');
  });

  it('shows the summary as a row of figures, not “Spent:” lines', () => {
    const page = html();
    expect(page).toContain('aria-label="INR summary"');
    expect(text(page)).not.toMatch(/Spent:|Expenses:|Payments:/);
  });

  it('heads its tables as the Export preview does: Member, Paid, Share and Net', () => {
    const page = text(html());
    expect(page).toContain('Member Paid Share Net');
    expect(page).toContain('Member Balance');
    expect(page).not.toContain('Person');
  });
});

describe('the statement summary’s figures (#646, W2)', () => {
  it('gives Spent, the Expense count and the payments’ total with their count, exact', () => {
    const [bucket] = buildStatement(TRIP, { timeZone: 'Asia/Kolkata' }).currencies;
    expect(statementSummary(bucket)).toEqual([
      { label: 'Spent', amountMinor: 184000 },
      { label: 'Expenses', count: 3 },
      { label: 'Payments', amountMinor: 40000, note: '1\u00a0payment' },
    ]);
  });

  it('counts several payments, and none', () => {
    const [bucket] = buildStatement(
      {
        ...TRIP,
        settlements: [TRIP.settlements[0], { ...TRIP.settlements[0], id: 'p2', amountMinor: 5 }],
      },
      { timeZone: 'Asia/Kolkata' },
    ).currencies;
    expect(statementSummary(bucket)[2]).toEqual({
      label: 'Payments',
      amountMinor: 40005,
      note: '2\u00a0payments',
    });
    const [none] = buildStatement({ ...TRIP, settlements: [] }).currencies;
    expect(statementSummary(none)[2]).toEqual({
      label: 'Payments',
      amountMinor: 0,
      note: 'No payments',
    });
  });
});

it('renders every currency section for printing with both cross-currency payment amounts', () => {
  const statement = buildStatement({
    ...TRIP,
    alternateCurrencies: ['EUR'],
    settlements: [
      {
        ...TRIP.settlements[0],
        currency: 'EUR',
        amountMinor: 2000,
        amountPaidMinor: 185000,
        paidCurrency: 'INR',
        appliedRate: '92.5',
        rateKind: 'entered',
      },
    ],
  });
  const html = renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme('light') },
      createElement(StatementView, { statement }),
    ),
  );
  expect(html).toContain('aria-label="EUR statement"');
  expect(html).toContain('aria-label="INR statement"');
  expect(text(html)).toContain(
    'Alex Rivera paid Sam Chen ₹1,850.00 to clear €20.00 at ₹92.50 per €; no rate suggested',
  );
});

it('prints a settled empty currency as one line while retaining an outstanding balance outside the period', () => {
  const statement = buildStatement(
    { ...TRIP, alternateCurrencies: ['JPY'] },
    { from: '2027-01-01', to: '2027-01-31' },
  );
  const html = renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme('light') },
      createElement(StatementView, { statement }),
    ),
  );
  const jpy =
    html.match(/<section[^>]*aria-label="JPY statement"[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? '';
  expect(text(jpy)).toBe('JPY: nothing in this period; everyone is settled up.');
  expect(jpy).not.toContain('<table');
  expect(html).toContain('aria-label="Current balances"');
});

// #820: an Expense in a currency Splitbook no longer supports, such as a legacy DEM row, gets a
// Spent line of its own, as stored at 2 places and never converted, and no position (#810, #812).
describe('a statement with an Expense in a currency Splitbook no longer supports (#820)', () => {
  it('lists it under its own Spent, with its code, and no one’s position', () => {
    const marks = { ...expense('e9', '2026-09-18', 'Old Berlin rent', 4000), currency: 'DEM' };
    const statement = buildStatement(
      { ...TRIP, expenses: [...TRIP.expenses, marks] },
      { timeZone: 'Asia/Kolkata' },
    );
    expect(statement.currencies.find((bucket) => bucket.currency === 'DEM')).toMatchObject({
      spentMinor: 4000,
      expenseCount: 1,
      people: [],
      suggestedPayments: [],
    });
    const shown = text(
      renderToStaticMarkup(
        createElement(
          ThemeProvider,
          { theme: createAppTheme('light') },
          createElement(StatementView, { statement }),
        ),
      ),
    );
    expect(shown).toMatch(/Old Berlin rent[\s\S]*DEM\s40\.00/);
    // The DEM section, first of the two: its members by name, and no position.
    const dem = shown.slice(shown.indexOf('DEM Amounts stay'), shown.indexOf('INR Amounts stay'));
    expect(dem).toContain('Alex Rivera');
    expect(dem).toContain('Sam Chen');
    expect(dem).not.toContain('Former member');
    expect(dem).toContain(
      'DEM is a currency Splitbook no longer supports, so this money isn’t in Balances.',
    );
    expect(dem).not.toContain('Settled up.');
    expect(dem).not.toContain('Paid, Share and Net');
    expect(dem).not.toContain('Balances and suggested payments');
  });
});

function tripHtml(statement = buildStatement(TRIP, { timeZone: 'Asia/Kolkata' })) {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme('light') },
      createElement(StatementView, { statement }),
    ),
  );
}

// #646 follow-up: on the real A4 sheet "₹54,000.00" broke as "₹54,000. / 00" and a date as
// "2026-06- / 05". Figures and dates never wrap; number columns are right-aligned; only the
// free text (Description, Note) and a long name (#928) wrap, and on screen a wide table scrolls
// inside the sheet.
describe('the statement’s table cells', () => {
  it('writes a payment’s date and time as a reader would, never as ISO (#646)', () => {
    const html = tripHtml();
    // In the statement's own time zone, day and month kept together, on one line, on the web's
    // 12-hour clock with the time kept beside AM or PM.
    expect(html).toMatch(/class="statement-when">Tue 22\u00a0Sep 2026, 5:30\u00a0PM</);
    expect(html).not.toContain('2026-09-22T17:30:00+05:30');
  });

  // #907: the Expenses' dates read as the web writes a date, as the payments' times beside them
  // do, never ISO. An Expense's date is a calendar day (#437): no zone moves it.
  it('writes each Expense’s date as the web does, day and month kept together (#907)', () => {
    const html = tripHtml();
    const expenses = html.slice(
      html.indexOf('aria-label="Expense details"'),
      html.indexOf('aria-label="Dated payments"'),
    );
    const days = [...expenses.matchAll(/class="statement-when">([^<]*)</g)].map(([, day]) => day);
    expect(days).toEqual(['30 Aug 2026', '18 Sep 2026', '22 Sep 2026']);
    expect(expenses).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  // #907: the period in the header, in the same words, each day on one line.
  it('writes the period’s days as the web does, each kept on one line (#907)', () => {
    const html = tripHtml(
      buildStatement(TRIP, { timeZone: 'Asia/Kolkata', from: '2026-09-14', to: '2026-09-20' }),
    );
    const days = stylesOf(html, 'statement-period-day');
    expect(days).toHaveLength(2);
    for (const day of days) expect(day.value('white-space')).toBe('nowrap');
    const head = html.slice(html.indexOf('</h1>'), html.indexOf('statement-controls'));
    expect(head).toMatch(
      /class="statement-period-day[^"]*">14 Sep 2026<\/span> – <span class="statement-period-day[^"]*">20 Sep 2026</,
    );
    expect(text(head)).toContain('14 Sep 2026 – 20 Sep 2026 · INR · Asia/Kolkata');
    expect(head).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('keeps each currency’s balances and Suggested payments together in print (#646)', () => {
    const html = tripHtml();
    const blocks = [...html.matchAll(/class="statement-keep-together[^"]*"[^>]*>/g)];
    expect(blocks).toHaveLength(1);
    const block = html.slice(blocks[0].index);
    const end = block.indexOf('</section>');
    expect(block.indexOf('aria-label="Current balances"')).toBeGreaterThan(-1);
    expect(block.indexOf('aria-label="Current balances"')).toBeLessThan(end);
    expect(block.indexOf('aria-label="INR suggested payments"')).toBeGreaterThan(-1);
    expect(block.indexOf('aria-label="INR suggested payments"')).toBeLessThan(end);
    // The section's opening sentence goes with them: left outside, it and the heading above it
    // could print at the foot of one page with the balances on the next. Nothing but the block
    // follows the heading, whose own break-after keeps it with the block.
    const heading = html.indexOf('>Balances and suggested payments</h3>');
    expect(heading).toBeGreaterThan(-1);
    expect(html.slice(heading + '>Balances and suggested payments</h3>'.length)).toMatch(
      /^<div class="statement-keep-together/,
    );
    expect(block.indexOf('Current all-time positions')).toBeGreaterThan(-1);
    expect(block.indexOf('Current all-time positions')).toBeLessThan(end);
    const css = readFileSync(STATEMENT_CSS, 'utf8');
    const print = css.slice(css.indexOf('@media print'));
    expect(print).toMatch(/\.statement-keep-together\s*\{[^}]*break-inside:\s*avoid/);
  });

  it('keeps every amount on one line, right-aligned, header and cells alike', () => {
    const money = stylesOf(tripHtml(), 'statement-money');
    // Paid, Share, Net and Balance per person, each table's headers, and every Amount.
    expect(money.length).toBeGreaterThan(10);
    for (const cell of money) {
      expect(cell.value('white-space')).toBe('nowrap');
      expect(cell.value('text-align')).toBe('right');
    }
  });

  it('never breaks inside a figure, as MoneyText may elsewhere', () => {
    const amounts = stylesOf(tripHtml(), 'statement-amount');
    expect(amounts.length).toBeGreaterThan(10);
    for (const amount of amounts) {
      expect(amount.value('white-space')).toBe('nowrap');
      expect(amount.value('overflow-wrap')).toBe('normal');
    }
  });

  it('keeps each date and date-time on one line', () => {
    const dates = stylesOf(tripHtml(), 'statement-date');
    // The Expenses' and Payments' headers, 3 Expense dates and 1 Payment's.
    expect(dates).toHaveLength(6);
    for (const cell of dates) expect(cell.value('white-space')).toBe('nowrap');
  });

  it('keeps each name beside its amount in Paid by and Share', () => {
    const lines = stylesOf(tripHtml(), 'statement-line');
    // 3 Expenses: one payer and two shares each.
    expect(lines).toHaveLength(9);
    for (const line of lines) {
      expect(line.value('white-space')).toBe('nowrap');
      expect(line.value('display')).toBe('flex');
    }
  });

  it('lets only Description wrap in the Expenses table', () => {
    const html = tripHtml();
    const expenses = html.slice(html.indexOf('aria-label="Expense details"'));
    const headers = [...expenses.matchAll(/<th class="([^"]*)"[^>]*scope="col"[^>]*>([^<]*)</g)]
      .slice(0, 5)
      .map(([, classes, label]) => [
        label,
        /statement-(date|wrap|people|money)/.exec(classes)?.[1],
      ]);
    expect(headers).toEqual([
      ['Date', 'date'],
      ['Description', 'wrap'],
      ['Paid by', 'people'],
      ['Amount', 'money'],
      ['Share', 'people'],
    ]);
    // Its cells wrap; its heading, like every heading, stays on one line.
    const wrapping = stylesOf(html, 'statement-wrap').filter((cell) => !cell.heading);
    expect(wrapping).toHaveLength(4);
    for (const cell of wrapping) expect(cell.value('white-space')).toBe('normal');
    // So on screen a table wider than the sheet scrolls inside it, never squeezing a figure.
    const regions = stylesOf(html, 'statement-table-region');
    expect(regions).toHaveLength(4);
    for (const region of regions) expect(region.value('overflow-x')).toBe('auto');
  });

  // #646: the on-screen A4 sheet leaves print's 180 mm for its tables, and at full screen type
  // the Expenses table was wider: "$413.50" showed as "$413" behind a hidden scrollbar. From the
  // md breakpoint the sheet's tables take print's type and padding; a phone's still scroll.
  it('sets the sheet’s tables as print does, on screen from md', () => {
    const css = readFileSync(STATEMENT_CSS, 'utf8');
    const md = createAppTheme('light').breakpoints.values.md;
    const query = `@media print, screen and (min-width: ${md}px)`;
    expect(css).toContain(query);
    const block = css.slice(css.indexOf(query));
    const rule = (selector: string) =>
      new RegExp(`${selector.replace(/[.*]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(block)?.[1] ?? '';
    expect(rule('.statement-paper table')).toMatch(/font-size:\s*9pt/);
    expect(rule('.statement-paper table *')).toMatch(/font-size:\s*inherit/);
    expect(rule('.statement-paper td')).toMatch(/padding:\s*3pt 4pt/);
    // Print keeps no copy of its own that could drift from the screen's.
    const print = css.slice(css.indexOf('@media print {'), css.indexOf(query));
    expect(print).not.toMatch(/font-size:\s*9pt/);
  });

  // #907 (#910's polish): 7.5 pt is about 10 px, below the app's smallest type on screen. The
  // Category · Tag caption is 11 px (8.25 pt) on screen and keeps 7.5 pt in print.
  it('sets the caption at 8.25 pt on screen and 7.5 pt in print (#907)', () => {
    const css = readFileSync(STATEMENT_CSS, 'utf8');
    const caption = /\.statement-paper table \.MuiTypography-caption\s*\{([^}]*)\}/g;
    const query = '@media print, screen and (min-width: 900px)';
    const shared = css.slice(css.indexOf(query));
    expect(caption.exec(shared)?.[1]).toMatch(/font-size:\s*8\.25pt\s*!important/);
    // Print's own size comes after the shared block, so print takes it.
    const printOnly = shared.slice(shared.indexOf('@media print {'));
    expect(shared.indexOf('@media print {')).toBeGreaterThan(0);
    caption.lastIndex = 0;
    expect(caption.exec(printOnly)?.[1]).toMatch(/font-size:\s*7\.5pt\s*!important/);
  });

  // #907 (#910's polish): the right-aligned Amount heading ran into the left-aligned one after
  // it ("Amount Share", "Amount Note"). The column after an amount has more room on its left.
  it('gives the column after Amount more room on its left (#907)', () => {
    const html = tripHtml();
    for (const [table, next] of [
      ['Expense details', 'Share'],
      ['Dated payments', 'Note'],
    ]) {
      const region = html.slice(html.indexOf(`aria-label="${table}"`));
      const labels = [...region.matchAll(/<th class="([^"]*)"[^>]*scope="col"[^>]*>([^<]*)</g)];
      const amount = labels.findIndex(([, , label]) => label === 'Amount');
      expect(labels[amount][1]).toContain('statement-money');
      expect(labels[amount + 1][2]).toBe(next);
      expect(labels[amount + 1][1]).not.toContain('statement-money');
    }
    const css = readFileSync(STATEMENT_CSS, 'utf8');
    const block = css
      .slice(css.indexOf('@media print, screen and (min-width: 900px)'))
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const [, selectors = '', body = ''] =
      /\}\s*((?:[^{}]*?\.statement-money \+[^{}]*))\{([^}]*)\}/.exec(block) ?? [];
    // Under the heading, and in each row, whether its Amount is a figure or a cross-currency
    // payment's sentence, so the Note column's left edge stays one line.
    expect(selectors.split(',').map((selector) => selector.trim())).toEqual([
      '.statement-paper th.statement-money + :not(.statement-money)',
      '.statement-paper td.statement-money + :not(.statement-money)',
      '.statement-paper td.statement-sentence + td',
    ]);
    expect(body).toMatch(/padding-left:\s*10pt\s*!important/);
  });
});

// #646 follow-up: the summary is one ruled strip with dividers and small uppercase labels, as
// the board's summary strip, not three rounded cards.
describe('the summary strip', () => {
  it('is one ruled strip, with a divider between figures and no rounded cards', () => {
    const html = tripHtml();
    const [strip] = stylesOf(html, 'statement-summary');
    expect(strip.value('border-top')).toBe('1px solid');
    expect(strip.value('border-bottom')).toBe('1px solid');
    expect(strip.value('border-radius')).toBeUndefined();
    expect(strip.nested.some((rule) => /^>\*\+\*/.test(rule.selector))).toBe(true);
    const items = stylesOf(html, 'statement-summary-item');
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.value('border-radius')).toBeUndefined();
      expect(item.value('border')).toBeUndefined();
    }
  });

  it('labels each figure in small uppercase', () => {
    const labels = stylesOf(tripHtml(), 'statement-summary-label');
    expect(labels).toHaveLength(3);
    for (const label of labels) {
      expect(label.value('text-transform')).toBe('uppercase');
      expect(label.value('font-size')).toBe('0.6875rem');
    }
  });
});

// #906: a negative figure carries the app's "−", joined to it with a word joiner as the rest of
// the app writes a sign (#899), never Intl's hyphen-minus. Positive figures stay unsigned.
it('writes a negative figure with the app’s “−” kept to its figure, and a positive one unsigned (#906)', () => {
  const page = render(false);
  // Sam paid nothing and shares half of ₹1,840.00: Net −₹920.00.
  expect(page).toContain('Sam Chen ₹0.00 ₹920.00 −⁠₹920.00');
  expect(page).toContain('Alex Rivera ₹1,840.00 ₹920.00 ₹920.00');
  expect(page).toContain('Member Balance Alex Rivera ₹1,320.00 Sam Chen −\u2060₹1,320.00');
  expect(page).not.toMatch(/-₹/);
});

// #918: with one payer, Paid by names them and no more, since Amount beside it has the same
// figure; with several, each payer keeps their own amount.
it('names a single payer in Paid by without the Amount, and gives several payers each theirs (#918)', () => {
  const shared = {
    ...expense('e4', '2026-09-19', 'Snorkelling trip', 90000, ['entertainment', 'Fun']),
    paidBy: [
      { userId: ALEX, amountMinor: 60000 },
      { userId: SAM, amountMinor: 30000 },
    ],
  };
  const page = text(
    tripHtml(
      buildStatement(
        { ...TRIP, expenses: [...TRIP.expenses, shared] },
        { timeZone: 'Asia/Kolkata' },
      ),
    ),
  );
  expect(page).toContain(
    '18 Sep 2026 Island guesthouse Food & Drink · Food Alex Rivera ₹1,200.00 Alex Rivera ₹600.00 Sam Chen ₹600.00',
  );
  expect(page).toContain(
    'Snorkelling trip Entertainment · Fun Alex Rivera ₹600.00 Sam Chen ₹300.00 ₹900.00 Alex Rivera ₹450.00 Sam Chen ₹450.00',
  );
});

// #928: a long name such as "Priyamvada Venkataraghavan-Subramaniam" stayed on one line in Paid by
// and Share, so the Expenses table grew past the sheet: on screen Share scrolled, and in print
// (which never scrolls) it ran past the page's margin. A long name wraps between its words and
// after its hyphen, never inside a word, beside its amount, which stays on one line. An everyday
// name stays whole, as #646 sets it, however long the Description beside it.
it('lets a long name wrap in Paid by and Share, and keeps an everyday one and every amount whole (#928)', () => {
  const longName = 'Priyamvada Venkataraghavan-Subramaniam';
  const html = tripHtml(
    buildStatement(
      {
        ...TRIP,
        members: [TRIP.members[0], { id: SAM, name: longName }],
        names: { ...TRIP.names, [SAM]: longName },
      },
      { timeZone: 'Asia/Kolkata' },
    ),
  );
  expect(text(html)).toContain(
    `Island guesthouse Food & Drink · Food Alex Rivera ₹1,200.00 Alex Rivera ₹600.00 ${longName} ₹600.00`,
  );
  // 3 Expenses: one payer (Alex) and two shares each, one of them the long name's.
  const names = stylesOf(html, 'statement-name');
  expect(names).toHaveLength(9);
  const written = [...html.matchAll(/class="[^"]*statement-name[^"]*"[^>]*>([^<]*)</g)].map(
    ([, name]) => name,
  );
  expect(written.filter((name) => name === longName)).toHaveLength(3);
  names.forEach((name, i) => {
    // Never inside a word.
    expect(name.value('overflow-wrap')).toBeUndefined();
    expect(name.value('word-break')).toBeUndefined();
    expect(name.value('white-space')).toBe(written[i] === longName ? 'normal' : 'nowrap');
  });
  // The amounts never wrap.
  const amounts = stylesOf(html, 'statement-amount');
  expect(amounts.length).toBeGreaterThan(10);
  for (const amount of amounts) expect(amount.value('white-space')).toBe('nowrap');
});
