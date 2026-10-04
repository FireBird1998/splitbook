import { describe, expect, it } from 'vitest';
import { createMobileController } from './mobile-controller';
import { visibleFieldErrors } from './field-feedback';
import { groupFields } from './group-draft';
import type { FetchResponse } from './types';

// #105: Group creation and Settlement entry explain corrections at their fields.
const people = {
  alex: { id: 'a00000000000000000000001', name: 'Alex', email: 'alex@example.test', image: null },
  sam: { id: 'a00000000000000000000002', name: 'Sam', email: 'sam@example.test', image: null },
};
type Persona = keyof typeof people;
const groupId = 'b00000000000000000000001';
const createdId = 'b00000000000000000000002';
const iso = '2026-09-28T12:00:00.000Z';
/** The device clock: local noon is 28 September in every time zone, as the member's day is. */
const localNoon = new Date(2026, 8, 28, 12).getTime();
const member = (persona: Persona) => ({
  user: { _id: people[persona].id, name: people[persona].name, email: people[persona].email },
  role: persona === 'alex' ? 'admin' : 'member',
  joinedAt: iso,
});
const group = {
  _id: groupId,
  createdBy: people.alex.id,
  name: 'Maple House',
  category: 'home',
  defaultCurrency: 'INR',
  members: [member('alex'), member('sam')],
  createdAt: iso,
  updatedAt: iso,
};
const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * One fictional server shared by both members' devices. Settlements are idempotent by
 * `Idempotency-Key`, like the real API; `loseNextResponse` drops a reply after the write.
 */
function server() {
  const recorded: { key: string; record: unknown }[] = [];
  const created: unknown[] = [];
  const calls: string[] = [];
  let loseNextResponse = false;
  let holdGroupCreate: Promise<void> | null = null;
  const personaOf = (init: RequestInit) =>
    String((init.headers as Record<string, string>).Cookie ?? '').includes('sam.') ? 'sam' : 'alex';
  const fetch = async (url: string, init: RequestInit): Promise<FetchResponse> => {
    const path = new URL(url).pathname;
    const method = init.method ?? 'GET';
    calls.push(`${method} ${path}`);
    const persona = personaOf(init);
    if (path.endsWith('/sign-in')) {
      const who: Persona = String(init.body).includes('sam') ? 'sam' : 'alex';
      return new Response(JSON.stringify({ user: people[who] }), {
        headers: { 'Set-Cookie': `better-auth.session_token=${who}.signature; Max-Age=2592000` },
      });
    }
    if (path.endsWith('/get-session'))
      return json({
        user: people[persona],
        session: { userId: people[persona].id, expiresAt: '2030-01-01T00:00:00Z' },
      });
    if (path.endsWith('/sign-out')) return json({ success: true });
    if (path === '/api/groups' && method === 'POST') {
      await holdGroupCreate;
      const body = JSON.parse(String(init.body));
      created.push(body);
      return json(
        {
          status: 201,
          data: {
            ...group,
            _id: createdId,
            name: body.name,
            category: body.category,
            members: [member('alex')],
          },
        },
        201,
      );
    }
    if (path === '/api/groups') return json({ status: 200, data: [group] });
    if (path === `/api/groups/${groupId}`) return json({ status: 200, data: group });
    if (path === '/api/user/balances') return json({ status: 200, data: { buckets: [] } });
    if (path.endsWith('/balances'))
      return json({
        status: 200,
        data: {
          byCurrency: [
            {
              currency: 'INR',
              balances: [],
              debts: recorded.length
                ? []
                : [
                    {
                      from: { _id: people.sam.id, name: 'Sam' },
                      to: { _id: people.alex.id, name: 'Alex' },
                      amount: 30,
                    },
                  ],
            },
          ],
        },
      });
    if (path.endsWith('/settlements') && method === 'POST') {
      const key = (init.headers as Record<string, string>)['Idempotency-Key'];
      let entry = recorded.find((item) => item.key === key);
      if (!entry) {
        const body = JSON.parse(String(init.body));
        entry = {
          key,
          record: {
            _id: `c0000000000000000000000${recorded.length + 1}`,
            group: groupId,
            paidBy: { _id: body.paidBy, name: body.paidBy === people.sam.id ? 'Sam' : 'Alex' },
            paidTo: { _id: body.paidTo, name: body.paidTo === people.sam.id ? 'Sam' : 'Alex' },
            createdBy: { _id: people[persona].id, name: people[persona].name },
            amount: body.amount,
            amountMinor: Math.round(body.amount * 100),
            moneyVersion: 1,
            currency: body.currency,
            note: body.note ?? '',
            createdAt: iso,
            updatedAt: iso,
          },
        };
        recorded.push(entry);
      }
      if (loseNextResponse) {
        loseNextResponse = false;
        throw new Error('Response lost after the server recorded the payment');
      }
      return json({ status: 201, data: entry.record }, 201);
    }
    if (path.endsWith('/settlements'))
      return json({ status: 200, data: recorded.map((item) => item.record) });
    if (path.includes('/expenses'))
      return json({
        status: 200,
        data: {
          expenses: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
          summary: { count: 0, totalsByCurrency: [], userOwes: 0, userGetsBack: 0, byMember: [] },
        },
      });
    return json({}, 404);
  };
  return {
    fetch,
    calls,
    recorded,
    created,
    loseNextResponse: () => {
      loseNextResponse = true;
    },
    holdGroupCreate(until: Promise<void>) {
      holdGroupCreate = until;
    },
  };
}

