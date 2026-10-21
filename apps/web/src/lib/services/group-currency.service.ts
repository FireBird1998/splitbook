/**
 * A Group's currency settings (#721, spec #710). Any member adds an extra currency, up to 4; only
 * an admin removes one, and only while no Expense, Settlement or To review item uses it. Activity
 * records each change as the list before and after, which also says who added each currency.
 */
import mongoose, { type ClientSession } from 'mongoose';
import connectDB from '@/lib/db';
import { withGroupMutation } from '@/lib/group-mutation';
import { CurrencyInUseError, CurrencyNotListedError } from '@/lib/group-currency-refusals';
import Activity from '@/lib/models/Activity';
import Expense from '@/lib/models/Expense';
import Group, { type IGroupDocument } from '@/lib/models/Group';
import RecurringExpense from '@/lib/models/RecurringExpense';
import Settlement from '@/lib/models/Settlement';
import { activityService } from './activity.service';
import { PERSON_FIELDS } from './person-fields';
import { MoneyValidationError } from '@splitbook/shared/exact-money';
import {
  extraCurrenciesProblem,
  normaliseExtraCurrencies,
} from '@splitbook/shared/group-currencies';
import {
  extraCurrencyChange,
  isCurrencyInUse,
  type ExtraCurrencySetting,
  type ExtraCurrencyUse,
  type GroupCurrencySettings,
} from '@splitbook/shared/group-currency-settings';

/** The most Expenses a refused removal lists by name; the rest are counted. */
const LISTED_EXPENSES = 100;
/** The most recorded currency-list changes read to find who added each currency; older ones say nobody. */
const LIST_CHANGES_READ = 200;

type GroupRecord = Pick<
  IGroupDocument,
  '_id' | 'name' | 'defaultCurrency' | 'alternateCurrencies' | 'currencyLocked' | 'members'
>;

const isMember = (group: GroupRecord, userId: string) =>
  group.members.some((member) => String(member.user) === userId);
const isAdmin = (group: GroupRecord, userId: string) =>
  group.members.some((member) => String(member.user) === userId && member.role === 'admin');
const extrasOf = (group: GroupRecord) =>
  normaliseExtraCurrencies(group.defaultCurrency, group.alternateCurrencies);

/** Whether money is recorded in the Group, which locks its main currency. */
export async function hasLedgerRecords(group: Pick<GroupRecord, '_id' | 'currencyLocked'>) {
  if (group.currencyLocked) return true;
  const records = await Promise.all([
    Expense.exists({ group: group._id }),
    Settlement.exists({ group: group._id }),
    RecurringExpense.exists({ group: group._id }),
  ]);
  return records.some(Boolean);
}

/**
 * What uses one currency in the Group: its live Expenses, latest first, its Settlements, and its
 * active To review items, the viewer's own apart from other members', which are only counted.
 */
async function currencyUse(
  groupId: mongoose.Types.ObjectId,
  currency: string,
  viewerId: string,
  session: ClientSession | null = null,
): Promise<ExtraCurrencyUse> {
  const expenses = { group: groupId, currency, isDeleted: { $ne: true } };
  const drafts = mongoose.connection.db!.collection('expensedrafts');
  const toReview = { group: groupId, state: 'active', 'values.currency': currency };
  const viewer = new mongoose.Types.ObjectId(viewerId);
  const [count, items, settlements, yours, others] = await Promise.all([
    Expense.countDocuments(expenses).session(session),
    Expense.find(expenses)
      .sort({ date: -1, createdAt: -1, _id: -1 })
      .limit(LISTED_EXPENSES)
      .select('description')
      .session(session)
      .lean(),
    Settlement.countDocuments({ group: groupId, currency }).session(session),
    drafts.countDocuments({ ...toReview, owner: viewer }, { session: session ?? undefined }),
    drafts.countDocuments(
      { ...toReview, owner: { $ne: viewer } },
      { session: session ?? undefined },
    ),
  ]);
  return {
    expenses: {
      count,
      items: items.map((item) => ({ _id: String(item._id), description: item.description })),
    },
    settlements,
    toReview: { yours, others },
  };
}

/** A recorded actor and time, as the settings name who added a currency. */
function addedBy(event: {
  actor: { _id: mongoose.Types.ObjectId; name: string } | null;
  createdAt: Date;
}): ExtraCurrencySetting['added'] {
  return event.actor
    ? {
        by: { _id: String(event.actor._id), name: event.actor.name },
        at: event.createdAt.toISOString(),
      }
    : null;
}

/**
 * Who added each listed currency, and when: the latest recorded change that added it, or the
 * Group's creation when it started with it. An older Group that recorded neither says nobody.
 */
