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
}
interface NewLedgerRecord<T> {
  // The module overwrites Group, actor, retry metadata and pending Activity below.
  document: Partial<T> & { _id: Types.ObjectId };
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
export interface LedgerRecording<T extends LedgerRecord> {
  groupId: string;
  actorId: string;
  model: Model<T>;
  transactions: 'allow-standalone' | { required: Refusal };
  compatibility?: { membership: 'before-retry'; missingGroup?: 'fault' };
  retry?: { key: string; command: Record<string, unknown> };
  currencies: ReadonlyArray<{ currency: string; rule: 'listed' | 'held-by-ledger' }>;
  checkPeople: (members: Set<string>) => void;
  /** Snapshot presentation data after replay, before waiting for the recording fence.
   * Each returned description is then built from the committed Group, sequentially.
   */
  prepare: () => Promise<ReadonlyArray<(group: IGroupDocument) => Promise<NewLedgerRecord<T>>>>;
}

/** Record a description; callers never sequence retry, commit and publication themselves. */
export async function recordLedger<T extends LedgerRecord>(description: LedgerRecording<T>) {
  const { groupId, actorId, model, retry } = description;
  await connectDB();
  await ensureLedgerWriteIndexes();
  const source = model.collection.collectionName;
  if (source !== 'expenses' && source !== 'settlements')
    throw new Error('Ledger recording needs an Expense or Settlement model');
  const checkMembers = (group: IGroupDocument) => {
    const members = new Set(group.members.map((member) => String(member.user)));
    if (!members.has(actorId)) throw new Refusal('FORBIDDEN');
    description.checkPeople(members);
  };
  let admittedGroup: IGroupDocument | undefined;
  // Single payments historically validate people even before confirming a stored retry.
  if (description.compatibility?.membership === 'before-retry') {
    admittedGroup = (await Group.findById(groupId).lean()) ?? undefined;
    if (!admittedGroup) {
      if (description.compatibility.missingGroup === 'fault') throw new Error('Group not found');
      throw new Refusal('FORBIDDEN');
    }
    checkMembers(admittedGroup);
  }
  const replay = async () => {
    if (!retry) return null;
    const existing = await model
      .findOne({ group: groupId, createdBy: actorId, 'creationRequest.key': retry.key })
      .select('+creationRequest +pendingActivity');
    if (existing) assertCreateReplay(existing.creationRequest!, retry.command);
    return existing;
  };
  const publish = async (rows: HydratedDocument<T>[]) => {
    for (const row of rows)
      await afterGroupCommit(() =>
        activityService.publishPending(source, row._id, row.pendingActivity),
      );
    return rows;
  };
  const existing = await replay();
  if (existing) return publish([existing]);
  if (description.transactions !== 'allow-standalone' && !(await supportsGroupTransactions()))
    throw description.transactions.required;
  if (admittedGroup?.isArchived) throw new Refusal('GROUP_ARCHIVED');
  const descriptions = await description.prepare();
  let saved: HydratedDocument<T>[];
  try {
    saved = await withGroupMutation(
      groupId,
      async () => {
        for (const use of description.currencies) {
          if (use.rule === 'held-by-ledger') await lockClearedCurrency(groupId, use.currency);
          else await lockLedgerCurrency(groupId, use.currency);
        }
        const group = await Group.findById(groupId).lean();
        if (!group) throw new Refusal('FORBIDDEN');
        if (group.isArchived) throw new Refusal('GROUP_ARCHIVED');
        if (description.compatibility?.membership !== 'before-retry') checkMembers(group);
        const result: HydratedDocument<T>[] = [];
        for (const [index, build] of descriptions.entries()) {
          const record = await build(group);
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
              { groupId, recordId: String(record.document._id) },
              alert.involved,
              new Set(group.members.map((member) => String(member.user))),
            );
          result.push(
            await model.create({
              ...record.document,
              group: groupId,
              createdBy: actorId,
              ...(index === 0 && retry
                ? { creationRequest: createRequestMetadata(retry.key, retry.command) }
                : {}),
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
      if (raced) return publish([raced]);
    }
    throw error;
  }
  return publish(saved);
}
