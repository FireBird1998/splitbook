import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AccessibilityInfo, ScrollView, TextInput, View } from 'react-native';
import { afterEach, expect, it, vi } from 'vitest';
import type { MobileController } from '../data/mobile-controller';
import type { MobileSnapshot } from '../data/types';
import { HeldUpdateFooter } from './held-update-snackbar';
import { Snackbar } from './compact/feedback';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.useRealTimers());

it('floats above the measured Save bar, consumes once and disappears after four seconds without changing the form', async () => {
  vi.useFakeTimers();
  const timeout = vi
    .spyOn(AccessibilityInfo, 'getRecommendedTimeoutMillis')
    .mockResolvedValue(4_000);
  const owner = { generation: 1, accountId: 'alex' };
  let snapshot = { heldNotification: owner, heldNotificationNotice: null } as MobileSnapshot;
  const listeners = new Set<() => void>();
  const consume = vi.fn(() => {
    snapshot = { ...snapshot, heldNotificationNotice: null };
    listeners.forEach((fn) => fn());
  });
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    consumeHeldNotificationNotice: consume,
  } as unknown as MobileController;
  let tree!: ReactTestRenderer;
  const screen = () => (
    <View>
      <ScrollView contentOffset={{ x: 0, y: 240 }}>
        <TextInput value="Dinner being edited" />
      </ScrollView>
      <HeldUpdateFooter controller={controller}>
        <View accessibilityLabel="Save bar" />
      </HeldUpdateFooter>
    </View>
  );
  await act(async () => {
    tree = create(screen());
  });
  const form = tree.root.findByType(TextInput);
  const scroll = tree.root.findByType(ScrollView);
  const footer = tree.root.findByType(HeldUpdateFooter).findAllByType(View)[0];
  await act(async () => {
    footer.props.onLayout({ nativeEvent: { layout: { height: 92 } } });
    snapshot = { ...snapshot, heldNotificationNotice: owner };
    listeners.forEach((fn) => fn());
  });
  expect(consume).toHaveBeenCalledExactlyOnceWith(owner);
  expect(timeout).toHaveBeenCalledWith(4_000);
  expect(tree.root.findByType(Snackbar).props).toMatchObject({
    message: 'Update held until you finish',
    bottom: 104,
  });
  expect(tree.root.findByType(Snackbar).props.action).toBeUndefined();
  expect(tree.root.findByType(TextInput)).toBe(form);
  expect(tree.root.findByType(ScrollView)).toBe(scroll);
  expect(scroll.props.contentOffset.y).toBe(240);
  expect(form.props.value).toBe('Dinner being edited');
  await act(async () => {
    vi.advanceTimersByTime(3_999);
  });
  expect(tree.root.findAllByType(Snackbar)).toHaveLength(1);
  await act(async () => {
    vi.advanceTimersByTime(1);
    tree.update(screen());
  });
  expect(tree.root.findAllByType(Snackbar)).toHaveLength(0);
  await act(async () => {
    tree.unmount();
    tree = create(screen());
  });
  expect(tree.root.findAllByType(Snackbar)).toHaveLength(0);
  await act(async () => tree.unmount());
  timeout.mockRestore();
});
