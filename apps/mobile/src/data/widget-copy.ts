import { widgetGroupWasDropped } from '@splitbook/shared/widget-membership';
import { parseGroupListResponse, type GroupReadTag } from '@splitbook/shared/group-read';
import { expenseDraftChanged, parseExpenseContext } from './expense-draft';
import { cachedRead } from './offline-cache';
import { parseGroup, parseGroups } from './dto';
import { widgetMonthCopy } from './widget-month-copy';
import { expensePagePath } from '@splitbook/shared/api-paths';
import { monthKeyInZone } from '@splitbook/shared/zoned-calendar';
import { expenseMonthRange } from '@splitbook/shared/expense-day';
import { parseGroupBalances } from './financial-dto';
import type { SavedQueryRecords } from './saved-copy-budget';
import { widgetGroupCopy, widgetGroupPeople } from './widget-group-copy';
import type { WidgetGroupPart, WidgetRecentPart } from '@splitbook/shared/group-widget';
import { parseAmountMinor } from '@splitbook/shared/exact-money';
import type { WidgetCopy, WidgetSession } from '@splitbook/shared/balances-widget';
import { createSavedCopyQueue, parseOnce, type Envelope } from './saved-read-engine';
import type { AccountStorageLease, MobileSnapshot } from './types';

export interface WidgetsNative {
  readCopy?(): Promise<WidgetCopy | null>;
  recentSelections?(accountId: string): Promise<Record<string, WidgetRecentPart | null>>;
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
  recentRead: (id: string) => WidgetRecentPart | null = () => null,
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
    if (
      (tags[id]?.verifiedAt ?? -Infinity) > verifiedAt ||
      verifiedAt <= (peopleRefusedAt[id] ?? -Infinity)
    )
      return;
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
  let groupPeople: NonNullable<WidgetCopy['groupPeople']> = {};
  let peopleRefusedAt: NonNullable<WidgetCopy['peopleRefusedAt']> = {};
  let peopleList: Pick<Envelope, 'refreshedAt' | 'value'> | null = null;
  const pruneGroups = (copy: WidgetCopy) => {
    if (!peopleList) return;
    const parts = {
      ...copy,
      groups,
      groupPeople,
      tags,
      months,
      savedGroups: { verifiedAt: peopleList.refreshedAt, rows: parseGroups(peopleList.value) },
    };
    const ids = new Set([
      ...Object.keys(groups),
      ...Object.keys(groupPeople),
      ...Object.keys(tags),
      ...Object.keys(months),
    ]);
    for (const id of ids)
      if (widgetGroupWasDropped(parts, id)) {
        delete groups[id];
        delete groupPeople[id];
        delete tags[id];
        delete months[id];
        retiredRecent.add(id);
      }
  };

