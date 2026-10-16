import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DraftReview,
  PersistedExpenseDraft,
} from '@splitbook/shared/validators/expense-draft';
import { createMobileController, type MobileController } from './mobile-controller';
import type { MobileFetch } from './types';
import { savedQueriesIn } from '../test-utils/saved-queries';

const user = {
  id: 'a00000000000000000000001',
  name: 'Alex',
  email: 'alex@example.test',
  image: null,
};
const groupId = 'b00000000000000000000001';
const tagId = 'c00000000000000000000001';
const iso = '2026-10-16T12:00:00.000Z';
const group = {
  _id: groupId,
  createdBy: user.id,
  name: 'Maple House',
  description: '',
  category: 'home',
  defaultCurrency: 'INR',
  createdAt: iso,
  updatedAt: iso,
  members: [{ user: { ...user, _id: user.id }, role: 'admin', joinedAt: iso }],
  tags: [{ _id: tagId, name: 'General', isArchived: false, createdAt: iso }],
};
const json = (value: unknown, status = 200, cookie?: string) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { 'Set-Cookie': cookie } : {}) },
  });
const item = (index: number): DraftReview => {
  const draft: PersistedExpenseDraft = {
    id: `d${String(index).padStart(23, '0')}`,
    groupId,
    revision: 0,
    state: 'active',
    preparedBy: { kind: 'assistant', name: 'Claude' },
    changedBy: { kind: 'assistant', name: 'Claude' },
    createdAt: iso,
    updatedAt: iso,
    missingFields: ['amount'],
    values: { description: `Item ${index}` },
  } as PersistedExpenseDraft;
  return { draft, review: 'a'.repeat(64), problems: [], duplicates: [] };
};
function memory() {
  const values = new Map<string, unknown>();
  return {
    load: async (account: string, id: string) =>
      structuredClone(values.get(`${account}:${id}`) ?? null),
    save: async (account: string, id: string, value: unknown) =>
      void values.set(`${account}:${id}`, structuredClone(value)),
    remove: async (account: string, id: string) => void values.delete(`${account}:${id}`),
    clear: async () => values.clear(),
    list: async (account: string) =>
      [...values]
        .filter(([key]) => key.startsWith(`${account}:`))
        .map(([key, value]) => ({
          groupId: key.slice(account.length + 1),
          value: structuredClone(value),
        })),
  };
}
const controllers: MobileController[] = [];
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.unstubAllEnvs();
});
function fixture(options: { groups?: boolean } = {}) {
  let held: Promise<void> | undefined;
  let operation = 0;
  let creation: unknown = null;
  let owner: string | null = null;
  let denied = false;
  vi.stubEnv('EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED', 'true');
  let items: DraftReview[] = [];
  let groups = options.groups === false ? [] : [group];
  let cookie: string | null = null;
  const fetch: MobileFetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/demo-persona/sign-in'))
      return json({ user }, 200, 'better-auth.session_token=alex.signature; Max-Age=2592000');
    if (path.endsWith('/get-session'))
      return json({ user, session: { userId: user.id, expiresAt: '2030-01-01T00:00:00Z' } });
    if (path === '/api/user/to-review') {
      const reply = {
        status: 200,
        data: {
          total: items.length,
          groups: items.length
            ? [{ groupId, groupName: group.name, count: items.length, items }]
            : [],
        },
      };
      await held;
      return json(reply);
    }
    if (path === '/api/user/balances')
      return json({
        status: 200,
        data: { buckets: [], groups: groups.map(() => ({ groupId, balances: [] })) },
      });
    if (path === '/api/groups' && init.method === 'POST') {
      groups = [group];
      return json({ status: 201, data: group }, 201);
    }
    if (path === '/api/groups') return json({ status: 200, data: groups });
    if (path === `/api/groups/${groupId}`)
      return denied
        ? json({ error: 'Forbidden', status: 403 }, 403)
        : json({ status: 200, data: group });
    if (path.endsWith('/drafts')) return json({ data: items.map((entry) => entry.draft) });
    if (path.endsWith('/activity'))
      return json({
        status: 200,
        data: { activities: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } },
      });
    if (path.endsWith('/expenses'))
      return json({
        status: 200,
        data: {
          expenses: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
          summary: { count: 0, totalsByCurrency: [], userOwes: 0, userGetsBack: 0 },
        },
      });
    if (path.endsWith('/balances')) return json({ status: 200, data: { byCurrency: [] } });
    return json({ error: 'Unavailable', status: 404 }, 404);
  };
  const drafts = memory(),
    requests = memory();
  let deviceHeld: Promise<void> | undefined;
  const list = drafts.list;
  drafts.list = async (account: string) => {
    await deviceHeld;
    return list(account);
  };
  const saved = new Map<string, unknown>();
  const makeController = () => {
    const controller = createMobileController(
      {
        apiBaseUrl: 'http://localhost:4433',
        authOrigin: 'http://localhost:4433',
        developmentPersonaEnabled: true,
      },
      {
        fetch,
        now: () => Date.parse(iso),
        newSubmissionKey: () => `fictional-433-${++operation}`,
        credentials: {
          load: async () => cookie,
          save: async (next) => void (cookie = next),
          clear: async () => void (cookie = null),
        },
        expenseDrafts: drafts,
        draftRequests: requests,
        groupCreations: {
          load: async () => structuredClone(creation),
          save: async (_account, value) => void (creation = structuredClone(value)),
          remove: async () => void (creation = null),
          clear: async () => undefined,
        },
        savedQueries: savedQueriesIn(saved),
        accountLocal: {
          owner: {
            load: async () => owner,
            save: async (next) => void (owner = next),
            clear: async () => void (owner = null),
          },
          cleanupMarker: { load: async () => false, mark: async () => {}, clear: async () => {} },
          stores: [drafts, requests],
        },
      },
    );
    controllers.push(controller);
    return controller;
  };
  const controller = makeController();
  return {
    controller,
    restart: () => {
      controller.dispose();
      return makeController();
    },
    holdDevice: () => {
      let release!: () => void;
      deviceHeld = new Promise((resolve) => (release = resolve));
      return () => {
        deviceHeld = undefined;
        release();
      };
    },
    deny: () => {
      denied = true;
    },
    allow: () => {
      denied = false;
    },
    hold: () => {
      let release!: () => void;
      held = new Promise((resolve) => (release = resolve));
      return () => {
        held = undefined;
        release();
      };
    },
    prepare: (count: number) => {
      items = Array.from({ length: count }, (_, index) => item(index + 1));
    },
  };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