/** One member's device: its own session, account storage and payment recovery store. */
function device(
  backend: ReturnType<typeof server>,
  options: { failAttemptSave?: boolean; failAttemptLoad?: boolean; noAttemptStore?: boolean } = {},
) {
  let cookie: string | null = null,
    owner: string | null = null,
    keys = 0;
  const attempts = new Map<string, unknown>();
  const store = {
    load: async (account: string, id: string) => {
      if (options.failAttemptLoad) throw new Error('SQLITE_CANTOPEN: unable to open database file');
      return structuredClone(attempts.get(account + id) ?? null);
    },
    save: async (account: string, id: string, value: unknown) => {
      if (options.failAttemptSave) throw new Error('SQLITE_FULL: database or disk is full');
      attempts.set(account + id, structuredClone(value));
    },
    remove: async (account: string, id: string) => {
      attempts.delete(account + id);
    },
    clear: async () => attempts.clear(),
  };
  const creations = new Map<string, unknown>();
  const groupCreations = {
    load: async (account: string) => structuredClone(creations.get(account) ?? null),
    save: async (account: string, value: unknown) => {
      creations.set(account, structuredClone(value));
    },
    remove: async (account: string) => {
      creations.delete(account);
    },
    clear: async () => creations.clear(),
  };
  const create = () =>
    createMobileController(
      {
        apiBaseUrl: 'http://localhost:4138',
        authOrigin: 'http://localhost:4138',
        developmentPersonaEnabled: true,
      },
      {
        fetch: backend.fetch,
        now: () => localNoon,
        newSubmissionKey: () => `payment-attempt-${String(++keys).padStart(4, '0')}`,
        settlementAttempts: options.noAttemptStore ? undefined : store,
        groupCreations,
        credentials: {
          load: async () => cookie,
          save: async (value) => {
            cookie = value;
          },
          clear: async () => {
            cookie = null;
          },
        },
        accountLocal: {
          owner: {
            load: async () => owner,
            save: async (value) => {
              owner = value;
            },
            clear: async () => {
              owner = null;
            },
          },
          cleanupMarker: { load: async () => false, mark: async () => {}, clear: async () => {} },
          stores: [store, groupCreations],
        },
      },
    );
  return { create, attempts };
}

