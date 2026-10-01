/** #56 real HTTP verification; owns only uniquely named fictional Groups and sessions. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { createMobileController, type MobileFetch } from '../src/data';
import { parseGroupBalances } from '../src/data/financial-dto';
import { parseSettlementHistory } from '../src/data/settlement';
import { FixtureActor, alexId, samId } from './financial-view-fixtures';
import { localOrigin } from './verification-origin';

async function run() {
  const origin = localOrigin(),
    name = `QA56 ${randomUUID()}`;
  const alex = new FixtureActor(),
    sam = new FixtureActor(),
    priya = new FixtureActor();
  const directory = await mkdtemp(join(tmpdir(), 'splitbook-56-')),
    file = join(directory, 'attempt.json');
  let groupId: string | undefined,
    controller: ReturnType<typeof createMobileController> | undefined;
  const id = z.string().regex(/^[a-f\d]{24}$/),
    object = z.object({ data: z.object({ _id: id }) });
  try {
    await alex.signIn('alex');
    await sam.signIn('sam');
    await priya.signIn('priya');
    groupId = object.parse(
      await alex.request(
        '/api/groups',
        'POST',
        {
          name,
          description: 'Owned fictional payment verification',
          category: 'home',
          defaultCurrency: 'INR',
        },
        201,
      ),
    ).data._id;
    const path = `/api/groups/${groupId}`,
      settlements = `${path}/settlements`;
    const invite = z
      .object({ data: z.object({ inviteCode: z.string() }) })
      .parse(await alex.request(`${path}/invite-link`, 'POST', {}, 201)).data.inviteCode;
    await sam.request(`/api/join/${invite}`, 'POST', undefined, 201);
    await priya.request(`/api/join/${invite}`, 'POST', undefined, 201);
    const tagId = z
      .object({ data: z.object({ tags: z.array(z.object({ _id: id })) }) })
      .parse(await alex.request(path)).data.tags[0]._id;
    async function expense(amount: number) {
      await alex.request(
        `${path}/expenses`,
        'POST',
        {
          description: 'QA56 shared cost',
          amount,
          currency: 'INR',
          date: '2026-09-28T12:00:00.000Z',
          category: 'other',
          tagId,
          paidBy: [{ user: alexId, amount }],
          splitMethod: 'unequal',
          splitBetween: [{ user: samId, amount }],
        },
        201,
      );
    }
    await expense(12.34);
    const denied = z
      .object({ code: z.literal('FORBIDDEN_SETTLEMENT') })
      .parse(
        await priya.request(
          settlements,
          'POST',
          { paidBy: samId, paidTo: alexId, amount: 1, currency: 'INR' },
          422,
        ),
      );
    assert.equal(denied.code, 'FORBIDDEN_SETTLEMENT');
    let cookie: string | null = null,
      account: string | null = null,
      cleanup = false,
      lose = false,
      offline = false;
    const writes: { body: string; key: string | null }[] = [];
    const store = {
      load: async () => {
        try {
          return JSON.parse(await readFile(file, 'utf8'));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw error;
        }
      },
      save: async (_account: string, _group: string, value: unknown) => {
        await writeFile(`${file}.tmp`, JSON.stringify(value));
        await rename(`${file}.tmp`, file);
      },
      remove: async () => {
        await rm(file, { force: true });
      },
      clear: async () => {
        await rm(file, { force: true });
      },
    };
    const fetcher: MobileFetch = async (url, init) => {
      assert.equal(new URL(url).origin, origin);
      if (offline && !url.includes('/api/auth/')) throw new Error('Controlled offline');
      const recording = url.endsWith('/settlements') && init.method === 'POST';
      if (recording) {
        const pending = await store.load();
        assert.equal(pending.body, String(init.body));
        assert.equal(pending.key, new Headers(init.headers).get('Idempotency-Key'));
        writes.push({
          body: String(init.body),
          key: new Headers(init.headers).get('Idempotency-Key'),
        });
      }
      const response = await fetch(url, { ...init, redirect: 'error' });
      if (recording && lose) {
        assert.equal(response.status, 201);
        await response.arrayBuffer();
        lose = false;
        offline = true;
        throw new Error('Controlled loss after commit');
      }
      return response;
    };
    const create = () =>
      createMobileController(
        { apiBaseUrl: origin, authOrigin: origin, developmentPersonaEnabled: true },
        {
          fetch: fetcher,
          newSubmissionKey: randomUUID,
          settlementAttempts: store,
          credentials: {
            load: async () => cookie,
            save: async (v) => {
              cookie = v;
            },
            clear: async () => {
              cookie = null;
            },
          },
          accountLocal: {
            owner: {
              load: async () => account,
              save: async (v) => {
                account = v;
              },
              clear: async () => {
                account = null;
              },
            },
            cleanupMarker: {
              load: async () => cleanup,
              mark: async () => {
                cleanup = true;
              },
              clear: async () => {
                cleanup = false;
              },
            },
            stores: [store],
          },
        },
      );
    controller = create();
    await controller.signIn('sam');
    const debt = async (from: string, to: string) =>
      parseGroupBalances(await alex.request(`${path}/balances`))
        .find((b) => b.currency === 'INR')
        ?.debts.find((d) => d.from.id === from && d.to.id === to)?.amount ?? 0;
    const start = async (amount: string, note: string) => {
      await controller!.openSettlements(groupId!);
      controller!.selectSettlement(samId, alexId, 'INR');
      controller!.updateSettlement({ amount, note });
      assert.equal(controller!.getSnapshot().settlement.status, 'editing');
    };
    await start('2.34', 'Partial payment already made');
    await controller.recordSettlement();
    // The sheet closes onto Balances with its confirmation.
    assert.equal(controller.getSnapshot().screen, 'group');
    assert.equal(controller.getSnapshot().snackbar?.message, 'Payment recorded');
    assert.equal(await debt(samId, alexId), 10);
    await start('10', 'Full remaining payment');
    await controller.recordSettlement();
    assert.equal(await debt(samId, alexId), 0);
    let history = parseSettlementHistory(await alex.request(settlements), groupId);
    assert.deepEqual(
      history.map((r) => r.amountMinor).sort((a, b) => a! - b!),
      [234, 1000],
    );
    console.log(
      'PASS: partial/full payments, currency precision, history, exact remaining balances and unauthorized-party rejection.',
    );
    await expense(5.12);
    await start('6.12', 'Actual payment exceeded suggestion');
    let count: number = writes.length;
    await controller.recordSettlement();
    assert.equal(writes.length, count);
    controller.acknowledgeSettlement();
    await controller.recordSettlement();
    assert.equal(await debt(alexId, samId), 1);
    console.log(
      'PASS: over-suggestion acknowledgment records the reviewed actual amount; resulting reverse debt is read from the server.',
    );
    await expense(11);
    await start('3.12', 'Lost response payment');
    lose = true;
    await controller.recordSettlement();
    assert.equal(controller.getSnapshot().settlement.status, 'uncertain');
    const original = JSON.parse(await readFile(file, 'utf8'));
    count = writes.length;
    await controller.recordSettlement();
    assert.equal(writes.length, count);
    offline = false;
    controller = create();
    await controller.restore();
    await controller.openSettlements(groupId);
    await controller.refresh();
    assert.equal(writes.length, count);
    assert.equal(controller.getSnapshot().settlement.attempt?.body, original.body);
    controller.updateSettlement({ amount: '999' });
    assert.equal(controller.getSnapshot().settlement.draft?.amount, '3.12');
    await controller.recordSettlement();
    assert.equal(writes.length, count + 1);
    assert.deepEqual(writes.at(-1), writes.at(-2));
    assert.equal(await store.load(), null);
    assert.equal(await debt(samId, alexId), 6.88);
    history = parseSettlementHistory(await alex.request(settlements), groupId);
    assert.equal(history.length, 4);
    const recovered = history.find((r) => r.note === 'Lost response payment');
    assert.ok(recovered);
    const activities = z
      .object({
        data: z.object({
          activities: z.array(
            z.object({ type: z.string(), metadata: z.record(z.string(), z.unknown()) }),
          ),
        }),
      })
      .parse(await alex.request(`${path}/activity`)).data.activities;
    assert.equal(
      activities.filter(
        (a) => a.type === 'settlement_recorded' && a.metadata.settlementId === recovered._id,
      ).length,
      1,
    );
    console.log(
      'PASS: committed response loss, offline retry refusal, persistent restart, immutable explicit retry, one Settlement/Activity and exact balance.',
    );
    await controller.openActivity(groupId);
    assert.equal(controller.getSnapshot().activity.status, 'ready');
    await controller.refreshActivity();
    assert.equal(
      controller
        .getSnapshot()
        .activity.events.filter((event) => event.metadata.settlementId === recovered._id).length,
      1,
    );
    console.log(
      'PASS: recovered payment appears once in the native Activity controller after authoritative refresh.',
    );
    await start('1', 'Revoked member payment');
    await alex.request(`${path}/members/${samId}`, 'DELETE');
    count = writes.length;
    await controller.recordSettlement();
    assert.equal(controller.getSnapshot().settlement.status, 'blocked');
    assert.equal(writes.length, count);
    await controller.signOut();
    assert.equal(await store.load(), null);
    console.log(
      'PASS: current membership denial blocks a new record; sign-out purges account-local recovery.',
    );
  } finally {
    if (controller) await controller.signOut();
    if (groupId) {
      const owned = z
        .object({ data: z.object({ name: z.string(), createdBy: id }) })
        .parse(await alex.request(`/api/groups/${groupId}`)).data;
      assert.equal(owned.name, name);
      assert.equal(owned.createdBy, alexId);
      await alex.request(`/api/groups/${groupId}`, 'DELETE');
    }
    await Promise.all([alex.close(), sam.close(), priya.close()]);
    await rm(directory, { recursive: true, force: true });
  }
}
void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Settlement verification failed');
  process.exitCode = 1;
});
