import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';
import { findHosts, flatten, largeTextWindows, unreadText } from '../../test-utils/layout';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setWindow, spring } from '../../test-utils/native';

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
    ).toEqual({ disabled: true, busy: false });
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

// #646: a sheet whose close discards its entries, as Record payment's does, closes with ×.
describe('Bottom sheet with a close icon (#646)', () => {
  const closing = (onDone = vi.fn(), dismissible = true) => {
    act(() => {
      renderer = create(
        <BottomSheet
          visible
          title="Record payment"
          doneIcon="close"
          doneLabel="Close"
          dismissLabel="Close without recording"
          dismissible={dismissible}
          onDone={onDone}
        >
          <CompactText>Body</CompactText>
        </BottomSheet>,
      );
    });
    return { root: renderer!.root, onDone };
  };
  const closeButton = (root: ReactTestInstance) =>
    host(root, (p) => p.accessibilityRole === 'button' && p.accessibilityLabel === 'Close');

  it('draws a 48 dp ×, named Close, in place of the word, and closes the sheet', () => {
    const { root, onDone } = closing();
    const close = closeButton(root);
    expect(
      close.findAll((node) => isHost(node, 'Ionicons')).map((icon) => icon.props.name),
    ).toEqual(['close']);
    expect(close.props.style({ pressed: false })).toMatchObject({ width: 48, height: 48 });
    const header = dragArea(root);
    const words = header
      .findAll((node) => isHost(node, 'Text'))
      .flatMap((node) => node.children.filter((child) => typeof child === 'string'));
    expect(words).toEqual(['Record payment']);
    act(() => close.props.onPress());
    expect(onDone).toHaveBeenCalledOnce();
    // The scrim still says what closing does.
    host(root, (p) => p.accessibilityLabel === 'Close without recording');
  });

  it('can’t be pressed while the sheet can’t close', () => {
    const { root } = closing(vi.fn(), false);
    const close = closeButton(root);
    expect(close.props.disabled).toBe(true);
    expect(close.props.accessibilityState).toEqual({ disabled: true });
  });
});

// #639: sheet and dialog titles were cut to one line, "Finish this expense late…" at 100% on a
// 360dp phone, "Delete this Expe…" and "Save ready expe…" at 200%. A title takes as many lines as
// it needs, beside Done, and a subtitle such as Rename Tag's "Currently …" too.
describe('Bottom sheet titles read in full (#639)', () => {
  /** Each sheet's title, its action, and any subtitle, as the app shows them. */
  const titles: [string, string, string?][] = [
    ['Finish this expense later?', 'Keep editing'],
    ['Delete this Expense?', 'Cancel'],
    ['Save 3 expenses?', 'Cancel'],
    ['Record payment', 'Close'],
    ['Rename Tag', 'Cancel', 'Currently QA Internet and broadband long name test 45ch'],
  ];
  /** The sheet's header: its title, any subtitle, and Done. */
  const header = () =>
    findHosts(renderer!.toJSON(), (props) => props.testID === 'sheet-drag-area')[0]!
      .children![1] as ReactTestRendererJSON;
  it.each([{ width: 360, height: 640, fontScale: 1 }, ...largeTextWindows])(
    'beside its action, $width dp at $fontScale× text',
    (size) => {
      setWindow(size);
      for (const [title, action, subtitle] of titles) {
        act(() => {
          renderer = create(
            <BottomSheet
              visible
              title={title}
              subtitle={subtitle}
              doneLabel={action}
              onDone={vi.fn()}
            >
              <CompactText>Body</CompactText>
            </BottomSheet>,
          );
        });
        expect(unreadText(header(), size.fontScale, size.width), title).toEqual([]);
        act(() => renderer!.unmount());
        renderer = undefined;
      }
    },
  );
});

// #646 (Designer): the header centred its action on the whole title block, so beside a title
// that wraps, "Settle up with Sam Chen" at 200%, × or Cancel sat between its lines. The action
// keeps to the title's first line, and a one-line title stays where it was.
const { lineBox, touch } = await import('./scale');
describe('Bottom sheet header action keeps to the title’s first line (#646)', () => {
  const headerRow = () =>
    findHosts(renderer!.toJSON(), (props) => props.testID === 'sheet-drag-area')[0]!
      .children![1] as ReactTestRendererJSON;
  const top = (style: unknown) => {
    const flat = flatten(style);
    return Number(flat.marginTop ?? 0);
  };
  function open(title: string, subtitle?: string) {
    act(() => {
      renderer = create(
        <BottomSheet visible title={title} subtitle={subtitle} doneLabel="Close" onDone={vi.fn()}>
          <CompactText>Body</CompactText>
        </BottomSheet>,
      );
    });
    const row = headerRow();
    const children = row.children as ReactTestRendererJSON[];
    const [titleBlock, action] = [children[0]!, children[children.length - 1]!];
    const button = findHosts(action, (props) => props.accessibilityLabel === 'Close')[0]!;
    const rowStyle = flatten(row.props.style);
    const edge = Number(rowStyle.paddingTop ?? 0);
    return {
      rowStyle,
      titleTop: edge + top(titleBlock.props.style),
      actionTop: edge + top(action.props.style),
      actionHeight: Number(flatten(button.props.style).minHeight),
    };
  }
  it.each([1, 1.3, 2])('at %s× text, beside a title that wraps or a subtitle', (fontScale) => {
    setWindow({ width: 360, height: 640, fontScale });
    for (const [title, subtitle] of [
      ['Settle up with Sam Chen and the rest of the Flat 4B household'],
      ['Rename Tag', 'Currently Groceries'],
      ['Tag'],
    ] as [string, string?][]) {
      const { rowStyle, titleTop, actionTop, actionHeight } = open(title, subtitle);
      expect(rowStyle.alignItems, title).toBe('flex-start');
      expect(actionHeight).toBe(touch.dense);
      const firstLine = titleTop + lineBox('title', fontScale).height / 2;
      expect(actionTop + actionHeight / 2, title).toBeCloseTo(firstLine, 5);
      act(() => renderer!.unmount());
      renderer = undefined;
    }
  });
  it('keeps a one-line title where it was at 100%: 16 dp down a 56 dp header', () => {
    setWindow({ width: 360, height: 640, fontScale: 1 });
    const { rowStyle, titleTop, actionTop, actionHeight } = open('Tag');
    expect(titleTop).toBe(16);
    expect(rowStyle.minHeight).toBe(56);
    expect(actionTop + actionHeight + Number(rowStyle.paddingBottom ?? 0)).toBe(56);
  });
});

