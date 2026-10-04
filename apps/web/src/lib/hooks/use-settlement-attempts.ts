'use client';

import { useMemo, useSyncExternalStore } from 'react';
import {
  parseSettlementAttemptsSnapshot,
  settlementAttemptsSnapshot,
  subscribeSettlementAttempts,
  type SettlementAttempt,
} from '@/lib/settlement-attempts';

/**
 * The unconfirmed payments this account stored for the Group in this
 * browser, kept current as this tab or another one stores, confirms or
 * discards one. Empty while rendering on the server.
 */
export function useSettlementAttempts(accountId: string, groupId: string): SettlementAttempt[] {
  const snapshot = useSyncExternalStore(
    subscribeSettlementAttempts,
    () => settlementAttemptsSnapshot(accountId, groupId),
    () => '[]',
  );
  return useMemo(() => parseSettlementAttemptsSnapshot(snapshot), [snapshot]);
}
