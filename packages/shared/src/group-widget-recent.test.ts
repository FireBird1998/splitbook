import { expect, it, vi } from 'vitest';
import { groupWidget, type WidgetGroupPart, type WidgetRecentPart } from './group-widget';

const now = new Date(2026, 10, 14, 9, 41).getTime();
const group: WidgetGroupPart = {
  id: 'maple',
  name: 'Maple House',
  theme: 'home',
  archived: false,
  mainCurrency: 'INR',
  verifiedAt: now,
  balancesVerifiedAt: now,
  currencies: [
    {
      currency: 'INR',
      balanceMinor: -148000,
      payments: [
        { from: 'alex', to: 'priya', fromName: 'Alex', toName: 'Priya', amountMinor: 106000 },
        { from: 'alex', to: 'sam', fromName: 'Alex', toName: 'Sam', amountMinor: 42000 },
      ],
    },
  ],
};
const setup = {
  kind: 'group' as const,
  widgetId: 7,
  accountId: 'alex',
  groupId: 'maple',
  showRecentExpenses: true,
};
const auth = { status: 'authenticated' as const, accountId: 'alex', loading: false };
const recent: WidgetRecentPart = {
  verifiedAt: now - 180000,
  rows: [
    {
      id: 'lunch',
      kind: 'expense',
      description: 'Beach shack lunch',
      payer: 'Meera Iyer',
      payerId: 'meera',
      amountMinor: 280000,
      currency: 'INR',
      date: '2026-11-14',
    },
    {
      id: 'scooter',
      kind: 'expense',
      description: 'Scooter rental',
      payer: 'Alex Rivera',
      payerId: 'alex',
      amountMinor: 120000,
      currency: 'INR',
      date: '2026-11-14',
    },
    {
      id: 'payment',
      kind: 'settlement',
      description: 'Rohan paid Meera',
      payer: 'Rohan Kapoor',
      payerId: 'rohan',
      amountMinor: 50000,
      currency: 'INR',
      date: '2026-11-13',
    },
    {
      id: 'villa',
      kind: 'expense',
      description: 'Villa booking',
      payer: 'Alex Rivera',
      payerId: 'alex',
      amountMinor: 960000,
      currency: 'INR',
      date: '2026-11-13',
    },
  ],
};
const month = {
  month: '2026-11',
  verifiedAt: now - 360000,
  count: 12,
  mainCurrency: 'INR',
  mainCurrencyOnly: false,
  totals: [{ currency: 'INR', totalMinor: 1840000 }],
  shareMinor: 460000,
};
const view = (size = { width: 360, height: 584 }, scale = 1, values = recent) =>
  groupWidget(group, setup, size, auth, now, scale, month, values);

it('Recent is off for an old or default setup, even with a saved private part', () => {
  const off = groupWidget(
    group,
    { ...setup, showRecentExpenses: undefined },
    { width: 360, height: 584 },
    auth,
    now,
    1,
    month,
    recent,
  );
  expect(off.recent).toBeNull();
  expect(JSON.stringify(off)).not.toContain('Beach shack lunch');
});

it('Recent shows its own saved time, first names and calendar days', () => {
  const result = view();
  expect(result.recent?.saved).toBe('Saved 9:38');
  expect(result.saved).toBe('Saved 9:41');
  expect(result.recent?.rows[0]).toMatchObject({
    description: 'Beach shack lunch',
    detail: 'Meera paid\u00a0· Today',
    amount: '₹2,800.00',
  });
  expect(result.recent?.rows[1]?.detail).toBe('You paid\u00a0· Today');
  expect(result.summary).toContain('Rohan paid Meera');
  expect(result.summary).not.toContain('Iyer');
  expect(result.summary).not.toContain('Rivera');
  const sections = result.layout.sections.map((s) => s.id);
  expect(sections.indexOf('payments')).toBeLessThan(sections.indexOf('recent'));
  expect(sections.indexOf('recent')).toBeLessThan(sections.indexOf('month'));
});

