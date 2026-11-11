import 'server-only';
import { Refusal } from '@splitbook/shared/refusals';
import type { ActivityType } from '@splitbook/shared/types';
import { Types, type HydratedDocument, type Model } from 'mongoose';
import connectDB from './db';
import { afterGroupCommit, supportsGroupTransactions, withGroupMutation } from './group-mutation';
import { ensureLedgerWriteIndexes } from './ledger-indexes';
import { lockLedgerCurrency } from './ledger-currency';
import Settlement from './models/Settlement';
import { MoneyValidationError } from '@splitbook/shared/exact-money';
import { assertExpenseParticipants } from '@splitbook/shared/expense-validation';
import { assertExpectedRevision } from './ledger-revision';
import Expense, { type IExpenseDocument } from './models/Expense';
import {
  assertCreateReplay,
  involvedMembers,
  createRequestMetadata,
  expenseChangeAlertsEnabled,
  paymentAlertsEnabled,
  type ICreationRequest,
  type IPendingActivity,
  type NotificationKind,
  type NotificationContext,
} from './financial-write';
import Group, { type IGroupDocument } from './models/Group';
import { activityService } from './services/activity.service';

interface LedgerRecord {
  _id: Types.ObjectId;
  creationRequest?: ICreationRequest;
  pendingActivity: IPendingActivity[];
  batchSettlementIds?: Types.ObjectId[];
}
interface NewLedgerRecord<T> {
  // The module overwrites Group, actor, retry metadata and pending Activity below.
  document: Parameters<Model<T>['create']>[0] & object;
  activity: {
    type: ActivityType;
    occurredAt?: Date;
    metadata: Record<string, unknown>;
    alert: {
      kind: NotificationKind;
      involved: readonly string[];
      switch: 'always' | 'payments' | 'expense-changes';
    };
  };
}
type CurrencyUse = { currency: string; rule: 'listed' | 'held-by-ledger' };
export interface LedgerRecordDescription<T> {
  id: Types.ObjectId;
  currencies?: readonly CurrencyUse[];
  build: (group: IGroupDocument) => Promise<NewLedgerRecord<T>>;
}
interface SubmissionRetry {
  key: string;
  receipt?: 'ordered-records';
  atCommit?: true;
  raceCommand?: 'original';
  legacyTagAlias?: string;
}
interface TemplateMonthRetry {
  template: Types.ObjectId;
  period: string;
  lookup?: 'on-duplicate';
}
export interface LedgerRecording<
  T extends LedgerRecord,
  Command extends Record<string, unknown> = Record<string, unknown>,
> {
  groupId: string;
  actorId: string;
  model: Model<T>;
  transactions: 'allow-standalone' | { required: Refusal };
  compatibility?: {
    membership: 'before-retry-and-at-commit' | 'actor-before-retry' | 'template-validated';
  };
  retry?: SubmissionRetry | TemplateMonthRetry;
  command: (context: { group?: IGroupDocument; receipt?: HydratedDocument<T> }) => Command;
  currencies: readonly CurrencyUse[];
  currenciesAt?: 'before-fence';
  checkPeople?: (members: Set<string>) => void;
  /** The batch reads presentation data after its commit-time replay; other writers prepare before the fence. */
  prepareAt?: 'commit';
  prepareResponseRecord?: (
    record: HydratedDocument<T>,
    context: {
      outcome: 'created' | 'replayed' | 'raced';
      group?: IGroupDocument;
    },
  ) => Promise<unknown>;
  prepare: (
    command: Command,
    group?: IGroupDocument,
  ) => Promise<ReadonlyArray<LedgerRecordDescription<T>>>;
}

