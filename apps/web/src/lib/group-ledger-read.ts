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
  now?: Date;
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
  now = new Date(),
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
    throw groupReadRefusal(actor);
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
    if (recurring === 'materialize')
      await recurringExpenseService.generateDueExpenses(groupId, now);
    result = await read(group, storedGroup);
  }
  if (!(await Group.exists(access))) throw groupReadRefusal(actor);
  return result;
}

export type GroupLedgersRead<T, Field extends keyof LedgerReadGroup = keyof LedgerReadGroup> = {
  actor: LedgerReadActor;
  archived: 'include' | 'exclude';
  deletionMarker?: GroupLedgerRead<T>['deletionMarker'];
  recurring?: GroupLedgerRead<T>['recurring'];
  now?: Date;
  sort?: Partial<Record<'name' | 'updatedAt' | '_id', 1 | -1>>;
  /** Select top-level Group fields with `_id`. Selecting members also populates them. */
  fields?: readonly Field[];
  read: (
    groups: Pick<LedgerReadGroup, Field | '_id'>[],
    storedGroups: Pick<IGroupDocument, Field | '_id'>[],
  ) => Promise<T>;
} &
  /** An exclusive id boundary and query limit, applied with this read's sort. */
  (| { groupIds?: never; page?: { after?: string; limit: number } }
    /** Every selected Group must be admitted, in the supplied order, before generation. */
    | { groupIds: readonly string[]; page?: never }
  );

/** Read the ledger over the Groups the actor may currently see. */
export async function readGroupLedgers<
  T,
  Field extends keyof LedgerReadGroup = keyof LedgerReadGroup,
>({
  actor,
  archived,
  deletionMarker = 'refuse',
  recurring = 'materialize',
  now = new Date(),
  groupIds,
  page,
  fields,
  sort = {},
  read,
}: GroupLedgersRead<T, Field>): Promise<T> {
  const access = {
    $and: [
      groupAccess(actor, { archived, deletionMarker }),
      ...(groupIds ? [{ _id: { $in: [...groupIds] } }] : []),
      ...(page?.after ? [{ _id: { $gt: page.after } }] : []),
    ],
  };
  await connectDB();
  const revoked = new Set<string>();
  const materialized = new Set<string>();
  const load = async () => {
    let storedGroups = await Group.find(
      revoked.size ? { $and: [access, { _id: { $nin: [...revoked] } }] } : access,
    )
      .sort(sort)
      .limit(page?.limit ?? 0)
      .select(fields ? ['_id', ...fields].join(' ') : '')
      .lean();
    if (groupIds) {
      const byId = new Map(storedGroups.map((group) => [String(group._id), group]));
      storedGroups = groupIds.map((id) => {
        const group = byId.get(id);
        if (!group) throw groupReadRefusal(actor);
        return group;
      });
    }
    const groups: (IGroupDocument | LedgerReadGroup)[] =
      fields && !fields.some((field) => field === 'members')
        ? storedGroups
        : await Group.populate<{ members: LedgerReadGroup['members'] }>(
            storedGroups.map((group) => ({
              ...group,
              members: group.members.map((member) => ({ ...member })),
            })),
            { path: 'members.user', select: PERSON_FIELDS, options: { lean: true } },
          );
    if (recurring === 'materialize') {
      await recurringExpenseService.generateDueExpensesForGroups(
        storedGroups.map((group) => String(group._id)).filter((id) => !materialized.has(id)),
        now,
      );
      storedGroups.forEach((group) => materialized.add(String(group._id)));
    }
    return { groups, storedGroups };
  };
  let { groups, storedGroups } = await load();
  // Recompute aggregates and capped lists over admitted Groups.
  // Page queries exclude every Group whose access was revoked.
  while (true) {
    const result = await read(groups as Pick<LedgerReadGroup, Field | '_id'>[], storedGroups);
    const current = await Group.find({
      $and: [access, { _id: { $in: storedGroups.map((group) => group._id) } }],
    })
      .select('_id')
      .lean();
    const admitted = new Set(current.map((group) => String(group._id)));
    if (storedGroups.every((group) => admitted.has(String(group._id)))) return result;
    if (groupIds) throw groupReadRefusal(actor);
    if (page) {
      storedGroups
        .filter((group) => !admitted.has(String(group._id)))
        .forEach((group) => revoked.add(String(group._id)));
      ({ groups, storedGroups } = await load());
    } else {
      storedGroups = storedGroups.filter((group) => admitted.has(String(group._id)));
      groups = groups.filter((group) => admitted.has(String(group._id)));
    }
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
    throw groupReadRefusal(actor);
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

/** Inaccessible Groups are indistinguishable to an assistant; tools supply their own words. */
function groupReadRefusal(actor: LedgerReadActor) {
  return actor.kind === 'assistant'
    ? new Refusal('NOT_FOUND', { resource: 'Group' })
    : new Refusal('FORBIDDEN');
}