async function additions(groupId: mongoose.Types.ObjectId, codes: string[]) {
  type Event = {
    type: string;
    actor: { _id: mongoose.Types.ObjectId; name: string } | null;
    metadata?: Record<string, unknown>;
    createdAt: Date;
  };
  const events = await Activity.find({
    group: groupId,
    $or: [
      { type: 'group_created' },
      { type: 'group_updated', 'metadata.changes.alternateCurrencies': { $exists: true } },
    ],
  })
    .sort({ createdAt: -1, _id: -1 })
    .limit(LIST_CHANGES_READ)
    .populate('actor', PERSON_FIELDS)
    .lean<Event[]>();
  const added = new Map<string, ExtraCurrencySetting['added']>();
  for (const event of events) {
    const change =
      event.type === 'group_created'
        ? extraCurrencyChange({
            alternateCurrencies: { old: [], new: event.metadata?.alternateCurrencies },
          })
        : extraCurrencyChange(event.metadata?.changes);
    for (const code of codes) {
      if (added.has(code) || !change) continue;
      if (change.added.includes(code)) added.set(code, addedBy(event));
      else if (change.removed.includes(code)) added.set(code, null);
    }
  }
  return added;
}

/** The Currencies section's read, as this member sees it. */
async function read(group: GroupRecord, viewerId: string): Promise<GroupCurrencySettings> {
  const codes = extrasOf(group);
  const [locked, uses, added] = await Promise.all([
    hasLedgerRecords(group),
    Promise.all(codes.map((code) => currencyUse(group._id, code, viewerId))),
    additions(group._id, codes),
  ]);
  return {
    mainCurrency: { code: group.defaultCurrency, locked },
    extraCurrencies: codes.map((code, index) => ({
      code,
      use: uses[index],
      added: added.get(code) ?? null,
    })),
  };
}

/**
 * Refuse to drop a currency that something still uses, naming the first one and what uses it.
 * Run inside the Group mutation that drops it, so no record in it can arrive in between.
 */
export async function refuseCurrenciesInUse(
  group: Pick<GroupRecord, '_id' | 'name'>,
  removed: readonly string[],
  viewerId: string,
  session: ClientSession | null = null,
) {
  for (const code of removed) {
    const use = await currencyUse(group._id, code, viewerId, session);
    if (isCurrencyInUse(use)) throw new CurrencyInUseError(code, group.name, use);
  }
}

/** The Group, read in the current mutation; a member who isn't in it is refused. */
async function memberGroup(groupId: string, userId: string, session: ClientSession | null) {
  const group = await Group.findById(groupId).session(session).lean<GroupRecord>();
  if (!group || !isMember(group, userId)) throw new Error('FORBIDDEN');
  return group;
}

async function settings(groupId: string, viewerId: string) {
  return read(await memberGroup(groupId, viewerId, null), viewerId);
}

/** Save the new list and record the change, in the same Group mutation. */
async function saveList(
  groupId: string,
  actorId: string,
  list: { old: string[]; new: string[] },
  session: ClientSession | null,
) {
  await Group.updateOne({ _id: groupId }, { $set: { alternateCurrencies: list.new } }).session(
    session,
  );
  await activityService.log(groupId, 'group_updated', actorId, {
    changes: { alternateCurrencies: list },
  });
}

export const groupCurrencyService = {
  /** The Group's currencies with what uses each one; members only. */
  async settings(groupId: string, viewerId: string): Promise<GroupCurrencySettings> {
    await connectDB();
    return settings(groupId, viewerId);
  },

  /** Any member adds a supported currency the Group doesn't list, while it has fewer than 4. */
  async add(groupId: string, currency: string, actorId: string): Promise<GroupCurrencySettings> {
    await connectDB();
    await withGroupMutation(groupId, async (session) => {
      const group = await memberGroup(groupId, actorId, session ?? null);
      const listed = extrasOf(group);
      const problem = listed.includes(currency)
        ? `${currency} is already one of this Group’s currencies.`
        : extraCurrenciesProblem(group.defaultCurrency, [...listed, currency]);
      if (problem)
        throw new MoneyValidationError('INVALID_GROUP_CURRENCIES', problem, ['currency']);
      await saveList(
        groupId,
        actorId,
        { old: listed, new: [...listed, currency] },
        session ?? null,
      );
    });
    return settings(groupId, actorId);
  },

  /** An admin removes an extra currency that nothing uses. */
  async remove(groupId: string, currency: string, actorId: string): Promise<GroupCurrencySettings> {
    await connectDB();
    await withGroupMutation(groupId, async (session) => {
      const group = await memberGroup(groupId, actorId, session ?? null);
      if (!isAdmin(group, actorId)) throw new Error('FORBIDDEN');
      const listed = extrasOf(group);
      if (!listed.includes(currency))
        throw new CurrencyNotListedError(currency, group.defaultCurrency);
      await refuseCurrenciesInUse(group, [currency], actorId, session ?? null);
      const next = listed.filter((code) => code !== currency);
      await saveList(groupId, actorId, { old: listed, new: next }, session ?? null);
    });
    return settings(groupId, actorId);
  },
};
