import { buildBackup, type BackupGroupInput } from '@splitbook/shared/export-backup';
import { buildStatement } from '@splitbook/shared/statement';
import { Types } from 'mongoose';
import { zipSync } from 'fflate';
import connectDB from '@/lib/db';
import Expense, { type IExpenseDocument } from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
import Settlement, { type ISettlementDocument } from '@/lib/models/Settlement';
import User from '@/lib/models/User';
import { recurringExpenseService } from './recurring-expense.service';
import { assertStoredExpenseMoney, readStoredAmountMinor } from '@splitbook/shared/exact-money';
import {
  buildExpenseCsv,
  buildPaymentCsv,
  serializeCsv,
  zonedDay,
  expenseDay,
  type ExportExpense,
  type ExportPayment,
} from '@splitbook/shared/export-csv';
import {
  EXPORT_MAX_ROWS,
  planExportFiles,
  type ExportRequest,
} from '@splitbook/shared/export-request';
import { displayTagReference } from '@splitbook/shared/tag-identity';

/** An export over `EXPORT_MAX_ROWS`: refused before any file is built. */
export class ExportTooLargeError extends Error {
  constructor(
    readonly rows: number,
    readonly limit: number,
  ) {
    super('EXPORT_TOO_LARGE');
    this.name = 'ExportTooLargeError';
  }
}

/** The finished download: one CSV, or a zip of several. */
export interface ExportDownload {
  fileName: string;
  contentType: string;
  body: Uint8Array;
  /** How many CSVs it holds. */
  files: number;
}

const DAY = 24 * 60 * 60 * 1000;
const utcMidnight = (day: string) => new Date(`${day}T00:00:00.000Z`);

type LeanExpense = Pick<
  IExpenseDocument,
  | '_id'
  | 'group'
  | 'description'
  | 'amount'
  | 'amountMinor'
  | 'moneyVersion'
  | 'currency'
  | 'category'
  | 'date'
  | 'paidBy'
  | 'splitMethod'
  | 'splitBetween'
  | 'tag'
  | 'tagId'
  | 'notes'
  | 'isDeleted'
  | 'deletedAt'
  | 'deletedBy'
  | 'createdBy'
  | 'createdAt'
  | 'updatedAt'
> & { editHistory?: IExpenseDocument['editHistory'] };

/** Stored values as plain JSON: ObjectIds as their hex, dates as ISO strings. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null));

/** Every person id an edit's payers or sharers name, before or after. */
function editPeople(changes: Record<string, { old?: unknown; new?: unknown }>) {
  const ids: string[] = [];
  for (const field of ['paidBy', 'splitBetween'])
    for (const side of [changes[field]?.old, changes[field]?.new])
      if (Array.isArray(side))
        for (const entry of side) {
          const user = (entry as { user?: unknown })?.user;
          const id = typeof user === 'object' && user ? (user as { _id?: unknown })._id : user;
          if (typeof id === 'string' && Types.ObjectId.isValid(id)) ids.push(id);
        }
  return ids;
}

