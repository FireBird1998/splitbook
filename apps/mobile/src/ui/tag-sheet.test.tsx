import type { ComponentProps, ReactElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  draftFromExpense,
  emptyExpenseEditor,
  parseExpenseContext,
  type ExpenseDraft,
  type ExpenseEditor as Editor,
} from '../data/expense-draft';
import { expenseRecordSchema } from '../data/expense-record';
import { ExpenseEditor } from './expense-editor';
import { TagSheet } from './tag-sheet';

// #124: the Tag sheet and how the form reports a Tag the Group no longer offers, rendered.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const memberId = 'a00000000000000000000001';
const groupId = 'a00000000000000000000010';
const groceries = 'a00000000000000000000020';
const utilities = 'a00000000000000000000021';
const party = 'a00000000000000000000022';
const removed = 'a00000000000000000000023';
const iso = '2026-09-28T10:00:00.000Z';
const alex = { _id: memberId, name: 'Alex', email: 'alex@example.test', image: null };
const tag = (_id: string, name: string, extra = {}) => ({ _id, name, createdAt: iso, ...extra });
const groupWith = (tags: object[]) => ({
  _id: groupId,
  createdBy: memberId,
  name: 'Maple House',
  category: 'home',
  defaultCurrency: 'INR',
  members: [{ user: alex, role: 'admin', joinedAt: iso }],
  tags,
  createdAt: iso,
  updatedAt: iso,
});
const allTags = [
  tag(groceries, 'Groceries'),
  tag(utilities, 'Utilities'),
  tag(party, 'Party supplies', { isArchived: true }),
  tag(removed, 'Old rent', { isDeleted: true }),
];
const draft: ExpenseDraft = {
  amount: '12.50',
  currency: 'INR',
  description: 'Balloons',
  date: '2026-09-28',
  payerId: memberId,
  multiPayer: false,
  payers: [],
  splitMethod: 'equal',
  splitValues: {},
  participantIds: [memberId],
  category: 'other',
  tagId: '',
  notes: '',
};
const editor = (patch: Partial<Editor> = {}, tags = allTags): Editor => ({
  ...emptyExpenseEditor(),
  groupId,
  context: parseExpenseContext({ status: 200, data: groupWith(tags) }),
  draft,
  status: 'editing',
  ...patch,
});
const inactive =
  '“Party supplies” is no longer active in this Group. Choose another Tag; nothing is swapped in for you.';

const isHost = (node: ReactTestInstance, name: string) => (node.type as unknown) === name;
const text = (scope: ReactTestInstance) =>
  scope
    .findAll((node) => isHost(node, 'Text'))
    .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    .join('');
const openSheet = (root: ReactTestInstance) =>
  root.findAll((node) => isHost(node, 'Modal') && node.props.visible === true);
const radios = (scope: ReactTestInstance) =>
  scope.findAll((node) => isHost(node, 'Pressable') && node.props.accessibilityRole === 'radio');
const labelled = (scope: ReactTestInstance, label: string) =>
  scope.findAll((node) => typeof node.type === 'string' && node.props.accessibilityLabel === label);

let screen: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => screen?.unmount());
  screen = null;
});
function render(element: ReactElement) {
  act(() => {
    screen = create(element);
  });
  return screen!.root;
}

describe('Tag sheet', () => {
  const tags = [
    { id: groceries, name: 'Groceries' },
    { id: utilities, name: 'Utilities' },
    { id: party, name: 'Shared meal' },
  ];
  const props = (patch: Partial<ComponentProps<typeof TagSheet>> = {}) => ({
    visible: true,
    tags,
    tagId: groceries,
    locked: false,
    onChoose: vi.fn(),
    onDone: vi.fn(),
    ...patch,
  });
  const search = (root: ReactTestInstance, query: string) =>
    act(() => labelled(root, 'Search Tags')[0].props.onChangeText(query));

  it('lists the Tags as radios with the draft’s Tag checked, and says where to manage them', () => {
    const root = render(<TagSheet {...props()} />);
    const group = labelled(root, 'Tag').find(
      (node) => node.props.accessibilityRole === 'radiogroup',
    );
    expect(group).toBeTruthy();
    expect(radios(group!).map((radio) => radio.props.accessibilityLabel)).toEqual([
      'Tag: Groceries',
      'Tag: Utilities',
      'Tag: Shared meal',
    ]);
    expect(radios(root).map((radio) => radio.props.accessibilityState)).toEqual([
      { checked: true, disabled: false },
      { checked: false, disabled: false },
      { checked: false, disabled: false },
    ]);
    expect(labelled(root, 'Search Tags')[0].props).toMatchObject({
      placeholder: 'Search Tags',
      value: '',
    });
    expect(text(root)).toContain(
      'Only this Group’s active Tags are listed. Manage Tags on the web.',
    );
  });

  it('narrows the list as the member searches, ignoring case', () => {
    const root = render(<TagSheet {...props()} />);
    search(root, '  SHARED ');
    expect(radios(root).map((radio) => radio.props.accessibilityLabel)).toEqual([
      'Tag: Shared meal',
    ]);
    search(root, 'rent');
    expect(radios(root)).toEqual([]);
    expect(text(root)).toContain('No Tags match “rent”.');
  });

  it('clears the search when it closes', () => {
    const root = render(<TagSheet {...props()} />);
    search(root, 'util');
    act(() => screen!.update(<TagSheet {...props({ visible: false })} />));
    act(() => screen!.update(<TagSheet {...props()} />));
    expect(labelled(root, 'Search Tags')[0].props.value).toBe('');
    expect(radios(root)).toHaveLength(3);
  });

  it('chooses a Tag with one tap, but not while the draft is locked', () => {
    const open = props();
    const root = render(<TagSheet {...open} />);
    act(() => labelled(root, 'Tag: Utilities')[0].props.onPress());
    expect(open.onChoose).toHaveBeenCalledWith(utilities);

    const locked = props({ locked: true });
    act(() => screen!.update(<TagSheet {...locked} />));
    const radio = labelled(root, 'Tag: Utilities')[0];
    expect(radio.props).toMatchObject({
      disabled: true,
      accessibilityState: { checked: false, disabled: true },
    });
    act(() => radio.props.onPress());
    expect(locked.onChoose).not.toHaveBeenCalled();
  });

  it('explains that a Tag must be added on the web when the Group has none active', () => {
    const root = render(<TagSheet {...props({ tags: [], tagId: '' })} />);
    expect(text(root)).toContain(
      'This Group has no active Tags. Add one on the web, then reopen this draft.',
    );
    expect(labelled(root, 'Search Tags')).toEqual([]);
    expect(radios(root)).toEqual([]);
    expect(text(root)).not.toContain('Only this Group’s active Tags are listed.');
  });

  it('asks for a connection when the Group’s Tags can’t be checked', () => {
    const root = render(<TagSheet {...props({ tags: null })} />);
    expect(text(root)).toContain('Connect to see this Group’s Tags.');
    expect(radios(root)).toEqual([]);
  });
});

