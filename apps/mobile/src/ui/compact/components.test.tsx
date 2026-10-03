import type { ReactElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setWindow } from '../../test-utils/native';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const {
  Banner,
  Chip,
  CompactButton,
  GroupNavBar,
  LinearProgress,
  ListRow,
  SegmentedControl,
  SelectorTile,
  Snackbar,
  Stepper,
  SummaryStats,
  TileGrid,
  TopBar,
} = await import('./index');

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
    expect(text(tile)).toBe('Date Thu 1 Oct');
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
    expect(button.props.accessibilityState).toEqual({ disabled: true });
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

  it('list rows without an action are not buttons', () => {
    const root = render(<ListRow title="Sam Chen" meta="Member" />);
    expect(byRole(root, 'button')).toHaveLength(0);
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
