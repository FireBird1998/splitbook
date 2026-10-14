import { describe, expect, it } from 'vitest';
import {
  buildToReview,
  describeDraftChange,
  reviewDate,
  summarizeReviewRun,
  type DeviceToReviewItem,
} from './to-review';
import { persistedExpenseDraftSchema } from './validators/expense-draft';
import { parseToReviewResponse } from './to-review-read';
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
      'the split a moment ago: equal · Alex → equal · Sam',
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