describe('Tag in the Expense form', () => {
  const calls = { change: vi.fn(), leave: vi.fn() };
  afterEach(() => {
    calls.change.mockClear();
    calls.leave.mockClear();
  });
  const noop = () => undefined;
  const form = (state: Editor) =>
    render(
      <ExpenseEditor
        state={state}
        currentUserId={memberId}
        onChange={calls.change}
        onLeaveField={calls.leave}
        onSave={noop}
        onResume={noop}
        onDiscard={noop}
        onRetry={noop}
        onEdit={noop}
        onReviewDelete={noop}
        onDelete={noop}
        onCancelDelete={noop}
        onReconcile={noop}
        onReviewLatest={noop}
        onAcceptCurrent={noop}
      />,
    );
  const tile = (root: ReactTestInstance) =>
    root.find(
      (node) =>
        isHost(node, 'Pressable') &&
        node.props.accessibilityRole === 'button' &&
        String(node.props.accessibilityLabel).startsWith('Tag'),
    );
  // Sheets stay mounted while hidden; the form is the screen's first scroll view.
  const body = (root: ReactTestInstance) => root.findAll((node) => isHost(node, 'ScrollView'))[0];
  const openTags = (root: ReactTestInstance) => {
    act(() => tile(root).props.onPress());
    const sheets = openSheet(root);
    expect(sheets).toHaveLength(1);
    return sheets[0];
  };

  it('offers only the Group’s active Tags and closes once one is chosen', () => {
    const root = form(editor());
    const sheet = openTags(root);
    expect(radios(sheet).map((radio) => radio.props.accessibilityLabel)).toEqual([
      'Tag: Groceries',
      'Tag: Utilities',
    ]);
    act(() => labelled(sheet, 'Tag: Groceries')[0].props.onPress());
    expect(calls.change).toHaveBeenCalledWith({ tagId: groceries });
    expect(openSheet(root)).toEqual([]);
  });

  it('reports an inactive draft Tag on its tile and in the sheet, and swaps nothing in', () => {
    const root = form(editor({ draft: { ...draft, tagId: party } }));
    // Shown at once: the member didn't mistype it, and it can't be saved.
    expect(tile(root).props.accessibilityLabel).toBe(`Tag, required: Party supplies. ${inactive}`);
    expect(JSON.stringify(tile(root).props.style({ pressed: false }))).toContain('"borderWidth":2');
    expect(labelled(body(root), inactive)).toHaveLength(1);

    const sheet = openTags(root);
    expect(text(sheet)).toContain(inactive);
    expect(radios(sheet).every((radio) => !radio.props.accessibilityState.checked)).toBe(true);
    act(() => labelled(sheet, 'Done')[0].props.onPress());
    expect(calls.leave).toHaveBeenCalledWith('tag');
    expect(calls.change).not.toHaveBeenCalled();
    expect(tile(root).props.accessibilityLabel).toContain('Party supplies');
  });

  it('keeps an edited Expense’s inactive Tag, saying so without a correction', () => {
    const original = expenseRecordSchema.parse({
      _id: 'a00000000000000000000030',
      group: groupId,
      description: 'Balloons',
      amount: 12.5,
      currency: 'INR',
      revision: 1,
      splitMethod: 'equal',
      paidBy: [{ user: { _id: memberId, name: 'Alex' }, amount: 12.5 }],
      splitBetween: [{ user: { _id: memberId, name: 'Alex' }, amount: 12.5 }],
      date: iso,
      createdAt: iso,
      updatedAt: iso,
      category: 'other',
      tagId: party,
      tag: 'Party supplies',
      isDeleted: false,
    });
    const root = form(editor({ draft: draftFromExpense(original) }));
    const kept = '“Party supplies” is no longer active in this Group. This Expense keeps it.';
    expect(tile(root).props.accessibilityLabel).toBe('Tag, required: Party supplies');
    expect(text(body(root))).toContain(kept);
    expect(text(root)).not.toContain('Choose another Tag');
    expect(text(openTags(root))).toContain(kept);
  });

  it('explains in the sheet, not the form, that a Group without active Tags needs one added on the web', () => {
    const root = form(editor({}, [tag(party, 'Party supplies', { isArchived: true })]));
    const explanation =
      'This Group has no active Tags. Add one on the web, then reopen this draft.';
    expect(text(body(root))).not.toContain(explanation);
    const sheet = openTags(root);
    expect(text(sheet)).toContain(explanation);
    expect(radios(sheet)).toEqual([]);
  });
});
