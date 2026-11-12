import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from 'react';
import type { MobileController } from '../data/mobile-controller';
import { notificationTaskProtected } from '../data/notification-alerts';
import type { MobileSnapshot } from '../data/types';
import { HeldUpdateFooter, useHeldUpdateTimeline } from './held-update-snackbar';
import { sameSelection, useMobileSnapshot } from './use-mobile-snapshot';

type Surface = 'screen' | 'tags' | 'currencies';
export const HeldUpdateSurfaceContext = createContext<ReturnType<
  typeof useHeldUpdateSurfaces
> | null>(null);
export const HeldUpdateDepthContext = createContext(0);

/** Native sheets need their own slot; the three existing task footers keep their geometry. */
function surface(snapshot: MobileSnapshot): Surface | null {
  if (!snapshot.heldNotification || !notificationTaskProtected(snapshot)) return null;
  if (snapshot.screen === 'expense' || snapshot.toReview.groupId !== null || snapshot.toReview.run)
    return null;
  // Retained edit/recovery/busy flags protect the task even after its native screen closed.
  if (snapshot.tagsOpenFor) return 'tags';
  if (snapshot.currenciesOpenFor) return 'currencies';
  return 'screen';
}

export function useHeldUpdateSurfaces(controller: MobileController) {
  const selected = useMobileSnapshot(
    controller,
    (s) => ({
      surface: surface(s),
      active: !!s.heldNotification && notificationTaskProtected(s),
    }),
    sameSelection,
  );
  const timeline = useHeldUpdateTimeline(controller);
  const [sheets, setSheets] = useState<{ id: string; depth: number }[]>([]);
  const register = useCallback((id: string, depth: number) => {
    setSheets((previous) => [...previous, { id, depth }]);
    return () => setSheets((previous) => previous.filter((sheet) => sheet.id !== id));
  }, []);
  // A nested native Modal sits above its parent, regardless of effect registration order.
  const top = sheets.reduce<{ id: string; depth: number } | null>(
    (a, b) => (!a || b.depth >= a.depth ? b : a),
    null,
  );
  const notice = useMemo(
    () => ({
      owner: timeline.owner,
      shown: timeline.shown,
      widget: timeline.widget,
      sheetId: top?.id ?? null,
    }),
    [timeline.owner, timeline.shown, timeline.widget, top?.id],
  );
  return useMemo(
    () => ({ controller, ...selected, register, notice }),
    [controller, selected, register, notice],
  );
}

/** New surfaces reserve space above their controls instead of covering a field or a button. */
export function useHeldUpdateNotice(name: Surface) {
  const context = useContext(HeldUpdateSurfaceContext);
  if (context?.surface !== name) return null;
  return <HeldUpdateFooter controller={context.controller} inline />;
}

/** Every visible BottomSheet can host the same live notice, including nested task sheets. */
export function useHeldUpdateSheetNotice(visible: boolean, depth: number) {
  const context = useContext(HeldUpdateSurfaceContext);
  const id = useId();
  const register = context?.register;
  const active = context?.active;
  useEffect(() => {
    if (visible && active && register) return register(id, depth);
  }, [visible, active, register, id, depth]);
  return visible && active && context ? (
    <HeldUpdateFooter controller={context.controller} inline sheetId={id} />
  ) : null;
}
