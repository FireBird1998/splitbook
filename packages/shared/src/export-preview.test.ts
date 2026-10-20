import { describe, expect, it } from 'vitest';
import { buildStatement } from './statement';
import { buildCsvPreviews, buildStatementPreview } from './export-preview';
import { serializeCsv, type CsvTable } from './export-csv';

/** A reply with this one file. */
const buildCsvPreview = (table: CsvTable) => buildCsvPreviews([table])[0];
import type { BackupGroupInput } from './export-backup';

const group: BackupGroupInput = {
  id: 'g',
  name: 'Preview Trip',
  theme: 'trip',
  currency: 'INR',
  tags: [],
  members: [
    { id: 'a', name: 'Alice' },
    { id: 'b', name: 'Bob' },
  ],
  names: { a: 'Alice', b: 'Bob' },
  expenses: ['INR', 'USD'].map((currency) => ({
    id: currency,
    date: '2026-09-01',
    description: 'Lunch',
    category: 'food',
    tag: 'Meals',
    currency,
    amountMinor: 101,
    splitMethod: 'equal',
    paidBy: [{ userId: 'a', amountMinor: 101 }],
    splitBetween: [
      { userId: 'a', amountMinor: 51 },
      { userId: 'b', amountMinor: 50 },
    ],
  })),
  settlements: [
    {
      id: 'p',
      at: '2026-09-02T12:00:00Z',
      fromId: 'b',
      toId: 'a',
      currency: 'INR',
      amountMinor: 20,
      recordedById: 'b',
    },
  ],
};

describe('export preview content', () => {
  it('preserves statement balances, Suggested payments and Expense allocations per currency', () => {
    const preview = buildStatementPreview(buildStatement(group));
    const [inr, usd] = preview.currencies;
    expect(inr.people.map((p) => p.balanceMinor)).toEqual([30, -30]);
    expect(usd.people.map((p) => p.balanceMinor)).toEqual([50, -50]);
    expect(inr.suggestedPayments).toEqual([{ from: 'b', to: 'a', amountMinor: 30 }]);
    expect(usd.suggestedPayments).toEqual([{ from: 'b', to: 'a', amountMinor: 50 }]);
    expect(inr.expenses[0].paidBy).toEqual([{ userId: 'a', amountMinor: 101 }]);
    expect(inr.expenses[0].splitBetween).toEqual([
      { userId: 'a', amountMinor: 51 },
      { userId: 'b', amountMinor: 50 },
    ]);
    const period = buildStatementPreview(
      buildStatement(group, { from: '2026-10-01', to: '2026-10-31' }),
    );
    expect(period.currencies[0].spentMinor).toBe(0);
    expect(period.currencies[0].people.map((p) => p.balanceMinor)).toEqual([30, -30]);
    expect(period.currencies[0].suggestedPayments).toEqual(inr.suggestedPayments);
  });

  it('CSV Text preserves the full download bytes beyond the five table rows', () => {
    const preview = buildCsvPreview({
      header: ['Description', 'Amount'],
      rows: [
        ['=SUM(1)', '1.01'],
        ['a,b', '2.00'],
        ['say "hi"', '3.00'],
        ['line\nbreak', '4.00'],
        ['five', '5.00'],
        ['six', '6.00'],
      ],
    });
    expect(preview.rows).toHaveLength(5);
    expect(preview.totalRows).toBe(6);
    expect(preview.text).toBe(
      '\uFEFFDescription,Amount\r\n\'=SUM(1),1.01\r\n"a,b",2.00\r\n"say ""hi""",3.00\r\n"line\nbreak",4.00\r\nfive,5.00\r\nsix,6.00\r\n',
    );
  });
});

describe('CSV Text in a preview reply is bounded (#698)', () => {
  /**
   * 5,461 rows of `cell`. With 46 ASCII characters each, the header and the BOM (one character,
   * three bytes in UTF-8), the file is 262,142 characters: 262,144 bytes.
   */
  const rows = (cell: string) => Array.from({ length: 5461 }, () => [cell]);

  it('is the exact download bytes for a file of up to 256 KB', () => {
    const table = { header: ['Description'], rows: rows('x'.repeat(46)) };
    const preview = buildCsvPreview(table);
    expect(preview.text).toHaveLength(262_142);
    expect(preview.text).toBe(serializeCsv(table.header, table.rows));
  });

  it('is left out for a file over 256 KB, counted in UTF-8 bytes, while the table sample stays', () => {
    const table = { header: ['Description'], rows: rows('x'.repeat(46)) };
    table.rows[0] = ['x'.repeat(47)];
    // One byte over: 262,145 bytes.
    expect(serializeCsv(table.header, table.rows)).toHaveLength(262_143);
    const over = buildCsvPreview(table);
    expect(over.text).toBeUndefined();
    expect(over.rows).toHaveLength(5);
    expect(over.totalRows).toBe(5461);
    // "₹" is one character but three bytes: 262,142 characters, 764,556 bytes.
    const rupees = { header: ['Description'], rows: rows('₹'.repeat(46)) };
    expect(serializeCsv(rupees.header, rupees.rows)).toHaveLength(262_142);
    expect(buildCsvPreview(rupees).text).toBeUndefined();
  });
});

describe('CSV Text across a preview reply’s files is bounded too (#698)', () => {
  /** A file of 262,144 bytes, at the per-file limit (see above). */
  const full = (cell = 'x') => ({
    header: ['Description'],
    rows: Array.from({ length: 5461 }, () => [cell.repeat(46)]),
  });
  const small = { header: ['Description'], rows: [['Lunch']] };
  const texts = (tables: Parameters<typeof buildCsvPreviews>[0]) =>
    buildCsvPreviews(tables).map((preview) => preview.text);

  it('gives Text in order while the reply stays within 1 MB, and none from the file that would pass it', () => {
    // Four full files are 1,048,576 bytes, the whole budget: the fifth would pass it, and the
    // small file after it gets none either.
    const tables = [full('a'), full('b'), full('c'), full('d'), full('e'), small];
    expect(texts(tables)).toEqual([
      serializeCsv(tables[0].header, tables[0].rows),
      serializeCsv(tables[1].header, tables[1].rows),
      serializeCsv(tables[2].header, tables[2].rows),
      serializeCsv(tables[3].header, tables[3].rows),
      undefined,
      undefined,
    ]);
    // Each file keeps its table sample.
    expect(buildCsvPreviews(tables).map((preview) => preview.totalRows)).toEqual([
      5461, 5461, 5461, 5461, 5461, 1,
    ]);
  });

  it('keeps every file’s exact bytes for a reply within 1 MB', () => {
    const tables = [full('a'), small, full('b'), full('c')];
    expect(texts(tables)).toEqual(tables.map((table) => serializeCsv(table.header, table.rows)));
  });

  it('leaves out only the Text of a file over 256 KB, which takes none of the budget', () => {
    const over = full('x');
    over.rows[0] = ['x'.repeat(47)];
    const tables = [over, full('a'), full('b'), full('c'), full('d')];
    expect(texts(tables)).toEqual([
      undefined,
      ...tables.slice(1).map((table) => serializeCsv(table.header, table.rows)),
    ]);
  });
});
