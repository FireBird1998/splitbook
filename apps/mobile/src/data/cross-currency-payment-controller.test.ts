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
/** Frankfurter's rates of 20 Oct, fetched at 06:00 in India the next day (#726). */
const frankfurter = (from: string, to: string, rate: string) => ({
  from,
  to,
  rate,
  source: 'frankfurter',
  asOf: '2026-10-20',
  fetchedAt: '2026-10-21T00:30:00.000Z',
  ageDays: 1,
  attributionRequired: false,
  attribution: null,
  components: [],
});
const suggestions: Record<string, ReturnType<typeof frankfurter>> = {
  'EUR→INR': frankfurter('EUR', 'INR', '92.1'),
  'EUR→JPY': frankfurter('EUR', 'JPY', '162.4'),
};
/** The Group's rate read: its suggestion for the pair, or none. */
const rates = (suggestion: unknown, reason = 'unavailable') =>
  json({
    status: 200,
    data: suggestion ? { suggestion } : { suggestion: null, reason },
  });
/** Nothing comes back: the phone has no connection. */
const offline = () => Promise.reject(new TypeError('Network request failed'));
/** Until the controller's snapshot satisfies `ready`. */
const until = (
  controller: ReturnType<typeof setup>['controller'],
  ready: (snapshot: ReturnType<ReturnType<typeof setup>['controller']['getSnapshot']>) => boolean,
) =>
  new Promise<void>((resolve) => {
    if (ready(controller.getSnapshot())) return resolve();
    const stop = controller.subscribe(() => {
      if (!ready(controller.getSnapshot())) return;
      stop();
      resolve();
    });
  });
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
  /** NetInfo's listeners: the device's connection, which `connect` reports. */
  const connection = new Set<(state: { isConnected: boolean | null }) => void>();
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
        netInfo: {
          // As NetInfo does, a new listener hears the connection as it is now.
          addEventListener: (listener) => {
            connection.add(listener);
            listener({ isConnected: true });
            return () => connection.delete(listener);
          },
        },
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
          if (path === `/api/groups/${groupId}/rates`)
            return rates(
              suggestions[`${url.searchParams.get('from')}→${url.searchParams.get('to')}`] ?? null,
            );
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
  /** NetInfo reports the device's connection: false when it drops, true when it's back. */
  const connect = (isConnected: boolean) =>
    connection.forEach((listener) => listener({ isConnected }));
  return { controller: create(), create, records, payments, sent, connect };
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

