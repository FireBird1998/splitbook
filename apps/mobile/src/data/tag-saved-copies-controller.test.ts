import { describe, expect, it, vi } from 'vitest';
import type { TagCommand } from '@splitbook/shared/tag-management';
import { createCheckedMobileController as createMobileController } from '../test-utils/flow-monitor';
import { savedQueriesIn } from '../test-utils/saved-queries';
import type { AccountGroupRecordStore } from './account-record-storage';
import { expenseTagPending } from './expense-draft';

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
    /** Each applied Tag change's receipt, by its request id, for Check again. */
    receipts: new Map<string, unknown>(),
    /** Reads of the Tags wait for this before they're answered. */
    holdRead: null as Promise<void> | null,
    /** How long this phone takes to read a kept Tag change, in ms. */
    tagLoadDelay: 0,
    /** This phone can't remove saved copies. */
    failRemoval: false,
    /** Sam belongs to Maple House too. */
    samMember: false,
    /** This phone's listing of its kept Tag changes waits for this. */
    holdKeys: null as Promise<void> | null,
    /** How often this phone has listed its kept Tag changes. */
    keysListed: 0,
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
  const kept = memory(),
    drafts = memory(),
    attempts = memory();
  const tagRequests = {
    ...kept,
    keys: async (account: string) => {
      server.keysListed += 1;
      await server.holdKeys;
      return kept.keys!(account);
    },
    load: async (account: string, id: string) => {
      await new Promise((resolve) => setTimeout(resolve, server.tagLoadDelay));
      return kept.load(account, id);
    },
  };
  const rows = savedQueriesIn(cache);
  const savedQueries = {
    ...rows,
    remove: async (account: string, path: string) => {
      if (server.failRemoval) throw new Error('The device storage is full');
      await rows.remove(account, path);
    },
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
    const member = (user === alex || server.samMember) && !server.revoked && !server.left;
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
      const receipt = { intent, tagId: tag.id, appliedAt: iso };
      server.receipts.set(command.requestId, receipt);
      if (server.loseTagReply) {
        server.loseTagReply = false;
        throw new TypeError('Network request failed');
      }
      return json({
        status: 200,
        data: {
          state: 'applied',
          requestId: command.requestId,
          receipt,
          snapshot: snapshot(),
        },
      });
    }
    if (path === tagsPath) {
      await server.holdRead;
      return json({ status: 200, data: snapshot() });
    }
    if (path.startsWith(`${tagsPath}/`)) {
      const requestId = path.slice(tagsPath.length + 1);
      const receipt = server.receipts.get(requestId);
      return json({
        status: 200,
        data: receipt
          ? { state: 'applied', requestId, receipt, snapshot: snapshot() }
          : { state: 'not-applied', requestId, snapshot: snapshot() },
      });
    }
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
  return {
    create,
    server,
    cache,
    sizes,
    savedTags,
    keepsMaple,
    tagRequests,
    requests,
    /** The session cookie is gone, as after a 401: this account's data stays on disk. */
    forgetCookie: () => {
      cookie = null;
    },
  };
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
  await vi.waitFor(() => expect(controller.getSnapshot().tagManager.busy).toBe(false), {
    timeout: 3000,
  });
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

/** Lets answers and saved-copy writes already under way finish. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 50));

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

/** A rename of Food kept on this phone, unresolved, as if the app was killed while it was sent. */
const keepRename = (f: Fixture, confirmed = false) =>
  f.tagRequests.save(alex.id, mapleId, {
    command: {
      requestId: '00000000-0000-4000-8000-000000000099',
      intent: { action: 'rename', tagId: foodId, expectedRevision: 0, name: 'Meals' },
    },
    ...(confirmed
      ? {
          confirmed: {
            state: 'applied',
            requestId: '00000000-0000-4000-8000-000000000099',
            receipt: {
              intent: { action: 'rename', tagId: foodId, expectedRevision: 0, name: 'Meals' },
              tagId: foodId,
              appliedAt: iso,
            },
            snapshot: {
              canManage: true,
              tags: [
                { id: foodId, name: 'Meals', revision: 1, isArchived: false, isDeleted: false },
              ],
            },
          },
        }
      : {}),
  });

