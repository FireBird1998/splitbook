import { brandLogoSize } from './brand-logo';
import type { ReactElement } from 'react';
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
  type ReactTestRendererJSON,
} from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ExpenseDraftSummary,
  HomeFinancialState,
  MobileGroup,
  MobileSnapshot,
} from '../data/types';
import { ContinueDrafts, HomeBalances, HomeGroups, HomeTopBar } from './home';
import { getSemanticTokens } from '@splitbook/shared/design-tokens';
import { ThemeContext } from './theme';
import {
  findHosts,
  flatten,
  hairSpace,
  labelRuns,
  largeTextWindows,
  layoutHeight,
  outerTexts,
  unreadText,
  wordsOf,
  countApart,
} from '../test-utils/layout';
import { refreshedLabel } from './refresh-feedback';
import {
  activateWithScreenReader,
  setFileWindow,
  setWindow,
  touchAlong,
} from '../test-utils/native';

// #126: Home's balances, drafts to resume and Groups, rendered.
setFileWindow({ width: 360, height: 640 });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const at = new Date('2026-10-01T10:42:00');
const [maple, goa, lisbon, football] = [1, 2, 3, 4].map(
  (n) => `b0000000000000000000000${n}`,
) as string[];
const group = (
  id: string,
  name: string,
  category: MobileGroup['category'],
  members = 3,
  dates: [string, string] | null = null,
): MobileGroup => ({
  id,
  name,
  description: '',
  category,
  defaultCurrency: 'INR',
  alternateCurrencies: [],
  latestExpenseCurrency: null,
  members: Array.from({ length: members }, (_, index) => ({
    user: {
      id: `a0000000000000000000001${index}`,
      name: `Member ${index}`,
      email: '',
      image: null,
    },
    role: 'member' as const,
    joinedAt: at,
  })),
  startDate: dates && new Date(`${dates[0]}T00:00:00.000Z`),
  endDate: dates && new Date(`${dates[1]}T00:00:00.000Z`),
  createdAt: at,
  updatedAt: at,
});
const groupsList: MobileGroup[] = [
  group(maple, 'Maple House', 'home'),
  group(goa, 'Goa Friends Trip', 'trip', 3, ['2026-09-17', '2026-09-20']),
  group(lisbon, 'Lisbon Offsite', 'work', 4),
  group(football, 'Sunday Football', 'other', 8),
];
const home = (patch: Partial<HomeFinancialState> = {}): HomeFinancialState => ({
  status: 'ready',
  data: [
    { currency: 'INR', youOwe: 1480, youAreOwed: 620 },
    { currency: 'EUR', youOwe: 0, youAreOwed: 42.5 },
  ],
  byGroup: {
    [maple]: [{ currency: 'INR', balance: -1480 }],
    [goa]: [
      { currency: 'INR', balance: 620 },
      { currency: 'EUR', balance: 12.5 },
    ],
    [football]: [],
  },
  message: null,
  refreshedAt: at.getTime(),
  stale: false,
  ...patch,
});
const draft = (patch: Partial<ExpenseDraftSummary>): ExpenseDraftSummary => ({
  groupId: maple,
  groupName: 'Maple House',
  expenseId: null,
  description: 'Weekly groceries',
  amount: '1249.5',
  currency: 'INR',
  unconfirmed: false,
  ...patch,
});

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});
const render = (element: ReactElement) => {
  act(() => {
    renderer = create(element);
  });
  return renderer!.root;
};
const isHost = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;
const text = (root: ReactTestInstance) =>
  root
    .findAll((node) => isHost(node, 'Text'))
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    .join('');
const buttons = (root: ReactTestInstance) =>
  root.findAll((node) => isHost(node, 'Pressable') && node.props.accessibilityRole === 'button');
const button = (root: ReactTestInstance, label: string) => {
  const found = buttons(root).filter((node) => node.props.accessibilityLabel === label);
  expect(found).toHaveLength(1);
  return found[0];
};
const announced = (root: ReactTestInstance) =>
  root
    .findAll((node) => isHost(node, 'View') && node.props.accessible === true)
    .map((node) => node.props.accessibilityLabel as string);
const headers = (root: ReactTestInstance) =>
  root
    .findAll((node) => typeof node.type === 'string' && node.props.accessibilityRole === 'header')
    .map(
      (node) =>
        node.props.accessibilityLabel ??
        node.children.filter((child) => typeof child === 'string').join(''),
    );

