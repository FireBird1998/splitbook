import mongoose from 'mongoose';
import connectDB from '@/lib/db';
const ready = new WeakMap<object, Promise<unknown>>();
/** Shared across instances; no tokens, prompts, names or expense content are stored. */
export async function allowMcpRequest(subject: string) {
  await connectDB();
  const db = mongoose.connection.db!;
  const limits = db.collection<{ _id: string; count: number; expiresAt: Date }>('mcprequestlimits');
  if (!ready.has(db))
    ready.set(
      db,
      limits.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch((error) => {
        ready.delete(db);
        throw error;
      }),
    );
  await ready.get(db);
  const minute = Math.floor(Date.now() / 60000);
  const result = await limits.findOneAndUpdate(
    { _id: `${subject}:${minute}` },
    {
      $inc: { count: 1 },
      $setOnInsert: { expiresAt: new Date((minute + 2) * 60000) },
    },
    { upsert: true, returnDocument: 'after' },
  );
  return (result?.count ?? 121) <= 120;
}
