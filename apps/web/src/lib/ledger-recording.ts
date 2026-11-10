import 'server-only';
import { Refusal } from '@splitbook/shared/refusals';
import type { ActivityType } from '@splitbook/shared/types';
import type { HydratedDocument, Model, Types } from 'mongoose';
import connectDB from './db';
import { afterGroupCommit, supportsGroupTransactions, withGroupMutation } from './group-mutation';
import { ensureLedgerWriteIndexes } from './ledger-indexes';
import { lockClearedCurrency, lockLedgerCurrency } from './ledger-currency';
import {
  assertCreateReplay,
  createRequestMetadata,
  makePendingActivity,
  ledgerNotificationContext,
  expenseChangeAlertsEnabled,
  paymentAlertsEnabled,
  type ICreationRequest,
  type IPendingActivity,
  type NotificationKind,
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
  document: Partial<T>;
  activity: {
    type: ActivityType;
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
export interface LedgerRecording<T extends LedgerRecord> {
  groupId: string;
  actorId: string;
  model: Model<T>;
  transactions: 'allow-standalone' | { required: Refusal };
  compatibility?: {
    membership: 'before-retry' | 'before-retry-and-at-commit';
    missingGroup?: 'fault';
    standaloneArchive?: 'fence-only';
  };
  retry?: {
    key: string;
    command: Record<string, unknown>;
    receipt?: 'ordered-records';
    atCommit?: true;
  };
  currencies: readonly CurrencyUse[];
  checkPeople: (members: Set<string>) => void;
  /** The batch reads presentation data after its commit-time replay; other writers prepare before the fence. */
  prepareAt?: 'commit';
  prepareResponseRecord?: (record: HydratedDocument<T>) => Promise<unknown>;
  prepare: () => Promise<ReadonlyArray<LedgerRecordDescription<T>>>;
}

/** Record a description; callers never sequence retry, commit and publication themselves. */
export async function recordLedger<T extends LedgerRecord>(description: LedgerRecording<T>) {
  const { groupId, actorId, model, retry } = description;
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
  const checkMembers = (group: IGroupDocument) => {
    const members = new Set(group.members.map((member) => String(member.user)));
    if (!members.has(actorId)) throw new Refusal('FORBIDDEN');
    description.checkPeople(members);
  };
  let admittedGroup: IGroupDocument | undefined;
  // Payment writers historically validate people even before confirming a stored retry.
  if (description.compatibility?.membership) {
    admittedGroup = (await Group.findById(groupId).lean()) ?? undefined;
    if (!admittedGroup) {
      if (description.compatibility?.missingGroup === 'fault') throw new Error('Group not found');
      throw new Refusal('FORBIDDEN');
    }
    checkMembers(admittedGroup);
  }
  const replay = async () => {
    if (!retry) return null;
    const first = await model
      .findOne({ group: groupId, createdBy: actorId, 'creationRequest.key': retry.key })
      .select('+creationRequest +pendingActivity +batchSettlementIds');
    if (!first) return null;
    assertCreateReplay(first.creationRequest!, retry.command);
    if (!retry.receipt) return [first];
    if (!first.batchSettlementIds?.length) throw new Error('IDEMPOTENCY_CONFLICT');
    const saved = await model
      .find({ group: groupId, _id: { $in: first.batchSettlementIds } })
      .select('+pendingActivity');
    if (saved.length !== first.batchSettlementIds.length)
      throw new Error('Incomplete stored Settlement batch');
    return first.batchSettlementIds.map((id) => saved.find((row) => row._id.equals(id))!);
  };
  const publish = async (rows: HydratedDocument<T>[]) => {
    for (const row of rows) {
      await afterGroupCommit(() =>
        activityService.publishPending(source, row._id, row.pendingActivity),
      );
      await description.prepareResponseRecord?.(row);
    }
    return rows;
  };
  const existing = await replay();
  if (existing) return publish(existing);
  if (description.transactions !== 'allow-standalone' && !(await supportsGroupTransactions()))
    throw description.transactions.required;
  if (admittedGroup?.isArchived && description.compatibility?.membership === 'before-retry')
    throw new Refusal('GROUP_ARCHIVED');
  const prepared = description.prepareAt === 'commit' ? undefined : await description.prepare();
  let saved: HydratedDocument<T>[];
  try {
    saved = await withGroupMutation(
      groupId,
      async (session) => {
        if (description.transactions !== 'allow-standalone' && !session)
          throw description.transactions.required;
        await lockCurrencies(description.currencies);
        const group = await Group.findById(groupId).lean();
        if (!group) throw new Refusal('FORBIDDEN');
        if (group.isArchived) {
          // Standalone payments historically rely on the fence's earlier archive check.
          // A real independent archive can commit after it, while currencies are being locked.
          const legacyStandalone =
            description.compatibility?.standaloneArchive === 'fence-only' &&
            !(await supportsGroupTransactions());
          if (!legacyStandalone) throw new Refusal('GROUP_ARCHIVED');
        }
        if (description.compatibility?.membership !== 'before-retry') checkMembers(group);
        if (retry?.atCommit) {
          const concurrent = await replay();
          if (concurrent) return concurrent;
        }
        const descriptions = prepared ?? (await description.prepare());
        const result: HydratedDocument<T>[] = [];
        for (const [index, entry] of descriptions.entries()) {
          await lockCurrencies(entry.currencies ?? []);
          const record = await entry.build(group);
          const event = makePendingActivity(
            groupId,
            record.activity.type,
            actorId,
            record.activity.metadata,
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
                index === 0 && retry ? createRequestMetadata(retry.key, retry.command) : undefined,
              batchSettlementIds:
                index === 0 && retry?.receipt === 'ordered-records'
                  ? descriptions.map((entry) => entry.id)
                  : undefined,
              pendingActivity: [event],
            }),
          );
        }
        return result;
      },
      { ledger: true },
    );
  } catch (error) {
    if (retry && (error as { code?: number }).code === 11000) {
      const raced = await replay();
      if (raced) return publish(raced);
    }
    throw error;
  }
  return publish(saved);
}
