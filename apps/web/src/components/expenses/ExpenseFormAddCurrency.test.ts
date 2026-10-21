import { createElement, type ComponentType, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import { ThemeProvider as EmotionThemeProvider } from '@emotion/react';
import { THEME_ID } from '@mui/material/styles';
import type { GroupRead } from '@splitbook/shared/group-read';
import type { GroupCurrencySettings } from '@splitbook/shared/group-currency-settings';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import ExpenseFormDialog from './ExpenseFormDialog';

/*
 * #722, boards "Pick the Expense's currency" and "A member adds a currency": a member abroad adds
 * a currency to the Group straight from the Expense form's picker, and the Expense is then in it.
 * The server is a stand-in; MUI's dialog and menu render inline, since their portals need a
 * browser. Fictional Group and people.
 */

vi.mock('@mui/material/Dialog', () => ({
  default: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? createElement('div', { role: 'dialog' }, children) : null,
}));
vi.mock('@mui/material/Menu', () => ({
  default: ({
    open,
    children,
    slotProps,
  }: {
    open: boolean;
    children: ReactNode;
    slotProps?: { list?: Record<string, unknown> };
  }) => (open ? createElement('ul', { ...slotProps?.list }, children) : null),
}));
vi.mock('@/components/drafts/KeepExpenseDraft', () => ({
  default: () => null,
  useKeepExpenseDraft: () => ({ busy: false }),
}));
vi.mock('@/components/drafts/KeptInToReview', () => ({ default: () => null }));
vi.mock('./use-expense-draft-save', () => ({
  useExpenseDraftSave: () => ({
    save: async () => ({ status: 'kept' }),
    transportBusy: { current: false },
    mounted: { current: true },
  }),
}));

const requests = vi.hoisted(() => [] as { method: string; path: string; body: unknown }[]);
const answers = vi.hoisted(() => new Map<string, { status: number; body: unknown }>());
vi.mock('@/lib/utils/api-fetch', () => ({
  apiFetch: async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    requests.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const answer = answers.get(`${method} ${path}`) ?? {
      status: 500,
      body: { error: 'Unplanned' },
    };
    // Status 0: the request went out, and no reply came back.
    if (answer.status === 0) throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  },
}));

const GROUP = 'b00000000000000000000010';
const ALEX = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';
const iso = '2026-10-01T12:00:00.000Z';
const PATH = `/api/groups/${GROUP}/currencies`;

/** Lisbon & Tokyo: rupees, with euros and yen; Alex's latest Expense here was in yen. */
const lisbon = (alternateCurrencies = ['EUR', 'JPY']): GroupRead => ({
  _id: GROUP,
  name: 'Lisbon & Tokyo',
  description: '',
  image: undefined,
  createdBy: ALEX,
  members: [
    { user: { _id: ALEX, name: 'Alex Rivera', image: undefined }, role: 'admin', joinedAt: iso },
    { user: { _id: SAM, name: 'Sam Chen', image: undefined }, role: 'member', joinedAt: iso },
  ],
  tags: [
    {
      _id: 'c00000000000000000000001',
      name: 'Food',
      isArchived: false,
      isDeleted: false,
      createdAt: iso,
    },
  ],
  defaultCurrency: 'INR',
  currencyLocked: true,
  alternateCurrencies,
  latestExpenseCurrency: 'JPY',
  category: 'trip',
  startDate: null,
  endDate: null,
  isArchived: false,
  createdAt: iso,
  updatedAt: iso,
});
const unused = {
  expenses: { count: 0, items: [] },
  settlements: 0,
  toReview: { yours: 0, others: 0 },
};
/** The Group's currencies as the server answers an added one. */
const settings = (extras: string[]): GroupCurrencySettings => ({
  mainCurrency: { code: 'INR', locked: true },
  extraCurrencies: extras.map((code) => ({
    code,
    use: unused,
    added: { by: { _id: ALEX, name: 'Alex Rivera' }, at: iso },
  })),
});

/**
 * What MUI's fields and menus reach for once mounted (their owner window and document), stubbed
 * only after every module has loaded, so Emotion and SWR still treat this as the server.
 */
