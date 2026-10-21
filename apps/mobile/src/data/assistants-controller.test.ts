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
    /** The next Disconnect fails on the server. */
    failRevoke: false,
    connections: [helper, reader],
  };
  let cookie: string | null = null,
    owner: string | null = null,
    identity: unknown = null,
    cleanup = false;
  const cache = new Map<string, unknown>();
  const savedQueries = savedQueriesIn(cache);
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
    if (path === connectionsPath) {
      if (server.assistantsOff) return json({ message: 'Not found' }, 404);
      return json({
        resource: 'http://localhost:4157/api/mcp',
        connections: server.connections,
        nextOffset: null,
      });
    }
    if (path === '/api/user/assistant-groups') {
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
          const path = new URL(url).pathname;
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
  return { create, server, requests, bodies, savedAssistants };
}
type Fixture = ReturnType<typeof fixture>;
type Controller = ReturnType<Fixture['create']>;

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
