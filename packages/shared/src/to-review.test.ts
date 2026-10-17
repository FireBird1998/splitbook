import { describe, expect, it } from 'vitest';
import {
  buildToReview,
  describeDraftChange,
  reviewDate,
  memberProblems,
  needsAmount,
  PAID_TOTAL_NEED,
  SPLIT_TOTAL_NEED,
  reviewProblem,
  reviewSplitMethod,
  summarizeReviewRun,
  type DeviceToReviewItem,
} from './to-review';
import {
  completeExpenseDraftSchema,
  persistedExpenseDraftSchema,
} from './validators/expense-draft';
import { parseReadableToReview, parseToReviewResponse } from './to-review-read';
import type { ToReviewItem, ToReviewRead } from './to-review-read';
import { toReviewHref, toReviewPath } from './api-paths';
import { toReviewKey, queryKeyPath } from './query-keys';

const groupId = 'a00000000000000000000001';
const member = 'b00000000000000000000001';
const now = new Date(2026, 9, 14, 0, 15);
function item(id: number, overrides: Partial<ToReviewItem> = {}): ToReviewItem {
  return {
    draft: {
      id: String(id).padStart(24, '0'),
      groupId,
      revision: 0,
      state: 'active',
      preparedBy: { kind: 'member' },
      changedBy: { kind: 'member' },
      missingFields: [],
      createdAt: new Date(2026, 9, 14, 0, 1, id).toISOString(),
      updatedAt: now.toISOString(),
      values: {
        description: 'Taxi',
        amount: 0.1,
        currency: 'USD',
        category: 'transport',
        date: '2026-10-14',
        tag: 'Travel',
        paidBy: [{ user: member, amount: 0.1 }],
        splitMethod: 'equal',
        splitBetween: [{ user: member }],
      },
    },
    problems: [],
    duplicates: [],
    ...overrides,
  };
}
function read(items: ToReviewItem[]): ToReviewRead {
  return {
    total: items.length,
    groups: [{ groupId, groupName: 'Weekend', count: items.length, items }],
  };
}
describe('To review model', () => {
  it('classifies every state, names several missing facts and orders state then oldest', () => {
    const first = item(1),
      second = item(2),
      duplicate = item(3),
      missing = item(4);
    duplicate.duplicates = [{ kind: 'expense', id: member, description: 'Taxi' }];
    delete missing.draft.values!.paidBy;
    delete missing.draft.values!.date;
    missing.draft.missingFields = ['paidBy', 'date'];
    const device: DeviceToReviewItem = {
      id: 'phone-1',
      groupId,
      groupName: 'Weekend',
      createdAt: new Date(2026, 9, 1).toISOString(),
      values: {},
    };
    const model = buildToReview(read([missing, second, duplicate, first]), [device], now);
    expect(model.items.map((item) => item.id)).toEqual([
      first.draft.id,
      second.draft.id,
      duplicate.draft.id,
      missing.draft.id,
      'phone-1',
    ]);
    expect(model.items.map((item) => item.state)).toEqual([
      'ready',
      'ready',
      'duplicate',
      'needs-details',
      'on-this-phone',
    ]);
    expect(model.items[3].missingFacts).toEqual(['who paid', 'the date']);
    expect(model.counts).toEqual({
      total: 5,
      ready: 2,
      duplicate: 1,
      needsDetails: 1,
      onThisPhone: 1,
    });
    expect(model.groups[0].counts).toEqual(model.counts);
    expect(model.items.map((item) => item.label).join(' ')).not.toMatch(/draft|revision|request/i);
  });
  it('excludes missing, invalid, duplicate and phone items from ready selection', () => {
    const invalid = item(2);
    invalid.problems = ['Member left'];
    const dup = item(3);
    dup.duplicates = [{ kind: 'draft', id: member, description: 'Taxi' }];
    const model = buildToReview(read([item(1), invalid, dup]), [], now);
    expect(model.ready.items.map((item) => item.draft.id)).toEqual([item(1).draft.id]);
    expect(model.items.find((item) => item.id === invalid.draft.id)?.missingFacts).toEqual([
      'the expense details',
    ]);
    expect(model.ready.label).toBe('Save 1 ready');
  });
  it('keeps exact minor totals in two currencies and formats with the app formatter', () => {
    const a = item(1),
      b = item(2),
      c = item(3);
    b.draft.values!.amount = 0.2;
    b.draft.values!.paidBy![0].amount = 0.2;
    c.draft.values!.amount = 123;
    c.draft.values!.paidBy![0].amount = 123;
    c.draft.values!.currency = 'JPY';
    const model = buildToReview(read([a, b, c]), [], now);
    expect(model.ready.totals).toEqual([
      { currency: 'JPY', amountMinor: 123, formatted: '¥123' },
      { currency: 'USD', amountMinor: 30, formatted: '$0.30' },
    ]);
  });
  it("makes an assistant's one-payer item without a Category ready, as Add expense would", () => {
    const dinner = item(1);
    dinner.draft.preparedBy = { kind: 'assistant', name: 'Claude' };
    dinner.draft.values = {
      description: 'Dinner',
      amount: 1200,
      currency: 'INR',
      date: '2026-10-16',
      tag: 'Food',
      paidBy: [{ user: member }],
      splitMethod: 'equal',
      splitBetween: [{ user: member }],
    };
    const model = buildToReview(read([dinner]), [], now);
    expect(model.items[0]).toMatchObject({ state: 'ready', missingFacts: [], label: 'Ready' });
    expect(model.ready.label).toBe('Save 1 ready');
    expect(model.ready.totals).toEqual([
      { currency: 'INR', amountMinor: 120000, formatted: '₹1,200.00' },
    ]);
    expect(completeExpenseDraftSchema.parse(dinner.draft.values)).toMatchObject({
      category: 'other',
      paidBy: [{ user: member, amount: 1200 }],
    });
  });
  it('never completes several payers, a mismatched payer, a missing payer or a missing amount', () => {
    const other = 'b00000000000000000000002';
    const several = item(1),
      mismatched = item(2),
      unpaid = item(3),
      unpriced = item(4);
    several.draft.values!.splitBetween = [{ user: member }, { user: other }];
    several.draft.values!.paidBy = [{ user: member, amount: 0.05 }, { user: other }];
    mismatched.draft.values!.paidBy = [{ user: member, amount: 0.05 }];
    delete unpaid.draft.values!.paidBy;
    unpaid.draft.missingFields = ['paidBy'];
    delete unpriced.draft.values!.amount;
    unpriced.draft.values!.paidBy = [{ user: member }];
    unpriced.draft.missingFields = ['amount'];
    const model = buildToReview(read([several, mismatched, unpaid, unpriced]), [], now);
    const facts = Object.fromEntries(model.items.map((item) => [item.id, item.missingFacts]));
    expect(model.ready.count).toBe(0);
    expect(facts[several.draft.id]).toEqual(['who paid']);
    // The payer doesn't add up to the amount: what it needs, not a missing amount (#506).
    expect(facts[mismatched.draft.id]).toEqual(['the amounts paid to add up to the total']);
    expect(facts[unpaid.draft.id]).toEqual(['who paid']);
    expect(facts[unpriced.draft.id]).toEqual(['the amount']);
  });
  it('groups two assistant sources first, ignores member sources, then names needs details', () => {
    const a = item(1),
      b = item(2),
      c = item(3),
      own = item(4);
    a.draft.preparedBy = b.draft.preparedBy = { kind: 'assistant', name: 'Claude' };
    c.draft.preparedBy = { kind: 'assistant', name: 'ChatGPT' };
    own.draft.values = {};
    own.draft.missingFields = ['paidBy'];
    const model = buildToReview(read([a, b, c, own]), [], now);
    expect(model.sourceSummary).toBe('1 from ChatGPT · 2 from Claude · 1 needs details');
    expect(model.groups[0].bannerSummary).toBe(
      '1 from ChatGPT today · 2 from Claude today · 1 needs details',
    );
  });
  it('uses the local calendar day at midnight in every host timezone', () => {
    const a = item(1);
    a.draft.preparedBy = { kind: 'assistant', name: 'Claude' };
    a.draft.createdAt = new Date(2026, 9, 13, 23, 59).toISOString();
    expect(buildToReview(read([a]), [], now).groups[0].bannerSummary).toBe('1 from Claude');
    a.draft.createdAt = new Date(2026, 9, 14, 0, 0).toISOString();
    expect(buildToReview(read([a]), [], now).groups[0].bannerSummary).toBe('1 from Claude today');
  });
  it('does not call a mixed-day assistant group today', () => {
    const a = item(1),
      b = item(2);
    a.draft.preparedBy = b.draft.preparedBy = { kind: 'assistant', name: 'Claude' };
    a.draft.createdAt = new Date(2026, 9, 13, 23).toISOString();
    expect(buildToReview(read([a, b]), [], now).groups[0].bannerSummary).toBe('2 from Claude');
  });
  it('counts multiple Groups including one kept only on this phone', () => {
    const model = buildToReview(
      read([item(1)]),
      [
        {
          id: 'phone',
          groupId: member,
          groupName: 'Home',
          createdAt: now.toISOString(),
          values: {},
        },
      ],
      now,
    );
    expect(model.groups.map((group) => [group.groupName, group.counts.total])).toEqual([
      ['Weekend', 1],
      ['Home', 1],
    ]);
    expect(model.counts.total).toBe(2);
  });
  it('summarizes per-item results without claiming uncertain saves succeeded', () => {
    expect(
      summarizeReviewRun([
        { id: '1', status: 'saved' },
        { id: '2', status: 'saved' },
        { id: '3', status: 'deleted' },
        { id: '4', status: 'skipped' },
        { id: '5', status: 'unresolved' },
      ]),
    ).toEqual({ saved: 2, deleted: 1, left: 2, label: 'Saved 2 · Deleted 1 · 2 left for later' });
    expect(summarizeReviewRun([{ id: '1', status: 'failed' }]).label).toBe('1 left for later');
    expect(summarizeReviewRun([]).label).toBe('');
    expect(buildToReview({ total: 0, groups: [] }, [], now).counts.total).toBe(0);
  });
});
describe('To review read contract', () => {
  it('decodes additive data and rejects malformed or inconsistent reads', () => {
    const data = read([item(1)]);
    expect(parseToReviewResponse({ status: 200, data: { ...data, extra: true } })).toMatchObject(
      data,
    );
    for (const value of [
      {},
      { status: 200, data: { ...data, total: 9 } },
      { status: 200, data: { groups: [], total: -1 } },
    ])
      expect(() => parseToReviewResponse(value)).toThrow('Unable to load To review. Please retry.');
  });
  it('leaves out each item it can’t read, counts it, and reads the rest (#513)', () => {
    const flat = 'a00000000000000000000002';
    const value = {
      status: 200,
      data: {
        total: 4,
        groups: [
          {
            groupId,
            groupName: 'Weekend',
            count: 3,
            items: [
              item(1),
              // Fails the shared schema, as an old or migrated Draft might.
              { ...item(2), draft: { ...item(2).draft, revision: 'two' } },
              // Filed under another Group.
              item(3, { draft: { ...item(3).draft, groupId: flat } }),
            ],
          },
          {
            groupId: flat,
            groupName: 'Flat',
            count: 1,
            items: [{ ...item(4), problems: 'none' }],
          },
        ],
      },
    };
    expect(parseReadableToReview(value)).toEqual({
      read: { total: 1, groups: [{ groupId, groupName: 'Weekend', count: 1, items: [item(1)] }] },
      unreadable: { [groupId]: 2, [flat]: 1 },
    });
    // Android still reads To review whole or not at all.
    expect(() => parseToReviewResponse(value)).toThrow('Unable to load To review. Please retry.');
  });
  it('reads nothing when the read itself doesn’t add up, whatever its items (#513)', () => {
    const data = read([item(1)]);
    for (const value of [
      {},
      { status: 200, data: { ...data, total: 9 } },
      { status: 200, data: { ...data, groups: [{ ...data.groups[0], count: 2 }] } },
    ])
      expect(() => parseReadableToReview(value)).toThrow('Unable to load To review. Please retry.');
  });
  it('shares a scoped cache key and safely encoded destination', () => {
    expect(queryKeyPath(toReviewKey({ accountId: member, environment: 'test' }))).toBe(
      toReviewPath(),
    );
    expect(toReviewHref('a/b')).toBe('/groups/a%2Fb/review');
    expect(() => toReviewHref('..')).toThrow();
  });
});

