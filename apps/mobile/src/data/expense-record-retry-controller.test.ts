import { describe, expect, it } from 'vitest';
import { createMobileController } from './mobile-controller';
import type { FetchResponse } from './types';

// #192: Try again on an Expense record opened from its saved copy. Fictional people and Groups only.
const sam = { id: 'a00000000000000000000002', name: 'Sam Chen', email: 'sam@example.test' };
const priya = { id: 'a00000000000000000000003', name: 'Priya Shah', email: 'priya@example.test' };
const groupId = 'a00000000000000000000010';
const expenseId = 'b00000000000000000000001';
const iso = '2026-09-20T10:00:00.000Z';
const person = (user: typeof sam) => ({ _id: user.id, name: user.name, image: null });
const group = {
  _id: groupId,
  createdBy: sam.id,
  name: 'Maple House',
  category: 'home',
  defaultCurrency: 'INR',
  members: [sam, priya].map((user) => ({
    user: { ...person(user), email: user.email },
    role: 'member',
    joinedAt: iso,
  })),
  tags: [],
  createdAt: iso,
  updatedAt: iso,
};
const record = (revision: number, description: string) => ({
  _id: expenseId,
  group: groupId,
  revision,
  description,
  amount: 30,
  amountMinor: 3000,
  moneyVersion: 1,
  currency: 'INR',
  paidBy: [{ user: person(priya), amount: 30, amountMinor: 3000 }],
  splitBetween: [
    { user: person(sam), amount: 15, amountMinor: 1500 },
    { user: person(priya), amount: 15, amountMinor: 1500 },
  ],
  splitMethod: 'equal',
  date: iso,
  createdAt: iso,
  updatedAt: iso,
  category: 'other',
  tag: 'General',
  notes: '',
  isDeleted: false,
  editHistory: [],
});
const event = (id: string, at: string, type: string, changes: Record<string, unknown> = {}) => ({
  _id: id,
  group: groupId,
  actor: person(priya),
  createdAt: at,
  type,
  metadata: { expenseId, description: 'Electricity bill', changes },
});
const added = event('d00000000000000000000001', iso, 'expense_added');
/** Priya renamed the Expense while Sam was offline. */
const renamed = event('d00000000000000000000002', '2026-09-27T10:00:00.000Z', 'expense_updated', {
  description: { old: 'Electricity bill', new: 'Electricity bill (August)' },
});
const json = (body: unknown, status = 200) => Response.json(body, { status });

const groupPath = `/api/groups/${groupId}`;
const recordPath = `${groupPath}/expenses/${expenseId}`;
const historyPath = `${groupPath}/activity?expenseId=${expenseId}&page=1&limit=20`;
const sessionRead = 'GET /api/auth/get-session';

/** Hold matching requests until released, to observe reads that land late. */
function gate() {
  const waiting: { path: string; release: (response: FetchResponse) => void }[] = [];
  const arrivals: (() => void)[] = [];
  return {
    hold(path: string) {
      return new Promise<FetchResponse>((release) => {
        waiting.push({ path, release });
        arrivals.splice(0).forEach((notify) => notify());
      });
    },
    async next(match: string) {
      for (;;) {
        const index = waiting.findIndex((entry) => entry.path === match);
        if (index >= 0) return waiting.splice(index, 1)[0];
        await new Promise<void>((resolve) => arrivals.push(resolve));
      }
    },
  };
}

