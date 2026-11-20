import { describe, expect, it } from 'vitest';
import type {
  DraftReview,
  ExpenseDraftValues,
  PersistedExpenseDraft,
} from '@splitbook/shared/validators/expense-draft';
import { manualTimer } from '../test-utils/transport-faults';
import { createReviewRun, type ReviewRunState } from './review-run';

// The review run's own machine (#1287): a typed change saves through it, and every state it
// publishes is what the screen renders. Fictional people and Groups only.

const groupId = 'b00000000000000000000001';
const values = (description: string): ExpenseDraftValues => ({
  description,
  amount: 12.34,
  currency: 'INR',
  date: '2026-10-14',
  category: 'other',
  paidBy: [{ user: 'a00000000000000000000001', amount: 12.34 }],
  splitMethod: 'equal',
  splitBetween: [{ user: 'a00000000000000000000001' }],
});
const draft = (revision: number, description: string): PersistedExpenseDraft => ({
  id: 'd00000000000000000000001',
  groupId,
  revision,
  state: 'active',
  preparedBy: { kind: 'assistant', name: 'Claude' },
  changedBy: { kind: 'assistant', name: 'Claude' },
  createdAt: '2026-10-14T06:30:00.000Z',
  updatedAt: '2026-10-14T06:30:00.000Z',
  missingFields: [],
  values: values(description),
});
const review = (version: PersistedExpenseDraft): DraftReview => ({
  draft: version,
  review: 'a'.repeat(64),
  problems: [],
  duplicates: [],
});

/** One Draft on the review run, with its context read, and a pending-action read it can hold. */
function machine() {
  let online = true;
  let server = draft(0, 'Lunch');
  const replaced: string[] = [];
  let holding: { reached: () => void; gate: Promise<void> } | null = null;
  let writeGate: Promise<void> | null = null;
  let refreshGate: { reached: () => void; gate: Promise<void> } | null = null;
  const timers = manualTimer();
  const amounts: (number | undefined)[] = [];
  const client = {
    context: async () => ({}),
    pending: async () => {
      const held = holding;
      holding = null;
      if (held) {
        held.reached();
        await held.gate;
      }
      return null;
    },
    review: async () => [review(server)],
    replace: async (version: PersistedExpenseDraft, next: ExpenseDraftValues) => {
      // A write based on an older version is refused, as the server refuses it (#1289).
      if (version.revision !== server.revision) throw new Error('STALE_REVISION');
      replaced.push(String(next.description));
      amounts.push(next.amount);
      const gate = writeGate;
      writeGate = null;
      if (gate) await gate;
      server = { ...version, revision: version.revision + 1, values: next };
      return server;
    },
    expense: async () => ({}),
  };
  let state: ReviewRunState = {
    items: [{ groupId, groupName: 'Maple House', currency: 'INR', item: review(server) }],
    index: 0,
    outcomes: [],
    context: {} as ReviewRunState['context'],
    busy: false,
    editing: false,
    unkept: null,
    pending: false,
    acknowledged: false,
    deletePrompt: false,
    message: null,
    changed: null,
    matches: [],
    allocation: null,
  };
  const published: ReviewRunState[] = [];
  const run = createReviewRun({
    read: () => state,
    publish: (next) => {
      state = next;
      published.push(next);
    },
    current: () => true,
    online: () => online,
    client: () => client as never,
    refresh: async () => {
      const held = refreshGate;
      refreshGate = null;
      if (held) {
        held.reached();
        await held.gate;
      }
    },
    timer: timers.timer,
  });
  return {
    run,
    published,
    replaced,
    amounts,
    server: () => server,
    state: () => state,
    /** The next write's reply waits until released. */
    holdWrite() {
      let release!: () => void;
      writeGate = new Promise<void>((resolve) => (release = resolve));
      return release;
    },
    goOffline: () => {
      online = false;
    },
    /** A pause in typing long enough to save the Draft (#1289). */
    pause: () => timers.elapse(1000),
    /** The assistant replaces the Draft: a newer version on the server. */
    moveServer: () => {
      server = {
        ...server,
        revision: server.revision + 1,
        changedBy: { kind: 'assistant', name: 'Claude' },
        values: {
          ...server.values,
          amount: 24,
          paidBy: [{ user: 'a00000000000000000000001', amount: 24 }],
        },
      };
    },
    /** The next To review read waits until released. */
    holdRefresh() {
      let reached!: () => void, release!: () => void;
      const arrived = new Promise<void>((resolve) => (reached = resolve));
      refreshGate = { reached, gate: new Promise<void>((resolve) => (release = resolve)) };
      return { arrived, release };
    },
    /** The next pending-action read waits until released: the end of a save. */
    holdPending() {
      let reached!: () => void, release!: () => void;
      const arrived = new Promise<void>((resolve) => (reached = resolve));
      holding = { reached, gate: new Promise<void>((resolve) => (release = resolve)) };
      return { arrived, release };
    },
  };
}

