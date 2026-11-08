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

function render({
  email = 'alex@example.test',
  origin = 'http://127.0.0.1:4100',
}: { email?: string; origin?: string } = {}) {
  const onAppearanceChange = vi.fn();
  act(() => {
    screen = create(
      <SettingsScreen
        user={{
          id: 'a00000000000000000000001',
          name: 'Alex Rivera',
          email,
          image: null,
        }}
        appearance="system"
        onAppearanceChange={onAppearanceChange}
        preferenceStatus="ready"
        preferenceMessage={null}
        onRetryPreference={vi.fn()}
        environment={{
          label: 'Local',
          apiOrigin: origin,
          webOrigin: origin,
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
  it('introduces appearance, phone alerts and the session', () => {
    render();
    const text = screen!.root
      .findAll((n) => (n.type as unknown) === 'Text')
      .flatMap((n) => n.children.filter((child) => typeof child === 'string'))
      .join('');
    expect(text).toContain(
      'Choose how Splitbook looks, which alerts this phone gets, and manage your session.',
    );
  });
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

// #921 QA: a line that may wrap gets a zero-width space after each hyphen between letters, so
// Android can break it there. Text the reader can select and copy must copy as it reads: an email
// or an origin with a hyphen in it copied with an invisible U+200B inside, which breaks the address
// wherever it is pasted (a mail app, a browser, a name field the server then stores).
describe('Account and server text copies as it reads (#921)', () => {
  it('keeps a selectable email and origin as they are, with no zero-width space', () => {
    const email = 'priya.venkataraghavan-subramaniam@split-book.test';
    const origin = 'https://splitbook-staging.example.test';
    render({ email, origin });
    const strings = (node: ReactTestInstance): string[] =>
      node.children.flatMap((child) => (typeof child === 'string' ? [child] : strings(child)));
    const copied = screen!.root
      .findAll((node) => (node.type as unknown) === 'Text' && node.props.selectable === true)
      .map((node) => strings(node).join(''));
    expect(copied).toEqual([email, origin, origin]);
  });
});
