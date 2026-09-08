// Native MongoDB driver handle for Better Auth's adapter. Separate from the
// Mongoose connection so the two never share state. The driver connects
// lazily on first use, so building the handle is synchronous and safe at
// import time (including `next build`, where MONGODB_URI may be absent).

import 'server-only';
import { MongoClient, type Db, type MongoClientOptions } from 'mongodb';

const globalWithMongo = global as typeof globalThis & {
  _authMongoClient?: MongoClient;
};

// A syntactically valid placeholder so an unconfigured build still constructs
// the auth instance; any database call would fail loudly at request time.
const UNCONFIGURED_URI = 'mongodb://127.0.0.1:27017/splitbook-unconfigured';

function createClient(): MongoClient {
  const uri = process.env.MONGODB_URI || UNCONFIGURED_URI;
  // directConnection is needed for the local Docker Mongo but is rejected by mongodb+srv:// (Atlas)
  const options: MongoClientOptions = uri.startsWith('mongodb+srv://')
    ? {}
    : { directConnection: true };
  return new MongoClient(uri, options);
}

function getClient(): MongoClient {
  if (process.env.NODE_ENV === 'development') {
    // Reuse across HMR reloads so dev does not leak connections.
    globalWithMongo._authMongoClient ??= createClient();
    return globalWithMongo._authMongoClient;
  }
  return createClient();
}

/** The database named in MONGODB_URI, for Better Auth's MongoDB adapter. */
export function getAuthDb(): Db {
  return getClient().db();
}
