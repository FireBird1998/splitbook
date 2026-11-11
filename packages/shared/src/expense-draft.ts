import { getCurrency } from './currency';
import { moneyParticipantId } from './exact-money';
import {
  readExpenseMoney,
  unsupportedCurrencyEditRefusal,
  type StoredExpenseMoney,
} from './expense-money-edit';
import { readExpenseEntry, formSummaryPolicy, type ExpenseEntry } from './expense-entry';
import type { ExpenseSplitMethod } from './split-calculation';

export interface ExpenseDraftContext {
  groupId: string;
  accountId: string;
  memberIds: string[];
  currency: string;
  /** The Group's currencies: a duplicate keeps an Expense's money in any of them (#719). */
  currencies?: readonly string[];
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
  entry: ExpenseEntry;
  error: string;
  invalidStoredMoney: boolean;
  conflict: boolean;
  completed: boolean;
  attempt: { body: string; key: string } | null;
  pending: ExpenseSubmission | null;
};

/** Dialog save lifetime: context, retry identity and confirmation. Typed values use ExpenseEntry. */
export class ExpenseDraft {
  private constructor(private readonly state: DraftState) {}

  static open(context: ExpenseDraftContext, saved: SavedDraftExpense | null = null): ExpenseDraft {
    const base = saved ? { ...saved } : null;
    const entry: ExpenseEntry = {
      description: base?.description ?? '',
      amount: '',
      currency: base?.currency ?? context.currency,
      category: base?.category ?? 'other',
      date: base?.date ? new Date(base.date).toISOString().split('T')[0] : context.date,
      tagId: base ? base.tagId || base.tag || '' : context.defaultTag,
      notes: base?.notes ?? '',
      splitMethod: base?.splitMethod ?? 'equal',
      participantIds: [...context.memberIds],
      payerId: context.accountId,
      payers: [{ user: context.accountId, amount: '' }],
      multiPayer: false,
      splitValues: {},
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
        entry.amount = String(money.amount);
        entry.payers = money.paidBy.map((row) => ({ user: row.user, amount: String(row.amount) }));
        entry.payerId = entry.payers[0]?.user ?? context.accountId;
        entry.multiPayer = entry.payers.length > 1;
        entry.participantIds = money.splitBetween.map((row) => row.user);
        const amounts = entry.splitMethod === 'exact' || entry.splitMethod === 'unequal';
        for (const row of money.splitBetween) {
          const value = amounts
            ? row.amount
            : entry.splitMethod === 'percentage'
              ? row.percentage
              : row.shares;
          if (value !== undefined && entry.splitMethod !== 'equal')
            entry.splitValues[row.user] = String(value);
        }
      } catch {
        entry.currency = context.currency;
        error = getCurrency(base.currency)
          ? 'This expense contains invalid stored amounts and cannot be edited.'
          : unsupportedCurrencyEditRefusal(base.currency);
      }
    }
    return new ExpenseDraft({
      context: { ...context, memberIds: [...context.memberIds] },
      base,
      entry,
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
   * that can't be read, or is in a currency the Group doesn't list, leaves the amount to enter again.
   */
  static duplicate(
    context: ExpenseDraftContext,
    saved: SavedDraftExpense,
    activeTagIds: readonly string[],
  ): ExpenseDraft {
    const blank = ExpenseDraft.open(context).entry;
    const copy = ExpenseDraft.open(context, saved);
    const members = new Set(context.memberIds);
    const inGroup = (id: string) => members.has(id);
    const tagId =
      saved.tagId && activeTagIds.includes(saved.tagId) ? saved.tagId : context.defaultTag;
    const words = {
      description: copy.entry.description,
      category: copy.entry.category,
      notes: copy.entry.notes,
      tagId,
      date: context.date,
    };
    let entry = { ...blank, ...words };
    const listed =
      copy.entry.currency === context.currency ||
      !!context.currencies?.includes(copy.entry.currency);
    if (!copy.invalidStoredMoney && listed) {
      const v = copy.entry;
      const payers = v.payers.filter((payer) => inGroup(payer.user));
      const participantIds = v.participantIds.filter(inGroup);
      entry = {
        ...v,
        ...words,
        payers: payers.length ? payers : blank.payers,
        payerId: payers[0]?.user ?? blank.payerId,
        multiPayer: payers.length > 1,
        participantIds: participantIds.length ? participantIds : blank.participantIds,
        splitValues: Object.fromEntries(
          Object.entries(v.splitValues).filter(([id]) => inGroup(id)),
        ),
      };
    }
    return new ExpenseDraft({
      ...copy.state,
      base: null,
      entry,
      error: '',
      invalidStoredMoney: false,
    });
  }

  get entry() {
    return this.state.entry;
  }

  get values() {
    return expenseDraftValues(this.entry);
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
  get hasSubmissionAttempt() {
    return this.state.attempt !== null;
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

  /** Legacy view for Finish later and To review until #1115; no second state is held. */
  edit(change: Partial<ExpenseDraftValues> | Partial<ExpenseEntry>) {
    return this.change(expenseEntryChange(this.entry, change));
  }

  change(change: Partial<ExpenseEntry>) {
    if (this.completed) return this;
    const entry = { ...this.entry, ...change };
    return this.with({
      entry: {
        ...entry,
        payers: entry.payers.map((row) => ({ ...row })),
        participantIds: [...entry.participantIds],
        splitValues: { ...entry.splitValues },
      },
    });
  }

  chooseSplitMethod(splitMethod: ExpenseSplitMethod) {
    return this.change({ splitMethod, splitValues: {} });
  }

  reading() {
    return readExpenseEntry(
      this.entry,
      this.base ? { kind: 'edit', saved: this.base } : { kind: 'new' },
      formSummaryPolicy,
    );
  }

  preview() {
    if (this.invalidStoredMoney) return { money: null, error: this.error };
    const { result } = this.reading();
    return result.kind === 'ready'
      ? { money: result.money, error: '' }
      : {
          money: null,
          error: result.error instanceof Error ? result.error.message : 'Invalid allocation',
        };
  }

  prepare(
    tagIds: string[],
    newKey: string,
  ): { draft: ExpenseDraft; submission?: ExpenseSubmission } {
    if (this.loading || this.completed || this.invalidStoredMoney) return { draft: this };
    const v = this.entry;
    try {
      const reading = this.reading();
      if (!v.description.trim() || reading.fields.amountMissing)
        throw new Error('Please fill in description and a valid amount.');
      if (!v.tagId) throw new Error('Please select a tag.');
      if (reading.result.kind === 'refused') throw reading.result.error;
      const money = reading.result.money;
      const body = JSON.stringify({
        description: v.description,
        ...money,
        currency: v.currency,
        category: v.category,
        date: v.date,
        splitMethod: v.splitMethod,
        ...(tagIds.includes(v.tagId) || this.base?.tagId === v.tagId
          ? { tagId: v.tagId }
          : { tag: v.tagId }),
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

/** Compatibility projection for the existing Draft editors. Only the active map exists. */
export function expenseDraftValues(entry: ExpenseEntry): ExpenseDraftValues {
  const { payerId: _payer, participantIds, multiPayer, splitValues, tagId, ...rest } = entry;
  return {
    ...rest,
    tag: tagId,
    selectedMembers: participantIds,
    multiPayerMode: multiPayer,
    customAmounts:
      entry.splitMethod === 'exact' || entry.splitMethod === 'unequal' ? splitValues : {},
    customPercentages: entry.splitMethod === 'percentage' ? splitValues : {},
    customShares: entry.splitMethod === 'shares' ? splitValues : {},
  };
}

/** Rename field changes; interpreting their contents belongs only to readExpenseEntry. */
export function expenseEntryChange(
  entry: ExpenseEntry,
  change: Partial<ExpenseDraftValues> | Partial<ExpenseEntry>,
): Partial<ExpenseEntry> {
  const {
    tag,
    selectedMembers,
    multiPayerMode,
    customAmounts,
    customPercentages,
    customShares,
    ...rest
  } = change as Partial<ExpenseDraftValues & ExpenseEntry>;
  const method = change.splitMethod ?? entry.splitMethod;
  const splitValues =
    method === 'percentage'
      ? customPercentages
      : method === 'shares'
        ? customShares
        : customAmounts;
  return {
    ...rest,
    ...(tag === undefined ? {} : { tagId: tag }),
    ...(selectedMembers === undefined ? {} : { participantIds: selectedMembers }),
    ...(multiPayerMode === undefined ? {} : { multiPayer: multiPayerMode }),
    ...(splitValues === undefined ? {} : { splitValues }),
  };
}

export function expenseEntryFromValues(
  values: Omit<ExpenseDraftValues, 'splitMethod'> & { splitMethod: ExpenseSplitMethod | '' },
): ExpenseEntry {
  return {
    amount: values.amount,
    currency: values.currency,
    description: values.description,
    date: values.date,
    notes: values.notes,
    category: values.category,
    tagId: values.tag,
    payerId: values.payers[0]?.user ?? '',
    payers: values.payers,
    multiPayer: values.multiPayerMode,
    participantIds: values.selectedMembers,
    splitMethod: values.splitMethod || 'equal',
    splitValues:
      values.splitMethod === 'shares'
        ? values.customShares
        : values.splitMethod === 'percentage'
          ? values.customPercentages
          : values.customAmounts,
  };
}

/** Rename only changed fields for the still-flat To review editor; missing facts stay missing. */
export function expenseDraftChanges(
  change: Partial<ExpenseEntry>,
  method: ExpenseSplitMethod,
): Partial<ExpenseDraftValues> {
  const { payerId: _payer, participantIds, multiPayer, splitValues, tagId, ...rest } = change;
  const next = change.splitMethod ?? method;
  return {
    ...rest,
    ...(tagId === undefined ? {} : { tag: tagId }),
    ...(participantIds === undefined ? {} : { selectedMembers: participantIds }),
    ...(multiPayer === undefined ? {} : { multiPayerMode: multiPayer }),
    ...(splitValues === undefined
      ? {}
      : {
          [next === 'percentage'
            ? 'customPercentages'
            : next === 'shares'
              ? 'customShares'
              : 'customAmounts']: splitValues,
        }),
  };
}
