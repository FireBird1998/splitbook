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

function barrier() {
  let arrive!: () => void, release!: () => void;
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    arrived,
    release,
    async pause() {
      arrive();
      await waiting;
    },
  };
}

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
    widget: (target: WidgetTarget): HeldAdmission => ({
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
  it('does not let an older admission finishing last replace a newer accepted tap', async () => {
    const h = scenario(),
      held = barrier();
    h.source.admission = held.pause;
    const older = h.updates.accept({ source: 'notification', value: h.hint });
    try {
      await held.arrived;
      await h.updates.accept({ source: 'widget', target: 'review' });
      held.release();
      await older;
      h.change({ protected: false });
      await h.updates.act({ kind: 'open' });
      expect(h.opened).toEqual([{ source: 'widget', target: 'review' }]);
    } finally {
      held.release();
      await older;
    }
  });

  it('holds again when a new task starts during the access check', async () => {
    const h = scenario(),
      held = barrier();
    await h.updates.accept({ source: 'notification', value: h.hint });
    h.change({ protected: false });
    h.source.access = async () => {
      await held.pause();
      return 'allowed';
    };
    const opening = h.updates.act({ kind: 'open' });
    try {
      await held.arrived;
      h.change({ protected: true });
      held.release();
      await opening;
      expect(h.state.notificationOpening.status).toBe('held');
      expect(h.opened).toEqual([]);
      h.change({ protected: false });
      await h.updates.act({ kind: 'open' });
      expect(h.opened).toEqual([{ source: 'notification', target: group }]);
    } finally {
      held.release();
      await opening;
    }
  });

  it.each(['completed', 'refused', 'unavailable', 'throw'] as const)(
    'a late %s navigation never clears or changes a newer held destination',
    async (ending) => {
      const h = scenario(),
        held = barrier();
      await h.updates.accept({ source: 'notification', value: h.hint });
      h.change({ protected: false });
      h.source.navigation = async () => {
        await held.pause();
        if (ending === 'throw') throw new Error('Lost reply');
      };
      h.source.outcome = { status: ending === 'throw' ? 'completed' : ending };
      const opening = h.updates.act({ kind: 'open' });
      try {
        await held.arrived;
        h.change({ protected: true });
        await h.updates.accept({ source: 'widget', target: 'review' });
        const newer = h.state.heldNotification;
        held.release();
        await opening;
        expect(h.state).toMatchObject({
          notificationOpening: { status: 'held' },
          heldNotificationSource: 'widget',
        });
        expect(h.state.heldNotification).toBe(newer);
        h.source.navigation = async () => {};
        h.source.outcome = { status: 'completed' };
        h.change({ protected: false });
        await h.updates.act({ kind: 'open' });
        expect(h.opened).toEqual([{ source: 'widget', target: 'review' }]);
      } finally {
        held.release();
        await opening;
      }
    },
  );
  it('keeps an interrupted widget navigation held, but completes its intended form', async () => {
    const h = scenario(),
      held = barrier();
    await h.updates.accept({ source: 'widget', target: { kind: 'expense', groupId: group } });
    h.change({ protected: false });
    h.source.navigation = held.pause;
    h.source.outcome = { status: 'completed', task: 'interrupted' };
    const opening = h.updates.act({ kind: 'open' });
    try {
      await held.arrived;
      h.change({ protected: true });
      held.release();
      await opening;
      expect(h.state.notificationOpening.status).toBe('held');
      h.source.navigation = async () => {
        h.change({ protected: true });
      };
      h.source.outcome = { status: 'completed', task: 'intended' };
      h.change({ protected: false });
      await h.updates.act({ kind: 'open' });
      expect(h.state).toMatchObject({
        notificationOpening: { status: 'idle' },
        heldNotification: null,
      });
    } finally {
      held.release();
      await opening;
    }
  });

  it.each(['refused', 'unavailable'] as const)(
    'a %s destination ends or offers explicit Retry',
    async (result) => {
      const h = scenario();
      await h.updates.accept({ source: 'notification', value: h.hint });
      h.change({ protected: false });
      h.source.access = async () => (result === 'refused' ? 'refused' : 'allowed');
      h.source.outcome = { status: result };
      await h.updates.act({ kind: 'open' });
      expect(h.state.notificationOpening.status).toBe(result === 'refused' ? 'idle' : 'error');
      expect(h.state.heldNotification === null).toBe(result === 'refused');
      if (result === 'unavailable') {
        h.source.outcome = { status: 'completed' };
        await h.updates.act({ kind: 'open' });
        expect(h.state.notificationOpening.status).toBe('idle');
      }
    },
  );

  it.each(['held', 'opening'] as const)(
    'drops an expired or deactivated notification while %s',
    async (phase) => {
      for (const invalidate of ['expiry', 'category'] as const) {
        const h = scenario(),
          held = barrier();
        await h.updates.accept({ source: 'notification', value: h.hint });
        h.change({ protected: false });
        if (phase === 'opening')
          h.source.access = async () => {
            await held.pause();
            return 'allowed';
          };
        const opening = phase === 'opening' ? h.updates.act({ kind: 'open' }) : undefined;
        try {
          if (opening) await held.arrived;
          if (invalidate === 'expiry') h.source.now += 86_400_000;
          else h.source.enabled = false;
          held.release();
          await (opening ?? h.updates.act({ kind: 'open' }));
          expect(h.opened).toEqual([]);
          expect(h.state).toMatchObject({
            notificationOpening: { status: 'idle' },
            heldNotification: null,
          });
        } finally {
          held.release();
          await opening;
        }
      }
    },
  );

  it('consumes one notice per hold, updates its source, and ignores a stale owner', async () => {
    const h = scenario();
    await h.updates.accept({ source: 'notification', value: h.hint });
    const first = h.state.heldNotification!;
    expect(h.state.heldNotificationNotice).toBe(first);
    await h.updates.act({ kind: 'consume-notice', owner: first });
    await h.updates.accept({ source: 'widget', target: 'home' });
    expect(h.state.heldNotification).toBe(first);
    expect(h.state.heldNotificationNotice).toBeNull();
    expect(h.state.heldNotificationSource).toBe('widget');
    await h.updates.act({ kind: 'dismiss', owner: first });
    await h.updates.accept({ source: 'widget', target: 'review' });
    const next = h.state.heldNotification;
    await h.updates.act({ kind: 'consume-notice', owner: first });
    await h.updates.act({ kind: 'dismiss', owner: first });
    expect(h.state.heldNotification).toBe(next);
    expect(h.state.heldNotificationNotice).toBe(next);
    h.change({ protected: false });
    await h.updates.act({ kind: 'open' });
    expect(h.opened).toEqual([{ source: 'widget', target: 'review' }]);
  });

  it('signals the first protected tap after an earlier unprotected open failed', async () => {
    const h = scenario();
    h.change({ protected: false });
    h.source.outcome = { status: 'unavailable' };
    await h.updates.accept({ source: 'notification', value: h.hint });
    expect(h.state.heldNotificationNotice).toBeNull();
    h.change({ protected: true });
    await h.updates.accept({ source: 'widget', target: 'home' });
    expect(h.state.heldNotificationNotice).toBe(h.state.heldNotification);
    expect(h.state.heldNotificationSource).toBe('widget');
  });
  describe.each(['access', 'navigation'] as const)('reset during %s', (phase) => {
    it.each(['sign-out', '401', 'account-switch'] as const)(
      'retires an open on %s, including its stale owner',
      async (reason) => {
        const h = scenario(),
          held = barrier();
        await h.updates.accept({ source: 'notification', value: h.hint });
        const staleOwner = h.state.heldNotification!;
        h.change({ protected: false });
        if (phase === 'access')
          h.source.access = async () => {
            await held.pause();
            return 'allowed';
          };
        else h.source.navigation = held.pause;
        const opening = h.updates.act({ kind: 'open' });
        try {
          await held.arrived;
          h.change({ generation: 2 });
          h.updates.reset();
          // The host owns its account/screen cleanup, as the controller does.
          h.change({
            accountId: reason === 'account-switch' ? 'a00000000000000000000002' : null,
            notificationOpening: { status: 'idle', message: '' },
            heldNotification: null,
            heldNotificationNotice: null,
            heldNotificationSource: null,
          });
          const afterReset = h.state;
          held.release();
          await opening;
          await h.updates.act({ kind: 'consume-notice', owner: staleOwner });
          await h.updates.act({ kind: 'dismiss', owner: staleOwner });
          await h.updates.act({ kind: 'open' });
          expect(h.state).toBe(afterReset);
          expect(h.opened).toEqual([]);
        } finally {
          held.release();
          await opening;
        }
      },
    );
  });

  it('opens an ordinary unprotected widget without creating a held notice', async () => {
    const h = scenario();
    h.change({ protected: false });
    await h.updates.accept({ source: 'widget', target: 'home' });
    expect(h.opened).toEqual([{ source: 'widget', target: 'home' }]);
    expect(h.state).toMatchObject({
      notificationOpening: { status: 'idle' },
      heldNotification: null,
      heldNotificationNotice: null,
    });
  });

  it('allows widget setup before sign-in through the direct destination adapter', async () => {
    const h = scenario();
    h.change({ accountId: null, protected: false });
    const target = { kind: 'setup', widgetId: 7 } as const;
    await h.updates.accept({ source: 'widget', target });
    expect(h.opened).toEqual([{ source: 'widget', target }]);
    expect(h.state.heldNotification).toBeNull();
  });
});
