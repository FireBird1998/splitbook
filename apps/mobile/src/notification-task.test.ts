import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachLiveReceiver,
  expenseAlertChannel,
  receiptBudget,
  receiveNotificationTask,
  type LiveReceiver,
  type NotificationTaskDependencies,
} from './notification-task';

// Fictional identities only.
const time = Date.now();
const envelope = {
  version: 2 as const,
  kind: 'expense_added' as const,
  eventId: 'd00000000000000000000001',
  groupId: 'b00000000000000000000001',
  recordId: 'c00000000000000000000001',
  accountId: 'a00000000000000000000001',
  environment: 'development' as const,
  binding: '00000000-0000-4000-8000-000000000001',
  activation: '00000000-0000-4000-8000-000000000002',
  occurredAt: new Date(time - 1_000).toISOString(),
  expiresAt: new Date(time - 1_000 + 86_400_000).toISOString(),
};
// What expo-notifications passes the task for a data-only FCM message on Android.
const payload = {
  data: { body: JSON.stringify(envelope), dataString: JSON.stringify(envelope) },
  notification: null,
};
function task(overrides: Partial<NotificationTaskDependencies> = {}) {
  return {
    now: () => time,
    visible: vi.fn(() => true),
    withoutApp: vi.fn(async (): Promise<typeof envelope | null> => null),
    present: vi.fn(async () => {}),
    ...overrides,
  } as NotificationTaskDependencies & {
    visible: ReturnType<typeof vi.fn>;
    withoutApp: ReturnType<typeof vi.fn>;
    present: ReturnType<typeof vi.fn>;
  };
}
// A mounted app whose sign-in is confirmed.
const signedIn = (receive: LiveReceiver['receive']): LiveReceiver => ({
  signedIn: () => true,
  receive,
});
let detach: (() => void) | undefined;
afterEach(() => {
  detach?.();
  detach = undefined;
  vi.useRealTimers();
});

describe('the notification task for data-only Expense alerts (#968)', () => {
  it('foreground on the affected Group: the app refreshes it quietly and shows no alert', async () => {
    const live = vi.fn(async () => false);
    detach = attachLiveReceiver(signedIn(live));
    const d = task();
    expect(await receiveNotificationTask(payload, d)).toBe(false);
    expect(live).toHaveBeenCalledWith(payload.data, true);
    expect(d.present).not.toHaveBeenCalled();
    expect(d.withoutApp).not.toHaveBeenCalled();
  });

  it('foreground elsewhere: the app passes its checks and the generic alert shows', async () => {
    detach = attachLiveReceiver(signedIn(async () => true));
    const d = task();
    expect(await receiveNotificationTask(payload, d)).toBe(true);
    expect(d.present).toHaveBeenCalledWith({
      identifier: 'expense-added:' + envelope.eventId,
      content: {
        title: 'Splitbook',
        body: 'An Expense was added.',
        data: { body: JSON.stringify(envelope) },
        sound: 'default',
      },
      trigger: { channelId: expenseAlertChannel },
    });
    // Generic: nothing of the Expense, its Group or its members.
    const shown = d.present.mock.calls[0][0].content;
    expect(shown.title + shown.body).not.toMatch(/[0-9a-f]{24}/);
  });

  it('background with the app still running: its checks run as not visible, so the alert shows', async () => {
    const live = vi.fn(async (_data: unknown, visible: boolean) => !visible);
    detach = attachLiveReceiver(signedIn(live));
    const d = task({ visible: vi.fn(() => false) });
    expect(await receiveNotificationTask(payload, d)).toBe(true);
    expect(live).toHaveBeenCalledWith(payload.data, false);
    expect(d.present).toHaveBeenCalledOnce();
  });

  it('no app running: the checks without the app decide, and pass shows the alert', async () => {
    const d = task({ withoutApp: vi.fn(async () => envelope) });
    expect(await receiveNotificationTask(payload, d)).toBe(true);
    expect(d.withoutApp).toHaveBeenCalledWith(payload.data);
    expect(d.present).toHaveBeenCalledOnce();
  });

  it('no app running: a dropped envelope shows nothing', async () => {
    const d = task();
    expect(await receiveNotificationTask(payload, d)).toBe(false);
    expect(d.present).not.toHaveBeenCalled();
  });

  it('after the app detaches, the task checks without it', async () => {
    const live = vi.fn(async () => true);
    attachLiveReceiver(signedIn(live))();
    const d = task();
    await receiveNotificationTask(payload, d);
    expect(live).not.toHaveBeenCalled();
    expect(d.withoutApp).toHaveBeenCalledOnce();
  });

  it('a mounted app not signed in yet: the checks without it decide, and only they run', async () => {
    const live = vi.fn(async () => true);
    detach = attachLiveReceiver({ signedIn: () => false, receive: live });
    const d = task({ withoutApp: vi.fn(async () => envelope) });
    expect(await receiveNotificationTask(payload, d)).toBe(true);
    expect(live).not.toHaveBeenCalled();
    expect(d.withoutApp).toHaveBeenCalledOnce();
    expect(d.present).toHaveBeenCalledOnce();
    const dropped = task();
    expect(await receiveNotificationTask(payload, dropped)).toBe(false);
    expect(live).not.toHaveBeenCalled();
    expect(dropped.present).not.toHaveBeenCalled();
  });

  it('a check that never answers shows nothing once its budget passes', async () => {
    vi.useFakeTimers();
    detach = attachLiveReceiver(signedIn(() => new Promise<boolean>(() => {})));
    const d = task();
    const shown = receiveNotificationTask(payload, d);
    await vi.advanceTimersByTimeAsync(receiptBudget);
    expect(await shown).toBe(false);
    expect(d.present).not.toHaveBeenCalled();
  });

  it('a failing check or presentation resolves false and never rejects', async () => {
    detach = attachLiveReceiver(
      signedIn(async () => {
        throw new Error('Fictional failure');
      }),
    );
    expect(await receiveNotificationTask(payload, task())).toBe(false);
    detach();
    const d = task({
      withoutApp: vi.fn(async () => envelope),
      present: vi.fn(async () => {
        throw new Error('Fictional presentation failure');
      }),
    });
    expect(await receiveNotificationTask(payload, d)).toBe(false);
  });

  it('ignores action responses, malformed payloads and expired envelopes without checking', async () => {
    const live = vi.fn(async () => true);
    detach = attachLiveReceiver(signedIn(live));
    const d = task();
    const expired = {
      data: {
        body: JSON.stringify({
          ...envelope,
          occurredAt: new Date(time - 86_400_001).toISOString(),
          expiresAt: new Date(time - 1).toISOString(),
        }),
      },
    };
    for (const value of [
      null,
      { actionIdentifier: 'default', notification: {} },
      { notification: null },
      { data: { body: '{' } },
      expired,
    ])
      expect(await receiveNotificationTask(value, d)).toBe(false);
    expect(live).not.toHaveBeenCalled();
    expect(d.present).not.toHaveBeenCalled();
  });
});

