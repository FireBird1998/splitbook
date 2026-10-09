import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector';
import type { MobileController } from '../data/mobile-controller';
import type { MobileSnapshot } from '../data/types';

/** Reads the controller's only client-state store; commands remain its only writers. */
export function useMobileSnapshot<Selection>(
  controller: MobileController,
  select: (snapshot: MobileSnapshot) => Selection,
  equal?: (before: Selection, after: Selection) => boolean,
): Selection {
  return useSyncExternalStoreWithSelector(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
    select,
    equal,
  );
}

/** Shallow equality for small projections whose values retain their controller identities. */
export function sameSelection<Selection extends object>(before: Selection, after: Selection) {
  const keys = Object.keys(before) as (keyof Selection)[];
  return (
    keys.length === Object.keys(after).length &&
    keys.every((key) => Object.is(before[key], after[key]))
  );
}