describe('Group creation corrections (#105)', () => {
  it('explains a missing name at the Name field, sends nothing, then creates once corrected', async () => {
    const backend = server();
    const controller = device(backend).create();
    await controller.signIn('alex');
    controller.startCreate();
    controller.updateCreation({
      category: 'home',
      defaultCurrency: 'EUR',
      description: 'Rent and bills',
    });
    // Typing alone never shows a correction; leaving the field does.
    expect(visibleFieldErrors(groupFields, controller.getSnapshot().creation.validation)).toEqual(
      {},
    );
    controller.touchCreationField('name');
    expect(visibleFieldErrors(groupFields, controller.getSnapshot().creation.validation)).toEqual({
      name: 'Add a name for this household, such as Flat 302.',
    });

    await controller.createGroup();
    await controller.createGroup();
    expect(backend.created).toHaveLength(0);
    expect(controller.getSnapshot().creation).toMatchObject({
      status: 'editing',
      message: 'Add a name for this household, such as Flat 302.',
      draft: { category: 'home', defaultCurrency: 'EUR', description: 'Rent and bills' },
      validation: { submitted: true, focus: { field: 'name', request: 2 } },
    });

    controller.updateCreation({ name: '  Flat 302 ' });
    expect(controller.getSnapshot().creation).toMatchObject({
      message: null,
      validation: { errors: {} },
    });
    await controller.createGroup();
    expect(backend.created).toEqual([
      expect.objectContaining({ name: 'Flat 302', category: 'home', defaultCurrency: 'EUR' }),
    ]);
    expect(controller.getSnapshot()).toMatchObject({ screen: 'group', detail: { id: createdId } });
  });

  it('attaches Trip date corrections to each date and focuses the first', async () => {
    const backend = server();
    const controller = device(backend).create();
    await controller.signIn('alex');
    controller.startCreate();
    controller.updateCreation({ name: 'Goa weekend', startDate: '2026-11-31', endDate: '2026-10' });
    await controller.createGroup();
    expect(controller.getSnapshot().creation).toMatchObject({
      message: 'Correct 2 fields before creating the Group: Start date and End date.',
      validation: {
        errors: {
          startDate: '2026-11-31 isn’t a real date. Check the day and month.',
          endDate: 'Enter the date as YYYY-MM-DD, such as 2026-09-28.',
        },
        focus: { field: 'startDate' },
      },
    });
    controller.updateCreation({ startDate: '2026-11-20', endDate: '2026-11-18' });
    await controller.createGroup();
    expect(controller.getSnapshot().creation.validation).toMatchObject({
      errors: { endDate: 'Choose an end date on or after the start date, 2026-11-20.' },
      focus: { field: 'endDate' },
    });
    controller.updateCreation({ endDate: '2026-11-22' });
    await controller.createGroup();
    expect(backend.created).toEqual([
      expect.objectContaining({
        startDate: '2026-11-20T00:00:00.000Z',
        endDate: '2026-11-22T00:00:00.000Z',
      }),
    ]);
  });

  it('keeps an active submission from being sent twice', async () => {
    const backend = server();
    let release!: () => void;
    backend.holdGroupCreate(new Promise<void>((resolve) => (release = resolve)));
    const controller = device(backend).create();
    await controller.signIn('alex');
    controller.startCreate();
    controller.updateCreation({ name: 'Weekend away' });
    const creating = controller.createGroup();
    expect(controller.getSnapshot().creation.status).toBe('saving');
    await controller.createGroup();
    release();
    await creating;
    expect(backend.created).toHaveLength(1);
  });
});

