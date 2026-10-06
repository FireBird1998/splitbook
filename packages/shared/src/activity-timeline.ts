import { formatCurrency } from './currency';
import { formatDate, formatDateTime } from './date';
import { toMajorAmount } from './exact-money';

export interface ActivityLike {
  _id: string;
  type: string;
  createdAt: string;
  actor?: { name?: string; _id?: string } | null;
  metadata?: Record<string, unknown> | null;
}

export interface ActivityDayGroup {
  key: string;
  label: string;
  activities: ActivityLike[];
}

function dayKey(date: string): string {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function groupActivitiesByDay(activities: ActivityLike[]): ActivityDayGroup[] {
  const groups = new Map<string, ActivityDayGroup>();

  for (const activity of activities) {
    const key = dayKey(activity.createdAt);
    const existing = groups.get(key);
    if (existing) {
      existing.activities.push(activity);
      continue;
    }
    groups.set(key, {
      key,
      label: formatDate(activity.createdAt),
      activities: [activity],
    });
  }

  return Array.from(groups.values());
}

export function formatActivityHeadline(activity: ActivityLike): string {
  const actorName = activity.actor?.name || 'Someone';
  const meta = activity.metadata || {};

  switch (activity.type) {
    case 'expense_added':
      return (
        `${actorName} added “${meta.description ?? 'an expense'}”` +
        (meta.recurring === true ? ' (recurring)' : '')
      );
    case 'expense_updated':
      return `${actorName} updated “${meta.description ?? 'an expense'}”`;
    case 'expense_deleted':
      return `${actorName} deleted “${meta.description ?? 'an expense'}”`;
    case 'settlement_recorded': {
      const amount =
        typeof meta.amount === 'number' && typeof meta.currency === 'string'
          ? formatCurrency(meta.amount, meta.currency)
          : 'a payment';
      return `${actorName} recorded ${amount}`;
    }
    case 'member_joined':
      return `${actorName} joined the group`;
    case 'member_left':
      return meta.method === 'removed'
        ? `${actorName} removed a member from the group`
        : `${actorName} left the group`;
    case 'group_created':
      return `${actorName} created the group`;
    case 'group_updated':
      return `${actorName} updated group settings`;
    default:
      return `${actorName} performed an action`;
  }
}

export function formatActivityDetail(activity: ActivityLike): string | null {
  const meta = activity.metadata || {};

  if (
    activity.type === 'expense_added' ||
    activity.type === 'expense_updated' ||
    activity.type === 'expense_deleted'
  ) {
    if (typeof meta.amount === 'number' && typeof meta.currency === 'string') {
      return formatCurrency(meta.amount, meta.currency);
    }
    return null;
  }

  if (activity.type === 'settlement_recorded') {
    const paidTo = typeof meta.paidToName === 'string' ? meta.paidToName : null;
    const paidBy = typeof meta.paidByName === 'string' ? meta.paidByName : null;
    if (paidBy && paidTo) {
      return `${paidBy} → ${paidTo}`;
    }
    if (paidTo) {
      return `Paid to ${paidTo}`;
    }
    return null;
  }

  return null;
}

export function formatActivityTimestamp(activity: ActivityLike): string {
  return formatDateTime(activity.createdAt);
}

/**
 * One event as a line of Home's latest changes (#309): "{actor} {action} {subject}", such as
 * "Priya Shah edited Wi-Fi", in the words Android's Activity uses. The viewer is "You".
 */
export interface ActivityLineParts {
  actor: string;
  action: string;
  /** The Expense the event is about, by its description; null for any other event. */
  subject: string | null;
}

const words = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function activityLineParts(activity: ActivityLike, viewerId?: string): ActivityLineParts {
  const meta = activity.metadata || {};
  const actor =
    viewerId && activity.actor?._id === viewerId
      ? 'You'
      : (words(activity.actor?.name) ?? 'Someone');
  const expense = words(meta.description) ?? 'an Expense';
  const line = (action: string, subject: string | null = null) => ({ actor, action, subject });

  switch (activity.type) {
    case 'expense_added':
      return line('added', expense);
    case 'expense_updated':
      return line(meta.action === 'restored' ? 'restored' : 'edited', expense);
    case 'expense_deleted':
      return line('deleted', expense);
    case 'settlement_recorded':
      return line('recorded a payment');
    case 'member_joined':
      return line('joined the Group');
    case 'member_left':
      return line(meta.method === 'removed' ? 'removed a member' : 'left the Group');
    case 'group_created':
      return line('created the Group');
    case 'group_updated':
      return line('updated the Group');
    default:
      return line('made a change');
  }
}

/** An event's amount; an edit that changed the amount also has what it was before. */
export interface ActivityAmount {
  before?: string;
  after: string;
}

/** Exact minor units when recorded, otherwise the recorded major amount. */
function recordedMoney(
  value: { amount?: unknown; amountMinor?: unknown },
  currency: string | null,
): string | null {
  if (!currency) return null;
  if (typeof value.amountMinor === 'number') {
    try {
      return formatCurrency(toMajorAmount(value.amountMinor, currency), currency);
    } catch {
      // A currency outside today's list, or an unsafe figure: the major amount follows.
    }
  }
  return typeof value.amount === 'number' && Number.isFinite(value.amount)
    ? formatCurrency(value.amount, currency)
    : null;
}

const RECORDED_AMOUNT = ['expense_added', 'expense_deleted', 'settlement_recorded'];

/**
 * The amount an event records, in its own currency and never converted: an Expense added or
 * deleted, or a payment, and for an Expense edit that changed the amount, the amount before and
 * after ("₹899.00 → ₹999.00"). An edit records only what changed, so `currency` names the
 * Expense's currency when the event doesn't. Any other event, or an edit that left the amount
 * alone, has none.
 */
export function formatActivityAmount(
  activity: ActivityLike,
  currency?: string,
): ActivityAmount | null {
  const meta = activity.metadata || {};
  const recorded = words(meta.currency) ?? words(currency);

  if (RECORDED_AMOUNT.includes(activity.type)) {
    const after = recordedMoney({ amount: meta.amount }, recorded);
    return after ? { after } : null;
  }
  const changes = meta.changes;
  if (activity.type !== 'expense_updated' || !isRecord(changes)) return null;

  const field = (name: string): Record<string, unknown> => {
    const change = changes[name];
    return isRecord(change) ? change : {};
  };
  const after = words(field('currency').new) ?? recorded;
  const before = words(field('currency').old) ?? after;
  const was = recordedMoney(
    { amount: field('amount').old, amountMinor: field('amountMinor').old },
    before,
  );
  const now = recordedMoney(
    { amount: field('amount').new, amountMinor: field('amountMinor').new },
    after,
  );
  return was && now ? { before: was, after: now } : null;
}
