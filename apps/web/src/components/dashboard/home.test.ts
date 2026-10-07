import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig, unstable_serialize } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import type { HomeCurrencyBalance } from '@splitbook/shared/dashboard';
import type { HomeSuggestedPaymentRead } from '@splitbook/shared/home-balances-read';
import type { GroupRead } from '@splitbook/shared/group-read';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { groupReadKey } from '@/lib/group-read-key';
import { anchors, text } from '@/lib/test-utils/markup';
import { BalancesCardView, groupCountLabel } from './BalancesCard';
import { HomeHeaderView, homeStatusLine } from './HomeHeader';
import { HomeRow } from './HomeCard';
import { NeedsYouCardView, paymentTitle, recordPaymentHref } from './NeedsYouCard';
import { invitationDetail } from './InvitationRow';
import {
  readInvitations,
  type CardRead,
  type HomeBalances,
  type HomeInvitation,
} from './home-reads';

/*
 * Home's top section (#306), rendered to static markup as the server renders it: each card's
 * loading, failed, empty and loaded states, and the page's order with the reads supplied
 * through SWR's fallback. Fictional people and Groups throughout.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: vi.fn() }),
}));
// The Group card grid stays until #308; its cards aren't what these tests look at.
vi.mock('@/components/groups/GroupCard', () => ({
  default: ({ group }: { group: GroupRead }) => createElement('article', null, group.name),
}));

const { default: DashboardView } = await import('./DashboardView');

const USER = { id: 'a00000000000000000000001', name: 'Alex Rivera' };
const id = (n: number) => `c0000000000000000000000${n}`;
const SAM = 'a00000000000000000000002';
const PRIYA = 'a00000000000000000000003';

function render(element: ReactElement, mode: 'light' | 'dark' = 'light', fallback = {}) {
  return renderToStaticMarkup(
    createElement(
      SWRConfig,
      { value: { fallback } },
      createElement(ThemeProvider, { theme: createAppTheme(mode) }, element),
    ),
  );
}

const noop = () => {};
const loading = { status: 'loading' } as const;
const failed = { status: 'error' } as const;
const ready = <T>(value: T): CardRead<T> => ({ status: 'ready', value });

/** The region a card's heading labels: its markup, from the heading to the section's end. */
function region(html: string, heading: string): string {
  const headingAt = html.indexOf(`>${heading}</h2>`);
  expect(headingAt, `the ${heading} heading`).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<section', headingAt);
  const end = html.indexOf('</section>', headingAt);
  return html.slice(start, end);
}

const INR: HomeCurrencyBalance = {
  currency: 'INR',
  netMinor: -86_000,
  youOweMinor: 148_000,
  owedToYouMinor: 62_000,
  groupCount: 3,
};
const EUR: HomeCurrencyBalance = {
  currency: 'EUR',
  netMinor: 4250,
  youOweMinor: 0,
  owedToYouMinor: 4250,
  groupCount: 1,
};

const balancesCard = (balances: CardRead<HomeBalances>, mode: 'light' | 'dark' = 'light') =>
  render(createElement(BalancesCardView, { balances, onRetry: noop }), mode);

