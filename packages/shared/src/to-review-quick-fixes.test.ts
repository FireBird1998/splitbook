import { describe, expect, it } from 'vitest';
import { buildToReview, type ReviewItemModel } from './to-review';
import type { ToReviewItem, ToReviewRead } from './to-review-read';
import type { ExpenseDraftValues } from './validators/expense-draft';
import {
  applyQuickFix,
  bulkPayerItems,
  changedElsewhere,
  toReviewQuickFixes,
  type QuickFixContext,
} from './to-review-quick-fixes';

const groupId = 'a00000000000000000000001';
const alex = 'b00000000000000000000001';
const sam = 'b00000000000000000000002';
const priya = 'b00000000000000000000003';
const tag = (n: number) => `c0000000000000000000000${n}`;
const context: QuickFixContext = {
  viewerId: alex,
  members: [
    { id: sam, name: 'Sam Chen' },
    { id: alex, name: 'Alex Rivera' },
    { id: priya, name: 'Priya Shah' },
  ],
  tags: [
    { id: tag(1), name: 'Groceries' },
    { id: tag(2), name: 'Utilities' },
    { id: tag(3), name: 'Home' },
    { id: tag(4), name: 'Transport' },
    { id: tag(5), name: 'Food' },
    { id: tag(6), name: 'General' },
  ],
};
const now = new Date(2026, 9, 17, 9, 0);
let next = 0;
function item(values: ExpenseDraftValues, missingFields: string[] = []): ToReviewItem {
  next += 1;
  return {
    draft: {
      id: String(next).padStart(24, 'd'),
      groupId,
      revision: 0,
      state: 'active',
      preparedBy: { kind: 'assistant', name: 'Claude' },
      changedBy: { kind: 'assistant', name: 'Claude' },
      missingFields,
      createdAt: new Date(2026, 9, 17, 8, next).toISOString(),
      updatedAt: now.toISOString(),
      values,
    },
    problems: [],
    duplicates: [],
  };
}
const full: ExpenseDraftValues = {
  description: 'Takeout dinner',
  amount: 1240,
  currency: 'INR',
  category: 'food',
  date: '2026-10-17',
  tagId: tag(5),
  paidBy: [{ user: alex }],
  splitMethod: 'equal',
  splitBetween: [{ user: alex }, { user: sam }],
};
function model(...items: ToReviewItem[]): ReviewItemModel[] {
  const read: ToReviewRead = {
    total: items.length,
    groups: [{ groupId, groupName: 'Maple House', count: items.length, items }],
  };
  return buildToReview(read, [], now).items;
}

