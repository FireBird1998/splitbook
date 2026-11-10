import Activity from '@/lib/models/Activity';
import { DEMO_PERSONA_IDS } from '@/lib/demo-personas';
import { it, expect, vi } from 'vitest';
import type { Recording, Answer } from './fixture';
import mongoose from 'mongoose';
import Group from '@/lib/models/Group';
import Expense from '@/lib/models/Expense';
import RecurringExpense from '@/lib/models/RecurringExpense';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const { alex, sam } = DEMO_PERSONA_IDS;

export function recordCreationPaths(recording: Recording) {
  if (recording.writer === 'single-settlement' || recording.writer === 'settlement-batch')
    it('the Group vanishes after route admission and before the service reads it', async () => {
      const before = await recording.state();
      const find = Group.collection.findOne;
      let removed = false;
      const spy = vi.spyOn(Group.collection, 'findOne').mockImplementation(async (...args) => {
        const filter = args[0];
        if (
          !removed &&
          Object.keys(filter).length === 1 &&
          String(filter._id) === recording.groupId
        ) {
          removed = true;
          await Group.collection.deleteOne({ _id: new mongoose.Types.ObjectId(recording.groupId) });
        }
        return find.apply(Group.collection, args);
      });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const recorded = await recording.capture(() => recording.send(), before);
        expect(removed).toBe(true);
        expect((recorded.answers as Answer).status).toBe(
          recording.writer === 'single-settlement' ? 500 : 403,
        );
      } finally {
        spy.mockRestore();
      }
    });
  if (recording.writer === 'settlement-batch') {
    it('one batch records same-currency and cross-currency rows', async () => {
      await recording.capture(() =>
        recording.send({
          settlements: [
            { currency: 'INR', amount: 30, note: 'Same currency' },
            {
              currency: 'EUR',
              amount: 20,
              amountPaidMinor: 185000,
              appliedRate: '92.5',
              rateKind: 'custom',
              suggestedRate: '92.1',
              rateSource: 'frankfurter',
              rateAsOf: '2026-10-20',
              rateFetchedAt: '2026-10-21T00:15:00.000Z',
              note: 'Cross currency',
            },
          ],
        }),
      );
    });
    it('no Debt in one row refuses the whole batch', async () => {
      await recording.capture(() =>
        recording.send({
          settlements: [
            { currency: 'INR', amount: 30 },
            {
              currency: 'USD',
              amount: 20,
              amountPaidMinor: 2000,
              appliedRate: '1',
              rateKind: 'entered',
            },
          ],
        }),
      );
    });
  }
  if (recording.writer === 'manual-expense') {
    it('the ordinary old-Tag-name retry returns the current display name', async () => {
      await recording.capture(async () => {
        const first = await recording.send();
        await Group.updateOne(
          { _id: recording.groupId, 'tags._id': recording.foodId },
          { $set: { 'tags.$.name': 'Meals' } },
        );
        return [first, await recording.send()];
      });
    });
    it('the duplicate-race response keeps the stored Tag name, then an ordinary retry rewrites it', async () => {
      const before = await recording.state();
      const pause = recording.holdFence(1);
      const racing = recording.send();
      let first: Answer;
      try {
        await pause.reached;
        first = await recording.send();
        await Group.updateOne(
          { _id: recording.groupId, 'tags._id': recording.foodId },
          { $set: { 'tags.$.name': 'Meals' } },
        );
      } finally {
        pause.release();
        pause.restore();
      }
      const duplicate = await racing;
      const ordinary = await recording.send();
      const after = await recording.state();
      expect([duplicate.body.data.tag, ordinary.body.data.tag]).toEqual(['Food', 'Meals']);
      expect(
        recording.names.normalise({ before, first, duplicate, ordinary, after }),
      ).toMatchSnapshot();
    });
    it('a reused old Tag name conflicts in the duplicate race but replays ordinarily', async () => {
      const before = await recording.state();
      const transaction = mongoose.connection.transaction.bind(mongoose.connection);
      const releases = new Map<string, () => void>();
      const arrivals = new Map<string, () => void>();
      const reached = (owner: string) =>
        new Promise<void>((resolve) => {
          arrivals.set(owner, resolve);
        });
      const winnerReached = reached('winner');
      const loserReached = reached('loser');
      const held = new Set<string>();
      const spy = vi
        .spyOn(mongoose.connection, 'transaction')
        .mockImplementation(async (callback, options) => {
          const owner = recording.requestOwner.getStore();
          if (owner && !held.has(owner)) {
            held.add(owner);
            const wait = new Promise<void>((resolve) => {
              releases.set(owner, resolve);
            });
            arrivals.get(owner)!();
            await wait;
          }
          return transaction(callback, options);
        });
      const waitForFence = async (arrival: Promise<void>, pending: Promise<Answer>) => {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            arrival,
            pending.then(() => {
              throw new Error('Request ended before its expected fence');
            }),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(
                () => reject(new Error('Recording did not reach its expected fence')),
                2_000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timeout);
        }
      };
      const winner = recording.requestOwner.run('winner', () => recording.send());
      let loser: Promise<Answer> | undefined;
      try {
        await waitForFence(winnerReached, winner);
        await Group.updateOne(
          { _id: recording.groupId, 'tags._id': recording.foodId },
          { $set: { 'tags.$.name': 'Meals' } },
        );
        const replacement = new mongoose.Types.ObjectId();
        recording.names.name(replacement, 'replacement-tag');
        await Group.updateOne(
          { _id: recording.groupId },
          { $push: { tags: { _id: replacement, name: 'Food', isArchived: false } } },
        );
        loser = recording.requestOwner.run('loser', () => recording.send());
        await waitForFence(loserReached, loser);
        releases.get('winner')!();
        const committed = await winner;
        releases.get('loser')!();
        const duplicate = await loser;
        spy.mockRestore();
        const ordinary = await recording.send();
        const after = await recording.state();
        expect([committed.status, duplicate.status, ordinary.status]).toEqual([201, 409, 201]);
        expect(
          recording.names.normalise({ before, committed, duplicate, ordinary, after }),
        ).toMatchSnapshot();
      } finally {
        // Late requests must use the real transaction instead of creating a new held gate.
        spy.mockRestore();
        for (const release of releases.values()) release();
        await Promise.allSettled([winner, ...(loser ? [loser] : [])]);
      }
    });
  }
  if (recording.writer === 'recurring-expense') {
    it('one read catches up three Months and a second read repeats none', async () => {
      await RecurringExpense.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(recording.templateId) },
        { $set: { startsOn: new Date('2026-09-01T00:00:00Z'), createdAt: recording.clock } },
      );
      await recording.capture(async () => [await recording.send(), await recording.send()]);
    });
    it('an unrelated duplicate stops the marker at the recorded prefix, then a read catches up', async () => {
      await RecurringExpense.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(recording.templateId) },
        { $set: { startsOn: new Date('2026-09-01T00:00:00Z'), createdAt: recording.clock } },
      );
      const index = await Expense.collection.createIndex(
        { description: 1 },
        { unique: true, name: 'recording_unrelated_collision' },
      );
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const before = await recording.state();
      try {
        const first = await recording.send();
        const stopped = await recording.state();
        expect(stopped.templates[0].lastGeneratedFor).toBe('2026-09');
        await Expense.collection.dropIndex(index);
        const retried = await recording.send();
        const after = await recording.state();
        expect(after.templates[0].lastGeneratedFor).toBe('2026-11');
        expect(
          recording.names.normalise({ before, first, stopped, retried, after }),
        ).toMatchSnapshot();
      } finally {
        if ((await Expense.collection.indexes()).some((entry) => entry.name === index))
          await Expense.collection.dropIndex(index);
      }
    });
  }
  if (
    recording.writer === 'manual-expense' ||
    recording.writer === 'edit' ||
    recording.writer === 'restore'
  )
    it('a currency removed before the financial commit refuses the recording', async () => {
      await recording.interleave(
        () =>
          Group.updateOne({ _id: recording.groupId }, { $pull: { alternateCurrencies: 'EUR' } }),
        { currency: 'EUR' },
      );
    });
  if (recording.writer === 'single-settlement' || recording.writer === 'settlement-batch') {
    it('a paying currency removed before the financial commit refuses the recording', async () => {
      const cross = {
        currency: 'INR',
        amount: 30,
        amountPaidMinor: 3000,
        appliedRate: '1',
        rateKind: 'entered',
      };
      await recording.interleave(
        () =>
          Group.updateOne({ _id: recording.groupId }, { $pull: { alternateCurrencies: 'EUR' } }),
        recording.writer === 'single-settlement'
          ? { ...cross, paidCurrency: 'EUR' }
          : { paidCurrency: 'EUR', settlements: [cross] },
      );
    });
    it('a real standalone database keeps its own transaction requirement', async () => {
      if (process.env.RECORDING_STANDALONE_RESULT) {
        const recorded = await recording.capture(() => recording.send());
        expect((recorded.answers as Answer).status).toBe(
          recording.writer === 'single-settlement' ? 201 : 503,
        );
        return;
      }
      const standaloneUri = process.env.STANDALONE_TEST_MONGODB_URI;
      if (!standaloneUri)
        throw new Error('Recordings require STANDALONE_TEST_MONGODB_URI for topology coverage');
      // Auth and models share one client. A separate process exercises a fresh server instance
      // against the real standalone database, then returns its record to this writer's snapshot.
      const directory = await mkdtemp(join(tmpdir(), 'splitbook-recording-'));
      const result = join(directory, 'record.json');
      try {
        await promisify(execFile)(
          process.execPath,
          [
            resolve('node_modules/vitest/vitest.mjs'),
            'run',
            `src/lib/recording-${recording.writer}.integration.test.ts`,
            '-t',
            'a real standalone database keeps its own transaction requirement',
            '--maxWorkers',
            '1',
          ],
          {
            cwd: process.cwd(),
            timeout: 15000,
            env: {
              ...process.env,
              TEST_MONGODB_URI: standaloneUri,
              RECORDING_STANDALONE_RESULT: result,
            },
          },
        );
        expect(JSON.parse(await readFile(result, 'utf8'))).toMatchSnapshot();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
  if (recording.writer === 'manual-expense' || recording.writer === 'single-settlement')
    it('two saves without a submission key are two recordings', async () => {
      await recording.capture(async () => [
        await recording.send({}, { 'Idempotency-Key': '' }),
        await recording.send({}, { 'Idempotency-Key': '' }),
      ]);
    });
  if (['manual-expense', 'single-settlement', 'settlement-batch'].includes(recording.writer))
    it('a historical currency removed before commit follows the writer’s currency rule', async () => {
      if (recording.writer !== 'settlement-batch') {
        const historical = await recording.http(
          recording.routes.expenses.POST,
          'POST',
          'expenses',
          recording.expenseBody({
            description: 'Historical Debt',
            currency: 'EUR',
            paidBy: [{ user: sam, amount: 120 }],
            splitBetween: [{ user: alex }],
          }),
        );
        expect(historical.status).toBe(201);
        await Activity.deleteMany({});
      }
      const recorded = await recording.interleave(
        () =>
          Group.updateOne({ _id: recording.groupId }, { $pull: { alternateCurrencies: 'EUR' } }),
        recording.writer === 'settlement-batch'
          ? {
              settlements: [
                {
                  currency: 'EUR',
                  amount: 30,
                  amountPaidMinor: 3000,
                  appliedRate: '1',
                  rateKind: 'entered',
                },
              ],
            }
          : { currency: 'EUR' },
      );
      expect((recorded.answers as Answer).status).toBe(
        recording.writer === 'manual-expense' ? 422 : 201,
      );
    });
  if (recording.writer === 'manual-expense' || recording.writer === 'recurring-expense')
    it('a failed first insertion leaves the currency lock the writer committed', async () => {
      await Expense.createCollection();
      await mongoose.connection.db!.command({
        collMod: 'expenses',
        validator: { description: { $ne: 'Recorded dinner' } },
      });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const recorded = await recording.capture(() => recording.send());
        expect(recorded.after.expenses).toHaveLength(0);
        expect(recorded.after.activities).toHaveLength(0);
        expect(recorded.after.group?.currencyLocked).toBe(recording.writer === 'recurring-expense');
      } finally {
        await mongoose.connection.db!.command({ collMod: 'expenses', validator: {} });
      }
    });
}
