import { describe, expect, it, vi } from 'vitest';
import { createCheckedMobileController as createMobileController } from '../test-utils/flow-monitor';
import { savedQueriesIn } from '../test-utils/saved-queries';

// #622: Account → Connected assistants on Android. It reads the same connection list and
// Disconnect as the web, counts each assistant's Groups from the member's Groups, keeps a Saved
// copy for offline, and is shown only where the server has assistants switched on.

// Fictional people, Groups and assistants only.
const alex = { id: 'a00000000000000000000001', name: 'Alex', email: 'alex@example.test' };
const maple = 'b00000000000000000000001';
const lunch = 'b00000000000000000000002';
const connectionsPath = '/api/auth/mcp/connections';
const helper = {
  id: 'c1',
  clientId: 'https://helper.example.test/client.json',
  name: 'Fictional Helper',
  scopes: ['ledger:read', 'drafts:write'],
  access: 'Ledger + To review',
  lastUsedAt: '2026-10-20T09:30:00.000Z',
  excludedGroupIds: [lunch],
};
const reader = {
  id: 'c2',
  clientId: 'registered-reader',
  name: 'Fictional Reader',
  scopes: ['ledger:read'],
  access: 'Ledger',
  lastUsedAt: null,
  excludedGroupIds: [],
};

/** Alex's server, and this phone's stores, which survive a restart as SQLite and SecureStore do. */
function fixture() {
  const server = {
    offline: false,
    /** The server has assistants switched off: its connection list isn't there. */
    assistantsOff: false,
    /** The optional Group-count read fails while connections still answer. */
    failGroups: false,
    /** Split the server list into pages when a paging test asks for it. */
    pageSize: null as number | null,
    /** The next Disconnect fails on the server. */
    failRevoke: false,
    /** The next read of the connection list waits for this, answering with the list as it was asked. */
    holdNextRead: null as Promise<void> | null,
    /** Splitbook can't be reached once a Disconnect is answered. */
    offlineAfterRevoke: false,
    /** This phone can't remove saved copies. */
    failRemoval: false,
    connections: [helper, reader],
  };
  let cookie: string | null = null,
    owner: string | null = null,
    identity: unknown = null,
    cleanup = false;
  const cache = new Map<string, unknown>();
  const rows = savedQueriesIn(cache);
  const savedQueries = {
    ...rows,
    remove: async (account: string, path: string) => {
      if (server.failRemoval) throw new Error('The device storage is full');
      await rows.remove(account, path);
    },
  };
  type ConnectionState = { isConnected: boolean | null; isInternetReachable?: boolean | null };
  /** What NetInfo last reported, once a test has reported something. */
  let connectionState: ConnectionState | null = null;
  const connection = new Set<(state: ConnectionState) => void>();
  const untrusted = { current: null as unknown };
  const record = (value: { current: unknown }) => ({
    load: async () => structuredClone(value.current),
    save: async (next: unknown) => {
      value.current = structuredClone(next);
    },
    clear: async () => {
      value.current = null;
    },
  });
  const json = (body: unknown, status = 200) => Response.json(body, { status });
  /** Every request sent so far, as `METHOD /path`, with each POST's body. */
  const requests: string[] = [];
  const bodies: unknown[] = [];
  const respond = async (path: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    if (path.endsWith('/sign-in'))
      return new Response(JSON.stringify({ user: { ...alex, image: null } }), {
        headers: { 'Set-Cookie': 'better-auth.session_token=Alex.signature; Path=/' },
      });
    if (path.endsWith('/get-session'))
      return json({
        user: { ...alex, image: null },
        session: { userId: alex.id, expiresAt: '2030-01-01T00:00:00.000Z' },
      });
    if (path.endsWith('/sign-out')) return json({ success: true });
    if (path === '/api/groups') return json({ status: 200, data: [] });
    if (path === '/api/user/balances')
      return json({ status: 200, data: { buckets: [], groups: [] } });
    if (path === connectionsPath || path.startsWith(`${connectionsPath}?`)) {
      if (server.assistantsOff) return json({ message: 'Not found' }, 404);
      const connections = server.connections,
        hold = server.holdNextRead;
      server.holdNextRead = null;
      await hold;
      const offset = Number(new URL(path, 'http://localhost:4157').searchParams.get('offset') ?? 0);
      const end = server.pageSize === null ? connections.length : offset + server.pageSize;
      return json({
        resource: 'http://localhost:4157/api/mcp',
        connections: connections.slice(offset, end),
        nextOffset: end < connections.length ? end : null,
      });
    }
    if (path === '/api/user/assistant-groups') {
      if (server.failGroups) return json({ message: 'Something went wrong' }, 500);
      if (server.assistantsOff) return json({ error: 'Assistants not found', status: 404 }, 404);
      return json({
        status: 200,
        data: {
          groups: [
            { id: maple, name: 'Maple House', rule: 'allowed' },
            { id: lunch, name: 'Studio Lunch Club', rule: 'allowed' },
          ],
        },
      });
    }
    if (path === '/api/auth/mcp/revoke' && method === 'POST') {
      const { id } = JSON.parse(String(init.body)) as { id: string };
      bodies.push({ id });
      if (server.failRevoke) return json({ message: 'Something went wrong' }, 500);
      server.connections = server.connections.filter((connection) => connection.id !== id);
      if (server.offlineAfterRevoke) server.offline = true;
      return json({ disconnected: true });
    }
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
        netInfo: {
          // As NetInfo does, a new listener hears the connection as it is now.
          addEventListener: (listener) => {
            connection.add(listener);
            listener(connectionState ?? { isConnected: !server.offline });
            return () => connection.delete(listener);
          },
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
          untrustedCopies: record(untrusted),
          stores: [savedQueries, record(untrusted)],
        },
        fetch: async (url, init) => {
          const address = new URL(url);
          const path = address.pathname + address.search;
          requests.push(`${init.method ?? 'GET'} ${path}`);
          if (server.offline) throw new TypeError('Network request failed');
          return respond(path, init);
        },
      },
    );
  /** The assistants this phone keeps for Alex, by name, or null when it keeps none. */
  const savedAssistants = () => {
    const row = cache.get(alex.id + connectionsPath) as
      | { value: { connections: { connections: { name: string }[] } } }
      | undefined;
    return row ? row.value.connections.connections.map((connection) => connection.name) : null;
  };
  /** NetInfo reports the device's connection, and whether it reaches the internet. */
  const connect = (isConnected: boolean, isInternetReachable?: boolean | null) => {
    const state = { isConnected, isInternetReachable };
    server.offline = !isConnected || isInternetReachable === false;
    connectionState = state;
    connection.forEach((listener) => listener(state));
  };
  return { create, server, requests, bodies, savedAssistants, connect };
}
type Fixture = ReturnType<typeof fixture>;
type Controller = ReturnType<Fixture['create']>;

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/** Settings, then Connected assistants, read until nothing is loading. */
async function openAssistants(controller: Controller) {
  controller.openSettings();
  await vi.waitFor(() => expect(controller.getSnapshot().assistants.available).not.toBeNull());
  controller.openAssistants();
  await vi.waitFor(() => expect(controller.getSnapshot().assistants.status).not.toBe('loading'));
  return () => controller.getSnapshot().assistants;
}

