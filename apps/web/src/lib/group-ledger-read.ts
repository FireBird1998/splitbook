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
  missingGroup?: 'forbidden' | 'not-found';
  deletionMarker?: 'refuse' | 'allow-retained-members';
  recurring?: 'materialize' | 'recorded-only';
  /** Preserve admission before request validation, and validation before any materialization. */
  validate?: () => void;
  read: (group: LedgerReadGroup) => Promise<T>;
}

/** Supply the admitted Group to the read; refuse access revoked while it was running. */
export async function readGroupLedger<T>({
  actor,
  groupId,
  missingGroup = 'forbidden',
  deletionMarker = 'refuse',
  recurring = 'materialize',
  validate,
  read,
}: GroupLedgerRead<T>): Promise<T> {
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
    ...(actor.kind === 'member' && deletionMarker === 'allow-retained-members'
      ? {}
      : { deletionRequestedAt: null }),
    ...(actor.kind === 'assistant' ? { assistantRule: { $ne: 'not_allowed' as const } } : {}),
  };
  const group = await Group.findOne(access)
    .populate<{ members: LedgerReadGroup['members'] }>('members.user', PERSON_FIELDS)
    .lean();
  if (!group) {
    if (missingGroup === 'not-found' && !(await Group.exists({ _id: groupId })))
      throw new Refusal('NOT_FOUND', { resource: 'Group' });
    throw new Refusal('FORBIDDEN');
  }
  validate?.();
  if (recurring === 'materialize') await recurringExpenseService.generateDueExpenses(groupId);
  const result = await read(group);
  if (!(await Group.exists(access))) throw new Refusal('FORBIDDEN');
  return result;
}
