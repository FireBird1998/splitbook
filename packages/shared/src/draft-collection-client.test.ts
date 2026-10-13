import { describe, expect, it, vi } from 'vitest';
import { draftCollectionClient } from './draft-collection-client';
import type { DraftReview } from './validators/expense-draft';

const groupId = '000000000000000000000001';
const draft = {
  id: '000000000000000000000002',
  groupId,
  preparedBy: { kind: 'member' as const },
  changedBy: { kind: 'member' as const },
  revision: 0,
  state: 'active' as const,
  values: { amount: 450 },
  missingFields: ['description'],
  createdAt: '2026-10-11T00:00:00.000Z',
  updatedAt: '2026-10-11T00:00:00.000Z',
};
const review: DraftReview = { draft, review: 'a'.repeat(64), problems: [], duplicates: [] };
const saved = { id: draft.id, status: 'saved', expenseId: '000000000000000000000003' };

describe('explicit Draft request recovery', () => {
  function setup() {
    let stored: string | null = null;
    let fails = true;
    const sent: unknown[] = [];
    const store = {
      load: async () => stored,
      save: async (value: string) => {
        stored = value;
      },
      clear: async () => {
        stored = null;
      },
    };
    const request = async (path: string, options?: unknown) => {
      sent.push([path, options]);
      if (fails) throw new Error('Lost response');
      return { data: [draft] };
    };
    const client = () => draftCollectionClient(groupId, request, store, () => 'stable-request-key');
    return {
      client,
      sent,
      store,
      restoreNetwork: () => {
        fails = false;
      },
    };
  }
  it('retains the original payload and key across reopening and sends nothing on reconnect', async () => {
    const fixture = setup();
    await expect(fixture.client().create({ amount: 450 })).rejects.toThrow('Lost response');
    expect(fixture.sent).toHaveLength(1);
    fixture.restoreNetwork();
    const reopened = fixture.client();
    expect(await reopened.pending()).toBeTruthy();
    expect(fixture.sent).toHaveLength(1);
    await expect(reopened.create({ amount: 999 })).rejects.toThrow('Resolve the previous');
    expect(await reopened.retry()).toEqual({ kind: 'create', drafts: [draft] });
    expect(fixture.sent[1]).toEqual(fixture.sent[0]);
    expect(await reopened.pending()).toBeNull();
  });
  it('does not clear a successful upload receipt before local recovery is safely handed off', async () => {
    const fixture = setup();
    let cleanupFails = true;
    const client = draftCollectionClient(
      groupId,
      async () => ({ data: [draft] }),
      fixture.store,
      () => 'request-handoff',
      async (source) => {
        expect(source).toBe('original local draft');
        if (cleanupFails) throw new Error('Storage failed');
      },
    );
    await expect(client.create({ amount: 450 }, 'original local draft')).rejects.toThrow(
      'Storage failed',
    );
    expect(await client.pending()).toBeTruthy();
    cleanupFails = false;
    await client.retry();
    expect(await client.pending()).toBeNull();
  });
  it('keeps the original identity when a retry is refused after an earlier lost response', async () => {
    const fixture = setup();
    await expect(fixture.client().create({ amount: 450 })).rejects.toThrow();
    const original = await fixture.store.load();
    const reopened = draftCollectionClient(
      groupId,
      async () => {
        throw Object.assign(new Error('Sign in again'), { status: 401 });
      },
      fixture.store,
      () => 'new-key',
    );
    await expect(reopened.retry()).rejects.toThrow('Sign in again');
    expect(await fixture.store.load()).toBe(original);
  });
  it('returns confirmed per-item outcomes after explicitly retrying an unresolved selection', async () => {
    const fixture = setup();
    let resolved = false;
    const client = draftCollectionClient(
      groupId,
      async () => ({
        data: [
          resolved
            ? saved
            : { id: draft.id, status: 'unresolved', message: 'Retry original request' },
        ],
      }),
      fixture.store,
      () => 'key',
    );
    await client.save([review], []);
    expect(await client.pending()).toBeTruthy();
    resolved = true;
    expect(await client.retry()).toEqual({ kind: 'save', outcomes: [saved] });
    expect(await client.pending()).toBeNull();
  });
  it.each([
    {},
    { data: [] },
    { data: [{ id: draft.id }] },
    { data: [{ ...draft, groupId: '000000000000000000000009' }] },
    { data: [{ ...draft, values: undefined }] },
  ])('retains upload identity and local recovery on malformed acknowledgment %j', async (reply) => {
    const fixture = setup();
    const onCreated = vi.fn();
    const client = draftCollectionClient(
      groupId,
      async () => reply,
      fixture.store,
      () => 'request-malformed',
      onCreated,
    );
    await expect(client.create({ amount: 450 }, 'local recovery')).rejects.toThrow('not confirmed');
    expect(await client.pending()).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
  });
  it.each([
    { data: [] },
    { data: [{ id: draft.id, status: 'saved' }] },
    { data: [{ ...saved, id: '000000000000000000000009' }] },
    { data: [saved, saved] },
  ])(
    'retains the reviewed command when save outcomes are incomplete or mismatched %j',
    async (reply) => {
      const fixture = setup();
      const client = draftCollectionClient(
        groupId,
        async () => reply,
        fixture.store,
        () => 'key',
      );
      await expect(client.save([review], [])).rejects.toThrow('not confirmed');
      expect(await client.pending()).toBeTruthy();
    },
  );
});