describe('Home top bar', () => {
  it.each(
    (['light', 'dark'] as const).flatMap((mode) =>
      [1, 1.3, 2].map((fontScale) => ({ mode, fontScale })),
    ),
  )(
    'shows the $mode artwork once as the fixed-size Splitbook heading at $fontScale text',
    ({ mode, fontScale }) => {
      setWindow({ fontScale });
      const root = render(
        <ThemeContext.Provider value={getSemanticTokens(mode)}>
          <HomeTopBar userName="Alex Rivera" onRefresh={vi.fn()} onAccount={vi.fn()} />
        </ThemeContext.Provider>,
      );
      const logos = root.findAll(
        (node) => typeof node.type === 'string' && node.props.accessibilityLabel === 'Splitbook',
      );
      expect(logos).toHaveLength(1);
      expect(logos[0]!.type).toBe('Image');
      expect(logos[0]!.props).toMatchObject({
        accessible: true,
        accessibilityRole: 'header',
        resizeMode: 'contain',
      });
      expect(String(logos[0]!.props.source)).toContain(`logo-${mode}.png`);
      expect(flatten(logos[0]!.props.style)).toMatchObject({
        height: 32,
        width: brandLogoSize.width,
        flexShrink: 0,
      });
      expect(text(root)).not.toContain('splitbook');
    },
  );

  it('keeps a refresh action and opens Account from the avatar', () => {
    const onRefresh = vi.fn(),
      onAccount = vi.fn();
    const root = render(
      <HomeTopBar userName="Alex Rivera" onRefresh={onRefresh} onAccount={onAccount} />,
    );
    expect(headers(root)).toEqual(['Splitbook']);
    act(() => button(root, 'Refresh Home').props.onPress());
    act(() => button(root, 'Account and settings').props.onPress());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onAccount).toHaveBeenCalledTimes(1);
    expect(text(root)).toContain('AR');
  });

  it('keeps Account closed while a Group is being saved', () => {
    const root = render(
      <HomeTopBar userName="Alex Rivera" accountDisabled onRefresh={vi.fn()} onAccount={vi.fn()} />,
    );
    expect(button(root, 'Account and settings').props.accessibilityState).toEqual({
      disabled: true,
    });
  });
});