it('Recent distinguishes no saved read from an empty saved list', () => {
  const missing = groupWidget(group, setup, { width: 360, height: 464 }, auth, now, 1, month);
  expect(missing.recent?.prompt).toBe('Open the Group to update');
  const empty = view(undefined, 1, { ...recent, rows: [] });
  expect(empty.recent).toMatchObject({
    prompt: null,
    empty: 'No recent Expenses or payments',
    saved: 'Saved 9:38',
  });
});

it('Hide amounts removes descriptions, names and amounts from pixels and speech', () => {
  const hidden = groupWidget(
    group,
    { ...setup, hideAmounts: true },
    { width: 360, height: 584 },
    auth,
    now,
    1,
    month,
    recent,
  );
  expect(hidden.recent?.rows).toEqual([]);
  expect(hidden.recent?.count).toBe('4\u00a0recent Expenses and payments');
  expect(hidden.hidden).toBe('Amounts, names and descriptions hidden');
  for (const secret of ['Beach shack', 'Meera', '2,800'])
    expect(JSON.stringify(hidden)).not.toContain(secret);
});

it('deleted rows never appear, including in hidden counts or speech', () => {
  const result = view(undefined, 1, {
    ...recent,
    rows: recent.rows.map((r, i) => (i === 0 ? { ...r, isDeleted: true } : r)),
  });
  expect(result.summary).not.toContain('Beach shack lunch');
  expect(result.recent?.rows.map((r) => r.id)).not.toContain('lunch');
});

it.each([1, 1.3, 2])('Recent fits all launcher sizes at %s text scale', (scale) => {
  for (const [width, height] of [
    [172, 224],
    [172, 344],
    [266, 344],
    [360, 224],
    [360, 270],
    [360, 344],
    [360, 464],
    [360, 584],
  ]) {
    const result = view({ width, height }, scale);
    const used =
      result.layout.sections.reduce((sum, s) => sum + s.height, 0) +
      Math.max(0, result.layout.sections.length - 1) * result.layout.gap;
    expect(used + result.layout.paddingVertical * 2).toBeLessThanOrEqual(height + 0.01);
    if (result.recent?.more?.startsWith('+')) expect(result.recent.rows.length).toBeGreaterThan(0);
    if (scale > 1) expect(result.layout.sections.some((s) => s.id === 'recent')).toBe(false);
  }
});

it('distinguishes matching first names by initials in speech while drawing first names', () => {
  const result = view(undefined, 1, {
    verifiedAt: now,
    rows: [
      { ...recent.rows[0], payer: 'Priya', payerId: 'priya-s', payerInitials: 'PS' },
      { ...recent.rows[1], payer: 'Priya', payerId: 'priya-k', payerInitials: 'PK' },
      {
        ...recent.rows[2],
        description: 'Priya paid Priya',
        payer: 'Priya',
        payerId: 'priya-s',
        payerInitials: 'PS',
        payee: { id: 'priya-k', firstName: 'Priya', initials: 'PK' },
      },
    ],
  });
  expect(result.summary).toContain('Priya S paid Priya K');
  expect(result.summary).toContain('Priya S paid');
  expect(result.summary).toContain('Priya K paid');
  expect(result.recent?.rows[0].detail).toContain('Priya paid');
  expect(result.recent?.rows[2].description).toBe('Priya paid Priya');
});

it('groups hidden section counts into measured rows on a full widget', () => {
  const result = groupWidget(
    group,
    { ...setup, hideAmounts: true },
    { width: 360, height: 344 },
    auth,
    now,
    1,
    month,
    recent,
  );
  expect(result.layout.hiddenHeaderBalance).toBe('You owe');
  expect(result.layout.hiddenCountRows.map((row) => row.lines.join(' '))).toEqual([
    'You pay 2 people',
    '4 recent Expenses and payments',
    '12 Expenses this Month',
  ]);
  expect(result.layout.hiddenCountsHeight).toBeGreaterThan(0);
  expect(
    result.layout.sections.some((section) => section.id === 'recent' || section.id === 'month'),
  ).toBe(false);
  expect(JSON.stringify(result)).not.toContain('Beach shack lunch');
});

