import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WidgetSetupRecord } from '@splitbook/shared/widget-setup';
import type { WidgetCopy, WidgetSession } from '@splitbook/shared/balances-widget';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';

const store = vi.hoisted(() => {
  vi.stubGlobal('__DEV__', true);
  return { read: vi.fn(), setup: vi.fn(), saveSetup: vi.fn() };
});
const redraw = vi.hoisted(() => vi.fn());
const appearance = vi.hoisted(() => ({ mode: 'light' as 'light' | 'dark' }));
vi.mock('react-native', async () => ({
  ...(await import('./test-utils/native')).reactNative,
  useColorScheme: () => appearance.mode,
}));
vi.mock('./widgets-native', () => ({ createWidgetsStore: () => store }));
vi.mock('./widgets', () => ({ redrawBalances: redraw }));
vi.mock('expo-font', () => ({ useFonts: () => [true] }));
vi.mock('@expo-google-fonts/outfit/400Regular', () => ({ Outfit_400Regular: 1 }));
vi.mock('@expo-google-fonts/outfit/700Bold', () => ({ Outfit_700Bold: 2 }));
import { WidgetSetup } from './widget-setup';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let screen: ReactTestRenderer | undefined;
const copy: WidgetCopy = {
  version: 1,
  accountId: 'alex',
  home: null,
  savedGroups: {
    verifiedAt: Date.parse('2026-11-09T04:11:00Z'),
    rows: [
      {
        id: 'maple',
        name: 'Maple House',
        theme: 'home',
        archived: false,
        members: 3,
        currencies: 1,
      },
    ],
  },
};
const session: WidgetSession = { status: 'authenticated', accountId: 'alex', loading: false };
const textOf = (node: ReactTestInstance) =>
  node
    .findAll((n) => (n.type as unknown) === 'Text')
    .flatMap((n) => n.children.filter((child) => typeof child === 'string'))
    .join(' ');
const text = () => textOf(screen!.root);
const host = (name: string) => screen!.root.findAll((n) => (n.type as unknown) === name);
const button = () =>
  host('Pressable').find(
    (n) =>
      n.props.accessibilityRole === 'button' &&
      n.props.accessibilityLabel !== 'Cancel widget setup',
  )!;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-09T04:11:00Z'));
  appearance.mode = 'light';
  store.read.mockResolvedValue({ copy, session });
  store.setup.mockResolvedValue(null);
  store.saveSetup.mockResolvedValue(undefined);
  redraw.mockResolvedValue(undefined);
});
afterEach(() => {
  if (screen)
    act(() => {
      host('Pressable')
        .find((n) => n.props.accessibilityLabel === 'Cancel widget setup')
        ?.props.onPress();
      screen!.unmount();
    });
  screen = undefined;
  vi.restoreAllMocks();
});
async function render(
  kind: 'Quick' | 'Group' | 'Balances',
  saved: WidgetSetupRecord | null = null,
) {
  store.setup.mockResolvedValue(saved);
  const setResult = vi.fn();
  await act(async () => {
    screen = create(
      <WidgetSetup
        widgetInfo={{
          widgetId: 989,
          widgetName: kind,
          width: 200,
          height: 200,
          screenInfo: {
            screenHeightDp: 800,
            screenWidthDp: 360,
            density: 3,
            densityDpi: 480,
            fontScale: 1,
          },
        }}
        setResult={setResult}
        renderWidget={vi.fn()}
      />,
    );
  });
  return setResult;
}

it.each([null, 'maple'])(
  'Quick Reconfigure keeps target %s, offers Save and has no Hide amounts',
  async (groupId) => {
    const saved: WidgetSetupRecord = { kind: 'quick', widgetId: 989, accountId: 'alex', groupId };
    const result = await render('Quick', saved);
    expect(text()).toContain('Quick actions widget');
    expect(text()).toContain('Choose what this widget does, and where.');
    expect(textOf(button())).toBe('Save');
    const radios = host('Pressable').filter((n) => n.props.accessibilityRole === 'radio');
    expect(
      radios.find((n) => n.props.accessibilityLabel === (groupId ? 'Maple House' : 'Ask each time'))
        ?.props.accessibilityState.checked,
    ).toBe(true);
    expect(radios.filter((n) => n.props.accessibilityState.checked)).toHaveLength(2);
    expect(host('Switch')).toHaveLength(0);
    expect(text()).not.toContain('Hide amounts');
    expect(text()).not.toContain('ON THE WIDGET');
    await act(async () => button().props.onPress());
    expect(store.saveSetup).toHaveBeenCalledExactlyOnceWith(saved);
    expect(redraw).toHaveBeenCalledOnce();
    expect(result).toHaveBeenCalledExactlyOnceWith('ok');
  },
);

