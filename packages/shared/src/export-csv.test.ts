import { describe, expect, it } from 'vitest';
import {
  CSV_BOM,
  DELETED_COLUMNS,
  EDIT_COLUMNS,
  EXPENSE_COLUMNS,
  FORMER_MEMBER,
  PAYMENT_COLUMNS,
  buildExpenseCsv,
  buildPaymentCsv,
  csvCell,
  describeEdit,
  expenseDay,
  formatMinorAmount,
  serializeCsv,
  zonedDay,
  zonedTimestamp,
  type ExpenseCsvOptions,
  type ExportExpense,
} from './export-csv';

/*
 * The CSV files of an export (#317): escaping, the documented column order, exact amounts in
 * each currency's minor units, deleted Expenses and edit rows, and payments.
 */

const ALEX = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';
const PRIYA = 'a00000000000000000000003';
const GONE = 'a00000000000000000000009';
const NAMES: Record<string, string> = {
  [ALEX]: 'Alex Rivera',
  [SAM]: 'Sam Chen',
  [PRIYA]: 'Priya Shah',
};
const MEMBERS = [ALEX, SAM, PRIYA].map((id) => ({ id, name: NAMES[id] }));

const OFF: ExpenseCsvOptions = { shares: false, deleted: false, history: false, timeZone: 'UTC' };

/** A ₹2,860.00 electricity bill Sam paid, split three ways with the paisa left over to Sam. */
function bill(overrides: Partial<ExportExpense> = {}): ExportExpense {
  return {
    id: 'c00000000000000000000001',
    date: new Date('2026-09-29T00:00:00.000Z'),
    description: 'Electricity bill',
    category: 'housing',
    tag: 'Utilities',
    currency: 'INR',
    amountMinor: 286000,
    splitMethod: 'equal',
    notes: '',
    paidBy: [{ userId: SAM, amountMinor: 286000 }],
    splitBetween: [
      { userId: ALEX, amountMinor: 95333 },
      { userId: SAM, amountMinor: 95334 },
      { userId: PRIYA, amountMinor: 95333 },
    ],
    ...overrides,
  };
}

const table = (expenses: ExportExpense[], options: Partial<ExpenseCsvOptions> = {}) =>
  buildExpenseCsv({ expenses, members: MEMBERS, names: NAMES, options: { ...OFF, ...options } });

/** Each row as a record of header → cell, for reading one column at a time. */
function records(csv: { header: string[]; rows: string[][] }) {
  return csv.rows.map((row) => Object.fromEntries(csv.header.map((name, i) => [name, row[i]])));
}

describe('a cell', () => {
  it('is written as it is when it holds nothing special', () => {
    expect(csvCell('Weekly groceries')).toBe('Weekly groceries');
    expect(csvCell('₹ and € stay as they are')).toBe('₹ and € stay as they are');
    expect(csvCell('')).toBe('');
  });

  it('is quoted when it holds a comma, a quote or a line break, with quotes doubled', () => {
    expect(csvCell('Milk, bread')).toBe('"Milk, bread"');
    expect(csvCell('The "good" cheese')).toBe('"The ""good"" cheese"');
    expect(csvCell('Line one\nline two')).toBe('"Line one\nline two"');
    expect(csvCell('Line one\r\nline two')).toBe('"Line one\r\nline two"');
  });

  it('is kept from running as a formula: a leading =, +, -, @, tab or CR gets an apostrophe', () => {
    expect(csvCell('=HYPERLINK("http://example.test","x")')).toBe(
      `"'=HYPERLINK(""http://example.test"",""x"")"`,
    );
    expect(csvCell('+91 98765 43210')).toBe("'+91 98765 43210");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
    expect(csvCell('\tTabbed')).toBe("'\tTabbed");
    expect(csvCell('\rReturn')).toBe(`"'\rReturn"`);
    // Only at the start: inside a cell they are plain text.
    expect(csvCell('Dinner = 2400')).toBe('Dinner = 2400');
    expect(csvCell('a@b')).toBe('a@b');
  });
});

