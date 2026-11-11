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
  validate?: (group: LedgerReadGroup, storedGroup: IGroupDocument) => void | NoInfer<T>;
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
  const access = groupAccess(actor, { groupId, deletionMarker, requiredRole });
  await connectDB();
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
  const validation = validate?.(group, storedGroup);
  let result: T;
  if (validation !== undefined) result = validation;
  else {
    if (recurring === 'materialize') await recurringExpenseService.generateDueExpenses(groupId);
    result = await read(group, storedGroup);
  }
  if (!(await Group.exists(access))) throw new Refusal('FORBIDDEN');
  return result;
}

export interface GroupLedgersRead<T> {
  actor: LedgerReadActor;
  archived: 'include' | 'exclude';
  deletionMarker?: GroupLedgerRead<T>['deletionMarker'];
  recurring?: GroupLedgerRead<T>['recurring'];
  now?: Date;
  sort?: Partial<Record<'name' | 'updatedAt' | '_id', 1 | -1>>;
  /** Every selected Group must be admitted, in the supplied order, before generation. */
  groupIds?: readonly string[];
  read: (groups: LedgerReadGroup[], storedGroups: IGroupDocument[]) => Promise<T>;
}

/** Read the ledger over the Groups the actor may currently see. */
export async function readGroupLedgers<T>({
  actor,
  archived,
  deletionMarker = 'refuse',
  recurring = 'materialize',
  now = new Date(),
  groupIds,
  sort = {},
  read,
}: GroupLedgersRead<T>): Promise<T> {
  const access = {
    $and: [
      groupAccess(actor, { archived, deletionMarker }),
      ...(groupIds ? [{ _id: { $in: [...groupIds] } }] : []),
    ],
  };
  await connectDB();
  let storedGroups = await Group.find(access).sort(sort).lean();
  if (groupIds) {
    const byId = new Map(storedGroups.map((group) => [String(group._id), group]));
    storedGroups = groupIds.map((id) => {
      const group = byId.get(id);
      if (!group) throw new Refusal('FORBIDDEN');
      return group;
    });
  }
  let groups = await Group.populate<{ members: LedgerReadGroup['members'] }>(
    storedGroups.map((group) => ({
      ...group,
      members: group.members.map((member) => ({ ...member })),
    })),
    { path: 'members.user', select: PERSON_FIELDS, options: { lean: true } },
  );
  if (recurring === 'materialize')
    await recurringExpenseService.generateDueExpensesForGroups(
      storedGroups.map((group) => String(group._id)),
      now,
    );
  // Aggregates and capped lists must be read again over the surviving Groups.
  // The set only shrinks, so even repeated revocations finish after at most one pass per Group.
  while (true) {
    const result = await read(groups, storedGroups);
    const current = await Group.find({
      $and: [access, { _id: { $in: storedGroups.map((group) => group._id) } }],
    })
      .select('_id')
      .lean();
    const admitted = new Set(current.map((group) => String(group._id)));
    if (storedGroups.every((group) => admitted.has(String(group._id)))) return result;
    if (groupIds) throw new Refusal('FORBIDDEN');
    storedGroups = storedGroups.filter((group) => admitted.has(String(group._id)));
    groups = groups.filter((group) => admitted.has(String(group._id)));
  }
}

/** One access rule for a Group and a list, including the member-only compatibility choices. */
function groupAccess(
  actor: LedgerReadActor,
  {
    groupId,
    archived = 'include',
    deletionMarker = 'refuse',
    requiredRole = 'member',
  }: {
    groupId?: string;
    archived?: GroupLedgersRead<unknown>['archived'];
    deletionMarker?: GroupLedgerRead<unknown>['deletionMarker'];
    requiredRole?: GroupLedgerRead<unknown>['requiredRole'];
  },
) {
  if (
    actor.kind === 'assistant' &&
    groupId &&
    actor.excludedGroupIds.some((id) => id.toLowerCase() === groupId)
  )
    throw new Refusal('FORBIDDEN');
  return {
    ...(groupId
      ? { _id: groupId }
      : actor.kind === 'assistant'
        ? { _id: { $nin: [...actor.excludedGroupIds] } }
        : {}),
    ...(requiredRole === 'admin'
      ? { members: { $elemMatch: { user: actor.id, role: 'admin' as const } } }
      : { 'members.user': actor.id }),
    ...(actor.kind === 'member' && deletionMarker === 'allow-retained-members'
      ? {}
      : { deletionRequestedAt: null }),
    ...(archived === 'exclude' ? { isArchived: false } : {}),
    ...(actor.kind === 'assistant' ? { assistantRule: { $ne: 'not_allowed' as const } } : {}),
  };
}
