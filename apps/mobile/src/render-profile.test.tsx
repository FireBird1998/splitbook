import { Profiler } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMobileController } from './data/mobile-controller';

/**
 * #177: how much of the tree each journey renders. Every exported component of the UI
 * modules is counted each time it renders, and a Profiler counts App's commits. The
 * counts are deterministic, so they are asserted as ceilings: a change that renders more
 * fails. Render times are reported for comparison only (`RENDER_PROFILE=1`); they come
 * from Node, not a phone. Components a module does not export are not counted.
 * `RENDER_PROFILE=record` prints the table without checking ceilings, to set new ones.
 */
const native = vi.hoisted(() => ({
  appState: [] as ((state: string) => void)[],
  back: [] as (() => boolean)[],
  controller: undefined as unknown,
  // useSyncExternalStore needs the same snapshot object until it changes.
  appearance: { mode: 'light', status: 'ready', message: null },
}));
const counting = vi.hoisted(() => {
  const renders = new Map<string, number>();
  const memo = Symbol.for('react.memo');
  const count = <T extends (...args: never[]) => unknown>(name: string, component: T): T => {
    const counted = (...args: never[]) => {
      renders.set(name, (renders.get(name) ?? 0) + 1);
      return component(...args);
    };
    return Object.assign(counted, component, { displayName: name }) as unknown as T;
  };
  return {
    renders,
    /** The module with each exported component (a function or memo) counted when it renders. */
    wrap: (module: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(module).map(([name, value]) => {
          if (!/^[A-Z]/.test(name)) return [name, value];
          if (typeof value === 'function')
            return [name, count(name, value as (...args: never[]) => unknown)];
          const type = (value as { $$typeof?: symbol; type?: unknown } | null)?.$$typeof;
          if (type === memo) {
            const memoized = value as { type: (...args: never[]) => unknown };
            return [name, { ...memoized, type: count(name, memoized.type) }];
          }
          return [name, value];
        }),
      ),
  };
});
type Module = Record<string, unknown>;
vi.mock('./ui/allocation-editors', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/compact/controls', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/compact/feedback', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/compact/layout', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/compact/navigation', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/compact/sheet', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/compact/text', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/date-sheet', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/expense-editor', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/expense-form', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/expense-record-view', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/financial-views', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/group-activity', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/group-balances', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/group-expenses', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/group-shell', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/group-snackbar', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/group-workflows', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/offline-notice', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/primitives', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/record-payment-sheet', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/screens', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/settings-screen', async (load) => counting.wrap(await load<Module>()));

