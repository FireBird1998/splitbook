import { describe, expect, it, vi } from 'vitest';
import { decodeStoredSession } from './cookies';
import { createMobileController } from './mobile-controller';
import type { AccountLocalStorage, CredentialStore, FetchResponse, MobileFetch } from './types';

const alex = {
  id: 'a00000000000000000000001',
  name: 'Alex Rivera',
  email: 'alex.demo@splitbook.local',
  image: null,
};
const sam = {
  id: 'a00000000000000000000002',
  name: 'Sam Chen',
  email: 'sam.demo@splitbook.local',
  image: null,
};
const groupId = 'a00000000000000000000010';
const otherGroupId = 'a00000000000000000000011';
const alexCookie = 'better-auth.session_token=signed-alex.signature';
const samCookie = 'better-auth.session_token=signed-sam.signature';
const iso = '2026-09-27T10:00:00.000Z';
const now = Date.parse(iso);

function group(user = alex, id = groupId) {
  const { id: userId, ...profile } = user;
  return {
    _id: id,
    createdBy: userId,
    name: user === alex ? 'Weekend Away' : 'Shared Home',
    description: 'Fictional development data',
    category: user === alex ? 'trip' : 'home',
    defaultCurrency: 'INR',
    members: [{ user: { _id: userId, ...profile }, role: 'admin', joinedAt: iso }],
    startDate: user === alex ? iso : null,
    endDate: null,
    createdAt: iso,
    updatedAt: iso,
  };
}

function json(body: unknown, status = 200, setCookie?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(setCookie ? { 'Set-Cookie': setCookie } : {}),
    },
  });
}