/** What the screen locks the Draft's fields on, beside offline, pending and no context. */
const locksFields = (state: ReviewRunState) => state.busy && !state.editing;

describe('a typed change on the review run (#1287)', () => {
  it('never locks the Draft’s fields while it saves, up to the end of its save', async () => {
    const m = machine();
    const pending = m.holdPending();
    const saving = m.run.change(values('Lunch two'));
    // The write is kept; the run is reading whether an earlier action is pending.
    await pending.arrived;
    expect(m.published.filter(locksFields)).toEqual([]);
    pending.release();
    await saving;
    expect(m.published.filter(locksFields)).toEqual([]);
    expect(m.replaced).toEqual(['Lunch two']);
    expect(m.state()).toMatchObject({ busy: false, editing: false });
  });

  it('saves a change typed while its save is ending, in a save of its own', async () => {
    const m = machine();
    const pending = m.holdPending();
    void m.run.change(values('Lunch two'));
    await pending.arrived;
    // Typed during the end of the first save.
    void m.run.change(values('Lunch three'));
    expect(m.state().items[0].item.draft.values?.description).toBe('Lunch three');
    pending.release();
    await m.run.finishEditing();
    expect(m.replaced).toEqual(['Lunch two', 'Lunch three']);
    expect(m.published.filter(locksFields)).toEqual([]);
    expect(m.state()).toMatchObject({ busy: false, editing: false });
    expect(m.state().items[0].item.draft).toMatchObject({
      revision: 2,
      values: { description: 'Lunch three' },
    });
  });

  it('keeps a change typed as its save ends for Keep my changes, when it can’t be saved after', async () => {
    const m = machine();
    const pending = m.holdPending();
    void m.run.change(values('Lunch two'));
    await pending.arrived;
    void m.run.change(values('Lunch three'));
    m.goOffline();
    pending.release();
    await m.run.finishEditing();
    expect(m.replaced).toEqual(['Lunch two']);
    expect(m.state().unkept?.description).toBe('Lunch three');
    expect(m.state()).toMatchObject({ busy: false, editing: false });
  });

  // QA's device check: seven deletes, then "450", with saves and their reads landing in between.
  it.each([
    'all at once',
    'each settled',
    'during a held write',
    'at the held end of a save',
  ] as const)(
    'keeps every Amount of a burst, and never notes a newer version for its own saves: %s',
    async (interleaving) => {
      const m = machine();
      const typed = [1200, 1200, 1200, 120, 12, 1, undefined, 4, 45, 450];
      const amount = (value: number | undefined) => ({ ...values('Lunch'), amount: value });
      const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
      if (interleaving === 'all at once')
        for (const value of typed) void m.run.change(amount(value));
      if (interleaving === 'each settled')
        for (const value of typed) {
          void m.run.change(amount(value));
          await tick();
        }
      if (interleaving === 'during a held write') {
        const release = m.holdWrite();
        for (const value of typed.slice(0, 7)) {
          void m.run.change(amount(value));
          await tick();
        }
        release();
        for (const value of typed.slice(7)) {
          void m.run.change(amount(value));
          await tick();
        }
      }
      if (interleaving === 'at the held end of a save') {
        for (const value of typed.slice(0, 7)) {
          void m.run.change(amount(value));
          await tick();
        }
        const pending = m.holdPending();
        void m.run.change(amount(4));
        await pending.arrived;
        void m.run.change(amount(45));
        void m.run.change(amount(450));
        pending.release();
      }
      await m.run.finishEditing();
      await tick();
      await m.run.finishEditing();
      expect(m.state().items[0].item.draft.values?.amount).toBe(450);
      expect(m.server().values?.amount).toBe(450);
      expect(m.amounts.at(-1)).toBe(450);
      expect(m.published.some((state) => state.changed !== null)).toBe(false);
      expect(m.published.filter(locksFields)).toEqual([]);
      expect(m.state()).toMatchObject({ busy: false, editing: false, unkept: null });
    },
  );
});

