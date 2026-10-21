import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activateWithScreenReader, setWindow, touchAlong } from '../test-utils/native';
import { findHosts, flatten, largeTextWindows, unreadText } from '../test-utils/layout';

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
            extraCurrencies: [],
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

describe('choosing a new Group’s currency (#684)', () => {
  it('opens the currencies and picks one on a tap or a screen reader’s activate, never on a drag', () => {
    const onChange = vi.fn();
    act(() => {
      renderer = create(
        <GroupCreateForm
          draft={{
            name: 'Maple House',
            description: '',
            category: 'home',
            defaultCurrency: 'INR',
            extraCurrencies: [],
            startDate: '',
            endDate: '',
          }}
          onChange={onChange}
          onSubmit={vi.fn()}
          busy={false}
          message={null}
          uncertain={false}
          onCheckGroups={vi.fn()}
          onDiscard={vi.fn()}
        />,
      );
    });
    const pressable = (label: string) =>
      renderer!.root.find(
        (node: ReactTestInstance) =>
          (node.type as unknown) === 'Pressable' &&
          String(node.props.accessibilityLabel).startsWith(label),
      );
    const choosing = () =>
      renderer!.root.find((node: ReactTestInstance) => (node.type as unknown) === 'Modal').props
        .visible;
    const landed = { pageX: 180, pageY: 400 };
    const drag = [landed, { pageX: 180, pageY: 300 }, { pageX: 181, pageY: 150 }] as const;
    const tap = [landed, { pageX: 182, pageY: 403 }] as const;

    act(() => touchAlong(pressable('Main currency, INR'), [...drag]));
    expect(choosing()).toBe(false);
    act(() => touchAlong(pressable('Main currency, INR'), [...tap]));
    expect(choosing()).toBe(true);

    act(() => touchAlong(pressable('USD, '), [...drag]));
    expect(onChange).not.toHaveBeenCalled();
    expect(choosing()).toBe(true);
    act(() => touchAlong(pressable('USD, '), [...tap]));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ defaultCurrency: 'USD' });
    expect(choosing()).toBe(false);

    act(() => activateWithScreenReader(pressable('Main currency, INR')));
    expect(choosing()).toBe(true);
    act(() => activateWithScreenReader(pressable('EUR, ')));
    expect(onChange).toHaveBeenLastCalledWith({ defaultCurrency: 'EUR' });
    expect(choosing()).toBe(false);
  });
});