function session(user = alex) {
  return { user, session: { userId: user.id, expiresAt: '2030-01-01T00:00:00.000Z' } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function memoryCredentials(initial: string | null = null) {
  let value = initial;
  const credentials: CredentialStore = {
    load: vi.fn(async () => value),
    save: vi.fn(async (cookie) => {
      value = cookie;
    }),
    clear: vi.fn(async () => {
      value = null;
    }),
  };
  return { credentials, read: () => value };
}

function memoryAccountOwner(initial: string | null = null): AccountLocalStorage['owner'] {
  let accountId = initial;
  return {
    load: async () => accountId,
    save: async (value) => {
      accountId = value;
    },
    clear: async () => {
      accountId = null;
    },
  };
}

/**
 * One device's account-local storage: the account owner, the cleanup marker, and the store for
 * a Group being created. `store: false` is a device without that store.
 */
function memoryDevice({ store = true } = {}) {
  let marked = false;
  let failing: 'load' | 'save' | 'remove' | null = null;
  const records = new Map<string, unknown>();
  const groupCreations = {
    load: async (accountId: string) => {
      if (failing === 'load') throw new Error('SQLITE_IOERR: disk I/O error');
      return structuredClone(records.get(accountId) ?? null);
    },
    save: async (accountId: string, value: unknown) => {
      if (failing === 'save') throw new Error('SQLITE_FULL: database or disk is full');
      records.set(accountId, structuredClone(value));
    },
    remove: async (accountId: string) => {
      if (failing === 'remove') throw new Error('SQLITE_BUSY: database is locked');
      records.delete(accountId);
    },
    clear: async () => {
      records.clear();
    },
  };
  const accountLocal: AccountLocalStorage = {
    owner: memoryAccountOwner(),
    cleanupMarker: {
      load: async () => marked,
      mark: async () => {
        marked = true;
      },
      clear: async () => {
        marked = false;
      },
    },
    stores: store ? [groupCreations] : [],
  };
  return {
    accountLocal,
    groupCreations: store ? groupCreations : undefined,
    records,
    fail: (operation: 'load' | 'save' | 'remove' | null) => {
      failing = operation;
    },
  };
}

function setup(
  options: {
    saved?: string;
    pending?: CredentialStore;
    enabled?: boolean;
    store?: ReturnType<typeof memoryCredentials>;
    accountLocal?: AccountLocalStorage;
    /** Defaults to a fresh device, unless `accountLocal` is given. */
    device?: ReturnType<typeof memoryDevice>;
    intercept?: (
      path: string,
      init: RequestInit,
    ) => FetchResponse | Promise<FetchResponse> | undefined;
    newSubmissionKey?: (() => string) | null;
  } = {},
) {
  let keys = 0;
  const store = options.store ?? memoryCredentials(options.saved);
  const device = options.device ?? (options.accountLocal ? undefined : memoryDevice());
  const fetch = vi.fn<MobileFetch>(async (url, init) => {
    const path = new URL(url).pathname;
    const intercepted = options.intercept?.(path, init);
    if (intercepted) return intercepted;
    const headers = new Headers(init.headers);
    if (init.method === 'POST' && headers.get('Origin') !== 'http://localhost:4127')
      return json({}, 403);
    if (path === '/api/auth/demo-persona/sign-in') {
      const selected = JSON.parse(String(init.body)).personaId === 'sam' ? sam : alex;
      return json(
        { token: 'raw-token-not-a-cookie', user: selected },
        200,
        `${selected === sam ? samCookie : alexCookie}; HttpOnly; Path=/; Max-Age=2592000`,
      );
    }
    if (!headers.get('Cookie')) return json({ error: 'Unauthorized', status: 401 }, 401);
    const selected = headers.get('Cookie')?.includes('signed-sam') ? sam : alex;
    if (path === '/api/auth/get-session') return json(session(selected));
    if (path === '/api/auth/sign-out')
      return json({ success: true }, 200, 'better-auth.session_token=; Max-Age=0');
    if (path === '/api/user/balances') return json({ data: { buckets: [] }, status: 200 });
    if (/^\/api\/groups\/[a-f0-9]{24}\/balances$/.test(path))
      return json({ data: { byCurrency: [] }, status: 200 });
    if (/^\/api\/groups\/[a-f0-9]{24}\/expenses$/.test(path))
      return json({
        data: {
          expenses: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
          summary: { count: 0, totalsByCurrency: [], userOwes: 0, userGetsBack: 0 },
        },
        status: 200,
      });
    if (path === '/api/groups') return json({ data: [group(selected)], status: 200 });
    if (path === `/api/groups/${groupId}`) return json({ data: group(selected), status: 200 });
    return json({ error: 'Not found', status: 404 }, 404);
  });
  const controller = createMobileController(
    {
      apiBaseUrl: 'http://10.0.2.2:4127',
      authOrigin: 'http://localhost:4127',
      developmentPersonaEnabled: options.enabled ?? true,
    },
    {
      fetch,
      credentials: store.credentials,
      pendingInvitation: options.pending,
      accountLocal: options.accountLocal ?? device?.accountLocal,
      groupCreations: device?.groupCreations,
      newSubmissionKey:
        options.newSubmissionKey === null
          ? undefined
          : (options.newSubmissionKey ?? (() => `native-group-key-${++keys}`)),
      now: () => now,
    },
  );
  return { controller, fetch, store };
}

describe('native session and Group boundary', () => {
  it('persists logout intent before waiting for a held account write', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    let cleanupPending = false;
    let value: string | null = null;
    const accountLocal: AccountLocalStorage = {
      owner: memoryAccountOwner(),
      cleanupMarker: {
        load: async () => cleanupPending,
        mark: async () => {
          cleanupPending = true;
        },
        clear: async () => {
          cleanupPending = false;
        },
      },
      stores: [
        {
          clear: async () => {
            value = null;
          },
        },
      ],
    };
    const store = memoryCredentials();
    const first = setup({ store, accountLocal }).controller;
    await first.signIn('alex');
    const lease = first.accountStorage();
    if (!lease) throw new Error('Expected an authenticated storage lease');
    const writing = lease.write(async () => {
      entered.resolve();
      await release.promise;
      value = 'Old account data';
    });
    const rejectedWrite = expect(writing).rejects.toThrow();
    await entered.promise;
    const loggingOut = first.signOut();
    try {
      await vi.waitFor(() => expect(cleanupPending).toBe(true), { timeout: 50, interval: 5 });
      const restarted = setup({ store, accountLocal }).controller;
      await restarted.restore();
      expect(restarted.getSnapshot().auth).toMatchObject({ status: 'signed-out', user: null });
      expect(store.read()).toBeNull();
    } finally {
      release.resolve();
      await Promise.all([loggingOut, rejectedWrite]);
    }
    expect(value).toBeNull();
  });

  it('preserves the same account after expiry and purges unknown or different stored owners', async () => {
    let cleanupPending = false;
    let cachedData: string | null = 'Unknown account data';
    let expired = false;
    const owner = memoryAccountOwner();
    const { controller } = setup({
      accountLocal: {
        owner,
        cleanupMarker: {
          load: async () => cleanupPending,
          mark: async () => {
            cleanupPending = true;
          },
          clear: async () => {
            cleanupPending = false;
          },
        },
        stores: [
          {
            clear: async () => {
              cachedData = null;
            },
          },
        ],
      },
      intercept: (path) =>
        expired && path === `/api/groups/${groupId}` ? json({}, 401) : undefined,
    });
    await controller.signIn('alex');
    expect(cachedData).toBeNull();
    cachedData = 'Alex recoverable entry';
    expired = true;
    await controller.openGroup(groupId);
    expect(controller.getSnapshot().auth.status).toBe('signed-out');
    await controller.signIn('alex');
    expect(cachedData).toBe('Alex recoverable entry');
    expect(await owner.load()).toBe(alex.id);
    await controller.signIn('sam');
    expect(controller.getSnapshot().auth.user?.id).toBe(sam.id);
    expect(cachedData).toBeNull();
    expect(await owner.load()).toBe(sam.id);
  });

  it('drains an old account write before purge and rejects its retired storage lease', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    let value: string | null = null;
    let cleanupPending = false;
    const { controller } = setup({
      accountLocal: {
        owner: memoryAccountOwner(),
        cleanupMarker: {
          load: async () => cleanupPending,
          mark: async () => {
            cleanupPending = true;
          },
          clear: async () => {
            cleanupPending = false;
          },
        },
        stores: [
          {
            clear: async () => {
              value = null;
            },
          },
        ],
      },
    });
    await controller.signIn('alex');
    const oldAccount = controller.accountStorage();
    if (!oldAccount) throw new Error('Expected an authenticated storage lease');
    const writing = oldAccount.write(async () => {
      entered.resolve();
      await release.promise;
      value = 'Alex cached Group';
    });
    const rejectedWrite = expect(writing).rejects.toThrow();
    await entered.promise;
    const signingOut = controller.signOut();
    expect(controller.accountStorage()).toBeNull();
    release.resolve();
    await Promise.all([signingOut, rejectedWrite]);
    expect(value).toBeNull();
    await controller.signIn('sam');
    await expect(
      oldAccount.write(async () => {
        value = 'Late Alex data';
      }),
    ).rejects.toThrow();
    const samAccount = controller.accountStorage();
    if (!samAccount) throw new Error('Expected the new authenticated storage lease');
    expect(samAccount.accountId).toBe(sam.id);
    await samAccount.write(async () => {
      value = 'Sam cached Group';
    });
    expect(value).toBe('Sam cached Group');
  });

  it('finishes a persisted failed purge before restoring or signing in after restart', async () => {
    let cleanupPending = false;
    let failing = false;
    let cachedData: string | null = null;
    const accountLocal: AccountLocalStorage = {
      owner: memoryAccountOwner(),
      cleanupMarker: {
        load: async () => cleanupPending,
        mark: async () => {
          cleanupPending = true;
        },
        clear: async () => {
          cleanupPending = false;
        },
      },
      stores: [
        {
          clear: async () => {
            if (failing) throw new Error('storage unavailable');
            cachedData = null;
          },
        },
      ],
    };
    const store = memoryCredentials();
    const first = setup({ store, accountLocal }).controller;
    await first.signIn('alex');
    cachedData = 'Alex cached Group';
    failing = true;
    await first.signOut();
    expect(cleanupPending).toBe(true);
    const restarted = setup({ store, accountLocal });
    await restarted.controller.restore();
    expect(restarted.controller.getSnapshot().auth).toMatchObject({ status: 'error', user: null });
    await restarted.controller.signIn('sam');
    expect(restarted.controller.getSnapshot().auth.status).toBe('error');
    expect(restarted.fetch).not.toHaveBeenCalled();
    expect(cleanupPending).toBe(true);
    failing = false;
    await restarted.controller.restore();
    expect(restarted.controller.getSnapshot().auth.status).toBe('signed-out');
    expect(cachedData).toBeNull();
    expect(cleanupPending).toBe(false);
    await restarted.controller.signIn('sam');
    expect(restarted.controller.getSnapshot().auth.user?.id).toBe(sam.id);
  });

  it('attempts every account purge even when the cleanup marker and another store fail', async () => {
    let failing = false;
    let cachedData: string | null = null;
    const pending = memoryCredentials();
    const { controller, store } = setup({
      pending: pending.credentials,
      accountLocal: {
        owner: memoryAccountOwner(),
        cleanupMarker: {
          load: async () => false,
          mark: async () => {
            if (failing) throw new Error('marker unavailable');
          },
          clear: async () => {},
        },
        stores: [
          {
            clear: async () => {
              if (failing) throw new Error('one store unavailable');
            },
          },
          {
            clear: async () => {
              cachedData = null;
            },
          },
        ],
      },
    });
    await controller.signIn('alex');
    cachedData = 'Alex cached Group';
    await pending.credentials.save('deadbeef');
    failing = true;
    await controller.signOut();
    expect(controller.getSnapshot().auth.status).toBe('error');
    expect(store.read()).toBeNull();
    expect(pending.read()).toBeNull();
    expect(cachedData).toBeNull();
  });

  it('clears every registered account store together with authentication on sign-out', async () => {
    let cleanupPending = false;
    let cachedData: string | null = null;
    let draft: string | null = null;
    const { controller, store } = setup({
      accountLocal: {
        owner: memoryAccountOwner(),
        cleanupMarker: {
          load: async () => cleanupPending,
          mark: async () => {
            cleanupPending = true;
          },
          clear: async () => {
            cleanupPending = false;
          },
        },
        stores: [
          {
            clear: async () => {
              cachedData = null;
            },
          },
          {
            clear: async () => {
              draft = null;
            },
          },
        ],
      },
    });
    await controller.signIn('alex');
    cachedData = 'Alex cached Group';
    draft = 'Alex unfinished entry';
    await controller.signOut();
    expect(controller.getSnapshot().auth.status).toBe('signed-out');
    expect(store.read()).toBeNull();
    expect(cachedData).toBeNull();
    expect(draft).toBeNull();
    expect(cleanupPending).toBe(false);
  });

  it('revalidates Settings without navigating away from the signed-in account', async () => {
    const { controller } = setup();
    await controller.signIn('alex');
    controller.openSettings();
    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'settings',
      auth: { status: 'authenticated', user: { id: alex.id } },
    });
    controller.back();
    expect(controller.getSnapshot().screen).toBe('groups');
  });

  it('keeps a new invitation visible when an earlier Group create finishes', async () => {
    const reply = deferred<FetchResponse>();
    const { controller } = setup({
      intercept: (path, init) => {
        if (path === '/api/groups' && init.method === 'POST') return reply.promise;
        if (path === '/api/join/deadbeef')
          return json({
            data: { _id: groupId, name: 'Invited Group', category: 'home', memberCount: 2 },
            status: 200,
          });
      },
    });
    await controller.signIn('alex');
    controller.startCreate();
    controller.updateCreation({ name: 'My new Group' });
    const saving = controller.createGroup();
    await controller.openInvitation('http://localhost:4127/join/deadbeef');
    reply.resolve(
      json({ data: { ...group(alex, otherGroupId), name: 'My new Group' }, status: 201 }, 201),
    );
    await saving;
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'invite',
      invitation: { preview: { name: 'Invited Group' } },
    });
    expect(controller.getSnapshot().groups.data.some((item) => item.id === otherGroupId)).toBe(
      true,
    );
  });

  it('rejects impossible Trip calendar dates without losing the entered fields', async () => {
    let posted = false;
    const { controller } = setup({
      intercept: (path, init) => {
        if (path === '/api/groups' && init.method === 'POST') posted = true;
        return undefined;
      },
    });
    await controller.signIn('alex');
    controller.startCreate();
    controller.updateCreation({ name: 'Weekend away', startDate: '2026-02-30' });
    await controller.createGroup();
    expect(posted).toBe(false);
    expect(controller.getSnapshot().creation).toMatchObject({
      status: 'editing',
      draft: { name: 'Weekend away', startDate: '2026-02-30' },
      message: '2026-02-30 isn’t a real date. Check the day and month.',
      validation: {
        submitted: true,
        errors: { startDate: '2026-02-30 isn’t a real date. Check the day and month.' },
        focus: { field: 'startDate', request: 1 },
      },
    });
  });

  it('does not let an older join completion replace a newly opened invitation', async () => {
    const reply = deferred<FetchResponse>();
    const { controller } = setup({
      intercept: (path, init) => {
        if (path === '/api/join/deadbeef' && init.method === 'POST') return reply.promise;
        if (path.startsWith('/api/join/'))
          return json({
            data: {
              _id: otherGroupId,
              name: path.endsWith('cafebabe') ? 'New invitation' : 'First invitation',
              category: 'home',
              memberCount: 1,
            },
            status: 200,
          });
      },
    });
    await controller.signIn('alex');
    await controller.openInvitation('http://localhost:4127/join/deadbeef');
    const firstJoin = controller.joinInvitation();
    await controller.openInvitation('http://localhost:4127/join/cafebabe');
    reply.resolve(json({ data: { groupId }, status: 201 }, 201));
    await firstJoin;
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'invite',
      invitation: { code: 'cafebabe', preview: { name: 'New invitation' } },
    });
  });

  it('ignores Back while joining, then opens the joined Group', async () => {
    const reply = deferred<FetchResponse>();
    let joined = false;
    const { controller } = setup({
      intercept: (path, init) => {
        if (path === '/api/join/deadbeef' && init.method === 'POST') {
          joined = true;
          return reply.promise;
        }
        if (path === '/api/join/deadbeef')
          return json({
            data: { _id: otherGroupId, name: 'Shared Home', category: 'home', memberCount: 1 },
            status: 200,
          });
        if (path === `/api/groups/${otherGroupId}` && joined)
          return json({ data: group(sam, otherGroupId), status: 200 });
      },
    });
    await controller.signIn('sam');
    await controller.openInvitation('http://localhost:4127/join/deadbeef');
    const join = controller.joinInvitation();
    await controller.back();
    await controller.cancelInvitation();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'invite',
      invitation: { code: 'deadbeef', status: 'joining' },
    });
    reply.resolve(json({ data: { groupId: otherGroupId }, status: 201 }, 201));
    await join;
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      detail: { status: 'ready', data: { id: otherGroupId, name: 'Shared Home' } },
      invitation: { code: null, status: 'idle' },
    });
  });

  it('keeps a newer invitation open when a joined Group list finishes loading', async () => {
    const groupsReply = deferred<FetchResponse>();
    const groupsRequested = deferred<void>();
    let joined = false;
    const { controller } = setup({
      intercept: (path, init) => {
        if (path === '/api/join/deadbeef' && init.method === 'POST') {
          joined = true;
          return json({ data: { groupId }, status: 201 }, 201);
        }
        if (path === '/api/groups' && joined) {
          groupsRequested.resolve();
          return groupsReply.promise;
        }
        if (path.startsWith('/api/join/'))
          return json({
            data: {
              _id: otherGroupId,
              name: path.endsWith('cafebabe') ? 'New invitation' : 'First invitation',
              category: 'home',
              memberCount: 1,
            },
            status: 200,
          });
      },
    });
    await controller.signIn('alex');
    await controller.openInvitation('http://localhost:4127/join/deadbeef');
    const firstJoin = controller.joinInvitation();
    await groupsRequested.promise;
    await controller.openInvitation('http://localhost:4127/join/cafebabe');
    groupsReply.resolve(json({ data: [group()], status: 200 }));
    await firstJoin;
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'invite',
      invitation: { code: 'cafebabe', preview: { name: 'New invitation' } },
    });
  });

  it('restores an unfinished Group form only to the same account after session expiry', async () => {
    let expired = false;
    const { controller } = setup({
      intercept: (path) => (path === '/api/auth/get-session' && expired ? json(null) : undefined),
    });
    await controller.signIn('alex');
    controller.startCreate();
    controller.updateCreation({ name: 'Keep my form' });
    expired = true;
    await controller.refresh();
    expect(controller.getSnapshot().auth.status).toBe('signed-out');
    expect(controller.getSnapshot().creation.draft.name).toBe('');
    expired = false;
    await controller.signIn('alex');
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'create',
      creation: { draft: { name: 'Keep my form' } },
    });
    expired = true;
    await controller.refresh();
    expired = false;
    await controller.signIn('sam');
    expect(controller.getSnapshot().creation.draft.name).toBe('');
  });

  it('revalidates the session on foreground without leaving an unfinished Group form', async () => {
    const { controller } = setup();
    await controller.signIn('alex');
    controller.startCreate();
    controller.updateCreation({ name: 'Still writing', description: 'Unfinished' });
    await controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'create',
      creation: { draft: { name: 'Still writing', description: 'Unfinished' } },
    });
  });

  it('checks the current link after a lost generation response without rotating it twice', async () => {
    let generations = 0;
    const { controller } = setup({
      intercept: (path, init) => {
        if (path !== `/api/groups/${groupId}/invite-link`) return;
        if (init.method === 'POST') {
          generations += 1;
          throw new Error('Response lost');
        }
        return json({
          data: generations
            ? {
                inviteCode: 'deadbeef',
                inviteUrl: 'http://localhost:4127/join/deadbeef',
                expiresAt: '2030-01-01T00:00:00.000Z',
              }
            : { inviteCode: null, inviteUrl: null, expiresAt: null },
          status: 200,
        });
      },
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    expect(await controller.loadInviteLink()).toBe('http://localhost:4127/join/deadbeef');
    expect(generations).toBe(1);
  });

  it('reuses the current authorized invite link without rotating it', async () => {
    let rotated = false;
    const { controller } = setup({
      intercept: (path, init) => {
        if (path !== `/api/groups/${groupId}/invite-link`) return;
        if (init.method === 'POST') rotated = true;
        return json({
          data: {
            inviteCode: 'deadbeef',
            inviteUrl: 'http://localhost:4127/join/deadbeef',
            expiresAt: '2030-01-01T00:00:00.000Z',
          },
          status: 200,
        });
      },
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    expect(await controller.loadInviteLink()).toBe('http://localhost:4127/join/deadbeef');
    expect(rotated).toBe(false);
    expect(controller.getSnapshot().share).toMatchObject({ status: 'ready' });
  });

  it('clears a pending invitation on explicit sign-out, including after restart', async () => {
    const pending = memoryCredentials();
    const intercept = (path: string) =>
      path === '/api/join/deadbeef'
        ? json({
            data: { _id: otherGroupId, name: 'Maple Flat', category: 'home', memberCount: 1 },
            status: 200,
          })
        : undefined;
    const first = setup({ pending: pending.credentials, intercept }).controller;
    await first.signIn('alex');
    await first.openInvitation('http://localhost:4127/join/deadbeef');
    await first.signOut();
    const second = setup({ pending: pending.credentials, intercept }).controller;
    await second.restore();
    expect(second.getSnapshot()).toMatchObject({
      screen: 'groups',
      invitation: { code: null, preview: null },
    });
  });

  it('restores a pending invitation after process restart before signing in', async () => {
    const pending = memoryCredentials();
    const intercept = (path: string) =>
      path === '/api/join/deadbeef'
        ? json({
            data: { _id: otherGroupId, name: 'Maple Flat', category: 'home', memberCount: 1 },
            status: 200,
          })
        : undefined;
    const first = setup({ pending: pending.credentials, intercept }).controller;
    await first.restore();
    await first.openInvitation('http://localhost:4127/join/deadbeef');
    first.dispose();
    const second = setup({ pending: pending.credentials, intercept }).controller;
    await second.restore();
    expect(second.getSnapshot()).toMatchObject({
      screen: 'invite',
      auth: { status: 'signed-out' },
      invitation: { status: 'ready', preview: { name: 'Maple Flat' } },
    });
  });

  it('keeps the invitation through sign-in and joins only after an explicit action', async () => {
    let joined = false;
    const { controller } = setup({
      intercept: (path, init) => {
        if (path === '/api/join/deadbeef') {
          if (init.method === 'POST') {
            joined = true;
            return json(
              { data: { groupId: otherGroupId, message: 'Joined group' }, status: 201 },
              201,
            );
          }
          return json({
            data: { _id: otherGroupId, name: 'Maple Flat', category: 'home', memberCount: 1 },
            status: 200,
          });
        }
        if (path === `/api/groups/${otherGroupId}` && joined)
          return json({ data: group(sam, otherGroupId), status: 200 });
      },
    });
    await controller.restore();
    await controller.openInvitation('http://localhost:4127/join/deadbeef');
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'invite',
      invitation: { status: 'ready', preview: { name: 'Maple Flat', memberCount: 1 } },
    });
    await controller.signIn('sam');
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'invite',
      auth: { user: sam },
      invitation: { status: 'ready' },
    });
    expect(joined).toBe(false);
    await controller.joinInvitation();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      detail: { status: 'ready', data: { id: otherGroupId } },
    });
  });

  it('reconciles a lost create response through Group reads and blocks another create until review', async () => {
    const saved: ReturnType<typeof group>[] = [];
    const { controller } = setup({
      intercept: (path, init) => {
        if (path !== '/api/groups') return;
        if (init.method === 'POST') {
          saved.push({ ...group(alex, otherGroupId), name: 'Cabin Weekend' });
          throw new Error('Response lost after commit');
        }
        return json({ data: saved, status: 200 });
      },
    });
    await controller.signIn('alex');
    controller.startCreate();
    controller.updateCreation({ name: 'Cabin Weekend' });
    await controller.createGroup();
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'groups',
      creation: { status: 'uncertain', draft: { name: 'Cabin Weekend' } },
      groups: { status: 'ready', data: [{ name: 'Cabin Weekend' }] },
    });
    await controller.createGroup();
    await controller.refresh();
    expect(controller.getSnapshot().groups.data).toHaveLength(1);
  });

  /** A keyed server: a repeated key returns the Group it already created. */
  function keyedGroupServer() {
    const created = new Map<string, ReturnType<typeof group>>();
    const posts: { key: string | null; body: string }[] = [];
    let loseNext = false;
    let hangNext = false;
    let refusing = false;
    return {
      created,
      posts,
      loseNextResponse: () => {
        loseNext = true;
      },
      /** The app is killed while saving: the server commits and the reply never arrives. */
      neverAnswerNext: () => {
        hangNext = true;
      },
      /** A deploy tightens validation, which runs before the replay check, as on the server. */
      refuseEverything: () => {
        refusing = true;
      },
      intercept: (path: string, init: RequestInit) => {
        // A Group it created reads back like any other.
        const read = [...created.values()].find(({ _id }) => path === `/api/groups/${_id}`);
        if (read) return json({ data: read, status: 200 });
        if (path !== '/api/groups') return;
        if (init.method !== 'POST') return json({ data: [...created.values()], status: 200 });
        const key = new Headers(init.headers).get('Idempotency-Key');
        const body = String(init.body);
        posts.push({ key, body });
        if (refusing)
          return json({ error: 'Validation error', code: 'VALIDATION_ERROR', status: 422 }, 422);
        if (!key) return json({ error: 'Key required' }, 422);
        const stored = created.get(key) ?? {
          ...group(alex, `a0000000000000000000002${created.size}`),
          name: JSON.parse(body).name,
        };
        created.set(key, stored);
        if (hangNext) {
          hangNext = false;
          return new Promise<FetchResponse>(() => undefined);
        }
        if (loseNext) {
          loseNext = false;
          throw new Error('Response lost after commit');
        }
        return json({ data: stored, status: 201 }, 201);
      },
    };
  }

  it('retries unchanged Group details with the same key, so a lost response creates one Group', async () => {
    const server = keyedGroupServer();
    const { controller } = setup({ intercept: server.intercept });
    await controller.signIn('alex');
    controller.startCreate();
    controller.updateCreation({ name: 'Cabin Weekend' });
    server.loseNextResponse();
    await controller.createGroup();
    expect(controller.getSnapshot().creation).toMatchObject({ status: 'uncertain' });
    const createdId = [...server.created.values()][0]._id;
    const listed = () => controller.getSnapshot().groups.data.map((item) => item.id);
    // The Groups read after the lost response already lists the committed Group.
    expect(listed()).toEqual([createdId]);

    // The member reviews their Groups, returns to the form and explicitly retries.
    controller.resumeCreationAfterCheck();
    await controller.createGroup();

    expect(server.posts).toHaveLength(2);
    expect(server.posts[1]).toEqual(server.posts[0]);
    expect(server.posts[0].key).toBe('native-group-key-1');
    expect(server.created.size).toBe(1);
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      detail: { status: 'ready', data: { id: createdId, name: 'Cabin Weekend' } },
      creation: { status: 'editing', attempt: null, draft: { name: '' } },
    });
    // The replayed Group replaces its listed entry rather than adding a second card.
    expect(listed()).toEqual([createdId]);
    await controller.back();
    expect(controller.getSnapshot().screen).toBe('groups');
    expect(listed()).toEqual([createdId]);
  });

  it('keeps the key when the server refuses a retry, and sends nothing new before the Groups are checked', async () => {
    const server = keyedGroupServer();
    const { controller } = setup({ intercept: server.intercept });
    await controller.signIn('alex');
    controller.startCreate();
    controller.updateCreation({ name: 'Cabin Weekend' });
    server.loseNextResponse();
    await controller.createGroup();
    // Until the member checks their Groups, neither a resubmit nor an edit goes out.
    await controller.createGroup();
    controller.updateCreation({ name: 'Lake Weekend' });
    await controller.createGroup();
    expect(server.posts).toHaveLength(1);

    controller.resumeCreationAfterCheck();
    server.refuseEverything();
    await controller.createGroup();
    expect(controller.getSnapshot().creation).toMatchObject({
      status: 'error',
      draft: { name: 'Cabin Weekend' },
    });
    // The refused retry keeps its key: unchanged details send the same submission again.
    await controller.createGroup();
    expect(server.posts).toHaveLength(3);
    expect(server.posts.every((post) => post.key === 'native-group-key-1')).toBe(true);
    expect(new Set(server.posts.map((post) => post.body)).size).toBe(1);
    expect(server.created.size).toBe(1);
  });

  it('gives changed Group details a new key after an uncertain create', async () => {
    const server = keyedGroupServer();
    const { controller } = setup({ intercept: server.intercept });
    await controller.signIn('alex');
    controller.startCreate();
    controller.updateCreation({ name: 'Cabin Weekend' });
    server.loseNextResponse();
    await controller.createGroup();
    controller.resumeCreationAfterCheck();
    controller.updateCreation({ name: 'Lake Weekend' });
    await controller.createGroup();

    expect(server.posts.map((post) => post.key)).toEqual([
      'native-group-key-1',
      'native-group-key-2',
    ]);
    expect(JSON.parse(server.posts[1].body)).toMatchObject({ name: 'Lake Weekend' });
  });

  describe('a Group being created, across an app restart', () => {
    /** Two controllers over one device and one keyed server: the second is the restarted app. */
    function restartable() {
      const server = keyedGroupServer();
      const device = memoryDevice();
      const credentials = memoryCredentials();
      let keys = 0;
      // At each POST: what this device holds for Alex's Group submission.
      const storedAtPost: unknown[] = [];
      const options = {
        store: credentials,
        device,
        newSubmissionKey: () => `native-group-key-${++keys}`,
        intercept: (path: string, init: RequestInit) => {
          if (path === '/api/groups' && init.method === 'POST')
            storedAtPost.push(structuredClone(device.records.get(alex.id) ?? null));
          return server.intercept(path, init);
        },
      };
      return { server, device, storedAtPost, app: () => setup(options).controller };
    }
    const startCabinWeekend = async (
      { server, app }: ReturnType<typeof restartable>,
      reply: 'never answered' | 'failed',
    ) => {
      const first = app();
      await first.signIn('alex');
      first.startCreate();
      first.updateCreation({ name: 'Cabin Weekend', description: 'Fictional cabin trip' });
      if (reply === 'never answered') {
        server.neverAnswerNext();
        void first.createGroup();
        await vi.waitFor(() => expect(server.posts).toHaveLength(1));
      } else {
        server.loseNextResponse();
        await first.createGroup();
        expect(first.getSnapshot().creation.status).toBe('uncertain');
      }
      first.dispose();
    };

    it.each(['never answered', 'failed'] as const)(
      'reopens a submission whose reply was %s as uncertain, and a resubmit reuses its key',
      async (reply) => {
        const run = restartable();
        await startCabinWeekend(run, reply);

        const restarted = run.app();
        await restarted.restore();
        expect(restarted.getSnapshot().creation).toMatchObject({
          status: 'uncertain',
          draft: { name: 'Cabin Weekend', description: 'Fictional cabin trip' },
        });
        // Restoring sends nothing, and neither do edits or Create until Alex checks his Groups.
        restarted.updateCreation({ name: 'Lake Weekend' });
        await restarted.createGroup();
        await restarted.refresh();
        expect(run.server.posts).toHaveLength(1);

        restarted.resumeCreationAfterCheck();
        await restarted.createGroup();
        expect(run.server.posts.map((post) => post.key)).toEqual([
          'native-group-key-1',
          'native-group-key-1',
        ]);
        expect(run.server.posts[1].body).toBe(run.server.posts[0].body);
        expect(run.server.created.size).toBe(1);
        expect(restarted.getSnapshot()).toMatchObject({
          screen: 'group',
          detail: { data: { name: 'Cabin Weekend' } },
          creation: { status: 'editing', draft: { name: '' } },
        });
        // A confirmed create removes it from the device.
        expect(run.device.records.size).toBe(0);
      },
    );

    it('stores the submission before its POST, and replaces it before a POST of changed details', async () => {
      const run = restartable();
      await startCabinWeekend(run, 'failed');
      expect(run.storedAtPost).toEqual([
        {
          version: 1,
          accountId: alex.id,
          key: 'native-group-key-1',
          body: run.server.posts[0].body,
          draft: expect.objectContaining({ name: 'Cabin Weekend' }),
        },
      ]);

      const restarted = run.app();
      await restarted.restore();
      restarted.resumeCreationAfterCheck();
      restarted.updateCreation({ name: 'Lake Weekend' });
      await restarted.createGroup();
      expect(run.server.posts.map((post) => post.key)).toEqual([
        'native-group-key-1',
        'native-group-key-2',
      ]);
      expect(run.storedAtPost[1]).toMatchObject({
        key: 'native-group-key-2',
        body: run.server.posts[1].body,
        draft: { name: 'Lake Weekend' },
      });
      expect(run.device.records.size).toBe(0);
    });

    it('keeps it for the same account only: Sam signing in on the device removes it', async () => {
      const run = restartable();
      await startCabinWeekend(run, 'failed');
      const restarted = run.app();
      await restarted.restore();
      expect(restarted.getSnapshot().creation).toMatchObject({ status: 'uncertain' });

      await restarted.signIn('sam');
      expect(restarted.getSnapshot().creation).toMatchObject({
        status: 'editing',
        attempt: null,
        draft: { name: '' },
      });
      expect(run.device.records.size).toBe(0);
      await restarted.signIn('alex');
      expect(restarted.getSnapshot().creation).toMatchObject({
        status: 'editing',
        draft: { name: '' },
      });
      expect(run.server.posts).toHaveLength(1);
    });

    it('removes it on Discard and on sign-out', async () => {
      const discarding = restartable();
      await startCabinWeekend(discarding, 'failed');
      const restarted = discarding.app();
      await restarted.restore();
      expect(discarding.device.records.size).toBe(1);
      await restarted.discardCreation();
      expect(discarding.device.records.size).toBe(0);
      expect(restarted.getSnapshot().creation).toMatchObject({
        status: 'editing',
        draft: { name: '' },
      });
      const reopened = discarding.app();
      await reopened.restore();
      expect(reopened.getSnapshot().creation).toMatchObject({
        status: 'editing',
        draft: { name: '' },
      });

      const signingOut = restartable();
      await startCabinWeekend(signingOut, 'failed');
      const signedIn = signingOut.app();
      await signedIn.restore();
      expect(signingOut.device.records.size).toBe(1);
      await signedIn.signOut();
      expect(signingOut.device.records.size).toBe(0);
      expect(discarding.server.posts).toHaveLength(1);
      expect(signingOut.server.posts).toHaveLength(1);
    });

    it('opens a confirmed Group even when this device can’t remove its stored submission', async () => {
      const run = restartable();
      const first = run.app();
      await first.signIn('alex');
      first.startCreate();
      first.updateCreation({ name: 'Cabin Weekend' });
      run.device.fail('remove');
      await first.createGroup();
      expect(first.getSnapshot()).toMatchObject({
        screen: 'group',
        detail: { status: 'ready', data: { name: 'Cabin Weekend' } },
        creation: { status: 'editing', attempt: null, draft: { name: '' } },
      });
      expect(run.server.posts).toHaveLength(1);
      // The stale copy stays on the device until a later remove succeeds.
      expect(run.device.records.size).toBe(1);

      // A restart shows it as uncertain; resubmitting it returns the same Group and clears it.
      run.device.fail(null);
      first.dispose();
      const restarted = run.app();
      await restarted.restore();
      expect(restarted.getSnapshot().creation).toMatchObject({
        status: 'uncertain',
        draft: { name: 'Cabin Weekend' },
      });
      restarted.resumeCreationAfterCheck();
      await restarted.createGroup();
      expect(run.server.posts.map((post) => post.key)).toEqual([
        'native-group-key-1',
        'native-group-key-1',
      ]);
      expect(run.server.created.size).toBe(1);
      expect(run.device.records.size).toBe(0);
    });

    it('says a stored submission it can’t read must be discarded, and sends nothing until then', async () => {
      const run = restartable();
      const controller = run.app();
      await controller.signIn('alex');
      // A record this version can't read, such as one cut short on disk.
      run.device.records.set(alex.id, { version: 1, accountId: alex.id, key: 'not a key' });
      controller.startCreate();
      controller.updateCreation({ name: 'Cabin Weekend' });
      await controller.createGroup();
      expect(run.server.posts).toHaveLength(0);
      expect(controller.getSnapshot().creation).toMatchObject({
        status: 'editing',
        draft: { name: 'Cabin Weekend' },
        message:
          'A saved Group submission on this device can’t be read, so nothing was sent. Discard this form to continue.',
      });

      await controller.discardCreation();
      expect(run.device.records.size).toBe(0);
      controller.startCreate();
      controller.updateCreation({ name: 'Cabin Weekend' });
      await controller.createGroup();
      expect(run.server.posts).toHaveLength(1);
      expect(run.server.created.size).toBe(1);
    });

    it('shows a stored submission the form missed instead of sending over it', async () => {
      const run = restartable();
      await startCabinWeekend(run, 'failed');
      // The restarted app can't read the device at first, so its form starts empty.
      run.device.fail('load');
      const restarted = run.app();
      await restarted.restore();
      run.device.fail(null);
      restarted.startCreate();
      restarted.updateCreation({ name: 'Cabin Weekend', description: 'Fictional cabin trip' });
      await restarted.createGroup();
      expect(run.server.posts).toHaveLength(1);
      expect(restarted.getSnapshot().creation).toMatchObject({
        status: 'uncertain',
        draft: { name: 'Cabin Weekend' },
      });
      restarted.resumeCreationAfterCheck();
      await restarted.createGroup();
      expect(run.server.posts.map((post) => post.key)).toEqual([
        'native-group-key-1',
        'native-group-key-1',
      ]);
      expect(run.server.created.size).toBe(1);
    });
  });

  it.each(['no device store', 'a device store whose write fails'] as const)(
    'sends nothing when the submission can’t be stored first (%s)',
    async (failure) => {
      const server = keyedGroupServer();
      const device = memoryDevice({ store: failure === 'no device store' });
      const { controller } = setup({ intercept: server.intercept, device });
      await controller.signIn('alex');
      controller.startCreate();
      controller.updateCreation({ name: 'Cabin Weekend', description: 'Fictional cabin trip' });
      device.fail('save');
      await controller.createGroup();
      await controller.createGroup();

      expect(server.posts).toHaveLength(0);
      expect(controller.getSnapshot().creation).toMatchObject({
        status: 'editing',
        draft: { name: 'Cabin Weekend', description: 'Fictional cabin trip' },
      });
      expect(controller.getSnapshot().creation.message).toContain('nothing was sent');
      controller.updateCreation({ name: 'Cabin Weekend 2' });
      expect(controller.getSnapshot().creation.draft.name).toBe('Cabin Weekend 2');
    },
  );

  it('sends nothing when a Group submission key cannot be created', async () => {
    const server = keyedGroupServer();
    const { controller } = setup({ intercept: server.intercept, newSubmissionKey: null });
    await controller.signIn('alex');
    controller.startCreate();
    controller.updateCreation({ name: 'Cabin Weekend' });
    await controller.createGroup();

    expect(server.posts).toHaveLength(0);
    expect(controller.getSnapshot().creation).toMatchObject({
      status: 'error',
      draft: { name: 'Cabin Weekend' },
      message: 'Could not prepare this Group for sending. Nothing was sent. Try again.',
    });
  });

  it('keeps invalid Group input editable without posting it', async () => {
    let posted = false;
    const { controller } = setup({
      intercept: (path, init) => {
        if (path === '/api/groups' && init.method === 'POST') posted = true;
        return undefined;
      },
    });
    await controller.signIn('alex');
    controller.startCreate();
    controller.updateCreation({ name: '   ', description: 'Keep this description' });
    await controller.createGroup();
    expect(controller.getSnapshot().creation).toMatchObject({
      status: 'editing',
      draft: { description: 'Keep this description' },
      message: 'Add a name for this trip, such as Goa Weekend.',
      validation: {
        errors: { name: 'Add a name for this trip, such as Goa Weekend.' },
        focus: { field: 'name', request: 1 },
      },
    });
    expect(posted).toBe(false);
  });

  it('creates a Household through the authenticated API and opens the persisted Group', async () => {
    const created = {
      ...group(alex, otherGroupId),
      name: 'Maple Flat',
      category: 'home',
      defaultCurrency: 'EUR',
      startDate: null,
      endDate: null,
    };
    let submitted: unknown;
    const { controller } = setup({
      intercept: (path, init) => {
        if (path === '/api/groups' && init.method === 'POST') {
          submitted = JSON.parse(String(init.body));
          return json({ data: created, status: 201 }, 201);
        }
        if (path === `/api/groups/${otherGroupId}`) return json({ data: created, status: 200 });
      },
    });
    await controller.signIn('alex');
    controller.startCreate();
    controller.updateCreation({
      name: ' Maple Flat ',
      category: 'home',
      defaultCurrency: 'EUR',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
    await controller.createGroup();
    expect(submitted).toMatchObject({
      name: 'Maple Flat',
      category: 'home',
      defaultCurrency: 'EUR',
      startDate: null,
      endDate: null,
    });
    expect(controller.getSnapshot()).toMatchObject({
      screen: 'group',
      detail: {
        status: 'ready',
        data: {
          id: otherGroupId,
          name: 'Maple Flat',
          category: 'home',
          defaultCurrency: 'EUR',
          members: [{ user: alex, role: 'admin' }],
        },
      },
    });
  });

  it('signs in through a signed cookie, verifies the session, and normalizes real Group JSON', async () => {
    const { controller, fetch, store } = setup();
    await controller.signIn('alex');
    const state = controller.getSnapshot();
    expect(state.auth).toMatchObject({ status: 'authenticated', user: alex });
    expect(state.groups.status).toBe('ready');
    expect(state.groups.data[0]).toMatchObject({
      id: groupId,
      members: [{ user: alex }],
      startDate: new Date(iso),
      createdAt: new Date(iso),
    });
    expect(decodeStoredSession(store.read()!, false)).toEqual({
      cookie: alexCookie,
      accountId: alex.id,
    });
    expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      '/api/auth/demo-persona/sign-in',
      '/api/auth/get-session',
      '/api/groups',
      '/api/user/balances',
    ]);
    const request = fetch.mock.calls[2][1];
    expect(new Headers(request.headers).get('Cookie')).toBe(alexCookie);
    expect(new Headers(request.headers).get('Origin')).toBe('http://localhost:4127');
    expect(request.credentials).toBe('omit');
    expect(request.redirect).toBe('error');
  });

  it('normalizes a legacy General list without optional fields and rejects malformed full Group fields', async () => {
    const legacy = {
      ...group(),
      category: undefined,
      description: undefined,
      startDate: undefined,
      endDate: undefined,
    };
    let payload: unknown[] = [legacy];
    const { controller } = setup({
      intercept: (path) =>
        path === '/api/groups' ? json({ data: payload, status: 200 }) : undefined,
    });
    await controller.signIn('alex');
    expect(controller.getSnapshot().groups.status).toBe('ready');
    expect(controller.getSnapshot().groups.data[0]).toMatchObject({
      category: 'other',
      description: '',
      startDate: null,
      endDate: null,
    });
    payload = [{ ...group(), tags: [{ _id: 'invalid', name: 'Broken' }] }];
    await controller.refresh();
    expect(controller.getSnapshot().groups.status).toBe('error');
    expect(controller.getSnapshot().groups.data[0].category).toBe('other');
  });

  it('retains the verified list after an invalid refresh and replaces it only after a successful Retry', async () => {
    let invalid = false;
    const { controller } = setup({
      intercept: (path) =>
        invalid && path === '/api/groups'
          ? json({
              data: [group(), { ...group(alex, otherGroupId), defaultCurrency: 'UNKNOWN' }],
              status: 200,
            })
          : undefined,
    });
    await controller.signIn('alex');
    const verified = controller.getSnapshot().groups.data;
    invalid = true;
    await controller.refresh();
    expect(controller.getSnapshot().groups).toMatchObject({ status: 'error', data: verified });
    expect(controller.getSnapshot().groups.message).toBeTruthy();
    invalid = false;
    await controller.refresh();
    expect(controller.getSnapshot().groups).toEqual({
      status: 'ready',
      data: verified,
      message: null,
      loaded: true,
    });
    await controller.signOut();
    expect(controller.getSnapshot().groups.data).toEqual([]);
  });

  it('restores only after server validation and shows a ready empty list distinctly', async () => {
    const { controller, fetch } = setup({
      saved: alexCookie,
      intercept: (path) => (path === '/api/groups' ? json({ data: [], status: 200 }) : undefined),
    });
    await controller.restore();
    expect(controller.getSnapshot().auth.status).toBe('authenticated');
    // Read and empty, which is not the same as never read.
    expect(controller.getSnapshot().groups).toEqual({
      status: 'ready',
      data: [],
      message: null,
      loaded: true,
    });
    expect(fetch.mock.calls[0][0]).toContain('/api/auth/get-session');
  });

  it('expires a saved session when the server returns null, without fetching Groups', async () => {
    const { controller, fetch, store } = setup({
      saved: alexCookie,
      intercept: (path) => (path === '/api/auth/get-session' ? json(null) : undefined),
    });
    await controller.restore();
    expect(controller.getSnapshot().auth).toMatchObject({
      status: 'signed-out',
      user: null,
      message: expect.stringContaining('expired'),
    });
    expect(controller.getSnapshot().groups.data).toEqual([]);
    expect(store.read()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not authenticate a session whose server expiry is already past', async () => {
    const expired = {
      ...session(),
      session: { userId: alex.id, expiresAt: '2026-01-01T00:00:00.000Z' },
    };
    const { controller, store } = setup({
      saved: alexCookie,
      intercept: (path) => (path === '/api/auth/get-session' ? json(expired) : undefined),
    });
    await controller.restore();
    expect(controller.getSnapshot().auth.status).toBe('signed-out');
    expect(store.read()).toBeNull();
  });

  it('keeps a recoverable saved session on a network failure without showing old financial data', async () => {
    let offline = true;
    const { controller, store } = setup({
      saved: alexCookie,
      intercept: () => {
        if (offline) throw new Error('Network failure');
        return undefined;
      },
    });
    await controller.restore();
    expect(controller.getSnapshot().auth.status).toBe('error');
    expect(controller.getSnapshot().groups.data).toEqual([]);
    expect(store.read()).toBe(alexCookie);
    offline = false;
    await controller.refresh();
    expect(controller.getSnapshot().auth.status).toBe('authenticated');
  });

  it('retains the requested verified Group on malformed detail refresh and recovers with Retry', async () => {
    let invalid = false;
    const { controller } = setup({
      intercept: (path) =>
        invalid && path === `/api/groups/${groupId}`
          ? json({ data: { ...group(), tags: [{ _id: 'invalid', name: 'Broken' }] }, status: 200 })
          : undefined,
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    const verified = controller.getSnapshot().detail.data;
    expect(verified?.id).toBe(groupId);
    invalid = true;
    await controller.refresh();
    expect(controller.getSnapshot().detail).toMatchObject({ status: 'error', data: verified });
    invalid = false;
    await controller.refresh();
    expect(controller.getSnapshot().detail).toMatchObject({
      status: 'ready',
      data: verified,
      message: null,
    });
    await controller.openGroup(otherGroupId);
    expect(controller.getSnapshot().detail.data).toBeNull();
  });

  it('removes both detail and its Group card when access is revoked on refresh', async () => {
    let forbidden = false;
    const { controller } = setup({
      intercept: (path) =>
        forbidden && path === `/api/groups/${groupId}` ? json({}, 403) : undefined,
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    expect(controller.getSnapshot().detail.data?.id).toBe(groupId);
    forbidden = true;
    await controller.refresh();
    expect(controller.getSnapshot().detail).toMatchObject({ status: 'denied', data: null });
    expect(controller.getSnapshot().groups.data).toEqual([]);
    controller.back();
    expect(controller.getSnapshot().detail.data).toBeNull();
  });

  it('treats a detail response without the signed-in member as denied and drops the card', async () => {
    const { controller } = setup({
      intercept: (path) =>
        path === `/api/groups/${groupId}` ? json({ data: group(sam), status: 200 }) : undefined,
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    expect(controller.getSnapshot().detail.status).toBe('denied');
    expect(controller.getSnapshot().groups.data).toEqual([]);
  });

  it('purges the session and all Group state after an authenticated API returns 401', async () => {
    const { controller, store } = setup({
      intercept: (path) => (path === `/api/groups/${groupId}` ? json({}, 401) : undefined),
    });
    await controller.signIn('alex');
    await controller.openGroup(groupId);
    expect(controller.getSnapshot().auth.status).toBe('signed-out');
    expect(controller.getSnapshot().groups.data).toEqual([]);
    expect(controller.getSnapshot().detail.data).toBeNull();
    expect(store.read()).toBeNull();
  });

  it('ignores Group data and cookie rotation arriving after logout, even if transport ignores abort', async () => {
    const response = deferred<FetchResponse>();
    const entered = deferred<void>();
    let delay = false;
    const { controller, store } = setup({
      intercept: (path) => {
        if (delay && path === '/api/groups') {
          entered.resolve();
          return response.promise;
        }
        return undefined;
      },
    });
    await controller.signIn('alex');
    delay = true;
    const refresh = controller.refresh();
    await entered.promise;
    await controller.signOut();
    response.resolve(
      json({ data: [group()], status: 200 }, 200, 'better-auth.session_token=late-rotation'),
    );
    await refresh;
    expect(controller.getSnapshot().auth.status).toBe('signed-out');
    expect(controller.getSnapshot().groups.data).toEqual([]);
    expect(store.read()).toBeNull();
  });

  it('never applies a previous account response over a newly signed-in account', async () => {
    const response = deferred<FetchResponse>();
    const entered = deferred<void>();
    let delay = false;
    const { controller, store } = setup({
      intercept: (path, init) => {
        if (
          delay &&
          path === '/api/groups' &&
          new Headers(init.headers).get('Cookie') === alexCookie
        ) {
          entered.resolve();
          return response.promise;
        }
        return undefined;
      },
    });
    await controller.signIn('alex');
    delay = true;
    const oldRequest = controller.refresh();
    await entered.promise;
    await controller.signIn('sam');
    response.resolve(json({ data: [group()], status: 200 }));
    await oldRequest;
    expect(controller.getSnapshot().auth.user?.id).toBe(sam.id);
    expect(controller.getSnapshot().groups.data[0].name).toBe('Shared Home');
    expect(decodeStoredSession(store.read()!, false)).toEqual({
      cookie: samCookie,
      accountId: sam.id,
    });
  });

  it('never applies a previous account’s Groups list that lands while a Group is open (#190)', async () => {
    const response = deferred<FetchResponse>();
    const entered = deferred<void>();
    let delay = false;
    const { controller, store } = setup({
      intercept: (path, init) => {
        if (
          delay &&
          path === '/api/groups' &&
          new Headers(init.headers).get('Cookie') === alexCookie
        ) {
          entered.resolve();
          return response.promise;
        }
        return undefined;
      },
    });
    await controller.signIn('alex');
    delay = true;
    const pulling = controller.refresh('pull');
    await entered.promise;
    await controller.openGroup(groupId);
    expect(controller.getSnapshot().screen).toBe('group');
    await controller.signIn('sam');
    const published: string[][] = [];
    controller.subscribe(() =>
      published.push(controller.getSnapshot().groups.data.map((item) => item.name)),
    );
    response.resolve(json({ data: [group()], status: 200 }));
    await pulling;
    expect(controller.getSnapshot()).toMatchObject({
      auth: { user: { id: sam.id } },
      groups: { status: 'ready', data: [{ name: 'Shared Home' }] },
    });
    expect(published.flat()).not.toContain('Weekend Away');
    expect(decodeStoredSession(store.read()!, false)).toEqual({
      cookie: samCookie,
      accountId: sam.id,
    });
  });

  it('serializes a credential save already in flight before logout clears storage', async () => {
    const store = memoryCredentials();
    const originalSave = store.credentials.save;
    const entered = deferred<void>();
    const release = deferred<void>();
    store.credentials.save = async (cookie) => {
      entered.resolve();
      await release.promise;
      await originalSave(cookie);
    };
    const { controller } = setup({ store });
    const signIn = controller.signIn('alex');
    await entered.promise;
    const logout = controller.signOut();
    release.resolve();
    await Promise.all([signIn, logout]);
    expect(store.read()).toBeNull();
    expect(controller.getSnapshot().auth.status).toBe('signed-out');
    expect(controller.getSnapshot().groups.data).toEqual([]);
  });

  it('fails closed and clears the old saved session when a rotated cookie cannot be persisted', async () => {
    const store = memoryCredentials(alexCookie);
    store.credentials.save = async () => {
      throw new Error('SecureStore unavailable');
    };
    const { controller, fetch } = setup({
      store,
      intercept: (path) =>
        path === '/api/auth/get-session'
          ? json(session(), 200, 'better-auth.session_token=new-signature')
          : undefined,
    });
    await controller.restore();
    expect(controller.getSnapshot().auth.status).toBe('error');
    expect(controller.getSnapshot().auth.user).toBeNull();
    expect(store.read()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('honors explicit cookie expiry even if its response contains a user', async () => {
    const { controller, store } = setup({
      saved: alexCookie,
      intercept: (path) =>
        path === '/api/auth/get-session'
          ? json(session(), 200, 'better-auth.session_token=; Max-Age=0')
          : undefined,
    });
    await controller.restore();
    expect(controller.getSnapshot().auth.status).toBe('signed-out');
    expect(store.read()).toBeNull();
  });

  it('does not use a raw token when native transport cannot expose a signed cookie', async () => {
    const { controller, fetch, store } = setup({
      intercept: (path) =>
        path === '/api/auth/demo-persona/sign-in'
          ? json({ token: 'raw-token', user: alex })
          : undefined,
    });
    await controller.signIn('alex');
    expect(controller.getSnapshot().auth.status).toBe('signed-out');
    expect(store.read()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('gates both persona entry and restoration when development access is disabled', async () => {
    const { controller, fetch, store } = setup({ enabled: false, saved: alexCookie });
    await controller.restore();
    await controller.signIn('alex');
    expect(fetch).not.toHaveBeenCalled();
    expect(controller.getSnapshot().auth.status).toBe('signed-out');
    expect(store.read()).toBeNull();
  });

  it('does not restart authentication when the foreground refresh arrives during sign-in', async () => {
    const response = deferred<FetchResponse>();
    const entered = deferred<void>();
    const { controller, fetch } = setup({
      intercept: (path) => {
        if (path === '/api/auth/demo-persona/sign-in') {
          entered.resolve();
          return response.promise;
        }
        return undefined;
      },
    });
    const login = controller.signIn('alex');
    await entered.promise;
    await controller.refresh();
    expect(controller.getSnapshot().auth.status).toBe('signing-in');
    response.resolve(json({ user: alex }, 200, alexCookie));
    await login;
    expect(controller.getSnapshot().auth.status).toBe('authenticated');
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('keeps persona retry available after the server denies development sign-in', async () => {
    const { controller } = setup({
      intercept: (path) => (path === '/api/auth/demo-persona/sign-in' ? json({}, 403) : undefined),
    });
    await controller.signIn('alex');
    expect(controller.getSnapshot().auth).toMatchObject({
      status: 'signed-out',
      user: null,
      message: expect.stringContaining('denied'),
    });
  });

  it('rejects invalid and cross-account Group DTOs instead of showing plausible money labels', async () => {
    for (const data of [[{ ...group(), defaultCurrency: 'UNKNOWN' }], [group(sam)]]) {
      const { controller } = setup({
        intercept: (path) => (path === '/api/groups' ? json({ data, status: 200 }) : undefined),
      });
      await controller.signIn('alex');
      expect(controller.getSnapshot().groups.status).toBe('error');
      expect(controller.getSnapshot().groups.data).toEqual([]);
    }
  });

  it('keeps a late detail response from navigating forward after Back', async () => {
    const response = deferred<FetchResponse>();
    const { controller } = setup({
      intercept: (path) => (path === `/api/groups/${otherGroupId}` ? response.promise : undefined),
    });
    await controller.signIn('alex');
    const opening = controller.openGroup(otherGroupId);
    controller.back();
    response.resolve(json({ data: group(alex, otherGroupId), status: 200 }));
    await opening;
    expect(controller.getSnapshot().screen).toBe('groups');
    expect(controller.getSnapshot().detail.data).toBeNull();
  });

  it('clears local credentials even when remote sign-out fails', async () => {
    const { controller, store } = setup({
      intercept: (path) => (path === '/api/auth/sign-out' ? json({}, 503) : undefined),
    });
    await controller.signIn('alex');
    await controller.signOut();
    expect(controller.getSnapshot().auth).toMatchObject({
      status: 'signed-out',
      user: null,
      message: expect.stringContaining('could not confirm'),
    });
    expect(store.read()).toBeNull();
  });

  it('cannot restore a signed-out account when clearing its saved invitation fails', async () => {
    const pending = memoryCredentials('deadbeef');
    pending.credentials.clear = async () => {
      throw new Error('Invitation storage unavailable');
    };
    const { controller, store } = setup({ pending: pending.credentials });
    await controller.signIn('alex');
    await controller.signOut();

    // Retrying the session error must not bring the signed-out account back.
    await controller.restore();
    // Cleanup remains blocked until every local store can be cleared.
    expect(controller.getSnapshot().auth).toMatchObject({ status: 'error', user: null });
    expect(controller.getSnapshot().groups.data).toEqual([]);
    expect(store.read()).toBeNull();
  });
});
