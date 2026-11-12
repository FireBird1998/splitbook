import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { fakeSplitbook } from './test-utils/fake-splitbook';
import { testPhone, until } from './test-utils/test-phone';
import { unbroken } from './test-utils/layout';
import { RecordPaymentSheet } from './ui/record-payment-sheet';
import { TagManager } from './ui/tag-manager';

const runtime = vi.hoisted(() => ({
  controller: undefined as unknown,
  appearance: { mode: 'light', status: 'ready', message: null },
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
// The App keeps its real rendering and subscribes to the phone's real controller.
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
let screen: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => screen?.unmount());
  screen = undefined;
  vi.unstubAllEnvs();
});

async function setup() {
  vi.stubEnv('EXPO_PUBLIC_ANDROID_NOTIFICATIONS_ENABLED', 'false');
  vi.stubEnv('EXPO_PUBLIC_ANDROID_WIDGETS_ENABLED', 'true');
  const server = fakeSplitbook();
  const groupId = server.world.groups[0]._id;
  const { alex, sam } = server.world.people;
  server.world.pages[`/api/groups/${groupId}/currencies`] = {
    mainCurrency: { code: 'INR', locked: true },
    extraCurrencies: [],
  };
  server.world.balances[groupId] = {
    byCurrency: [
      {
        currency: 'INR',
        balances: [
          { user: { _id: alex.id, name: alex.name }, balance: -10 },
          { user: { _id: sam.id, name: sam.name }, balance: 10 },
        ],
        debts: [
          {
            from: { _id: alex.id, name: alex.name },
            to: { _id: sam.id, name: sam.name },
            amount: 10,
          },
        ],
      },
    ],
  };
  const phone = testPhone(server, { now: Date.UTC(2026, 10, 12, 12) });
  const controller = phone.open();
  runtime.controller = controller;
  await act(async () => {
    screen = create(<App />, {
      createNodeMock: () => ({ scrollTo: () => undefined, focus: () => undefined }),
    });
  });
  await act(async () => {
    await until(controller, (state) => state.auth.status === 'signed-out');
    await controller.signIn('alex');
    await controller.openGroup(groupId);
  });
  const text = () =>
    unbroken(
      screen!.root
        .findAll((node) => (node.type as unknown) === 'Text')
        .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
        .join(''),
    );
  return { server, controller, groupId, alex, sam, text };
}

async function paymentHoldingTap() {
  const { controller: c, alex, sam, text } = await setup();
  await act(async () => {
    await c.selectDestination('balances');
    await c.openRecordPayment(alex.id, sam.id, 'INR');
    c.updateSettlement({ amount: '5', note: 'Already paid outside Splitbook' });
  });
  expect(screen!.root.findByType(RecordPaymentSheet).props.visible).toBe(true);
  expect(c.getSnapshot().settlement).toMatchObject({
    status: 'editing',
    draft: { amount: '5', note: 'Already paid outside Splitbook' },
  });
  expect(text()).toContain('Amount paid');
  expect(text()).toContain('Sam Chen');
  const payment = c.getSnapshot().settlement;
  await act(async () => c.openWidget('home'));
  expect(c.getSnapshot()).toMatchObject({
    screen: 'settlement',
    notificationOpening: { status: 'held' },
    heldNotificationSource: 'widget',
  });
  expect(c.getSnapshot().settlement).toBe(payment);
  expect(c.getSnapshot().heldNotification).not.toBeNull();
  return { controller: c, text };
}

async function tagsHoldingTap() {
  const { controller: c, groupId, text } = await setup();
  await act(async () => c.openTags(groupId));
  await act(async () => until(c, (state) => !!state.tagManager.snapshot && !state.tagManager.busy));
  expect(screen!.root.findByType(TagManager).props.groupId).toBe(groupId);
  const tags = c.getSnapshot().tagManager;
  await act(async () => c.openWidget('home'));
  expect(c.getSnapshot()).toMatchObject({
    screen: 'group',
    tagsOpenFor: groupId,
    notificationOpening: { status: 'held' },
    heldNotificationSource: 'widget',
  });
  expect(c.getSnapshot().tagManager).toBe(tags);
  expect(c.getSnapshot().heldNotification).not.toBeNull();
  return { controller: c, text };
}

