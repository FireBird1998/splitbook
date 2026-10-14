/**
 * The loopback Mongo server the isolated app and these specs share. CI points it at a
 * replica set, because To review saves need transactions; locally it stays 27017.
 * Only a port is accepted, never a caller's URI.
 */
const port = process.env.EXPENSE_ACCESS_MONGO_PORT ?? '27017';
if (!/^\d{2,5}$/.test(port)) throw new Error('EXPENSE_ACCESS_MONGO_PORT must be a port number');

export const expenseAccessMongoUri = (database: string) =>
  `mongodb://127.0.0.1:${port}/${database}?directConnection=true`;
