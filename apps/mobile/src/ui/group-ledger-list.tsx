import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
  type ComponentProps,
  type Ref,
} from 'react';
import {
  Animated,
  FlatList,
  View,
  type LayoutChangeEvent,
  type ScrollViewProps,
  type FlatListProps,
} from 'react-native';
import type { ScrollAnchor } from '../data/types';
import type { LedgerItem } from './ledger-items';
import { floatingRoom } from './group-shell';
import { radius } from './compact/scale';
import type { Reveal } from './compact/motion';
import { virtualReturnTarget, visibleRowAnchor, type RowPlaces } from './return-scroll';
import { useTheme } from './theme';

export interface LedgerScrollHandle {
  scrollTo: (position: { y: number; animated: boolean }) => void;
  /** False until the anchored cell has actually been measured; a guessed offset never finishes a return. */
  restore: (position: { y: number; anchor?: ScrollAnchor }) => boolean;
  cancel: () => void;
}

export interface LedgerScrollProps {
  nativeRef?: Ref<LedgerScrollHandle>;
  scroll?: Pick<
    ScrollViewProps,
    | 'scrollEventThrottle'
    | 'onScroll'
    | 'onScrollBeginDrag'
    | 'onScrollEndDrag'
    | 'onMomentumScrollEnd'
    | 'onLayout'
    | 'onContentSizeChange'
    | 'refreshControl'
  >;
  floating?: boolean;
}

const initialCells = 8;

const CellMeasurements = createContext<
  (key: string, layout: { top: number; height: number } | null, cell?: View | null) => void
>(() => undefined);
/** Forward FlatList's own measurement and focus handlers before reporting content coordinates. */
function MeasuredCell({
  cellKey,
  onLayout,
  children,
  style,
  onFocusCapture,
}: ComponentProps<NonNullable<FlatListProps<unknown>['CellRendererComponent']>>) {
  const report = useContext(CellMeasurements);
  const cell = useRef<View>(null);
  useEffect(() => () => report(cellKey, null), [cellKey, report]);
  return (
    <View
      ref={cell}
      collapsable={false}
      {...{ style, onFocusCapture }}
      onLayout={(event) => {
        onLayout?.(event);
        report(
          cellKey,
          { top: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height },
          cell.current,
        );
      }}
    >
      {children}
    </View>
  );
}

