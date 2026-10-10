/**
 * #108: request counts and timings for the Group Activity destination, so a change to how
 * Activity is read can be compared with the controller's own reads on the same journeys.
 * Public controller → real HTTP → isolated fictional ledger, with a fixed injected delay
 * per request (MEASURE_LATENCY_MS, default 300). Creates, then archives, its own fictional
 * Household Group. Never resets a database.
 *
 * A foreground event is what App.tsx does when Android reports the app active again: the
 * controller's foreground refresh. The TanStack Query pilot (PR #173) also sent a focus
 * event through its focusManager; that call left with the pilot.
 *
 * Run inside apps/mobile, as the verify:* scripts run, against a fictional backend:
 *   MOBILE_VERIFY_URL=http://127.0.0.1:<port> node --import tsx scripts/measure-activity-reads.ts
 * Record: docs/qa/2026-10-02-android-activity-query-pilot.md.
 */
import assert from 'node:assert/strict';
import type { MobileSnapshot } from '../src/data/types';
import { alexId, samId } from './financial-view-fixtures';
import { withMeasurementHarness } from './measurement-harness';

async function run() {
  await withMeasurementHarness(
    {
      prefix: 'QA108',
      persistOfflineIdentity: true,
      extraQueryKey: (target) =>
        target.pathname.endsWith('/activity')
          ? `?page=${target.searchParams.get('page')}`
          : undefined,
    },
    async (harness) => {
      const { alex, groupId, tagId, runId, measure } = harness;
      const activityShown =
        (minimum = 1) =>
        (state: MobileSnapshot) =>
          state.screen === 'group' &&
          state.destination === 'activity' &&
          state.activity.groupId === groupId &&
          state.activity.events.length >= minimum;
      const activityHasDescription = (text: string) => (state: MobileSnapshot) =>
        activityShown()(state) &&
        state.activity.events.some((event) => event.metadata.description?.startsWith(text));

      // More than one Activity page: 24 Expenses plus the Group and membership events.
      const now = new Date();
      for (let index = 1; index <= 24; index += 1)
        await alex.request(
          `/api/groups/${groupId}/expenses`,
          'POST',
          {
            description: `QA108 seeded ${index}`,
            amount: 30,
            currency: 'INR',
            category: 'other',
            tagId,
            date: new Date(now.getFullYear(), now.getMonth(), 1, 12).toISOString(),
            paidBy: [{ user: alexId, amount: 30 }],
            splitMethod: 'equal',
            splitBetween: [{ user: alexId }, { user: samId }],
          },
          201,
        );

      let controller = harness.restart();
      await controller.signIn('sam');
      const foreground = () => controller.refresh('foreground');
      await measure(
        'Open the Group on Activity (first time)',
        () => controller!.openActivity(groupId),
        activityShown(),
      );
      await measure(
        'Expenses, then Activity again within 30 s',
        async () => {
          await controller!.selectDestination('expenses');
          await controller!.selectDestination('activity');
        },
        activityShown(),
      );
      await measure(
        'Three overlapping foreground events on Activity within 30 s',
        () => Promise.all([foreground(), foreground(), foreground()]),
        activityShown(),
      );
      harness.advance(31_000);
      await measure(
        'Three overlapping foreground events on Activity after 30 s',
        () => Promise.all([foreground(), foreground(), foreground()]),
        activityShown(),
      );
      await measure(
        'Pull to refresh on Activity',
        () => controller!.refresh('pull'),
        activityShown(),
      );
      await measure('Load older Activity', () => controller!.loadMoreActivity(), activityShown(21));
      await measure(
        'Home, then the Group on Activity within 30 s',
        async () => {
          await controller!.back();
          await controller!.openActivity(groupId);
        },
        activityShown(),
      );
      await controller.selectDestination('expenses');
      await controller.openExpense(groupId);
      await controller.updateExpenseDraft({
        amount: '45.50',
        description: `QA108 confirmed write ${runId.slice(0, 8)}`,
        tagId,
      });
      await measure(
        'Confirmed Expense create (returns to Expenses)',
        () => controller!.saveExpense(),
        (state) => state.screen === 'group' && state.destination === 'expenses',
      );
      await measure(
        'Activity after the confirmed create',
        () => controller!.selectDestination('activity'),
        activityHasDescription('QA108 confirmed write'),
      );
      assert.ok(
        activityHasDescription('QA108 confirmed write')(controller.getSnapshot()),
        'The confirmed Expense is missing from Activity after the write.',
      );
      harness.advance(31_000);
      controller = harness.restart();
      await controller.restore();
      await measure(
        'Restart: open the Group on Activity (saved views)',
        () => controller!.openActivity(groupId),
        activityShown(),
      );
      harness.setOffline(true);
      controller = harness.restart();
      await controller.restore();
      await measure(
        'Offline restart: open the Group on Activity',
        () => controller!.openActivity(groupId),
        activityShown(),
      );
      const shown = controller.getSnapshot();
      console.log(
        `Offline restart: Activity ${shown.activity.status}, ${shown.activity.events.length} events, offline label ${shown.offline.active ? 'shown' : 'absent'}, saved time ${shown.offline.refreshedAt ? 'kept' : 'absent'}.`,
      );
      harness.setOffline(false);
    },
  );
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
