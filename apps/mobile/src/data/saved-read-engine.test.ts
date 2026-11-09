import { describe, expect, it } from 'vitest';
import { savedQueriesIn } from '../test-utils/saved-queries';
import { createSavedCopyQueue } from './saved-read-engine';

describe('the saved-copy queue', () => {
  it('keeps the latest queued wire row per query', async () => {
    const rows = savedQueriesIn(new Map());
    const queue = createSavedCopyQueue();
    queue.push('/api/groups', () => rows.save('account', '/api/groups', { time: 10, value: 'old' }));
    queue.push('/api/groups', () => rows.save('account', '/api/groups', { time: 20, value: 'new' }));
    await queue.idle();
    expect(await rows.load('account', '/api/groups')).toEqual({ time: 20, value: 'new' });
  });
});