/** Alex signs in and opens Connected assistants online; this phone saves what it read. */
async function readOnline(f: Fixture) {
  const controller = f.create();
  await controller.signIn('alex');
  const state = await openAssistants(controller);
  await vi.waitFor(() =>
    expect(f.savedAssistants()).toEqual(['Fictional Helper', 'Fictional Reader']),
  );
  return { controller, state };
}

/** The app is closed, the phone goes offline, and the app starts again. */
async function restartOffline(f: Fixture, controller: Controller) {
  controller.dispose();
  f.server.offline = true;
  const restarted = f.create();
  await restarted.restore();
  expect(restarted.getSnapshot()).toMatchObject({ offline: { active: true } });
  return restarted;
}

describe('Connected assistants on Android (#622)', () => {
  it('lists each assistant with its access, how many Groups it reaches and when it was last used', async () => {
    const f = fixture();
    const { controller, state } = await readOnline(f);
    expect(controller.getSnapshot().screen).toBe('assistants');
    expect(state()).toMatchObject({
      available: true,
      status: 'ready',
      saved: false,
      unsaved: false,
      assistants: [
        {
          id: 'c1',
          name: 'Fictional Helper',
          host: 'helper.example.test',
          access: 'Ledger + To review',
          groups: { reached: 1, of: 2 },
          lastUsedAt: '2026-10-20T09:30:00.000Z',
        },
        {
          id: 'c2',
          name: 'Fictional Reader',
          host: null,
          access: 'Ledger',
          groups: { reached: 2, of: 2 },
          lastUsedAt: null,
        },
      ],
    });
    // Back returns to Settings, where the screen was opened.
    controller.back();
    expect(controller.getSnapshot().screen).toBe('settings');
    controller.dispose();
  });

  it('isn’t offered where the server has assistants switched off', async () => {
    const f = fixture();
    f.server.assistantsOff = true;
    const controller = f.create();
    await controller.signIn('alex');
    controller.openSettings();
    await vi.waitFor(() => expect(controller.getSnapshot().assistants.available).toBe(false));
    controller.openAssistants();
    expect(controller.getSnapshot().screen).toBe('settings');
    controller.dispose();
  });

  it('keeps the old assistant list and Settings row gone after a 404 and offline restart (#775)', async () => {
    const f = fixture();
    const { controller, state } = await readOnline(f);
    f.server.assistantsOff = true;
    await controller.refresh('pull');
    expect(state()).toMatchObject({ available: false, assistants: null, status: 'ready' });

    const restarted = await restartOffline(f, controller);
    restarted.openSettings();
    await vi.waitFor(() => expect(restarted.getSnapshot().assistants.status).toBe('ready'));
    expect(restarted.getSnapshot().assistants).toMatchObject({
      assistants: null,
      saved: false,
      unsaved: true,
    });
    expect(restarted.getSnapshot().assistants.available).not.toBe(true);
    restarted.openAssistants();
    expect(restarted.getSnapshot().screen).toBe('settings');
    restarted.dispose();
  });

  it('lists assistants without counts when the Groups read answers 500 (#775)', async () => {
    const f = fixture();
    f.server.failGroups = true;
    const controller = f.create();
    await controller.signIn('alex');
    controller.openSettings();
    await vi.waitFor(() => expect(controller.getSnapshot().assistants.status).not.toBe('loading'));
    expect(controller.getSnapshot().assistants).toMatchObject({
      available: true,
      status: 'ready',
      saved: false,
      unsaved: false,
      message: '',
      assistants: [
        { id: helper.id, name: helper.name, access: helper.access, groups: null },
        { id: reader.id, name: reader.name, access: reader.access, groups: null },
      ],
    });
    expect(f.requests).toContain('GET /api/user/assistant-groups');
    controller.openAssistants();
    expect(controller.getSnapshot().screen).toBe('assistants');
    controller.dispose();
  });

  it('follows nextOffset and lists assistants from the second page (#775)', async () => {
    const f = fixture();
    f.server.pageSize = 1;
    const controller = f.create();
    await controller.signIn('alex');
    const state = await openAssistants(controller);
    expect(state()).toMatchObject({
      available: true,
      status: 'ready',
      assistants: [
        { id: helper.id, name: helper.name },
        { id: reader.id, name: reader.name },
      ],
    });
    expect(f.requests).toContain(`GET ${connectionsPath}?offset=1`);
    controller.dispose();
  });

  it('disconnects an assistant once the member confirms, and says so', async () => {
    const f = fixture();
    const { controller, state } = await readOnline(f);
    controller.askDisconnectAssistant('c1');
    expect(state().confirming).toBe('c1');
    expect(f.bodies).toEqual([]);
    controller.cancelDisconnectAssistant();
    expect(state().confirming).toBeNull();
    expect(f.bodies).toEqual([]);
    controller.askDisconnectAssistant('c1');
    await controller.disconnectAssistant();
    expect(f.bodies).toEqual([{ id: 'c1' }]);
    expect(state()).toMatchObject({
      confirming: null,
      disconnecting: false,
      snackbar: 'Fictional Helper disconnected',
    });
    expect(state().assistants?.map((assistant) => assistant.name)).toEqual(['Fictional Reader']);
    await vi.waitFor(() => expect(f.savedAssistants()).toEqual(['Fictional Reader']));
    controller.dismissAssistantsSnackbar();
    expect(state().snackbar).toBeNull();
    controller.dispose();
  });

  it('says it disconnected once: leaving the screen ends the snackbar', async () => {
    const f = fixture();
    const { controller, state } = await readOnline(f);
    controller.askDisconnectAssistant('c1');
    await controller.disconnectAssistant();
    expect(state().snackbar).toBe('Fictional Helper disconnected');
    controller.back();
    expect(controller.getSnapshot().screen).toBe('settings');
    expect(state().snackbar).toBeNull();
    controller.openAssistants();
    expect(state().snackbar).toBeNull();
    controller.dispose();
  });

  it('keeps the assistant and says so when Disconnect fails', async () => {
    const f = fixture();
    const { controller, state } = await readOnline(f);
    f.server.failRevoke = true;
    controller.askDisconnectAssistant('c1');
    await controller.disconnectAssistant();
    expect(state()).toMatchObject({
      confirming: 'c1',
      disconnecting: false,
      disconnectMessage: 'Couldn’t confirm the disconnection. Try again.',
      snackbar: null,
    });
    expect(state().assistants?.map((assistant) => assistant.name)).toEqual([
      'Fictional Helper',
      'Fictional Reader',
    ]);
    controller.dispose();
  });

  it('shows its Saved copy offline, read only, and Disconnect needs a connection', async () => {
    const f = fixture();
    const { controller } = await readOnline(f);
    const restarted = await restartOffline(f, controller);
    const state = await openAssistants(restarted);
    expect(state()).toMatchObject({
      available: true,
      status: 'ready',
      saved: true,
      unsaved: false,
      assistants: [{ name: 'Fictional Helper' }, { name: 'Fictional Reader' }],
    });
    expect(state().refreshedAt).toEqual(expect.any(Number));
    const sent = f.requests.length;
    restarted.askDisconnectAssistant('c1');
    await restarted.disconnectAssistant();
    expect(f.requests.slice(sent).filter((request) => request.startsWith('POST'))).toEqual([]);
    expect(state().disconnectMessage).toBe('Disconnecting needs a connection.');
    restarted.dispose();
  });

  it('shows its Saved copy under the offline banner, read only, when the internet goes mid-visit', async () => {
    const f = fixture();
    const { controller, state } = await readOnline(f);
    // The phone keeps its Wi-Fi, but the internet goes.
    f.connect(true, false);
    await controller.refresh('pull');
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect(state()).toMatchObject({
      saved: true,
      assistants: [{ name: 'Fictional Helper' }, { name: 'Fictional Reader' }],
    });
    expect(controller.getSnapshot().offline.active).toBe(true);
    const sent = f.requests.length;
    controller.askDisconnectAssistant('c1');
    await controller.disconnectAssistant();
    expect(f.requests.slice(sent).filter((request) => request.startsWith('POST'))).toEqual([]);
    expect(state().disconnectMessage).toBe('Disconnecting needs a connection.');
    controller.dispose();
  });

  it('reads again once when the internet returns, and the offline banner lifts', async () => {
    const f = fixture();
    const { controller, state } = await readOnline(f);
    f.connect(true, false);
    await controller.refresh('pull');
    await vi.waitFor(() => expect(controller.getSnapshot().offline.active).toBe(true));
    // Meanwhile Fictional Helper was disconnected on the web.
    f.server.connections = [reader];
    const sent = f.requests.length;
    f.connect(true, true);
    await vi.waitFor(() => expect(state().saved).toBe(false));
    expect(state().assistants?.map((assistant) => assistant.name)).toEqual(['Fictional Reader']);
    expect(controller.getSnapshot().offline.active).toBe(false);
    // NetInfo reports the same return again: nothing more is read.
    f.connect(true, true);
    await settle();
    expect(
      f.requests.slice(sent).filter((request) => request === `GET ${connectionsPath}`),
    ).toEqual([`GET ${connectionsPath}`]);
    controller.dispose();
  });

  it('closes the Disconnect sheet of an assistant a read no longer lists', async () => {
    const f = fixture();
    const { controller, state } = await readOnline(f);
    f.connect(true, false);
    await controller.refresh('pull');
    await vi.waitFor(() => expect(controller.getSnapshot().offline.active).toBe(true));
    controller.askDisconnectAssistant('c1');
    expect(state().confirming).toBe('c1');
    // Meanwhile Fictional Helper was disconnected on the web; the internet returns.
    f.server.connections = [reader];
    f.connect(true, true);
    await vi.waitFor(() => expect(state().saved).toBe(false));
    expect(state().confirming).toBeNull();
    const sent = f.requests.length;
    await controller.disconnectAssistant();
    expect(f.requests.slice(sent).filter((request) => request.startsWith('POST'))).toEqual([]);
    controller.dispose();
  });

  it('doesn’t read again on the internet’s return when what it shows was read live', async () => {
    const f = fixture();
    const { controller, state } = await readOnline(f);
    // The internet drops and returns before anything is read meanwhile.
    f.connect(true, false);
    await settle();
    const sent = f.requests.length;
    f.connect(true, true);
    await settle();
    expect(f.requests.slice(sent)).not.toContain(`GET ${connectionsPath}`);
    expect(state().saved).toBe(false);
    controller.dispose();
  });

  it('shows no list once it says this phone keeps no copy', async () => {
    const f = fixture();
    const { controller, state } = await readOnline(f);
    // Splitbook stops answering as Disconnect is sent: its Saved copy went first.
    f.server.offline = true;
    controller.askDisconnectAssistant('c1');
    await controller.disconnectAssistant();
    expect(state().disconnectMessage).toBe('Couldn’t confirm the disconnection. Try again.');
    controller.cancelDisconnectAssistant();
    await controller.refresh('pull');
    await vi.waitFor(() => expect(state().status).not.toBe('loading'));
    expect(state()).toMatchObject({
      unsaved: true,
      saved: false,
      assistants: null,
      refreshedAt: null,
      message: 'Connected assistants aren’t saved on this phone. Connect to see them.',
    });
    expect(controller.getSnapshot().offline.active).toBe(true);
    controller.dispose();
  });

  it('says plainly offline when this phone keeps no copy', async () => {
    const f = fixture();
    const controller = f.create();
    await controller.signIn('alex');
    const restarted = await restartOffline(f, controller);
    restarted.openSettings();
    await vi.waitFor(() => expect(restarted.getSnapshot().assistants.status).not.toBe('loading'));
    // Not known to be switched on: Settings doesn't offer it.
    expect(restarted.getSnapshot().assistants.available).toBeNull();
    restarted.dispose();
  });

  it('never brings back an assistant from a read that started before its Disconnect', async () => {
    const f = fixture();
    const { controller, state } = await readOnline(f);
    let release!: () => void;
    f.server.holdNextRead = new Promise((resolve) => (release = resolve));
    // A pull reads the list as it is now, with Fictional Helper, and its answer is held.
    const pulling = controller.refresh('pull');
    await vi.waitFor(() => expect(f.server.holdNextRead).toBeNull());
    controller.askDisconnectAssistant('c1');
    await controller.disconnectAssistant();
    // The read after the Disconnect has answered; only then does the pull's answer land.
    release();
    await pulling;
    await vi.waitFor(() => expect(state().status).toBe('ready'));
    expect(state().assistants?.map((assistant) => assistant.name)).toEqual(['Fictional Reader']);
    await vi.waitFor(() => expect(f.savedAssistants()).toEqual(['Fictional Reader']));
    controller.dispose();
  });

  it('never shows a disconnected assistant from the Saved copy, even when it can’t read again', async () => {
    const f = fixture();
    const { controller, state } = await readOnline(f);
    f.server.offlineAfterRevoke = true;
    controller.askDisconnectAssistant('c1');
    await controller.disconnectAssistant();
    await vi.waitFor(() => expect(state().status).not.toBe('loading'));
    // Its Saved copy went before the Disconnect, so the read after it finds nothing to show.
    expect(state()).toMatchObject({ assistants: null, unsaved: true });
    expect(f.savedAssistants() ?? []).not.toContain('Fictional Helper');
    controller.dispose();
  });

  it('never shows a Saved copy it couldn’t remove at a Disconnect', async () => {
    const f = fixture();
    const { controller, state } = await readOnline(f);
    f.server.failRemoval = true;
    f.server.offlineAfterRevoke = true;
    controller.askDisconnectAssistant('c1');
    await controller.disconnectAssistant();
    await vi.waitFor(() => expect(state().status).not.toBe('loading'));
    // The copy from before is still on this phone, and never answers again.
    expect(f.savedAssistants()).toContain('Fictional Helper');
    expect(state()).toMatchObject({ saved: false, unsaved: true, assistants: null });
    controller.dispose();
  });

  it('forgets its Saved copy at sign-out', async () => {
    const f = fixture();
    const { controller } = await readOnline(f);
    await controller.signOut();
    await vi.waitFor(() => expect(f.savedAssistants()).toBeNull());
    expect(controller.getSnapshot().assistants).toMatchObject({
      available: null,
      assistants: null,
    });
    controller.dispose();
  });
});