/** Record a description; callers never sequence retry, commit and publication themselves. */
export async function recordLedger<T extends LedgerRecord, Command extends Record<string, unknown>>(
  description: LedgerRecording<T, Command>,
) {
  const { groupId, actorId, model, retry } = description;
  const submission = retry && 'key' in retry ? retry : undefined;
  const month = retry && 'template' in retry ? retry : undefined;
  await connectDB();
  await ensureLedgerWriteIndexes();
  const source = model.collection.collectionName;
  if (source !== 'expenses' && source !== 'settlements')
    throw new Error('Ledger recording needs an Expense or Settlement model');
  const lockCurrencies = async (currencies: readonly CurrencyUse[]) => {
    for (const use of currencies) {
      if (use.rule === 'held-by-ledger') await lockClearedCurrency(groupId, use.currency);
      else await lockLedgerCurrency(groupId, use.currency);
    }
  };
  const checkMembers = (group: IGroupDocument, includePeople = true) => {
    const members = new Set(group.members.map((member) => String(member.user)));
    if (description.compatibility?.membership !== 'template-validated' && !members.has(actorId))
      throw new Refusal('FORBIDDEN');
    if (includePeople) description.checkPeople?.(members);
  };
  let admittedGroup: IGroupDocument | undefined;
  // Admission is separate from commit-time checks: an Expense replay may name a former member.
  if (
    description.compatibility?.membership &&
    description.compatibility.membership !== 'template-validated'
  ) {
    admittedGroup = (await Group.findById(groupId)) ?? undefined;
    if (!admittedGroup) throw new Refusal('FORBIDDEN');
    checkMembers(admittedGroup, description.compatibility.membership !== 'actor-before-retry');
  }
  const lookup = async () => {
    if (month)
      return model
        .findOne({ recurringExpense: month.template, period: month.period })
        .select('+pendingActivity');
    if (submission)
      return model
        .findOne({ group: groupId, createdBy: actorId, 'creationRequest.key': submission.key })
        .select('+creationRequest +pendingActivity +batchSettlementIds');
    return null;
  };
  const normalize = (receipt: HydratedDocument<T> | null) =>
    description.command({
      group: admittedGroup,
      receipt: receipt ?? undefined,
    });
  const confirm = async (first: HydratedDocument<T> | null, command: Command) => {
    if (!first) return null;
    if (month) return [first];
    assertCreateReplay(first.creationRequest!, command);
    if (!submission?.receipt) return [first];
    if (!first.batchSettlementIds?.length) throw new Error('IDEMPOTENCY_CONFLICT');
    const saved = await model
      .find({ group: groupId, _id: { $in: first.batchSettlementIds } })
      .select('+pendingActivity');
    if (saved.length !== first.batchSettlementIds.length)
      throw new Error('Incomplete stored Settlement batch');
    return first.batchSettlementIds.map((id) => saved.find((row) => row._id.equals(id))!);
  };
  const publish = async (
    rows: HydratedDocument<T>[],
    outcome: 'created' | 'replayed' | 'raced',
  ) => {
    for (const row of rows) {
      await afterGroupCommit(() =>
        activityService.publishPending(source, row._id, row.pendingActivity),
      );
      await description.prepareResponseRecord?.(row, { outcome, group: admittedGroup });
    }
    return { records: rows, created: outcome === 'created' };
  };
  const first = month?.lookup === 'on-duplicate' ? null : await lookup();
  const command = normalize(first);
  const existing = await confirm(first, command);
  if (existing) return publish(existing, 'replayed');
  if (description.transactions !== 'allow-standalone' && !(await supportsGroupTransactions()))
    throw description.transactions.required;
  if (
    admittedGroup?.isArchived &&
    description.compatibility?.membership !== 'before-retry-and-at-commit'
  )
    throw new Refusal('GROUP_ARCHIVED');
  if (description.currenciesAt === 'before-fence') await lockCurrencies(description.currencies);
  const prepared =
    description.prepareAt === 'commit'
      ? undefined
      : await description.prepare(command, admittedGroup);
  let committed: { records: HydratedDocument<T>[]; outcome: 'created' | 'replayed' };
  try {
    committed = await withGroupMutation(
      groupId,
      async (session) => {
        if (description.transactions !== 'allow-standalone' && !session)
          throw description.transactions.required;
        if (description.currenciesAt !== 'before-fence')
          await lockCurrencies(description.currencies);
        const group = await Group.findById(groupId);
        if (!group) throw new Refusal('FORBIDDEN');
        if (group.isArchived) {
          throw new Refusal('GROUP_ARCHIVED');
        }
        checkMembers(group);
        if (submission?.atCommit) {
          const receipt = await lookup();
          const concurrent = receipt ? await confirm(receipt, normalize(receipt)) : null;
          if (concurrent) return { records: concurrent, outcome: 'replayed' as const };
        }
        const descriptions = prepared ?? (await description.prepare(command, admittedGroup));
        const result: HydratedDocument<T>[] = [];
        for (const [index, entry] of descriptions.entries()) {
          await lockCurrencies(entry.currencies ?? []);
          const record = await entry.build(group);
          const event = makePendingActivity(
            groupId,
            record.activity.type,
            actorId,
            record.activity.metadata,
            record.activity.occurredAt,
          );
          const alert = record.activity.alert;
          const capture =
            alert.switch === 'always' ||
            (alert.switch === 'payments' ? paymentAlertsEnabled() : expenseChangeAlertsEnabled());
          if (capture)
            event.notificationContext = ledgerNotificationContext(
              event,
              alert.kind,
              { groupId, recordId: String(entry.id) },
              alert.involved,
              new Set(group.members.map((member) => String(member.user))),
            );
          result.push(
            await model.create({
              ...record.document,
              _id: entry.id,
              group: groupId,
              createdBy: actorId,
              creationRequest:
                index === 0 && submission
                  ? createRequestMetadata(submission.key, command, submission.legacyTagAlias)
                  : undefined,
              batchSettlementIds:
                index === 0 && submission?.receipt === 'ordered-records'
                  ? descriptions.map((entry) => entry.id)
                  : undefined,
              ...(month ? { recurringExpense: month.template, period: month.period } : {}),
              pendingActivity: [event],
            }),
          );
        }
        return { records: result, outcome: 'created' as const };
      },
      { ledger: true },
    );
  } catch (error) {
    if (retry && (error as { code?: number }).code === 11000) {
      const receipt = await lookup();
      const raced = receipt
        ? await confirm(
            receipt,
            submission?.raceCommand === 'original' ? command : normalize(receipt),
          )
        : null;
      if (raced) return publish(raced, 'raced');
    }
    throw error;
  }
  return publish(committed.records, committed.outcome);
}