/** A fictional backend Sam can lose touch with, and device stores that survive a restart. */
function fixture() {
  const clock = { now: Date.parse('2026-09-27T06:30:00.000Z') };
  const server = {
    offline: false,
    record: record(3, 'Electricity bill'),
    events: [added],
    /** The Group: refused (403) or gone (404) answers every read of it. */
    group: 200,
    /** The Expense's own read only, after its Group has been read. */
    expense: 200,
  };
  let cookie: string | null = null,
    owner: string | null = null,
    identity: unknown = null,
    cleanup = false;
  const cache = new Map<string, unknown>(),
    drafts = new Map<string, unknown>();
  const requests: string[] = [];
  const held = gate();
  let holding: (path: string) => boolean = () => false;
  const respond = (path: string): FetchResponse => {
    if (path.endsWith('/sign-in'))
      return new Response(JSON.stringify({ user: sam }), {
        headers: { 'Set-Cookie': 'better-auth.session_token=sam.signature; Path=/; HttpOnly' },
      });
    if (path.endsWith('/get-session'))
      return json({ user: sam, session: { userId: sam.id, expiresAt: '2030-01-01T00:00:00Z' } });
    if (path.endsWith('/sign-out')) return json({ success: true });
    if (path === '/api/groups')
      return json({ status: 200, data: server.group === 200 ? [group] : [] });
    if (path === '/api/user/balances') return json({ status: 200, data: { buckets: [] } });
    if (path.startsWith(groupPath) && server.group !== 200)
      return json({ error: 'Unavailable', status: server.group }, server.group);
    if (path === groupPath) return json({ status: 200, data: group });
    if (path === recordPath)
      return server.expense === 200
        ? json({ status: 200, data: server.record })
        : json({ error: 'Unavailable', status: server.expense }, server.expense);
    if (path.startsWith(`${groupPath}/activity?`)) {
      const page = Number(new URL(path, 'http://local').searchParams.get('page'));
      return json({
        status: 200,
        data: {
          activities: server.events.slice((page - 1) * 20, page * 20),
          pagination: {
            page,
            limit: 20,
            total: server.events.length,
            totalPages: Math.ceil(server.events.length / 20),
          },
        },
      });
    }
    if (path.startsWith(`${groupPath}/expenses?`))
      return json({
        status: 200,
        data: {
          expenses: [server.record],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
          summary: { count: 1, totalsByCurrency: [], userOwes: 0, userGetsBack: 0, byMember: [] },
        },
      });
    if (path === `${groupPath}/balances`)
      return json({
        status: 200,
        data: { byCurrency: [{ currency: 'INR', balances: [], debts: [] }] },
      });
    return json({ error: 'Unavailable', status: 404 }, 404);
  };
  const create = () =>
    createMobileController(
      {
        apiBaseUrl: 'http://localhost:4138',
        authOrigin: 'http://localhost:4138',
        developmentPersonaEnabled: true,
      },
      {
        now: () => clock.now,
        credentials: {
          load: async () => cookie,
          save: async (value) => {
            cookie = value;
          },
          clear: async () => {
            cookie = null;
          },
        },
        offlineIdentity: {
          load: async () => structuredClone(identity),
          save: async (value) => {
            identity = structuredClone(value);
          },
          clear: async () => {
            identity = null;
          },
        },
        readCache: {
          load: async (account, path) => structuredClone(cache.get(account + path) ?? null),
          save: async (account, path, value) => {
            cache.set(account + path, structuredClone(value));
          },
          clear: async () => cache.clear(),
          invalidateGroup: async (account, id) => {
            for (const key of cache.keys())
              if (
                key.startsWith(`${account}/api/groups/${id}`) ||
                key === `${account}/api/groups` ||
                key === `${account}/api/user/balances`
              )
                cache.delete(key);
          },
          retainGroups: async (account, ids) => {
            for (const key of cache.keys()) {
              const id = /^\/api\/groups\/([a-f\d]{24})/.exec(key.slice(account.length))?.[1];
              if (key.startsWith(account) && id && !ids.includes(id)) cache.delete(key);
            }
          },
        },
        expenseDrafts: {
          load: async (account, id) => structuredClone(drafts.get(account + id) ?? null),
          save: async (account, id, value) => {
            drafts.set(account + id, structuredClone(value));
          },
          remove: async (account, id) => {
            drafts.delete(account + id);
          },
          clear: async () => drafts.clear(),
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
          cleanupMarker: {
            load: async () => cleanup,
            mark: async () => {
              cleanup = true;
            },
            clear: async () => {
              cleanup = false;
            },
          },
          stores: [
            {
              clear: async () => {
                cache.clear();
                drafts.clear();
                identity = null;
              },
            },
          ],
        },
        fetch: async (url, init) => {
          const address = new URL(url);
          const path = address.pathname + address.search;
          if (server.offline) throw new Error('Offline');
          requests.push(`${init.method ?? 'GET'} ${path}`);
          if (holding(path)) return held.hold(path);
          return respond(path);
        },
        // An invitation opened here can't be kept, so it stays on its error until retried.
        pendingInvitation: {
          load: async () => null,
          save: async () => {
            throw new Error('The device storage is full');
          },
          clear: async () => undefined,
        },
      },
    );
  return {
    create,
    clock,
    server,
    cache,
    drafts,
    held,
    hold(match: (path: string) => boolean) {
      holding = match;
    },
    /** The answer the fictional backend gives Sam for this path right now. */
    answer: (path: string) => respond(path),
    /** Requests sent since the last call. */
    sent: () => requests.splice(0),
    /** Whether this device keeps a saved copy of this path for Sam. */
    saved: (path: string) => cache.get(sam.id + path) as { value: { data: unknown } } | undefined,
  };
}
type Fixture = ReturnType<typeof fixture>;
type Controller = ReturnType<Fixture['create']>;

