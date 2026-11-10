import { testPhone, until } from '../test-utils/test-phone';
import {
  fakeSplitbook,
  rateSuggestion as frankfurter,
  recordedSettlement,
} from '../test-utils/fake-splitbook';
import { describe, expect, it } from 'vitest';
import type { FetchResponse } from './types';

/**
 * A Debt recorded on its own currency's tab, and paid in another of the Group's currencies
 * (#728, the web's #727): the controller seam, with fake HTTP.
 */
const alex = 'a00000000000000000000001',
  sam = 'a00000000000000000000002',
  priya = 'a00000000000000000000003';
const groupId = 'b00000000000000000000001';
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
const recorded = (body: Record<string, unknown>) => recordedSettlement(body, group);

function setup(
  intercept: (
    url: URL,
    init: RequestInit,
  ) => FetchResponse | Promise<FetchResponse> | undefined = () => undefined,
) {
  const server = fakeSplitbook();
  server.world.people.alex = user;
  server.world.groups = [group];
  server.world.balances[groupId] = balances().data;
  server.world.rates[groupId] = suggestions;
  const payments: Record<string, unknown>[] = [];
  server.reply('*', '*', ({ url, init, method, body }) => {
    if (method === 'POST' && url.pathname.endsWith('/settlements')) payments.push(body!);
    return intercept(url, init);
  });
  let key = 0;
  // Original phone: recovery + financial cleanup and NetInfo, on the platform clock.
  const phone = testPhone(server, {
    newSubmissionKey: () => `settlement-key-${++key}`,
    parts: {
      savedQueries: undefined,
      offlineIdentity: undefined,
      pendingInvitation: undefined,
      expenseDrafts: undefined,
      draftRequests: undefined,
      tagRequests: undefined,
      groupCreations: undefined,
    },
  });
  return {
    controller: phone.open(),
    create: phone.open,
    records: phone.stores.settlementAttempts.records,
    payments,
    sent: server.sent(),
    connect: phone.connect,
  };
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
        appliedRate: '92.50',
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
        { ...paidSide, amountPaidMinor: 184800, appliedRate: '92.40', rateKind: 'entered' },
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

  // #873: the second source sent "20.826633165829"; the sheet showed all twelve places.
  it('shows and pays a second source’s twelve-place suggestion as rates show (#873)', async () => {
    const { controller, payments } = await opened(({ pathname }) =>
      pathname.endsWith('/rates')
        ? rates({
            ...frankfurter('EUR', 'INR', '92.099945255334'),
            source: 'exchange-rate-api',
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
    // 20 × 92.099945 = 1841.9989: the amount paid follows the rate the field shows.
    expect(controller.getSnapshot().settlement.crossCurrency).toMatchObject({
      entry: { cleared: '20.00', rate: '92.099945', paid: '1842.00' },
      rate: { status: 'ready', suggestion: { rate: '92.099945' } },
    });
    await controller.recordSettlement();
    expect(payments).toEqual([
      {
        ...paidSide,
        amountPaidMinor: 184200,
        appliedRate: '92.099945',
        rateKind: 'suggested',
        ...fromFrankfurter,
        suggestedRate: '92.099945',
        rateSource: 'exchange-rate-api',
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
        appliedRate: '92.40',
        rateKind: 'custom',
        ...fromFrankfurter,
      },
    ]);
  });

  // The Tester found this unpinned (M3): Record pressed while the suggestion is still being looked
  // up must wait, never record a typed amount as paid with no suggestion when one is on its way.
  it('waits while the suggestion is looked up, rather than recording it as entered', async () => {
    let release = () => {};
    const looked = new Promise<FetchResponse>((resolve) => {
      release = () => resolve(rates(suggestions['EUR→INR']));
    });
    const { controller, payments } = await opened(({ pathname }) =>
      pathname.endsWith('/rates') ? looked : undefined,
    );
    const choosing = controller.choosePaidCurrency('INR');
    await until(controller, (now) => now.settlement.crossCurrency?.rate.status === 'loading');
    controller.editCrossCurrency('paid', '1,850');
    await controller.recordSettlement();

    expect(payments).toEqual([]);
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'editing',
      message: 'Record is available once a suggested rate is looked up.',
    });
    release();
    await choosing;
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
          appliedRate: '92.50',
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
