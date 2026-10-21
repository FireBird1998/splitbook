/** Export previews: bounded table samples and CSV text from the download builders. */
import { z } from 'zod';
import type { Statement } from './statement';
import { serializeCsv, spreadsheetCellText, type CsvTable } from './export-csv';
import { isCalendarDay, isTimeZone } from './export-request';
const day = z.string().refine(isCalendarDay).nullable();

export const EXPORT_PREVIEW_ROWS = 5;
/**
 * The most CSV one preview file carries as Text, in UTF-8 bytes (256 KB). A preview is read again
 * on every settled change of the selection, and a serverless reply is capped at about 4.5 MB, so a
 * larger file's Text is left out: its download has every row.
 */
export const EXPORT_PREVIEW_TEXT_BYTES = 256 * 1024;
/** The most CSV Text one preview reply carries across all its files, in UTF-8 bytes (1 MB). */
export const EXPORT_PREVIEW_TEXT_TOTAL_BYTES = 1024 * 1024;
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
      /** The download's exact bytes; absent past either Text budget (`buildCsvPreviews`). */
      text: z.string().optional(),
    }),
  ),
});
const count = z.number().int().nonnegative();
export const backupPreviewSchema = z.object({
  ...common,
  format: z.literal('json'),
  currencyGroups: z
    .array(
      z.object({
        name: z.string(),
        currency: z.string(),
        alternateCurrencies: z.array(z.string()),
      }),
    )
    .optional(),
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

/** How many bytes `text` takes in UTF-8, as the download is encoded; a lone surrogate takes 3. */
function utf8Bytes(text: string) {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * A reply's files, in preview order. Both views use the download's table. Text is the download's
 * exact bytes, every row with the BOM and CRLF. A file over `EXPORT_PREVIEW_TEXT_BYTES` has none
 * and takes none of the reply's `EXPORT_PREVIEW_TEXT_TOTAL_BYTES`; from the first file that would
 * pass that total, no later file has Text either.
 */
export function buildCsvPreviews(tables: readonly CsvTable[]) {
  let left = EXPORT_PREVIEW_TEXT_TOTAL_BYTES;
  return tables.map((table) => {
    const text = serializeCsv(table.header, table.rows);
    const bytes = utf8Bytes(text);
    const fits = bytes <= EXPORT_PREVIEW_TEXT_BYTES;
    const kept = fits && bytes <= left;
    if (fits) left = kept ? left - bytes : 0;
    return {
      header: table.header.map(spreadsheetCellText),
      rows: table.rows.slice(0, EXPORT_PREVIEW_ROWS).map((row) => row.map(spreadsheetCellText)),
      totalRows: table.rows.length,
      ...(kept ? { text } : {}),
    };
  });
}