/** Group reads, the Expense's included, among these requests. */
const groupReads = (requests: string[]) =>
  requests.filter((request) => request.startsWith(`GET ${groupPath}`));

/**
 * Sam read the Expense online at `savedAt`; later, offline, opens it again from its saved
 * copy: in the same session, or after restarting the app offline.
 */
async function openedOffline(restart: boolean) {
  const f = fixture();
  let controller = f.create();
  await controller.signIn('sam');
  await controller.openExpense(groupId, expenseId);
  const savedAt = f.clock.now;
  f.clock.now += 3_600_000;
  f.server.offline = true;
  if (restart) {
    controller.dispose();
    controller = f.create();
    await controller.restore();
  }
  await controller.openExpense(groupId, expenseId);
  expect(controller.getSnapshot()).toMatchObject({
    screen: 'expense',
    offline: { active: true, refreshedAt: savedAt },
    expense: {
      status: 'detail',
      draft: { original: { _id: expenseId, revision: 3, description: 'Electricity bill' } },
      history: { status: 'ready', events: [{ _id: added._id }] },
    },
  });
  f.sent();
  return { f, controller, savedAt };
}

/** While Sam was offline, Priya renamed the Expense. */
function renamedMeanwhile(f: Fixture) {
  f.server.record = record(4, 'Electricity bill (August)');
  f.server.events = [renamed, added];
}

/** Runs a Try again whose request for `path` gets this response; false when none was sent. */
async function answering(
  f: Fixture,
  path: string,
  run: () => Promise<void>,
  during: () => Promise<void> | void,
  response: () => FetchResponse,
) {
  f.hold((sent) => sent === path);
  const running = run();
  const held = await Promise.race([f.held.next(path), running.then(() => null)]);
  f.hold(() => false);
  if (held) {
    await during();
    held.release(response());
  }
  await running;
  return held !== null;
}

/** The record and its changes are gone from the screen; what's left says why. */
const withdrawn = (controller: Controller, message: string) =>
  expect(controller.getSnapshot()).toMatchObject({
    screen: 'expense',
    offline: { active: false },
    expense: {
      status: 'blocked',
      draft: null,
      latest: null,
      message,
      history: { status: 'idle', events: [] },
    },
  });

