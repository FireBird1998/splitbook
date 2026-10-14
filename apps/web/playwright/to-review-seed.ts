/** Test-only records; no assistant impersonation endpoint or product seed option. */
import { MongoClient, ObjectId } from 'mongodb';
import type { ExpenseDraftValues } from '@splitbook/shared/validators/expense-draft';
import { DEMO_GROUP_ID, DEMO_PERSONA_IDS } from '../src/lib/demo-personas';

export async function seedToReview(count: number) {
  const uri =
    process.env.TO_REVIEW_TEST_MONGODB_URI ??
    process.env.PLAYWRIGHT_DEMO_MONGODB_URI ??
    'mongodb://127.0.0.1:27017/splitbook-demo?directConnection=true';
  const url = new URL(uri);
  if (
    !['/splitbook-demo', '/splitbook_w405', '/splitbook_w407', '/splitbook_w406'].includes(
      url.pathname,
    ) ||
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

/** Full fictional items for #406's web review journeys; only the guarded demo DB is writable. */
export async function seedReviewPage(kinds: Array<'ready' | 'missing-payer' | 'duplicate'>) {
  await seedToReview(0);
  const uri =
    process.env.TO_REVIEW_TEST_MONGODB_URI ??
    process.env.PLAYWRIGHT_DEMO_MONGODB_URI ??
    'mongodb://127.0.0.1:27017/splitbook-demo?directConnection=true';
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db();
    const group = await db.collection('groups').findOne({ _id: new ObjectId(DEMO_GROUP_ID) });
    if (!group) throw new Error('Seeded fictional Group required');
    const tags = group.tags as Array<{ _id: ObjectId; name: string; isArchived?: boolean }>;
    const tag = tags.find((tag) => !tag.isArchived)!;
    const values = (index: number): ExpenseDraftValues => ({
      description: `Review meal ${index + 1}`,
      amount: 12.34,
      currency: 'INR',
      category: 'food',
      date: '2026-10-14',
      tagId: String(tag._id),
      paidBy: [{ user: DEMO_PERSONA_IDS.alex, amount: 12.34 }],
      splitMethod: 'equal',
      splitBetween: [{ user: DEMO_PERSONA_IDS.alex }],
    });
    const records = kinds.map((kind, index) => {
      const v = values(index);
      if (kind === 'missing-payer') delete v.paidBy;
      if (kind === 'duplicate') v.description = 'Review matching meal';
      return {
        group: new ObjectId(DEMO_GROUP_ID),
        owner: new ObjectId(DEMO_PERSONA_IDS.alex),
        requestKey: 'playwright-to-review',
        itemIndex: index,
        requestFingerprint: 'test-only',
        revision: 0,
        state: 'active',
        preparedBy: { kind: 'assistant', name: 'Claude' },
        changedBy: { kind: 'assistant', name: 'Claude' },
        values: v,
        createdAt: new Date(Date.now() + index),
        updatedAt: new Date(),
      };
    });
    if (records.length) await db.collection('expensedrafts').insertMany(records);
    return records;
  } finally {
    await client.close();
  }
}