describe('a file', () => {
  it('starts with a byte-order mark and ends every line, the last too, with CRLF', () => {
    const text = serializeCsv(['Date', 'Description'], [['2026-09-29', 'Rent, September']]);
    expect(text.startsWith(CSV_BOM)).toBe(true);
    expect(text).toBe('﻿Date,Description\r\n2026-09-29,"Rent, September"\r\n');
  });

  it('with no rows is the header alone', () => {
    expect(serializeCsv(['Date'], [])).toBe('﻿Date\r\n');
  });
});

describe('an amount', () => {
  it('is exact, in its currency’s minor units, with no grouping or symbol', () => {
    expect(formatMinorAmount(124950, 'INR')).toBe('1249.50');
    expect(formatMinorAmount(1_000_000_000, 'INR')).toBe('10000000.00');
    expect(formatMinorAmount(5, 'EUR')).toBe('0.05');
    expect(formatMinorAmount(0, 'USD')).toBe('0.00');
    expect(formatMinorAmount(2400, 'JPY')).toBe('2400');
    expect(formatMinorAmount(15000, 'KRW')).toBe('15000');
    expect(formatMinorAmount(-1250, 'EUR')).toBe('-12.50');
  });

  it('refuses an amount it can’t hold exactly, or a currency it doesn’t know', () => {
    expect(() => formatMinorAmount(0.5, 'INR')).toThrow();
    expect(() => formatMinorAmount(Number.MAX_SAFE_INTEGER + 2, 'INR')).toThrow();
    expect(() => formatMinorAmount(100, 'XXX')).toThrow('INVALID_CURRENCY');
  });
});

describe('days and times', () => {
  it('reads an Expense’s day in UTC, where its calendar day is stored', () => {
    expect(expenseDay(new Date('2026-09-01T00:00:00.000Z'))).toBe('2026-09-01');
    expect(expenseDay('2026-09-30T00:00:00.000Z')).toBe('2026-09-30');
  });

  it('writes a moment as the viewer’s day and wall clock, with the offset', () => {
    // 20:00 UTC on 31 August: 1 September in Kolkata, still 31 August in New York.
    const at = new Date('2026-08-31T20:00:00.000Z');
    expect(zonedDay(at, 'Asia/Kolkata')).toBe('2026-09-01');
    expect(zonedDay(at, 'America/New_York')).toBe('2026-08-31');
    expect(zonedTimestamp(at, 'Asia/Kolkata')).toBe('2026-09-01T01:30:00+05:30');
    expect(zonedTimestamp(at, 'America/New_York')).toBe('2026-08-31T16:00:00-04:00');
    expect(zonedTimestamp(at, 'UTC')).toBe('2026-08-31T20:00:00+00:00');
    expect(zonedTimestamp(new Date('2026-12-31T23:59:59.900Z'), 'Pacific/Kiritimati')).toBe(
      '2027-01-01T13:59:59+14:00',
    );
  });

  it('follows daylight saving time: the same zone, two offsets', () => {
    expect(zonedTimestamp(new Date('2026-01-15T12:00:00Z'), 'Europe/Lisbon')).toBe(
      '2026-01-15T12:00:00+00:00',
    );
    expect(zonedTimestamp(new Date('2026-07-15T12:00:00Z'), 'Europe/Lisbon')).toBe(
      '2026-07-15T13:00:00+01:00',
    );
  });
});

