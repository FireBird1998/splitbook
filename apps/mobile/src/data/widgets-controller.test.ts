import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMobileController } from './mobile-controller';
import { savedQueriesIn } from '../test-utils/saved-queries';
import { notificationTaskProtected } from './notification-alerts';
import type { WidgetCopy } from '@splitbook/shared/balances-widget';
import { groupWidget } from '@splitbook/shared/group-widget';
import { quickWidget } from '@splitbook/shared/quick-widget';

const alex = { id: 'a00000000000000000000001', name: 'Alex Rivera', email: 'alex@example.test' };
const sam = { id: 'a00000000000000000000002', name: 'Sam Chen', email: 'sam@example.test' };
const tagId = 'e00000000000000000000001';
const groupId = 'b00000000000000000000001';
const controllers: ReturnType<typeof createMobileController>[] = [];
const verified = Date.parse('2026-11-08T04:11:00Z');
function fixture() {
  let user = alex,
    cookie: string | null = null,
    owner: string | null = alex.id,
    cleanup = false;
  let offline = false,
    expired = false,
    owed = 2400;
  let groupBalances: unknown = { byCurrency: [] };
  let refused = 0;
  let offlineAfterSave = false;
  let noGroups = false;
  let archived = false;
  let identity: unknown = null;
  const rows = new Map<string, unknown>();
  let hold: Promise<void> | undefined;
  const drafts = new Map<string, unknown>();
  const requests: { path: string; method: string }[] = [];
  const copies: WidgetCopy[] = [];
  const events: string[] = [];
  const group = () => ({
    _id: groupId,
    name: 'Maple House',
    isArchived: archived,
    createdBy: user.id,
    category: 'home',
    defaultCurrency: 'INR',
    tags: [{ _id: tagId, name: 'Groceries', createdAt: '2026-11-01T00:00:00Z', isArchived: false }],
    members: [
      { user: { ...user, _id: user.id }, role: 'admin', joinedAt: '2026-11-01T00:00:00Z' },
      ...[
        alex,
        sam,
        { id: 'a00000000000000000000003', name: 'Priya Shah', email: 'priya@example.test' },
      ]
        .filter((person) => person.id !== user.id)
        .map((person) => ({
          user: { ...person, _id: person.id },
          role: 'member',
          joinedAt: '2026-11-01T00:00:00Z',
        })),
    ],
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  });
  const make = () => {
    const controller = createMobileController(
      {
        apiBaseUrl: 'http://localhost:4986',
        authOrigin: 'http://localhost:4986',
        developmentPersonaEnabled: true,
      },
      {
        widgets: {
          write: async (copy) => {
            await hold;
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
        settlementAttempts: {
          load: async () => null,
          save: async () => {},
          remove: async () => {},
          clear: async () => {},
        },
        newSubmissionKey: () => 'widget-expense-fictional-986',
        expenseDrafts: {
          load: async (account, id) => drafts.get(account + id) ?? null,
          save: async (account, id, value) => {
            drafts.set(account + id, structuredClone(value));
          },
          remove: async (account, id) => {
            drafts.delete(account + id);
          },
          clear: async () => {
            drafts.clear();
          },
          list: async () => [],
        },
        savedQueries: savedQueriesIn(rows),
        offlineIdentity: {
          load: async () => identity,
          save: async (value) => {
            identity = structuredClone(value);
          },
          clear: async () => {
            identity = null;
          },
        },
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
          requests.push({ path, method: init.method ?? 'GET' });
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
          if (path === `/api/groups/${groupId}` && refused)
            return Response.json({ error: 'Not a member' }, { status: refused });
          if (path === `/api/groups/${groupId}`)
            return Response.json({ status: 200, data: group() });
          if (path.endsWith('/expenses') && init.method === 'POST') {
            owed = 2500;
            if (offlineAfterSave) offline = true;
            return Response.json({
              status: 201,
              data: {
                _id: 'c00000000000000000000001',
                group: groupId,
                ...JSON.parse(String(init.body)),
                revision: 1,
                isDeleted: false,
                createdAt: '2026-11-08T00:00:00Z',
                updatedAt: '2026-11-08T00:00:00Z',
              },
            });
          }
          if (path === `/api/groups/${groupId}/expenses/c00000000000000000000001`)
            return Response.json({
              status: 200,
              data: {
                _id: 'c00000000000000000000001',
                group: groupId,
                createdBy: alex.id,
                description: 'Saved groceries',
                amount: 100,
                amountMinor: 10000,
                moneyVersion: 1,
                currency: 'INR',
                category: 'food',
                tag: 'Groceries',
                tagId,
                date: '2026-11-08T00:00:00Z',
                paidBy: [{ user: { ...alex, _id: alex.id }, amount: 100, amountMinor: 10000 }],
                splitBetween: [
                  { user: { ...alex, _id: alex.id }, amount: 100, amountMinor: 10000 },
                ],
                splitMethod: 'equal',
                revision: 1,
                isDeleted: false,
                createdAt: '2026-11-08T00:00:00Z',
                updatedAt: '2026-11-08T00:00:00Z',
              },
            });
          if (path.endsWith('/expenses'))
            return Response.json({
              status: 200,
              data: {
                expenses: [],
                pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
                summary: {
                  count: 0,
                  totalsByCurrency: [],
                  userOwes: 0,
                  userGetsBack: 0,
                  byMember: [],
                },
              },
            });
          if (path === `/api/groups/${groupId}/balances`)
            return Response.json({ status: 200, data: groupBalances });
          if (path === '/api/groups')
            return Response.json({ status: 200, data: noGroups || archived ? [] : [group()] });
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
    controllers.push(controller);
    return controller;
  };
  return {
    make,
    archive: () => {
      archived = true;
    },
    noGroups: () => {
      noGroups = true;
    },
    groupBalances: (value: unknown) => {
      groupBalances = value;
    },
    offlineAfterSave: () => {
      offlineAfterSave = true;
    },
    refuse: (status: number) => {
      refused = status;
    },
    blockWrite: () => {
      let release!: () => void;
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    copies,
    requests,
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
  controllers.splice(0).forEach((controller) => controller.dispose());
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
  vi.stubEnv('EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED', 'true');
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
    widgetOpen: { target: 'review' },
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
  const count = f.copies.length;
  c.dispose();
  f.offline();
  vi.spyOn(Date, 'now').mockReturnValue(verified + 60_000);
  const restart = f.make();
  await restart.restore();
  await vi.waitFor(() => expect(f.copies.length).toBeGreaterThan(count));
  expect(restart.getSnapshot().auth.status).toBe('authenticated');
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

it('updates from the Home read after a member saves an Expense, never from the submitted amount', async () => {
  const f = fixture();
  const c = f.make();
  await c.signIn('alex');
  await vi.waitFor(() => expect(f.copies.at(-1)?.home?.currencies[0]?.owedMinor).toBe(240000));
  await c.openExpense(groupId);
  await c.updateExpenseDraft({ description: 'Weekly groceries', amount: '100', tagId });
  await c.saveExpense();
  expect(c.getSnapshot().expense.status).toBe('saved');
  await c.back();
  await vi.waitFor(() => expect(f.copies.at(-1)?.home?.currencies[0]?.owedMinor).toBe(250000));
});
it('waits for an already running saved-copy write before purging and cancels the remaining writes', async () => {
  const f = fixture();
  const c = f.make();
  await c.signIn('alex');
  await vi.waitFor(() => expect(f.copies.at(-1)?.home).toBeTruthy());
  const release = f.blockWrite();
  f.owe(2500);
  await c.refreshHome();
  f.events.length = 0;
  const signingOut = c.signOut();
  await Promise.resolve();
  expect(f.events).not.toContain('clear');
  release();
  await signingOut;
  const signedOut = f.events.indexOf('signed-out');
  expect(signedOut).toBeGreaterThan(f.events.indexOf('account-purged'));
  expect(f.events.slice(signedOut)).toEqual(['signed-out', 'redraw']);
});
it('hides a 401 immediately even while a saved-copy write is still running', async () => {
  const f = fixture();
  const c = f.make();
  await c.signIn('alex');
  await vi.waitFor(() => expect(f.copies.at(-1)?.home).toBeTruthy());
  const release = f.blockWrite();
  f.owe(2500);
  await c.refreshHome();
  f.events.length = 0;
  f.expire();
  await c.refreshHome();
  try {
    await vi.waitFor(() => expect(f.events).toContain('expired'));
    expect(f.events).not.toContain('clear');
  } finally {
    release();
  }
});

it('projects a Group and its Balances reads into the widget copy with both verification times', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(verified);
  const f = fixture();
  const controller = f.make();
  await controller.signIn('alex');
  await controller.openGroup(groupId);
  await controller.refreshBalances();
  await vi.waitFor(() =>
    expect(f.copies.at(-1)?.groups?.[groupId]).toMatchObject({
      id: groupId,
      name: 'Maple House',
      theme: 'home',
      archived: false,
      mainCurrency: 'INR',
      verifiedAt: verified,
      balancesVerifiedAt: verified,
      currencies: [],
    }),
  );
  expect(f.copies.at(-1)?.savedGroups?.rows.map((g) => g.id)).toEqual([groupId]);
});

for (const status of [403, 404])
  it(`removes the Group widget part after a refused read (${status})`, async () => {
    const f = fixture(),
      c = f.make();
    await c.signIn('alex');
    await c.openGroup(groupId);
    await c.refreshBalances();
    await vi.waitFor(() => expect(f.copies.at(-1)?.groups?.[groupId]).toBeDefined());
    f.refuse(status);
    await c.openGroup(groupId, false);
    await vi.waitFor(() => expect(f.copies.at(-1)?.groups?.[groupId]).toBeUndefined());
    expect(f.copies.at(-1)?.lostGroupIds).toContain(groupId);
  });
it('restores Group widget parts and offline setup with their original saved verification times', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(verified);
  const f = fixture(),
    first = f.make();
  await first.signIn('alex');
  await first.openGroup(groupId);
  await first.refreshBalances();
  await vi.waitFor(() => expect(f.copies.at(-1)?.groups?.[groupId]).toBeDefined());
  first.dispose();
  f.offline();
  vi.spyOn(Date, 'now').mockReturnValue(verified + 3600000);
  const restarted = f.make();
  await restarted.restore();
  await vi.waitFor(() =>
    expect(f.copies.at(-1)?.groups?.[groupId]?.balancesVerifiedAt).toBe(verified),
  );
  expect(f.copies.at(-1)?.savedGroups?.rows.map((g) => g.id)).toEqual([groupId]);
});

it('a widget payment tap opens the chosen payment without sending a Settlement request', async () => {
  const f = fixture(),
    c = f.make(),
    priya = { _id: 'a00000000000000000000003', name: 'Priya Shah' };
  f.groupBalances({
    byCurrency: [
      {
        currency: 'INR',
        balances: [
          { user: { _id: alex.id, name: alex.name }, balance: -1060 },
          { user: priya, balance: 1060 },
        ],
        debts: [{ from: { _id: alex.id, name: alex.name }, to: priya, amount: 1060 }],
      },
    ],
  });
  await c.signIn('alex');
  await c.openWidget({
    kind: 'settle',
    groupId,
    payment: { from: alex.id, to: priya._id, currency: 'INR' },
  });
  expect(c.getSnapshot().screen).toBe('settlement');
  expect(c.getSnapshot().settlement.draft).toMatchObject({
    paidBy: alex.id,
    paidTo: priya._id,
    currency: 'INR',
    amount: '1060',
  });
  expect(f.requests.filter((r) => r.method === 'POST' && r.path.includes('/settlements'))).toEqual(
    [],
  );
});
it('a widget Add expense tap resumes the Group’s unfinished draft', async () => {
  const f = fixture(),
    c = f.make();
  await c.signIn('alex');
  await c.openExpense(groupId);
  await c.updateExpenseDraft({ description: 'Unfinished groceries', amount: '123', tagId });
  await c.back();
  await c.openWidget({ kind: 'expense', groupId });
  expect(c.getSnapshot().screen).toBe('expense');
  expect(c.getSnapshot().expense.draft).toMatchObject({
    description: 'Unfinished groceries',
    amount: '123',
  });
});

it('removes a Group widget part when a save retires its saved copies, until the next successful read', async () => {
  const f = fixture(),
    c = f.make();
  await c.signIn('alex');
  await c.openGroup(groupId);
  await c.refreshBalances();
  await vi.waitFor(() => expect(f.copies.at(-1)?.groups?.[groupId]).toBeDefined());
  await c.openExpense(groupId);
  await c.updateExpenseDraft({ description: 'Groceries', amount: '100', tagId });
  f.offlineAfterSave();
  await c.saveExpense();
  await vi.waitFor(() => expect(f.copies.at(-1)?.groups?.[groupId]).toBeUndefined());
  expect(f.copies.at(-1)?.lostGroupIds).not.toContain(groupId);
});
it('Ask each time opens a Group picker after restoration, and choosing resumes the same draft', async () => {
  const f = fixture(),
    c = f.make();
  await c.signIn('alex');
  await c.openExpense(groupId);
  await c.updateExpenseDraft({ description: 'Widget unfinished', amount: '123', tagId });
  await c.back();
  await c.openWidget('choose-group');
  expect(c.getSnapshot().widgetPicker).toBe(true);
  await c.chooseWidgetGroup(groupId);
  expect(c.getSnapshot().widgetPicker).toBe(false);
  expect(c.getSnapshot().expense.draft).toMatchObject({
    description: 'Widget unfinished',
    amount: '123',
  });
});

it('opens Ask each time from a cold start with no Groups, then hands Create a Group to the app', async () => {
  const f = fixture();
  f.noGroups();
  const first = f.make();
  await first.signIn('alex');
  first.dispose();
  const cold = f.make();
  await cold.openWidget('choose-group');
  expect(cold.getSnapshot().widgetPicker).toBe(true);
  expect(cold.getSnapshot().groups.data).toEqual([]);
  cold.closeWidgetPicker();
  await cold.openWidget('create-group');
  expect(cold.getSnapshot().screen).toBe('create');
});
it('closes an open widget picker when a chosen-Group widget opens its Expense', async () => {
  const f = fixture(),
    c = f.make();
  await c.signIn('alex');
  await c.openWidget('choose-group');
  await c.openWidget({ kind: 'expense', groupId });
  expect(c.getSnapshot().widgetPicker).toBe(false);
  expect(c.getSnapshot().screen).toBe('expense');
});

it('holds a widget tap during Add expense and offers it after close without changing the draft', async () => {
  const f = fixture(),
    c = f.make();
  await c.signIn('alex');
  await c.openExpense(groupId);
  await c.updateExpenseDraft({ description: 'Still entering groceries', amount: '123', tagId });
  const form = c.getSnapshot().expense;
  const before = f.requests.length;
  await c.openWidget('home');
  expect(c.getSnapshot()).toMatchObject({
    screen: 'expense',
    notificationOpening: { status: 'held' },
  });
  expect(c.getSnapshot().expense).toBe(form);
  expect(f.requests.slice(before)).toEqual([]);
  const owner = c.getSnapshot().heldNotification;
  expect(c.getSnapshot().heldNotificationNotice).toBe(owner);
  expect(owner).not.toBeNull();
  await c.closeExpense();
  expect(c.getSnapshot().notificationOpening.status).toBe('held');
  await c.openPendingNotification();
  expect(c.getSnapshot()).toMatchObject({
    screen: 'groups',
    notificationOpening: { status: 'idle' },
    heldNotification: null,
  });
});

it.each([
  'Add expense',
  'edit',
  'payment',
  'To review',
  'Group form',
  'Tags',
  'Currencies',
  'Leave Group',
] as const)('holds a widget tap with the entire protected %s task unchanged', async (task) => {
  vi.stubEnv('EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED', 'true');
  const f = fixture(),
    c = f.make();
  await c.signIn('alex');
  await c.openGroup(groupId);
  if (task === 'Add expense') {
    await c.openExpense(groupId);
    await c.updateExpenseDraft({ description: 'Unfinished', amount: '123', tagId });
  }
  if (task === 'edit') {
    await c.openExpense(groupId, 'c00000000000000000000001');
    await c.editExpense();
    await c.updateExpenseDraft({ description: 'Unfinished edit' });
    expect(c.getSnapshot().expense.status, c.getSnapshot().expense.message ?? '').toBe('editing');
  }
  if (task === 'payment') {
    f.groupBalances({
      byCurrency: [
        {
          currency: 'INR',
          balances: [
            { user: { _id: alex.id, name: alex.name }, balance: -100 },
            { user: { _id: sam.id, name: sam.name }, balance: 100 },
          ],
          debts: [
            {
              from: { _id: alex.id, name: alex.name },
              to: { _id: sam.id, name: sam.name },
              amount: 100,
            },
          ],
        },
      ],
    });
    await c.selectDestination('balances');
    await c.openRecordPayment(alex.id, sam.id, 'INR');
    expect(c.getSnapshot().screen).toBe('settlement');
  }
  if (task === 'To review') await c.openToReview(groupId);
  if (task === 'Group form') {
    c.startCreate();
    c.updateCreation({ name: 'Unfinished Group' });
  }
  if (task === 'Tags') c.openTags(groupId);
  if (task === 'Currencies') await c.openCurrencies(groupId);
  if (task === 'Leave Group') {
    c.openMembers();
    await c.reviewLeaveGroup();
  }
  const before = c.getSnapshot();
  expect(notificationTaskProtected(before)).toBe(true);
  const count = f.requests.length;
  await c.openWidget('home');
  const after = c.getSnapshot();
  expect(after.screen).toBe(before.screen);
  expect(after.detail).toBe(before.detail);
  for (const key of [
    'expense',
    'settlement',
    'creation',
    'toReview',
    'tagManager',
    'groupCurrencies',
    'leave',
  ] as const)
    expect(after[key]).toBe(before[key]);
  expect(after.tagsOpenFor).toBe(before.tagsOpenFor);
  expect(after.currenciesOpenFor).toBe(before.currenciesOpenFor);
  expect(after.notificationOpening.status).toBe('held');
  expect(after.heldNotificationNotice).toBe(after.heldNotification);
  expect(after.heldNotification).not.toBeNull();
  expect(f.requests.slice(count)).toEqual([]);
});
it.each(['sign out', 'account change'] as const)(
  'drops a held widget tap on %s',
  async (action) => {
    const f = fixture(),
      c = f.make();
    await c.signIn('alex');
    c.startCreate();
    await c.openWidget('home');
    const owner = c.getSnapshot().heldNotification!;
    if (action === 'sign out') await c.signOut();
    else await c.signIn('sam');
    expect(c.getSnapshot().heldNotification).toBeNull();
    expect(c.getSnapshot().notificationOpening.status).toBe('idle');
    c.dismissPendingNotification(owner);
    await c.openPendingNotification();
    expect(c.getSnapshot().heldNotification).toBeNull();
  },
);

it('keeps the last Group balance as final when an authoritative read says it is archived', async () => {
  const f = fixture(),
    c = f.make();
  f.groupBalances({
    byCurrency: [
      {
        currency: 'INR',
        balances: [
          { user: { _id: alex.id, name: alex.name }, balance: -12 },
          { user: { _id: sam.id, name: sam.name }, balance: 12 },
        ],
        debts: [
          {
            from: { _id: alex.id, name: alex.name },
            to: { _id: sam.id, name: sam.name },
            amount: 12,
          },
        ],
      },
    ],
  });
  await c.signIn('alex');
  await c.openGroup(groupId);
  await c.refreshBalances();
  await vi.waitFor(() => expect(f.copies.at(-1)?.groups?.[groupId]).toBeDefined());
  const original = f.copies.at(-1)!.groups![groupId]!;
  f.archive();
  await c.openWidget({ kind: 'group', groupId });
  await vi.waitFor(() => expect(f.copies.at(-1)?.groups?.[groupId]?.archived).toBe(true));
  const copy = f.copies.at(-1)!;
  expect(copy.lostGroupIds).not.toContain(groupId);
  expect(copy.groups![groupId]).toMatchObject({
    currencies: original.currencies,
    verifiedAt: original.verifiedAt,
    balancesVerifiedAt: original.balancesVerifiedAt,
  });
  const session = { status: 'authenticated' as const, accountId: alex.id, loading: false };
  const setup = { widgetId: 7, accountId: alex.id, groupId };
  expect(
    groupWidget(copy.groups![groupId], { ...setup, kind: 'group' }, '4x2', session, verified),
  ).toMatchObject({ state: 'archived', final: true, addExpense: false });
  expect(quickWidget(copy, { ...setup, kind: 'quick' }, '2x1', session)).toMatchObject({
    state: 'archived',
    title: 'Group archived',
    subtitle: 'Choose another',
  });
  // The app's existing archived-Group refusal is unchanged.
  expect(c.getSnapshot().detail.data).toBeNull();
});
