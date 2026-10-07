import { describe, expect, it } from 'vitest';
import { ExpenseDraft } from './expense-draft';

const context = {
  groupId: 'group',
  accountId: 'alice',
  memberIds: ['alice', 'bob'],
  currency: 'USD',
  defaultTag: 'general-id',
  date: '2026-09-28',
};

it('retains editable input and the attempted submission after a lost response', () => {
  let draft = ExpenseDraft.open(context).edit({ description: 'Lunch', amount: '10' });
  const prepared = draft.prepare(['general-id'], 'first-key');
  expect(prepared.submission).toBeDefined();
  draft = prepared.draft
    .attempt(prepared.submission!)
    .fail(prepared.submission!, 'Connection lost');
  expect(draft.values.description).toBe('Lunch');
  const retry = draft.prepare(['general-id'], 'unused-key');
  expect(retry.submission).toMatchObject({
    key: 'first-key',
    checkDuplicate: false,
    body: prepared.submission!.body,
  });
  expect(retry.draft.values.amount).toBe('10');
});

it('keeps invalid fields and cancelled duplicate warnings editable', () => {
  let draft = ExpenseDraft.open(context).edit({
    description: 'Lunch',
    amount: '10.001',
    notes: 'Keep this',
  });
  const invalid = draft.prepare(['general-id'], 'invalid');
  expect(invalid.submission).toBeUndefined();
  expect(invalid.draft.error).toMatch(/decimal places/);
  expect(invalid.draft.values).toMatchObject({ amount: '10.001', notes: 'Keep this' });
  draft = invalid.draft.edit({ amount: '10' });
  const prepared = draft.prepare(['general-id'], 'cancelled');
  draft = prepared.draft.cancel(prepared.submission!);
  expect(draft.loading).toBe(false);
  expect(draft.values).toMatchObject({ amount: '10', notes: 'Keep this' });
  expect(draft.prepare(['general-id'], 'next').submission?.checkDuplicate).toBe(true);
});

it('uses a new explicit action for changed content and keeps attempted payload separate from fields', () => {
  const first = ExpenseDraft.open(context)
    .edit({ description: 'Lunch', amount: '10' })
    .prepare(['general-id'], 'first');
  const edited = first.draft.attempt(first.submission!).edit({ description: 'Dinner' });
  expect(JSON.parse(first.submission!.body).description).toBe('Lunch');
  const failed = edited.fail(first.submission!, 'Lost');
  const next = failed.prepare(['general-id'], 'second');
  expect(next.submission).toMatchObject({ key: 'second', checkDuplicate: true });
  expect(JSON.parse(next.submission!.body).description).toBe('Dinner');
});

it('completes once and ignores old request outcomes', () => {
  const prepared = ExpenseDraft.open(context)
    .edit({ description: 'Lunch', amount: '10' })
    .prepare(['general-id'], 'first');
  const complete = prepared.draft.attempt(prepared.submission!).complete(prepared.submission!);
  expect(complete.completed).toBe(true);
  expect(complete.loading).toBe(false);
  expect(complete.complete(prepared.submission!)).toBe(complete);
  expect(complete.fail(prepared.submission!, 'Late failure')).toBe(complete);
  expect(complete.prepare(['general-id'], 'another').submission).toBeUndefined();
});

const saved = {
  _id: 'expense',
  revision: 3,
  description: 'Historical lunch',
  amount: 0.03,
  currency: 'USD',
  tag: 'General',
  tagId: 'general-id',
  splitMethod: 'equal' as const,
  paidBy: [{ user: { _id: 'alice' }, amount: 0.03 }],
  splitBetween: [
    { user: 'alice', amount: 0.01 },
    { user: 'bob', amount: 0.02 },
  ],
};

it('retains the saved revision and historical preview until explicit successful reload', () => {
  const source = { ...saved };
  let draft = ExpenseDraft.open(context, source).edit({ description: 'My correction' });
  source.revision = 4;
  source.description = 'Background read';
  expect(draft.base?.revision).toBe(3);
  expect(draft.preview().money?.splitBetween.map((row) => row.amountMinor)).toEqual([1, 2]);
  const prepared = draft.prepare(['general-id'], 'edit');
  expect(prepared.submission).toMatchObject({ expenseId: 'expense', revision: 3 });
  draft = prepared.draft
    .attempt(prepared.submission!)
    .fail(prepared.submission!, 'Newer edit won', 409);
  expect(draft.conflict).toBe(true);
  draft = draft.reloadFailed('Could not reload');
  expect(draft.values.description).toBe('My correction');
  expect(draft.base?.revision).toBe(3);
  expect(draft.conflict).toBe(true);
  const reloaded = draft.reload(source);
  expect(reloaded.values.description).toBe('Background read');
  expect(reloaded.base?.revision).toBe(4);
  expect(reloaded.conflict).toBe(false);
});

it('keeps a stable Tag identity and initializes independent account, Group and Expense contexts', () => {
  const entered = ExpenseDraft.open(context, saved).edit({ notes: 'Private draft' });
  expect(JSON.parse(entered.prepare(['general-id'], 'edit').submission!.body).tagId).toBe(
    'general-id',
  );
  for (const nextContext of [
    { ...context, groupId: 'other' },
    { ...context, accountId: 'bob' },
  ]) {
    const other = ExpenseDraft.open(nextContext);
    expect(other.values.notes).toBe('');
    expect(other.base).toBeNull();
    expect(other.values.payers[0].user).toBe(nextContext.accountId);
  }
  const otherExpense = ExpenseDraft.open(context, {
    ...saved,
    _id: 'other',
    description: 'Other expense',
  });
  expect(otherExpense.values.description).toBe('Other expense');
  expect(otherExpense.values.notes).toBe('');
  expect(entered.reload({ ...saved, _id: 'other' })).toBe(entered);
});

