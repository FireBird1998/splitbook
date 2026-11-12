import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from 'react';
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
  const timeline = useHeldUpdateTimeline(controller);
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
    () => ({ controller, active, register, notice }),
    [controller, active, register, notice],
  );
}

/** A full native screen sits above a task footer and below its nested sheets. */
export function useHeldUpdateModalNotice() {
  const context = useContext(HeldUpdateSurfaceContext);
  const id = useId();
  const register = context?.register;
  const active = context?.active;
  useEffect(() => {
    if (active && register) return register(id, 0);
  }, [active, register, id]);
  return active && context ? (
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
