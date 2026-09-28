/** #57: authorized Activity journeys using only owned fictional HTTP fixtures. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { createMobileController } from '../src/data';
import { FixtureActor, alexId, samId } from './financial-view-fixtures';
import { localOrigin } from './verification-origin';

const id = z.string().regex(/^[a-f\d]{24}$/);
const record = z.object({ data: z.object({ _id: id, revision: z.number().optional() }) });
const manifest = z.object({
  kind: z.literal('splitbook-57-fictional'),
  origin: z.string(),
  groupId: id,
  expenseId: id,
  name: z.string().startsWith('QA57 '),
});
type Fixture = z.infer<typeof manifest>;
async function seed(alex: FixtureActor, sam: FixtureActor): Promise<Fixture> {
  const name = `QA57 ${randomUUID()}`;
  const groupId = record.parse(
    await alex.request(
      '/api/groups',
      'POST',
      {
        name,
        category: 'home',
        defaultCurrency: 'INR',
        description: 'Owned fictional Activity verification',
      },
      201,
    ),
  ).data._id;
  const path = `/api/groups/${groupId}`;
  try {
    const invite = z
      .object({ data: z.object({ inviteCode: z.string() }) })
      .parse(await alex.request(`${path}/invite-link`, 'POST', {}, 201)).data.inviteCode;
    await sam.request(`/api/join/${invite}`, 'POST', undefined, 201);
    const tagId = z
      .object({ data: z.object({ tags: z.array(z.object({ _id: id })) }) })
      .parse(await alex.request(path)).data.tags[0]._id;
    const expenseId = record.parse(
      await alex.request(
        `${path}/expenses`,
        'POST',
        {
          description: 'Dinner snapshot',
          amount: 30,
          currency: 'INR',
          date: '2026-09-28T12:00:00.000Z',
          category: 'food',
          tagId,
          paidBy: [{ user: alexId, amount: 30 }],
          splitMethod: 'unequal',
          splitBetween: [{ user: samId, amount: 30 }],
        },
        201,
      ),
    ).data._id;
    let revision = 0;
    for (let index = 0; index < 20; index++) {
      const changed = record.parse(
        await alex.request(
          `${path}/expenses/${expenseId}`,
          'PATCH',
          { notes: `Fictional note ${index + 1}` },
          200,
          revision,
        ),
      );
      revision = changed.data.revision!;
    }
    await sam.request(
      `${path}/settlements`,
      'POST',
      { paidBy: samId, paidTo: alexId, amount: 5, currency: 'INR', note: 'Payment already made' },
      201,
    );
    await alex.request(`${path}/expenses/${expenseId}`, 'DELETE', undefined, 200, revision);
    return { kind: 'splitbook-57-fictional', origin: localOrigin(), groupId, expenseId, name };
  } catch (error) {
    await alex.request(path, 'PATCH', { isArchived: true });
    throw error;
  }
}
async function cleanup(alex: FixtureActor, fixture: Fixture) {
  assert.equal(fixture.origin, localOrigin());
  const path = `/api/groups/${fixture.groupId}`;
  const group = z
    .object({ data: z.object({ name: z.string(), createdBy: id }) })
    .parse(await alex.request(path)).data;
  assert.equal(group.name, fixture.name);
  assert.equal(group.createdBy, alexId);
  await alex.request(path, 'PATCH', { isArchived: true });
}
async function run() {
  const origin = localOrigin(),
    alex = new FixtureActor(),
    sam = new FixtureActor();
  let fixture: Fixture | undefined,
    keep = false;
  let controller: ReturnType<typeof createMobileController> | undefined;
  try {
    await alex.signIn('alex');
    await sam.signIn('sam');
    if (process.argv[2] === '--cleanup-fixtures') {
      await cleanup(alex, manifest.parse(JSON.parse(await readFile(process.argv[3], 'utf8'))));
      return;
    }
    fixture = await seed(alex, sam);
    if (process.argv[2] === '--seed-fixtures') {
      await writeFile(process.argv[3], JSON.stringify(fixture));
      keep = true;
      console.log(`Created fictional native Group: ${fixture.name}`);
      return;
    }
    let cookie: string | null = null,
      offline = false;
    controller = createMobileController(
      { apiBaseUrl: origin, authOrigin: origin, developmentPersonaEnabled: true },
      {
        credentials: {
          load: async () => cookie,
          save: async (value) => {
            cookie = value;
          },
          clear: async () => {
            cookie = null;
          },
        },
        fetch: async (url, init) => {
          assert.equal(new URL(url).origin, origin);
          if (offline && url.includes('/activity')) throw new Error('Controlled offline');
          return fetch(url, init);
        },
      },
    );
    await controller.signIn('sam');
    await controller.openActivity(fixture.groupId);
    assert.equal(controller.getSnapshot().activity.status, 'ready');
    assert.equal(controller.getSnapshot().activity.events.length, 20);
    await controller.loadMoreActivity();
    const events = controller.getSnapshot().activity.events;
    assert.equal(new Set(events.map((event) => event._id)).size, events.length);
    for (const type of [
      'group_created',
      'member_joined',
      'expense_added',
      'expense_updated',
      'expense_deleted',
      'settlement_recorded',
    ])
      assert.ok(
        events.some((event) => event.type === type),
        `Missing ${type}`,
      );
    const added = events.find((event) => event.type === 'expense_added')!;
    assert.equal(added.metadata.amount, 30);
    assert.equal(added.metadata.currency, 'INR');
    await controller.selectActivity(added._id);
    assert.equal(controller.getSnapshot().activity.target.status, 'deleted');
    assert.equal(
      controller.getSnapshot().activity.selected?.metadata.description,
      'Dinner snapshot',
    );
    assert.equal(controller.getSnapshot().expense.draft, null);
    console.log(
      'PASS: mixed paginated Activity, original snapshot money, and current deleted-target detail without an editor.',
    );
    offline = true;
    await controller.refreshActivity();
    assert.equal(controller.getSnapshot().activity.status, 'error');
    assert.ok(controller.getSnapshot().activity.message?.includes('stale'));
    offline = false;
    await controller.refreshActivity();
    assert.equal(controller.getSnapshot().activity.status, 'ready');
    assert.equal(
      controller
        .getSnapshot()
        .activity.events.filter((event) => event.type === 'settlement_recorded').length,
      1,
    );
    await alex.request(`/api/groups/${fixture.groupId}/members/${samId}`, 'DELETE');
    await controller.refresh();
    assert.equal(controller.getSnapshot().activity.status, 'denied');
    assert.deepEqual(controller.getSnapshot().activity.events, []);
    console.log(
      'PASS: explicit stale/error recovery, single payment event, and foreground membership revocation.',
    );
  } finally {
    if (controller) await controller.signOut();
    if (fixture && !keep) await cleanup(alex, fixture);
    await Promise.all([alex.close(), sam.close()]);
  }
}
void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Activity verification failed');
  process.exitCode = 1;
});
