import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import { NotificationSettings } from './notification-settings';
import { emptyNotifications, type NotificationControls } from '../data/notification-controls';
import { activateWithScreenReader, setWindow } from '../test-utils/native';
import { flatten, unreadText } from '../test-utils/layout';
import { Banner, Card, Divider, SectionHeader, Skeleton } from './compact';
import { ThemeContext } from './theme';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const caption =
  'Alerts say only that something changed, never who or how much. Other phones keep their own settings.';
const actions = () => ({
  onEnable: vi.fn(),
  onDisable: vi.fn(),
  onCategory: vi.fn(),
  onRetry: vi.fn(),
  onAndroidSettings: vi.fn(),
});
const confirmed = {
  ...emptyNotifications().confirmed,
  available: true,
  enabled: true,
  expenseUpdates: true,
  payments: false,
};
let screen: ReactTestRenderer;
afterEach(() => {
  if (screen) act(() => screen.unmount());
});
function render(
  status: NotificationControls['status'],
  enabled = true,
  mode: 'light' | 'dark' = 'light',
  available = true,
) {
  const callbacks = actions();
  act(() => {
    screen = create(
      <ThemeContext.Provider value={getSemanticTokens(mode)}>
        <NotificationSettings
          {...callbacks}
          state={{
            status,
            confirmed: { ...confirmed, enabled, available },
            message: 'Old controller copy',
          }}
        />
      </ThemeContext.Provider>,
    );
  });
  return callbacks;
}
const text = () =>
  screen.root
    .findAll((n) => (n.type as unknown) === 'Text')
    .flatMap((n) => n.children.filter((c) => typeof c === 'string'))
    .join(' ');
const switches = () =>
  screen.root.findAll(
    (n) => (n.type as unknown) === 'Pressable' && n.props.accessibilityRole === 'switch',
  );
const press = (label: string) =>
  act(() =>
    activateWithScreenReader(
      screen.root.find(
        (n) => (n.type as unknown) === 'Pressable' && n.props.accessibilityLabel === label,
      ),
    ),
  );

