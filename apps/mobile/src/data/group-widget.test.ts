import { beforeAll, afterAll, expect, it } from 'vitest';
import { groupWidget, type WidgetGroupPart } from '@splitbook/shared/group-widget';
const previousZone = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'Asia/Kolkata';
});
afterAll(() => {
  process.env.TZ = previousZone;
});
const now = Date.parse('2026-11-08T04:11:00Z');
export const part: WidgetGroupPart = {
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
        {
          from: 'alex',
          to: 'priya',
          fromName: 'Alex',
          fromInitials: 'AR',
          toName: 'Priya',
          toInitials: 'PS',
          amountMinor: 106000,
        },
        {
          from: 'alex',
          to: 'sam',
          fromName: 'Alex',
          fromInitials: 'AR',
          toName: 'Sam',
          toInitials: 'SC',
          amountMinor: 42000,
        },
        {
          from: 'sam',
          to: 'priya',
          fromName: 'Sam',
          fromInitials: 'SC',
          toName: 'Priya',
          toInitials: 'PS',
          amountMinor: 90000,
        },
      ],
    },
  ],
};
export const setup = { kind: 'group' as const, accountId: 'alex', groupId: 'maple', widgetId: 7 };
it('shows only my Suggested payments with first names, and never a payment between others', () => {
  const view = groupWidget(
    part,
    setup,
    '4x2',
    { status: 'authenticated', accountId: 'alex', loading: false },
    now,
  );
  expect(view).toMatchObject({
    state: 'normal',
    name: 'Maple House',
    balance: 'You owe ₹1,480.00',
    payments: [
      { label: 'You pay Priya', amount: '₹1,060.00' },
      { label: 'You pay Sam', amount: '₹420.00' },
    ],
    addExpense: true,
    saved: 'Saved 9:41',
  });
});
const session = { status: 'authenticated' as const, accountId: 'alex', loading: false };
for (const size of ['2x2', '4x2', '4x3'] as const) {
  it(`keeps signed-out, expired, other-account and refused Group data private at ${size}`, () => {
    for (const status of ['signed-out', 'expired'] as const) {
      const v = groupWidget(part, setup, size, { status }, now);
      expect(v).toMatchObject({ state: status, name: null, payments: [], addExpense: false });
    }
    expect(groupWidget(part, setup, size, { ...session, accountId: 'sam' }, now)).toMatchObject({
      state: 'other-account',
      name: null,
      title: 'Set up this widget again',
      payments: [],
    });
    expect(groupWidget(null, setup, size, session, now)).toMatchObject({
      state: 'lost-access',
      name: null,
      title: 'You’re no longer in this Group',
      action: 'Choose another Group',
      payments: [],
    });
  });
  it(`shows all square, no copy, loading and final archived balances at ${size}`, () => {
    expect(groupWidget({ ...part, currencies: [] }, setup, size, session, now)).toMatchObject({
      state: 'all-square',
      balance: 'You’re all square',
    });
    expect(groupWidget(undefined, setup, size, session, now)).toMatchObject({
      state: 'no-copy',
      title: 'Nothing saved yet',
    });
    expect(groupWidget(undefined, setup, size, { ...session, loading: true }, now)).toMatchObject({
      state: 'loading',
    });
    expect(groupWidget({ ...part, archived: true }, setup, size, session, now)).toMatchObject({
      state: 'archived',
      addExpense: false,
      final: true,
    });
  });
}
it('limits compact to the people count, wide to two payments and tall to four, keeping Main currency first', () => {
  const multi = {
    ...part,
    currencies: [
      {
        currency: 'JPY',
        balanceMinor: 3000,
        payments: [
          {
            from: 'sam',
            to: 'alex',
            fromName: 'Sam',
            fromInitials: 'SC',
            toName: 'Alex',
            toInitials: 'AR',
            amountMinor: 3000,
          },
        ],
      },
      ...part.currencies,
      {
        currency: 'EUR',
        balanceMinor: 4000,
        payments: Array.from({ length: 4 }, () => ({
          from: 'priya',
          to: 'alex',
          fromName: 'Priya',
          fromInitials: 'PS',
          toName: 'Alex',
          toInitials: 'AR',
          amountMinor: 1000,
        })),
      },
    ],
  };
  expect(groupWidget(multi, setup, '4x2', session, now)).toMatchObject({
    balance: 'In 3\u00a0currencies',
    more: '+5\u00a0more\u00a0· ¥, €',
    payments: [{ label: 'You pay Priya' }, { label: 'You pay Sam' }],
  });
  expect(groupWidget(multi, setup, '4x3', session, now).payments).toHaveLength(4);
  expect(groupWidget(part, setup, '2x2', session, now)).toMatchObject({
    people: 'to 2\u00a0people',
    payments: [],
  });
  expect(groupWidget(part, setup, '4x2', session, now + 86400001)).toMatchObject({
    muted: true,
    action: 'Open to update',
  });
});
it('uses the older Group/Balances verification time and keeps data hidden across accounts', () => {
  expect(
    groupWidget({ ...part, verifiedAt: now - 86400001 }, setup, '4x2', session, now),
  ).toMatchObject({ muted: true, action: 'Open to update' });
  const view = groupWidget(part, setup, '4x2', { ...session, accountId: 'sam' }, now);
  expect(JSON.stringify(view)).not.toMatch(/Maple|Priya|Sam|1,480|1,060/);
});