describe('Try again on an Expense record opened from its saved copy (#192)', () => {
  it.each([
    ['in the same session', false],
    ['after restarting offline', true],
  ] as const)(
    'reads the record and its changes again after reconnecting, and the offline notice clears (%s)',
    async (_, restart) => {
      const { f, controller, savedAt } = await openedOffline(restart);

      // Still offline: the saved copy stays, with the time it was saved.
      await controller.refresh();
      expect(f.sent()).toEqual([]);
      expect(controller.getSnapshot()).toMatchObject({
        offline: { active: true, refreshedAt: savedAt },
        expense: { status: 'detail', draft: { original: { revision: 3 } } },
      });

      f.server.offline = false;
      renamedMeanwhile(f);
      await controller.refresh();
      const sent = f.sent();
      // Access is checked first: the session, then the Group, then the record and its changes.
      expect(sent[0]).toBe(sessionRead);
      expect(groupReads(sent)).toEqual([
        `GET ${groupPath}`,
        `GET ${recordPath}`,
        `GET ${historyPath}`,
      ]);
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'expense',
        offline: { active: false, message: null },
        expense: {
          status: 'detail',
          message: null,
          draft: {
            description: 'Electricity bill (August)',
            original: { _id: expenseId, revision: 4, description: 'Electricity bill (August)' },
          },
          history: { expenseId, status: 'ready', message: null },
        },
      });
      expect(controller.getSnapshot().expense.history.events.map(({ _id }) => _id)).toEqual([
        renamed._id,
        added._id,
      ]);
      // The current version is what this device keeps for offline use now.
      expect(f.saved(recordPath)?.value.data).toMatchObject({ revision: 4 });
      expect(f.drafts.size).toBe(0);
      expect(sent.filter((request) => !request.startsWith('GET '))).toEqual([]);
    },
  );

  it('keeps the saved record and its notice when reading the record again fails', async () => {
    const { f, controller, savedAt } = await openedOffline(false);
    f.server.offline = false;
    renamedMeanwhile(f);
    f.server.expense = 500;
    await controller.refresh();
    expect(groupReads(f.sent())).toEqual([`GET ${groupPath}`, `GET ${recordPath}`]);
    expect(controller.getSnapshot()).toMatchObject({
      offline: { active: true, refreshedAt: savedAt },
      expense: {
        status: 'detail',
        draft: { original: { revision: 3, description: 'Electricity bill' } },
        history: { status: 'ready', events: [{ _id: added._id }] },
      },
    });
  });

  it.each([
    [403, 'You no longer have access to this group.'],
    [404, 'This group is no longer available.'],
  ] as const)(
    'withdraws the Expense as before when its Group answers %i, and the offline notice goes',
    async (status, message) => {
      const { f, controller } = await openedOffline(false);
      f.server.offline = false;
      f.server.group = status;
      await controller.refresh();
      expect(groupReads(f.sent())).toEqual([`GET ${groupPath}`]);
      withdrawn(controller, message);
      expect(controller.getSnapshot().groups.data).toEqual([]);
      expect([...f.cache.keys()].some((key) => key.includes(groupPath))).toBe(false);
    },
  );

  it('withdraws the Expense when its own read is refused after its Group was read', async () => {
    const { f, controller } = await openedOffline(false);
    f.server.offline = false;
    f.server.expense = 403;
    await controller.refresh();
    expect(groupReads(f.sent())).toEqual([`GET ${groupPath}`, `GET ${recordPath}`]);
    withdrawn(controller, 'You no longer have access to this group.');
    expect(controller.getSnapshot().groups.data).toEqual([]);
    expect([...f.cache.keys()].some((key) => key.includes(groupPath))).toBe(false);
  });

  it('says the Expense isn’t available when its own read finds it gone, and keeps the Group', async () => {
    const { f, controller } = await openedOffline(false);
    f.server.offline = false;
    f.server.expense = 404;
    await controller.refresh();
    expect(groupReads(f.sent())).toEqual([`GET ${groupPath}`, `GET ${recordPath}`]);
    withdrawn(controller, 'This Expense isn’t available.');
    expect(controller.getSnapshot().groups.data.map(({ id }) => id)).toEqual([groupId]);
    expect(f.saved(groupPath)).toBeDefined();
  });

  it('keeps an edit begun while the record is read again, on the version it started from', async () => {
    const { f, controller } = await openedOffline(false);
    f.server.offline = false;
    renamedMeanwhile(f);
    const editing = async () => {
      await controller.editExpense();
      await controller.updateExpenseDraft({ notes: 'Meter read on the 20th' });
    };
    expect(
      await answering(
        f,
        recordPath,
        () => controller.refresh(),
        editing,
        () => f.answer(recordPath),
      ),
    ).toBe(true);
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'editing',
      draft: {
        description: 'Electricity bill',
        notes: 'Meter read on the 20th',
        original: { revision: 3 },
      },
    });
    expect(groupReads(f.sent())).toEqual([`GET ${groupPath}`, `GET ${recordPath}`]);
  });

  it.each([
    ['Back', 200],
    ['Back', 404],
    ['sign-out', 200],
    ['sign-out', 404],
    ['an invitation opened over it', 200],
    ['an invitation opened over it', 404],
  ] as const)(
    'publishes nothing from a record read that lands after %s (%i)',
    async (move, status) => {
      const { f, controller } = await openedOffline(false);
      f.server.offline = false;
      renamedMeanwhile(f);
      let left: ReturnType<Controller['getSnapshot']>['expense'] | undefined;
      const moving = async () => {
        if (move === 'Back') await controller.back();
        else if (move === 'sign-out') await controller.signOut();
        else await controller.openInvitation('http://localhost:4138/join/abcdef12');
        left = controller.getSnapshot().expense;
      };
      const response = () =>
        status === 200 ? f.answer(recordPath) : json({ error: 'Unavailable', status }, status);
      expect(await answering(f, recordPath, () => controller.refresh(), moving, response)).toBe(
        true,
      );
      const state = controller.getSnapshot(),
        sent = f.sent();
      // The Expense is as the member left it, and nothing more is read for it.
      expect(state.expense).toEqual(left);
      expect(sent.filter((request) => request.includes('/activity?expenseId='))).toEqual([]);
      if (move === 'Back')
        expect(state).toMatchObject({ screen: 'group', detail: { id: groupId, status: 'ready' } });
      else if (move === 'sign-out') {
        expect(state.auth.status).toBe('signed-out');
        expect(f.cache.size).toBe(0);
      } else {
        // The refresh never retries an invitation the member didn't ask to.
        expect(state).toMatchObject({ screen: 'invite', invitation: { status: 'error' } });
        expect(sent.filter((request) => request.includes('/api/join/'))).toEqual([]);
      }
    },
  );
});