describe('a Debt paid in another currency (#728)', () => {
  const ratesPath = (to: string) => `GET /api/groups/${groupId}/rates?from=EUR&to=${to}`;
  /** Alex's €20.00 Debt to Sam, open on the sheet. */
  const opened = async (intercept?: Parameters<typeof setup>[0]) => {
    const harness = setup(intercept);
    await harness.controller.signIn('alex');
    await harness.controller.openSettlements(groupId);
    harness.controller.selectSettlement(alex, sam, 'EUR');
    return harness;
  };
  const paidSide = {
    paidBy: alex,
    paidTo: sam,
    amount: 20,
    currency: 'EUR',
    note: '',
    paidCurrency: 'INR',
  };
  const fromFrankfurter = {
    suggestedRate: '92.1',
    rateSource: 'frankfurter',
    rateAsOf: '2026-10-20',
    rateFetchedAt: '2026-10-21T00:30:00.000Z',
  };

  it('pays it in rupees at the suggested rate, the amount paid following, and records both sides', async () => {
    const { controller, payments, sent } = await opened();
    await controller.choosePaidCurrency('INR');
    expect(sent).toContain(ratesPath('INR'));
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'editing',
      draft: { currency: 'EUR', amount: '20.00' },
      crossCurrency: {
        paidCurrency: 'INR',
        entry: { cleared: '20.00', rate: '92.10', paid: '1842.00' },
        rate: { status: 'ready', suggestion: { rate: '92.1', source: 'frankfurter' } },
      },
    });
    await controller.recordSettlement();
    expect(payments).toEqual([
      {
        ...paidSide,
        amountPaidMinor: 184200,
        appliedRate: '92.1',
        rateKind: 'suggested',
        ...fromFrankfurter,
      },
    ]);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      snackbar: { message: 'Payment recorded' },
    });
  });

  it('records the member’s own rate beside the suggestion, and puts the suggestion back on request', async () => {
    const { controller, payments } = await opened();
    await controller.choosePaidCurrency('INR');
    controller.editCrossCurrency('rate', '92.50');
    expect(controller.getSnapshot().settlement.crossCurrency?.entry).toMatchObject({
      rate: '92.50',
      paid: '1850.00',
    });
    controller.restoreSuggestedRate();
    expect(controller.getSnapshot().settlement.crossCurrency?.entry).toMatchObject({
      rate: '92.10',
      paid: '1842.00',
    });
    controller.editCrossCurrency('rate', '92.50');
    await controller.recordSettlement();
    expect(payments).toEqual([
      {
        ...paidSide,
        amountPaidMinor: 185000,
        appliedRate: '92.5',
        rateKind: 'custom',
        ...fromFrankfurter,
      },
    ]);
  });

  it('clears part of the Debt, the amount paid following the amount cleared', async () => {
    const { controller, payments } = await opened();
    await controller.choosePaidCurrency('INR');
    controller.editCrossCurrency('cleared', '10.00');
    expect(controller.getSnapshot().settlement).toMatchObject({
      draft: { amount: '10.00' },
      crossCurrency: { entry: { cleared: '10.00', rate: '92.10', paid: '921.00' } },
    });
    await controller.recordSettlement();
    expect(payments).toEqual([
      {
        ...paidSide,
        amount: 10,
        amountPaidMinor: 92100,
        appliedRate: '92.1',
        rateKind: 'suggested',
        ...fromFrankfurter,
      },
    ]);
  });

  it('works the rate out from both amounts', async () => {
    const { controller, payments } = await opened();
    await controller.choosePaidCurrency('INR');
    controller.editCrossCurrency('paid', '1,850');
    expect(controller.getSnapshot().settlement.crossCurrency?.entry).toMatchObject({
      cleared: '20.00',
      rate: '92.50',
      paid: '1,850',
    });
    await controller.recordSettlement();
    expect(payments).toEqual([
      {
        ...paidSide,
        amountPaidMinor: 185000,
        appliedRate: '92.5',
        rateKind: 'custom',
        ...fromFrankfurter,
      },
    ]);
  });

  it('needs an acknowledgement to clear more than the Debt', async () => {
    const { controller, payments } = await opened();
    await controller.choosePaidCurrency('INR');
    controller.editCrossCurrency('cleared', '25.00');
    await controller.recordSettlement();
    expect(payments).toEqual([]);
    expect(controller.getSnapshot().settlement.status).toBe('review');
    controller.acknowledgeSettlement();
    await controller.recordSettlement();
    expect(payments).toEqual([
      {
        ...paidSide,
        amount: 25,
        amountPaidMinor: 230250,
        appliedRate: '92.1',
        rateKind: 'suggested',
        ...fromFrankfurter,
      },
    ]);
  });

  it.each([
    ['has none', rates(null, 'unavailable'), 'unavailable'],
    ['has no quote for one of them', rates(null, 'currency_unavailable'), 'currency_unavailable'],
    ['fails', json({ status: 500, error: 'Rates are down' }, 500), null],
  ] as const)(
    'when the rate service %s, waits for the rate the member agreed, and records it as entered',
    async (_, answer, reason) => {
      const { controller, payments } = await opened(({ pathname }) =>
        pathname.endsWith('/rates') ? answer.clone() : undefined,
      );
      await controller.choosePaidCurrency('INR');
      expect(controller.getSnapshot().settlement.crossCurrency).toMatchObject({
        entry: { cleared: '20.00', rate: '', paid: '' },
        rate: { status: 'none', reason },
      });
      // Nothing to record yet: the rate or the amount paid is missing.
      await controller.recordSettlement();
      expect(payments).toEqual([]);
      expect(controller.getSnapshot().settlement.message).toBe(
        'Enter the rate or the amount paid to record it.',
      );
      controller.editCrossCurrency('rate', '92.40');
      await controller.recordSettlement();
      expect(payments).toEqual([
        { ...paidSide, amountPaidMinor: 184800, appliedRate: '92.4', rateKind: 'entered' },
      ]);
    },
  );

  it('records a second source’s suggestion as it came, with its source', async () => {
    const { controller, payments } = await opened(({ pathname }) =>
      pathname.endsWith('/rates')
        ? rates({
            ...frankfurter('EUR', 'INR', '92.06'),
            source: 'mixed',
            asOf: '2026-10-21',
            attributionRequired: true,
            attribution: {
              text: 'Rates By Exchange Rate API',
              url: 'https://www.exchangerate-api.com',
            },
          })
        : undefined,
    );
    await controller.choosePaidCurrency('INR');
    expect(controller.getSnapshot().settlement.crossCurrency?.rate).toMatchObject({
      status: 'ready',
      suggestion: { source: 'mixed', attributionRequired: true },
    });
    await controller.recordSettlement();
    expect(payments).toEqual([
      {
        ...paidSide,
        amountPaidMinor: 184120,
        appliedRate: '92.06',
        rateKind: 'suggested',
        ...fromFrankfurter,
        suggestedRate: '92.06',
        rateSource: 'mixed',
        rateAsOf: '2026-10-21',
      },
    ]);
  });

  it('offline, waits for a connection rather than saying no rate is suggested, and records nothing', async () => {
    let down = true;
    const { controller, payments, connect } = await opened(({ pathname }) =>
      down && pathname.endsWith('/rates') ? offline() : undefined,
    );
    await controller.choosePaidCurrency('INR');
    expect(controller.getSnapshot().settlement.crossCurrency).toMatchObject({
      entry: { cleared: '20.00', rate: '', paid: '' },
      rate: { status: 'unreachable' },
    });
    // Even with a rate typed, nothing is recorded until a suggestion can be looked up.
    controller.editCrossCurrency('rate', '92.40');
    await controller.recordSettlement();
    expect(payments).toEqual([]);
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'editing',
      message: 'Recording a payment needs a connection.',
    });
    // Connected again, the sheet looks the rate up; the member's own rate stays theirs.
    down = false;
    connect(false);
    connect(true);
    await until(controller, (now) => now.settlement.crossCurrency?.rate.status === 'ready');
    expect(controller.getSnapshot().settlement.crossCurrency?.entry).toMatchObject({
      rate: '92.40',
      paid: '1848.00',
    });
    await controller.recordSettlement();
    expect(payments).toEqual([
      {
        ...paidSide,
        amountPaidMinor: 184800,
        appliedRate: '92.4',
        rateKind: 'custom',
        ...fromFrankfurter,
      },
    ]);
  });

  it('starts afresh at the next currency’s suggestion, and back in euros pays the amount cleared', async () => {
    const { controller, payments, sent } = await opened();
    await controller.choosePaidCurrency('INR');
    controller.editCrossCurrency('cleared', '10.00');
    controller.editCrossCurrency('rate', '92.50');
    await controller.choosePaidCurrency('JPY');
    expect(sent).toContain(ratesPath('JPY'));
    expect(controller.getSnapshot().settlement.crossCurrency).toMatchObject({
      paidCurrency: 'JPY',
      entry: { cleared: '10.00', rate: '162.40', paid: '1624' },
    });
    // A currency the Group doesn't list isn't offered.
    await controller.choosePaidCurrency('GBP');
    expect(controller.getSnapshot().settlement.crossCurrency?.paidCurrency).toBe('JPY');
    await controller.choosePaidCurrency('EUR');
    expect(controller.getSnapshot().settlement).toMatchObject({
      crossCurrency: null,
      draft: { currency: 'EUR', amount: '10.00' },
    });
    await controller.recordSettlement();
    expect(payments).toEqual([
      { paidBy: alex, paidTo: sam, amount: 10, currency: 'EUR', note: '' },
    ]);
  });

  it('never sends it twice: a lost reply is retried with the same key and body, after a restart too', async () => {
    let posts = 0;
    const { controller, payments, create, records } = await opened(({ pathname }, init) =>
      pathname.endsWith('/settlements') && init.method === 'POST' && ++posts === 1
        ? Promise.reject(new Error('Response lost'))
        : undefined,
    );
    await controller.choosePaidCurrency('INR');
    controller.editCrossCurrency('rate', '92.50');
    await controller.recordSettlement();
    expect(controller.getSnapshot().settlement.status).toBe('uncertain');
    controller.dispose();
    const restarted = create();
    await restarted.restore();
    await restarted.openSettlements(groupId);
    // The payment found on this phone shows what it paid, at what rate.
    expect(restarted.getSnapshot().settlement).toMatchObject({
      status: 'uncertain',
      draft: {
        currency: 'EUR',
        amount: '20',
        paid: {
          amountPaidMinor: 185000,
          paidCurrency: 'INR',
          appliedRate: '92.5',
          rateKind: 'custom',
        },
      },
    });
    await restarted.recordSettlement();
    expect(payments).toHaveLength(2);
    expect(payments[1]).toEqual(payments[0]);
    expect(payments[0]).toMatchObject({ amountPaidMinor: 185000, rateKind: 'custom' });
    expect(records.size).toBe(0);
    expect(restarted.getSnapshot().snackbar?.message).toBe('Payment recorded');
  });

  it('keeps a payment unconfirmed when the reply records another paid side', async () => {
    const { controller, records } = await opened(({ pathname }, init) =>
      pathname.endsWith('/settlements') && init.method === 'POST'
        ? json(
            {
              status: 201,
              data: { ...recorded(JSON.parse(String(init.body))), amountPaidMinor: 185000 },
            },
            201,
          )
        : undefined,
    );
    await controller.choosePaidCurrency('INR');
    await controller.recordSettlement();
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'uncertain',
      attempt: { key: 'settlement-key-1' },
    });
    expect(records.size).toBe(1);
  });
});
