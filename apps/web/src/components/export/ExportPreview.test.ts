import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import { exportPreviewSchema, type ExportPreview } from '@splitbook/shared/export-preview';
import { buildStatement } from '@splitbook/shared/statement';
import { buildStatementPreview } from '@splitbook/shared/export-preview';
import ExportPreviewPanel, { type PreviewState } from './ExportPreview';

const csv: ExportPreview = {
  format: 'csv',
  groupNames: ['Maple House'],
  generatedAt: '2026-10-19T06:00:00.000Z',
  from: '2026-09-01',
  to: '2026-09-30',
  timeZone: 'UTC',
  empty: false,
  fileName: 'maple.csv',
  files: [
    {
      name: 'maple.csv',
      kind: 'expenses',
      header: ['Description', 'Amount', 'Currency'],
      rows: [['Groceries', '10.01', 'INR']],
      totalRows: 8,
      text: '\uFEFFDescription,Amount,Currency\r\nGroceries,10.01,INR\r\n',
    },
  ],
};
function render(state: PreviewState) {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme('light') },
      createElement(ExportPreviewPanel, { state, onRetry: vi.fn() }),
    ),
  );
}
describe('Export preview panel (#611)', () => {
  it('offers Table and Text views of the CSV preview', () => {
    const html = render({ status: 'ready', data: csv });
    expect(html).toContain('aria-label="CSV preview format"');
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Table</);
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Text</);
  });

  it('shows the CSV headers, exact first cells and remaining row count', () => {
    const html = render({ status: 'ready', data: csv });
    expect(text(html)).toContain('Preview');
    expect(text(html)).toContain('Maple House · September 2026 · CSV');
    expect(html).toContain('<th');
    expect(text(html)).toContain('Description Amount Currency');
    expect(text(html)).toContain('Groceries 10.01 INR');
    expect(text(html)).toContain('…and 7 more rows');
    expect(html).toContain('tabindex="0"');
  });
});

it('keeps no-selection, loading, empty and retryable preview failures distinct', () => {
  expect(text(render({ status: 'idle', message: 'Pick at least one Group.' }))).toContain(
    'Pick at least one Group.',
  );
  const loading = render({ status: 'loading' });
  expect(loading).toContain('aria-busy="true"');
  expect(text(loading)).toContain('Loading preview…');
  const failure = render({ status: 'error', message: 'Preview could not be loaded.' });
  expect(failure).toContain('role="alert"');
  expect(text(failure)).toContain('Preview could not be loaded.');
  expect(text(failure)).toContain('Retry');
  const empty = render({ status: 'ready', data: { ...csv, empty: true, files: [] } });
  expect(text(empty)).toContain('Nothing to export for this period.');
  expect(empty).not.toContain('<table');
});

it('shows only backup contents and states the accepted backup omission', () => {
  const html = render({
    status: 'ready',
    data: {
      format: 'json',
      groupNames: ['Maple House'],
      generatedAt: '2026-10-19T06:00:00.000Z',
      from: null,
      to: null,
      timeZone: 'UTC',
      empty: false,
      fileName: 'splitbook-1-groups-backup.json',
      sizeBytes: 1200,
      earliestMonth: '2026-04',
      historyIncluded: true,
      paymentsIncluded: true,
      deletedExpensesIncluded: true,
      counts: {
        members: 3,
        expenses: 86,
        payments: 3,
        deletedExpenses: 1,
        editHistoryEntries: 4,
      },
    },
  });
  expect(text(html)).toContain('splitbook-1-groups-backup.json');
  expect(text(html)).toContain('Approximately 1.2 KB');
  expect(text(html)).toContain('3 Members');
  expect(text(html)).toContain('86 Expenses Since April 2026, each with its edit history');
  expect(text(html)).toContain('3 Payments');
  expect(text(html)).toContain('1 Deleted Expense');
  expect(text(html)).toContain('Not included: recurring Expense templates and Activity history.');
});