/** The trusted session actor and the requested Expense's Group always travel together. */
export interface ExpenseAccess {
  actorId: string;
  groupId: string;
  expenseId: string;
}
export interface LedgerExpenseChange {
  access: ExpenseAccess;
  expectedRevision?: number;
  /** Apply the fields/history and describe its event. Null means return without saving. */
  change: (
    expense: HydratedDocument<IExpenseDocument>,
    group: IGroupDocument,
  ) => {
    financialEdit?: boolean;
    activity?: { type: 'expense_updated' | 'expense_deleted'; metadata: Record<string, unknown> };
  } | null;
}

async function requireCommitGroup(groupId: string, actorId?: string) {
  const group = await Group.findById(groupId);
  if (!group) throw new Refusal('FORBIDDEN');
  if (group.isArchived) throw new Refusal('GROUP_ARCHIVED');
  const members = new Set(group.members.map((member) => String(member.user)));
  if (actorId !== undefined && !members.has(actorId)) throw new Refusal('FORBIDDEN');
  return { group, members };
}

/** Change once under the displayed revision; callers cannot separate loading from committing. */
export async function changeLedgerExpense({
  access,
  expectedRevision,
  change,
}: LedgerExpenseChange) {
  const { actorId, groupId, expenseId } = access;
  await connectDB();
  const group = await Group.findOne({ _id: groupId, 'members.user': actorId });
  if (!group) throw new Refusal('FORBIDDEN');
  if (group.isArchived) throw new Refusal('GROUP_ARCHIVED');
  // Old Expenses get their first revision even when the displayed revision is absent.
  await withGroupMutation(
    groupId,
    async (session) => {
      await requireCommitGroup(groupId, actorId);
      return Expense.collection.updateOne(
        {
          _id: new Types.ObjectId(expenseId),
          group: new Types.ObjectId(groupId),
          revision: { $exists: false },
        },
        { $set: { revision: 0 } },
        { session },
      );
    },
    { ledger: true },
  );
  const expense = await Expense.findOne({ _id: expenseId, group: groupId }).select(
    '+pendingActivity',
  );
  if (!expense) return null;
  assertExpectedRevision(expense.revision, expectedRevision);
  const involvedBefore = involvedMembers(expense);
  const originalCurrency = expense.currency;
  const wasDeleted = expense.isDeleted;
  const prepared = change(expense, group);
  if (!prepared) return expense;
  let event: IPendingActivity | undefined;
  if (prepared.activity) {
    assertPendingActivityCapacity(expense.pendingActivity);
    event = makePendingActivity(
      groupId,
      prepared.activity.type,
      actorId,
      prepared.activity.metadata,
    );
    expense.pendingActivity.push(event);
  }
  const involved = [...involvedBefore, ...involvedMembers(expense)];
  await withGroupMutation(
    groupId,
    async () => {
      if (wasDeleted && !expense.isDeleted)
        await lockRestoredCurrency(groupId, expense.currency, expenseId);
      else if (originalCurrency !== expense.currency)
        await lockLedgerCurrency(groupId, expense.currency);
      const { members } = await requireCommitGroup(groupId, actorId);
      if (prepared.financialEdit || (wasDeleted && !expense.isDeleted))
        assertExpenseParticipants(members, expense.paidBy, expense.splitBetween);
      if (event && expenseChangeAlertsEnabled()) {
        const intent = expense.pendingActivity.find(
          (pending) => String(pending._id) === String(event._id),
        );
        if (intent)
          intent.notificationContext = ledgerNotificationContext(
            event,
            prepared.activity!.type,
            { groupId, recordId: String(expense._id) },
            involved,
            members,
          );
      }
      return expense.save();
    },
    { ledger: true },
  );
  // Changes historically publish directly after their save, unlike nested creation recordings.
  await activityService.publishPending('expenses', expense._id, expense.pendingActivity);
  return expense;
}

