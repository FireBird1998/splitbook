import { parseAmountMinor } from '@splitbook/shared/exact-money';
import type { WidgetCopy, WidgetSession } from '@splitbook/shared/balances-widget';
import { createSavedCopyQueue } from './home-queries';
import type { AccountStorageLease, MobileSnapshot } from './types';

export interface WidgetsNative {
  write(copy: WidgetCopy): Promise<void>;
  clear(): Promise<void>;
  setSession(session: WidgetSession): Promise<void>;
  redraw(): Promise<void>;
}

/** Uses the saved-copy lane and the account lease; never publishes or reads the network. */
export function createWidgetCopy(
  native: WidgetsNative | undefined,
  lease: () => AccountStorageLease | null,
  review: (snapshot: MobileSnapshot) => WidgetCopy['review'],
) {
  const queue = createSavedCopyQueue();
  let signature = '';
  return {
    update(snapshot: MobileSnapshot) {
      if (!native || snapshot.auth.status !== 'authenticated') return;
      const held = lease();
      if (!held) return;
      const data = snapshot.home;
      const copy: WidgetCopy = {
        version: 1,
        accountId: held.accountId,
        home:
          data.data !== null && data.refreshedAt !== null
            ? {
                verifiedAt: data.refreshedAt,
                groupCount: Object.keys(data.byGroup).length,
                currencies: data.data.map(({ currency, youOwe, youAreOwed }) => ({
                  currency,
                  oweMinor: parseAmountMinor(youOwe, currency),
                  owedMinor: parseAmountMinor(youAreOwed, currency),
                })),
              }
            : null,
      };
      const count = review(snapshot);
      if (count) copy.review = count;
      const state: WidgetSession = {
        status: 'authenticated',
        accountId: held.accountId,
        loading: data.status === 'loading' && !copy.home,
      };
      const next = JSON.stringify([copy, state]);
      if (next === signature) return;
      signature = next;
      queue.push('widget', async () => {
        await held.writeSavedCopy(() => native.write(copy));
        await held.writeSavedCopy(() => native.setSession(state));
        await held.writeSavedCopy(() => native.redraw());
      });
    },
    reset() {
      queue.cancel();
      signature = '';
    },
    idle: () => queue.idle(),
    async clear() {
      if (!native) return;
      await queue.idle();
      await native.clear();
    },
    async signedOut() {
      if (!native) return;
      await native.setSession({ status: 'signed-out' });
      await native.redraw();
    },
    async expired(current: () => boolean) {
      if (!native) return;
      if (!current()) return;
      await native.setSession({ status: 'expired' });
      await native.redraw();
    },
  };
}
