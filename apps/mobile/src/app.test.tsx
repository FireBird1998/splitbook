import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';
import { findHosts, layoutHeight } from './test-utils/layout';
import { Alert } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocalMonthIsoRange } from '@splitbook/shared/date';
import { createMobileController } from './data/mobile-controller';
import type { FetchResponse } from './data/types';
import { refreshedLabel } from './ui/refresh-feedback';
import { emitAppState, pressBack } from './test-utils/native';
import { GroupExpensesView } from './ui/group-expenses';

// The real App tree renders through the shared host stand-ins; only native modules are replaced.
// What the mocked `./runtime` serves: the controller under test and the appearance.
const runtime = vi.hoisted(() => ({
  controller: undefined as unknown,
  appearance: { mode: 'light', status: 'ready', message: null },
}));
// The native ScrollView method the stand-ins lack; `renderApp` records scroll requests with it.
const native = { scrollTo: vi.fn() };
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

const user = { id: 'a00000000000000000000002', name: 'Sam Chen', email: 's@x.test', image: null };
const person = { _id: user.id, name: user.name, image: null };
const alex = { _id: 'a00000000000000000000001', name: 'Alex', image: null };
const groupId = 'a00000000000000000000010';
const iso = '2026-09-27T10:00:00.000Z';
const group = {
  _id: groupId,
  createdBy: user.id,
  name: 'Maple House',
  category: 'home',
  defaultCurrency: 'INR',
  members: [{ user: { ...person, email: user.email }, role: 'member', joinedAt: iso }],
  tags: [{ _id: 'c00000000000000000000001', name: 'Shared', isArchived: false, createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
};
const expense = (id: string, description: string) => ({
  _id: id,
  group: groupId,
  description,
  currency: 'INR',
  amount: 10,
  amountMinor: 1000,
  moneyVersion: 1,
  category: 'food',
  tag: 'Shared',
  tagId: 'c00000000000000000000001',
  date: iso,
  createdAt: iso,
  updatedAt: iso,
  paidBy: [{ user: person, amount: 10, amountMinor: 1000 }],
  splitBetween: [{ user: person, amount: 10, amountMinor: 1000 }],
  splitMethod: 'equal',
});
const page = (rows: unknown[]) => ({
  data: {
    expenses: rows,
    pagination: { page: 1, limit: 20, total: rows.length, totalPages: 1 },
    summary: {
      count: rows.length,
      totalsByCurrency: [{ currency: 'INR', totalAmount: 10 * rows.length }],
      userOwes: 0,
      userGetsBack: 0,
      byMember: [],
    },
  },
  status: 200,
});
const json = (body: unknown, status = 200) => Response.json(body, { status });
const september = expense('b00000000000000000000001', 'September groceries');
const august = expense('b00000000000000000000002', 'August rent');

type Handler = (
  path: string,
  init: RequestInit,
) => FetchResponse | Promise<FetchResponse> | undefined;
const activityPage = {
  status: 200,
  data: {
    activities: [
      {
        _id: 'd00000000000000000000001',
        group: groupId,
        actor: { _id: user.id, name: user.name },
        type: 'expense_added',
        createdAt: iso,
        metadata: { description: 'September groceries', amount: 10, currency: 'INR' },
      },
    ],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  },
};

function backend() {
  let cookie: string | null = null;
  let account: string | null = null;
  const drafts = new Map<string, unknown>();
  const creations = new Map<string, unknown>();
  const groupCreations = {
    load: async (accountId: string) => structuredClone(creations.get(accountId) ?? null),
    save: async (accountId: string, value: unknown) => {
      creations.set(accountId, structuredClone(value));
    },
    remove: async (accountId: string) => {
      creations.delete(accountId);
    },
    clear: async () => creations.clear(),
  };
  const clock = { now: new Date(2026, 8, 27, 12).getTime() };
  let handler: Handler = () => undefined;
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
        list: async (accountId) =>
          [...drafts]
            .filter(([key]) => key.startsWith(`${accountId}:`))
            .map(([key, value]) => ({ groupId: key.split(':')[1], value: structuredClone(value) })),
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
        stores: [groupCreations],
      },
      groupCreations,
      newSubmissionKey: () => 'native-app-test-0001',
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
        const override = handler(path, init);
        if (override) return override;
        if (path.endsWith('/sign-in'))
          return new Response(JSON.stringify({ user }), {
            headers: { 'Set-Cookie': 'better-auth.session_token=test.signature; Path=/; HttpOnly' },
          });
        if (path.endsWith('/get-session'))
          return json({ user, session: { userId: user.id, expiresAt: '2030-01-01T00:00:00Z' } });
        if (path === '/api/groups') return json({ data: [group], status: 200 });
        if (path === `/api/groups/${groupId}`) return json({ data: group, status: 200 });
        if (path === '/api/user/balances')
          return json({
            data: { buckets: [{ currency: 'INR', youOwe: 30, youAreOwed: 0 }] },
            status: 200,
          });
        if (path.includes('/expenses?')) {
          const from = new URL(path, 'http://local').searchParams.get('dateFrom');
          return json(
            page(from === getLocalMonthIsoRange('2026-08').dateFrom ? [august] : [september]),
          );
        }
        if (path.startsWith(`/api/groups/${groupId}/activity?`)) return json(activityPage);
        if (path === `/api/groups/${groupId}/balances`)
          return json({
            data: {
              currency: 'INR',
              balances: [],
              debts: [],
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
  return {
    controller,
    clock,
    creations,
    use(next: Handler) {
      handler = next;
    },
  };
}

/** Hold one matching request until released. */
function hold() {
  let release!: (response: FetchResponse) => void;
  let arrived!: () => void;
  const reached = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const response = new Promise<FetchResponse>((resolve) => {
    release = resolve;
  });
  return {
    respond: () => {
      arrived();
      return response;
    },
    reached,
    release,
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
  native.scrollTo.mockClear();
  vi.restoreAllMocks();
});
const settle = (pending?: Promise<unknown>) =>
  act(async () => {
    await pending;
    for (let tick = 0; tick < 10; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function renderApp() {
  const harness = backend();
  await harness.controller.signIn('sam');
  runtime.controller = harness.controller;
  await act(async () => {
    // Host stand-ins have no native methods; the Group view's scroll requests are recorded.
    screen = create(<App />, {
      createNodeMock: () => ({ scrollTo: native.scrollTo, focus: () => undefined }),
    });
  });
  await settle();
  const root = () => screen!.root;
  const isHost = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;
  const text = () =>
    root()
      .findAll((node) => isHost(node, 'Text'))
      .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
      .join('');
  const pressable = (label: string) =>
    root().find(
      (node) =>
        isHost(node, 'Pressable') && String(node.props.accessibilityLabel ?? '').startsWith(label),
    );
  const refreshControl = () =>
    root().find((node) => isHost(node, 'ScrollView') && node.props.refreshControl).props
      .refreshControl.props as { refreshing: boolean; onRefresh: () => void };
  // The visible screen's; a Group's closed options sheet renders its own after it.
  const scrollView = () => root().findAll((node) => isHost(node, 'ScrollView'))[0];
  const progressbars = () =>
    root().findAll(
      (node) => typeof node.type === 'string' && node.props.accessibilityRole === 'progressbar',
    ).length;
  return {
    ...harness,
    root,
    text,
    pressable,
    refreshControl,
    progressbars,
    press: (label: string) => settle(Promise.resolve(pressable(label).props.onPress())),
    type: (label: string, value: string) =>
      settle(
        Promise.resolve(
          root()
            .find((node) => isHost(node, 'TextInput') && node.props.accessibilityLabel === label)
            .props.onChangeText(value),
        ),
      ),
    /** The member scrolls the visible screen to this offset. */
    scrollTo: (y: number) =>
      act(() => scrollView().props.onScroll({ nativeEvent: { contentOffset: { y } } })),
    /** Native layout reports the visible screen's viewport and content heights. */
    layout: (viewport: number, content: number) =>
      act(() => {
        scrollView().props.onLayout({ nativeEvent: { layout: { height: viewport } } });
        scrollView().props.onContentSizeChange(390, content);
      }),
    /** Android's hardware or gesture Back; returns whether the app handled it. */
    androidBack: async () => {
      let handled = false;
      await settle(
        Promise.resolve().then(() => {
          handled = pressBack();
        }),
      );
      return handled;
    },
    /** Android reports the app returning to the foreground. */
    foreground: () => emitAppState('active'),
  };
}

describe('App refresh rendering', () => {
  it('keeps the newest Month and never lists its Expenses under an older Month label', async () => {
    const app = await renderApp();
    await app.press('Open Maple House');
    expect(app.text()).toContain('September 2026');
    expect(app.text()).toContain('September groceries');

    const groupRead = hold();
    app.use((path) => (path === `/api/groups/${groupId}` ? groupRead.respond() : undefined));
    // Past the display freshness window, so the foreground refresh reads again.
    app.clock.now += 31_000;
    app.foreground();
    await groupRead.reached;
    await settle();
    app.use(() => undefined);
    await app.press('Previous month');
    expect(app.text()).toContain('August 2026');
    expect(app.text()).toContain('August rent');
    expect(app.text()).not.toContain('September groceries');

    groupRead.release(json({ data: group, status: 200 }));
    await settle();
    const shown = app.text();
    expect(shown).toContain('August 2026');
    expect(shown).toContain('1 expense in August');
    expect(shown).toContain('August rent');
    expect(shown).not.toContain('September');
  });

  // Owner decision 2A (#219): the Expenses and Balances read beside a failed Group read show.
  it('keeps the Group’s details with their time, a message and a retry when its read fails, beside Expenses and Balances read again', async () => {
    const app = await renderApp();
    await app.press('Open Maple House');
    const verifiedAt = refreshedLabel(app.clock.now);
    app.clock.now += 5 * 60_000;
    // A 500, a server fault: an uncoded 503 now counts as can't reach the server (#231).
    app.use((path) => (path === `/api/groups/${groupId}` ? json({}, 500) : undefined));
    await settle(Promise.resolve(app.refreshControl().onRefresh()));

    const retained = `The server could not complete this request. Please try again. Showing Maple House from ${verifiedAt}.`;
    expect(app.text()).toContain(retained);
    expect(app.text()).toContain('September groceries');
    expect(app.text()).toContain('September 2026');
    expect(app.text()).toContain('1 expense');
    await app.press('Balances');
    expect(app.text()).toContain(retained);
    expect(app.text()).toContain('You owe₹30.00');
    expect(app.refreshControl().refreshing).toBe(false);

    // A retry is not a pull: it keeps the figures and shows the quiet header status only.
    const retried = hold();
    app.use((path) => (path === `/api/groups/${groupId}` ? retried.respond() : undefined));
    app.pressable('Retry Group').props.onPress();
    await retried.reached;
    await settle();
    expect(app.refreshControl().refreshing).toBe(false);
    // The pull read Expenses and Balances again beside the failed Group read; the retry reads the
    // Expenses beside the Group again (#219), so Balances wait to follow them.
    expect(app.text()).toContain(
      `Updating balances. These figures are from ${refreshedLabel(app.clock.now)} and may change.`,
    );
    expect(app.text()).toContain('You owe₹30.00');

    app.use(() => undefined);
    retried.release(json({ data: group, status: 200 }));
    await settle();
    expect(app.text()).not.toContain('Showing Maple House from');
    expect(app.text()).not.toContain('· refreshing');
    expect(app.text()).toContain('You owe₹30.00');
    expect(app.refreshControl().refreshing).toBe(false);
    await app.press('Expenses');
    expect(app.text()).toContain('September groceries');
  });

  it('opens a Group whose own read fails as Home lists it, with its Expenses and the failure (2A)', async () => {
    const app = await renderApp();
    app.use((path) => (path === `/api/groups/${groupId}` ? json({}, 500) : undefined));
    await app.press('Open Maple House');
    // The note says what failed and what is current; no time it can't know, no offline icon.
    expect(app.text()).toContain(
      'Couldn’t load Maple House’s details. Expenses and balances below are up to date.',
    );
    expect(app.text()).not.toContain('unknown time');
    expect(app.text()).not.toContain('Couldn’t open this Group');
    const icons = screen!.root
      .findAll((node) => (node.type as unknown) === 'Ionicons')
      .map((node) => node.props.name as string);
    expect(icons).toContain('alert-circle-outline');
    expect(icons).not.toContain('cloud-offline-outline');
    expect(app.pressable('Retry Group')).toBeDefined();
    expect(app.text()).toContain('September groceries');
    await app.press('Balances');
    expect(app.text()).toContain('You owe₹30.00');
  });

  it('says only the Expenses are up to date when Balances aren’t answered beside a failed Group read (2A)', async () => {
    const app = await renderApp();
    app.use((path) =>
      path === `/api/groups/${groupId}` || path === `/api/groups/${groupId}/balances`
        ? json({}, 500)
        : undefined,
    );
    await app.press('Open Maple House');
    expect(app.text()).toContain(
      'Couldn’t load Maple House’s details. Expenses below are up to date.',
    );
    expect(app.text()).not.toContain('Expenses and balances below are up to date.');
    expect(app.text()).toContain('September groceries');
  });

  it('keeps Record disabled, and says why, while the Group’s details can’t be read (2A)', async () => {
    const app = await renderApp();
    // Alex is a member too, so Sam's debt to Alex is a payment Sam can record.
    const both = {
      ...group,
      members: [
        ...group.members,
        { user: { ...alex, email: 'alex@x.test' }, role: 'member', joinedAt: iso },
      ],
    };
    app.use((path) =>
      path === '/api/groups'
        ? json({ data: [both], status: 200 })
        : path === `/api/groups/${groupId}`
          ? json({}, 500)
          : undefined,
    );
    await settle(Promise.resolve(app.refreshControl().onRefresh()));
    await app.press('Open Maple House');
    await app.press('Balances');
    const record = app.pressable('Record your payment to Alex');
    expect(record.props.accessibilityState).toEqual({ disabled: true });
    expect(record.props.accessibilityHint).toBe(
      'Record is available once Maple House’s details load.',
    );
    expect(app.text()).toContain('Record is available once Maple House’s details load.');
    await app.press('Record your payment to Alex');
    expect(app.controller.getSnapshot().screen).toBe('group');
  });

  it('reopens a recent Group without a request, then shows it with its time while it is read again', async () => {
    const app = await renderApp();
    const reads: string[] = [];
    app.use((path) => {
      reads.push(path);
      return undefined;
    });
    await app.press('Open Maple House');
    const verifiedAt = refreshedLabel(app.clock.now);
    await app.press('Back to Home');
    reads.length = 0;

    // Within the display freshness window: shown at once, nothing read, no progress cue.
    app.clock.now += 20_000;
    await app.press('Open Maple House');
    app.foreground();
    await settle();
    expect(reads).toEqual([]);
    expect(app.text()).toContain('September groceries');
    expect(app.text()).not.toContain('· refreshing');

    // After it: the same figures stay, labelled with when they were verified.
    await app.press('Back to Home');
    app.clock.now += 31_000;
    const groupRead = hold();
    app.use((path) => (path === `/api/groups/${groupId}` ? groupRead.respond() : undefined));
    await app.press('Open Maple House');
    await groupRead.reached;
    await settle();
    expect(app.text()).toContain(`Saved ${verifiedAt} · refreshing`);
    expect(app.text()).toContain('September groceries');
    await app.press('Balances');
    // The Expenses, read beside the Group (#219), have answered: Balances wait to follow them.
    expect(app.text()).toContain(
      `Updating balances. These figures are from ${verifiedAt} and may change.`,
    );
    expect(app.text()).toContain('You owe₹30.00');
    expect(app.refreshControl().refreshing).toBe(false);
    app.use(() => undefined);
    groupRead.release(json({ data: group, status: 200 }));
    await settle();
    expect(app.text()).not.toContain('· refreshing');
    expect(app.text()).toContain('You owe₹30.00');
  });

  it('turns on the pull indicator for a pull, and keeps an automatic refresh silent', async () => {
    const app = await renderApp();
    await app.press('Open Maple House');
    const expenses = hold();
    app.use((path) => (path.includes('/expenses?') ? expenses.respond() : undefined));

    app.clock.now += 31_000;
    app.foreground();
    await expenses.reached;
    await settle();
    expect(app.refreshControl().refreshing).toBe(false);
    expect(app.text()).not.toContain('· refreshing');
    expect(app.progressbars()).toBe(0);
    expect(app.text()).toContain('September groceries');
    expenses.release(json(page([september])));
    await settle();

    const pulled = hold();
    app.use((path) => (path.includes('/expenses?') ? pulled.respond() : undefined));
    app.refreshControl().onRefresh();
    await pulled.reached;
    await settle();
    expect(app.refreshControl().refreshing).toBe(true);
    expect(app.text()).not.toContain('· refreshing');
    expect(app.text()).toContain('September groceries');
    pulled.release(json(page([september])));
    await settle();
    expect(app.refreshControl().refreshing).toBe(false);
  });
});

describe('App Settings sign-out', () => {
  it('lists in Settings everything the sign-out confirmation says is cleared', async () => {
    const app = await renderApp();
    await app.press('Account and settings');
    const panel = app.text();
    expect(panel).toContain('Expense drafts');
    expect(panel).toContain('unresolved payment records and save recovery keys');

    await app.press('Sign out');
    const [title, message] = vi.mocked(Alert.alert).mock.calls.at(-1)!;
    expect(title).toBe('Sign out on this device?');
    const [, cleared, advice] = /^Your (.+) will be cleared\. (.+)$/.exec(message!)!;
    expect(panel).toContain(`Sign-out clears your ${cleared} from this device.`);
    // Any interrupted save, not only a Group creation.
    expect(panel).toContain(advice);
    expect(advice).toContain('If a save was interrupted');
  });

  it('offers Try again and Continue, and no account, when the server doesn’t confirm (#202)', async () => {
    const app = await renderApp();
    const revokes: (string | null)[] = [];
    let answer = 503;
    app.use((path, init) => {
      if (path !== '/api/auth/sign-out') return undefined;
      revokes.push(new Headers(init.headers).get('Cookie'));
      return json({ success: answer === 200 }, answer);
    });
    await app.press('Account and settings');
    await app.press('Sign out');
    const [, , buttons] = vi.mocked(Alert.alert).mock.calls.at(-1)!;
    await settle(
      Promise.resolve(buttons!.find((button) => button.text === 'Sign out')!.onPress!()),
    );
    expect(app.text()).toContain('Couldn’t sign out of the server');
    expect(app.text()).not.toContain('Sam Chen');
    expect(app.text()).not.toContain('Maple House');
    expect(revokes).toEqual(['better-auth.session_token=test.signature']);

    await app.press('Try again');
    expect(revokes).toHaveLength(2);
    expect(app.text()).toContain('Couldn’t sign out of the server');

    await app.press('Continue');
    expect(revokes).toHaveLength(2);
    expect(app.text()).not.toContain('Couldn’t sign out of the server');
    expect(app.text()).toContain('Shared expenses.');
    expect(app.text()).not.toContain('Maple House');

    // The next restore revokes the kept cookie, and the sign-in screen stays.
    answer = 200;
    await settle(app.controller.restore());
    expect(revokes).toEqual([
      'better-auth.session_token=test.signature',
      'better-auth.session_token=test.signature',
      'better-auth.session_token=test.signature',
    ]);
    expect(app.text()).toContain('Shared expenses.');
    expect(app.text()).not.toContain('Couldn’t sign out of the server');
  });

  it.each(['the link', 'the return to the app'] as const)(
    'says an invitation opened offline after Continue is saved, when %s comes first (#286)',
    async (first) => {
      const app = await renderApp();
      app.use((path) =>
        path === '/api/auth/sign-out' ? json({ success: false }, 503) : undefined,
      );
      await app.press('Account and settings');
      await app.press('Sign out');
      const [, , buttons] = vi.mocked(Alert.alert).mock.calls.at(-1)!;
      await settle(
        Promise.resolve(buttons!.find((button) => button.text === 'Sign out')!.onPress!()),
      );
      await app.press('Continue');
      expect(app.text()).not.toContain('Your invitation is saved');

      // Offline, Sam's link opens the app, which also returns it to the foreground.
      app.use(() => Promise.reject(new TypeError('Network request failed')));
      const open = () => app.controller.openInvitation('http://localhost:4138/join/deadbeef');
      if (first === 'the link') {
        const opening = open();
        app.foreground();
        await settle(opening);
      } else {
        app.foreground();
        await settle(open());
      }
      expect(app.text()).toContain(
        'Your invitation is saved. Sign in to continue, then choose whether to join.',
      );
      expect(app.text()).toContain('Shared expenses.');
      expect(app.text()).not.toContain('Maple House');
    },
  );
});

describe('App Group being created', () => {
  it('discards an uncertain Group from Home only after confirming', async () => {
    const app = await renderApp();
    app.use((path, init) =>
      path === '/api/groups' && init.method === 'POST'
        ? Promise.reject(new Error('Response lost after commit'))
        : undefined,
    );
    app.controller.startCreate();
    app.controller.updateCreation({ name: 'Cabin Weekend' });
    await settle(app.controller.createGroup());
    expect(app.text()).toContain('The Group may have been created.');
    expect(app.creations.size).toBe(1);

    await app.press('Discard this form');
    const [title, , choices] = vi.mocked(Alert.alert).mock.lastCall!;
    expect(title).toBe('Discard this Group form?');
    expect(app.text()).toContain('The Group may have been created.');
    expect(app.creations.size).toBe(1);
    await settle(Promise.resolve(choices!.find((choice) => choice.text === 'Discard')!.onPress!()));
    expect(app.text()).not.toContain('The Group may have been created.');
    expect(app.creations.size).toBe(0);
  });

  it('opens a new Group on “No expenses yet”, without a pull (#189)', async () => {
    const app = await renderApp();
    const createdId = 'a00000000000000000000020';
    const created = {
      ...group,
      _id: createdId,
      name: 'Cabin Weekend',
      category: 'trip',
      members: [{ user: { ...person, email: user.email }, role: 'admin', joinedAt: iso }],
    };
    app.use((path, init) => {
      if (path === '/api/groups' && init.method === 'POST')
        return json({ data: created, status: 201 }, 201);
      if (path === `/api/groups/${createdId}`) return json({ data: created, status: 200 });
      if (path.startsWith(`/api/groups/${createdId}/expenses?`)) return json(page([]));
      if (path === `/api/groups/${createdId}/balances`)
        return json({
          data: { currency: 'INR', balances: [], debts: [], byCurrency: [] },
          status: 200,
        });
      return undefined;
    });
    app.controller.startCreate();
    app.controller.updateCreation({ name: 'Cabin Weekend' });
    await settle(app.controller.createGroup());
    expect(app.text()).toContain('Cabin Weekend');
    expect(app.text()).toContain('No expenses yet');
    expect(app.refreshControl().refreshing).toBe(false);
  });
});

describe('App Group Activity refresh', () => {
  async function onActivity() {
    const app = await renderApp();
    await app.press('Open Maple House');
    await app.press('Activity');
    expect(app.text()).toContain('September groceries');
    return app;
  }

  it('shows only the native pull indicator for a pull on Activity', async () => {
    const app = await onActivity();
    const read = hold();
    app.use((path) => (path.includes('/activity?') ? read.respond() : undefined));
    app.refreshControl().onRefresh();
    await read.reached;
    await settle();
    expect(app.refreshControl().refreshing).toBe(true);
    expect(app.progressbars()).toBe(0);
    expect(app.text()).not.toContain('Updating…');
    expect(app.text()).toContain('September groceries');

    app.use(() => undefined);
    read.release(json(activityPage));
    await settle();
    expect(app.refreshControl().refreshing).toBe(false);
  });

  it('keeps an automatic refresh of Activity silent, and shows a retry with one bar', async () => {
    const app = await onActivity();
    const read = hold();
    app.use((path) => (path.includes('/activity?') ? read.respond() : undefined));
    app.foreground();
    await read.reached;
    await settle();
    expect(app.refreshControl().refreshing).toBe(false);
    expect(app.text()).not.toContain('Refreshing');
    expect(app.progressbars()).toBe(0);
    expect(app.text()).toContain('September groceries');
    read.release(json(activityPage));
    await settle();

    const retried = hold();
    app.use((path) => (path.includes('/activity?') ? retried.respond() : undefined));
    await app.press('Group options');
    app.pressable('Refresh').props.onPress();
    await retried.reached;
    await settle();
    expect(app.text()).toMatch(/Saved .+ · refreshing/);
    expect(app.progressbars()).toBe(1);
    app.use(() => undefined);
    retried.release(json(activityPage));
    await settle();
    expect(app.text()).not.toContain('· refreshing');
    expect(app.progressbars()).toBe(0);
  });
});

describe('App Trip strip', () => {
  it('sits at the top of a Trip’s scrolling Expenses, and only a Trip’s', async () => {
    const app = await renderApp();
    const tripId = 'a00000000000000000000011';
    const trip = {
      ...group,
      _id: tripId,
      name: 'Goa Friends Trip',
      category: 'trip',
      startDate: '2026-09-17T00:00:00.000Z',
      endDate: '2026-09-20T00:00:00.000Z',
    };
    const lunch = { ...expense('b00000000000000000000011', 'Beach shack lunch'), group: tripId };
    const reads: Record<string, unknown> = {
      '/api/groups': { data: [group, trip], status: 200 },
      [`/api/groups/${tripId}`]: { data: trip, status: 200 },
      [`/api/groups/${tripId}/balances`]: {
        data: { currency: 'INR', balances: [], debts: [], byCurrency: [] },
        status: 200,
      },
    };
    app.use((path) =>
      path.startsWith(`/api/groups/${tripId}/expenses?`)
        ? json(page([lunch]))
        : path in reads
          ? json(reads[path])
          : undefined,
    );
    await settle(app.controller.refresh());
    const strips = (root: ReactTestInstance = screen!.root) =>
      root.findAll(
        (node) => (node.type as unknown) === 'View' && node.props.accessibilityRole === 'image',
      );

    await app.press('Open Maple House');
    expect(app.text()).toContain('September groceries');
    expect(strips()).toHaveLength(0);
    await app.press('Back to Home');

    await app.press('Open Goa Friends Trip');
    expect(app.text()).toContain('Beach shack lunch');
    const [strip, ...others] = strips();
    expect(others).toHaveLength(0);
    expect(strip.props.accessibilityLabel).toBe(
      'Trip from GOA to TRI, 17 to 20 September, 1 member',
    );
    // Part of the scrolling content, so it scrolls away, and above the Expenses summary.
    const content = screen!.root.findAll((node) => (node.type as unknown) === 'ScrollView')[0];
    expect(strips(content)).toHaveLength(1);
    const shown = app.text();
    expect(shown.indexOf('17–20 Sep')).toBeGreaterThan(-1);
    expect(shown.indexOf('17–20 Sep')).toBeLessThan(shown.indexOf('Spent'));
  });
});

describe('App Members and Group details', () => {
  const openMembers = async (app: Awaited<ReturnType<typeof renderApp>>) => {
    await app.press('Group options');
    await app.press('Members and Group details');
    expect(app.text()).toContain('Members and details');
  };
  const selected = (app: Awaited<ReturnType<typeof renderApp>>) =>
    ['Expenses', 'Balances', 'Activity'].filter(
      (label) => app.pressable(label).props.accessibilityState.selected,
    );

  it('opens from ⋮ as a full screen, and Android Back returns to the destination and scroll', async () => {
    const app = await renderApp();
    await app.press('Open Maple House');
    await app.press('Balances');
    await app.scrollTo(240);
    await openMembers(app);
    expect(app.text()).toContain('Sam Chen · YouMember');
    expect(app.text()).toContain('Expenses shown byMonth');
    expect(() => app.pressable('Balances')).toThrow();

    expect(await app.androidBack()).toBe(true);
    expect(selected(app)).toEqual(['Balances']);
    expect(app.text()).toContain('You owe₹30.00');
    await app.layout(700, 1600);
    expect(native.scrollTo).toHaveBeenLastCalledWith({ y: 240, animated: false });
  });

  it('the back arrow returns to Activity', async () => {
    const app = await renderApp();
    await app.press('Open Maple House');
    await app.press('Activity');
    await openMembers(app);
    await app.press('Back to Group');
    expect(selected(app)).toEqual(['Activity']);
    expect(app.text()).toContain('September groceries');
  });

  it('invites from the page through the share sheet', async () => {
    const { Share } = await import('react-native');
    const app = await renderApp();
    const inviteUrl = 'http://localhost:4138/join/deadbeef';
    app.use((path) =>
      path === `/api/groups/${groupId}/invite-link`
        ? json({
            data: { inviteCode: 'deadbeef', inviteUrl, expiresAt: '2030-01-01T00:00:00.000Z' },
            status: 200,
          })
        : undefined,
    );
    await app.press('Open Maple House');
    await openMembers(app);
    await app.press('Invite people');
    expect(Share.share).toHaveBeenLastCalledWith({
      message: `Join our Group on SplitBook: ${inviteUrl}`,
      title: 'SplitBook invitation',
    });
    expect(app.text()).toContain('Members and details');
  });

  it('stops showing the Group and its members once a foreground read is refused', async () => {
    const app = await renderApp();
    await app.press('Open Maple House');
    await openMembers(app);
    expect(app.text()).toContain('Sam Chen · YouMember');
    // An admin removed Sam on the web while SplitBook was in the background.
    app.use((path) =>
      path === `/api/groups/${groupId}`
        ? json({}, 403)
        : path === '/api/groups'
          ? json({ data: [], status: 200 })
          : undefined,
    );
    // Past the display freshness window, so the foreground refresh reads again.
    app.clock.now += 31_000;
    app.foreground();
    await settle();
    const shown = app.text();
    expect(shown).toContain('Members and details');
    expect(shown).toContain('You no longer have access to this group.');
    expect(shown).not.toContain('Sam Chen');
    expect(shown).not.toContain('Maple House');
    expect(shown).not.toContain('Expenses shown by');
  });
});

describe('App return from an Expense', () => {
  /** `date` is the Date sheet's steps from this Month, such as ['Sunday, 20 September 2026']. */
  const addExpense = async (app: Awaited<ReturnType<typeof renderApp>>, date: string[]) => {
    const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
      this: Intl.DateTimeFormat,
    ) {
      return { ...resolvedOptions.call(this), locale: 'en-IN' };
    });
    await app.press('Add expense');
    await app.type('Amount, required', '12.50');
    await app.type('Description, required', 'Weekly groceries');
    await app.press('Date: ');
    for (const step of date) await app.press(step);
    await app.press('Close Date, keeping your entries');
    await app.press('Tag: Shared');
  };
  const created = (path: string, init: RequestInit) =>
    path === `/api/groups/${groupId}/expenses` && init.method === 'POST'
      ? json({ status: 201, data: { _id: 'b00000000000000000000009', group: groupId } }, 201)
      : undefined;

  it('offers a save that may already be recorded to check, not as a draft to resume', async () => {
    const app = await renderApp();
    await app.press('Open Maple House');
    app.use((path, init) =>
      path === `/api/groups/${groupId}/expenses` && init.method === 'POST'
        ? Promise.reject(new Error('The response was lost after sending'))
        : undefined,
    );
    await addExpense(app, ['Sunday, 20 September 2026']);
    await app.press('Save expense');
    app.use(() => undefined);
    await app.press('Back to Group');

    expect(app.text()).toContain('Save not confirmed');
    expect(() => app.pressable('Resume draft')).toThrow();
    expect(() => app.pressable('Add expense')).toThrow();
    expect(app.pressable('Open to check').props.accessibilityRole).toBe('button');
    await app.press('Check save');
    // The form opens on its locked recovery, without the resume prompt.
    expect(app.text()).toContain('Details are locked until the save is confirmed.');
    expect(app.text()).not.toContain('Resume save recovery');
  });

  it('Android Back returns to the same Group, Month and scroll position', async () => {
    const app = await renderApp();
    await app.press('Open Maple House');
    await app.press('Previous month');
    await app.scrollTo(420);
    await app.press('Add expense');
    expect(app.text()).toContain('Add expense');
    await app.type('Description, required', 'Kept for later');

    expect(await app.androidBack()).toBe(true);
    expect(app.text()).toContain('August 2026');
    expect(app.text()).toContain('August rent');
    expect(app.text()).not.toContain('September groceries');
    await app.layout(700, 1600);
    expect(native.scrollTo).toHaveBeenLastCalledWith({ y: 420, animated: false });

    // Leaving never discarded the draft: Expenses offers it, and resuming skips the prompt.
    expect(app.text()).toContain('Draft: Kept for later');
    expect(() => app.pressable('Add expense')).toThrow();
    // The banner and the floating button both resume it.
    const resume = screen!.root.findAll(
      (node) =>
        (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === 'Resume draft',
    );
    expect(resume).toHaveLength(2);
    await settle(Promise.resolve(resume[1].props.onPress()));
    expect(app.text()).toContain('Add expense');
    expect(app.text()).not.toContain('Unfinished draft');
  });

  it('discards a kept draft from Expenses only after confirming', async () => {
    const app = await renderApp();
    await app.press('Open Maple House');
    await app.press('Add expense');
    await app.type('Description, required', 'Kept for later');
    await app.press('Back to Group');
    expect(app.text()).toContain('Draft: Kept for later');

    await app.press('Discard draft');
    const [title, , choices] = vi.mocked(Alert.alert).mock.lastCall!;
    expect(title).toBe('Discard this expense draft?');
    expect(app.text()).toContain('Draft: Kept for later');
    await settle(Promise.resolve(choices!.find((choice) => choice.text === 'Discard')!.onPress!()));
    expect(app.text()).not.toContain('Draft: Kept for later');
    expect(app.pressable('Add expense').props.accessibilityRole).toBe('button');
  });

  // #331: on the emulator Home moved up 3dp when its progress bar went.
  it('keeps the progress bar’s room on Home when nothing loads', async () => {
    const app = await renderApp();
    expect(app.progressbars()).toBe(0);
    const json = screen!.toJSON() as ReactTestRendererJSON;
    // The host that holds Home's scrolling content, and what sits just above it.
    const [frame] = findHosts(json, () => true).filter((node) =>
      (node.children ?? []).some(
        (child) => typeof child !== 'string' && child.type === 'ScrollView',
      ),
    );
    const children = frame!.children as ReactTestRendererJSON[];
    const slot = children[children.findIndex((child) => child.type === 'ScrollView') - 1]!;
    expect(slot.props.accessibilityRole).toBeUndefined();
    expect(layoutHeight(slot)).toBe(3);
  });

  // #331: a settled card is shorter than one with an amount; Home's last read shapes the wait.
  it('shapes the Balances placeholder as settled when Home last read the member settled there', async () => {
    const app = await renderApp();
    app.use((path) =>
      path === '/api/user/balances'
        ? json({
            data: {
              buckets: [],
              groups: [{ groupId, balances: [{ currency: 'INR', balance: 0 }] }],
            },
            status: 200,
          })
        : undefined,
    );
    await app.press('Refresh Home');
    const read = hold();
    app.use((path) => (path === `/api/groups/${groupId}/balances` ? read.respond() : undefined));
    await app.press('Open Maple House');
    await app.press('Balances');
    const [placeholder] = app
      .root()
      .findAll(
        (node) =>
          typeof node.type === 'string' &&
          node.props.accessibilityLabel === 'Loading balances' &&
          node.props.accessibilityRole !== 'progressbar',
      );
    // No line as tall as an amount (35dp); a "Settled up" line (20dp) instead.
    const heights = placeholder!
      .findAll((node) => typeof node.type === 'string')
      .map((node) => (node.props.style as { height?: number } | undefined)?.height);
    expect(heights).not.toContain(35);
    expect(heights).toContain(20);
    read.release(json({ data: { byCurrency: [] }, status: 200 }));
    await settle();
  });

  // #331: the record's skeleton takes the shape of what the list row already says about it.
  it('opens an Expense from its row over a skeleton of that record', async () => {
    const app = await renderApp();
    await app.press('Open Maple House');
    const read = hold();
    app.use((path) =>
      path === `/api/groups/${groupId}/expenses/${september._id}` ? read.respond() : undefined,
    );
    await app.press('September groceries');
    await read.reached;
    const opening = app
      .root()
      .findAll(
        (node) =>
          typeof node.type === 'string' &&
          node.props.accessibilityLabel === 'Opening this Expense…',
      );
    expect(opening).toHaveLength(1);
    const laidOut = opening[0]
      .findAll((node) => (node.type as unknown) === 'Text')
      .flatMap((node) => node.children.filter((child) => typeof child === 'string'));
    // Its texts are laid out, unseen, under the skeleton: the row's, not a stand-in's.
    expect(laidOut).toContain('September groceries');
    expect(laidOut).toContain('₹10.00');
    expect(opening[0].props.accessibilityState).toEqual({ busy: true });
    read.release(json({ status: 200, data: { ...september, revision: 0, isDeleted: false } }));
    await settle();
    expect(app.text()).toContain('You paid your share');
  });

  it('the top-bar back arrow names the Group it returns to', async () => {
    const app = await renderApp();
    await app.press('Open Maple House');
    await app.press('Add expense');
    await app.press('Back to Group');
    expect(app.text()).toContain('September 2026');
    expect(app.text()).toContain('September groceries');
  });

  /** Activity names September groceries; its event opens the record from 300 down. */
  const openFromActivity = async (app: Awaited<ReturnType<typeof renderApp>>) => {
    const [event] = activityPage.data.activities;
    app.use((path) =>
      path.startsWith(`/api/groups/${groupId}/activity?`)
        ? json({
            ...activityPage,
            data: {
              ...activityPage.data,
              activities: [{ ...event, metadata: { ...event.metadata, expenseId: september._id } }],
            },
          })
        : path === `/api/groups/${groupId}/expenses/${september._id}`
          ? json({ status: 200, data: { ...september, revision: 0, isDeleted: false } })
          : undefined,
    );
    await app.press('Open Maple House');
    await app.press('Activity');
    await app.scrollTo(300);
    await app.press('You added September groceries');
  };

  it('opens an Expense from its Activity event, and Back returns to Activity at the same place', async () => {
    const app = await renderApp();
    await openFromActivity(app);
    expect(app.text()).toContain('September groceries');
    expect(app.text()).toContain('You paid your share');
    expect(app.pressable('Back to Activity')).toBeTruthy();

    expect(await app.androidBack()).toBe(true);
    expect(app.text()).toContain('Changes in this Group');
    await app.layout(700, 1600);
    expect(native.scrollTo).toHaveBeenLastCalledWith({ y: 300, animated: false });
  });

  it('settles on the nearest place when the Activity it returns to is shorter', async () => {
    const app = await renderApp();
    await openFromActivity(app);
    expect(await app.androidBack()).toBe(true);
    await app.layout(700, 800);
    expect(native.scrollTo).toHaveBeenLastCalledWith({ y: 100, animated: false });
    // Activity is shown, so content that grows later doesn't move the member.
    native.scrollTo.mockClear();
    await app.layout(700, 1600);
    expect(native.scrollTo).not.toHaveBeenCalled();
  });

  it('confirms a save in the Month shown without offering another Month', async () => {
    const app = await renderApp();
    await app.press('Open Maple House');
    app.use(created);
    await addExpense(app, ['Sunday, 20 September 2026']);
    await app.press('Save expense');

    expect(app.text()).toContain('Expense saved · Weekly groceries');
    expect(app.text()).toContain('September 2026');
    expect(() => app.pressable('View in')).toThrow();
  });

  it('keeps the Month after saving into another and switches only when asked', async () => {
    const app = await renderApp();
    await app.press('Open Maple House');
    app.use(created);
    await addExpense(app, ['Previous month', 'Saturday, 15 August 2026']);
    await app.press('Save expense');

    expect(app.text()).toContain('Expense saved · Weekly groceries');
    expect(app.text()).toContain('September 2026');
    expect(app.text()).toContain('September groceries');
    await app.press('View in August');
    expect(app.text()).toContain('August 2026');
    expect(app.text()).toContain('August rent');
    expect(app.text()).not.toContain('Expense saved');
  });
});

describe('App Expense window (#219)', () => {
  // September has 6 pages of 20 fictional Expenses.
  const septemberPage = (number: number) => ({
    ...page(
      Array.from({ length: 20 }, (_, row) =>
        expense(
          `e${String(number * 100 + row).padStart(23, '0')}`,
          `Fictional row ${number}-${row + 1}`,
        ),
      ),
    ),
  });
  const sixPages = (path: string) => {
    if (!path.includes('/expenses?')) return undefined;
    const number = Number(new URL(path, 'http://local').searchParams.get('page'));
    const answer = septemberPage(number);
    answer.data.pagination = { page: number, limit: 20, total: 120, totalPages: 6 };
    answer.data.summary = { ...answer.data.summary, count: 120 };
    return json(answer);
  };

  it('keeps the row on screen when the newest page drops: it scrolls from where the slide began', async () => {
    const app = await renderApp();
    app.use(sixPages);
    await app.press('Open Maple House');
    for (let number = 2; number <= 5; number += 1) await app.press('Load more expenses');
    await app.scrollTo(5000);
    native.scrollTo.mockClear();
    await app.press('Load more expenses');
    expect(app.text()).toContain('Fictional row 6-20');
    expect(app.text()).not.toContain('Fictional row 1-1');
    // The list is shorter now, so Android has already clamped the offset before the shift lands.
    await app.scrollTo(4200);
    const view = screen!.root.findByType(GroupExpensesView);
    act(() => view.props.onShift(-1140));
    expect(native.scrollTo).toHaveBeenLastCalledWith({
      y: 5000 - 1140,
      animated: false,
    });
    // Only the slide's own shift starts from there.
    act(() => view.props.onShift(-60));
    expect(native.scrollTo).toHaveBeenLastCalledWith({
      y: 5000 - 1140 - 60,
      animated: false,
    });
  });
});
describe('App invitation', () => {
  it('stays on the invitation while Joining Group…, then opens the joined Group', async () => {
    const app = await renderApp();
    const joinedId = 'a00000000000000000000020';
    const post = hold();
    app.use((path, init) => {
      if (path === '/api/join/deadbeef')
        return init.method === 'POST'
          ? post.respond()
          : json({
              data: { _id: joinedId, name: 'Cedar Flat', category: 'home', memberCount: 2 },
              status: 200,
            });
      if (path === `/api/groups/${joinedId}`)
        return json({ data: { ...group, _id: joinedId, name: 'Cedar Flat' }, status: 200 });
    });
    await settle(app.controller.openInvitation('http://localhost:4138/join/deadbeef'));
    await app.press('Join Group');
    await post.reached;
    expect(app.pressable('Back to Home').props.accessibilityState).toEqual({ disabled: true });
    expect(await app.androidBack()).toBe(true);
    expect(app.text()).toContain('Joining Group…');

    post.release(json({ data: { groupId: joinedId }, status: 201 }, 201));
    await settle();
    expect(app.text()).not.toContain('You’re invited');
    expect(app.text()).toContain('Cedar FlatHousehold · 1 member · INR');
  });
});

describe('App Home', () => {
  it('shows each Group’s balance and resumes a draft in its Group’s form', async () => {
    const app = await renderApp();
    await app.press('Open Maple House');
    await app.press('Add expense');
    await app.type('Amount, required', '12.50');
    await app.type('Description, required', 'Kept for later');
    expect(await app.androidBack()).toBe(true);

    // Past the display freshness window, so Home reads its balances again.
    app.clock.now += 31_000;
    app.use((path) =>
      path === '/api/user/balances'
        ? json({
            status: 200,
            data: {
              buckets: [{ currency: 'INR', youOwe: 30, youAreOwed: 0 }],
              groups: [{ groupId, balances: [{ currency: 'INR', balance: -30 }] }],
            },
          })
        : undefined,
    );
    expect(await app.androidBack()).toBe(true);
    expect(app.pressable('Open Maple House').props.accessibilityLabel).toBe(
      'Open Maple House, Household · 1 member, You owe ₹30.00',
    );
    expect(app.text()).toContain('Continue where you left off');

    // Direct entry: Back returns to that Group's Expenses.
    await app.press('Draft, Kept for later, ₹12.50, Maple House');
    expect(app.text()).toContain('Unfinished draft');
    expect(await app.androidBack()).toBe(true);
    expect(app.text()).toContain('September groceries');
    expect(app.pressable('Back to Home')).toBeTruthy();
  });
});