// #1289: a key typed is shown at once and saved after a pause in typing, or at once at a flush
// point; nothing typed is lost when a save is refused, offline or under way.
describe('typing on the review run (#1289)', () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('type shows a burst at once and sends it in one write after the pause', async () => {
    const m = machine();
    for (const description of ['Lunch a', 'Lunch at', 'Lunch at Mezze'])
      m.run.type(values(description));
    expect(m.state().items[0].item.draft.values?.description).toBe('Lunch at Mezze');
    await tick();
    expect(m.replaced).toEqual([]);
    m.pause();
    await tick();
    await m.run.finishEditing();
    expect(m.replaced).toEqual(['Lunch at Mezze']);
    expect(m.state().items[0].item.draft).toMatchObject({ revision: 1 });
    expect(m.published.filter(locksFields)).toEqual([]);
  });

  it('flush sends what is typed at once and returns its save; the pause then sends nothing', async () => {
    const m = machine();
    m.run.type(values('Lunch at'));
    await m.run.flush();
    expect(m.replaced).toEqual(['Lunch at']);
    m.pause();
    await m.run.finishEditing();
    expect(m.replaced).toEqual(['Lunch at']);
    expect(m.run.flush()).toBeUndefined();
  });

  it('flush offline keeps what is typed for Keep my changes and sends nothing', async () => {
    const m = machine();
    m.run.type(values('Lunch at'));
    m.goOffline();
    expect(m.run.flush()).toBeUndefined();
    expect(m.state().unkept?.description).toBe('Lunch at');
    m.pause();
    await tick();
    expect(m.replaced).toEqual([]);
  });

  it('flush during a save sending its writes adds the typing to that save', async () => {
    const m = machine();
    const release = m.holdWrite();
    m.run.type(values('Lunch at'));
    const first = m.run.flush();
    // Its write is under way, held.
    await tick();
    m.run.type(values('Lunch at Mezze'));
    expect(m.run.flush()).toBe(first);
    release();
    await m.run.finishEditing();
    expect(m.replaced).toEqual(['Lunch at', 'Lunch at Mezze']);
    expect(m.server().values?.description).toBe('Lunch at Mezze');
  });

  it('finishEditing sends what is typed and waits for its save, with what is typed meanwhile', async () => {
    const m = machine();
    const release = m.holdWrite();
    m.run.type(values('Lunch at'));
    const done = m.run.finishEditing();
    await tick();
    m.run.type(values('Lunch at Mezze'));
    release();
    await done;
    expect(m.replaced).toEqual(['Lunch at', 'Lunch at Mezze']);
    expect(m.state()).toMatchObject({ busy: false, editing: false, unkept: null });
  });

  // QA's probe: typing while a refused save reads the newer version joins what wasn't kept.
  it.each(['leaving the field', 'the pause'] as const)(
    'keeps typing entered while a refused save recovers for Keep my changes: %s',
    async (how) => {
      const m = machine();
      m.run.type(values('Lunch at'));
      m.moveServer();
      const read = m.holdRefresh();
      m.pause();
      await read.arrived;
      m.run.type(values('Lunch at Mezze'));
      if (how === 'leaving the field') void m.run.flush();
      else m.pause();
      read.release();
      await m.run.finishEditing();
      expect(m.replaced).toEqual([]);
      expect(m.state().unkept?.description).toBe('Lunch at Mezze');
      expect(m.state().changed).toMatchObject({ before: { revision: 0 }, after: { revision: 1 } });
      expect(m.server().values).toMatchObject({ description: 'Lunch', amount: 24 });
      await m.run.retryChange();
      await m.run.finishEditing();
      expect(m.replaced).toEqual(['Lunch at Mezze']);
      expect(m.server().revision).toBe(2);
    },
  );

  it('keepUnsent keeps what is typed, and what a save under way still holds, for Keep my changes', async () => {
    const m = machine();
    const release = m.holdWrite();
    m.run.type(values('Lunch at'));
    m.pause();
    await tick();
    // Handed to the save under way, then the connection drops.
    m.run.type(values('Lunch at Mez'));
    m.pause();
    m.goOffline();
    m.run.keepUnsent();
    expect(m.state().unkept?.description).toBe('Lunch at Mez');
    // Typed and not yet handed to a save.
    m.run.type(values('Lunch at Mezze'));
    m.run.keepUnsent();
    expect(m.state().unkept?.description).toBe('Lunch at Mezze');
    release();
    await m.run.finishEditing();
    // The save under way comes back unable to send the rest: the newest typing stays kept.
    expect(m.replaced).toEqual(['Lunch at']);
    expect(m.state().unkept?.description).toBe('Lunch at Mezze');
    m.pause();
    await tick();
    expect(m.replaced).toEqual(['Lunch at']);
  });
});
