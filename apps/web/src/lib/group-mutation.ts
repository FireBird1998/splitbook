import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import mongoose, { type ClientSession } from 'mongoose';
import connectDB from './db';

// Mongoose propagates the transaction session through its own AsyncLocalStorage.
// Raw collection writes must explicitly use the session handed to the callback.
mongoose.set('transactionAsyncLocalStorage', true);
const mutations = new AsyncLocalStorage<{ groupId: string; session: ClientSession }>();
export const groupTransactionOptions: mongoose.mongo.TransactionOptions & { timeoutMS: number } = {
  timeoutMS: 2_000,
  maxCommitTimeMS: 1_000,
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
};
const capabilities = new WeakMap<object, Promise<boolean>>();

export async function supportsGroupTransactions(): Promise<boolean> {
  await connectDB();
  const db = mongoose.connection.db!;
  let capability = capabilities.get(db);
  if (!capability) {
    capability = db
      .admin()
      .command({ hello: 1 })
      .then((hello) => !!hello.setName || hello.msg === 'isdbgrid')
      .catch((error) => {
        capabilities.delete(db);
        throw error;
      });
    capabilities.set(db, capability);
  }
  return capability;
}

/** Every Group-owned mutation conflicts with deletion on this shared Mongo document. */
export async function withGroupMutation<T>(
  groupId: string,
  write: (session?: ClientSession) => Promise<T>,
): Promise<T> {
  await connectDB();
  const active = mutations.getStore();
  if (active) {
    if (active.groupId !== groupId) throw new Error('Cross-Group nested mutation is not supported');
    return write(active.session);
  }
  const db = mongoose.connection.db!;
  if (!(await supportsGroupTransactions())) {
    // Standalone retains existing ordinary operations. Destructive claims are refused.
    const group = await db
      .collection('groups')
      .findOne({ _id: new mongoose.Types.ObjectId(groupId), deletionRequestedAt: null });
    if (!group) throw new Error('FORBIDDEN');
    return write();
  }
  return mongoose.connection.transaction(async (session) => {
    const fenced = await db
      .collection('groups')
      .updateOne(
        { _id: new mongoose.Types.ObjectId(groupId), deletionRequestedAt: null },
        { $inc: { mutationSequence: 1 } },
        { session },
      );
    if (!fenced.matchedCount) throw new Error('FORBIDDEN');
    return mutations.run({ groupId, session }, () => write(session));
  }, groupTransactionOptions);
}
