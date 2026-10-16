import { afterEach, describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/query-core';
import { draftCollectionClient } from '@splitbook/shared/draft-collection-client';
import type { PersistedExpenseDraft } from '@splitbook/shared/validators/expense-draft';
import { emptySharedDraftCollection, sharedDraftCollection } from './shared-draft-collection';
import type { MobileGroup } from './types';

const accountId = 'a00000000000000000000001';
const group: MobileGroup = {
  id: 'c00000000000000000000001',
  name: 'Home',
  description: '',
  defaultCurrency: 'INR',
  category: 'home',
  members: [
    {
      user: { id: accountId, name: 'Alex', email: 'alex@example.test', image: null },
      role: 'admin',
      joinedAt: new Date(),
    },
  ],
  startDate: null,
  endDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const draft = (index: number): PersistedExpenseDraft =>
  ({
    id: `d${String(index).padStart(23, '0')}`,
    groupId: group.id,
    revision: 0,
    state: 'active',
    missingFields: ['amount'],
    values: { description: `Item ${index}` },
    createdAt: '2026-10-16T00:00:00.000Z',
    updatedAt: '2026-10-16T00:00:00.000Z',
  }) as PersistedExpenseDraft;

const clients: QueryClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) {
    client.clear();
    client.unmount();
  }
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/** One Group's collection over a fictional server whose items can be saved or deleted elsewhere. */
async function collection() {
  let rows = [draft(1), draft(2)];
  const client = draftCollectionClient(
    group.id,
    async (path, init) => {
      const id = path.split('/').at(-1);
      if (init?.method === 'PUT' || init?.method === 'DELETE') {
        const row = rows.find((entry) => entry.id === id);
        if (!row) throw Object.assign(new Error('DRAFT_NOT_FOUND'), { status: 404 });
        if (init.method === 'DELETE') {
          rows = rows.filter((entry) => entry.id !== id);
          return { data: { id } };
        }
        const kept = { ...row, revision: row.revision + 1, values: JSON.parse(init.body!).values };
        rows = rows.map((entry) => (entry.id === id ? kept : entry));
        return { data: kept };
      }
      return { data: rows };
    },
    { load: async () => null, save: async () => {}, clear: async () => {} },
    () => 'fictional-request',
  );
  const queryClient = new QueryClient();
  queryClient.mount();
  clients.push(queryClient);
  let state = emptySharedDraftCollection();
  const commands = sharedDraftCollection({
    client: { ...client, context: async () => ({ group, tags: [] }) },
    queryClient,
    groupId: group.id,
    environment: 'http://localhost:4436',
    accountId,
    current: () => true,
    read: () => state,
    publish: (value) => {
      state = value;
    },
  });
  commands.open();
  await settle();
  return {
    commands,
    state: () => state,
    /** The item is saved or deleted on another screen or device. */
    removeElsewhere: (id: string) => {
      rows = rows.filter((row) => row.id !== id);
    },
  };
}

describe("an open item's editor when the item is saved or deleted (#436)", () => {
  it('closes when a read no longer lists the item', async () => {
    const c = await collection();
    c.commands.edit(c.state().rows[0]);
    expect(c.state().editing).toMatchObject({ id: draft(1).id });
    c.removeElsewhere(draft(1).id);
    await c.commands.refresh();
    expect(c.state()).toMatchObject({ editing: null, message: '' });
  });

  it('says changes were not kept when it closes over unsent changes', async () => {
    const c = await collection();
    c.commands.edit(c.state().rows[0]);
    c.commands.enter('description', 'Dinner at the station');
    c.removeElsewhere(draft(1).id);
    await c.commands.refresh();
    expect(c.state()).toMatchObject({
      editing: null,
      message: 'This item was saved or deleted, so your changes weren’t kept.',
    });
  });

  it('closes when the item is deleted from its editor', async () => {
    const c = await collection();
    c.commands.edit(c.state().rows[0]);
    await c.commands.discard(c.state().rows[0]);
    expect(c.state().editing).toBeNull();
    expect(c.state().rows.map((row) => row.id)).toEqual([draft(2).id]);
  });

  it('closes and says so when Keep changes for later finds the item gone', async () => {
    const c = await collection();
    c.commands.edit(c.state().rows[0]);
    c.commands.enter('description', 'Dinner at the station');
    c.removeElsewhere(draft(1).id);
    await c.commands.keep();
    expect(c.state()).toMatchObject({
      editing: null,
      busy: false,
      message: 'This item was saved or deleted, so your changes weren’t kept.',
    });
  });

  it('keeps a new item’s editor and another item’s editor open', async () => {
    const c = await collection();
    c.commands.edit(c.state().rows[1]);
    c.removeElsewhere(draft(1).id);
    await c.commands.refresh();
    expect(c.state().editing).toMatchObject({ id: draft(2).id });
    c.commands.closeEditor();
    c.commands.newDraft();
    await c.commands.refresh();
    expect(c.state().editing).toBe('new');
  });
});
