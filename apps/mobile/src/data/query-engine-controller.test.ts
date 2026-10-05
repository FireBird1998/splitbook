import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalMonthIsoRange } from '@splitbook/shared/date';
import { createMobileController } from './mobile-controller';
import type { FetchResponse } from './types';
import { hangUntilAborted } from '../test-utils/transport-faults';

// #214: TanStack Query owns the display reads under the controller. These checks drive the
// controller's public commands, as the app does, and look only at the requests sent, the
// snapshot and the saved copies on this device. Freshness runs on TanStack's clock, Date.now,
// so time moves with vitest's fake Date; no controller clock is injected.

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
const start = Date.parse(iso);
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
const groupPath = `/api/groups/${groupId}`;
const balancesPath = `/api/groups/${groupId}/balances`;
const expensesPath = `/api/groups/${groupId}/expenses?`;
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

/** A fictional backend for Alex and Sam, and device stores that outlive a controller. */
function fixture(options: { freshness?: number } = {}) {
  const state = { ledger: 0, offline: false, revoked: false };
  let cookie: string | null = null,
    owner: string | null = null,
    cleanup = false,
    keys = 0;
  const disk = new Map<string, unknown>(),
    drafts = new Map<string, unknown>(),
    attempts = new Map<string, unknown>();
  /** Every request sent, answered or not. */
  const calls: { method: string; path: string }[] = [];
  const held = gate();
  let answer: (
    path: string,
    method: string,
    init: RequestInit,
  ) => Promise<FetchResponse> | null = () => null;
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
    if (state.revoked && path.startsWith(groupPath)) return json({}, 403);
    if (path === '/api/groups') return json({ status: 200, data: state.revoked ? [] : [group] });
    if (path === '/api/user/balances')
      return json({
        status: 200,
        data: { buckets: [{ currency: 'INR', youOwe: 30 + state.ledger, youAreOwed: 0 }] },
      });
    if (path === groupPath) return json({ status: 200, data: group });
    if (path.startsWith(expensesPath))
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
      state.ledger += 1;
      return json({ status: 201, data: { _id: 'd00000000000000000000009', group: groupId } }, 201);
    }
    if (path === balancesPath)
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
        displayFreshnessMs: options.freshness,
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
          calls.push({ method, path });
          if (state.offline) throw new TypeError('Network request failed');
          return (await answer(path, method, init)) ?? respond(path, init);
        },
      },
    );
  /** GET requests sent for exactly this path, or starting with it when it ends in `?`. */
  const reads = (match: string) =>
    calls.filter(
      (call) =>
        call.method === 'GET' &&
        (call.path === match || (match.endsWith('?') && call.path.startsWith(match))),
    ).length;
  return {
    create,
    state,
    calls,
    disk,
    reads,
    held,
    /** Answers matching requests some other way; null leaves them to the backend. */
    answer(next: typeof answer) {
      answer = next;
    },
    /** Holds matching requests until the test releases them. */
    hold(match: (path: string, method: string) => boolean) {
      answer = (path, method) => (match(path, method) ? held.hold(path) : null);
    },
    /** The response Alex would get for this path from the backend as it is now. */
    now: (path: string) => respond(path, { headers: { Cookie: 'alex.signature' } }),
    /** Every saved copy on this device of anything in the Group. */
    savedOfGroup: () => [...disk.keys()].filter((key) => key.includes(groupPath)),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(start);
});
afterEach(() => {
  vi.useRealTimers();
});

const later = (ms: number) => vi.setSystemTime(Date.now() + ms);
/** Waits, on real timers, until `check` holds. vi.waitFor would move the fake clock. */
async function until(check: () => boolean) {
  while (!check()) await new Promise((resolve) => setTimeout(resolve, 1));
}

