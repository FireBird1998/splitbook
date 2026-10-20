import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activateWithScreenReader, touchAlong } from '../test-utils/native';
import { SettingsScreen } from './settings-screen';

// #665: Settings' Appearance choices, rendered. Fictional account only.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let screen: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => screen?.unmount());
  screen = null;
});

function render() {
  const onAppearanceChange = vi.fn();
  act(() => {
    screen = create(
      <SettingsScreen
        user={{
          id: 'a00000000000000000000001',
          name: 'Alex Rivera',
          email: 'alex@example.test',
          image: null,
        }}
        appearance="system"
        onAppearanceChange={onAppearanceChange}
        preferenceStatus="ready"
        preferenceMessage={null}
        onRetryPreference={vi.fn()}
        environment={{
          label: 'Local',
          apiOrigin: 'http://127.0.0.1:4100',
          webOrigin: 'http://127.0.0.1:4100',
        }}
        onOpenWeb={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );
  });
  const radio = (label: string): ReactTestInstance =>
    screen!.root.find(
      (node) =>
        (node.type as unknown) === 'Pressable' &&
        node.props.accessibilityRole === 'radio' &&
        node.props.accessibilityLabel === label,
    );
  return { radio, onAppearanceChange };
}

describe('Appearance', () => {
  it('changes on a tap or a screen reader’s activate, never on a drag that starts on a choice (#665)', () => {
    // Settings is short: the screen can't scroll, so nothing takes a drag.
    const { radio, onAppearanceChange } = render();
    const landed = { pageX: 200, pageY: 300 };
    act(() =>
      touchAlong(radio('Dark'), [landed, { pageX: 200, pageY: 220 }, { pageX: 201, pageY: 60 }]),
    );
    expect(onAppearanceChange).not.toHaveBeenCalled();
    act(() => touchAlong(radio('Dark'), [landed, { pageX: 203, pageY: 297 }]));
    expect(onAppearanceChange).toHaveBeenCalledExactlyOnceWith('dark');
    act(() => activateWithScreenReader(radio('Light')));
    expect(onAppearanceChange).toHaveBeenLastCalledWith('light');
    expect(onAppearanceChange).toHaveBeenCalledTimes(2);
  });
});
