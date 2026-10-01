import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Host stand-ins; PanResponder hands its config straight through so tests can drive a drag.
const spring = vi.hoisted(() => vi.fn(() => ({ start: vi.fn() })));
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Animated: {
    View: 'AnimatedView',
    Value: class {
      value: number;
      constructor(value: number) {
        this.value = value;
      }
      setValue(value: number) {
        this.value = value;
      }
    },
    spring,
  },
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Modal: 'Modal',
  PanResponder: { create: (config: object) => ({ panHandlers: config }) },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: 'Text',
  View: 'View',
  useWindowDimensions: () => ({ width: 412, height: 915, scale: 2, fontScale: 1 }),
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('@expo/vector-icons/Ionicons', () => ({ default: 'Ionicons' }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { BottomSheet, CompactText, FieldMarker } = await import('./index');

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => {
    renderer?.unmount();
  });
  renderer = undefined;
  spring.mockClear();
});

function sheet(onDone = vi.fn(), visible = true) {
  act(() => {
    renderer = create(
      <BottomSheet
        visible={visible}
        title="Tag"
        titleAccessory={<FieldMarker kind="required" />}
        onDone={onDone}
        footer={<CompactText>Only this Group’s active Tags are listed.</CompactText>}
      >
        <CompactText>Groceries</CompactText>
      </BottomSheet>,
    );
  });
  return { root: renderer!.root, onDone };
}
const isHost = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;
const host = (root: ReactTestInstance, match: (props: Record<string, unknown>) => boolean) => {
  const found = root.findAll((node) => typeof node.type === 'string' && match(node.props));
  expect(found).toHaveLength(1);
  return found[0];
};
const dragArea = (root: ReactTestInstance) => host(root, (p) => p.testID === 'sheet-drag-area');
const release = (root: ReactTestInstance, gesture: { dy: number; vy: number; dx: number }) => {
  act(() => {
    dragArea(root).props.onPanResponderRelease({}, gesture);
  });
};

describe('Bottom sheet dismissal keeps entries', () => {
  it('Done closes the sheet', () => {
    const { root, onDone } = sheet();
    act(() => {
      host(
        root,
        (p) => p.accessibilityRole === 'button' && p.accessibilityLabel === 'Done',
      ).props.onPress();
    });
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('Android Back behaves like Done', () => {
    const { root, onDone } = sheet();
    act(() => {
      root.find((node) => isHost(node, 'Modal')).props.onRequestClose();
    });
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('tapping outside behaves like Done and says entries are kept', () => {
    const { root, onDone } = sheet();
    const scrim = host(
      root,
      (p) =>
        p.accessibilityRole === 'button' &&
        p.accessibilityLabel === 'Close Tag, keeping your entries',
    );
    act(() => {
      scrim.props.onPress();
    });
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('a long swipe down behaves like Done', () => {
    const { root, onDone } = sheet();
    release(root, { dy: 140, vy: 0.1, dx: 0 });
    expect(onDone).toHaveBeenCalledOnce();
    expect(spring).not.toHaveBeenCalled();
  });

  it('a short swipe settles back without closing', () => {
    const { root, onDone } = sheet();
    release(root, { dy: 30, vy: 0.1, dx: 0 });
    expect(onDone).not.toHaveBeenCalled();
    expect(spring).toHaveBeenCalledOnce();
  });

  it('only claims mostly vertical downward drags', () => {
    const { root } = sheet();
    const claims = dragArea(root).props.onMoveShouldSetPanResponder as (
      event: object,
      gesture: object,
    ) => boolean;
    expect(claims({}, { dy: 20, dx: 2 })).toBe(true);
    expect(claims({}, { dy: 20, dx: 40 })).toBe(false);
    expect(claims({}, { dy: -20, dx: 0 })).toBe(false);
  });
});

describe('Bottom sheet structure', () => {
  it('shows a heading title, its marker, the body and a pinned footer', () => {
    const { root } = sheet();
    const texts = root
      .findAll((node) => isHost(node, 'Text'))
      .flatMap((node) =>
        node.children.filter((child): child is string => typeof child === 'string'),
      );
    expect(texts).toEqual(
      expect.arrayContaining([
        'Tag',
        'Required',
        'Groceries',
        'Only this Group’s active Tags are listed.',
      ]),
    );
    expect(host(root, (p) => p.accessibilityRole === 'header').children).toEqual(['Tag']);
  });

  it('is hidden when not visible', () => {
    const { root } = sheet(vi.fn(), false);
    expect(root.find((node) => isHost(node, 'Modal')).props.visible).toBe(false);
  });
});