it.each([null, 'maple'])('Quick Reconfigure changes target %s in place', async (groupId) => {
  await render('Quick', { kind: 'quick', widgetId: 989, accountId: 'alex', groupId });
  const label = groupId ? 'Ask each time' : 'Maple House';
  await act(async () =>
    host('Pressable')
      .find((n) => n.props.accessibilityLabel === label)!
      .props.onPress(),
  );
  expect(textOf(button())).toBe('Save');
  await act(async () => button().props.onPress());
  expect(store.saveSetup).toHaveBeenCalledExactlyOnceWith({
    kind: 'quick',
    widgetId: 989,
    accountId: 'alex',
    groupId: groupId ? null : 'maple',
  });
});

it.each([true, false])(
  'a new Quick widget offers Ask each time even with saved Groups=%s',
  async (hasGroups) => {
    store.read.mockResolvedValue({
      copy: { ...copy, savedGroups: hasGroups ? copy.savedGroups : undefined },
      session,
    });
    const result = await render('Quick');
    expect(textOf(button())).toBe('Add widget');
    expect(
      host('Pressable').find((n) => n.props.accessibilityLabel === 'Ask each time')?.props
        .accessibilityState.checked,
    ).toBe(true);
    expect(host('Switch')).toHaveLength(0);
    if (!hasGroups) expect(text()).toContain('Nothing saved yet');
    await act(async () => button().props.onPress());
    expect(store.saveSetup).toHaveBeenCalledExactlyOnceWith({
      kind: 'quick',
      widgetId: 989,
      accountId: 'alex',
      groupId: null,
    });
    expect(result).toHaveBeenCalledWith('ok');
  },
);

it.each(['light', 'dark'] as const)(
  'retains Hide amounts and its %s token colours for Group and Balances',
  async (mode) => {
    appearance.mode = mode;
    const tokens = getSemanticTokens(mode);
    for (const kind of ['Group', 'Balances'] as const) {
      const saved: WidgetSetupRecord =
        kind === 'Group'
          ? { kind: 'group', widgetId: 989, accountId: 'alex', groupId: 'maple', hideAmounts: true }
          : { kind: 'balances', widgetId: 989, hideAmounts: true };
      await render(kind, saved);
      expect(text()).toContain(
        kind === 'Group'
          ? 'Choose the Group this widget shows.'
          : 'What you owe and are owed across your Groups.',
      );
      expect(textOf(button())).toBe('Save');
      expect(host('Switch')[0].props).toMatchObject({
        value: true,
        thumbColor: tokens.brand.main,
        trackColor: { false: tokens.borderStrong, true: `${tokens.brand.main}80` },
      });
      await act(async () => button().props.onPress());
      expect(store.saveSetup).toHaveBeenLastCalledWith(saved);
      act(() => screen!.unmount());
      screen = undefined;
    }
  },
);

it('Balances setup remains available without a signed-in account or saved Groups', async () => {
  store.read.mockResolvedValue({ copy: null, session: { status: 'signed-out' } });
  const result = await render('Balances');
  expect(text()).toContain('Balances widget');
  expect(host('Switch')).toHaveLength(1);
  expect(textOf(button())).toBe('Add widget');
  await act(async () => button().props.onPress());
  expect(store.saveSetup).toHaveBeenCalledExactlyOnceWith({
    kind: 'balances',
    widgetId: 989,
    hideAmounts: false,
  });
  expect(result).toHaveBeenCalledWith('ok');
});

it('Group setup still requires saved Groups and Quick still requires sign-in', async () => {
  store.read.mockResolvedValue({ copy: { ...copy, savedGroups: undefined }, session });
  await render('Group');
  expect(text()).toContain('No Groups yet');
  expect(textOf(button())).toBe('Create a Group');
  act(() => screen!.unmount());
  store.read.mockResolvedValue({ copy: null, session: { status: 'signed-out' } });
  await render('Quick');
  expect(text()).toContain('Sign in to Splitbook first');
  expect(textOf(button())).toBe('Open Splitbook');
  expect(store.saveSetup).not.toHaveBeenCalled();
});

