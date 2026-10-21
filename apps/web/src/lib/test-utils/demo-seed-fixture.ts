import mongoose from 'mongoose';
import { BSON } from 'mongodb';
import { seedDemoData } from '@/lib/demo/seed';

/**
 * Seed through the real services once, then keep an in-memory BSON copy for independent
 * tests. Restores are setup only: lifecycle tests still call the real seed/reset operation
 * they assert on. Call after connecting/resetting the file's isolated integration database;
 * restore only into that empty database (beforeEach resets it, retaining its indexes).
 */
export async function captureDemoSeed() {
  const result = await seedDemoData();
  const db = mongoose.connection.db!;
  const snapshots = await Promise.all(
    (await db.collections()).map(async (collection) => ({
      name: collection.collectionName,
      documents: (await collection.find().toArray()).map((document) => BSON.serialize(document)),
    })),
  );
  return async () => {
    await Promise.all(
      snapshots
        .filter((snapshot) => snapshot.documents.length)
        .map((snapshot) =>
          db
            .collection(snapshot.name)
            .insertMany(snapshot.documents.map((document) => BSON.deserialize(document))),
        ),
    );
    return structuredClone(result);
  };
}