describe('Your balances', () => {
  it('shows each currency on its own: Net, large and signed, then You owe and Owed to you, and its Groups', () => {
    for (const mode of ['light', 'dark'] as const) {
      const html = balancesCard(ready({ currencies: [INR, EUR], groupCount: 5 }), mode);
      expect(text(html)).toBe(
        'Your balances Each currency on its own. Nothing is converted. ' +
          'INR 3 Groups Net −₹860.00 You owe ₹1,480.00 Owed to you ₹620.00 ' +
          'EUR 1 Group Net +€42.50 You owe €0.00 Owed to you €42.50',
      );
      expect(html).toMatch(/<section[^>]*aria-labelledby="home-balances-heading"/);
      expect(html.match(/role="group"/g)).toHaveLength(2);
    }
  });

  it('nets to zero without a sign when what is owed both ways is equal', () => {
    const html = balancesCard(
      ready({
        currencies: [
          {
            currency: 'INR',
            netMinor: 0,
            youOweMinor: 10_000,
            owedToYouMinor: 10_000,
            groupCount: 2,
          },
        ],
        groupCount: 2,
      }),
    );
    expect(text(html)).toContain('Net ₹0.00 You owe ₹100.00 Owed to you ₹100.00');
  });

  it('announces loading, with no figure and no empty state', () => {
    const html = balancesCard(loading);
    expect(html).toContain('role="status" aria-label="Loading your balances"');
    expect(text(html)).not.toMatch(/₹|settled|No balances/);
  });

  it('fails on its own with a safe message and Try again', () => {
    const html = balancesCard(failed);
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain('Your balances could not be loaded. Try again');
    expect(text(html)).not.toMatch(/₹|settled/);
  });

  it('is calm and settled when the member owes and is owed nothing', () => {
    const html = balancesCard(ready({ currencies: [], groupCount: 4 }));
    expect(text(html)).toContain(
      'You’re settled up Nobody owes you, and you owe nobody, in any of your Groups.',
    );
    expect(html).not.toContain('role="alert"');
  });

  it('says there are no balances yet to a member without Groups', () => {
    expect(text(balancesCard(ready({ currencies: [], groupCount: 0 })))).toContain(
      'No balances yet Create or join a Group',
    );
  });

  it('counts Groups in the singular and plural', () => {
    expect(groupCountLabel(1)).toBe('1 Group');
    expect(groupCountLabel(2)).toBe('2 Groups');
  });
});

const payment = (overrides: Partial<HomeSuggestedPaymentRead>): HomeSuggestedPaymentRead => ({
  groupId: id(1),
  groupName: 'Maple House',
  currency: 'INR',
  direction: 'pay',
  counterpartyId: SAM,
  counterpartyName: 'Sam Chen',
  amountMinor: 106_000,
  ...overrides,
});
const PAYMENTS = [
  payment({}),
  payment({ counterpartyId: PRIYA, counterpartyName: 'Priya Shah', amountMinor: 42_000 }),
  payment({
    groupId: id(2),
    groupName: 'Goa Friends Trip',
    direction: 'receive',
    amountMinor: 62_000,
  }),
];
const INVITATION: HomeInvitation = {
  id: 'd00000000000000000000001',
  groupName: 'Diwali at Priya’s',
  category: 'other',
  invitedByName: 'Priya Shah',
};

const needsYou = (
  payments: CardRead<HomeSuggestedPaymentRead[]>,
  invitations: CardRead<HomeInvitation[]>,
) =>
  render(
    createElement(NeedsYouCardView, {
      payments,
      invitations,
      memberName: USER.name,
      onRetryPayments: noop,
      onRetryInvitations: noop,
      onInvitationAnswered: noop,
    }),
  );

