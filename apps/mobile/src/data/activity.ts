import { z } from 'zod';
import { getCurrency } from '@splitbook/shared/currency';
import { parseAmountMinor } from '@splitbook/shared/exact-money';
import { objectId } from './dto';
import type { LoadStatus } from './types';

const metadata = z.object({
  userId: objectId.optional(),
  method: z.string().optional(),
  expenseId: objectId.optional(),
  settlementId: objectId.optional(),
  description: z.string().optional(),
  amount: z.number().finite().optional(),
  currency: z
    .string()
    .refine((value) => !!getCurrency(value))
    .optional(),
  paidByName: z.string().optional(),
  paidToName: z.string().optional(),
  recurring: z.boolean().optional(),
  action: z.string().optional(),
  changes: z
    .record(z.string(), z.object({ old: z.unknown().optional(), new: z.unknown().optional() }))
    .optional(),
});
const eventSchema = z.object({
  _id: objectId,
  group: objectId,
  type: z.string().min(1),
  actor: z
    .union([objectId, z.object({ _id: objectId, name: z.string().optional() }), z.null()])
    .transform((value) =>
      typeof value === 'string' ? { _id: value, name: 'Former member' } : value,
    ),
  createdAt: z.iso.datetime({ offset: true }),
  metadata: metadata.nullish().transform((value) => value ?? {}),
});
export type ActivityEvent = z.infer<typeof eventSchema>;
export interface ActivityState {
  selected: ActivityEvent | null;
  target: {
    status: 'none' | 'loading' | 'available' | 'deleted' | 'unavailable' | 'error';
    description?: string;
    updatedAt?: string;
  };
  groupId: string | null;
  status: LoadStatus;
  events: ActivityEvent[];
  pagination: { page: number; limit: number; total: number; totalPages: number } | null;
  message: string | null;
  moreStatus: 'idle' | 'loading' | 'error';
}
export function emptyActivity(): ActivityState {
  return {
    selected: null,
    target: { status: 'none' },
    groupId: null,
    status: 'idle',
    events: [],
    pagination: null,
    message: null,
    moreStatus: 'idle',
  };
}
export function parseActivityPage(value: unknown, groupId: string, requestedPage: number) {
  const data = z
    .object({
      status: z.literal(200),
      data: z.object({
        activities: z.array(eventSchema),
        pagination: z.object({
          page: z.number().int().positive(),
          limit: z.literal(20),
          total: z.number().int().nonnegative(),
          totalPages: z.number().int().nonnegative(),
        }),
      }),
    })
    .parse(value).data;
  if (
    data.pagination.page !== requestedPage ||
    data.activities.some((event) => event.group !== groupId)
  )
    throw new Error('Unexpected Activity scope');
  for (const event of data.activities) {
    const { amount, currency } = event.metadata;
    if (amount !== undefined && currency !== undefined) parseAmountMinor(amount, currency);
  }
  return {
    events: [...new Map(data.activities.map((event) => [event._id, event])).values()],
    pagination: data.pagination,
  };
}

/** The Expense an event is about, when it names one. */
export const activityExpenseId = (event: ActivityEvent) =>
  event.type.startsWith('expense_') ? event.metadata.expenseId : undefined;

export function parseActivityExpense(value: unknown, groupId: string, expenseId: string) {
  const record = z
    .object({
      status: z.literal(200),
      data: z.object({
        _id: objectId,
        group: objectId,
        description: z.string(),
        isDeleted: z.boolean(),
        updatedAt: z.iso.datetime({ offset: true }),
      }),
    })
    .parse(value).data;
  if (record._id !== expenseId || record.group !== groupId)
    throw new Error('Unexpected Activity target');
  return {
    status: record.isDeleted ? ('deleted' as const) : ('available' as const),
    description: record.description,
    updatedAt: record.updatedAt,
  };
}