// Normal tests exercise each scenario's invariants too: a setup/protection regression
// must fail normally, not be swallowed by the expected notice failure below.
it('keeps the payment unchanged and offers its held widget after Close (#1158)', async () => {
  const { controller: c, text } = await paymentHoldingTap();
  await act(async () => c.closeSettlement());
  expect(c.getSnapshot().notificationOpening.status).toBe('held');
  expect(text()).toContain('Ready to open');
});

// #1163: every protected surface acknowledges a held tap.
it('shows the held widget notice on the payment sheet without changing the payment (#1158)', async () => {
  const { text } = await paymentHoldingTap();
  expect(text()).toContain('Widget held until you finish');
});

it('keeps Tags open and offers its held widget after Close (#1158)', async () => {
  const { controller: c, text } = await tagsHoldingTap();
  await act(async () => c.closeTags());
  expect(c.getSnapshot().notificationOpening.status).toBe('held');
  expect(text()).toContain('Ready to open');
});

it('shows the held widget notice on the Tags sheet without closing it (#1158)', async () => {
  const { text } = await tagsHoldingTap();
  expect(text()).toContain('Widget held until you finish');
});

it('shows the held widget notice on Currencies without closing it', async () => {
  const { controller: c, groupId, text } = await setup();
  await act(async () => c.openCurrencies(groupId));
  expect(c.getSnapshot().currenciesOpenFor).toBe(groupId);
  await act(async () => c.openWidget('home'));
  expect(c.getSnapshot().currenciesOpenFor).toBe(groupId);
  expect(text()).toContain('Widget held until you finish');
});

it('shows the held widget notice on the Group form without changing its entries', async () => {
  const { controller: c, text } = await setup();
  act(() => {
    c.startCreate();
    c.updateCreation({ name: 'Keep this Group name' });
  });
  const form = c.getSnapshot().creation;
  await act(async () => c.openWidget('home'));
  expect(c.getSnapshot().creation).toBe(form);
  expect(c.getSnapshot().screen).toBe('create');
  expect(text()).toContain('Widget held until you finish');
});

it('shows the held widget notice on Leave Group without closing it', async () => {
  const { controller: c, text } = await setup();
  await act(async () => {
    c.openMembers();
    await c.reviewLeaveGroup();
  });
  expect(c.getSnapshot().leave.status).not.toBe('closed');
  const leave = c.getSnapshot().leave;
  await act(async () => c.openWidget('home'));
  expect(c.getSnapshot().leave).toBe(leave);
  expect(text()).toContain('Widget held until you finish');
});

it('shows the held widget notice on Connected assistants', async () => {
  const { controller: c, text } = await setup();
  await act(async () => c.openSettings());
  await act(async () => until(c, (s) => s.assistants.available === true));
  act(() => c.openAssistants());
  expect(c.getSnapshot().screen).toBe('assistants');
  await act(async () => c.openWidget('home'));
  expect(c.getSnapshot().screen).toBe('assistants');
  expect(text()).toContain('Widget held until you finish');
});

it('shows the held widget notice on an invitation without navigating away', async () => {
  const { server, controller: c, text } = await setup();
  server.reply('GET', '/api/join/deadbeef', () =>
    Response.json({
      status: 200,
      data: {
        _id: 'b00000000000000000000002',
        name: 'Cedar Flat',
        category: 'home',
        memberCount: 2,
      },
    }),
  );
  await act(async () => c.openInvitation('http://localhost:4138/join/deadbeef'));
  expect(c.getSnapshot().screen).toBe('invite');
  await act(async () => c.openWidget('home'));
  expect(c.getSnapshot().screen).toBe('invite');
  expect(text()).toContain('Widget held until you finish');
});
