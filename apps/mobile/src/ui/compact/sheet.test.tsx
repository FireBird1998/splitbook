import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spring } from '../../test-utils/native';

// The PanResponder stand-in hands its config straight through, so tests can drive a drag.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { BottomSheet, CompactText, FieldMarker } = await import('./index');

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => {
    renderer?.unmount();
  });
  renderer = undefined;
});

function sheet(onDone = vi.fn(), visible = true, dismissible = true) {
  act(() => {
    renderer = create(element(onDone, visible, dismissible));
  });
  return { root: renderer!.root, onDone };
}
function element(onDone: () => void, visible: boolean, dismissible: boolean) {
  return (
    <BottomSheet
      visible={visible}
      dismissible={dismissible}
      title="Tag"
      titleAccessory={<FieldMarker kind="required" />}
      onDone={onDone}
      footer={<CompactText>Only this Group’s active Tags are listed.</CompactText>}
    >
      <CompactText>Groceries</CompactText>
    </BottomSheet>
  );
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

  it('springs back from any swipe, and ignores Done, Back and the scrim, while it can’t close', () => {
    // e.g. Record payment while it's saving: the sheet must not stay dragged part-way.
    const { root, onDone } = sheet(vi.fn(), true, false);
    release(root, { dy: 140, vy: 0.1, dx: 0 });
    expect(spring).toHaveBeenCalledOnce();
    expect(
      host(root, (p) => p.accessibilityRole === 'button' && p.accessibilityLabel === 'Done').props
        .accessibilityState,
    ).toEqual({ disabled: true });
    const scrim = host(root, (p) => p.accessibilityLabel === 'Close Tag, keeping your entries');
    expect(scrim.props.accessibilityState).toEqual({ disabled: true });
    act(() => {
      root.find((node) => isHost(node, 'Modal')).props.onRequestClose();
      scrim.props.onPress();
    });
    expect(onDone).not.toHaveBeenCalled();
  });

  it('springs back once it stops being closable after it opened', () => {
    // The drag handler is created once, so it must see the latest state: Record starts saving.
    const { root, onDone } = sheet();
    act(() => {
      renderer!.update(element(onDone, true, false));
    });
    release(root, { dy: 140, vy: 0.1, dx: 0 });
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
