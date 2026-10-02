import { focusManager } from '@tanstack/query-core';
import { describe, expect, it } from 'vitest';
import { createMobileController } from './mobile-controller';
import type { FetchResponse } from './types';
import { refreshFeedback } from '../ui/refresh-feedback';

// #108: gates for the TanStack Query Activity pilot. Fictional accounts and ledger only.
const alex = { id: 'a00000000000000000000001', name: 'Alex', email: 'alex@example.test' };
const sam = { id: 'a00000000000000000000002', name: 'Sam', email: 'sam@example.test' };
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
const activityPath = (page: number) => `/api/groups/${groupId}/activity?page=${page}&limit=20`;
/** Lets reads started by a focus event, which TanStack starts a tick later, settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
/** Android reports the app leaving and returning to the foreground. */
const focus = () => {
  focusManager.setFocused(false);
  focusManager.setFocused(true);
};

/** Holds matching requests or saves until released. */
function gate() {
  const waiting: { key: string; release: () => void }[] = [];
  const arrivals: (() => void)[] = [];
  return {
    hold(key: string) {
      return new Promise<void>((release) => {
        waiting.push({ key, release });
        arrivals.splice(0).forEach((notify) => notify());
      });
    },
    async next(match: string) {
      for (;;) {
        const index = waiting.findIndex((entry) => entry.key.includes(match));
        if (index >= 0) return waiting.splice(index, 1)[0]!;
        await new Promise<void>((resolve) => arrivals.push(resolve));
      }
    },
  };
}

/**
 * A fictional backend whose ledger rises with every accepted Expense and whose Activity
 * has `pages` pages, plus device stores that survive a controller restart.
 */
function fixture() {
  const clock = { now: Date.parse(iso) };
  const state = { ledger: 0, pages: 1, offline: false, revoked: false };
  let cookie: string | null = null,
    owner: string | null = null,
    identity: unknown = null,
    cleanup = false,
    keys = 0;
  const disk = new Map<string, unknown>(),
    drafts = new Map<string, unknown>(),
    attempts = new Map<string, unknown>();
  const calls: string[] = [];
  let activitySaves = 0;
  const responses = gate(),
    saves = gate();
  let holdRead: (path: string) => boolean = () => false,
    holdSave: (path: string) => boolean = () => false;
  const records = (map: Map<string, unknown>, held?: (key: string) => boolean) => ({
    load: async (account: string, key: string) => structuredClone(map.get(account + key) ?? null),
    save: async (account: string, key: string, value: unknown) => {
      if (key.includes('/activity?')) activitySaves += 1;
      if (held?.(key)) await saves.hold(key);
      map.set(account + key, structuredClone(value));
    },
    remove: async (account: string, key: string) => {
      map.delete(account + key);
    },
    clear: async () => {
      map.clear();
    },
  });
  const respond = (path: string, init: RequestInit): FetchResponse => {
    const method = init.method ?? 'GET';
    const user = String((init.headers as Record<string, string>).Cookie ?? '').includes('sam.')
      ? sam
      : alex;
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
    if (path === '/api/user/balances') return json({ status: 200, data: { buckets: [] } });
    if (path === `/api/groups/${groupId}`) return json({ status: 200, data: group });
    if (path.startsWith(`/api/groups/${groupId}/expenses?`))
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
    if (path === `/api/groups/${groupId}/expenses` && method === 'POST') {
      state.ledger += 1;
      return json({ status: 201, data: { _id: 'd00000000000000000000009', group: groupId } }, 201);
    }
    if (path === `/api/groups/${groupId}/balances`)
      return json({ status: 200, data: { byCurrency: [] } });
    if (path.startsWith(`/api/groups/${groupId}/activity?`)) {
      const page = Number(new URL(path, 'http://local').searchParams.get('page'));
      return json({
        status: 200,
        data: {
          activities: [
            {
              _id: `e0000000000000000000000${page}`,
              group: groupId,
              actor: { _id: alex.id, name: 'Alex' },
              type: 'expense_added',
              createdAt: iso,
              metadata: { description: `ledger ${state.ledger} page ${page} for ${user.name}` },
            },
          ],
          // Every accepted Expense adds an event, so the timeline's total moves with it.
          pagination: {
            page,
            limit: 20,
            total: 20 * (state.pages - 1) + 1 + state.ledger,
            totalPages: state.pages,
          },
        },
      });
    }
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
          ...records(disk, (key) => holdSave(key)),
          invalidateGroup: async (account, id) => {
            for (const key of disk.keys())
              if (
                key.startsWith(`${account}/api/groups/${id}`) ||
                key === `${account}/api/groups` ||
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
          load: async () => structuredClone(identity),
          save: async (value) => {
            identity = structuredClone(value);
          },
          clear: async () => {
            identity = null;
          },
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
          if (state.offline) throw new TypeError('Network request failed');
          calls.push(`${init.method ?? 'GET'} ${path}`);
          // A delayed response carries what the server held when the request arrived.
          const response = respond(path, init);
          if (holdRead(path)) await responses.hold(path);
          return response;
        },
      },
    );
  return {
    create,
    clock,
    state,
    disk,
    /** Activity pages requested since the last call. */
    activityReads: () =>
      calls
        .splice(0)
        .filter((call) => call.startsWith(`GET /api/groups/${groupId}/activity?`))
        .map((call) => Number(new URL(call.slice(4), 'http://local').searchParams.get('page'))),
    /** Activity pages written to the device since the last call. */
    activitySaves: () => {
      const count = activitySaves;
      activitySaves = 0;
      return count;
    },
    /** The saved copy of an Activity page for an account. */
    saved: (account: string, page: number) =>
      disk.get(account + activityPath(page)) as
        | { refreshedAt: number; value: { data: { activities: { metadata: unknown }[] } } }
        | undefined,
    holdReads(match: (path: string) => boolean) {
      holdRead = match;
    },
    holdSaves(match: (path: string) => boolean) {
      holdSave = match;
    },
    responses,
    saves,
  };
}

