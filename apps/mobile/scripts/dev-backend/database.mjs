import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { webApp, mongoUri, mongoPort, databaseName, marker } from './environment.mjs';

const require = createRequire(resolve(webApp, 'package.json'));
const { MongoClient, ObjectId } = require('mongodb');

export async function withIsolatedDatabase(action, { initialize = false } = {}) {
  const parsed = new URL(mongoUri);
  if (
    parsed.protocol !== 'mongodb:' ||
    parsed.hostname !== '127.0.0.1' ||
    parsed.port !== String(mongoPort) ||
    parsed.pathname !== `/${databaseName}` ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error('Isolated database target invariant failed');
  }
  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const database = client.db(databaseName);
    const ownership = await database.collection('native_verification').findOne({ _id: marker });
    if (!ownership) {
      const existingCollections = await database.listCollections({}, { nameOnly: true }).toArray();
      if (!initialize || existingCollections.length) {
        throw new Error('Refusing unmarked or pre-existing nonempty database');
      }
      await database.collection('native_verification').insertOne({
        _id: marker,
        fictional: true,
        createdAt: new Date(),
      });
    } else if (ownership.fictional !== true) {
      throw new Error('Database ownership marker is not explicitly fictional');
    }
    return await action(database, ObjectId);
  } finally {
    await client.close();
  }
}
