import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Profiler } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ceilingsFile, harnessCeilings, measures } from '../scripts/ceilings';
import { createMobileController } from './data/mobile-controller';
import { emitAppState } from './test-utils/native';

/**
 * #177: how much of the tree each journey renders, and #206: how many requests it sends. The
 * UI modules' exports are wrapped so that a component is counted each time another module
 * renders it through its export, a Profiler counts App's commits, and the fake `fetch` records
 * each request by method and path. Renders from inside a component's own module (`Card` and
 * `Skeleton` inside compact/layout, `Icon` and `Copy` inside primitives) and components a
 * module does not export are not counted, so the renders are a lower bound.
 * The counts are deterministic, so they are asserted as ceilings, kept in
 * `render-profile.ceilings.json`: a change that renders more or sends more fails. CI's ratchet
 * (`pnpm mobile ceilings:compare`) reads the same file. Each journey also checks the screen it
 * ends on, so a journey that breaks can't pass by rendering less, and a journey that only
 * reads fails if it sends anything but a GET. Render times are reported for comparison only
 * (`RENDER_PROFILE=1`); they come from Node, not a phone. `RENDER_PROFILE=record` prints the
 * table and the data file without checking ceilings, to set new ones; it refuses to run in CI.
 * The guard test fails when a module under `src/ui` exports a component this file doesn't
 * count, and the last test when the data file has a ceiling for a journey that didn't run.
 */
