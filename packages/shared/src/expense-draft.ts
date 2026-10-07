import { moneyParticipantId, normalizeExpenseMoney } from './exact-money';
import {
  decideExpenseMoneyEdit,
  readExpenseMoney,
  type StoredExpenseMoney,
} from './expense-money-edit';
import type { ExpenseSplitMethod } from './split-calculation';

export interface ExpenseDraftContext {
  groupId: string;
  accountId: string;
  memberIds: string[];
  currency: string;
  defaultTag: string;
  date: string;
}

export interface SavedDraftExpense extends StoredExpenseMoney {
  _id: string;
  revision?: number;
  description?: string;
  category?: string;
  date?: string;
  tag?: string;
  tagId?: string;
  notes?: string;
}

export interface ExpenseDraftValues {
  description: string;
  amount: string;
  currency: string;
  category: string;
  date: string;
  tag: string;
  notes: string;
  splitMethod: ExpenseSplitMethod;
  selectedMembers: string[];
  payers: Array<{ user: string; amount: string }>;
  multiPayerMode: boolean;
  customAmounts: Record<string, string>;
  customPercentages: Record<string, string>;
  customShares: Record<string, string>;
}

export interface ExpenseSubmission {
  readonly groupId: string;
  readonly expenseId?: string;
  readonly revision?: number;
  readonly body: string;
  readonly key: string;
  readonly checkDuplicate: boolean;
  readonly description: string;
  readonly amount: number;
  readonly date: string;
}

type DraftState = {
  context: ExpenseDraftContext;
  base: SavedDraftExpense | null;
  values: ExpenseDraftValues;
  error: string;
  invalidStoredMoney: boolean;
  conflict: boolean;
  completed: boolean;
  attempt: { body: string; key: string } | null;
  pending: ExpenseSubmission | null;
};

/** Immutable, dialog-lifetime Expense entry. Transport and confirmation belong to the adapter. */
export class ExpenseDraft {
  private constructor(private readonly state: DraftState) {}

  static open(context: ExpenseDraftContext, saved: SavedDraftExpense | null = null): ExpenseDraft {
    const base = saved ? { ...saved } : null;
    const values: ExpenseDraftValues = {
      description: base?.description ?? '',
      amount: '',
      currency: base?.currency ?? context.currency,
      category: base?.category ?? 'other',
      date: base?.date ? new Date(base.date).toISOString().split('T')[0] : context.date,
      tag: base ? base.tagId || base.tag || '' : context.defaultTag,
      notes: base?.notes ?? '',
      splitMethod: base?.splitMethod ?? 'equal',
      selectedMembers: [...context.memberIds],
      payers: [{ user: context.accountId, amount: '' }],
      multiPayerMode: false,
      customAmounts: {},
      customPercentages: {},
      customShares: {},
    };
    let error = '';
    if (base) {
      try {
        const money = readExpenseMoney(base);
        base.paidBy = base.paidBy.map((row) => ({ ...row, user: moneyParticipantId(row.user) }));
        base.splitBetween = base.splitBetween.map((row) => ({
          ...row,
          user: moneyParticipantId(row.user),
        }));
        values.amount = String(money.amount);
        values.payers = money.paidBy.map((row) => ({ user: row.user, amount: String(row.amount) }));
        values.multiPayerMode = values.payers.length > 1;
        values.selectedMembers = money.splitBetween.map((row) => row.user);
        for (const row of money.splitBetween) {
          values.customAmounts[row.user] = String(row.amount);
          if (row.percentage !== undefined)
            values.customPercentages[row.user] = String(row.percentage);
          if (row.shares !== undefined) values.customShares[row.user] = String(row.shares);
        }
      } catch {
        values.currency = context.currency;
        error = 'This expense contains invalid stored amounts and cannot be edited.';
      }
    }
    return new ExpenseDraft({
      context: { ...context, memberIds: [...context.memberIds] },
      base,
      values,
      error,
      invalidStoredMoney: !!error,
      conflict: false,
      completed: false,
      attempt: null,
      pending: null,
    });
  }

  /**
   * A new Expense entered from a saved one (#311's Duplicate): its description, amount, who
   * paid, split, Tag, Category and notes, dated `context.date` (today). It saves as a new
   * Expense, with its own idempotency key and the same unconfirmed-save handling as any new
   * Expense. Anyone no longer in the Group is left out (the viewer pays when no payer is
   * left), a Tag that isn't active (`activeTagIds`) falls back to the default, and stored money
   * that can't be read, or is in another currency, leaves the amount to enter again.
   */
  static duplicate(
    context: ExpenseDraftContext,
    saved: SavedDraftExpense,
    activeTagIds: readonly string[],
  ): ExpenseDraft {
    const blank = ExpenseDraft.open(context).values;
    const copy = ExpenseDraft.open(context, saved);
    const members = new Set(context.memberIds);
    const inGroup = (id: string) => members.has(id);
    const keep = (values: Record<string, string>) =>
      Object.fromEntries(Object.entries(values).filter(([id]) => inGroup(id)));
    const tag =
      saved.tagId && activeTagIds.includes(saved.tagId) ? saved.tagId : context.defaultTag;
    const words = {
      description: copy.values.description,
      category: copy.values.category,
      notes: copy.values.notes,
      tag,
      date: context.date,
    };
    let values: ExpenseDraftValues = { ...blank, ...words };
    if (!copy.invalidStoredMoney && copy.values.currency === context.currency) {
      const v = copy.values;
      const payers = v.payers.filter((payer) => inGroup(payer.user));
      const selectedMembers = v.selectedMembers.filter(inGroup);
      values = {
        ...v,
        ...words,
        payers: payers.length ? payers : blank.payers,
        multiPayerMode: payers.length > 1,
        selectedMembers: selectedMembers.length ? selectedMembers : blank.selectedMembers,
        customAmounts: keep(v.customAmounts),
        customPercentages: keep(v.customPercentages),
        customShares: keep(v.customShares),
      };
    }
    return new ExpenseDraft({
      ...copy.state,
      base: null,
      values,
      error: '',
      invalidStoredMoney: false,
    });
  }

