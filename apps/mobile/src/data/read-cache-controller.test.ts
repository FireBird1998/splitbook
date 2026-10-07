import { describe, expect, it, vi } from 'vitest';
import { getLocalMonthIsoRange } from '@splitbook/shared/date';
import { DISPLAY_FRESHNESS_MS, createMobileController } from './mobile-controller';
import type { FetchResponse, PendingInvitationStore } from './types';
import { refreshFeedback } from '../ui/refresh-feedback';
import { savedQueriesIn } from '../test-utils/saved-queries';

// #103: reuse cached views and coalesce foreground reads.
const alex = {
  id: 'a00000000000000000000001',
  name: 'Alex',
  email: 'alex@example.test',
  image: null,
};
const sam = { id: 'a00000000000000000000002', name: 'Sam', email: 'sam@example.test', image: null };
const groupId = 'b00000000000000000000001';
const tagId = 'c00000000000000000000001';
const iso = '2026-09-15T06:30:00.000Z';
const person = (user: typeof alex) => ({ _id: user.id, name: user.name, image: null });
const group = {
  _id: groupId,
  createdBy: alex.id,
  name: 'Maple House',
  category: 'home',
  defaultCurrency: 'INR',
  members: [alex, sam].map((user) => ({
    user: { ...person(user), email: user.email },
    role: 'member',
    joinedAt: iso,
  })),
  tags: [{ _id: tagId, name: 'Rent', isArchived: false, createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
};
const json = (body: unknown, status = 200) => Response.json(body, { status });
const monthOf = (path: string) => {
  const from = new URL(path, 'http://local').searchParams.get('dateFrom');
  return ['2026-08', '2026-09'].find((month) => getLocalMonthIsoRange(month).dateFrom === from);
};

/** Hold matching requests until released, to observe overlapping and late reads. */
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
        const index = waiting.findIndex((entry) => entry.path.includes(match));
        if (index >= 0) return waiting.splice(index, 1)[0];
        await new Promise<void>((resolve) => arrivals.push(resolve));
      }
    },
  };
}

/**
 * A fictional backend whose ledger version rises with every accepted write, plus
 * persistent device stores that survive a controller restart.
 */
