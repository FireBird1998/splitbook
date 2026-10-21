import type { ReactElement } from 'react';
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  findHosts,
  flatten,
  hairSpace,
  labelRuns,
  largeTextWindows,
  layoutHeight,
  unreadText,
} from '../../test-utils/layout';
import { activateWithScreenReader, setWindow, touchAlong } from '../../test-utils/native';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const {
  Badge,
  Banner,
  Chip,
  CompactAvatar,
  CompactButton,
  CompactText,
  FieldMarker,
  FloatingAction,
  GroupNavBar,
  IconButton,
  IconTile,
  LinearProgress,
  ListRow,
  RowAmount,
  SectionHeader,
  SegmentedControl,
  SelectorTile,
  Snackbar,
  Stepper,
  SummaryStats,
  TileGrid,
  TopBar,
} = await import('./index');
const { ThemeContext } = await import('../theme');

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => {
    renderer?.unmount();
  });
  renderer = undefined;
});

function render(element: ReactElement) {
  act(() => {
    renderer = create(element);
  });
  return renderer!.root;
}
const isHost = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;
const hosts = (root: ReactTestInstance, match: (props: Record<string, unknown>) => boolean) =>
  root.findAll((node) => typeof node.type === 'string' && match(node.props));
const byRole = (root: ReactTestInstance, role: string, label?: string) =>
  hosts(
    root,
    (p) => p.accessibilityRole === role && (label === undefined || p.accessibilityLabel === label),
  );
const one = (nodes: ReactTestInstance[]) => {
  expect(nodes).toHaveLength(1);
  return nodes[0];
};
const press = (node: ReactTestInstance) => {
  act(() => {
    node.props.onPress();
  });
};
const text = (node: ReactTestInstance) =>
  node
    .findAll((n) => isHost(n, 'Text'))
    .flatMap((n) => n.children.filter((c): c is string => typeof c === 'string'))
    .join(' ');

describe('Group bottom navigation', () => {
  it('exposes three Group-scoped tabs with the selected one marked', () => {
    const onChange = vi.fn();
    const root = render(
      <GroupNavBar groupName="Maple House" value="balances" onChange={onChange} />,
    );

    one(byRole(root, 'tablist', 'Maple House sections'));
    const tabs = byRole(root, 'tab');
    expect(
      tabs.map((tab) => [tab.props.accessibilityLabel, tab.props.accessibilityState.selected]),
    ).toEqual([
      ['Expenses', false],
      ['Balances', true],
      ['Activity', false],
    ]);

    press(one(byRole(root, 'tab', 'Activity')));
    expect(onChange).toHaveBeenCalledWith('activity');
  });
});

describe('Top bar', () => {
  it('labels its back action and marks the title as a heading', () => {
    const back = vi.fn();
    const root = render(
      <TopBar
        title="Maple House"
        subtitle="Household · 3 members · INR"
        leading={{ kind: 'back', label: 'Back to Home', onPress: back }}
      />,
    );
    press(one(byRole(root, 'button', 'Back to Home')));
    expect(back).toHaveBeenCalledOnce();
    expect(text(one(byRole(root, 'header')))).toBe('Maple House');
  });
});

