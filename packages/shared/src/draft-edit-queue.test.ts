import { describe, expect, it, vi } from 'vitest';
import { draftEditQueue } from './draft-edit-queue';
import type { PersistedExpenseDraft } from './validators/expense-draft';

const draft: PersistedExpenseDraft = {
  id: '000000000000000000000001',
  groupId: '000000000000000000000002',
  revision: 0,
  state: 'active',
  preparedBy: { kind: 'member' },
  changedBy: { kind: 'member' },
  values: { description: 'Before' },
  missingFields: [],
  createdAt: '2026-10-17T00:00:00.000Z',
  updatedAt: '2026-10-17T00:00:00.000Z',
};
function microtask(task: () => void) {
  void Promise.resolve().then(task);
}
function hold<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const kept = (revision: number, description: string): PersistedExpenseDraft => ({
  ...draft,
  revision,
  values: { description },
});
function setup(refreshAfter: 'write' | 'drain' = 'write') {
  const replace = vi.fn(async (before: PersistedExpenseDraft, input: string) =>
    kept(before.revision + 1, input),
  );
  const refresh = vi.fn(async () => {});
  const publish = vi.fn();
  let online = true,
    current = true;
  const queue = draftEditQueue({
    replace,
    refresh,
    kept: publish,
    refreshAfter,
    current: () => current,
    canWrite: () => online,
  });
  return {
    queue,
    replace,
    refresh,
    publish,
    offline: () => {
      online = false;
    },
    online: () => {
      online = true;
    },
    leave: () => {
      current = false;
    },
  };
}