  const rememberPeople = (
    group: Parameters<typeof widgetGroupPeople>[0],
    verifiedAt: number,
    direct = false,
  ) => {
    if (
      (!direct && groupPeople[group.id]?.verifiedAt === verifiedAt) ||
      lost.has(group.id) ||
      verifiedAt <= (peopleRefusedAt[group.id] ?? -Infinity) ||
      (groupPeople[group.id]?.verifiedAt ?? -Infinity) > verifiedAt
    )
      return;
    delete peopleRefusedAt[group.id];
    groupPeople[group.id] = {
      ...widgetGroupPeople(group, verifiedAt),
      archived: !!group.isArchived || archived.has(group.id),
    };
  };
  let savedGroups: WidgetCopy['savedGroups'];
  const lost = new Set<string>();
  const refusedAt = new Map<string, number>();
  const retired = new Set<string>();
  const retiredRecent = new Set<string>();
  const archived = new Set<string>();
  let restored = false;
  const restore = async (accountId: string) => {
    if (restored || !rows) return;
    restored = true;
    const previous = await native?.readCopy?.();
    if (previous?.accountId === accountId) {
      const fences = { ...previous.peopleRefusedAt };
      // Older copies already remember refusals, but do not yet carry their times.
      for (const id of previous.lostGroupIds ?? []) fences[id] ??= now();
      for (const [id, at] of Object.entries(fences)) {
        if (!Number.isFinite(at)) continue;
        if ((groupPeople[id]?.verifiedAt ?? -Infinity) > at) continue;
        peopleRefusedAt[id] = Math.max(peopleRefusedAt[id] ?? -Infinity, at);
        refusedAt.set(id, at);
        delete groupPeople[id];
      }
    }
    const read = async (path: string) => {
      const row = cachedRead(await rows.load(accountId, path), accountId, path, now());
      return row && trusted(path, row.refreshedAt) ? row : null;
    };
    const list = await read('/api/groups');
    if (list) {
      if (!peopleList || list.refreshedAt > peopleList.refreshedAt) peopleList = list;
      for (const group of parseGroups(list.value)) rememberPeople(group, list.refreshedAt);
    }
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
      if (!detail || retired.has(id) || detail.refreshedAt <= (refusedAt.get(id) ?? -Infinity))
        continue;
      delete peopleRefusedAt[id];
      refusedAt.delete(id);
      if (!lost.has(id)) {
        try {
          rememberPeople(parseGroup(detail.value), detail.refreshedAt, true);
        } catch {
          /* An unreadable saved Group supplies no people. */
        }
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
      if (snapshot.groups.loaded && listed && trusted('/api/groups', listed.refreshedAt)) {
        if (!peopleList || listed.refreshedAt > peopleList.refreshedAt) peopleList = listed;
        for (const group of parseGroups(listed.value)) rememberPeople(group, listed.refreshedAt);
      }
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
        rememberPeople(parseGroup(read.value), read.refreshedAt, true);
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
        groupPeople: { ...groupPeople },
        peopleRefusedAt: { ...peopleRefusedAt },
        lostGroupIds: [...new Set([...lost, ...Object.keys(peopleRefusedAt)])],
        ...(savedGroups ? { savedGroups } : {}),
        home:
          data.data !== null && data.refreshedAt !== null
            ? {
                verifiedAt: data.refreshedAt,
                groupCount: Object.keys(data.byGroup).length,
                byGroup: Object.fromEntries(
                  Object.entries(data.byGroup)
                    .filter(([id]) => !lost.has(id))
                    .map(([id, balances]) => [
                      id,
                      balances.map(({ currency, balance }) => ({
                        currency,
                        balanceMinor:
                          Math.sign(balance) * parseAmountMinor(Math.abs(balance), currency),
                      })),
                    ]),
                ),
                currencies: data.data.map(({ currency, youOwe, youAreOwed }) => ({
                  currency,
                  oweMinor: parseAmountMinor(youOwe, currency),
                  owedMinor: parseAmountMinor(youAreOwed, currency),
                })),
              }
            : null,
      };
      if (process.env.EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED === 'true') {
        // A Group's kept entry is read when its list opens, before Home next lists drafts.
        // Prefer that current result (including absence) over Home's earlier summary.
        const kept = snapshot.keptDraft;
        const openGroup = snapshot.detail.data;
        const editor = snapshot.expense;
        const entered = editor.draft;
        const editorGroup = editor.groupId;
        const editorName =
          editor.context?.group.name ??
          snapshot.groups.data.find((g) => g.id === editorGroup)?.name;
        const draft =
          editorGroup &&
          editorName &&
          entered &&
          !entered.original &&
          !editor.attempt &&
          !editor.mutation &&
          editor.persistence === 'saved' &&
          !editor.accessLost &&
          ['editing', 'resume', 'blocked'].includes(editor.status) &&
          expenseDraftChanged(entered, editor.blank)
            ? { groupId: editorGroup, groupName: editorName }
            : kept?.draft &&
                !kept.draft.edit &&
                !kept.unconfirmed &&
                kept.groupId !== editorGroup &&
                openGroup?.id === kept.groupId
              ? { groupId: kept.groupId, groupName: openGroup.name }
              : snapshot.drafts.find(
                  (d) =>
                    !d.expenseId &&
                    !d.unconfirmed &&
                    d.groupId !== openGroup?.id &&
                    d.groupId !== editorGroup,
                );
        if (draft && !lost.has(draft.groupId))
          copy.finishLater = { groupId: draft.groupId, groupName: draft.groupName };
      }
      const count = review(snapshot);
      if (count) copy.review = count;
      const state: WidgetSession = {
        status: 'authenticated',
        accountId: held.accountId,
        loading: data.status === 'loading' && !copy.home,
      };
      queue.push('widget', async () => {
        await held.writeSavedCopy(() => restore(held.accountId));
        copy.groups = { ...groups };
        copy.months = { ...months };
        copy.tags = { ...tags };
        copy.groupPeople = { ...groupPeople };
        copy.peopleRefusedAt = { ...peopleRefusedAt };
        copy.lostGroupIds = [...new Set([...lost, ...Object.keys(peopleRefusedAt)])];
        if (savedGroups) copy.savedGroups = savedGroups;
        if (native.recentSelections) {
          copy.recents = {};
          try {
            await held.writeSavedCopy(async () => {
              const selected = await native.recentSelections!(held.accountId);
              const recents: NonNullable<WidgetCopy['recents']> = {};
              for (const id of Object.keys(selected)) {
                if (copy.lostGroupIds?.includes(id)) continue;
                const current = recentRead(id);
                if (current) retiredRecent.delete(id);
                const saved = current ?? (!retiredRecent.has(id) ? selected[id] : null);
                if (saved) recents[id] = saved;
              }
              copy.recents = recents;
            });
          } catch {
            // Optional private rows cannot prevent the other saved parts or session redrawing.
            copy.recents = {};
          }
        }
        const dropped = new Set(
          [...Object.keys(copy.groups ?? {}), ...Object.keys(copy.home?.byGroup ?? {})].filter(
            (id) => copy.lostGroupIds?.includes(id) || widgetGroupWasDropped(copy, id),
          ),
        );
        pruneGroups(copy);
        if (copy.home?.byGroup)
          copy.home = {
            ...copy.home,
            byGroup: Object.fromEntries(
              Object.entries(copy.home.byGroup).filter(([id]) => !dropped.has(id)),
            ),
          };
        copy.groups = { ...groups };
        copy.months = { ...months };
        copy.tags = { ...tags };
        copy.groupPeople = { ...groupPeople };
        if (copy.recents)
          for (const id of Object.keys(copy.recents))
            if (widgetGroupWasDropped(copy, id)) delete copy.recents[id];
        if (copy.finishLater && widgetGroupWasDropped(copy, copy.finishLater.groupId))
          delete copy.finishLater;
        const next = JSON.stringify([copy, state]);
        if (next === signature) return;
        await held.writeSavedCopy(() => native.write(copy));
        await held.writeSavedCopy(() => native.setSession(state));
        await held.writeSavedCopy(() => native.redraw());
        signature = next;
      });
    },
    archiveGroup(id: string) {
      if (groups[id]) groups[id] = { ...groups[id], archived: true };
      if (groupPeople[id]) groupPeople[id] = { ...groupPeople[id], archived: true };
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
      retiredRecent.add(id);
      queue.cancel();
      if (denied) {
        delete tags[id];
        delete groupPeople[id];
        peopleRefusedAt[id] = now();
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
      groupPeople = {};
      peopleRefusedAt = {};
      peopleList = null;
      savedGroups = undefined;
      lost.clear();
      refusedAt.clear();
      retired.clear();
      retiredRecent.clear();
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