it.each([
  ['UTC', 'Mon 19 Oct 2026, 6:00 AM'],
  ['Pacific/Pago_Pago', 'Sun 18 Oct 2026, 7:00 PM'],
])(
  'renders statement balances, Suggested payments and Expense allocations in %s',
  (timeZone, generated) => {
    const html = render({
      status: 'ready',
      data: {
        ...csv,
        format: 'statement',
        timeZone,
        statement: {
          id: 'maple',
          name: 'Maple House',
          theme: 'home',
          defaultCurrency: 'INR',
          from: csv.from,
          to: csv.to,
          timeZone: 'UTC',
          // Bob isn't among the names: a former member, named so.
          names: { alice: 'Alice Tester' },
          currencies: [
            {
              currency: 'INR',
              spentMinor: 7007,
              expenseCount: 7,
              paymentTotalMinor: 1000,
              paymentCount: 1,
              people: [
                {
                  id: 'alice',
                  name: 'Alice Tester',
                  paidMinor: 7007,
                  shareMinor: 3504,
                  netMinor: 3503,
                  balanceMinor: 2503,
                },
              ],
              suggestedPayments: [{ from: 'bob', to: 'alice', amountMinor: 2503 }],
              expenses: [
                {
                  id: 'expense',
                  date: '2026-09-01',
                  description: 'Groceries',
                  tag: 'Food',
                  amountMinor: 1001,
                  paidBy: [{ userId: 'alice', amountMinor: 1001 }],
                  splitBetween: [
                    { userId: 'alice', amountMinor: 501 },
                    { userId: 'bob', amountMinor: 500 },
                  ],
                },
              ],
            },
          ],
        },
      },
    });
    expect(text(html)).toContain('Maple House · Statement · September 2026');
    expect(text(html)).toContain('Household · INR · Generated');
    expect(text(html)).toContain(`Generated ${generated} (${timeZone})`);
    expect(text(html)).toContain('Spent');
    expect(text(html)).toContain('70.07');
    expect(text(html)).toContain('Member Paid Share Net');
    expect(text(html)).toContain('Current balances');
    expect(text(html)).toContain('Suggested payments');
    expect(text(html)).toContain('25.03');
    expect(text(html)).toContain('Former member pays Alice Tester');
    expect(text(html)).toContain('Paid by');
    expect(text(html)).toContain('5.01');
    expect(text(html)).toContain('5.00');
    expect(text(html)).toContain('Alice Tester');
    expect(text(html)).not.toContain('You');
    expect(text(html)).toContain('Groceries');
    expect(text(html)).toContain('…and 6 more Expenses');
    expect(text(html)).toContain('Amounts in INR, never converted');
  },
);