describe('display reads on TanStack Query (#214)', () => {
  it('a read the query cache cancels is never offline: no saved copy, and Save still sends', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    // Balances are saved on this device from this first read.
    expect(f.savedOfGroup()).toContain(`${alex.id}${balancesPath}`);
    later(5_000);
    // Another Month's Expense read is held, so its Balances read waits behind it.
    f.hold((path) => monthOf(path) === '2026-08');
    const august = controller.selectMonth('2026-08');
    const held = await f.held.next(expensesPath);
    // Back on this Month, whose Expenses are still fresh, Balances are read again. That read
    // hangs until it's aborted, and fails as expo/fetch does, like a lost connection.
    let hung = 0;
    f.answer((path, _method, init) =>
      path === balancesPath && ++hung === 1 ? hangUntilAborted(init, 'headers') : null,
    );
    const september = controller.selectMonth('2026-09');
    await until(() => hung === 1);
    // August's Expense read ends, and may have added recurring Expenses: the Balances read in
    // flight is obsolete, so the query cache cancels it.
    held.release(f.now(held.path));
    await Promise.all([august, september]);

    expect(f.reads(balancesPath)).toBe(3);
    expect(controller.getSnapshot()).toMatchObject({
      offline: { active: false, refreshedAt: null, message: null },
      financial: {
        month: '2026-09',
        balances: { status: 'ready', refreshedAt: start + 5_000, stale: false },
      },
    });

    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Dinner', amount: '12', tagId });
    await controller.saveExpense();
    expect(
      f.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/expenses')),
    ).toHaveLength(1);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      expense: { status: 'saved' },
      offline: { active: false },
    });
  });

  it('a 403 during a read leaves nothing of the Group, and a late answer brings none of it back', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    later(31_000);
    // A foreground refresh reads the Group again; its Balances answer arrives late.
    f.hold((path) => path === balancesPath);
    const refreshing = controller.refresh('foreground');
    const balances = await f.held.next(balancesPath);
    const lateAnswer = f.now(balancesPath);
    f.hold(() => false);
    // Then access is lost, and a Retry's Group read is refused.
    f.state.revoked = true;
    await controller.refresh();
    balances.release(lateAnswer);
    await refreshing;

    expect(controller.getSnapshot()).toMatchObject({
      detail: { status: 'denied', data: null },
      financial: { groupId: null, expenses: { data: [] }, balances: { data: null } },
      home: { data: null },
    });
    expect(controller.getSnapshot().groups.data.map(({ id }) => id)).not.toContain(groupId);
    expect(f.savedOfGroup()).toEqual([]);

    // Access returns: nothing read before the refusal is shown while the Group is read again.
    f.state.revoked = false;
    f.hold((path) => path === groupPath);
    const reopening = controller.openGroup(groupId);
    const read = await f.held.next(groupPath);
    // Whatever this device would show early has been shown by now.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(controller.getSnapshot()).toMatchObject({
      detail: { status: 'loading', data: null },
      financial: { expenses: { data: [] }, balances: { data: null } },
    });
    f.hold(() => false);
    read.release(f.now(groupPath));
    await reopening;
    expect(controller.getSnapshot().financial.balances).toMatchObject({
      status: 'ready',
      refreshedAt: start + 31_000,
    });
  });

  it('a read that answers after sign-out or an account switch is never shown, saved or reused', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    expect(f.reads(groupPath)).toBe(1);
    // Alex pulls, and signs out before the Group answers.
    f.hold((path) => path === groupPath);
    const pulling = controller.refresh('pull');
    const afterSignOut = await f.held.next(groupPath);
    await controller.signOut();
    afterSignOut.release(f.now(groupPath));
    await pulling;
    expect(controller.getSnapshot()).toMatchObject({
      auth: { status: 'signed-out' },
      detail: { data: null },
      groups: { data: [] },
    });
    expect(f.disk.size).toBe(0);

    // Within the window, Alex's next session reads the Group, its Expenses and its Balances
    // again: nothing from the session that ended is reused.
    f.hold(() => false);
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    expect([f.reads(groupPath), f.reads(expensesPath), f.reads(balancesPath)]).toEqual([3, 2, 2]);

    // Alex pulls again, and Sam signs in on this device before the Group answers.
    f.hold((path) => path === groupPath);
    const switching = controller.refresh('pull');
    const afterSwitch = await f.held.next(groupPath);
    f.hold(() => false);
    await controller.signIn('sam');
    afterSwitch.release(f.now(groupPath));
    await switching;
    expect(controller.getSnapshot()).toMatchObject({
      auth: { status: 'authenticated', user: { id: sam.id } },
      detail: { data: null },
    });
    expect([...f.disk.keys()].some((key) => key.startsWith(alex.id))).toBe(false);
    // Sam's own read of the Group is sent, never answered from Alex's.
    await controller.openGroup(groupId);
    expect(f.reads(groupPath)).toBe(5);
    expect(controller.getSnapshot().detail).toMatchObject({ status: 'ready', id: groupId });
  });
});

describe('query defaults (#214, M1-6)', () => {
  it('sends one request and then shows the saved copy: no automatic retry', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    await controller.back();
    later(31_000);
    f.state.offline = true;
    const before = f.calls.length;
    await controller.openGroup(groupId);
    // The Group is read once, then its saved copy stands in, with its original time. Offline
    // now, its Expenses and Balances check the session first, once each, and fall back too.
    expect(f.calls.slice(before).map((call) => call.path)).toEqual([
      groupPath,
      '/api/auth/get-session',
      '/api/auth/get-session',
    ]);
    expect(controller.getSnapshot()).toMatchObject({
      offline: { active: true, refreshedAt: start },
      detail: { status: 'ready', data: { id: groupId }, refreshedAt: start },
      financial: {
        expenses: { status: 'ready', refreshedAt: start },
        balances: { status: 'ready', refreshedAt: start },
      },
    });
  });

  it('reuses a read for the adjustable display freshness window, on TanStack’s clock', async () => {
    const f = fixture({ freshness: 5_000 });
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    later(4_000);
    await controller.refresh('foreground');
    expect(f.reads(groupPath)).toBe(1);
    later(2_000);
    await controller.refresh('foreground');
    expect(f.reads(groupPath)).toBe(2);
  });

  it('never reuses a read across sign-out or an account change, even within the window', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    await controller.signOut();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    expect(f.reads(groupPath)).toBe(2);
    await controller.signIn('sam');
    await controller.openGroup(groupId);
    expect(f.reads(groupPath)).toBe(3);
    expect(controller.getSnapshot().detail).toMatchObject({ status: 'ready', refreshedAt: start });
  });
});
