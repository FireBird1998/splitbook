/** #55: authorized edit/delete reads, revision races, and disk-backed interruption recovery. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createMobileController, type MobileFetch } from '../src/data';
import { parseExpenseRecord } from '../src/data/expense-record';
import { FixtureActor, alexId, samId } from './financial-view-fixtures';
import { localOrigin } from './verification-origin';

async function run() {
  const origin = localOrigin();
  const id = z.string().regex(/^[a-f\d]{24}$/);
  const object = z.object({ data: z.object({ _id: id }) });
  const alex = new FixtureActor(),
    sam = new FixtureActor(),
    priya = new FixtureActor();
  const runId = randomUUID(),
    name = `QA55 ${runId}`;
  let groupId: string | undefined;
  const directory = await mkdtemp(join(tmpdir(), 'splitbook-55-'));
  async function main() {
    await alex.signIn('alex');
    await sam.signIn('sam');
    await priya.signIn('priya');
    const group = object.parse(
      await alex.request(
        '/api/groups',
        'POST',
        {
          name,
          description: `Fictional edit verification ${runId}`,
          category: 'home',
          defaultCurrency: 'INR',
        },
        201,
      ),
    );
    groupId = group.data._id;
    const groupPath = `/api/groups/${groupId}`;
    const invite = z
      .object({ data: z.object({ inviteCode: z.string() }) })
      .parse(await alex.request(`${groupPath}/invite-link`, 'POST', {}, 201));
    await sam.request(`/api/join/${invite.data.inviteCode}`, 'POST', undefined, 201);
    await priya.request(`/api/join/${invite.data.inviteCode}`, 'POST', undefined, 201);
    const tags = z
      .object({ data: z.object({ tags: z.array(z.object({ _id: id, name: z.string() })) }) })
      .parse(await alex.request(groupPath)).data.tags;
    const tagId = tags[0]._id;
    const created = object.parse(
      await alex.request(
        `${groupPath}/expenses`,
        'POST',
        {
          description: 'Initial dinner',
          amount: 10,
          currency: 'INR',
          date: '2026-08-31T23:45:00.000Z',
          category: 'food',
          tagId,
          notes: 'Initial note',
          paidBy: [
            { user: alexId, amount: 6 },
            { user: samId, amount: 4 },
          ],
          splitMethod: 'equal',
          splitBetween: [{ user: alexId }, { user: samId }, { user: 'a00000000000000000000003' }],
        },
        201,
      ),
    );
    const expenseId = created.data._id,
      path = `${groupPath}/expenses/${expenseId}`;
    const read = async () => parseExpenseRecord(await alex.request(path), groupId!, expenseId);
    let cookie: string | null = null,
      account: string | null = null,
      cleanup = false;
    let lose: 'PATCH' | 'DELETE' | null = null,
      offline = false;
    const writes: { method: string; revision: string | null; body: string }[] = [];
    const file = join(directory, 'draft.json');
    const drafts = {
      load: async () => {
        try {
          return JSON.parse(await readFile(file, 'utf8'));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw e;
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
      const mutation = init.method === 'PATCH' || init.method === 'DELETE';
      if (mutation) {
        const persisted = await drafts.load();
        assert.equal(
          persisted.mutation.revision,
          Number(new Headers(init.headers).get('X-Splitbook-Revision')),
        );
        assert.equal(persisted.mutation.body, String(init.body ?? ''));
        writes.push({
          method: init.method!,
          revision: new Headers(init.headers).get('X-Splitbook-Revision'),
          body: String(init.body ?? ''),
        });
      }
      const response = await fetch(url, { ...init, redirect: 'error' });
      if (mutation && lose === init.method) {
        assert.equal(response.status, 200);
        await response.arrayBuffer();
        lose = null;
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
          credentials: {
            load: async () => cookie,
            save: async (v) => {
              cookie = v;
            },
            clear: async () => {
              cookie = null;
            },
          },
          expenseDrafts: drafts,
          newSubmissionKey: randomUUID,
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
            stores: [drafts],
          },
        },
      );
    let controller = create();
    try {
      await controller.signIn('alex');
      await controller.openExpense(groupId, expenseId);
      assert.equal(controller.getSnapshot().expense.status, 'detail');
      const initial = await read();
      assert.deepEqual(
        initial.splitBetween.map((row) => row.amountMinor),
        [334, 333, 333],
      );
      await alex.request(`${groupPath}/tags/${tagId}`, 'PATCH', { isArchived: true });
      await controller.editExpense();
      await controller.updateExpenseDraft({ description: 'Metadata correction' });
      await controller.saveExpense();
      assert.equal(controller.getSnapshot().expense.status, 'saved');
      let current = await read();
      assert.equal(current.description, 'Metadata correction');
      assert.equal(current.date, initial.date);
      assert.deepEqual(
        current.paidBy.map((row) => row.amountMinor),
        [600, 400],
      );
      assert.deepEqual(
        current.splitBetween.map((row) => row.amountMinor),
        [334, 333, 333],
      );
      assert.equal(current.tagId, tagId);
      assert.ok(current.editHistory.length);
      assert.deepEqual(JSON.parse(writes[0].body), { description: 'Metadata correction' });
      console.log(
        'PASS: metadata edit/read-back preserves money, currency, date, archived Tag and history.',
      );
      await controller.openExpense(groupId, expenseId);
      await controller.editExpense();
      await controller.updateExpenseDraft({ notes: 'My stale note' });
      await sam.request(path, 'PATCH', { notes: 'Other editor note' }, 200, current.revision);
      await controller.saveExpense();
      assert.equal(controller.getSnapshot().expense.status, 'conflict');
      assert.equal(controller.getSnapshot().expense.latest?.notes, 'Other editor note');
      let count = writes.length;
      controller = create();
      await controller.restore();
      await controller.openExpense(groupId, expenseId);
      controller.resumeExpenseDraft();
      await controller.refresh();
      assert.equal(writes.length, count);
      await controller.reconcileExpense();
      await controller.saveExpense();
      assert.equal(writes.length, count);
      await controller.reviewLatestExpense();
      await controller.saveExpense();
      assert.equal(controller.getSnapshot().expense.status, 'saved');
      assert.equal((await read()).notes, 'My stale note');
      console.log(
        'PASS: two editors, stale revision, restart, explicit review and retained draft.',
      );
      await controller.openExpense(groupId, expenseId);
      await controller.editExpense();
      await controller.updateExpenseDraft({ notes: 'Committed recovery note' });
      lose = 'PATCH';
      await controller.saveExpense();
      assert.equal(controller.getSnapshot().expense.status, 'uncertain');
      count = writes.length;
      offline = false;
      controller = create();
      await controller.restore();
      await controller.openExpense(groupId, expenseId);
      controller.resumeExpenseDraft();
      await controller.refresh();
      assert.equal(writes.length, count);
      await controller.reconcileExpense();
      assert.equal(controller.getSnapshot().expense.latest?.notes, 'Committed recovery note');
      await controller.acceptCurrentExpense();
      assert.equal(writes.length, count);
      assert.equal(await drafts.load(), null);
      console.log(
        'PASS: committed edit response loss, persistent recovery and read-only acceptance.',
      );
      controller.reviewExpenseDeletion();
      current = await read();
      await sam.request(
        path,
        'PATCH',
        { description: 'Changed before deletion' },
        200,
        current.revision,
      );
      await controller.deleteExpense();
      assert.equal(controller.getSnapshot().expense.status, 'conflict');
      assert.equal((await read()).isDeleted, false);
      count = writes.length;
      await controller.deleteExpense();
      assert.equal(writes.length, count);
      await controller.acceptCurrentExpense();
      controller.reviewExpenseDeletion();
      lose = 'DELETE';
      await controller.deleteExpense();
      assert.equal(controller.getSnapshot().expense.status, 'uncertain');
      offline = false;
      count = writes.length;
      controller = create();
      await controller.restore();
      await controller.openExpense(groupId, expenseId);
      controller.resumeExpenseDraft();
      await controller.reconcileExpense();
      assert.equal(controller.getSnapshot().expense.latest?.isDeleted, true);
      assert.equal(controller.getSnapshot().expense.status, 'blocked');
      await controller.deleteExpense();
      await controller.saveExpense();
      assert.equal(writes.length, count);
      await controller.acceptCurrentExpense();
      assert.equal(await drafts.load(), null);
      const activities = z
        .object({
          data: z.object({
            activities: z.array(
              z.object({ type: z.string(), metadata: z.record(z.string(), z.unknown()) }),
            ),
          }),
        })
        .parse(await alex.request(`${groupPath}/activity`)).data.activities;
      assert.equal(
        activities.filter(
          (row) => row.type === 'expense_deleted' && row.metadata.expenseId === expenseId,
        ).length,
        1,
      );
      console.log(
        'PASS: stale delete refusal; committed deletion loss; authorized deleted read; one deletion Activity, no replay.',
      );
    } finally {
      await controller.signOut();
    }
  }
  try {
    await main();
  } finally {
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
  console.error(error instanceof Error ? error.message : 'Verification failed');
  process.exitCode = 1;
});
