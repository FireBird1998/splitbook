import { createContext, useContext, useMemo } from 'react';
import type { MobileController } from '../data/mobile-controller';
import { notificationTaskProtected } from '../data/notification-alerts';
import type { MobileSnapshot } from '../data/types';
import { HeldUpdateFooter } from './held-update-snackbar';
import { useMobileSnapshot } from './use-mobile-snapshot';

type Surface = 'screen' | 'payment' | 'tags' | 'currencies' | 'leave';
export const HeldUpdateSurfaceContext = createContext<{
  controller: MobileController;
  surface: Surface | null;
} | null>(null);

/** Native sheets need their own slot; the three existing task footers keep their geometry. */
function surface(snapshot: MobileSnapshot): Surface | null {
  if (!snapshot.heldNotification || !notificationTaskProtected(snapshot)) return null;
  if (snapshot.screen === 'expense' || snapshot.toReview.groupId !== null || snapshot.toReview.run)
    return null;
  if (
    snapshot.tagsOpenFor ||
    snapshot.tagManager.edit ||
    snapshot.tagManager.recovery ||
    snapshot.tagManager.busy
  )
    return 'tags';
  if (snapshot.currenciesOpenFor) return 'currencies';
  if (snapshot.leave.status !== 'closed') return 'leave';
  if (snapshot.screen === 'settlement') return 'payment';
  return 'screen';
}

export function useHeldUpdateSurfaces(controller: MobileController) {
  const selected = useMobileSnapshot(controller, surface);
  return useMemo(() => ({ controller, surface: selected }), [controller, selected]);
}

/** New surfaces reserve space above their controls instead of covering a field or a button. */
export function useHeldUpdateNotice(name: Surface) {
  const context = useContext(HeldUpdateSurfaceContext);
  if (context?.surface !== name) return null;
  return <HeldUpdateFooter controller={context.controller} inline />;
}