describe('changes while an item is open', () => {
  const names = { [member]: 'Alex', c00000000000000000000001: 'Sam' };
  function changed() {
    const before = item(1).draft;
    before.values!.currency = 'INR';
    before.values!.amount = 2350;
    before.values!.paidBy![0].amount = 2350;
    const after = persistedExpenseDraftSchema.parse(JSON.parse(JSON.stringify(before)));
    after.revision++;
    after.changedBy = { kind: 'assistant', name: 'Claude' };
    return { before, after };
  }
  it('describes exact money and names the assistant that last changed it', () => {
    const { before, after } = changed();
    after.values!.amount = 2400;
    expect(describeDraftChange(before, after, names)).toBe(
      "Claude changed the amount a moment ago: ₹2,350.00 → ₹2,400.00. You're seeing the latest version.",
    );
  });
  it('describes an amount without a currency in the Group’s (#512)', () => {
    const { before, after } = changed();
    delete before.values!.currency;
    delete after.values!.currency;
    after.values!.amount = 2400;
    expect(describeDraftChange(before, after, names, 'INR')).toBe(
      "Claude changed the amount a moment ago: ₹2,350.00 → ₹2,400.00. You're seeing the latest version.",
    );
  });
  it('formats date facts as calendar days in every host time zone', () => {
    const { before, after } = changed();
    after.values!.date = '2026-10-15';
    expect(describeDraftChange(before, after)).toBe(
      `Claude changed the date a moment ago: ${reviewDate('2026-10-14')} → ${reviewDate('2026-10-15')}. You're seeing the latest version.`,
    );
    expect(reviewDate('2000-01-01')).toBe('Jan 1, 2000');
  });
  it('names changed payers and amounts without exposing identities', () => {
    const { before, after } = changed();
    after.values!.paidBy = [{ user: 'c00000000000000000000001', amount: 2350 }];
    expect(describeDraftChange(before, after, names)).toContain(
      'the payer a moment ago: Alex ₹2,350.00 → Sam ₹2,350.00',
    );
  });
  it('describes a changed split, including participants when the method stays equal', () => {
    const { before, after } = changed();
    after.values!.splitBetween = [{ user: 'c00000000000000000000001' }];
    expect(describeDraftChange(before, after, names)).toContain(
      'the split a moment ago: Split equally · Alex → Split equally · Sam',
    );
    after.values!.splitMethod = 'percentage';
    after.values!.splitBetween[0].percentage = 100;
    expect(describeDraftChange(before, after, names)).toContain('percentage · Sam 100%');
  });
  it('describes multiple changed facts and the member on another device', () => {
    const { before, after } = changed();
    after.changedBy = { kind: 'member' };
    after.values!.amount = 2400;
    after.values!.date = '2026-10-15';
    const note = describeDraftChange(before, after, names);
    expect(note).toContain('You on another device changed the amount a moment ago: ');
    expect(note).toContain('; the date:');
    expect(note).toMatch(/You're seeing the latest version\.$/);
    expect(note).not.toMatch(/draft|revision|request|collection/i);
  });
  it('still says who changed it when no listed fact differs', () => {
    const { before, after } = changed();
    expect(describeDraftChange(before, after)).toBe(
      "Claude changed this item a moment ago. You're seeing the latest version.",
    );
  });
});

describe('review member wording', () => {
  it('names missing facts and payer amounts without exposing validation paths', () => {
    const values = { paidBy: [{ user: member }] };
    expect(reviewProblem('paidBy: Choose who paid.')).toBe('Who paid?');
    expect(
      reviewProblem('paidBy.0.amount: Enter the amount paid by this member.', values, {
        [member]: 'Alex Rivera',
      }),
    ).toBe('The amount paid by Alex Rivera?');
    expect(reviewProblem('paidBy.0.amount: invalid', values)).toBe(
      'The amount paid by this member?',
    );
    expect(
      reviewProblem(
        'splitBetween.0.percentage: invalid',
        { splitBetween: [{ user: member }] },
        { [member]: 'Sam Chen' },
      ),
    ).toBe('The percentage for Sam Chen?');
    expect(reviewProblem('tagId: Invalid identity')).toBe('The tag?');
    expect(reviewProblem('INVALID_MEMBERS')).toBe(
      'Choose current Group members for who paid and who shared it.',
    );
  });
  it('preserves the explanations that block stale saves and changed duplicate matches', () => {
    for (const message of [
      'This item changed while you were looking. Review the latest version before saving.',
      'The possible matches changed. Check them before saving this expense.',
      'This item needs another look before saving. Check the details and any possible duplicate.',
      'Some items changed or need another look. Review them before saving.',
    ])
      expect(reviewProblem(message)).toBe(message);
  });
  it('never forwards unrecognized server prose or code terms', () => {
    for (const message of [
      'values.paidBy.0.amount: broken',
      'request collection Draft revision',
      'An internal server failure',
    ])
      expect(reviewProblem(message)).toBe('Check the expense details and try again.');
  });
  it('uses display names for split changes and categories', () => {
    expect(reviewSplitMethod('equal')).toBe('Split equally');
    expect(reviewSplitMethod('exact')).toBe('Split by amounts');
    const before = item(1).draft;
    const after = item(1).draft;
    after.values!.splitMethod = 'shares';
    after.values!.category = 'other';
    const note = describeDraftChange(before, after);
    expect(note).toContain('Split equally');
    expect(note).toContain('Split by shares');
    expect(note).toContain('Other');
    expect(note).not.toMatch(/\bequal\b|\bother\b/);
  });
});

describe('memberProblems (#435)', () => {
  const alex = 'a00000000000000000000001';
  const model = (problems: string[], values = {}, missingFields: string[] = []) =>
    buildToReview(
      {
        total: 1,
        groups: [
          {
            groupId: 'b00000000000000000000001',
            groupName: 'Maple House',
            count: 1,
            items: [item(problems, values, missingFields)],
          },
        ],
      },
      [],
      new Date('2026-10-16T12:00:00.000Z'),
    ).items[0];
  const item = (problems: string[], values = {}, missingFields: string[] = []): ToReviewItem =>
    ({
      draft: {
        id: 'd00000000000000000000001',
        groupId: 'b00000000000000000000001',
        revision: 0,
        state: 'active',
        preparedBy: { kind: 'member' },
        changedBy: { kind: 'member' },
        createdAt: '2026-10-16T00:00:00.000Z',
        updatedAt: '2026-10-16T00:00:00.000Z',
        missingFields,
        values,
      },
      review: 'a'.repeat(64),
      problems,
      duplicates: [],
    }) as ToReviewItem;

  it('leaves out a fact the item already says it needs, and never shows field names', () => {
    expect(
      memberProblems(
        model(
          [
            'paidBy: Choose who paid.',
            'splitMethod: Choose a split method.',
            'splitBetween: Choose who shared this Expense.',
            'tagId: Choose a Tag.',
          ],
          { description: 'Station dinner', amount: 30, currency: 'INR', date: '2026-10-16' },
          ['paidBy', 'splitMethod', 'splitBetween', 'tagId'],
        ),
      ),
    ).toEqual([]);
  });

  it('says a member-level problem in member words, once', () => {
    const values = {
      description: 'Station dinner',
      amount: 30,
      currency: 'INR',
      date: '2026-10-16',
      category: 'other',
      tagId: 'c00000000000000000000001',
      paidBy: [{ user: alex }],
      splitMethod: 'equal',
      splitBetween: [{ user: alex }],
    };
    expect(
      memberProblems(
        model(['paidBy.0.amount: Required', 'paidBy.0.amount: Required', 'INVALID_TAG'], values),
        { [alex]: 'Alex' },
      ),
    ).toEqual(['The amount paid by Alex?', 'Choose an available Tag.']);
  });

  it('names a row from the values being edited, when given (#441)', () => {
    const sam = 'a00000000000000000000002';
    const saved = { paidBy: [{ user: alex }] };
    const editing = { paidBy: [{ user: sam }] };
    expect(
      memberProblems(
        model(['paidBy.0.amount: Required'], saved),
        { [alex]: 'Alex', [sam]: 'Sam' },
        editing,
      ),
    ).toEqual(['The amount paid by Sam?']);
  });

  it('names the person whose exact share was left out, not the Expense amount (#497)', () => {
    const sam = 'a00000000000000000000002';
    const values = {
      description: 'Station dinner',
      amount: 30,
      currency: 'INR',
      date: '2026-10-16',
      category: 'other',
      tagId: 'c00000000000000000000001',
      paidBy: [{ user: alex, amount: 30 }],
      splitMethod: 'exact',
      splitBetween: [{ user: alex, amount: 30 }, { user: sam }],
    };
    // The problem as a Draft review words the save schema's issue.
    const reviewed = model(
      ['splitBetween.1.amount: Enter an amount for each person in the split'],
      values,
    );

    expect(reviewed.missingFacts).toEqual(['who shared it']);
    expect(memberProblems(reviewed, { [alex]: 'Alex', [sam]: 'Sam' })).toEqual([
      'The amount for Sam?',
    ]);
  });
});

describe('a fact that is there but wrong (#506)', () => {
  const sam = 'b00000000000000000000002';
  const priya = 'b00000000000000000000003';
  const names = { [member]: 'Alex', [sam]: 'Sam', [priya]: 'Priya' };
  const groceries = {
    description: 'Groceries',
    amount: 100,
    currency: 'USD',
    category: 'other',
    date: '2026-10-14',
    tag: 'Travel',
    paidBy: [{ user: member, amount: 100 }],
    splitMethod: 'equal',
    splitBetween: [{ user: member }, { user: sam }, { user: priya }],
  };
  /** An item as a Draft review sends it: each problem at its field, which missingFields names. */
  const reviewed = (
    values: object,
    problem: string,
    preparedBy: ToReviewItem['draft']['preparedBy'] = { kind: 'member' },
  ) => {
    const base = item(1);
    const field = problem.split(/[.:]/)[0];
    return buildToReview(
      read([
        {
          ...base,
          draft: {
            ...base.draft,
            preparedBy,
            missingFields: [field],
            values,
          },
          problems: [problem],
        },
      ]),
      [],
      now,
    ).items[0];
  };

  it.each([
    [
      'a $100 split 30 / 30 / 30',
      {
        ...groceries,
        splitMethod: 'unequal',
        splitBetween: [
          { user: member, amount: 30 },
          { user: sam, amount: 30 },
          { user: priya, amount: 30 },
        ],
      },
      'splitBetween: Split amounts must add up to the expense amount',
      'the split to add up to the total',
    ],
    [
      'a $200 paid 150 + 100',
      {
        ...groceries,
        amount: 200,
        paidBy: [
          { user: member, amount: 150 },
          { user: sam, amount: 100 },
        ],
      },
      'paidBy: Payer amounts must add up to the expense amount',
      'the amounts paid to add up to the total',
    ],
    [
      'percentages 50 + 30',
      {
        ...groceries,
        splitMethod: 'percentage',
        splitBetween: [
          { user: member, percentage: 50 },
          { user: sam, percentage: 30 },
        ],
      },
      'splitBetween: Percentages must add up to 100',
      'the percentages to add up to 100%',
    ],
    [
      'an amount of $10.555',
      { ...groceries, amount: 10.555, paidBy: [{ user: member }] },
      'amount: Amount supports at most 2 decimal places',
      'an amount with at most 2 decimal places',
    ],
  ])('names what %s needs, not the amount', (_case, values, problem, need) => {
    const model = reviewed(values, problem);

    expect(model.missingFacts).toEqual([need]);
    expect(model.unknownFacts).toEqual([]);
    expect(model.label).toBe(`Needs ${need}`);
    // The Needs line already says it, so it isn't said twice.
    expect(memberProblems(model, names)).toEqual([]);
  });

  it('names the share with too many decimals, and whose it is', () => {
    const model = reviewed(
      {
        ...groceries,
        splitMethod: 'exact',
        splitBetween: [
          { user: member, amount: 33.333 },
          { user: sam, amount: 33.333 },
          { user: priya, amount: 33.334 },
        ],
      },
      'splitBetween.0.amount: Amount supports at most 2 decimal places',
    );

    expect(model.missingFacts).toEqual(['shares with at most 2 decimal places']);
    expect(memberProblems(model, names)).toEqual([
      'The amount for Alex can have at most 2 decimal places.',
    ]);
  });

  it('reads the same from a server that still filed the reason at the amount', () => {
    const model = reviewed(
      {
        ...groceries,
        splitMethod: 'unequal',
        splitBetween: [
          { user: member, amount: 30 },
          { user: sam, amount: 30 },
          { user: priya, amount: 30 },
        ],
      },
      'amount: Split amounts must add up to the expense amount',
    );

    expect(model.missingFacts).toEqual(['the split to add up to the total']);
    expect(memberProblems(model, names)).toEqual([]);
  });

  it('does not say an assistant left out a fact that is only wrong', () => {
    const model = reviewed(
      { ...groceries, amount: 10.555, paidBy: [{ user: member }] },
      'amount: Amount supports at most 2 decimal places',
      { kind: 'assistant', name: 'Claude' },
    );

    expect(model.unknownFacts).toEqual([]);
  });

  it('still says a missing amount, once (#458)', () => {
    const withoutAmount = Object.fromEntries(
      Object.entries(groceries).filter(([key]) => key !== 'amount'),
    );
    const model = reviewed(withoutAmount, 'amount: Enter the Expense amount.');

    expect([model.missingFacts, model.unknownFacts]).toEqual([['the amount'], ['the amount']]);
    expect(memberProblems(model, names)).toEqual([]);
  });

  it('says each reason in member words wherever a problem is shown alone', () => {
    expect(
      [
        'splitBetween: Split amounts must add up to the expense amount',
        'paidBy: Payer amounts must add up to the expense amount',
        'splitBetween: Percentages must add up to 100',
        'amount: Amount supports at most 2 decimal places',
        'Invalid Draft: amount: Amount supports at most 0 decimal places',
      ].map((problem) => reviewProblem(problem)),
    ).toEqual([
      'The split must add up to the total.',
      'The amounts paid must add up to the total.',
      'The percentages must add up to 100%.',
      'The amount can have at most 2 decimal places.',
      'The amount must be a whole number.',
    ]);
  });
});

describe('the Group currency (#512)', () => {
  /** A read whose Group may set the currency, with the missingFields today's server sends. */
  const inGroup = (values: object, currency?: string, missingFields: string[] = []) =>
    buildToReview(
      {
        total: 1,
        groups: [
          {
            groupId,
            groupName: 'Weekend',
            ...(currency ? { currency } : {}),
            count: 1,
            items: [{ ...item(1), draft: { ...item(1).draft, missingFields, values } }],
          },
        ],
      },
      [],
      now,
    ).items[0];
  const taxiWithoutCurrency = Object.fromEntries(
    Object.entries(item(1).draft.values!).filter(([key]) => key !== 'currency'),
  );

  it('fills an item without a currency from its Group, so it is ready', () => {
    const model = inGroup(taxiWithoutCurrency, 'USD');

    expect([model.state, model.missingFacts]).toEqual(['ready', []]);
  });

  it('never asks for the currency, only for what is really missing', () => {
    const model = inGroup({ description: 'Taxi' }, 'USD', [
      'amount',
      'currency',
      'date',
      'paidBy',
      'splitMethod',
      'splitBetween',
      'tagId',
    ]);

    expect(model.missingFacts).toEqual([
      'the amount',
      'the date',
      'who paid',
      'how to split it',
      'who shared it',
      'the tag',
    ]);
  });

  it('still asks for it when the read names no Group currency', () => {
    expect(inGroup(taxiWithoutCurrency).missingFacts).toEqual(['the currency']);
  });
});

describe('whether To review asks for an item’s amount (#524)', () => {
  it('asks when the amount is missing or has more decimal places than its currency', () => {
    expect(needsAmount(['the amount'])).toBe(true);
    expect(needsAmount(['an amount with at most 2 decimal places'])).toBe(true);
    expect(needsAmount(['a whole-number amount'])).toBe(true);
  });

  it('does not ask for a split, payers or other facts that mention amounts', () => {
    expect(
      needsAmount([
        SPLIT_TOTAL_NEED,
        PAID_TOTAL_NEED,
        'amounts paid with at most 2 decimal places',
      ]),
    ).toBe(false);
    expect(needsAmount(['what it was for', 'the date'])).toBe(false);
  });
});
