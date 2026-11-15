import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { Platform, StyleSheet } from 'react-native';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import { SEPARATOR } from '@splitbook/shared/separator';
import { HeaderSettings } from './header-settings';
import { ThemeContext } from './theme';
import { setWindow } from '../test-utils/native';
import type { MobileGroup } from '../data/types';
import type { HeaderSettings as Settings } from '../data/header-settings';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
const availability = vi.hoisted(() => ({ enabled: false }));
vi.mock('../config', async (original) => ({
  ...(await original<typeof import('../config')>()),
  get headerSceneMotionAvailable() {
    return availability.enabled;
  },
}));
beforeEach(() => {
  // 08:00 here: Auto shows the morning sky.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-16T08:00:00'));
});
afterEach(() => {
  availability.enabled = false;
  vi.useRealTimers();
});
const header = { style: 'classic', scene: 'beach', time: 'auto' } as const;
const scene = { style: 'scene', scene: 'beach', time: 'auto' } as const;
const maple = {
  name: 'Maple House',
  category: 'home',
  members: [],
  defaultCurrency: 'INR',
  alternateCurrencies: [],
} as unknown as MobileGroup;
type Props = Partial<Parameters<typeof HeaderSettings>[0]> & { draft?: Settings['draft'] };
function page({ draft = header, ...props }: Props = {}) {
  return (
    <HeaderSettings
      group={maple}
      state={{ groupId: 'g', saved: header, draft, status: 'editing', message: null }}
      offline={false}
      motion
      motionMessage={null}
      tilt
      tiltMessage={null}
      onTilt={() => {}}
      onMotion={() => {}}
      onChoose={() => {}}
      onSave={() => {}}
      onRetry={() => {}}
      onClose={() => {}}
      {...props}
    />
  );
}
async function open(element: ReturnType<typeof page>) {
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(element);
  });
  return view;
}
const isRadio = (node: ReactTestInstance) =>
  (node.type as unknown) === 'Pressable' && node.props.accessibilityRole === 'radio';
const group = (view: ReturnType<typeof create>, label: string) =>
  view.root.find(
    (node) =>
      (node.type as unknown) === 'View' &&
      node.props.accessibilityRole === 'radiogroup' &&
      node.props.accessibilityLabel === label,
  );
const radio = (view: ReturnType<typeof create>, label: string) =>
  view.root.findAll(isRadio).find((node) => node.props.accessibilityLabel === label)!;
