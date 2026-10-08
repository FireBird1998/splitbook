import type { QueryClient } from '@tanstack/query-core';
import type { QueryKey } from '@splitbook/shared/query-keys';
import type { MobileSnapshot } from './types';
import type { Envelope } from './home-queries';
import type { PageEnvelope } from './group-queries';
import { RequestError } from './transport';

type Result = Envelope | { pages: PageEnvelope[] };
const envelopes = (data: Result | undefined): (Envelope | PageEnvelope)[] =>
  !data ? [] : 'pages' in data ? data.pages : [data];

/** Provenance belongs to answered query envelopes, never to a second path/time cache. */
export function readProvenance(client: QueryClient) {
  // A manually restored preview has not answered a failed network read. Structural sharing can
  // reuse it as a real fallback, so tag the actual answer object rather than infer from its age.
  const answered = new WeakSet<object>();
  const retained = new WeakSet<object>();
  const stop = client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success' || event.action.manual) return;
    for (const result of envelopes(event.query.state.data as Result | undefined))
      if (result.source === 'saved') answered.add(result);
  });
  return {
    stop,
    project(next: MobileSnapshot, keys: QueryKey[], offline: boolean) {
      const times = keys
        .flatMap((key) => envelopes(client.getQueryData<Result>(key)))
        .filter((result) => result.source === 'saved' && answered.has(result))
        .map((result) => result.refreshedAt);
      const missing = (index: number) => !keys[index] || !client.getQueryData(keys[index]);
      // Removed queries may leave their already shown content visible during a re-read. Its
      // existing snapshot provenance remains authoritative until a response replaces it.
      const retain = (
        shown: object,
        saved: boolean | undefined,
        time: number | null | undefined,
        index: number,
      ) => {
        const data = keys[index] && client.getQueryData<Result>(keys[index]);
        if (envelopes(data).some((result) => result.source === 'saved' && answered.has(result)))
          retained.add(shown);
        if (
          retained.has(shown) &&
          saved &&
          missing(index) &&
          time != null &&
          (!keys[index] || !client.getQueryState(keys[index])?.isInvalidated)
        )
          times.push(time);
      };
      if (next.screen === 'groups') retain(next.home, next.home.restored, next.home.refreshedAt, 1);
      else if (['group', 'members', 'settlement', 'expense'].includes(next.screen)) {
        retain(
          next.detail,
          next.detail.data !== null && next.detail.restored,
          next.detail.refreshedAt,
          0,
        );
        if (next.screen === 'group' && next.destination === 'activity')
          retain(next.activity, next.activity.restored, next.activity.refreshedAt, 1);
        else if (next.screen === 'group' || next.screen === 'settlement') {
          retain(
            next.financial.balances,
            next.financial.balances.restored,
            next.financial.balances.refreshedAt,
            1,
          );
          retain(
            next.financial.expenses,
            next.financial.expenses.restored,
            next.financial.expenses.refreshedAt,
            2,
          );
        }
      }
      const unavailable = keys.some((key) => {
        const error = client.getQueryState(key)?.error;
        return error instanceof RequestError && error.code === 'OFFLINE_UNAVAILABLE';
      });
      const active = offline || unavailable || times.length > 0;
      const refreshedAt = times.length ? Math.min(...times) : null;
      return next.offline.active === active && next.offline.refreshedAt === refreshedAt
        ? next
        : { ...next, offline: { ...next.offline, active, refreshedAt } };
    },
  };
}
