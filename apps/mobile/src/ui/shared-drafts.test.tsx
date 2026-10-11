import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it } from 'vitest';
import { QueryClient, focusManager, onlineManager } from '@tanstack/query-core';
import { emptySharedDraftCollection, sharedDraftCollection } from '../data/shared-draft-collection';
import { SharedDrafts } from './shared-drafts';
import { draftCollectionClient } from '@splitbook/shared/draft-collection-client';
import type { MobileGroup } from '../data/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it.each([false, true])(
  'renders per-item outcomes, including explicit retry after a lost save reply (%s)',
  async (loseReply) => {
    const id = 'a00000000000000000000001';
    const group: MobileGroup = {
      id: 'c00000000000000000000001',
      name: 'Home',
      description: '',
      defaultCurrency: 'INR',
      category: 'home',
      members: [
        {
          user: { id, name: 'Alex', email: 'alex@example.test', image: null },
          role: 'admin',
          joinedAt: new Date(),
        },
      ],
      startDate: null,
      endDate: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const rows = [
      {
        id: 'd00000000000000000000001',
        groupId: group.id,
        revision: 0,
        state: 'active',
        missingFields: ['currency', 'date'],
        values: { description: 'Dinner', amount: 100 },
        createdAt: '2026-10-11T00:00:00.000Z',
        updatedAt: '2026-10-11T00:00:00.000Z',
      },
      {
        id: 'd00000000000000000000002',
        groupId: group.id,
        revision: 0,
        state: 'active',
        missingFields: ['currency', 'date'],
        values: {},
        createdAt: '2026-10-11T00:00:00.000Z',
        updatedAt: '2026-10-11T00:00:00.000Z',
      },
    ];
    let stored: string | null = null;
    let saved = false;
    let denied = false;
    const calls: string[] = [];
    const client = draftCollectionClient(
      group.id,
      async (path, init) => {
        calls.push(path);
        if (denied) throw Object.assign(new Error('Group access denied'), { status: 403 });
        if (init?.method === 'PUT')
          throw Object.assign(new Error('Stale revision'), { status: 409 });
        if (path.endsWith('/review'))
          return {
            data: rows.map((row) => ({
              draft: row,
              review: 'a'.repeat(64),
              problems: row.values.description ? [] : ['description: Required'],
              duplicates: [],
            })),
          };
        if (path.endsWith('/save')) {
          expect(JSON.parse(init!.body!).drafts).toHaveLength(2);
          saved = true;
          if (loseReply && calls.filter((path) => path.endsWith('/save')).length === 1)
            throw new Error('Lost reply');
          return {
            data: [
              { id: rows[0].id, status: 'saved', expenseId: id },
              { id: rows[1].id, status: 'failed', message: 'Description required' },
            ],
          };
        }
        return { data: saved ? [rows[1]] : rows };
      },
      {
        load: async () => stored,
        save: async (value) => {
          stored = value;
        },
        clear: async () => {
          stored = null;
        },
      },
      () => 'synthetic-request',
    );
    const queryClient = new QueryClient();
    queryClient.mount();
    let snapshot = { sharedDraftCollection: emptySharedDraftCollection() };
    const listeners = new Set<() => void>();
    const commands = sharedDraftCollection({
      client: { ...client, context: async () => ({ group, tags: [] }) },
      queryClient,
      groupId: group.id,
      environment: 'http://localhost:3000',
      accountId: id,
      current: () => true,
      read: () => snapshot.sharedDraftCollection,
      publish: (value) => {
        snapshot = { sharedDraftCollection: value };
        listeners.forEach((listener) => listener());
      },
    });
    const controller = {
      draftCollection: () => commands,
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    let tree!: ReactTestRenderer;
    // Only this narrow controller interface is needed by the collection screen.
    await act(async () => {
      tree = create(
        <SharedDrafts controller={controller} group={group} accountId={id} onClose={() => {}} />,
      );
    });
    const buttons = (label: string) =>
      tree.root.findAll(
        (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label,
      );
    try {
      expect(JSON.stringify(tree.toJSON())).toContain('Description missing');
      await act(async () => {
        commands.edit(snapshot.sharedDraftCollection.rows[0]);
        commands.enter('description', 'My unsent correction');
        await commands.keep();
      });
      expect(snapshot.sharedDraftCollection.entries.description).toBe('My unsent correction');
      expect(snapshot.sharedDraftCollection.message).toContain('Stale revision');
      await act(async () => commands.closeEditor());
      for (let index = 0; index < 2; index++)
        await act(async () => {
          buttons('Select Draft')[0].props.onPress();
        });
      await act(async () => {
        buttons('Review selected Drafts')[0].props.onPress();
      });
      expect(JSON.stringify(tree.toJSON())).toContain('description: Required');
      await act(async () => {
        buttons('Save reviewed Drafts')[0].props.onPress();
      });
      if (loseReply) {
        expect(JSON.stringify(tree.toJSON())).toContain('Retry original request');
        await act(async () => {
          focusManager.setFocused(false);
          onlineManager.setOnline(false);
          focusManager.setFocused(true);
          onlineManager.setOnline(true);
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
        expect(calls.filter((path) => path.endsWith('/save'))).toHaveLength(1);
        expect(stored).not.toBeNull();
        await act(async () => {
          buttons('Retry original request')[0].props.onPress();
        });
      }
      expect(JSON.stringify(tree.toJSON())).toContain('Expense saved');
      expect(JSON.stringify(tree.toJSON())).toContain('Description required');
      expect(calls.filter((path) => path.endsWith('/save'))).toHaveLength(loseReply ? 2 : 1);
      await act(async () => {
        commands.newDraft();
        commands.enter('description', 'Private unsent text');
        denied = true;
        await commands.refresh();
      });
      expect(snapshot.sharedDraftCollection.entries).toEqual({});
      expect(snapshot.sharedDraftCollection.rows).toEqual([]);
      expect(snapshot.sharedDraftCollection.reviews).toEqual([]);
      expect(JSON.stringify(tree.toJSON())).not.toContain('Private unsent text');
    } finally {
      await act(async () => tree.unmount());
      queryClient.clear();
      queryClient.unmount();
      focusManager.setFocused(undefined);
    }
  },
);
