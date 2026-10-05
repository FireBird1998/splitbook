import { describe, expect, it } from 'vitest';
import { createMobileController } from './mobile-controller';
import type { FetchResponse } from './types';

// #192: Try again on an Expense record opened from its saved copy. Fictional people and Groups only.
const sam = { id: 'a00000000000000000000002', name: 'Sam Chen', email: 'sam@example.test' };
const priya = { id: 'a00000000000000000000003', name: 'Priya Shah', email: 'priya@example.test' };
const groupId = 'a00000000000000000000010';
const expenseId = 'b00000000000000000000001';
/** Another Expense in the same Group. */
const otherId = 'b00000000000000000000002';
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
const record = (revision: number, description: string, id = expenseId) => ({
  _id: id,
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
const event = (
  id: string,
  at: string,
  type: string,
  changes: Record<string, unknown> = {},
  about = expenseId,
  description = 'Electricity bill',
) => ({
  _id: id,
  group: groupId,
  actor: person(priya),
  createdAt: at,
  type,
  metadata: { expenseId: about, description, changes },
});
const added = event('d00000000000000000000001', iso, 'expense_added');
/** Priya renamed the Expense while Sam was offline. */
const renamed = event('d00000000000000000000002', '2026-09-27T10:00:00.000Z', 'expense_updated', {
  description: { old: 'Electricity bill', new: 'Electricity bill (August)' },
});
const other = record(1, 'Water bill', otherId);
const otherAdded = event(
  'd00000000000000000000003',
  iso,
  'expense_added',
  {},
  otherId,
  'Water bill',
);
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
    /** The Expense's own path only, after its Group has been read. */
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
  const respond = (path: string, method = 'GET', revision?: string): FetchResponse => {
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
    if (path === recordPath && server.expense !== 200)
      return json({ error: 'Unavailable', status: server.expense }, server.expense);
    if (path === recordPath && method !== 'GET') {
      // An edit or deletion applies only to the revision it was shown.
      if (revision !== String(server.record.revision))
        return json({ error: 'This Expense changed', code: 'STALE_REVISION', status: 409 }, 409);
      server.record = {
        ...server.record,
        revision: server.record.revision + 1,
        isDeleted: method === 'DELETE',
      };
    }
    if (path === recordPath) return json({ status: 200, data: server.record });
    if (path === `${groupPath}/expenses/${otherId}`) return json({ status: 200, data: other });
    if (path.startsWith(`${groupPath}/activity?`)) {
      const query = new URL(path, 'http://local').searchParams;
      const page = Number(query.get('page'));
      const events = query.get('expenseId') === otherId ? [otherAdded] : server.events;
      return json({
        status: 200,
        data: {
          activities: events.slice((page - 1) * 20, page * 20),
          pagination: { page, limit: 20, total: events.length, totalPages: 1 },
        },
      });
    }
    if (path.startsWith(`${groupPath}/expenses?`))
      return json({
        status: 200,
        data: {
          expenses: [server.record, other],
          pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
          summary: { count: 2, totalsByCurrency: [], userOwes: 0, userGetsBack: 0, byMember: [] },
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
          const method = init.method ?? 'GET';
          const revision = (init.headers as Record<string, string>)['X-Splitbook-Revision'];
          const sent = `${method} ${path}${revision === undefined ? '' : ` (revision ${revision})`}`;
          // Attempts made offline are logged too, marked as never reaching the server.
          if (server.offline) {
            requests.push(`${sent} (offline)`);
            throw new Error('Offline');
          }
          requests.push(sent);
          if (holding(path)) return held.hold(path);
          return respond(path, method, revision);
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
    /** The answer the fictional backend gives Sam for this read right now. */
    answer: (path: string) => respond(path),
    /** Requests made since the last call, those attempted offline included. */
    sent: () => requests.splice(0),
    /** Whether this device keeps a saved copy of this path for Sam. */
    saved: (path: string) => cache.get(sam.id + path) as { value: { data: unknown } } | undefined,
  };
}
type Fixture = ReturnType<typeof fixture>;
type Controller = ReturnType<Fixture['create']>;

/**
 * The reads of the Group, the Expense and its changes among these requests, in order. Each read
 * made while the offline notice is up checks the session first; those checks are left out.
 */
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

      // Still offline: only reads are tried, and the saved copy stays with the time it was saved.
      await controller.refresh();
      const tried = f.sent();
      expect(tried[0]).toBe(`${sessionRead} (offline)`);
      expect(tried.every((request) => /^GET .* \(offline\)$/.test(request))).toBe(true);
      expect(controller.getSnapshot()).toMatchObject({
        offline: { active: true, refreshedAt: savedAt },
        expense: { status: 'detail', draft: { original: { revision: 3 } } },
      });

      f.server.offline = false;
      renamedMeanwhile(f);
      await controller.refresh();
      const sent = f.sent();
      // The session is checked first, and again before each read while the offline notice is
      // up; the Group, the record and its changes are read in that order.
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

  it('reads only the session and the Group on a foreground refresh; only Try again reads the record', async () => {
    const { f, controller, savedAt } = await openedOffline(false);
    f.server.offline = false;
    renamedMeanwhile(f);
    await controller.refresh('foreground');
    expect(f.sent()).toEqual([sessionRead, sessionRead, `GET ${groupPath}`]);
    expect(controller.getSnapshot()).toMatchObject({
      offline: { active: true, refreshedAt: savedAt },
      expense: { status: 'detail', draft: { original: { revision: 3 } } },
    });
  });

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

  it('clears the notice for an edit begun offline, keeping its draft and the revision it started from', async () => {
    const { f, controller } = await openedOffline(false);
    await controller.editExpense();
    await controller.updateExpenseDraft({ notes: 'Meter read on the 20th' });
    f.server.offline = false;
    renamedMeanwhile(f);
    await controller.refresh();
    expect(groupReads(f.sent())).toEqual([
      `GET ${groupPath}`,
      `GET ${recordPath}`,
      `GET ${historyPath}`,
    ]);
    expect(controller.getSnapshot()).toMatchObject({
      offline: { active: false },
      expense: {
        status: 'editing',
        context: { group: { id: groupId } },
        draft: {
          description: 'Electricity bill',
          notes: 'Meter read on the 20th',
          original: { revision: 3 },
        },
      },
    });
    expect(f.saved(recordPath)?.value.data).toMatchObject({ revision: 4 });

    // Saving sends the revision the edit started from; the server's check refuses it as stale,
    // and the member compares it with the current version, as for any stale edit.
    await controller.saveExpense();
    expect(f.sent().filter((request) => !request.startsWith('GET '))).toEqual([
      `PATCH ${recordPath} (revision 3)`,
    ]);
    expect(f.server.record).toMatchObject({ revision: 4, isDeleted: false });
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'conflict',
      latest: { revision: 4, description: 'Electricity bill (August)' },
      draft: { notes: 'Meter read on the 20th', original: { revision: 3 } },
    });
  });

  it('clears the notice for a deletion reviewed offline, which still sends the revision it was shown', async () => {
    const { f, controller } = await openedOffline(false);
    controller.reviewExpenseDeletion();
    f.server.offline = false;
    renamedMeanwhile(f);
    await controller.refresh();
    expect(groupReads(f.sent())).toEqual([
      `GET ${groupPath}`,
      `GET ${recordPath}`,
      `GET ${historyPath}`,
    ]);
    expect(controller.getSnapshot()).toMatchObject({
      offline: { active: false },
      expense: {
        status: 'delete-review',
        draft: { original: { revision: 3, description: 'Electricity bill' } },
      },
    });

    await controller.deleteExpense();
    expect(f.sent().filter((request) => !request.startsWith('GET '))).toEqual([
      `DELETE ${recordPath} (revision 3)`,
    ]);
    expect(f.server.record).toMatchObject({ revision: 4, isDeleted: false });
    expect(controller.getSnapshot().expense).toMatchObject({ latest: { revision: 4 } });
  });

  it('keeps an edit, with its Group’s details, when its Expense is found gone', async () => {
    const { f, controller } = await openedOffline(false);
    await controller.editExpense();
    await controller.updateExpenseDraft({ notes: 'Meter read on the 20th' });
    f.server.offline = false;
    f.server.expense = 404;
    await controller.refresh();
    expect(groupReads(f.sent())).toEqual([`GET ${groupPath}`, `GET ${recordPath}`]);
    expect(controller.getSnapshot()).toMatchObject({
      offline: { active: false },
      expense: {
        status: 'editing',
        message: null,
        context: { group: { id: groupId } },
        draft: { notes: 'Meter read on the 20th', original: { revision: 3 } },
      },
    });
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
    expect(controller.getSnapshot()).toMatchObject({
      offline: { active: false },
      expense: {
        status: 'editing',
        draft: {
          description: 'Electricity bill',
          notes: 'Meter read on the 20th',
          original: { revision: 3 },
        },
      },
    });
    expect(groupReads(f.sent())).toEqual([
      `GET ${groupPath}`,
      `GET ${recordPath}`,
      `GET ${historyPath}`,
    ]);
  });

  it.each([
    ['Back', 200],
    ['Back', 404],
    ['Back, then opening another Expense', 200],
    ['Back, then opening another Expense', 404],
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
        if (move === 'sign-out') await controller.signOut();
        else if (move === 'an invitation opened over it')
          await controller.openInvitation('http://localhost:4138/join/abcdef12');
        else {
          await controller.back();
          if (move !== 'Back') await controller.openExpense(groupId, otherId);
        }
        left = controller.getSnapshot().expense;
      };
      const response = () =>
        status === 200 ? f.answer(recordPath) : json({ error: 'Unavailable', status }, status);
      expect(await answering(f, recordPath, () => controller.refresh(), moving, response)).toBe(
        true,
      );
      const state = controller.getSnapshot(),
        sent = f.sent();
      // The Expense on screen is as the member left it, and the late record's changes aren't read.
      expect(state.expense).toEqual(left);
      expect(sent).not.toContain(`GET ${historyPath}`);
      if (move === 'Back')
        expect(state).toMatchObject({ screen: 'group', detail: { id: groupId, status: 'ready' } });
      else if (move === 'Back, then opening another Expense')
        expect(state).toMatchObject({
          screen: 'expense',
          expense: {
            status: 'detail',
            draft: { original: { _id: otherId, description: 'Water bill' } },
            history: { expenseId: otherId, status: 'ready', events: [{ _id: otherAdded._id }] },
          },
        });
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