const browser = () => {
  const view = {
    addEventListener() {},
    removeEventListener() {},
    getComputedStyle: () => ({}),
    requestAnimationFrame: (run: () => void) => setTimeout(run, 0),
    cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  };
  const page = { defaultView: view, addEventListener() {}, removeEventListener() {} };
  return { view, page };
};
const node = () => ({
  style: {},
  focus() {},
  addEventListener() {},
  removeEventListener() {},
  ownerDocument: browser().page,
});

const AppTheme = EmotionThemeProvider as ComponentType<{ theme: object; children?: ReactNode }>;
let renderer: ReactTestRenderer;
async function mount(group = lisbon()) {
  await act(async () => {
    renderer = create(
      createElement(
        SWRConfig,
        { value: { provider: () => new Map(), dedupingInterval: 0 } },
        // The app's theme without MUI's ThemeProvider, whose layer order needs a browser.
        createElement(
          AppTheme,
          { theme: { [THEME_ID]: createAppTheme('light') } },
          createElement(ExpenseFormDialog, {
            open: true,
            onClose: () => {},
            groupId: GROUP,
            group,
            userId: ALEX,
          }),
        ),
      ),
      { createNodeMock: node },
    );
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
const hosts = (match: (node: ReactTestInstance) => boolean) =>
  renderer.root.findAll((node) => typeof node.type === 'string' && match(node));
const currencyButton = () =>
  hosts(
    (node) =>
      node.type === 'button' && String(node.props['aria-label'] ?? '').startsWith('Currency, '),
  )[0]!;
/** The picker's options, as read, once it is open. */
const options = () =>
  hosts((node) => node.props.role === 'listbox' && node.props['aria-label'] === 'Currency').flatMap(
    (list) =>
      list
        .findAll((node) => typeof node.type === 'string' && node.props.role === 'option')
        .map(textOf),
  );
const option = (starts: string) =>
  hosts((node) => node.props.role === 'option' && textOf(node).startsWith(starts))[0]!;
const addDialog = () =>
  hosts((node) => node.props.role === 'dialog').find((node) =>
    textOf(node).startsWith('Add a currency'),
  ) ?? null;
async function openPicker() {
  await act(async () => {
    currencyButton().props.onClick({ currentTarget: {} });
  });
}
async function click(node: ReactTestInstance) {
  await act(async () => {
    node.props.onClick({ currentTarget: {} });
  });
}
function buttonIn(scope: ReactTestInstance, name: string) {
  const found = scope
    .findAll((node) => node.type === 'button')
    .find((node) => node.props['aria-label'] === name || textOf(node) === name);
  if (!found) throw new Error(`Missing button ${name}`);
  return found;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const { view, page } = browser();
  vi.stubGlobal('window', view);
  vi.stubGlobal('document', page);
  vi.stubGlobal('requestAnimationFrame', view.requestAnimationFrame);
  vi.stubGlobal('cancelAnimationFrame', view.cancelAnimationFrame);
  requests.length = 0;
  answers.clear();
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

describe('adding a currency from the Expense form (#722)', () => {
  it('offers to add one from the picker, adds it to the Group and puts the Expense in it', async () => {
    answers.set(`POST ${PATH}`, { status: 201, body: { data: settings(['EUR', 'JPY', 'CHF']) } });
    await mount();
    await openPicker();
    expect(options()).toEqual([
      'JPY Japanese Yen Your latest Expense here',
      'INR Indian Rupee Main currency',
      'EUR Euro',
      'Add a currency… Adds it to Lisbon & Tokyo for everyone',
    ]);
    await click(option('Add a currency…'));
    const dialog = addDialog()!;
    expect(textOf(dialog)).toContain('Lisbon & Tokyo · 2 of 4 extra currencies');
    expect(textOf(dialog)).toContain(
      'INR, EUR and JPY are already on the list, so they aren’t shown.',
    );
    // The Group's own currencies aren't offered again.
    const offered = dialog
      .findAll((node) => typeof node.type === 'string' && node.props.role === 'option')
      .map((node) => textOf(node).split(' ')[0]);
    expect(offered).toContain('CHF');
    expect(offered).not.toContain('EUR');
    await click(
      dialog.findAll(
        (node) =>
          typeof node.type === 'string' &&
          node.props.role === 'option' &&
          textOf(node).startsWith('CHF'),
      )[0]!,
    );
    await click(buttonIn(addDialog()!, 'Add CHF'));
    expect(requests.filter(({ method }) => method === 'POST')).toEqual([
      { method: 'POST', path: PATH, body: { currency: 'CHF' } },
    ]);
    expect(addDialog()).toBeNull();
    expect(currencyButton().props['aria-label']).toBe(
      'Currency, CHF, Swiss Franc. Change currency',
    );
    // CHF is one of the Group's currencies now, not just this Expense's.
    await openPicker();
    expect(options()).toContain('CHF Swiss Franc');
  });

  it('keeps the Expense’s currency, and says why, when the Group refuses the one asked for', async () => {
    answers.set(`POST ${PATH}`, {
      status: 422,
      body: {
        error: 'A Group can have at most 4 extra currencies.',
        code: 'INVALID_GROUP_CURRENCIES',
      },
    });
    // The Group, read again after the refusal, still doesn't list CHF.
    answers.set(`GET /api/groups/${GROUP}`, {
      status: 200,
      body: { status: 200, data: lisbon(['EUR', 'JPY']) },
    });
    await mount();
    await openPicker();
    await click(option('Add a currency…'));
    await click(
      addDialog()!.findAll(
        (node) =>
          typeof node.type === 'string' &&
          node.props.role === 'option' &&
          textOf(node).startsWith('CHF'),
      )[0]!,
    );
    await click(buttonIn(addDialog()!, 'Add CHF'));
    expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
      `POST ${PATH}`,
      `GET /api/groups/${GROUP}`,
    ]);
    expect(textOf(addDialog())).toContain('A Group can have at most 4 extra currencies.');
    expect(currencyButton().props['aria-label']).toBe(
      'Currency, JPY, Japanese Yen. Change currency',
    );
  });

  // The Tester's Medium on 49d3c2ab: the currency was added, but the form never learnt it.
  it.each([
    ['its reply is lost on the way back', { status: 0, body: null }],
    [
      'the Group already lists it',
      {
        status: 422,
        body: {
          error: 'CHF is already one of this Group’s currencies.',
          code: 'INVALID_GROUP_CURRENCIES',
        },
      },
    ],
  ])(
    'when adding one fails because %s, reads the Group again and puts the Expense in it',
    async (_, answer) => {
      answers.set(`POST ${PATH}`, answer);
      // Splitbook added CHF: reading the Group again lists it.
      answers.set(`GET /api/groups/${GROUP}`, {
        status: 200,
        body: { status: 200, data: lisbon(['EUR', 'JPY', 'CHF']) },
      });
      await mount();
      await openPicker();
      await click(option('Add a currency…'));
      await click(
        addDialog()!.findAll(
          (node) =>
            typeof node.type === 'string' &&
            node.props.role === 'option' &&
            textOf(node).startsWith('CHF'),
        )[0]!,
      );
      await click(buttonIn(addDialog()!, 'Add CHF'));
      expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
        `POST ${PATH}`,
        `GET /api/groups/${GROUP}`,
      ]);
      expect(addDialog()).toBeNull();
      expect(currencyButton().props['aria-label']).toBe(
        'Currency, CHF, Swiss Franc. Change currency',
      );
      await openPicker();
      expect(options()).toContain('CHF Swiss Franc');
    },
  );

  it('lets a Group in one currency open the picker to add one', async () => {
    await mount({ ...lisbon([]), latestExpenseCurrency: null });
    expect(currencyButton().props.disabled).toBeFalsy();
    await openPicker();
    expect(options()).toEqual([
      'INR Indian Rupee Main currency',
      'Add a currency… Adds it to Lisbon & Tokyo for everyone',
    ]);
  });

  it('offers no more once the Group has 4 extra currencies', async () => {
    await mount(lisbon(['EUR', 'JPY', 'GBP', 'USD']));
    await openPicker();
    expect(options().some((name) => name.startsWith('Add a currency'))).toBe(false);
  });
});
