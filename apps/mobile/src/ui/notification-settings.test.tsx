import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { NotificationSettings } from './notification-settings';
import { emptyNotifications } from '../data/notification-controls';
import { activateWithScreenReader } from '../test-utils/native';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
describe('per-phone Settings notification controls', () => {
  it('offers explicit enable and renders only confirmed category choices while pending', () => {
    const onEnable = vi.fn(),
      onCategory = vi.fn(),
      onRetry = vi.fn(),
      onAndroidSettings = vi.fn();
    const actions = { onEnable, onCategory, onRetry, onAndroidSettings, onDisable: vi.fn() };
    let screen!: ReturnType<typeof create>;
    const state = emptyNotifications();
    act(() => {
      screen = create(<NotificationSettings {...actions} state={state} />);
    });
    const enable = screen.root.find(
      (n) =>
        (n.type as unknown) === 'Pressable' &&
        n.props.accessibilityLabel === 'Enable notifications',
    );
    act(() => activateWithScreenReader(enable));
    expect(onEnable).toHaveBeenCalledOnce();
    act(() =>
      screen.update(<NotificationSettings {...actions} state={{ ...state, status: 'pending' }} />),
    );
    expect(
      screen.root.find(
        (n) =>
          (n.type as unknown) === 'Pressable' &&
          n.props.accessibilityLabel === 'Enable notifications',
      ).props.disabled,
    ).toBe(true);
    const confirmed = {
      ...state.confirmed,
      available: true,
      enabled: true,
      expenseUpdates: true,
      payments: false,
    };
    act(() =>
      screen.update(
        <NotificationSettings {...actions} state={{ status: 'ready', confirmed, message: '' }} />,
      ),
    );
    const payments = screen.root.find(
      (n) => (n.type as unknown) === 'Switch' && n.props.accessibilityLabel === 'Payments',
    );
    expect(payments.props.value).toBe(false);
    act(() => payments.props.onValueChange(true));
    expect(onCategory).toHaveBeenCalledExactlyOnceWith('payments', true);
    act(() => screen.unmount());
  });
  it('shows a paused feature as not available yet, for an opted-in phone too (#839)', () => {
    const actions = {
      onEnable: vi.fn(),
      onCategory: vi.fn(),
      onRetry: vi.fn(),
      onAndroidSettings: vi.fn(),
      onDisable: vi.fn(),
    };
    const paused = { ...emptyNotifications().confirmed, available: false };
    for (const enabled of [false, true]) {
      let screen!: ReturnType<typeof create>;
      const confirmed = { ...paused, enabled, expenseUpdates: enabled, payments: enabled };
      act(() => {
        screen = create(
          <NotificationSettings {...actions} state={{ status: 'ready', confirmed, message: '' }} />,
        );
      });
      const texts = screen.root
        .findAll((n) => (n.type as unknown) === 'Text')
        .flatMap((n) => n.children.filter((child) => typeof child === 'string'))
        .join(' ');
      expect(texts).toContain('Notifications aren’t available yet.');
      const labels = screen.root
        .findAll((n) => (n.type as unknown) === 'Pressable' || (n.type as unknown) === 'Switch')
        .map((n) => n.props.accessibilityLabel);
      expect(labels).not.toContain('Enable notifications');
      expect(labels).not.toContain('Turn off notifications');
      expect(labels).not.toContain('Expense updates');
      expect(labels.includes('Open Android notification settings')).toBe(enabled);
      act(() => screen.unmount());
    }
  });
});
