import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeStoredSession } from './data/cookies';
import { createMobileController, type MobileController } from './data/mobile-controller';
import type { FetchResponse } from './data/types';
import { balanceWidth } from './ui/home';
import { refreshedLabel } from './ui/refresh-feedback';
import { findHosts, layoutWidth } from './test-utils/layout';
import { setFileWindow, setWindow } from './test-utils/native';
import { savedQueriesIn } from './test-utils/saved-queries';

// #127: the App's loading, refreshing, offline and cold-start states, rendered through the real
// App tree and controller. Only native modules are replaced.
// What the mocked `./runtime` serves: the controller under test and the appearance.
const runtime = vi.hoisted(() => ({
  controller: undefined as unknown,
  appearance: { mode: 'light', status: 'ready', message: null },
}));
setFileWindow({ width: 360, height: 640 });
vi.mock('react-native-nitro-google-signin', () => ({ GoogleSignInButton: 'GoogleSignInButton' }));
vi.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
vi.mock('expo-font', () => ({ useFonts: () => [true, null] }));
vi.mock('@expo-google-fonts/outfit/400Regular', () => ({ Outfit_400Regular: 1 }));
vi.mock('@expo-google-fonts/outfit/500Medium', () => ({ Outfit_500Medium: 1 }));
vi.mock('@expo-google-fonts/outfit/600SemiBold', () => ({ Outfit_600SemiBold: 1 }));
vi.mock('@expo-google-fonts/outfit/700Bold', () => ({ Outfit_700Bold: 1 }));
vi.mock('@expo-google-fonts/ibm-plex-mono/500Medium', () => ({ IBMPlexMono_500Medium: 1 }));
vi.mock('./runtime', () => ({
  get controller() {
    return runtime.controller;
  },
  appearance: {
    subscribe: () => () => undefined,
    getSnapshot: () => runtime.appearance,
    restore: async () => undefined,
    select: async () => undefined,
  },
  configurationReady: true,
  environment: {
    label: 'Local development · fictional data',
    apiOrigin: 'http://localhost:4138',
    webOrigin: 'http://localhost:4138',
  },
  googleSignInEnabled: false,
}));

const { default: App } = await import('../App');
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const alex = { id: 'a00000000000000000000001', name: 'Alex Rao', email: 'a@x.test', image: null };
const sam = { _id: 'a00000000000000000000002', name: 'Sam Chen', email: 's@x.test', image: null };
const maple = 'b00000000000000000000001',
  lisbon = 'b00000000000000000000002',
  tagId = 'c00000000000000000000001';
