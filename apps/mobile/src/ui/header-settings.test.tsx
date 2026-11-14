import { act, create } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { HeaderSettings } from './header-settings';
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
  let renderer!: ReturnType<typeof create>;
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
        onMotion={() => undefined}
        onChoose={() => undefined}
        onSave={() => undefined}
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
  expect(markup).not.toContain('Tilt');
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
  act(() => {
    view = create(
      <HeaderSettings
        group={{ name: 'Maple House', category: 'home' } as unknown as MobileGroup}
        state={{ groupId: 'g', saved: header, draft: header, status: 'editing', message: null }}
        offline={false}
        motion
        motionMessage={null}
        onMotion={onMotion}
        onChoose={() => {}}
        onSave={() => {}}
        onRetry={() => {}}
        onClose={() => {}}
      />,
    );
  });
  const switches = view.root.findAll((node) => (node.type as unknown) === 'Switch');
  expect(switches).toHaveLength(available ? 1 : 0);
  const text = JSON.stringify(view.toJSON());
  expect(text.includes('On this phone')).toBe(available);
  expect(text.includes('Scenes stay still')).toBe(available);
  if (available) {
    expect(switches[0].props.accessibilityLabel).toBe('Motion');
    act(() => switches[0].props.onValueChange(false));
    expect(onMotion).toHaveBeenCalledWith(false);
  }
  act(() => view.unmount());
});
