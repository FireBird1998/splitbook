import { testPhone, until } from '../test-utils/test-phone';
import {
  fakeSplitbook,
  rateSuggestion as frankfurter,
  recordedBatch,
} from '../test-utils/fake-splitbook';
import { describe, expect, it } from 'vitest';
import type { FetchResponse } from './types';

/**
 * Settle up with Sam (#734): one payment clears Alex's Debts to Sam in two currencies, one
 * Settlement for each, all recorded in one request or none (`/settlements/batch`). The
 * controller seam, with fake HTTP; the amounts are the shared `calculateSettlementBatch`'s.
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
  'INR→EUR': frankfurter('INR', 'EUR', '0.010858'),
};
/** Version 1 recovery bodies, as the app sent them before the shared-reading move (#1050). */
const storedSingleBody =
  '{"paidBy":"a00000000000000000000001","paidTo":"a00000000000000000000002","amount":1480,"currency":"INR","note":"Paid already"}';
const storedBatchBody =
  '{"paidBy":"a00000000000000000000001","paidTo":"a00000000000000000000002","paidCurrency":"INR","settlements":[{"amount":1480,"currency":"INR"},{"amountPaidMinor":185000,"appliedRate":"92.50","suggestedRate":"92.1","rateSource":"frankfurter","rateAsOf":"2026-10-20","rateFetchedAt":"2026-10-21T00:30:00.000Z","rateKind":"custom","amount":20,"currency":"EUR"}]}';
/** The Group's rate read: its suggestion for the pair, or none. */
const rates = (suggestion: unknown, reason = 'unavailable') =>
  json({
    status: 200,
    data: suggestion ? { suggestion } : { suggestion: null, reason },
  });
/** Nothing comes back: the phone has no connection. */
const offline = () => Promise.reject(new TypeError('Network request failed'));
/** Build altered replies for the tests that check the server's recorded amounts. */
const batchRecorded = (body: Parameters<typeof recordedBatch>[0]) => recordedBatch(body, group);

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
  const sent = server.sent();
  const payments: Record<string, unknown>[] = [];
  const batches: { key: string | null; body: Record<string, unknown> }[] = [];
  // Keep the existing assertions' live log views; all replies come from the shared fake.
  server.reply('*', '*', ({ url, init, method, body, headers }) => {
    if (url.pathname.endsWith('/settlements') && method === 'POST') payments.push(body!);
    if (url.pathname.endsWith('/settlements/batch') && method === 'POST')
      batches.push({ key: headers.get('Idempotency-Key'), body: body! });
    return intercept(url, init);
  });
  let key = 0;
  const phone = testPhone(server, { newSubmissionKey: () => `settlement-key-${++key}` });
  return {
    controller: phone.open(),
    create: phone.open,
    records: phone.stores.settlementAttempts.records,
    payments,
    batches,
    sent,
    connect: phone.connect,
  };
}

