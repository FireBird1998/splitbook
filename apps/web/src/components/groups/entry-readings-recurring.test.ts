import { normalizeExpenseMoney } from '@splitbook/shared/exact-money';
import { recording } from '@splitbook/shared/test-support/expense-entry-recording';
import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { ThemeProvider } from '@mui/material/styles';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Checkbox from '@mui/material/Checkbox';
import { SWRConfig } from 'swr';
import { afterEach, expect, it, vi } from 'vitest';
import { MoneyTextField } from '@/components/ui/MoneyInput';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import RecurringExpensesSection from './RecurringExpensesSection';
import {
  entries,
  alex,
  people,
  groupId,
  tagId,
  day,
  savedExpense,
  type TypedEntry,
  type Reading,
} from '@splitbook/shared/test-support/expense-entry-cases';

// DOM boundary only: the real form and its fields run; portals render inline in Node.
vi.mock('@mui/material/Dialog', () => ({
  default: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? createElement('div', { role: 'dialog' }, children) : null,
}));
vi.mock('@mui/material/Menu', () => ({
  default: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? createElement('ul', {}, children) : null,
}));
let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const text = (node: ReactTestInstance): string =>
  node.type === 'style'
    ? ''
    : node.children
        .map((c) => (typeof c === 'string' ? c : ' ' + text(c) + ' '))
        .join('')
        .replace(/[\t\r\n ]+/g, ' ')
        .trim();

