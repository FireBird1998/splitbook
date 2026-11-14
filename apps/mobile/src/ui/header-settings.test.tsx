import { act, create } from 'react-test-renderer';
import { Platform } from 'react-native';
import { afterEach, expect, it, vi } from 'vitest';
import { HeaderSettings } from './header-settings';
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
afterEach(() => {
  availability.enabled = false;
});
const header = { style: 'classic', scene: 'beach', time: 'auto' } as const;
it.each([false, true])('shows selected states, unchanged Save and offline=%s', (offline) => {
  availability.enabled = true;
  let renderer!: ReturnType<typeof create>;
  const onTilt = vi.fn();
  const onChoose = vi.fn();
  const onSave = vi.fn();
  const state: Settings = {
    groupId: 'g',
    saved: header,
    draft: header,
    status: 'editing',
    message: null,
  };
  act(() => {
    renderer = create(
      <HeaderSettings
        group={
          {
            name: 'Maple House',
            category: 'home',
            members: [],
            defaultCurrency: 'INR',
            alternateCurrencies: [],
          } as unknown as MobileGroup
        }
        state={state}
        offline={offline}
        motion={false}
        motionMessage={null}
        tilt={true}
        tiltMessage={null}
        onTilt={onTilt}
        onMotion={() => undefined}
        onChoose={onChoose}
        onSave={onSave}
        onRetry={() => undefined}
        onClose={() => undefined}
      />,
    );
  });
  const radios = renderer.root.findAll(
    (node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityRole === 'radio',
  );
  expect(
    radios.find((node) => node.props.accessibilityLabel === 'Classic')?.props.accessibilityState
      .checked,
  ).toBe(true);
  expect(
    radios.find((node) => node.props.accessibilityLabel === 'Beach')?.props.accessibilityState,
  ).toEqual({ checked: true, disabled: true });
  const save = renderer.root
    .findAll(
      (node) => (node.type as unknown) === 'Pressable' && node.props.accessibilityRole === 'button',
    )
    .find((node) => node.props.accessibilityLabel === 'Save');
  expect(save?.props.accessibilityState.disabled).toBe(true);
  const markup = JSON.stringify(renderer.toJSON());
  expect(markup).toContain('Who sees what');
  expect(markup.includes('Changing the header needs a connection')).toBe(offline);
  expect(markup).toContain('Tilt with the phone');
  const tilt = renderer.root
    .findAll((node) => (node.type as unknown) === 'Switch')
    .find((node) => node.props.accessibilityLabel === 'Tilt with the phone')!;
  expect(tilt.props.value).toBe(true);
  act(() => tilt.props.onValueChange(false));
  expect(onTilt).toHaveBeenCalledWith(false);
  expect(onChoose).not.toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();
  act(() => renderer.unmount());
});

it.each([false, true])('a changed header has Save disabled only when offline=%s', (offline) => {
  let view!: ReturnType<typeof create>;
  const state: Settings = {
    groupId: 'g',
    saved: header,
    draft: { ...header, time: 'night' },
    status: 'editing',
    message: null,
  };
  act(() => {
    view = create(
      <HeaderSettings
        group={{ name: 'Maple House', category: 'home' } as unknown as MobileGroup}
        state={state}
        offline={offline}
        motion={false}
        motionMessage={null}
        tilt={true}
        tiltMessage={null}
        onTilt={() => {}}
        onMotion={() => {}}
        onChoose={() => {}}
        onSave={() => {}}
        onRetry={() => {}}
        onClose={() => {}}
      />,
    );
  });
  const save = view.root
    .findAll((node) => (node.type as unknown) === 'Pressable')
    .find((node) => node.props.accessibilityLabel === 'Save');
  expect(save?.props.accessibilityState.disabled).toBe(offline);
  act(() => view.unmount());
});

it.each([false, true])('renders the phone card only when motion is available=%s', (available) => {
  availability.enabled = available;
  let view!: ReturnType<typeof create>;
  const onMotion = vi.fn();
  const onTilt = vi.fn();
  act(() => {
    view = create(
      <HeaderSettings
        group={{ name: 'Maple House', category: 'home' } as unknown as MobileGroup}
        state={{ groupId: 'g', saved: header, draft: header, status: 'editing', message: null }}
        offline={false}
        motion
        motionMessage={null}
        tilt
        tiltMessage={null}
        onTilt={onTilt}
        onMotion={onMotion}
        onChoose={() => {}}
        onSave={() => {}}
        onRetry={() => {}}
        onClose={() => {}}
      />,
    );
  });
  const switches = view.root.findAll((node) => (node.type as unknown) === 'Switch');
  expect(switches).toHaveLength(available ? 2 : 0);
  const text = JSON.stringify(view.toJSON());
  expect(text.includes('On this phone')).toBe(available);
  expect(text.includes('Clouds, water and people move')).toBe(available);
  expect(text.includes('The scene shifts a little as you move the phone')).toBe(available);
  // Motion is real whenever the card is shown, so the card never says scenes stay still.
  expect(text).not.toContain('stay still');
  expect(text).not.toContain('The scene shifts a little as you move it.');
  if (available) {
    expect(switches[0].props.accessibilityLabel).toBe('Motion');
    act(() => switches[0].props.onValueChange(false));
    expect(onMotion).toHaveBeenCalledWith(false);
    expect(switches[1].props.accessibilityLabel).toBe('Tilt with the phone');
    act(() => switches[1].props.onValueChange(false));
    expect(onTilt).toHaveBeenCalledWith(false);
  }
  act(() => view.unmount());
});

it.each([
  [30, ['Motion'], 'Motion is kept on this phone only.'],
  [31, ['Motion', 'Tilt with the phone'], 'Motion and Tilt are kept on this phone only.'],
])('on Android API %s the phone card offers %j', (version, labels, sentence) => {
  availability.enabled = true;
  const original = Platform.Version;
  (Platform as { Version: number }).Version = version;
  let view!: ReturnType<typeof create>;
  try {
    act(() => {
      view = create(
        <HeaderSettings
          group={{ name: 'Maple House', category: 'home' } as unknown as MobileGroup}
          state={{ groupId: 'g', saved: header, draft: header, status: 'editing', message: null }}
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
    });
    const switches = view.root.findAll((node) => (node.type as unknown) === 'Switch');
    expect(switches.map((node) => node.props.accessibilityLabel)).toEqual(labels);
    const text = JSON.stringify(view.toJSON());
    expect(text.replace(/","/g, '')).toContain(sentence);
    expect(text.includes('as you move the phone')).toBe(labels.length === 2);
  } finally {
    act(() => view.unmount());
    (Platform as { Version: number | string }).Version = original;
  }
});

it.each([
  ['a usual phone', {}, true],
  ['a tall phone at 130% text', { fontScale: 1.3 }, true],
  ['a tall phone at 200% text', { fontScale: 2 }, false],
  ['a 640 dp phone at 130% text', { height: 640, fontScale: 1.3 }, false],
  ['a short screen', { height: 560 }, false],
])('on %s the preview is pinned above the scrolling choices: %s', async (_, size, pinned) => {
  setWindow(size);
  let view!: ReturnType<typeof create>;
  const scene = { style: 'scene', scene: 'beach', time: 'day' } as const;
  await act(async () => {
    view = create(
      <HeaderSettings
        group={
          {
            name: 'Maple House',
            category: 'home',
            members: [],
            defaultCurrency: 'INR',
            alternateCurrencies: [],
          } as unknown as MobileGroup
        }
        state={{ groupId: 'g', saved: scene, draft: scene, status: 'editing', message: null }}
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
  });
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
