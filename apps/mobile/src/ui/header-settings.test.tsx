import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { HeaderSettings } from './header-settings';
import type { MobileGroup } from '../data/types';
import type { HeaderSettings as Settings } from '../data/header-settings';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
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
