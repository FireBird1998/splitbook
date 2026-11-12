import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert, AppState, Share, type LayoutChangeEvent } from 'react-native';
import type { MobileController } from '../data/mobile-controller';
import { notificationTaskProtected } from '../data/notification-alerts';
import { HeldUpdateFooter, useHeldUpdateTimeline } from './held-update-snackbar';
import { useMobileSnapshot } from './use-mobile-snapshot';

export const HeldUpdateSurfaceContext = createContext<ReturnType<
  typeof useHeldUpdateSurfaces
> | null>(null);
export const HeldUpdateDepthContext = createContext(0);

/** The protection rule decides when; actual mounted hosts decide where. */
export function useHeldUpdateSurfaces(controller: MobileController) {
  const active = useMobileSnapshot(
    controller,
    (snapshot) => !!snapshot.heldNotification && notificationTaskProtected(snapshot),
  );
  const foreground = useRef(
    AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
  );
  const [, refreshVisibility] = useState(0);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      foreground.current = next === 'active';
      const snapshot = controller.getSnapshot();
      // Ordinary foreground events stay render-free; only a protected hold has feedback to move.
      if (snapshot.heldNotification && notificationTaskProtected(snapshot))
        refreshVisibility((n) => n + 1);
    });
    return () => subscription.remove();
  }, [controller]);
  const [covered, setCovered] = useState(0);
  const cover = useCallback(() => {
    setCovered((n) => n + 1);
    let open = true;
    return () => {
      if (!open) return;
      open = false;
      setCovered((n) => n - 1);
    };
  }, []);
  const bottomSpaces = useRef(new Map<string, number>());
  const reserveBottom = useCallback(
    (id: string, space: number | null) => {
      if (space === null ? !bottomSpaces.current.has(id) : bottomSpaces.current.get(id) === space)
        return;
      if (space === null) bottomSpaces.current.delete(id);
      else bottomSpaces.current.set(id, space);
      const snapshot = controller.getSnapshot();
      if (snapshot.heldNotification && notificationTaskProtected(snapshot))
        refreshVisibility((n) => n + 1);
    },
    [controller],
  );
  const bottomClearance = Math.max(0, ...bottomSpaces.current.values());
  const timeline = useHeldUpdateTimeline(controller, foreground.current && covered === 0);
  const [hosts, setHosts] = useState<{ id: string; depth: number }[]>([]);
  const register = useCallback((id: string, depth: number) => {
    setHosts((previous) => [...previous, { id, depth }]);
    return () => setHosts((previous) => previous.filter((host) => host.id !== id));
  }, []);
  // A nested native Modal sits above its parent, regardless of effect registration order.
  const top = hosts.reduce<{ id: string; depth: number } | null>(
    (a, b) => (!a || b.depth >= a.depth ? b : a),
    null,
  );
  const notice = useMemo(
    () => ({
      owner: timeline.owner,
      shown: timeline.shown,
      widget: timeline.widget,
      register,
      active: active,
      hostId: top?.id ?? null,
    }),
    [timeline.owner, timeline.shown, timeline.widget, top?.id, register, active],
  );
  return useMemo(
    () => ({ controller, active, register, notice, cover, reserveBottom, bottomClearance }),
    [controller, active, register, notice, cover, reserveBottom, bottomClearance],
  );
}

/** A full native screen sits above a task footer and below its nested sheets. */
export function useHeldUpdateModalNotice(visible = true) {
  const context = useContext(HeldUpdateSurfaceContext);
  const id = useId();
  const register = context?.register;
  const active = context?.active;
  useEffect(() => {
    if (visible && active && register) return register(id, 0);
  }, [visible, active, register, id]);
  return visible && active && context ? (
    <HeldUpdateFooter controller={context.controller} inline hostId={id} />
  ) : null;
}

/** Every visible BottomSheet can host the same live notice, including nested task sheets. */
export function useHeldUpdateSheetNotice(visible: boolean, depth: number) {
  const context = useContext(HeldUpdateSurfaceContext);
  const id = useId();
  const register = context?.register;
  const active = context?.active;
  useEffect(() => {
    if (visible && active && register) return register(id, depth + 1);
  }, [visible, active, register, id, depth]);
  return visible && active && context ? (
    <HeldUpdateFooter controller={context.controller} inline hostId={id} />
  ) : null;
}

/** Native windows cannot host React feedback: keep its acknowledgement pending until dismissal. */
export function useHeldUpdateNativeOverlays() {
  const cover = useContext(HeldUpdateSurfaceContext)?.cover;
  const pending = useRef(new Set<() => void>());
  useEffect(() => {
    const requests = pending.current;
    return () => {
      for (const finish of requests) finish();
    };
  }, []);
  return useMemo(
    () => ({
      alert(title: string, message: string) {
        const finish = cover?.();
        Alert.alert(title, message, [{ text: 'OK', onPress: finish }], { onDismiss: finish });
      },
      share(content: Parameters<typeof Share.share>[0]) {
        const release = cover?.();
        let away = false;
        const subscription = AppState.addEventListener('change', (next) => {
          if (next !== 'active') away = true;
          else if (away) finish();
        });
        const finish = () => {
          subscription.remove();
          pending.current.delete(finish);
          release?.();
        };
        pending.current.add(finish);
        // Android resolves on launch, before the chooser closes. Its return to the foreground
        // releases the cover; a failed launch has no window to wait for.
        return Share.share(content).catch((error: unknown) => {
          finish();
          throw error;
        });
      },
    }),
    [cover],
  );
}

/** Fixed controls keep their place; the floating fallback clears their actual measured height. */
export function useHeldUpdateBottomSpace(bottom: number | null = 0) {
  const reserve = useContext(HeldUpdateSurfaceContext)?.reserveBottom;
  const id = useId();
  const height = useRef(0);
  useEffect(() => {
    if (bottom !== null) reserve?.(id, bottom + height.current);
    return () => reserve?.(id, null);
  }, [reserve, id, bottom]);
  return useCallback(
    (event: LayoutChangeEvent) => {
      height.current = event.nativeEvent.layout.height;
      if (bottom !== null) reserve?.(id, bottom + height.current);
    },
    [reserve, id, bottom],
  );
}
