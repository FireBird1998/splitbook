import { createRef } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextFrame } from '../test-utils/native';
import { GroupLedgerList, type LedgerScrollHandle } from './group-ledger-list';
import { ledgerItems } from './ledger-items';
import { visibleRowAnchor, type RowPlaces } from './return-scroll';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let screen: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => screen?.unmount());
  screen = undefined;
});

function rendered({
  firstPage = 1,
  buffered = false,
  tail = 0,
  preceding = 0,
  nativeFeedback = false,
  nativeCapture = false,
} = {}) {
  const ref = createRef<LedgerScrollHandle>();
  const layout = new Map<unknown, { top: number; height: number; physicalOffset: number }>();
  let y = 4500;
  let physicalTop = 4481;
  let surfaceHeight = 700;
  let holding = false;
  let holdingSurface = false;
  const waiting: (() => void)[] = [];
  const surfaces: (() => void)[] = [];
  const clock = { now: 1000, dispatched: 0 };
  const feedback: number[] = [];
  const offset = vi.fn(({ offset }: { offset: number }) => {
    y = offset;
    if (!nativeFeedback) return;
    // Android RN0.86.3 ReactScrollViewHelper.kt drops SCROLL without delayed dispatch when
    // throttle >= max(17, now-lastDispatch); a native move can therefore have no JS feedback.
    const throttle = list().props.scrollEventThrottle ?? 0;
    if (throttle >= Math.max(17, clock.now - clock.dispatched)) return;
    clock.dispatched = clock.now;
    feedback.push(y);
    list().props.onScroll({ nativeEvent: { contentOffset: { y } } });
  });
  const index = vi.fn(); // Index navigation can be an estimate; it never proves viewport placement.
  const rows = vi.fn<(rows: RowPlaces) => void>();
  const shift = vi.fn();
  const data = ledgerItems(
    [
      {
        key: 'day',
        label: 'Tuesday',
        rows: [
          ...(buffered ? [{ id: 'before' }] : []),
          ...Array.from({ length: preceding }, (_, row) => ({ id: `earlier${row}` })),
          { id: 'kept' },
          { id: 'next' },
          ...Array.from({ length: tail }, (_, row) => ({ id: `later${row}` })),
        ],
      },
    ],
    (row) => row.id,
  );
  const view = (page: number) => (
    <GroupLedgerList
      items={data}
      firstPage={page}
      renderRow={(item) =>
        item.kind === 'day' ? (
          <Text>{item.label}</Text>
        ) : (
          <Text accessibilityLabel={item.row.id}>{item.row.id}</Text>
        )
      }
      header={<Text>Summary</Text>}
      nativeRef={ref}
      scroll={nativeFeedback ? { scrollEventThrottle: 100 } : undefined}
      onRowsLayout={rows}
      onShift={shift}
    />
  );
  act(() => {
    screen = create(view(firstPage), {
      createNodeMock: (node) => {
        if (node.type === 'FlatList')
          return {
            scrollToIndex: index,
            scrollToOffset: offset,
            getNativeScrollRef: () => ({
              measureInWindow: (
                answer: (x: number, y: number, width: number, height: number) => void,
              ) => {
                const capturedHeight = surfaceHeight;
                const finish = () => answer(0, 100, 360, capturedHeight);
                if (holdingSurface) surfaces.push(finish);
                else finish();
              },
            }),
          };
        return {
          measureInWindow: (
            answer: (x: number, y: number, width: number, height: number) => void,
          ) => {
            const ref =
              node.props && typeof node.props === 'object' && 'ref' in node.props
                ? node.props.ref
                : undefined;
            const cell = layout.get(ref);
            if (cell) {
              const capturedY = 100 + physicalTop + cell.physicalOffset - y;
              const finish = () =>
                answer(
                  0,
                  nativeCapture ? capturedY : 100 + physicalTop + cell.physicalOffset - y,
                  360,
                  cell.height,
                );
              if (holding) waiting.push(finish);
              else finish();
            }
          },
        };
      },
    });
  });
  const list = () => screen!.root.find((node) => (node.type as unknown) === 'FlatList');
  const cell = (label = 'kept') => {
    let node: ReactTestInstance | null = screen!.root.find(
      (node) => typeof node.type === 'string' && node.props.accessibilityLabel === label,
    );
    while (node && !((node.type as unknown) === 'View' && node.props.onLayout)) node = node.parent;
    if (!node) throw new Error('Missing native cell');
    return node;
  };
  const report = (top = 4481, label = 'kept') =>
    act(() => {
      layout.set(cell(label).props.ref, {
        top,
        height: 60,
        physicalOffset: label === 'before' ? -300 : label === 'next' ? 100 : 0,
      });
      cell(label).props.onLayout({ nativeEvent: { layout: { y: top, height: 60 } } });
    });
  act(() => {
    list().props.onLayout({ nativeEvent: { layout: { height: 700 } } });
    list().props.onContentSizeChange(360, 9000);
    list().props.onScroll({ nativeEvent: { contentOffset: { y } } });
  });
  return {
    ref,
    index,
    offset,
    report,
    shift,
    rows,
    frame: () => act(() => nextFrame()),
    moveSpacer: (top: number) => {
      physicalTop = top;
    },
    update: (page: number) => act(() => screen!.update(view(page))),
    visible: (keys = ['kept']) =>
      act(() =>
        list().props.onViewableItemsChanged({
          viewableItems: data
            .filter((item) => item.kind === 'row' && keys.includes(item.key))
            .map((item) => ({ item, isViewable: true })),
        }),
      ),
    scroll: (value: number) =>
      act(() => {
        y = value;
        list().props.onScroll({ nativeEvent: { contentOffset: { y } } });
      }),
    drag: () => act(() => list().props.onScrollBeginDrag({})),
    hold: () => {
      holding = true;
    },
    holdSurface: () => {
      holdingSurface = true;
    },
    releaseSurfaceOne: () => act(() => surfaces.shift()!()),
    releaseSurface: () =>
      act(() => {
        holdingSurface = false;
        while (surfaces.length) surfaces.shift()!();
      }),
    releaseOne: () => act(() => waiting.shift()!()),
    release: () =>
      act(() => {
        holding = false;
        while (waiting.length) waiting.shift()!();
      }),
    unmount: () =>
      act(() => {
        screen!.unmount();
        screen = undefined;
      }),
    surface: (height: number) => {
      surfaceHeight = height;
    },
    viewport: (height = 700) => {
      surfaceHeight = height;
      act(() => list().props.onLayout({ nativeEvent: { layout: { height } } }));
    },
    header: (height: number) =>
      act(() =>
        list().props.ListHeaderComponent.props.onLayout({ nativeEvent: { layout: { height } } }),
      ),
    failedIndex: (averageItemLength: number, highestMeasuredFrameIndex: number, index = 44) =>
      act(() =>
        list().props.onScrollToIndexFailed({ averageItemLength, highestMeasuredFrameIndex, index }),
      ),
    content: (height: number) => act(() => list().props.onContentSizeChange(360, height)),
    measurable: () => cell().props.collapsable,
    feedback,
    advance: (milliseconds: number) => {
      clock.now += milliseconds;
    },
  };
}

