// This file provides a MongoClient promise for Auth.js MongoDB adapter.
// It's separate from Mongoose connection to avoid conflicts.
// Uses lazy initialization to avoid build-time errors.

import { MongoClient, MongoClientOptions } from 'mongodb';

const globalWithMongo = global as typeof globalThis & {
  _mongoClientPromise?: Promise<MongoClient>;
};

let clientPromise: Promise<MongoClient>;

if (typeof process.env.MONGODB_URI === 'string' && process.env.MONGODB_URI) {
  const uri = process.env.MONGODB_URI;
  // directConnection is needed for the local Docker Mongo but is rejected by mongodb+srv:// (Atlas)
  const options: MongoClientOptions = uri.startsWith('mongodb+srv://')
    ? {}
    : { directConnection: true };

  if (process.env.NODE_ENV === 'development') {
    if (!globalWithMongo._mongoClientPromise) {
      const client = new MongoClient(uri, options);
      globalWithMongo._mongoClientPromise = client.connect();
    }
    clientPromise = globalWithMongo._mongoClientPromise;
  } else {
    const client = new MongoClient(uri, options);
    clientPromise = client.connect();
  }
} else {
  // During build time, provide a dummy promise that will never resolve
  // This file is only actually used at runtime when MONGODB_URI is available
  clientPromise = new Promise(() => {});
}

export default clientPromise;