// What the mocked `./runtime` serves: the controller under test and the appearance.
const runtime = vi.hoisted(() => ({
  controller: undefined as unknown,
  // useSyncExternalStore needs the same snapshot object until it changes.
  appearance: { mode: 'light', status: 'ready', message: null },
}));
const counting = vi.hoisted(() => {
  const renders = new Map<string, number>();
  const memo = Symbol.for('react.memo');
  const forwardRef = Symbol.for('react.forward_ref');
  const counted = Symbol('counted');
  type Render = (...args: never[]) => unknown;
  type ClassComponent = new (...args: never[]) => { render(): unknown };
  type Exotic = { $$typeof?: symbol; type?: unknown; render?: unknown } | null;
  const tally = (name: string) => renders.set(name, (renders.get(name) ?? 0) + 1);
  const countRender = (name: string, render: Render) =>
    Object.assign(
      (...args: never[]) => {
        tally(name);
        return render(...args);
      },
      render,
      { displayName: name, [counted]: true },
    );
  const countClass = (name: string, Component: ClassComponent) =>
    Object.assign(
      class extends Component {
        render() {
          tally(name);
          return super.render();
        }
      },
      { displayName: name, [counted]: true },
    );
  /** Whether an export is a component: a function, class, memo or forwardRef with a capital. */
  const isComponent = (name: string, value: unknown) =>
    /^[A-Z]/.test(name) &&
    (typeof value === 'function' ||
      (value as Exotic)?.$$typeof === memo ||
      (value as Exotic)?.$$typeof === forwardRef);
  /** The export, counted when it renders; undefined when this file can't count its kind. */
  const count = (name: string, value: unknown): unknown => {
    const exotic = value as Exotic;
    if (typeof value === 'function')
      return (value as { prototype?: { isReactComponent?: unknown } }).prototype?.isReactComponent
        ? countClass(name, value as ClassComponent)
        : countRender(name, value as Render);
    if (exotic?.$$typeof === memo && typeof exotic.type === 'function')
      return { ...exotic, type: countRender(name, exotic.type as Render) };
    if (exotic?.$$typeof === forwardRef && typeof exotic.render === 'function')
      return { ...exotic, render: countRender(name, exotic.render as Render) };
    return undefined;
  };
  return {
    renders,
    isComponent,
    /** Whether this file counts an export's renders. */
    isCounted: (value: unknown) => {
      const exotic = value as { [counted]?: true; type?: unknown; render?: unknown } | null;
      const inner = (exotic?.type ?? exotic?.render) as { [counted]?: true } | undefined;
      return Boolean(exotic?.[counted] || inner?.[counted]);
    },
    /** The module with each exported component counted when it renders. */
    wrap: (module: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(module).map(([name, value]) => [
          name,
          (isComponent(name, value) && count(name, value)) || value,
        ]),
      ),
  };
});
type Module = Record<string, unknown>;
// Every module under src/ui that exports a component; the last test checks this list.
vi.mock('./ui/compact/controls', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/compact/feedback', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/compact/layout', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/compact/navigation', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/compact/sheet', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/compact/text', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/date-sheet', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/error-boundary', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/expense-editor', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/expense-form', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/expense-record-view', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/financial-views', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/group-activity', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/group-balances', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/group-expenses', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/group-members', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/group-shell', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/group-snackbar', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/group-workflows', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/home', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/offline-notice', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/payer-sheet', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/primitives', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/record-payment-sheet', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/screens', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/settings-screen', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/split-sheet', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/tag-sheet', async (load) => counting.wrap(await load<Module>()));
vi.mock('./ui/trip-strip', async (load) => counting.wrap(await load<Module>()));

// The real App tree renders through the shared host stand-ins (`./test-utils/native.ts`);
// only native modules are replaced here.
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
// No act(): React schedules and batches renders as it does on a device, so a controller
// publish in its own task commits on its own instead of merging into one act() flush.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

/**
 * The most each journey may render and send, from the one data file the ratchet also reads.
 * Lower a ceiling when a change renders or sends less. Raising one, or removing or renaming a
 * journey, needs the reason in the pull request and the owner's `re-record-ceilings` label
 * (docs/qa/2026-10-02-android-render-baseline.md).
 */
const ceilingsPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', ceilingsFile);
const ceilings = harnessCeilings(readFileSync(ceilingsPath, 'utf8'), ceilingsFile);
const recording = process.env.RENDER_PROFILE === 'record';
// Recording skips every ceiling, so a leaked variable must not turn CI green.
if (recording && process.env.CI)
  throw new Error('RENDER_PROFILE=record skips every ceiling; it never runs in CI.');

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
      fetch: async (url, init) => {
        const path = new URL(url).pathname + new URL(url).search;
        // Every request the controller sends, as it leaves; the journey counts them.
        sent.push(`${init.method ?? 'GET'} ${path}`);
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
  requests: number;
  publishes: number;
  commits: number;
  renders: number;
  components: number;
  ms: number;
  top: string;
  /** Each request the journey sent, as `METHOD /path?query`. */
  sent: string[];
}
const samples: Sample[] = [];
let screen: ReactTestRenderer | null = null;
let publishes = 0,
  commits = 0,
  renderMs = 0;
/** The requests the fake `fetch` received since the journey started. */
const sent: string[] = [];

// The two console errors this file causes on purpose: it renders outside act() so that
// publishes commit as they would on a device, and it uses react-test-renderer. Any other
// console error fails the test.
const expectedErrors = [
  /The current testing environment is not configured to support act\(/,
  /react-test-renderer is deprecated/,
];
let consoleErrors: string[] = [];
beforeEach(() => {
  consoleErrors = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const message = args.map(String).join(' ');
    if (!expectedErrors.some((expected) => expected.test(message))) consoleErrors.push(message);
  });
});
afterEach(() => {
  screen?.unmount();
  screen = null;
  vi.restoreAllMocks();
  expect(consoleErrors, 'Unexpected console errors').toEqual([]);
});
afterAll(() => {
  if (!process.env.RENDER_PROFILE) return;
  console.log(
    '| Journey | Requests | Publishes | Commits | Component renders | Components | Render time (Node, ms) | Most rendered |',
  );
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
  for (const sample of samples)
    console.log(
      `| ${sample.journey} | ${sample.requests} | ${sample.publishes} | ${sample.commits} | ${sample.renders} | ${sample.components} | ${sample.ms.toFixed(1)} | ${sample.top} |`,
    );
  console.log('\n| Journey | Requests sent, in order |');
  console.log('| --- | --- |');
  for (const sample of samples)
    console.log(
      `| ${sample.journey} | ${sample.sent.map((request) => `\`${request.replaceAll(groupId, ':groupId')}\``).join(', ') || 'none'} |`,
    );
  if (!recording) return;
  // The data file as these counts would make it: run the whole file before copying it.
  const journeys = Object.fromEntries(
    samples.map((sample) => [
      sample.journey,
      Object.fromEntries(measures.map((measure) => [measure, sample[measure]])),
    ]),
  );
  const about = (JSON.parse(readFileSync(ceilingsPath, 'utf8')) as { about?: string }).about;
  console.log(`\n${ceilingsFile}:\n${JSON.stringify({ about, journeys }, null, 2)}`);
});

/** Waits until nothing has been published, committed or sent for 5 consecutive tasks. */
const settle = async (pending?: Promise<unknown>) => {
  await pending;
  for (let quiet = 0, tick = 0, last = -1; quiet < 5 && tick < 500; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    const seen = (publishes * 100_000 + commits) * 1_000 + sent.length;
    quiet = seen === last ? quiet + 1 : 0;
    last = seen;
  }
};

async function renderApp() {
  const harness = backend();
  await harness.controller.signIn('sam');
  runtime.controller = harness.controller;
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
  const labelled = (label: string) => (node: ReactTestInstance) =>
    isHost(node, 'Pressable') && String(node.props.accessibilityLabel ?? '').startsWith(label);
  const pressable = (label: string) => root().find(labelled(label));
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
    /** Pull to refresh: the RefreshControl of the screen's ScrollView reports a pull. */
    pull: () =>
      settle(
        Promise.resolve(
          root()
            .find((node) => isHost(node, 'ScrollView') && node.props.refreshControl)
            .props.refreshControl.props.onRefresh(),
        ),
      ),
    /** Android reports the app leaving and returning to the foreground. */
    foreground: () =>
      settle(
        Promise.resolve().then(() => {
          emitAppState('background');
          emitAppState('active');
        }),
      ),
    /** How many buttons on screen have a label starting with `label`, such as list rows. */
    count: (label: string) => root().findAll(labelled(label)).length,
    /** Whether some text on screen contains `text`. */
    shows: (text: string) =>
      root()
        .findAll((node) => isHost(node, 'Text'))
        .some((node) => node.children.some((child) => String(child).includes(text))),
    /** The value of the text field with this label. */
    value: (label: string) =>
      root().find((node) => isHost(node, 'TextInput') && node.props.accessibilityLabel === label)
        .props.value,
  };
}

/**
 * Measures one journey, checks the screen it ends on, then checks its counts against the
 * ceilings. A journey that breaks fails on its end screen, not by rendering less. Every
 * journey of a test reports its counts before the test fails on a ceiling.
 *
 * A journey only reads unless it says it `writes`: opening, going back, refreshing, returning
 * to the foreground and loading a page send nothing but GETs. A read never resumes or replays
 * a financial write (ADR 0004), so any other request fails the journey.
 */
async function journey(
  name: string,
  run: () => Promise<unknown>,
  reached: () => void,
  options: { writes?: true } = {},
) {
  counting.renders.clear();
  publishes = 0;
  commits = 0;
  renderMs = 0;
  sent.length = 0;
  await run();
  const renders = [...counting.renders.values()].reduce((sum, count) => sum + count, 0);
  const top = [...counting.renders]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([component, count]) => `${component} ${count}`)
    .join(', ');
  const sample = {
    journey: name,
    requests: sent.length,
    publishes,
    commits,
    renders,
    components: counting.renders.size,
    ms: renderMs,
    top,
    sent: [...sent],
  };
  samples.push(sample);
  // Before the end screen: a write is reported even when the journey also broke.
  if (!options.writes)
    expect
      .soft(
        sample.sent.filter((request) => !request.startsWith('GET ')),
        `${name} only reads, so it may send nothing but GETs`,
      )
      .toEqual([]);
  reached();
  if (recording) return sample;
  const ceiling = ceilings[name];
  expect.soft(ceiling, `No ceiling recorded for "${name}" in ${ceilingsFile}`).toBeDefined();
  if (!ceiling) return sample;
  for (const measure of measures) {
    expect.soft(sample[measure], `${name}: ${measure}`).toBeLessThanOrEqual(ceiling[measure]);
    // Quiet unless a ceiling can come down.
    if (sample[measure] < ceiling[measure])
      console.warn(
        `${name}: ${measure} ${sample[measure]} is under its ceiling of ${ceiling[measure]}; lower the ceiling.`,
      );
  }
  return sample;
}

describe('render and request profile (#177, #206)', () => {
  it('Home and Group navigation', async () => {
    let app!: Awaited<ReturnType<typeof renderApp>>;
    const home = () => expect(app.count('Open '), 'Group rows on Home').toBe(groups.length);
    const expenses = (month: string) => () => {
      expect(app.shows(month), `${month} on screen`).toBe(true);
      expect(app.count('Fictional expense'), 'Expense rows').toBe(20);
    };
    await journey(
      'Sign in and show Home (20 Groups)',
      async () => {
        app = await renderApp();
      },
      home,
      // Signing in posts the persona sign-in.
      { writes: true },
    );
    await journey('Foreground on Home within 30 s', () => app.foreground(), home);
    await journey(
      'Open a Group on Expenses',
      () => app.press('Open Maple House'),
      expenses('September 2026'),
    );
    await journey('Change Month', () => app.press('Previous month'), expenses('August 2026'));
    await journey(
      'Switch to Balances',
      () => app.press('Balances'),
      () => {
        expect(app.shows('All-time balance'), 'Balances on screen').toBe(true);
        expect(app.shows('−₹30.00'), "Sam's balance").toBe(true);
      },
    );
    await journey(
      'Switch to Activity',
      () => app.press('Activity'),
      () => expect(app.count('You added'), 'Activity rows').toBe(20),
    );
  });

  it('long lists', async () => {
    const app = await renderApp();
    const expenseRows = (rows: number) => () =>
      expect(app.count('Fictional expense'), 'Expense rows').toBe(rows);
    const activityRows = (rows: number) => () =>
      expect(app.count('You added'), 'Activity rows').toBe(rows);
    await app.press('Open Maple House');
    for (let page = 2; page < pages; page += 1) await app.press('Load more expenses');
    await journey(
      'Load the 5th Expense page (80 → 100 rows)',
      () => app.press('Load more expenses'),
      expenseRows(100),
    );
    // An automatic refresh starts again from the first page (#104), so the list shrinks.
    // ADR 0006 keeps up to 5 loaded pages instead (#219), which will re-record this journey.
    await journey(
      'Foreground within 30 s after 5 Expense pages',
      () => app.foreground(),
      expenseRows(20),
    );
    await app.press('Activity');
    for (let page = 2; page < pages; page += 1) await app.press('Load older activity');
    await journey(
      'Load the 5th Activity page (80 → 100 events)',
      () => app.press('Load older activity'),
      activityRows(100),
    );
    await journey(
      'Foreground within 30 s after 5 Activity pages',
      () => app.foreground(),
      activityRows(20),
    );
  });

  it('back to Home, and the Group again', async () => {
    const app = await renderApp();
    const expenseRows = () => expect(app.count('Fictional expense'), 'Expense rows').toBe(20);
    await app.press('Open Maple House');
    expenseRows();
    await journey(
      'Back to Home from a Group',
      () => app.press('Back to Home'),
      () => expect(app.count('Open '), 'Group rows on Home').toBe(groups.length),
    );
    // Within the 30-second freshness window: the clock hasn't moved since the Group was read.
    await journey('Reopen the Group within 30 s', () => app.press('Open Maple House'), expenseRows);
  });

  // The journeys a refresh of loaded pages (ADR 0006, #215) changes. Today a refresh starts
  // again from the first page (#104), so the list shrinks to 20 rows; #219 (Expenses) and #222
  // (Activity) re-read the loaded pages instead, and re-record these journeys.
  it('refreshing 5 loaded pages', async () => {
    const app = await renderApp();
    const expenseRows = (rows: number) => () =>
      expect(app.count('Fictional expense'), 'Expense rows').toBe(rows);
    const activityRows = (rows: number) => () =>
      expect(app.count('You added'), 'Activity rows').toBe(rows);
    const load = async (more: string, rows: () => void) => {
      for (let page = 2; page <= pages; page += 1) await app.press(more);
      rows();
    };
    // Moves the harness clock past the 30-second freshness window, then returns to the
    // foreground. Once freshness follows Date.now, #214 moves time with fake timers instead.
    const foregroundAfter30s = () => {
      app.clock.now += 31_000;
      return app.foreground();
    };
    await app.press('Open Maple House');
    await load('Load more expenses', expenseRows(100));
    await journey('Pull to refresh with 5 Expense pages', () => app.pull(), expenseRows(20));
    await load('Load more expenses', expenseRows(100));
    await journey(
      'Foreground after 30 s with 5 Expense pages',
      foregroundAfter30s,
      expenseRows(20),
    );
    await app.press('Activity');
    await load('Load older activity', activityRows(100));
    await journey('Pull to refresh with 5 Activity pages', () => app.pull(), activityRows(20));
    await load('Load older activity', activityRows(100));
    await journey(
      'Foreground after 30 s with 5 Activity pages',
      foregroundAfter30s,
      activityRows(20),
    );
  });

  it('typing in the Expense form', async () => {
    const app = await renderApp();
    await app.press('Open Maple House');
    // The form is measured as a member reaches it: from a Group whose Expenses loaded.
    expect(app.count('Fictional expense'), 'Expense rows').toBe(20);
    await app.press('Add expense');
    const text = 'Fictional groceries!';
    await journey(
      `Type ${text.length} characters into Description`,
      async () => {
        for (let length = 1; length <= text.length; length += 1)
          await app.type('Description, required', text.slice(0, length));
      },
      () => {
        expect(app.value('Description, required'), 'Description').toBe(text);
        expect(app.shows('Draft saved'), 'Draft saved on screen').toBe(true);
      },
    );
  });

  // vi.mock takes static paths, so the list at the top is kept by hand and checked here.
  it('counts every component that a module under src/ui exports', async () => {
    const self = fileURLToPath(import.meta.url);
    const modules = readdirSync(resolve(dirname(self), 'ui'), { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .map((file) => file.replaceAll(sep, '/').replace(/\.tsx?$/, ''))
      .sort();
    const uncounted: string[] = [];
    for (const module of modules) {
      const path = `./ui/${module}`;
      for (const [name, value] of Object.entries(await import(/* @vite-ignore */ path)))
        if (counting.isComponent(name, value) && !counting.isCounted(value))
          uncounted.push(`${module}: ${name}`);
    }
    expect.soft(uncounted, 'Add a vi.mock for each module at the top of this file').toEqual([]);

    // A module that was removed or renamed would leave a vi.mock that counts nothing.
    const instrumented = Array.from(
      readFileSync(self, 'utf8').matchAll(/vi\.mock\(\s*'\.\/ui\/([^']+)'/g),
      (match) => match[1]!,
    );
    expect(instrumented.length, 'vi.mock calls found in this file').toBeGreaterThan(0);
    expect(
      instrumented.filter((module) => !modules.includes(module)),
      'Remove the vi.mock for each module that no longer exists',
    ).toEqual([]);
  });

  // Runs last, once every journey above has run (vitest runs a file's tests in order).
  it(`has a ceiling in ${ceilingsFile} only for journeys that ran`, () => {
    const ran = new Set(samples.map((sample) => sample.journey));
    expect(
      Object.keys(ceilings).filter((name) => !ran.has(name)),
      `Ceilings in ${ceilingsFile} for journeys that didn't run: remove or rename them (a re-record)`,
    ).toEqual([]);
  });
});