describe('Settlement corrections (#105)', () => {
  const open = async (persona: Persona, backend = server(), options = {}) => {
    const member = device(backend, options);
    const controller = member.create();
    await controller.signIn(persona);
    await controller.openSettlements(groupId);
    controller.selectSettlement(people.sam.id, people.alex.id, 'INR');
    return { controller, backend, member };
  };

  it.each([
    ['', 'Enter the amount, such as 250.50.'],
    ['12.345', 'INR amounts can have at most 2 decimal places. Nothing is rounded for you.'],
    ['0', 'Enter an amount greater than 0.'],
    ['12,50', 'Use digits and one decimal point, such as 250.50.'],
    ['20000000', 'Enter an amount of at most 10,000,000.'],
  ])('attaches the Amount correction for %j and keeps every entry', async (amount, correction) => {
    const { controller, backend } = await open('sam');
    controller.updateSettlement({ amount, note: 'Cash at dinner' });
    const before = backend.calls.length;
    await controller.recordSettlement();
    expect(backend.calls.slice(before)).toEqual([]);
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'editing',
      message: correction,
      draft: {
        paidBy: people.sam.id,
        paidTo: people.alex.id,
        currency: 'INR',
        amount,
        note: 'Cash at dinner',
      },
      validation: { submitted: true, errors: { amount: correction }, focus: { field: 'amount' } },
    });
  });

  it('records a corrected amount above the suggestion only once the member ticks it', async () => {
    const { controller, backend } = await open('sam');
    controller.updateSettlement({ amount: '40.5' });
    controller.touchSettlementField('amount');
    expect(controller.getSnapshot().settlement.validation.errors).toEqual({});
    await controller.recordSettlement();
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'review',
      message:
        'This payment exceeds the current suggestion. Acknowledge the difference before recording.',
    });
    expect(backend.recorded).toHaveLength(0);
    controller.acknowledgeSettlement();
    await controller.recordSettlement();
    expect(backend.recorded).toHaveLength(1);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'balances',
      snackbar: { message: 'Payment recorded' },
    });
  });

  it('retries a lost response with the same submission, so the payment is recorded once', async () => {
    const backend = server();
    const { controller, member } = await open('sam', backend);
    backend.loseNextResponse();
    await controller.recordSettlement();
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'uncertain',
      draft: { amount: '30', paidBy: people.sam.id, paidTo: people.alex.id, currency: 'INR' },
    });
    const attempt = controller.getSnapshot().settlement.attempt;
    expect(attempt).not.toBeNull();
    // Reconnecting or reopening never sends it; only the explicit retry does.
    await controller.refresh();
    const restarted = member.create();
    await restarted.restore();
    await restarted.openSettlements(groupId);
    expect(restarted.getSnapshot().settlement).toMatchObject({ status: 'uncertain', attempt });
    const posts = () =>
      backend.calls.filter((call) => call === `POST /api/groups/${groupId}/settlements`);
    expect(posts()).toHaveLength(1);
    await restarted.recordSettlement();
    expect(posts()).toHaveLength(2);
    expect(backend.recorded).toHaveLength(1);
    expect(restarted.getSnapshot()).toMatchObject({
      screen: 'group',
      settlement: { draft: null, attempt: null },
    });
  });

  it('explains missing payment recovery storage when opening Payments, not connectivity', async () => {
    const backend = server();
    const sam = device(backend, { noAttemptStore: true }).create();
    await sam.signIn('sam');
    await sam.openSettlements(groupId);
    expect(sam.getSnapshot().settlement).toMatchObject({
      status: 'error',
      message:
        'Payments need this device to keep a recovery copy of each submission, and that storage isn’t available right now. Try again, or sign out and back in.',
    });
    expect(backend.calls.filter((call) => call.includes('/settlements'))).toEqual([]);
  });

  it('explains an unreadable recovery store when opening Payments and keeps the unresolved payment', async () => {
    const backend = server();
    const options = { failAttemptLoad: false };
    const member = device(backend, options);
    const sam = member.create();
    await sam.signIn('sam');
    await sam.openSettlements(groupId);
    sam.selectSettlement(people.sam.id, people.alex.id, 'INR');
    backend.loseNextResponse();
    await sam.recordSettlement();
    expect(sam.getSnapshot().settlement.status).toBe('uncertain');

    options.failAttemptLoad = true;
    const restarted = member.create();
    await restarted.restore();
    await restarted.openSettlements(groupId);
    const state = restarted.getSnapshot().settlement;
    expect(state).toMatchObject({
      status: 'error',
      attempt: null,
      message:
        'Couldn’t read this device’s payment recovery records, so payments can’t be recorded right now. Any unresolved payment is kept. Try again, or restart the app.',
    });
    expect(state.message).not.toMatch(/sqlite/i);
    expect(member.attempts.size).toBe(1);

    // Once storage reads again, the unresolved payment returns for an explicit retry.
    options.failAttemptLoad = false;
    await restarted.openSettlements(groupId);
    expect(restarted.getSnapshot().settlement).toMatchObject({
      status: 'uncertain',
      draft: { amount: '30' },
    });
    expect(backend.recorded).toHaveLength(1);
  });

  it('sends nothing and explains when the recovery copy cannot be stored', async () => {
    const { controller, backend } = await open('sam', server(), { failAttemptSave: true });
    await controller.recordSettlement();
    expect(backend.recorded).toHaveLength(0);
    expect(controller.getSnapshot().settlement).toMatchObject({
      status: 'review',
      attempt: null,
      draft: { amount: '30' },
      message:
        'Nothing was sent: this device couldn’t store a recovery copy of the payment. Your entries are kept. Choose Record payment again.',
    });
  });
});
