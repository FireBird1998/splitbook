import { createContext, useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent } from 'react-native';

export const SceneVisibility = createContext<{
  visible: boolean;
  onLayout: (event: LayoutChangeEvent) => void;
}>({
  visible: false,
  onLayout: () => undefined,
});
/** Scroll geometry stays outside controller snapshots; only visibility crossings render. */
export function useSceneVisibility(uncovered: boolean, destination = 'expenses') {
  const bounds = useRef({ top: 0, bottom: 0 });
  const viewport = useRef({ top: 0, height: 0 });
  const [intersects, setIntersects] = useState(false);
  const check = useCallback(() => {
    setIntersects(
      bounds.current.bottom > viewport.current.top &&
        bounds.current.top < viewport.current.top + viewport.current.height,
    );
  }, []);
  useLayoutEffect(() => {
    viewport.current.top = 0;
    check();
  }, [destination, check]);
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      bounds.current = {
        top: event.nativeEvent.layout.y,
        bottom: event.nativeEvent.layout.y + 208,
      };
      check();
    },
    [check],
  );
  const onScroll = (event: NativeScrollEvent) => {
    viewport.current = {
      top: event.contentOffset.y,
      height: event.layoutMeasurement?.height ?? viewport.current.height,
    };
    check();
  };
  return {
    context: { visible: uncovered && intersects, onLayout },
    onScroll,
    onViewport: (event: LayoutChangeEvent) => {
      viewport.current.height = event.nativeEvent.layout.height;
      check();
    },
  };
}