function fixture(options: { freshness?: number; pendingInvitation?: PendingInvitationStore } = {}) {
  const clock = { now: Date.parse(iso) };
  const state = {
    ledger: 0,
    offline: false,
    revoked: false,
    loseWrites: false,
    failGroup: 0,
  };
  let cookie: string | null = null,
    owner: string | null = null,
    cleanup = false,
    keys = 0;
  const disk = new Map<string, unknown>(),
    drafts = new Map<string, unknown>(),
    attempts = new Map<string, unknown>();
  const calls: { method: string; path: string }[] = [];
  const held = gate();
  let holding: (path: string, method: string) => boolean = () => false;
  const records = (map: Map<string, unknown>) => ({
    load: async (account: string, key: string) => structuredClone(map.get(account + key) ?? null),
    save: async (account: string, key: string, value: unknown) => {
      map.set(account + key, structuredClone(value));
    },
    remove: async (account: string, key: string) => {
      map.delete(account + key);
    },
    clear: async () => {
      map.clear();
    },
  });
  const signedIn = (init: RequestInit) =>
    String((init.headers as Record<string, string>).Cookie ?? '').includes('sam.') ? sam : alex;
  const respond = (path: string, init: RequestInit): FetchResponse => {
    const method = init.method ?? 'GET';
    const user = signedIn(init);
    if (path.endsWith('/sign-in')) {
      const persona = String(init.body).includes('sam') ? 'sam' : 'alex';
      return new Response(JSON.stringify({ user: persona === 'sam' ? sam : alex }), {
        headers: {
          'Set-Cookie': `better-auth.session_token=${persona}.signature; Path=/; HttpOnly`,
        },
      });
    }
    if (path.endsWith('/get-session'))
      return json({ user, session: { userId: user.id, expiresAt: '2030-01-01T00:00:00Z' } });
    if (path.endsWith('/sign-out')) return json({ success: true });
    if (state.revoked && path.startsWith(`/api/groups/${groupId}`)) return json({}, 403);
    if (path === '/api/groups') return json({ status: 200, data: state.revoked ? [] : [group] });
    if (path === '/api/user/balances')
      return json({
        status: 200,
        data: { buckets: [{ currency: 'INR', youOwe: 30 + state.ledger, youAreOwed: 0 }] },
      });
    if (path === `/api/groups/${groupId}`)
      return state.failGroup ? json({}, state.failGroup) : json({ status: 200, data: group });
    if (path.startsWith(`/api/groups/${groupId}/expenses?`))
      return json({
        status: 200,
        data: {
          expenses: [
            {
              _id: 'd00000000000000000000001',
              group: groupId,
              description: `${monthOf(path) ?? 'All'} rent, ledger ${state.ledger}`,
              currency: 'INR',
              amount: 10,
              amountMinor: 1000,
              moneyVersion: 1,
              category: 'food',
              tag: 'Rent',
              tagId,
              date: iso,
              createdAt: iso,
              updatedAt: iso,
              paidBy: [{ user: person(alex), amount: 10, amountMinor: 1000 }],
              splitBetween: [{ user: person(alex), amount: 10, amountMinor: 1000 }],
              splitMethod: 'equal',
            },
          ],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
          summary: {
            count: 1,
            totalsByCurrency: [{ currency: 'INR', totalAmount: 10 }],
            userOwes: 0,
            userGetsBack: 0,
            byMember: [],
          },
        },
      });
    if (path === `/api/groups/${groupId}/expenses` && method === 'POST') {
      if (state.loseWrites) throw new Error('Lost response');
      state.ledger += 1;
      return json({ status: 201, data: { _id: 'd00000000000000000000009', group: groupId } }, 201);
    }
    if (path === `/api/groups/${groupId}/balances`)
      return json({
        status: 200,
        data: {
          byCurrency: [
            {
              currency: 'INR',
              balances: [],
              debts: [{ from: person(alex), to: person(sam), amount: 30 + state.ledger }],
            },
          ],
        },
      });
    if (path.startsWith(`/api/groups/${groupId}/activity?`))
      return json({
        status: 200,
        data: {
          activities: [
            {
              _id: 'e00000000000000000000001',
              group: groupId,
              actor: { _id: alex.id, name: 'Alex' },
              type: 'expense_added',
              createdAt: iso,
              metadata: { description: `ledger ${state.ledger}` },
            },
          ],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      });
    if (path === `/api/groups/${groupId}/settlements` && method === 'POST') {
      state.ledger += 1;
      const body = JSON.parse(String(init.body));
      const people = { [alex.id]: alex, [sam.id]: sam };
      return json(
        {
          status: 201,
          data: {
            _id: 'f00000000000000000000001',
            group: groupId,
            paidBy: person(people[body.paidBy]),
            paidTo: person(people[body.paidTo]),
            createdBy: person(user),
            amount: body.amount,
            amountMinor: Math.round(body.amount * 100),
            moneyVersion: 1,
            currency: body.currency,
            note: body.note ?? '',
            createdAt: iso,
            updatedAt: iso,
          },
        },
        201,
      );
    }
    if (path === `/api/groups/${groupId}/settlements`) return json({ status: 200, data: [] });
    return json({}, 404);
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
        displayFreshnessMs: options.freshness,
        pendingInvitation: options.pendingInvitation,
        newSubmissionKey: () => `attempt-${String(++keys).padStart(4, '0')}`,
        credentials: {
          load: async () => cookie,
          save: async (value) => {
            cookie = value;
          },
          clear: async () => {
            cookie = null;
          },
        },
        savedQueries: savedQueriesIn(disk),
        readCache: {
          ...records(disk),
          invalidateGroup: async (account, id) => {
            for (const key of disk.keys())
              if (
                key.startsWith(`${account}/api/groups/${id}`) ||
                key === `${account}/api/groups` ||
                key === `${account}/api/user/balances`
              )
                disk.delete(key);
          },
          invalidateLedger: async (account, id) => {
            for (const key of disk.keys())
              if (
                key.startsWith(`${account}/api/groups/${id}/`) ||
                key.startsWith(`${account}/api/groups/${id}?`) ||
                key === `${account}/api/user/balances`
              )
                disk.delete(key);
          },
          retainGroups: async (account, ids) => {
            for (const key of disk.keys()) {
              const id = /^\/api\/groups\/([a-f\d]{24})/.exec(key.slice(account.length))?.[1];
              if (key.startsWith(account) && id && !ids.includes(id)) disk.delete(key);
            }
          },
        },
        offlineIdentity: {
          load: async () => null,
          save: async () => undefined,
          clear: async () => undefined,
        },
        expenseDrafts: records(drafts),
        settlementAttempts: records(attempts),
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
          stores: [records(disk), records(drafts), records(attempts)],
        },
        fetch: async (url, init) => {
          const path = new URL(url).pathname + new URL(url).search;
          const method = init.method ?? 'GET';
          if (state.offline) throw new Error('Offline');
          calls.push({ method, path });
          if (holding(path, method)) {
            const response = await held.hold(path);
            if (response.status === 598) throw new Error('Lost response');
            return response.status === 599 ? respond(path, init) : response;
          }
          return respond(path, init);
        },
      },
    );
  /** GET requests for exactly this path, or starting with it when it ends in `?`. */
  const reads = (match: string) =>
    calls.filter(
      (call) =>
        call.method === 'GET' &&
        (call.path === match || (match.endsWith('?') && call.path.startsWith(match))),
    ).length;
  return {
    create,
    clock,
    state,
    calls,
    disk,
    drafts,
    reads,
    held,
    hold(match: (path: string, method: string) => boolean) {
      holding = match;
    },
    /** Answer a held request from the fictional backend's state at release time. */
    live: () => new Response(null, { status: 599 }),
    /** The response Alex would receive for this path right now. */
    answer: (path: string) => respond(path, { headers: { Cookie: 'alex.signature' } }),
    /** A request that reached the server but whose response never arrived. */
    lost: () => new Response(null, { status: 598 }),
  };
}

const groupPath = `/api/groups/${groupId}`;
const expenseReads = `/api/groups/${groupId}/expenses?`;
const balanceReads = `/api/groups/${groupId}/balances`;

