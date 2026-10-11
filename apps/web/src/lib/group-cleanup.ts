import { z } from 'zod';
import { type Db, ObjectId } from 'mongodb';
import type { mongo } from 'mongoose';
type InventoryDatabase = Db | mongo.Db;

export const groupOwnedCollections = [
  'expenses',
  'settlements',
  'activities',
  'recurringexpenses',
  'invitations',
  // Append only: in-progress cleanup receipts persist the numeric collection index.
  'expensedrafts',
] as const;
export type GroupOwnedCollection = (typeof groupOwnedCollections)[number];
export type GroupRecordCounts = Record<GroupOwnedCollection, number>;
export interface OrphanGroupInventory {
  version: 1;
  environment: string;
  database: string;
  generatedAt: string;
  groups: Array<{
    id: string;
    name: string;
    theme: string;
    archived: boolean;
    updatedAt: string | null;
    revision: number | null;
    memberCount: 0;
    counts: GroupRecordCounts;
  }>;
  missingParents: Array<{ groupId: string; counts: GroupRecordCounts }>;
}

/** Metadata only: callers separately verify membership and read dependent counts. */
export function projectOrphanGroup(
  group: {
    _id: unknown;
    name?: unknown;
    category?: unknown;
    isArchived?: unknown;
    updatedAt?: unknown;
    __v?: unknown;
  },
  counts: GroupRecordCounts,
): OrphanGroupInventory['groups'][number] {
  return {
    id: String(group._id),
    name: typeof group.name === 'string' ? group.name : '(unnamed)',
    theme: typeof group.category === 'string' ? group.category : 'unknown',
    archived: group.isArchived === true,
    updatedAt: group.updatedAt instanceof Date ? group.updatedAt.toISOString() : null,
    revision: typeof group.__v === 'number' ? group.__v : null,
    memberCount: 0,
    counts,
  };
}

async function countsFor(db: InventoryDatabase, group: ObjectId): Promise<GroupRecordCounts> {
  const counts = await Promise.all(
    groupOwnedCollections.map(
      async (name) => [name, await db.collection(name).countDocuments({ group })] as const,
    ),
  );
  return Object.fromEntries(counts) as GroupRecordCounts;
}

/** Raw read-only audit: never registers models, creates indexes, materializes or sweeps. */
export async function inventoryOrphanGroups(
  db: InventoryDatabase,
  environment: string,
): Promise<OrphanGroupInventory> {
  if (!environment.trim()) throw new Error('An explicit environment is required');
  const groups: OrphanGroupInventory['groups'] = [];
  // Equality to [] excludes malformed/missing members and unresolved User references.
  for await (const group of db
    .collection('groups')
    .find({ members: { $type: 'array', $size: 0 } })
    .sort({ _id: 1 })) {
    groups.push(projectOrphanGroup(group, await countsFor(db, group._id)));
  }
  const missing = new Map<string, GroupRecordCounts>();
  for (const collection of groupOwnedCollections) {
    const cursor = db.collection(collection).aggregate<{
      _id: ObjectId;
      count: number;
    }>([{ $match: { group: { $type: 'objectId' } } }, { $group: { _id: '$group', count: { $sum: 1 } } }, { $lookup: { from: 'groups', localField: '_id', foreignField: '_id', as: 'parent' } }, { $match: { parent: { $size: 0 } } }, { $project: { _id: 1, count: 1 } }]);
    for await (const row of cursor) {
      const id = String(row._id);
      const counts = missing.get(id) ?? {
        expenses: 0,
        settlements: 0,
        activities: 0,
        recurringexpenses: 0,
        invitations: 0,
        expensedrafts: 0,
      };
      counts[collection] = row.count;
      missing.set(id, counts);
    }
  }
  return {
    version: 1,
    environment,
    database: db.databaseName,
    generatedAt: new Date().toISOString(),
    groups,
    missingParents: [...missing]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([groupId, counts]) => ({ groupId, counts })),
  };
}

const recordCountsSchema = z
  .object({
    expenses: z.number().int().nonnegative(),
    settlements: z.number().int().nonnegative(),
    activities: z.number().int().nonnegative(),
    recurringexpenses: z.number().int().nonnegative(),
    invitations: z.number().int().nonnegative(),
    expensedrafts: z.number().int().nonnegative().default(0),
  })
  .strict();
const selectedGroupSchema = z
  .object({
    id: z.string().regex(/^[a-f\d]{24}$/),
    name: z.string(),
    theme: z.string(),
    archived: z.boolean(),
    updatedAt: z.string().datetime().nullable(),
    revision: z.number().int().nullable(),
    memberCount: z.literal(0),
    counts: recordCountsSchema,
  })
  .strict();
export const orphanGroupManifestSchema = z
  .object({
    version: z.literal(1),
    environment: z.string().min(1),
    database: z.string().min(1),
    generatedAt: z.string().datetime(),
    groups: z.array(selectedGroupSchema).max(100),
    selectedGroupIds: z.array(z.string().regex(/^[a-f\d]{24}$/)).max(100),
    missingParents: z.array(z.object({ groupId: z.string(), counts: recordCountsSchema }).strict()),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (
      manifest.groups.length !== manifest.selectedGroupIds.length ||
      manifest.groups.some((group, index) => group.id !== manifest.selectedGroupIds[index]) ||
      new Set(manifest.selectedGroupIds).size !== manifest.selectedGroupIds.length
    )
      context.addIssue({
        code: 'custom',
        message: 'Selected IDs must exactly match the unique reviewed Group entries, in order',
      });
  });
export type OrphanGroupManifest = z.infer<typeof orphanGroupManifestSchema>;
