import { expenseRecordSchema, storedExpenseMoney, type ExpenseRecord } from './expense-record';
import { decideExpenseMoneyEdit, readExpenseMoney } from '@splitbook/shared/expense-money-edit';
import { toDateParam } from '@splitbook/shared/date';
import { createExpenseSchema, updateExpenseSchema } from '@splitbook/shared/validators/expense';
import {
  assertExpenseParticipants,
  assertGroupCurrency,
} from '@splitbook/shared/expense-validation';
import { resolveTagReference } from '@splitbook/shared/tag-identity';
import { z } from 'zod';
import {
  MoneyValidationError,
  normalizeExpenseMoney,
  parseAmountMinor,
  parseDecimalUnits,
} from '@splitbook/shared/exact-money';
import { getCurrency } from '@splitbook/shared/currency';
import {
  expenseMoneyFields,
  rebaseExpenseEntries,
  resolveExpenseReview,
  type ExpenseMoneyField,
} from '@splitbook/shared/expense-review';
import { amountError as moneyAmountError, calendarDateError } from './field-feedback';
import { parseGroupResponse } from '@splitbook/shared/group-read';
import { objectId, toMobileGroup } from './dto';
import type { GroupReturnContext, MobileGroup } from './types';

// Historical missing identities are local read/delete-recovery keys, never API identities.
const draftMemberId = z.union([objectId, z.string().regex(/^former-(payer|participant)-\d+$/)]);

export const expenseDraftSchema = z.object({
  original: expenseRecordSchema.optional(),
  amount: z.string().max(40),
  currency: z.string().refine((value) => !!getCurrency(value)),
  description: z.string().max(200),
  date: z.string().max(10),
  payerId: draftMemberId,
  multiPayer: z.boolean().default(false),
  payers: z.array(z.object({ user: draftMemberId, amount: z.string().max(40) })).default([]),
  splitMethod: z.enum(['equal', 'unequal', 'percentage', 'shares', 'exact']).default('equal'),
  splitValues: z.record(draftMemberId, z.string().max(40)).default({}),
  participantIds: z.array(draftMemberId),
  category: z.string(),
  tagId: z.string(),
  notes: z.string().max(500),
  /**
   * Money fields the saved Expense changed while this edit was open. Each keeps the member's
   * entry until they choose theirs or the saved one; saving waits for every choice.
   */
  review: z.array(z.enum(expenseMoneyFields)).optional(),
});
export type ExpenseDraft = z.infer<typeof expenseDraftSchema>;
export interface ExpenseContext {
  group: MobileGroup;
  tags: { id: string; name: string; isArchived: boolean; isDeleted: boolean }[];
}
export interface ExpenseAttempt {
  key: string;
  body: string;
}
export const expenseMutationSchema = z.object({
  kind: z.enum(['edit', 'delete']),
  revision: z.number().int().nonnegative(),
  body: z.string(),
});
export type ExpenseMutation = z.infer<typeof expenseMutationSchema>;
export interface ExpenseEditor {
  groupId: string | null;
  context: ExpenseContext | null;
  draft: ExpenseDraft | null;
  preview: { user: unknown; amountMinor: number }[] | null;
  status:
    | 'conflict'
    | 'delete-review'
    | 'detail'
    | 'idle'
    | 'loading'
    | 'resume'
    | 'editing'
    | 'blocked'
    | 'saving'
    | 'uncertain'
    | 'saved';
  attempt: ExpenseAttempt | null;
  mutation: ExpenseMutation | null;
  latest: ExpenseRecord | null;
  requestedExpenseId: string | null;
  receiptId: string | null;
  persistence: 'saved' | 'saving' | 'error';
  message: string | null;
  validation: ExpenseValidation;
  returnTo: GroupReturnContext | null;
  /**
   * The Group's ordinary draft while another, saved Expense is read. That record opens
   * read-only; Edit and Delete wait until the draft is finished or discarded.
   */
  groupDraft: ExpenseDraft | null;
  /**
   * The entries a new Expense's draft started from, stored with the draft so it is compared
   * with the same start after a restart or a change of day. Null when unknown, as for drafts
   * stored by earlier versions. An edit starts from its saved Expense.
   */
  blank: ExpenseDraft | null;
}
/** Correctable Expense inputs, in the order they appear on screen. */
export const expenseFields = ['amount', 'description', 'date', 'payers', 'split', 'tag'] as const;
export type ExpenseField = (typeof expenseFields)[number];
export type ExpenseFieldErrors = Partial<Record<ExpenseField, string>>;
/**
 * Errors become visible once a field is left or a save is attempted, so partial
 * typing is not treated as a mistake. `focus.request` changes once per rejected save.
 */
