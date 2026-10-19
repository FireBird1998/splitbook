import { describe, expect, it, vi } from 'vitest';
import type { TagCommand } from '@splitbook/shared/tag-management';
import { createCheckedMobileController as createMobileController } from '../test-utils/flow-monitor';
import { savedQueriesIn } from '../test-utils/saved-queries';
import type { AccountGroupRecordStore } from './account-record-storage';

// #638: a Group's Tags are kept in its Saved copy, beside its other saved reads (ADR 0006). After
// a cold offline start the Tags screen shows them with when they were read, or says plainly that
// this phone keeps no copy of them; a new Expense offline can take one of the saved Tags.

// Fictional people and Groups only.
const alex = { id: 'a00000000000000000000001', name: 'Alex', email: 'alex@example.test' };
const sam = { id: 'a00000000000000000000002', name: 'Sam', email: 'sam@example.test' };
const mapleId = 'b00000000000000000000001';
const foodId = 'c00000000000000000000001';
const rentId = 'c00000000000000000000002';
const iso = '2026-10-19T09:00:00.000Z';
const maplePath = `/api/groups/${mapleId}`;
const tagsPath = `${maplePath}/tag-actions`;
const mb = 1_000_000;

/**
 * Maple House's server, with Alex its admin and Sam a member, and this phone's stores, which
 * survive a restart as SQLite and SecureStore do.
 */
