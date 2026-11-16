import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import { emptyNotifications } from '../data/notification-controls';
import { activateWithScreenReader, touchAlong } from '../test-utils/native';
import { SettingsScreen } from './settings-screen';
import { ThemeContext } from './theme';

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
  spending = { enabled: false, message: null as string | null },
  notifications = false,
  mode = 'light',
}: {
  email?: string;
  origin?: string;
  spending?: { enabled: boolean; message: string | null };
  notifications?: boolean;
  mode?: 'light' | 'dark';
} = {}) {
  const onAppearanceChange = vi.fn();
  const onSpendingChange = vi.fn();
  act(() => {
    screen = create(
      <ThemeContext.Provider value={getSemanticTokens(mode)}>
        <SettingsScreen
          notifications={
            notifications
              ? {
                  state: emptyNotifications(),
                  onEnable: vi.fn(),
                  onDisable: vi.fn(),
                  onCategory: vi.fn(),
                  onRetry: vi.fn(),
                  onAndroidSettings: vi.fn(),
                }
              : undefined
          }
          spendingByDay={{ ...spending, onChange: onSpendingChange }}
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
        />
      </ThemeContext.Provider>,
    );
  });
  const radio = (label: string): ReactTestInstance =>
    screen!.root.find(
      (node) =>
        (node.type as unknown) === 'Pressable' &&
        node.props.accessibilityRole === 'radio' &&
        node.props.accessibilityLabel === label,
    );
  return { radio, onAppearanceChange, onSpendingChange };
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

// #1274: board SpendAndSettings. One phone switch in a Home section of its own.
describe('Home: Spending by day', () => {
  const texts = () =>
    screen!.root
      .findAll((n) => (n.type as unknown) === 'Text')
      .map((n) => n.children.filter((child) => typeof child === 'string').join(''));
  const headers = () =>
    screen!.root
      .findAll((n) => (n.type as unknown) === 'Text' && n.props.accessibilityRole === 'header')
      .map((n) => n.children.join('').trim());
  const spendingRow = () =>
    screen!.root.find(
      (n) =>
        (n.type as unknown) === 'Pressable' &&
        n.props.accessibilityRole === 'switch' &&
        String(n.props.accessibilityLabel).startsWith('Spending by day, '),
    );
  const spendingSwitch = () => spendingRow().find((n) => (n.type as unknown) === 'Switch');

  it('is a Home section between Notifications and Appearance', () => {
    render({ notifications: true });
    expect(headers().slice(0, 3)).toEqual(['Notifications', 'Home', 'Appearance']);
    act(() => screen?.unmount());
    render();
    expect(headers().slice(0, 2)).toEqual(['Home', 'Appearance']);
  });

  it('reads as the board says while off, a switch row TalkBack hears whole', () => {
    render();
    const all = texts();
    expect(all).toContain('Spending by day');
    expect(all).toContain(
      'Your share of spending this month, on Home, with a calendar of each day.',
    );
    expect(all).toContain('Off. Home shows your balances and Groups, as it does today.');
    expect(all.join(' ')).not.toContain('On. It counts');
    expect(spendingRow().props.accessibilityLabel).toBe(
      'Spending by day, Your share of spending this month, on Home, with a calendar of each day.',
    );
    expect(spendingRow().props.accessibilityState).toMatchObject({ checked: false });
    expect(spendingSwitch().props.value).toBe(false);
  });

  it('says what the figure counts once on', () => {
    render({ spending: { enabled: true, message: null } });
    const all = texts();
    expect(all).toContain(
      'On. It counts your share of each Expense. Payments between members are left out.',
    );
    expect(all.join(' ')).not.toContain('Off. Home shows');
    expect(spendingRow().props.accessibilityState).toMatchObject({ checked: true });
  });

  it('turns on and off from the whole row, by tap or screen reader', () => {
    const off = render();
    act(() => spendingRow().props.onPress());
    expect(off.onSpendingChange).toHaveBeenCalledExactlyOnceWith(true);
    act(() => screen?.unmount());
    const on = render({ spending: { enabled: true, message: null } });
    act(() => activateWithScreenReader(spendingRow()));
    expect(on.onSpendingChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it.each(['light', 'dark'] as const)('is brand coloured when on (%s)', (mode) => {
    const tokens = getSemanticTokens(mode);
    render({ spending: { enabled: true, message: null }, mode });
    expect(spendingSwitch().props.thumbColor).toBe(tokens.brand.main);
    expect(spendingSwitch().props.trackColor.true).toBe(`${tokens.brand.main}80`);
  });

  it('says when the phone couldn’t keep the choice', () => {
    render({
      spending: {
        enabled: true,
        message: 'Couldn’t keep Spending by day on this phone. Please try again.',
      },
    });
    expect(texts()).toContain('Couldn’t keep Spending by day on this phone. Please try again.');
  });
});
