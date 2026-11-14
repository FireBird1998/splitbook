import { Superseded } from './transport';
import { widgetGroupsToConfirm } from '@splitbook/shared/widget-membership';
import { parseGroupListResponse, type GroupReadTag } from '@splitbook/shared/group-read';
import { expenseDraftChanged, parseExpenseContext, parseStoredExpenseDraft } from './expense-draft';
import type { AccountGroupRecordStore } from './account-record-storage';
import { cachedRead } from './offline-cache';
import { parseGroup, parseGroups } from './dto';
import { widgetMonthCopy } from './widget-month-copy';
import { expensePagePath } from '@splitbook/shared/api-paths';
import { monthKeyInZone } from '@splitbook/shared/zoned-calendar';
import { expenseMonthRange } from '@splitbook/shared/expense-day';
import { parseGroupBalances } from './financial-dto';
import type { SavedQueryRecords } from './saved-copy-budget';
import { widgetGroupCopy, widgetGroupPeople } from './widget-group-copy';
import type {
  WidgetGroupPart,
  WidgetMonthPart,
  WidgetRecentPart,
} from '@splitbook/shared/group-widget';
import { parseAmountMinor } from '@splitbook/shared/exact-money';
import type { WidgetCopy, WidgetSession } from '@splitbook/shared/balances-widget';
import { createSavedCopyQueue, parseOnce, type Envelope } from './saved-read-engine';
import type { AccountStorageLease, MobileSnapshot } from './types';

export interface WidgetCopyWriteOptions {
  groups?: readonly string[];
  tags?: readonly string[];
  months?: readonly string[];
  trustedGroups?: readonly string[];
  homeVerified?: boolean;
  current?(): boolean;
}
export type WidgetGroupEviction = { at: number } & (
  | { kind: 'lost' }
  | { kind: 'archived'; group?: WidgetGroupPart; month?: WidgetMonthPart }
);