export interface ExpenseValidation {
  submitted: boolean;
  touched: ExpenseField[];
  errors: ExpenseFieldErrors;
  focus: { field: ExpenseField; request: number } | null;
}
export const expenseFieldLabels: Record<ExpenseField, string> = {
  amount: 'Amount',
  description: 'Description',
  date: 'Date',
  payers: 'Paid by',
  split: 'Split',
  tag: 'Tag',
};
export function emptyExpenseValidation(): ExpenseValidation {
  return { submitted: false, touched: [], errors: {}, focus: null };
}
export type { AccountGroupRecordStore as ExpenseDraftStore } from './account-record-storage';
export function emptyExpenseEditor(): ExpenseEditor {
  return {
    groupId: null,
    context: null,
    draft: null,
    preview: null,
    status: 'idle',
    attempt: null,
    mutation: null,
    latest: null,
    requestedExpenseId: null,
    receiptId: null,
    persistence: 'saved',
    message: null,
    validation: emptyExpenseValidation(),
    returnTo: null,
    groupDraft: null,
    blank: null,
  };
}
export function parseExpenseContext(value: unknown): ExpenseContext {
  const group = parseGroupResponse(value);
  return {
    group: toMobileGroup(group),
    tags: group.tags.map(({ _id, name, isArchived, isDeleted }) => ({
      id: _id,
      name,
      isArchived,
      isDeleted,
    })),
  };
}
export function parseStoredExpenseDraft(value: unknown, accountId: string, groupId: string) {
  const record = z
    .object({
      version: z.literal(1),
      accountId: z.literal(accountId),
      groupId: z.literal(groupId),
      draft: expenseDraftSchema,
      // Where a new Expense's draft started. Earlier records lack it; it is then unknown.
      blank: expenseDraftSchema.nullable().default(null).catch(null),
      mutation: expenseMutationSchema.nullable().optional().default(null),
      attempt: z
        .object({ key: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/), body: z.string() })
        .nullable()
        .optional()
        .default(null),
    })
    .parse(value);
  if (record.draft.original && record.draft.original.group !== groupId)
    throw new Error('Unexpected stored Expense Group');
  if (record.attempt) createExpenseSchema.parse(JSON.parse(record.attempt.body));
  if (record.mutation) {
    if (
      !record.draft.original ||
      record.attempt ||
      record.mutation.revision !== record.draft.original.revision
    )
      throw new Error('Invalid mutation recovery');
    if (record.mutation.kind === 'edit')
      updateExpenseSchema.parse(JSON.parse(record.mutation.body));
  }
  return record;
}
/** Adapt text entry to the same exact-money command used by the web ledger. */
export function expenseMoney(draft: ExpenseDraft) {
  const input = expenseMoneyInput(draft);
  return draft.original
    ? decideExpenseMoneyEdit(storedExpenseMoney(draft.original), input).money
    : normalizeExpenseMoney(input);
}
function expenseMoneyInput(draft: ExpenseDraft) {
  return {
    amount: draft.amount,
    currency: draft.currency,
    paidBy: draft.multiPayer ? draft.payers : [{ user: draft.payerId, amount: draft.amount }],
    splitMethod: draft.splitMethod,
    splitBetween: draft.participantIds.map((user) => ({
      user,
      ...(draft.splitMethod === 'unequal' || draft.splitMethod === 'exact'
        ? { amount: draft.splitValues[user] || '0' }
        : draft.splitMethod === 'percentage'
          ? { percentage: parseDecimalUnits(draft.splitValues[user] || '0', 2) / 100 }
          : draft.splitMethod === 'shares'
            ? { shares: parseDecimalUnits(draft.splitValues[user] || '0', 0) }
            : {}),
    })),
  };
}
/** An edit re-checks current members only when it changes the saved allocation. */
function changesExpenseMoney(draft: ExpenseDraft, money: ReturnType<typeof expenseMoney>) {
  return (
    !draft.original ||
    decideExpenseMoneyEdit(storedExpenseMoney(draft.original), {
      ...money,
      splitMethod: draft.splitMethod,
    }).financialEdit
  );
}
export function previewExpense(draft: ExpenseDraft): ExpenseEditor['preview'] {
  try {
    return expenseMoney(draft).splitBetween;
  } catch {
    return null;
  }
}

