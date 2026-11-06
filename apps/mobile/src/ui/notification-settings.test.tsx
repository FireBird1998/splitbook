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
});