describe('Draft edit ordering through the shared interface', () => {
  it.each(['write', 'drain'] as const)(
    'coalesces typing and threads revisions (%s refresh)',
    async (mode) => {
      const f = setup(mode),
        first = hold<PersistedExpenseDraft>();
      f.replace.mockImplementationOnce(() => first.promise);
      f.queue.change('First');
      const writing = f.queue.flush(draft);
      await Promise.resolve();
      f.queue.change('Middle');
      f.queue.change('Latest');
      expect(f.queue.flush(draft)).toBe(writing);
      first.resolve(kept(1, 'First'));
      expect(await writing).toEqual({ kind: 'kept', draft: kept(2, 'Latest') });
      expect(f.replace.mock.calls.map(([before, text]) => [before.revision, text])).toEqual([
        [0, 'First'],
        [1, 'Latest'],
      ]);
      expect(f.refresh).toHaveBeenCalledTimes(mode === 'write' ? 2 : 1);
      expect(f.queue.pending).toBe(false);
      expect(f.queue.writing).toBe(false);
    },
  );
  it('does not mistake a polled own-write revision for an external edit', async () => {
    const f = setup(),
      reply = hold<PersistedExpenseDraft>();
    f.replace.mockImplementationOnce(() => reply.promise);
    f.queue.change('Submitted');
    const writing = f.queue.flush(draft);
    await Promise.resolve();
    f.queue.change('New typing');
    expect(f.queue.receive(kept(1, 'Submitted'))).toBe(true);
    reply.resolve(kept(1, 'Submitted'));
    expect(await writing).toEqual({ kind: 'kept', draft: kept(2, 'New typing') });
  });
  it('returns the highest external revision without sending older typing over it', async () => {
    const f = setup(),
      reply = hold<PersistedExpenseDraft>();
    f.replace.mockImplementationOnce(() => reply.promise);
    f.queue.change('Submitted');
    const writing = f.queue.flush(draft);
    await Promise.resolve();
    f.queue.change('Unsent');
    f.queue.receive(kept(3, 'Newest elsewhere'));
    f.queue.receive(kept(2, 'Earlier elsewhere'));
    reply.resolve(kept(1, 'Submitted'));
    expect(await writing).toEqual({
      kind: 'changed',
      before: kept(1, 'Submitted'),
      draft: kept(3, 'Newest elsewhere'),
    });
    expect(f.replace).toHaveBeenCalledTimes(1);
    expect(f.queue.pending).toBe(false);
  });
  it.each(['write', 'drain'] as const)(
    'keeps typing entered while the post-write read is held (%s)',
    async (mode) => {
      const f = setup(mode),
        read = hold<void>();
      f.refresh.mockImplementationOnce(() => read.promise);
      f.queue.change('First');
      const writing = f.queue.flush(draft);
      await vi.waitFor(() => expect(f.refresh).toHaveBeenCalledOnce());
      f.queue.change('During read');
      read.resolve();
      expect(await writing).toEqual({ kind: 'kept', draft: kept(2, 'During read') });
    },
  );
  it('returns an external revision delivered by the post-write read', async () => {
    const f = setup();
    f.refresh.mockImplementationOnce(async () => {
      f.queue.receive(kept(2, 'Elsewhere'));
    });
    f.queue.change('Mine');
    expect(await f.queue.flush(draft)).toEqual({
      kind: 'changed',
      before: kept(1, 'Mine'),
      draft: kept(2, 'Elsewhere'),
    });
  });
  it.each(['write', 'drain'] as const)(
    'settles an external revision arriving after the drain returns (%s)',
    async (mode) => {
      const f = setup(mode);
      f.refresh.mockImplementationOnce(async () => {
        microtask(() =>
          microtask(() => {
            expect(f.queue.receive(kept(99, 'Elsewhere'))).toBe(true);
          }),
        );
      });
      f.queue.change('Mine');
      expect(await f.queue.flush(draft)).toEqual({
        kind: 'changed',
        before: kept(1, 'Mine'),
        draft: kept(99, 'Elsewhere'),
      });
    },
  );
  it.each(['write', 'drain'] as const)(
    'drains typing arriving as the previous burst settles (%s)',
    async (mode) => {
      const f = setup(mode);
      f.refresh.mockImplementationOnce(async () => {
        microtask(() => microtask(() => f.queue.change('Late typing')));
      });
      f.queue.change('Mine');
      expect(await f.queue.flush(draft)).toEqual({ kind: 'kept', draft: kept(2, 'Late typing') });
      expect(f.queue.pending).toBe(false);
    },
  );
  it('retains interrupted typing without sending on reconnect', async () => {
    const f = setup('drain'),
      reply = hold<PersistedExpenseDraft>();
    f.replace.mockImplementationOnce(() => reply.promise);
    f.queue.change('First');
    const writing = f.queue.flush(draft);
    await Promise.resolve();
    f.queue.change('Offline correction');
    f.offline();
    reply.resolve(kept(1, 'First'));
    expect(await writing).toEqual({
      kind: 'interrupted',
      draft: kept(1, 'First'),
      input: 'Offline correction',
    });
    f.online();
    await Promise.resolve();
    expect(f.replace).toHaveBeenCalledTimes(1);
    expect(await f.queue.flush(kept(1, 'First'))).toEqual({
      kind: 'kept',
      draft: kept(2, 'Offline correction'),
    });
  });
  it('leaves conflict recovery to the caller and never retries by itself', async () => {
    const f = setup(),
      cause = Object.assign(new Error('Changed elsewhere'), { status: 409 });
    f.replace.mockRejectedValueOnce(cause);
    f.queue.change('My correction');
    expect(await f.queue.flush(draft)).toEqual({
      kind: 'failed',
      draft,
      input: 'My correction',
      cause,
    });
    expect(f.replace).toHaveBeenCalledTimes(1);
    f.queue.clear();
    expect(f.queue.receive(kept(2, 'Elsewhere'))).toBe(false);
    expect(await f.queue.flush(kept(2, 'Elsewhere'))).toEqual({
      kind: 'kept',
      draft: kept(2, 'Elsewhere'),
    });
    expect(f.replace).toHaveBeenCalledTimes(1);
  });
  it('shares conflict recovery with overlapping flushes and never sends typing during recovery', async () => {
    const read = hold<PersistedExpenseDraft>();
    const cause = Object.assign(new Error('Changed elsewhere'), { status: 409 });
    const replace = vi.fn(async () => {
      throw cause;
    });
    const recover = vi.fn(async () => {
      const latest = await read.promise;
      queue.clear();
      return latest;
    });
    const queue = draftEditQueue<string>({
      current: () => true,
      canWrite: () => true,
      replace,
      kept: vi.fn(),
      refresh: async () => {},
      refreshAfter: 'write',
      recover,
    });
    queue.change('First');
    const writing = queue.flush(draft);
    await vi.waitFor(() => expect(recover).toHaveBeenCalledOnce());
    queue.change('Typing during recovery');
    expect(queue.writing).toBe(true);
    expect(queue.flush(draft)).toBe(writing);
    expect(replace).toHaveBeenCalledOnce();
    read.resolve(kept(3, 'Elsewhere'));
    expect(await writing).toEqual({
      kind: 'failed',
      draft: kept(3, 'Elsewhere'),
      input: 'First',
      cause,
    });
    expect(recover).toHaveBeenCalledOnce();
    expect(queue.pending).toBe(false);
    expect(queue.writing).toBe(false);
  });
  it('settles newer reads delivered while client-owned conflict recovery refreshes', async () => {
    const recover = vi.fn(async () => {
      queue.clear();
      microtask(() => microtask(() => queue.receive(kept(4, 'Newer elsewhere'))));
      return kept(3, 'Recovered');
    });
    const queue = draftEditQueue<string>({
      current: () => true,
      canWrite: () => true,
      replace: async () => {
        throw new Error('Conflict');
      },
      kept: vi.fn(),
      refresh: async () => {},
      refreshAfter: 'write',
      recover,
    });
    queue.change('Mine');
    expect(await queue.flush(draft)).toEqual({
      kind: 'changed',
      before: kept(3, 'Recovered'),
      draft: kept(4, 'Newer elsewhere'),
    });
  });
  it('releases a failed recovery without replaying the correction', async () => {
    const cause = new Error('Recovery unavailable');
    const replace = vi.fn(async () => {
      throw new Error('Conflict');
    });
    const queue = draftEditQueue<string>({
      current: () => true,
      canWrite: () => true,
      replace,
      kept: vi.fn(),
      refresh: async () => {},
      refreshAfter: 'write',
      recover: async () => {
        throw cause;
      },
    });
    queue.change('Mine');
    expect(await queue.flush(draft)).toEqual({ kind: 'failed', draft, input: 'Mine', cause });
    expect(queue.writing).toBe(false);
    expect(queue.pending).toBe(true);
    expect(replace).toHaveBeenCalledOnce();
  });
  it('does not re-send a kept edit when only its refresh failed', async () => {
    const f = setup();
    f.refresh.mockRejectedValueOnce(new Error('Read unavailable'));
    f.queue.change('Kept');
    expect((await f.queue.flush(draft)).kind).toBe('failed');
    expect(f.queue.pending).toBe(false);
    expect(await f.queue.flush(kept(1, 'Kept'))).toEqual({ kind: 'kept', draft: kept(1, 'Kept') });
    expect(f.replace).toHaveBeenCalledOnce();
  });
  it('can discard an edit before its explicit flush begins sending', async () => {
    const f = setup();
    f.queue.change('Discarded');
    const writing = f.queue.flush(draft);
    f.queue.clear();
    expect(await writing).toEqual({ kind: 'kept', draft });
    expect(f.replace).not.toHaveBeenCalled();
  });
  it('does not publish or send newer typing after the account becomes obsolete', async () => {
    const f = setup(),
      reply = hold<PersistedExpenseDraft>();
    f.replace.mockImplementationOnce(() => reply.promise);
    f.queue.change('First');
    const writing = f.queue.flush(draft);
    await Promise.resolve();
    f.queue.change('Later');
    f.leave();
    reply.resolve(kept(1, 'First'));
    expect((await writing).kind).toBe('interrupted');
    expect(f.publish).not.toHaveBeenCalled();
    expect(f.replace).toHaveBeenCalledTimes(1);
  });
});