describe('Selector tile', () => {
  it('speaks its label, required marker and value, and opens its sheet', () => {
    const open = vi.fn();
    const root = render(
      <SelectorTile
        icon="pricetag-outline"
        label="Tag"
        value="Groceries"
        required
        onPress={open}
      />,
    );
    const tile = one(byRole(root, 'button', 'Tag, required: Groceries'));
    expect(tile.props.accessibilityState).toEqual({ disabled: false });
    press(tile);
    expect(open).toHaveBeenCalledOnce();
  });

  it('includes the correction in what it announces', () => {
    const root = render(
      <SelectorTile
        icon="pricetag-outline"
        label="Tag"
        value="Party supplies"
        required
        error="Party supplies is no longer active. Choose another Tag."
        onPress={vi.fn()}
      />,
    );
    one(
      byRole(
        root,
        'button',
        'Tag, required: Party supplies. Party supplies is no longer active. Choose another Tag.',
      ),
    );
  });

  it('cannot be opened while locked', () => {
    const root = render(
      <SelectorTile
        icon="calendar-outline"
        label="Date"
        value="Today, 30 Sep"
        locked
        onPress={vi.fn()}
      />,
    );
    const tile = one(byRole(root, 'button', 'Date: Today, 30 Sep. locked'));
    expect(tile.props.accessibilityState).toEqual({ disabled: true });
    expect(tile.props.disabled).toBe(true);
  });

  it('shows a shortened value but speaks it in full', () => {
    const root = render(
      <SelectorTile
        icon="calendar-outline"
        label="Date"
        value="Thu 1 Oct"
        spokenValue="Yesterday, Thursday, 1 October 2026"
        onPress={vi.fn()}
      />,
    );
    const tile = one(byRole(root, 'button', 'Date: Yesterday, Thursday, 1 October 2026'));
    // The label keeps a hair space to spare (#639).
    expect(text(tile)).toBe('Date \u200a Thu 1 Oct');
  });
});

describe('Choice controls', () => {
  it('segmented control is a labelled radio group reporting the checked option', () => {
    const onChange = vi.fn();
    const root = render(
      <SegmentedControl
        label="How many people paid"
        value="one"
        onChange={onChange}
        options={[
          { value: 'one', label: 'One person' },
          { value: 'several', label: 'Several people' },
        ]}
      />,
    );
    one(byRole(root, 'radiogroup', 'How many people paid'));
    expect(
      byRole(root, 'radio').map((r) => [
        r.props.accessibilityLabel,
        r.props.accessibilityState.checked,
      ]),
    ).toEqual([
      ['One person', true],
      ['Several people', false],
    ]);
    press(one(byRole(root, 'radio', 'Several people')));
    expect(onChange).toHaveBeenCalledWith('several');
  });

  it('chips report checked as radios and selected as shortcuts', () => {
    const root = render(
      <>
        <Chip role="radio" label="Shares" selected onPress={vi.fn()} />
        <Chip label="Yesterday" onPress={vi.fn()} />
      </>,
    );
    expect(one(byRole(root, 'radio', 'Shares')).props.accessibilityState).toEqual({
      checked: true,
    });
    expect(one(byRole(root, 'button', 'Yesterday')).props.accessibilityState).toEqual({
      selected: false,
    });
  });

  it('stepper labels both directions and stops at its minimum', () => {
    const onChange = vi.fn();
    const root = render(<Stepper label="Shares for Sam Chen" value={0} onChange={onChange} />);
    expect(
      one(byRole(root, 'button', 'Decrease Shares for Sam Chen')).props.accessibilityState,
    ).toEqual({
      disabled: true,
    });
    press(one(byRole(root, 'button', 'Increase Shares for Sam Chen')));
    expect(onChange).toHaveBeenCalledWith(1);
    one(hosts(root, (p) => p.accessibilityLabel === 'Shares for Sam Chen: 0'));
  });
});