const moneyCode = (error: unknown) => (error instanceof MoneyValidationError ? error.code : '');
function amountError(draft: ExpenseDraft, context: ExpenseContext | null) {
  const { currency } = draft;
  if (!draft.original && context && currency !== context.group.defaultCurrency)
    return `This draft uses ${currency}, but the Group now uses ${context.group.defaultCurrency}. Choose Use ${context.group.defaultCurrency}, then review the amount.`;
  return moneyAmountError(draft.amount, currency);
}
function memberName(draft: ExpenseDraft, id: string) {
  return [...(draft.original?.paidBy ?? []), ...(draft.original?.splitBetween ?? [])].find(
    (row) => row.user === id,
  )?.name;
}
/** Payer and split problems stay with their editors; the shared money rules decide validity. */
function allocationErrors(draft: ExpenseDraft, context: ExpenseContext | null): ExpenseFieldErrors {
  let money: ReturnType<typeof expenseMoney>;
  try {
    money = expenseMoney(draft);
  } catch (error) {
    const code = moneyCode(error);
    const payerIds = draft.multiPayer ? draft.payers.map((payer) => payer.user) : [draft.payerId];
    if (code === 'EMPTY_PARTICIPANTS')
      return payerIds.length
        ? { split: 'Choose at least one person to share this Expense.' }
        : { payers: 'Choose who paid.' };
    const unreadablePayer =
      draft.multiPayer &&
      draft.payers.some((payer) => {
        try {
          parseAmountMinor(payer.amount, draft.currency);
          return false;
        } catch {
          return true;
        }
      });
    const payerProblem =
      code === 'PAYER_TOTAL_MISMATCH' ||
      code === 'INVALID_PAYER_AMOUNT' ||
      (code === 'DUPLICATE_PARTICIPANTS' && new Set(payerIds).size !== payerIds.length) ||
      (code.startsWith('INVALID_MONEY') && unreadablePayer);
    const message =
      error instanceof MoneyValidationError
        ? error.message
        : 'Review who paid and how this Expense is split.';
    return payerProblem ? { payers: message } : { split: message };
  }
  if (!context || !changesExpenseMoney(draft, money)) return {};
  const members = new Set(context.group.members.map((member) => member.user.id));
  const payer = money.paidBy.find((row) => !members.has(String(row.user)));
  if (payer)
    return {
      payers: `${memberName(draft, String(payer.user)) ?? 'A payer'} is no longer in this Group. Choose who paid.`,
    };
  const participant = money.splitBetween.find((row) => !members.has(String(row.user)));
  if (participant)
    return {
      split: `${memberName(draft, String(participant.user)) ?? 'A participant'} is no longer in this Group. Remove unavailable participants from the split.`,
    };
  return {};
}
function tagError(draft: ExpenseDraft, context: ExpenseContext | null) {
  const original = draft.original;
  // Editing keeps an existing historical Tag association unless the member changes it.
  if (original && draft.tagId === (original.tagId ?? '')) return undefined;
  if (!draft.tagId) return 'Choose a Tag for this Expense.';
  if (!context) return undefined;
  try {
    resolveTagReference(
      context.tags.map(({ id, ...rest }) => ({ _id: id, ...rest })),
      { tagId: draft.tagId },
      original,
    );
    return undefined;
  } catch {
    return 'This Tag is no longer available. Choose an active Tag.';
  }
}

