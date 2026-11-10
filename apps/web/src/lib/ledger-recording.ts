import 'server-only';
import { Refusal } from '@splitbook/shared/refusals';
import type { ActivityType } from '@splitbook/shared/types';
import type { Model, Types } from 'mongoose';
import connectDB from './db';
import { withGroupMutation } from './group-mutation';
import { ensureLedgerWriteIndexes } from './ledger-indexes';
import { lockLedgerCurrency } from './ledger-currency';
import {
  assertCreateReplay,
  createRequestMetadata,
  makePendingActivity,
  type ICreationRequest,
  type IPendingActivity,
  type NotificationKind,
} from './financial-write';
import Group, { type IGroupDocument } from './models/Group';
import { activityService, type ActivitySource } from './services/activity.service';

interface LedgerRecord {
  _id: Types.ObjectId;
  creationRequest?: ICreationRequest;
  pendingActivity: IPendingActivity[];
}
interface RecordingEntry<T> {
  document: Partial<T> & { _id: Types.ObjectId };
  activity: {
    type: ActivityType;
    metadata: Record<string, unknown>;
    alert: { kind: NotificationKind; involved: readonly string[]; switch: 'always' };
  };
}
export interface LedgerRecording<T extends LedgerRecord> {
  groupId: string;
  actorId: string;
  model: Model<T>;
  source: ActivitySource;
  retry?: { key: string; command: Record<string, unknown> };
  currencies: ReadonlyArray<{ currency: string; rule: 'listed' }>;
  checkPeople: (members: ReadonlySet<string>) => void;
  entries: (group: IGroupDocument) => Promise<RecordingEntry<T>[]>;
}

/** Record a description; callers never sequence retry, commit and publication themselves. */
export async function recordLedger<T extends LedgerRecord>(description: LedgerRecording<T>) {
  const { groupId, actorId, model, retry } = description;
  await connectDB();
  await ensureLedgerWriteIndexes();
  if (retry) {
    const existing = await model
      .findOne({ group: groupId, createdBy: actorId, 'creationRequest.key': retry.key })
      .select('+creationRequest +pendingActivity');
    if (existing) {
      assertCreateReplay(existing.creationRequest!, retry.command);
      await activityService.publishPending(
        description.source,
        existing._id,
        existing.pendingActivity,
      );
      return [existing];
    }
  }
  const saved = await withGroupMutation(
    groupId,
    async () => {
      for (const use of description.currencies) await lockLedgerCurrency(groupId, use.currency);
      const group = await Group.findById(groupId).lean();
      if (!group) throw new Refusal('FORBIDDEN');
      if (group.isArchived) throw new Refusal('GROUP_ARCHIVED');
      const result = [];
      for (const [index, entry] of (await description.entries(group)).entries()) {
        const event = makePendingActivity(
          groupId,
          entry.activity.type,
          actorId,
          entry.activity.metadata,
        );
        result.push(
          await model.create({
            ...entry.document,
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
  for (const row of saved)
    await activityService.publishPending(description.source, row._id, row.pendingActivity);
  return saved;
}