it('marks incoming Suggested payments and the balance as owed to you', () => {
  const incoming = {
    ...part,
    currencies: [
      {
        currency: 'INR',
        balanceMinor: 120000,
        payments: [
          {
            from: 'priya',
            to: 'alex',
            fromName: 'Priya',
            fromInitials: 'PS',
            toName: 'Alex',
            toInitials: 'AR',
            amountMinor: 120000,
          },
        ],
      },
    ],
  };
  expect(groupWidget(incoming, setup, '4x2', session, now)).toMatchObject({
    balanceTone: 'positive',
    payments: [
      {
        label: 'Priya pays you',
        firstName: 'Priya',
        initials: 'PS',
        incoming: true,
        payment: { from: 'priya', to: 'alex', currency: 'INR' },
      },
    ],
  });
});
it('keeps the Main currency balance and an overflow label in the compact widget', () => {
  const multi = {
    ...part,
    currencies: [{ currency: 'JPY', balanceMinor: 3000, payments: [] }, ...part.currencies],
  };
  expect(groupWidget(multi, setup, '2x2', session, now)).toMatchObject({
    compactLabel: 'You owe',
    compactAmount: '₹1,480.00',
    currencyOverflow: '+1\u00a0currency',
  });
});
it('states why an archived Group cannot take another Expense and confirms an all-square Group', () => {
  expect(groupWidget({ ...part, archived: true }, setup, '4x2', session, now)).toMatchObject({
    balance: 'You owe ₹1,480.00\u00a0· final',
    description: 'Nothing more can be saved here.',
    addExpense: false,
  });
  expect(groupWidget({ ...part, currencies: [] }, setup, '4x2', session, now).description).toBe(
    'You’re all square in Maple House.',
  );
});
it('uses two initials in payment avatars without expanding the visible first names', () => {
  expect(groupWidget(part, setup, '4x2', session, now).payments).toMatchObject([
    { firstName: 'Priya', initials: 'PS' },
    { firstName: 'Sam', initials: 'SC' },
  ]);
});
it('names the currencies of payments hidden by the widget size', () => {
  const multi = {
    ...part,
    currencies: [
      ...part.currencies,
      {
        currency: 'JPY',
        balanceMinor: 3000,
        payments: [
          {
            from: 'sam',
            to: 'alex',
            fromName: 'Sam',
            fromInitials: 'SC',
            toName: 'Alex',
            toInitials: 'AR',
            amountMinor: 3000,
          },
        ],
      },
    ],
  };
  expect(groupWidget(multi, setup, '4x2', session, now).more).toBe('+1\u00a0more\u00a0· ¥');
});

it.each(['2x2', '4x2', '4x3'] as const)(
  'offers the Group-specific expired explanation and sign-in at %s',
  (size) => {
    expect(groupWidget(part, setup, size, { status: 'expired' }, now)).toMatchObject({
      state: 'expired',
      title: 'Sign in again',
      description: 'to see this Group. It comes back once you do.',
      action: 'Sign in',
      target: 'sign-in',
      name: null,
      payments: [],
    });
  },
);

it('renders an older first-name-only copy with one initial until a new read replaces it', () => {
  const legacy = {
    ...part,
    currencies: [
      {
        ...part.currencies[0],
        payments: [
          {
            from: 'alex',
            to: 'priya',
            fromName: 'Alex',
            toName: 'Priya',
            amountMinor: 106000,
          },
        ],
      },
    ],
  };
  expect(groupWidget(legacy, setup, '4x2', session, now).payments).toMatchObject([
    { firstName: 'Priya', initials: 'P' },
  ]);
});

it('Hide amounts omits stored member initials and names from the view and spoken summary', () => {
  const copy = {
    ...part,
    currencies: [
      {
        ...part.currencies[0],
        payments: [
          {
            from: 'alex',
            to: 'priya',
            fromName: 'Alex',
            fromInitials: 'AR',
            toName: 'Priya',
            toInitials: 'PS',
            amountMinor: 106000,
          },
        ],
      },
    ],
  };
  const view = groupWidget(copy, { ...setup, hideAmounts: true }, '4x3', session, now);
  expect(view.payments).toEqual([]);
  expect(JSON.stringify(view)).not.toMatch(/Priya|PS|AR|1060|1,060/);
});

it('renders no-copy when a damaged saved Group part cannot be read', () => {
  for (const damaged of [JSON.parse('{"currencies":null}'), { ...part, name: 42 }])
    expect(groupWidget(damaged, setup, '4x2', session, now)).toMatchObject({
      state: 'no-copy',
      payments: [],
      title: 'Nothing saved yet',
    });
});
