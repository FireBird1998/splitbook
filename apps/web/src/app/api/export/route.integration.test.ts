/**
 * Integration tests for the export read (`GET /api/export`, #317) against a real, isolated
 * MongoDB database (`splitbook-test-export-route`). Only the session is a stand-in; membership,
 * recurring Expenses, the window, the CSVs and the zip run against stored records.
 */

import { backupSchema } from '@splitbook/shared/export-backup';
import { unzipSync } from 'fflate';
import { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Group from '@/lib/models/Group';
import Expense from '@/lib/models/Expense';
import RecurringExpense from '@/lib/models/RecurringExpense';
import Settlement from '@/lib/models/Settlement';
import { ExportTooLargeError, exportService } from '@/lib/services/export.service';
import { expenseService } from '@/lib/services/expense.service';
import { groupService } from '@/lib/services/group.service';
import { recurringExpenseService } from '@/lib/services/recurring-expense.service';
import { settlementService } from '@/lib/services/settlement.service';
import { createTestUsers, TEST_USER_IDS } from '@/lib/test-utils/fixtures';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { exportPath } from '@splitbook/shared/api-paths';
import {
  DELETED_COLUMNS,
  EDIT_COLUMNS,
  EXPENSE_COLUMNS,
  PAYMENT_COLUMNS,
} from '@splitbook/shared/export-csv';
import type { ExportInclude, ExportRequest } from '@splitbook/shared/export-request';
import {
  expenseDateForPeriod,
  previousPeriod,
  toPeriod,
} from '@splitbook/shared/recurring-due-periods';
import { GET } from './route';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(async () =>
        session.userId
          ? { user: { id: session.userId, name: 'Tester', email: 'tester@splitbook-test.local' } }
          : null,
      ),
    },
  },
}));

const db = integrationTestDb('export-route');
const { alice, bob, carol, dave } = TEST_USER_IDS;

