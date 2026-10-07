import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { loop } from '../../test-utils/native';

// #331: before Android has said whether reduce motion is on, it counts as on, so nothing moves
// on a guess. Its own file, so the kit starts as the app does: nothing asked yet.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { CompactButton, Skeleton } = await import('./index');

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});
const hosts = (root: ReactTestInstance, name: string) =>
  root.findAll((node) => (node.type as unknown) === name);

it('a busy button shows a still mark, and skeletons rest, until Android answers', async () => {
  act(() => {
    renderer = create(
      <>
        <CompactButton label="Save expense" busy="Saving expense…" block onPress={vi.fn()} />
        <Skeleton width={40} />
      </>,
    );
  });
  const root = renderer!.root;
  expect(hosts(root, 'ActivityIndicator')).toEqual([]);
  expect(hosts(root, 'Ionicons').map((node) => node.props.name)).toEqual(['hourglass-outline']);
  expect(loop).not.toHaveBeenCalled();
  // Reduce motion is off: the spinner and the pulse start.
  await act(async () => undefined);
  expect(hosts(root, 'ActivityIndicator')).toHaveLength(1);
  expect(hosts(root, 'Ionicons')).toEqual([]);
  expect(loop).toHaveBeenCalledOnce();
});
