import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import type { ExpenseDraft } from '@splitbook/shared/expense-draft';
import type { GroupRead } from '@splitbook/shared/group-read';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import QuickAddExpense from './QuickAddExpense';

/*
 * #732: Quick add in Lisbon & Tokyo (main currency INR, extra currencies EUR and JPY), as the
 * board "Quick add with an unlisted currency" shows it. A line in Swiss francs can't be added
 * until the member adds CHF to the Group or reads the line in a listed currency instead; the
 * amount is never converted. The server and the save are stand-ins; MUI's menu renders inline,
 * since its portal needs a browser.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/groups/b00000000000000000000010/expenses',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@mui/material/Menu', () => ({
  default: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? createElement('div', { role: 'menu' }, children) : null,
}));
vi.mock('@/lib/web-read', () => ({
  fetchWebExpensePage: async () => ({ data: { expenses: [] } }),
}));

const requests = vi.hoisted(() => [] as { method: string; path: string; body: unknown }[]);
/** A status of 0 is a request whose reply never arrives. */
const answers = vi.hoisted(() => new Map<string, { status: number; body: unknown }>());
vi.mock('@/lib/utils/api-fetch', () => ({
  apiFetch: async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    requests.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const answer = answers.get(`${method} ${path}`) ?? {
      status: 500,
      body: { error: 'Unplanned' },
    };
    if (answer.status === 0) throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  },
}));
const saved = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('./use-expense-draft-save', () => ({
  useExpenseDraftSave: () => ({
    save: async (draft: ExpenseDraft) => {
      saved.push({ ...draft.values });
      return { status: 'saved' };
    },
  }),
}));

const GROUP = 'b00000000000000000000010';
const ALEX = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';
const PRIYA = 'a00000000000000000000003';
const CURRENCIES = `/api/groups/${GROUP}/currencies`;
const GROUP_READ = `/api/groups/${GROUP}`;