describe('settling up in several currencies at once (#734)', () => {
  const batchPath = `POST /api/groups/${groupId}/settlements/batch`;
  /** Alex's Debts to Sam, in rupees and euros, open on the sheet. */
  const opened = async (intercept?: Parameters<typeof setup>[0]) => {
    const harness = setup(intercept);
    await harness.controller.signIn('alex');
    await harness.controller.openSettlements(groupId);
    await harness.controller.selectSettleAll(alex, sam);
    return harness;
  };
  const fromFrankfurter = {
    suggestedRate: '92.1',
    rateSource: 'frankfurter',
    rateAsOf: '2026-10-20',
    rateFetchedAt: '2026-10-21T00:30:00.000Z',
  };
  /** The two Debts as Alex pays them in rupees, at Frankfurter's rate for euros. */
  const inRupees = {
    paidBy: alex,
    paidTo: sam,
    paidCurrency: 'INR',
    settlements: [
      { amount: 1480, currency: 'INR' },
      {
        amount: 20,
        currency: 'EUR',
        amountPaidMinor: 184200,
        appliedRate: '92.1',
        rateKind: 'suggested',
        ...fromFrankfurter,
      },
    ],
  };

  it('keeps the exact batch request bytes, including Debt order and the typed rate (#1050)', async () => {
    let body: BodyInit | null | undefined;
    const { controller } = await opened(({ pathname }, init) => {
      if (pathname.endsWith('/settlements/batch') && init.method === 'POST') body = init.body;
      return undefined;
    });
    controller.editBatchRate('EUR', '92.50');
    await controller.recordSettlement();
    expect(body).toBe(storedBatchBody);
    controller.dispose();
  });

  it('offers version 1 unconfirmed single and batch payments again and retries their original bytes (#1050)', async () => {
    for (const [body, suffix, draft] of [
      [storedSingleBody, '', { currency: 'INR', amount: '1480', note: 'Paid already' }],
      [
        storedBatchBody,
        '/batch',
        {
          currency: 'INR',
          amount: '3330',
          note: '',
          batch: [
            { amount: 1480, currency: 'INR' },
            {
              amountPaidMinor: 185000,
              appliedRate: '92.50',
              suggestedRate: '92.1',
              rateSource: 'frankfurter',
              rateAsOf: '2026-10-20',
              rateFetchedAt: '2026-10-21T00:30:00.000Z',
              rateKind: 'custom',
              amount: 20,
              currency: 'EUR',
            },
          ],
        },
      ],
    ] as const) {
      const writes: { body: BodyInit | null | undefined; key: string | null }[] = [];
      const { controller, create, records } = setup(({ pathname }, init) => {
        if (pathname === `/api/groups/${groupId}/settlements${suffix}` && init.method === 'POST')
          writes.push({ body: init.body, key: new Headers(init.headers).get('Idempotency-Key') });
        return undefined;
      });
      await controller.signIn('alex');
      records.set(alex + groupId, {
        version: 1,
        accountId: alex,
        groupId,
        key: 'original-payment-key',
        body,
      });
      controller.dispose();
      const restarted = create();
      await restarted.restore();
      await restarted.openSettlements(groupId);
      expect(restarted.getSnapshot().settlement).toMatchObject({
        status: 'uncertain',
        attempt: { key: 'original-payment-key', body },
        draft: { paidBy: alex, paidTo: sam, ...draft },
      });
      expect(writes).toEqual([]);
      await restarted.recordSettlement();
      expect(writes).toEqual([{ key: 'original-payment-key', body }]);
      expect(records.size).toBe(0);
      restarted.dispose();
    }
  });

  it('settles both Debts in one payment, each at its own rate, all in one request', async () => {
    const { controller, batches, payments, sent, records } = await opened();
    expect(sent).toContain(`GET /api/groups/${groupId}/rates?from=EUR&to=INR`);
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'editing',
      batch: {
        paidBy: alex,
        paidTo: sam,
        paidCurrency: 'INR',
        // The Group's order: its main currency first.
        debts: [
          { currency: 'INR', amountMinor: 148000 },
          { currency: 'EUR', amountMinor: 2000 },
        ],
        rates: { EUR: { state: { status: 'ready', suggestion: { rate: '92.1' } }, custom: null } },
      },
    });
    await controller.recordSettlement();
    expect(payments).toEqual([]);
    expect(batches).toEqual([{ key: 'settlement-key-1', body: inRupees }]);
    expect(sent.filter((request) => request.startsWith('POST'))).toEqual([
      'POST /api/auth/demo-persona/sign-in',
      batchPath,
    ]);
    expect(records.size).toBe(0);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      snackbar: { message: 'Payment recorded' },
    });
  });

  // #872: Alex owes Sam only in extra currencies, €20.00 and ¥2,500; Pay in still offers rupees.
  it('pays Debts only in extra currencies in the main currency, first, each at its own rate (#872)', async () => {
    const { controller, batches, sent } = await opened(({ pathname, searchParams }) => {
      if (pathname === `/api/groups/${groupId}/balances`)
        return json({
          status: 200,
          data: {
            byCurrency: [
              {
                currency: 'EUR',
                balances: [],
                debts: [{ from: people[0], to: people[1], amount: 20 }],
              },
              {
                currency: 'JPY',
                balances: [],
                debts: [{ from: people[0], to: people[1], amount: 2500 }],
              },
            ],
          },
        });
      if (pathname === `/api/groups/${groupId}/rates` && searchParams.get('from') === 'JPY')
        return rates(frankfurter('JPY', searchParams.get('to') ?? '', '0.56'));
      return undefined;
    });
    expect(sent).toContain(`GET /api/groups/${groupId}/rates?from=EUR&to=INR`);
    expect(sent).toContain(`GET /api/groups/${groupId}/rates?from=JPY&to=INR`);
    expect(controller.getSnapshot().settlement.batch).toMatchObject({
      paidCurrency: 'INR',
      debts: [
        { currency: 'EUR', amountMinor: 2000 },
        { currency: 'JPY', amountMinor: 2500 },
      ],
    });
    await controller.recordSettlement();
    expect(batches[0]?.body).toEqual({
      paidBy: alex,
      paidTo: sam,
      paidCurrency: 'INR',
      settlements: [
        {
          amount: 20,
          currency: 'EUR',
          amountPaidMinor: 184200,
          appliedRate: '92.1',
          rateKind: 'suggested',
          ...fromFrankfurter,
        },
        {
          amount: 2500,
          currency: 'JPY',
          amountPaidMinor: 140000,
          appliedRate: '0.56',
          rateKind: 'suggested',
          ...fromFrankfurter,
          suggestedRate: '0.56',
        },
      ],
    });
  });

  it('pays in the other currency: its own Debt needs no rate, the other one its own', async () => {
    const { controller, batches, sent } = await opened();
    await controller.choosePaidCurrency('EUR');
    expect(sent).toContain(`GET /api/groups/${groupId}/rates?from=INR&to=EUR`);
    expect(controller.getSnapshot().settlement.batch).toMatchObject({
      paidCurrency: 'EUR',
      rates: { INR: { state: { status: 'ready' } } },
    });
    expect(controller.getSnapshot().settlement.batch?.rates.EUR).toBeUndefined();
    await controller.recordSettlement();
    const [row, plain] = (batches[0]?.body.settlements ?? []) as Record<string, unknown>[];
    expect(batches[0]?.body.paidCurrency).toBe('EUR');
    // ₹1,480.00 at €0.010858 for each rupee is €16.06984, which rounds to €16.07.
    expect(row).toMatchObject({
      currency: 'INR',
      amount: 1480,
      amountPaidMinor: 1607,
      rateKind: 'suggested',
      suggestedRate: '0.010858',
    });
    // The rate kept is the suggestion the member paid at (#870).
    expect(row?.appliedRate).toBe('0.010858');
    expect(plain).toEqual({ amount: 20, currency: 'EUR' });
  });

  it('pays a Debt in a currency the Group no longer lists in its listed main currency (#1051)', async () => {
    const { controller, batches } = await opened(({ pathname }) => {
      if (pathname === `/api/groups/${groupId}`)
        return json({ status: 200, data: { ...group, alternateCurrencies: [] } });
      return undefined;
    });
    expect(controller.getSnapshot().settlement.batch).toMatchObject({
      paidCurrency: 'INR',
      debts: [
        { currency: 'INR', amountMinor: 148000 },
        { currency: 'EUR', amountMinor: 2000 },
      ],
    });
    await controller.recordSettlement();
    expect(batches).toEqual([{ key: 'settlement-key-1', body: inRupees }]);
    expect(controller.getSnapshot().snackbar?.message).toBe('Payment recorded');
    controller.dispose();
  });

  it('records the member’s own rate for one Debt beside its suggestion, and puts the suggestion back', async () => {
    const { controller, batches } = await opened();
    controller.editBatchRate('EUR', '92.50');
    expect(controller.getSnapshot().settlement.batch?.rates.EUR?.custom).toBe('92.50');
    controller.restoreBatchRate('EUR');
    expect(controller.getSnapshot().settlement.batch?.rates.EUR?.custom).toBeNull();
    controller.editBatchRate('EUR', '92.50');
    await controller.recordSettlement();
    expect(batches[0]?.body.settlements).toEqual([
      { amount: 1480, currency: 'INR' },
      {
        amount: 20,
        currency: 'EUR',
        amountPaidMinor: 185000,
        appliedRate: '92.50',
        rateKind: 'custom',
        ...fromFrankfurter,
      },
    ]);
  });

  it('with no suggested rate for a Debt, waits for the one the member agreed, recorded as entered', async () => {
    const { controller, batches } = await opened(({ pathname }) =>
      pathname.endsWith('/rates') ? rates(null) : undefined,
    );
    expect(controller.getSnapshot().settlement.batch?.rates.EUR).toEqual({
      state: { status: 'none', reason: 'unavailable' },
      custom: null,
    });
    await controller.recordSettlement();
    expect(batches).toEqual([]);
    expect(controller.getSnapshot().settlement.message).toBe(
      'Enter the rate for the EUR Debt to record it.',
    );
    controller.editBatchRate('EUR', '92.40');
    await controller.recordSettlement();
    expect(batches[0]?.body.settlements).toEqual([
      { amount: 1480, currency: 'INR' },
      {
        amount: 20,
        currency: 'EUR',
        amountPaidMinor: 184800,
        appliedRate: '92.40',
        rateKind: 'entered',
      },
    ]);
  });

  it('offline, waits for a connection and records nothing; connected again, looks the rate up', async () => {
    let down = true;
    const { controller, batches, connect } = await opened(({ pathname }) =>
      down && pathname.endsWith('/rates') ? offline() : undefined,
    );
    expect(controller.getSnapshot().settlement.batch?.rates.EUR?.state).toEqual({
      status: 'unreachable',
    });
    controller.editBatchRate('EUR', '92.40');
    await controller.recordSettlement();
    expect(batches).toEqual([]);
    expect(controller.getSnapshot().settlement.message).toBe(
      'Recording a payment needs a connection.',
    );
    down = false;
    connect(false);
    connect(true);
    await until(controller, (now) => now.settlement.batch?.rates.EUR?.state.status === 'ready');
    // The member's own rate stays theirs, beside the suggestion now known.
    await controller.recordSettlement();
    expect(batches[0]?.body.settlements).toEqual([
      { amount: 1480, currency: 'INR' },
      {
        amount: 20,
        currency: 'EUR',
        amountPaidMinor: 184800,
        appliedRate: '92.40',
        rateKind: 'custom',
        ...fromFrankfurter,
      },
    ]);
  });

  it('when a Debt changed meanwhile, shows it and waits to be recorded again', async () => {
    let euros = 20;
    const { controller, batches } = await opened(({ pathname }) =>
      pathname === `/api/groups/${groupId}/balances` ? json(balances(euros)) : undefined,
    );
    euros = 15;
    await controller.recordSettlement();
    expect(batches).toEqual([]);
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'review',
      message: 'The Debts changed. Check the payment, then record again.',
      batch: {
        debts: [
          { currency: 'INR', amountMinor: 148000 },
          { currency: 'EUR', amountMinor: 1500 },
        ],
      },
    });
    await controller.recordSettlement();
    expect(batches[0]?.body.settlements).toEqual([
      { amount: 1480, currency: 'INR' },
      {
        amount: 15,
        currency: 'EUR',
        amountPaidMinor: 138150,
        appliedRate: '92.1',
        rateKind: 'suggested',
        ...fromFrankfurter,
      },
    ]);
  });

  it('ends when a Debt is gone by the time it’s recorded, and sends nothing', async () => {
    let euros = 20;
    const { controller, batches, records } = await opened(({ pathname }) =>
      pathname === `/api/groups/${groupId}/balances` ? json(balances(euros)) : undefined,
    );
    euros = 0;
    await controller.recordSettlement();
    expect(batches).toEqual([]);
    expect(records.size).toBe(0);
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'ready',
      batch: null,
      message: 'This suggested payment has changed. Close this to see the latest balances.',
    });
  });

  it('ends when Splitbook finds a Debt gone, and keeps nothing to retry', async () => {
    const { controller, batches, records } = await opened(({ pathname }, init) =>
      pathname.endsWith('/settlements/batch') && init.method === 'POST'
        ? json(
            {
              status: 422,
              code: 'NO_SETTLEMENT_DEBT',
              error: 'There is no Debt to settle in EUR.',
            },
            422,
          )
        : undefined,
    );
    await controller.recordSettlement();
    expect(batches).toHaveLength(1);
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'ready',
      batch: null,
      attempt: null,
      message: 'These Debts changed. Close this and check them again.',
    });
    expect(records.size).toBe(0);
  });

  it('never sends it twice: a lost reply is retried with the same key and body, after a restart too', async () => {
    let posts = 0;
    const { controller, batches, create, records } = await opened(({ pathname }, init) =>
      pathname.endsWith('/settlements/batch') && init.method === 'POST' && ++posts === 1
        ? Promise.reject(new Error('Response lost'))
        : undefined,
    );
    await controller.recordSettlement();
    expect(controller.getSnapshot().settlement.status).toBe('uncertain');
    controller.dispose();
    const restarted = create();
    await restarted.restore();
    await restarted.openSettlements(groupId);
    // The payment found on this phone is the batch, with what it pays.
    expect(restarted.getSnapshot().settlement).toMatchObject({
      status: 'uncertain',
      draft: {
        paidBy: alex,
        paidTo: sam,
        currency: 'INR',
        amount: '3322',
        batch: inRupees.settlements,
      },
    });
    await restarted.recordSettlement();
    expect(batches).toHaveLength(2);
    expect(batches[1]).toEqual(batches[0]);
    expect(records.size).toBe(0);
    expect(restarted.getSnapshot().snackbar?.message).toBe('Payment recorded');
  });

  it.each<[string, (data: ReturnType<typeof batchRecorded>) => void]>([
    [
      'pays another amount for a Debt',
      (data) => {
        data.settlements[1] = {
          ...data.settlements[1]!,
          amountPaidMinor: 185000,
        } as (typeof data.settlements)[number];
      },
    ],
    [
      'clears another amount of a Debt',
      (data) => {
        Object.assign(data.settlements[0]!, { amount: 1400, amountMinor: 140000 });
      },
    ],
    [
      'pays another total',
      (data) => {
        data.totalPaidMinor += 1;
      },
    ],
    [
      'lists its Settlements in another order',
      (data) => {
        data.settlements.reverse();
      },
    ],
    [
      'pays in another currency',
      (data) => {
        data.paidCurrency = 'EUR';
      },
    ],
    [
      'leaves a Settlement out',
      (data) => {
        data.settlements.pop();
      },
    ],
  ])('keeps it unconfirmed when the reply %s', async (_, change) => {
    const { controller, records } = await opened(({ pathname }, init) => {
      if (!pathname.endsWith('/settlements/batch') || init.method !== 'POST') return undefined;
      const data = batchRecorded(JSON.parse(String(init.body)));
      change(data);
      return json({ status: 201, data }, 201);
    });
    await controller.recordSettlement();
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'uncertain',
      attempt: { key: 'settlement-key-1' },
    });
    expect(records.size).toBe(1);
  });

  it('says a retry refused because its Debts changed wasn’t recorded, and keeps nothing to retry (#802)', async () => {
    let posts = 0;
    const { controller, batches, create, records } = await opened(({ pathname }, init) => {
      if (!pathname.endsWith('/settlements/batch') || init.method !== 'POST') return undefined;
      // The first send's reply never arrives; by its retry, the Debts have changed.
      return ++posts === 1
        ? Promise.reject(new Error('Response lost'))
        : json(
            {
              status: 422,
              code: 'NO_SETTLEMENT_DEBT',
              error: 'There is no Debt to settle in EUR.',
            },
            422,
          );
    });
    await controller.recordSettlement();
    expect(controller.getSnapshot().settlement.status).toBe('uncertain');
    controller.dispose();
    const restarted = create();
    await restarted.restore();
    await restarted.openSettlements(groupId);
    await restarted.recordSettlement();
    expect(batches).toHaveLength(2);
    expect(batches[1]).toEqual(batches[0]);
    expect(restarted.getSnapshot().settlement).toMatchObject({
      status: 'ready',
      batch: null,
      attempt: null,
      message:
        'These Debts changed, so this payment wasn’t recorded. Close this and check them again.',
    });
    expect(records.size).toBe(0);
  });

  // Only NO_SETTLEMENT_DEBT proves the batch never landed: the route checks membership before it
  // replays (#802), so a payment that landed and is retried after a member left is refused, and
  // its record must stay.
  it.each(['INVALID_MEMBERS', 'CURRENCY_MISMATCH', 'FORBIDDEN_SETTLEMENT'] as const)(
    'keeps the record of a batch retry refused with %s, which may have landed (#802)',
    async (code) => {
      let posts = 0;
      const { controller, create, records } = await opened(({ pathname }, init) => {
        if (!pathname.endsWith('/settlements/batch') || init.method !== 'POST') return undefined;
        return ++posts === 1
          ? Promise.reject(new Error('Response lost'))
          : json({ status: 422, code, error: 'Refused' }, 422);
      });
      await controller.recordSettlement();
      controller.dispose();
      const restarted = create();
      await restarted.restore();
      await restarted.openSettlements(groupId);
      await restarted.recordSettlement();
      expect(records.size).toBe(1);
      expect(restarted.getSnapshot().settlement.attempt).not.toBeNull();
    },
  );

  it('is only for Debts between the same two people, one way, in two currencies or more', async () => {
    const { controller } = setup(({ pathname }) =>
      pathname === `/api/groups/${groupId}/balances` ? json(balances(0)) : undefined,
    );
    await controller.signIn('alex');
    await controller.openSettlements(groupId);
    // Only rupees are owed to Sam now; Priya is owed nothing.
    await controller.selectSettleAll(alex, sam);
    await controller.selectSettleAll(alex, priya);
    expect(controller.getSnapshot().settlement).toMatchObject({ status: 'ready', batch: null });
  });

  it('opens from Balances, checking the latest balances first', async () => {
    const { controller, sent } = setup();
    await controller.signIn('alex');
    await controller.openGroup(groupId, true, 'balances');
    const from = sent.length;
    await controller.openSettleAll(alex, sam);
    expect(sent.slice(from)).toContain(`GET /api/groups/${groupId}/balances`);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'settlement',
      settlement: { status: 'editing', batch: { paidBy: alex, paidTo: sam } },
    });
  });
});
