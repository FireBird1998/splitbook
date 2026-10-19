/** Bounded JSON previews of the same export records and file formatting. */
import { z } from 'zod';
import { isCalendarDay, isTimeZone } from './export-request';
const day = z.string().refine(isCalendarDay).nullable();

export const EXPORT_PREVIEW_ROWS = 5;
const common = {
  groupNames: z.array(z.string()),
  generatedAt: z.iso.datetime(),
  from: day,
  to: day,
  timeZone: z.string().refine(isTimeZone),
  empty: z.boolean(),
};
export const csvPreviewSchema = z.object({
  ...common,
  format: z.literal('csv'),
  fileName: z.string(),
  files: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(['expenses', 'payments']),
      header: z.array(z.string()),
      rows: z.array(z.array(z.string())).max(EXPORT_PREVIEW_ROWS),
      totalRows: z.number().int().nonnegative(),
    }),
  ),
});
const count = z.number().int().nonnegative();
export const backupPreviewSchema = z.object({
  ...common,
  format: z.literal('json'),
  fileName: z.string(),
  sizeBytes: count,
  earliestMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .nullable(),
  historyIncluded: z.boolean(),
  counts: z.object({
    members: count,
    expenses: count,
    payments: count,
    deletedExpenses: count,
    editHistoryEntries: count,
    recurringExpenses: z.literal(0),
    activityEvents: z.literal(0),
  }),
  unsupported: z.tuple([z.literal('recurringExpenses'), z.literal('activityEvents')]),
});
const minor = z.number().int().refine(Number.isSafeInteger);
export const statementPreviewSchema = z.object({
  ...common,
  format: z.literal('statement'),
  statement: z.object({
    id: z.string(),
    name: z.string(),
    theme: z.enum(['trip', 'home', 'couple', 'work', 'other']),
    defaultCurrency: z.string(),
    from: day,
    to: day,
    timeZone: z.string().refine(isTimeZone),
    currencies: z.array(
      z.object({
        currency: z.string(),
        spentMinor: minor,
        expenseCount: count,
        paymentTotalMinor: minor,
        paymentCount: count,
        people: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            paidMinor: minor,
            shareMinor: minor,
            netMinor: minor,
          }),
        ),
        expenses: z
          .array(
            z.object({
              id: z.string(),
              date: z.string(),
              description: z.string(),
              tag: z.string(),
              amountMinor: minor,
            }),
          )
          .max(EXPORT_PREVIEW_ROWS),
      }),
    ),
  }),
});
export const exportPreviewSchema = z.discriminatedUnion('format', [
  csvPreviewSchema,
  backupPreviewSchema,
  statementPreviewSchema,
]);
export type ExportPreview = z.infer<typeof exportPreviewSchema>;
