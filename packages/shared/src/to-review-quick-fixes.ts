import { getCategory } from './categories';
import { reviewNeedWords, reviewSplitMethod, type ReviewItemModel } from './to-review';
import type { ExpenseDraftValues } from './validators/expense-draft';

/** Who is looking, and the Group's current members and active Tags. */
export interface QuickFixContext {
  viewerId: string;
  members: ReadonlyArray<{ id: string; name: string }>;
  tags: ReadonlyArray<{ id: string; name: string }>;
}
export type QuickFixFact = 'paidBy' | 'tag';
export interface QuickFixOption {
  id: string;
  label: string;
  suggested: boolean;
}
export interface QuickFix {
  fact: QuickFixFact;
  question: string;
  /** Every option, the suggested one first. */
  options: QuickFixOption[];
  /** At most four, shown on the row; the rest are behind More… */
  visible: QuickFixOption[];
  hasMore: boolean;
}
export interface ItemQuickFixes {
  fixes: QuickFix[];
  /** Missing facts the chips don't cover, in the shared member wording. */
  stillNeeds: string[];
  /** What saving a Ready item records, e.g. "You paid · Split equally · Food". */
  summary: string | null;
}

const VISIBLE = 4;

function categoryLabel(values: ExpenseDraftValues) {
  return getCategory(values.category ?? 'other')?.label ?? 'Other';
}
/** A Tag "matches" a Category when it names it, or names its first word (Food ↔ Food & Drink). */
function matches(tagName: string, label: string) {
  const name = tagName.trim().toLowerCase();
  const category = label.toLowerCase();
  return !!name && (category === name || category.startsWith(`${name} `));
}
function fix(fact: QuickFixFact, question: string, options: QuickFixOption[]): QuickFix {
  return {
    fact,
    question,
    options,
    visible: options.slice(0, VISIBLE),
    hasMore: options.length > VISIBLE,
  };
}

/** One-tap fixes, what's left and the Ready summary for a To review row. Suggests, never chooses. */
export function toReviewQuickFixes(
  item: ReviewItemModel,
  context: QuickFixContext,
): ItemQuickFixes {
  const values = item.accountItem?.draft.values ?? {};
  const fixes: QuickFix[] = [];
  if (item.state === 'needs-details' && item.accountItem) {
    // Several payers missing an amount need typing, so only an item with no payer at all gets chips.
    if (!values.paidBy?.length) {
      const viewer = context.members.filter((member) => member.id === context.viewerId);
      const others = context.members.filter((member) => member.id !== context.viewerId);
      fixes.push(
        fix('paidBy', 'Who paid?', [
          ...viewer.map((member) => ({ id: member.id, label: 'You', suggested: true })),
          ...others.map((member) => ({ id: member.id, label: member.name, suggested: false })),
        ]),
      );
    }
    if (!values.tagId && !values.tag) {
      const label = categoryLabel(values);
      const suggested = context.tags.find((tag) => matches(tag.name, label));
      fixes.push(
        fix('tag', 'The tag?', [
          ...(suggested ? [{ id: suggested.id, label: suggested.name, suggested: true }] : []),
          ...context.tags
            .filter((tag) => tag !== suggested)
            .map((tag) => ({ id: tag.id, label: tag.name, suggested: false })),
        ]),
      );
    }
  }
  const covered = new Set<string>(fixes.map((row) => row.fact));
  return {
    fixes,
    stillNeeds: [
      ...new Set(
        item.needs
          .filter((need) => !covered.has(need.field === 'tagId' ? 'tag' : need.field))
          .map((need) => reviewNeedWords(need, item.theme)),
      ),
    ],
    summary: item.state === 'ready' ? summarize(values, context) : null,
  };
}

function summarize(values: ExpenseDraftValues, context: QuickFixContext) {
  const payers = values.paidBy ?? [];
  const name = (id: string) =>
    id === context.viewerId
      ? 'You'
      : (context.members.find((member) => member.id === id)?.name ?? 'A member');
  const paid =
    payers.length === 1 ? `${name(payers[0].user)} paid` : `${payers.length} people paid`;
  const tag =
    (values.tagId && context.tags.find((row) => row.id === values.tagId)?.name) || values.tag || '';
  const label = categoryLabel(values);
  const category = values.category && values.category !== 'other' && !matches(tag, label);
  return [paid, reviewSplitMethod(values.splitMethod), tag, category ? label : '']
    .filter(Boolean)
    .join(' · ');
}

/** The values a chip keeps: a lone payer (who then pays the whole Expense, #425) or a Tag identity. */
export function applyQuickFix(
  values: ExpenseDraftValues,
  fact: QuickFixFact,
  optionId: string,
): ExpenseDraftValues {
  if (fact === 'paidBy') return { ...values, paidBy: [{ user: optionId }] };
  // The identity replaces any earlier Tag name, as the Add expense form's Tag picker does.
  const next = { ...values, tagId: optionId };
  delete next.tag;
  return next;
}

/** Items the "You for all N" action can fill in: waiting only for someone to have paid. */
export function bulkPayerItems(items: readonly ReviewItemModel[]): ReviewItemModel[] {
  return items.filter(
    (item) =>
      item.state === 'needs-details' &&
      !!item.accountItem &&
      !item.accountItem.draft.values?.paidBy?.length,
  );
}

/** A change made elsewhere, or an item already gone: a bulk action skips it, never overwrites it. */
export function changedElsewhere(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'STALE_REVISION' || code === 'DRAFT_NOT_FOUND' || code === 'REVISION_REQUIRED';
}
