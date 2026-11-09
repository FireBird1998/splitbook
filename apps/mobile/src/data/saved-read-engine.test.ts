import { describe, expect, it } from 'vitest';
import { savedQueriesIn } from '../test-utils/saved-queries';
import { createSavedCopyQueue } from './saved-read-engine';

describe('the saved-copy queue', () => {
  it('keeps the latest queued wire row per query', async () => {
    const rows = savedQueriesIn(new Map());
    const queue = createSavedCopyQueue();
    queue.push('/api/groups', () =>
      rows.save('account', '/api/groups', { time: 10, value: 'old' }),
    );
    queue.push('/api/groups', () =>
      rows.save('account', '/api/groups', { time: 20, value: 'new' }),
    );
    await queue.idle();
    expect(await rows.load('account', '/api/groups')).toEqual({ time: 20, value: 'new' });
  });
});

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

it('replaces a queued row behind a slow write without waiting for the discarded write', async () => {
  const rows = savedQueriesIn(new Map());
  const queue = createSavedCopyQueue();
  const started = deferred(),
    slow = deferred(),
    discarded = deferred();
  queue.push('/api/slow', async () => {
    started.resolve();
    await slow.promise;
    await rows.save('account', '/api/slow', { time: 10 });
  });
  await started.promise;
  queue.push('/api/groups', async () => {
    await discarded.promise;
    await rows.save('account', '/api/groups', { time: 20 });
  });
  queue.push('/api/groups', () => rows.save('account', '/api/groups', { time: 30 }));
  slow.resolve();
  try {
    await queue.idle();
    expect(await rows.load('account', '/api/groups')).toEqual({ time: 30 });
    expect(await rows.load('account', '/api/slow')).toEqual({ time: 10 });
  } finally {
    discarded.resolve();
  }
});

it('cancels waiting copies while allowing the running write to finish', async () => {
  const rows = savedQueriesIn(new Map());
  const queue = createSavedCopyQueue();
  const started = deferred(),
    slow = deferred();
  queue.push('/api/running', async () => {
    started.resolve();
    await slow.promise;
    await rows.save('account', '/api/running', { time: 10 });
  });
  await started.promise;
  queue.push('/api/groups', () => rows.save('account', '/api/groups', { time: 20 }));
  queue.cancel();
  slow.resolve();
  await queue.idle();
  expect(await rows.load('account', '/api/running')).toEqual({ time: 10 });
  expect(await rows.load('account', '/api/groups')).toBeNull();
});

it('drops just the named queued row and continues after a storage failure', async () => {
  const rows = savedQueriesIn(new Map());
  const queue = createSavedCopyQueue();
  queue.push('/api/failure', async () => {
    throw new Error('device unavailable');
  });
  queue.push('/api/drop', () => rows.save('account', '/api/drop', { time: 10 }));
  queue.push('/api/keep', () => rows.save('account', '/api/keep', { time: 20 }));
  queue.drop('/api/drop');
  await queue.idle();
  expect(await rows.load('account', '/api/drop')).toBeNull();
  expect(await rows.load('account', '/api/keep')).toEqual({ time: 20 });
});