function lisbon(alternateCurrencies: string[]): GroupRead {
  return {
    _id: GROUP,
    name: 'Lisbon & Tokyo',
    description: '',
    createdBy: ALEX,
    defaultCurrency: 'INR',
    currencyLocked: true,
    alternateCurrencies,
    category: 'trip',
    startDate: null,
    endDate: null,
    isArchived: false,
    tags: [
      {
        _id: 'd00000000000000000000002',
        name: 'Food',
        isArchived: false,
        isDeleted: false,
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ],
    members: [
      [ALEX, 'Alex Rivera'],
      [SAM, 'Sam Chen'],
      [PRIYA, 'Priya Shah'],
    ].map(([id, name]) => ({
      user: { _id: id, name, email: `${name.split(' ')[0].toLowerCase()}@example.test` },
      role: 'member',
      joinedAt: '2026-09-01T00:00:00.000Z',
    })),
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  } as unknown as GroupRead;
}

let renderer: ReactTestRenderer;

function element(group: GroupRead) {
  return createElement(
    SWRConfig,
    { value: { provider: () => new Map(), dedupingInterval: 0 } },
    createElement(
      ThemeProvider,
      { theme: createAppTheme('light') },
      createElement(QuickAddExpense, { groupId: GROUP, userId: ALEX, group }),
    ),
  );
}

async function mount(group: GroupRead) {
  await act(async () => {
    renderer = create(element(group), {
      createNodeMock: () => ({ focus() {}, addEventListener() {}, removeEventListener() {} }),
    });
  });
}

/** A node's text as read: elements apart, the pieces of one text run together. */
const textOf = (node: ReactTestInstance | null): string =>
  node
    ? node.children
        .map((child) => (typeof child === 'string' ? child : ` ${textOf(child)} `))
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
const shown = () => textOf(renderer.root);
function buttonNamed(name: string) {
  return renderer.root
    .findAll(
      (node) => node.type === 'button' || (node.type === 'li' && node.props.role === 'menuitem'),
    )
    .find((node) => textOf(node).replace(/\s*↵$/, '') === name);
}
async function press(name: string) {
  const found = buttonNamed(name);
  if (!found) throw new Error(`Missing button ${name}`);
  await act(async () => {
    found.props.onClick({ currentTarget: {} });
  });
}
async function type(value: string) {
  const field = renderer.root.findByType('input');
  await act(async () => {
    field.props.onChange({ target: { value } });
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // The theme looks for a colour-scheme attribute on the page; there is none here.
  vi.stubGlobal('document', { querySelector: () => null });
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  requests.length = 0;
  answers.clear();
  saved.length = 0;
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

describe('Quick add with a currency the Group doesn’t list (#732)', () => {
  it('adds the currency to the Group, then reads the line as one of its currencies', async () => {
    answers.set(`POST ${CURRENCIES}`, { status: 201, body: { data: {} } });
    await mount(lisbon(['EUR', 'JPY']));
    await type('CHF 86 dinner in Zürich');
    expect(shown()).toContain('Amount · not on the list CHF 86.00');
    expect(shown()).toContain('CHF isn’t one of Lisbon & Tokyo’s currencies.');

    await press('Add CHF to Lisbon & Tokyo');
    expect(requests).toContainEqual({
      method: 'POST',
      path: CURRENCIES,
      body: { currency: 'CHF' },
    });

    // The Group's read comes back with CHF on its list.
    await act(async () => renderer.update(element(lisbon(['EUR', 'JPY', 'CHF']))));
    expect(shown()).toContain('Amount CHF 86.00');
    expect(shown()).toContain('Read as CHF, one of Lisbon & Tokyo’s currencies.');
    expect(buttonNamed('Add CHF to Lisbon & Tokyo')).toBeUndefined();
  });

  it('says why the currency couldn’t be added, and keeps the line', async () => {
    answers.set(`POST ${CURRENCIES}`, {
      status: 409,
      body: { error: 'A Group can have at most 4 extra currencies.' },
    });
    // Read again, the Group still doesn't list CHF, so the refusal stands.
    answers.set(`GET ${GROUP_READ}`, {
      status: 200,
      body: { status: 200, data: lisbon(['EUR', 'JPY']) },
    });
    await mount(lisbon(['EUR', 'JPY']));
    await type('CHF 86 dinner in Zürich');
    await press('Add CHF to Lisbon & Tokyo');
    expect(shown()).toContain('A Group can have at most 4 extra currencies.');
    expect(shown()).not.toContain('CHF added');
    expect(renderer.root.findByType('input').props.value).toBe('CHF 86 dinner in Zürich');
  });

  it('takes CHF as added when its reply is lost but the Group, read again, lists it', async () => {
    answers.set(`POST ${CURRENCIES}`, { status: 0, body: null });
    answers.set(`GET ${GROUP_READ}`, {
      status: 200,
      body: { status: 200, data: lisbon(['EUR', 'JPY', 'CHF']) },
    });
    await mount(lisbon(['EUR', 'JPY']));
    await type('CHF 86 dinner in Zürich');
    await press('Add CHF to Lisbon & Tokyo');
    expect(requests.map(({ method, path }) => `${method} ${path}`)).toContain(`GET ${GROUP_READ}`);
    expect(shown()).not.toContain('Couldn’t add the currency');
    expect(shown()).toContain('CHF added to Lisbon & Tokyo.');
  });

  it('takes an “already listed” refusal as added once the Group, read again, lists it', async () => {
    answers.set(`POST ${CURRENCIES}`, {
      status: 409,
      body: { error: 'CHF is already one of this Group’s currencies.' },
    });
    answers.set(`GET ${GROUP_READ}`, {
      status: 200,
      body: { status: 200, data: lisbon(['EUR', 'JPY', 'CHF']) },
    });
    await mount(lisbon(['EUR', 'JPY']));
    await type('CHF 86 dinner in Zürich');
    await press('Add CHF to Lisbon & Tokyo');
    expect(shown()).not.toContain('already one of');
    expect(shown()).toContain('CHF added to Lisbon & Tokyo.');
  });

  it('keeps the lost reply’s words when the Group can’t be read again', async () => {
    answers.set(`POST ${CURRENCIES}`, { status: 0, body: null });
    await mount(lisbon(['EUR', 'JPY']));
    await type('CHF 86 dinner in Zürich');
    await press('Add CHF to Lisbon & Tokyo');
    expect(shown()).toContain('Couldn’t add the currency. Check your connection and try again.');
  });

  it('reads the line in another of the Group’s currencies and adds it there, unconverted', async () => {
    await mount(lisbon(['EUR', 'JPY']));
    await type('CHF 86 dinner in Zürich');
    await press('Use another currency');
    expect(
      renderer.root
        .findAll((node) => node.type === 'li' && node.props.role === 'menuitem')
        .map(textOf),
    ).toEqual(['INR', 'EUR', 'JPY']);
    await press('EUR');
    expect(shown()).toContain('Amount €86.00');
    expect(requests.filter((request) => request.method !== 'GET')).toEqual([]);

    await press('Add expense');
    expect(saved).toEqual([expect.objectContaining({ currency: 'EUR', amount: '86' })]);
    expect(shown()).toContain('Added Dinner in Zürich, €86.00.');
  });
});