function fixture() {
  const server = {
    offline: false,
    /** Maple House refuses Alex, and the Groups list leaves it out. */
    revoked: false,
    /** The Groups list leaves Maple House out, as it does an archived Group. */
    unlisted: false,
    /** Alex left Maple House. */
    left: false,
    /** The next Tag change is applied, and its reply lost on the way back. */
    loseTagReply: false,
    tags: [
      { id: foodId, name: 'Food', revision: 0, isArchived: false, isDeleted: false },
      { id: rentId, name: 'Rent', revision: 0, isArchived: false, isDeleted: false },
    ],
  };
  let user = alex,
    cookie: string | null = null,
    owner: string | null = null,
    identity: unknown = null,
    cleanup = false,
    keys = 0;
  /** This phone's saved copies, by account and path. */
  const cache = new Map<string, unknown>();
  /** Each saved row's size as the saved-copy budget measures it, by path (0 when unnamed). */
  const sizes = new Map<string, number>();
  const memory = (): AccountGroupRecordStore & { map: Map<string, unknown> } => {
    const map = new Map<string, unknown>();
    return {
      map,
      load: async (account, id) => structuredClone(map.get(account + id) ?? null),
      save: async (account, id, value) => {
        map.set(account + id, structuredClone(value));
      },
      remove: async (account, id) => {
        map.delete(account + id);
      },
      clear: async () => map.clear(),
      list: async (account) =>
        [...map]
          .filter(([key]) => key.startsWith(account))
          .map(([key, value]) => ({ groupId: key.slice(account.length), value })),
      keys: async (account) =>
        [...map.keys()]
          .filter((key) => key.startsWith(account))
          .map((key) => key.slice(account.length)),
    };
  };
  const tagRequests = memory(),
    drafts = memory(),
    attempts = memory();
  const savedQueries = {
    ...savedQueriesIn(cache),
    usage: async (account: string) =>
      [...cache.keys()]
        .filter((key) => key.startsWith(account))
        .map((key) => ({
          path: key.slice(account.length),
          bytes: sizes.get(key.slice(account.length)) ?? 0,
          lastUsed: 0,
        })),
  };
  const record = (value: { current: unknown }) => ({
    load: async () => structuredClone(value.current),
    save: async (next: unknown) => {
      value.current = structuredClone(next);
    },
    clear: async () => {
      value.current = null;
    },
  });
  const untrusted = { current: null as unknown };

  const person = (who: typeof alex) => ({ _id: who.id, name: who.name, email: who.email });
  const group = () => ({
    _id: mapleId,
    name: 'Maple House',
    createdBy: alex.id,
    category: 'home',
    defaultCurrency: 'INR',
    members: [alex, sam].map((who) => ({
      user: person(who),
      role: who === alex ? 'admin' : 'member',
      joinedAt: iso,
    })),
    tags: server.tags.map((tag) => ({
      _id: tag.id,
      name: tag.name,
      isArchived: tag.isArchived,
      isDeleted: tag.isDeleted,
      createdAt: iso,
    })),
    createdAt: iso,
    updatedAt: iso,
  });
  const snapshot = () => ({ canManage: user === alex, tags: structuredClone(server.tags) });
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  const emptyPage = {
    status: 200,
    data: {
      expenses: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      summary: { count: 0, totalsByCurrency: [], userOwes: 0, userGetsBack: 0, byMember: [] },
    },
  };
  /** Every request sent so far, as `METHOD /path`. */
  const requests: string[] = [];
  const respond = async (path: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    if (path.endsWith('/sign-in')) {
      user = String(init.body).includes('sam') ? sam : alex;
      return new Response(JSON.stringify({ user: { ...user, image: null } }), {
        headers: { 'Set-Cookie': `better-auth.session_token=${user.name}.signature; Path=/` },
      });
    }
    if (path.endsWith('/get-session'))
      return json({
        user: { ...user, image: null },
        session: { userId: user.id, expiresAt: '2030-01-01T00:00:00.000Z' },
      });
    if (path.endsWith('/sign-out')) return json({ success: true });
    const member = user === alex && !server.revoked && !server.left;
    if (path === '/api/groups')
      return json({ status: 200, data: member && !server.unlisted ? [group()] : [] });
    if (path === '/api/user/balances')
      return json({
        status: 200,
        data: {
          buckets: [],
          groups: member && !server.unlisted ? [{ groupId: mapleId, balances: [] }] : [],
        },
      });
    if (path === `${maplePath}/leave` && method === 'POST') {
      server.left = true;
      return json({ status: 200, data: { archived: false } });
    }
    if (path.startsWith(maplePath) && !member)
      return json({ error: 'Forbidden', status: 403 }, 403);
    if (path === maplePath) return json({ status: 200, data: group() });
    if (path === tagsPath && method === 'POST') {
      const command = JSON.parse(String(init.body)) as TagCommand;
      const { intent } = command;
      const tag = server.tags.find((item) => 'tagId' in intent && item.id === intent.tagId)!;
      if (intent.action === 'rename') tag.name = intent.name;
      if (intent.action === 'archive' || intent.action === 'restore')
        tag.isArchived = intent.action === 'archive';
      tag.revision += 1;
      if (server.loseTagReply) {
        server.loseTagReply = false;
        throw new TypeError('Network request failed');
      }
      return json({
        status: 200,
        data: {
          state: 'applied',
          requestId: command.requestId,
          receipt: { intent, tagId: tag.id, appliedAt: iso },
          snapshot: snapshot(),
        },
      });
    }
    if (path === tagsPath) return json({ status: 200, data: snapshot() });
    if (path.startsWith(`${maplePath}/expenses`)) return json(emptyPage);
    if (path === `${maplePath}/balances`)
      return json({
        status: 200,
        data: { byCurrency: [{ currency: 'INR', balances: [], debts: [] }] },
      });
    throw new Error(`Unexpected fixture request ${method} ${path}`);
  };
  const create = () =>
    createMobileController(
      {
        apiBaseUrl: 'http://localhost:4157',
        authOrigin: 'http://localhost:4157',
        developmentPersonaEnabled: true,
      },
      {
        newSubmissionKey: () => `00000000-0000-4000-8000-${String(++keys).padStart(12, '0')}`,
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
        savedQueries,
        tagRequests,
        expenseDrafts: drafts,
        settlementAttempts: attempts,
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
          untrustedCopies: record(untrusted),
          stores: [savedQueries, tagRequests, drafts, attempts, record(untrusted)],
        },
        fetch: async (url, init) => {
          const path = new URL(url).pathname;
          requests.push(`${init.method ?? 'GET'} ${path}`);
          if (server.offline) throw new TypeError('Network request failed');
          return respond(path, init);
        },
      },
    );
  /** The Tags this phone keeps for Maple House, as Alex's saved row holds them, or null. */
  const savedTags = (account = alex.id) => {
    const row = cache.get(account + tagsPath) as
      | { refreshedAt: number; value: { data: { tags: { name: string; isArchived: boolean }[] } } }
      | undefined;
    return row ? { refreshedAt: row.refreshedAt, tags: row.value.data.tags } : null;
  };
  /** Whether this phone keeps any saved copy of Maple House for this account. */
  const keepsMaple = (account = alex.id) =>
    [...cache.keys()].some((key) => key.startsWith(account + maplePath));
  return { create, server, cache, sizes, savedTags, keepsMaple, tagRequests, requests };
}
type Fixture = ReturnType<typeof fixture>;
type Controller = ReturnType<Fixture['create']>;

/**
 * Maple House's Tags, as the Tags screen opens them from Group options: the Group's view, then
 * its Tags, read until nothing is busy. `close` is what closing the screen does.
 */