describe('per-phone Settings notification controls', () => {
  it('offers one off master row and the fixed privacy caption', () => {
    const calls = render('off', false);
    expect(screen.root.findByType(SectionHeader).props.title).toBe('Notifications');
    expect(screen.root.findAllByType(Card)).toHaveLength(1);
    expect(
      screen.root.findAll((n) => n.props.title !== undefined && n.props.meta !== undefined),
    ).toHaveLength(1);
    expect(switches()[0].props.accessibilityState).toEqual({ checked: false, disabled: false });
    expect(text()).toContain(caption);
    press('Notifications on this phone, Off');
    expect(calls.onEnable).toHaveBeenCalledOnce();
    expect(calls.onDisable).not.toHaveBeenCalled();
  });
  it('shows only confirmed values and routes every row callback', () => {
    const calls = render('ready');
    expect(switches().map((n) => n.props.accessibilityState.checked)).toEqual([true, true, false]);
    expect(text()).toContain('Expenses you’re part of');
    expect(text()).toContain('Payments to or from you');
    expect(text()).toContain(caption);
    press('Notifications on this phone, On for all your Groups');
    press('Expense updates, Expenses you’re part of');
    press('Payments, Payments to or from you');
    press('Android notification settings');
    expect(calls.onDisable).toHaveBeenCalledOnce();
    expect(calls.onEnable).not.toHaveBeenCalled();
    expect(calls.onCategory.mock.calls).toEqual([
      ['expenseUpdates', false],
      ['payments', true],
    ]);
    expect(calls.onAndroidSettings).toHaveBeenCalledOnce();
  });
  it('separates Android settings with a divider reaching both Card edges', () => {
    render('ready');
    const margins = screen.root.findAllByType(Divider).map((divider) => {
      const line = divider.find((n) => (n.type as unknown) === 'View');
      const style = flatten(line.props.style);
      return [style.marginLeft, style.marginRight];
    });
    expect(margins).toEqual([
      [66, 14],
      [66, 14],
      [0, 0],
    ]);
  });
  it('replaces the off switch with a busy mark while asking Android', () => {
    render('pending', false);
    expect(switches()).toHaveLength(0);
    expect(text()).toContain('Asking Android…');
    expect(text()).toContain(caption);
    expect(text()).not.toContain('Confirming notification settings…');
    expect(screen.root.findAll((n) => (n.type as unknown) === 'ActivityIndicator')).toHaveLength(1);
  });
  it.each(['pending', 'offline', 'error'] as const)(
    'holds all confirmed switches disabled during %s',
    (status) => {
      render(status);
      expect(switches().map((n) => n.props.accessibilityState)).toEqual(
        [true, true, false].map((checked) => ({ checked, disabled: true })),
      );
      expect(
        screen.root.findAll((n) => (n.type as unknown) === 'Switch').every((n) => n.props.disabled),
      ).toBe(true);
      if (status === 'pending') {
        expect(text()).toContain('Confirming notification settings…');
        expect(screen.root.findAllByType(Banner)).toHaveLength(0);
        expect(text()).not.toContain(caption);
      }
    },
  );
  it.each([
    ['blocked', 'warning', 'Allow them in Android settings to get these alerts.', true],
    [
      'denied',
      'info',
      'Android didn’t allow notifications. Turn them on again when you’re ready.',
      false,
    ],
    [
      'offline',
      'offline',
      'Connect to change notification settings. Android settings still work offline.',
      true,
    ],
    ['error', 'error', 'Couldn’t confirm notification settings.', true],
  ] as const)(
    'renders the %s problem as one Banner outside the Card',
    (status, tone, message, enabled) => {
      const calls = render(status, enabled);
      const banner = screen.root.findByType(Banner);
      expect(banner.props.tone).toBe(tone);
      expect(banner.props.message).toBe(message);
      expect(screen.root.findByType(Card).findAllByType(Banner)).toHaveLength(0);
      expect(text()).not.toContain('Old controller copy');
      expect(text()).not.toContain(caption);
      const urgent = tone === 'warning' || tone === 'error';
      expect(
        banner.findAll(
          (n) =>
            (n.type as unknown) === 'View' &&
            n.props.accessibilityLiveRegion === (urgent ? 'assertive' : 'polite'),
        ),
      ).toHaveLength(1);
      if (status === 'blocked') {
        expect(banner.props.title).toBe('Android is blocking notifications');
        expect(
          screen.root.findAll((n) => n.props.title !== undefined && n.props.meta !== undefined)[0]
            .props.metaTone,
        ).toBe('warning');
        expect(text()).toContain('Blocked by Android');
        press('Open Android settings');
        expect(calls.onAndroidSettings).toHaveBeenCalledOnce();
      } else if (status === 'offline' || status === 'error') {
        press('Try again');
        expect(calls.onRetry).toHaveBeenCalledOnce();
        press('Android notification settings');
        expect(calls.onAndroidSettings).toHaveBeenCalledOnce();
      } else {
        expect(switches().map((n) => n.props.accessibilityState.checked)).toEqual([false]);
        expect(banner.props.children).toBeNull();
      }
    },
  );
  it('keeps an offline off phone off without offering unconfirmed category rows', () => {
    render('offline', false);
    expect(switches().map((n) => n.props.accessibilityState)).toEqual([
      { checked: false, disabled: true },
    ]);
  });
  it('shows one accessible skeleton row while loading, never stale controls', () => {
    render('loading');
    expect(switches()).toHaveLength(0);
    expect(screen.root.findAllByType(Skeleton)).toHaveLength(4);
    expect(
      screen.root.findAll(
        (n) =>
          (n.type as unknown) === 'View' &&
          n.props.accessibilityLabel === 'Loading notification settings…',
      ),
    ).toHaveLength(1);
    expect(text()).toContain(caption);
  });
  it.each([false, true])(
    'shows unavailable with no switch or caption even when enabled=%s',
    (enabled) => {
      render('ready', enabled, 'light', false);
      expect(text()).toContain('Not available yet');
      expect(switches()).toHaveLength(0);
      expect(text()).not.toContain(caption);
      expect(
        screen.root.findAll((n) => n.props.title !== undefined && n.props.meta !== undefined),
      ).toHaveLength(1);
    },
  );
  it.each(['light', 'dark'] as const)(
    'wraps at 200% on 360dp and uses %s switch tokens',
    (mode) => {
      setWindow({ width: 360, fontScale: 2 });
      render('ready', true, mode);
      const tree = screen.toJSON();
      if (Array.isArray(tree)) throw new Error('Expected one notification section');
      expect(unreadText(tree, 2, 328)).toEqual([]);
      const theme = getSemanticTokens(mode);
      const native = screen.root.findAll((n) => (n.type as unknown) === 'Switch');
      expect(native[0].props.thumbColor).toBe(theme.brand.main);
      expect(native[0].props.trackColor.true).toBe(`${theme.brand.main}80`);
      expect(native[2].props.trackColor.false).toBe(theme.borderStrong);
      expect(native.every((n) => n.parent?.props.style.alignSelf === 'flex-start')).toBe(true);
    },
  );
  it('uses dark warning tokens for the blocked meta, Banner and action', () => {
    render('blocked', true, 'dark');
    const theme = getSemanticTokens('dark');
    for (const words of [
      'Blocked by Android',
      'Android is blocking notifications',
      'Open Android settings',
    ]) {
      const label = screen.root.find(
        (n) =>
          (n.type as unknown) === 'Text' &&
          n.children.some((child) => typeof child === 'string' && child.startsWith(words)),
      );
      expect(flatten(label.props.style).color).toBe(theme.status.warning);
    }
  });
  it.each(['pending', 'blocked', 'denied', 'offline', 'error'] as const)(
    'keeps %s copy readable at 200% on 360dp',
    (status) => {
      setWindow({ width: 360, fontScale: 2 });
      render(status, status !== 'denied');
      const tree = screen.toJSON();
      if (Array.isArray(tree)) throw new Error('Expected one notification section');
      expect(unreadText(tree, 2, 328)).toEqual([]);
    },
  );
});