export class ExportService {
  /**
   * Build an export's CSVs (#317) for a member: one Expenses CSV per Group, and one payments CSV
   * per Group when payments are included, as one CSV or a zip of all of them.
   *
   * - **Access.** Every Group must be one the member belongs to today, as for the Group reads;
   *   a Group they never joined, have left, or that doesn't exist refuses the whole request
   *   (`FORBIDDEN`) and nothing is read or generated. An archived Group can be exported.
   * - **Recurring Expenses.** Due ones are added first, as the Group reads add them, unless the
   *   product switch is off (#289).
   * - **The window** holds the Expenses dated from its first to its last day (an Expense's date
   *   is a calendar day, stored at midnight UTC), and the payments recorded on those days in the
   *   viewer's time zone. Without a window, everything.
   * - **Size.** More than `maxRows` rows across every file is refused (`ExportTooLargeError`)
   *   before anything is built; the files are made in memory, not streamed.
   * - **People** are named from their accounts, never by email; an account that no longer
   *   exists reads "Former member".
   */
  async csv(
    userId: string,
    request: ExportRequest,
    { maxRows = EXPORT_MAX_ROWS }: { maxRows?: number } = {},
  ): Promise<ExportDownload> {
    const { ordered, expenses, payments, names } = await this.load(userId, request, maxRows);
    const include = new Set(request.include);

    const plan = planExportFiles(
      ordered.map((group) => group.name),
      request,
    );
    const contents = plan.files.map((file) => {
      const group = ordered[file.group];
      const id = String(group._id);
      if (file.kind === 'payments') {
        const csv = buildPaymentCsv({
          payments: payments
            .filter((payment) => String(payment.group) === id)
            .map((payment) => this.toExportPayment(payment)),
          names,
          timeZone: request.timeZone,
        });
        return serializeCsv(csv.header, csv.rows);
      }
      const csv = buildExpenseCsv({
        expenses: expenses
          .filter((expense) => String(expense.group) === id)
          .map((expense) => this.toExportExpense(expense, group.tags)),
        members: group.members.map((member) => {
          const memberId = String(member.user);
          return { id: memberId, name: names[memberId] };
        }),
        names,
        options: {
          shares: include.has('shares'),
          deleted: include.has('deleted'),
          history: include.has('history'),
          timeZone: request.timeZone,
        },
      });
      return serializeCsv(csv.header, csv.rows);
    });

    const encoder = new TextEncoder();
    if (!plan.zipped)
      return {
        fileName: plan.download,
        contentType: 'text/csv; charset=utf-8',
        body: encoder.encode(contents[0]),
        files: 1,
      };
    const mtime = new Date();
    const body = zipSync(
      Object.fromEntries(
        plan.files.map((file, index) => [file.name, [encoder.encode(contents[index]), { mtime }]]),
      ),
      { level: 6 },
    );
    return {
      fileName: plan.download,
      contentType: 'application/zip',
      body,
      files: plan.files.length,
    };
  }