async function openTags(controller: Controller) {
  await controller.openGroup(mapleId);
  controller.openTags(mapleId);
  const manager = controller.manageTags(mapleId);
  const stop = manager.open();
  await vi.waitFor(() => expect(controller.getSnapshot().tagManager.busy).toBe(false));
  return {
    manager,
    state: () => controller.getSnapshot().tagManager,
    close: () => {
      stop();
      controller.closeTags();
    },
  };
}

/** Alex reads Maple House's Tags online, and this phone saves them. */
async function readTagsOnline(f: Fixture) {
  const controller = f.create();
  await controller.signIn('alex');
  const tags = await openTags(controller);
  expect(tags.state().snapshot?.tags.map((tag) => tag.name)).toEqual(['Food', 'Rent']);
  await vi.waitFor(() =>
    expect(f.savedTags()?.tags.map((tag) => tag.name)).toEqual(['Food', 'Rent']),
  );
  return { controller, tags };
}

/** The app is closed, the phone goes offline, and the app starts again. */
async function restartOffline(f: Fixture, controller: Controller) {
  controller.dispose();
  f.server.offline = true;
  const restarted = f.create();
  await restarted.restore();
  expect(restarted.getSnapshot()).toMatchObject({
    auth: { status: 'authenticated', user: { id: alex.id } },
    offline: { active: true },
  });
  return restarted;
}

describe('a Group’s Tags in its Saved copy (#638)', () => {
  it('keeps the Tags read online, and shows them after a cold offline start with when they were read', async () => {
    const f = fixture();
    const { controller } = await readTagsOnline(f);
    const saved = f.savedTags()!;
    const restarted = await restartOffline(f, controller);
    try {
      const tags = await openTags(restarted);
      expect(tags.state()).toMatchObject({
        snapshot: { canManage: true, tags: [{ name: 'Food' }, { name: 'Rent' }] },
        // This phone's copy, with the time it was read: never presented as current.
        saved: true,
        refreshedAt: saved.refreshedAt,
        unsaved: false,
        message: '',
      });
      // Nothing was sent to change them.
      expect(f.requests.filter((request) => request.startsWith('POST /api/groups'))).toEqual([]);
      tags.close();
    } finally {
      restarted.dispose();
    }
  });

  it('says the Tags aren’t saved on this phone when they were never read here, never that they failed to load', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(mapleId);
    await vi.waitFor(() => expect(f.keepsMaple()).toBe(true));
    const restarted = await restartOffline(f, controller);
    try {
      const tags = await openTags(restarted);
      expect(tags.state()).toMatchObject({ snapshot: null, unsaved: true, saved: false });
      tags.close();
    } finally {
      restarted.dispose();
    }
  });

  it('follows a confirmed rename and a confirmed archive into the saved Tags, also after a restart', async () => {
    const f = fixture();
    const { controller, tags } = await readTagsOnline(f);
    const tag = (name: string) => tags.state().snapshot!.tags.find((item) => item.name === name)!;
    tags.manager.edit(tag('Food'), 'rename');
    tags.manager.enter('Meals');
    await tags.manager.submit();
    expect(tags.state().done).toMatchObject({ state: 'applied' });
    await vi.waitFor(() =>
      expect(f.savedTags()?.tags.map((item) => item.name)).toEqual(['Meals', 'Rent']),
    );
    tags.manager.edit(tag('Rent'), 'archive');
    await tags.manager.submit();
    await vi.waitFor(() =>
      expect(f.savedTags()?.tags).toMatchObject([
        { name: 'Meals', isArchived: false },
        { name: 'Rent', isArchived: true },
      ]),
    );
    tags.close();
    const restarted = await restartOffline(f, controller);
    try {
      const offline = await openTags(restarted);
      expect(offline.state()).toMatchObject({
        saved: true,
        snapshot: {
          tags: [
            { name: 'Meals', isArchived: false },
            { name: 'Rent', isArchived: true },
          ],
        },
      });
      offline.close();
    } finally {
      restarted.dispose();
    }
  });

  it('shows no saved Tags after a restart once a change’s reply was lost, and keeps that change to check', async () => {
    const f = fixture();
    const { controller, tags } = await readTagsOnline(f);
    const food = tags.state().snapshot!.tags.find((item) => item.name === 'Food')!;
    f.server.loseTagReply = true;
    tags.manager.edit(food, 'rename');
    tags.manager.enter('Meals');
    await tags.manager.submit();
    expect(tags.state().recovery).toMatchObject({ command: { intent: { name: 'Meals' } } });
    tags.close();
    const restarted = await restartOffline(f, controller);
    try {
      const offline = await openTags(restarted);
      // Neither the Tags from before the change nor any copy claiming it: nothing is shown.
      expect(offline.state()).toMatchObject({
        snapshot: null,
        unsaved: true,
        recovery: { command: { intent: { action: 'rename', name: 'Meals' } } },
      });
      offline.close();
    } finally {
      restarted.dispose();
    }
  });
});

