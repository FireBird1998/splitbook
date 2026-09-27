import mongoose from 'mongoose';
import type { Db } from 'mongodb';

/** Both MongoDB driver instances provide this index-creation surface. */
interface LedgerIndexDatabase {
  collection(name: string): {
    createIndex(
      keys: Record<string, 1 | -1>,
      options: {
        unique: boolean;
        partialFilterExpression: Record<string, { $type: 'string' | 'objectId' }>;
      },
    ): Promise<string>;
  };
}

async function createLedgerWriteIndexes(db: LedgerIndexDatabase): Promise<void> {
  for (const collection of ['expenses', 'settlements']) {
    await db
      .collection(collection)
      .createIndex(
        { group: 1, createdBy: 1, 'creationRequest.key': 1 },
        { unique: true, partialFilterExpression: { 'creationRequest.key': { $type: 'string' } } },
      );
  }
  await db
    .collection('expenses')
    .createIndex(
      { recurringExpense: 1, period: 1 },
      { unique: true, partialFilterExpression: { recurringExpense: { $type: 'objectId' } } },
    );
}

/** Explicit index creation is part of rollout, not an assumption about autoIndex settings. */
export async function createLedgerIndexes(db: Db): Promise<void> {
  await createLedgerWriteIndexes(db);
  await db.collection('expenses').createIndex({ group: 1, isDeleted: 1, date: -1, createdAt: -1 });
  await db.collection('expenses').createIndex({ group: 1, tagId: 1 });
  await db.collection('activities').createIndex({ group: 1, createdAt: -1, _id: -1 });
}

let indexedDatabase: unknown;
let promise: Promise<void> | undefined;
/** Same guarantees for fresh installs and migrated ledgers, even with autoIndex disabled. */
export async function ensureLedgerWriteIndexes(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Database unavailable');
  if (indexedDatabase !== db) {
    indexedDatabase = db;
    promise = undefined;
  }
  if (!promise)
    promise = createLedgerWriteIndexes(db).catch((error) => {
      promise = undefined;
      throw error;
    });
  await promise;
}