async function create(f: ReturnType<typeof fixture>) {
  f.controller.updateCreation({ name: 'Cabin Weekend', category: 'home', defaultCurrency: 'INR' });
  await f.controller.createGroup();
  await settle();
}

describe('To review stays current (#433)', () => {
  it('finishes a To review read that Home outdated while it was on its way', async () => {
    const f = fixture({ groups: false });
    const release = f.hold();
    await f.controller.signIn('alex');
    await settle();
    expect(f.controller.getSnapshot().toReview.status).toBe('loading');
    // Creating a Group outdates Home's reads while To review's read is still on its way.
    await create(f);
    release();
    await settle();
    expect(f.controller.getSnapshot().toReview).toMatchObject({
      status: 'ready',
      read: { total: 0 },
    });
  });

  it('reads To review again when Home is outdated, so items prepared meanwhile show', async () => {
    const f = fixture({ groups: false });
    await f.controller.signIn('alex');
    await settle();
    expect(f.controller.getSnapshot().toReview).toMatchObject({
      status: 'ready',
      read: { total: 0 },
    });
    f.prepare(2);
    await create(f);
    expect(f.controller.getSnapshot().toReview).toMatchObject({
      status: 'ready',
      read: { total: 2 },
    });
  });

  it('keeps the count shown while that read is on its way', async () => {
    const f = fixture({ groups: false });
    f.prepare(2);
    await f.controller.signIn('alex');
    await settle();
    expect(f.controller.getSnapshot().toReview.read.total).toBe(2);
    f.prepare(3);
    const release = f.hold();
    await create(f);
    expect(f.controller.getSnapshot().toReview.read.total).toBe(2);
    release();
    await settle();
    expect(f.controller.getSnapshot().toReview).toMatchObject({
      status: 'ready',
      read: { total: 3 },
    });
  });

  it('never shows a denied Group from a later read, until the member creates or joins it again', async () => {
    const f = fixture();
    f.prepare(2);
    await f.controller.signIn('alex');
    await settle();
    expect(f.controller.getSnapshot().toReview.read.total).toBe(2);
    f.deny();
    await f.controller.openGroup(groupId);
    await f.controller.back();
    await settle();
    // The server's read still lists it (a read sent before the denial, or a lagging server).
    await f.controller.refreshHome();
    await settle();
    expect(f.controller.getSnapshot().toReview.read).toEqual({ total: 0, groups: [] });
    f.allow();
    await create(f);
    await settle();
    expect(f.controller.getSnapshot().toReview.read.total).toBe(2);
  });

  it('finishes a To review read started at a cold start when the member opens a Group meanwhile', async () => {
    const f = fixture();
    f.prepare(2);
    await f.controller.signIn('alex');
    await settle();
    const restarted = f.restart();
    const release = f.hold();
    await restarted.restore();
    await settle();
    expect(restarted.getSnapshot().toReview.status).toBe('loading');
    // Opening the Group reads it and its Expenses, which outdates Home's reads (M1-5).
    await restarted.openGroup(groupId);
    await settle();
    release();
    await settle();
    expect(restarted.getSnapshot().toReview).toMatchObject({ status: 'ready', read: { total: 2 } });
  });

  it("Refresh Home reads To review without waiting for this phone's storage", async () => {
    const f = fixture();
    await f.controller.signIn('alex');
    await settle();
    f.prepare(2);
    const release = f.holdDevice();
    const refreshing = f.controller.refreshHome();
    await settle();
    expect(f.controller.getSnapshot().toReview).toMatchObject({
      status: 'ready',
      read: { total: 2 },
    });
    release();
    await refreshing;
  });

  it('Refresh Home reads To review again and shows items an assistant prepared', async () => {
    const f = fixture();
    await f.controller.signIn('alex');
    await settle();
    f.prepare(2);
    await f.controller.refreshHome();
    await settle();
    expect(f.controller.getSnapshot().toReview).toMatchObject({
      status: 'ready',
      read: { total: 2 },
    });
  });

  it('opens a Group To review with its items without a manual refresh', async () => {
    const f = fixture();
    await f.controller.signIn('alex');
    await settle();
    f.prepare(2);
    await f.controller.openToReview(groupId);
    await settle();
    expect(f.controller.getSnapshot().toReview).toMatchObject({
      status: 'ready',
      read: { total: 2 },
    });
  });
});