describe('Needs you', () => {
  it('lists every suggested payment with the other person, its Group, the amount and Record, then invitations', () => {
    const html = needsYou(ready(PAYMENTS), ready([INVITATION]));
    expect(text(html)).toBe(
      'Needs you 4 items ' +
        'AR SC You pay Sam Chen Maple House · suggested payment ₹1,060.00 Record ' +
        'AR PS You pay Priya Shah Maple House · suggested payment ₹420.00 Record ' +
        'SC AR Sam Chen pays you Goa Friends Trip · suggested payment ₹620.00 Record ' +
        'Diwali at Priya’s Invitation from Priya Shah · General Join Decline',
    );
    // Record opens the payment's Group on its Balances.
    expect(anchors(html).map(({ href }) => href)).toEqual([
      `/groups/${id(1)}/balances`,
      `/groups/${id(1)}/balances`,
      `/groups/${id(2)}/balances`,
    ]);
    expect(html).toContain(
      'aria-label="Record payment: You pay Sam Chen, ₹1,060.00, in Maple House"',
    );
    expect(html).toContain('aria-label="Join Diwali at Priya’s"');
    expect(html).toContain('aria-label="Decline Diwali at Priya’s"');
    expect(html).toMatch(/<ul[^>]*aria-label="Needs you"/);
    expect(html.match(/<li\b/g)).toHaveLength(4);
  });

  it('is calm when nothing needs the member: no payments and no invitations', () => {
    const html = needsYou(ready([]), ready([]));
    expect(text(html)).toBe(
      'Needs you Nothing needs you No payments to make or receive, and no invitations waiting.',
    );
    expect(html).not.toContain('role="alert"');
  });

  it('announces loading while both reads are pending, and claims nothing', () => {
    const html = needsYou(loading, loading);
    expect(html).toContain('role="status" aria-label="Loading what needs you"');
    expect(text(html)).not.toMatch(/Nothing needs you|Record|Join/);
  });

  it('shows the invitations while the payments still load, and the other way round', () => {
    const invitationsFirst = needsYou(loading, ready([INVITATION]));
    expect(invitationsFirst).toContain('aria-label="Loading suggested payments"');
    expect(text(invitationsFirst)).toContain('Diwali at Priya’s');
    expect(text(invitationsFirst)).not.toContain('Nothing needs you');

    const paymentsFirst = needsYou(ready(PAYMENTS), loading);
    expect(paymentsFirst).toContain('aria-label="Loading invitations"');
    expect(text(paymentsFirst)).toContain('You pay Sam Chen');
  });

  it('fails the payments on their own, with Try again, and never says nothing needs you', () => {
    const html = needsYou(failed, ready([]));
    expect(text(html)).toContain('Suggested payments could not be loaded. Try again');
    expect(text(html)).not.toContain('Nothing needs you');

    const withInvitation = needsYou(failed, ready([INVITATION]));
    expect(text(withInvitation)).toContain('Suggested payments could not be loaded. Try again');
    expect(text(withInvitation)).toContain('Diwali at Priya’s');
  });

  it('fails the invitations on their own, keeping the payments', () => {
    const html = needsYou(ready(PAYMENTS), failed);
    expect(text(html)).toContain('Invitations could not be loaded. Try again');
    expect(text(html)).toContain('You pay Sam Chen');
    expect(text(needsYou(ready([]), failed))).not.toContain('Nothing needs you');
  });

  it('words each payment from the member’s side and links Record to the Group’s Balances', () => {
    expect(paymentTitle(payment({}))).toBe('You pay Sam Chen');
    expect(paymentTitle(payment({ direction: 'receive' }))).toBe('Sam Chen pays you');
    expect(recordPaymentHref(id(3))).toBe(`/groups/${id(3)}/balances`);
  });

  it('describes an invitation with what the read sent', () => {
    expect(invitationDetail(INVITATION)).toBe('Invitation from Priya Shah · General');
    expect(invitationDetail({ ...INVITATION, category: 'home' })).toBe(
      'Invitation from Priya Shah · Household',
    );
    expect(invitationDetail({ ...INVITATION, invitedByName: null, category: null })).toBe(
      'Invitation',
    );
  });
});

describe('the invitations read', () => {
  it('keeps what Needs you shows', () => {
    expect(
      readInvitations({
        status: 200,
        data: [
          {
            _id: INVITATION.id,
            email: 'alex@example.test',
            group: { _id: id(4), name: INVITATION.groupName, category: 'other', members: [] },
            invitedBy: { _id: PRIYA, name: 'Priya Shah', email: 'priya@example.test' },
          },
        ],
      }),
    ).toEqual([INVITATION]);
  });

  it.each([{ status: 200 }, { data: 'none' }, { data: [{ _id: 1 }] }, { data: [{ _id: 'x' }] }])(
    'refuses %j',
    (value) => {
      expect(() => readInvitations(value)).toThrow();
    },
  );
});