describe('Home balances', () => {
  it.each([1, 1.3])(
    'shows one row per currency with You owe, Owed to you and the update time at %sx text',
    (fontScale) => {
      setWindow({ fontScale });
      const root = render(<HomeBalances state={home()} onRefresh={vi.fn()} />);
      // A heading beside the time keeps a hair space to spare (#639).
      expect(headers(root)).toContain('Your balances\u200a');
      expect(text(root)).toContain(`Updated ${refreshedLabel(at.getTime())}`);
      expect(announced(root)).toEqual([
        'INR: You owe ₹1,480.00, Owed to you ₹620.00',
        'EUR: You owe €0.00, Owed to you €42.50',
      ]);
    },
  );

  it('says when nothing is outstanding', () => {
    const root = render(<HomeBalances state={home({ data: [] })} onRefresh={vi.fn()} />);
    expect(text(root)).toContain('Nothing outstanding in your Groups');
    expect(announced(root)).toEqual([]);
  });

  it('shows a first load without a time, and a failed one with Retry', () => {
    const onRefresh = vi.fn();
    const loading = render(
      <HomeBalances
        state={home({ status: 'loading', data: null, refreshedAt: null })}
        onRefresh={onRefresh}
      />,
    );
    // Placeholders, never a spinner; the screen's one progress bar is under the top bar.
    const placeholder = loading.find(
      (node) => isHost(node, 'View') && node.props.accessibilityLabel === 'Loading your balances',
    );
    expect(placeholder.props.accessibilityState).toEqual({ busy: true });
    expect(loading.findAll((node) => isHost(node, 'ActivityIndicator'))).toHaveLength(0);
    expect(text(loading)).not.toContain('Updated');

    const failed = render(
      <HomeBalances
        state={home({ status: 'error', data: null, refreshedAt: null, message: 'No connection.' })}
        onRefresh={onRefresh}
      />,
    );
    const alert = failed.find(
      (node) => isHost(node, 'Text') && node.props.accessibilityRole === 'alert',
    );
    expect(alert.children).toEqual(['No connection.']);
    act(() => button(failed, 'Retry Home balances').props.onPress());
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('Continue where you left off', () => {
  it('is absent without drafts', () => {
    const root = render(<ContinueDrafts drafts={[]} onOpen={vi.fn()} />);
    expect(text(root)).toBe('');
  });

  it('lists each draft with its description, amount and Group, and opens the one tapped', () => {
    const onOpen = vi.fn();
    const unconfirmed = draft({
      groupId: goa,
      groupName: 'Goa Friends Trip',
      description: 'Airport taxi',
      amount: '1150',
      unconfirmed: true,
    });
    const root = render(
      <ContinueDrafts
        drafts={[
          unconfirmed,
          draft({}),
          draft({ groupId: lisbon, groupName: 'Lisbon Offsite', description: ' ', amount: '' }),
        ]}
        onOpen={onOpen}
      />,
    );
    // A section's title keeps a hair space to spare (#639).
    expect(headers(root)).toEqual(['Continue where you left off\u200a']);
    expect(buttons(root).map((row) => row.props.accessibilityLabel)).toEqual([
      'Save not confirmed, Airport taxi, ₹1,150.00, Goa Friends Trip',
      'Draft, Weekly groceries, ₹1,249.50, Maple House',
      // Not yet valid: nothing is guessed.
      'Draft, No description, Lisbon Offsite',
    ]);
    const shown = text(root);
    expect(shown).toContain('Save not confirmed\u00a0· Goa Friends Trip');
    expect(shown).toContain('Draft\u00a0· Maple House');
    act(() =>
      button(root, 'Save not confirmed, Airport taxi, ₹1,150.00, Goa Friends Trip').props.onPress(),
    );
    expect(onOpen).toHaveBeenCalledWith(unconfirmed);
  });
});

describe('Home Groups', () => {
  const view = (
    groups: Partial<MobileSnapshot['groups']> = {},
    props: Partial<Parameters<typeof HomeGroups>[0]> = {},
  ) => {
    const handlers = { onNewGroup: vi.fn(), onOpen: vi.fn(), onRetry: vi.fn() };
    const root = render(
      <HomeGroups
        groups={{ status: 'ready', data: groupsList, message: null, loaded: true, ...groups }}
        byGroup={home().byGroup}
        newGroupLabel="New Group"
        {...handlers}
        {...props}
      />,
    );
    return { root, ...handlers };
  };

  it('says how many wait in To review on a Group’s row (#646)', () => {
    const { root } = view({}, { toReview: { [groupsList[0]!.id]: 3 } });
    expect(
      button(
        root,
        'Open Maple House, Household\u00a0· 3\u00a0members\u00a0· 3\u00a0to review, You owe ₹1,480.00',
      ),
    ).toBeDefined();
    expect(text(root)).toContain('Household\u00a0· 3\u00a0members\u00a0· 3\u00a0to review');
  });
  it('shows the member’s balance in each Group, its first currency and +N, or Settled up', () => {
    const { root, onOpen } = view();
    expect(headers(root)).toEqual(['Groups\u00a0· 4\u200a']);
    expect(buttons(root).map((row) => row.props.accessibilityLabel)).toEqual([
      'New Group',
      'Open Maple House, Household\u00a0· 3\u00a0members, You owe ₹1,480.00',
      'Open Goa Friends Trip, Trip\u00a0· 17–20 Sep\u00a0· 3\u00a0members, Owed to you ₹620.00, plus 1 more currency',
      // Not in the Home response, so nothing is claimed.
      'Open Lisbon Offsite, Work\u00a0· 4\u00a0members',
      'Open Sunday Football, General\u00a0· 8\u00a0members, Settled up',
    ]);
    const shown = text(root);
    expect(shown).toContain('₹1,480.00you owe');
    expect(shown).toContain('₹620.00owed to you\u00a0· +1');
    expect(shown).toContain('Settled up');
    act(() => button(root, 'Open Lisbon Offsite, Work\u00a0· 4\u00a0members').props.onPress());
    expect(onOpen).toHaveBeenCalledWith(lisbon);
  });

  it('opens a Group on a tap or a screen reader’s activate, never on a drag that starts on its row (#665)', () => {
    const { root, onOpen } = view();
    const row = button(root, 'Open Lisbon Offsite, Work\u00a0· 4\u00a0members');
    const landed = { pageX: 180, pageY: 420 };
    act(() => touchAlong(row, [landed, { pageX: 180, pageY: 330 }, { pageX: 181, pageY: 170 }]));
    expect(onOpen).not.toHaveBeenCalled();
    act(() => touchAlong(row, [landed, { pageX: 178, pageY: 423 }]));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(lisbon);
    act(() => activateWithScreenReader(row));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('keeps New Group, or continues an unfinished Group form', () => {
    const { root, onNewGroup } = view();
    act(() => button(root, 'New Group').props.onPress());
    expect(onNewGroup).toHaveBeenCalledTimes(1);
    const continuing = view({}, { newGroupLabel: 'Continue Group form' });
    expect(buttons(continuing.root)[0].props.accessibilityLabel).toBe('Continue Group form');
  });

  it('invites a first Group when there are none, and explains a failed read with a retry', () => {
    const empty = view({ data: [] });
    expect(headers(empty.root)).toEqual(['Groups\u00a0· 0\u200a']);
    expect(text(empty.root)).toContain('A shared space starts here.');
    act(() => button(empty.root, 'Refresh Groups').props.onPress());
    expect(empty.onRetry).toHaveBeenCalledTimes(1);

    const failed = view({ status: 'error', message: 'No connection.' });
    expect(text(failed.root)).toContain('Couldn’t load your Groups');
    expect(text(failed.root)).toContain('No connection. Showing previously verified Groups.');
    expect(text(failed.root)).toContain('Maple House');
    act(() => button(failed.root, 'Try again').props.onPress());
    expect(failed.onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows placeholders only for a list never read, and keeps an empty list while it is read again', () => {
    const placeholders = (root: ReactTestInstance) =>
      root.findAll((node) => node.props.accessibilityLabel === 'Loading your Groups');
    const first = view({ status: 'loading', data: [], loaded: false });
    expect(placeholders(first.root)).not.toHaveLength(0);
    expect(headers(first.root)).toEqual(['Groups\u200a']);

    const again = view({ status: 'loading', data: [], loaded: true });
    expect(placeholders(again.root)).toHaveLength(0);
    expect(headers(again.root)).toEqual(['Groups\u00a0· 0\u200a']);
    expect(text(again.root)).toContain('A shared space starts here.');
  });
});

// #639: on the emulator at density 160, Home's "Groups · 7" drew "Groups ·" and a settled
// Group's "Settled up" drew "Settled", at 100% and 130%: each label is as wide as its words, and
// Android, laying it out again to draw it, wrapped its last word out of sight. They keep room to
// spare, as do the captions under the balances.
describe.each(['light', 'dark'] as const)('Home Groups at large text in %s (#639)', (mode) => {
  it.each(largeTextWindows)(
    'keeps the count, the captions and Settled up whole, $width dp at $fontScale× text',
    (size) => {
      setWindow(size);
      const root = render(
        <ThemeContext.Provider value={getSemanticTokens(mode)}>
          <HomeGroups
            groups={{ status: 'ready', data: groupsList, message: null, loaded: true }}
            byGroup={home().byGroup}
            newGroupLabel="New Group"
            onNewGroup={vi.fn()}
            onOpen={vi.fn()}
            onRetry={vi.fn()}
          />
        </ThemeContext.Provider>,
      );
      for (const label of ['Groups\u00a0· 4', 'Settled up', 'you owe', 'New Group'])
        expect(labelRuns(root, label), label).toEqual([[label, hairSpace]]);
    },
  );
});

// #895: at 150% and 200% a line could start with "·". A line breaks only at an ordinary space,
// and a no-break space keeps each dot with what comes before it: the balances' "you owe · +1",
// the drafts' "Draft · Maple House", "Groups · 4" and each Group's "Trip · 17–20 Sep · 3 members".
it.each([1.5, 2])('never starts a line with a dot at %s× text (#895)', (fontScale) => {
  setWindow({ width: 360, height: 640, fontScale });
  render(
    <>
      <HomeBalances state={home()} onRefresh={vi.fn()} />
      <ContinueDrafts drafts={[draft({})]} onOpen={vi.fn()} />
      <HomeGroups
        groups={{ status: 'ready', data: groupsList, message: null, loaded: true }}
        byGroup={home().byGroup}
        newGroupLabel="New Group"
        onNewGroup={vi.fn()}
        onOpen={vi.fn()}
        onRetry={vi.fn()}
      />
    </>,
  );
  const lines = [renderer!.toJSON() as ReactTestRendererJSON | ReactTestRendererJSON[]]
    .flat()
    .flatMap(outerTexts)
    .map(wordsOf);
  expect(lines.filter((words) => words.includes('·')).length).toBeGreaterThanOrEqual(6);
  for (const words of lines) expect(words, words).not.toMatch(/(^|[ \n])·/);
});

// #898: at 150% a Group's row read "Household · 3 / members". A count and its noun, and "3 to
// review", are joined by a no-break space, so a line never breaks between them.
it.each([1.5, 2])('keeps each count with its noun at %s× text (#898)', (fontScale) => {
  setWindow({ width: 360, height: 640, fontScale });
  render(
    <HomeGroups
      groups={{ status: 'ready', data: groupsList, message: null, loaded: true }}
      byGroup={home().byGroup}
      toReview={{ [groupsList[0]!.id]: 3 }}
      newGroupLabel="New Group"
      onNewGroup={vi.fn()}
      onOpen={vi.fn()}
      onRetry={vi.fn()}
    />,
  );
  const lines = [renderer!.toJSON() as ReactTestRendererJSON | ReactTestRendererJSON[]]
    .flat()
    .flatMap(outerTexts)
    .map(wordsOf);
  expect(lines.filter((words) => /\d\u00a0members?/.test(words)).length).toBe(4);
  expect(lines).toContainEqual(expect.stringContaining('3\u00a0to review'));
  for (const words of lines) {
    expect(words, words).not.toMatch(countApart);
    expect(words, words).not.toMatch(/\d to review/);
  }
});

// #639: at 200% a Group's row read "QA Eu.." and "Genera.." beside its balance. A row's name and
// details take the lines they need from 150%, and its balance goes under them where it would
// leave them too narrow a column. At 130% a long name is still cut once (#332), but no word
// breaks in two.
describe.each(['light', 'dark'] as const)(
  'Home’s Group rows at large text in %s (#639)',
  (mode) => {
    it.each(largeTextWindows)('read in full, $width dp at $fontScale× text', (size) => {
      setWindow(size);
      act(() => {
        renderer = create(
          <ThemeContext.Provider value={getSemanticTokens(mode)}>
            <HomeGroups
              groups={{
                status: 'ready',
                data: [
                  ...groupsList,
                  group('b00000000000000000000009', 'Alex private test Group', 'other', 1),
                ],
                message: null,
                loaded: true,
              }}
              byGroup={home().byGroup}
              newGroupLabel="New Group"
              onNewGroup={vi.fn()}
              onOpen={vi.fn()}
              onRetry={vi.fn()}
            />
          </ThemeContext.Provider>,
        );
      });
      // Home's content is inset 16dp on each side.
      expect(
        unreadText(renderer!.toJSON() as ReactTestRendererJSON, size.fontScale, size.width - 32, {
          cutOnce: size.fontScale < 1.5,
        }),
      ).toEqual([]);
    });
  },
);

// #890: at 200% on a 360 dp phone, Your balances' "Owed to you" figure ran through the card's
// padding to its border, and the card hid the rest: "₹11,387.77" read "₹11,387.7", a wrong figure
// with no "…". Its header broke inside a word, "YOUR BALANC / ES", beside "Updated …". A figure
// that doesn't fit beside its label goes under it, at the row's end, and the time goes onto a line
// of its own where it can't share the header's, as To review's note does (#876).
describe.each(['light', 'dark'] as const)(
  'Home’s Your balances at large text in %s (#890)',
  (mode) => {
    const figure = '₹11,387.77';
    const balances = (size: { width: number; fontScale: number }) => {
      setWindow({ ...size, height: 640 });
      act(() => {
        renderer = create(
          <ThemeContext.Provider value={getSemanticTokens(mode)}>
            <HomeBalances
              state={home({ data: [{ currency: 'INR', youOwe: 11387.77, youAreOwed: 11387.77 }] })}
              onRefresh={vi.fn()}
            />
          </ThemeContext.Provider>,
        );
      });
      return renderer!.toJSON() as ReactTestRendererJSON;
    };
    /** The header's row: "Your balances" and the time beside or under it. */
    const headerRow = (tree: ReactTestRendererJSON) =>
      findHosts(tree, (_props, type) => type === 'View').find((node) =>
        (node.children ?? []).some(
          (child) => typeof child !== 'string' && child.props.accessibilityRole === 'header',
        ),
      )!;

    it.each(largeTextWindows)(
      'shows every digit of a 10-character figure and the whole header, $width dp at $fontScale× text',
      (size) => {
        expect(figure).toHaveLength(10);
        const tree = balances(size);
        expect(outerTexts(tree).filter((text) => wordsOf(text) === figure)).toHaveLength(2);
        // Home's content is inset 16dp on each side.
        expect(unreadText(tree, size.fontScale, size.width - 32)).toEqual([]);
      },
    );

    it('keeps each figure beside its label, and the time beside the header, at 100%', () => {
      const tree = balances({ width: 360, fontScale: 1 });
      expect(unreadText(tree, 1, 360 - 32)).toEqual([]);
      // The card's border and padding leave 298dp.
      const row = headerRow(tree);
      const tallest = Math.max(
        ...(row.children as ReactTestRendererJSON[]).map((child) => layoutHeight(child, 1, 298)),
      );
      expect(layoutHeight(row, 1, 298)).toBe(tallest);
    });
  },
);