describe('cached views and coalesced reads (#103)', () => {
  it.each(['before', 'after'] as const)(
    'finishes cached Group reads when its request completes %s the payment sheet closes',
    async (completion) => {
      const f = fixture();
      const controller = f.create();
      await controller.signIn('alex');
      await controller.openGroup(groupId, true, 'balances');
      await controller.back();
      f.clock.now += DISPLAY_FRESHNESS_MS + 1;
      f.hold((path) => path === groupPath);
      const opening = controller.openGroup(groupId, true, 'balances');
      const held = await f.held.next(groupPath);
      await vi.waitFor(() => {
        expect(controller.getSnapshot()).toMatchObject({
          detail: { status: 'loading', data: { id: groupId } },
          financial: {
            expenses: { status: 'loading', data: [{ description: '2026-09 rent, ledger 0' }] },
            balances: { status: 'loading', data: [{ debts: [{ amount: 30 }] }] },
          },
        });
      });
      f.hold(() => false);
      await controller.openRecordPayment(alex.id, sam.id, 'INR');
      expect(controller.getSnapshot().settlement.status).toBe('editing');
      const before = f.calls.length;
      if (completion === 'after') await controller.back();
      held.release(f.live());
      await opening;
      expect(controller.getSnapshot()).toMatchObject({
        screen: completion === 'before' ? 'settlement' : 'group',
        financial: { expenses: { status: 'ready' }, balances: { status: 'ready' } },
      });
      if (completion === 'before') await controller.back();
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'group',
        destination: 'balances',
        financial: { expenses: { status: 'ready' }, balances: { status: 'ready' } },
      });
      // The Month's Expenses were read beside the Group (#219): only Balances follow its answer.
      expect(f.calls.slice(before).map((call) => [call.method, call.path.split('?')[0]])).toEqual([
        ['GET', balanceReads],
      ]);
    },
  );

  it('starts with an adjustable 30-second display freshness window', async () => {
    expect(DISPLAY_FRESHNESS_MS).toBe(30_000);
    const f = fixture({ freshness: 5_000 });
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    f.clock.now += 4_000;
    await controller.refresh('foreground');
    expect(f.reads(groupPath)).toBe(1);
    f.clock.now += 2_000;
    await controller.refresh('foreground');
    expect(f.reads(groupPath)).toBe(2);
  });

  it('reuses a recently verified Group with its original times when navigating back to it', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const verifiedAt = f.clock.now;
    await controller.openGroup(groupId);
    await controller.back();
    f.clock.now += 20_000;
    const before = f.calls.length;
    await controller.openGroup(groupId);
    await controller.refresh('foreground');
    expect(f.calls.slice(before)).toEqual([]);
    expect(controller.getSnapshot()).toMatchObject({
      detail: { status: 'ready', refreshedAt: verifiedAt },
      financial: {
        month: '2026-09',
        expenses: { status: 'ready', refreshedAt: verifiedAt, month: '2026-09' },
        balances: { status: 'ready', refreshedAt: verifiedAt, stale: false },
      },
    });
  });

  it('reads again after the window, Group before Expenses before Balances', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    f.clock.now += 31_000;
    const before = f.calls.length;
    await controller.refresh('foreground');
    expect(f.calls.slice(before).map((call) => call.path.split('?')[0])).toEqual([
      groupPath,
      `/api/groups/${groupId}/expenses`,
      balanceReads,
    ]);
    expect(controller.getSnapshot().financial.balances.refreshedAt).toBe(f.clock.now);
  });

  it('bypasses the window for a pull, Retry and each section Retry, keeping the pull indicator to pulls', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    const pulls: (string | null)[] = [];
    controller.subscribe(() => pulls.push(controller.getSnapshot().pull));

    await controller.refresh('pull');
    expect(pulls).toContain(`group:${groupId}:expenses`);
    expect([f.reads(groupPath), f.reads(expenseReads), f.reads(balanceReads)]).toEqual([2, 2, 2]);

    pulls.length = 0;
    await controller.refresh();
    await controller.refreshExpenses();
    await controller.refreshBalances();
    await controller.refresh('foreground');
    expect(pulls.every((pull) => pull === null)).toBe(true);
    expect([f.reads(groupPath), f.reads(expenseReads), f.reads(balanceReads)]).toEqual([3, 4, 5]);

    await controller.back();
    const home = f.reads('/api/user/balances');
    await controller.refreshHome();
    expect(f.reads('/api/user/balances')).toBe(home + 1);
  });

  it('shares one in-flight read between overlapping foreground events and a pull', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    f.clock.now += 31_000;
    f.hold((path) => path === groupPath);
    const refreshes = [controller.refresh('foreground'), controller.refresh('foreground')];
    const read = await f.held.next(groupPath);
    refreshes.push(controller.refresh('pull'), controller.refresh('foreground'));
    expect(controller.getSnapshot().pull).toBe(`group:${groupId}:expenses`);
    read.release(f.live());
    await Promise.all(refreshes);
    expect([f.reads(groupPath), f.reads(expenseReads), f.reads(balanceReads)]).toEqual([2, 2, 2]);
    expect(controller.getSnapshot()).toMatchObject({
      pull: null,
      detail: { status: 'ready' },
      financial: { expenses: { status: 'ready' }, balances: { status: 'ready', stale: false } },
    });
  });

  it('keeps a pull explicit when a foreground refresh overlaps it, reading current Expenses and Balances', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    f.state.ledger += 1;
    f.hold((path) => path === groupPath);
    const pulling = controller.refresh('pull');
    const read = await f.held.next(groupPath);
    // Within the freshness window, but an explicit refresh of this Group is still running.
    const foreground = controller.refresh('foreground');
    await new Promise((resolve) => setTimeout(resolve, 0));
    f.hold(() => false);
    read.release(f.live());
    await Promise.all([pulling, foreground]);
    expect([f.reads(groupPath), f.reads(expenseReads), f.reads(balanceReads)]).toEqual([2, 2, 2]);
    expect(controller.getSnapshot()).toMatchObject({
      pull: null,
      financial: {
        expenses: { status: 'ready', data: [{ description: '2026-09 rent, ledger 1' }] },
        balances: { status: 'ready', stale: false, data: [{ debts: [{ amount: 31 }] }] },
      },
    });
  });

  it('keeps a pull on Groups explicit when a foreground refresh overlaps it, reading current Home', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    f.state.ledger += 1;
    f.hold((path) => path === '/api/groups');
    const pulling = controller.refresh('pull');
    const read = await f.held.next('/api/groups');
    const foreground = controller.refresh('foreground');
    await new Promise((resolve) => setTimeout(resolve, 0));
    f.hold(() => false);
    read.release(f.live());
    await Promise.all([pulling, foreground]);
    expect(controller.getSnapshot().home).toMatchObject({
      status: 'ready',
      data: [{ youOwe: 31 }],
    });
  });

  it('reads Balances only after a pending Month read that may add recurring Expenses', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    f.hold((path, method) => method === 'GET' && monthOf(path) === '2026-08');
    const august = controller.selectMonth('2026-08');
    const held = await f.held.next(expenseReads);
    // Back to the recently verified September while August's read is still pending.
    const september = controller.selectMonth('2026-09');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(controller.getSnapshot().financial.expenses).toMatchObject({
      month: '2026-09',
      status: 'ready',
    });
    // August's read materializes a due recurring Expense before it answers.
    f.state.ledger += 1;
    f.hold(() => false);
    held.release(f.live());
    await Promise.all([august, september]);
    expect(controller.getSnapshot().financial).toMatchObject({
      month: '2026-09',
      expenses: { month: '2026-09', data: [{ description: '2026-09 rent, ledger 0' }] },
      balances: { status: 'ready', stale: false, data: [{ debts: [{ amount: 31 }] }] },
    });
    // Home, read afterwards, follows the same ledger.
    await controller.back();
    expect(controller.getSnapshot().home.data).toMatchObject([{ youOwe: 31 }]);
  });

  it('reads Balances again when that pending Month read settles while they are still being read', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    f.hold((path, method) => method === 'GET' && monthOf(path) === '2026-08');
    const august = controller.selectMonth('2026-08');
    const augustRead = await f.held.next(expenseReads);
    f.hold((path) => path === balanceReads || monthOf(path) === '2026-08');
    const september = controller.selectMonth('2026-09');
    const balanceRead = await f.held.next(balanceReads);
    const beforeAugust = f.answer(balanceRead.path);
    f.state.ledger += 1;
    f.hold(() => false);
    augustRead.release(f.live());
    await august;
    // The Balance response began before August materialized: it is read again.
    balanceRead.release(beforeAugust);
    await september;
    expect(f.reads(balanceReads)).toBe(3);
    expect(controller.getSnapshot().financial).toMatchObject({
      month: '2026-09',
      balances: { status: 'ready', stale: false, data: [{ debts: [{ amount: 31 }] }] },
    });
  });

  it('switches back to a recent Month without reading, and never reuses Balances older than an Expense read', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    await controller.selectMonth('2026-08');
    const before = f.calls.length;
    await controller.selectMonth('2026-09');
    expect(f.calls.slice(before)).toEqual([]);
    expect(controller.getSnapshot().financial.expenses).toMatchObject({
      month: '2026-09',
      status: 'ready',
      data: [{ description: '2026-09 rent, ledger 0' }],
    });

    // Rapid Month changes share the reads they overlap with; the newest Month wins.
    f.clock.now += 31_000;
    const reads = f.calls.length;
    await Promise.all([
      controller.selectMonth('2026-08'),
      controller.selectMonth('2026-09'),
      controller.selectMonth('2026-08'),
    ]);
    const paths = f.calls.slice(reads).map((call) => monthOf(call.path) ?? call.path);
    expect(paths.filter((path) => path === '2026-08')).toHaveLength(1);
    // Balances are read only after the last Expense read that could change them.
    expect(paths.at(-1)).toBe(balanceReads);
    expect(controller.getSnapshot().financial).toMatchObject({
      month: '2026-08',
      expenses: { month: '2026-08', data: [{ description: '2026-08 rent, ledger 0' }] },
      balances: { status: 'ready', stale: false },
    });
  });

  it('never joins or keeps a read that started before a confirmed Expense, and shows the newer state', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    f.clock.now += 31_000;
    f.hold((path, method) => method === 'GET' && path.startsWith(expenseReads));
    const refreshing = controller.refresh('foreground');
    const older = await f.held.next(expenseReads);
    const beforeSave = f.answer(older.path);
    f.hold(() => false);

    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Dinner', amount: '12', tagId });
    await controller.saveExpense();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      expense: { status: 'saved' },
      financial: { expenses: { data: [{ description: '2026-09 rent, ledger 1' }] } },
    });
    // The pre-save response arrives last: it is neither shown nor kept for reuse.
    older.release(beforeSave);
    await refreshing;
    expect(controller.getSnapshot().financial.expenses.data).toMatchObject([
      { description: '2026-09 rent, ledger 1' },
    ]);
    const savedPages = [...f.disk].filter(([key]) => key.includes('/expenses?'));
    expect(savedPages).toHaveLength(1);
    expect(JSON.stringify(savedPages[0][1])).toContain('ledger 1');
    await controller.back();
    const before = f.calls.length;
    await controller.openGroup(groupId);
    // The newer reads are reused. Balances are read again, once: the pre-save Expense read, sent
    // beside the Group (#219), finished after them, once the member had left (AMEND-1).
    expect(f.calls.slice(before).map(({ method, path }) => `${method} ${path}`)).toEqual([
      `GET ${balanceReads}`,
    ]);
    expect(controller.getSnapshot().financial.expenses.data).toMatchObject([
      { description: '2026-09 rent, ledger 1' },
    ]);
  });

  it('reads again when a change lands while the shown read is still in flight', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Dinner', amount: '12', tagId });
    f.hold((path) => path.startsWith(`/api/groups/${groupId}/expenses`));
    const saving = controller.saveExpense();
    const write = await f.held.next(`/api/groups/${groupId}/expenses`);
    // The member returns to the Group while the save's response is still outstanding.
    const opening = controller.openGroup(groupId);
    const older = await f.held.next(expenseReads);
    const beforeSave = f.answer(older.path);
    f.hold(() => false);
    // The save reached the server, but its response is lost: no confirmation arrives.
    f.state.ledger += 1;
    write.release(f.lost());
    await saving;
    expect(controller.getSnapshot().expense.status).toBe('uncertain');
    older.release(beforeSave);
    await opening;
    // The shown read began before the save could have landed, so it was read again.
    expect(f.reads(expenseReads)).toBe(2);
    expect(controller.getSnapshot().financial).toMatchObject({
      expenses: { status: 'ready', data: [{ description: '2026-09 rent, ledger 1' }] },
      balances: { status: 'ready', data: [{ debts: [{ amount: 31 }] }] },
    });
  });

  it('invalidates every affected page, Month summary, Balance, Home and Activity after a confirmed change', async () => {
    for (const change of ['expense', 'settlement'] as const) {
      const f = fixture();
      const controller = f.create();
      await controller.signIn('alex');
      await controller.openGroup(groupId);
      await controller.selectMonth('2026-08');
      await controller.selectMonth('2026-09');
      await controller.openActivity(groupId);
      await controller.back();
      await controller.back();
      if (change === 'expense') {
        await controller.openExpense(groupId);
        await controller.updateExpenseDraft({ description: 'Dinner', amount: '12', tagId });
        await controller.saveExpense();
      } else {
        await controller.openGroup(groupId, true, 'balances');
        await controller.openRecordPayment(alex.id, sam.id, 'INR');
        await controller.recordSettlement();
        expect(controller.getSnapshot().snackbar?.message).toBe('Payment recorded');
        await controller.selectDestination('expenses');
      }
      expect(f.state.ledger).toBe(1);
      expect(controller.getSnapshot().financial).toMatchObject({
        expenses: { data: [{ description: '2026-09 rent, ledger 1' }] },
        balances: { status: 'ready', stale: false, data: [{ debts: [{ amount: 31 }] }] },
      });
      await controller.selectMonth('2026-08');
      expect(controller.getSnapshot().financial.expenses.data).toMatchObject([
        { description: '2026-08 rent, ledger 1' },
      ]);
      await controller.openActivity(groupId);
      expect(controller.getSnapshot().activity.events).toMatchObject([
        { metadata: { description: 'ledger 1' } },
      ]);
      await controller.back();
      await controller.back();
      expect(controller.getSnapshot().home.data).toMatchObject([{ youOwe: 31 }]);
    }
  });

  it('never replays a write or replaces an unfinished draft on foreground or reconnect', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Lost dinner', amount: '12', tagId });
    f.state.loseWrites = true;
    await controller.saveExpense();
    expect(controller.getSnapshot().expense.status).toBe('uncertain');
    f.state.offline = true;
    await controller.refresh('foreground');
    f.state.offline = false;
    f.state.loseWrites = false;
    for (const origin of ['foreground', 'foreground', 'retry', 'pull'] as const) {
      f.clock.now += 31_000;
      await controller.refresh(origin);
    }
    expect(
      f.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/expenses')),
    ).toHaveLength(1);
    expect(controller.getSnapshot().expense).toMatchObject({
      status: 'uncertain',
      draft: { description: 'Lost dinner', amount: '12' },
    });
    expect(controller.getSnapshot().expense.attempt).not.toBeNull();
  });

  it('shows the saved copy at once after a restart, with its original time, and always reads it again', async () => {
    const f = fixture();
    const first = f.create();
    await first.signIn('alex');
    const savedAt = f.clock.now;
    await first.openGroup(groupId);
    await first.back();
    first.dispose();

    f.clock.now += 5_000;
    const restarted = f.create();
    f.hold((path) => path === '/api/groups' || path === groupPath);
    const restoring = restarted.restore();
    const groups = await f.held.next('/api/groups');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(restarted.getSnapshot().groups).toMatchObject({
      status: 'loading',
      data: [{ id: groupId, name: 'Maple House' }],
    });
    groups.release(f.live());
    await restoring;

    const opening = restarted.openGroup(groupId);
    const read = await f.held.next(groupPath);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(restarted.getSnapshot()).toMatchObject({
      detail: { status: 'loading', data: { name: 'Maple House' }, refreshedAt: savedAt },
      financial: {
        month: '2026-09',
        expenses: {
          month: '2026-09',
          refreshedAt: savedAt,
          data: [{ description: '2026-09 rent, ledger 0' }],
        },
        balances: { refreshedAt: savedAt, data: [{ currency: 'INR' }] },
      },
    });
    f.hold(() => false);
    read.release(f.live());
    await opening;
    // A saved copy is never fresh: the restart re-read everything within the window.
    expect([f.reads(groupPath), f.reads(expenseReads), f.reads(balanceReads)]).toEqual([2, 2, 2]);
    expect(restarted.getSnapshot().financial.balances.refreshedAt).toBe(f.clock.now);
  });

  it('keeps a saved Group readable with its time, and no running cue, when its Group read fails beside Expenses that answer', async () => {
    const f = fixture();
    const first = f.create();
    await first.signIn('alex');
    const savedAt = f.clock.now;
    await first.openGroup(groupId);
    first.dispose();
    f.clock.now += 60_000;
    const restarted = f.create();
    await restarted.restore();
    // A 500, a server fault: an uncoded 503 now counts as can't reach the server (#231).
    f.state.failGroup = 500;
    await restarted.openGroup(groupId);
    const state = restarted.getSnapshot();
    // The saved Group shows with its time and the failure. The Expenses read beside it answered,
    // which proves the member belongs, so they show as read now, and Balances after them (owner
    // decision 2A, #219).
    expect(state).toMatchObject({
      detail: { status: 'error', data: { name: 'Maple House' }, refreshedAt: savedAt },
      financial: {
        expenses: {
          status: 'ready',
          refreshedAt: f.clock.now,
          data: [{ description: '2026-09 rent, ledger 0' }],
        },
        balances: { status: 'ready', refreshedAt: f.clock.now },
      },
    });
    expect(refreshFeedback(state)).toMatchObject({ quiet: false, pull: false });
    f.state.failGroup = 0;
    await restarted.refresh();
    expect(restarted.getSnapshot()).toMatchObject({
      detail: { status: 'ready', refreshedAt: f.clock.now },
      financial: { expenses: { status: 'ready' }, balances: { status: 'ready' } },
    });
  });

  it('removes reused and saved content as soon as access is denied', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    f.state.revoked = true;
    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({
      detail: { status: 'denied', data: null },
      financial: { groupId: null, expenses: { data: [] }, balances: { data: null } },
      home: { data: null },
    });
    f.state.revoked = false;
    f.hold((path) => path === groupPath);
    const reopening = controller.openGroup(groupId);
    const read = await f.held.next(groupPath);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Nothing from before the denial is reused or shown while access is checked again.
    expect(controller.getSnapshot().detail.data).toBeNull();
    expect(controller.getSnapshot().financial.expenses.data).toEqual([]);
    read.release(f.live());
    await reopening;
    expect(f.reads(groupPath)).toBe(3);
  });

  it('never reuses reads across sign-out or an account change, even within the window', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    await controller.signOut();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    expect(f.reads(groupPath)).toBe(2);

    f.hold((path) => path === groupPath);
    await controller.signIn('sam');
    const opening = controller.openGroup(groupId);
    const read = await f.held.next(groupPath);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(controller.getSnapshot().detail.data).toBeNull();
    expect(controller.getSnapshot().financial.expenses.data).toEqual([]);
    expect([...f.disk.keys()].some((key) => key.startsWith(alex.id))).toBe(false);
    read.release(f.live());
    await opening;
    expect(controller.getSnapshot().auth.user?.id).toBe(sam.id);
  });

  it('drops a shared read that answers after sign-out, without showing or saving it', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    f.clock.now += 31_000;
    f.hold((path) => path.startsWith(expenseReads));
    const refreshes = [controller.refresh('foreground'), controller.refresh('foreground')];
    const read = await f.held.next(expenseReads);
    await controller.signOut();
    read.release(f.live());
    await Promise.all(refreshes);
    expect(controller.getSnapshot()).toMatchObject({
      auth: { status: 'signed-out' },
      financial: { expenses: { data: [] }, balances: { data: null } },
    });
    expect(f.disk.size).toBe(0);
  });

  it('ends an offline miss in an actionable error, never a loader', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    f.state.offline = true;
    await controller.selectMonth('2026-07');
    expect(controller.getSnapshot().financial.expenses).toMatchObject({
      status: 'error',
      month: '2026-07',
      data: [],
      message: 'This view was not saved on this device. Connect to load it.',
    });
    expect(controller.getSnapshot().financial.balances.status).toBe('ready');
    f.state.offline = false;
    await controller.refreshExpenses();
    expect(controller.getSnapshot().financial.expenses.status).toBe('ready');

    // A Group never opened on this device.
    f.state.offline = true;
    await controller.back();
    await controller.openGroup('b00000000000000000000002');
    expect(controller.getSnapshot().detail).toMatchObject({
      status: 'error',
      data: null,
      message: 'This view was not saved on this device. Connect to load it.',
    });
  });
});