const setupChanges = [
  { state: 'signed out', list: ['Sign in to Splitbook first'], maple: false },
  { state: 'another account signed in', list: ['Sam’s saved Group'], maple: true },
  { state: 'chosen Group gone', list: ['Cedar House'], maple: false },
  { state: 'chosen Group archived', list: ['Cedar House'], maple: false },
] as const;

function changedSetupRead(state: (typeof setupChanges)[number]['state']) {
  if (state === 'signed out') return { copy: null, session: { status: 'signed-out' as const } };
  const otherAccount = state === 'another account signed in';
  const accountId = otherAccount ? 'sam' : 'alex';
  const row = copy.savedGroups!.rows[0];
  return {
    copy: {
      ...copy,
      accountId,
      savedGroups: {
        verifiedAt: Date.parse('2026-11-09T05:17:00Z'),
        rows: [
          ...(otherAccount
            ? [row]
            : state === 'chosen Group archived'
              ? [{ ...row, archived: true }]
              : []),
          { ...row, id: 'cedar', name: otherAccount ? 'Sam’s saved Group' : 'Cedar House' },
        ],
      },
    },
    session: { status: 'authenticated' as const, accountId, loading: false },
  };
}

for (const kind of ['Group', 'Quick'] as const)
  it.each(setupChanges)(
    `${kind} setup refuses Save and reloads the saved list after $state`,
    async ({ state, list, maple }) => {
      const saved: WidgetSetupRecord =
        kind === 'Group'
          ? {
              kind: 'group',
              widgetId: 989,
              accountId: 'alex',
              groupId: 'maple',
              hideAmounts: false,
            }
          : { kind: 'quick', widgetId: 989, accountId: 'alex', groupId: 'maple' };
      const result = await render(kind, saved);
      expect(textOf(button())).toBe('Save');
      expect(
        host('Pressable').find((node) => node.props.accessibilityLabel === 'Maple House')?.props
          .accessibilityState.checked,
      ).toBe(true);

      // The configure activity remains open while the app changes the saved account/Groups.
      store.read.mockResolvedValue(changedSetupRead(state));
      await act(async () => button().props.onPress());

      expect(text()).toContain('Choose a saved Group for this account.');
      for (const label of list) expect(text()).toContain(label);
      expect(
        host('Pressable').some((node) => node.props.accessibilityLabel === 'Maple House'),
      ).toBe(maple);
      expect(store.saveSetup).not.toHaveBeenCalled();
      expect(redraw).not.toHaveBeenCalled();
      expect(result).not.toHaveBeenCalled();
    },
  );

it.each(setupChanges)(
  'Balances setup saves Hide amounts after $state while setup is open',
  async ({ state }) => {
    const result = await render('Balances', {
      kind: 'balances',
      widgetId: 989,
      hideAmounts: false,
    });
    expect(textOf(button())).toBe('Save');
    act(() => host('Switch')[0].props.onValueChange(true));
    store.read.mockResolvedValue(changedSetupRead(state));

    await act(async () => button().props.onPress());

    expect(text()).not.toContain('Choose a saved Group for this account.');
    expect(store.saveSetup).toHaveBeenCalledExactlyOnceWith({
      kind: 'balances',
      widgetId: 989,
      hideAmounts: true,
    });
    expect(redraw).toHaveBeenCalledOnce();
    expect(result).toHaveBeenCalledExactlyOnceWith('ok');
  },
);

it('Record payment needs a saved Group, survives Reconfigure and cannot use Ask each time', async () => {
  await render('Quick');
  const payment = host('Pressable').find((n) => n.props.accessibilityLabel === 'Record payment');
  expect(payment).toBeDefined();
  await act(async () => payment!.props.onPress());
  expect(text()).not.toContain('Ask each time');
  expect(text()).toContain('Opens Settle up, on Record payment');
  expect(button().props.disabled).toBe(true);
  await act(async () =>
    host('Pressable')
      .find((n) => n.props.accessibilityLabel === 'Maple House')!
      .props.onPress(),
  );
  await act(async () => button().props.onPress());
  expect(store.saveSetup).toHaveBeenCalledWith({
    kind: 'quick',
    widgetId: 989,
    accountId: 'alex',
    groupId: 'maple',
    mode: 'payment',
  });
  await act(async () => screen!.unmount());
  screen = undefined;
  await render('Quick', store.saveSetup.mock.calls[0][0]);
  expect(
    host('Pressable').find((n) => n.props.accessibilityLabel === 'Record payment')!.props
      .accessibilityState.checked,
  ).toBe(true);
});

