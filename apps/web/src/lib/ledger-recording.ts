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
import { settlementDebtSnapshot } from './services/settlement-debt';
import Group, { type IGroupDocument } from './models/Group';
import { activityService, type ActivitySource } from './services/activity.service';

interface LedgerRecord {
  _id: Types.ObjectId;
  creationRequest?: ICreationRequest;
  pendingActivity: IPendingActivity[];
}
interface RecordingEntry<T> {
  /** Single payments require no Debt for a same-currency recording. */
  paymentDebt?: {
    sameCurrency: 'allow-without-debt';
    currency: string;
    paidCurrency?: string;
    paidBy: string;
    paidTo: string;
    amountMinor: number;
  };
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
  source: ActivitySource;
  transactions: 'allow-standalone' | { required: Refusal };
  compatibility?: { membership: 'before-retry'; missingGroup?: 'fault' };
  retry?: { key: string; command: Record<string, unknown> };
  currencies: ReadonlyArray<{ currency: string; rule: 'listed' | 'held-by-ledger' }>;
  checkPeople: (members: Set<string>) => void;
  entries: (group: IGroupDocument) => Promise<RecordingEntry<T>[]>;
}

/** Record a description; callers never sequence retry, commit and publication themselves. */
export async function recordLedger<T extends LedgerRecord>(description: LedgerRecording<T>) {
  const { groupId, actorId, model, retry } = description;
  await connectDB();
  await ensureLedgerWriteIndexes();
  const checkMembers = (group: IGroupDocument) => {
    const members = new Set(group.members.map((member) => String(member.user)));
    if (!members.has(actorId)) throw new Refusal('FORBIDDEN');
    description.checkPeople(members);
  };
  // Single payments historically validate people even before confirming a stored retry.
  if (description.compatibility?.membership === 'before-retry') {
    const admittedGroup = await Group.findById(groupId).lean();
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
        activityService.publishPending(description.source, row._id, row.pendingActivity),
      );
    return rows;
  };
  const existing = await replay();
  if (existing) return publish([existing]);
  if (description.transactions !== 'allow-standalone' && !(await supportsGroupTransactions()))
    throw description.transactions.required;
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
        const result = [];
        for (const [index, entry] of (await description.entries(group)).entries()) {
          const debt = entry.paymentDebt;
          const debtSnapshot = debt?.paidCurrency
            ? await settlementDebtSnapshot(
                groupId,
                debt.currency,
                debt.paidBy,
                debt.paidTo,
                debt.amountMinor,
              )
            : {};
          const event = makePendingActivity(groupId, entry.activity.type, actorId, {
            ...entry.activity.metadata,
            ...debtSnapshot,
          });
          const alert = entry.activity.alert;
          const capture =
            alert.switch === 'always' ||
            (alert.switch === 'payments' ? paymentAlertsEnabled() : expenseChangeAlertsEnabled());
          if (capture)
            event.notificationContext = ledgerNotificationContext(
              event,
              alert.kind,
              { groupId, recordId: String(entry.document._id) },
              alert.involved,
              new Set(group.members.map((member) => String(member.user))),
            );
          result.push(
            await model.create({
              ...entry.document,
              ...debtSnapshot,
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