describe('Members and Group details reads its Group again (#238)', () => {
  const priya = {
    id: 'a00000000000000000000003',
    name: 'Priya',
    email: 'priya@example.test',
    image: null,
  };
  /** Maple House after Priya joined it. */
  const joined = {
    ...group,
    members: [
      ...group.members,
      { user: { ...person(priya), email: priya.email }, role: 'member', joinedAt: iso },
    ],
  };
  type Fixture = ReturnType<typeof fixture>;
  /** Sam on Maple House's Members and details, opened from the Group view. */
  async function onMembers(options: Parameters<typeof fixture>[0] = {}) {
    const f = fixture(options);
    const controller = f.create();
    await controller.signIn('sam');
    await controller.openGroup(groupId);
    controller.openMembers();
    return { f, controller };
  }
  type Controller = Awaited<ReturnType<typeof onMembers>>['controller'];
  const refresh = (controller: Controller, origin: 'foreground' | 'retry') =>
    origin === 'retry' ? controller.refresh() : controller.refresh('foreground');
  const sessionRead = { method: 'GET', path: '/api/auth/get-session' };
  const groupRead = { method: 'GET', path: groupPath };
  /** Whether this device still keeps a saved copy of the Group. */
  const savedGroup = (f: Fixture) => [...f.disk.keys()].some((key) => key.endsWith(groupPath));
  /** How many saved copies of the Group, its Expenses and its Balances this device keeps. */
  const savedOfGroup = (f: Fixture) =>
    [...f.disk.keys()].filter((key) => key.includes(groupPath)).length;
  const listed = (controller: Controller) =>
    controller.getSnapshot().groups.data.map((entry) => entry.id);
  /** Runs a refresh whose request for `path` gets this response; false when none was sent. */
  async function answering(
    f: Fixture,
    path: string,
    run: () => Promise<void>,
    response: FetchResponse,
  ) {
    f.hold((sent) => sent === path);
    const running = run();
    const held = await Promise.race([f.held.next(path), running.then(() => null)]);
    f.hold(() => false);
    held?.release(response);
    await running;
    return held !== null;
  }

  it.each(['foreground', 'retry'] as const)(
    'stops showing a Group whose read is refused on a %s refresh, and Back then goes Home',
    async (origin) => {
      const { f, controller } = await onMembers();
      expect(savedGroup(f)).toBe(true);
      f.state.revoked = true;
      // Past the display freshness window.
      f.clock.now += 60_000;
      const before = f.calls.length;
      await refresh(controller, origin);
      expect(f.calls.slice(before)).toEqual([sessionRead, groupRead]);
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'members',
        detail: { id: groupId, status: 'denied', data: null },
      });
      expect(listed(controller)).not.toContain(groupId);
      expect(savedGroup(f)).toBe(false);
      await controller.back();
      expect(controller.getSnapshot().screen).toBe('groups');
    },
  );

  it('says a Group that is gone is no longer available, as the Group view does', async () => {
    const { f, controller } = await onMembers();
    f.state.failGroup = 404;
    f.clock.now += 60_000;
    await controller.refresh('foreground');
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'members',
      detail: {
        id: groupId,
        status: 'error',
        data: null,
        message: 'This group is no longer available.',
      },
    });
    expect(listed(controller)).not.toContain(groupId);
    expect(savedGroup(f)).toBe(false);
  });

  it('stops showing a Group that no longer lists the member, and removes its saved copies', async () => {
    const { f, controller } = await onMembers();
    // The Group, its Month's Expenses and its Balances.
    expect(savedOfGroup(f)).toBe(3);
    f.clock.now += 60_000;
    const without = {
      ...group,
      members: group.members.filter((member) => member.user._id !== sam.id),
    };
    const refreshing = () => controller.refresh('foreground');
    expect(await answering(f, groupPath, refreshing, json({ status: 200, data: without }))).toBe(
      true,
    );
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'members',
      detail: { id: groupId, status: 'denied', data: null },
    });
    expect(listed(controller)).not.toContain(groupId);
    expect(savedOfGroup(f)).toBe(0);
    expect([...f.disk.keys()].some((key) => key.endsWith('/api/groups'))).toBe(false);
  });

  it.each(['foreground', 'retry'] as const)(
    'shows the Group as read on a %s refresh: a member who joined meanwhile appears',
    async (origin) => {
      const { f, controller } = await onMembers();
      f.clock.now += 60_000;
      const refreshing = () => refresh(controller, origin);
      expect(await answering(f, groupPath, refreshing, json({ status: 200, data: joined }))).toBe(
        true,
      );
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'members',
        detail: { id: groupId, status: 'ready', refreshedAt: f.clock.now },
      });
      expect(controller.getSnapshot().detail.data?.members.map(({ user }) => user.name)).toEqual([
        'Alex',
        'Sam',
        'Priya',
      ]);
    },
  );

  it('reuses a Group read verified within the display freshness window on a foreground refresh; Try again always reads', async () => {
    const { f, controller } = await onMembers();
    const verifiedAt = f.clock.now;
    f.clock.now += 10_000;
    await controller.refresh('foreground');
    expect(f.reads(groupPath)).toBe(1);
    expect(controller.getSnapshot().detail).toMatchObject({
      status: 'ready',
      refreshedAt: verifiedAt,
    });
    await controller.refresh();
    expect(f.reads(groupPath)).toBe(2);
    expect(controller.getSnapshot().detail).toMatchObject({
      status: 'ready',
      refreshedAt: f.clock.now,
    });
    f.clock.now += DISPLAY_FRESHNESS_MS + 1;
    await controller.refresh('foreground');
    expect(f.reads(groupPath)).toBe(3);
  });

  it('keeps the saved copy, its time and the offline banner offline, dropping nothing until a read is refused', async () => {
    const { f, controller } = await onMembers();
    const savedAt = f.clock.now;
    f.state.offline = true;
    f.state.revoked = true;
    f.clock.now += 60_000;
    await controller.refresh('foreground');
    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'members',
      offline: { active: true, refreshedAt: savedAt },
      detail: { id: groupId, data: { name: 'Maple House' }, refreshedAt: savedAt },
    });
    expect(listed(controller)).toContain(groupId);
    expect(savedGroup(f)).toBe(true);

    // Back online, the refusal is lost access, not offline: the offline banner goes too.
    f.state.offline = false;
    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'members',
      offline: { active: false },
      detail: { id: groupId, status: 'denied', data: null },
    });
    expect(listed(controller)).not.toContain(groupId);
    expect(savedGroup(f)).toBe(false);
  });

  it.each([403, 404])(
    'keeps the Group when the session check answers %i: only the Group’s own read can refuse it',
    async (status) => {
      const { f, controller } = await onMembers();
      f.clock.now += 60_000;
      const before = f.calls.length;
      const refreshing = () => controller.refresh();
      expect(await answering(f, sessionRead.path, refreshing, json({}, status))).toBe(true);
      expect(f.calls.slice(before)).toEqual([sessionRead]);
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'members',
        detail: { id: groupId, status: 'ready', data: { name: 'Maple House' } },
      });
      expect(listed(controller)).toContain(groupId);
      expect(savedOfGroup(f)).toBe(3);
    },
  );

  // A gateway's 502 or 503 now counts as can't reach the server: see the next test (#231).
  it.each([500])(
    'keeps the Group and its saved copies when its read fails with %i, online or after an offline fallback',
    async (status) => {
      const { f, controller } = await onMembers();
      const savedAt = f.clock.now;
      f.state.failGroup = status;
      f.clock.now += 60_000;
      const before = f.calls.length;
      await controller.refresh('foreground');
      await controller.refresh();
      expect(f.calls.slice(before)).toEqual([sessionRead, groupRead, sessionRead, groupRead]);
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'members',
        offline: { active: false },
        detail: { id: groupId, data: { name: 'Maple House' }, refreshedAt: savedAt },
      });
      expect(listed(controller)).toContain(groupId);
      expect(savedOfGroup(f)).toBe(3);

      // Offline, the saved copy shows with its time; back online, the failure keeps both.
      f.state.offline = true;
      await controller.refresh();
      f.state.offline = false;
      await controller.refresh();
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'members',
        offline: { active: true, refreshedAt: savedAt },
        detail: { id: groupId, data: { name: 'Maple House' }, refreshedAt: savedAt },
      });
      expect(listed(controller)).toContain(groupId);
      expect(savedOfGroup(f)).toBe(3);
    },
  );

  it.each([502, 503, 504])(
    'keeps the Group and its saved copies, offline with their time, when a gateway answers its read with %i (#231)',
    async (status) => {
      const { f, controller } = await onMembers();
      const savedAt = f.clock.now;
      f.state.failGroup = status;
      f.clock.now += 60_000;
      const before = f.calls.length;
      await controller.refresh('foreground');
      expect(f.calls.slice(before)).toEqual([sessionRead, groupRead]);
      expect(controller.getSnapshot()).toMatchObject({
        screen: 'members',
        offline: { active: true, refreshedAt: savedAt },
        detail: { id: groupId, data: { name: 'Maple House' }, refreshedAt: savedAt },
      });
      expect(listed(controller)).toContain(groupId);
      expect(savedOfGroup(f)).toBe(3);
    },
  );

  it('keeps showing an archived Group, which its members can still read', async () => {
    const { f, controller } = await onMembers();
    f.clock.now += 60_000;
    const refreshing = () => controller.refresh('foreground');
    const archived = json({ status: 200, data: { ...group, isArchived: true } });
    expect(await answering(f, groupPath, refreshing, archived)).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'members',
      detail: {
        id: groupId,
        status: 'ready',
        data: { name: 'Maple House' },
        refreshedAt: f.clock.now,
      },
    });
    expect(listed(controller)).toContain(groupId);
    expect(savedGroup(f)).toBe(true);
  });

  it.each([
    ['Back to Home', 200],
    ['Back to Home', 403],
    ['sign-out', 200],
    ['sign-out', 403],
    ['an account change', 200],
    ['an account change', 403],
  ] as const)(
    'publishes nothing from a Group read that lands after %s (%i)',
    async (move, status) => {
      const { f, controller } = await onMembers();
      f.clock.now += 60_000;
      f.hold((path) => path === groupPath);
      const refreshing = controller.refresh('foreground');
      const read = await f.held.next(groupPath);
      f.hold(() => false);
      let returning: ReturnType<Controller['back']> | undefined;
      if (move === 'Back to Home') {
        // To the Group view, which waits on the same read, then Home.
        returning = controller.back();
        expect(controller.getSnapshot().screen).toBe('group');
        await controller.back();
      } else if (move === 'sign-out') await controller.signOut();
      else await controller.signIn('alex');
      read.release(status === 200 ? json({ status: 200, data: joined }) : json({}, status));
      await Promise.all([refreshing, returning]);

      const state = controller.getSnapshot();
      expect(state).toMatchObject({
        screen: 'groups',
        detail: { status: 'idle', id: null, data: null },
      });
      if (move === 'sign-out') {
        expect(state.auth.status).toBe('signed-out');
        expect(state.groups.data).toEqual([]);
        expect(f.disk.size).toBe(0);
      } else if (move === 'an account change') {
        // Alex is still a member: Sam's late refusal leaves Alex's Group and saved list alone.
        expect(state.auth.user?.id).toBe(alex.id);
        expect(listed(controller)).toContain(groupId);
        expect([...f.disk.keys()].some((key) => key.startsWith(sam.id))).toBe(false);
        expect(f.disk.has(`${alex.id}/api/groups`)).toBe(true);
      } else if (status === 200) expect(listed(controller)).toContain(groupId);
      // On a 403, the request itself still removes the refused Group from Home, as any refused
      // request does; the page's denied state never reaches Home.
    },
  );

  it('publishes nothing from a Group read that lands after an invitation opened over the page', async () => {
    const { f, controller } = await onMembers({
      pendingInvitation: {
        load: async () => null,
        save: async () => {
          throw new Error('The device storage is full');
        },
        clear: async () => undefined,
      },
    });
    f.clock.now += 60_000;
    f.hold((path) => path === groupPath);
    const refreshing = controller.refresh('foreground');
    const read = await f.held.next(groupPath);
    f.hold(() => false);
    await controller.openInvitation('http://localhost:4138/join/abcdef12');
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'invite',
      invitation: { status: 'error' },
    });
    read.release(json({ status: 200, data: joined }));
    await refreshing;
    // The refresh neither shows its Group nor retries the invitation the member didn't ask to.
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'invite',
      invitation: { status: 'error' },
    });
    expect(f.calls.filter((call) => call.path.startsWith('/api/join/'))).toEqual([]);
    expect(controller.getSnapshot().detail.data?.members.map(({ user }) => user.name)).toEqual([
      'Alex',
      'Sam',
    ]);
  });
});
