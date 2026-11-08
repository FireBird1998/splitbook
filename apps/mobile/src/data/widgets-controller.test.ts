import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMobileController } from './mobile-controller';
import { savedQueriesIn } from '../test-utils/saved-queries';
import type { WidgetCopy } from '@splitbook/shared/balances-widget';

const alex = { id: 'a00000000000000000000001', name: 'Alex Rivera', email: 'alex@example.test' };
const sam = { id: 'a00000000000000000000002', name: 'Sam Chen', email: 'sam@example.test' };
const groupId = 'b00000000000000000000001';
const verified = Date.parse('2026-11-08T04:11:00Z');
function fixture() {
  let user = alex,
    cookie: string | null = null,
    owner: string | null = alex.id,
    cleanup = false;
  let offline = false,
    expired = false,
    owed = 2400;
  const rows = new Map<string, unknown>();
  const copies: WidgetCopy[] = [];
  const events: string[] = [];
  const group = () => ({
    _id: groupId,
    name: 'Maple House',
    createdBy: user.id,
    category: 'home',
    defaultCurrency: 'INR',
    members: [{ user: { ...user, _id: user.id }, role: 'admin', joinedAt: '2026-11-01T00:00:00Z' }],
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  });
  const make = () =>
    createMobileController(
      {
        apiBaseUrl: 'http://localhost:4986',
        authOrigin: 'http://localhost:4986',
        developmentPersonaEnabled: true,
      },
      {
        widgets: {
          write: async (copy) => {
            copies.push(structuredClone(copy));
            events.push('write:' + copy.accountId);
          },
          clear: async () => {
            events.push('clear');
          },
          setSession: async (state) => {
            events.push(state.status);
          },
          redraw: async () => {
            events.push('redraw');
          },
        },
        savedQueries: savedQueriesIn(rows),
        credentials: {
          load: async () => cookie,
          save: async (value) => {
            cookie = value;
          },
          clear: async () => {
            cookie = null;
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
          stores: [
            {
              clear: async () => {
                rows.clear();
                events.push('account-purged');
              },
            },
          ],
        },
        fetch: async (url, init) => {
          if (offline) throw new Error('Offline');
          const path = new URL(url).pathname;
          if (path.endsWith('/sign-in')) {
            user = JSON.parse(String(init.body)).personaId === 'sam' ? sam : alex;
            return Response.json(
              { user },
              {
                headers: {
                  'Set-Cookie': 'better-auth.session_token=fictional.signature; Max-Age=2592000',
                },
              },
            );
          }
          if (path.endsWith('/get-session'))
            return Response.json({
              user,
              session: { userId: user.id, expiresAt: '2030-01-01T00:00:00Z' },
            });
          if (path.endsWith('/sign-out')) return Response.json({ success: true });
          if (expired) return Response.json({ error: 'Session expired' }, { status: 401 });
          if (path === '/api/groups') return Response.json({ status: 200, data: [group()] });
          if (path === '/api/user/balances')
            return Response.json({
              status: 200,
              data: {
                buckets: [
                  { currency: 'INR', youOwe: 1480, youAreOwed: owed, net: owed - 1480 },
                  { currency: 'EUR', youOwe: 0, youAreOwed: 40, net: 40 },
                ],
                groups: [
                  {
                    groupId,
                    name: 'Maple House',
                    balances: [{ currency: 'INR', balance: owed - 1480 }],
                  },
                ],
              },
            });
          if (path === '/api/user/to-review')
            return Response.json({ status: 200, data: { total: 0, groups: [] } });
          throw new Error(`Unexpected ${path}`);
        },
      },
    );
  return {
    make,
    copies,
    events,
    offline: () => {
      offline = true;
    },
    expire: () => {
      expired = true;
    },
    recover: () => {
      expired = false;
    },
    owe: (amount: number) => {
      owed = amount;
    },
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe('Balances widget at the controller seam', () => {
  it('projects Home in currency order with its original verification time and no To review count when Drafts are off', async () => {
    vi.stubEnv('EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED', 'false');
    vi.spyOn(Date, 'now').mockReturnValue(verified);
    const f = fixture();
    await f.make().signIn('alex');
    await vi.waitFor(() =>
      expect(f.copies.at(-1)).toMatchObject({
        accountId: alex.id,
        home: {
          verifiedAt: verified,
          groupCount: 1,
          currencies: [
            { currency: 'INR', owedMinor: 240000, oweMinor: 148000 },
            { currency: 'EUR', owedMinor: 4000, oweMinor: 0 },
          ],
        },
      }),
    );
    expect(f.copies.at(-1)).not.toHaveProperty('review');
  });
});

it('includes a separately verified To review count only while Drafts are on', async () => {
  vi.stubEnv('EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED', 'true');
  const f = fixture();
  const c = f.make();
  await c.signIn('alex');
  await vi.waitFor(() =>
    expect(f.copies.at(-1)?.review).toMatchObject({ count: 0, verifiedAt: expect.any(Number) }),
  );
  c.dispose();
});
it('opens Home and To review after the session check, including cold start', async () => {
  const f = fixture();
  const c = f.make();
  await c.signIn('alex');
  c.dispose();
  const restart = f.make();
  const checking = restart.restore();
  const opening = restart.openWidget('review');
  await checking;
  await opening;
  expect(restart.getSnapshot()).toMatchObject({
    auth: { status: 'authenticated' },
    screen: 'groups',
  });
  await restart.openWidget('home');
  await restart.signOut();
  await restart.openWidget('sign-in');
  expect(restart.getSnapshot()).toMatchObject({ auth: { status: 'signed-out' }, screen: 'groups' });
  restart.dispose();
});
it('restores the original verification time from saved Home reads', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(verified);
  const f = fixture();
  const c = f.make();
  await c.signIn('alex');
  await vi.waitFor(() => expect(f.copies.at(-1)?.home?.verifiedAt).toBe(verified));
  c.dispose();
  f.offline();
  vi.spyOn(Date, 'now').mockReturnValue(verified + 60_000);
  const restart = f.make();
  await restart.restore();
  // Online restore without a stored identity cannot authorize a saved Home.
  expect(f.copies.at(-1)?.home?.verifiedAt).toBe(verified);
  restart.dispose();
});
it('purges before the signed-out redraw and never redraws an older queued copy afterwards', async () => {
  const f = fixture();
  const c = f.make();
  await c.signIn('alex');
  await vi.waitFor(() => expect(f.copies.at(-1)?.home).toBeTruthy());
  f.events.length = 0;
  await c.signOut();
  expect(f.events.indexOf('clear')).toBeGreaterThanOrEqual(0);
  expect(f.events.indexOf('signed-out')).toBeGreaterThan(f.events.indexOf('clear'));
  expect(f.events.at(-1)).toBe('redraw');
  c.dispose();
});
it('keeps the copy on a 401 and refills it for the same account', async () => {
  const f = fixture();
  const c = f.make();
  await c.signIn('alex');
  await vi.waitFor(() => expect(f.copies.at(-1)?.home).toBeTruthy());
  f.events.length = 0;
  f.expire();
  await c.refreshHome();
  await vi.waitFor(() => expect(f.events).toContain('expired'));
  expect(f.events).not.toContain('clear');
  f.recover();
  f.owe(2500);
  await c.signIn('alex');
  await vi.waitFor(() => expect(f.copies.at(-1)?.home?.currencies[0]?.owedMinor).toBe(250000));
  c.dispose();
});
it('clears the old account before writing the next account’s copy', async () => {
  const f = fixture();
  const c = f.make();
  await c.signIn('alex');
  await vi.waitFor(() => expect(f.copies.at(-1)?.home).toBeTruthy());
  f.events.length = 0;
  await c.signIn('sam');
  await vi.waitFor(() => expect(f.copies.at(-1)?.accountId).toBe(sam.id));
  expect(f.events.indexOf('write:' + sam.id)).toBeGreaterThan(f.events.indexOf('clear'));
  expect(f.events.indexOf('signed-out')).toBeGreaterThan(f.events.indexOf('clear'));
  c.dispose();
});