describe('the Expenses CSV', () => {
  it('has the documented columns, in order', () => {
    expect(EXPENSE_COLUMNS).toEqual([
      'Date',
      'Description',
      'Category',
      'Tag',
      'Paid by',
      'Split',
      'Amount',
      'Currency',
      'Notes',
      'Expense ID',
    ]);
    expect(table([bill()]).header).toEqual([...EXPENSE_COLUMNS]);
  });

  it('writes one row per Expense, names instead of ids, and the amount with its currency', () => {
    expect(table([bill({ notes: 'Two months, estimated' })]).rows).toEqual([
      [
        '2026-09-29',
        'Electricity bill',
        'Housing',
        'Utilities',
        'Sam Chen',
        'Equally',
        '2860.00',
        'INR',
        'Two months, estimated',
        'c00000000000000000000001',
      ],
    ]);
  });

  it('names every payer, with what each paid, when several paid', () => {
    const shared = bill({
      paidBy: [
        { userId: ALEX, amountMinor: 200000 },
        { userId: SAM, amountMinor: 86000 },
      ],
    });
    expect(records(table([shared]))[0]['Paid by']).toBe('Alex Rivera 2000.00, Sam Chen 860.00');
  });

  it('keeps each Expense in its own currency, never converted (a legacy Group mixing two)', () => {
    const rows = records(
      table([
        bill(),
        bill({
          id: 'c00000000000000000000002',
          description: 'Ferry',
          currency: 'EUR',
          amountMinor: 1250,
          paidBy: [{ userId: ALEX, amountMinor: 1250 }],
          splitBetween: [{ userId: ALEX, amountMinor: 1250 }],
        }),
        bill({
          id: 'c00000000000000000000003',
          description: 'Ramen',
          currency: 'JPY',
          amountMinor: 2400,
          paidBy: [{ userId: ALEX, amountMinor: 2400 }],
          splitBetween: [{ userId: ALEX, amountMinor: 2400 }],
        }),
      ]),
    );
    expect(rows.map((row) => [row.Amount, row.Currency])).toEqual([
      ['2860.00', 'INR'],
      ['12.50', 'EUR'],
      ['2400', 'JPY'],
    ]);
  });

  it('calls the split by the app’s names', () => {
    const methods = ['equal', 'unequal', 'exact', 'percentage', 'shares'] as const;
    const rows = records(table(methods.map((splitMethod) => bill({ splitMethod }))));
    expect(rows.map((row) => row.Split)).toEqual([
      'Equally',
      'Exact amounts',
      'Exact amounts',
      'Percentages',
      'Shares',
    ]);
  });

  it('names someone whose account is gone as a former member, never by id', () => {
    const csv = table([bill({ paidBy: [{ userId: GONE, amountMinor: 286000 }] })]);
    expect(records(csv)[0]['Paid by']).toBe(FORMER_MEMBER);
    expect(csv.rows.flat().join()).not.toContain(GONE);
  });

  describe('with shares per person', () => {
    it('adds a column per member, in the Group’s order, with each exact share', () => {
      const csv = table([bill()], { shares: true });
      expect(csv.header).toEqual([
        ...EXPENSE_COLUMNS,
        'Alex Rivera share',
        'Sam Chen share',
        'Priya Shah share',
      ]);
      // The leftover paisa stays where the ledger put it.
      expect(csv.rows[0].slice(-3)).toEqual(['953.33', '953.34', '953.33']);
    });

    it('writes 0 for a member outside the split, and adds a column for anyone else sharing', () => {
      const lunch = bill({
        splitBetween: [
          { userId: ALEX, amountMinor: 143000 },
          { userId: GONE, amountMinor: 143000 },
        ],
      });
      const csv = table([lunch], { shares: true });
      expect(csv.header.slice(EXPENSE_COLUMNS.length)).toEqual([
        'Alex Rivera share',
        'Sam Chen share',
        'Priya Shah share',
        'Former member share',
      ]);
      expect(csv.rows[0].slice(EXPENSE_COLUMNS.length)).toEqual([
        '1430.00',
        '0.00',
        '0.00',
        '1430.00',
      ]);
    });

    it('tells two people with one name apart', () => {
      const csv = buildExpenseCsv({
        expenses: [
          bill({
            splitBetween: [
              { userId: ALEX, amountMinor: 143000 },
              { userId: SAM, amountMinor: 143000 },
            ],
          }),
        ],
        members: [
          { id: ALEX, name: 'Sam' },
          { id: SAM, name: 'Sam' },
        ],
        names: { [ALEX]: 'Sam', [SAM]: 'Sam' },
        options: { ...OFF, shares: true },
      });
      expect(csv.header.slice(EXPENSE_COLUMNS.length)).toEqual(['Sam share', 'Sam (2) share']);
    });
  });

  describe('deleted Expenses', () => {
    const deleted = bill({
      id: 'c00000000000000000000004',
      description: 'Duplicate Wi-Fi',
      deleted: { at: new Date('2026-09-30T05:00:00.000Z'), byId: PRIYA },
    });

    it('are left out unless asked for', () => {
      const csv = table([bill(), deleted]);
      expect(csv.rows.map((row) => row[1])).toEqual(['Electricity bill']);
      expect(csv.header).not.toContain('Deleted at');
    });

    it('are rows of their own when asked for, saying when and by whom', () => {
      const csv = table([bill(), deleted], { deleted: true, timeZone: 'Asia/Kolkata' });
      expect(csv.header).toEqual([...EXPENSE_COLUMNS, ...DELETED_COLUMNS]);
      expect(
        records(csv).map((row) => [row.Description, row['Deleted at'], row['Deleted by']]),
      ).toEqual([
        ['Electricity bill', '', ''],
        ['Duplicate Wi-Fi', '2026-09-30T10:30:00+05:30', 'Priya Shah'],
      ]);
      expect(records(csv)[1].Amount).toBe('2860.00');
    });

    it('give a deleted Expense’s sharers no column unless deleted Expenses are included', () => {
      const lonely = { ...deleted, splitBetween: [{ userId: GONE, amountMinor: 286000 }] };
      expect(table([bill(), lonely], { shares: true }).header).not.toContain('Former member share');
      expect(table([bill(), lonely], { shares: true, deleted: true }).header).toContain(
        'Former member share',
      );
    });
  });

  describe('edit history', () => {
    const edited = bill({
      edits: [
        {
          at: new Date('2026-09-30T06:15:00.000Z'),
          byId: ALEX,
          changes: { tag: { old: 'Bills', new: 'Utilities' } },
        },
        {
          at: new Date('2026-09-29T18:40:00.000Z'),
          byId: PRIYA,
          changes: {
            amount: { old: 2680, new: 2860 },
            amountMinor: { old: 268000, new: 286000 },
          },
        },
      ],
    });

    it('adds a row per edit after its Expense, oldest first, with no amount to double count', () => {
      const csv = table([edited, bill({ id: 'c00000000000000000000005', description: 'Wi-Fi' })], {
        history: true,
        timeZone: 'Asia/Kolkata',
      });
      expect(csv.header).toEqual([...EXPENSE_COLUMNS, ...EDIT_COLUMNS]);
      expect(
        records(csv).map((row) => [
          row.Description,
          row.Amount,
          row['Edited at'],
          row['Edited by'],
          row.Change,
        ]),
      ).toEqual([
        ['Electricity bill', '2860.00', '', '', ''],
        [
          'Electricity bill',
          '',
          '2026-09-30T00:10:00+05:30',
          'Priya Shah',
          'Amount: 2680.00 → 2860.00',
        ],
        [
          'Electricity bill',
          '',
          '2026-09-30T11:45:00+05:30',
          'Alex Rivera',
          'Tag: Bills → Utilities',
        ],
        ['Wi-Fi', '2860.00', '', '', ''],
      ]);
      const editRow = records(csv)[1];
      expect(editRow['Expense ID']).toBe('c00000000000000000000001');
      expect(editRow.Date).toBe('2026-09-29');
    });

    it('keeps every option’s columns in place, edits last', () => {
      const csv = table([edited], { shares: true, deleted: true, history: true });
      expect(csv.header).toEqual([
        ...EXPENSE_COLUMNS,
        'Alex Rivera share',
        'Sam Chen share',
        'Priya Shah share',
        ...DELETED_COLUMNS,
        ...EDIT_COLUMNS,
      ]);
      for (const row of csv.rows) expect(row).toHaveLength(csv.header.length);
      // An edit row leaves the shares and deletion blank too.
      expect(csv.rows[1].slice(EXPENSE_COLUMNS.length, -3)).toEqual(['', '', '', '', '']);
    });

    it('describes each change by name, with exact amounts and people named', () => {
      const name = (id: string) => NAMES[id] ?? FORMER_MEMBER;
      expect(
        describeEdit(
          {
            description: { old: 'Power', new: 'Electricity bill' },
            amountMinor: { old: 268000, new: 286000 },
            amount: { old: 2680, new: 2860 },
            date: { old: '2026-09-28T00:00:00.000Z', new: new Date('2026-09-29T00:00:00Z') },
            category: { old: 'other', new: 'housing' },
            paidBy: {
              old: [{ user: ALEX, amount: 2680, amountMinor: 268000 }],
              new: [{ user: SAM, amount: 2860, amountMinor: 286000 }],
            },
            splitMethod: { old: 'equal', new: 'shares' },
            notes: { old: '', new: 'Estimated' },
            tagId: { old: 'x', new: 'y' },
            moneyVersion: { old: undefined, new: 1 },
          },
          'INR',
          name,
        ),
      ).toBe(
        'Description: Power → Electricity bill; Amount: 2680.00 → 2860.00; ' +
          'Date: 2026-09-28 → 2026-09-29; Category: Other → Housing; ' +
          'Paid by: Alex Rivera 2680.00 → Sam Chen 2860.00; Split: Equally → Shares; ' +
          'Notes: (none) → Estimated',
      );
    });

    it('reads a legacy decimal amount exactly, and names both currencies when they changed', () => {
      expect(describeEdit({ amount: { old: 899, new: 999.5 } }, 'INR', () => '')).toBe(
        'Amount: 899.00 → 999.50',
      );
      expect(
        describeEdit(
          {
            amount: { old: 12.5, new: 1100 },
            currency: { old: 'EUR', new: 'INR' },
          },
          'INR',
          () => '',
        ),
      ).toBe('Amount: 12.50 EUR → 1100.00 INR; Currency: EUR → INR');
    });

    it('names payers and sharers from stored ids, never an email or a raw object', () => {
      const text = describeEdit(
        {
          splitBetween: {
            old: [{ user: { _id: ALEX, email: 'alex@example.test' }, amountMinor: 100 }],
            new: [{ user: SAM, amountMinor: 100 }],
          },
        },
        'INR',
        (id) => NAMES[id] ?? FORMER_MEMBER,
      );
      expect(text).toBe('Shares: Alex Rivera 1.00 → Sam Chen 1.00');
      expect(text).not.toContain('@');
    });

    it('says "Other details" for an edit to nothing it can show', () => {
      expect(describeEdit({ tagId: { old: 'a', new: 'b' } }, 'INR', () => '')).toBe(
        'Other details',
      );
    });
  });

  it('serialises to a file a spreadsheet reads back cell for cell', () => {
    const tricky = bill({ description: '=1+1, "quoted"\nand split', notes: '@home' });
    const text = serializeCsv(table([tricky]).header, table([tricky]).rows);
    expect(text).toContain(`"'=1+1, ""quoted""\nand split"`);
    expect(text).toContain(",'@home,");
  });
});

