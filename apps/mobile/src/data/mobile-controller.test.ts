import { describe, expect, it, vi } from 'vitest';
import { createMobileController } from './mobile-controller';
import type { CredentialStore, FetchResponse, MobileFetch } from './types';

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

function setup(
  options: {
    saved?: string;
    pending?: CredentialStore;
    enabled?: boolean;
    store?: ReturnType<typeof memoryCredentials>;
    intercept?: (
      path: string,
      init: RequestInit,
    ) => FetchResponse | Promise<FetchResponse> | undefined;
  } = {},
) {
  const store = options.store ?? memoryCredentials(options.saved);
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
    { fetch, credentials: store.credentials, pendingInvitation: options.pending, now: () => now },
  );
  return { controller, fetch, store };
}

describe('native session and Group boundary', () => {
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
      status: 'error',
      draft: { startDate: '2026-02-30' },
      message: 'Enter valid Trip dates as YYYY-MM-DD.',
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
      status: 'error',
      draft: { description: 'Keep this description' },
      message: 'Name is required',
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
    expect(store.read()).toBe(alexCookie);
    expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
      '/api/auth/demo-persona/sign-in',
      '/api/auth/get-session',
      '/api/groups',
    ]);
    const request = fetch.mock.calls[2][1];
    expect(new Headers(request.headers).get('Cookie')).toBe(alexCookie);
    expect(new Headers(request.headers).get('Origin')).toBe('http://localhost:4127');
    expect(request.credentials).toBe('omit');
    expect(request.redirect).toBe('error');
  });

  it('restores only after server validation and shows a ready empty list distinctly', async () => {
    const { controller, fetch } = setup({
      saved: alexCookie,
      intercept: (path) => (path === '/api/groups' ? json({ data: [], status: 200 }) : undefined),
    });
    await controller.restore();
    expect(controller.getSnapshot().auth.status).toBe('authenticated');
    expect(controller.getSnapshot().groups).toEqual({ status: 'ready', data: [], message: null });
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
    expect(store.read()).toBe(samCookie);
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
    expect(fetch).toHaveBeenCalledTimes(3);
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
});
