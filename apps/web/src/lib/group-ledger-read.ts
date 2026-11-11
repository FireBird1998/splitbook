import 'server-only';
import { Refusal } from '@splitbook/shared/refusals';
import { Types } from 'mongoose';
import connectDB from './db';
import Group, { type IGroupDocument } from './models/Group';
import { PERSON_FIELDS } from './services/person-fields';
import { recurringExpenseService } from './services/recurring-expense.service';

export type LedgerReadActor =
  | { kind: 'member'; id: string }
  | { kind: 'assistant'; id: string; excludedGroupIds: readonly string[] };
export type LedgerReadGroup = Omit<IGroupDocument, 'members' | 'deletionRequestedAt'> & {
  members: Array<{
    user: { _id: Types.ObjectId; name: string; image?: string } | null;
    role: 'admin' | 'member';
    joinedAt: Date;
  }>;
};
export interface GroupLedgerRead<T> {
  actor: LedgerReadActor;
  groupId: string;
  read: (group: LedgerReadGroup) => Promise<T>;
}

/** Supply the admitted Group to the read; refuse access revoked while it was running. */
export async function readGroupLedger<T>({ actor, groupId, read }: GroupLedgerRead<T>): Promise<T> {
  if (!Types.ObjectId.isValid(groupId)) throw new Refusal('INVALID_ID');
  groupId = new Types.ObjectId(groupId).toHexString();
  if (
    actor.kind === 'assistant' &&
    actor.excludedGroupIds.some((id) => id.toLowerCase() === groupId)
  )
    throw new Refusal('FORBIDDEN');
  await connectDB();
  const access = {
    _id: groupId,
    'members.user': actor.id,
    deletionRequestedAt: null,
    ...(actor.kind === 'assistant' ? { assistantRule: { $ne: 'not_allowed' } } : {}),
  };
  const group = await Group.findOne(access)
    .populate<{ members: LedgerReadGroup['members'] }>('members.user', PERSON_FIELDS)
    .lean();
  if (!group) throw new Refusal('FORBIDDEN');
  await recurringExpenseService.generateDueExpenses(groupId);
  const result = await read(group);
  if (!(await Group.exists(access))) throw new Refusal('FORBIDDEN');
  return result;
}
