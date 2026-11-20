import { describe, expect, it } from 'vitest';
import type {
  DraftReview,
  ExpenseDraftValues,
  PersistedExpenseDraft,
} from '@splitbook/shared/validators/expense-draft';
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
  let server = draft(0, 'Lunch');
  const replaced: string[] = [];
  let holding: { reached: () => void; gate: Promise<void> } | null = null;
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
      replaced.push(String(next.description));
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
    online: () => true,
    client: () => client as never,
    refresh: async () => undefined,
  });
  return {
    run,
    published,
    replaced,
    state: () => state,
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
});
