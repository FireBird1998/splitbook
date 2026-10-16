import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { expect, it } from 'vitest';
import { QueryClient } from '@tanstack/query-core';
import {
  draftGoneMessage,
  emptySharedDraftCollection,
  sharedDraftCollection,
} from '../data/shared-draft-collection';
import { SharedDraftEditor } from './shared-drafts';
import { useEffect, useSyncExternalStore } from 'react';
import { draftCollectionClient } from '@splitbook/shared/draft-collection-client';
import type { MobileGroup } from '../data/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it.each([
  { initial: { tag: 'Food' }, displayed: 'Food', selection: 'Not specified', expected: {} },
  {
    initial: { tagId: 'e00000000000000000000001', tag: 'Old name' },
    displayed: 'Food',
    selection: 'Travel',
    expected: { tagId: 'e00000000000000000000002' },
  },
  {
    initial: { tagId: 'e00000000000000000000003' },
    displayed: 'Unavailable Tag (e00000000000000000000003)',
    selection: 'Not specified',
    expected: {},
  },
  {
    initial: { tag: 'Food' },
    displayed: 'Food',
    selection: 'Travel',
    expected: { tagId: 'e00000000000000000000002' },
  },
  {
    initial: { tag: 'Old Label' },
    displayed: 'Old Label (unavailable)',
    selection: 'Not specified',
    expected: {},
  },
])('shows and replaces the supplied Tag ($displayed → $selection)', async (scenario) => {
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
  let row = {
    id: 'd00000000000000000000001',
    groupId: group.id,
    revision: 0,
    state: 'active',
    missingFields: ['currency', 'date'],
    values: { description: 'Dinner', ...scenario.initial },
    createdAt: '2026-10-11T00:00:00.000Z',
    updatedAt: '2026-10-11T00:00:00.000Z',
  };
  let submitted: unknown;
  const client = draftCollectionClient(
    group.id,
    async (_path, init) => {
      if (init?.method === 'PUT') {
        submitted = JSON.parse(init.body!).values;
        row = { ...row, revision: row.revision + 1, values: JSON.parse(init.body!).values };
        return { data: row };
      }
      return { data: [row] };
    },
    { load: async () => null, save: async () => {}, clear: async () => {} },
    () => 'synthetic-request',
  );
  const queryClient = new QueryClient();
  queryClient.mount();
  let snapshot = { sharedDraftCollection: emptySharedDraftCollection() };
  const listeners = new Set<() => void>();
  const commands = sharedDraftCollection({
    client: {
      ...client,
      context: async () => ({
        group,
        tags: [
          { id: 'e00000000000000000000001', name: 'Food', isArchived: false, isDeleted: false },
          { id: 'e00000000000000000000002', name: 'Travel', isArchived: false, isDeleted: false },
        ],
      }),
    },
    queryClient,
    groupId: group.id,
    environment: 'http://localhost:3000',
    accountId,
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
      return () => listeners.delete(listener);
    },
  };
  function Editor() {
    const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
    useEffect(() => commands.open(), []);
    return (
      <SharedDraftEditor client={commands} state={state.sharedDraftCollection} offline={false} />
    );
  }
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Editor />);
  });
  const button = (label: string) =>
    tree.root.findAll(
      (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label,
    )[0];
  try {
    await act(async () => commands.edit(snapshot.sharedDraftCollection.rows[0]));
    expect(button(scenario.displayed)).toBeDefined();
    await act(async () => button(scenario.displayed).props.onPress());
    const tagChoices = button(scenario.displayed).parent!.parent!;
    const selected = tagChoices.findAll(
      (node) =>
        String(node.type) === 'Pressable' && node.props.accessibilityLabel === scenario.selection,
    )[0];
    await act(async () => selected.props.onPress());
    await act(async () => button('Keep changes for later').props.onPress());
    expect(submitted).toEqual({ description: 'Dinner', ...scenario.expected });
    await act(async () => commands.edit(snapshot.sharedDraftCollection.rows[0]));
    const remainingTag = scenario.selection === 'Travel' ? 'Travel' : 'Not specified';
    expect(button(remainingTag)).toBeDefined();
  } finally {
    await act(async () => tree.unmount());
    queryClient.clear();
    queryClient.unmount();
  }
});

it('says where its editor was that the item was saved or deleted (#436)', async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SharedDraftEditor
        client={{} as Parameters<typeof SharedDraftEditor>[0]['client']}
        state={{ ...emptySharedDraftCollection(), message: draftGoneMessage }}
        offline={false}
      />,
    );
  });
  const alert = tree.root.findAll(
    (node) => String(node.type) === 'Text' && node.props.accessibilityRole === 'alert',
  );
  expect(alert.map((node) => node.props.children)).toContain(draftGoneMessage);
  await act(async () => tree.unmount());
});
