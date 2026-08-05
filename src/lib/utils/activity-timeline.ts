import { formatCurrency } from '@/lib/utils/currency';
import { formatDate, formatDateTime } from '@/lib/utils/date';

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
      return `${actorName} added “${meta.description ?? 'an expense'}”`;
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
      return `${actorName} left the group`;
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