describe('Buttons and rows', () => {
  it('announces the amount on a Save button and explains why it is unavailable', () => {
    const root = render(
      <CompactButton
        label="Save expense"
        amount="₹1,249.50"
        block
        disabled
        hint="Saving needs a connection."
        onPress={vi.fn()}
      />,
    );
    const button = one(byRole(root, 'button', 'Save expense ₹1,249.50'));
    expect(button.props.accessibilityState).toEqual({ disabled: true, busy: false });
    expect(button.props.accessibilityHint).toBe('Saving needs a connection.');
  });

  it('a destructive button uses the coral status colour instead of the brand', async () => {
    const { lightTokens } = await import('@splitbook/shared/design-tokens');
    const root = render(
      <>
        <CompactButton label="Leave Group" variant="tonal" destructive onPress={vi.fn()} />
        <CompactButton label="Confirm leaving" destructive onPress={vi.fn()} />
      </>,
    );
    const background = (label: string) =>
      one(byRole(root, 'button', label)).props.style({ pressed: false }).backgroundColor;
    const labelColor = (label: string) =>
      one(byRole(root, 'button', label))
        .findAll((node) => isHost(node, 'Text'))
        .map((node) => node.props.style)
        .flat()
        // The label's own colour comes last, over the text's default.
        .filter((style) => style && 'color' in style)
        .at(-1)?.color;
    expect(background('Leave Group')).toBe(lightTokens.negative.bg);
    expect(labelColor('Leave Group')).toBe(lightTokens.status.negative);
    expect(background('Confirm leaving')).toBe(lightTokens.status.negative);
    expect(labelColor('Confirm leaving')).toBe(lightTokens.brand.contrastText);
  });

  it('list rows that open something are buttons that say everything they show', () => {
    const open = vi.fn();
    const root = render(
      <ListRow
        title="Weekly groceries"
        meta="You paid · Groceries"
        accessibilityLabel="Weekly groceries, ₹1,249.50, you lent ₹833.00"
        onPress={open}
      />,
    );
    press(one(byRole(root, 'button', 'Weekly groceries, ₹1,249.50, you lent ₹833.00')));
    expect(open).toHaveBeenCalledOnce();
  });

  it('a list row’s own label says its note too (#751)', () => {
    const root = render(
      <ListRow
        title="Weekly groceries"
        meta="You paid · Groceries"
        note="prepared by helper.example.test"
        onPress={() => undefined}
      />,
    );
    expect(byRole(root, 'button')[0]?.props.accessibilityLabel).toBe(
      'Weekly groceries, You paid · Groceries, prepared by helper.example.test',
    );
  });

  it('list rows without an action are not buttons', () => {
    const root = render(<ListRow title="Sam Chen" meta="Member" />);
    expect(byRole(root, 'button')).toHaveLength(0);
  });
});

