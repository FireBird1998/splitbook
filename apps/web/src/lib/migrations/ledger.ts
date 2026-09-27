import { ObjectId, type Db } from 'mongodb';
import { createLedgerIndexes } from '@/lib/ledger-indexes';
import { migrateLedgerMoney } from './ledger-money';
import {
  auditTagReferences,
  migrateTagReferences,
  type TagReferenceMapping,
} from './tag-references';

export interface LedgerMigrationOptions {
  apply?: boolean;
  mappings?: readonly TagReferenceMapping[];
}

async function auditMetadata(db: Db) {
  const groups = await db
    .collection('groups')
    .find({}, { projection: { currencyLocked: 1 } })
    .toArray();
  const byId = new Map(groups.map((group) => [String(group._id), group]));
  const referenced = new Set<string>();
  const issues: Array<{ collection: string; id: string; reason: string }> = [];
  let revisionsPlanned = 0;
  for (const collection of ['expenses', 'recurringexpenses', 'settlements']) {
    for await (const record of db
      .collection(collection)
      .find({}, { projection: { group: 1, revision: 1 } })) {
      const groupId = String(record.group);
      if (
        !(record.group instanceof ObjectId) ||
        (byId.has(groupId) && !(byId.get(groupId)!._id instanceof ObjectId))
      )
        issues.push({
          collection,
          id: String(record._id),
          reason: 'Invalid Group identity; BSON ObjectId required',
        });
      else if (!byId.has(groupId))
        issues.push({ collection, id: String(record._id), reason: 'Missing Group' });
      else referenced.add(groupId);
      if (collection === 'settlements') continue;
      if (record.revision === undefined) revisionsPlanned += 1;
      else if (!Number.isSafeInteger(record.revision) || record.revision < 0) {
        issues.push({
          collection,
          id: String(record._id),
          reason: 'Invalid existing revision; review required',
        });
      }
    }
  }
  const groupIdsToLock = [...referenced]
    .filter((id) => byId.get(id)?.currencyLocked !== true)
    .map((id) => byId.get(id)!._id);
  return { revisionsPlanned, groupsToLock: groupIdsToLock.length, groupIdsToLock, issues };
}

/** Operators must stop writers. Both data audits complete before either migration writes. */
export async function migrateLedger(db: Db, options: LedgerMigrationOptions = {}) {
  const [moneyAudit, tagAudit, metadata] = await Promise.all([
    migrateLedgerMoney(db),
    auditTagReferences(db, { mappings: options.mappings }),
    auditMetadata(db),
  ]);
  const report = {
    status: 'audited' as 'audited' | 'blocked' | 'applied',
    dryRun: !options.apply,
    money: moneyAudit,
    tags: tagAudit,
    metadata: {
      revisionsPlanned: metadata.revisionsPlanned,
      revisionsApplied: 0,
      groupsToLock: metadata.groupsToLock,
      groupsLocked: 0,
      issues: metadata.issues,
    },
    indexes: 'not-run' as 'not-run' | 'created',
  };
  if (moneyAudit.issues.length || tagAudit.issues.length || metadata.issues.length) {
    report.status = 'blocked';
    return report;
  }
  if (!options.apply) return report;

  report.money = await migrateLedgerMoney(db, { apply: true });
  if (report.money.issues.length) {
    report.status = 'blocked';
    return report;
  }
  report.tags = await migrateTagReferences(db, { apply: true, mappings: options.mappings });
  if (report.tags.issues.length) {
    report.status = 'blocked';
    return report;
  }

  for (const collection of ['expenses', 'recurringexpenses']) {
    const result = await db
      .collection(collection)
      .updateMany({ revision: { $exists: false } }, { $set: { revision: 0 } });
    report.metadata.revisionsApplied += result.modifiedCount;
  }
  if (metadata.groupIdsToLock.length) {
    const result = await db
      .collection('groups')
      .updateMany({ _id: { $in: metadata.groupIdsToLock } }, { $set: { currencyLocked: true } });
    report.metadata.groupsLocked = result.modifiedCount;
  }
  await createLedgerIndexes(db);
  report.indexes = 'created';
  report.status = 'applied';
  return report;
}