describe('native ledger viewport alignment (#179)', () => {
  it.each(['before native feedback', 'after native feedback'] as const)(
    'ignores an overlapping old native capture after the same held row already moved %s',
    (feedback) => {
      const app = rendered({ nativeCapture: true });
      app.report();
      app.visible();
      const origin = { y: 4500, anchor: { key: 'kept', offset: 19 } };
      app.ref.current!.restore(origin);
      app.frame();
      expect(app.ref.current!.restore(origin)).toBe(true);
      app.drag();
      app.scroll(4500);
      app.visible();
      app.update(2);
      app.moveSpacer(3481);
      app.hold();
      app.frame(); // Both native snapshots have top=-1019 before either reply is delivered.
      app.content(8000);
      app.frame();
      app.releaseOne();
      expect(app.offset).toHaveBeenLastCalledWith({ offset: 3500, animated: false });
      if (feedback === 'after native feedback') app.scroll(3500);
      app.releaseOne();
      expect(app.offset).toHaveBeenLastCalledWith({ offset: 3500, animated: false });
      app.release();
      app.frame();
      expect(app.shift).toHaveBeenCalledExactlyOnceWith(-1000);
    },
  );

  it.each(['before native feedback', 'after native feedback'] as const)(
    'ignores an overlapping old capture after the same pending return applies its first correction %s',
    (feedback) => {
      const app = rendered({ nativeCapture: true });
      app.report();
      app.scroll(0);
      const target = { y: 4500, anchor: { key: 'kept', offset: 19 } };
      app.hold();
      app.ref.current!.restore(target);
      app.frame();
      app.content(9000);
      app.frame();
      app.releaseOne();
      expect(app.offset).toHaveBeenLastCalledWith({ offset: 4500, animated: false });
      if (feedback === 'after native feedback') app.scroll(4500);
      app.releaseOne();
      expect(app.offset).toHaveBeenLastCalledWith({ offset: 4500, animated: false });
      app.release();
      app.frame();
      expect(app.ref.current!.restore(target)).toBe(true);
    },
  );

  it('remeasures an active return when native scrolling arrives between surface and cell replies', () => {
    const app = rendered({ nativeCapture: true });
    app.report();
    app.scroll(0);
    const target = { y: 4500, anchor: { key: 'kept', offset: 19 } };
    app.holdSurface();
    app.hold();
    app.ref.current!.restore(target);
    app.frame(); // Surface snapshot starts at the original scroll basis.
    app.scroll(1500);
    app.viewport();
    app.frame(); // A second surface snapshot uses the actual newer physical position.
    app.releaseSurfaceOne();
    app.releaseOne(); // Old surface basis must not finish a return using a newer cell sample.
    expect(app.offset).not.toHaveBeenCalled();
    app.releaseSurfaceOne();
    app.releaseOne();
    expect(app.offset).toHaveBeenLastCalledWith({ offset: 4500, animated: false });
    app.scroll(4500);
    app.releaseSurface();
    app.release();
    app.frame();
    expect(app.ref.current!.restore(target)).toBe(true);
  });

  it('does not complete from a native cell capture invalidated by a newer real layout', () => {
    const app = rendered({ nativeCapture: true });
    app.report();
    const target = { y: 4500, anchor: { key: 'kept', offset: 19 } };
    app.hold();
    app.ref.current!.restore(target);
    app.frame(); // Old native point is already aligned, but its reply has not reached JavaScript.
    app.moveSpacer(4703);
    app.report(4703);
    app.releaseOne();
    expect(app.ref.current!.restore(target)).toBe(false);
    app.release();
    app.frame();
    expect(app.offset).toHaveBeenLastCalledWith({ offset: 4722, animated: false });
    app.frame();
    expect(app.ref.current!.restore(target)).toBe(true);
  });

  it('relinquishes a previously completed correction when native focus follows a late old-cell layout', () => {
    const app = rendered();
    app.report(4481);
    app.report(4581, 'next');
    const target = { y: 4500, anchor: { key: 'kept', offset: 19 } };
    app.ref.current!.restore(target);
    app.frame();
    expect(app.ref.current!.restore(target)).toBe(true);
    app.offset.mockClear();
    app.report(4481); // A late old-cell layout reopens correction before native focus movement.
    app.scroll(4545);
    app.visible(['next']);
    app.frame();
    expect(app.offset).not.toHaveBeenCalled();
  });

  it('does not replay a completed return after native accessibility scrolling without a touch drag', () => {
    const app = rendered();
    app.report(4481);
    app.report(4581, 'next');
    const target = { y: 4500, anchor: { key: 'kept', offset: 19 } };
    expect(app.ref.current!.restore(target)).toBe(false);
    app.frame();
    expect(app.ref.current!.restore(target)).toBe(true);
    app.offset.mockClear();
    app.scroll(4545); // The60dp kept cell ended4541; next4581 is now the first visible native row.
    app.visible(['next']); // TalkBack/focus native scrolling does not emit a touch begin-drag.
    app.frame();
    expect(app.offset).not.toHaveBeenCalled();
  });

  it.each(['viewability', 'late row layout'] as const)(
    'ignores a pending completed-row measurement from %s after native focus movement retires its return',
    (event) => {
      const app = rendered();
      app.report(4481);
      app.report(4581, 'next');
      const target = { y: 4500, anchor: { key: 'kept', offset: 19 } };
      app.ref.current!.restore(target);
      app.frame();
      expect(app.ref.current!.restore(target)).toBe(true);
      app.hold();
      if (event === 'late row layout') app.report(4481);
      else app.visible(['kept']);
      app.frame(); // The already-completed target's physical measure is now waiting for native reply.
      app.offset.mockClear();
      app.scroll(4545);
      app.visible(['next']);
      app.release();
      app.frame();
      expect(app.offset).not.toHaveBeenCalled();
      expect(app.ref.current!.restore(target)).toBe(true);
    },
  );

  it('acknowledges a completed return without reviving it when its old cell lays out after native focus navigation', () => {
    const app = rendered();
    app.report(4481);
    app.report(4581, 'next');
    const target = { y: 4500, anchor: { key: 'kept', offset: 19 } };
    app.ref.current!.restore(target);
    app.frame();
    expect(app.ref.current!.restore(target)).toBe(true);
    app.scroll(4545);
    app.visible(['next']);
    app.offset.mockClear();
    app.report(4481); // A recycled/layout callback must not revive an already relinquished owner.
    app.frame();
    expect(app.ref.current!.restore(target)).toBe(true);
    app.frame();
    expect(app.offset).not.toHaveBeenCalled();
    const another = { y: 4561, anchor: { key: 'next', offset: -20 } };
    expect(app.ref.current!.restore(another)).toBe(false);
    app.frame();
    expect(app.offset).toHaveBeenLastCalledWith({ offset: 4561, animated: false });
    app.frame();
    expect(app.ref.current!.restore(another)).toBe(true);
  });

  it('delivers successive native seek positions despite the inherited 100 ms scroll throttle', () => {
    const app = rendered({ preceding: 43, tail: 55, nativeFeedback: true });
    app.header(75.04762268066406);
    app.viewport(701.7142944335938);
    app.content(2273.90478515625);
    app.scroll(0);
    const target = { y: 5142.09521484375, anchor: { key: 'kept', offset: 79.619140625 } };
    expect(app.ref.current!.restore(target)).toBe(false);
    app.failedIndex(111.09774218107525, 18);
    app.frame(); // First physical1572 feedback delivered at time0.
    app.advance(33);
    app.content(3192);
    app.frame(); // A native2490 move33ms after the first physical feedback needs to advance RN's render window.
    app.advance(33);
    app.content(3880.381103515625);
    app.frame(); // Native3179 follows33ms later, also 66ms after the first feedback, before throttle100 permits it.
    expect(app.feedback).toEqual([
      2273.90478515625 - 701.7142944335938,
      3192 - 701.7142944335938,
      3880.381103515625 - 701.7142944335938,
    ]);
    // Native feedback now lets the real next window mount; it is still not completion by estimate.
    expect(app.ref.current!.restore(target)).toBe(false);
    app.content(7000);
    app.advance(33);
    app.frame();
    app.moveSpacer(5062.47607421875);
    app.report(5062.47607421875);
    app.frame();
    app.frame();
    expect(app.ref.current!.restore(target)).toBe(true);
    expect(app.offset).toHaveBeenLastCalledWith({ offset: 5142.09521484375, animated: false });
  });

  it('resumes an unmounted seek after a real viewport clamp reverses', () => {
    const app = rendered({ preceding: 43, tail: 55 });
    app.scroll(0);
    app.content(3200);
    app.ref.current!.restore({ y: 4500, anchor: { key: 'kept', offset: 19 } });
    app.failedIndex(100, 18);
    app.frame();
    expect(app.offset).toHaveBeenLastCalledWith({ offset: 2500, animated: false });
    app.scroll(2500);
    app.offset.mockClear();
    app.viewport(1000);
    app.scroll(2200); // Android clamps before the queued alignment frame can issue a new command.
    app.frame();
    expect(app.offset).not.toHaveBeenCalled();
    app.viewport(700);
    app.frame();
    expect(app.offset).toHaveBeenLastCalledWith({ offset: 2500, animated: false });
  });

  it('advances an unmounted large-text return through native clamping and real content growth', () => {
    const app = rendered({ preceding: 43, tail: 55 }); // The real101-cell Activity window; anchor index44.
    app.header(75.04762268066406);
    app.viewport(701.7142944335938);
    app.content(2273.90478515625);
    app.scroll(0);
    const target = { y: 5143.619140625, anchor: { key: 'kept', offset: 81.14306640625 } };
    expect(app.ref.current!.restore(target)).toBe(false);
    expect(app.index).toHaveBeenLastCalledWith({
      index: 44,
      viewOffset: -81.14306640625,
      animated: false,
    });
    app.failedIndex(111.09774218107525, 18);
    app.frame();
    expect(app.offset).toHaveBeenLastCalledWith({
      offset: 2273.90478515625 - 701.7142944335938,
      animated: false,
    });
    const beforeNativeScroll = app.offset.mock.calls.length;
    app.failedIndex(111.09774218107525, 18); // The actual scroll event has not arrived yet.
    app.frame();
    expect(app.offset).toHaveBeenCalledTimes(beforeNativeScroll);
    app.scroll(1572.1904296875); // Android's physical clamp, rather than the requested average5032.
    app.content(3192);
    app.content(3880.381103515625);
    app.frame();
    expect(app.offset).toHaveBeenLastCalledWith({
      offset: 3880.381103515625 - 701.7142944335938,
      animated: false,
    });
    app.scroll(3880.381103515625 - 701.7142944335938);
    app.failedIndex(112.65800845984256, 32);
    app.frame();
    const calls = app.offset.mock.calls.length;
    for (let frame = 0; frame < 20; frame++) app.frame();
    expect(app.offset).toHaveBeenCalledTimes(calls); // Wait for genuine native progress, without polling.
    app.failedIndex(112.65800845984256, 32); // A duplicate failed-index callback must not issue a no-op scroll.
    app.frame();
    expect(app.offset).toHaveBeenCalledTimes(calls);
    expect(app.ref.current!.restore(target)).toBe(false);
    app.content(7000); // Scrolling to the measured edge lets the next native batch fill the window.
    app.frame();
    expect(app.offset).toHaveBeenLastCalledWith({ offset: 5031.999994913736, animated: false });
    app.scroll(5031.999994913736);
    app.moveSpacer(5062.47607421875);
    app.report(5062.47607421875);
    app.frame();
    expect(app.offset).toHaveBeenLastCalledWith({ offset: 5143.619140625, animated: false });
    app.frame();
    expect(app.ref.current!.restore(target)).toBe(true);
    const completed = app.offset.mock.calls.length;
    app.content(10000);
    for (let frame = 0; frame < 20; frame++) app.frame();
    expect(app.offset).toHaveBeenCalledTimes(completed);
  });

  it.each(['drag', 'Month unmount', 'new anchored return', 'removed anchor fallback'] as const)(
    'cancels an unmounted index seek on %s before later native content grows',
    (action) => {
      const app = rendered({ preceding: 43, tail: 55 });
      app.scroll(0);
      app.content(3200);
      app.ref.current!.restore({ y: 4500, anchor: { key: 'kept', offset: 19 } });
      app.failedIndex(100, 18);
      app.frame();
      expect(app.offset).toHaveBeenLastCalledWith({ offset: 2500, animated: false });
      app.scroll(2500); // Deliver Android's actual scroll before a member starts a replacement action.
      if (action === 'drag') app.drag();
      else if (action === 'Month unmount') app.unmount();
      else if (action === 'new anchored return') {
        app.report(4581, 'next');
        app.ref.current!.restore({ y: 4700, anchor: { key: 'next', offset: 119 } });
      } else app.ref.current!.restore({ y: 1200, anchor: { key: 'removed', offset: 19 } });
      app.offset.mockClear();
      if (action !== 'Month unmount') app.content(9000);
      app.frame();
      if (action === 'new anchored return') {
        expect(app.offset).toHaveBeenLastCalledWith({ offset: 4700, animated: false });
        app.frame();
      } else expect(app.offset).not.toHaveBeenCalled();
      const calls = app.offset.mock.calls.length;
      for (let frame = 0; frame < 20; frame++) app.frame();
      expect(app.offset).toHaveBeenCalledTimes(calls);
    },
  );

  it('publishes one coherent physical first anchor when two visible rows have stale spacer coordinates', () => {
    const app = rendered();
    app.report(4420);
    app.report(4520, 'next');
    app.moveSpacer(4540); // Physical A/B are4540/4640; their stored onLayout points were4420/4520.
    app.visible(['kept', 'next']);
    const anchor = visibleRowAnchor(app.rows.mock.lastCall![0], 4500, 700);
    expect(anchor).toEqual({ key: 'kept', offset: -40 });
    app.scroll(0); // Back remounts a native list at its beginning.
    const target = { y: 4500, anchor };
    expect(app.ref.current!.restore(target)).toBe(false);
    app.frame();
    expect(app.offset).toHaveBeenLastCalledWith({ offset: 4500, animated: false });
    app.frame();
    expect(app.ref.current!.restore(target)).toBe(true);
  });

  it('ignores a first-row sample that arrives after another drag starts', () => {
    const app = rendered();
    app.report(4420);
    app.moveSpacer(4540);
    app.hold();
    app.visible();
    app.drag();
    app.scroll(5100);
    app.release();
    expect(visibleRowAnchor(app.rows.mock.lastCall![0], 4500, 700)).toBeUndefined();
  });

  it('keeps an anchor pending until its real viewport point matches, including a later spacer shift', () => {
    const app = rendered();
    app.report();
    app.moveSpacer(4703); // The mounted row moved 222dp beneath a virtual spacer.
    const target = { y: 4500, anchor: { key: 'kept', offset: 19 } };
    expect(app.ref.current!.restore(target)).toBe(false);
    app.frame();
    expect(app.offset).toHaveBeenLastCalledWith({ offset: 4722, animated: false });
    expect(app.ref.current!.restore(target)).toBe(false);
    app.frame();
    expect(app.ref.current!.restore(target)).toBe(true);
    // A later native batch shifts the spacer again; the retained physical anchor stays fixed.
    app.moveSpacer(4781);
    app.report(4703);
    app.frame();
    expect(app.offset).toHaveBeenLastCalledWith({ offset: 4800, animated: false });
    app.frame();
    expect(app.ref.current!.restore(target)).toBe(true);
  });

  it('uses the retained row’s physical point across a five-page slide, once only', () => {
    const app = rendered();
    app.report();
    app.visible();
    app.frame();
    app.update(2);
    app.moveSpacer(3481);
    app.report(3700); // This intermediate native layout still includes an estimated spacer.
    app.frame();
    expect(app.offset).toHaveBeenLastCalledWith({ offset: 3500, animated: false });
    app.frame();
    expect(app.shift).toHaveBeenCalledExactlyOnceWith(-1000);
    app.report(3481);
    app.frame();
    expect(app.shift).toHaveBeenCalledOnce();
  });

  it('keeps the last physical viewport anchor when a page arrives during its native remeasurement', () => {
    const app = rendered({ buffered: true });
    app.report(4100, 'before'); // Buffered row's cached spacer point differs from its actual 4181.
    app.report();
    app.visible();
    app.hold();
    app.report(); // A native layout invalidates the published point; its new answer is still pending.
    app.update(2);
    app.moveSpacer(3481);
    app.frame();
    app.release();
    app.frame();
    expect(app.offset).toHaveBeenLastCalledWith({ offset: 3500, animated: false });
    app.frame();
    expect(app.shift).toHaveBeenCalledExactlyOnceWith(-1000);
  });

  it('keeps the same physical viewport through consecutive delayed page slides', () => {
    const app = rendered({ buffered: true });
    app.report(4100, 'before');
    app.report();
    app.visible();
    for (const [page, before, after, offset] of [
      [2, 4481, 3481, 3500],
      [3, 3481, 2481, 2500],
    ]) {
      app.hold();
      app.report(before);
      app.update(page);
      app.moveSpacer(after);
      app.frame();
      app.release();
      app.frame();
      expect(app.offset).toHaveBeenLastCalledWith({ offset, animated: false });
      app.frame();
    }
    expect(app.shift.mock.calls).toEqual([[-1000], [-1000]]);
  });

  it('waits without polling through zero native geometry, then resumes from a real viewport layout', () => {
    const app = rendered();
    app.report();
    expect(app.measurable()).toBe(false); // Fabric must keep a measurable host for the cell.
    app.surface(0);
    const target = { y: 4500, anchor: { key: 'kept', offset: 19 } };
    expect(app.ref.current!.restore(target)).toBe(false);
    app.frame();
    for (let frame = 0; frame < 20; frame++) app.frame();
    expect(app.offset).not.toHaveBeenCalled();
    expect(app.index).toHaveBeenCalledOnce();
    app.surface(700);
    app.viewport();
    app.frame();
    expect(app.ref.current!.restore(target)).toBe(true);
  });

  it('recovers a saved numeric return when enlarged native cells grow the estimated content height', () => {
    const app = rendered({ tail: 8 });
    app.content(3200);
    expect(app.ref.current!.restore({ y: 4500 })).toBe(true);
    expect(app.offset).toHaveBeenLastCalledWith({ offset: 2500, animated: false });
    app.content(9000);
    app.frame();
    expect(app.offset).toHaveBeenLastCalledWith({ offset: 4500, animated: false });
    const calls = app.offset.mock.calls.length;
    for (let frame = 0; frame < 20; frame++) app.frame();
    expect(app.offset).toHaveBeenCalledTimes(calls);
  });

  it('retires a numeric return once its saved position is reached, before later shrink and growth', () => {
    const app = rendered({ tail: 8 });
    app.content(3200);
    app.ref.current!.restore({ y: 4500 });
    app.content(9000);
    app.frame();
    expect(app.offset).toHaveBeenLastCalledWith({ offset: 4500, animated: false });
    app.offset.mockClear();
    app.content(4000);
    app.scroll(3300); // Android clamps the now-shorter content; that completed return must not replay.
    app.frame();
    app.content(6000);
    app.frame();
    expect(app.offset).not.toHaveBeenCalled();
  });

  it('finishes a clamped numeric fallback once its real final native cell has measured', () => {
    const app = rendered({ tail: 8 });
    app.content(3200);
    app.ref.current!.restore({ y: 4500 });
    expect(app.offset).toHaveBeenLastCalledWith({ offset: 2500, animated: false });
    app.report(3100, 'later7');
    app.frame();
    app.offset.mockClear();
    app.content(6000);
    app.frame();
    expect(app.offset).not.toHaveBeenCalled();
  });

  it.each(['drag', 'Month unmount', 'anchored return', 'window slide', 'explicit scroll'] as const)(
    'cancels the old numeric return on %s before later native content grows',
    (action) => {
      const app = rendered({ tail: 8 });
      app.content(3200);
      app.ref.current!.restore({ y: 4500 });
      let expected = 2500;
      if (action === 'drag') app.drag();
      else if (action === 'Month unmount') {
        app.content(9000);
        app.unmount();
      } else if (action === 'anchored return') {
        app.report();
        app.ref.current!.restore({ y: 4500, anchor: { key: 'kept', offset: 119 } });
        expected = 4600;
      } else if (action === 'window slide') {
        app.moveSpacer(2481);
        app.report(2481);
        app.visible();
        app.update(2);
        app.moveSpacer(1481);
        expected = 1500;
      } else {
        app.ref.current!.scrollTo({ y: 1200, animated: false });
        expected = 1200;
      }
      if (action !== 'Month unmount') app.content(9000);
      app.frame();
      expect(app.offset).toHaveBeenLastCalledWith({ offset: expected, animated: false });
      app.frame();
      const calls = app.offset.mock.calls.length;
      for (let frame = 0; frame < 20; frame++) app.frame();
      expect(app.offset).toHaveBeenCalledTimes(calls);
    },
  );

  it('finishes at the nearest reachable bottom and stops scheduling alignment', () => {
    const app = rendered();
    app.report();
    app.moveSpacer(9000);
    const target = { y: 4500, anchor: { key: 'kept', offset: 19 } };
    expect(app.ref.current!.restore(target)).toBe(false);
    app.frame();
    expect(app.offset).toHaveBeenLastCalledWith({ offset: 8300, animated: false });
    app.frame();
    expect(app.ref.current!.restore(target)).toBe(true);
    const calls = app.offset.mock.calls.length;
    for (let frame = 0; frame < 20; frame++) app.frame();
    expect(app.offset).toHaveBeenCalledTimes(calls);
  });

  it.each(['drag', 'Month unmount'] as const)(
    'ignores a delayed native measurement after %s',
    (action) => {
      const app = rendered();
      app.report();
      app.hold();
      app.ref.current!.restore({ y: 4500, anchor: { key: 'kept', offset: 19 } });
      app.frame();
      if (action === 'drag') app.drag();
      else app.unmount();
      app.moveSpacer(4703);
      app.release();
      app.frame();
      expect(app.offset).not.toHaveBeenCalled();
    },
  );

  it('cancels physical alignment on a native drag', () => {
    const app = rendered();
    app.report();
    app.ref.current!.restore({ y: 4500, anchor: { key: 'kept', offset: 19 } });
    app.drag();
    app.moveSpacer(4703);
    app.frame();
    expect(app.offset).not.toHaveBeenCalled();
  });
});
