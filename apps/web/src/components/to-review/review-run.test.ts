import { describe, expect, it } from 'vitest';
import { closeReviewRun, settleReviewRun, startReviewRun } from './review-run';

describe('web review run', () => {
  it('keeps the chosen order independently of later changes to the selection', () => {
    const ids = ['ready', 'duplicate', 'needs-details'];
    const run = startReviewRun(ids);
    ids.reverse();

    expect(run.ids).toEqual(['ready', 'duplicate', 'needs-details']);
    expect(run.index).toBe(0);
    expect(run.currentId).toBe('ready');
    expect(run.outcomes).toEqual([]);
  });

  it('records a skip and advances without any save dependency', () => {
    const original = startReviewRun(['a', 'b']);
    const next = settleReviewRun(original, [{ id: 'a', status: 'skipped' }], ['a', 'b']);

    expect(next.currentId).toBe('b');
    expect(next.index).toBe(1);
    expect(next.outcomes).toEqual([{ id: 'a', status: 'skipped' }]);
    expect(next.summary).toEqual({ saved: 0, deleted: 0, left: 1, label: '1 left for later' });
    expect(original.currentId).toBe('a');
    expect(original.outcomes).toEqual([]);
  });

  it('advances a confirmed save past an absent upcoming item without claiming it', () => {
    const run = startReviewRun(['a', 'finished-elsewhere', 'c']);
    const next = settleReviewRun(run, [{ id: 'a', status: 'saved' }], ['a', 'c', 'new-item']);

    expect(next.currentId).toBe('c');
    expect(next.index).toBe(2);
    expect(next.ids).toEqual(['a', 'finished-elsewhere', 'c']);
    expect(next.outcomes).toEqual([{ id: 'a', status: 'saved' }]);
    expect(next.summary).toEqual({ saved: 1, deleted: 0, left: 0, label: 'Saved 1' });
  });

  it('closes early counting only the remaining items that still exist', () => {
    const run = settleReviewRun(
      startReviewRun(['saved', 'deleted', 'current', 'absent', 'last']),
      [
        { id: 'saved', status: 'saved' },
        { id: 'deleted', status: 'deleted' },
      ],
      ['current', 'absent', 'last'],
    );
    const closed = closeReviewRun(run, ['current', 'last', 'new-item']);

    expect(closed.currentId).toBeNull();
    expect(closed.outcomes).toEqual([
      { id: 'saved', status: 'saved' },
      { id: 'deleted', status: 'deleted' },
      { id: 'current', status: 'skipped' },
      { id: 'last', status: 'skipped' },
    ]);
    expect(closed.summary).toEqual({
      saved: 1,
      deleted: 1,
      left: 2,
      label: 'Saved 1\u00a0· Deleted 1\u00a0· 2 left for later',
    });
  });

  it.each(['failed', 'unresolved'] as const)(
    'keeps a %s save current without a final outcome',
    (status) => {
      const next = settleReviewRun(startReviewRun(['a', 'b']), [{ id: 'a', status }], ['a', 'b']);

      expect(next.currentId).toBe('a');
      expect(next.outcomes).toEqual([]);
    },
  );

  it.each(['confirmed', 'lost-then-confirmed'] as const)('merges bulk saves once (%s)', (reply) => {
    let run = settleReviewRun(
      startReviewRun(['a', 'b', 'c', 'd']),
      [{ id: 'a', status: 'skipped' }],
      ['a', 'b', 'c', 'd'],
    );
    if (reply === 'lost-then-confirmed') {
      run = settleReviewRun(
        run,
        [
          { id: 'a', status: 'unresolved' },
          { id: 'c', status: 'unresolved' },
        ],
        ['a', 'b', 'c', 'd'],
      );
      expect(run.currentId).toBe('b');
      expect(run.summary.saved).toBe(0);
    }
    const results = [
      { id: 'a', status: 'saved' as const },
      { id: 'c', status: 'saved' as const },
    ];
    run = settleReviewRun(run, results, ['a', 'b', 'c', 'd']);
    run = settleReviewRun(run, results, ['a', 'b', 'c', 'd']);
    expect(run.currentId).toBe('b');
    expect(run.summary.saved).toBe(2);

    // The read may still contain an item already confirmed by bulk Save.
    run = settleReviewRun(run, [{ id: 'b', status: 'deleted' }], ['a', 'b', 'c', 'd']);
    expect(run.currentId).toBe('d');
    const closed = closeReviewRun(run, ['a', 'b', 'c', 'd']);
    expect(closed.summary).toEqual({
      saved: 2,
      deleted: 1,
      left: 1,
      label: 'Saved 2\u00a0· Deleted 1\u00a0· 1 left for later',
    });
    expect(closed.outcomes).toHaveLength(4);
  });

  it('ends after the last present item and does not count unrelated bulk results', () => {
    const run = settleReviewRun(
      startReviewRun(['a', 'absent']),
      [
        { id: 'a', status: 'saved' },
        { id: 'other', status: 'saved' },
      ],
      [],
    );

    expect(run.currentId).toBeNull();
    expect(run.index).toBe(2);
    expect(run.outcomes).toEqual([{ id: 'a', status: 'saved' }]);
    expect(run.summary).toEqual({ saved: 1, deleted: 0, left: 0, label: 'Saved 1' });
    expect(closeReviewRun(run, []).summary).toEqual(run.summary);
  });

  it('has an empty summary when no selected items remain on early close', () => {
    const closed = closeReviewRun(startReviewRun(['absent']), ['new-item']);
    expect(closed.currentId).toBeNull();
    expect(closed.outcomes).toEqual([]);
    expect(closed.summary).toEqual({ saved: 0, deleted: 0, left: 0, label: '' });
  });
});