const { ConfirmSheet, useConfirm } = await import('./index');
const { AccessibilityInfo } = await import('react-native');
const { getSemanticTokens } = await import('@splitbook/shared/design-tokens');
const { confirmSheetIn, confirmSheetOpen } = await import('../../test-utils/confirm-sheet');

describe('ConfirmSheet, the app’s own confirm (#646)', () => {
  const confirmation = {
    title: 'Discard this name?',
    message: 'Your new name isn’t saved.',
    action: 'Discard',
    cancel: 'Keep editing',
  };
  function ask() {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    act(() => {
      renderer = create(
        <ConfirmSheet {...confirmation} onConfirm={onConfirm} onCancel={onCancel} />,
        // The title's node, as Android hands it to the screen reader.
        { createNodeMock: (element) => ({ element }) },
      );
    });
    return { root: renderer!.root, onConfirm, onCancel };
  }

  it('shows the title as a heading, the message, Keep in the header and the red action', () => {
    const { root } = ask();
    const sheet = confirmSheetIn(root);
    expect(sheet.heading.props.children).toBe('Discard this name?');
    expect(
      root
        .findAll((node) => isHost(node, 'Text'))
        .some((node) => node.props.children === 'Your new name isn’t saved.'),
    ).toBe(true);
    // The scrim, the header's Keep editing, then Discard: each with its spoken label.
    expect(sheet.labels).toEqual(['Keep editing', 'Keep editing', 'Discard']);
    const red = getSemanticTokens('light').status.negative;
    expect(sheet.actionButton.props.style({ pressed: false }).backgroundColor).toBe(red);
    expect(sheet.modal.props.visible).toBe(true);
    expect(root.find((node) => node.props.accessibilityViewIsModal === true)).toBeDefined();
  });

  it('moves the screen reader to its title once it is on screen', () => {
    const { root } = ask();
    vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mockClear();
    const sheet = confirmSheetIn(root);
    act(() => sheet.modal.props.onShow());
    const [[node, event]] = vi.mocked(AccessibilityInfo.sendAccessibilityEvent).mock
      .calls as unknown as [[{ element: { props: Record<string, unknown> } }, string]];
    expect(event).toBe('focus');
    expect(node.element.props).toMatchObject({
      accessibilityRole: 'header',
      children: 'Discard this name?',
    });
  });

  it.each(['pressCancel', 'pressBack', 'pressOutside'] as const)(
    '%s cancels, and never confirms',
    (how) => {
      const { root, onConfirm, onCancel } = ask();
      act(() => confirmSheetIn(root)[how]());
      expect(onCancel).toHaveBeenCalledOnce();
      expect(onConfirm).not.toHaveBeenCalled();
    },
  );

  it('a swipe down cancels, and never confirms', () => {
    const { root, onConfirm, onCancel } = ask();
    release(root, { dy: 200, vy: 2, dx: 0 });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('answers once: a second tap on its action, or Back after it, does nothing', () => {
    const { root, onConfirm, onCancel } = ask();
    const sheet = confirmSheetIn(root);
    act(() => sheet.pressAction());
    act(() => sheet.pressAction());
    act(() => sheet.pressBack());
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('useConfirm mounts nothing until it asks, and closes once answered', () => {
    const onConfirm = vi.fn();
    let open: (() => void) | undefined;
    function Screen() {
      const [confirm, sheet] = useConfirm();
      open = () => confirm({ ...confirmation, onConfirm });
      return sheet;
    }
    act(() => {
      renderer = create(<Screen />);
    });
    const root = renderer!.root;
    expect(confirmSheetOpen(root)).toBe(false);
    expect(root.findAll((node) => isHost(node, 'Modal'))).toEqual([]);
    act(() => open!());
    act(() => confirmSheetIn(root).pressBack());
    expect(confirmSheetOpen(root)).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
    act(() => open!());
    act(() => confirmSheetIn(root).pressAction());
    expect(confirmSheetOpen(root)).toBe(false);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
