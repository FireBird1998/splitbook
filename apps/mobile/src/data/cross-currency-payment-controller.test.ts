import { createCheckedMobileController as createMobileController } from '../test-utils/flow-monitor';
import { describe, expect, it } from 'vitest';
import { parseAmountMinor } from '@splitbook/shared/exact-money';
import type { FetchResponse } from './types';

/**
 * A Debt recorded on its own currency's tab, and paid in another of the Group's currencies
 * (#728, the web's #727): the controller seam, with fake HTTP.
 */
const alex = 'a00000000000000000000001',
  sam = 'a00000000000000000000002',
  priya = 'a00000000000000000000003';
const groupId = 'b00000000000000000000001',
  settlementId = 'c00000000000000000000001';
const iso = '2026-10-21T04:50:00.000Z';
const user = { id: alex, name: 'Alex Rivera', email: 'alex@example.test', image: null };
const people = [alex, sam, priya].map((_id, i) => ({
  _id,
  name: ['Alex Rivera', 'Sam Chen', 'Priya Shah'][i],
  email: `${i}@example.test`,
  image: null,
}));
const group = {
  _id: groupId,
  createdBy: alex,
  name: 'Lisbon & Tokyo',
  category: 'trip',
  defaultCurrency: 'INR',
  alternateCurrencies: ['EUR', 'JPY'],
  members: people.map((person) => ({ user: person, role: 'member', joinedAt: iso })),
  createdAt: iso,
  updatedAt: iso,
};
/** As the server sends them: alphabetically. Alex owes Sam €20.00 and ₹1,480.00. */
const balances = (euros = 20) => ({
  status: 200,
  data: {
    byCurrency: [
      {
        currency: 'EUR',
        balances: [],
        debts: euros ? [{ from: people[0], to: people[1], amount: euros }] : [],
      },
      { currency: 'INR', balances: [], debts: [{ from: people[0], to: people[1], amount: 1480 }] },
      { currency: 'JPY', balances: [], debts: [{ from: people[1], to: people[0], amount: 8400 }] },
    ],
  },
});
const json = (body: unknown, status = 200) => Response.json(body, { status });
/** The server's answer to a payment: what was sent, as it stores it. */
const recorded = (body: Record<string, unknown>) => ({
  _id: settlementId,
  group: groupId,
  createdBy: people[0],
  ...body,
  paidBy: people.find(({ _id }) => _id === body.paidBy),
  paidTo: people.find(({ _id }) => _id === body.paidTo),
  amountMinor: parseAmountMinor(body.amount as number, body.currency as string),
  moneyVersion: 1,
  createdAt: iso,
  updatedAt: iso,
});

