import type { PersistedExpenseDraft } from './validators/expense-draft';
import { formatDate } from './date';
import { toDateParam } from './date';
import { formatCurrency } from './currency';
import { parseAmountMinor, sumMinorAmounts, toMajorAmount } from './exact-money';
import { completeExpenseDraftSchema, type ExpenseDraftValues } from './validators/expense-draft';
import type { ToReviewItem, ToReviewRead } from './to-review-read';

export type ToReviewState = 'ready' | 'duplicate' | 'needs-details' | 'on-this-phone';
/** Device recovery stays plain data; this model never uploads it or selects it for saving. */
export interface DeviceToReviewItem {
  id: string;
  groupId: string;
  groupName: string;
  createdAt: string;
  values: ExpenseDraftValues;
}
export interface ReviewItemModel {
  id: string;
  groupId: string;
  createdAt: string;
  state: ToReviewState;
  missingFacts: string[];
  label: string;
  accountItem?: ToReviewItem;
  deviceItem?: DeviceToReviewItem;
}
const facts: Record<string, string> = {
  description: 'what it was for',
  amount: 'the amount',
  currency: 'the currency',
  category: 'the category',
  date: 'the date',
  paidBy: 'who paid',
  splitMethod: 'how to split it',
  splitBetween: 'who shared it',
  tagId: 'the tag',
  tag: 'the tag',
};
const labels: Record<ToReviewState, string> = {
  ready: 'Ready',
  duplicate: 'Check before saving',
  'needs-details': 'Needs details',
  'on-this-phone': 'On this phone',
};
function accountModel(item: ToReviewItem): ReviewItemModel {
  const parsed = completeExpenseDraftSchema.safeParse(item.draft.values);
  const fields = [
    ...(item.draft.missingFields ?? []),
    ...(parsed.success ? [] : parsed.error.issues.map((issue) => String(issue.path[0] ?? ''))),
  ];
  const missingFacts = [...new Set(fields.map((field) => facts[field] ?? 'the expense details'))];
  if (item.problems.length && !missingFacts.length) missingFacts.push('the expense details');
  const state = missingFacts.length
    ? 'needs-details'
    : item.duplicates.length
      ? 'duplicate'
      : 'ready';
  return {
    id: item.draft.id,
    groupId: item.draft.groupId,
    createdAt: item.draft.createdAt,
    state,
    missingFacts,
    label: missingFacts.length ? `Needs ${missingFacts.join(', ')}` : labels[state],
    accountItem: item,
  };
}
export function toReviewSourceSummary(items: readonly ReviewItemModel[], now?: Date): string {
  const sources = new Map<string, { total: number; today: number }>();
  for (const item of items) {
    const by = item.accountItem?.draft.preparedBy;
    if (by?.kind !== 'assistant') continue;
    const source = sources.get(by.name) ?? { total: 0, today: 0 };
    source.total++;
    if (now && toDateParam(new Date(item.createdAt)) === toDateParam(now)) source.today++;
    sources.set(by.name, source);
  }
  const parts = [...sources]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([name, count]) =>
        `${count.total} from ${name}${now && count.today === count.total ? ' today' : ''}`,
    );
  const needs = items.filter((item) => item.state === 'needs-details').length;
  if (needs) parts.push(`${needs} needs details`);
  return parts.join(' · ');
}
function counts(items: readonly ReviewItemModel[]) {
  return {
    total: items.length,
    ready: items.filter((item) => item.state === 'ready').length,
    duplicate: items.filter((item) => item.state === 'duplicate').length,
    needsDetails: items.filter((item) => item.state === 'needs-details').length,
    onThisPhone: items.filter((item) => item.state === 'on-this-phone').length,
  };
}
const order: Record<ToReviewState, number> = {
  ready: 0,
  duplicate: 1,
  'needs-details': 2,
  'on-this-phone': 3,
};
export function buildToReview(
  read: ToReviewRead,
  deviceItems: readonly DeviceToReviewItem[],
  now: Date,
) {
  const items: ReviewItemModel[] = read.groups.flatMap((group) => group.items.map(accountModel));
  items.push(
    ...deviceItems.map((item) => ({
      id: item.id,
      groupId: item.groupId,
      createdAt: item.createdAt,
      state: 'on-this-phone' as const,
      missingFacts: [],
      label: labels['on-this-phone'],
      deviceItem: item,
    })),
  );
  items.sort(
    (a, b) =>
      order[a.state] - order[b.state] ||
      Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
  const names = new Map(read.groups.map((group) => [group.groupId, group.groupName]));
  for (const item of deviceItems)
    if (!names.has(item.groupId)) names.set(item.groupId, item.groupName);
  const groups = [...names]
    .map(([groupId, groupName]) => {
      const own = items.filter((item) => item.groupId === groupId);
      return {
        groupId,
        groupName,
        items: own,
        counts: counts(own),
        sourceSummary: toReviewSourceSummary(own),
        bannerSummary: toReviewSourceSummary(own, now),
      };
    })
    .filter((group) => group.counts.total > 0);
  const ready = items.flatMap((item) =>
    item.state === 'ready' && item.accountItem ? [item.accountItem] : [],
  );
  const amounts = new Map<string, number[]>();
  for (const item of ready) {
    const values = completeExpenseDraftSchema.parse(item.draft.values);
    const list = amounts.get(values.currency) ?? [];
    list.push(parseAmountMinor(values.amount, values.currency));
    amounts.set(values.currency, list);
  }
  const totals = [...amounts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amounts]) => {
      const amountMinor = sumMinorAmounts(amounts);
      return {
        currency,
        amountMinor,
        formatted: formatCurrency(toMajorAmount(amountMinor, currency), currency),
      };
    });
  return {
    items,
    groups,
    counts: counts(items),
    sourceSummary: toReviewSourceSummary(items),
    ready: { items: ready, count: ready.length, label: `Save ${ready.length} ready`, totals },
  };
}

