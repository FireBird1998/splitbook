/** Tickets #53–54: real HTTP ledger verification with controlled loss of a committed response. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { z } from 'zod';
import { createMobileController, type MobileFetch } from '../src/data';
import { FixtureActor, alexId } from './financial-view-fixtures';
import { localOrigin } from './verification-origin';

const origin = localOrigin();
const id = z.string().regex(/^[a-f\d]{24}$/);
const groupSchema = z.object({
  data: z.object({
    _id: id,
    name: z.string(),
    description: z.string(),
    createdBy: id,
    tags: z.array(z.object({ _id: id, name: z.string() })),
    members: z.array(z.object({ user: z.object({ _id: id }), role: z.string() })),
  }),
});
const manifestSchema = z.object({
  kind: z.literal('splitbook-native-53-fictional-v1'),
  origin: z.literal(origin),
  runId: z.uuid(),
  groupId: id,
  tagId: id,
});
type Manifest = z.infer<typeof manifestSchema>;
const groupName = (runId: string) => `QA53 ${runId}`;
const description = (runId: string) => `Fictional expense recovery verification ${runId}.`;
const alex = new FixtureActor();
const sam = new FixtureActor();
const priya = new FixtureActor();

async function archive(manifest: Manifest) {
  const group = groupSchema.parse(await alex.request(`/api/groups/${manifest.groupId}`)).data;
  assert.ok(
    group._id === manifest.groupId &&
      group.name === groupName(manifest.runId) &&
      group.description === description(manifest.runId) &&
      group.createdBy === alexId &&
      group.members.some((member) => member.user._id === alexId && member.role === 'admin'),
    'Refusing cleanup of a Group outside this fictional run.',
  );
  await alex.request(`/api/groups/${manifest.groupId}`, 'DELETE');
}

async function seed(): Promise<Manifest> {
  const runId = randomUUID();
  const group = groupSchema.parse(
    await alex.request(
      '/api/groups',
      'POST',
      {
        name: groupName(runId),
        description: description(runId),
        category: 'home',
        defaultCurrency: 'INR',
        alternateCurrencies: [],
      },
      201,
    ),
  ).data;
  const provisional = {
    kind: 'splitbook-native-53-fictional-v1' as const,
    origin,
    runId,
    groupId: group._id,
    tagId: group._id,
  };
  try {
    const invite = z
      .object({ data: z.object({ inviteCode: z.string() }) })
      .parse(await alex.request(`/api/groups/${group._id}/invite-link`, 'POST', {}, 201));
    await sam.request(`/api/join/${invite.data.inviteCode}`, 'POST', undefined, 201);
    await priya.request(`/api/join/${invite.data.inviteCode}`, 'POST', undefined, 201);
    const tagged = groupSchema.parse(
      await alex.request(`/api/groups/${group._id}/tags`, 'POST', { name: 'Shared meal' }),
    ).data;
    const tag = tagged.tags.find((item) => item.name === 'Shared meal');
    assert.ok(tag);
    return manifestSchema.parse({ ...provisional, tagId: tag._id });
  } catch (error) {
    await archive(provisional);
    throw error;
  }
}

async function verify(manifest: Manifest) {
  const directory = await mkdtemp(join(tmpdir(), 'splitbook-53-'));
  const path = join(directory, 'draft.json');
  let cookie: string | null = null;
  let account: string | null = null;
  let cleanup = false;
  let loseResponse = true;
  let offline = false;
  const submissions: { key: string | null; body: string }[] = [];
  const drafts = {
    load: async () => {
      try {
        return JSON.parse(await readFile(path, 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    save: async (_account: string, _group: string, value: unknown) => {
      await writeFile(`${path}.tmp`, JSON.stringify(value));
      await rename(`${path}.tmp`, path);
    },
    remove: async () => {
      await rm(path, { force: true });
    },
    clear: async () => {
      await rm(path, { force: true });
    },
  };
  const fetcher: MobileFetch = async (url, init) => {
    assert.equal(new URL(url).origin, origin);
    if (offline && !url.includes('/api/auth/')) throw new Error('Controlled offline transport');
    const isExpense =
      init.method === 'POST' &&
      new URL(url).pathname === `/api/groups/${manifest.groupId}/expenses`;
    if (isExpense) {
      const persisted = z
        .object({ attempt: z.object({ key: z.string(), body: z.string() }) })
        .parse(await drafts.load());
      const sent = {
        key: new Headers(init.headers).get('Idempotency-Key'),
        body: String(init.body),
      };
      assert.deepEqual(
        sent,
        persisted.attempt,
        'The exact request was not on disk before submission.',
      );
      submissions.push(sent);
    }
    const response = await fetch(url, { ...init, redirect: 'error' });
    if (isExpense && loseResponse) {
      assert.equal(response.status, 201, 'The interrupted real write was not committed.');
      await response.arrayBuffer();
      loseResponse = false;
      throw new Error('Controlled loss after server committed');
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
          save: async (value) => {
            cookie = value;
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
            save: async (value) => {
              account = value;
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
    await controller.openExpense(manifest.groupId);
    assert.equal(controller.getSnapshot().expense.status, 'editing');
    await controller.updateExpenseDraft({
      amount: '10.001',
      description: 'QA53 exactly once dinner',
      tagId: manifest.tagId,
    });
    await controller.saveExpense();
    assert.equal(submissions.length, 0, 'Invalid currency precision reached the server.');
    const invalidBody = {
      description: 'Rejected',
      amount: 10,
      currency: 'INR',
      category: 'other',
      date: new Date().toISOString(),
      paidBy: [{ user: alexId, amount: 10 }],
      splitMethod: 'equal',
      splitBetween: [{ user: alexId, amount: 10 }],
      tagId: 'a00000000000000000000099',
    };
    for (const [patch, code] of [
      [{}, 'INVALID_TAG'],
      [{ tagId: manifest.tagId, currency: 'USD' }, 'CURRENCY_MISMATCH'],
      [
        { tagId: manifest.tagId, paidBy: [{ user: 'a00000000000000000000099', amount: 10 }] },
        'INVALID_MEMBERS',
      ],
      [{ tagId: manifest.tagId, description: '' }, 'VALIDATION_ERROR'],
    ] as const) {
      const rejected = z
        .object({ code: z.string() })
        .parse(
          await alex.request(
            `/api/groups/${manifest.groupId}/expenses`,
            'POST',
            { ...invalidBody, ...patch },
            422,
          ),
        );
      assert.equal(rejected.code, code);
    }
    await alex.request(`/api/groups/${manifest.groupId}/tags/${manifest.tagId}`, 'PATCH', {
      name: 'Renamed meal',
    });
    await controller.updateExpenseDraft({ amount: '10.00' });
    assert.deepEqual(
      controller.getSnapshot().expense.preview?.map((share) => share.amountMinor),
      [334, 333, 333],
    );
    offline = true;
    await controller.saveExpense();
    assert.equal(submissions.length, 0, 'Offline Save queued a write.');
    offline = false;
    await controller.refresh();
    assert.equal(submissions.length, 0, 'Foreground refresh submitted automatically.');
    await controller.saveExpense();
    assert.equal(controller.getSnapshot().expense.status, 'uncertain');
    await alex.request(`/api/groups/${manifest.groupId}/tags/${manifest.tagId}`, 'PATCH', {
      isArchived: true,
    });
    controller = create();
    await controller.restore();
    await controller.openExpense(manifest.groupId);
    assert.equal(
      controller.getSnapshot().expense.context?.tags.find((tag) => tag.id === manifest.tagId)?.name,
      'Renamed meal',
    );
    controller.resumeExpenseDraft();
    assert.equal(controller.getSnapshot().expense.status, 'uncertain');
    await controller.saveExpense();
    assert.equal(controller.getSnapshot().expense.status, 'saved');
    assert.equal(submissions.length, 2);
    assert.deepEqual(submissions[1], submissions[0]);
    assert.equal(await drafts.load(), null);
    assert.equal(controller.getSnapshot().financial.expenses.status, 'ready');
    assert.equal(controller.getSnapshot().financial.balances.status, 'ready');
    assert.equal(controller.getSnapshot().home.status, 'ready');
    const expenses = z
      .object({
        data: z.object({
          expenses: z.array(
            z.object({
              _id: id,
              amountMinor: z.number(),
              splitBetween: z.array(z.object({ amountMinor: z.number() })),
            }),
          ),
        }),
      })
      .parse(await alex.request(`/api/groups/${manifest.groupId}/expenses`)).data.expenses;
    assert.equal(expenses.length, 1);
    assert.equal(expenses[0].amountMinor, 1000);
    assert.deepEqual(
      expenses[0].splitBetween.map((share) => share.amountMinor),
      [334, 333, 333],
    );
    const activity = z
      .object({
        data: z.object({
          activities: z.array(
            z.object({ type: z.string(), metadata: z.record(z.string(), z.unknown()) }),
          ),
        }),
      })
      .parse(await alex.request(`/api/groups/${manifest.groupId}/activity`)).data.activities;
    assert.equal(
      activity.filter(
        (item) => item.type === 'expense_added' && item.metadata.expenseId === expenses[0]._id,
      ).length,
      1,
    );
    await alex.request(`/api/groups/${manifest.groupId}/tags/${manifest.tagId}`, 'PATCH', {
      isArchived: false,
    });
    const memberIds = controller
      .getSnapshot()
      .expense.context!.group.members.map((member) => member.user.id)
      .sort();
    const cases = [
      { method: 'equal', values: ['0', '0', '0'], expected: [334, 333, 333] },
      { method: 'unequal', values: ['5', '3', '2'], expected: [500, 300, 200] },
      { method: 'percentage', values: ['33.33', '33.33', '33.34'], expected: [333, 333, 334] },
      { method: 'shares', values: ['1', '1', '1'], expected: [334, 333, 333] },
      { method: 'exact', values: ['0.01', '9.99', '0'], expected: [1, 999, 0] },
    ] as const;
    for (const entry of cases) {
      await controller.openExpense(manifest.groupId);
      await controller.updateExpenseDraft({
        description: `QA54 ${entry.method}`,
        amount: '10',
        tagId: manifest.tagId,
        splitMethod: entry.method,
        multiPayer: true,
        payers: [
          { user: memberIds[0], amount: '6' },
          { user: memberIds[1], amount: '4' },
        ],
        participantIds: [...memberIds].reverse(),
      });
      await controller.updateExpenseDraft({
        splitValues: Object.fromEntries(
          memberIds.map((user, index) => [user, entry.values[index]]),
        ),
      });
      const preview = controller.getSnapshot().expense.preview!;
      assert.deepEqual(
        [...preview]
          .sort((a, b) => String(a.user).localeCompare(String(b.user)))
          .map((row) => row.amountMinor),
        entry.expected,
      );
      const before: number = submissions.length;
      offline = true;
      await controller.saveExpense();
      assert.equal(submissions.length, before);
      offline = false;
      loseResponse = true;
      await controller.saveExpense();
      assert.equal(controller.getSnapshot().expense.status, 'uncertain');
      controller = create();
      await controller.restore();
      await controller.openExpense(manifest.groupId);
      controller.resumeExpenseDraft();
      await controller.refresh();
      assert.equal(submissions.length, before + 1, 'Custom recovery resubmitted automatically.');
      await controller.saveExpense();
      assert.equal(controller.getSnapshot().expense.status, 'saved');
      assert.equal(submissions.length, before + 2);
      assert.deepEqual(submissions[before + 1], submissions[before]);
      const receiptId = controller.getSnapshot().expense.receiptId;
      const saved = z
        .object({
          data: z.object({
            expenses: z.array(
              z.object({
                _id: id,
                splitMethod: z.string(),
                amountMinor: z.number(),
                paidBy: z.array(z.object({ user: z.object({ _id: id }), amountMinor: z.number() })),
                splitBetween: z.array(
                  z.object({ user: z.object({ _id: id }), amountMinor: z.number() }),
                ),
              }),
            ),
          }),
        })
        .parse(await alex.request(`/api/groups/${manifest.groupId}/expenses`)).data.expenses;
      const expense = saved.find((row) => row._id === receiptId);
      assert.ok(expense);
      assert.equal(expense.splitMethod, entry.method);
      assert.equal(expense.amountMinor, 1000);
      assert.deepEqual(
        expense.paidBy.map((row) => row.amountMinor),
        [600, 400],
      );
      assert.deepEqual(
        expense.splitBetween.map((row) => ({ user: row.user._id, amountMinor: row.amountMinor })),
        preview.map((row) => ({ user: row.user, amountMinor: row.amountMinor })),
      );
      assert.equal(saved.length, cases.indexOf(entry) + 2, 'A custom retry duplicated an Expense.');
      const events = z
        .object({
          data: z.object({
            activities: z.array(
              z.object({ type: z.string(), metadata: z.record(z.string(), z.unknown()) }),
            ),
          }),
        })
        .parse(await alex.request(`/api/groups/${manifest.groupId}/activity`)).data.activities;
      assert.equal(
        events.filter(
          (event) => event.type === 'expense_added' && event.metadata.expenseId === receiptId,
        ).length,
        1,
      );
      console.log(
        `PASS: ${entry.method}, multiple payers, offline prevention, persisted retry, exact read-back and one Activity.`,
      );
    }
    await controller.openExpense(manifest.groupId);
    await controller.updateExpenseDraft({ description: 'Alex private draft', amount: '12' });
    await controller.signOut();
    assert.equal(await drafts.load(), null);
    await controller.signIn('sam');
    await controller.openExpense(manifest.groupId);
    assert.equal(controller.getSnapshot().expense.draft?.description, '');
    console.log(
      'PASS: exact remainder; validation correction; offline Save prevention; persisted lost-response restart/retry; one Expense + one Activity; refreshed balances; account isolation.',
    );
  } finally {
    await controller.signOut();
    await rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  await alex.signIn('alex');
  try {
    const [mode, file] = process.argv.slice(2);
    if (mode === '--cleanup-fixtures') {
      assert.ok(file && isAbsolute(file));
      await archive(manifestSchema.parse(JSON.parse(await readFile(file, 'utf8'))));
      console.log('Archived the verified QA53 fictional Group.');
    } else {
      await sam.signIn('sam');
      await priya.signIn('priya');
      const manifest = await seed();
      if (mode === '--seed-fixtures') {
        assert.ok(file && isAbsolute(file));
        await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
        console.log(`Created fictional native fixture ${groupName(manifest.runId)}.`);
      } else {
        try {
          await verify(manifest);
        } finally {
          await archive(manifest);
        }
      }
    }
  } finally {
    await Promise.all([alex.close(), sam.close(), priya.close()]);
  }
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Verification failed');
  process.exitCode = 1;
});
