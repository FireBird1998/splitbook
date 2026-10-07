import { Types } from 'mongoose';
import { zipSync } from 'fflate';
import connectDB from '@/lib/db';
import Expense, { type IExpenseDocument } from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
import Settlement from '@/lib/models/Settlement';
import User from '@/lib/models/User';
import { recurringExpenseService } from './recurring-expense.service';
import { assertStoredExpenseMoney, readStoredAmountMinor } from '@splitbook/shared/exact-money';
import {
  buildExpenseCsv,
  buildPaymentCsv,
  serializeCsv,
  zonedDay,
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
    await connectDB();
    const include = new Set(request.include);

    const found = await Group.find({ _id: { $in: request.groupIds }, 'members.user': userId })
      .select('name members tags')
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
            'splitMethod splitBetween tag tagId notes isDeleted deletedAt deletedBy' +
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
        ...(expense.deletedBy ? [expense.deletedBy] : []),
        ...(expense.editHistory ?? []).flatMap((edit) => [
          edit.editedBy,
          ...editPeople(plain(edit.changes) ?? {}),
        ]),
      ]),
      ...payments.flatMap((payment) => [payment.paidBy, payment.paidTo, payment.createdBy]),
    ]);

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
            .map(
              (payment): ExportPayment => ({
                id: String(payment._id),
                at: payment.createdAt,
                fromId: String(payment.paidBy),
                toId: String(payment.paidTo),
                amountMinor: readStoredAmountMinor(payment),
                currency: payment.currency,
                note: payment.note,
                recordedById: String(payment.createdBy),
              }),
            ),
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