  get values() {
    return this.state.values;
  }
  get base() {
    return this.state.base;
  }
  get error() {
    return this.state.error;
  }
  get conflict() {
    return this.state.conflict;
  }
  get loading() {
    return this.state.pending !== null;
  }
  get completed() {
    return this.state.completed;
  }
  get invalidStoredMoney() {
    return this.state.invalidStoredMoney;
  }

  private with(change: Partial<DraftState>) {
    return new ExpenseDraft({ ...this.state, ...change });
  }

  edit(change: Partial<ExpenseDraftValues>) {
    if (this.completed) return this;
    const next = { ...this.values, ...change };
    return this.with({
      values: {
        ...next,
        payers: next.payers.map((row) => ({ ...row })),
        selectedMembers: [...next.selectedMembers],
        customAmounts: { ...next.customAmounts },
        customPercentages: { ...next.customPercentages },
        customShares: { ...next.customShares },
      },
    });
  }

  chooseSplitMethod(splitMethod: ExpenseSplitMethod) {
    return this.edit({ splitMethod, customAmounts: {}, customPercentages: {}, customShares: {} });
  }

  private money() {
    if (this.invalidStoredMoney) throw new Error(this.error);
    const v = this.values;
    if (
      v.splitMethod === 'shares' &&
      v.selectedMembers.reduce((sum, id) => sum + (parseInt(v.customShares[id]) || 0), 0) === 0
    )
      throw new Error('Each member needs at least 1 share');
    const input = {
      amount: v.amount,
      currency: v.currency,
      splitMethod: v.splitMethod,
      paidBy: v.multiPayerMode ? v.payers : [{ user: v.payers[0]?.user ?? '', amount: v.amount }],
      splitBetween: v.selectedMembers.map((user) => ({
        user,
        ...(v.splitMethod === 'exact' || v.splitMethod === 'unequal'
          ? { amount: v.customAmounts[user] || '0' }
          : v.splitMethod === 'percentage'
            ? { percentage: Number(v.customPercentages[user] || '0') }
            : v.splitMethod === 'shares'
              ? { shares: Number(v.customShares[user] || '1') }
              : {}),
      })),
    };
    return this.base
      ? decideExpenseMoneyEdit(this.base, input).money
      : normalizeExpenseMoney(input);
  }

  preview() {
    try {
      return { money: this.money(), error: '' };
    } catch (error) {
      return { money: null, error: error instanceof Error ? error.message : 'Invalid allocation' };
    }
  }

  prepare(
    tagIds: string[],
    newKey: string,
  ): { draft: ExpenseDraft; submission?: ExpenseSubmission } {
    if (this.loading || this.completed || this.invalidStoredMoney) return { draft: this };
    const v = this.values;
    try {
      if (!v.description.trim() || !v.amount || Number(v.amount) <= 0)
        throw new Error('Please fill in description and a valid amount.');
      if (!v.tag) throw new Error('Please select a tag.');
      const money = this.money();
      const body = JSON.stringify({
        description: v.description,
        ...money,
        currency: v.currency,
        category: v.category,
        date: v.date,
        splitMethod: v.splitMethod,
        ...(tagIds.includes(v.tag) || this.base?.tagId === v.tag
          ? { tagId: v.tag }
          : { tag: v.tag }),
        notes: v.notes,
      });
      const retry = !this.base && this.state.attempt?.body === body ? this.state.attempt : null;
      const submission: ExpenseSubmission = {
        groupId: this.state.context.groupId,
        expenseId: this.base?._id,
        revision: this.base ? (this.base.revision ?? 0) : undefined,
        body: retry?.body ?? body,
        key: retry?.key ?? newKey,
        checkDuplicate: !retry,
        description: v.description.trim(),
        amount: money.amount,
        date: v.date,
      };
      return {
        draft: this.with({ pending: submission, error: this.conflict ? this.error : '' }),
        submission,
      };
    } catch (error) {
      return {
        draft: this.with({ error: error instanceof Error ? error.message : 'Invalid Expense' }),
      };
    }
  }

  cancel(submission: ExpenseSubmission) {
    return this.state.pending === submission ? this.with({ pending: null }) : this;
  }

  attempt(submission: ExpenseSubmission) {
    if (this.state.pending !== submission) return this;
    return this.with({
      attempt: this.base ? null : { body: submission.body, key: submission.key },
    });
  }

  fail(submission: ExpenseSubmission, error: string, status?: number) {
    if (this.state.pending !== submission) return this;
    return this.with({
      pending: null,
      error,
      conflict: this.conflict || status === 409 || status === 428,
    });
  }

  complete(submission: ExpenseSubmission) {
    if (this.state.pending !== submission) return this;
    return this.with({ pending: null, attempt: null, error: '', conflict: false, completed: true });
  }

  reload(saved: SavedDraftExpense) {
    if (!this.base || moneyParticipantId(saved._id) !== moneyParticipantId(this.base._id))
      return this;
    const latest = ExpenseDraft.open(this.state.context, saved);
    // Invalid reload data is not permission to discard the member's current draft.
    return latest.invalidStoredMoney ? this.reloadFailed(latest.error) : latest;
  }

  reloadFailed(error: string) {
    return this.with({ error });
  }
}
