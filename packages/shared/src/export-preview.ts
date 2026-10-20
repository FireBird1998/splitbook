/** Export previews: bounded table samples and complete CSV text from the download builders. */
import { z } from 'zod';
import type { Statement } from './statement';
import { serializeCsv, spreadsheetCellText, type CsvTable } from './export-csv';
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
      text: z.string(),
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
  paymentsIncluded: z.boolean(),
  deletedExpensesIncluded: z.boolean(),
  counts: z.object({
    members: count,
    expenses: count,
    payments: count,
    deletedExpenses: count,
    editHistoryEntries: count,
  }),
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
            balanceMinor: minor,
          }),
        ),
        suggestedPayments: z.array(
          z.object({ from: z.string(), to: z.string(), amountMinor: minor }),
        ),
        expenses: z
          .array(
            z.object({
              id: z.string(),
              date: z.string(),
              description: z.string(),
              tag: z.string(),
              amountMinor: minor,
              paidBy: z.array(z.object({ userId: z.string(), amountMinor: minor })),
              splitBetween: z.array(z.object({ userId: z.string(), amountMinor: minor })),
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

/** Project the printed statement without recomputing any money. */
export function buildStatementPreview(statement: Statement) {
  return statementPreviewSchema.shape.statement.parse({
    ...statement,
    currencies: statement.currencies.map((bucket) => ({
      ...bucket,
      paymentCount: bucket.payments.length,
      expenses: bucket.expenses.slice(0, EXPORT_PREVIEW_ROWS),
    })),
  });
}

/** Both views use the download's table; raw text includes every row, BOM and CRLF. */
export function buildCsvPreview(table: CsvTable) {
  return {
    header: table.header.map(spreadsheetCellText),
    rows: table.rows.slice(0, EXPORT_PREVIEW_ROWS).map((row) => row.map(spreadsheetCellText)),
    totalRows: table.rows.length,
    text: serializeCsv(table.header, table.rows),
  };
}
