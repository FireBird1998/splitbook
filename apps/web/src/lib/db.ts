import 'server-only';
import mongoose from 'mongoose';
import { connectMongo } from '@/lib/mongodb-client';

// Models throw rather than wait when no connection is open.
mongoose.set('bufferCommands', false);

/**
 * Mongoose on the app's one MongoDB client (#826). A connection that fails rejects to the caller,
 * and the next call tries again.
 */
export async function connectDB(): Promise<typeof mongoose> {
  await connectMongo();
  return mongoose;
}

export default connectDB;
