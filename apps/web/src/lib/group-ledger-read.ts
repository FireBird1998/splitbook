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
  /** Trusted session subject or validated grant subject. */
  actor: LedgerReadActor;
  groupId: string;
  missingGroup?: 'forbidden' | 'not-found';
  deletionMarker?: 'refuse' | 'allow-retained-members';
  recurring?: 'materialize' | 'recorded-only';
  /** Minimum Group role for this read. */
  requiredRole?: 'member' | 'admin';
  /** Preserve admission before request validation, and validation before any materialization. */
  validate?: () => void;
  read: (group: LedgerReadGroup, storedGroup: IGroupDocument) => Promise<T>;
}

/** Supply the admitted Group to the read; refuse access revoked while it was running. */
export async function readGroupLedger<T>({
  actor,
  groupId,
  missingGroup = 'forbidden',
  deletionMarker = 'refuse',
  recurring = 'materialize',
  requiredRole = 'member',
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
    ...(requiredRole === 'admin'
      ? { members: { $elemMatch: { user: actor.id, role: 'admin' as const } } }
      : { 'members.user': actor.id }),
    ...(actor.kind === 'member' && deletionMarker === 'allow-retained-members'
      ? {}
      : { deletionRequestedAt: null }),
    ...(actor.kind === 'assistant' ? { assistantRule: { $ne: 'not_allowed' as const } } : {}),
  };
  const storedGroup = await Group.findOne(access).lean();
  if (!storedGroup) {
    if (
      actor.kind === 'member' &&
      missingGroup === 'not-found' &&
      !(await Group.exists({ _id: groupId }))
    )
      throw new Refusal('NOT_FOUND', { resource: 'Group' });
    throw new Refusal('FORBIDDEN');
  }
  // Keep stored member identities for review fingerprints and member-id computations.
  const group = await Group.populate<{ members: LedgerReadGroup['members'] }>(
    { ...storedGroup, members: storedGroup.members.map((member) => ({ ...member })) },
    { path: 'members.user', select: PERSON_FIELDS, options: { lean: true } },
  );
  validate?.();
  if (recurring === 'materialize') await recurringExpenseService.generateDueExpenses(groupId);
  const result = await read(group, storedGroup);
  if (!(await Group.exists(access))) throw new Refusal('FORBIDDEN');
  return result;
}