describe('saved Tags are retired with the Group’s other saved copies (#638)', () => {
  it('on sign-out', async () => {
    const f = fixture();
    const { controller, tags } = await readTagsOnline(f);
    tags.close();
    await controller.signOut();
    expect(f.savedTags()).toBeNull();
    controller.dispose();
  });

  it('on an account switch', async () => {
    const f = fixture();
    const { controller, tags } = await readTagsOnline(f);
    tags.close();
    await controller.signIn('sam');
    expect(controller.getSnapshot().auth.user?.id).toBe(sam.id);
    expect(f.savedTags(alex.id)).toBeNull();
    expect(f.keepsMaple(alex.id)).toBe(false);
    controller.dispose();
  });

  it('when Maple House refuses the member', async () => {
    const f = fixture();
    const { controller, tags } = await readTagsOnline(f);
    tags.close();
    f.server.revoked = true;
    await controller.refresh();
    await vi.waitFor(() => expect(f.keepsMaple()).toBe(false));
    expect(f.savedTags()).toBeNull();
    controller.dispose();
  });

  it('when the member leaves Maple House', async () => {
    const f = fixture();
    const { controller, tags } = await readTagsOnline(f);
    tags.close();
    controller.openMembers();
    await controller.reviewLeaveGroup();
    await controller.leaveGroup();
    expect(f.server.left).toBe(true);
    await vi.waitFor(() => expect(f.keepsMaple()).toBe(false));
    controller.dispose();
  });

  it('when a Groups list from the server leaves Maple House out', async () => {
    const f = fixture();
    const { controller, tags } = await readTagsOnline(f);
    tags.close();
    await controller.back();
    expect(controller.getSnapshot().screen).toBe('groups');
    f.server.unlisted = true;
    // A pull reads the Groups list again.
    await controller.refresh('pull');
    expect(controller.getSnapshot().groups.data).toEqual([]);
    await vi.waitFor(() => expect(f.savedTags()).toBeNull());
    expect(f.keepsMaple()).toBe(false);
    controller.dispose();
  });

  it('within the 20 MB budget: kept while their Group is open, removed least recently used once it isn’t', async () => {
    const f = fixture();
    f.sizes.set(tagsPath, 21 * mb);
    const { controller, tags } = await readTagsOnline(f);
    // Maple House is open, so its Tags stay though they're over the budget.
    expect(f.savedTags()).not.toBeNull();
    tags.close();
    await controller.back();
    expect(controller.getSnapshot().screen).toBe('groups');
    // Home's next saved copy has the budget checked again: the Tags go, Home's own rows stay.
    await controller.refreshHome();
    await vi.waitFor(() => expect(f.savedTags()).toBeNull());
    expect(f.cache.has(alex.id + '/api/groups')).toBe(true);
    controller.dispose();
  });
});

describe('a new Expense offline takes one of the Group’s saved Tags (#638)', () => {
  it('lists the saved Tags and keeps the Tag chosen, while other financial choices still wait', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(mapleId);
    await vi.waitFor(() => expect(f.cache.has(alex.id + maplePath)).toBe(true));
    const restarted = await restartOffline(f, controller);
    try {
      await restarted.openGroup(mapleId);
      await restarted.openExpense(mapleId);
      expect(restarted.getSnapshot().expense).toMatchObject({
        status: 'editing',
        contextCheck: { status: 'saved', saved: true },
        draft: { tagId: '', payerId: alex.id },
      });
      expect(restarted.getSnapshot().expense.context?.tags.map((tag) => tag.name)).toEqual([
        'Food',
        'Rent',
      ]);
      await restarted.updateExpenseDraft({ tagId: foodId, payerId: sam.id });
      // The Tag is the member's own pick from the saved Tags; the payer still waits for the
      // Group's live check, as before.
      expect(restarted.getSnapshot().expense.draft).toMatchObject({
        tagId: foodId,
        payerId: alex.id,
      });
      expect(restarted.getSnapshot().expense.validation.errors.tag).toBeUndefined();
      // Saving still needs a connection: nothing was sent.
      await restarted.saveExpense();
      expect(f.requests.filter((request) => request.startsWith('POST /api/groups'))).toEqual([]);
    } finally {
      restarted.dispose();
    }
  });
});
