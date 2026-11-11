import { Types } from 'mongoose';
import type { ActivityType } from '@splitbook/shared/types';
import type { IPendingActivity } from '../financial-write';

/** Stored outbox data for tests of publication, cleanup and backlog limits. */
export function pendingActivityFixture(
  groupId: string,
  type: ActivityType,
  actorId: string,
  metadata: Record<string, unknown> = {},
  occurredAt = new Date(),
): IPendingActivity {
  return {
    _id: new Types.ObjectId(),
    group: new Types.ObjectId(groupId),
    type,
    actor: new Types.ObjectId(actorId),
    occurredAt: new Date(occurredAt),
    metadata: JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>,
  };
}