describe('To review quick fixes', () => {
  it('covers payer and Tag needs independently of their displayed wording (#712)', () => {
    const [draft] = model(item({ ...full, paidBy: undefined, tagId: undefined, date: undefined }));
    const reworded = {
      ...draft,
      missingFacts: ['the person who paid', 'a Tag choice', 'the date'],
      unknownFacts: ['the person who paid', 'a Tag choice', 'the date'],
    };
    const fixes = toReviewQuickFixes(reworded, context);
    expect(fixes.fixes.map((fix) => fix.fact)).toEqual(['paidBy', 'tag']);
    expect(fixes.stillNeeds).toEqual(['the date']);
    expect(reworded.state).toBe('needs-details');
    const corrected = applyQuickFix(
      applyQuickFix(draft.accountItem!.draft.values!, 'paidBy', alex),
      'tag',
      tag(5),
    );
    expect(model(item({ ...corrected, date: full.date }))[0].state).toBe('ready');
  });

  it('offers who paid as chips with You first and suggested, never chosen', () => {
    const [taxi] = model(item({ ...full, description: 'Taxi', paidBy: undefined }, ['paidBy']));
    const fixes = toReviewQuickFixes(taxi, context);
    expect(fixes.fixes).toHaveLength(1);
    expect(fixes.fixes[0]).toMatchObject({ fact: 'paidBy', question: 'Who paid?', hasMore: false });
    expect(fixes.fixes[0].visible).toEqual([
      { id: alex, label: 'You', suggested: true },
      { id: sam, label: 'Sam Chen', suggested: false },
      { id: priya, label: 'Priya Shah', suggested: false },
    ]);
    expect(fixes.stillNeeds).toEqual([]);
    expect(fixes.summary).toBeNull();
  });

  it('offers the Tag matching the Category first, four at a time with More', () => {
    const [ferry] = model(
      item({ ...full, description: 'Ferry', category: 'transport', tagId: undefined }, ['tagId']),
    );
    const [fix] = toReviewQuickFixes(ferry, context).fixes;
    expect(fix.fact).toBe('tag');
    expect(fix.question).toBe('The tag?');
    expect(fix.visible.map((option) => option.label)).toEqual([
      'Transport',
      'Groceries',
      'Utilities',
      'Home',
    ]);
    expect(fix.visible[0].suggested).toBe(true);
    expect(fix.visible.slice(1).some((option) => option.suggested)).toBe(false);
    expect(fix.options).toHaveLength(6);
    expect(fix.hasMore).toBe(true);
  });

  it('suggests no Tag when none matches the Category', () => {
    const [cinema] = model(
      item({ ...full, category: 'entertainment', tagId: undefined }, ['tagId']),
    );
    const [fix] = toReviewQuickFixes(cinema, context).fixes;
    expect(fix.options.map((option) => option.label)).toEqual(context.tags.map((t) => t.name));
    expect(fix.options.some((option) => option.suggested)).toBe(false);
  });

  it('names only the facts the chips do not cover', () => {
    const [spice] = model(
      item({ ...full, description: 'Spice market', amount: undefined, paidBy: undefined }, [
        'amount',
        'paidBy',
      ]),
    );
    const fixes = toReviewQuickFixes(spice, context);
    expect(fixes.fixes.map((fix) => fix.fact)).toEqual(['paidBy']);
    expect(fixes.stillNeeds).toEqual(['the amount']);
  });

  it('never offers payer chips over several payers whose amounts are missing', () => {
    const [shared] = model(
      item({ ...full, paidBy: [{ user: alex, amount: 600 }, { user: sam }] }, []),
    );
    const fixes = toReviewQuickFixes(shared, context);
    expect(fixes.fixes).toEqual([]);
    expect(fixes.stillNeeds).toEqual(['who paid']);
  });

  it('summarises a Ready item, hiding a Category that is Other or matches the Tag', () => {
    const [dinner, bill, other, pair] = model(
      item(full),
      item({
        ...full,
        description: 'Electricity bill',
        category: 'housing',
        tagId: tag(2),
        paidBy: [{ user: priya }],
      }),
      item({ ...full, description: 'Odds and ends', category: undefined, tagId: tag(6) }),
      item({
        ...full,
        description: 'Concert',
        paidBy: [
          { user: alex, amount: 620 },
          { user: sam, amount: 620 },
        ],
      }),
    );
    expect(toReviewQuickFixes(dinner, context).summary).toBe('You paid · Split equally · Food');
    expect(toReviewQuickFixes(bill, context).summary).toBe(
      'Priya Shah paid · Split equally · Utilities · Housing',
    );
    expect(toReviewQuickFixes(other, context).summary).toBe('You paid · Split equally · General');
    expect(toReviewQuickFixes(pair, context).summary).toBe('2 people paid · Split equally · Food');
  });

  it('keeps a lone payer without an amount, and sets the Tag identity over its name', () => {
    const values: ExpenseDraftValues = { ...full, paidBy: undefined, tag: 'Old name' };
    expect(applyQuickFix(values, 'paidBy', sam)).toEqual({
      ...full,
      tag: 'Old name',
      paidBy: [{ user: sam }],
    });
    const tagged = applyQuickFix(values, 'tag', tag(4));
    expect(tagged.tagId).toBe(tag(4));
    expect(tagged).not.toHaveProperty('tag');
    expect(values.tag).toBe('Old name');
  });

  it('lists only items still waiting for any payer for the bulk action', () => {
    const items = model(
      item({ ...full, description: 'Taxi', paidBy: undefined }, ['paidBy']),
      item({ ...full, description: 'Fish market', paidBy: undefined }, ['paidBy']),
      item(full),
      item({ ...full, paidBy: [{ user: alex, amount: 600 }, { user: sam }] }, []),
    );
    expect(bulkPayerItems(items).map((row) => row.accountItem?.draft.values?.description)).toEqual([
      'Taxi',
      'Fish market',
    ]);
  });
  it('treats a change made elsewhere or an item already gone as skippable, nothing else', () => {
    const coded = (code: string | null) => Object.assign(new Error('x'), { code });
    for (const code of ['STALE_REVISION', 'DRAFT_NOT_FOUND', 'REVISION_REQUIRED'])
      expect(changedElsewhere(coded(code))).toBe(true);
    for (const error of [coded(null), coded('FORBIDDEN'), new Error('Offline'), null, 'x'])
      expect(changedElsewhere(error)).toBe(false);
  });
});
