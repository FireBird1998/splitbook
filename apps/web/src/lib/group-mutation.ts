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

function remainingTime(deadline: number) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('Group mutation budget expired');
  return remaining;
}

async function withinDeadline<T>(pending: Promise<T>, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Group mutation budget expired')),
          remainingTime(deadline),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function supportsGroupTransactions(deadline = Date.now() + 2_000): Promise<boolean> {
  await withinDeadline(connectDB(), deadline);
  const db = mongoose.connection.db!;
  let capability = capabilities.get(db);
  if (!capability) {
    capability = db
      .admin()
      .command({ hello: 1 }, { timeoutMS: remainingTime(deadline) })
      .then((hello) => !!hello.setName || hello.msg === 'isdbgrid')
      .catch((error) => {
        capabilities.delete(db);
        throw error;
      });
    capabilities.set(db, capability);
  }
  return withinDeadline(capability, deadline);
}

/** Every Group-owned mutation conflicts with deletion on this shared Mongo document. */
export async function withGroupMutation<T>(
  groupId: string,
  write: (session?: ClientSession) => Promise<T>,
  budget: { deadline?: number } = {},
): Promise<T> {
  const deadline = budget.deadline ?? Date.now() + 2_000;
  await withinDeadline(connectDB(), deadline);
  const active = mutations.getStore();
  if (active) {
    if (active.groupId !== groupId) throw new Error('Cross-Group nested mutation is not supported');
    remainingTime(deadline);
    return write(active.session);
  }
  const db = mongoose.connection.db!;
  if (!(await supportsGroupTransactions(deadline))) {
    // Standalone retains existing ordinary operations. Destructive claims are refused.
    const group = await db
      .collection('groups')
      .findOne(
        { _id: new mongoose.Types.ObjectId(groupId), deletionRequestedAt: null },
        { timeoutMS: remainingTime(deadline) },
      );
    if (!group) throw new Error('FORBIDDEN');
    remainingTime(deadline);
    return write();
  }
  const transactionOptions = {
    ...groupTransactionOptions,
    timeoutMS: remainingTime(deadline),
    maxCommitTimeMS: Math.min(1_000, remainingTime(deadline)),
  };
  return mongoose.connection.transaction(async (session) => {
    const fenced = await db
      .collection('groups')
      .updateOne(
        { _id: new mongoose.Types.ObjectId(groupId), deletionRequestedAt: null },
        { $inc: { mutationSequence: 1 } },
        { session },
      );
    if (!fenced.matchedCount) throw new Error('FORBIDDEN');
    remainingTime(deadline);
    return mutations.run({ groupId, session }, () => write(session));
  }, transactionOptions);
}
