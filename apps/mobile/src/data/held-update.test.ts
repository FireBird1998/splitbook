import { describe, expect, it } from 'vitest';
import type { WidgetTarget } from '@splitbook/shared/balances-widget';
import { notificationHint } from '../test-utils/notification';
import { parseNotificationEnvelope } from './notification-alerts';
import {
  createHeldUpdate,
  type HeldAdmission,
  type HeldOutcome,
  type HeldUpdateState,
} from './held-update';

const alex = 'a00000000000000000000001';
const group = 'b00000000000000000000001';
const now = Date.UTC(2026, 10, 12, 12);

function scenario() {
  let state: HeldUpdateState = {
    generation: 1,
    accountId: alex,
    protected: true,
    notificationOpening: { status: 'idle', message: '' },
    heldNotification: null,
    heldNotificationNotice: null,
    heldNotificationSource: null,
  };
  const source = {
    now,
    enabled: true,
    admission: async () => {},
    access: async (): Promise<'allowed' | 'refused'> => 'allowed',
    navigation: async () => {},
    outcome: { status: 'completed' } as HeldOutcome,
  };
  const opened: { source: string; target: unknown }[] = [];
  const destination = (
    kind: string,
    target: unknown,
    accountId: string | null,
    valid: () => boolean,
  ) => ({
    accountId,
    valid,
    check: () => source.access(),
    async open(owns: () => boolean) {
      await source.navigation();
      if (owns()) opened.push({ source: kind, target });
      return source.outcome;
    },
  });
  const updates = createHeldUpdate({
    read: () => state,
    publish: (fields) => {
      state = { ...state, ...fields };
    },
    notification: async (value): Promise<HeldAdmission | null> => {
      await source.admission();
      const event = parseNotificationEnvelope(value, source.now);
      if (!event || event.accountId !== state.accountId || !source.enabled) return null;
      return {
        kind: 'offer',
        destination: destination(
          'notification',
          event.groupId,
          event.accountId,
          () => source.enabled && Date.parse(event.expiresAt) > source.now,
        ),
      };
    },
    widget: async (target: WidgetTarget): Promise<HeldAdmission> => ({
      kind: 'open',
      destination: destination('widget', target, state.accountId, () => true),
    }),
  });
  return {
    updates,
    source,
    opened,
    get state() {
      return state;
    },
    change(patch: Partial<HeldUpdateState>) {
      state = { ...state, ...patch };
    },
    hint: notificationHint(alex, group, now),
  };
}

describe('one held update through accept, act and reset', () => {
  it('offers only the newer tap and opens it only after the protected task closes', async () => {
    const h = scenario();
    await h.updates.accept({ source: 'notification', value: h.hint });
    await h.updates.accept({ source: 'widget', target: { kind: 'group', groupId: group } });
    expect(h.state).toMatchObject({
      notificationOpening: { status: 'held' },
      heldNotificationSource: 'widget',
    });
    expect(h.opened).toEqual([]);
    await h.updates.act({ kind: 'open' });
    expect(h.opened).toEqual([]);
    h.change({ protected: false });
    await h.updates.act({ kind: 'open' });
    expect(h.opened).toEqual([{ source: 'widget', target: { kind: 'group', groupId: group } }]);
    expect(h.state).toMatchObject({
      notificationOpening: { status: 'idle' },
      heldNotification: null,
    });
  });
});