const PENDING_ACTIVITY_LIMIT = 100;

function makePendingActivity(
  groupId: string,
  type: ActivityType,
  actorId: string,
  metadata: Record<string, unknown> = {},
  occurredAt: Date = new Date(),
): IPendingActivity {
  return {
    _id: new Types.ObjectId(),
    group: new Types.ObjectId(groupId),
    type,
    actor: new Types.ObjectId(actorId),
    occurredAt: new Date(occurredAt),
    // Snapshot now: callers may subsequently mutate an expense or a changes object.
    metadata: JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>,
  };
}

/**
 * The private immutable alert context for one Expense or Settlement event, captured inside the
 * financial commit: its involved members (an Expense's payers and split participants, before and
 * after for an edit; a Settlement's payer and recipient) who are Group members at that commit,
 * without the event's actor.
 */
function ledgerNotificationContext(
  event: Pick<IPendingActivity, '_id' | 'actor' | 'occurredAt'>,
  kind: NotificationKind,
  record: { groupId: string; recordId: string },
  involved: Iterable<unknown>,
  membersAtCommit: ReadonlySet<string>,
): NotificationContext {
  const actor = String(event.actor);
  return {
    version: 2,
    eventId: String(event._id),
    kind,
    groupId: record.groupId,
    recordId: record.recordId,
    occurredAt: event.occurredAt,
    recipientIds: [...new Set(Array.from(involved, String))]
      .filter((candidate) => candidate !== actor && membersAtCommit.has(candidate))
      .sort(),
  };
}

/** Refuse another mutation before committing if a sustained outage has filled this outbox. */
function assertPendingActivityCapacity(events: readonly IPendingActivity[] = []): void {
  if (events.length >= PENDING_ACTIVITY_LIMIT) throw new Refusal('ACTIVITY_BACKLOG_FULL');
}

/**
 * Whether the Group's ledger still holds this currency: a live Expense (other than `except`) or a
 * Settlement uses it, as an older Group's currency the list no longer names may be.
 */
async function ledgerStillUses(groupId: string, currency: string, except?: string) {
  return Boolean(
    (await Expense.exists({
      group: groupId,
      currency,
      isDeleted: { $ne: true },
      ...(except ? { _id: { $ne: except } } : {}),
    })) || (await Settlement.exists({ group: groupId, currency })),
  );
}

/**
 * A Settlement clears a Debt in one of the Group's currencies, or in an older currency its
 * ledger still holds (#727); either way it locks the main currency. Run inside the insert's own
 * Group mutation, so a removal of the currency can't come in between (#721).
 */
async function lockClearedCurrency(groupId: string, currency: string): Promise<void> {
  try {
    await lockLedgerCurrency(groupId, currency);
    return;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'CURRENCY_MISMATCH') throw error;
  }
  if (!(await ledgerStillUses(groupId, currency))) throw new Refusal('CURRENCY_MISMATCH');
  await withGroupMutation(groupId, async () =>
    Group.updateOne({ _id: groupId }, { $set: { currencyLocked: true } }, { timestamps: false }),
  );
}

/**
 * A deleted Expense comes back in its currency while the Group lists it, or while the ledger
 * still holds it otherwise. Otherwise the refusal says how to bring it back. Run inside the
 * restore's own Group mutation.
 */
async function lockRestoredCurrency(
  groupId: string,
  currency: string,
  expenseId: string,
): Promise<void> {
  try {
    await lockLedgerCurrency(groupId, currency);
    return;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'CURRENCY_MISMATCH') throw error;
  }
  if (!(await ledgerStillUses(groupId, currency, expenseId)))
    throw new MoneyValidationError(
      'CURRENCY_MISMATCH',
      `Add ${currency} to the Group’s currencies to restore it.`,
    );
}
