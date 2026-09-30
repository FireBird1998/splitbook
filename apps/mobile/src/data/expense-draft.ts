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
import { normalizeExpenseMoney, parseDecimalUnits } from '@splitbook/shared/exact-money';
import { getCurrency } from '@splitbook/shared/currency';
import { parseGroupResponse } from '@splitbook/shared/group-read';
import { objectId, toMobileGroup } from './dto';
import type { MobileGroup } from './types';
import { idleReceiptScan, type ReceiptScanState } from './receipt-scan';

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
  /** The receipt-scanning experiment's review, bound to this editor's account, Group and draft. */
  receiptScan: ReceiptScanState;
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
    receiptScan: idleReceiptScan,
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
  const input = {
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
  return draft.original
    ? decideExpenseMoneyEdit(storedExpenseMoney(draft.original), input).money
    : normalizeExpenseMoney(input);
}
export function previewExpense(draft: ExpenseDraft): ExpenseEditor['preview'] {
  try {
    return expenseMoney(draft).splitBetween;
  } catch {
    return null;
  }
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

export function buildExpensePatch(draft: ExpenseDraft, context: ExpenseContext): string {
  const original = draft.original;
  if (!original || original.isDeleted) throw new Error('This Expense is deleted.');
  const money = expenseMoney(draft);
  const financial = decideExpenseMoneyEdit(storedExpenseMoney(original), {
    ...money,
    splitMethod: draft.splitMethod,
  }).financialEdit;
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
