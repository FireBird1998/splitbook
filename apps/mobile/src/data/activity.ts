import { z } from 'zod';
import { parseActivityPageResponse } from '@splitbook/shared/activity-page-read';
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
  /** When the events shown were read: the first page's time, which a saved copy keeps. */
  refreshedAt: number | null;
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
    refreshedAt: null,
  };
}
/** A saved Expense's own events: its Group's Activity, filtered to that Expense. */
export interface ExpenseHistoryState {
  expenseId: string | null;
  status: LoadStatus;
  events: ActivityEvent[];
  pagination: ActivityState['pagination'];
  message: string | null;
  moreStatus: 'idle' | 'loading' | 'error';
  /** The oldest verification time among the pages shown (#215): a saved copy keeps its own. */
  refreshedAt?: number | null;
  /**
   * The first page shown: past 1 once the changes have slid past 5 pages, when Load newer reads
   * the page before it (#220, M7-2). `pagination` is the last page shown.
   */
  firstPage?: number;
  /** Load newer, above the changes: reading the page before the window, or failed to. */
  newerStatus?: 'idle' | 'loading' | 'error';
  /** A page shown is this device's saved copy, not a read in this session: "Saved", not "Updated". */
  restored?: boolean;
}
export function emptyExpenseHistory(): ExpenseHistoryState {
  return {
    expenseId: null,
    status: 'idle',
    events: [],
    pagination: null,
    message: null,
    moreStatus: 'idle',
    refreshedAt: null,
    firstPage: 1,
    newerStatus: 'idle',
    restored: false,
  };
}
const PAGE_SIZE = 20;
/**
 * The shared decoder checks the page's fields (#211). `eventSchema` then reads each event as
 * Android shows it, in today's currencies only. With `expenseId`, every event must be about
 * that Expense.
 */
export function parseActivityPage(
  value: unknown,
  groupId: string,
  requestedPage: number,
  expenseId?: string,
) {
  const read = parseActivityPageResponse(value);
  const { page, limit, total, totalPages } = read.pagination;
  if (limit !== PAGE_SIZE) throw new Error('Unexpected Activity page size');
  const activities = read.activities.map((event) => eventSchema.parse(event));
  if (
    page !== requestedPage ||
    activities.some(
      (event) =>
        event.group !== groupId ||
        (expenseId !== undefined && event.metadata.expenseId !== expenseId),
    )
  )
    throw new Error('Unexpected Activity scope');
  for (const event of activities) {
    const { amount, currency } = event.metadata;
    if (amount !== undefined && currency !== undefined) parseAmountMinor(amount, currency);
  }
  return {
    events: [...new Map(activities.map((event) => [event._id, event])).values()],
    pagination: { page, limit: PAGE_SIZE, total, totalPages },
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
