import { parseGroupListResponse, type GroupReadTag } from '@splitbook/shared/group-read';
import { parseExpenseContext } from './expense-draft';
import { cachedRead } from './offline-cache';
import { parseGroup, parseGroups } from './dto';
import { widgetMonthCopy } from './widget-month-copy';
import { expensePagePath } from '@splitbook/shared/api-paths';
import { monthKeyInZone } from '@splitbook/shared/zoned-calendar';
import { expenseMonthRange } from '@splitbook/shared/expense-day';
import { parseGroupBalances } from './financial-dto';
import type { SavedQueryRecords } from './saved-copy-budget';
import { widgetGroupCopy } from './widget-group-copy';
import type { WidgetGroupPart } from '@splitbook/shared/group-widget';
import { parseAmountMinor } from '@splitbook/shared/exact-money';
import type { WidgetCopy, WidgetSession } from '@splitbook/shared/balances-widget';
import { createSavedCopyQueue, parseOnce, type Envelope } from './saved-read-engine';
import type { AccountStorageLease, MobileSnapshot } from './types';

export interface WidgetsNative {
  openSetup?(widgetId: number): Promise<void>;
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
  groupsRead: () => Envelope | null = () => null,
  rows?: SavedQueryRecords,
  now: () => number = Date.now,
  groupReads: (id: string) => { group: Envelope; balances?: Envelope } | null = () => null,
  trusted: (path: string, verifiedAt: number) => boolean = () => true,
  monthRead: (id: string) => { month: string; read: Envelope } | null = () => null,
) {
  const queue = createSavedCopyQueue();
  let signature = '';
  let groups: Record<string, WidgetGroupPart> = {};
  let months: NonNullable<WidgetCopy['months']> = {};
  let tags: NonNullable<WidgetCopy['tags']> = {};
  const listOf = parseOnce((value) => parseGroupListResponse(value));
  const contextOf = parseOnce((value) => parseExpenseContext(value));
  const rememberTags = (
    id: string,
    rows: { id: string; name: string; isArchived: boolean; isDeleted: boolean }[],
    verifiedAt: number,
  ) => {
    if ((tags[id]?.verifiedAt ?? -Infinity) > verifiedAt) return;
    tags[id] = {
      verifiedAt,
      rows: rows
        .filter((tag) => !tag.isArchived && !tag.isDeleted)
        .map(({ id, name }) => ({ id, name })),
    };
  };
  const rememberListTags = (read: Pick<Envelope, 'value' | 'refreshedAt'>) => {
    for (const group of listOf(read.value, 'widget')) {
      if (!lost.has(group._id))
        rememberTags(
          group._id,
          group.tags.map((tag: GroupReadTag) => ({ ...tag, id: tag._id })),
          read.refreshedAt,
        );
    }
  };
  let savedGroups: WidgetCopy['savedGroups'];
  const lost = new Set<string>();
  const refusedAt = new Map<string, number>();
  const retired = new Set<string>();
  const archived = new Set<string>();
  let restored = false;
  const restore = async (accountId: string) => {
    if (restored || !rows) return;
    restored = true;
    const read = async (path: string) => {
      const row = cachedRead(await rows.load(accountId, path), accountId, path, now());
      return row && trusted(path, row.refreshedAt) ? row : null;
    };
    const list = await read('/api/groups');
    if (list && !savedGroups)
      savedGroups = {
        verifiedAt: list.refreshedAt,
        rows: parseGroups(list.value)
          .filter((g) => !lost.has(g.id))
          .map((g) => ({
            id: g.id,
            name: g.name,
            theme: g.category,
            archived: !!g.isArchived || archived.has(g.id),
            members: g.members.length,
            currencies: 1 + g.alternateCurrencies.length,
          })),
      };
    if (list) rememberListTags(list);
    const keys = (await rows.keys?.(accountId)) ?? [];
    for (const path of keys.filter((path) => /^\/api\/groups\/[^/]+$/.test(path))) {
      const id = path.split('/').at(-1)!;
      if (retired.has(id)) continue;
      const detail = await read(path);
      if (!detail || retired.has(id)) continue;
      if (!lost.has(id)) {
        try {
          rememberTags(id, contextOf(detail.value, 'widget').tags, detail.refreshedAt);
        } catch {
          /* An unreadable saved Group supplies no Tags. */
        }
      }
      try {
        const group = parseGroup(detail.value);
        if (!groups[id]) {
          const balances = await read(path + '/balances');
          try {
            if (balances && !retired.has(id))
              groups[id] = widgetGroupCopy(
                group,
                parseGroupBalances(balances.value),
                accountId,
                detail.refreshedAt,
                balances.refreshedAt,
              );
          } catch {
            /* An unreadable Balances part does not discard a saved Month summary. */
          }
        }
        if (!months[id]) {
          const month = monthKeyInZone(
            now(),
            Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          );
          const expected = expensePagePath(id, {
            limit: 20,
            includeMemberBreakdown: true,
            ...expenseMonthRange(month),
          });
          // Every Month page carries the same aggregate summary. Keep the newest saved read.
          for (const candidate of keys.filter((key) => key.replace(/page=\d+&/, '') === expected)) {
            const saved = await read(candidate);
            if (
              saved &&
              !retired.has(id) &&
              (!months[id] || saved.refreshedAt > months[id].verifiedAt)
            )
              months[id] = widgetMonthCopy(group, saved.value, accountId, month, saved.refreshedAt);
          }
        }
      } catch {
        /* A malformed saved read is never shown. */
      }
    }
  };
  return {
    update(snapshot: MobileSnapshot) {
      if (!native || snapshot.auth.status !== 'authenticated') return;
      const held = lease();
      if (!held) return;
      const data = snapshot.home;
      const listed = groupsRead();
      if (snapshot.groups.loaded && listed !== null)
        savedGroups = {
          verifiedAt: listed.refreshedAt,
          rows: snapshot.groups.data.map((g) => ({
            id: g.id,
            name: g.name,
            theme: g.category,
            archived: !!g.isArchived || archived.has(g.id),
            members: g.members.length,
            currencies: 1 + g.alternateCurrencies.length,
          })),
        };
      if (snapshot.groups.loaded && listed && trusted('/api/groups', listed.refreshedAt))
        rememberListTags(listed);
      const ids = new Set([
        ...snapshot.groups.data.map((g) => g.id),
        snapshot.detail.id,
        snapshot.expense.groupId,
        snapshot.settlement.groupId,
      ]);
      for (const id of ids) {
        const read = id ? groupReads(id)?.group : null;
        if (
          !id ||
          !read ||
          !trusted('/api/groups/' + id, read.refreshedAt) ||
          read.refreshedAt <= (refusedAt.get(id) ?? -Infinity)
        )
          continue;
        const context = contextOf(read.value, 'widget');
        rememberTags(id, context.tags, read.refreshedAt);
        lost.delete(id);
      }
      const id = snapshot.detail.data?.id;
      const reads = id ? groupReads(id) : null;
      if (id && reads?.balances && reads.group.refreshedAt > (refusedAt.get(id) ?? -Infinity)) {
        groups[id] = widgetGroupCopy(
          parseGroup(reads.group.value),
          parseGroupBalances(reads.balances.value),
          held.accountId,
          reads.group.refreshedAt,
          reads.balances.refreshedAt,
        );
        lost.delete(id);
        retired.delete(id);
        archived.delete(id);
      }
      const month = id && !lost.has(id) && !retired.has(id) ? monthRead(id) : null;
      if (month && snapshot.detail.data) {
        months[id!] = widgetMonthCopy(
          snapshot.detail.data,
          month.read.value,
          held.accountId,
          month.month,
          month.read.refreshedAt,
        );
      }
      const copy: WidgetCopy = {
        version: 1,
        accountId: held.accountId,
        groups: { ...groups },
        months: { ...months },
        tags: { ...tags },
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
        await held.writeSavedCopy(() => restore(held.accountId));
        copy.groups = { ...groups };
        copy.months = { ...months };
        copy.tags = { ...tags };
        copy.lostGroupIds = [...lost];
        if (savedGroups) copy.savedGroups = savedGroups;
        await held.writeSavedCopy(() => native.write(copy));
        await held.writeSavedCopy(() => native.setSession(state));
        await held.writeSavedCopy(() => native.redraw());
      });
    },
    archiveGroup(id: string) {
      if (groups[id]) groups[id] = { ...groups[id], archived: true };
      archived.add(id);
      lost.delete(id);
      retired.add(id);
      queue.cancel();
      signature = '';
    },
    forgetGroup(id: string, denied = false) {
      delete groups[id];
      delete months[id];
      archived.delete(id);
      retired.add(id);
      queue.cancel();
      if (denied) {
        delete tags[id];
        lost.add(id);
        refusedAt.set(id, now());
        if (savedGroups)
          savedGroups = { ...savedGroups, rows: savedGroups.rows.filter((g) => g.id !== id) };
      }
      signature = '';
    },
    reset() {
      queue.cancel();
      signature = '';
      groups = {};
      months = {};
      tags = {};
      savedGroups = undefined;
      lost.clear();
      refusedAt.clear();
      retired.clear();
      archived.clear();
      restored = false;
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
