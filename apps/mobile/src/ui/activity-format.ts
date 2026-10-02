import { formatCurrency, getCurrency } from '@splitbook/shared/currency';
import { GROUP_THEME_LIST } from '@splitbook/shared/group-themes';
import type { ActivityEvent } from '../data/activity';
import {
  describeExpenseChanges,
  memberNamer,
  type ExpenseHistoryChange,
} from '../data/expense-history';

/** One Activity row in plain language: "{actor} {verb} {subject} {complement}" and its details. */
export interface ActivityLine {
  actor: string;
  verb: string;
  subject: string | null;
  /** Words after the subject, such as "an admin" in "made Priya Shah an admin". */
  complement?: string;
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

const changeLine = ({ label, before, after }: ExpenseHistoryChange) =>
  before !== undefined && after !== undefined
    ? `${label} ${before} → ${after}`
    : after !== undefined
      ? `${label} ${after}`
      : `${label} changed`;

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
  }).map(changeLine);
}

/** One change a Group edit made, from the headline it leads to its line under "What changed". */
interface GroupChange {
  /** The row's headline when this is the edit's first change. */
  headline: Pick<ActivityLine, 'verb' | 'subject' | 'complement'>;
  /** The row's short form of the change, when the headline doesn't say it all. */
  summary: string | null;
  line: ExpenseHistoryChange;
}

const quoted = (value: unknown) => (text(value) ? `“${text(value)}”` : 'None');
const currencies = (value: unknown) =>
  (Array.isArray(value) ? value : [value])
    .filter((code): code is string => typeof code === 'string' && !!getCurrency(code))
    .join(', ') || 'None';
/** A Group's dates are calendar days stored at UTC midnight. */
function calendarDay(value: unknown) {
  const date = new Date(typeof value === 'string' ? value : Number.NaN);
  return Number.isNaN(date.getTime())
    ? 'None'
    : date.toLocaleDateString('en', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      });
}
const groupFields = new Map<
  string,
  { label: string; verb: string; value: (value: unknown) => string }
>([
  ['name', { label: 'Name', verb: 'renamed the Group', value: quoted }],
  ['description', { label: 'Description', verb: 'changed the description', value: quoted }],
  [
    'category',
    {
      label: 'Theme',
      verb: 'changed the Theme',
      value: (value) => GROUP_THEME_LIST.find((theme) => theme.id === value)?.label ?? 'Unknown',
    },
  ],
  ['defaultCurrency', { label: 'Currency', verb: 'changed the currency', value: currencies }],
  [
    'alternateCurrencies',
    { label: 'Other currencies', verb: 'changed the other currencies', value: currencies },
  ],
  ['startDate', { label: 'Start date', verb: 'changed the dates', value: calendarDay }],
  ['endDate', { label: 'End date', verb: 'changed the dates', value: calendarDay }],
]);
const roles = new Map([
  ['admin', 'Group admin'],
  ['member', 'Member'],
]);
const roleName = (value: unknown) => (typeof value === 'string' && roles.get(value)) || 'Unknown';
const fields = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

function groupChange(
  field: string,
  change: { old?: unknown; new?: unknown },
  {
    names,
    currentUserId,
    actorId,
  }: { names: Map<string, string>; currentUserId: string; actorId?: string },
): GroupChange | null {
  if (field === 'memberRole') {
    const was = fields(change.old);
    const now = fields(change.new);
    const target = now.userId ?? was.userId;
    const userId = typeof target === 'string' ? target : '';
    const you = userId === currentUserId;
    const name = names.get(userId);
    const complement =
      now.role === 'admin' ? 'an admin' : now.role === 'member' ? 'a member' : undefined;
    const subject =
      userId === actorId
        ? you
          ? 'yourself'
          : 'themselves'
        : you
          ? 'you'
          : (name ?? 'a former member');
    return {
      headline: complement
        ? { verb: 'made', subject, complement }
        : { verb: 'changed a member’s role', subject: null },
      summary: 'Member role',
      line: {
        label: you ? 'Your role' : `${name ?? 'Former member'}’s role`,
        before: roleName(was.role),
        after: roleName(now.role),
      },
    };
  }
  if (field === 'isArchived' && typeof change.new === 'boolean')
    return {
      headline: { verb: change.new ? 'archived the Group' : 'unarchived the Group', subject: null },
      summary: null,
      line: {
        label: 'Status',
        before: change.new ? 'Active' : 'Archived',
        after: change.new ? 'Archived' : 'Active',
      },
    };
  const known = groupFields.get(field);
  if (!known) return null;
  const before = known.value(change.old);
  const after = known.value(change.new);
  return {
    headline: { verb: known.verb, subject: null },
    summary: `${before} → ${after}`,
    line: { label: known.label, before, after },
  };
}

/**
 * What a Group edit changed, in the order it was recorded: a member's role, the name, currency,
 * dates or Theme, or archiving. Anything else is one "Other details", last.
 */
function describeGroupChanges(
  changes: Record<string, { old?: unknown; new?: unknown }>,
  {
    members,
    ...context
  }: { members: { id: string; name: string }[]; currentUserId: string; actorId?: string },
): GroupChange[] {
  const names = new Map(members.map((member) => [member.id, member.name]));
  const described = Object.entries(changes).map(([field, change]) =>
    groupChange(field, change, { ...context, names }),
  );
  const known = described.filter((change) => change !== null);
  return known.length < described.length
    ? [
        ...known,
        {
          headline: { verb: 'updated the Group details', subject: null },
          summary: null,
          line: { label: 'Other details' },
        },
      ]
    : known;
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
    case 'group_updated': {
      const changes = describeGroupChanges(meta.changes ?? {}, {
        members,
        currentUserId,
        actorId: event.actor?._id,
      });
      const [first] = changes;
      if (!first) return line('updated the Group details', null, []);
      return {
        ...line(first.headline.verb, first.headline.subject, [
          first.summary,
          changes.length > 1 ? `${changes.length - 1} more` : null,
        ]),
        complement: first.headline.complement,
        changes: changes.map((change) => changeLine(change.line)),
      };
    }
    default:
      return line('changed the Group', null, []);
  }
}

/** The whole row as one sentence for screen readers. */
export function spokenActivity(line: ActivityLine, time: string) {
  const headline = [line.actor, line.verb, line.subject, line.complement].filter(Boolean).join(' ');
  return [headline, ...line.details.map((detail) => detail.text), time].join(', ');
}
