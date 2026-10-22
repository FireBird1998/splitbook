import 'server-only';
import mongoose from 'mongoose';
import { connectMongo, MONGO_CONNECTION_OPTIONS } from '@/lib/mongodb-client';

// A model's call made while no connection is open waits for one at most as long as connecting
// does, then throws. Mongoose's buffering stays on: a model compiled with no connection open
// waits for one to run its autoCreate and autoIndex. With buffering off its first init() fails,
// Mongoose keeps that failure, and the model's indexes are never built (#856).
mongoose.set('bufferTimeoutMS', MONGO_CONNECTION_OPTIONS.serverSelectionTimeoutMS);

/**
 * Mongoose on the app's one MongoDB client (#826). A connection that fails rejects to the caller,
 * and the next call tries again.
 */
export async function connectDB(): Promise<typeof mongoose> {
  await connectMongo();
  return mongoose;
}

export default connectDB;
