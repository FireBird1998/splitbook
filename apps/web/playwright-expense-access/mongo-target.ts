/**
 * The loopback Mongo server the isolated app and these specs share. CI points it at a
 * replica set, because To review saves and Tag actions need transactions; locally it
 * stays 27017. Only a port is accepted, never a caller's URI, and only this suite's
 * minted splitbook-test-access-<uuid> database may be opened.
 */
const port = process.env.EXPENSE_ACCESS_MONGO_PORT ?? '27017';
if (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535)
  throw new Error('EXPENSE_ACCESS_MONGO_PORT must be a TCP port on loopback.');

export function expenseAccessMongoUri(database: string) {
  if (!/^splitbook-test-access-[0-9a-f-]{36}$/.test(database))
    throw new Error('An isolated expense-access database is required.');
  return `mongodb://127.0.0.1:${port}/${database}?directConnection=true`;
}