async function read(
  row: TypedEntry,
  edit: boolean,
  roundTrip = false,
  changeGroup = false,
): Promise<Reading> {
  if (row.multiPayer || row.savedZeroPayer)
    return {
      result: {
        kind: 'unsupported',
        reason:
          'The recurring form has one payer and no separate payer-amount entry or multi-payer mode.',
      },
    };
  const template = {
    ...savedExpense,
    _id: 'f00000000000000000000001',
    startsOn: day,
    endsOn: null,
    dayOfMonth: 1,
    isPaused: false,
    createdBy: alex,
  };
  let sent: unknown;
  vi.stubGlobal('fetch', async (_path: string, init?: RequestInit) => {
    if (init?.method === 'POST' || init?.method === 'PATCH') {
      sent = JSON.parse(String(init.body));
      const status = init.method === 'POST' ? 201 : 200;
      const recorded = {
        ...template,
        ...(sent as object),
        ...normalizeExpenseMoney(sent as Parameters<typeof normalizeExpenseMoney>[0]),
        revision: edit ? 2 : 0,
      };
      return Response.json({ status, data: recorded }, { status });
    }
    return Response.json({ status: 200, data: edit ? [template] : [] });
  });
  const tree = (currency = 'INR', groupPeople = people) =>
    createElement(
      SWRConfig,
      { value: { provider: () => new Map(), dedupingInterval: 0 } },
      createElement(
        ThemeProvider,
        { theme: createAppTheme('light') },
        createElement(RecurringExpensesSection, {
          groupId,
          defaultCurrency: currency,
          viewerId: alex,
          onNotify: () => {},
          tags: [
            {
              _id: tagId,
              name: 'Shared',
              isArchived: false,
              isDeleted: false,
              createdAt: day + 'T00:00:00.000Z',
            },
          ],
          members: groupPeople.map((p) => ({
            user: { _id: p.id, name: p.name, image: undefined },
            role: 'member' as const,
            joinedAt: day + 'T00:00:00.000Z',
          })),
        }),
      ),
    );
  await act(async () => {
    renderer = create(tree(), {
      createNodeMock: () => ({
        style: {},
        focus() {},
        addEventListener() {},
        removeEventListener() {},
        scrollIntoView() {},
      }),
    });
  });
  const root = () => renderer!.root;
  if (edit) {
    await act(async () =>
      root()
        .findAllByType('button')
        .find((n) => n.props['aria-label']?.startsWith('Actions for recurring'))!
        .props.onClick({ currentTarget: {} }),
    );
    await act(async () =>
      root()
        .findAllByType(MenuItem)
        .find((n) => text(n) === 'Edit')!
        .props.onClick(),
    );
  } else
    await act(async () =>
      root()
        .findAllByType('button')
        .find((n) => text(n) === 'Add')!
        .props.onClick(),
    );
  const field = (label: string) =>
    root()
      .findAllByType(TextField)
      .find((n) => n.props.label === label)!;
  const change = async (label: string, value: string) =>
    act(async () => field(label).props.onChange({ target: { value } }));
  await change('Description', row.description);
  await change('Category', row.category);
  await change('Tag', row.tagId);
  await act(async () => root().findAllByType(MoneyTextField)[0].props.onValueChange(row.amount));
  await change('Starts on', day);
  await change('Paid by', row.payerId);
  // This form offers Exact amounts for the entry's Amounts choice, never `unequal`.
  const method = row.splitMethod === 'unequal' ? 'exact' : row.splitMethod;
  await change('Split method', method);
  for (const index of people.keys()) {
    if (!root().findAllByType(Checkbox)[index].props.checked)
      await act(async () =>
        root()
          .findAllByType(Checkbox)
          [index].props.onChange({ target: { checked: true } }),
      );
  }
  for (const [index, person] of people.entries()) {
    const value = row.splitValues[person.id] ?? '';
    if (method === 'exact')
      await act(async () =>
        root().findAllByType(MoneyTextField)[index + 1].props.onValueChange(value),
      );
    else if (method !== 'equal')
      await act(async () =>
        root()
          .findAllByType(TextField)
          .filter((n) => n.props.label === (method === 'shares' ? 'Shares' : '%'))
          [index].props.onChange({ target: { value } }),
      );
  }
  // Type first, then untick: this proves an unticked person's retained text is ignored.
  for (const [index, person] of people.entries())
    if (!row.participantIds.includes(person.id))
      await act(async () =>
        root()
          .findAllByType(Checkbox)
          [index].props.onChange({ target: { checked: false } }),
      );
  if (roundTrip) {
    await change('Split method', 'shares');
    const shares = () =>
      root()
        .findAllByType(TextField)
        .filter((n) => n.props.label === 'Shares');
    expect(shares().map((n) => n.props.value)).toEqual(['1', '1']);
    await act(async () => shares()[0].props.onChange({ target: { value: '7' } }));
    await change('Split method', 'exact');
    expect(
      root()
        .findAllByType(MoneyTextField)
        .slice(1)
        .map((n) => n.props.value),
    ).toEqual(['60', '40']);
    await change('Split method', 'shares');
    expect(shares().map((n) => n.props.value)).toEqual(['7', '1']);
  }
  if (changeGroup) {
    await act(async () =>
      renderer!.update(
        tree('JPY', [people[1], { id: 'a00000000000000000000004', name: 'New Person' }]),
      ),
    );
    await act(async () =>
      root()
        .findAllByType(Checkbox)[0]
        .props.onChange({ target: { checked: false } }),
    );
    await act(async () =>
      root()
        .findAllByType(Checkbox)[0]
        .props.onChange({ target: { checked: true } }),
    );
    await act(async () => renderer!.update(tree()));
    expect(root().findAllByType(Checkbox)[0].props.checked).toBe(true);
    await act(async () =>
      renderer!.update(
        tree('JPY', [people[1], { id: 'a00000000000000000000004', name: 'New Person' }]),
      ),
    );
    // Existing boxes follow the latest Group; newly arriving members get boxes on the next open.
    expect(root().findAllByType(Checkbox)).toHaveLength(1);
  }
  const before = text(root());
  const fields = root()
    .findAllByType(TextField)
    .map((n) => ({ label: n.props.label ?? '', value: n.props.value }));
  await act(async () =>
    root()
      .findAllByType('button')
      .find((n) => text(n) === (edit ? 'Save changes' : 'Add recurring expense'))!
      .props.onClick(),
  );
  const errors = root()
    .findAll((n) => typeof n.type === 'string' && n.props.role === 'alert')
    .map(text);
  const result: Reading = {
    result: sent
      ? { kind: 'command', value: sent }
      : { kind: 'refusal', issues: errors.map((message) => ({ field: '', message })) },
    shown: { methodOffered: method, fields, before, errors, roundingNote: null },
  };
  expect(sent !== undefined || errors.length > 0, row.id).toBe(true);
  await act(async () => renderer!.unmount());
  renderer = undefined;
  return result;
}
it('records recurring Add and Edit through the actual form controls (#1111)', async () => {
  // The template's relative date label is part of the recording; midnight must not change it.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(day + 'T12:00:00'));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', {
    location: { hash: '' },
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal('document', { querySelector: () => null, getElementById: () => null });
  const cells: Record<string, Reading & { edit: Reading }> = {};
  for (const row of entries)
    cells[row.id] = { ...(await read(row, false)), edit: await read(row, true) };
  await expect(await recording(cells)).toMatchFileSnapshot(
    '../../../../../test/expense-entry-readings/recordings/web-recurring.json',
  );
  // One test drives the real dialog through 62 entries; a CI runner needs more than the default.
}, 120_000);
it('preserves separately typed amounts and shares across a split-method round trip', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', {
    location: { hash: '' },
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal('document', { querySelector: () => null, getElementById: () => null });
  await read(
    {
      ...entries[0],
      splitMethod: 'exact',
      splitValues: { [people[0].id]: '60', [people[1].id]: '40' },
    },
    false,
    true,
  );
});

it('uses the current Group currency and members if its read changes while the dialog is open', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', {
    location: { hash: '' },
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal('document', { querySelector: () => null, getElementById: () => null });
  const cell = await read({ ...entries[0], payerId: people[1].id }, false, false, true);
  expect(cell.result).toMatchObject({
    kind: 'command',
    value: { currency: 'JPY', splitBetween: [{ user: people[1].id }] },
  });
});
