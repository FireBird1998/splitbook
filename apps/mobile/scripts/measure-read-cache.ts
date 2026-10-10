/**
 * #103: request counts and cold/warm timings for display reads.
 * Public controller → real HTTP → isolated fictional ledger, with a fixed injected
 * delay per request (MEASURE_LATENCY_MS, default 300) so timings resemble a phone.
 * Creates, then archives, its own fictional Household Group. Never resets a database.
 */
import assert from 'node:assert/strict';
import type { MobileSnapshot } from '../src/data/types';
import { alexId, samId } from './financial-view-fixtures';
import { withMeasurementHarness } from './measurement-harness';

async function run() {
  await withMeasurementHarness({ prefix: 'QA103' }, async (harness) => {
    const { alex, groupId, tagId, runId, now, month, measure } = harness;
    const groupsShown = (state: MobileSnapshot) =>
      state.groups.data.some((group) => group.id === groupId) && state.home.data !== null;
    const groupShown = (state: MobileSnapshot) =>
      state.detail.data?.id === groupId &&
      state.financial.expenses.data.length > 0 &&
      state.financial.balances.data !== null;
    const monthShown = (key: string) => (state: MobileSnapshot) =>
      state.financial.month === key &&
      state.financial.expenses.month === key &&
      state.financial.expenses.data.length > 0;

    for (const [offset, description] of [
      [0, 'QA103 this Month groceries'],
      [0, 'QA103 this Month rent share'],
      [-1, 'QA103 last Month groceries'],
    ] as const) {
      const date = new Date(now.getFullYear(), now.getMonth() + offset, 2, 12);
      await alex.request(
        `/api/groups/${groupId}/expenses`,
        'POST',
        {
          description,
          amount: 120,
          currency: 'INR',
          category: 'other',
          tagId,
          date: date.toISOString(),
          paidBy: [{ user: alexId, amount: 120 }],
          splitMethod: 'equal',
          splitBetween: [{ user: alexId }, { user: samId }],
        },
        201,
      );
    }

    let controller = harness.restart();
    await measure(
      'Sign in, Groups and Home (cold, no saved views)',
      () => controller!.signIn('sam'),
      groupsShown,
    );
    await measure('Open the Group (first time)', () => controller!.openGroup(groupId), groupShown);
    await measure(
      'Back to Groups within 30 s',
      () => Promise.resolve(controller!.back()),
      groupsShown,
    );
    await measure('Reopen the Group within 30 s', () => controller!.openGroup(groupId), groupShown);
    await measure(
      'Three overlapping foreground events within 30 s',
      () =>
        Promise.all([
          controller!.refresh('foreground'),
          controller!.refresh('foreground'),
          controller!.refresh('foreground'),
        ]),
      groupShown,
    );
    harness.advance(31_000);
    await measure(
      'Three overlapping foreground events after 30 s',
      () =>
        Promise.all([
          controller!.refresh('foreground'),
          controller!.refresh('foreground'),
          controller!.refresh('foreground'),
        ]),
      groupShown,
    );
    await measure('Pull to refresh', () => controller!.refresh('pull'), groupShown);
    await measure(
      'Previous Month (first visit)',
      () => controller!.selectMonth(month(-1)),
      monthShown(month(-1)),
    );
    await measure(
      'Back to this Month within 30 s',
      () => controller!.selectMonth(month(0)),
      monthShown(month(0)),
    );
    await measure(
      'Previous, this, previous Month without waiting',
      () =>
        Promise.all([
          controller!.selectMonth(month(-1)),
          controller!.selectMonth(month(0)),
          controller!.selectMonth(month(-1)),
        ]),
      monthShown(month(-1)),
    );
    await controller.selectMonth(month(0));
    await controller.openExpense(groupId);
    await controller.updateExpenseDraft({
      amount: '45.50',
      description: `QA103 confirmed write ${runId.slice(0, 8)}`,
      tagId,
    });
    await measure(
      'Confirmed Expense create, then affected views',
      () => controller!.saveExpense(),
      (state) =>
        state.screen === 'group' &&
        state.financial.expenses.data.some((expense) =>
          expense.description.startsWith('QA103 confirmed write'),
        ),
    );
    assert.ok(
      controller
        .getSnapshot()
        .financial.expenses.data.some((expense) =>
          expense.description.startsWith('QA103 confirmed write'),
        ),
      'The confirmed Expense is missing after the post-write refresh.',
    );
    harness.advance(31_000);
    controller = harness.restart();
    await measure(
      'Restart: restore, Groups and Home (saved views)',
      () => controller!.restore(),
      groupsShown,
    );
    await measure(
      'Restart: open the Group (saved views)',
      () => controller!.openGroup(groupId),
      groupShown,
    );
  });
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