describe('the heading', () => {
  // Built in local time: the zone the tests run in decides nothing.
  const at = new Date(2026, 9, 7, 10, 42).getTime();

  it('says how many Groups and when Home last updated, with Refresh', () => {
    const html = render(
      createElement(HomeHeaderView, {
        groupCount: 5,
        updatedAt: at,
        refreshing: false,
        onRefresh: noop,
      }),
    );
    expect(html).toMatch(/<h1\b[^>]*>Home<\/h1>/);
    expect(text(html)).toBe('Home 5 Groups · Updated 10:42 AM Refresh');
  });

  it('leaves out what isn’t known yet', () => {
    expect(homeStatusLine(null, null)).toBe('');
    expect(homeStatusLine(1, null)).toBe('1 Group');
    expect(homeStatusLine(null, at)).toBe('Updated 10:42 AM');
  });
});

describe('Home', () => {
  const GROUPS = [
    { _id: id(1), name: 'Maple House', category: 'home', defaultCurrency: 'INR' },
    { _id: id(2), name: 'Goa Friends Trip', category: 'trip', defaultCurrency: 'INR' },
  ] as GroupRead[];
  const BALANCES = {
    status: 200,
    data: {
      buckets: [{ currency: 'INR', youOwe: 1480, youAreOwed: 620, net: -860 }],
      groups: [
        { groupId: id(1), balances: [{ currency: 'INR', balance: -1480 }] },
        { groupId: id(2), balances: [{ currency: 'INR', balance: 620 }] },
      ],
      hasMixedCurrencies: false,
      suggestedPayments: PAYMENTS,
    },
  };
  const home = (balances: unknown, invitations: unknown = { status: 200, data: [] }) =>
    render(createElement(DashboardView, { userId: USER.id, userName: USER.name }), 'light', {
      [unstable_serialize(groupReadKey(USER.id, '/api/groups'))]: { data: GROUPS },
      '/api/user/balances': balances,
      '/api/invitations': invitations,
    });

  it('lays out the canvas’s order: the heading, Your balances beside Needs you, then the Groups beside Latest changes', () => {
    const html = home(BALANCES);
    const headings = [...html.matchAll(/<h([12])\b[^>]*>([^<]+)<\/h\1>/g)].map(
      ([, , name]) => name,
    );
    expect(headings).toEqual([
      'Home',
      'Your balances',
      'Needs you',
      'Your groups',
      'Latest changes',
    ]);
    expect(text(region(html, 'Your balances'))).toContain('Net −₹860.00');
    expect(text(region(html, 'Needs you'))).toContain('You pay Sam Chen');
    // Receipts are backlogged: nothing on Home mentions them.
    expect(text(html)).not.toMatch(/receipt/i);
  });

  it('keeps Your balances when the suggested payments can’t be read, and fails only Needs you', () => {
    const html = home({ ...BALANCES, data: { ...BALANCES.data, suggestedPayments: 'unexpected' } });
    expect(text(region(html, 'Your balances'))).toContain('Net −₹860.00');
    expect(text(region(html, 'Needs you'))).toContain(
      'Suggested payments could not be loaded. Try again',
    );
  });

  it('fails Your balances on an amount it can’t read exactly, rather than round it', () => {
    const html = home({
      ...BALANCES,
      data: { ...BALANCES.data, buckets: [{ currency: 'INR', youOwe: 1.005, youAreOwed: 0 }] },
    });
    expect(text(region(html, 'Your balances'))).toContain(
      'Your balances could not be loaded. Try again',
    );
    expect(text(region(html, 'Needs you'))).toContain('You pay Sam Chen');
  });

  it('shows every card loading on its own before its reads answer', () => {
    const html = render(createElement(DashboardView, { userId: USER.id, userName: USER.name }));
    expect(html).toContain('aria-label="Loading your balances"');
    expect(html).toContain('aria-label="Loading what needs you"');
    expect(text(html)).toContain('Home');
  });
});

describe('a row of cards', () => {
  it('renders nothing until a card joins it', () => {
    expect(render(createElement(HomeRow, null))).toBe('');
  });
});
