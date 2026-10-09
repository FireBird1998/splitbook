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
import { balanceWidth, HomeBalances } from './ui/home';
import { refreshFeedback, refreshedLabel } from './ui/refresh-feedback';
import { findHosts, flatten, layoutHeight, layoutWidth } from './test-utils/layout';
import { loop, setFileWindow, setReduceMotion, setWindow, timing } from './test-utils/native';
import { progressHeight, sweepTrack } from './ui/compact';
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
    /** Groups that answer without Alex among their members: Alex was removed from them. */
    removed: [] as string[],
    /** Paths the server fails with a 500: exact, or every path a prefix ending in `?` starts. */
    failing: [] as string[],
    /** Alex has recorded the ₹30.00 owed to Sam: Balances are settled. */
    paid: false,
  };
  /**
   * The saved copies can't be removed, as on a full or read-only disk; or the drafts can't be
   * read (`failDraftRead`).
   */
  const storage = { failRemoval: false, failDraftRead: false };
  let cookie: string | null = null,
    owner: string | null = null,
    identity: unknown = null,
    untrusted: unknown = null;
  const cache = new Map<string, unknown>(),
    drafts = new Map<string, unknown>(),
    payments = new Map<string, unknown>();
  const holds: { prefix: string; arrive: () => void; response: Promise<void> }[] = [];
  /** Every request this phone sent, as `METHOD /path?query`. */
  const sent: string[] = [];
  /** Storage calls to hold, in order: a slow device's next reads, writes or removals. */
  const slow: { arrive: () => void; response: Promise<void> }[] = [];
  /** A call to this phone's saved copies or drafts: it waits while a storage hold is set. */
  const disk = async () => {
    const held = slow.shift();
    if (!held) return;
    held.arrive();
    await held.response;
  };
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
          buckets: network.noGroups
            ? []
            : [{ currency: 'INR', youOwe: network.paid ? 0 : 30, youAreOwed: 0 }],
          // Home's figures say which Groups they cover, as SplitBook's do (#333): with no Group
          // balances, none, so each row's balance stays unknown.
          groups: network.groupBalances
            ? [
                { groupId: maple, balances: [{ currency: 'INR', balance: -30 }] },
                { groupId: lisbon, balances: [] },
              ]
            : [],
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
    if (
      network.failing.some((failing) =>
        failing.endsWith('?') ? path.startsWith(failing) : path === failing,
      )
    )
      return json({}, 500);
    if (path === `/api/groups/${id}`)
      return json({
        data: network.removed.includes(found._id)
          ? { ...found, members: found.members.filter(({ user }) => user.name !== alex.name) }
          : found,
        status: 200,
      });
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
    if (path === `/api/groups/${id}/settlements` && method === 'POST') {
      network.paid = true;
      return json(
        {
          status: 201,
          data: {
            _id: 'f00000000000000000000001',
            group: id,
            paidBy: { _id: alex.id, name: alex.name, image: null },
            paidTo: { _id: sam._id, name: sam.name, image: null },
            createdBy: { _id: alex.id, name: alex.name, image: null },
            amount: 30,
            amountMinor: 3000,
            moneyVersion: 1,
            currency: 'INR',
            note: '',
            createdAt: iso,
            updatedAt: iso,
          },
        },
        201,
      );
    }
    if (path === `/api/groups/${id}/balances`)
      return json({
        status: 200,
        data: {
          byCurrency: [
            {
              currency: 'INR',
              balances: [
                { user: { ...alex, _id: alex.id }, balance: network.paid ? 0 : -30 },
                { user: sam, balance: network.paid ? 0 : 30 },
              ],
              debts: network.paid ? [] : [{ from: { ...alex, _id: alex.id }, to: sam, amount: 30 }],
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
        // A payment's retry identity, stored before it is sent.
        settlementAttempts: {
          load: async (account, id) => structuredClone(payments.get(`${account}:${id}`) ?? null),
          save: async (account, id, value) => {
            payments.set(`${account}:${id}`, structuredClone(value));
          },
          remove: async (account, id) => {
            payments.delete(`${account}:${id}`);
          },
          clear: async () => payments.clear(),
        },
        savedQueries: savedQueriesIn(cache, {
          load: async (account, path) => {
            await disk();
            return structuredClone(cache.get(account + path) ?? null);
          },
          remove: async (account, path) => {
            await disk();
            if (storage.failRemoval) throw new Error('The device storage is full');
            cache.delete(account + path);
          },
        }),
        expenseDrafts: {
          load: async (account, id) => {
            await disk();
            if (storage.failDraftRead) throw new Error('The device storage is unreadable');
            return structuredClone(drafts.get(`${account}:${id}`) ?? null);
          },
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
          stores: [{ clear: async () => cache.clear() }, { clear: async () => payments.clear() }],
        },
        fetch: async (url, init) => {
          const path = new URL(url).pathname + new URL(url).search;
          sent.push(`${init.method ?? 'GET'} ${path}`);
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
    sent,
    storage,
    controller,
    /** The saved copy of `path` on this phone, as stored. */
    saved: (path: string) => cache.get(alex.id + path) ?? null,
    /** This phone loses its saved copy of `path`, as after a write that failed. */
    lose: (path: string) => cache.delete(alex.id + path),
    /** The phone's next call to its saved copies or drafts waits until released. */
    holdStorage() {
      let arrive!: () => void;
      let release!: () => void;
      const reached = new Promise<void>((resolve) => {
        arrive = resolve;
      });
      const response = new Promise<void>((resolve) => {
        release = resolve;
      });
      slow.push({ arrive, response });
      return { reached, release };
    },
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

describe('sign-in and start-up show progress while they wait (#335)', () => {
  /** What the App's controller publishes. */
  const shown = () => (runtime.controller as MobileController).getSnapshot();
  /** The host just above the screen's content: the progress bar, or the room it keeps. */
  const aboveContent = (content: string) => {
    const json = screen!.toJSON() as ReactTestRendererJSON;
    const [frame] = findHosts(json, () => true).filter((node) =>
      (node.children ?? []).some((child) => typeof child !== 'string' && child.type === content),
    );
    const children = frame!.children as ReactTestRendererJSON[];
    return children[children.findIndex((child) => child.type === content) - 1]!;
  };
  const spinners = () =>
    screen!.root.findAll((node) => (node.type as unknown) === 'ActivityIndicator');
  const icons = (node: ReactTestInstance) =>
    node.findAll((child) => (child.type as unknown) === 'Ionicons').map((icon) => icon.props.name);
  /** The polite live regions' text, as a screen reader hears it change. */
  const announced = (app: Awaited<ReturnType<typeof start>>) =>
    app
      .hosts((p) => p.accessibilityLiveRegion === 'polite')
      .map((node) =>
        node
          .findAll((child) => (child.type as unknown) === 'Text')
          .flatMap((text) => text.children.filter((part) => typeof part === 'string'))
          .join(''),
      );
  /** Nothing moves: no loop or fade started, no spinner, and the bar's segment where it rests. */
  const still = (app: Awaited<ReturnType<typeof start>>) => {
    expect(loop).not.toHaveBeenCalled();
    expect(timing).not.toHaveBeenCalled();
    expect(spinners()).toEqual([]);
    for (const bar of app.progress()) {
      const [segment] = bar.findAll((node) => (node.type as unknown) === 'AnimatedView');
      const [{ translateX }] = flatten(segment!.props.style).transform as [
        { translateX: { multiply: [{ value: number }] } },
      ];
      expect(translateX.multiply[0].value).toBe(sweepTrack.rest);
    }
  };

  it('shows the progress bar while the session is checked, saying what it checks', async () => {
    const phone = device();
    await usedBefore(phone);
    // A session without a verified account shows no saved Home: the check has the screen.
    phone.unverifySession();
    const check = phone.hold('/api/auth/get-session');
    const app = await start(phone);
    await check.reached;
    await settle();

    expect(app.progress().map((bar) => bar.props.accessibilityLabel)).toEqual([
      'Checking your session',
    ]);
    expect(layoutHeight(aboveContent('KeyboardAvoidingView'))).toBe(progressHeight);
    expect(announced(app)).toContain('Checking your session…');
    // The bar is the one progress cue: no spinner beside it.
    expect(spinners()).toEqual([]);

    check.release();
    await settle();
    expect(app.text()).not.toContain('Checking your session');
    expect(app.progress()).toEqual([]);
    expect(app.text()).toContain('Maple House');
  });

  it('shows the progress bar over the saved Home while its session is checked, labelled as saved', async () => {
    const phone = device();
    const savedAt = await usedBefore(phone);
    phone.clock.now += 60 * 60_000;
    const check = phone.hold('/api/auth/get-session');
    const app = await start(phone);
    await check.reached;
    await settle();

    expect(app.progress().map((bar) => bar.props.accessibilityLabel)).toEqual([
      'Checking your session',
    ]);
    expect(aboveContent('ScrollView').props.accessibilityRole).toBe('progressbar');
    // #332's labels: the top bar says what is happening, the saved figures when they were saved.
    expect(app.content().outside).toContain('Checking…');
    expect(app.content().inside).toContain(`Saved ${refreshedLabel(savedAt)}`);
    expect(app.text()).not.toContain('Updated');

    // Confirmed, Home is read again: the bar goes with the check, and the top bar says
    // "Refreshing…" over the saved figures until they're answered (#332). Its list and figures
    // are read together (#333).
    const list = phone.hold('/api/groups');
    const figures = phone.hold('/api/user/balances');
    check.release();
    await list.reached;
    await settle();
    expect(app.progress()).toEqual([]);
    expect(aboveContent('ScrollView').props.accessibilityRole).toBeUndefined();
    expect(layoutHeight(aboveContent('ScrollView'))).toBe(progressHeight);
    expect(app.content().outside).toContain('Refreshing…');
    expect(app.text()).not.toContain('Checking…');
    expect(app.content().inside).toContain(`Saved ${refreshedLabel(savedAt)}`);
    expect(app.text()).not.toContain('Updated');

    list.release();
    figures.release();
    await settle();
    expect(app.progress()).toEqual([]);
    expect(app.content().inside).toContain(`Updated ${refreshedLabel(phone.clock.now)}`);
  });

  it('keeps the session check still with reduce motion on, its states still shown', async () => {
    setReduceMotion(true);
    const phone = device();
    const savedAt = await usedBefore(phone);
    phone.clock.now += 60 * 60_000;
    const check = phone.hold('/api/auth/get-session');
    const app = await start(phone);
    await check.reached;
    await settle();

    expect(app.progress().map((bar) => bar.props.accessibilityLabel)).toEqual([
      'Checking your session',
    ]);
    expect(app.content().outside).toContain('Checking…');
    expect(app.content().inside).toContain(`Saved ${refreshedLabel(savedAt)}`);
    still(app);

    // The fresh figures replace the saved ones at once.
    check.release();
    await settle();
    expect(app.content().inside).toContain(`Updated ${refreshedLabel(phone.clock.now)}`);
    still(app);
  });

  it('shows the progress bar and the chosen persona busy until Home opens; the others wait', async () => {
    const phone = device();
    const app = await start(phone);
    await settle();
    expect(app.progress()).toEqual([]);
    // The bar's room stays while nothing runs, so the options never move.
    expect(layoutHeight(aboveContent('KeyboardAvoidingView'))).toBe(progressHeight);

    const posted = phone.hold('/api/auth/demo-persona/sign-in');
    const check = phone.hold('/api/auth/get-session');
    app.tap('Continue as Alex Rivera');
    await posted.reached;
    await settle();

    const waiting = () => {
      expect(shown().auth).toMatchObject({
        status: 'signing-in',
        option: 'alex',
      });
      expect(app.progress().map((bar) => bar.props.accessibilityLabel)).toEqual(['Signing in']);
      expect(layoutHeight(aboveContent('KeyboardAvoidingView'))).toBe(progressHeight);
      // The chosen option: at full strength, busy and saying so, with a spinner for its arrow.
      const chosen = app.button('Signing in as Alex Rivera')!;
      expect(chosen.props.accessibilityState).toEqual({
        disabled: true,
        busy: true,
      });
      expect(chosen.props.disabled).toBe(true);
      expect(flatten(chosen.props.style).opacity).toBe(1);
      expect(chosen.findAll((node) => (node.type as unknown) === 'ActivityIndicator')).toHaveLength(
        1,
      );
      expect(icons(chosen)).not.toContain('arrow-forward-outline');
      expect(app.button('Continue as Alex Rivera')).toBeNull();
      // The others are disabled and dimmed.
      for (const other of ['Continue as Sam Chen', 'Continue as Priya Shah']) {
        expect(app.button(other)!.props.accessibilityState).toEqual({
          disabled: true,
          busy: false,
        });
        expect(app.button(other)!.props.disabled).toBe(true);
        expect(flatten(app.button(other)!.props.style).opacity).toBe(0.45);
      }
      expect(announced(app)).toContain('Signing in as Alex Rivera…');
    };
    waiting();
    // The sign-in's session check is part of the same wait.
    posted.release();
    await check.reached;
    await settle();
    waiting();

    check.release();
    await settle();
    expect(shown().auth).toEqual({
      status: 'authenticated',
      user: alex,
      message: null,
    });
    expect(app.text()).not.toContain('Signing in');
    expect(app.progress()).toEqual([]);
    expect(app.text()).toContain('Maple House');
  });

  it('ends the busy state when a sign-in fails, so any option can be chosen again', async () => {
    const phone = device();
    const app = await start(phone);
    await settle();
    const posted = phone.hold('/api/auth/demo-persona/sign-in');
    app.tap('Continue as Sam Chen');
    await posted.reached;
    await settle();
    expect(app.button('Signing in as Sam Chen')!.props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
    expect(app.progress()).toHaveLength(1);

    // The connection drops before the reply.
    phone.network.online = false;
    posted.release();
    await settle();
    expect(shown().auth).toEqual({
      status: 'signed-out',
      user: null,
      message: 'Could not reach SplitBook. Check your connection and try again.',
    });
    expect(app.progress()).toEqual([]);
    expect(layoutHeight(aboveContent('KeyboardAvoidingView'))).toBe(progressHeight);
    expect(spinners()).toEqual([]);
    expect(app.text()).not.toContain('Signing in');
    for (const name of ['Alex Rivera', 'Sam Chen', 'Priya Shah']) {
      const option = app.button(`Continue as ${name}`)!;
      // Busy is sent as false, not dropped: Android keeps a key no longer sent, and Sam's row
      // read "busy" on the emulator after this failure while it showed ready.
      expect(option.props.accessibilityState).toEqual({ disabled: false, busy: false });
      expect(flatten(option.props.style).opacity).toBe(1);
      expect(icons(option)).toEqual(['arrow-forward-outline']);
    }
  });

  it('keeps a sign-in still with reduce motion on: the busy option shows a still mark', async () => {
    setReduceMotion(true);
    const phone = device();
    const app = await start(phone);
    await settle();
    const posted = phone.hold('/api/auth/demo-persona/sign-in');
    app.tap('Continue as Priya Shah');
    await posted.reached;
    await settle();

    expect(app.progress().map((bar) => bar.props.accessibilityLabel)).toEqual(['Signing in']);
    const chosen = app.button('Signing in as Priya Shah')!;
    expect(chosen.props.accessibilityState).toEqual({
      disabled: true,
      busy: true,
    });
    expect(icons(chosen)).toContain('hourglass-outline');
    expect(app.disabled('Continue as Alex Rivera')).toBe(true);
    expect(app.disabled('Continue as Sam Chen')).toBe(true);
    expect(announced(app)).toContain('Signing in as Priya Shah…');
    still(app);

    posted.release();
    await settle();
    expect(app.text()).toContain('Maple House');
    still(app);
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
    // Its Expenses' own placeholders, in the shape they keep once it answers (#219).
    expect(app.hosts((p) => p.accessibilityLabel === 'Loading all-time expenses')).toHaveLength(1);
    expect(app.hosts((p) => p.accessibilityRole === 'tablist')).toHaveLength(1);
    expect(app.text()).not.toContain('Opening your Group…');
    read.release();
    await settle();
    expect(app.progress()).toHaveLength(0);
  });

  it('keeps a pull on Balances there: Activity says its own read', async () => {
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
    // This phone's copy of Activity shows at once while it is read (M3-1, #222), so its own bar
    // says it is refreshing.
    expect(app.progress().map((bar) => bar.props.accessibilityLabel)).toEqual(['Refreshing']);
    expect(app.text()).toMatch(/Saved \d/);
    activity.release();
    expenses.release();
    await settle();
  });

  it('keeps the top bar whole while refreshing, with one progress bar over each destination’s time', async () => {
    const phone = device();
    await usedBefore(phone);
    const app = await start(phone);
    await settle();
    await app.press('Open Maple House, Household · 2 members');
    // Expenses and Balances keep when they were read; the progress bar says they're read (#219).
    const refresh = async (path: string, destination: string, cue = /Updated \d/) => {
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
    // The Expenses, read beside the Group (#219), have answered: Balances wait to follow them,
    // with their time, in their place.
    await refresh(`/api/groups/${maple}`, 'Balances', /Updated \d/);
    // Activity keeps when its events were read too, as the others do (#222).
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
    expect(app.progress().map((bar) => bar.props.accessibilityLabel)).toEqual(['Refreshing']);
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
    expect(record.props.accessibilityState).toEqual({ disabled: true, busy: false });
    expect(record.props.accessibilityHint).toBe('Recording a payment needs a connection.');

    await app.press('Activity');
    expect(app.text()).toContain(saved);

    await app.press('Expenses');
    await app.press('Add expense');
    expect(app.text().match(/You’re offline/g)).toHaveLength(1);
    const save = app.button('Save expense')!;
    expect(save.props.accessibilityState).toEqual({ disabled: true, busy: false });
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
    expect(remove.props.accessibilityState).toEqual({ disabled: true, busy: false });
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
    expect(create.props.accessibilityState).toEqual({ disabled: true, busy: false });
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
    expect(join.props.accessibilityState).toEqual({ disabled: true, busy: false });
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
    expect(join.props.accessibilityState).toEqual({ disabled: false, busy: false });
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
    expect(app.text()).toContain('Lisbon Offsite isn’t saved on this phone. Connect to load it.');
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
    expect(app.text()).toContain(
      'Expenses in August 2026 aren’t saved on this phone. Connect to load them.',
    );
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
    // True whether it was never saved here, removed or withheld (#280 item 2, #222).
    expect(app.text()).toContain(
      'This Group’s activity isn’t saved on this phone. Connect to load it.',
    );
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

  it('holds each Group’s balance in its row while its figures are read beside the list', async () => {
    const phone = device();
    await usedBefore(phone);
    // Home's figures have no saved copy, so the saved list shows with its balances unknown.
    await changed(phone);
    phone.network.online = true;
    // Confirmed online, Home reads its list and its figures again, together (#333).
    const list = phone.hold('/api/groups');
    const figures = phone.hold('/api/user/balances');
    const app = await start(phone);
    await list.reached;
    await settle();
    expect(app.text()).not.toContain('Checking…');
    expect(app.text()).toContain('Lisbon Offsite');
    const width = Math.round(balanceWidth(1) * 100) / 100;
    expect(trailing()).toEqual([width, width]);
    list.release();
    await settle();
    expect(trailing()).toEqual([width, width]);
    figures.release();
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

    // Alex signs in again; the connection drops before Home's list and figures are answered.
    const list = phone.hold('/api/groups');
    const figures = phone.hold('/api/user/balances');
    const signingIn = controller().signIn('alex');
    await Promise.all([list.reached, figures.reached]);
    phone.network.online = false;
    list.release();
    figures.release();
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

describe('A Group says what is true, without jumps (#219)', () => {
  const controller = () => runtime.controller as MobileController;
  const open = {
    [maple]: 'Open Maple House, Household · 2 members',
    [lisbon]: 'Open Lisbon Offsite, Work · 2 members',
  };
  /** Signed in once, with Home read: no Group's view has been opened on this phone. */
  async function signedIn(phone: ReturnType<typeof device>) {
    const first = phone.controller();
    await first.signIn('alex');
    first.dispose();
  }
  /**
   * The scrolling content as it lays out on this 360dp phone: its children stacked with its gap,
   * as Yoga stacks them (`layoutHeight`). Sheets lie over it and take no room.
   */
  const contentHeight = (fontScale = 1) => {
    const [scroll] = findHosts(screen!.toJSON(), (_props, type) => type === 'ScrollView');
    const style = flatten(scroll!.props.contentContainerStyle);
    const children = (scroll!.children ?? []).filter(
      (child): child is ReactTestRendererJSON =>
        typeof child !== 'string' && child.type !== 'Modal',
    );
    const room = 360 - 2 * (style.paddingHorizontal as number);
    return (
      children.reduce((sum, child) => sum + layoutHeight(child, fontScale, room), 0) +
      (style.gap as number) * Math.max(0, children.length - 1)
    );
  };
  /** What the scrolling content announces as loading. */
  const busy = () =>
    findHosts(
      findHosts(screen!.toJSON(), (_props, type) => type === 'ScrollView')[0]!,
      (props) => (props.accessibilityState as { busy?: boolean } | undefined)?.busy === true,
    ).map((node) => node.props.accessibilityLabel);
  /** The icons beside the words `words`: in the row, card or notice that holds them. */
  const iconsBeside = (words: string) => {
    let node: ReactTestInstance | null = screen!.root.findAll(
      (candidate) =>
        (candidate.type as unknown) === 'Text' &&
        candidate.children
          .filter((child) => typeof child === 'string')
          .join('')
          .includes(words),
    )[0]!;
    const icons = (at: ReactTestInstance) =>
      at.findAll((candidate) => (candidate.type as unknown) === 'Ionicons');
    while (node && !icons(node).length) node = node.parent;
    return node ? icons(node).map((icon) => icon.props.name as string) : [];
  };
  /**
   * The scrolling content's text as the member sees it: without what is laid out only to hold a
   * place, such as a skeleton's sizing copy, unseen and unread by TalkBack and VoiceOver alike
   * (`importantForAccessibility` and `accessibilityElementsHidden`). Hidden from one of them only,
   * it counts as seen.
   */
  const words = (node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null): string =>
    node === null
      ? ''
      : typeof node === 'string'
        ? node
        : Array.isArray(node)
          ? node.map(words).join('')
          : node.props.accessibilityElementsHidden === true &&
              node.props.importantForAccessibility === 'no-hide-descendants'
            ? ''
            : (node.children ?? []).map(words).join('');
  const seen = () =>
    words(findHosts(screen!.toJSON(), (_props, type) => type === 'ScrollView')[0]!);
  /**
   * What the screen's statuses are fading out (#331): text a reader may still see for a moment
   * beside what replaced it.
   */
  const fading = () =>
    screen!.root
      .findAll((node) => (node.type as unknown) === 'AnimatedText')
      .map((node) => node.children.join(''));
  /**
   * From the first publish `shows` is true of, this phone's next storage call waits until
   * released: what that publish drew stays on screen while the reads after it wait on storage.
   */
  const slowFrom = (phone: ReturnType<typeof device>, shows: () => boolean) => {
    let held: ReturnType<ReturnType<typeof device>['holdStorage']> | null = null;
    let reached!: () => void;
    const holding = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const stop = controller().subscribe(() => {
      if (held || !shows()) return;
      held = phone.holdStorage();
      void held.reached.then(reached);
    });
    return {
      reached: holding.then(stop),
      release: () => held?.release(),
    };
  };
  /** Group options, then Refresh: started, not waited for. */
  const refresh = async (app: Awaited<ReturnType<typeof start>>) => {
    await app.press('Group options');
    app.tap('Refresh, Check for the latest changes');
  };

  /**
   * Alex opens `groupId` and saves an Expense in it, which removes its ledger's saved copies
   * (M2-2); the connection drops before its Expenses are read again, and the app is closed.
   * `withheld`: the phone can't remove them, so they stay on it, never shown (#212, #323).
   */
  async function changedOffline(
    phone: ReturnType<typeof device>,
    groupId: string,
    withheld: boolean,
  ) {
    const first = phone.controller();
    await first.restore();
    await first.openGroup(groupId, true, 'balances');
    phone.storage.failRemoval = withheld;
    await first.openExpense(groupId);
    await first.updateExpenseDraft({ description: 'Gas bill', amount: '12', tagId });
    const expenses = phone.hold(`/api/groups/${groupId}/expenses?`);
    const saving = first.saveExpense();
    await expenses.reached;
    phone.network.online = false;
    expenses.release();
    await saving;
    expect(first.getSnapshot().expense.status).toBe('saved');
    await settle();
    first.dispose();
  }

  // Item 1: true offline wording (#280 item 2, for Expenses and Balances).
  it('says a Group isn’t saved on this phone, offline after a sign-out cleared it', async () => {
    const phone = device();
    await usedBefore(phone);
    const app = await start(phone);
    await settle();
    await settle(controller().signOut());
    await settle(controller().signIn('alex'));
    // The connection drops before Maple House is opened again.
    phone.network.online = false;
    await app.press(open[maple]);
    expect(app.text()).toContain('Maple House isn’t saved on this phone. Connect to load it.');
    expect(app.text()).not.toContain('been opened');
    expect(app.text()).not.toContain('yet');
  });

  it.each([
    [
      'removed',
      maple,
      'Expenses in September 2026 aren’t saved on this phone. Connect to load them.',
    ],
    [
      'withheld',
      maple,
      'Expenses in September 2026 aren’t saved on this phone. Connect to load them.',
    ],
    ['removed', lisbon, 'These expenses aren’t saved on this phone. Connect to load them.'],
  ] as const)(
    'says the Expenses and Balances aren’t saved, offline after a change %s their copies (%s)',
    async (copy, groupId, expenses) => {
      const phone = device();
      await usedBefore(phone);
      await changedOffline(phone, groupId, copy === 'withheld');
      const app = await start(phone);
      await settle();
      await app.press(open[groupId]);
      expect(app.content().inside).toContain(expenses);
      // The Group itself is this phone's copy: the banner says what was saved (#219).
      expect(app.text()).toContain('You’re offlineWhat’s shown was saved on this device at');
      await app.press('Balances');
      expect(app.content().inside).toContain(
        'These balances aren’t saved on this phone. Connect to load them.',
      );
      expect(app.text()).not.toContain('been opened');
      expect(app.text()).not.toContain('yet');
    },
  );

  // Items 1 and 3: what stays on screen once its copy was removed was read in this session.
  it('says one true thing of Expenses and Balances read in this session, offline after a change removed their copies', async () => {
    const phone = device();
    await usedBefore(phone);
    const app = await start(phone);
    await settle();
    await app.press(open[maple]);
    const readAt = refreshedLabel(phone.clock.now);
    await settle(controller().openExpense(maple));
    await settle(controller().updateExpenseDraft({ description: 'Gas bill', amount: '12', tagId }));
    const expenses = phone.hold(`/api/groups/${maple}/expenses?`);
    const saving = controller().saveExpense();
    await expenses.reached;
    phone.network.online = false;
    expenses.release();
    await settle(saving);

    const notice =
      'Couldn’t refresh these expenses, and this phone no longer keeps a copy of them. Showing September 2026 expenses from';
    expect(app.content().inside).toContain(`${notice} ${readAt}.`);
    expect(app.content().inside).toContain(`Updated ${readAt}`);
    expect(app.text()).not.toContain('Saved');
    expect(app.text()).not.toContain('This view was not saved');
    // It couldn't be read because SplitBook can't be reached: the offline icon says so.
    expect(iconsBeside(notice)).toEqual(['cloud-offline-outline']);
    // Nothing shown is this phone's copy: the banner says only that the app is offline.
    expect(app.text()).toContain('You’re offlineConnect to load the latest.');

    await app.press('Balances');
    expect(app.content().inside).toContain(
      `Couldn’t refresh these balances, and this phone no longer keeps a copy of them. Showing balances from ${readAt}.`,
    );
    expect(app.content().inside).toContain(`Updated ${readAt}`);
    expect(app.text()).not.toContain('Saved');
  });

  // Item 2: the offline banner.
  it('says what was saved only over a Group restored from this phone, and nothing once SplitBook answers', async () => {
    const phone = device();
    const savedAt = await usedBefore(phone);
    phone.network.online = false;
    const app = await start(phone);
    await settle();
    // Maple House shows this phone's copy: the banner says when it was saved, as its badge does.
    await app.press(open[maple]);
    expect(app.text()).toContain(
      `You’re offlineWhat’s shown was saved on this device at ${refreshedLabel(savedAt)}`,
    );
    expect(app.content().inside).toContain(`Saved ${refreshedLabel(savedAt)}\u200a`);
    await app.press('Back to Home');

    // The connection is back. Lisbon Offsite was never opened here: its read checks the session
    // first, with nothing of it saved on screen.
    phone.network.online = true;
    const check = phone.hold('/api/auth/get-session');
    app.tap(open[lisbon]);
    await check.reached;
    await settle();
    expect(app.text()).toContain('You’re offlineConnect to load the latest.');
    expect(app.text()).not.toContain('What’s shown was saved');

    // SplitBook answered the check: the app is online while the Group and its Expenses are
    // still read.
    const expenses = phone.hold(`/api/groups/${lisbon}/expenses?`);
    const read = phone.hold(`/api/groups/${lisbon}`);
    check.release();
    await Promise.all([read.reached, expenses.reached]);
    await settle();
    expect(app.text()).not.toContain('You’re offline');
    expect(app.progress().map((bar) => bar.props.accessibilityLabel)).toEqual([
      'Opening Lisbon Offsite',
    ]);
    read.release();
    expenses.release();
    await settle();
    expect(app.text()).not.toContain('You’re offline');
  });

  it('says it is offline again when the connection drops after SplitBook answered the session check', async () => {
    const phone = device();
    const savedAt = await usedBefore(phone);
    phone.network.online = false;
    const app = await start(phone);
    await settle();
    phone.network.online = true;
    const check = phone.hold('/api/auth/get-session');
    app.tap(open[maple]);
    await check.reached;
    await settle();
    const expenses = phone.hold(`/api/groups/${maple}/expenses?`);
    const read = phone.hold(`/api/groups/${maple}`);
    check.release();
    await Promise.all([read.reached, expenses.reached]);
    await settle();
    expect(app.text()).not.toContain('You’re offline');

    // The reads then fail: this phone's copy answers for them, and the banner says so again.
    phone.network.online = false;
    read.release();
    expenses.release();
    await settle();
    expect(app.text()).toContain(
      `You’re offlineWhat’s shown was saved on this device at ${refreshedLabel(savedAt)}`,
    );
  });

  // Item 3: the summary card's label.
  it('says “Updated” of figures read in this session while they are read again, on Expenses and Balances', async () => {
    const phone = device();
    await usedBefore(phone);
    const app = await start(phone);
    await settle();
    await app.press(open[maple]);
    for (const destination of ['Expenses', 'Balances']) {
      if (destination === 'Balances') await app.press('Balances');
      const readAt = refreshedLabel(phone.clock.now);
      phone.clock.now += 5 * 60_000;
      const read = phone.hold(`/api/groups/${maple}/expenses?`);
      await refresh(app);
      await read.reached;
      await settle();
      expect(app.progress().map((bar) => bar.props.accessibilityLabel)).toEqual(['Refreshing']);
      expect(app.content().inside).toContain(`Updated ${readAt}`);
      expect(app.text()).not.toContain('Saved');
      read.release();
      await settle();
      expect(app.content().inside).toContain(`Updated ${refreshedLabel(phone.clock.now)}`);
    }
  });

  it('labels this phone’s copy of a Group “Saved” while it is read again, then “Updated”', async () => {
    const phone = device();
    const savedAt = refreshedLabel(await usedBefore(phone));
    phone.clock.now += 60 * 60_000;
    const app = await start(phone);
    await settle();
    const expenses = phone.hold(`/api/groups/${maple}/expenses?`);
    const read = phone.hold(`/api/groups/${maple}`);
    app.tap(open[maple]);
    await Promise.all([read.reached, expenses.reached]);
    await settle();
    expect(app.content().inside).toContain(`Saved ${savedAt}`);
    expect(app.text()).not.toContain('refreshing');
    expect(app.text()).not.toContain('Updated');
    await app.press('Balances');
    expect(app.content().inside).toContain(`Saved ${savedAt}`);
    expect(app.text()).not.toContain('Updated');
    read.release();
    expenses.release();
    await settle();
    expect(app.content().inside).toContain(`Updated ${refreshedLabel(phone.clock.now)}`);
    expect(app.text()).not.toContain('Saved');
    await app.press('Expenses');
    expect(app.content().inside).toContain(`Updated ${refreshedLabel(phone.clock.now)}`);
    expect(app.text()).not.toContain('Saved');
  });

  // Item 4: no layout jumps.
  it.each([
    [maple, 'expenses', 1, ['Loading September 2026 expenses']],
    [maple, 'expenses', 1.3, ['Loading September 2026 expenses']],
    [lisbon, 'expenses', 1, ['Loading all-time expenses']],
    [lisbon, 'expenses', 1.3, ['Loading all-time expenses']],
    [maple, 'balances', 1, ['Loading balances']],
    [maple, 'balances', 1.3, ['Loading balances']],
  ] as const)(
    'keeps %s’s %s placeholders in their shape while the Group is first read, at %s× text',
    async (groupId, destination, scale, loading) => {
      setWindow({ fontScale: scale });
      const phone = device();
      await signedIn(phone);
      const app = await start(phone);
      await settle();
      const expenses = phone.hold(`/api/groups/${groupId}/expenses?`);
      const read = phone.hold(`/api/groups/${groupId}`);
      void controller().openGroup(groupId, true, destination);
      await Promise.all([read.reached, expenses.reached]);
      await settle();
      const first = { height: contentHeight(scale), busy: busy() };
      expect(first.busy).toEqual(loading);
      // A Household's Month isn't known yet: its bar has nothing to press.
      const household = groupId === maple && destination === 'expenses';
      if (household)
        for (const label of ['Previous month', 'Next month', 'All time'])
          expect(app.disabled(label), label).toBe(true);

      // The Group answered; its Expenses are still read: nothing moves.
      read.release();
      await settle();
      expect({ height: contentHeight(scale), busy: busy() }).toEqual(first);
      if (household) {
        expect(app.disabled('Previous month')).toBe(false);
        expect(app.disabled('All time')).toBe(false);
      }
      expenses.release();
      await settle();
    },
  );

  // N6: a Group Home doesn't list yet, such as one opened from elsewhere, has no Theme to shape
  // its placeholders by: they take an all-time Group's, the commoner case.
  it('keeps the placeholders’ shape for a Group Home doesn’t list yet', async () => {
    const phone = device();
    phone.network.noGroups = true;
    await signedIn(phone);
    await start(phone);
    await settle();
    const read = phone.hold(`/api/groups/${lisbon}`);
    void controller().openGroup(lisbon);
    await read.reached;
    await settle();
    const first = { height: contentHeight(), busy: busy() };
    expect(first.busy).toEqual(['Loading all-time expenses']);

    // Its Expenses are read once the Group is known: nothing moves meanwhile.
    const expenses = phone.hold(`/api/groups/${lisbon}/expenses?`);
    read.release();
    await expenses.reached;
    await settle();
    expect({ height: contentHeight(), busy: busy() }).toEqual(first);
    expenses.release();
    await settle();
  });

  it.each([1, 1.3])(
    'keeps Balances where they are while they wait for the Expenses to be read again, at %s× text',
    async (scale) => {
      setWindow({ fontScale: scale });
      const phone = device();
      await usedBefore(phone);
      const app = await start(phone);
      await settle();
      await app.press(open[maple]);
      await app.press('Balances');
      const readAt = refreshedLabel(phone.clock.now);
      const height = contentHeight(scale);
      phone.clock.now += 5 * 60_000;
      const expenses = phone.hold(`/api/groups/${maple}/expenses?`);
      await refresh(app);
      await expenses.reached;
      await settle();
      // Balances wait to follow the Expenses: the screen's one progress bar says they're read.
      expect(controller().getSnapshot().financial.balances).toMatchObject({ stale: true });
      expect(contentHeight(scale)).toBe(height);
      expect(app.content().inside).toContain(`Updated ${readAt}`);
      expect(app.text()).not.toContain('Updating');
      expect(app.progress().map((bar) => bar.props.accessibilityLabel)).toEqual(['Refreshing']);
      expenses.release();
      await settle();
      expect(contentHeight(scale)).toBe(height);
      expect(app.content().inside).toContain(`Updated ${refreshedLabel(phone.clock.now)}`);
    },
  );

  it('keeps Home’s balances where they are while they are read again after a Group', async () => {
    const phone = device();
    await usedBefore(phone);
    const app = await start(phone);
    await settle();
    const height = contentHeight();
    await app.press(open[maple]);
    const figures = phone.hold('/api/user/balances');
    // Home's balances as each publish back on Home draws them, before their read starts too.
    const frames: string[] = [];
    const stop = controller().subscribe(() => {
      const shown = controller().getSnapshot();
      if (shown.screen !== 'groups') return;
      let frame!: ReactTestRenderer;
      act(() => {
        frame = create(
          <HomeBalances
            state={shown.home}
            offline={shown.offline.active}
            silent={refreshFeedback(shown).silent}
            onRefresh={() => undefined}
          />,
        );
      });
      frames.push(words(frame.toJSON()));
      act(() => frame.unmount());
    });
    app.tap('Back to Home');
    await figures.reached;
    await settle();
    stop();
    // The Group's Expenses were read since: Home's figures say in place that they're updating,
    // where their time was, from the first frame back, and the top bar stays quiet.
    expect(frames.length).toBeGreaterThan(1);
    for (const frame of frames) expect(frame).toContain('Your balancesUpdating…');
    expect(seen()).toContain('Your balancesUpdating…');
    // Nothing fades from the old time into it.
    expect(fading().filter((text) => text.startsWith('Updated'))).toEqual([]);
    expect(app.content().outside).not.toContain('Refreshing');
    expect(contentHeight()).toBe(height);
    expect(seen()).toContain('Your balancesUpdating…');
    expect(seen()).not.toContain('Updated');
    expect(app.content().outside).not.toContain('Refreshing');
    figures.release();
    await settle();
    expect(contentHeight()).toBe(height);
    expect(seen()).toContain(`Your balancesUpdated ${refreshedLabel(phone.clock.now)}`);
  });

  // B1 and S2: after a payment, Balances and then Home say the figures shown are being updated.
  it.each([1, 1.3])(
    'says Balances and Home are updating after a payment, in place, at %s× text',
    async (scale) => {
      setWindow({ fontScale: scale });
      const phone = device();
      await usedBefore(phone);
      const app = await start(phone);
      await settle();
      const home = contentHeight(scale);
      await app.press(open[maple]);
      await app.press('Balances');
      const readAt = refreshedLabel(phone.clock.now);
      const height = contentHeight(scale);
      expect(seen()).toContain(`All-time balance · INRUpdated ${readAt}You owe₹30.00`);
      expect(seen()).toContain('Suggested paymentsRecord one once it’s paid');

      // Alex records the ₹30.00 owed to Sam; it is confirmed, and Balances are read again after it.
      phone.clock.now += 2 * 60_000;
      await settle(controller().openRecordPayment(alex.id, sam._id, 'INR'));
      const expenses = phone.hold(`/api/groups/${maple}/expenses?`);
      const figures = phone.hold('/api/user/balances');
      const recording = controller().recordSettlement();
      await expenses.reached;
      await settle();
      expect(app.text()).toContain('Payment recorded');
      // The old debt says it is being updated, where its time was, and Record says why it waits,
      // where its caption was: nothing moves.
      expect(seen()).toContain('All-time balance · INRUpdating…You owe₹30.00');
      expect(seen()).toContain('Suggested paymentsRecord once updated');
      expect(seen()).not.toContain(`Updated ${readAt}`);
      expect(app.disabled('Record your payment to Sam Chen')).toBe(true);
      expect(contentHeight(scale)).toBe(height);
      // While Balances themselves are read, too.
      const balances = phone.hold(`/api/groups/${maple}/balances`);
      expenses.release();
      await balances.reached;
      await settle();
      expect(seen()).toContain('All-time balance · INRUpdating…You owe₹30.00');
      expect(contentHeight(scale)).toBe(height);
      balances.release();
      await figures.reached;
      await settle();
      expect(seen()).toContain(`All-time balance · INRUpdated ${refreshedLabel(phone.clock.now)}`);
      expect(seen()).toContain('Settled up');
      expect(seen()).not.toContain('Updating');

      // Home's figures, read before the payment, are read again after it: back on Home they say
      // so in place, and the top bar stays quiet.
      app.tap('Back to Home');
      await settle();
      expect(seen()).toContain('Your balancesUpdating…');
      expect(seen()).not.toContain(`Updated ${readAt}`);
      expect(app.content().outside).not.toContain('Refreshing');
      expect(contentHeight(scale)).toBe(home);
      figures.release();
      await settle(recording);
      expect(seen()).toContain(`Your balancesUpdated ${refreshedLabel(phone.clock.now)}`);
    },
  );

  // Balances' frame gap: a slow device holds the reads after a payment, but not what they say.
  it('says Balances are updating from the frame that says the payment is recorded', async () => {
    const phone = device();
    await usedBefore(phone);
    const app = await start(phone);
    await settle();
    await app.press(open[maple]);
    await app.press('Balances');
    const readAt = refreshedLabel(phone.clock.now);
    phone.clock.now += 2 * 60_000;
    await settle(controller().openRecordPayment(alex.id, sam._id, 'INR'));
    // The payment is confirmed; from the publish that says so, the reads after it wait on this
    // phone's storage.
    const storage = slowFrom(
      phone,
      () => controller().getSnapshot().snackbar?.message === 'Payment recorded',
    );
    const before = phone.sent.length;
    const recording = controller().recordSettlement();
    await storage.reached;
    await settle();
    expect(app.text()).toContain('Payment recorded');
    // Neither the Expenses nor Balances have been asked for since the payment.
    const sent = phone.sent.slice(before);
    const since = sent.slice(sent.indexOf(`POST /api/groups/${maple}/settlements`) + 1);
    expect(since.filter((request) => /\/(expenses\?|balances$)/.test(request))).toEqual([]);
    expect(seen()).toContain('All-time balance · INRUpdating…You owe₹30.00');
    expect(seen()).toContain('Suggested paymentsRecord once updated');
    // Nothing fades from the old time or caption into these: neither is drawn at any opacity
    // beside "Payment recorded".
    expect(fading()).not.toContain(`Updated ${readAt}`);
    expect(fading()).not.toContain('Record one once it’s paid');
    storage.release();
    await settle(recording);
    expect(seen()).toContain(`All-time balance · INRUpdated ${refreshedLabel(phone.clock.now)}`);
  });

  // N2 (MB): once the Expenses are read after a change, they're current, whatever Balances wait on.
  it('says the Expenses are refreshing plainly once read after a change, while Balances still wait', async () => {
    const phone = device();
    await usedBefore(phone);
    const app = await start(phone);
    await settle();
    await app.press(open[maple]);
    phone.clock.now += 2 * 60_000;
    await settle(controller().openExpense(maple));
    await settle(controller().updateExpenseDraft({ description: 'Gas bill', amount: '12', tagId }));
    const balances = phone.hold(`/api/groups/${maple}/balances`);
    const saving = controller().saveExpense();
    await balances.reached;
    await settle();
    // The Expenses were read after the save; Balances, read after them, are still on their way.
    const listedAt = refreshedLabel(phone.clock.now);
    expect(seen()).toContain(`0 expenses this monthUpdated ${listedAt}`);
    phone.clock.now += 60_000;
    const pulled = phone.hold(`/api/groups/${maple}/expenses?`);
    void controller().refresh('pull');
    await pulled.reached;
    await settle();
    expect(seen()).toContain(`0 expenses this monthUpdated ${listedAt}`);
    expect(seen()).not.toContain('Updating');
    pulled.release();
    balances.release();
    await settle(saving);
    await settle();
  });

  // N3 (MD): an automatic refresh says nothing, even of figures a Group's Expenses made stale.
  it('keeps an automatic refresh of Home’s figures silent, stale after a Group', async () => {
    const phone = device();
    await usedBefore(phone);
    const app = await start(phone);
    await settle();
    const readAt = refreshedLabel(phone.clock.now);
    await app.press(open[maple]);
    // Offline back on Home, with no copy of its figures to stand in: they stay, stale.
    phone.lose('/api/user/balances');
    phone.network.online = false;
    await app.press('Back to Home');
    expect(controller().getSnapshot().home).toMatchObject({ status: 'error', stale: true });
    // Back online, the foreground reads them again, automatically.
    phone.network.online = true;
    phone.clock.now += 31_000;
    const figures = phone.hold('/api/user/balances');
    void controller().refresh('foreground');
    await figures.reached;
    await settle();
    expect(controller().getSnapshot().home).toMatchObject({ status: 'loading', stale: true });
    expect(seen()).toContain(`Your balancesUpdated ${readAt}`);
    expect(seen()).not.toContain('Updating');
    figures.release();
    await settle();
  });

  // S1: after a save, the Month's figures say they're being updated until the list is read again.
  it('says the Expenses are updating after an Expense is saved, in place', async () => {
    const phone = device();
    await usedBefore(phone);
    const app = await start(phone);
    await settle();
    await app.press(open[maple]);
    const readAt = refreshedLabel(phone.clock.now);
    const height = contentHeight();
    expect(seen()).toContain(`0 expenses this monthUpdated ${readAt}`);
    phone.clock.now += 2 * 60_000;
    await settle(controller().openExpense(maple));
    await settle(controller().updateExpenseDraft({ description: 'Gas bill', amount: '12', tagId }));
    const expenses = phone.hold(`/api/groups/${maple}/expenses?`);
    const saving = controller().saveExpense();
    await expenses.reached;
    await settle();
    expect(app.text()).toContain('Expense saved');
    expect(seen()).toContain('0 expenses this monthUpdating…');
    expect(seen()).not.toContain(`Updated ${readAt}`);
    expect(contentHeight()).toBe(height);
    expenses.release();
    await settle(saving);
    expect(seen()).toContain(`0 expenses this monthUpdated ${refreshedLabel(phone.clock.now)}`);
    expect(seen()).not.toContain('Updating');
  });

  // S3: the Group itself, read in this session, once this phone has lost its copy.
  it('says what is true of a Group read in this session whose copy this phone lost, refreshed offline', async () => {
    const phone = device();
    await usedBefore(phone);
    const app = await start(phone);
    await settle();
    await app.press(open[maple]);
    const readAt = refreshedLabel(phone.clock.now);
    phone.lose(`/api/groups/${maple}`);
    phone.network.online = false;
    await refresh(app);
    await settle();
    const notice =
      'Couldn’t refresh Maple House, and this phone no longer keeps a copy of it. Showing Maple House from';
    expect(app.content().inside).toContain(`${notice} ${readAt}.`);
    expect(app.text()).not.toContain('This view was not saved');
    expect(iconsBeside(notice)).toEqual(['cloud-offline-outline']);
  });

  // Item 5: the error icon.
  it.each([
    [`/api/groups/${maple}`, 'Showing Maple House from'],
    [`/api/groups/${maple}/expenses?`, 'Showing September 2026 expenses from'],
  ])(
    'marks a refresh the server failed (%s) with the error icon, not the offline cloud',
    async (path, words) => {
      const phone = device();
      await usedBefore(phone);
      const app = await start(phone);
      await settle();
      await app.press(open[maple]);
      phone.network.failing.push(path);
      await refresh(app);
      await settle();
      expect(app.content().inside).toContain(
        `The server could not complete this request. Please try again. ${words}`,
      );
      expect(iconsBeside(words)).toEqual(['alert-circle-outline']);
    },
  );
});

describe('The Expense form and Record payment say what they are doing (#334)', () => {
  const controller = () => runtime.controller as MobileController;
  const openMaple = 'Open Maple House, Household · 2 members';
  const unreachable = 'Could not reach SplitBook. Check your connection and try again.';
  const footnote = 'Records a payment made outside Splitbook. No money moves.';
  /** Maple House on Balances, where Alex owes Sam ₹30.00. */
  async function onBalances() {
    const phone = device();
    await usedBefore(phone);
    const app = await start(phone);
    await settle();
    await app.press(openMaple);
    await app.press('Balances');
    return { phone, app };
  }
  /**
   * Text as the member sees it: without what is laid out only to hold a place, unseen and unread
   * (`importantForAccessibility` and `accessibilityElementsHidden`).
   */
  const words = (node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null): string =>
    node === null
      ? ''
      : typeof node === 'string'
        ? node
        : Array.isArray(node)
          ? node.map(words).join('')
          : node.props.accessibilityElementsHidden === true &&
              node.props.importantForAccessibility === 'no-hide-descendants'
            ? ''
            : (node.children ?? []).map(words).join('');
  /** The Record payment sheet as rendered, while it is open. */
  const sheet = () =>
    findHosts(screen!.toJSON(), (props, type) => type === 'Modal' && props.visible === true).find(
      (modal) =>
        findHosts(modal, (props) => props.accessibilityRole === 'header').some(
          (header) => words(header) === 'Record payment',
        ),
    ) ?? null;
  /** What the open sheet shows. */
  const shown = () => words(sheet());
  /** The open sheet's live hosts labelled `label`, to read their props or press them. */
  const inSheet = (label: string) =>
    screen!.root
      .findAll((node) => (node.type as unknown) === 'Modal' && node.props.visible === true)
      .flatMap((modal) =>
        modal.findAll(
          (node) => typeof node.type === 'string' && node.props.accessibilityLabel === label,
        ),
      );
  /** The open sheet's one button labelled `label`, or null. */
  const button = (label: string) => {
    const found = inSheet(label).filter((node) => node.props.accessibilityRole === 'button');
    return found.length === 1 ? found[0]! : null;
  };
  const progress = () =>
    findHosts(sheet(), (props) => props.accessibilityRole === 'progressbar').map(
      (bar) => bar.props.accessibilityLabel,
    );
  /** How tall the open sheet lays out on this 360dp phone. */
  const sheetHeight = (fontScale = 1) => layoutHeight(sheet(), fontScale, 360);
  /** The payments this phone has sent. */
  const posts = (phone: ReturnType<typeof device>) =>
    phone.sent.filter((request) => request === `POST /api/groups/${maple}/settlements`);

  it('opens a warm new Expense without a network loading screen', async () => {
    const phone = device();
    await usedBefore(phone);
    const app = await start(phone);
    await settle();
    await app.press(openMaple);
    const before = phone.sent.filter((request) => request === `GET /api/groups/${maple}`).length;
    await app.press('Add expense');
    expect(controller().getSnapshot().expense.status).toBe('editing');
    expect(app.text()).not.toContain('Opening a new Expense…');
    expect(app.text()).not.toContain('Opening your draft…');
    expect(phone.sent.filter((request) => request === `GET /api/groups/${maple}`)).toHaveLength(
      before,
    );
  });

  // Item 1: "Opening your draft…" showed for a brand-new Expense.
  it('opens a new Expense without saying “draft”, and says it only for a kept draft', async () => {
    const phone = device();
    await usedBefore(phone);
    const app = await start(phone);
    await settle();
    await app.press(openMaple);
    // Outside the freshness window, the form waits only for the Group's read (#366).
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000);
    let group = phone.hold(`/api/groups/${maple}`);
    void controller().openExpense(maple);
    await group.reached;
    await settle();
    expect(controller().getSnapshot().expense).toMatchObject({ status: 'loading', draft: null });
    expect(app.text()).toContain('Opening a new Expense…');
    expect(app.text()).not.toMatch(/draft/i);
    group.release();
    await settle();
    await settle(controller().updateExpenseDraft({ description: 'Gas bill', amount: '12' }));
    await app.press('Back to Group, keeping your draft');
    expect(controller().getSnapshot().keptDraft).toMatchObject({ groupId: maple });
    // The draft kept for Maple House opens, and says so when its Group needs a read.
    clock.mockReturnValue(Date.now() + 31_000);
    group = phone.hold(`/api/groups/${maple}`);
    void controller().openExpense(maple);
    await group.reached;
    await settle();
    expect(controller().getSnapshot().expense).toMatchObject({
      status: 'loading',
      draft: { description: 'Gas bill' },
    });
    expect(app.text()).toContain('Opening your draft…');
    expect(app.text()).not.toContain('new Expense');
    group.release();
    await settle();
  });

  // Item 1, from review: the Group already knows its draft, before this phone reads it.
  it('says “draft” for a kept draft while this phone still reads it, and not once it is discarded', async () => {
    const phone = device();
    await usedBefore(phone);
    const app = await start(phone);
    await settle();
    await app.press(openMaple);
    await settle(controller().openExpense(maple));
    await settle(controller().updateExpenseDraft({ description: 'Gas bill', amount: '12' }));
    await app.press('Back to Group, keeping your draft');
    expect(controller().getSnapshot().keptDraft).toMatchObject({ groupId: maple });
    // A slow phone: the draft's own read waits, and the form already says what it opens.
    const disk = phone.holdStorage();
    void controller().openExpense(maple);
    await disk.reached;
    await settle();
    expect(controller().getSnapshot().expense).toMatchObject({ status: 'loading', draft: null });
    expect(app.text()).toContain('Opening your draft…');
    expect(app.text()).not.toContain('new Expense');
    disk.release();
    await settle();
    expect(controller().getSnapshot().expense).toMatchObject({
      draft: { description: 'Gas bill' },
    });
    // Discarded, nothing is kept: an expired Group makes this new form wait for a read.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000);
    const group = phone.hold(`/api/groups/${maple}`);
    void controller().discardExpenseDraft();
    await group.reached;
    await settle();
    expect(controller().getSnapshot().expense).toMatchObject({ status: 'loading', draft: null });
    expect(app.text()).toContain('Opening a new Expense…');
    expect(app.text()).not.toMatch(/draft/i);
    group.release();
    await settle();
  });

  it.each(['Group', 'storage'] as const)(
    'says it couldn’t open a new Expense, never a draft, when the %s fails',
    async (failure) => {
      const phone = device();
      await usedBefore(phone);
      const app = await start(phone);
      await settle();
      await app.press(openMaple);
      expect(controller().getSnapshot().keptDraft).toBeNull();
      if (failure === 'Group') {
        vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000);
        phone.network.failing.push(`/api/groups/${maple}`);
      } else phone.storage.failDraftRead = true;
      await settle(controller().openExpense(maple));
      expect(controller().getSnapshot().expense).toMatchObject({
        status: 'blocked',
        draft: null,
        message:
          failure === 'Group'
            ? 'The server could not complete this request. Please try again.'
            : 'Could not open a new Expense. Please try again.',
      });
      expect(app.text()).toContain('Couldn’t open a new Expense');
      expect(app.text()).not.toMatch(/draft/i);
    },
  );

  // Item 2: "Checking the latest balances…" hid the balances already on screen for about 6 s.
  it('shows the chosen payment while the sheet checks the latest balances, with Record waiting, and nothing moves when the check lands', async () => {
    const { phone, app } = await onBalances();
    const before = phone.sent.length;
    const balances = phone.hold(`/api/groups/${maple}/balances`);
    app.tap('Record your payment to Sam Chen');
    await balances.reached;
    await settle();
    // The payment as Balances shows it, locked, under the progress bar, with a quiet status.
    expect(controller().getSnapshot().settlement).toMatchObject({ status: 'loading', draft: null });
    expect(progress()).toEqual(['Checking the latest balances']);
    expect(inSheet('You pay Sam Chen. Suggested ₹30.00.')).toHaveLength(1);
    expect(inSheet('Amount paid, required')[0]!.props).toMatchObject({
      value: '30',
      editable: false,
    });
    const record = button('Record payment ₹30.00')!;
    expect(record.props.accessibilityState).toEqual({ disabled: true, busy: false });
    expect(record.props.accessibilityHint).toBe(
      'Record is available once the latest balances are checked.',
    );
    expect(shown()).toContain('Checking the latest balances…');
    expect(shown()).not.toContain(footnote);
    const checking = [sheetHeight(), sheetHeight(1.3)];
    // A tap that gets through records nothing from figures the check hasn't confirmed.
    record.props.onPress();
    await settle();
    expect(posts(phone)).toEqual([]);

    balances.release();
    await settle();
    expect(controller().getSnapshot().settlement).toMatchObject({
      status: 'editing',
      draft: { amount: '30' },
    });
    expect(progress()).toEqual([]);
    expect(inSheet('Amount paid, required')[0]!.props).toMatchObject({
      value: '30',
      editable: true,
    });
    expect(button('Record payment ₹30.00')!.props.accessibilityState).toEqual({
      disabled: false,
      busy: false,
    });
    expect(shown()).toContain(footnote);
    expect(shown()).not.toContain('Checking');
    expect([sheetHeight(), sheetHeight(1.3)]).toEqual(checking);
    // Only its Balances: the Group its view verified within 30 s stands (#333).
    expect(phone.sent.slice(before)).toEqual([`GET /api/groups/${maple}/balances`]);
  });

  // Item 3 (#331): already true, and kept pinned through the App.
  it('says it is recording, busy, and records once for two taps', async () => {
    const { phone, app } = await onBalances();
    await settle(controller().openRecordPayment(alex.id, sam._id, 'INR'));
    const post = phone.hold(`/api/groups/${maple}/settlements`);
    void button('Record payment ₹30.00')!.props.onPress();
    await post.reached;
    await settle();
    expect(button('Record payment ₹30.00')).toBeNull();
    const recording = button('Recording payment…')!;
    expect(recording.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(recording.props.disabled).toBe(true);
    expect(
      recording.findAll((node) => (node.type as unknown) === 'ActivityIndicator'),
    ).toHaveLength(1);
    expect(shown()).toContain('Recording payment…');
    expect(progress()).toEqual(['Recording payment']);
    // A second tap that gets through sends nothing more.
    recording.props.onPress();
    await settle();
    post.release();
    await settle();
    expect(posts(phone)).toEqual([`POST /api/groups/${maple}/settlements`]);
    expect(app.text()).toContain('Payment recorded');
  });

  // Device check: Check payment read "FM You → FM Former member" until its check landed.
  it('names who pays whom while Check payment checks an unconfirmed payment', async () => {
    const { phone, app } = await onBalances();
    await settle(controller().openRecordPayment(alex.id, sam._id, 'INR'));
    // The payment is sent, and its reply is lost.
    const post = phone.hold(`/api/groups/${maple}/settlements`);
    void button('Record payment ₹30.00')!.props.onPress();
    await post.reached;
    phone.network.online = false;
    post.release();
    await settle();
    expect(controller().getSnapshot().settlement.status).toBe('uncertain');
    phone.network.online = true;
    void controller().back();
    await settle();
    expect(controller().getSnapshot().pendingPayment).toMatchObject({ groupId: maple });
    const balances = phone.hold(`/api/groups/${maple}/balances`);
    app.tap('Check payment');
    await balances.reached;
    await settle();
    expect(controller().getSnapshot().settlement).toMatchObject({
      status: 'loading',
      group: null,
    });
    // The row as drawn, avatars' initials included: who pays whom, as this phone knows them.
    const [row] = inSheet('You pay Sam Chen.');
    expect(
      row!
        .findAll((node) => (node.type as unknown) === 'Text')
        .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
        .join(' '),
    ).toBe('AR You SC Sam Chen');
    expect(shown()).not.toContain('Former member');
    balances.release();
    await settle();
    // Checked: the Group it read names them now.
    expect(controller().getSnapshot().settlement).toMatchObject({
      status: 'uncertain',
      group: { id: maple },
    });
    expect(inSheet('You pay Sam Chen.')).toHaveLength(1);
    expect(posts(phone)).toEqual([`POST /api/groups/${maple}/settlements`]);
  });

  // Final review: a sheet refused on a refresh named people from what this phone knew.
  it('names no one from what this phone knew once a refresh finds Alex removed from the Group', async () => {
    const { phone } = await onBalances();
    await settle(controller().openRecordPayment(alex.id, sam._id, 'INR'));
    expect(inSheet('You pay Sam Chen. Suggested ₹30.00.')).toHaveLength(1);
    phone.network.removed.push(maple);
    await settle(controller().refresh());
    expect(controller().getSnapshot().settlement).toMatchObject({
      status: 'blocked',
      group: null,
      known: {},
    });
    expect(inSheet('You pay Former member. Suggested ₹30.00.')).toHaveLength(1);
    expect(shown()).not.toContain('Sam Chen');
  });

  // Final review, N4: no flow opens the sheet over another Group's view today; if one did, that
  // Group's people would name no one on it.
  it('takes no names from another Group’s view when the sheet opens', async () => {
    const { phone } = await onBalances();
    const lisbonGroup = phone.hold(`/api/groups/${lisbon}`);
    void controller().openSettlements(lisbon);
    await lisbonGroup.reached;
    expect(controller().getSnapshot()).toMatchObject({
      detail: { id: maple },
      financial: { groupId: maple },
      settlement: { groupId: lisbon, status: 'loading' },
    });
    expect(controller().getSnapshot().settlement.known).toEqual({});
    lisbonGroup.release();
    await settle();
  });

  // Item 4: after a network failure the sheet showed only "Could not reach SplitBook…".
  it('offers Try again on the sheet when its check can’t reach SplitBook, keeping the figures, and sends nothing', async () => {
    const { phone, app } = await onBalances();
    phone.network.online = false;
    app.tap('Record your payment to Sam Chen');
    await settle();
    expect(controller().getSnapshot().settlement).toMatchObject({
      status: 'error',
      draft: null,
      attempt: null,
      message: unreachable,
    });
    // Said plainly, not as a payment that may be recorded: nothing was sent.
    expect(shown()).toContain(unreachable);
    expect(shown()).not.toContain('Payment not confirmed');
    expect(inSheet('You pay Sam Chen. Suggested ₹30.00.')).toHaveLength(1);
    expect(inSheet('Amount paid, required')[0]!.props.editable).toBe(false);
    expect(button('Record payment ₹30.00')).toBeNull();
    const retry = button('Try again')!;
    expect(retry.props.accessibilityState).toEqual({ disabled: false, busy: false });
    expect(progress()).toEqual([]);

    // Try again checks again, with the same reads, and Record waits for them.
    phone.network.online = true;
    const before = phone.sent.length;
    const balances = phone.hold(`/api/groups/${maple}/balances`);
    void retry.props.onPress();
    await balances.reached;
    await settle();
    expect(shown()).not.toContain(unreachable);
    expect(progress()).toEqual(['Checking the latest balances']);
    expect(inSheet('You pay Sam Chen. Suggested ₹30.00.')).toHaveLength(1);
    expect(button('Record payment ₹30.00')!.props.accessibilityState).toEqual({
      disabled: true,
      busy: false,
    });
    balances.release();
    await settle();
    expect(controller().getSnapshot().settlement).toMatchObject({
      status: 'editing',
      draft: { paidBy: alex.id, paidTo: sam._id, amount: '30' },
    });
    expect(button('Record payment ₹30.00')!.props.accessibilityState).toEqual({
      disabled: false,
      busy: false,
    });
    // The same check: the Balances, over the Group its view verified within 30 s (#333).
    expect(phone.sent.slice(before)).toEqual([`GET /api/groups/${maple}/balances`]);
    expect(posts(phone)).toEqual([]);
  });
});

// #222 and the loading-state audit (2026-10-07): Activity says what is true of its events, as a
// Group's other destinations do since #219.
describe('Activity says what is true (#222)', () => {
  const controller = () => runtime.controller as MobileController;
  const openMaple = 'Open Maple House, Household · 2 members';
  const activityPage = `/api/groups/${maple}/activity?page=1&limit=20`;

  // #280 item 1: older events stayed on screen, labelled "Saved", after this device's own change.
  it('shows nothing from before this device’s own change when Activity can’t be read offline', async () => {
    const phone = device();
    await usedBefore(phone);
    const app = await start(phone);
    await settle();
    await app.press(openMaple);
    await app.press('Activity');
    expect(app.text()).toContain('created');
    await settle(controller().selectDestination('expenses'));
    await settle(controller().openExpense(maple));
    await settle(controller().updateExpenseDraft({ description: 'Gas bill', amount: '12', tagId }));
    await settle(controller().saveExpense());
    expect(controller().getSnapshot().expense.status).toBe('saved');
    phone.network.online = false;
    await app.press('Activity');
    expect(app.text()).toContain(
      'This Group’s activity isn’t saved on this phone. Connect to load it.',
    );
    expect(app.text()).not.toContain('created');
    expect(app.text()).not.toContain('Saved');
  });

  it('says what was saved only over this phone’s copy, and one true thing of events read in this session', async () => {
    const phone = device();
    await usedBefore(phone);
    const app = await start(phone);
    await settle();
    await app.press(openMaple);
    await app.press('Activity');
    const readAt = refreshedLabel(phone.clock.now);
    expect(app.text()).toContain(`Updated ${readAt}`);
    // This phone no longer keeps a copy of them, and the connection drops.
    phone.lose(activityPage);
    phone.network.online = false;
    await settle(controller().refresh('pull'));
    expect(app.text()).toContain(
      'Couldn’t refresh this Group’s activity, and this phone no longer keeps a copy of it.',
    );
    expect(app.text()).toContain('created');
    expect(app.text()).toContain(`Updated ${readAt}`);
    expect(app.text()).not.toContain('Saved');
    // Nothing shown is this phone's copy: the banner says only that the app is offline.
    expect(app.text()).toContain('You’re offlineConnect to load the latest.');
    expect(app.text()).not.toContain('What’s shown was saved');
  });
});