describe('the payments CSV', () => {
  it('has the documented columns, in order', () => {
    expect(PAYMENT_COLUMNS).toEqual([
      'Date',
      'Recorded at',
      'From',
      'To',
      'Amount',
      'Currency',
      'Note',
      'Recorded by',
      'Payment ID',
    ]);
  });

  it('writes who paid whom, exactly, on the viewer’s day, and who recorded it', () => {
    const csv = buildPaymentCsv({
      payments: [
        {
          id: 'd00000000000000000000001',
          at: new Date('2026-08-31T20:00:00.000Z'),
          fromId: ALEX,
          toId: SAM,
          amountMinor: 106000,
          currency: 'INR',
          note: 'Rent, August',
          recordedById: SAM,
        },
        {
          id: 'd00000000000000000000002',
          at: '2026-09-02T09:00:00.000Z',
          fromId: GONE,
          toId: PRIYA,
          amountMinor: 1250,
          currency: 'EUR',
          recordedById: PRIYA,
        },
      ],
      names: NAMES,
      timeZone: 'Asia/Kolkata',
    });
    expect(csv.header).toEqual([...PAYMENT_COLUMNS]);
    expect(csv.rows).toEqual([
      [
        '2026-09-01',
        '2026-09-01T01:30:00+05:30',
        'Alex Rivera',
        'Sam Chen',
        '1060.00',
        'INR',
        'Rent, August',
        'Sam Chen',
        'd00000000000000000000001',
      ],
      [
        '2026-09-02',
        '2026-09-02T14:30:00+05:30',
        FORMER_MEMBER,
        'Priya Shah',
        '12.50',
        'EUR',
        '',
        'Priya Shah',
        'd00000000000000000000002',
      ],
    ]);
  });
});
