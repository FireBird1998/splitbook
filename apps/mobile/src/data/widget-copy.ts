import { widgetGroupCopy } from './widget-group-copy';
import type { WidgetGroupPart } from '@splitbook/shared/group-widget';
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
  groupsTime: () => number | null = () => null,
) {
  const queue = createSavedCopyQueue();
  let signature = '';
  let groups: Record<string, WidgetGroupPart> = {};
  let savedGroups: WidgetCopy['savedGroups'];
  const lost = new Set<string>();
  return {
    update(snapshot: MobileSnapshot) {
      if (!native || snapshot.auth.status !== 'authenticated') return;
      const held = lease();
      if (!held) return;
      const data = snapshot.home;
      const listed = groupsTime();
      if (snapshot.groups.loaded && listed !== null)
        savedGroups = {
          verifiedAt: listed,
          rows: snapshot.groups.data.map((g) => ({
            id: g.id,
            name: g.name,
            theme: g.category,
            archived: !!g.isArchived,
            members: g.members.length,
            currencies: 1 + g.alternateCurrencies.length,
          })),
        };
      const detail = snapshot.detail,
        balances = snapshot.financial.balances;
      if (
        detail.data &&
        detail.refreshedAt !== null &&
        snapshot.financial.groupId === detail.data.id &&
        balances.data &&
        balances.refreshedAt !== null &&
        !balances.changed &&
        !lost.has(detail.data.id)
      )
        groups[detail.data.id] = widgetGroupCopy(
          detail.data,
          balances.data,
          held.accountId,
          detail.refreshedAt,
          balances.refreshedAt,
        );
      const copy: WidgetCopy = {
        version: 1,
        accountId: held.accountId,
        groups: { ...groups },
        lostGroupIds: [...lost],
        ...(savedGroups ? { savedGroups } : {}),
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
    forgetGroup(id: string, denied = false) {
      delete groups[id];
      if (denied) {
        lost.add(id);
        if (savedGroups)
          savedGroups = { ...savedGroups, rows: savedGroups.rows.filter((g) => g.id !== id) };
      }
      signature = '';
    },
    reset() {
      queue.cancel();
      signature = '';
      groups = {};
      savedGroups = undefined;
      lost.clear();
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