const switchRow = (view: ReturnType<typeof create>, title: string) =>
  view.root
    .findAll(
      (node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityRole === 'switch',
    )
    .find((node) => String(node.props.accessibilityLabel).startsWith(`${title}, `));
const switchRows = (view: ReturnType<typeof create>) =>
  view.root.findAll(
    (node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityRole === 'switch',
  );
const text = (view: ReturnType<typeof create>) => JSON.stringify(view.toJSON()).replace(/","/g, '');
/** The radios a row holds, in order, by label. */
const labels = (node: ReactTestInstance) =>
  node.findAll(isRadio).map((child) => child.props.accessibilityLabel as string);
/** The Views directly under a node that hold radios: its rows. */
const rows = (node: ReactTestInstance) =>
  node.children.filter(
    (child): child is ReactTestInstance =>
      typeof child !== 'string' && child.findAll(isRadio).length > 0,
  );

it.each([false, true])('shows selected states, unchanged Save and offline=%s', async (offline) => {
  availability.enabled = true;
  const onTilt = vi.fn();
  const onChoose = vi.fn();
  const onSave = vi.fn();
  const view = await open(page({ offline, motion: false, onTilt, onChoose, onSave }));
  expect(radio(view, 'Classic').props.accessibilityState.checked).toBe(true);
  expect(radio(view, 'Beach').props.accessibilityState).toEqual({ checked: true, disabled: true });
  const save = view.root
    .findAll(
      (node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityRole === 'button',
    )
    .find((node) => node.props.accessibilityLabel === 'Save');
  expect(save?.props.accessibilityState.disabled).toBe(true);
  const markup = text(view);
  // The note is small text under the switches, with no heading of its own.
  expect(markup).not.toMatch(/who sees what/i);
  expect(markup.includes('Changing the header needs a connection')).toBe(offline);
  expect(markup).toContain('Tilt with the phone');
  const tilt = switchRow(view, 'Tilt with the phone')!;
  expect(tilt.props.accessibilityState.checked).toBe(true);
  act(() => tilt.props.onPress());
  expect(onTilt).toHaveBeenCalledWith(false);
  expect(onChoose).not.toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();
  act(() => view.unmount());
});

it.each([false, true])(
  'a changed header has Save disabled only when offline=%s',
  async (offline) => {
    const view = await open(page({ offline, draft: { ...header, time: 'night' } }));
    const save = view.root
      .findAll((node) => (node.type as unknown) === 'Pressable')
      .find((node) => node.props.accessibilityLabel === 'Save');
    expect(save?.props.accessibilityState.disabled).toBe(offline);
    act(() => view.unmount());
  },
);

it.each([false, true])(
  'renders the phone card only when motion is available=%s',
  async (available) => {
    availability.enabled = available;
    const onMotion = vi.fn();
    const onTilt = vi.fn();
    const view = await open(page({ onMotion, onTilt }));
    expect(view.root.findAll((node) => (node.type as unknown) === 'Switch')).toHaveLength(
      available ? 2 : 0,
    );
    const words = text(view);
    expect(words.includes('On this phone')).toBe(available);
    expect(words.includes('Clouds, water and people move')).toBe(available);
    expect(words.includes('The scene shifts a little as you move the phone')).toBe(available);
    // Motion is real whenever the card is shown, so the card never says scenes stay still.
    expect(words).not.toContain('stay still');
    expect(words).not.toContain('The scene shifts a little as you move it.');
    if (available) {
      expect(switchRows(view).map((row) => row.props.accessibilityLabel)).toEqual([
        'Motion, Clouds, water and people move',
        'Tilt with the phone, The scene shifts a little as you move the phone',
      ]);
      act(() => switchRow(view, 'Motion')!.props.onPress());
      expect(onMotion).toHaveBeenCalledWith(false);
      act(() => switchRow(view, 'Tilt with the phone')!.props.onPress());
      expect(onTilt).toHaveBeenCalledWith(false);
    }
    act(() => view.unmount());
  },
);

it.each([
  [30, ['Motion'], 'Motion is kept on this phone only.'],
  [31, ['Motion', 'Tilt with the phone'], 'Motion and tilt are kept on this phone only.'],
])('on Android API %s the phone card offers %j', async (version, titles, sentence) => {
  availability.enabled = true;
  const original = Platform.Version;
  (Platform as { Version: number }).Version = version;
  let view!: ReturnType<typeof create>;
  try {
    view = await open(page());
    expect(
      switchRows(view).map((row) => String(row.props.accessibilityLabel).split(', ')[0]),
    ).toEqual(titles);
    const words = text(view);
    // The board's words, straight under the switches.
    expect(words).toContain(
      `Everyone in Maple House sees the header, scene and time you save. ${sentence}`,
    );
    expect(words.includes('as you move the phone')).toBe(titles.length === 2);
  } finally {
    act(() => view.unmount());
    (Platform as { Version: number | string }).Version = original;
  }
});

it.each(['light', 'dark'] as const)(
  'the switches are brand coloured when on (%s)',
  async (mode) => {
    availability.enabled = true;
    const tokens = getSemanticTokens(mode);
    const view = await open(
      <ThemeContext.Provider value={tokens}>{page({ tilt: false })}</ThemeContext.Provider>,
    );
    const [motion, tilt] = view.root.findAll((node) => (node.type as unknown) === 'Switch');
    expect(motion.props.value).toBe(true);
    expect(motion.props.thumbColor).toBe(tokens.brand.main);
    expect(motion.props.trackColor.true).toBe(`${tokens.brand.main}80`);
    expect(tilt.props.value).toBe(false);
    expect(tilt.props.thumbColor).not.toBe(tokens.brand.main);
    act(() => view.unmount());
  },
);

it('the Header choice is one segmented control, Scene then Classic, the chosen half raised', async () => {
  const onChoose = vi.fn();
  const view = await open(page({ draft: scene, onChoose }));
  const control = group(view, 'Header style');
  expect(labels(control)).toEqual(['Scene', 'Classic']);
  // One row: the two halves share the control's width.
  expect(StyleSheet.flatten(control.props.style)).toMatchObject({ flexDirection: 'row' });
  for (const half of control.findAll(isRadio))
    expect(StyleSheet.flatten(half.props.style)).toMatchObject({ flex: 1 });
  expect(radio(view, 'Scene').props.accessibilityState).toEqual({ checked: true, disabled: false });
  expect(radio(view, 'Classic').props.accessibilityState).toEqual({
    checked: false,
    disabled: false,
  });
  act(() => radio(view, 'Classic').props.onPress());
  expect(onChoose).toHaveBeenCalledWith({ style: 'classic' });
  act(() => view.unmount());
});

it('while saving, no choice can be changed', async () => {
  const view = await open(
    <HeaderSettings
      group={maple}
      state={{ groupId: 'g', saved: header, draft: scene, status: 'saving', message: null }}
      offline={false}
      motion
      motionMessage={null}
      tilt
      tiltMessage={null}
      onTilt={() => {}}
      onMotion={() => {}}
      onChoose={() => {}}
      onSave={() => {}}
      onRetry={() => {}}
      onClose={() => {}}
    />,
  );
  for (const label of ['Scene', 'Classic', 'Beach', 'Night'])
    expect(radio(view, label).props.accessibilityState.disabled, label).toBe(true);
  act(() => view.unmount());
});

it('the scenes are a 2×2 grid of cards in the board’s order, the chosen one ticked', async () => {
  const onChoose = vi.fn();
  const view = await open(page({ draft: { ...scene, scene: 'sakura' }, onChoose }));
  const grid = group(view, 'Scene');
  expect(rows(grid).map(labels)).toEqual([
    ['Beach', 'Sakura'],
    ['Eco city', 'Mountain village'],
  ]);
  for (const row of rows(grid)) {
    expect(StyleSheet.flatten(row.props.style)).toMatchObject({ flexDirection: 'row' });
    for (const card of row.findAll(isRadio))
      expect(StyleSheet.flatten(card.props.style)).toMatchObject({ flex: 1 });
  }
  const ticks = (label: string) =>
    radio(view, label).findAll(
      (node) => (node.type as unknown) === 'Ionicons' && node.props.name === 'checkmark',
    ).length;
  expect(['Beach', 'Sakura', 'Eco city', 'Mountain village'].map(ticks)).toEqual([0, 1, 0, 0]);
  const tokens = getSemanticTokens('light');
  const chosen = StyleSheet.flatten(radio(view, 'Sakura').props.style);
  expect(chosen).toMatchObject({
    borderColor: tokens.brand.main,
    backgroundColor: tokens.brand.bg,
  });
  expect(StyleSheet.flatten(radio(view, 'Beach').props.style)).toMatchObject({
    borderColor: tokens.borderStrong,
    backgroundColor: tokens.surface,
  });
  // A wide picture of the island over its name.
  expect(
    radio(view, 'Eco city').findAll((node) => (node.type as unknown) === 'LinearGradient'),
  ).toHaveLength(1);
  act(() => radio(view, 'Eco city').props.onPress());
  expect(onChoose).toHaveBeenCalledWith({ scene: 'eco-city' });
  act(() => view.unmount());
});

it('Time of day is a full-width Auto row, then four tiles with their skies in one row', async () => {
  const onChoose = vi.fn();
  const view = await open(page({ draft: { ...scene, time: 'sunset' }, onChoose }));
  const times = group(view, 'Time of day');
  const [auto, tiles] = rows(times);
  expect(labels(auto)).toEqual([`Auto, Follows your clock${SEPARATOR}morning now`]);
  expect(auto.props.accessibilityState).toEqual({ checked: false, disabled: false });
  expect(
    auto.findAll(
      (node) => (node.type as unknown) === 'Ionicons' && node.props.name === 'time-outline',
    ),
  ).toHaveLength(1);
  expect(text(view)).toContain(`Follows your clock${SEPARATOR}morning now`);
  expect(labels(tiles)).toEqual(['Morning', 'Day', 'Sunset', 'Night']);
  expect(StyleSheet.flatten(tiles.props.style)).toMatchObject({ flexDirection: 'row' });
  for (const tile of tiles.findAll(isRadio)) {
    expect(StyleSheet.flatten(tile.props.style)).toMatchObject({ flex: 1 });
    expect(tile.findAll((node) => (node.type as unknown) === 'LinearGradient')).toHaveLength(1);
  }
  expect(radio(view, 'Sunset').props.accessibilityState).toEqual({
    checked: true,
    disabled: false,
  });
  act(() => auto.props.onPress());
  expect(onChoose).toHaveBeenCalledWith({ time: 'auto' });
  act(() => view.unmount());
});

it.each([
  [1.3, 2],
  [2, 2],
])('at %s× text the time tiles go two to a row', async (fontScale, perRow) => {
  setWindow({ fontScale });
  const view = await open(page({ draft: scene }));
  const [, ...tileRows] = rows(group(view, 'Time of day'));
  expect(tileRows.map(labels)).toEqual(
    perRow === 2
      ? [
          ['Morning', 'Day'],
          ['Sunset', 'Night'],
        ]
      : [['Morning', 'Day', 'Sunset', 'Night']],
  );
  // The scenes stay two to a row.
  expect(rows(group(view, 'Scene')).map(labels)).toHaveLength(2);
  act(() => view.unmount());
});

it('Classic greys the Scene and Time of day choices and keeps them from being pressed', async () => {
  const view = await open(page());
  for (const label of [
    'Beach',
    'Mountain village',
    `Auto, Follows your clock${SEPARATOR}morning now`,
    'Night',
  ])
    expect(radio(view, label).props.accessibilityState, label).toMatchObject({ disabled: true });
  for (const title of ['Scene', 'Time of day']) {
    // The section: the nearest View around the heading that holds the choices too.
    let section: ReactTestInstance | null = view.root.find(
      (node) =>
        (node.type as unknown) === 'Text' &&
        node.props.accessibilityRole === 'header' &&
        [node.props.children].flat().includes(title),
    );
    while (section && section.findAll(isRadio).length === 0) section = section.parent;
    expect(StyleSheet.flatten(section!.props.style), title).toMatchObject({ opacity: 0.45 });
  }
  act(() => view.unmount());
});

it.each([
  ['Auto', scene, `Beach${SEPARATOR}now, morning`],
  [
    'a fixed time',
    { ...scene, scene: 'mountain-village', time: 'night' } as const,
    `Mountain village${SEPARATOR}Night`,
  ],
  ['Classic', header, 'Classic'],
])('the preview caption reads PREVIEW and the choice for %s', async (_, draft, caption) => {
  const view = await open(page({ draft }));
  const words = text(view);
  expect(words).toContain('Preview');
  expect(words).toContain(caption);
  // The caption strip is the card's own surface in the app's theme, never forced dark at night.
  const strip = view.root.find(
    (node) => (node.type as unknown) === 'Text' && node.props.children === caption,
  );
  expect(StyleSheet.flatten(strip.props.style).color).toBe(
    getSemanticTokens('light').textSecondary,
  );
  act(() => view.unmount());
});

it.each([
  ['a usual phone', {}, true],
  ['a tall phone at 130% text', { fontScale: 1.3 }, true],
  ['a tall phone at 200% text', { fontScale: 2 }, false],
  ['a 640 dp phone at 130% text', { height: 640, fontScale: 1.3 }, false],
  ['a short screen', { height: 560 }, false],
])('on %s the preview is pinned above the scrolling choices: %s', async (_, size, pinned) => {
  setWindow(size);
  const view = await open(page({ draft: { ...scene, time: 'day' } }));
  const isPreview = (node: { type: unknown; props: Record<string, unknown> }) =>
    node.type === 'View' &&
    (node.props.accessibilityRole === 'image' ||
      node.props.accessibilityLabel === 'Loading Header scene');
  const scroll = view.root.findAll((node) => (node.type as unknown) === 'ScrollView')[0];
  expect(view.root.findAll(isPreview)).toHaveLength(1);
  // Pinned means the preview is not among the things that scroll away.
  expect(scroll.findAll(isPreview)).toHaveLength(pinned ? 0 : 1);
  // The choices always scroll.
  expect(
    scroll.findAll((node) => node.props.accessibilityLabel === 'Header style').length,
  ).toBeGreaterThan(0);
  act(() => view.unmount());
});