function setup(
  intercept: (
    url: URL,
    init: RequestInit,
  ) => FetchResponse | Promise<FetchResponse> | undefined = () => undefined,
) {
  let cookie: string | null = null,
    account: string | null = null,
    cleanup = false,
    key = 0;
  const records = new Map<string, unknown>();
  let cleanupRecord: unknown = null;
  const financialCleanup = {
    load: async () => structuredClone(cleanupRecord),
    save: async (value: unknown) => {
      cleanupRecord = structuredClone(value);
    },
    clear: async () => {
      cleanupRecord = null;
    },
  };
  const store = {
    list: async (owner: string) =>
      [...records]
        .filter(([id]) => id.startsWith(owner))
        .map(([id, value]) => ({ groupId: id.slice(owner.length), value: structuredClone(value) })),
    load: async (a: string, g: string) => structuredClone(records.get(a + g) ?? null),
    save: async (a: string, g: string, v: unknown) => {
      records.set(a + g, structuredClone(v));
    },
    remove: async (a: string, g: string) => {
      records.delete(a + g);
    },
    clear: async () => {
      records.clear();
    },
  };
  /** Each payment's body, as sent. */
  const payments: Record<string, unknown>[] = [];
  /** Every request sent, as `METHOD /path?query`, in the order sent. */
  const sent: string[] = [];
  const create = () =>
    createMobileController(
      {
        apiBaseUrl: 'http://localhost:4138',
        authOrigin: 'http://localhost:4138',
        developmentPersonaEnabled: true,
      },
      {
        credentials: {
          load: async () => cookie,
          save: async (v) => {
            cookie = v;
          },
          clear: async () => {
            cookie = null;
          },
        },
        settlementAttempts: store,
        newSubmissionKey: () => `settlement-key-${++key}`,
        accountLocal: {
          financialCleanup,
          owner: {
            load: async () => account,
            save: async (v) => {
              account = v;
            },
            clear: async () => {
              account = null;
            },
          },
          cleanupMarker: {
            load: async () => cleanup,
            mark: async () => {
              cleanup = true;
            },
            clear: async () => {
              cleanup = false;
            },
          },
          stores: [store, financialCleanup],
        },
        fetch: async (address, init) => {
          const url = new URL(address);
          const path = url.pathname;
          sent.push(`${init.method ?? 'GET'} ${path}${url.search}`);
          if (path.endsWith('/settlements') && init.method === 'POST')
            payments.push(JSON.parse(String(init.body)));
          const override = intercept(url, init);
          if (override) return override;
          if (path.endsWith('/sign-in'))
            return new Response(JSON.stringify({ user }), {
              headers: {
                'Set-Cookie': 'better-auth.session_token=alex.signature; Max-Age=2592000',
              },
            });
          if (path.endsWith('/get-session'))
            return json({ user, session: { userId: alex, expiresAt: '2030-01-01T00:00:00Z' } });
          if (path === '/api/groups') return json({ status: 200, data: [group] });
          if (path === `/api/groups/${groupId}`) return json({ status: 200, data: group });
          if (path.endsWith('/user/balances')) return json({ status: 200, data: { buckets: [] } });
          if (path.endsWith('/balances')) return json(balances());
          if (path.endsWith('/settlements'))
            return init.method === 'POST'
              ? json({ status: 201, data: recorded(JSON.parse(String(init.body))) }, 201)
              : json({ status: 200, data: [] });
          if (path.endsWith('/expenses'))
            return json({
              status: 200,
              data: {
                expenses: [],
                pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
                summary: {
                  count: 0,
                  totalsByCurrency: [],
                  userOwes: 0,
                  userGetsBack: 0,
                  byMember: [],
                },
              },
            });
          return json({}, 404);
        },
      },
    );
  return { controller: create(), create, records, payments, sent };
}

describe('a Debt recorded in its own currency (#728)', () => {
  it('records a Debt in an extra currency in that currency, from its own tab', async () => {
    const { controller, payments } = setup();
    await controller.signIn('alex');
    await controller.openSettlements(groupId);
    controller.selectSettlement(alex, sam, 'EUR');
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'editing',
      draft: { paidBy: alex, paidTo: sam, currency: 'EUR', amount: '20' },
      suggested: 20,
    });
    await controller.recordSettlement();
    expect(payments).toEqual([
      { paidBy: alex, paidTo: sam, amount: 20, currency: 'EUR', note: '' },
    ]);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      snackbar: { message: 'Payment recorded' },
    });
  });

  it('records a Debt in a currency the Group no longer lists, as the server allows', async () => {
    // GBP was removed from the Group's currencies, but a Debt in it remains to settle.
    const pounds = {
      currency: 'GBP',
      balances: [],
      debts: [{ from: people[0], to: people[2], amount: 12.5 }],
    };
    const { controller, payments } = setup(({ pathname }) =>
      pathname === `/api/groups/${groupId}/balances`
        ? json({ status: 200, data: { byCurrency: [...balances().data.byCurrency, pounds] } })
        : undefined,
    );
    await controller.signIn('alex');
    await controller.openSettlements(groupId);
    controller.selectSettlement(alex, priya, 'GBP');
    await controller.recordSettlement();
    expect(payments).toEqual([
      { paidBy: alex, paidTo: priya, amount: 12.5, currency: 'GBP', note: '' },
    ]);
    expect(controller.getSnapshot().snackbar?.message).toBe('Payment recorded');
  });
});