/**
 * Local corrections for every field, in screen order. `context` availability is
 * advisory: saving re-runs this against the freshly authorized Group first.
 */
export function validateExpenseDraft(
  draft: ExpenseDraft,
  context: ExpenseContext | null,
  today: string,
): ExpenseFieldErrors {
  const amount = amountError(draft, context);
  const found: ExpenseFieldErrors = {
    amount,
    description: updateExpenseSchema.shape.description.safeParse(draft.description).success
      ? undefined
      : draft.description.trim()
        ? 'Keep the description to 200 characters or fewer.'
        : 'Add a description, such as Groceries.',
    date: calendarDateError(draft.date, today),
    ...(amount ? {} : allocationErrors(draft, context)),
    tag: tagError(draft, context),
  };
  return Object.fromEntries(
    expenseFields.filter((field) => found[field]).map((field) => [field, found[field]]),
  );
}
export function visibleExpenseErrors(
  errors: ExpenseFieldErrors,
  validation: Pick<ExpenseValidation, 'submitted' | 'touched'>,
): ExpenseFieldErrors {
  return validation.submitted
    ? errors
    : Object.fromEntries(
        expenseFields
          .filter((field) => errors[field] && validation.touched.includes(field))
          .map((field) => [field, errors[field]]),
      );
}
/** One concise announcement for a rejected save; details stay beside each field. */
export function expenseCorrectionSummary(errors: ExpenseFieldErrors): string | null {
  const fields = expenseFields.filter((field) => errors[field]);
  if (fields.length <= 1) return fields.length ? errors[fields[0]]! : null;
  const labels = fields.map((field) => expenseFieldLabels[field]);
  return `Correct ${fields.length} fields before saving: ${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}.`;
}

export function buildExpenseBody(draft: ExpenseDraft, context: ExpenseContext): string {
  assertGroupCurrency(context.group.defaultCurrency, draft.currency);
  const { amount, paidBy, splitBetween } = expenseMoney(draft);
  assertExpenseParticipants(
    new Set(context.group.members.map((member) => member.user.id)),
    paidBy,
    splitBetween,
  );
  const tag = resolveTagReference(
    context.tags.map(({ id, ...rest }) => ({ _id: id, ...rest })),
    { tagId: draft.tagId },
  );
  const date = z.iso.date().parse(draft.date);
  const payload = createExpenseSchema.parse({
    description: draft.description,
    amount,
    currency: draft.currency,
    category: draft.category,
    date: new Date(`${date}T12:00:00`),
    paidBy,
    splitBetween,
    splitMethod: draft.splitMethod,
    tagId: tag.tagId,
    notes: draft.notes,
  });
  return JSON.stringify(payload);
}

export function parseCreatedExpenseId(value: unknown, groupId: string): string {
  return z
    .object({
      status: z.literal(201),
      data: z.object({ _id: objectId, group: z.literal(groupId) }),
    })
    .parse(value).data._id;
}