const descriptions = (controller: ReturnType<ReturnType<typeof fixture>['create']>) =>
  controller
    .getSnapshot()
    .activity.events.map((event) => (event.metadata as { description?: string }).description);

describe('Activity query pilot (#108)', () => {
  it('reads Activity once per freshness window, however many triggers arrive', async () => {
    const f = fixture(),
      controller = f.create();
    await controller.signIn('alex');
    await controller.openActivity(groupId);
    expect(f.activityReads()).toEqual([1]);

    // Within the window: switching destinations, reopening and foreground events reuse it.
    await controller.selectDestination('expenses');
    await controller.selectDestination('activity');
    await controller.back();
    await controller.openActivity(groupId);
    await Promise.all([
      controller.refresh('foreground'),
      controller.refresh('foreground'),
      controller.refresh('foreground'),
    ]);
    focus();
    focus();
    focus();
    await settle();
    expect(f.activityReads()).toEqual([]);

    // After it: three overlapping foreground events, each also a focus event, read once.
    f.clock.now += 31_000;
    focus();
    focus();
    focus();
    await Promise.all([
      controller.refresh('foreground'),
      controller.refresh('foreground'),
      controller.refresh('foreground'),
    ]);
    await settle();
    expect(f.activityReads()).toEqual([1]);

    // A pull always reads again.
    await controller.refresh('pull');
    expect(f.activityReads()).toEqual([1]);
    expect(controller.getSnapshot().activity.status).toBe('ready');
  });

  it('re-reads every loaded page on focus, but only the first on a pull', async () => {
    const f = fixture();
    f.state.pages = 2;
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openActivity(groupId);
    await controller.loadMoreActivity();
    expect(f.activityReads()).toEqual([1, 2]);
    expect(descriptions(controller)).toHaveLength(2);

    f.clock.now += 31_000;
    focus();
    await settle();
    expect(f.activityReads()).toEqual([1, 2]);
    expect(descriptions(controller)).toHaveLength(2);

    await controller.refresh('pull');
    expect(f.activityReads()).toEqual([1]);
    expect(descriptions(controller)).toEqual(['ledger 0 page 1 for Alex']);
  });

  it('does not observe Activity while another destination is shown', async () => {
    const f = fixture(),
      controller = f.create();
    await controller.signIn('alex');
    await controller.openActivity(groupId);
    await controller.selectDestination('balances');
    f.activityReads();
    f.clock.now += 31_000;
    focus();
    await settle();
    expect(f.activityReads()).toEqual([]);
  });

  it('restores saved pages offline with their original time and never treats them as verified', async () => {
    const f = fixture();
    f.state.pages = 2;
    const first = f.create();
    await first.signIn('alex');
    await first.openActivity(groupId);
    await first.loadMoreActivity();
    const readAt = f.clock.now;
    expect(f.saved(alex.id, 1)?.refreshedAt).toBe(readAt);
    expect(f.saved(alex.id, 2)?.refreshedAt).toBe(readAt);
    first.dispose();
    f.activityReads();
    f.activitySaves();

    // Restarted within the freshness window of that read.
    f.clock.now += 10_000;
    f.state.offline = true;
    const restarted = f.create();
    await restarted.restore();
    await restarted.openActivity(groupId);
    const shown = restarted.getSnapshot();
    expect(shown.activity).toMatchObject({ status: 'ready', moreStatus: 'idle', message: null });
    expect(descriptions(restarted)).toEqual([
      'ledger 0 page 1 for Alex',
      'ledger 0 page 2 for Alex',
    ]);
    // Offline, not loading: the saved time is shown and no progress cue runs.
    expect(shown.offline).toMatchObject({ active: true, refreshedAt: readAt });
    expect(refreshFeedback(shown).quiet).toBe(false);
    // The fallback is never saved again.
    expect(f.activitySaves()).toBe(0);
    expect(f.saved(alex.id, 1)?.refreshedAt).toBe(readAt);

    // Back online, the saved copy is stale although its read is within the window: both
    // restored pages are read again.
    f.state.offline = false;
    focus();
    await settle();
    expect(f.activityReads()).toEqual([1, 2]);
    expect(restarted.getSnapshot().activity.status).toBe('ready');
    // A network read, so it is saved with its own time. (The Group details on screen are
    // still the saved copy, so the offline notice rightly stays.)
    expect(f.saved(alex.id, 1)?.refreshedAt).toBe(f.clock.now);
    expect(f.saved(alex.id, 2)?.refreshedAt).toBe(f.clock.now);
  });

  it('leaves out saved pages from another moment of the timeline', async () => {
    const f = fixture();
    f.state.pages = 2;
    const first = f.create();
    await first.signIn('alex');
    await first.openActivity(groupId);
    await first.loadMoreActivity();
    // Another member's Expense moves the timeline; only the first page is read again.
    f.state.ledger += 1;
    await first.refresh('pull');
    first.dispose();

    f.state.offline = true;
    const restarted = f.create();
    await restarted.restore();
    await restarted.openActivity(groupId);
    expect(descriptions(restarted)).toEqual(['ledger 1 page 1 for Alex']);
  });

  it('shows an unsaved timeline as unavailable offline, never as loading', async () => {
    const f = fixture(),
      first = f.create();
    await first.signIn('alex');
    await first.openGroup(groupId);
    first.dispose();

    f.state.offline = true;
    const restarted = f.create();
    await restarted.restore();
    await restarted.openActivity(groupId);
    expect(restarted.getSnapshot().activity).toMatchObject({
      status: 'error',
      events: [],
      message: 'This view was not saved on this device. Connect to load it.',
    });
    expect(restarted.getSnapshot().offline.active).toBe(true);
  });

  it('never shows or saves one account’s Activity for another', async () => {
    const f = fixture(),
      controller = f.create();
    await controller.signIn('alex');
    await controller.openActivity(groupId);
    expect(descriptions(controller)).toEqual(['ledger 0 page 1 for Alex']);

    // Alex's next read is still in flight when Alex signs out and Sam signs in.
    f.clock.now += 31_000;
    f.holdReads((path) => path.includes('/activity?'));
    const pulling = controller.refresh('pull');
    const late = await f.responses.next('/activity?');
    await controller.signOut();
    await pulling;
    expect(f.saved(alex.id, 1)).toBeUndefined();
    f.holdReads(() => false);
    await controller.signIn('sam');
    late.release();
    await settle();
    expect(f.saved(alex.id, 1)).toBeUndefined();

    await controller.openActivity(groupId);
    expect(descriptions(controller)).toEqual(['ledger 0 page 1 for Sam']);
    expect(f.saved(sam.id, 1)?.value.data.activities[0]?.metadata).toEqual({
      description: 'ledger 0 page 1 for Sam',
    });
  });

  it('removes a denied Group’s timeline from memory and the device', async () => {
    const f = fixture(),
      controller = f.create();
    await controller.signIn('alex');
    await controller.openActivity(groupId);
    expect(f.saved(alex.id, 1)).toBeDefined();
    f.state.revoked = true;
    await controller.refresh('pull');
    expect(controller.getSnapshot()).toMatchObject({
      activity: { status: 'denied', events: [] },
      detail: { status: 'denied', id: groupId, data: null },
      groups: { data: [] },
      financial: { groupId: null },
    });
    expect(f.saved(alex.id, 1)).toBeUndefined();

    // Access returns: nothing cached is shown while Activity is read again.
    f.state.revoked = false;
    await controller.back();
    f.activityReads();
    f.holdReads((path) => path.includes('/activity?'));
    const opening = controller.openActivity(groupId);
    const read = await f.responses.next('/activity?');
    expect(controller.getSnapshot().activity).toMatchObject({ status: 'loading', events: [] });
    read.release();
    await opening;
    expect(f.activityReads()).toEqual([1]);
    expect(controller.getSnapshot().activity.status).toBe('ready');
  });

  it('never shows or saves a read that a confirmed change made obsolete', async () => {
    const f = fixture(),
      controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    f.holdReads((path) => path.includes('/activity?'));
    const opening = controller.selectDestination('activity');
    const late = await f.responses.next('/activity?');
    f.holdReads(() => false);

    // The member moves on and saves an Expense while that read is delayed.
    await controller.selectDestination('expenses');
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({ description: 'Dinner', amount: '12', tagId });
    await controller.saveExpense();
    expect(f.state.ledger).toBe(1);
    late.release();
    await opening;
    await settle();
    expect(f.saved(alex.id, 1)).toBeUndefined();

    f.activityReads();
    await controller.selectDestination('activity');
    expect(f.activityReads()).toEqual([1]);
    expect(descriptions(controller)).toEqual(['ledger 1 page 1 for Alex']);
    expect(f.saved(alex.id, 1)?.value.data.activities[0]?.metadata).toEqual({
      description: 'ledger 1 page 1 for Alex',
    });
  });

  it('shows a read before its slow save finishes, and saves it with the time it was read', async () => {
    const f = fixture(),
      controller = f.create();
    await controller.signIn('alex');
    f.holdSaves((key) => key.includes('/activity?'));
    const readAt = f.clock.now;
    await controller.openActivity(groupId);
    const save = await f.saves.next('/activity?');
    expect(controller.getSnapshot().activity.status).toBe('ready');

    f.clock.now += 10_000;
    save.release();
    await settle();
    expect(f.saved(alex.id, 1)?.refreshedAt).toBe(readAt);
  });
});