it('blocks invalid stored money and preserves the draft on an invalid reload', () => {
  const invalid = { ...saved, moneyVersion: 1, amountMinor: 4 };
  const draft = ExpenseDraft.open(context, invalid);
  expect(draft.invalidStoredMoney).toBe(true);
  expect(draft.preview().money).toBeNull();
  expect(draft.prepare(['general-id'], 'invalid').submission).toBeUndefined();
  const entered = ExpenseDraft.open(context, saved).edit({ notes: 'Keep my work' }).reload(invalid);
  expect(entered.values.notes).toBe('Keep my work');
  expect(entered.base?.revision).toBe(3);
  expect(entered.error).toMatch(/invalid stored amounts/);
});

it('requires entered shares before submitting the Shares method', () => {
  const draft = ExpenseDraft.open(context)
    .edit({ description: 'Lunch', amount: '10' })
    .chooseSplitMethod('shares');
  const prepared = draft.prepare(['general-id'], 'shares');
  expect(prepared.submission).toBeUndefined();
  expect(prepared.draft.error).toContain('at least 1 share');
});

it.each(['paidBy', 'splitBetween'])('shows an editing error for malformed stored %s', (field) => {
  const malformed = { ...saved };
  Reflect.set(malformed, field, null);
  const draft = ExpenseDraft.open(context, malformed);
  expect(draft.invalidStoredMoney).toBe(true);
  expect(draft.error).toContain('invalid stored amounts');
  expect(draft.prepare(['general-id'], 'invalid').submission).toBeUndefined();
});

it('keeps invalid stored currency out of editable money controls', () => {
  const draft = ExpenseDraft.open(context, { ...saved, currency: 'invalid' });
  expect(draft.invalidStoredMoney).toBe(true);
  expect(draft.values.currency).toBe('USD');
});

describe('a duplicate of a saved Expense (#311)', () => {
  const today = { ...context, date: '2026-10-07' };
  const shares = {
    ...saved,
    amount: 30,
    notes: 'Same again',
    category: 'food',
    splitMethod: 'shares' as const,
    paidBy: [{ user: 'bob', amount: 30 }],
    splitBetween: [
      { user: 'alice', amount: 10, shares: 1 },
      { user: 'bob', amount: 20, shares: 2 },
    ],
  };

  it('is a new Expense with the saved one’s entries, dated today', () => {
    const copy = ExpenseDraft.duplicate(today, shares, ['general-id']);
    expect(copy.base).toBeNull();
    expect(copy.values).toMatchObject({
      description: 'Historical lunch',
      amount: '30',
      category: 'food',
      notes: 'Same again',
      tag: 'general-id',
      date: '2026-10-07',
      splitMethod: 'shares',
      selectedMembers: ['alice', 'bob'],
      payers: [{ user: 'bob', amount: '30' }],
      multiPayerMode: false,
      customShares: { alice: '1', bob: '2' },
    });
  });

  it('saves with a new idempotency key and no revision, and a retry after a lost reply resends it', () => {
    const copy = ExpenseDraft.duplicate(today, shares, ['general-id']);
    const first = copy.prepare(['general-id'], 'copy-key');
    expect(first.submission).toMatchObject({
      expenseId: undefined,
      revision: undefined,
      key: 'copy-key',
      checkDuplicate: true,
      date: '2026-10-07',
    });
    expect(JSON.parse(first.submission!.body)).toMatchObject({
      description: 'Historical lunch',
      amount: 30,
      tagId: 'general-id',
      date: '2026-10-07',
      splitMethod: 'shares',
    });
    const lost = first.draft.attempt(first.submission!).fail(first.submission!, 'Connection lost');
    expect(lost.prepare(['general-id'], 'unused').submission).toMatchObject({
      key: 'copy-key',
      body: first.submission!.body,
    });
  });

  it('leaves out anyone no longer in the Group, and the viewer pays when no payer is left', () => {
    const left = {
      ...shares,
      paidBy: [{ user: 'carol', amount: 30 }],
      splitBetween: [
        { user: 'alice', amount: 10, shares: 1 },
        { user: 'carol', amount: 20, shares: 2 },
      ],
    };
    const copy = ExpenseDraft.duplicate(today, left, ['general-id']);
    expect(copy.values.selectedMembers).toEqual(['alice']);
    expect(copy.values.payers).toEqual([{ user: 'alice', amount: '' }]);
    expect(copy.values.customShares).toEqual({ alice: '1' });
  });

  it('falls back to the default Tag when the saved one isn’t active', () => {
    const copy = ExpenseDraft.duplicate({ ...today, defaultTag: 'home-id' }, shares, ['home-id']);
    expect(copy.values.tag).toBe('home-id');
  });

  it('leaves the amount to enter again when the stored money can’t be read or is another currency', () => {
    for (const unreadable of [
      { ...saved, moneyVersion: 1, amountMinor: 4 },
      { ...saved, currency: 'INR' },
    ]) {
      const copy = ExpenseDraft.duplicate(today, unreadable, ['general-id']);
      expect(copy.invalidStoredMoney).toBe(false);
      expect(copy.error).toBe('');
      expect(copy.values).toMatchObject({
        description: 'Historical lunch',
        amount: '',
        currency: 'USD',
        splitMethod: 'equal',
        date: '2026-10-07',
      });
    }
  });
});