describe('a drag that starts on a list row never opens it (#665)', () => {
  const landed = { pageX: 180, pageY: 400 };
  const row = (open: () => void) =>
    one(
      byRole(
        render(<ListRow title="Weekly groceries" meta="You paid · Groceries" onPress={open} />),
        'button',
        'Weekly groceries, You paid · Groceries',
      ),
    );
  /** The row's background while Pressable reports it pressed. */
  const pressedBackground = (node: ReactTestInstance) =>
    flatten((node.props.style as (state: { pressed: boolean }) => unknown)({ pressed: true }))
      .backgroundColor;

  it('a touch that moves past the touch slop and lifts on the row does not open it', () => {
    const open = vi.fn();
    const pressable = row(open);
    // 12dp up: still on the row, so Pressability itself presses on release.
    act(() =>
      touchAlong(pressable, [landed, { pageX: 180, pageY: 394 }, { pageX: 180, pageY: 388 }]),
    );
    expect(open).not.toHaveBeenCalled();
  });

  it('an upward drag of 250dp does not open it, as on a list too short to scroll', () => {
    const open = vi.fn();
    const pressable = row(open);
    act(() =>
      touchAlong(pressable, [landed, { pageX: 181, pageY: 300 }, { pageX: 182, pageY: 150 }]),
    );
    expect(open).not.toHaveBeenCalled();
  });

  it('a finger that lifts past the slop with no move in between does not open it', () => {
    // A fast swipe whose moves were coalesced away: only where it lifts says it moved.
    const open = vi.fn();
    const pressable = row(open);
    act(() => touchAlong(pressable, [landed, { pageX: 182, pageY: 150 }], { moves: false }));
    act(() => touchAlong(pressable, [landed, { pageX: 180, pageY: 391 }], { moves: false }));
    expect(open).not.toHaveBeenCalled();
    // Lifted within the slop, it is a tap.
    act(() => touchAlong(pressable, [landed, { pageX: 184, pageY: 395 }], { moves: false }));
    expect(open).toHaveBeenCalledOnce();
  });

  it('a drag that comes back to where it landed does not open it', () => {
    const open = vi.fn();
    const pressable = row(open);
    act(() => touchAlong(pressable, [landed, { pageX: 180, pageY: 300 }, landed]));
    expect(open).not.toHaveBeenCalled();
  });

  it('a tap opens it, though the finger moves a little', () => {
    const open = vi.fn();
    const pressable = row(open);
    act(() => touchAlong(pressable, [landed, { pageX: 183, pageY: 396 }]));
    expect(open).toHaveBeenCalledOnce();
    // Each touch is judged on its own: a drag, then a tap elsewhere on the row.
    act(() => touchAlong(pressable, [landed, { pageX: 180, pageY: 300 }]));
    act(() => touchAlong(pressable, [{ pageX: 40, pageY: 380 }]));
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('a screen reader’s activate opens it, after a drag too', () => {
    const open = vi.fn();
    const pressable = row(open);
    act(() => activateWithScreenReader(pressable));
    expect(open).toHaveBeenCalledOnce();
    act(() => touchAlong(pressable, [landed, { pageX: 180, pageY: 300 }]));
    act(() => activateWithScreenReader(pressable));
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('stops looking pressed once the touch is a drag, and a tap still looks pressed', () => {
    const light = getSemanticTokens('light');
    const pressable = row(vi.fn());
    act(() => touchAlong(pressable, [landed, { pageX: 182, pageY: 397 }], { lift: false }));
    expect(pressedBackground(pressable)).toBe(light.surfaceMuted);
    act(() => touchAlong(pressable, [landed, { pageX: 180, pageY: 380 }], { lift: false }));
    expect(pressedBackground(pressable)).toBeUndefined();
    // The next touch starts pressed again.
    act(() => touchAlong(pressable, [landed], { lift: false }));
    expect(pressedBackground(pressable)).toBe(light.surfaceMuted);
  });
});

describe('buttons, form tiles, tabs and the floating action press only on a tap (#693)', () => {
  const landed = { pageX: 180, pageY: 400 };
  /** A sideways drag that starts and ends on the control, as on the device. */
  const sideways = [landed, { pageX: 260, pageY: 402 }, { pageX: 330, pageY: 403 }] as const;
  const tap = [landed, { pageX: 183, pageY: 402 }] as const;
  /** A control's opacity while Pressable reports it pressed. */
  const pressedOpacity = (node: ReactTestInstance) =>
    flatten((node.props.style as (state: { pressed: boolean }) => unknown)({ pressed: true }))
      .opacity;

  it('a CompactButton presses on a tap or a screen reader’s activate, never on a drag', () => {
    const save = vi.fn();
    const button = one(
      byRole(
        render(<CompactButton label="Save expense" onPress={save} />),
        'button',
        'Save expense',
      ),
    );
    act(() => touchAlong(button, [...sideways]));
    expect(save).not.toHaveBeenCalled();
    act(() => touchAlong(button, [...tap]));
    expect(save).toHaveBeenCalledOnce();
    act(() => activateWithScreenReader(button));
    expect(save).toHaveBeenCalledTimes(2);
    // It stops looking pressed once the touch is a drag.
    act(() => touchAlong(button, [...sideways], { lift: false }));
    expect(pressedOpacity(button)).toBe(1);
    act(() => touchAlong(button, [landed], { lift: false }));
    expect(pressedOpacity(button)).toBe(0.8);
  });

  it('a form tile opens its editor on a tap or a screen reader’s activate, never on a drag', () => {
    const open = vi.fn();
    const tile = one(
      byRole(
        render(<SelectorTile icon="wallet-outline" label="Paid by" value="You" onPress={open} />),
        'button',
        'Paid by: You',
      ),
    );
    act(() => touchAlong(tile, [...sideways]));
    expect(open).not.toHaveBeenCalled();
    act(() => touchAlong(tile, [...tap]));
    expect(open).toHaveBeenCalledOnce();
    act(() => activateWithScreenReader(tile));
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('a bottom tab is chosen on a tap or a screen reader’s activate, never on a drag', () => {
    const choose = vi.fn();
    const root = render(<GroupNavBar groupName="Maple House" value="expenses" onChange={choose} />);
    const balances = one(byRole(root, 'tab', 'Balances'));
    // The tab bar has no scrolling parent to take even a short vertical drag.
    act(() =>
      touchAlong(balances, [landed, { pageX: 181, pageY: 381 }, { pageX: 181, pageY: 362 }]),
    );
    act(() => touchAlong(balances, [...sideways]));
    expect(choose).not.toHaveBeenCalled();
    act(() => touchAlong(balances, [...tap]));
    expect(choose).toHaveBeenCalledExactlyOnceWith('balances');
    act(() => activateWithScreenReader(one(byRole(root, 'tab', 'Activity'))));
    expect(choose).toHaveBeenLastCalledWith('activity');
  });

  it('the floating action presses on a tap or a screen reader’s activate, never on a drag', () => {
    const add = vi.fn();
    const action = one(
      byRole(
        render(<FloatingAction label="Add expense" icon="add" onPress={add} />),
        'button',
        'Add expense',
      ),
    );
    act(() => touchAlong(action, [...sideways]));
    expect(add).not.toHaveBeenCalled();
    act(() => touchAlong(action, [...tap]));
    expect(add).toHaveBeenCalledOnce();
    act(() => activateWithScreenReader(action));
    expect(add).toHaveBeenCalledTimes(2);
  });
});

describe('Feedback', () => {
  it('interrupts for warnings and errors but announces info politely', () => {
    const root = render(
      <>
        <Banner
          tone="warning"
          title="We couldn’t confirm this save"
          message="It may already be recorded."
        />
        <Banner tone="info" message="Draft kept on this device." />
      </>,
    );
    const alert = one(byRole(root, 'alert'));
    expect(alert.props.accessibilityLiveRegion).toBe('assertive');
    expect(text(alert)).toBe('We couldn’t confirm this save It may already be recorded.');
    expect(one(byRole(root, 'summary')).props.accessibilityLiveRegion).toBe('polite');
  });

  it('progress bar is a labelled busy progressbar', () => {
    const root = render(<LinearProgress label="Loading September" />);
    expect(one(byRole(root, 'progressbar', 'Loading September')).props.accessibilityState).toEqual({
      busy: true,
    });
  });

  // A pill is sized to its label's measure, and Android, laying the text out again to draw it,
  // can need a fraction of a pixel more: Tea stall's badge wrapped "₹416.67" below its one-line
  // pill (#331). A hair space after the label adds room to the measure and, as white space a line
  // may end past, never wraps a word itself.
  it('a badge keeps a hair space to spare after its label, with or without an icon', () => {
    for (const icon of [undefined, 'trash-outline' as const]) {
      const root = render(<Badge label="You owe Sam ₹416.67" tone="negative" icon={icon} />);
      const label = one(
        root.findAll(
          (node) => isHost(node, 'Text') && node.children.includes('You owe Sam ₹416.67'),
        ),
      );
      expect(label.children).toEqual(['You owe Sam ₹416.67', String.fromCodePoint(0x200a)]);
      act(() => renderer!.unmount());
      renderer = undefined;
    }
  });

  it('snackbar announces politely and offers its action', () => {
    const view = vi.fn();
    const root = render(
      <Snackbar message="Saved to August" action={{ label: 'View', onPress: view }} />,
    );
    one(hosts(root, (p) => p.accessibilityLiveRegion === 'polite'));
    press(one(byRole(root, 'button', 'View')));
    expect(view).toHaveBeenCalledOnce();
  });
});

describe('Large text', () => {
  // The reflow itself (one column from 130%) is layout, so it is checked on a device; these
  // tests pin what a reader relies on at every scale: nothing is dropped, relabelled or reordered.
  const tiles = (
    <TileGrid>
      <SelectorTile icon="calendar-outline" label="Date" value="Today" onPress={vi.fn()} />
      <SelectorTile icon="wallet-outline" label="Paid by" value="You" onPress={vi.fn()} />
      <SelectorTile icon="pie-chart-outline" label="Split" value="Equally · 3" onPress={vi.fn()} />
      <SelectorTile icon="pricetag-outline" label="Tag" value="Groceries" onPress={vi.fn()} />
    </TileGrid>
  );
  const stats = (
    <SummaryStats
      stats={[
        { label: 'Spent', value: '₹18,420.00' },
        { label: 'Your share', value: '₹6,140.00' },
        { label: 'You paid', value: '₹5,210.00' },
      ]}
    />
  );

  it('keeps both initials in a member’s avatar at 200% text, while their name grows (#589)', () => {
    setWindow({ fontScale: 2 });
    const root = render(
      <>
        <CompactAvatar name="Alex Rivera" />
        <CompactAvatar name="Sam Chen" small />
        <CompactText>Alex Rivera</CompactText>
      </>,
    );
    const texts = root.findAll((node) => isHost(node, 'Text'));
    const initials = texts.filter((node) => ['AR', 'SC'].includes(node.children.join('')));
    expect(initials.map((node) => node.children.join(''))).toEqual(['AR', 'SC']);
    // The avatar's box stays 32 dp (26 small): two letters fit it only up to about 130% text.
    for (const node of initials) expect(node.props.maxFontSizeMultiplier).toBeLessThanOrEqual(1.3);
    const name = one(texts.filter((node) => node.children.join('') === 'Alex Rivera'));
    expect(name.props.maxFontSizeMultiplier).toBeUndefined();
  });

  it.each([1, 1.15, 1.3, 2])(
    'keeps every tile a button and every stat announced, in order, at %sx text',
    (fontScale) => {
      setWindow({ fontScale });
      const root = render(
        <>
          {tiles}
          {stats}
        </>,
      );
      expect(byRole(root, 'button').map((tile) => tile.props.accessibilityLabel)).toEqual([
        'Date: Today',
        'Paid by: You',
        'Split: Equally · 3',
        'Tag: Groceries',
      ]);
      expect(
        hosts(root, (p) => p.accessible === true).map((stat) => stat.props.accessibilityLabel),
      ).toEqual(['Spent: ₹18,420.00', 'Your share: ₹6,140.00', 'You paid: ₹5,210.00']);
      expect(text(root)).toContain('Your share ₹6,140.00');
    },
  );
});

// #639: Android lays a label out again to draw it and can need a fraction of a pixel more than
// React Native measured; a label as wide as its words then wraps its last word out of its
// one-line box. At density 160, "Groups · 7" drew "Groups ·", "ACTIVE · 6" "ACTIVE ·", "One
// person" "One" and "Settled up" "Settled". Every compact part that sizes a label to its words
// keeps room to spare after it, a hair space, as a Badge and a button do (#331).
describe('labels as wide as their words keep room to spare (#639)', () => {
  const noop = () => undefined;
  it.each<[string, ReactElement, string[]]>([
    [
      'a section’s title beside its action',
      <SectionHeader
        key="header"
        title="Groups · 7"
        trailing={<CompactButton label="New Group" icon="add" variant="text" onPress={noop} />}
      />,
      ['Groups · 7', 'New Group'],
    ],
    [
      'a section’s title over its note',
      <SectionHeader key="below" title="Changes in this Group" below trailing={null} />,
      ['Changes in this Group'],
    ],
    [
      'a segmented control’s options',
      <SegmentedControl
        key="segments"
        label="How many people paid"
        options={[
          { value: 'one', label: 'One person' },
          { value: 'several', label: 'Several people' },
        ]}
        value="several"
        onChange={noop}
      />,
      ['One person', 'Several people'],
    ],
    [
      'a chip, chosen or not',
      <>
        <Chip label="Equal" selected role="radio" onPress={noop} />
        <Chip label="By amounts" role="radio" onPress={noop} />
      </>,
      ['Equal', 'By amounts'],
    ],
    [
      'a selector tile’s label',
      <SelectorTile key="tile" icon="wallet-outline" label="Paid by" value="You" onPress={noop} />,
      ['Paid by'],
    ],
    ['a field’s marker', <FieldMarker key="marker" kind="required" />, ['Required']],
    [
      'the add button',
      <FloatingAction key="fab" label="Add expense" icon="add" onPress={noop} />,
      ['Add expense'],
    ],
    [
      'a snackbar’s action',
      <Snackbar key="snackbar" message="Expense saved" action={{ label: 'View', onPress: noop }} />,
      ['View'],
    ],
    [
      'the Group’s destinations',
      <GroupNavBar key="nav" groupName="Maple House" value="expenses" onChange={noop} />,
      ['Expenses', 'Balances', 'Activity'],
    ],
    [
      'a row’s caption under its amount',
      <ListRow
        key="row"
        title="Studio Lunch Club"
        trailing={<RowAmount amount="₹62.30" tone="positive" caption="owed to you" />}
      />,
      ['owed to you'],
    ],
    [
      'a text button',
      <CompactButton key="button" label="All time" variant="text" onPress={noop} />,
      ['All time'],
    ],
    ['a badge', <Badge key="badge" label="Adds up" tone="positive" />, ['Adds up']],
  ])('%s', (_part, element, labels) => {
    const root = render(element);
    for (const label of labels) expect(labelRuns(root, label), label).toEqual([[label, hairSpace]]);
  });
});

// #639, at 200% text: a top bar's status squeezed "Add expense" and its Group to dots, a Group's
// subtitle lost its currency, a block button's words and amount ran past both its edges, a row's
// balance squeezed its Group's name to "QA Eu..", and an options row read "Members and Group
// d…". As the layout estimate lays them out, every text in these parts reads in full at 200% on
// 360 and 412dp phones. At 130% a long name may still end at its line, cut once as the compact
// design has it (#332), but no word breaks in two and nothing runs past its row.
describe.each(['light', 'dark'] as const)('compact parts at large text in %s (#639)', (mode) => {
  const noop = () => undefined;
  /** Each part, and how much narrower than the screen it lays out. */
  const parts: [string, number, ReactElement][] = [
    [
      'a top bar with a status',
      0,
      <TopBar
        key="status"
        title="Add expense"
        subtitle="Maple House · INR"
        prominent={false}
        leading={{ kind: 'close', label: 'Back to Group', onPress: noop }}
        status={<Badge label="Kept on this phone" />}
        actions={<IconButton icon="ellipsis-vertical-outline" label="Options" onPress={noop} />}
      />,
    ],
    [
      'a Group’s top bar',
      0,
      <TopBar
        key="group"
        title="Maple House"
        subtitle="Household · 3 members · INR"
        leading={{ kind: 'back', label: 'Back', onPress: noop }}
        actions={
          <>
            <IconButton icon="person-add-outline" label="Invite" onPress={noop} />
            <IconButton icon="ellipsis-vertical" label="Group options" onPress={noop} />
          </>
        }
      />,
    ],
    [
      'a block button with an amount',
      40,
      <CompactButton key="button" label="Record payment" amount="₹1,000.00" block onPress={noop} />,
    ],
    [
      'a row with a balance',
      34,
      <ListRow
        key="balance"
        leading={<IconTile icon="airplane-outline" />}
        title="Kochi to Alleppey"
        meta="Trip · 28 Aug – 2 Sep · 3 members"
        trailing={<RowAmount amount="₹8,661.00" tone="negative" caption="you owe" />}
      />,
    ],
    [
      'a row of options',
      42,
      <ListRow
        key="options"
        leading={<IconTile icon="people-outline" />}
        title="Members and Group details"
        meta="Theme, currency, members and Invite"
        onPress={noop}
      />,
    ],
    [
      'a section’s title beside its action',
      32,
      <SectionHeader
        key="header"
        title="Groups · 7"
        trailing={<CompactButton label="New Group" icon="add" variant="text" onPress={noop} />}
      />,
    ],
  ];
  it.each(largeTextWindows)('read in full, $width dp at $fontScale× text', (size) => {
    setWindow(size);
    for (const [part, inset, element] of parts) {
      render(
        <ThemeContext.Provider value={getSemanticTokens(mode)}>{element}</ThemeContext.Provider>,
      );
      const tree = renderer!.toJSON() as ReactTestRendererJSON;
      expect(
        unreadText(tree, size.fontScale, size.width - inset, { cutOnce: size.fontScale < 1.5 }),
        part,
      ).toEqual([]);
      act(() => renderer!.unmount());
      renderer = undefined;
    }
  });
});

// #639 review: at large text a part that can't share its line goes onto a line of its own at the
// row's end, as a row's balance does: a section's action (New Group, New Tag, Invite) and a top
// bar's status, where they were at 100%, not under the title at the start.
describe('a part on a line of its own keeps to the row’s end (#639)', () => {
  const noop = () => undefined;
  /** A line that wraps: its style, the title's part and the part after it. */
  const parts = (row: ReactTestRendererJSON) => {
    const [first, second] = (row.children ?? []) as ReactTestRendererJSON[];
    return {
      row: flatten(row.props.style),
      first: flatten(first!.props.style),
      title: first!,
      second,
    };
  };
  it('a section’s action, under a title it doesn’t fit beside at 200% on a 360dp phone', () => {
    setWindow({ width: 360, height: 640, fontScale: 2 });
    render(
      <SectionHeader
        title="Groups · 12"
        trailing={<CompactButton label="New Group" icon="add" variant="text" onPress={noop} />}
      />,
    );
    const row = renderer!.toJSON() as ReactTestRendererJSON;
    const { title, second } = parts(row);
    // On a line of its own: the title's line, the gap, then the button's.
    const room = 360 - 32 - 4;
    expect(layoutHeight(row, 2, 360 - 32)).toBe(
      layoutHeight(title, 2, room) + 8 + layoutHeight(second!, 2, room),
    );
    // A lone part keeps to the end; the title's margin takes what its own line leaves.
    const { row: style, first } = parts(row);
    expect(style.justifyContent).toBe('flex-end');
    expect(first.marginRight).toBe('auto');
  });
  it.each(largeTextWindows)(
    'a top bar’s status, beside its title or under it at the end, $width dp at $fontScale× text',
    (size) => {
      setWindow(size);
      render(
        <TopBar
          title="Add expense"
          subtitle="Maple House · INR"
          prominent={false}
          leading={{ kind: 'close', label: 'Back to Group', onPress: noop }}
          status={<Badge label="Kept on this phone" />}
          actions={<IconButton icon="ellipsis-vertical-outline" label="Options" onPress={noop} />}
        />,
      );
      const [line] = findHosts(
        renderer!.toJSON() as ReactTestRendererJSON,
        (props) => flatten(props.style).flexWrap === 'wrap',
      );
      const { row: style, first } = parts(line!);
      // The title fills its line, and a status on a line of its own keeps to the end.
      expect(first.flex).toBe(1);
      expect(style.justifyContent).toBe('flex-end');
    },
  );
});

// #639 device check: at 200% and density 420, Home's "New Group" put its "+" on a line of its own
// above the words, with room to spare beside them: a button that wrapped its parts tipped over on
// a fraction of a pixel. A button keeps its icon and words on one line, and its words wrap inside
// themselves, so the icon stays beside the first line.
describe('a button with an icon at 200% text (#639)', () => {
  const noop = () => undefined;
  it.each([360, 412])('keeps its icon on its words’ first line, %sdp', (width) => {
    setWindow({ width, height: 640, fontScale: 2 });
    render(<CompactButton label="New Group" icon="add" variant="text" onPress={noop} />);
    const button = renderer!.toJSON() as ReactTestRendererJSON;
    const [icon, words] = button.children as ReactTestRendererJSON[];
    expect(icon!.type).toBe('Ionicons');
    expect(flatten(button.props.style).flexWrap).not.toBe('wrap');
    expect(flatten(words!.props.style)).toMatchObject({ flexShrink: 1, minWidth: 0 });
    // In less room than the icon and both words need, the words wrap beside the icon.
    const room = 140;
    const style = flatten(button.props.style);
    const beside = room - 2 * (style.paddingHorizontal as number) - 18 - (style.gap as number);
    expect(layoutHeight(button, 2, room)).toBe(
      Math.max(style.minHeight as number, layoutHeight(words!, 2, beside)),
    );
  });
});