export function draftFromExpense(original: ExpenseRecord): ExpenseDraft {
  const money = readExpenseMoney(storedExpenseMoney(original));
  return {
    original,
    amount: String(money.amount),
    currency: original.currency,
    description: original.description,
    date: toDateParam(new Date(original.date)),
    category: original.category,
    notes: original.notes,
    tagId: original.tagId ?? '',
    payerId: money.paidBy[0].user,
    multiPayer: money.paidBy.length > 1,
    payers: money.paidBy.map((row) => ({ user: row.user, amount: String(row.amount) })),
    participantIds: money.splitBetween.map((row) => row.user),
    splitMethod: original.splitMethod,
    splitValues: Object.fromEntries(
      money.splitBetween.map((row) => [
        row.user,
        String(
          original.splitMethod === 'percentage'
            ? (row.percentage ?? 0)
            : original.splitMethod === 'shares'
              ? (row.shares ?? 0)
              : row.amount,
        ),
      ]),
    ),
  };
}

/** Field by field, so key order and a fresh copy don't count as a change. */
export function sameExpenseDraft(a: ExpenseDraft, b: ExpenseDraft): boolean {
  const entries = (draft: ExpenseDraft) =>
    JSON.stringify(draft, (_key, value: unknown) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([x], [y]) => (x < y ? -1 : 1)))
        : value,
    );
  return entries(a) === entries(b);
}

/**
 * Whether the entries differ from where the form started: the saved Expense being edited,
 * or a new Expense's blank entries. Only a changed draft is kept on the device.
 */
export function expenseDraftChanged(draft: ExpenseDraft, blank: ExpenseDraft | null): boolean {
  const start = draft.original ? draftFromExpense(draft.original) : blank;
  return !start || !sameExpenseDraft(draft, start);
}

/**
 * "Keep my version for review" against the latest saved Expense, by the shared review policy:
 * the edit began from its `original` and now builds on `latest`.
 */
export function rebaseExpenseDraft(draft: ExpenseDraft, latest: ExpenseRecord): ExpenseDraft {
  return {
    ...rebaseExpenseEntries(draft, draftFromExpense(draft.original!), draftFromExpense(latest)),
    original: latest,
  };
}

/** The member's choice for a money field under review, against the Expense the draft edits. */
export function resolveDraftReview(
  draft: ExpenseDraft,
  field: ExpenseMoneyField,
  keep: 'mine' | 'saved',
): Partial<ExpenseDraft> {
  return resolveExpenseReview(
    draft,
    field,
    keep,
    draft.original ? draftFromExpense(draft.original) : null,
  );
}

export function buildExpensePatch(draft: ExpenseDraft, context: ExpenseContext): string {
  const original = draft.original;
  if (!original || original.isDeleted) throw new Error('This Expense is deleted.');
  const money = expenseMoney(draft);
  const financial = changesExpenseMoney(draft, money);
  if (financial)
    assertExpenseParticipants(
      new Set(context.group.members.map((member) => member.user.id)),
      money.paidBy,
      money.splitBetween,
    );
  if (draft.currency !== original.currency)
    assertGroupCurrency(context.group.defaultCurrency, draft.currency);
  const tagChanged = draft.tagId !== (original.tagId ?? '');
  const tag = resolveTagReference(
    context.tags.map(({ id, ...rest }) => ({ _id: id, ...rest })),
    tagChanged ? { tagId: draft.tagId } : {},
    original,
  );
  const date = z.iso.date().parse(draft.date);
  const patch = updateExpenseSchema.parse({
    ...(draft.description !== original.description ? { description: draft.description } : {}),
    ...(draft.notes !== original.notes ? { notes: draft.notes } : {}),
    ...(draft.category !== original.category ? { category: draft.category } : {}),
    ...(date !== toDateParam(new Date(original.date))
      ? { date: new Date(`${date}T12:00:00`) }
      : {}),
    ...(tagChanged ? tag : {}),
    ...(financial
      ? {
          amount: money.amount,
          currency: draft.currency,
          paidBy: money.paidBy,
          splitBetween: money.splitBetween,
          splitMethod: draft.splitMethod,
        }
      : {}),
  });
  return JSON.stringify(patch);
}
