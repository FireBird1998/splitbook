import { formatCurrency } from '@splitbook/shared/currency';
import type { ActivityEvent } from '../data/activity';
import { describeExpenseChanges, memberNamer } from '../data/expense-history';

/** One Activity row in plain language: "{actor} {verb} {subject}" and its details. */
export interface ActivityLine {
  actor: string;
  verb: string;
  subject: string | null;
  /** Short details shown under the headline, e.g. the amount or what an edit changed. */
  details: ActivityDetail[];
  /** Every change an edit made, for the event's detail view. */
  changes: string[];
}

/** A standalone amount is `mono`, so it can use the money font. */
export interface ActivityDetail {
  text: string;
  mono?: boolean;
}

export interface ActivityDay {
  key: string;
  label: string;
  events: ActivityEvent[];
}

const localDayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** "Today", "Yesterday", or a short weekday and date such as "Sun 27 Sep". */
export function dayLabel(date: Date, now: number) {
  const today = new Date(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (localDayKey(date) === localDayKey(today)) return 'Today';
  if (localDayKey(date) === localDayKey(yesterday)) return 'Yesterday';
  return date.toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** Events keep the server's newest-first order, grouped under their local day. */
export function activityDays(events: ActivityEvent[], now: number): ActivityDay[] {
  const days: ActivityDay[] = [];
  for (const event of events) {
    const date = new Date(event.createdAt);
    const key = localDayKey(date);
    const last = days[days.length - 1];
    if (last?.key === key) last.events.push(event);
    else days.push({ key, label: dayLabel(date, now), events: [event] });
  }
  return days;
}

export const clockTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

function money(value: unknown, currency: string) {
  return typeof value === 'number' && Number.isFinite(value)
    ? formatCurrency(value, currency)
    : null;
}

/**
 * What an Expense edit changed, one line per change: "Amount ₹899.00 → ₹999.00", or
 * "Sam Chen’s share ₹300.00 → ₹350.00". Uses the same wording as the Expense's history.
 */
export function describeChanges(
  changes: Record<string, { old?: unknown; new?: unknown }> | undefined,
  { currency, members = [] }: { currency: string; members?: { id: string; name: string }[] },
): string[] {
  if (!changes) return [];
  const after = text(changes.currency?.new) ?? currency;
  return describeExpenseChanges(changes, {
    currencies: { before: text(changes.currency?.old) ?? after, after },
    person: memberNamer(new Map(members.map((member) => [member.id, member.name]))),
  }).map(({ label, before, after: now }) =>
    before !== undefined && now !== undefined
      ? `${label} ${before} → ${now}`
      : now !== undefined
        ? `${label} ${now}`
        : `${label} changed`,
  );
}

/** One event as the member reads it; the signed-in member is "You". */
export function describeActivity(
  event: ActivityEvent,
  {
    currentUserId,
    currency,
    members = [],
  }: { currentUserId: string; currency: string; members?: { id: string; name: string }[] },
): ActivityLine {
  const meta = event.metadata;
  const actor =
    event.actor?._id === currentUserId ? 'You' : text(event.actor?.name) || 'Former member';
  const subject = text(meta.description);
  const formatted = money(meta.amount, meta.currency ?? currency);
  const amount = formatted ? { text: formatted, mono: true } : null;
  const line = (
    verb: string,
    subjectText: string | null,
    details: (ActivityDetail | string | null)[],
  ): ActivityLine => ({
    actor,
    verb,
    subject: subjectText,
    details: details.flatMap((detail) =>
      detail === null ? [] : typeof detail === 'string' ? [{ text: detail }] : [detail],
    ),
    changes: [],
  });
  switch (event.type) {
    case 'expense_added':
      return line('added', subject ?? 'an Expense', [
        meta.recurring === true ? 'Recurring' : null,
        amount,
      ]);
    case 'expense_deleted':
      return line('deleted', subject ?? 'an Expense', [amount]);
    case 'expense_updated': {
      if (meta.action === 'restored') return line('restored', subject ?? 'an Expense', [amount]);
      const changes = describeChanges(meta.changes, {
        currency: meta.currency ?? currency,
        members,
      });
      const shown = changes.slice(0, 1);
      if (changes.length > 1) shown.push(`${changes.length - 1} more`);
      return { ...line('edited', subject ?? 'an Expense', shown), changes };
    }
    case 'settlement_recorded':
      return line('recorded a payment', null, [
        text(meta.paidByName) && text(meta.paidToName)
          ? `${text(meta.paidByName)} → ${text(meta.paidToName)}`
          : text(meta.paidToName)
            ? `To ${text(meta.paidToName)}`
            : null,
        amount,
      ]);
    case 'member_joined':
      return line('joined the Group', null, []);
    case 'member_left':
      return meta.method === 'removed'
        ? line('removed a member', null, [])
        : line('left the Group', null, []);
    case 'group_created':
      return line('created the Group', null, []);
    case 'group_updated':
      return line('updated the Group details', null, []);
    default:
      return line('changed the Group', null, []);
  }
}

/** The whole row as one sentence for screen readers. */
export function spokenActivity(line: ActivityLine, time: string) {
  const headline = [line.actor, line.verb, line.subject].filter(Boolean).join(' ');
  return [headline, ...line.details.map((detail) => detail.text), time].join(', ');
}
