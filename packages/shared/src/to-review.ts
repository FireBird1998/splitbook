import { getCategory } from './categories';
import type { GroupCategory } from './types';
import { groupNounTitle } from './group-themes';
import { GROUP_ARCHIVED_MESSAGE } from './group-archive';
import type { PersistedExpenseDraft } from './validators/expense-draft';
import { formatDate } from './date';
import { expenseLocalDate } from './expense-day';
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
  theme?: GroupCategory;
  /** Meaning retained before member wording is rendered. Member rows keep their source path. */
  needs: ReviewNeed[];
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
export interface ReviewNeed {
  field: string;
  reason:
    | 'missing'
    | 'invalid'
    | 'decimals'
    | 'split-total'
    | 'payer-total'
    | 'percentage-total'
    | 'group-currency'
    | 'unknown';
  index?: number;
  part?: string;
  precision?: number;
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
/** Whether an item's missing facts ask for its amount: missing, or with too many decimals. */
export const needsAmount = (needs: readonly ReviewNeed[]) =>
  needs.some((need) => need.field === 'amount');

/** Display wording for a need; behavior consumes the meaning directly. */
export function reviewNeedWords(need: ReviewNeed, category?: GroupCategory): string {
  if (need.reason === 'split-total') return 'the split to add up to the total';
  if (need.reason === 'payer-total') return 'the amounts paid to add up to the total';
  if (need.reason === 'percentage-total') return 'the percentages to add up to 100%';
  if (need.reason === 'group-currency') return groupCurrencyNeed(category);
  if (need.reason === 'decimals') {
    const places = need.precision === 0 ? undefined : `at most ${need.precision} decimal places`;
    if (need.field === 'splitBetween')
      return places ? `shares with ${places}` : 'whole-number shares';
    if (need.field === 'paidBy')
      return places ? `amounts paid with ${places}` : 'whole-number amounts paid';
    return places ? `an amount with ${places}` : 'a whole-number amount';
  }
  return facts[need.field] ?? 'the expense details';
}

/** Known legacy validation reasons are interpreted here, before any display wording exists. */
function validationNeed(reason: string, path: readonly PropertyKey[]): ReviewNeed {
  const field = String(path[0] ?? 'expense');
  if (reason === 'Split amounts must add up to the expense amount')
    return { field: 'splitBetween', reason: 'split-total' };
  if (reason === 'Payer amounts must add up to the expense amount')
    return { field: 'paidBy', reason: 'payer-total' };
  if (reason === 'Percentages must add up to 100')
    return { field: 'splitBetween', reason: 'percentage-total' };
  const precision = reason.match(DECIMALS)?.[1];
  return {
    field,
    reason: precision === undefined ? 'invalid' : 'decimals',
    ...(precision === undefined ? {} : { precision: Number(precision) }),
    ...(typeof path[1] === 'number' ? { index: path[1], part: String(path[2]) } : {}),
  };
}
/** What an item in another currency than its Group's needs (#567). */
function groupCurrencyNeed(category?: GroupCategory) {
  // Named as Add expense names it: the Trip currency, the Household currency (#596).
  return `the ${groupNounTitle(category)} currency`;
}
const DECIMALS = /^Amount supports at most (\d+) decimal places$/;

/** A sentence for a known invalid fact, from the same interpretation as the Needs line. */
function needSentence(need: ReviewNeed): string {
  if (need.reason === 'split-total') return 'The split must add up to the total.';
  if (need.reason === 'payer-total') return 'The amounts paid must add up to the total.';
  if (need.reason === 'percentage-total') return 'The percentages must add up to 100%.';
  const places = need.precision === 0 ? undefined : `at most ${need.precision} decimal places`;
  if (need.field === 'splitBetween')
    return places ? `Each share can have ${places}.` : 'Each share must be a whole number.';
  if (need.field === 'paidBy')
    return places
      ? `Each amount paid can have ${places}.`
      : 'Each amount paid must be a whole number.';
  return places ? `The amount can have ${places}.` : 'The amount must be a whole number.';
}

function accountModel(
  item: ToReviewItem,
  groupCurrency?: string,
  category?: GroupCategory,
): ReviewItemModel {
  const values = withGroupCurrency(item.draft.values, groupCurrency);
  const parsed = completeExpenseDraftSchema.safeParse(values);
  const issues = parsed.success ? [] : parsed.error.issues;
  const missing = missingDraftFields(values, issues, item.draft.missingFields ?? []);
  const needs: ReviewNeed[] = missing.map((field) => ({ field, reason: 'missing' }));
  // A fact that is there but wrong reads as what it needs, or as the fact for a reason without
  // member words.
  needs.push(
    ...issues
      .filter((issue) => !missing.includes(String(issue.path[0] ?? 'expense')))
      .map((issue) => validationNeed(issue.message, issue.path)),
  );
  if (item.problems.includes('CURRENCY_MISMATCH'))
    needs.push({ field: 'currency', reason: 'group-currency' });
  // Only a problem nothing can name falls back to the expense details.
  if (item.problems.length && !needs.length) needs.push({ field: 'expense', reason: 'unknown' });
  const words = (rows: readonly ReviewNeed[]) => [
    ...new Set(rows.map((need) => reviewNeedWords(need, category))),
  ];
  const state = needs.length ? 'needs-details' : item.duplicates.length ? 'duplicate' : 'ready';
  return {
    id: item.draft.id,
    groupId: item.draft.groupId,
    createdAt: item.draft.createdAt,
    state,
    theme: category,
    needs,
    get missingFacts() {
      return words(needs);
    },
    get unknownFacts() {
      return words(needs.filter((need) => need.reason === 'missing'));
    },
    get label() {
      return needs.length ? `Needs ${words(needs).join(', ')}` : labels[state];
    },
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
    group.items.map((item) => accountModel(item, group.currency, group.category)),
  );
  items.push(
    ...deviceItems.map((item) => ({
      id: item.id,
      groupId: item.groupId,
      createdAt: item.createdAt,
      state: 'on-this-phone' as const,
      needs: [],
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
  const categories = new Map(read.groups.map((group) => [group.groupId, group.category]));
  for (const item of deviceItems)
    if (!names.has(item.groupId)) names.set(item.groupId, item.groupName);
  const groups = [...names]
    .map(([groupId, groupName]) => {
      const own = items.filter((item) => item.groupId === groupId);
      return {
        groupId,
        groupName,
        currency: currencies.get(groupId),
        ...(categories.get(groupId) ? { category: categories.get(groupId) } : {}),
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
  return date ? formatDate(expenseLocalDate(date)) : 'Date missing';
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
  const latest = 'You’re seeing the latest version.';
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

const memberMessages = [
  'This item changed while you were looking. Review the latest version before saving.',
  'The possible matches changed. Check them before saving this expense.',
  'This item needs another look before saving. Check the details and any possible duplicate.',
  'Some items changed or need another look. Review them before saving.',
  'Could not confirm this action. Check your connection and try again.',
  GROUP_ARCHIVED_MESSAGE,
];
const problemCodes = {
  INVALID_MEMBERS: 'Choose current Group members for who paid and who shared it.',
  INVALID_TAG: 'Choose an available Tag.',
  CURRENCY_MISMATCH: 'Choose the Group currency.',
  STALE_REVISION: 'This item changed. Check the latest version before saving.',
  'Each person can appear only once': 'Choose each member only once.',
};

type ReviewExplanation =
  | { kind: 'message'; message: string }
  | { kind: 'code'; code: keyof typeof problemCodes }
  | { kind: 'need'; need: ReviewNeed }
  | { kind: 'fact'; field: string }
  | {
      kind: 'row';
      field: 'paidBy' | 'splitBetween';
      index: number;
      part: string;
      precision?: number;
    }
  | { kind: 'unknown' };

/** Tag name and identity describe the same required fact. */
const factField = (field: string) => (field === 'tagId' ? 'tag' : field);

/**
 * The legacy-server compatibility seam: interpret incoming text once, then keep meaning for
 * both rendering and coverage. Member-row explanations always survive a broader field need.
 */
function readReviewProblem(message: string): {
  explanation: ReviewExplanation;
  coveredBy: ReviewNeed[];
} {
  const coveredBy: ReviewNeed[] = [];
  if (memberMessages.includes(message))
    return { explanation: { kind: 'message', message }, coveredBy };
  const path = problemPath(message);
  const reason = path?.reason ?? message;
  if (path && path.index === undefined && Object.hasOwn(facts, path.field)) {
    coveredBy.push(
      { field: path.field, reason: 'missing' },
      { field: path.field, reason: 'invalid' },
    );
  }
  const need = validationNeed(reason, [path?.field ?? 'amount']);
  // Legacy decimal reasons outside payer/share fields have always named the Expense amount.
  if (need.reason === 'decimals' && need.field !== 'paidBy' && need.field !== 'splitBetween')
    need.field = 'amount';
  if (path?.index === undefined && need.reason !== 'invalid') {
    if (path) coveredBy.push(need);
    return { explanation: { kind: 'need', need }, coveredBy };
  }
  if (Object.hasOwn(problemCodes, reason)) {
    if (message === 'CURRENCY_MISMATCH')
      coveredBy.push({ field: 'currency', reason: 'group-currency' });
    return { explanation: { kind: 'code', code: reason as keyof typeof problemCodes }, coveredBy };
  }
  if (path) {
    const { field, index, part } = path;
    if ((field === 'paidBy' || field === 'splitBetween') && index !== undefined) {
      if (
        (field === 'paidBy' && part === 'amount') ||
        (field === 'splitBetween' && ['amount', 'percentage', 'shares'].includes(part))
      ) {
        return {
          explanation: {
            kind: 'row',
            field,
            index: Number(index),
            part,
            ...(part === 'amount' && need.reason === 'decimals'
              ? { precision: need.precision }
              : {}),
          },
          coveredBy,
        };
      }
    }
    if (Object.hasOwn(facts, field)) return { explanation: { kind: 'fact', field }, coveredBy };
  }
  return { explanation: { kind: 'unknown' }, coveredBy };
}

function rowName(
  explanation: Extract<ReviewExplanation, { kind: 'row' }>,
  values: ExpenseDraftValues,
  names: Readonly<Record<string, string>>,
) {
  const row = values[explanation.field]?.[explanation.index];
  return row ? (names[row.user] ?? 'this member') : 'this member';
}

function explanationWords(
  explanation: ReviewExplanation,
  values: ExpenseDraftValues,
  names: Readonly<Record<string, string>>,
): string {
  switch (explanation.kind) {
    case 'message':
      return explanation.message;
    case 'code':
      return problemCodes[explanation.code];
    case 'need':
      return needSentence(explanation.need);
    case 'fact': {
      const fact = facts[explanation.field];
      return `${fact.charAt(0).toUpperCase()}${fact.slice(1)}?`;
    }
    case 'row': {
      const name = rowName(explanation, values, names);
      const subject =
        explanation.field === 'paidBy'
          ? `amount paid by ${name}`
          : `${explanation.part} for ${name}`;
      if (explanation.precision !== undefined) {
        const limit =
          explanation.precision === 0
            ? 'must be a whole number'
            : `can have at most ${explanation.precision} decimal places`;
        return `The ${subject} ${limit}.`;
      }
      return `The ${subject}?`;
    }
    case 'unknown':
      return 'Check the expense details and try again.';
  }
}

/** Same explanation, before rendering. Member names are current domain facts, not parsed prose. */
function explanationIdentity(
  explanation: ReviewExplanation,
  values: ExpenseDraftValues,
  names: Readonly<Record<string, string>>,
): string {
  switch (explanation.kind) {
    case 'message':
      return JSON.stringify(['message', explanation.message]);
    case 'code':
      return JSON.stringify(['code', explanation.code]);
    case 'need': {
      const { field, reason, precision } = explanation.need;
      const subject = field === 'paidBy' || field === 'splitBetween' ? field : 'amount';
      return JSON.stringify(['need', subject, reason, precision]);
    }
    case 'fact':
      return JSON.stringify(['fact', factField(explanation.field)]);
    case 'row':
      return JSON.stringify([
        'row',
        explanation.field,
        explanation.part,
        explanation.precision,
        rowName(explanation, values, names),
      ]);
    case 'unknown':
      return 'unknown';
  }
}

/** Interpret known validation paths; never forward server prose or unknown paths to members. */
export function reviewProblem(
  message: string,
  values: ExpenseDraftValues = {},
  names: Readonly<Record<string, string>> = {},
): string {
  return explanationWords(readReviewProblem(message).explanation, values, names);
}

/** An item's additional explanations, once each, after needs already represented are removed. */
export function memberProblems(
  item: ReviewItemModel,
  names: Readonly<Record<string, string>> = {},
  /** Current edits determine the person named by a member-row problem. */
  values: ExpenseDraftValues = item.accountItem?.draft.values ?? {},
): string[] {
  if (!item.accountItem) return [];
  const said = new Set<string>();
  const words: string[] = [];
  for (const message of item.accountItem.problems) {
    const { explanation, coveredBy } = readReviewProblem(message);
    if (
      coveredBy.some((covered) =>
        item.needs.some(
          (need) =>
            factField(need.field) === factField(covered.field) &&
            need.reason === covered.reason &&
            need.precision === covered.precision,
        ),
      )
    )
      continue;
    const identity = explanationIdentity(explanation, values, names);
    if (said.has(identity)) continue;
    said.add(identity);
    words.push(explanationWords(explanation, values, names));
  }
  return words;
}