export interface WidgetsNative {
  readCopy?(): Promise<WidgetCopy | null>;
  recentSelections?(accountId: string): Promise<Record<string, WidgetRecentPart | null>>;
  openSetup?(widgetId: number): Promise<void>;
  evictGroup?(accountId: string, id: string, eviction: WidgetGroupEviction): Promise<void>;
  write(copy: WidgetCopy, options?: WidgetCopyWriteOptions): Promise<void>;
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
  drafts?: Pick<AccountGroupRecordStore, 'load'>,
) {
  const queue = createSavedCopyQueue();
  let signature = '';
  let epoch = 0;
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
  let written: WidgetCopy | null = null;
  let initialHome: WidgetCopy['home'] = null;
  let homeAnswered = false;
  let homeReady = true;
  let homeRefusedAt = -Infinity;
  let copyEvictions = 0;
  let evictionWrites: Promise<void> = Promise.resolve();
  const persistEviction = (id: string, eviction: WidgetGroupEviction) => {
    const held = lease();
    if (!held || !native?.evictGroup) return Promise.resolve();
    const writing = evictionWrites.then(() =>
      held.writeSavedCopy(() => native.evictGroup!(held.accountId, id, eviction)),
    );
    evictionWrites = writing.catch(() => undefined);
    return writing;
  };
  const pendingNativeGroups = new Set<string>();
  const groupPath = (id: string) => '/api/groups/' + id;
  const ledgerPath = (id: string) => expensePagePath(id, { limit: 20 });
  const trustedGroup = (id: string, part: WidgetGroupPart) =>
    trusted(groupPath(id), part.verifiedAt) &&
    trusted(groupPath(id) + '/balances', part.balancesVerifiedAt);
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
  const rememberCatalogue = (
    rows: NonNullable<WidgetCopy['savedGroups']>['rows'],
    verifiedAt: number,
  ) => {
    const previous = savedGroups;
    const included = new Set(rows.map((row) => row.id));
    const omitted = previous?.rows.filter((row) => !included.has(row.id)) ?? [];
    savedGroups = {
      verifiedAt,
      rows: [...rows, ...omitted]
        .filter((row) => !lost.has(row.id))
        .map((row) => ({ ...row, archived: row.archived || archived.has(row.id) })),
    };
  };
  const lost = new Set<string>();
  const refusedAt = new Map<string, number>();
  const retired = new Set<string>();
  const retiredRecent = new Set<string>();
  const archived = new Set<string>();
  let restored = false;
  const restore = async (accountId: string) => {
    if (restored || !rows) return;
    restored = true;
    const started = epoch;
    const assertCurrent = () => {
      if (started !== epoch) throw new Superseded();
    };
    const previous = await native?.readCopy?.();
    assertCurrent();
    if (previous?.accountId === accountId) {
      homeRefusedAt = Math.max(homeRefusedAt, ...Object.values(previous.peopleRefusedAt ?? {}));
      if (!homeAnswered) initialHome = previous.home;
      for (const id of widgetGroupsToConfirm(previous, new Set())) pendingNativeGroups.add(id);
      const fences = { ...previous.peopleRefusedAt };
      // Older copies already remember refusals, but do not yet carry their times.
      for (const id of previous.lostGroupIds ?? []) fences[id] ??= now();
      for (const [id, at] of Object.entries(fences)) {
        if (!Number.isFinite(at)) continue;
        const live = groupReads(id)?.group;
        if (
          live?.source === 'network' &&
          live.refreshedAt > at &&
          trusted(groupPath(id), live.refreshedAt)
        )
          continue;
        peopleRefusedAt[id] = Math.max(peopleRefusedAt[id] ?? -Infinity, at);
        refusedAt.set(id, at);
        lost.add(id);
        delete groupPeople[id];
      }
    }
    if (previous?.accountId === accountId) {
      const allowed = (id: string) =>
        !lost.has(id) && !retired.has(id) && peopleRefusedAt[id] === undefined;
      for (const [id, part] of Object.entries(previous.groups ?? {}))
        if (allowed(id) && !groups[id] && trustedGroup(id, part)) groups[id] = part;
      for (const [id, part] of Object.entries(previous.groupPeople ?? {}))
        if (allowed(id) && !groupPeople[id] && trusted(groupPath(id), part.verifiedAt))
          groupPeople[id] = part;
      for (const [id, part] of Object.entries(previous.tags ?? {}))
        if (allowed(id) && !tags[id] && trusted(groupPath(id), part.verifiedAt)) tags[id] = part;
      for (const [id, part] of Object.entries(previous.months ?? {}))
        if (allowed(id) && !months[id] && trusted(ledgerPath(id), part.verifiedAt))
          months[id] = part;
      if (previous.savedGroups && trusted('/api/groups', previous.savedGroups.verifiedAt)) {
        const current = savedGroups;
        savedGroups = previous.savedGroups;
        if (
          current &&
          (groupsRead()?.source === 'network' || current.verifiedAt >= savedGroups.verifiedAt)
        )
          rememberCatalogue(current.rows, current.verifiedAt);
      }
    }
    const read = async (path: string) => {
      const row = cachedRead(await rows.load(accountId, path), accountId, path, now());
      assertCurrent();
      return row && trusted(path, row.refreshedAt) ? row : null;
    };
    const list = await read('/api/groups');
    if (list) {
      for (const group of parseGroups(list.value)) rememberPeople(group, list.refreshedAt);
    }
    if (list && (!savedGroups || list.refreshedAt >= savedGroups.verifiedAt))
      rememberCatalogue(
        parseGroups(list.value)
          .filter((g) => !lost.has(g.id))
          .map((g) => ({
            id: g.id,
            name: g.name,
            theme: g.category,
            archived: !!g.isArchived || archived.has(g.id),
            members: g.members.length,
            currencies: 1 + g.alternateCurrencies.length,
          })),
        list.refreshedAt,
      );
    if (list) rememberListTags(list);
    const keys = (await rows.keys?.(accountId)) ?? [];
    assertCurrent();
    for (const path of keys.filter((path) => /^\/api\/groups\/[^/]+$/.test(path))) {
      const id = path.split('/').at(-1)!;
      if (retired.has(id)) continue;
      const detail = await read(path);
      if (!detail || retired.has(id) || lost.has(id) || peopleRefusedAt[id] !== undefined) continue;
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
            /* An unreadable Balances part does not options a saved Month summary. */
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
      const copyOwner = copyEvictions;
      const accountOwner = epoch;
      const trustedGroups: string[] = [];
      if (data.data !== null && !data.restored) {
        homeAnswered = true;
        initialHome = null;
      }
      const listed = groupsRead();
      if (snapshot.groups.loaded && listed && trusted('/api/groups', listed.refreshedAt)) {
        for (const group of parseGroups(listed.value)) rememberPeople(group, listed.refreshedAt);
      }
      if (
        snapshot.groups.loaded &&
        listed &&
        trusted('/api/groups', listed.refreshedAt) &&
        (listed.source === 'network' ||
          !savedGroups ||
          listed.refreshedAt >= savedGroups.verifiedAt)
      )
        rememberCatalogue(
          parseGroups(listed.value).map((g) => ({
            id: g.id,
            name: g.name,
            theme: g.category,
            archived: !!g.isArchived || archived.has(g.id),
            members: g.members.length,
            currencies: 1 + g.alternateCurrencies.length,
          })),
          listed.refreshedAt,
        );
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
          read.refreshedAt <= (refusedAt.get(id) ?? -Infinity) ||
          (read.source !== 'network' && (lost.has(id) || peopleRefusedAt[id] !== undefined))
        )
          continue;
        if (read.source === 'network') {
          trustedGroups.push(id);
          delete peopleRefusedAt[id];
          refusedAt.delete(id);
        }
        const context = contextOf(read.value, 'widget');
        rememberTags(id, context.tags, read.refreshedAt);
        lost.delete(id);
        rememberPeople(parseGroup(read.value), read.refreshedAt, true);
      }
      const id = snapshot.detail.data?.id;
      const reads = id ? groupReads(id) : null;
      if (id && reads?.balances && !lost.has(id) && peopleRefusedAt[id] === undefined) {
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
                  Object.entries(data.byGroup).map(([id, balances]) => [
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
        if (
          !copy.home &&
          !homeAnswered &&
          initialHome &&
          trusted('/api/user/balances', initialHome.verifiedAt)
        )
          copy.home = initialHome;
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
        if (copy.finishLater && copy.lostGroupIds?.includes(copy.finishLater.groupId))
          delete copy.finishLater;
        const old = await held.writeSavedCopy(async () => (await native.readCopy?.()) ?? written);
        const unfinished = old?.finishLater;
        if (
          !copy.finishLater &&
          unfinished &&
          drafts &&
          process.env.EXPO_PUBLIC_PERSISTENT_DRAFTS_ENABLED === 'true' &&
          !snapshot.groups.data.some((group) => group.id === unfinished.groupId) &&
          !copy.lostGroupIds?.includes(unfinished.groupId) &&
          !archived.has(unfinished.groupId) &&
          !copy.groups?.[unfinished.groupId]?.archived
        ) {
          try {
            const record = await held.writeSavedCopy(() =>
              drafts.load(held.accountId, unfinished.groupId),
            );
            const { draft, attempt, mutation } = parseStoredExpenseDraft(
              record,
              held.accountId,
              unfinished.groupId,
            );
            if (!draft.original && !attempt && !mutation) copy.finishLater = unfinished;
          } catch {
            // An unreadable kept record supplies no Finish later prompt.
          }
        }
        const options: WidgetCopyWriteOptions = {
          trustedGroups,
          homeVerified: homeReady && data.data !== null && !data.restored && !!copy.home,
          current: () => copyOwner === copyEvictions && accountOwner === epoch,
          groups: Object.entries(old?.groups ?? {})
            .filter(([id, part]) => !trustedGroup(id, part))
            .map(([id]) => id),
          tags: Object.entries(old?.tags ?? {})
            .filter(([id, part]) => !trusted(groupPath(id), part.verifiedAt))
            .map(([id]) => id),
          months: Object.entries(old?.months ?? {})
            .filter(([id, part]) => !trusted(ledgerPath(id), part.verifiedAt))
            .map(([id]) => id),
        };
        copy.groups = Object.fromEntries(
          Object.entries(copy.groups ?? {}).filter(([id, part]) => trustedGroup(id, part)),
        );
        copy.groupPeople = Object.fromEntries(
          Object.entries(copy.groupPeople ?? {}).filter(([id, part]) =>
            trusted(groupPath(id), part.verifiedAt),
          ),
        );
        copy.tags = Object.fromEntries(
          Object.entries(copy.tags ?? {}).filter(([id, part]) =>
            trusted(groupPath(id), part.verifiedAt),
          ),
        );
        copy.months = Object.fromEntries(
          Object.entries(copy.months ?? {}).filter(([id, part]) =>
            trusted(ledgerPath(id), part.verifiedAt),
          ),
        );
        if (copy.recents)
          copy.recents = Object.fromEntries(
            Object.entries(copy.recents).filter(([id, part]) =>
              trusted(ledgerPath(id), part.verifiedAt),
            ),
          );
        const unavailable = new Set([
          ...(copy.lostGroupIds ?? []),
          ...Object.keys(copy.groups ?? {}).filter((id) => copy.groups![id].archived),
          ...Object.keys(copy.groupPeople ?? {}).filter((id) => copy.groupPeople![id].archived),
        ]);
        if (
          (homeAnswered && data.restored) ||
          (copy.home &&
            (!trusted('/api/user/balances', copy.home.verifiedAt) ||
              Object.keys(copy.home.byGroup ?? {}).some((id) => unavailable.has(id)) ||
              ((data.restored || data.data === null) &&
                (Math.max(homeRefusedAt, ...Object.values(peopleRefusedAt)) >
                  copy.home.verifiedAt ||
                  (unavailable.size > 0 &&
                    (!copy.home.byGroup ||
                      Object.keys(copy.home.byGroup).length < copy.home.groupCount))))))
        )
          copy.home = null;
        if (copy.savedGroups) {
          if (!trusted('/api/groups', copy.savedGroups.verifiedAt)) delete copy.savedGroups;
          else
            copy.savedGroups = {
              ...copy.savedGroups,
              rows: copy.savedGroups.rows.filter((group) => !copy.lostGroupIds?.includes(group.id)),
            };
        }
        options.homeVerified &&= !!copy.home;
        const next = JSON.stringify([copy, state, options]);
        if (next === signature) return;
        // A refusal or archive invalidates every captured part, not only Home.
        if (copyOwner !== copyEvictions) return;
        await held.writeSavedCopy(() => native.write(copy, options));
        if (copyOwner !== copyEvictions) return;
        written = copy;
        await held.writeSavedCopy(() => native.setSession(state));
        await held.writeSavedCopy(() => native.redraw());
        signature = next;
      });
    },
    async unlistedGroups(listed: ReadonlySet<string>) {
      const held = lease();
      if (!held || !native) return [];
      for (const id of listed) pendingNativeGroups.delete(id);
      const before = widgetGroupsToConfirm(written, listed);
      await queue.idle();
      const copy = await held.writeSavedCopy(async () => (await native.readCopy?.()) ?? written);
      return copy?.accountId === held.accountId
        ? [
            ...new Set([...before, ...pendingNativeGroups, ...widgetGroupsToConfirm(copy, listed)]),
          ].filter(
            (id) =>
              !listed.has(id) &&
              !lost.has(id) &&
              !archived.has(id) &&
              peopleRefusedAt[id] === undefined,
          )
        : [];
    },
    confirmedGroup(id: string) {
      pendingNativeGroups.delete(id);
    },
    homeVerified() {
      homeReady = true;
    },
    archiveGroup(id: string) {
      homeReady = false;
      homeAnswered = true;
      initialHome = null;
      copyEvictions++;
      pendingNativeGroups.delete(id);
      if (groups[id]) groups[id] = { ...groups[id], archived: true };
      if (groupPeople[id]) groupPeople[id] = { ...groupPeople[id], archived: true };
      archived.add(id);
      lost.delete(id);
      retired.add(id);
      queue.cancel();
      signature = '';
      return persistEviction(id, {
        kind: 'archived',
        at: now(),
        group: groups[id],
        month: months[id],
      });
    },
    forgetGroup(id: string, denied = false) {
      homeReady = false;
      homeAnswered = true;
      initialHome = null;
      copyEvictions++;
      pendingNativeGroups.delete(id);
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
      return denied ? persistEviction(id, { kind: 'lost', at: now() }) : Promise.resolve();
    },
    reset() {
      epoch++;
      queue.cancel();
      signature = '';
      groups = {};
      months = {};
      tags = {};
      groupPeople = {};
      peopleRefusedAt = {};
      written = null;
      initialHome = null;
      homeAnswered = false;
      homeReady = true;
      homeRefusedAt = -Infinity;
      copyEvictions = 0;
      pendingNativeGroups.clear();
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
      await Promise.all([queue.idle(), evictionWrites]);
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