/** Each final outcome occurs once per run item; uncertain/failed saves remain for later. */
export type ReviewRunOutcome = {
  id: string;
  status: 'saved' | 'deleted' | 'skipped' | 'failed' | 'unresolved';
};
export function summarizeReviewRun(outcomes: readonly ReviewRunOutcome[]) {
  const saved = outcomes.filter((item) => item.status === 'saved').length;
  const deleted = outcomes.filter((item) => item.status === 'deleted').length;
  const left = outcomes.length - saved - deleted;
  const parts = [
    saved ? `Saved ${saved}` : '',
    deleted ? `Deleted ${deleted}` : '',
    left ? `${left} left for later` : '',
  ].filter(Boolean);
  return { saved, deleted, left, label: parts.join(' · ') };
}

/** A date-only Expense fact is a calendar day, not a UTC instant. */
export function reviewDate(date?: string): string {
  return date ? formatDate(`${date}T12:00:00`) : 'Date missing';
}

/** Shared member wording for a newer version; callers supply names, never guess identities. */
export function describeDraftChange(
  before: PersistedExpenseDraft,
  after: PersistedExpenseDraft,
  names: Readonly<Record<string, string>> = {},
): string {
  const prior = before.values ?? {};
  const next = after.values ?? {};
  const currency = (values: ExpenseDraftValues) =>
    values.amount === undefined || !values.currency
      ? 'not specified'
      : formatCurrency(values.amount, values.currency);
  const people = (
    rows: ExpenseDraftValues['paidBy'] | ExpenseDraftValues['splitBetween'],
    money: string | undefined,
  ) =>
    rows
      ?.map((row) => {
        const part =
          row.amount !== undefined && money
            ? formatCurrency(row.amount, money)
            : 'percentage' in row
              ? `${row.percentage}%`
              : 'shares' in row
                ? `${row.shares} shares`
                : '';
        return [names[row.user] ?? 'a member', part].filter(Boolean).join(' ');
      })
      .join(', ') || 'not specified';
  const split = (values: ExpenseDraftValues) =>
    `${values.splitMethod ?? 'not specified'} · ${people(values.splitBetween, values.currency)}`;
  const fields = [
    [
      'amount',
      currency(prior),
      currency(next),
      [prior.amount, prior.currency],
      [next.amount, next.currency],
    ],
    ['date', reviewDate(prior.date), reviewDate(next.date), prior.date, next.date],
    [
      'payer',
      people(prior.paidBy, prior.currency),
      people(next.paidBy, next.currency),
      prior.paidBy,
      next.paidBy,
    ],
    [
      'split',
      split(prior),
      split(next),
      [prior.splitMethod, prior.splitBetween],
      [next.splitMethod, next.splitBetween],
    ],
    [
      'description',
      prior.description ?? 'not specified',
      next.description ?? 'not specified',
      prior.description,
      next.description,
    ],
    [
      'category',
      prior.category ?? 'not specified',
      next.category ?? 'not specified',
      prior.category,
      next.category,
    ],
    [
      'Tag',
      prior.tag ?? names[prior.tagId ?? ''] ?? 'not specified',
      next.tag ?? names[next.tagId ?? ''] ?? 'not specified',
      [prior.tagId, prior.tag],
      [next.tagId, next.tag],
    ],
    ['notes', prior.notes || 'empty', next.notes || 'empty', prior.notes, next.notes],
  ] as const;
  const changed = fields.filter(([, , , a, b]) => JSON.stringify(a) !== JSON.stringify(b));
  const author =
    after.changedBy.kind === 'assistant' ? after.changedBy.name : 'You on another device';
  if (!changed.length)
    return `${author} changed this item a moment ago. You are looking at the latest version.`;
  const changes = changed.map(([field, a, b]) =>
    a === b ? `the ${field} details` : `the ${field}: ${a} → ${b}`,
  );
  return `${author} changed ${changes.join('; ')} a moment ago.`;
}