it('shares name disambiguation between Payments and Recent', () => {
  const result = groupWidget(
    {
      ...group,
      currencies: [
        {
          ...group.currencies[0],
          payments: [
            {
              from: 'alex',
              to: 'priya-k',
              fromName: 'Alex',
              toName: 'Priya',
              toInitials: 'PK',
              amountMinor: 10000,
            },
          ],
        },
      ],
    },
    setup,
    { width: 360, height: 584 },
    auth,
    now,
    1,
    month,
    {
      verifiedAt: now,
      rows: [{ ...recent.rows[0], payer: 'Priya', payerId: 'priya-s', payerInitials: 'PS' }],
    },
  );
  expect(result.summary).toContain('You pay Priya K');
  expect(result.summary).toContain('Priya S paid');
});

it.each([{ currencies: [] }, { currencies: [{ currency: 'INR', balanceMinor: 0, payments: [] }] }])(
  'keeps an all-square Group with Recent and Hide amounts enabled',
  ({ currencies }) => {
    const result = groupWidget(
      { ...group, currencies },
      { ...setup, hideAmounts: true },
      { width: 360, height: 344 },
      auth,
      now,
      1,
      month,
      recent,
    );
    expect(result.state).toBe('all-square');
    expect(result.layout.hiddenHeaderBalance).toBe('You’re all square');
    expect(result.summary).toContain('Maple House');
  },
);

it('keeps normal payment heights and gives Recent two rows without an overflow line at 4×3', () => {
  const result = view({ width: 360, height: 344 });
  expect(result.payments).toHaveLength(2);
  expect(result.layout.sections.find((s) => s.id === 'payments')?.rowHeight).toBeLessThanOrEqual(
    39,
  );
  expect(result.recent?.rows.length).toBeGreaterThanOrEqual(2);
  expect(result.recent?.more).toBeNull();
});
it('Recent never displaces the payments that fit without it', () => {
  for (const height of [224, 270, 344, 464]) {
    const baseline = groupWidget(
      group,
      { ...setup, showRecentExpenses: false },
      { width: 360, height },
      auth,
      now,
    );
    const result = view({ width: 360, height });
    expect(result.payments).toHaveLength(baseline.payments.length);
  }
});
it('orders Expense and payment creation instants across midnight in the phone zone', () => {
  const resolve = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
    this: Intl.DateTimeFormat,
  ) {
    return { ...resolve.call(this), timeZone: 'Pacific/Honolulu' };
  });
  try {
    const values = {
      ...recent,
      rows: [
        {
          ...recent.rows[0],
          id: 'expense-newer',
          date: '2026-11-13',
          createdAt: '2026-11-14T03:00:00Z',
        },
        {
          ...recent.rows[0],
          id: 'payment',
          kind: 'settlement' as const,
          date: '2026-11-14T02:00:00Z',
          createdAt: '2026-11-14T02:00:00Z',
        },
        {
          ...recent.rows[0],
          id: 'expense-older',
          date: '2026-11-13',
          createdAt: '2026-11-13T23:00:00Z',
        },
      ],
    };
    const result = groupWidget(
      group,
      setup,
      { width: 360, height: 584 },
      auth,
      Date.parse('2026-11-14T04:11:00Z'),
      1,
      month,
      values,
    );
    expect(result.recent?.rows.map((r) => r.id)).toEqual([
      'expense-newer',
      'payment',
      'expense-older',
    ]);
    expect(result.recent?.rows.every((r) => r.detail.endsWith('Today'))).toBe(true);
  } finally {
    vi.restoreAllMocks();
  }
});

it('keeps the archived header first when its Recent prompt leaves spare space and no action', () => {
  const result = groupWidget(
    { ...group, archived: true },
    setup,
    { width: 360, height: 344 },
    auth,
    now,
    1,
    month,
  );
  expect(result.layout.sections[0].id).toBe('header');
  expect(result.layout.sections.some((s) => s.id === 'action')).toBe(false);
  expect(result.layout.sections.at(-1)?.id).toBe('space');
});