beforeAll(db.connect);
beforeEach(async () => {
  await db.reset();
  await createTestUsers('alice', 'bob', 'carol', 'dave');
  session.userId = null;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(db.teardown);

// ─── Requests ───────────────────────────────────────────

interface Answer {
  status: number;
  headers: Headers;
  bytes: Uint8Array;
}

async function request(userId: string | null, path: string): Promise<Answer> {
  session.userId = userId;
  const response = await GET(new Request(`http://localhost${path}`));
  return {
    status: response.status,
    headers: response.headers,
    bytes: new Uint8Array(await response.arrayBuffer()),
  };
}

const exportOf = (
  groupIds: string[],
  {
    include = [],
    from,
    to,
    timeZone = 'UTC',
  }: Partial<ExportRequest> & { include?: ExportInclude[] } = {},
) => exportPath({ groupIds, include, from, to, format: 'csv', timeZone });

const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
const json = (answer: Answer) => JSON.parse(decoder.decode(answer.bytes));

/** A CSV file read back cell by cell (RFC 4180), checking its byte-order mark and CRLFs. */
function parseCsv(text: string): string[][] {
  expect(text.charCodeAt(0), 'starts with a byte-order mark').toBe(0xfeff);
  const body = text.slice(1);
  expect(body.endsWith('\r\n')).toBe(true);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (quoted) {
      if (char === '"' && body[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\r' && body[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else {
      expect(char, 'a bare line break outside quotes').not.toBe('\n');
      cell += char;
    }
  }
  return rows;
}

/** A CSV answer as records of header → cell. */
function table(text: string) {
  const [header, ...rows] = parseCsv(text);
  for (const row of rows) expect(row).toHaveLength(header.length);
  return {
    header,
    records: rows.map((row) => Object.fromEntries(header.map((h, i) => [h, row[i]]))),
  };
}

/** A successful single-CSV answer. */
async function csv(userId: string, path: string) {
  const answer = await request(userId, path);
  expect(answer.status, decoder.decode(answer.bytes)).toBe(200);
  expect(answer.headers.get('content-type')).toBe('text/csv; charset=utf-8');
  const text = decoder.decode(answer.bytes);
  return { ...table(text), text, fileName: fileNameOf(answer) };
}

/** A successful zip answer: each file's text by name. */
async function zip(userId: string, path: string) {
  const answer = await request(userId, path);
  expect(answer.status, decoder.decode(answer.bytes)).toBe(200);
  expect(answer.headers.get('content-type')).toBe('application/zip');
  const files = Object.fromEntries(
    Object.entries(unzipSync(answer.bytes)).map(([name, bytes]) => [name, decoder.decode(bytes)]),
  );
  return { files, fileName: fileNameOf(answer) };
}

function fileNameOf(answer: Answer) {
  const disposition = answer.headers.get('content-disposition') ?? '';
  expect(disposition).toMatch(/^attachment; filename="[a-z0-9.-]+"$/);
  return /filename="([^"]+)"/.exec(disposition)![1];
}

// ─── Ledger ─────────────────────────────────────────────

async function createGroup(
  name: string,
  creator: string,
  members: string[] = [],
  { category = 'trip', currency = 'INR' }: { category?: 'trip' | 'home'; currency?: string } = {},
) {
  const group = await groupService.create(
    { name, category, defaultCurrency: currency, alternateCurrencies: [] },
    creator,
  );
  const groupId = String(group._id);
  for (const member of members) await groupService.addMember(groupId, member);
  return groupId;
}

const command = (
  description: string,
  amount: number,
  payer: string,
  members: string[],
  date = '2026-09-20',
) => ({
  description,
  amount,
  currency: 'INR',
  category: 'food',
  tag: 'General',
  date: new Date(date),
  paidBy: [{ user: payer, amount }],
  splitMethod: 'equal' as const,
  splitBetween: members.map((user) => ({ user })),
});

async function addExpense(groupId: string, actor: string, ...args: Parameters<typeof command>) {
  return String((await expenseService.create(groupId, command(...args), actor))._id);
}

const EMAIL = /@|splitbook-test\.local/;

// ─── Tests ──────────────────────────────────────────────

describe('GET /api/export', () => {
  it('sends a member one Group’s Expenses as a CSV: documented columns, names, exact amounts', async () => {
    const ferry = await createGroup('Ferry Trip', alice, [bob, carol]);
    await addExpense(
      ferry,
      alice,
      'Tickets, both ways',
      1000,
      alice,
      [alice, bob, carol],
      '2026-09-18',
    );
    await addExpense(ferry, bob, 'Snacks "on board"', 99.5, bob, [alice, bob], '2026-09-19');

    const { header, records, text, fileName } = await csv(bob, exportOf([ferry]));
    expect(fileName).toBe('ferry-trip-all-time-expenses.csv');
    expect(header).toEqual([...EXPENSE_COLUMNS]);
    expect(
      records.map((row) => [row.Date, row.Description, row['Paid by'], row.Amount, row.Currency]),
    ).toEqual([
      ['2026-09-19', 'Snacks "on board"', 'Bob Tester', '99.50', 'INR'],
      ['2026-09-18', 'Tickets, both ways', 'Alice Tester', '1000.00', 'INR'],
    ]);
    expect(records[1]).toMatchObject({
      Category: 'Food & Drink',
      Tag: 'General',
      Split: 'Equally',
    });
    expect(records[1]['Expense ID']).toMatch(/^[a-f\d]{24}$/);
    expect(text).not.toMatch(EMAIL);
  });

  it('refuses anyone signed out', async () => {
    const ferry = await createGroup('Ferry Trip', alice);
    const answer = await request(null, exportOf([ferry]));
    expect(answer.status).toBe(401);
    expect(json(answer)).toEqual({ error: 'Unauthorized', status: 401 });
  });

  describe('refuses the whole request, adding nothing, for a Group the member isn’t in', () => {
    it('one they never joined, one that doesn’t exist, or one of several', async () => {
      const ferry = await createGroup('Ferry Trip', alice, [bob]);
      const cabin = await createGroup('Cabin', carol);
      await addExpense(ferry, alice, 'Tickets', 300, alice, [alice, bob]);
      const missing = new Types.ObjectId().toHexString();
      for (const [actor, groups] of [
        [dave, [ferry]],
        [alice, [missing]],
        [bob, [ferry, cabin]],
      ] as const) {
        const answer = await request(actor, exportOf([...groups]));
        expect(answer.status).toBe(403);
        expect(json(answer)).toEqual({ error: 'Forbidden', status: 403 });
      }
      // Bob can export the Group he is in.
      expect((await csv(bob, exportOf([ferry]))).records).toHaveLength(1);
    });

    it('one they have left', async () => {
      const ferry = await createGroup('Ferry Trip', alice, [bob]);
      await addExpense(ferry, alice, 'Tickets', 300, alice, [alice]);
      expect((await csv(bob, exportOf([ferry]))).records).toHaveLength(1);

      await groupService.leave(ferry, bob);
      const answer = await request(bob, exportOf([ferry]));
      expect(answer.status).toBe(403);
      expect(json(answer)).toEqual({ error: 'Forbidden', status: 403 });
    });

    it('without adding due recurring Expenses to the Groups it could read', async () => {
      vi.stubEnv('RECURRING_EXPENSES_ENABLED', 'true');
      const { groupId, templateId } = await householdWithRentDue();
      const cabin = await createGroup('Cabin', carol);
      const answer = await request(alice, exportOf([groupId, cabin]));
      expect(answer.status).toBe(403);
      expect(await rentFor(templateId, CURRENT_PERIOD)).toBe(0);
    });
  });

  it('lets a member export an archived Group', async () => {
    const ferry = await createGroup('Ferry Trip', alice, [bob]);
    await addExpense(ferry, alice, 'Tickets', 300, alice, [alice, bob]);
    await groupService.archive(ferry, alice);
    const { records } = await csv(bob, exportOf([ferry]));
    expect(records.map((row) => row.Description)).toEqual(['Tickets']);
  });

  it('keeps every amount in its own currency in a legacy Group that mixed them, never converted', async () => {
    const legacy = await createGroup('Old Lisbon Trip', alice, [bob]);
    const raw = (description: string, amount: number, currency: string) => ({
      group: new Types.ObjectId(legacy),
      description,
      amount,
      currency,
      category: 'transport',
      date: new Date('2026-05-02T00:00:00Z'),
      paidBy: [{ user: new Types.ObjectId(alice), amount }],
      splitMethod: 'equal',
      splitBetween: [{ user: new Types.ObjectId(alice), amount }],
      tag: 'General',
      createdBy: new Types.ObjectId(alice),
      isDeleted: false,
      editHistory: [],
      createdAt: new Date('2026-05-02T10:00:00Z'),
      updatedAt: new Date('2026-05-02T10:00:00Z'),
    });
    await Expense.collection.insertMany([
      raw('Tram passes', 12.5, 'EUR'),
      raw('Airport taxi', 2150, 'INR'),
      raw('Ramen', 2400, 'JPY'),
    ]);
    const backup = backupSchema.parse(
      json(await request(bob, `/api/export?groups=${legacy}&format=json`)),
    );
    expect(backup.groups[0].expenses.map((row) => [row.currency, row.amountMinor]).sort()).toEqual([
      ['EUR', 1250],
      ['INR', 215000],
      ['JPY', 2400],
    ]);
    const statement = await exportService.statement(bob, {
      groupIds: [legacy],
      format: 'csv',
      include: [],
      timeZone: 'UTC',
    });
    expect(statement.currencies.map((row) => [row.currency, row.spentMinor])).toEqual([
      ['EUR', 1250],
      ['INR', 215000],
      ['JPY', 2400],
    ]);
    const { records } = await csv(bob, exportOf([legacy], { include: ['shares'] }));
    expect(
      records.map((row) => [row.Description, row.Amount, row.Currency, row['Alice Tester share']]),
    ).toEqual([
      ['Ramen', '2400', 'JPY', '2400'],
      ['Airport taxi', '2150.00', 'INR', '2150.00'],
      ['Tram passes', '12.50', 'EUR', '12.50'],
    ]);
  });

  describe('includes', () => {
    it('payments: a second CSV per Group, in one zip named after the Group', async () => {
      const ferry = await createGroup('Ferry Trip', alice, [bob]);
      await addExpense(ferry, alice, 'Tickets', 300, alice, [alice, bob]);
      await settlementService.create(
        ferry,
        { paidTo: alice, amount: 150, currency: 'INR', note: 'Tickets, settled' },
        bob,
      );
      const { files, fileName } = await zip(alice, exportOf([ferry], { include: ['payments'] }));
      expect(fileName).toBe('ferry-trip-all-time.zip');
      expect(Object.keys(files)).toEqual([
        'ferry-trip-all-time-expenses.csv',
        'ferry-trip-all-time-payments.csv',
      ]);
      const payments = table(files['ferry-trip-all-time-payments.csv']);
      expect(payments.header).toEqual([...PAYMENT_COLUMNS]);
      expect(payments.records).toEqual([
        expect.objectContaining({
          From: 'Bob Tester',
          To: 'Alice Tester',
          Amount: '150.00',
          Currency: 'INR',
          Note: 'Tickets, settled',
          'Recorded by': 'Bob Tester',
        }),
      ]);
      // Without payments, there is no payments file.
      expect((await csv(alice, exportOf([ferry]))).fileName).toBe(
        'ferry-trip-all-time-expenses.csv',
      );
    });

    it('shares per person: a column per person, with each exact share', async () => {
      const ferry = await createGroup('Ferry Trip', alice, [bob, carol]);
      await addExpense(ferry, alice, 'Tickets', 100, alice, [alice, bob, carol]);
      const { header, records } = await csv(alice, exportOf([ferry], { include: ['shares'] }));
      expect(header.slice(EXPENSE_COLUMNS.length)).toEqual([
        'Alice Tester share',
        'Bob Tester share',
        'Carol Tester share',
      ]);
      const shares = header.slice(EXPENSE_COLUMNS.length).map((column) => records[0][column]);
      // ₹100 three ways: the leftover paisa goes where the ledger put it, and they add up.
      expect([...shares].sort()).toEqual(['33.33', '33.33', '33.34']);
    });

    it('deleted Expenses: their rows, with when and by whom', async () => {
      const ferry = await createGroup('Ferry Trip', alice, [bob]);
      await addExpense(ferry, alice, 'Tickets', 300, alice, [alice, bob]);
      const duplicate = await addExpense(ferry, alice, 'Tickets again', 300, alice, [alice, bob]);
      await expenseService.delete({ actorId: bob, groupId: ferry, expenseId: duplicate }, 0);

      expect((await csv(alice, exportOf([ferry]))).records.map((row) => row.Description)).toEqual([
        'Tickets',
      ]);
      const { header, records } = await csv(
        alice,
        exportOf([ferry], { include: ['deleted'], timeZone: 'Asia/Kolkata' }),
      );
      expect(header).toEqual([...EXPENSE_COLUMNS, ...DELETED_COLUMNS]);
      const deleted = records.find((row) => row.Description === 'Tickets again')!;
      expect(deleted['Deleted by']).toBe('Bob Tester');
      expect(deleted['Deleted at']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+05:30$/);
      expect(records.find((row) => row.Description === 'Tickets')!['Deleted at']).toBe('');
    });

    it('edit history: a row per edit after its Expense, which the list read leaves out', async () => {
      const ferry = await createGroup('Ferry Trip', alice, [bob]);
      const tickets = await addExpense(ferry, alice, 'Tickets', 268, alice, [alice, bob]);
      await expenseService.update(
        { actorId: bob, groupId: ferry, expenseId: tickets },
        command('Ferry tickets', 286, alice, [alice, bob]),
        0,
      );
      const { header, records } = await csv(alice, exportOf([ferry], { include: ['history'] }));
      expect(header).toEqual([...EXPENSE_COLUMNS, ...EDIT_COLUMNS]);
      expect(
        records.map((row) => [row.Description, row.Amount, row['Edited by'], row.Change]),
      ).toEqual([
        ['Ferry tickets', '286.00', '', ''],
        [
          'Ferry tickets',
          '',
          'Bob Tester',
          'Description: Tickets → Ferry tickets; Amount: 268.00 → 286.00; ' +
            'Paid by: Alice Tester 268.00 → Alice Tester 286.00; ' +
            'Shares: Alice Tester 134.00, Bob Tester 134.00 → Alice Tester 143.00, Bob Tester 143.00',
        ],
      ]);
    });

    it('everything at once, for several Groups, in one zip with no email anywhere', async () => {
      const ferry = await createGroup('Ferry Trip', alice, [bob]);
      const cabin = await createGroup('Cabin', carol, [alice]);
      const tickets = await addExpense(ferry, alice, 'Tickets', 300, alice, [alice, bob]);
      await expenseService.update(
        { actorId: bob, groupId: ferry, expenseId: tickets },
        { notes: 'Window seats' },
        0,
      );
      const wood = await addExpense(cabin, carol, 'Firewood', 60, carol, [alice, carol]);
      await expenseService.delete({ actorId: carol, groupId: cabin, expenseId: wood }, 0);
      await settlementService.create(cabin, { paidTo: carol, amount: 30, currency: 'INR' }, alice);
      // Bob leaves the Ferry Trip after settling; he is still named in its history.
      await settlementService.create(ferry, { paidTo: alice, amount: 150, currency: 'INR' }, bob);
      await groupService.leave(ferry, bob);

      const { files, fileName } = await zip(
        alice,
        exportOf([ferry, cabin], { include: ['payments', 'shares', 'deleted', 'history'] }),
      );
      expect(fileName).toBe('splitbook-2-groups-all-time.zip');
      expect(Object.keys(files)).toEqual([
        'ferry-trip-all-time-expenses.csv',
        'ferry-trip-all-time-payments.csv',
        'cabin-all-time-expenses.csv',
        'cabin-all-time-payments.csv',
      ]);
      // Each Group's records stay in its own files.
      expect(
        table(files['ferry-trip-all-time-expenses.csv']).records.map((r) => r.Description),
      ).toEqual(['Tickets', 'Tickets']);
      expect(table(files['cabin-all-time-expenses.csv']).records.map((r) => r.Description)).toEqual(
        ['Firewood'],
      );
      expect(table(files['ferry-trip-all-time-expenses.csv']).header).toContain('Bob Tester share');
      expect(table(files['ferry-trip-all-time-payments.csv']).records[0].From).toBe('Bob Tester');
      for (const [name, text] of Object.entries(files)) expect(text, name).not.toMatch(EMAIL);
    });
  });

  describe('the window', () => {
    it('holds the Expenses dated from its first day to its last, both included', async () => {
      const ferry = await createGroup('Ferry Trip', alice);
      for (const day of ['2026-08-31', '2026-09-01', '2026-09-15', '2026-09-30', '2026-10-01'])
        await addExpense(ferry, alice, `On ${day}`, 10, alice, [alice], day);

      const september = await csv(
        alice,
        exportOf([ferry], { from: '2026-09-01', to: '2026-09-30' }),
      );
      expect(september.fileName).toBe('ferry-trip-2026-09-expenses.csv');
      expect(september.records.map((row) => row.Date)).toEqual([
        '2026-09-30',
        '2026-09-15',
        '2026-09-01',
      ]);
      const oneDay = await csv(alice, exportOf([ferry], { from: '2026-10-01', to: '2026-10-01' }));
      expect(oneDay.records.map((row) => row.Date)).toEqual(['2026-10-01']);
      expect(oneDay.fileName).toBe('ferry-trip-2026-10-01-expenses.csv');
      const empty = await csv(alice, exportOf([ferry], { from: '2025-01-01', to: '2025-01-31' }));
      expect(empty.records).toEqual([]);
      expect(empty.header).toEqual([...EXPENSE_COLUMNS]);
    });

    it('holds the payments recorded on its days in the viewer’s time zone', async () => {
      const ferry = await createGroup('Ferry Trip', alice, [bob]);
      await addExpense(ferry, alice, 'Tickets', 300, alice, [alice, bob]);
      const payment = await settlementService.create(
        ferry,
        { paidTo: alice, amount: 50, currency: 'INR' },
        bob,
      );
      // 20:00 UTC on 31 August: 1 September in Kolkata, still 31 August in UTC.
      await Settlement.collection.updateOne(
        { _id: payment._id },
        { $set: { createdAt: new Date('2026-08-31T20:00:00.000Z') } },
      );
      const paymentsIn = async (from: string, to: string, timeZone: string) => {
        const { files } = await zip(
          alice,
          exportOf([ferry], { include: ['payments'], from, to, timeZone }),
        );
        const name = Object.keys(files).find((file) => file.endsWith('-payments.csv'))!;
        return table(files[name]).records;
      };
      expect(await paymentsIn('2026-09-01', '2026-09-30', 'Asia/Kolkata')).toEqual([
        expect.objectContaining({ Date: '2026-09-01', 'Recorded at': '2026-09-01T01:30:00+05:30' }),
      ]);
      expect(await paymentsIn('2026-09-01', '2026-09-30', 'UTC')).toEqual([]);
      expect(await paymentsIn('2026-08-01', '2026-08-31', 'UTC')).toEqual([
        expect.objectContaining({ Date: '2026-08-31', 'Recorded at': '2026-08-31T20:00:00+00:00' }),
      ]);
    });
  });

  describe('recurring Expenses', () => {
    it('adds those that fell due before exporting, while the switch is on', async () => {
      vi.stubEnv('RECURRING_EXPENSES_ENABLED', 'true');
      const { groupId, templateId } = await householdWithRentDue();
      const { records } = await csv(bob, exportOf([groupId]));
      expect(await rentFor(templateId, CURRENT_PERIOD)).toBe(1);
      expect(records.map((row) => [row.Description, row.Date])).toEqual([
        ['Rent', expenseDateForPeriod(CURRENT_PERIOD, 1).toISOString().slice(0, 10)],
        ['Rent', expenseDateForPeriod(PREVIOUS_PERIOD, 1).toISOString().slice(0, 10)],
      ]);
    });

    it('adds none while the switch is off, and exports what is stored', async () => {
      vi.stubEnv('RECURRING_EXPENSES_ENABLED', 'true');
      const { groupId, templateId } = await householdWithRentDue();
      vi.stubEnv('RECURRING_EXPENSES_ENABLED', undefined);
      const { records } = await csv(bob, exportOf([groupId]));
      expect(await rentFor(templateId, CURRENT_PERIOD)).toBe(0);
      expect(records.map((row) => row.Date)).toEqual([
        expenseDateForPeriod(PREVIOUS_PERIOD, 1).toISOString().slice(0, 10),
      ]);
    });
  });

  describe('refuses a request it can’t read', () => {
    it.each([
      ['no Groups', '/api/export'],
      ['a Group that is not an id', '/api/export?groups=ferry-trip'],
      ['a window with no end', `/api/export?groups=${'a'.repeat(24)}&from=2026-09-01`],
      [
        'a window that ends first',
        `/api/export?groups=${'a'.repeat(24)}&from=2026-09-30&to=2026-09-01`,
      ],
      ['an unknown include', `/api/export?groups=${'a'.repeat(24)}&include=receipts`],
      ['another format', `/api/export?groups=${'a'.repeat(24)}&format=xlsx`],
      ['an unknown time zone', `/api/export?groups=${'a'.repeat(24)}&tz=Nowhere%2FCity`],
    ])('%s', async (_, path) => {
      const answer = await request(alice, path);
      expect(answer.status).toBe(422);
      expect(json(answer)).toMatchObject({ code: 'VALIDATION_ERROR', status: 422 });
    });
  });

  describe('a very large export', () => {
    it('is refused before any file is built, counting Expenses, edits and payments', async () => {
      const ferry = await createGroup('Ferry Trip', alice, [bob]);
      const tickets = await addExpense(ferry, alice, 'Tickets', 300, alice, [alice, bob]);
      await expenseService.update(
        { actorId: alice, groupId: ferry, expenseId: tickets },
        { notes: 'x' },
        0,
      );
      await settlementService.create(ferry, { paidTo: alice, amount: 50, currency: 'INR' }, bob);
      const request = (include: ExportInclude[]): ExportRequest => ({
        groupIds: [ferry],
        include,
        format: 'csv',
        timeZone: 'UTC',
      });

      await expect(exportService.csv(alice, request([]), { maxRows: 1 })).resolves.toMatchObject({
        files: 1,
      });
      await expect(
        exportService.csv(alice, request(['history', 'payments']), { maxRows: 2 }),
      ).rejects.toEqual(new ExportTooLargeError(3, 2));
    });

    it('is answered 413 with a message that says what to do', async () => {
      const ferry = await createGroup('Ferry Trip', alice);
      vi.spyOn(exportService, 'csv').mockRejectedValueOnce(new ExportTooLargeError(61_250, 50_000));
      const answer = await request(alice, exportOf([ferry]));
      expect(answer.status).toBe(413);
      expect(json(answer)).toEqual({
        error:
          'This export would have 61,250 rows, more than the 50,000 one download can hold. ' +
          'Pick fewer Groups or a shorter period.',
        status: 413,
        code: 'EXPORT_TOO_LARGE',
      });
    });
  });
});

// ─── Recurring fixture ──────────────────────────────────

const CURRENT_PERIOD = toPeriod(new Date());
const PREVIOUS_PERIOD = previousPeriod(CURRENT_PERIOD);

/**
 * A Household of three whose ₹30,000 Rent, paid by Alice and split equally, was last added for
 * the previous month: this month's Rent is due and no read has added it yet.
 */
async function householdWithRentDue() {
  const groupId = await createGroup('Lakeview Flat', alice, [bob, carol], { category: 'home' });
  const template = await recurringExpenseService.create(
    groupId,
    {
      description: 'Rent',
      amount: 30000,
      currency: 'INR',
      category: 'housing',
      tag: 'Rent',
      paidBy: [{ user: alice, amount: 30000 }],
      splitMethod: 'equal',
      splitBetween: [{ user: alice }, { user: bob }, { user: carol }],
      dayOfMonth: 1,
      startsOn: expenseDateForPeriod(CURRENT_PERIOD, 1),
    },
    alice,
  );
  const templateId = String(template!._id);
  const lastMonth = expenseDateForPeriod(PREVIOUS_PERIOD, 1);
  const rewound = await Expense.updateOne(
    { recurringExpense: templateId, period: CURRENT_PERIOD },
    { $set: { period: PREVIOUS_PERIOD, date: lastMonth } },
  );
  expect(rewound.modifiedCount).toBe(1);
  await RecurringExpense.updateOne(
    { _id: templateId },
    { $set: { startsOn: lastMonth, lastGeneratedFor: PREVIOUS_PERIOD } },
  );
  expect(await rentFor(templateId, CURRENT_PERIOD)).toBe(0);
  return { groupId, templateId };
}

function rentFor(templateId: string, period: string) {
  return Expense.countDocuments({ recurringExpense: templateId, period, isDeleted: false });
}

describe('JSON backup and statement (#318, #319)', () => {
  it('round-trips a seeded backup without contacts and leaves the CSV bytes unchanged', async () => {
    const id = await createGroup('Ferry Trip', alice, [bob]);
    await addExpense(id, alice, 'Tickets', 1.01, alice, [alice, bob], '2026-09-20');
    const before = await request(alice, exportOf([id]));
    const backup = await request(
      alice,
      `/api/export?groups=${id}&format=json&include=payments,history`,
    );
    expect(backup.status).toBe(200);
    const parsed = backupSchema.parse(json(backup));
    expect(parsed.groups[0].expenses[0].amountMinor).toBe(101);
    expect(parsed.groups[0].members.map((person) => person.name)).toEqual([
      'Alice Tester',
      'Bob Tester',
    ]);
    expect(JSON.stringify(parsed)).not.toMatch(/@|email/i);
    const after = await request(alice, exportOf([id]));
    expect(after.bytes).toEqual(before.bytes);
    // A literal CSV contract from #317; the generated Expense identity is the sole variable.
    const expenseId = parsed.groups[0].expenses[0].id;
    expect(decoder.decode(after.bytes)).toBe(
      '﻿Date,Description,Category,Tag,Paid by,Split,Amount,Currency,Notes,Expense ID\r\n' +
        `2026-09-20,Tickets,Food & Drink,General,Alice Tester,Equally,1.01,INR,,${expenseId}\r\n`,
    );
    expect(
      (await request(alice, `/api/export?groups=${id}&format=json&from=2026-09-01&to=2026-09-30`))
        .status,
    ).toBe(422);
  });
  it('backs up deleted Expenses, stored Tag identities, history and former members on request', async () => {
    const id = await createGroup('Ferry Trip', alice, [bob]);
    const expense = await addExpense(id, alice, 'Tickets', 3, bob, [alice, bob]);
    await expenseService.update(
      { actorId: alice, groupId: id, expenseId: expense },
      { notes: 'Revised' },
      0,
    );
    await expenseService.delete({ actorId: alice, groupId: id, expenseId: expense }, 1);
    await Group.updateOne({ _id: id }, { $pull: { members: { user: bob } } });
    const backup = backupSchema.parse(
      json(await request(alice, `/api/export?groups=${id}&format=json&include=deleted,history`)),
    );
    expect(backup.groups[0].members.find((person) => person.id === bob)).toMatchObject({
      name: 'Bob Tester',
      former: true,
    });
    expect(backup.groups[0].expenses[0]).toMatchObject({
      notes: 'Revised',
      deleted: { byId: alice },
    });
    expect(backup.groups[0].expenses[0].edits).toHaveLength(1);
    expect(backup.groups[0].expenses[0].tagId).toBeTruthy();
    expect(
      backupSchema.parse(json(await request(alice, `/api/export?groups=${id}&format=json`)))
        .groups[0].expenses,
    ).toEqual([]);
  });
  it('counts backup history and payments toward the same row cap', async () => {
    const id = await createGroup('Ferry Trip', alice, [bob]);
    await addExpense(id, alice, 'Tickets', 1, alice, [alice, bob]);
    await expect(
      exportService.backup(
        alice,
        { groupIds: [id], format: 'json', include: [], timeZone: 'UTC' },
        { maxRows: 0 },
      ),
    ).rejects.toEqual(new ExportTooLargeError(1, 0));
  });
  it('statement contributions and current positions match Balances in each currency', async () => {
    const id = await createGroup('Ferry Trip', alice, [bob]);
    await addExpense(id, alice, 'Tickets', 1.01, alice, [alice, bob]);
    const statement = await exportService.statement(alice, {
      groupIds: [id],
      format: 'csv',
      include: [],
      timeZone: 'UTC',
    });
    expect(statement.currencies[0].spentMinor).toBe(101);
    expect(statement.currencies[0].people.map((person) => person.netMinor)).toEqual([50, -50]);
  });
  it.each(['outsider', 'left', 'missing', 'anonymous'] as const)(
    'JSON backup refuses %s as CSV does',
    async (scenario) => {
      const id = await createGroup('Private Ferry', alice, [bob]);
      const actor = scenario === 'outsider' ? dave : scenario === 'anonymous' ? null : bob;
      if (scenario === 'left')
        await Group.updateOne({ _id: id }, { $pull: { members: { user: bob } } });
      const target = scenario === 'missing' ? 'f00000000000000000000000' : id;
      const response = await request(actor, `/api/export?groups=${target}&format=json`);
      expect(response.status).toBe(scenario === 'anonymous' ? 401 : 403);
      if (actor)
        await expect(
          exportService.statement(actor, {
            groupIds: [target],
            format: 'csv',
            include: [],
            timeZone: 'UTC',
          }),
        ).rejects.toThrow('FORBIDDEN');
    },
  );
});

describe('new exports honor recurring switch', () => {
  it.each([true, false])('materializes due Expenses only when enabled: %s', async (enabled) => {
    vi.stubEnv('RECURRING_EXPENSES_ENABLED', 'true');
    const { groupId } = await householdWithRentDue();
    vi.stubEnv('RECURRING_EXPENSES_ENABLED', enabled ? 'true' : 'false');
    const backup = backupSchema.parse(
      json(await request(bob, `/api/export?groups=${groupId}&format=json`)),
    );
    expect(backup.groups[0].expenses).toHaveLength(enabled ? 2 : 1);
    const statement = await exportService.statement(bob, {
      groupIds: [groupId],
      format: 'csv',
      include: [],
      timeZone: 'UTC',
    });
    expect(statement.currencies[0].expenseCount).toBe(enabled ? 2 : 1);
  });
});

describe('export recovery and whole-trip statement bounds', () => {
  it('returns the real 413 for an oversized JSON backup without preparing a file', async () => {
    const id = await createGroup('Large backup', alice);
    await Expense.collection.insertMany(
      Array.from({ length: 50_001 }, () => ({
        group: new Types.ObjectId(id),
        isDeleted: false,
      })),
    );
    const response = await request(alice, `/api/export?groups=${id}&format=json`);
    expect(response.status).toBe(413);
    expect(json(response)).toMatchObject({ code: 'EXPORT_TOO_LARGE', status: 413 });
    expect(response.headers.get('content-disposition')).toBeNull();
  });
  it('uses stored Trip dates, retaining before/after Expenses and every Payment', async () => {
    const id = await createGroup('Ferry Trip', alice, [bob]);
    await Group.updateOne(
      { _id: id },
      { $set: { startDate: new Date('2026-09-01'), endDate: new Date('2026-09-02') } },
    );
    await addExpense(id, alice, 'Before the trip', 1.01, alice, [alice, bob], '2026-08-31');
    await addExpense(id, alice, 'After the trip', 1.01, alice, [alice, bob], '2026-09-03');
    const payment = await settlementService.create(
      id,
      { paidTo: alice, amount: 0.2, currency: 'INR' },
      bob,
    );
    await Settlement.collection.updateOne(
      { _id: payment!._id },
      { $set: { createdAt: new Date('2026-09-03T10:00:00Z') } },
    );
    const result = await exportService.statement(
      alice,
      {
        groupIds: [id],
        format: 'csv',
        include: [],
        from: '2026-01-01',
        to: '2026-12-31',
        timeZone: 'UTC',
      },
      { wholeTrip: true },
    );
    expect([result.from, result.to]).toEqual(['2026-09-01', '2026-09-02']);
    expect(result.currencies[0].spentMinor).toBe(202);
    // Counted in Spent, and named as the Trip summary names them (#316).
    expect([result.currencies[0].beforeTrip, result.currencies[0].afterTrip]).toEqual([
      { spentMinor: 101, expenseCount: 1 },
      { spentMinor: 101, expenseCount: 1 },
    ]);
    expect(result.currencies[0].expenses.map((row) => [row.description, row.outsideTrip])).toEqual([
      ['Before the trip', 'before'],
      ['After the trip', 'after'],
    ]);
    expect(result.currencies[0].payments).toMatchObject([
      { amountMinor: 20, recordedById: bob, outsideTrip: 'after' },
    ]);
    expect(result.currencies[0].paymentTotalMinor).toBe(20);
    expect(result.currencies[0].people.map((row) => row.balanceMinor)).toEqual([80, -80]);
    const period = await exportService.statement(alice, {
      groupIds: [id],
      format: 'csv',
      include: [],
      from: '2026-09-01',
      to: '2026-09-02',
      timeZone: 'UTC',
    });
    expect(period.currencies[0].payments).toEqual([]);
    expect(period.currencies[0].paymentTotalMinor).toBe(0);
    expect(period.currencies[0].people.map((row) => row.balanceMinor)).toEqual([80, -80]);
  });
});
