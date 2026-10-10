/** Real authenticated HTTP + read-only persistence oracle, fictional loopback backend only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { groupOwnedCollections } from '../src/lib/group-cleanup';

async function verify() {
  const origin = process.env.MOBILE_VERIFY_URL;
  const uri = process.env.MONGODB_URI;
  assert.ok(origin && uri, 'Specify the owned fictional HTTP origin and database URI.');
  const http = new URL(origin),
    mongo = new URL(uri);
  assert.ok(
    http.protocol === 'http:' && http.hostname === '127.0.0.1',
    'HTTP verification requires loopback.',
  );
  assert.ok(
    mongo.protocol === 'mongodb:' &&
      mongo.hostname === '127.0.0.1' &&
      !mongo.username &&
      !mongo.password &&
      /^\/splitbook_mobile_[a-z0-9_]+$/.test(mongo.pathname),
    'Database verification requires a fictional loopback target.',
  );
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const alex = 'a00000000000000000000001',
    sam = 'a00000000000000000000002';
  const run = randomUUID();
  const owned: ObjectId[] = [];
  const checks: string[] = [];
  const request = (path: string, cookie: string | null = null, method = 'GET', body?: object) =>
    fetch(`${origin}${path}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  async function signIn(personaId: string) {
    const response = await request('/api/auth/demo-persona/sign-in', null, 'POST', { personaId });
    assert.equal(response.status, 200, 'Demo sign-in did not succeed.');
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    assert.ok(cookie.includes('session_token='), 'Demo sign-in did not issue a real session.');
    await response.arrayBuffer();
    return cookie;
  }
  async function group(cookie: string, label: string) {
    const response = await request('/api/groups', cookie, 'POST', {
      name: `Orphan QA ${label} ${run}`,
      category: 'other',
      defaultCurrency: 'INR',
      alternateCurrencies: [],
    });
    assert.equal(response.status, 201);
    const value = await response.json();
    const id = new ObjectId(value.data._id);
    owned.push(id);
    return id;
  }
  const members = (people: string[]) =>
    people.map((user, index) => ({
      user: new ObjectId(user),
      role: index === 0 ? 'admin' : 'member',
      joinedAt: new Date(),
    }));
  const count = async (id: ObjectId) =>
    Promise.all(
      groupOwnedCollections.map((name) => db.collection(name).countDocuments({ group: id })),
    );
  try {
    assert.equal(
      (
        await db
          .collection<{ _id: string; fictional: boolean }>('native_verification')
          .findOne({ _id: 'splitbook-native-ticket-50-fictional-only' })
      )?.fictional,
      true,
      'The backend is not marked fictional.',
    );
    const hello = await db.admin().command({ hello: 1 });
    assert.ok(
      hello.setName || hello.msg === 'isdbgrid',
      'This verifier requires a replica set; transaction coverage must not skip.',
    );
    const alexCookie = await signIn('alex'),
      samCookie = await signIn('sam');
    const originalUsers = await db.collection('users').countDocuments();
    const id = await group(alexCookie, 'cascade');
    const path = `/api/groups/${id}/leave`;
    assert.equal((await request(path, null, 'POST', { deleteIfLastMember: true })).status, 401);
    assert.equal(
      (await request(path, samCookie, 'POST', { deleteIfLastMember: true })).status,
      403,
    );
    for (const body of [undefined, { deleteIfLastMember: false }]) {
      const response = await request(path, alexCookie, 'POST', body);
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, 'GROUP_DELETION_CONFIRMATION_REQUIRED');
    }
    assert.equal((await db.collection('groups').findOne({ _id: id }))?.members.length, 1);
    checks.push(
      'Real sessions: anonymous/outsider refusal and old-client missing/false consent preserve membership',
    );
    // A cancelled confirmation sends no request; all displayed data is unchanged.
    await request(`/api/groups/${id}`, alexCookie);
    assert.equal((await db.collection('groups').findOne({ _id: id }))?.members.length, 1);
    for (const name of groupOwnedCollections)
      await db.collection(name).insertOne({
        group: id,
        isDeleted: true,
        isPaused: true,
        pendingActivity: [{ metadata: { description: 'Fictional unprojected event' } }],
      });
    const archived = await group(alexCookie, 'archived member');
    assert.equal((await request(`/api/groups/${archived}`, alexCookie, 'DELETE')).status, 200);
    const deleted = await request(path, alexCookie, 'POST', { deleteIfLastMember: true });
    assert.equal(deleted.status, 200);
    assert.deepEqual((await deleted.json()).data, {
      message: 'Left group',
      archived: true,
      deleted: true,
      deletionPending: false,
    });
    assert.equal(await db.collection('groups').countDocuments({ _id: id }), 0);
    assert.deepEqual(await count(id), [0, 0, 0, 0, 0]);
    assert.equal(await db.collection('users').countDocuments(), originalUsers);
    assert.equal((await db.collection('groups').findOne({ _id: archived }))?.members.length, 1);
    checks.push(
      'Six-collection cascade includes soft-deleted/pending history; accounts and archived-with-member Group remain',
    );
    const replay = await request(path, alexCookie, 'POST', { deleteIfLastMember: true });
    assert.equal((await replay.json()).data.deleted, true);
    assert.equal(
      (await request(path, samCookie, 'POST', { deleteIfLastMember: true })).status,
      404,
    );
    checks.push('Same-actor completed receipt replay succeeds; unrelated user cannot inspect it');

    const ordinary = await group(alexCookie, 'ordinary and admin');
    await db
      .collection('groups')
      .updateOne({ _id: ordinary }, { $set: { members: members([alex, sam]) } });
    const refused = await request(`/api/groups/${ordinary}/leave`, alexCookie, 'POST', {
      deleteIfLastMember: true,
    });
    assert.equal(refused.status, 409);
    assert.equal((await refused.json()).code, 'LAST_ADMIN');
    const left = await request(`/api/groups/${ordinary}/leave`, samCookie, 'POST');
    assert.equal(left.status, 200);
    assert.equal((await left.json()).data.archived, false);
    assert.equal((await db.collection('groups').findOne({ _id: ordinary }))?.members.length, 1);
    checks.push('Last-admin refusal and ordinary leave retain existing contracts');

    const balance = await group(alexCookie, 'open balance');
    await db
      .collection('groups')
      .updateOne({ _id: balance }, { $set: { members: members([alex, sam]) } });
    const expense = await request(`/api/groups/${balance}/expenses`, alexCookie, 'POST', {
      description: 'Fictional groceries',
      amount: 100,
      currency: 'INR',
      category: 'food',
      date: new Date().toISOString(),
      paidBy: [{ user: alex, amount: 100 }],
      splitBetween: [{ user: alex }, { user: sam }],
      splitMethod: 'equal',
      tag: 'General',
    });
    assert.equal(expense.status, 201);
    const owing = await request(`/api/groups/${balance}/leave`, samCookie, 'POST', {
      deleteIfLastMember: true,
    });
    assert.equal(owing.status, 409);
    assert.equal((await owing.json()).code, 'OPEN_BALANCE');
    assert.equal((await db.collection('groups').findOne({ _id: balance }))?.members.length, 2);
    checks.push('Open financial balance still blocks leave before destructive membership changes');

    const pending = await group(alexCookie, 'bounded recovery');
    await db
      .collection('expenses')
      .insertMany(Array.from({ length: 2_000 }, () => ({ group: pending, isDeleted: true })));
    const historic = new ObjectId();
    owned.push(historic);
    await db.collection('groups').insertOne({
      _id: historic,
      name: `Orphan QA unrequested ${run}`,
      members: [],
      isArchived: true,
    });
    await db.collection('expenses').insertOne({ group: historic, isDeleted: true });
    const first = await request(`/api/groups/${pending}/leave`, alexCookie, 'POST', {
      deleteIfLastMember: true,
    });
    assert.equal(first.status, 200);
    assert.equal((await first.json()).data.deletionPending, true);
    // Never replay leave to advance this job: real authenticated reads schedule after().
    for (let attempt = 0; attempt < 12; attempt++) {
      await (await request('/api/groups', alexCookie)).arrayBuffer();
      await new Promise((resolve) => setTimeout(resolve, 100));
      if ((await db.collection('groupdeletions').findOne({ _id: pending }))?.state === 'complete')
        break;
    }
    assert.equal(
      (await db.collection('groupdeletions').findOne({ _id: pending }))?.state,
      'complete',
    );
    assert.deepEqual(await count(pending), [0, 0, 0, 0, 0]);
    assert.equal(await db.collection('groups').countDocuments({ _id: pending }), 0);
    assert.equal(await db.collection('groups').countDocuments({ _id: historic }), 1);
    assert.equal(await db.collection('expenses').countDocuments({ group: historic }), 1);
    assert.equal((await db.collection('groups').findOne({ _id: archived }))?.members.length, 1);
    checks.push(
      'A durable pending job completes through actual after(response) on authenticated reads; historic empty Groups are never swept',
    );

    const lost = await group(alexCookie, 'lost response');
    await (
      await request(`/api/groups/${lost}/leave`, alexCookie, 'POST', { deleteIfLastMember: true })
    ).arrayBuffer();
    const recovered = await request(`/api/groups/${lost}/leave`, alexCookie, 'POST', {
      deleteIfLastMember: true,
    });
    assert.equal((await recovered.json()).data.deleted, true);
    assert.deepEqual(await count(lost), [0, 0, 0, 0, 0]);
    checks.push(
      'Lost completed HTTP response can be replayed explicitly without a second deletion',
    );
    console.log(`PASS: ${checks.length} authenticated orphan cleanup checks.`);
    for (const check of checks) console.log(`- ${check}`);
  } finally {
    // Raw fixture cleanup is allowed only after the marker check and only this run's ids.
    for (const id of owned) {
      for (const name of [...groupOwnedCollections, 'groups', 'groupdeletions'])
        await db
          .collection(name)
          .deleteMany(name === 'groups' || name === 'groupdeletions' ? { _id: id } : { group: id });
    }
    await client.close();
  }
}
void verify().catch((error: unknown) => {
  console.error(
    error instanceof assert.AssertionError
      ? `FAIL: ${error.message}`
      : 'FAIL: the isolated orphan cleanup verifier could not finish.',
  );
  process.exitCode = 1;
});
