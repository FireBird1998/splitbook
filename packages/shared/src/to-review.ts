import { getCategory } from './categories';
import { GROUP_ARCHIVED_MESSAGE } from './group-archive';
import type { PersistedExpenseDraft } from './validators/expense-draft';
import { formatDate } from './date';
import { toDateParam } from './date';
import { formatCurrency } from './currency';
import { parseAmountMinor, sumMinorAmounts, toMajorAmount } from './exact-money';
import {
  completeExpenseDraftSchema,
  missingDraftFields,
  withGroupCurrency,
  type ExpenseDraftValues,
} from './validators/expense-draft';
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
  /**
   * What the item still needs before it can be saved, in words that follow "Needs": a fact it
   * has no value for ("the date"), or one that is there but wrong ("the split to add up to the
   * total", #506).
   */
  missingFacts: string[];
  /** The facts it has no value for at all, which an assistant may have left to the member. */
  unknownFacts: string[];
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
/** What an item needs when its split, payers or percentages don't add up (#506). */
export const SPLIT_TOTAL_NEED = 'the split to add up to the total';
export const PAID_TOTAL_NEED = 'the amounts paid to add up to the total';
export const PERCENTAGE_TOTAL_NEED = 'the percentages to add up to 100%';
/** Whether an item's missing facts ask for its amount: missing, or with too many decimals. */
export const needsAmount = (missingFacts: readonly string[]) =>
  missingFacts.some(
    (fact) =>
      fact === facts.amount ||
      fact === 'a whole-number amount' ||
      fact.startsWith('an amount with'),
  );
/** What an item in another currency than its Group's needs (#567). */
const GROUP_CURRENCY_NEED = 'the Group currency';
/** A problem the server names by its code, in words that follow "Needs". */
const codeNeeds = new Map([['CURRENCY_MISMATCH', GROUP_CURRENCY_NEED]]);

const DECIMALS = /^Amount supports at most (\d+) decimal places$/;

/**
 * What an item needs when a fact it has is wrong rather than missing (#506): worded to follow
 * "Needs", and as a sentence for the problem on its own. Without it, a split that doesn't add up
 * read as a missing amount, and a member could change the total to match the shares. The field
 * says whose decimals are wrong: the total, the shares or the amounts paid.
 */
function unmetNeed(
  reason: string,
  field = 'amount',
): { need: string; sentence: string } | undefined {
  if (reason === 'Split amounts must add up to the expense amount')
    return { need: SPLIT_TOTAL_NEED, sentence: 'The split must add up to the total.' };
  if (reason === 'Payer amounts must add up to the expense amount')
    return { need: PAID_TOTAL_NEED, sentence: 'The amounts paid must add up to the total.' };
  if (reason === 'Percentages must add up to 100')
    return { need: PERCENTAGE_TOTAL_NEED, sentence: 'The percentages must add up to 100%.' };
  const decimals = reason.match(DECIMALS);
  if (!decimals) return undefined;
  const places = decimals[1] === '0' ? undefined : `at most ${decimals[1]} decimal places`;
  if (field === 'splitBetween')
    return {
      need: places ? `shares with ${places}` : 'whole-number shares',
      sentence: places ? `Each share can have ${places}.` : 'Each share must be a whole number.',
    };
  if (field === 'paidBy')
    return {
      need: places ? `amounts paid with ${places}` : 'whole-number amounts paid',
      sentence: places
        ? `Each amount paid can have ${places}.`
        : 'Each amount paid must be a whole number.',
    };
  return places
    ? { need: `an amount with ${places}`, sentence: `The amount can have ${places}.` }
    : { need: 'a whole-number amount', sentence: 'The amount must be a whole number.' };
}

