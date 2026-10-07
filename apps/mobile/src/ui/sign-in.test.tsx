import type { ReactElement } from 'react';
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findHosts, flatten, layoutHeight, layoutWidth } from '../test-utils/layout';
import { loop, setFileWindow, setReduceMotion } from '../test-utils/native';

// #335: the sign-in option chosen stays busy, keeping its size, while the sign-in runs. The App's
// own tests (app-states) cover the personas end to end; Google's native button is covered here.
setFileWindow({ width: 360, height: 640 });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('react-native-nitro-google-signin', () => ({ GoogleSignInButton: 'GoogleSignInButton' }));

const { SignIn } = await import('./screens');

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});
/** Renders in place of what was rendered, then lets Android answer whether reduce motion is on. */
async function render(element: ReactElement) {
  act(() => {
    renderer?.unmount();
    renderer = create(element);
  });
  await act(async () => undefined);
  return renderer!.root;
}
const ofType = (root: ReactTestInstance, type: string) =>
  root.findAll((node) => (node.type as unknown) === type);
const icons = (root: ReactTestInstance) => ofType(root, 'Ionicons').map((icon) => icon.props.name);
const text = (root: ReactTestInstance) =>
  ofType(root, 'Text')
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    .join(' ');
/** A host in the rendered JSON, by its spoken label. */
const labelled = (label: string) => {
  const [node] = findHosts(
    renderer!.toJSON() as ReactTestRendererJSON,
    (props) => props.accessibilityLabel === label,
  );
  return node!;
};
const google = (root: ReactTestInstance) => ofType(root, 'GoogleSignInButton')[0]!;
const options = { message: null, onSignIn: vi.fn() };

describe('the persona signing in', () => {
  it('keeps its row’s size, at 100% and 130% text, with a still mark in its arrow’s place', async () => {
    // A still mark is narrower than the arrow it replaces: the row must not move for it.
    setReduceMotion(true);
    const measure = (label: string, fontScale: number) => {
      const row = labelled(label);
      const trailing = (row.children as ReactTestRendererJSON[]).at(-1)!;
      return {
        height: layoutHeight(row, fontScale, 328),
        trailing: layoutWidth(trailing, fontScale),
      };
    };
    await render(<SignIn busy={false} {...options} />);
    const idle = [1, 1.3].map((scale) => measure('Continue as Alex Rivera', scale));
    await render(<SignIn busy option="alex" {...options} />);
    const busy = [1, 1.3].map((scale) => measure('Signing in as Alex Rivera', scale));
    expect(busy).toEqual(idle);
    expect(icons(renderer!.root)).toContain('hourglass-outline');
    expect(ofType(renderer!.root, 'ActivityIndicator')).toEqual([]);
    expect(loop).not.toHaveBeenCalled();
  });
});

describe('Google signing in', () => {
  it('says so on its own button, which keeps its size and label, with the busy mark at its end', async () => {
    const onGoogleSignIn = vi.fn();
    const idle = google(
      await render(<SignIn busy={false} {...options} onGoogleSignIn={onGoogleSignIn} />),
    );
    expect(idle.props).toMatchObject({
      accessibilityLabel: 'Sign in with Google',
      accessibilityState: { disabled: false },
      disabled: false,
    });
    const size = flatten(idle.props.style);

    const root = await render(
      <SignIn busy option="google" {...options} onGoogleSignIn={onGoogleSignIn} />,
    );
    expect(google(root).props).toMatchObject({
      accessibilityLabel: 'Signing in with Google',
      accessibilityState: { disabled: true, busy: true },
      disabled: true,
    });
    expect(flatten(google(root).props.style)).toEqual(size);
    // The mark sits over the button's end, unread: the button says it is busy.
    const [spinner] = ofType(root, 'ActivityIndicator');
    let overlay = spinner!.parent!;
    while (typeof overlay.type !== 'string') overlay = overlay.parent!;
    expect(flatten(overlay.props.style)).toMatchObject({ position: 'absolute' });
    expect(overlay.props).toMatchObject({
      pointerEvents: 'none',
      importantForAccessibility: 'no-hide-descendants',
    });
    const [status] = root.findAll(
      (node) => typeof node.type === 'string' && node.props.accessibilityLiveRegion === 'polite',
    );
    expect(text(status!)).toBe('Signing in with Google…');
  });

  it('shows a still mark with reduce motion on', async () => {
    setReduceMotion(true);
    const root = await render(
      <SignIn busy option="google" {...options} onGoogleSignIn={vi.fn()} />,
    );
    expect(google(root).props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(ofType(root, 'ActivityIndicator')).toEqual([]);
    expect(icons(root)).toContain('hourglass-outline');
    expect(loop).not.toHaveBeenCalled();
  });
});