it('says nothing to export yet for an empty All time export', () => {
  expect(
    text(
      render({ status: 'ready', data: { ...csv, from: null, to: null, empty: true, files: [] } }),
    ),
  ).toContain('Nothing to export yet.');
});
it('shows the backup’s counts as tiles, each number above its label (#646)', () => {
  const html = render({
    status: 'ready',
    data: {
      format: 'json',
      groupNames: ['Maple House'],
      generatedAt: '2026-10-19T06:00:00.000Z',
      from: null,
      to: null,
      timeZone: 'UTC',
      empty: false,
      fileName: 'splitbook-1-groups-backup.json',
      sizeBytes: 1200,
      earliestMonth: '2026-04',
      historyIncluded: true,
      paymentsIncluded: true,
      deletedExpensesIncluded: true,
      counts: { members: 3, expenses: 86, payments: 1, deletedExpenses: 2, editHistoryEntries: 4 },
    },
  });
  const tiles = /<ul\b[^>]*aria-label="What the backup holds"[^>]*>([\s\S]*?)<\/ul>/.exec(html);
  expect(tiles).not.toBeNull();
  const items = [...tiles![1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(([, inner]) =>
    [...inner.matchAll(/<(?:p|span)\b[^>]*>([^<]*)<\/(?:p|span)>/g)].map(([, part]) => part),
  );
  expect(items).toEqual([
    ['3', 'Members'],
    ['86', 'Expenses', 'Since April 2026, each with its edit history'],
    ['1', 'Payment', 'Both amounts, currencies and stored rates'],
    ['2', 'Deleted Expenses'],
  ]);
});

it('hides Payments and Deleted Expenses when excluded from the backup', () => {
  const html = render({
    status: 'ready',
    data: {
      ...csv,
      format: 'json',
      sizeBytes: 2000000,
      earliestMonth: null,
      historyIncluded: false,
      paymentsIncluded: false,
      deletedExpensesIncluded: false,
      counts: { members: 2, expenses: 1, payments: 0, deletedExpenses: 0, editHistoryEntries: 0 },
    },
  });
  expect(text(html)).not.toContain('0 Payments');
  expect(text(html)).not.toContain('0 Deleted Expenses');
  expect(text(html)).toContain('Approximately 2 MB');
});

it('names the zip and explains blank Amount cells for edit rows', () => {
  const data: ExportPreview = {
    ...csv,
    fileName: 'export.zip',
    files: [
      { ...csv.files[0], header: ['Amount', 'Edited at'] },
      { ...csv.files[0], name: 'payments.csv', kind: 'payments' },
    ],
  };
  const html = text(render({ status: 'ready', data }));
  expect(html).toContain('In one zip, export.zip');
  expect(html).toContain('Edit rows leave Amount blank.');
});

it('says a CSV file too large to show as text can be downloaded in full (#698)', () => {
  // The reply as the server sends it: the large file comes without its text.
  const data = exportPreviewSchema.parse({
    ...csv,
    fileName: 'export.zip',
    files: [
      {
        name: 'expenses.csv',
        kind: 'expenses',
        header: ['Description', 'Amount', 'Currency'],
        rows: [['Groceries', '10.01', 'INR']],
        totalRows: 50000,
      },
      { ...csv.files[0], name: 'payments.csv', kind: 'payments' },
    ],
  });
  let renderer!: ReturnType<typeof create>;
  act(() => {
    // MUI's default theme: its ThemeProvider reads the document, which this renderer has none of.
    renderer = create(
      createElement(ExportPreviewPanel, { state: { status: 'ready', data }, onRetry: vi.fn() }),
    );
  });
  const strings = (node: ReactTestInstance | string): string =>
    typeof node === 'string' ? node : node.children.map(strings).join(' ');
  const textButton = renderer.root.find(
    (node) => node.type === 'button' && strings(node).trim() === 'Text',
  );
  act(() => textButton.props.onClick({ defaultPrevented: false, preventDefault: () => {} }));
  const shown = strings(renderer.root);
  expect(shown).toContain('This file is too large to show as text. Download it to see every row.');
  expect(shown).toContain('Groceries,10.01,INR');
  const regions = renderer.root
    .findAll((node) => node.type === 'pre')
    .map((node) => node.props['aria-label']);
  expect(regions).toEqual(['payments.csv text preview']);
  act(() => renderer.unmount());
});

it('names each currency’s balances and Suggested payments for screen readers (#698)', () => {
  const bucket = (currency: string) => ({
    currency,
    spentMinor: 1001,
    expenseCount: 1,
    paymentTotalMinor: 0,
    paymentCount: 0,
    people: [
      {
        id: 'alice',
        name: 'Alice Tester',
        paidMinor: 1001,
        shareMinor: 501,
        netMinor: 500,
        balanceMinor: 500,
      },
      { id: 'bob', name: 'Bob', paidMinor: 0, shareMinor: 500, netMinor: -500, balanceMinor: -500 },
    ],
    suggestedPayments: [{ from: 'bob', to: 'alice', amountMinor: 500 }],
    expenses: [],
  });
  const html = render({
    status: 'ready',
    data: {
      ...csv,
      format: 'statement',
      statement: {
        id: 'maple',
        name: 'Maple House',
        theme: 'home',
        defaultCurrency: 'INR',
        from: csv.from,
        to: csv.to,
        timeZone: 'UTC',
        names: { alice: 'Alice Tester', bob: 'Bob' },
        currencies: [bucket('INR'), bucket('USD')],
      },
    },
  });
  const headings = [...html.matchAll(/<h5[^>]*>([^<]*)<\/h5>/g)].map(([, heading]) => heading);
  expect(headings).toEqual([
    'Current balances (INR)',
    'Suggested payments (INR)',
    'Current balances (USD)',
    'Suggested payments (USD)',
  ]);
  expect(html).toMatch(/<ul[^>]*aria-label="INR suggested payments"/);
  expect(html).toMatch(/<ul[^>]*aria-label="USD suggested payments"/);
  expect(text(html)).toContain('Bob pays Alice Tester');
});

it('shows each currency and both stored payment amounts in the statement preview', () => {
  const statement = buildStatement({
    id: 'g',
    name: 'Fictional Europe trip',
    theme: 'trip',
    currency: 'INR',
    alternateCurrencies: ['EUR'],
    tags: [],
    names: { a: 'Alex', s: 'Sam' },
    members: [
      { id: 'a', name: 'Alex' },
      { id: 's', name: 'Sam' },
    ],
    expenses: [],
    settlements: [
      {
        id: 'p',
        at: '2026-10-21T12:00:00Z',
        fromId: 's',
        toId: 'a',
        recordedById: 's',
        currency: 'EUR',
        amountMinor: 2000,
        amountPaidMinor: 185000,
        paidCurrency: 'INR',
        appliedRate: '92.5',
        rateKind: 'entered',
      },
    ],
  });
  const html = render({
    status: 'ready',
    data: {
      format: 'statement',
      groupNames: [statement.name],
      generatedAt: '2026-10-21T12:00:00Z',
      from: null,
      to: null,
      timeZone: 'UTC',
      empty: false,
      statement: buildStatementPreview(statement),
    },
  });
  expect(html).toContain('aria-label="EUR statement preview"');
  expect(html).toContain('aria-label="INR statement preview"');
  expect(text(html)).toContain(
    'Sam paid Alex ₹1,850.00 to clear €20.00 at ₹92.50 per €; no rate suggested',
  );
});

// #820: a statement preview with an Expense in a currency Splitbook no longer supports shows its
// Spent as stored, with its code, never converted.
it('previews a statement with an Expense in a currency Splitbook no longer supports', () => {
  const statement = buildStatement({
    id: 'g',
    name: 'Fictional Berlin trip',
    theme: 'trip',
    currency: 'INR',
    tags: [],
    names: { a: 'Alex', b: 'Sam' },
    members: [
      { id: 'a', name: 'Alex' },
      { id: 'b', name: 'Sam' },
    ],
    expenses: [
      {
        id: 'e1',
        date: '2026-09-18T00:00:00.000Z',
        description: 'Old Berlin rent',
        category: 'housing',
        tag: 'Rent',
        currency: 'DEM',
        amountMinor: 4000,
        splitMethod: 'equal',
        paidBy: [{ userId: 'a', amountMinor: 4000 }],
        splitBetween: [
          { userId: 'a', amountMinor: 2000 },
          { userId: 'b', amountMinor: 2000 },
        ],
      },
    ],
    settlements: [],
  });
  const html = render({
    status: 'ready',
    data: {
      format: 'statement',
      groupNames: [statement.name],
      generatedAt: '2026-10-21T12:00:00Z',
      from: null,
      to: null,
      timeZone: 'UTC',
      empty: false,
      statement: buildStatementPreview(statement),
    },
  });
  const shown = text(html);
  expect(shown).toMatch(/DEM\s40\.00/);
  // Its members by name, and no position.
  expect(shown).toMatch(/Alex[\s\S]*Sam/);
  expect(shown).not.toContain('Former member');
  expect(shown).toContain(
    'DEM is a currency Splitbook no longer supports, so this money isn’t in Balances.',
  );
  expect(shown).not.toContain('Settled up.');
  expect(shown).not.toContain('Current balances');
});

it('collapses settled empty statement currencies to the same one-line preview', () => {
  const statement = buildStatement({
    id: 'g',
    name: 'Fictional empty trip',
    theme: 'trip',
    currency: 'INR',
    alternateCurrencies: ['JPY'],
    tags: [],
    names: { a: 'Alex' },
    members: [{ id: 'a', name: 'Alex' }],
    expenses: [],
    settlements: [],
  });
  const html = render({
    status: 'ready',
    data: {
      format: 'statement',
      groupNames: [statement.name],
      generatedAt: '2026-10-21T12:00:00Z',
      from: null,
      to: null,
      timeZone: 'UTC',
      empty: true,
      statement: buildStatementPreview(statement),
    },
  });
  expect(text(html)).toContain('JPY: nothing in this period; everyone is settled up.');
  expect(text(html)).toContain('INR: nothing in this period; everyone is settled up.');
  expect(html).not.toContain('<table');
});

it('places the cross-currency column note beneath the payments preview table only', () => {
  const note = 'Cross-currency payments add Amount paid, Paid currency and Rate';
  const html = render({
    status: 'ready',
    data: { ...csv, files: [{ ...csv.files[0], kind: 'payments', name: 'payments.csv' }] },
  });
  expect(text(html)).toContain(note);
  expect(html.indexOf(note)).toBeGreaterThan(html.indexOf('</table>'));
  expect(text(render({ status: 'ready', data: csv }))).not.toContain(note);
});

it.each([0, 1, 2])(
  'uses the correct Expense and Payment plurals for %s in the backup preview',
  (count) => {
    const html = render({
      status: 'ready',
      data: {
        format: 'json',
        groupNames: ['Fictional trip'],
        generatedAt: '2026-10-21T12:00:00Z',
        from: null,
        to: null,
        timeZone: 'UTC',
        empty: false,
        fileName: 'backup.json',
        sizeBytes: 1000,
        earliestMonth: null,
        historyIncluded: true,
        paymentsIncluded: true,
        deletedExpensesIncluded: false,
        counts: {
          members: 2,
          expenses: count,
          payments: count,
          deletedExpenses: 0,
          editHistoryEntries: 0,
        },
      },
    });
    expect(text(html)).toContain(
      `${count} ${count === 1 ? 'Expense' : 'Expenses'} Each with its edit history`,
    );
    expect(text(html)).toContain(
      `${count} ${count === 1 ? 'Payment' : 'Payments'} Both amounts, currencies and stored rates`,
    );
  },
);

// #906: a member who owes reads "−₹35.03" in the statement preview's Net and Current balances,
// the app's "−" kept to its figure (#899), never Intl's hyphen-minus "-₹35.03".
it('writes a statement preview’s negative Net and balance with the app’s “−” (#906)', () => {
  const statement = buildStatement(
    {
      id: 'maple',
      name: 'Maple House',
      theme: 'home',
      currency: 'INR',
      members: [
        { id: 'alice', name: 'Alice Tester' },
        { id: 'bob', name: 'Bob Tester' },
      ],
      names: { alice: 'Alice Tester', bob: 'Bob Tester' },
      tags: [],
      expenses: [
        {
          id: 'expense',
          date: '2026-09-01T00:00:00.000Z',
          description: 'Groceries',
          category: 'food',
          tag: 'Food',
          currency: 'INR',
          amountMinor: 7006,
          splitMethod: 'equal',
          paidBy: [{ userId: 'alice', amountMinor: 7006 }],
          splitBetween: [
            { userId: 'alice', amountMinor: 3503 },
            { userId: 'bob', amountMinor: 3503 },
          ],
        },
      ],
      settlements: [],
    },
    { timeZone: 'UTC' },
  );
  const page = text(
    render({
      status: 'ready',
      data: {
        ...csv,
        format: 'statement',
        timeZone: 'UTC',
        statement: buildStatementPreview(statement),
      },
    }),
  );
  expect(page).toContain('Bob Tester ₹0.00 ₹35.03 −⁠₹35.03');
  expect(page).toContain('Alice Tester ₹70.06 ₹35.03 ₹35.03');
  expect(page).toMatch(/Bob Tester −⁠₹35\.03/);
  expect(page).not.toMatch(/-₹/);
});

it('writes a statement preview’s period and Expense dates as the statement does, “14 Sep 2026” (#907)', () => {
  const statement = buildStatement(
    {
      id: 'maple',
      name: 'Maple House',
      theme: 'home',
      currency: 'INR',
      members: [{ id: 'alice', name: 'Alice Tester' }],
      names: { alice: 'Alice Tester' },
      tags: [],
      expenses: [
        {
          id: 'expense',
          date: '2026-09-14T00:00:00.000Z',
          description: 'Groceries',
          category: 'food',
          tag: 'Food',
          currency: 'INR',
          amountMinor: 7006,
          splitMethod: 'equal',
          paidBy: [{ userId: 'alice', amountMinor: 7006 }],
          splitBetween: [{ userId: 'alice', amountMinor: 7006 }],
        },
      ],
      settlements: [],
    },
    { timeZone: 'UTC' },
  );
  const html = render({
    status: 'ready',
    data: {
      ...csv,
      from: '2026-09-01',
      to: '2026-09-20',
      format: 'statement',
      timeZone: 'UTC',
      statement: buildStatementPreview(statement),
    },
  });
  const page = text(html);
  expect(page).toContain('Maple House · Statement · 1 Sep 2026 – 20 Sep 2026');
  expect(page).toContain('Maple House · 1 Sep 2026 – 20 Sep 2026 · Statement');
  expect(page).toContain('14 Sep 2026 Groceries');
  expect(page).not.toMatch(/2026-09-/);
  // Day and month joined by a no-break space, as on the printed statement (text() folds it).
  expect(html).toContain('1\u00A0Sep 2026 – 20\u00A0Sep 2026');
  expect(html).toContain('>14\u00A0Sep 2026<');
});

// #916: the statement preview writes its payment and generated times as the statement writes a
// payment's time, "Fri 6 Nov 2026, 12:40 PM" (zonedDateTime), in the export's time zone.
it('writes a statement preview’s payment and generated times as the statement does (#916)', () => {
  const statement = buildStatement(
    {
      id: 'maple',
      name: 'Maple House',
      theme: 'home',
      currency: 'INR',
      tags: [],
      names: { a: 'Alex', s: 'Sam' },
      members: [
        { id: 'a', name: 'Alex' },
        { id: 's', name: 'Sam' },
      ],
      expenses: [],
      settlements: [
        {
          id: 'p',
          at: '2026-11-06T07:10:00Z',
          fromId: 's',
          toId: 'a',
          recordedById: 's',
          currency: 'INR',
          amountMinor: 2000,
        },
      ],
    },
    { timeZone: 'Asia/Kolkata' },
  );
  const html = render({
    status: 'ready',
    data: {
      format: 'statement',
      groupNames: [statement.name],
      generatedAt: '2026-11-06T18:35:00Z',
      from: null,
      to: null,
      timeZone: 'Asia/Kolkata',
      empty: false,
      statement: buildStatementPreview(statement),
    },
  });
  const page = text(html);
  expect(page).toContain('Fri 6 Nov 2026, 12:40 PM Sam paid Alex ₹20.00');
  expect(page).toContain('Generated Sat 7 Nov 2026, 12:05 AM (Asia/Kolkata)');
  expect(page).not.toMatch(/\d{4} at \d/);
});

// #916: the statement preview's Expenses fit the Export card as the statement's do: its columns in
// the statement's order, with the Tag under the Description rather than a column of its own.
it('lays out a statement preview’s Expenses as the statement does, Tag under the Description (#916)', () => {
  const statement = buildStatement(
    {
      id: 'maple',
      name: 'Maple House',
      theme: 'home',
      currency: 'INR',
      members: [
        { id: 'alice', name: 'Alice Tester' },
        { id: 'bob', name: 'Bob Tester' },
      ],
      names: { alice: 'Alice Tester', bob: 'Bob Tester' },
      tags: [],
      expenses: [
        {
          id: 'expense',
          date: '2026-09-14T00:00:00.000Z',
          description: 'Groceries',
          category: 'food',
          tag: 'Food',
          currency: 'INR',
          amountMinor: 7006,
          splitMethod: 'equal',
          paidBy: [{ userId: 'alice', amountMinor: 7006 }],
          splitBetween: [
            { userId: 'alice', amountMinor: 3503 },
            { userId: 'bob', amountMinor: 3503 },
          ],
        },
      ],
      settlements: [],
    },
    { timeZone: 'UTC' },
  );
  const html = render({
    status: 'ready',
    data: {
      ...csv,
      format: 'statement',
      statement: buildStatementPreview(statement),
    },
  });
  const table = /<table\b[^>]*aria-label="INR first Expenses"[^>]*>([\s\S]*?)<\/table>/.exec(html);
  expect(table).not.toBeNull();
  const headers = [...table![1].matchAll(/<th\b[^>]*scope="col"[^>]*>([^<]*)<\/th>/g)].map(
    ([, header]) => header,
  );
  expect(headers).toEqual(['Date', 'Description', 'Paid by', 'Amount', 'Share']);
  // The Description heads its row, its Tag beneath it.
  expect(text(table![1])).toContain(
    '14 Sep 2026 Groceries Food Alice Tester ₹70.06 ₹70.06 Alice Tester ₹35.03 Bob Tester ₹35.03',
  );
  expect(table![1]).toMatch(/<th\b[^>]*scope="row"[^>]*>Groceries</);
});
