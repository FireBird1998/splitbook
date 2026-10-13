/** Test-only records; no assistant impersonation endpoint or product seed option. */
import { MongoClient, ObjectId } from 'mongodb';
import { DEMO_GROUP_ID, DEMO_PERSONA_IDS } from '../src/lib/demo-personas';

export async function seedToReview(count: number) {
  const uri =
    process.env.TO_REVIEW_TEST_MONGODB_URI ??
    'mongodb://127.0.0.1:27017/splitbook-demo?directConnection=true';
  const url = new URL(uri);
  if (
    !['/splitbook-demo', '/splitbook_w405'].includes(url.pathname) ||
    !['localhost', '127.0.0.1', 'host.docker.internal'].includes(url.hostname)
  )
    throw new Error('To review fixtures require an isolated demo database.');
  const client = await MongoClient.connect(uri);
  try {
    const collection = client.db().collection('expensedrafts');
    const scope = {
      group: new ObjectId(DEMO_GROUP_ID),
      owner: new ObjectId(DEMO_PERSONA_IDS.alex),
      requestKey: 'playwright-to-review',
    };
    await collection.deleteMany(scope);
    if (count)
      await collection.insertMany(
        Array.from({ length: count }, (_, index) => ({
          ...scope,
          itemIndex: index,
          requestFingerprint: 'test-only',
          revision: 0,
          state: 'active',
          preparedBy: { kind: 'assistant', name: 'Claude' },
          changedBy: { kind: 'assistant', name: 'Claude' },
          values: { description: `Review taxi ${index + 1}`, amount: 12.34 },
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      );
  } finally {
    await client.close();
  }
}
