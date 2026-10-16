import 'server-only';
import mongoose from 'mongoose';
import connectDB from '@/lib/db';
import { supportsGroupTransactions } from '@/lib/group-mutation';

/** Called before account deletion. The user fence rejects concurrent or later Draft writes. */
export async function removeAccountDrafts(userId: string) {
  await connectDB();
  if (!(await supportsGroupTransactions())) throw new Error('DRAFT_TRANSACTIONS_REQUIRED');
  const db = mongoose.connection.db!;
  const owner = new mongoose.Types.ObjectId(userId);
  await mongoose.connection.transaction(async (session) => {
    await db
      .collection('users')
      .updateOne({ _id: owner }, { $set: { draftDeletionPending: true } }, { session });
    await db.collection('expensedrafts').deleteMany({ owner }, { session });
    await db.collection('tagactions').deleteMany({ actor: owner }, { session });
  });
}
