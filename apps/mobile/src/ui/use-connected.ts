import { createContext, useSyncExternalStore } from 'react';
import { onlineManager } from '@tanstack/query-core';

const subscribe = (notify: () => void) => onlineManager.subscribe(notify);
const isOnline = () => onlineManager.isOnline();

/**
 * Whether the phone has a connection, as NetInfo tells TanStack's online manager. The app's
 * offline state (`offline.active`) turns on only once a request fails; the Expense form and its
 * Finish later also treat a lost connection as offline, so they say the same thing (#927, #963).
 */
export function useConnected() {
  return useSyncExternalStore(subscribe, isOnline, isOnline);
}

/**
 * The connection, for an offline banner inside a screen that treats losing it as offline: the
 * Expense form provides it, so its banner agrees with its Save and Finish later (#963). Elsewhere
 * it is undefined, and the banner follows the app's offline state alone.
 */
export const OfflineConnection = createContext<boolean | undefined>(undefined);
