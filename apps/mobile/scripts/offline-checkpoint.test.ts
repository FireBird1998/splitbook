import { describe, expect, it } from 'vitest';
import { createMobileController } from '../src/data';
import { savedQueriesIn } from '../src/test-utils/saved-queries';
import { waitForSavedQueries } from './offline-checkpoint';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('the offline verifier’s persistence checkpoint (#600)', () => {
  it('names a query that never reached disk instead of treating it as saved', async () => {
    const rows = savedQueriesIn(new Map());
    await expect(waitForSavedQueries(rows, 'sam', ['/api/user/balances'], 0)).rejects.toThrow(
      'Offline restart needs saved queries: /api/user/balances',
    );
  });

  it('propagates a storage read failure immediately', async () => {
    const rows = savedQueriesIn(new Map(), {
      load: async () => {
        throw new Error('Device read failed');
      },
    });
    await expect(waitForSavedQueries(rows, 'sam', ['/api/user/balances'])).rejects.toThrow(
      'Device read failed',
    );
  });

  it('restores Home after a restart even when its ready network read is still being saved', async () => {
    const user = {
      id: 'a00000000000000000000002',
      name: 'Sam Chen',
      email: 'sam@example.test',
      image: null,
    };
    const disk = new Map<string, unknown>();
    const saving = deferred(),
      release = deferred();
    const records = savedQueriesIn(disk);
    const rows = {
      ...records,
      save: async (account: string, path: string, value: unknown) => {
        if (path === '/api/user/balances') {
          saving.resolve();
          await release.promise;
        }
        await records.save(account, path, value);
      },
    };
    let cookie: string | null = null,
      owner: string | null = null,
      identity: unknown = null;
    let offline = false;
    const create = () =>
      createMobileController(
        {
          apiBaseUrl: 'http://localhost:4145',
          authOrigin: 'http://localhost:4145',
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
            load: async () => identity,
            save: async (value) => {
              identity = value;
            },
            clear: async () => {
              identity = null;
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
            cleanupMarker: { load: async () => false, mark: async () => {}, clear: async () => {} },
            stores: [rows],
          },
          savedQueries: rows,
          fetch: async (url) => {
            if (offline) throw new TypeError('Controlled network loss');
            const path = new URL(url).pathname;
            if (path.endsWith('/sign-in'))
              return new Response(JSON.stringify({ user }), {
                headers: {
                  'Set-Cookie': 'better-auth.session_token=sam.signature; Path=/; HttpOnly',
                },
              });
            if (path.endsWith('/get-session'))
              return Response.json({
                user,
                session: { userId: user.id, expiresAt: '2030-01-01T00:00:00Z' },
              });
            if (path === '/api/groups') return Response.json({ status: 200, data: [] });
            if (path === '/api/user/balances')
              return Response.json({
                status: 200,
                data: { buckets: [{ currency: 'INR', youOwe: 12, youAreOwed: 0 }], groups: [] },
              });
            throw new Error(`Unexpected fixture path ${path}`);
          },
        },
      );
    let controller = create();
    try {
      await controller.signIn('sam');
      await saving.promise;
      expect(controller.getSnapshot().home.status).toBe('ready');
      const restarting = (async () => {
        await waitForSavedQueries(rows, user.id, ['/api/groups', '/api/user/balances']);
        controller.dispose();
        offline = true;
        controller = create();
        await controller.restore();
      })();
      // Release the disk only after the checkpoint has had a turn. Without waiting for storage,
      // disposal cancels the queued row or the new controller reads before it reaches disk.
      await new Promise<void>((done) => setImmediate(done));
      release.resolve();
      await restarting;
      expect(controller.getSnapshot()).toMatchObject({
        auth: { status: 'authenticated', user: { id: user.id } },
        home: { status: 'ready', data: [{ currency: 'INR', youOwe: 12, youAreOwed: 0 }] },
        offline: { active: true },
      });
    } finally {
      release.resolve();
      controller.dispose();
    }
  });
});
