import type { WidgetTarget } from '@splitbook/shared/balances-widget';
import { emptyNotificationOpening } from './notification-alerts';
import type { HeldNotificationOwner, MobileSnapshot } from './types';

type HeldFields = Pick<
  MobileSnapshot,
  'notificationOpening' | 'heldNotification' | 'heldNotificationNotice' | 'heldNotificationSource'
>;
export type HeldUpdateState = HeldFields & {
  generation: number;
  accountId: string | null;
  protected: boolean;
};
export type HeldOutcome =
  | { status: 'completed'; task?: 'intended' | 'interrupted' }
  | { status: 'refused' | 'unavailable' };
export interface HeldAdmission {
  /** A notification is offered even without a form; an ordinary widget can open directly. */
  kind: 'offer' | 'open';
  destination: {
    accountId: string | null;
    valid(): boolean;
    check?(): Promise<'allowed' | 'refused'>;
    open(owns: () => boolean, access: 'allowed' | 'refused'): Promise<HeldOutcome>;
  };
}
export type HeldIntent =
  | { source: 'notification'; value: unknown }
  | { source: 'widget'; target: WidgetTarget };
export type HeldAction =
  | { kind: 'open' }
  | { kind: 'dismiss' | 'consume-notice'; owner: HeldNotificationOwner };
export interface HeldUpdate {
  accept(intent: HeldIntent): Promise<void>;
  act(action: HeldAction): Promise<void>;
  reset(): void;
}

/** One in-memory destination. The controller keeps the route and the sole visible snapshot. */
export function createHeldUpdate(d: {
  read(): HeldUpdateState;
  publish(fields: HeldFields): void;
  notification(value: unknown): Promise<HeldAdmission | null>;
  widget(target: WidgetTarget): HeldAdmission | null | Promise<HeldAdmission | null>;
}): HeldUpdate {
  let nextTap = 0,
    acceptedTap = 0,
    epoch = 0;
  let pending: { source: HeldIntent['source']; destination: HeldAdmission['destination'] } | null =
    null;
  let signalled: HeldNotificationOwner | null = null;
  const fields = (): HeldFields => {
    const state = d.read();
    return {
      notificationOpening: state.notificationOpening,
      heldNotification: state.heldNotification,
      heldNotificationNotice: state.heldNotificationNotice,
      heldNotificationSource: state.heldNotificationSource,
    };
  };
  const opening = (status: MobileSnapshot['notificationOpening']['status']) => {
    d.publish({
      ...fields(),
      notificationOpening: {
        status,
        message:
          status === 'opening'
            ? 'Checking Group access…'
            : status === 'error'
              ? 'Couldn’t open the update. Retry when ready.'
              : 'An update is ready.',
      },
    });
  };
  const clear = () => {
    pending = null;
    d.publish({
      notificationOpening: emptyNotificationOpening(),
      heldNotification: null,
      heldNotificationNotice: null,
      heldNotificationSource: null,
    });
  };
  const ownsOwner = (owner: HeldNotificationOwner) => {
    const state = d.read();
    return (
      pending !== null &&
      owner === state.heldNotification &&
      owner.generation === state.generation &&
      owner.accountId === state.accountId
    );
  };
  const hold = (event: NonNullable<typeof pending>) => {
    const state = d.read();
    const owner = state.heldNotification ?? {
      generation: state.generation,
      accountId: event.destination.accountId!,
    };
    const first = signalled !== owner && state.protected;
    if (first) signalled = owner;
    pending = event;
    d.publish({
      notificationOpening: { status: 'held', message: 'An update is ready.' },
      heldNotification: owner,
      heldNotificationNotice: first ? owner : state.heldNotificationNotice,
      heldNotificationSource: event.source,
    });
  };
  const open = async () => {
    const event = pending,
      state = d.read();
    if (!event || state.protected) return;
    const owner = state.generation,
      admitted = event.destination,
      started = epoch;
    const owns = () =>
      pending === event &&
      epoch === started &&
      d.read().generation === owner &&
      d.read().accountId === admitted.accountId;
    if (!owns() || !admitted.valid()) {
      clear();
      return;
    }
    opening('opening');
    try {
      let access: 'allowed' | 'refused' = 'allowed';
      if (admitted.check) {
        access = await admitted.check();
        if (!owns()) return;
        if (d.read().protected) {
          opening('held');
          return;
        }
        // A refused Group still uses its existing unavailable view and saved-copy cleanup.
        if (access === 'allowed' && !admitted.valid()) {
          clear();
          return;
        }
      }
      const result = await admitted.open(owns, access);
      // This check also covers a refused destination's final navigation (#1162).
      if (!owns()) return;
      if (result.status === 'completed' && result.task === 'interrupted') {
        opening('held');
        return;
      }
      if (result.status === 'unavailable') throw new Error('Destination unavailable');
      clear();
    } catch {
      if (!owns()) return;
      opening(d.read().protected ? 'held' : 'error');
    }
  };
  return {
    async accept(intent) {
      // Reserve before admission: an older binding check/restore cannot replace a newer tap.
      const tap = ++nextTap;
      const admitted =
        intent.source === 'notification' ? d.notification(intent.value) : d.widget(intent.target);
      // Cold widget restore invalidates synchronously inside admission; later resets retire it.
      const admittedEpoch = epoch,
        admittedGeneration = d.read().generation;
      const admission = admitted instanceof Promise ? await admitted : admitted;
      if (
        !admission ||
        epoch !== admittedEpoch ||
        d.read().generation !== admittedGeneration ||
        tap < acceptedTap
      )
        return;
      acceptedTap = tap;
      const state = d.read(),
        destination = admission.destination;
      if (admission.kind === 'offer' || (state.accountId && (pending || state.protected))) {
        hold({ source: intent.source, destination });
        if (!state.protected) await open();
      } else {
        const owner = state.generation,
          started = epoch;
        // Ordinary unprotected widget navigation stays with its adapter, without held feedback.
        await destination.open(
          () => epoch === started && d.read().generation === owner && tap === acceptedTap,
          'allowed',
        );
      }
    },
    async act(action) {
      if (action.kind === 'open') {
        await open();
        return;
      }
      if (!ownsOwner(action.owner)) return;
      if (action.kind === 'dismiss') clear();
      else if (d.read().heldNotificationNotice === action.owner)
        d.publish({ ...fields(), heldNotificationNotice: null });
    },
    reset() {
      epoch++;
      pending = null;
      signalled = null;
      // Session cleanup already publishes the clean snapshot; do not add another render here.
    },
  };
}