it('Record payment with no saved Groups offers Create a Group and cannot save an Ask each time setup', async () => {
  store.read.mockResolvedValue({
    copy: { ...copy, savedGroups: { ...copy.savedGroups!, rows: [] } },
    session,
  });
  await render('Quick');
  await act(async () =>
    host('Pressable')
      .find((n) => n.props.accessibilityLabel === 'Record payment')!
      .props.onPress(),
  );
  expect(text()).toContain('No Groups yet');
  expect(textOf(button())).toBe('Create a Group');
  expect(store.saveSetup).not.toHaveBeenCalled();
});

it('prefills the first four active Tags, lets a member swap one, and keeps their chosen order', async () => {
  const tags = ['Groceries', 'Rent', 'Bills', 'Dining', 'Travel'].map((name, i) => ({
    id: `tag${i}`,
    name,
  }));
  store.read.mockResolvedValue({ copy: { ...copy, tags: { maple: tags } }, session });
  await render('Quick', { kind: 'quick', widgetId: 989, accountId: 'alex', groupId: 'maple' });
  const chips = () => host('Pressable').filter((n) => n.props.accessibilityRole === 'checkbox');
  expect(
    chips()
      .filter((n) => n.props.accessibilityState.checked)
      .map((n) => n.props.accessibilityLabel),
  ).toEqual(['Groceries', 'Rent', 'Bills', 'Dining']);
  expect(
    chips().find((n) => n.props.accessibilityLabel === 'Travel')!.props.accessibilityState.disabled,
  ).toBe(true);
  await act(async () =>
    chips()
      .find((n) => n.props.accessibilityLabel === 'Travel')!
      .props.onPress(),
  );
  expect(chips().filter((n) => n.props.accessibilityState.checked)).toHaveLength(4);
  await act(async () =>
    chips()
      .find((n) => n.props.accessibilityLabel === 'Rent')!
      .props.onPress(),
  );
  await act(async () =>
    chips()
      .find((n) => n.props.accessibilityLabel === 'Travel')!
      .props.onPress(),
  );
  await act(async () => button().props.onPress());
  expect(store.saveSetup).toHaveBeenCalledWith({
    kind: 'quick',
    widgetId: 989,
    accountId: 'alex',
    groupId: 'maple',
    tagIds: ['tag0', 'tag2', 'tag3', 'tag4'],
  });
});

it('keeps remaining chosen Tags after an archive, permits none, and offers none for payment or Ask each time', async () => {
  store.read.mockResolvedValue({
    copy: {
      ...copy,
      tags: {
        maple: [
          { id: 'bills', name: 'Bills' },
          { id: 'rent', name: 'Rent' },
        ],
      },
    },
    session,
  });
  await render('Quick', {
    kind: 'quick',
    widgetId: 989,
    accountId: 'alex',
    groupId: 'maple',
    tagIds: ['rent', 'archived', 'bills'],
  });
  const chips = () => host('Pressable').filter((n) => n.props.accessibilityRole === 'checkbox');
  expect(chips().map((n) => n.props.accessibilityLabel)).toEqual(['Bills', 'Rent']);
  expect(chips().every((n) => n.props.accessibilityState.checked)).toBe(true);
  await act(async () => button().props.onPress());
  expect(store.saveSetup.mock.calls[0][0].tagIds).toEqual(['rent', 'bills']);
  await act(async () =>
    host('Pressable')
      .find((n) => n.props.accessibilityLabel === 'Record payment')!
      .props.onPress(),
  );
  expect(chips()).toEqual([]);
  await act(async () =>
    host('Pressable')
      .find((n) => n.props.accessibilityLabel === 'Add expense')!
      .props.onPress(),
  );
  while (chips().some((n) => n.props.accessibilityState.checked))
    await act(async () =>
      chips()
        .find((n) => n.props.accessibilityState.checked)!
        .props.onPress(),
    );
  expect(chips().filter((n) => n.props.accessibilityState.checked)).toHaveLength(0);
  await act(async () => button().props.onPress());
  expect(store.saveSetup.mock.calls.at(-1)![0].tagIds).toEqual([]);
  await act(async () =>
    host('Pressable')
      .find((n) => n.props.accessibilityLabel === 'Ask each time')!
      .props.onPress(),
  );
  expect(chips()).toEqual([]);
});
