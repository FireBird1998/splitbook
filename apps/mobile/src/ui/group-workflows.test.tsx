import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setWindow } from '../test-utils/native';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { GroupCreateForm, InvitationPreview, joinNeedsConnection } =
  await import('./group-workflows');

// Sam's invitation to Maple House, a fictional Household.
const preview = {
  id: 'b00000000000000000000002',
  name: 'Maple House',
  category: 'home' as const,
  memberCount: 2,
};

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => {
    renderer?.unmount();
  });
  renderer = undefined;
});

/** A ready invitation, offline, and its one primary button. */
function offlineInvitation(signedIn: boolean, alreadyMember: boolean) {
  act(() => {
    renderer = create(
      <InvitationPreview
        preview={preview}
        status="ready"
        message={null}
        signedIn={signedIn}
        alreadyMember={alreadyMember}
        offline
        onJoin={vi.fn()}
        onOpenGroup={vi.fn()}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
  });
  const root = renderer!.root;
  const text = root
    .findAll((node: ReactTestInstance) => (node.type as unknown) === 'Text')
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    .join('');
  const [action] = root.findAll(
    (node: ReactTestInstance) =>
      typeof node.type === 'string' && node.props.accessibilityRole === 'button',
  );
  return { text, action };
}

describe('An invitation while offline (#286)', () => {
  it('keeps Join unavailable, saying why', () => {
    const { text, action } = offlineInvitation(true, false);
    expect(action.props.accessibilityLabel).toBe('Join Group');
    expect(action.props.accessibilityState).toEqual({ disabled: true, busy: false });
    expect(action.props.accessibilityHint).toBe(joinNeedsConnection);
    expect(text).toContain(joinNeedsConnection);
  });

  it.each([
    ['Open Group, for a member already in the Group,', true, true],
    ['Sign in to continue, before signing in,', false, false],
  ] as const)('keeps %s available: it isn’t a write', (_, signedIn, alreadyMember) => {
    const { text, action } = offlineInvitation(signedIn, alreadyMember);
    expect(action.props.accessibilityLabel).toBe(signedIn ? 'Open Group' : 'Sign in to continue');
    expect(action.props.accessibilityState).toEqual({ disabled: false, busy: false });
    expect(action.props.accessibilityHint).toBeUndefined();
    expect(text).not.toContain(joinNeedsConnection);
  });
});

describe('A long Group name (#554)', () => {
  it('opens at its start, and leaves the cursor to the member while typing', () => {
    setWindow({ width: 360, height: 780, fontScale: 2 });
    const onLeaveField = vi.fn();
    act(() => {
      renderer = create(
        <GroupCreateForm
          draft={{
            name: 'Maple House shared flat with a very long name',
            description: '',
            category: 'home',
            defaultCurrency: 'INR',
            startDate: '',
            endDate: '',
          }}
          onChange={vi.fn()}
          onSubmit={vi.fn()}
          busy={false}
          message={null}
          uncertain={false}
          onCheckGroups={vi.fn()}
          onDiscard={vi.fn()}
          onLeaveField={onLeaveField}
        />,
      );
    });
    const name = () =>
      renderer!.root.find(
        (node: ReactTestInstance) =>
          (node.type as unknown) === 'TextInput' &&
          node.props.accessibilityLabel === 'Household name, required',
      );
    // Android otherwise opens a filled single-line box at its end, cutting off the start.
    expect(name().props.selection).toEqual({ start: 0, end: 0 });
    act(() => name().props.onFocus());
    expect(name().props.selection).toBeUndefined();
    act(() => name().props.onBlur());
    expect(name().props.selection).toEqual({ start: 0, end: 0 });
    // Leaving the box still checks the name, as before.
    expect(onLeaveField).toHaveBeenCalledWith('name');
  });
});