  /** Load only after every requested Group passes the current-membership check. */
  private async load(userId: string, request: ExportRequest, maxRows: number) {
    await connectDB();
    const include = new Set(request.include);

    const found = await Group.find({ _id: { $in: request.groupIds }, 'members.user': userId })
      .select('name category defaultCurrency startDate endDate members tags')
      .lean();
    const groups = request.groupIds.map((id) => found.find((group) => String(group._id) === id));
    if (groups.some((group) => !group)) throw new Error('FORBIDDEN');
    const ordered = groups as NonNullable<(typeof groups)[number]>[];
    const groupIds = ordered.map((group) => group._id);

    for (const group of ordered)
      await recurringExpenseService.generateDueExpenses(String(group._id));

    const expenseFilter: Record<string, unknown> = { group: { $in: groupIds } };
    if (!include.has('deleted')) expenseFilter.isDeleted = false;
    if (request.from && request.to)
      expenseFilter.date = {
        $gte: utcMidnight(request.from),
        $lt: new Date(utcMidnight(request.to).getTime() + DAY),
      };
    // Payments are kept by their day in the viewer's zone, which is never more than a day from
    // UTC: read the days either side, then keep the ones in the window.
    const paymentFilter: Record<string, unknown> = { group: { $in: groupIds } };
    if (request.from && request.to)
      paymentFilter.createdAt = {
        $gte: new Date(utcMidnight(request.from).getTime() - DAY),
        $lt: new Date(utcMidnight(request.to).getTime() + 2 * DAY),
      };

    const [expenseCount, editCount, paymentCount] = await Promise.all([
      Expense.countDocuments(expenseFilter),
      include.has('history')
        ? Expense.aggregate<{ edits: number }>([
            { $match: expenseFilter },
            {
              $group: { _id: null, edits: { $sum: { $size: { $ifNull: ['$editHistory', []] } } } },
            },
          ]).then((result) => result[0]?.edits ?? 0)
        : 0,
      include.has('payments') ? Settlement.countDocuments(paymentFilter) : 0,
    ]);
    const rows = expenseCount + editCount + paymentCount;
    if (rows > maxRows) throw new ExportTooLargeError(rows, maxRows);

    const [expenses, settlements] = await Promise.all([
      Expense.find(expenseFilter)
        .select(
          'group description amount amountMinor moneyVersion currency category date paidBy ' +
            'splitMethod splitBetween tag tagId notes isDeleted deletedAt deletedBy createdBy createdAt updatedAt' +
            (include.has('history') ? ' editHistory' : ''),
        )
        .sort({ date: -1, createdAt: -1, _id: -1 })
        .lean<LeanExpense[]>(),
      include.has('payments')
        ? Settlement.find(paymentFilter).sort({ createdAt: -1, _id: -1 }).lean()
        : Promise.resolve([]),
    ]);
    const payments =
      request.from && request.to
        ? settlements.filter((payment) => {
            const day = zonedDay(payment.createdAt, request.timeZone);
            return day >= request.from! && day <= request.to!;
          })
        : settlements;

    const names = await this.names([
      ...ordered.flatMap((group) => group.members.map((member) => member.user)),
      ...expenses.flatMap((expense) => [
        ...expense.paidBy.map((payer) => payer.user),
        ...expense.splitBetween.map((share) => share.user),
        expense.createdBy,
        ...(expense.deletedBy ? [expense.deletedBy] : []),
        ...(expense.editHistory ?? []).flatMap((edit) => [
          edit.editedBy,
          ...editPeople(plain(edit.changes) ?? {}),
        ]),
      ]),
      ...payments.flatMap((payment) => [payment.paidBy, payment.paidTo, payment.createdBy]),
    ]);

    const loadedRows =
      expenses.length +
      payments.length +
      expenses.reduce((count, row) => count + (row.editHistory?.length ?? 0), 0);
    if (loadedRows > maxRows) throw new ExportTooLargeError(loadedRows, maxRows);
    return { ordered, expenses, payments, names };
  }

  private backupGroups(data: Awaited<ReturnType<ExportService['load']>>): BackupGroupInput[] {
    return data.ordered.map((group) => {
      const id = String(group._id);
      return {
        id,
        name: group.name,
        theme: group.category,
        currency: group.defaultCurrency,
        startDate: group.startDate,
        endDate: group.endDate,
        members: group.members.map((member) => ({
          id: String(member.user),
          name: data.names[String(member.user)] ?? 'Former member',
        })),
        names: data.names,
        tags: group.tags.map((tag) => ({
          id: String(tag._id),
          name: tag.name,
          retired: Boolean(tag.isArchived),
          deleted: Boolean(tag.isDeleted),
          createdAt: tag.createdAt.toISOString(),
        })),
        expenses: data.expenses
          .filter((row) => String(row.group) === id)
          .map((row) => ({
            ...this.toExportExpense(row, group.tags),
            tag: row.tag,
            tagId: row.tagId ? String(row.tagId) : null,
            createdBy: row.createdBy ? String(row.createdBy) : null,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            splitBetween: this.toExportExpense(row, group.tags).splitBetween.map(
              (share, index) => ({
                ...share,
                percentage: row.splitBetween[index].percentage,
                shares: row.splitBetween[index].shares,
              }),
            ),
          })),
        settlements: data.payments
          .filter((row) => String(row.group) === id)
          .map((row) => this.toExportPayment(row)),
      };
    });
  }

