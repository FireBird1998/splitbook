import { ObjectId, type Db } from 'mongodb';
import { findReferencedTag, type IdentityTag } from '@splitbook/shared/tag-identity';

export interface TagReferenceMapping {
  groupId: string;
  legacyTag: string;
  tagId: string;
}

interface MigrationRecord {
  group: unknown;
  tag?: string;
  tagId?: unknown;
}

export type TagReferenceDecision =
  | { status: 'resolved'; tagId: string; source: 'existing' | 'exact-name' | 'mapping' }
  | {
      status:
        | 'unresolved'
        | 'ambiguous'
        | 'missing-group'
        | 'invalid-reference'
        | 'invalid-mapping';
    };

/** No case folding or fuzzy matching: historical identity must not be guessed. */
export function planTagReference(
  record: MigrationRecord,
  tags: IdentityTag[] | undefined,
  mappings: readonly TagReferenceMapping[] = [],
): TagReferenceDecision {
  if (!(record.group instanceof ObjectId)) return { status: 'invalid-reference' };
  if (!tags) return { status: 'missing-group' };
  if (record.tagId !== undefined && record.tagId !== null) {
    if (!(record.tagId instanceof ObjectId)) return { status: 'invalid-reference' };
    const existing = findReferencedTag(tags, record);
    return existing && existing._id instanceof ObjectId
      ? { status: 'resolved', tagId: String(existing._id), source: 'existing' }
      : { status: 'invalid-reference' };
  }
  const reviewed = mappings.filter(
    (mapping) => mapping.groupId === String(record.group) && mapping.legacyTag === record.tag,
  );
  if (reviewed.length > 0) {
    if (new Set(reviewed.map((mapping) => mapping.tagId)).size !== 1)
      return { status: 'invalid-mapping' };
    const target = tags.find((tag) => String(tag._id) === reviewed[0].tagId);
    return target && target._id instanceof ObjectId
      ? { status: 'resolved', tagId: String(target._id), source: 'mapping' }
      : { status: 'invalid-mapping' };
  }
  const matches = tags.filter((tag) => tag.name === record.tag);
  if (matches.length > 1) return { status: 'ambiguous' };
  if (matches.length === 0) return { status: 'unresolved' };
  if (!(matches[0]._id instanceof ObjectId)) return { status: 'invalid-reference' };
  return { status: 'resolved', tagId: String(matches[0]._id), source: 'exact-name' };
}

interface CollectionReport {
  scanned: number;
  alreadyResolved: number;
  planned: number;
  applied: number;
  blocked: number;
  conflicts: number;
}

export interface TagMigrationReport {
  dryRun: boolean;
  collections: Record<'expenses' | 'recurringexpenses', CollectionReport>;
  issues: Array<{
    collection: string;
    recordId: string;
    groupId: string;
    legacyTag?: string;
    reason: string;
  }>;
}

export interface TagMigrationOptions {
  /** Explicit opt-in; the default is a read-only audit. */
  apply?: boolean;
  mappings?: readonly TagReferenceMapping[];
  /** Bound a resumable batch. Subsequent invocations skip completed records. */
  maxUpdates?: number;
}

export async function migrateTagReferences(
  db: Db,
  options: TagMigrationOptions = {},
): Promise<TagMigrationReport> {
  if (
    options.maxUpdates !== undefined &&
    (!Number.isInteger(options.maxUpdates) || options.maxUpdates < 0)
  ) {
    throw new Error('maxUpdates must be a nonnegative integer');
  }
  const empty = (): CollectionReport => ({
    scanned: 0,
    alreadyResolved: 0,
    planned: 0,
    applied: 0,
    blocked: 0,
    conflicts: 0,
  });
  const report: TagMigrationReport = {
    dryRun: !options.apply,
    collections: { expenses: empty(), recurringexpenses: empty() },
    issues: [],
  };
  const groups = await db
    .collection('groups')
    .find({}, { projection: { tags: 1 } })
    .toArray();
  const tagsByGroup = new Map(
    groups.map((group) => [String(group._id), (group.tags ?? []) as IdentityTag[]]),
  );
  let applied = 0;
  for (const collection of ['expenses', 'recurringexpenses'] as const) {
    const stats = report.collections[collection];
    const cursor = db
      .collection(collection)
      .find({}, { projection: { group: 1, tag: 1, tagId: 1 } })
      .sort({ _id: 1 });
    for await (const record of cursor) {
      stats.scanned += 1;
      const input = { group: record.group, tag: record.tag, tagId: record.tagId };
      const decision = planTagReference(
        input,
        tagsByGroup.get(String(record.group)),
        options.mappings,
      );
      const issue = (reason: string) =>
        report.issues.push({
          collection,
          recordId: String(record._id),
          groupId: String(record.group),
          legacyTag: record.tag,
          reason,
        });
      if (decision.status !== 'resolved') {
        stats.blocked += 1;
        issue(decision.status);
        continue;
      }
      if (decision.source === 'existing') {
        stats.alreadyResolved += 1;
        continue;
      }
      stats.planned += 1;
      if (!options.apply || applied >= (options.maxUpdates ?? Infinity)) continue;

      // Recheck current Group state and compare the source fields in the write;
      // concurrent corrections are reported, never overwritten.
      const currentGroup = await db
        .collection('groups')
        .findOne({ _id: record.group }, { projection: { tags: 1 } });
      const current = planTagReference(
        input,
        currentGroup ? (currentGroup.tags ?? []) : undefined,
        options.mappings,
      );
      if (
        current.status !== 'resolved' ||
        current.tagId !== decision.tagId ||
        !ObjectId.isValid(decision.tagId)
      ) {
        stats.conflicts += 1;
        issue('group-changed');
        continue;
      }
      const result = await db
        .collection(collection)
        .updateOne(
          { _id: record._id, group: record.group, tag: record.tag, tagId: null },
          { $set: { tagId: new ObjectId(decision.tagId) } },
        );
      if (result.modifiedCount === 1) {
        stats.applied += 1;
        applied += 1;
      } else {
        stats.conflicts += 1;
        issue('record-changed');
      }
    }
  }
  return report;
}

export async function auditTagReferences(db: Db, options: Omit<TagMigrationOptions, 'apply'> = {}) {
  return migrateTagReferences(db, { ...options, apply: false });
}