const iso = '2026-09-27T10:00:00.000Z';
const group = (id: string, name: string, category: string) => ({
  _id: id,
  name,
  createdBy: alex.id,
  category,
  defaultCurrency: 'INR',
  members: [
    { user: { ...alex, _id: alex.id }, role: 'admin', joinedAt: iso },
    { user: sam, role: 'member', joinedAt: iso },
  ],
  tags: [{ _id: tagId, name: 'Shared', isArchived: false, createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
});
const groups = [group(maple, 'Maple House', 'home'), group(lisbon, 'Lisbon Offsite', 'work')];
const expenseId = 'e00000000000000000000001';
// A saved Expense in Maple House, opened by its record.
const expense = {
  _id: expenseId,
  group: maple,
  revision: 0,
  description: 'Water bill',
  amount: 30,
  amountMinor: 3000,
  moneyVersion: 1,
  currency: 'INR',
  paidBy: [{ user: { _id: alex.id, name: alex.name, image: null }, amount: 30, amountMinor: 3000 }],
  splitBetween: [
    { user: { _id: alex.id, name: alex.name, image: null }, amount: 15, amountMinor: 1500 },
    { user: { _id: sam._id, name: sam.name, image: null }, amount: 15, amountMinor: 1500 },
  ],
  splitMethod: 'equal',
  date: iso,
  createdAt: iso,
  updatedAt: iso,
  category: 'housing',
  tagId,
  tag: 'Shared',
  notes: '',
  isDeleted: false,
  editHistory: [],
};
const json = (body: unknown, status = 200) => Response.json(body, { status });

/** One phone: its stored session and saved views outlive each controller, as across restarts. */
function device() {
  const clock = { now: new Date(2026, 8, 27, 10, 42).getTime() };
  const network = {
    online: true,
    session: 200,
    noGroups: false,
    noActivity: false,
    /** Home's figures hold Alex's balance in each Group too. */
    groupBalances: false,
    /** Groups that refuse Alex (403): Alex has lost them. */
    refused: [] as string[],
  };
  /** The saved copies can't be removed, as on a full or read-only disk. */
  const storage = { failRemoval: false };
  let cookie: string | null = null,
    owner: string | null = null,
    identity: unknown = null,
    untrusted: unknown = null;
  const cache = new Map<string, unknown>(),
    drafts = new Map<string, unknown>();
  const holds: { prefix: string; arrive: () => void; response: Promise<void> }[] = [];
  const respond = (path: string, method: string): FetchResponse => {
    if (path.endsWith('/sign-out')) return json({ success: true });
    if (path.endsWith('/sign-in'))
      return new Response(JSON.stringify({ user: alex }), {
        headers: { 'Set-Cookie': 'better-auth.session_token=test.signature; Path=/; HttpOnly' },
      });
    if (path.endsWith('/get-session'))
      return network.session === 200
        ? json({ user: alex, session: { userId: alex.id, expiresAt: '2030-01-01T00:00:00Z' } })
        : json({}, network.session);
    if (path === '/api/groups') return json({ data: network.noGroups ? [] : groups, status: 200 });
    if (path === '/api/user/balances')
      return json({
        data: {
          buckets: network.noGroups ? [] : [{ currency: 'INR', youOwe: 30, youAreOwed: 0 }],
          ...(network.groupBalances && {
            groups: [
              { groupId: maple, balances: [{ currency: 'INR', balance: -30 }] },
              { groupId: lisbon, balances: [] },
            ],
          }),
        },
        status: 200,
      });
    // Sam's invitation to Cedar Flat, a Household Alex hasn't joined.
    if (path === '/api/join/deadbeef')
      return json({
        data: {
          _id: 'b00000000000000000000003',
          name: 'Cedar Flat',
          category: 'home',
          memberCount: 1,
        },
        status: 200,
      });
    const id = /^\/api\/groups\/([a-f\d]{24})/.exec(path)?.[1];
    const found = groups.find((item) => item._id === id);
    if (!found) return json({}, 404);
    if (network.refused.includes(found._id)) return json({}, 403);
    if (path === `/api/groups/${id}`) return json({ data: found, status: 200 });
    if (path === `/api/groups/${maple}/expenses/${expenseId}`)
      return json({ data: expense, status: 200 });
    if (path === `/api/groups/${id}/expenses` && method === 'POST')
      return json({ data: { _id: 'e00000000000000000000009', group: id }, status: 201 }, 201);
    if (path.startsWith(`/api/groups/${id}/expenses?`))
      return json({
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
    if (path === `/api/groups/${id}/balances`)
      return json({
        status: 200,
        data: {
          byCurrency: [
            {
              currency: 'INR',
              balances: [
                { user: { ...alex, _id: alex.id }, balance: -30 },
                { user: sam, balance: 30 },
              ],
              debts: [{ from: { ...alex, _id: alex.id }, to: sam, amount: 30 }],
            },
          ],
        },
      });
    if (path.startsWith(`/api/groups/${id}/activity?`))
      return json({
        status: 200,
        data: {
          activities: network.noActivity
            ? []
            : [
                {
                  _id: 'd00000000000000000000001',
                  group: id,
                  actor: { _id: alex.id, name: alex.name },
                  type: 'group_created',
                  createdAt: iso,
                  metadata: {},
                },
              ],
          pagination: network.noActivity
            ? { page: 1, limit: 20, total: 0, totalPages: 0 }
            : { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      });
    return json({}, 404);
  };
  const controller = () =>
    createMobileController(
      {
        apiBaseUrl: 'http://localhost:4138',
        authOrigin: 'http://localhost:4138',
        developmentPersonaEnabled: true,
      },
      {
        now: () => clock.now,
        newSubmissionKey: () => 'app-states-test-0001',
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
        savedQueries: savedQueriesIn(cache, {
          remove: async (account, path) => {
            if (storage.failRemoval) throw new Error('The device storage is full');
            cache.delete(account + path);
          },
        }),
        readCache: {
          retainGroups: async () => undefined,
          invalidateGroup: async () => undefined,
          invalidateLedger: async () => undefined,
          load: async (account, key) => structuredClone(cache.get(account + key) ?? null),
          save: async (account, key, value) => {
            cache.set(account + key, structuredClone(value));
          },
          clear: async () => cache.clear(),
        },
        expenseDrafts: {
          load: async (account, id) => structuredClone(drafts.get(`${account}:${id}`) ?? null),
          save: async (account, id, value) => {
            drafts.set(`${account}:${id}`, structuredClone(value));
          },
          remove: async (account, id) => {
            drafts.delete(`${account}:${id}`);
          },
          clear: async () => drafts.clear(),
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
          // Saved copies this phone couldn't remove, recorded for the next start (#212).
          untrustedCopies: {
            load: async () => structuredClone(untrusted),
            save: async (value) => {
              untrusted = structuredClone(value);
            },
            clear: async () => {
              untrusted = null;
            },
          },
          // As the app registers them: sign-out and an account change clear the saved copies.
          stores: [{ clear: async () => cache.clear() }],
        },
        fetch: async (url, init) => {
          const path = new URL(url).pathname + new URL(url).search;
          if (!network.online) throw new Error('Offline');
          const index = holds.findIndex((item) => path.startsWith(item.prefix));
          if (index >= 0) {
            const [item] = holds.splice(index, 1);
            item.arrive();
            await item.response;
            // The connection may have dropped while it waited.
            if (!network.online) throw new Error('Offline');
          }
          return respond(path, init.method ?? 'GET');
        },
      },
    );
  return {
    clock,
    network,
    storage,
    controller,
    /** The saved copy of `path` on this phone, as stored. */
    saved: (path: string) => cache.get(alex.id + path) ?? null,
    /** The next request starting with `prefix` waits until released. */
    hold(prefix: string) {
      let arrive!: () => void;
      let release!: () => void;
      const reached = new Promise<void>((resolve) => {
        arrive = resolve;
      });
      const response = new Promise<void>((resolve) => {
        release = resolve;
      });
      holds.push({ prefix, arrive, response });
      return { reached, release };
    },
    /** The saved session as an earlier version saved it: the cookie alone, unverified (#200). */
    unverifySession() {
      cookie = cookie && (decodeStoredSession(cookie, false)?.cookie ?? cookie);
    },
  };
}

let screen: ReactTestRenderer | null = null;
const consoleError = console.error;
beforeEach(() => {
  // Controller snapshots published between act scopes are the behaviour under test.
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const message = String(args[0]);
    if (message.includes('not wrapped in act') || message.includes('react-test-renderer')) return;
    consoleError(...args);
  });
});
afterEach(() => {
  act(() => screen?.unmount());
  screen = null;
  vi.restoreAllMocks();
});
const settle = (pending?: Promise<unknown>) =>
  act(async () => {
    await pending;
    for (let tick = 0; tick < 10; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

/** Signs in once and reads Maple House, then quits: what this phone has saved. */
async function usedBefore(phone: ReturnType<typeof device>) {
  const first = phone.controller();
  await first.signIn('alex');
  await first.openGroup(maple, true, 'balances');
  await first.openActivity(maple);
  first.dispose();
  return phone.clock.now;
}

/** Starts the App on this phone, which restores the session as on a cold start. */
async function start(phone: ReturnType<typeof device>) {
  runtime.controller = phone.controller();
  await act(async () => {
    screen = create(<App />, { createNodeMock: () => ({ scrollTo: () => undefined }) });
  });
  const root = () => screen!.root;
  const hosts = (match: (props: Record<string, unknown>) => boolean) =>
    root().findAll((node) => typeof node.type === 'string' && match(node.props));
  const strings = (nodes: ReactTestInstance[]) =>
    nodes.flatMap((node) => node.children.filter((child) => typeof child === 'string')).join('');
  const texts = (scope: ReactTestInstance) =>
    scope.findAll((node) => (node.type as unknown) === 'Text');
  const text = () => strings(texts(root()));
  const button = (label: string) => {
    const found = hosts(
      (p) =>
        ['button', 'tab'].includes(String(p.accessibilityRole)) && p.accessibilityLabel === label,
    );
    return found.length === 1 ? found[0] : null;
  };
  return {
    text,
    /** The visible destination's own content, below the top bar; and everything else. */
    content: () => {
      const inside = texts(root().findAll((node) => (node.type as unknown) === 'ScrollView')[0]);
      return {
        inside: strings(inside),
        outside: strings(texts(root()).filter((node) => !inside.includes(node))),
      };
    },
    hosts,
    button,
    press: (label: string) => settle(Promise.resolve(button(label)!.props.onPress())),
    /** Starts an action that waits on a held request; the test settles once it is reached. */
    tap: (label: string) => void button(label)!.props.onPress(),
    disabled: (label: string) => button(label)!.props.accessibilityState?.disabled === true,
    progress: () => hosts((p) => p.accessibilityRole === 'progressbar'),
    headers: () =>
      hosts((p) => p.accessibilityRole === 'header').map((node: ReactTestInstance) =>
        node.children.filter((child) => typeof child === 'string').join(''),
      ),
    pull: () =>
      hosts((p) => !!p.refreshControl)[0].props.refreshControl.props as {
        refreshing: boolean;
        onRefresh: () => void;
      },
  };
}

describe('cold start', () => {
  it('shows the saved Home at once, marked as checking, with nothing to open until confirmed', async () => {
    const phone = device();
    const savedAt = await usedBefore(phone);
    phone.clock.now += 60 * 60_000;
    const check = phone.hold('/api/auth/get-session');
    const app = await start(phone);
    await check.reached;
    await settle();

    // The status says what is happening; the saved figures, when they were saved (#332).
    expect(app.content().outside).toContain('Checking…');
    expect(app.content().inside).toContain(`Saved ${refreshedLabel(savedAt)}`);
    expect(app.text()).toContain('Maple House');
    expect(app.text()).not.toContain('Checking your session');
    expect(app.button('Open Maple House, Household · 2 members')).toBeNull();
    expect(app.disabled('Refresh Home')).toBe(true);
    expect(app.disabled('Account and settings')).toBe(true);

    check.release();
    await settle();
    expect(app.text()).not.toContain('Checking…');
    expect(app.button('Open Maple House, Household · 2 members')).not.toBeNull();
  });

  it('replaces the saved Home with sign-in when the session has ended', async () => {
    const phone = device();
    await usedBefore(phone);
    phone.network.session = 401;
    const check = phone.hold('/api/auth/get-session');
    const app = await start(phone);
    await check.reached;
    await settle();
    expect(app.text()).toContain('Maple House');
    check.release();
    await settle();
    expect(app.text()).toContain('Shared expenses.');
    expect(app.text()).not.toContain('Maple House');
  });
});

describe('first load and refresh', () => {
  it('keeps the Group’s top bar during a first load, with one progress bar and placeholders', async () => {
    const phone = device();
    await usedBefore(phone);
    const app = await start(phone);
    await settle();
    const read = phone.hold(`/api/groups/${lisbon}`);
    app.tap('Open Lisbon Offsite, Work · 2 members');
    await read.reached;
    await settle();

    expect(app.headers()[0]).toBe('Lisbon Offsite');
    expect(app.text()).toContain('Work · 2 members · INR');
    expect(app.disabled('Invite people')).toBe(false);
    expect(app.button('Group options')).not.toBeNull();
    expect(app.button('Add expense')).not.toBeNull();
    expect(app.progress().map((bar) => bar.props.accessibilityLabel)).toEqual([
      'Opening Lisbon Offsite',
    ]);
    expect(app.hosts((p) => p.accessibilityLabel === 'Loading this Group')).toHaveLength(1);
    expect(app.hosts((p) => p.accessibilityRole === 'tablist')).toHaveLength(1);
    expect(app.text()).not.toContain('Opening your Group…');
    read.release();
    await settle();
    expect(app.progress()).toHaveLength(0);
  });

  it('keeps a pull on Balances there: Activity shows its own first load', async () => {
    const phone = device();
    await usedBefore(phone);
    const app = await start(phone);
    await settle();
    await app.press('Open Maple House, Household · 2 members');
    await app.press('Balances');
    const expenses = phone.hold(`/api/groups/${maple}/expenses?`);
    app.pull().onRefresh();
    await expenses.reached;
    await settle();
    expect(app.pull().refreshing).toBe(true);

    const activity = phone.hold(`/api/groups/${maple}/activity?`);
    app.tap('Activity');
    await activity.reached;
    await settle();
    expect(app.pull().refreshing).toBe(false);
    expect(app.progress().map((bar) => bar.props.accessibilityLabel)).toEqual(['Loading Activity']);
    activity.release();
    expenses.release();
    await settle();
  });

  it('keeps the top bar whole while refreshing, saying so in each destination’s own slot', async () => {
    const phone = device();
    await usedBefore(phone);
    const app = await start(phone);
    await settle();
    await app.press('Open Maple House, Household · 2 members');
    const refresh = async (path: string, destination: string, cue = /Saved .+ · refreshing/) => {
      if (destination !== 'Expenses') await app.press(destination);
      const read = phone.hold(path);
      await app.press('Group options');
      app.tap('Refresh, Check for the latest changes');
      await read.reached;
      await settle();
      expect(app.headers()[0]).toBe('Maple House');
      expect(app.progress().map((bar) => bar.props.accessibilityLabel)).toEqual(['Refreshing']);
      const { inside, outside } = app.content();
      expect(inside).toMatch(cue);
      expect(outside).not.toContain('refreshing');
      read.release();
      await settle();
      expect(app.progress()).toHaveLength(0);
      expect(app.text()).not.toContain('· refreshing');
    };
    await refresh(`/api/groups/${maple}`, 'Expenses');
    // The Expenses, read beside the Group (#219), have answered: Balances wait to follow them.
    await refresh(
      `/api/groups/${maple}`,
      'Balances',
      /Updating balances\. These figures are from .+ and may change\./,
    );
    await refresh(`/api/groups/${maple}/activity?`, 'Activity');
  });

  it('keeps an empty Home on screen while it refreshes automatically', async () => {
    const phone = device();
    phone.network.noGroups = true;
    const first = phone.controller();
    await first.signIn('alex');
    first.dispose();
    const app = await start(phone);
    await settle();
    expect(app.text()).toContain('A shared space starts here.');

    phone.clock.now += 31_000;
    const read = phone.hold('/api/groups');
    void (runtime.controller as MobileController).refresh('foreground');
    await read.reached;
    await settle();
    expect(app.progress()).toHaveLength(0);
    expect(app.hosts((p) => p.accessibilityLabel === 'Loading your Groups')).toHaveLength(0);
    expect(app.text()).toContain('A shared space starts here.');
    read.release();
    await settle();
    expect(app.text()).toContain('A shared space starts here.');
  });

  it('keeps an empty Activity on screen while it refreshes automatically', async () => {
    const phone = device();
    phone.network.noActivity = true;
    await usedBefore(phone);
    const app = await start(phone);
    await settle();
    await app.press('Open Maple House, Household · 2 members');
    await app.press('Activity');
    expect(app.text()).toContain('No changes yet');

    phone.clock.now += 31_000;
    const read = phone.hold(`/api/groups/${maple}/activity?`);
    void (runtime.controller as MobileController).refresh('foreground');
    await read.reached;
    await settle();
    expect(app.progress()).toHaveLength(0);
    expect(app.hosts((p) => p.accessibilityLabel === 'Loading Activity')).toHaveLength(0);
    expect(app.text()).toContain('No changes yet');
    read.release();
    await settle();
    expect(app.text()).toContain('No changes yet');
  });

  it('keeps Invite available while the Group refreshes', async () => {
    const phone = device();
    await usedBefore(phone);
    const app = await start(phone);
    await settle();
    await app.press('Open Maple House, Household · 2 members');
    const read = phone.hold(`/api/groups/${maple}`);
    await app.press('Group options');
    app.tap('Refresh, Check for the latest changes');
    await read.reached;
    await settle();
    expect(app.text()).toMatch(/Saved .+ · refreshing/);
    expect(app.disabled('Invite people')).toBe(false);
    read.release();
    await settle();
  });
});

describe('offline', () => {
  const kept = 'Your saved data is kept. Connect once to confirm your session.';

  it('says saved data is kept when an unconfirmed session can’t be checked offline (#200)', async () => {
    const phone = device();
    await usedBefore(phone);
    // As after updating from a version that saved the cookie alone.
    phone.unverifySession();
    phone.network.online = false;
    const app = await start(phone);
    await settle();
    expect(app.text()).toContain('Couldn’t check your session');
    expect(app.text()).toContain('Could not reach SplitBook.');
    expect(app.text()).toContain(kept);
    expect(app.button('Try again')).not.toBeNull();
    expect(app.button('Sign out on this device')).not.toBeNull();

    // Connected, Try again confirms the session, and the saved data is still there.
    phone.network.online = true;
    await app.press('Try again');
    expect(app.text()).not.toContain('Couldn’t check your session');
    expect(app.text()).toContain('Maple House');
  });

  it('keeps every other session error’s own copy (#200)', async () => {
    const phone = device();
    await usedBefore(phone);
    phone.network.session = 500;
    const app = await start(phone);
    await settle();
    expect(app.text()).toContain('Couldn’t check your session');
    expect(app.text()).toContain('The server could not complete this request. Please try again.');
    expect(app.text()).not.toContain(kept);
  });

  it('shows one offline banner, each view’s saved time, and why each write waits', async () => {
    const phone = device();
    const savedAt = await usedBefore(phone);
    phone.clock.now += 60 * 60_000;
    phone.network.online = false;
    const app = await start(phone);
    await settle();
    const saved = `Saved ${refreshedLabel(savedAt)}`;
    expect(app.text()).toContain('You’re offline');
    expect(app.text()).toContain(
      `What’s shown was saved on this device at ${refreshedLabel(savedAt)}`,
    );
    expect(app.text()).toContain(saved);

    await app.press('Open Maple House, Household · 2 members');
    expect(app.text().match(/You’re offline/g)).toHaveLength(1);
    expect(app.text()).toContain(saved);
    expect(app.disabled('Invite people. Inviting needs a connection')).toBe(true);

    await app.press('Balances');
    expect(app.text()).toContain(saved);
    const record = app.button('Record your payment to Sam Chen')!;
    expect(record.props.accessibilityState).toEqual({ disabled: true });
    expect(record.props.accessibilityHint).toBe('Recording a payment needs a connection.');

    await app.press('Activity');
    expect(app.text()).toContain(saved);

    await app.press('Expenses');
    await app.press('Add expense');
    expect(app.text().match(/You’re offline/g)).toHaveLength(1);
    const save = app.button('Save expense')!;
    expect(save.props.accessibilityState).toEqual({ disabled: true });
    expect(save.props.accessibilityHint).toBe('Saving needs a connection.');
    expect(app.text()).toContain('Saving needs a connection.');
    expect(app.button('Try again')).not.toBeNull();
  });

  it('keeps Delete expense disabled offline, with the confirmation still open (#200)', async () => {
    const phone = device();
    const first = phone.controller();
    await first.signIn('alex');
    await first.openExpense(maple, expenseId);
    first.dispose();
    phone.network.online = false;
    const app = await start(phone);
    await settle();
    await settle((runtime.controller as MobileController).openExpense(maple, expenseId));
    /** The sheet showing now, and a button in it. */
    const sheet = () => app.hosts((p) => p.transparent === true && p.visible === true)[0];
    const inSheet = (label: string) =>
      sheet().findAll(
        (node) =>
          typeof node.type === 'string' &&
          node.props.accessibilityRole === 'button' &&
          node.props.accessibilityLabel === label,
      )[0];
    await app.press('Expense options');
    await settle(Promise.resolve(inSheet('Delete expense').props.onPress()));
    expect(app.text()).toContain('Delete this Expense?');
    const remove = inSheet('Delete expense');
    expect(remove.props.accessibilityState).toEqual({ disabled: true });
    expect(remove.props.accessibilityHint).toBe('Saving needs a connection.');
    const shown = sheet()
      .findAll((node) => (node.type as unknown) === 'Text')
      .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
      .join('');
    expect(shown).toContain('Saving needs a connection.');
    expect((runtime.controller as MobileController).getSnapshot().expense.status).toBe(
      'delete-review',
    );
  });

  it('keeps Create disabled offline, with the Group form’s entries (#200)', async () => {
    const phone = device();
    await usedBefore(phone);
    phone.network.online = false;
    const app = await start(phone);
    await settle();
    await app.press('New Group');
    const name = app.hosts((p) => p.accessibilityLabel === 'Trip name, required')[0];
    await settle(Promise.resolve(name.props.onChangeText('Cabin Weekend')));
    const create = app.button('Create trip')!;
    expect(create.props.accessibilityState).toEqual({ disabled: true });
    expect(create.props.accessibilityHint).toBe('Saving needs a connection.');
    expect(app.text()).toContain('Saving needs a connection.');
    expect(app.hosts((p) => p.accessibilityLabel === 'Trip name, required')[0].props.value).toBe(
      'Cabin Weekend',
    );
  });

  /**
   * Sam's invitation, ready, opened while Home's Groups list was read again; the connection then
   * dropped before the list answered, so the app counts itself offline.
   */
  async function invitationOffline() {
    const phone = device();
    await usedBefore(phone);
    const app = await start(phone);
    await settle();
    const controller = runtime.controller as MobileController;
    const list = phone.hold('/api/groups');
    const pulling = controller.refresh('pull');
    await list.reached;
    await settle(controller.openInvitation('http://localhost:4138/join/deadbeef'));
    expect(app.disabled('Join Group')).toBe(false);
    expect(app.text()).not.toContain('Joining needs a connection.');
    phone.network.online = false;
    list.release();
    await settle(pulling);
    return { phone, app };
  }

  it('keeps Join disabled while offline, saying why (#286)', async () => {
    const { app } = await invitationOffline();
    const join = app.button('Join Group')!;
    expect(join.props.accessibilityState).toEqual({ disabled: true });
    expect(join.props.accessibilityHint).toBe('Joining needs a connection.');
    expect(app.text()).toContain('Joining needs a connection.');
    expect(app.text()).toContain('Cedar Flat');
  });

  it('checks the session again on a pull over the invitation, then offers Join (#286)', async () => {
    const { phone, app } = await invitationOffline();
    // The connection is back. A pull checks the session before the invitation is read again.
    phone.network.online = true;
    const check = phone.hold('/api/auth/get-session');
    expect(app.hosts((p) => !!p.refreshControl)).toHaveLength(1);
    void app.pull().onRefresh();
    await check.reached;
    await settle();
    expect(app.pull().refreshing).toBe(true);
    expect(app.disabled('Join Group')).toBe(true);

    check.release();
    await settle();
    expect(app.pull().refreshing).toBe(false);
    const join = app.button('Join Group')!;
    expect(join.props.accessibilityState).toEqual({ disabled: false });
    expect(join.props.accessibilityHint).toBeUndefined();
    expect(app.text()).not.toContain('Joining needs a connection.');
    expect(app.text()).toContain('Cedar Flat');
  });

  it('says a Group never opened here isn’t available offline, keeping its navigation', async () => {
    const phone = device();
    await usedBefore(phone);
    phone.network.online = false;
    const app = await start(phone);
    await settle();
    await app.press('Open Lisbon Offsite, Work · 2 members');

    expect(app.headers()).toEqual(
      expect.arrayContaining(['Lisbon Offsite', 'Not available offline']),
    );
    expect(app.text()).toContain('Lisbon Offsite hasn’t been opened on this phone yet');
    expect(app.text()).not.toContain('You’re offline');
    expect(app.button('Add expense')).toBeNull();
    expect(app.hosts((p) => p.accessibilityRole === 'tablist')).toHaveLength(1);
    expect(app.progress()).toHaveLength(0);

    phone.network.online = true;
    await app.press('Try again');
    expect(app.text()).not.toContain('Not available offline');
    expect(app.text()).toContain('No expenses yet');
  });

  it('says a Month never opened here isn’t available offline, below the saved Group', async () => {
    const phone = device();
    await usedBefore(phone);
    phone.network.online = false;
    const app = await start(phone);
    await settle();
    await app.press('Open Maple House, Household · 2 members');
    await app.press('Previous month');
    expect(app.text()).toContain('August 2026 hasn’t been opened on this phone yet.');
    expect(app.text().match(/You’re offline/g)).toHaveLength(1);
    expect(app.button('Try again')).not.toBeNull();
    expect(app.progress()).toHaveLength(0);
    // Add expense stays, and the content leaves room to scroll the message clear of it.
    const action = app.button('Add expense')!.props.style({ pressed: false });
    const navigation = app.hosts((p) => p.accessibilityRole === 'tablist')[0].props.style;
    const content = app.hosts((p) => p.refreshControl !== undefined)[0].props.contentContainerStyle;
    expect(content.paddingBottom).toBeGreaterThan(
      action.bottom - navigation.minHeight + action.minHeight,
    );
  });

  it('says Activity never opened here isn’t available offline, with nothing floating over it', async () => {
    const phone = device();
    await usedBefore(phone);
    const first = phone.controller();
    await first.restore();
    await first.openGroup(lisbon);
    first.dispose();
    phone.network.online = false;
    const app = await start(phone);
    await settle();
    await app.press('Open Lisbon Offsite, Work · 2 members');
    expect(app.text()).toContain('No expenses yet');
    await app.press('Activity');
    expect(app.text()).toContain('This Group’s activity hasn’t been opened on this phone yet.');
    expect(app.button('Try again')).not.toBeNull();
    expect(app.button('Add expense')).toBeNull();
  });
});

describe('Home says what is true, without jumps (#332)', () => {
  const controller = () => runtime.controller as MobileController;
  const notSaved = {
    balances: 'Your balances aren’t saved on this phone. Connect to load them.',
    groups: 'Your Groups aren’t saved on this phone. Connect to load them.',
  };
  /** The top bar as rendered, and its text: the row that holds Refresh Home. */
  const topBar = () => {
    const holding = (
      node: ReactTestRendererJSON | string,
      parent: ReactTestRendererJSON | null,
    ): ReactTestRendererJSON | null => {
      if (typeof node === 'string') return null;
      if (node.props.accessibilityLabel === 'Refresh Home') return parent;
      for (const child of node.children ?? []) {
        const found = holding(child, node);
        if (found) return found;
      }
      return null;
    };
    const tree = screen!.toJSON();
    const bar = (Array.isArray(tree) ? tree : [tree]).reduce<ReactTestRendererJSON | null>(
      (found, node) => found ?? (node && holding(node, null)),
      null,
    )!;
    const words = (node: ReactTestRendererJSON | string): string =>
      typeof node === 'string' ? node : (node.children ?? []).map(words).join('');
    return { bar, text: words(bar) };
  };

  it('labels a restored copy of the balances “Saved” until the server answers, then “Updated”', async () => {
    const phone = device();
    const savedAt = await usedBefore(phone);
    phone.clock.now += 60 * 60_000;
    const check = phone.hold('/api/auth/get-session');
    const app = await start(phone);
    await check.reached;
    await settle();
    const saved = `Saved ${refreshedLabel(savedAt)}`;
    expect(app.content().inside).toContain(saved);
    expect(app.text()).not.toContain('Updated');

    // The session is confirmed and the figures are read again: until they answer, what is
    // shown is still this phone's copy.
    const figures = phone.hold('/api/user/balances');
    check.release();
    await figures.reached;
    await settle();
    expect(app.content().inside).toContain(saved);
    expect(app.text()).not.toContain('Updated');

    figures.release();
    await settle();
    expect(app.content().inside).toContain(`Updated ${refreshedLabel(phone.clock.now)}`);
    expect(app.text()).not.toContain(saved);
  });

  it('says only “Refreshing…” above figures read in this session while they are read again', async () => {
    const phone = device();
    await usedBefore(phone);
    const app = await start(phone);
    await settle();
    const read = `Updated ${refreshedLabel(phone.clock.now)}`;
    expect(app.content().inside).toContain(read);

    phone.clock.now += 5 * 60_000;
    const figures = phone.hold('/api/user/balances');
    app.tap('Refresh Home');
    await figures.reached;
    await settle();
    expect(app.content().outside).toContain('Refreshing…');
    expect(app.content().inside).toContain(read);
    expect(app.text()).not.toContain('Saved');

    figures.release();
    await settle();
    expect(app.text()).not.toContain('Refreshing…');
    expect(app.content().inside).toContain(`Updated ${refreshedLabel(phone.clock.now)}`);
  });

  // On a 360×640dp phone at 130% text, "Refreshing…" wrapped onto two lines on the device
  // (#332 device check, C6): the widths here are calibrated to what it measured there.
  it.each([1, 1.3])(
    'keeps the status beside the wordmark on one line, at %s× text',
    async (scale) => {
      setWindow({ fontScale: scale });
      const phone = device();
      await usedBefore(phone);
      phone.clock.now += 60 * 60_000;
      const check = phone.hold('/api/auth/get-session');
      await start(phone);
      await check.reached;
      await settle();
      // Laid out at its natural width, the top bar fits a 360dp phone, so its status needs no
      // second line; past that, it is one line that shrinks to fit rather than wrap or lose a word.
      const fits = (status: string) => {
        const { bar, text } = topBar();
        expect(layoutWidth(bar, scale)).toBeLessThanOrEqual(360);
        expect(text).toContain(status);
        const [line] = findHosts(
          bar,
          (props, type) => type === 'Text' && props.numberOfLines === 1,
        );
        expect(line?.props).toMatchObject({ numberOfLines: 1, adjustsFontSizeToFit: true });
        expect(line?.children).toEqual([status]);
      };
      fits('Checking…');

      const figures = phone.hold('/api/user/balances');
      check.release();
      await figures.reached;
      await settle();
      fits('Refreshing…');
      figures.release();
      await settle();
    },
  );

  /**
   * Each Group row's slot after its tile and title, as wide as it lays out (0 for a row without
   * one). Rows are found by their label, so only rows that open.
   */
  const trailing = () =>
    findHosts(screen!.toJSON(), (props) =>
      String(props.accessibilityLabel ?? '').startsWith('Open '),
    ).map((row) => {
      const slot = row.children?.[2];
      // To a hundredth of a dp: sums of character widths aren't exact.
      return typeof slot === 'object' ? Math.round(layoutWidth(slot) * 100) / 100 : 0;
    });

  it('holds each Group’s balance in its row while Home’s figures are read after the list', async () => {
    const phone = device();
    phone.network.groupBalances = true;
    const app = await start(phone);
    await settle();
    // As after a sign-out: nothing saved, so the list lands first and the figures after it.
    const figures = phone.hold('/api/user/balances');
    const signingIn = controller().signIn('alex');
    await figures.reached;
    await settle();
    expect(app.text()).toContain('Lisbon Offsite');
    const width = Math.round(balanceWidth(1) * 100) / 100;
    expect(trailing()).toEqual([width, width]);

    figures.release();
    await settle(signingIn);
    expect(app.text()).toContain('₹30.00you owe');
    expect(app.text()).toContain('Settled up');
    // The balances took the places held for them: the names were laid out once.
    expect(trailing()).toEqual([width, width]);
  });

  it('holds each Group’s balance in its row while its figures wait for the list', async () => {
    const phone = device();
    await usedBefore(phone);
    // Home's figures have no saved copy, so the saved list shows with its balances unknown.
    await changed(phone);
    phone.network.online = true;
    // Confirmed online, Home reads its list again before its figures, which wait for it.
    const list = phone.hold('/api/groups');
    const app = await start(phone);
    await list.reached;
    await settle();
    expect(app.text()).not.toContain('Checking…');
    expect(app.text()).toContain('Lisbon Offsite');
    const width = Math.round(balanceWidth(1) * 100) / 100;
    expect(trailing()).toEqual([width, width]);
    list.release();
    await settle();
  });

  it('labels this phone’s copy “Saved” while it stands in for the first read after a sign-in', async () => {
    const phone = device();
    const savedAt = await usedBefore(phone);
    phone.clock.now += 60 * 60_000;
    // The session has ended; signing in again reads Home with this phone's copy on screen.
    phone.network.session = 401;
    const app = await start(phone);
    await settle();
    phone.network.session = 200;
    const figures = phone.hold('/api/user/balances');
    const signingIn = controller().signIn('alex');
    await figures.reached;
    await settle();
    expect(app.content().inside).toContain(`Saved ${refreshedLabel(savedAt)}`);
    expect(app.text()).not.toContain('Updated');
    figures.release();
    await settle(signingIn);
    expect(app.content().inside).toContain(`Updated ${refreshedLabel(phone.clock.now)}`);
  });

  // A Badge keeps a hair space after its label; a status line doesn't.
  const badge = (label: string) => `${label}\u200a`;

  it('marks only this phone’s copy of the balances “Saved” while offline, with the badge', async () => {
    const phone = device();
    const savedAt = await usedBefore(phone);
    phone.network.online = false;
    const app = await start(phone);
    await settle();
    expect(app.content().inside).toContain(badge(`Saved ${refreshedLabel(savedAt)}`));
    expect(app.text()).not.toContain('Updated');
  });

  it('says one true thing of balances read in this session, offline after a change removed their copy', async () => {
    const phone = device();
    await usedBefore(phone);
    const app = await start(phone);
    await settle();
    const readAt = refreshedLabel(phone.clock.now);
    // Alex saves an Expense, which removes Home's saved figures; the connection drops before
    // they are read again, and Alex goes back to Home.
    await settle(controller().openExpense(maple));
    await settle(controller().updateExpenseDraft({ description: 'Gas bill', amount: '12', tagId }));
    const figures = phone.hold('/api/user/balances');
    const saving = controller().saveExpense();
    await figures.reached;
    phone.network.online = false;
    figures.release();
    await settle(saving);
    expect(phone.saved('/api/user/balances')).toBeNull();
    await settle(Promise.resolve(controller().back()));

    expect(app.content().inside).toContain('You owe');
    expect(app.content().inside).toContain(`Updated ${readAt}`);
    expect(app.text()).not.toContain(`Saved ${readAt}`);
    expect(app.content().inside).toContain(
      `Couldn’t refresh your balances, and this phone no longer keeps a copy of them. Showing your balances from ${readAt}.`,
    );
    expect(app.text()).not.toContain('This view was not saved');
    // Home says it's offline, but nothing shown is this phone's copy, so not that it was saved.
    expect(app.text()).toContain('You’re offlineConnect to load the latest.');
    expect(app.text()).not.toContain('What’s shown was saved');
  });

  it('says the same beside the badge of a saved copy a change has since removed', async () => {
    const phone = device();
    const savedAt = await usedBefore(phone);
    const app = await start(phone);
    await settle();
    phone.clock.now += 60 * 60_000;
    // Offline on Home, this phone's copy stands in for the figures.
    phone.network.online = false;
    await settle(controller().refreshHome());
    const saved = badge(`Saved ${refreshedLabel(savedAt)}`);
    expect(app.content().inside).toContain(saved);
    // Alex opens a Group, reconnects, pulls and saves an Expense, which removes that copy; the
    // connection drops before Home's figures are read again, and Alex goes back to Home.
    await app.press('Open Maple House, Household · 2 members');
    phone.network.online = true;
    await settle(controller().refresh('pull'));
    await settle(controller().openExpense(maple));
    await settle(controller().updateExpenseDraft({ description: 'Gas bill', amount: '12', tagId }));
    const figures = phone.hold('/api/user/balances');
    const saving = controller().saveExpense();
    await figures.reached;
    phone.network.online = false;
    figures.release();
    await settle(saving);
    expect(phone.saved('/api/user/balances')).toBeNull();
    await settle(Promise.resolve(controller().back()));

    expect(app.content().inside).toContain(saved);
    expect(app.content().inside).toContain(
      `Couldn’t refresh your balances, and this phone no longer keeps a copy of them. Showing your balances from ${refreshedLabel(savedAt)}.`,
    );
    expect(app.text()).toContain('You’re offline');
  });

  it.each(['removed', 'withheld'] as const)(
    'says what is true of the Groups on screen, offline after losing a Group %s their copy',
    async (copy) => {
      const phone = device();
      await usedBefore(phone);
      const app = await start(phone);
      await settle();
      // Offline, Home's list is read again: this phone's copy stands in for it.
      phone.network.online = false;
      await settle(controller().checkCreatedGroups());
      // Back online, Alex opens Lisbon Offsite, which refuses Alex now. Losing it removes Home's
      // saved copies, or withholds them on a phone that can't remove them (#212, #323).
      phone.storage.failRemoval = copy === 'withheld';
      phone.network.online = true;
      phone.network.refused.push(lisbon);
      await app.press('Open Lisbon Offsite, Work · 2 members');
      // The connection drops before Home is read again.
      phone.network.online = false;
      await settle(Promise.resolve(controller().back()));

      expect(phone.saved('/api/groups') === null).toBe(copy === 'removed');
      expect(app.text()).toContain('Maple House');
      expect(app.text()).not.toContain('Lisbon Offsite');
      expect(app.text()).toContain(
        'Couldn’t load your GroupsThis phone no longer keeps a copy of them. Showing previously verified Groups.',
      );
      expect(app.text()).not.toContain('This view was not saved');
      // The list on screen is still this phone's earlier copy, and the banner says so.
      expect(app.text()).toContain('What’s shown was saved on this device');
    },
  );

  it('keeps the offline banner over saved figures beside a list read in this session', async () => {
    const phone = device();
    const savedAt = await usedBefore(phone);
    const app = await start(phone);
    await settle();
    // Offline, only the figures are read again: this phone's copy stands in for them.
    phone.network.online = false;
    await settle(controller().refreshHome());
    expect(app.content().inside).toContain(badge(`Saved ${refreshedLabel(savedAt)}`));
    expect(app.text()).toContain('You’re offline');
    expect(app.text()).toContain('What’s shown was saved on this device');
  });

  it('keeps the offline banner over an empty Groups list and its saved figures', async () => {
    const phone = device();
    phone.network.noGroups = true;
    const first = phone.controller();
    await first.signIn('alex');
    first.dispose();
    phone.network.online = false;
    const app = await start(phone);
    await settle();
    expect(app.text()).toContain('A shared space starts here.');
    expect(app.text()).toContain('Nothing outstanding in your Groups');
    expect(app.text()).toContain('You’re offlineWhat’s shown was saved on this device');
  });

  it('says the balances and Groups aren’t saved, offline after a sign-out cleared them', async () => {
    const phone = device();
    await usedBefore(phone);
    const app = await start(phone);
    await settle();
    await settle(controller().signOut());
    expect(phone.saved('/api/groups')).toBeNull();
    expect(phone.saved('/api/user/balances')).toBeNull();

    // Alex signs in again; the connection drops before Home is read.
    const list = phone.hold('/api/groups');
    const signingIn = controller().signIn('alex');
    await list.reached;
    phone.network.online = false;
    list.release();
    await settle(signingIn);
    expect(app.text()).toContain(notSaved.balances);
    expect(app.text()).toContain(notSaved.groups);
    expect(app.text()).not.toContain('yet');
    // Home says it's offline; nothing shown was saved on this phone, so nothing says it was.
    expect(app.text()).toContain('You’re offlineConnect to load the latest.');
    expect(app.text()).not.toContain('What’s shown was saved');
  });

  /**
   * Alex saves an Expense in Maple House, which makes Home's saved figures obsolete (M2-2). They
   * are read again after it, but the connection drops first, and the app is closed.
   */
  async function changed(phone: ReturnType<typeof device>) {
    const first = phone.controller();
    await first.restore();
    await first.openExpense(maple);
    await first.updateExpenseDraft({ description: 'Gas bill', amount: '12', tagId });
    const figures = phone.hold('/api/user/balances');
    const saving = first.saveExpense();
    await figures.reached;
    phone.network.online = false;
    figures.release();
    await saving;
    expect(first.getSnapshot().expense.status).toBe('saved');
    await settle();
    first.dispose();
  }

  it('says the balances aren’t saved, offline after a change removed their copy', async () => {
    const phone = device();
    await usedBefore(phone);
    await changed(phone);
    expect(phone.saved('/api/user/balances')).toBeNull();

    const app = await start(phone);
    await settle();
    expect(app.text()).toContain('You’re offlineWhat’s shown was saved on this device');
    expect(app.text()).toContain('Maple House');
    expect(app.text()).toContain(notSaved.balances);
    expect(app.text()).not.toContain('yet');
  });

  it('says the balances aren’t saved, offline while their copy is withheld (#323)', async () => {
    const phone = device();
    await usedBefore(phone);
    // The phone can't remove the obsolete copy: it stays on the device, never shown (#212).
    phone.storage.failRemoval = true;
    await changed(phone);
    expect(phone.saved('/api/user/balances')).not.toBeNull();

    const app = await start(phone);
    await settle();
    expect(phone.saved('/api/user/balances')).not.toBeNull();
    expect(app.text()).toContain('Maple House');
    expect(app.text()).toContain(notSaved.balances);
    expect(app.text()).not.toContain('You owe');
    expect(app.text()).not.toContain('yet');
  });
});
