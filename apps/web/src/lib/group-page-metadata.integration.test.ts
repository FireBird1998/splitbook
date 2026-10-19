import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import {
  connectSignedIn,
  disconnectSignedIn,
  insertDemoPersonas,
  nextHeaders,
  signIn,
} from '@/lib/test-utils/signed-in-route';
import { DEMO_PERSONA_IDS } from '@/lib/demo-personas';
import { groupService } from '@/lib/services/group.service';

vi.mock('next/headers', async () => (await import('@/lib/test-utils/signed-in-route')).nextHeaders);

const db = integrationTestDb('page-metadata');
let groupPageMetadata: typeof import('./group-page-metadata').groupPageMetadata;
let joinMetadata: typeof import('@/app/join/[code]/page').generateMetadata;

beforeAll(async () => {
  await connectSignedIn(db);
  ({ groupPageMetadata } = await import('./group-page-metadata'));
  ({ generateMetadata: joinMetadata } = await import('@/app/join/[code]/page'));
});
beforeEach(async () => {
  await db.reset();
  await insertDemoPersonas();
  (await nextHeaders.headers()).set('cookie', await signIn('alex'));
});
afterAll(() => disconnectSignedIn(db));

it('Group and Join metadata fall back to generic titles when Mongo reads fail', async () => {
  const group = await groupService.create(
    { name: 'Private trip', category: 'trip', defaultCurrency: 'INR', alternateCurrencies: [] },
    DEMO_PERSONA_IDS.alex,
  );
  // Only this file's Mongoose connection goes offline; auth keeps its own client.
  await mongoose.disconnect();
  try {
    await expect(
      groupPageMetadata(Promise.resolve({ id: String(group._id) }), 'Balances'),
    ).resolves.toEqual({ title: 'Group · Balances' });
    await expect(
      joinMetadata({ params: Promise.resolve({ code: 'unavailable' }) }),
    ).resolves.toEqual({ title: 'Join a Group' });
  } finally {
    await mongoose.connect(db.uri);
  }
});