// The real App tree renders through these host names; only native modules are replaced.
vi.mock('react-native', () => ({
  AccessibilityInfo: {
    sendAccessibilityEvent: vi.fn(),
    getRecommendedTimeoutMillis: async (timeout: number) => timeout,
  },
  ActivityIndicator: 'ActivityIndicator',
  Alert: { alert: vi.fn() },
  Animated: {
    View: 'AnimatedView',
    Value: class {
      setValue() {}
    },
    spring: () => ({ start: () => undefined }),
  },
  AppState: {
    addEventListener: (_: string, listener: (state: string) => void) => {
      native.appState.push(listener);
      return { remove: () => native.appState.splice(native.appState.indexOf(listener), 1) };
    },
  },
  Appearance: { setColorScheme: vi.fn() },
  BackHandler: {
    addEventListener: (_: string, listener: () => boolean) => {
      native.back.push(listener);
      return { remove: () => native.back.splice(native.back.indexOf(listener), 1) };
    },
  },
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Linking: {
    addEventListener: () => ({ remove: () => undefined }),
    getInitialURL: async () => null,
    openURL: vi.fn(),
  },
  Modal: 'Modal',
  PanResponder: { create: (config: object) => ({ panHandlers: config }) },
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  Share: { share: vi.fn() },
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 412, height: 915, scale: 2, fontScale: 1 }),
}));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: 'SafeAreaProvider',
  SafeAreaView: 'SafeAreaView',
}));
vi.mock('react-native-nitro-google-signin', () => ({ GoogleSignInButton: 'GoogleSignInButton' }));
vi.mock('expo-status-bar', () => ({ StatusBar: 'StatusBar' }));
vi.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
vi.mock('expo-font', () => ({ useFonts: () => [true, null] }));
vi.mock('@expo-google-fonts/outfit/400Regular', () => ({ Outfit_400Regular: 1 }));
vi.mock('@expo-google-fonts/outfit/500Medium', () => ({ Outfit_500Medium: 1 }));
vi.mock('@expo-google-fonts/outfit/600SemiBold', () => ({ Outfit_600SemiBold: 1 }));
vi.mock('@expo-google-fonts/outfit/700Bold', () => ({ Outfit_700Bold: 1 }));
vi.mock('@expo-google-fonts/ibm-plex-mono/500Medium', () => ({ IBMPlexMono_500Medium: 1 }));
vi.mock('@expo/vector-icons/Ionicons', () => ({
  default: Object.assign(() => null, { font: {} }),
}));
vi.mock('./runtime', () => ({
  get controller() {
    return native.controller;
  },
  appearance: {
    subscribe: () => () => undefined,
    getSnapshot: () => native.appearance,
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
// No act(): React schedules and batches renders as it does on a device, so a controller
// publish in its own task commits on its own instead of merging into one act() flush.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

/**
 * The most each journey may render. Lower a ceiling when a change renders less; raise one
 * only with the reason recorded in docs/qa (see #177).
 */
const ceilings: Record<string, { publishes: number; commits: number; renders: number }> = {
  'Sign in and show Home (20 Groups)': { publishes: 9, commits: 5, renders: 649 },
  'Foreground on Home within 30 s': { publishes: 4, commits: 1, renders: 209 },
  'Open a Group on Expenses': { publishes: 11, commits: 4, renders: 512 },
  'Change Month': { publishes: 8, commits: 3, renders: 492 },
  'Switch to Balances': { publishes: 1, commits: 1, renders: 61 },
  'Switch to Activity': { publishes: 4, commits: 3, renders: 192 },
  'Load the 5th Expense page (80 → 100 rows)': { publishes: 7, commits: 3, renders: 2159 },
  'Foreground within 30 s after 5 Expense pages': { publishes: 5, commits: 1, renders: 208 },
  'Load the 5th Activity page (80 → 100 events)': { publishes: 3, commits: 2, renders: 821 },
  'Foreground within 30 s after 5 Activity pages': { publishes: 3, commits: 2, renders: 584 },
  'Type 20 characters into Description': { publishes: 40, commits: 20, renders: 2780 },
};

// Fictional ledger: 20 Groups, and a Household Group with 5 pages each of Expenses and Activity.
const user = { id: 'a00000000000000000000002', name: 'Sam Chen', email: 's@x.test', image: null };
const person = { _id: user.id, name: user.name, image: null };
const alex = { _id: 'a00000000000000000000001', name: 'Alex', image: null };
const iso = '2026-09-27T10:00:00.000Z';
const hex = (prefix: string, index: number) => `${prefix}${String(index).padStart(23, '0')}`;
const groups = Array.from({ length: 20 }, (_, index) => ({
  _id: hex('a', 10 + index),
  createdBy: user.id,
  name: index ? `Fictional Group ${index + 1}` : 'Maple House',
  category: 'home',
  defaultCurrency: 'INR',
  members: [{ user: { ...person, email: user.email }, role: 'member', joinedAt: iso }],
  tags: [{ _id: hex('c', 1), name: 'Shared', isArchived: false, createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
}));
const group = groups[0]!;
const groupId = group._id;
const pages = 5;
const pageOf = (path: string) => Number(new URL(path, 'http://local').searchParams.get('page'));
const expensePage = (page: number) => ({
  status: 200,
  data: {
    expenses: Array.from({ length: 20 }, (_, row) => ({
      _id: hex('b', page * 100 + row),
      group: groupId,
      description: `Fictional expense ${page}-${row + 1}`,
      currency: 'INR',
      amount: 10,
      amountMinor: 1000,
      moneyVersion: 1,
      category: 'food',
      tag: 'Shared',
      tagId: hex('c', 1),
      date: iso,
      createdAt: iso,
      updatedAt: iso,
      paidBy: [{ user: person, amount: 10, amountMinor: 1000 }],
      splitBetween: [{ user: person, amount: 10, amountMinor: 1000 }],
      splitMethod: 'equal',
    })),
    pagination: { page, limit: 20, total: 20 * pages, totalPages: pages },
    summary: {
      count: 20 * pages,
      totalsByCurrency: [{ currency: 'INR', totalAmount: 200 * pages }],
      userOwes: 0,
      userGetsBack: 0,
      byMember: [],
    },
  },
});
const activityPage = (page: number) => ({
  status: 200,
  data: {
    activities: Array.from({ length: 20 }, (_, row) => ({
      _id: hex('d', page * 100 + row),
      group: groupId,
      actor: { _id: user.id, name: user.name },
      type: 'expense_added',
      createdAt: iso,
      metadata: {
        description: `Fictional expense ${page}-${row + 1}`,
        amount: 10,
        currency: 'INR',
      },
    })),
    pagination: { page, limit: 20, total: 20 * pages, totalPages: pages },
  },
});
const json = (body: unknown, status = 200) => Response.json(body, { status });

function backend() {
  let cookie: string | null = null;
  let account: string | null = null;
  const drafts = new Map<string, unknown>();
  const clock = { now: new Date(2026, 8, 27, 12).getTime() };
  const controller = createMobileController(
    {
      apiBaseUrl: 'http://localhost:4138',
      authOrigin: 'http://localhost:4138',
      developmentPersonaEnabled: true,
    },
    {
      now: () => clock.now,
      expenseDrafts: {
        load: async (accountId, id) => structuredClone(drafts.get(`${accountId}:${id}`) ?? null),
        save: async (accountId, id, value) => {
          drafts.set(`${accountId}:${id}`, structuredClone(value));
        },
        remove: async (accountId, id) => {
          drafts.delete(`${accountId}:${id}`);
        },
        clear: async () => drafts.clear(),
      },
      accountLocal: {
        owner: {
          load: async () => account,
          save: async (value) => {
            account = value;
          },
          clear: async () => {
            account = null;
          },
        },
        cleanupMarker: { load: async () => false, mark: async () => {}, clear: async () => {} },
        stores: [],
      },
      newSubmissionKey: () => 'render-profile-0001',
      credentials: {
        load: async () => cookie,
        save: async (value) => {
          cookie = value;
        },
        clear: async () => {
          cookie = null;
        },
      },
      fetch: async (url) => {
        const path = new URL(url).pathname + new URL(url).search;
        // Like a network reply, each response arrives in a later task.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (path.endsWith('/sign-in'))
          return new Response(JSON.stringify({ user }), {
            headers: { 'Set-Cookie': 'better-auth.session_token=test.signature; Path=/; HttpOnly' },
          });
        if (path.endsWith('/get-session'))
          return json({ user, session: { userId: user.id, expiresAt: '2030-01-01T00:00:00Z' } });
        if (path === '/api/groups') return json({ data: groups, status: 200 });
        if (path === `/api/groups/${groupId}`) return json({ data: group, status: 200 });
        if (path === '/api/user/balances')
          return json({
            data: { buckets: [{ currency: 'INR', youOwe: 30, youAreOwed: 0 }] },
            status: 200,
          });
        if (path.startsWith(`/api/groups/${groupId}/expenses?`))
          return json(expensePage(pageOf(path)));
        if (path.startsWith(`/api/groups/${groupId}/activity?`))
          return json(activityPage(pageOf(path)));
        if (path === `/api/groups/${groupId}/balances`)
          return json({
            data: {
              byCurrency: [
                {
                  currency: 'INR',
                  balances: [{ user: person, balance: -30 }],
                  debts: [{ from: person, to: alex, amount: 30 }],
                },
              ],
            },
            status: 200,
          });
        return json({}, 404);
      },
    },
  );
  return { controller, clock };
}

interface Sample {
  journey: string;
  publishes: number;
  commits: number;
  renders: number;
  components: number;
  ms: number;
  top: string;
}
const samples: Sample[] = [];
let screen: ReactTestRenderer | null = null;
let publishes = 0,
  commits = 0,
  renderMs = 0;

beforeEach(() => {
  // Controller snapshots published between act scopes are part of what is measured.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  screen?.unmount();
  screen = null;
  native.appState.length = 0;
  native.back.length = 0;
  vi.restoreAllMocks();
});
afterAll(() => {
  if (!process.env.RENDER_PROFILE) return;
  console.log(
    '| Journey | Publishes | Commits | Component renders | Components | Render time (Node, ms) | Most rendered |',
  );
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const sample of samples)
    console.log(
      `| ${sample.journey} | ${sample.publishes} | ${sample.commits} | ${sample.renders} | ${sample.components} | ${sample.ms.toFixed(1)} | ${sample.top} |`,
    );
});

/** Waits until nothing has been published or committed for 5 consecutive tasks. */
const settle = async (pending?: Promise<unknown>) => {
  await pending;
  for (let quiet = 0, tick = 0, last = -1; quiet < 5 && tick < 500; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const seen = publishes * 100_000 + commits;
    quiet = seen === last ? quiet + 1 : 0;
    last = seen;
  }
};

async function renderApp() {
  const harness = backend();
  await harness.controller.signIn('sam');
  native.controller = harness.controller;
  harness.controller.subscribe(() => {
    publishes += 1;
  });
  await act(async () => {
    screen = create(
      <Profiler
        id="App"
        onRender={(_id, _phase, actual) => {
          commits += 1;
          renderMs += actual;
        }}
      >
        <App />
      </Profiler>,
      { createNodeMock: () => ({ scrollTo: () => undefined, focus: () => undefined }) },
    );
  });
  await settle();
  const root = () => screen!.root;
  const isHost = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;
  const pressable = (label: string) =>
    root().find(
      (node) =>
        isHost(node, 'Pressable') && String(node.props.accessibilityLabel ?? '').startsWith(label),
    );
  return {
    ...harness,
    press: (label: string) => settle(Promise.resolve(pressable(label).props.onPress())),
    type: (label: string, value: string) =>
      settle(
        Promise.resolve(
          root()
            .find((node) => isHost(node, 'TextInput') && node.props.accessibilityLabel === label)
            .props.onChangeText(value),
        ),
      ),
    /** Android reports the app leaving and returning to the foreground. */
    foreground: () =>
      settle(
        Promise.resolve().then(() => {
          native.appState.forEach((listener) => listener('background'));
          native.appState.forEach((listener) => listener('active'));
        }),
      ),
    /** Host Text nodes on screen: a proxy for how much is mounted. */
    mounted: () => root().findAll((node) => isHost(node, 'Text')).length,
  };
}

/** Measures one journey and checks it against its ceiling. */
async function journey(name: string, run: () => Promise<unknown>) {
  counting.renders.clear();
  publishes = 0;
  commits = 0;
  renderMs = 0;
  await run();
  const renders = [...counting.renders.values()].reduce((sum, count) => sum + count, 0);
  const top = [...counting.renders]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([component, count]) => `${component} ${count}`)
    .join(', ');
  const sample = {
    journey: name,
    publishes,
    commits,
    renders,
    components: counting.renders.size,
    ms: renderMs,
    top,
  };
  samples.push(sample);
  if (process.env.RENDER_PROFILE === 'record') return sample;
  const ceiling = ceilings[name];
  expect(ceiling, `No ceiling recorded for "${name}"`).toBeDefined();
  expect(sample.publishes, `${name}: publishes`).toBeLessThanOrEqual(ceiling!.publishes);
  expect(sample.commits, `${name}: commits`).toBeLessThanOrEqual(ceiling!.commits);
  expect(sample.renders, `${name}: component renders`).toBeLessThanOrEqual(ceiling!.renders);
  return sample;
}

describe('render profile (#177)', () => {
  it('Home and Group navigation', async () => {
    let app!: Awaited<ReturnType<typeof renderApp>>;
    await journey('Sign in and show Home (20 Groups)', async () => {
      app = await renderApp();
    });
    await journey('Foreground on Home within 30 s', () => app.foreground());
    await journey('Open a Group on Expenses', () => app.press('Open Maple House'));
    await journey('Change Month', () => app.press('Previous month'));
    await journey('Switch to Balances', () => app.press('Balances'));
    await journey('Switch to Activity', () => app.press('Activity'));
  });

  it('long lists', async () => {
    const app = await renderApp();
    await app.press('Open Maple House');
    for (let page = 2; page < pages; page += 1) await app.press('Load more expenses');
    await journey('Load the 5th Expense page (80 → 100 rows)', () =>
      app.press('Load more expenses'),
    );
    // An automatic refresh starts again from the first page (#104), so the list shrinks.
    await journey('Foreground within 30 s after 5 Expense pages', () => app.foreground());
    await app.press('Activity');
    for (let page = 2; page < pages; page += 1) await app.press('Load older activity');
    await journey('Load the 5th Activity page (80 → 100 events)', () =>
      app.press('Load older activity'),
    );
    await journey('Foreground within 30 s after 5 Activity pages', () => app.foreground());
  });

  it('typing in the Expense form', async () => {
    const app = await renderApp();
    await app.press('Open Maple House');
    await app.press('Add expense');
    const text = 'Fictional groceries!';
    await journey(`Type ${text.length} characters into Description`, async () => {
      for (let length = 1; length <= text.length; length += 1)
        await app.type('Description, required', text.slice(0, length));
    });
  });
});