describe('Tags are never kept while a change made here is unconfirmed (#638)', () => {
  it('holds them back after an offline start, once the phone reconnects, though read before the kept change', async () => {
    const f = fixture();
    const { controller, tags } = await readTagsOnline(f);
    tags.close();
    await keepRename(f);
    // An offline start notes the kept change; no session check runs until the phone reconnects.
    const restarted = await restartOffline(f, controller);
    try {
      f.server.offline = false;
      f.server.tagLoadDelay = 300;
      const again = await openTags(restarted);
      expect(again.state().snapshot?.tags.map((tag) => tag.name)).toEqual(['Food', 'Rent']);
      await settled();
      expect(f.savedTags()).toBeNull();
      again.close();
    } finally {
      restarted.dispose();
    }
  });

  it('holds them back when the same account signs in again with its data still here', async () => {
    const f = fixture();
    const { controller, tags } = await readTagsOnline(f);
    tags.close();
    await keepRename(f);
    controller.dispose();
    // Signed out by a 401: the cookie goes, the account's data stays, and the member signs in.
    f.forgetCookie();
    const restarted = f.create();
    await restarted.restore();
    expect(restarted.getSnapshot().auth.status).toBe('signed-out');
    try {
      await restarted.signIn('alex');
      f.server.tagLoadDelay = 300;
      const again = await openTags(restarted);
      expect(again.state().recovery).toMatchObject({ command: { intent: { name: 'Meals' } } });
      await settled();
      expect(f.savedTags()).toBeNull();
      again.close();
    } finally {
      restarted.dispose();
    }
  });

  it('marks nothing for the next account when a start is overtaken while it lists kept changes', async () => {
    const f = fixture();
    f.server.samMember = true;
    const { controller, tags } = await readTagsOnline(f);
    tags.close();
    await keepRename(f);
    controller.dispose();
    let release!: () => void;
    f.server.holdKeys = new Promise<void>((resolve) => (release = resolve));
    const listed = f.server.keysListed;
    const restarted = f.create();
    const restoring = restarted.restore().catch(() => undefined);
    try {
      await vi.waitFor(() => expect(f.server.keysListed).toBeGreaterThan(listed));
      // Sam signs in on this phone while Alex's start is still listing Alex's kept changes.
      const switching = restarted.signIn('sam');
      await settled();
      f.server.holdKeys = null;
      release();
      await restoring;
      await switching;
      expect(restarted.getSnapshot().auth.user?.id).toBe(sam.id);
      // Nothing of Alex's holds back Sam's Tags: offline, a new Expense takes one of them.
      await restarted.openGroup(mapleId);
      await vi.waitFor(() => expect(f.cache.has(sam.id + maplePath)).toBe(true));
      f.server.offline = true;
      await restarted.refresh();
      expect(restarted.getSnapshot().offline.active).toBe(true);
      await restarted.openExpense(mapleId);
      const { expense } = restarted.getSnapshot();
      expect(expense.contextCheck).toMatchObject({ status: 'saved' });
      expect(expense.contextCheck?.tagChange).toBeUndefined();
      await restarted.updateExpenseDraft({ tagId: foodId });
      expect(restarted.getSnapshot().expense.draft?.tagId).toBe(foodId);
    } finally {
      restarted.dispose();
    }
  });

  it('keeps none after a restart, though the Tags are read before the kept change is', async () => {
    const f = fixture();
    const { controller, tags } = await readTagsOnline(f);
    const food = tags.state().snapshot!.tags.find((item) => item.name === 'Food')!;
    f.server.loseTagReply = true;
    tags.manager.edit(food, 'rename');
    tags.manager.enter('Meals');
    await tags.manager.submit();
    expect(tags.state().recovery?.confirmed).toBeUndefined();
    tags.close();
    controller.dispose();
    // The app starts again, online, and this phone reads its kept change more slowly than
    // Splitbook answers a read of the Tags.
    f.server.tagLoadDelay = 300;
    const restarted = f.create();
    await restarted.restore();
    try {
      const again = await openTags(restarted);
      expect(again.state()).toMatchObject({
        snapshot: { tags: [{ name: 'Meals' }, { name: 'Rent' }] },
        recovery: { command: { intent: { action: 'rename', name: 'Meals' } } },
      });
      expect(again.state().recovery?.confirmed).toBeUndefined();
      await settled();
      expect(f.savedTags()).toBeNull();
      again.close();
    } finally {
      restarted.dispose();
    }
  });

  it('shows them, but keeps none, until Check again confirms the change', async () => {
    const f = fixture();
    const { controller, tags } = await readTagsOnline(f);
    const food = tags.state().snapshot!.tags.find((item) => item.name === 'Food')!;
    f.server.loseTagReply = true;
    // The read after the lost reply is answered once this phone has cleared its older copies.
    let answer!: () => void;
    f.server.holdRead = new Promise<void>((resolve) => (answer = resolve));
    tags.manager.edit(food, 'rename');
    tags.manager.enter('Meals');
    await tags.manager.submit();
    expect(tags.state().recovery).toMatchObject({ command: { intent: { name: 'Meals' } } });
    expect(tags.state().recovery?.confirmed).toBeUndefined();
    f.server.holdRead = null;
    answer();
    // Read again after the lost reply, which the server had applied: shown, never kept, since
    // this phone can't yet say whether the change it holds is in them.
    await vi.waitFor(() =>
      expect(tags.state().snapshot?.tags.map((item) => item.name)).toEqual(['Meals', 'Rent']),
    );
    await settled();
    expect(f.savedTags()).toBeNull();
    tags.close();
    // Offline in the same session, the Tags read after the reply show as that read, never as
    // this phone's copy, beside the change to check: they say this phone keeps none.
    f.server.offline = true;
    const offline = await openTags(controller);
    expect(offline.state()).toMatchObject({
      snapshot: { tags: [{ name: 'Meals' }, { name: 'Rent' }] },
      saved: false,
      message: 'Couldn’t refresh the Tags, and this phone no longer keeps a copy of them.',
      recovery: { command: { intent: { action: 'rename', name: 'Meals' } } },
    });
    expect(f.savedTags()).toBeNull();
    offline.close();
    // Online again, Check again confirms the change, and the Tags read after it are kept.
    f.server.offline = false;
    const online = await openTags(controller);
    await online.manager.check();
    expect(online.state().recovery?.confirmed).toMatchObject({ state: 'applied' });
    await vi.waitFor(() =>
      expect(f.savedTags()?.tags.map((item) => item.name)).toEqual(['Meals', 'Rent']),
    );
    online.close();
    controller.dispose();
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

  it('at the next start, when a Tag change is kept for their Group', async () => {
    const f = fixture();
    const { controller, tags } = await readTagsOnline(f);
    tags.close();
    // A change kept before the app was killed: it may have reached the server.
    await keepRename(f);
    expect(f.savedTags()).not.toBeNull();
    controller.dispose();
    f.server.offline = true;
    const restarted = f.create();
    await restarted.restore();
    try {
      expect(f.savedTags()).toBeNull();
    } finally {
      restarted.dispose();
    }
  });

  it('never shown once this phone couldn’t remove them, even still on disk after a restart', async () => {
    const f = fixture();
    const { controller, tags } = await readTagsOnline(f);
    tags.close();
    await controller.back();
    // A Groups list leaves Maple House out, and this phone can't remove its copies.
    f.server.unlisted = true;
    f.server.failRemoval = true;
    await controller.refresh('pull');
    expect(f.savedTags()).not.toBeNull();
    controller.dispose();
    f.server.offline = true;
    const restarted = f.create();
    await restarted.restore();
    try {
      const offline = await openTags(restarted);
      expect(offline.state()).toMatchObject({ snapshot: null, unsaved: true, saved: false });
      expect(f.savedTags()).not.toBeNull();
      offline.close();
    } finally {
      restarted.dispose();
    }
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
  it('offers the Tags of the newer of the Group’s two saved reads', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(mapleId);
    await vi.waitFor(() => expect(f.cache.has(alex.id + maplePath)).toBe(true));
    // Another admin renames Food; this phone reads the Tags after it, and not the Group.
    f.server.tags[0].name = 'Meals';
    controller.openTags(mapleId);
    const stop = controller.manageTags(mapleId).open();
    await vi.waitFor(() =>
      expect(f.savedTags()?.tags.map((tag) => tag.name)).toEqual(['Meals', 'Rent']),
    );
    stop();
    controller.closeTags();
    const group = f.cache.get(alex.id + maplePath) as {
      refreshedAt: number;
      value: { data: { tags: { name: string }[] } };
    };
    expect(group.value.data.tags.map((tag) => tag.name)).toEqual(['Food', 'Rent']);
    expect(f.savedTags()!.refreshedAt).toBeGreaterThan(group.refreshedAt);
    const restarted = await restartOffline(f, controller);
    try {
      await restarted.openGroup(mapleId);
      await restarted.openExpense(mapleId);
      expect(restarted.getSnapshot().expense.contextCheck).toMatchObject({ status: 'saved' });
      expect(restarted.getSnapshot().expense.context?.tags.map((tag) => tag.name)).toEqual([
        'Meals',
        'Rent',
      ]);
      await restarted.updateExpenseDraft({ tagId: foodId });
      expect(restarted.getSnapshot().expense.draft?.tagId).toBe(foodId);
    } finally {
      restarted.dispose();
    }
  });

  it('offers the Group’s own Tags when its saved read is the newer one', async () => {
    const f = fixture();
    const { controller, tags } = await readTagsOnline(f);
    tags.close();
    // Another admin renames Food; this phone reads the Group after it, and not the Tags.
    f.server.tags[0].name = 'Meals';
    await controller.refresh();
    await vi.waitFor(() =>
      expect(
        (
          f.cache.get(alex.id + maplePath) as { value: { data: { tags: { name: string }[] } } }
        ).value.data.tags.map((tag) => tag.name),
      ).toEqual(['Meals', 'Rent']),
    );
    expect(f.savedTags()?.tags.map((tag) => tag.name)).toEqual(['Food', 'Rent']);
    const restarted = await restartOffline(f, controller);
    try {
      await restarted.openGroup(mapleId);
      await restarted.openExpense(mapleId);
      expect(restarted.getSnapshot().expense.context?.tags.map((tag) => tag.name)).toEqual([
        'Meals',
        'Rent',
      ]);
    } finally {
      restarted.dispose();
    }
  });

  it('offers the saved Tags after a start that finds a confirmed change kept here', async () => {
    const f = fixture();
    const { controller, tags } = await readTagsOnline(f);
    tags.close();
    await keepRename(f, true);
    // The start removes the Group's older copies for the kept change; once reconnected, the
    // Group is read and saved again, then the phone goes offline.
    const restarted = await restartOffline(f, controller);
    try {
      f.server.offline = false;
      await restarted.openGroup(mapleId);
      await vi.waitFor(() => expect(f.cache.has(alex.id + maplePath)).toBe(true));
      f.server.offline = true;
      await restarted.refresh();
      expect(restarted.getSnapshot().offline.active).toBe(true);
      await restarted.openExpense(mapleId);
      const { expense } = restarted.getSnapshot();
      expect(expense.contextCheck).toMatchObject({ status: 'saved' });
      expect(expense.contextCheck?.tagChange).toBeUndefined();
      await restarted.updateExpenseDraft({ tagId: foodId });
      expect(restarted.getSnapshot().expense.draft?.tagId).toBe(foodId);
    } finally {
      restarted.dispose();
    }
  });

  it('offers no saved Tags while a Tag change made here is unconfirmed: the Tag waits', async () => {
    const f = fixture();
    const { controller, tags } = await readTagsOnline(f);
    const food = tags.state().snapshot!.tags.find((item) => item.name === 'Food')!;
    f.server.loseTagReply = true;
    tags.manager.edit(food, 'rename');
    tags.manager.enter('Meals');
    await tags.manager.submit();
    expect(tags.state().recovery?.confirmed).toBeUndefined();
    tags.close();
    // The Group is read again and saved after the lost reply: it may or may not include the
    // change. Then the phone goes offline.
    await controller.refresh();
    await vi.waitFor(() => expect(f.cache.has(alex.id + maplePath)).toBe(true));
    f.server.offline = true;
    await controller.refresh();
    expect(controller.getSnapshot().offline.active).toBe(true);
    try {
      await controller.openExpense(mapleId);
      const { expense } = controller.getSnapshot();
      expect(expense).toMatchObject({
        status: 'editing',
        contextCheck: { status: 'saved', tagChange: true },
      });
      expect(expenseTagPending(expense, true)).toBe(true);
      await controller.updateExpenseDraft({ tagId: foodId, description: 'Market run' });
      expect(controller.getSnapshot().expense.draft).toMatchObject({
        tagId: '',
        description: 'Market run',
      });
    } finally {
      controller.dispose();
    }
  });

  it('refuses a saved Tag archived meanwhile once back online, sending nothing and swapping nothing in', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    await controller.openGroup(mapleId);
    await vi.waitFor(() => expect(f.cache.has(alex.id + maplePath)).toBe(true));
    const restarted = await restartOffline(f, controller);
    try {
      await restarted.openGroup(mapleId);
      await restarted.openExpense(mapleId);
      await restarted.updateExpenseDraft({
        amount: '12',
        description: 'Market run',
        tagId: foodId,
      });
      expect(restarted.getSnapshot().expense.draft?.tagId).toBe(foodId);
      // Meanwhile another admin archives Food, and the phone reconnects.
      f.server.tags[0].isArchived = true;
      f.server.offline = false;
      await restarted.refresh();
      expect(restarted.getSnapshot().expense.contextCheck).toBeUndefined();
      await restarted.saveExpense();
      const { expense } = restarted.getSnapshot();
      expect(expense.status).toBe('editing');
      expect(expense.draft?.tagId).toBe(foodId);
      expect(expense.validation.errors.tag).toBe(
        '“Food” is no longer active in this Group. Choose another Tag; nothing is swapped in for you.',
      );
      expect(f.requests.filter((request) => request.startsWith('POST /api/groups'))).toEqual([]);
    } finally {
      restarted.dispose();
    }
  });

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
