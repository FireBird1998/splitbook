import { Types } from 'mongoose';
import connectDB from '@/lib/db';
import Activity from '@/lib/models/Activity';
import Expense from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
// Registers the model `populate('actor')` needs. A fresh server instance loads only the
// modules of the route it serves, so this read must not rely on another route (#186).
import '@/lib/models/User';
import { USER_ACTIVITY_MAX_LIMIT } from '@splitbook/shared/user-activity-read';

/** One event of the latest changes, as `GET /api/user/activity` sends it. */
export interface UserActivityEvent {
  _id: string;
  type: string;
  createdAt: Date;
  group: { _id: string; name: string };
  /** By name only; null when the person's account no longer exists. */
  actor: { _id: string; name: string } | null;
  /** The currency of the event's amounts, when it has any. */
  currency?: string;
  metadata: Record<string, unknown>;
}

type Fields = Record<string, unknown>;

const isRecord = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const objectId = (value: unknown): string | undefined =>
  value instanceof Types.ObjectId
    ? value.toHexString()
    : typeof value === 'string' && /^[a-f\d]{24}$/i.test(value)
      ? value
      : undefined;
const scalar = (value: unknown) =>
  typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));

/** The metadata fields Home's line and amount use, and the money fields of an edit. */
const IDS = ['expenseId', 'settlementId'];
const TEXTS = ['description', 'currency', 'paidByName', 'paidToName', 'action', 'method'];
const MONEY_CHANGES = ['amount', 'amountMinor', 'currency'];

/**
 * What the read sends of an event's metadata. People appear by name only (a payment's
 * `paidByName` and `paidToName`); member ids, emails and every other recorded field stay out.
 * An Expense edit keeps only its money changes, before and after.
 */
function publicMetadata(type: string, metadata: unknown): Fields {
  const source = isRecord(metadata) ? metadata : {};
  const sent: Fields = {};
  for (const key of IDS) {
    const id = objectId(source[key]);
    if (id) sent[key] = id;
  }
  for (const key of TEXTS) if (typeof source[key] === 'string') sent[key] = source[key];
  if (typeof source.amount === 'number' && Number.isFinite(source.amount))
    sent.amount = source.amount;
  if (type === 'expense_updated' && isRecord(source.changes)) {
    const changes: Fields = {};
    for (const key of MONEY_CHANGES) {
      const change = source.changes[key];
      if (!isRecord(change)) continue;
      changes[key] = {
        ...(scalar(change.old) ? { old: change.old } : {}),
        ...(scalar(change.new) ? { new: change.new } : {}),
      };
    }
    sent.changes = changes;
  }
  return sent;
}

interface StoredEdit {
  editedAt?: Date;
  changes?: { currency?: { old?: unknown } };
}

/**
 * The currency an Expense had just after `at`: the one a later edit changed it from, or its
 * currency today. Only legacy Groups that mixed currencies can change an Expense's currency.
 */
function currencyAfter(expense: { currency: string; editHistory?: StoredEdit[] }, at: Date) {
  const later = (expense.editHistory ?? [])
    .filter(
      (edit) =>
        edit.editedAt instanceof Date &&
        edit.editedAt > at &&
        typeof edit.changes?.currency?.old === 'string',
    )
    .sort((a, b) => a.editedAt!.getTime() - b.editedAt!.getTime());
  return (later[0]?.changes?.currency?.old as string | undefined) ?? expense.currency;
}

export class UserActivityService {
  /**
   * The latest Activity across the Groups the member belongs to today, newest first: Home's
   * latest changes (#309). Archived Groups are left out, as they are from Home's Groups and
   * totals. A Group the member has left, or never joined, contributes nothing.
   *
   * Read-only: unlike a Group's own Activity read, it doesn't publish events whose
   * publication failed (`activityService.recoverGroupActivity`). Those appear here once that
   * Group's Activity is read, or the next write to the same record publishes them.
   */
  async getUserActivity(userId: string, limit: number) {
    const size = Math.max(1, Math.min(USER_ACTIVITY_MAX_LIMIT, Math.floor(limit)));
    await connectDB();

    const groups = await Group.find({ 'members.user': userId, isArchived: false })
      .select('name defaultCurrency')
      .lean();
    if (groups.length === 0) return { activities: [] as UserActivityEvent[], limit: size };
    const groupsById = new Map(groups.map((group) => [String(group._id), group]));
    const groupIds = groups.map((group) => group._id);

    // The { group, createdAt, _id } index serves each Group's newest events in order.
    const events = await Activity.find({ group: { $in: groupIds } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(size)
      .populate<{ actor: { _id: Types.ObjectId; name?: string } | null }>('actor', 'name')
      .lean();

    const activities = events.map((event): UserActivityEvent => {
      const group = groupsById.get(String(event.group))!;
      const metadata = publicMetadata(event.type, event.metadata);
      const actor = isRecord(event.actor) ? event.actor : null;
      return {
        _id: String(event._id),
        type: event.type,
        createdAt: event.createdAt,
        group: { _id: String(group._id), name: group.name },
        actor: actor ? { _id: String(actor._id), name: actor.name ?? '' } : null,
        ...(typeof metadata.currency === 'string' ? { currency: metadata.currency } : {}),
        metadata,
      };
    });
    await this.resolveEditCurrencies(activities, groupIds, groupsById);
    return { activities, limit: size };
  }

  /**
   * An Expense edit records only what changed, so an edit to the amount alone doesn't name the
   * currency. Each such edit gets the currency its Expense had just after it, and the Group's
   * own currency if the Expense can't be found.
   */
  private async resolveEditCurrencies(
    activities: UserActivityEvent[],
    groupIds: Types.ObjectId[],
    groupsById: Map<string, { defaultCurrency: string }>,
  ) {
    const edits = activities.filter((event) => {
      const changes = event.metadata.changes;
      return (
        event.type === 'expense_updated' &&
        isRecord(changes) &&
        (isRecord(changes.amount) || isRecord(changes.amountMinor))
      );
    });
    if (edits.length === 0) return;

    const expenseIds = [
      ...new Set(edits.flatMap((event) => objectId(event.metadata.expenseId) ?? [])),
    ];
    const expenses = await Expense.find({ _id: { $in: expenseIds }, group: { $in: groupIds } })
      .select('currency editHistory.editedAt editHistory.changes.currency')
      .lean<{ _id: Types.ObjectId; currency: string; editHistory?: StoredEdit[] }[]>();
    const expensesById = new Map(expenses.map((expense) => [String(expense._id), expense]));

    for (const event of edits) {
      const changes = event.metadata.changes as Fields;
      const changed = isRecord(changes.currency) ? changes.currency.new : undefined;
      const expense = expensesById.get(String(event.metadata.expenseId));
      event.currency =
        typeof changed === 'string'
          ? changed
          : expense
            ? currencyAfter(expense, event.createdAt)
            : groupsById.get(event.group._id)?.defaultCurrency;
    }
  }
}

export const userActivityService = new UserActivityService();