/** One virtualized scroll container; controller pages and row content remain outside it. */
export function GroupLedgerList<Row>({
  items,
  renderRow,
  reveal = null,
  header,
  footer,
  empty,
  firstPage = 1,
  onRowsLayout,
  onShift,
  nativeRef,
  scroll,
  floating = false,
}: LedgerScrollProps & {
  items: LedgerItem<Row>[];
  renderRow: (item: LedgerItem<Row>) => ReactNode;
  /** One logical arrival, shared by late-mounted cells without replaying on scroll or paging. */
  reveal?: Reveal | null;
  header: ReactNode;
  footer?: ReactNode;
  empty?: ReactNode;
  firstPage?: number;
  onRowsLayout?: (rows: RowPlaces) => void;
  onShift?: (dy: number) => void;
}) {
  const theme = useTheme();
  const list = useRef<FlatList<LedgerItem<Row>>>(null);
  const places = useRef(new Map<string, { top: number; height: number }>());
  const cells = useRef(new Map<string, View>());
  const revision = useRef(0);
  const position = useRef({ y: 0, content: 0, viewport: 0, header: 0 });
  const visibleKeys = useRef(new Set<string>());
  const sample = useRef(0);
  const verified = useRef(new Map<string, { top: number; height: number }>());
  const verifiedFirst = useRef<string | null>(null);
  // Keep the last physically sampled viewport point across the gap between a layout invalidation
  // and its asynchronous native answer. A page can arrive in that gap; raw buffered cell/spacer
  // points must not replace the member's previous viewport anchor.
  const viewportPoint = useRef<{ key: string; top: number; height: number } | null>(null);
  const held = useRef<{ key: string; top: number; offset: number } | null>(null);
  const pendingIndex = useRef(false);
  // A failed index provides navigation intent, never a physical position or a completed return.
  const indexOffset = useRef<{ offset: number; applied: number | null } | null>(null);
  const returningOffset = useRef<number | null>(null);
  const returning = useRef<{
    key: string;
    offset: number;
    // Correcting retains prior completion, so native focus movement can retire a late layout repair.
    phase: 'pending' | 'correcting' | 'aligned' | 'retired';
    attempted: number;
  } | null>(null);
  const frame = useRef<number | null>(null);
  const align = useRef<() => void>(() => undefined);
  const queueAlignment = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      align.current();
    });
  }, []);
  const cancelAlignment = useCallback(() => {
    sample.current += 1;
    returning.current = null;
    held.current = null;
    pendingIndex.current = false;
    indexOffset.current = null;
    returningOffset.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);
  useEffect(() => cancelAlignment, [cancelAlignment]);
  const previous = useRef({ firstPage, items });
  const latest = useRef({ items, onRowsLayout, onShift });
  latest.current = { items, onRowsLayout, onShift };
  const estimatedExtent = useCallback(() => {
    const data = latest.current.items;
    const last = data.at(-1);
    // A short initial render has no virtual tail. For a longer list, a measured final cell
    // distinguishes a real nearest-bottom fallback from an extent that is still being filled.
    return data.length > initialCells && !!last && !cells.current.has(last.key);
  }, []);
  const notify = useCallback(() => {
    const rows = new Map<string, { top: number; height: number }>();
    for (const item of latest.current.items) {
      // Raw cell/spacer coordinates must never compete with a verified physical first row.
      const layout =
        visibleKeys.current.size === 0
          ? places.current.get(item.key)
          : verified.current.get(item.key);
      if (
        item.kind === 'row' &&
        layout &&
        (visibleKeys.current.size === 0 ||
          verifiedFirst.current === item.key ||
          held.current?.key === item.key ||
          returning.current?.key === item.key)
      )
        rows.set(item.key, layout);
    }
    latest.current.onRowsLayout?.(rows);
  }, []);
  /** Native viewport coordinates bypass FlatList's estimated spacer and cached index offsets. */
  const readPoint = useCallback((key: string, answer: (top: number, height: number) => void) => {
    const cell = cells.current.get(key);
    const surface = list.current?.getNativeScrollRef?.();
    if (
      !cell ||
      !surface ||
      !('measureInWindow' in surface) ||
      typeof surface.measureInWindow !== 'function'
    )
      return;
    surface.measureInWindow((_x: number, surfaceY: number, width: number, height: number) => {
      if (width <= 0 || height <= 0 || cells.current.get(key) !== cell) return;
      cell.measureInWindow((_x, cellY, width, height) => {
        if (width > 0 && height > 0 && list.current && cells.current.get(key) === cell)
          answer(cellY - surfaceY, height);
      });
    });
  }, []);
  align.current = () => {
    if (returningOffset.current !== null) {
      const next = Math.max(
        0,
        Math.min(
          returningOffset.current,
          Math.max(0, position.current.content - position.current.viewport),
        ),
      );
      if (Math.abs(next - position.current.y) > 0.5) {
        position.current.y = next;
        list.current?.scrollToOffset({ offset: next, animated: false });
      }
      if (next === returningOffset.current || !estimatedExtent()) returningOffset.current = null;
      return; // Real size changes retry a numeric return; never poll estimated content geometry.
    }
    const shift = held.current;
    const target = shift ?? returning.current;
    if (!target || (!shift && returning.current?.phase === 'retired')) return;
    if (!cells.current.has(target.key)) {
      const intent = indexOffset.current;
      if (intent) {
        const next = Math.max(
          0,
          Math.min(
            intent.offset,
            Math.max(0, position.current.content - position.current.viewport),
          ),
        );
        if (
          Math.abs(next - position.current.y) > 0.5 &&
          (intent.applied === null || Math.abs(next - intent.applied) > 0.5)
        ) {
          intent.applied = next;
          list.current?.scrollToOffset({ offset: next, animated: false });
        }
      }
      return; // Native content/layout progress retries; never poll for an unmounted target.
    }
    indexOffset.current = null;
    const basis = {
      y: position.current.y,
      viewport: position.current.viewport,
      header: position.current.header,
      revision: revision.current,
      sample: sample.current,
    };
    readPoint(target.key, (top, height) => {
      // A drag, Month switch, new request or unmount makes an asynchronous answer obsolete.
      if (
        (target !== held.current && target !== returning.current) ||
        (target === returning.current && returning.current.phase === 'retired')
      )
        return;
      // Native surface/cell replies can overlap another measurement or physical scroll. Their
      // relative point belongs to that request's geometry, never to a later scroll position.
      if (
        basis.y !== position.current.y ||
        basis.viewport !== position.current.viewport ||
        basis.header !== position.current.header ||
        basis.revision !== revision.current ||
        basis.sample !== sample.current
      ) {
        queueAlignment(); // A stale native answer triggers one fresh read of the still-active owner.
        return;
      }
      const actualTop = position.current.y + top;
      places.current.set(target.key, { top: actualTop, height });
      verified.current.set(target.key, { top: actualTop, height });
      if (viewportPoint.current?.key === target.key)
        viewportPoint.current = { key: target.key, top: actualTop, height };
      const next = Math.max(
        0,
        Math.min(
          position.current.y + top + target.offset,
          Math.max(0, position.current.content - position.current.viewport),
        ),
      );
      if (Math.abs(next - position.current.y) > 0.5) {
        if (returning.current?.phase === 'aligned') returning.current.phase = 'correcting';
        position.current.y = next;
        list.current?.scrollToOffset({ offset: next, animated: false });
        queueAlignment(); // One confirming native frame; no polling once the physical point matches.
      } else {
        pendingIndex.current = false;
        if (shift && target === held.current) {
          held.current = null;
          returning.current = {
            key: target.key,
            offset: target.offset,
            phase: 'aligned',
            attempted: revision.current,
          };
          latest.current.onShift?.(actualTop - shift.top);
        } else if (returning.current) returning.current.phase = 'aligned';
      }
      notify();
    });
  };
  const sampleVisible = useCallback(() => {
    const key = latest.current.items.find(
      (item) => item.kind === 'row' && visibleKeys.current.has(item.key),
    )?.key;
    if (!key) return;
    const request = ++sample.current;
    readPoint(key, (top, height) => {
      if (sample.current !== request || !visibleKeys.current.has(key)) return;
      const point = { top: position.current.y + top, height };
      places.current.set(key, point);
      verified.current.set(key, point);
      verifiedFirst.current = key;
      viewportPoint.current = { key, ...point };
      notify();
    });
  }, [notify, readPoint]);
  const report = useCallback(
    (key: string, layout: { top: number; height: number } | null, cell?: View | null) => {
      revision.current += 1;
      verified.current.delete(key);
      if (verifiedFirst.current === key) verifiedFirst.current = null;
      if (returning.current?.key === key && returning.current.phase === 'aligned')
        returning.current.phase = 'correcting';
      if (layout) {
        places.current.set(key, layout);
        if (cell && layout.height > 0) cells.current.set(key, cell);
        else cells.current.delete(key);
      } else {
        places.current.delete(key);
        cells.current.delete(key);
      }
      notify();
      const first = latest.current.items.find(
        (item) => item.kind === 'row' && visibleKeys.current.has(item.key),
      );
      if (first?.key === key && layout) sampleVisible();
      if (
        held.current ||
        returning.current ||
        (returningOffset.current !== null && key === latest.current.items.at(-1)?.key)
      )
        queueAlignment();
    },
    [notify, queueAlignment, sampleVisible],
  );
  const restore = useCallback(
    (target: { y: number; anchor?: ScrollAnchor }) => {
      const result = virtualReturnTarget(target, latest.current.items, position.current);
      if (result.kind === 'offset') {
        cancelAlignment();
        returningOffset.current =
          !target.anchor && result.offset < target.y && estimatedExtent() ? target.y : null;
        position.current.y = result.offset;
        list.current?.scrollToOffset({ offset: result.offset, animated: false });
        return true;
      }
      returningOffset.current = null;
      const anchor = target.anchor!;
      if (
        !returning.current ||
        returning.current.key !== anchor.key ||
        returning.current.offset !== anchor.offset
      ) {
        indexOffset.current = null;
        returning.current = { ...anchor, phase: 'pending', attempted: -1 };
      }
      const pending = returning.current;
      if (pending.phase === 'aligned' || pending.phase === 'retired') return true;
      // Index/average geometry is navigation only. A mounted cell alone never finishes a return.
      if (
        pending.attempted === -1 ||
        (pending.attempted !== revision.current && !cells.current.has(anchor.key))
      ) {
        pendingIndex.current = true;
        pending.attempted = revision.current;
        list.current?.scrollToIndex({
          index: result.index,
          viewOffset: result.viewOffset,
          animated: false,
        });
      }
      queueAlignment();
      return false;
    },
    [cancelAlignment, queueAlignment, estimatedExtent],
  );
  useImperativeHandle(
    nativeRef,
    () => ({
      scrollTo: ({ y, animated }) => {
        returningOffset.current = null;
        indexOffset.current = null;
        position.current.y = y;
        list.current?.scrollToOffset({ offset: y, animated });
      },
      restore,
      cancel: cancelAlignment,
    }),
    [restore, cancelAlignment],
  );
  // A five-page window moved. Keep the visible row if it survives; otherwise the first retained
  // measured row. Native measurements (including the header) decide the final shift, never a row-height guess.
  useLayoutEffect(() => {
    if (previous.current.firstPage !== firstPage) {
      sample.current += 1; // A reply measured against the previous page window is obsolete.
      returningOffset.current = null;
      indexOffset.current = null;
      const kept = new Set(items.filter((item) => item.kind === 'row').map(({ key }) => key));
      const oldRows = new Map(
        previous.current.items
          .filter((item) => item.kind === 'row')
          .flatMap(({ key }) => {
            const at = places.current.get(key);
            return at ? [[key, at] as const] : [];
          }),
      );
      const first = verifiedFirst.current && verified.current.get(verifiedFirst.current);
      const point =
        first && verifiedFirst.current
          ? { key: verifiedFirst.current, ...first }
          : viewportPoint.current;
      const visible = visibleKeys.current.size
        ? point && visibleKeys.current.has(point.key)
          ? { key: point.key, offset: position.current.y - point.top }
          : undefined
        : visibleRowAnchor(oldRows, position.current.y, position.current.viewport);
      const key =
        visible && kept.has(visible.key)
          ? visible.key
          : [...oldRows.keys()].find((id) => kept.has(id));
      const at =
        key && (point?.key === key ? point : (verified.current.get(key) ?? oldRows.get(key)));
      if (key && at) {
        returning.current = null;
        held.current = { key, top: at.top, offset: position.current.y - at.top };
        const index = items.findIndex((item) => item.key === key);
        pendingIndex.current = true;
        list.current?.scrollToIndex({ index, viewOffset: -held.current.offset, animated: false });
        queueAlignment();
      }
    }
    previous.current = { firstPage, items };
  }, [firstPage, items, queueAlignment]);
  const viewability = useRef({ itemVisiblePercentThreshold: 1 });
  const viewable = useCallback(
    ({
      viewableItems,
    }: {
      viewableItems: Array<{ item: LedgerItem<Row>; isViewable: boolean }>;
    }) => {
      verifiedFirst.current = null;
      visibleKeys.current = new Set(
        viewableItems
          .filter(({ item, isViewable }) => isViewable && item.kind === 'row')
          .map(({ item }) => item.key),
      );
      sampleVisible();
      notify();
      if (held.current || returning.current) queueAlignment();
    },
    [notify, sampleVisible, queueAlignment],
  );
  const render = useCallback(
    ({ item }: { item: LedgerItem<Row> }) => (
      <View
        style={{
          backgroundColor: theme.surface,
          borderColor: theme.border,
          borderLeftWidth: 1,
          borderRightWidth: 1,
          borderTopWidth: item.first ? 1 : 0,
          borderBottomWidth: item.last ? 1 : 0,
          borderTopLeftRadius: item.first ? radius.card : 0,
          borderTopRightRadius: item.first ? radius.card : 0,
          borderBottomLeftRadius: item.last ? radius.card : 0,
          borderBottomRightRadius: item.last ? radius.card : 0,
          overflow: 'hidden',
        }}
      >
        {reveal ? (
          <Animated.View style={{ opacity: reveal }}>{renderRow(item)}</Animated.View>
        ) : (
          renderRow(item)
        )}
      </View>
    ),
    [renderRow, reveal, theme.surface, theme.border],
  );
  const headerElement = useMemo(
    () => (
      <View
        style={{ gap: 12, paddingBottom: 12 }}
        onLayout={({ nativeEvent }: LayoutChangeEvent) => {
          position.current.header = nativeEvent.layout.height;
          if (held.current || returning.current) queueAlignment();
        }}
      >
        {header}
      </View>
    ),
    [header, queueAlignment],
  );
  return (
    <CellMeasurements.Provider value={report}>
      <FlatList
        ref={list}
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={render}
        CellRendererComponent={MeasuredCell}
        ListHeaderComponent={headerElement}
        ListFooterComponent={
          footer ? <View style={{ paddingTop: 12, gap: 12 }}>{footer}</View> : null
        }
        ListEmptyComponent={empty ? <>{empty}</> : null}
        // Five viewports, not the default 21: mount a useful fling buffer without retaining 100 rows.
        windowSize={5}
        initialNumToRender={initialCells}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={32}
        // Clipping breaks focused TalkBack/large-text rows on some Android builds; windowing alone bounds mounting.
        removeClippedSubviews={false}
        viewabilityConfig={viewability.current}
        onViewableItemsChanged={viewable}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 4,
          paddingBottom: floating ? floatingRoom : 24,
        }}
        {...scroll}
        // VirtualizedList needs every native position to advance its window during nonanimated
        // restoration. Android throttles >=17ms can discard the only feedback for a seek.
        scrollEventThrottle={16}
        onScroll={(event) => {
          sample.current += 1;
          const y = event.nativeEvent.contentOffset.y;
          // Focus/TalkBack navigation has no touch begin-drag. A completed return acknowledges
          // future restore calls, but must relinquish correction when native navigation moves on.
          if (
            (returning.current?.phase === 'aligned' || returning.current?.phase === 'correcting') &&
            Math.abs(y - position.current.y) > 0.5
          )
            returning.current.phase = 'retired';
          position.current.y = y;
          // Before feedback, suppress duplicate commands; afterward the physical result (including
          // a native viewport clamp) becomes the baseline for subsequent genuine geometry changes.
          if (indexOffset.current) indexOffset.current.applied = position.current.y;
          scroll?.onScroll?.(event);
        }}
        onScrollEndDrag={(event) => {
          position.current.y = event.nativeEvent.contentOffset.y;
          scroll?.onScrollEndDrag?.(event);
          sampleVisible();
        }}
        onMomentumScrollEnd={(event) => {
          position.current.y = event.nativeEvent.contentOffset.y;
          scroll?.onMomentumScrollEnd?.(event);
          sampleVisible();
        }}
        onScrollBeginDrag={(event) => {
          cancelAlignment();
          scroll?.onScrollBeginDrag?.(event);
        }}
        onLayout={(event) => {
          position.current.viewport = event.nativeEvent.layout.height;
          scroll?.onLayout?.(event);
          if (held.current || returning.current || returningOffset.current !== null)
            queueAlignment();
        }}
        onContentSizeChange={(width, height) => {
          position.current.content = height;
          scroll?.onContentSizeChange?.(width, height);
          if (held.current || returning.current || returningOffset.current !== null)
            queueAlignment();
        }}
        onScrollToIndexFailed={({ averageItemLength, index }) => {
          if (!pendingIndex.current) return;
          const offset = Math.max(0, position.current.header + averageItemLength * index);
          indexOffset.current = { offset, applied: indexOffset.current?.applied ?? null };
          queueAlignment();
          // Native extent changes advance this bounded seek. Only an actual viewport point finishes it.
        }}
      />
    </CellMeasurements.Provider>
  );
}
