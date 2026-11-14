import { act, create } from 'react-test-renderer';
import { expect, it } from 'vitest';
import { useSceneVisibility } from './scene-visibility';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it('stops visibility at viewport crossings and while covered; follows resized and moved layouts', () => {
  let state!: ReturnType<typeof useSceneVisibility>;
  function Probe({
    uncovered,
    destination = 'expenses',
  }: {
    uncovered: boolean;
    destination?: string;
  }) {
    state = useSceneVisibility(uncovered, destination);
    return null;
  }
  let view!: ReturnType<typeof create>;
  act(() => {
    view = create(<Probe uncovered />);
  });
  expect(state.context.visible).toBe(false);
  act(() =>
    state.onViewport({
      nativeEvent: { layout: { height: 500, width: 400, x: 0, y: 0 } },
    } as Parameters<typeof state.onViewport>[0]),
  );
  act(() =>
    state.context.onLayout({
      nativeEvent: { layout: { y: 100, x: 0, width: 400, height: 350 } },
    } as Parameters<typeof state.context.onLayout>[0]),
  );
  expect(state.context.visible).toBe(true);
  act(() =>
    state.onScroll({
      contentOffset: { x: 0, y: 308 },
      layoutMeasurement: { height: 500, width: 400 },
    } as Parameters<typeof state.onScroll>[0]),
  );
  expect(state.context.visible).toBe(false);
  act(() =>
    state.onScroll({
      contentOffset: { x: 0, y: 307 },
      layoutMeasurement: { height: 500, width: 400 },
    } as Parameters<typeof state.onScroll>[0]),
  );
  expect(state.context.visible).toBe(true);
  act(() => view.update(<Probe uncovered={false} />));
  expect(state.context.visible).toBe(false);
  act(() => view.update(<Probe uncovered />));
  expect(state.context.visible).toBe(true);
  act(() =>
    state.onScroll({
      contentOffset: { x: 0, y: 500 },
      layoutMeasurement: { height: 500, width: 400 },
    } as Parameters<typeof state.onScroll>[0]),
  );
  expect(state.context.visible).toBe(false);
  act(() => view.update(<Probe uncovered destination="activity" />));
  expect(state.context.visible).toBe(true);
  act(() => view.unmount());
});
