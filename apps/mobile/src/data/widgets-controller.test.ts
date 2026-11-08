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
          if (path === '/api/to-review')
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
