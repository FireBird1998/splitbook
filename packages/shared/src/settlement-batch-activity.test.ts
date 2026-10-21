import { describe, expect, it } from 'vitest';
import { groupSettlementBatches } from './settlement-batch-activity';

const event = (_id: string, metadata: Record<string, unknown> = {}) => ({
  _id,
  type: 'settlement_recorded',
  metadata,
});
// Settlement ids are made in the request's order, so f1 was recorded before f2.
const a1 = event('a1', { batchId: 'batch-a', batchSize: 2, settlementId: 'f1' });
const a2 = event('a2', { batchId: 'batch-a', batchSize: 2, settlementId: 'f2' });
const b1 = event('b1', { batchId: 'batch-b', batchSize: 2, settlementId: 'f3' });
const b2 = event('b2', { batchId: 'batch-b', batchSize: 2, settlementId: 'f4' });
const first = event('first');
const middle = { ...event('middle'), type: 'expense_added' };
const last = event('last');

describe('groupSettlementBatches (#734)', () => {
  it('keeps single events in their given order without changing the input', () => {
    const events = Object.freeze([last, first, middle]);
    expect(groupSettlementBatches(events)).toEqual([
      { kind: 'event', event: last, complete: true },
      { kind: 'event', event: first, complete: true },
      { kind: 'event', event: middle, complete: true },
    ]);
    expect(events).toEqual([last, first, middle]);
    expect(groupSettlementBatches([])).toEqual([]);
  });

  it('collects non-adjacent batches at their first event, each in the order it was recorded', () => {
    expect(groupSettlementBatches([first, a2, b1, middle, a1, b2, last])).toEqual([
      { kind: 'event', event: first, complete: true },
      { kind: 'batch', batchId: 'batch-a', batchSize: 2, events: [a1, a2], complete: true },
      { kind: 'batch', batchId: 'batch-b', batchSize: 2, events: [b1, b2], complete: true },
      { kind: 'event', event: middle, complete: true },
      { kind: 'event', event: last, complete: true },
    ]);
  });

  // A newer event shifts the pages, so one event can arrive on both: it counts once.
  it('counts an event repeated across shifted pages once, so its batch completes', () => {
    const pageOne = [first, a1, middle];
    const pageTwo = [middle, a2, last];
    expect(groupSettlementBatches([...pageOne, ...pageTwo])).toEqual([
      { kind: 'event', event: first, complete: true },
      { kind: 'batch', batchId: 'batch-a', batchSize: 2, events: [a1, a2], complete: true },
      { kind: 'event', event: middle, complete: true },
      { kind: 'event', event: last, complete: true },
    ]);
    expect(groupSettlementBatches([a2, a1, a1])).toEqual([
      { kind: 'batch', batchId: 'batch-a', batchSize: 2, events: [a1, a2], complete: true },
    ]);
  });

  // The feed is newest first and a batch's events share one time, so they arrive in reverse; the
  // row names its Debts as they were recorded ("₹1,480.00 and €20.00", not the reverse).
  it('gives a batch newest first in the order its Settlements were recorded', () => {
    const [batch] = groupSettlementBatches([a2, a1]);
    expect(batch).toEqual({
      kind: 'batch',
      batchId: 'batch-a',
      batchSize: 2,
      events: [a1, a2],
      complete: true,
    });
  });

  it('keeps a batch event without a settlementId after the recorded ones, in feed order', () => {
    const x = event('x', { batchId: 'batch-a', batchSize: 4 });
    const y = event('y', { batchId: 'batch-a', batchSize: 4 });
    expect(groupSettlementBatches([x, a2, y, a1])).toEqual([
      { kind: 'batch', batchId: 'batch-a', batchSize: 4, events: [a1, a2, x, y], complete: true },
    ]);
  });

  it('marks a page-split batch incomplete', () => {
    expect(groupSettlementBatches([a1, middle])).toEqual([
      { kind: 'batch', batchId: 'batch-a', batchSize: 2, events: [a1], complete: false },
      { kind: 'event', event: middle, complete: true },
    ]);
  });

  it('joins concatenated pages exactly as a complete page without changing an earlier result', () => {
    const pageOne = [first, a1, middle];
    const pageTwo = [a2, last];
    const partial = groupSettlementBatches(pageOne);
    const expected = [
      { kind: 'event', event: first, complete: true },
      { kind: 'batch', batchId: 'batch-a', batchSize: 2, events: [a1, a2], complete: true },
      { kind: 'event', event: middle, complete: true },
      { kind: 'event', event: last, complete: true },
    ];
    expect(groupSettlementBatches([...pageOne, ...pageTwo])).toEqual(expected);
    expect(groupSettlementBatches([first, a1, middle, a2, last])).toEqual(expected);
    expect(partial[1]).toEqual({
      kind: 'batch',
      batchId: 'batch-a',
      batchSize: 2,
      events: [a1],
      complete: false,
    });
  });

  it('leaves one-row batches and partial references as single events', () => {
    const one = event('one', { batchId: 'one', batchSize: 1 });
    const noSize = event('no-size', { batchId: 'batch-a' });
    const noId = event('no-id', { batchSize: 2 });
    const noMetadata = { _id: 'no-metadata', type: 'settlement_recorded' };
    const nullMetadata = { _id: 'null-metadata', type: 'settlement_recorded', metadata: null };
    expect(groupSettlementBatches([one, noSize, noId, noMetadata, nullMetadata])).toEqual([
      { kind: 'event', event: one, complete: true },
      { kind: 'event', event: noSize, complete: true },
      { kind: 'event', event: noId, complete: true },
      { kind: 'event', event: noMetadata, complete: true },
      { kind: 'event', event: nullMetadata, complete: true },
    ]);
  });

  it('does not collect a non-Settlement event that happens to carry a batch reference', () => {
    const expense = { ...a1, type: 'expense_added' };
    expect(groupSettlementBatches([expense, a2])).toEqual([
      { kind: 'event', event: expense, complete: true },
      { kind: 'batch', batchId: 'batch-a', batchSize: 2, events: [a2], complete: false },
    ]);
  });
});