describe('Expense updated and deleted alerts (#841)', () => {
  it.each([
    ['expense_updated', 'An Expense was updated.'],
    ['expense_deleted', 'An Expense was deleted.'],
  ] as const)(
    '%s: foreground elsewhere and with no app running, the fixed generic text shows, one per event',
    async (kind, text) => {
      const changed = { ...envelope, kind };
      const message = { data: { body: JSON.stringify(changed) }, notification: null };
      detach = attachLiveReceiver(signedIn(async () => true));
      const live = task();
      expect(await receiveNotificationTask(message, live)).toBe(true);
      detach();
      detach = undefined;
      const noApp = task({ withoutApp: vi.fn(async () => changed) });
      expect(await receiveNotificationTask(message, noApp)).toBe(true);
      for (const d of [live, noApp]) {
        const alert = d.present.mock.calls[0][0];
        expect(alert).toEqual({
          identifier: kind.replace('_', '-') + ':' + envelope.eventId,
          content: {
            title: 'Splitbook',
            body: text,
            data: { body: JSON.stringify(changed) },
            sound: 'default',
          },
          trigger: { channelId: expenseAlertChannel },
        });
      }
    },
  );

  it('foreground on the affected Group: an update refreshes quietly and shows no alert', async () => {
    const live = vi.fn(async () => false);
    detach = attachLiveReceiver(signedIn(live));
    const d = task();
    const message = {
      data: { body: JSON.stringify({ ...envelope, kind: 'expense_updated' }) },
      notification: null,
    };
    expect(await receiveNotificationTask(message, d)).toBe(false);
    expect(live).toHaveBeenCalledWith(message.data, true);
    expect(d.present).not.toHaveBeenCalled();
  });

  it('an unknown kind is never shown', async () => {
    detach = attachLiveReceiver(signedIn(async () => true));
    const d = task({ withoutApp: vi.fn(async () => envelope) });
    const message = {
      data: { body: JSON.stringify({ ...envelope, kind: 'settlement_deleted' }) },
      notification: null,
    };
    expect(await receiveNotificationTask(message, d)).toBe(false);
    expect(d.present).not.toHaveBeenCalled();
  });
});

describe('Payment alerts (#842)', () => {
  const payment = { ...envelope, kind: 'settlement_recorded' as const };
  const message = { data: { body: JSON.stringify(payment) }, notification: null };
  it('foreground elsewhere and with no app running, the fixed generic Payment text shows, one per event', async () => {
    detach = attachLiveReceiver(signedIn(async () => true));
    const live = task();
    expect(await receiveNotificationTask(message, live)).toBe(true);
    detach();
    detach = undefined;
    const noApp = task({ withoutApp: vi.fn(async () => payment) });
    expect(await receiveNotificationTask(message, noApp)).toBe(true);
    for (const d of [live, noApp])
      expect(d.present.mock.calls[0][0]).toEqual({
        identifier: 'settlement-recorded:' + envelope.eventId,
        content: {
          title: 'Splitbook',
          body: 'A payment was recorded.',
          data: { body: JSON.stringify(payment) },
          sound: 'default',
        },
        trigger: { channelId: expenseAlertChannel },
      });
  });

  it('foreground on the affected Group: a payment refreshes quietly and shows no alert', async () => {
    const live = vi.fn(async () => false);
    detach = attachLiveReceiver(signedIn(live));
    const d = task();
    expect(await receiveNotificationTask(message, d)).toBe(false);
    expect(live).toHaveBeenCalledWith(message.data, true);
    expect(d.present).not.toHaveBeenCalled();
  });
});
