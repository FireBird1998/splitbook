import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MobileController } from '../data/mobile-controller';
import { emptyTagManager, type TagManagerState } from '../data/tag-manager';
import { TagManager } from './tag-manager';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Alex renames Harbour Flat's "Shared" Tag, a fictional Group.
const groupId = 'b00000000000000000000001';
const tagId = 'c00000000000000000000001';

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => {
    renderer?.unmount();
  });
  renderer = undefined;
});

/** Manage Tags showing the given Tag manager state, as the controller publishes it. */
function manageTags(tagManager: TagManagerState) {
  const manager = { open: () => () => undefined, enter: vi.fn(), dirty: () => false };
  const controller = {
    manageTags: () => manager,
    subscribe: () => () => undefined,
    getSnapshot: () => ({ tagManager }),
  } as unknown as MobileController;
  act(() => {
    renderer = create(
      <TagManager
        controller={controller}
        groupId={groupId}
        accountId="a00000000000000000000001"
        offline={false}
        onClose={vi.fn()}
      />,
    );
  });
}

describe('Renaming a Tag (#554)', () => {
  it('opens a long name at its start, and leaves the cursor to the member while typing', () => {
    const name = 'Shared groceries and household supplies for the flat';
    manageTags({
      ...emptyTagManager(),
      groupId,
      snapshot: {
        canManage: true,
        tags: [{ id: tagId, name, revision: 0, isArchived: false, isDeleted: false }],
      },
      edit: { action: 'rename', tagId, expectedRevision: 0, name },
      originalName: name,
    });
    const box = () =>
      renderer!.root.find(
        (node: ReactTestInstance) =>
          (node.type as unknown) === 'TextInput' && node.props.accessibilityLabel === 'Tag name',
      );
    // Android otherwise opens a filled single-line box at its end, cutting off the start.
    expect(box().props.selection).toEqual({ start: 0, end: 0 });
    act(() => box().props.onFocus());
    expect(box().props.selection).toBeUndefined();
    act(() => box().props.onBlur());
    expect(box().props.selection).toEqual({ start: 0, end: 0 });
  });
});