function accountModel(item: ToReviewItem, groupCurrency?: string): ReviewItemModel {
  const values = withGroupCurrency(item.draft.values, groupCurrency);
  const parsed = completeExpenseDraftSchema.safeParse(values);
  const issues = parsed.success ? [] : parsed.error.issues;
  const missing = missingDraftFields(values, issues, item.draft.missingFields ?? []);
  const unknownFacts = [...new Set(missing.map((field) => facts[field] ?? 'the expense details'))];
  // A fact that is there but wrong reads as what it needs, or as the fact for a reason without
  // member words.
  const needs = issues
    .filter((issue) => !missing.includes(String(issue.path[0] ?? 'expense')))
    .map(
      (issue) =>
        unmetNeed(issue.message, String(issue.path[0]))?.need ??
        facts[String(issue.path[0])] ??
        'the expense details',
    );
  const coded = item.problems.flatMap((problem) => codeNeeds.get(problem) ?? []);
  const missingFacts = [...new Set([...unknownFacts, ...needs, ...coded])];
  // Only a problem nothing can name falls back to the expense details.
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
    unknownFacts,
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
  const items: ReviewItemModel[] = read.groups.flatMap((group) =>
    group.items.map((item) => accountModel(item, group.currency)),
  );
  items.push(
    ...deviceItems.map((item) => ({
      id: item.id,
      groupId: item.groupId,
      createdAt: item.createdAt,
      state: 'on-this-phone' as const,
      missingFacts: [],
      unknownFacts: [],
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
  const currencies = new Map(read.groups.map((group) => [group.groupId, group.currency]));
  for (const item of deviceItems)
    if (!names.has(item.groupId)) names.set(item.groupId, item.groupName);
  const groups = [...names]
    .map(([groupId, groupName]) => {
      const own = items.filter((item) => item.groupId === groupId);
      return {
        groupId,
        groupName,
        currency: currencies.get(groupId),
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
    const values = completeExpenseDraftSchema.parse(
      withGroupCurrency(item.draft.values, currencies.get(item.draft.groupId)),
    );
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

/**
 * Shared member wording for a newer version; callers supply names, never guess identities, and
 * the Group's currency, which an item without its own is in (#512).
 */
export function describeDraftChange(
  before: PersistedExpenseDraft,
  after: PersistedExpenseDraft,
  names: Readonly<Record<string, string>> = {},
  groupCurrency?: string,
): string {
  const prior = withGroupCurrency(before.values, groupCurrency);
  const next = withGroupCurrency(after.values, groupCurrency);
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
    `${reviewSplitMethod(values.splitMethod)} · ${people(values.splitBetween, values.currency)}`;
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
      getCategory(prior.category ?? '')?.label ?? 'not specified',
      getCategory(next.category ?? '')?.label ?? 'not specified',
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
  const latest = "You're seeing the latest version.";
  if (!changed.length) return `${author} changed this item a moment ago. ${latest}`;
  // The design's wording: "Claude changed the amount a moment ago: ₹2,350.00 → ₹2,400.00."
  const changes = changed.map(([field, a, b], index) => {
    const label = a === b ? `the ${field} details` : `the ${field}`;
    const when = index === 0 ? ' a moment ago' : '';
    return a === b ? `${label}${when}` : `${label}${when}: ${a} → ${b}`;
  });
  return `${author} changed ${changes.join('; ')}. ${latest}`;
}

/** Display labels shared by review cards, confirmations and change notes. */
export function reviewSplitMethod(method?: string): string {
  return (
    (
      {
        equal: 'Split equally',
        exact: 'Split by amounts',
        unequal: 'Split by amounts',
        percentage: 'Split by percentage',
        shares: 'Split by shares',
      } as Record<string, string>
    )[method ?? ''] ?? 'Split missing'
  );
}

/** A validation problem's path: its field and, for a member's row, the row and the part of it. */
function problemPath(message: string) {
  const path = message.match(/^(?:Invalid Draft: )?([a-zA-Z]+)(?:\.(\d+)\.([a-zA-Z]+))?: ?/);
  return path
    ? { field: path[1], index: path[2], part: path[3], reason: message.slice(path[0].length) }
    : null;
}

/** Interpret known validation paths; never forward server prose or unknown paths to members. */
export function reviewProblem(
  message: string,
  values: ExpenseDraftValues = {},
  names: Readonly<Record<string, string>> = {},
): string {
  const memberMessages = [
    'This item changed while you were looking. Review the latest version before saving.',
    'The possible matches changed. Check them before saving this expense.',
    'This item needs another look before saving. Check the details and any possible duplicate.',
    'Some items changed or need another look. Review them before saving.',
    'Could not confirm this action. Check your connection and try again.',
    GROUP_ARCHIVED_MESSAGE,
  ];
  if (memberMessages.includes(message)) return message;
  const path = problemPath(message);
  const reason = path?.reason ?? message;
  // A row's decimals are said for that member below.
  const unmet = path?.index === undefined && unmetNeed(reason, path?.field);
  if (unmet) return unmet.sentence;
  const known: Record<string, string> = {
    INVALID_MEMBERS: 'Choose current Group members for who paid and who shared it.',
    INVALID_TAG: 'Choose an available Tag.',
    CURRENCY_MISMATCH: 'Choose the Group currency.',
    STALE_REVISION: 'This item changed. Check the latest version before saving.',
    'Each person can appear only once': 'Choose each member only once.',
  };
  if (Object.hasOwn(known, reason)) return known[reason];
  if (path) {
    const { field, index, part } = path;
    if ((field === 'paidBy' || field === 'splitBetween') && index !== undefined) {
      const row = values[field]?.[Number(index)];
      const name = row ? (names[row.user] ?? 'this member') : 'this member';
      const digits = reason.match(DECIMALS)?.[1];
      const limit =
        digits === '0' ? 'must be a whole number' : `can have at most ${digits} decimal places`;
      if (field === 'paidBy' && part === 'amount')
        return digits ? `The amount paid by ${name} ${limit}.` : `The amount paid by ${name}?`;
      if (field === 'splitBetween' && part === 'amount' && digits)
        return `The amount for ${name} ${limit}.`;
      if (field === 'splitBetween' && ['amount', 'percentage', 'shares'].includes(part))
        return `The ${part} for ${name}?`;
    }
    const fact = facts[field];
    if (fact) return `${fact.charAt(0).toUpperCase()}${fact.slice(1)}?`;
  }
  return 'Check the expense details and try again.';
}

/**
 * An item's problems in member words, once each. A problem about a fact the item already says it
 * needs ("Needs who paid…") is left out, so a missing fact is described once (#435).
 */
export function memberProblems(
  item: ReviewItemModel,
  names: Readonly<Record<string, string>> = {},
  /** The values the member is editing, which name the rows a problem points at (#441). */
  values: ExpenseDraftValues | undefined = item.accountItem?.draft.values,
): string[] {
  if (!item.accountItem) return [];
  const { problems } = item.accountItem;
  const said: string[] = [];
  for (const problem of problems) {
    const path = problemPath(problem);
    if (path && path.index === undefined && item.missingFacts.includes(facts[path.field])) continue;
    // A wrong fact the Needs line already names (#506); a member's row is still named below.
    const unmet = path && path.index === undefined && unmetNeed(path.reason, path.field);
    if (unmet && item.missingFacts.includes(unmet.need)) continue;
    const coded = codeNeeds.get(problem);
    if (coded && item.missingFacts.includes(coded)) continue;
    const words = reviewProblem(problem, values, names);
    if (!said.includes(words)) said.push(words);
  }
  return said;
}
