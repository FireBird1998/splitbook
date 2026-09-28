import { createExpenseSchema } from '@splitbook/shared/validators/expense';
import {
  assertExpenseParticipants,
  assertGroupCurrency,
} from '@splitbook/shared/expense-validation';
import { resolveTagReference } from '@splitbook/shared/tag-identity';
import { z } from 'zod';
import { normalizeExpenseMoney, parseDecimalUnits } from '@splitbook/shared/exact-money';
import { getCurrency } from '@splitbook/shared/currency';
import { objectId, parseGroup } from './dto';
import type { MobileGroup } from './types';

export const expenseDraftSchema = z.object({
  amount: z.string().max(40),
  currency: z.string().refine((value) => !!getCurrency(value)),
  description: z.string().max(200),
  date: z.string().max(10),
  payerId: objectId,
  multiPayer: z.boolean().default(false),
  payers: z.array(z.object({ user: objectId, amount: z.string().max(40) })).default([]),
  splitMethod: z.enum(['equal', 'unequal', 'percentage', 'shares', 'exact']).default('equal'),
  splitValues: z.record(objectId, z.string().max(40)).default({}),
  participantIds: z.array(objectId),
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
export interface ExpenseEditor {
  groupId: string | null;
  context: ExpenseContext | null;
  draft: ExpenseDraft | null;
  preview: { user: unknown; amountMinor: number }[] | null;
  status: 'idle' | 'loading' | 'resume' | 'editing' | 'blocked' | 'saving' | 'uncertain' | 'saved';
  attempt: ExpenseAttempt | null;
  receiptId: string | null;
  persistence: 'saved' | 'saving' | 'error';
  message: string | null;
}
export interface ExpenseDraftStore {
  load(accountId: string, groupId: string): Promise<unknown | null>;
  save(accountId: string, groupId: string, value: unknown): Promise<void>;
  remove(accountId: string, groupId: string): Promise<void>;
  clear(): Promise<void>;
}
export function emptyExpenseEditor(): ExpenseEditor {
  return {
    groupId: null,
    context: null,
    draft: null,
    preview: null,
    status: 'idle',
    attempt: null,
    receiptId: null,
    persistence: 'saved',
    message: null,
  };
}
export function parseExpenseContext(value: unknown): ExpenseContext {
  const group = parseGroup(value);
  const tags = z
    .object({
      data: z.object({
        tags: z.array(
          z.object({
            _id: objectId,
            name: z.string().min(1),
            isArchived: z.boolean(),
            isDeleted: z.boolean().optional().default(false),
          }),
        ),
      }),
    })
    .parse(value).data.tags;
  return { group, tags: tags.map(({ _id, ...tag }) => ({ id: _id, ...tag })) };
}
export function parseStoredExpenseDraft(value: unknown, accountId: string, groupId: string) {
  const record = z
    .object({
      version: z.literal(1),
      accountId: z.literal(accountId),
      groupId: z.literal(groupId),
      draft: expenseDraftSchema,
      attempt: z
        .object({ key: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/), body: z.string() })
        .nullable()
        .optional()
        .default(null),
    })
    .parse(value);
  if (record.attempt) createExpenseSchema.parse(JSON.parse(record.attempt.body));
  return record;
}
/** Adapt text entry to the same exact-money command used by the web ledger. */
export function expenseMoney(draft: ExpenseDraft) {
  return normalizeExpenseMoney({
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
  });
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