// #723: a new Trip offers its extra currencies while it is set up, as the board "Android · New
// Trip offers extra currencies" shows them; a Household adds them later in settings.
describe('a new Trip’s extra currencies (#723)', () => {
  const lisbonAndTokyo = {
    name: 'Lisbon & Tokyo',
    description: '',
    category: 'trip' as const,
    defaultCurrency: 'INR',
    extraCurrencies: ['EUR', 'JPY'],
    startDate: '',
    endDate: '',
  };
  const form = (
    draft: typeof lisbonAndTokyo | Record<string, unknown>,
    onChange = vi.fn(),
    busy = false,
  ) => {
    act(() => {
      renderer = create(
        <GroupCreateForm
          draft={{ ...lisbonAndTokyo, ...draft }}
          onChange={onChange}
          onSubmit={vi.fn()}
          busy={busy}
          message={null}
          uncertain={false}
          onCheckGroups={vi.fn()}
          onDiscard={vi.fn()}
        />,
      );
    });
    return onChange;
  };
  const text = () =>
    renderer!.root
      .findAll((node: ReactTestInstance) => (node.type as unknown) === 'Text')
      .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
      .join(' ');
  const pressables = (label: string) =>
    renderer!.root.findAll(
      (node: ReactTestInstance) =>
        (node.type as unknown) === 'Pressable' &&
        String(node.props.accessibilityLabel).startsWith(label),
    );
  /** A currency in the list, by its spoken name exactly: "EUR, Euro". */
  const currencyRow = (label: string) =>
    renderer!.root.findAll(
      (node: ReactTestInstance) =>
        (node.type as unknown) === 'Pressable' && node.props.accessibilityLabel === label,
    );
  const choosing = () =>
    renderer!.root.find((node: ReactTestInstance) => (node.type as unknown) === 'Modal').props
      .visible;

  it('names each one added, with how many more there’s room for', () => {
    form(lisbonAndTokyo);
    for (const words of [
      'Spending abroad?',
      'Optional',
      '2 of 4',
      'Add each currency you’ll pay in. Expenses keep the amount on the receipt; nothing is converted.',
      'Anyone in the Group can add more later.',
    ])
      expect(text()).toContain(words);
    expect(pressables('EUR, Euro, added. Remove')).toHaveLength(1);
    expect(pressables('JPY, Japanese Yen, added. Remove')).toHaveLength(1);
  });

  it('says the count as it changes, to TalkBack too', () => {
    form(lisbonAndTokyo);
    const count = renderer!.root.find(
      (node: ReactTestInstance) =>
        (node.type as unknown) === 'Text' && node.children.join('') === '2 of 4',
    );
    expect(count.props.accessibilityLiveRegion).toBe('polite');
  });

  it('makes each chip a full touch target', () => {
    form(lisbonAndTokyo);
    for (const chip of [
      ...pressables('EUR, Euro, added. Remove'),
      ...pressables('Add a currency'),
    ]) {
      expect(chip.props.style({ pressed: false }).minHeight).toBe(44);
      expect(chip.props.hitSlop).toEqual({ top: 2, bottom: 2, left: 2, right: 2 });
    }
  });

  it('dims its chips while the Group is being sent', () => {
    form(lisbonAndTokyo, vi.fn(), true);
    for (const chip of [
      ...pressables('EUR, Euro, added. Remove'),
      ...pressables('Add a currency'),
    ]) {
      expect(chip.props.disabled).toBe(true);
      expect(chip.props.style({ pressed: false }).opacity).toBeLessThan(1);
    }
  });

  it('removes one with a tap on it', () => {
    const onChange = form(lisbonAndTokyo);
    act(() => activateWithScreenReader(pressables('EUR, Euro, added. Remove')[0]));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ extraCurrencies: ['JPY'] });
  });

  it('adds one from the currencies, never the main currency or one already added', () => {
    const onChange = form(lisbonAndTokyo);
    act(() => activateWithScreenReader(pressables('Add a currency')[0]));
    expect(choosing()).toBe(true);
    expect(currencyRow('INR, Indian Rupee')).toHaveLength(0);
    expect(currencyRow('EUR, Euro')).toHaveLength(0);
    act(() => activateWithScreenReader(currencyRow('USD, US Dollar')[0]));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ extraCurrencies: ['EUR', 'JPY', 'USD'] });
    expect(choosing()).toBe(false);
  });

  it('offers no more once there are 4', () => {
    form({ ...lisbonAndTokyo, extraCurrencies: ['EUR', 'JPY', 'USD', 'GBP'] });
    expect(text()).toContain('4 of 4');
    expect(pressables('Add a currency')[0].props.accessibilityState).toMatchObject({
      disabled: true,
    });
    // Disabled for Android too, not only as TalkBack says it.
    expect(pressables('Add a currency')[0].props.disabled).toBe(true);
  });

  // On the emulator at 200% on a 360dp phone, the heading row ran past the card: "Optio…", and
  // no count.
  it.each(largeTextWindows)('reads in full, $width dp at $fontScale× text', (size) => {
    setWindow(size);
    form(lisbonAndTokyo);
    const card = findHosts(
      renderer!.toJSON() as ReactTestRendererJSON,
      (props, type) =>
        type === 'View' &&
        flatten(props.style).padding === 14 &&
        flatten(props.style).borderWidth === 1,
    ).find((node) => JSON.stringify(node).includes('Spending abroad?'));
    // The form sits 16dp in from each edge of the screen.
    expect(unreadText(card!, size.fontScale, size.width - 32)).toEqual([]);
  });

  it('isn’t offered for a Household, which adds them later in settings', () => {
    form({ ...lisbonAndTokyo, category: 'home', name: 'Maple House' });
    expect(text()).not.toContain('Spending abroad?');
  });

  it('sits under the main currency, named as the boards do', () => {
    form(lisbonAndTokyo);
    expect(text()).toContain('Main currency');
    expect(text()).toContain('Locked once money is recorded. Pick the one most of you settle in.');
    expect(pressables('Create Trip')).toHaveLength(1);
  });
});