  async backup(
    userId: string,
    request: ExportRequest,
    { maxRows = EXPORT_MAX_ROWS } = {},
  ): Promise<ExportDownload> {
    if (request.from || request.to) throw new Error('BACKUP_ALL_TIME');
    const data = await this.load(userId, request, maxRows);
    const backup = buildBackup(this.backupGroups(data), {
      exportedAt: new Date(),
      include: request.include,
    });
    return {
      fileName: `splitbook-${data.ordered.length}-groups-backup.json`,
      contentType: 'application/json; charset=utf-8',
      body: new TextEncoder().encode(JSON.stringify(backup, null, 2) + '\n'),
      files: 1,
    };
  }

  async statement(userId: string, request: ExportRequest, { wholeTrip = false } = {}) {
    if (request.groupIds.length !== 1) throw new Error('FORBIDDEN');
    const data = await this.load(
      userId,
      { ...request, from: undefined, to: undefined, include: ['payments'] },
      EXPORT_MAX_ROWS,
    );
    const group = this.backupGroups(data)[0];
    if (wholeTrip && group.theme !== 'trip')
      throw new RangeError('Whole-trip statements require a Trip');
    return buildStatement(group, {
      from: wholeTrip ? (group.startDate ? expenseDay(group.startDate) : undefined) : request.from,
      to: wholeTrip ? (group.endDate ? expenseDay(group.endDate) : undefined) : request.to,
      timeZone: request.timeZone,
      wholeTrip,
    });
  }

  /** Names by id, from the accounts alone: `name` is the only field read, never `email`. */
  private async names(ids: unknown[]): Promise<Record<string, string>> {
    const unique = [...new Set(ids.map((id) => String(id)))].filter((id) =>
      Types.ObjectId.isValid(id),
    );
    if (unique.length === 0) return {};
    const users = await User.find({ _id: { $in: unique } })
      .select('name')
      .lean<{ _id: Types.ObjectId; name?: string }[]>();
    return Object.fromEntries(users.map((user) => [String(user._id), user.name ?? '']));
  }

  private toExportPayment(
    payment: Pick<
      ISettlementDocument,
      | '_id'
      | 'createdAt'
      | 'paidBy'
      | 'paidTo'
      | 'amount'
      | 'amountMinor'
      | 'moneyVersion'
      | 'currency'
      | 'note'
      | 'createdBy'
    >,
  ): ExportPayment {
    return {
      id: String(payment._id),
      at: payment.createdAt,
      fromId: String(payment.paidBy),
      toId: String(payment.paidTo),
      amountMinor: readStoredAmountMinor(payment),
      currency: payment.currency,
      note: payment.note,
      recordedById: String(payment.createdBy),
    };
  }

  private toExportExpense(
    expense: LeanExpense,
    tags: Parameters<typeof displayTagReference>[0],
  ): ExportExpense {
    assertStoredExpenseMoney(expense);
    const allocation = (row: { user: unknown; amount: number; amountMinor?: number }) => ({
      userId: String(row.user),
      amountMinor: readStoredAmountMinor({
        amount: row.amount,
        amountMinor: row.amountMinor,
        currency: expense.currency,
        moneyVersion: expense.moneyVersion,
      }),
    });
    return {
      id: String(expense._id),
      date: expense.date,
      description: expense.description,
      category: expense.category,
      tag: displayTagReference(tags, expense).tag,
      currency: expense.currency,
      amountMinor: readStoredAmountMinor(expense),
      splitMethod: expense.splitMethod,
      notes: expense.notes,
      paidBy: expense.paidBy.map(allocation),
      splitBetween: expense.splitBetween.map(allocation),
      deleted: expense.isDeleted
        ? {
            at: expense.deletedAt ?? null,
            byId: expense.deletedBy ? String(expense.deletedBy) : null,
          }
        : null,
      edits: (expense.editHistory ?? []).map((edit) => ({
        at: edit.editedAt,
        byId: String(edit.editedBy),
        changes: plain(edit.changes) ?? {},
      })),
    };
  }
}

export const exportService = new ExportService();
