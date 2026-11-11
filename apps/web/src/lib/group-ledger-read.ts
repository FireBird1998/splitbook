import 'server-only';
import { Refusal } from '@splitbook/shared/refusals';
import type { Types } from 'mongoose';
import connectDB from './db';
import Group, { type IGroupDocument } from './models/Group';
import { PERSON_FIELDS } from './services/person-fields';
import { recurringExpenseService } from './services/recurring-expense.service';

export type LedgerReadActor =
  | { kind: 'member'; id: string }
  | { kind: 'assistant'; id: string; excludedGroupIds: readonly string[] };
export type LedgerReadGroup = Omit<IGroupDocument, 'members' | 'deletionRequestedAt'> & {
  members: Array<{
    user: { _id: Types.ObjectId; name: string; image?: string };
    role: 'admin' | 'member';
    joinedAt: Date;
  }>;
};
export interface GroupLedgerRead<T> {
  actor: LedgerReadActor;
  groupId: string;
  read: (group: LedgerReadGroup) => Promise<T>;
}

/** Authorize the Group once and supply its loaded data to the read. */
export async function readGroupLedger<T>({ actor, groupId, read }: GroupLedgerRead<T>): Promise<T> {
  await connectDB();
  const group = await Group.findById(groupId)
    .populate<{ members: LedgerReadGroup['members'] }>('members.user', PERSON_FIELDS)
    .lean();
  if (!group || !group.members.some((member) => String(member.user._id) === actor.id))
    throw new Refusal('FORBIDDEN');
  await recurringExpenseService.generateDueExpenses(groupId);
  return read(group);
}
