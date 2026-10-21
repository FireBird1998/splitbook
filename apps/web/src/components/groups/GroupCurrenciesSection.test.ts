import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import type { GroupCurrencySettings } from '@splitbook/shared/group-currency-settings';
import GroupCurrenciesSection from './GroupCurrenciesSection';

/*
 * #721: the Currencies section's dialogs, as the boards "Remove refused while in use" and "A member
 * adds a currency" show them: a removal still in use is explained without asking the server, an
 * unused one is removed after asking, and a member adds a currency found by a search. The server
 * is a stand-in; MUI's dialog renders inline, since its portal needs a browser.
 */

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement('a', { href }, children),
}));
vi.mock('@mui/material/Dialog', () => ({
  default: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? createElement('div', { role: 'dialog' }, children) : null,
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
    // A saved change is what the Group's currencies read returns next, as on the server.
    if (method !== 'GET' && answer.status < 300)
      answers.set(`GET ${path.replace(/\/[A-Z]{3}$/, '')}`, answer);
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  },
}));

const GROUP = 'b00000000000000000000010';
const ALEX = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';
const PATH = `/api/groups/${GROUP}/currencies`;
const unused = {
  expenses: { count: 0, items: [] },
  settlements: 0,
  toReview: { yours: 0, others: 0 },
};
const by = (id: string, name: string) => ({
  by: { _id: id, name },
  at: '2026-10-01T12:00:00.000Z',
});

/** Lisbon & Tokyo: yen used by two Expenses and two of Sam's To review items, pounds by nothing. */
const lisbonAndTokyo: GroupCurrencySettings = {
  mainCurrency: { code: 'INR', locked: true },
  extraCurrencies: [
    {
      code: 'JPY',
      use: {
        expenses: {
          count: 2,
          items: [
            { _id: 'e00000000000000000000001', description: 'Ramen at Ichiran' },
            { _id: 'e00000000000000000000002', description: 'Taxi to Haneda' },
          ],
        },
        settlements: 0,
        toReview: { yours: 0, others: 2 },
      },
      added: by(SAM, 'Sam'),
    },
    { code: 'GBP', use: unused, added: by(ALEX, 'Alex') },
  ],
};

let renderer: ReactTestRenderer;
const notices: string[] = [];

async function mount(isAdmin: boolean) {
  answers.set(`GET ${PATH}`, { status: 200, body: { data: lisbonAndTokyo } });
  await act(async () => {
    renderer = create(
      createElement(
        SWRConfig,
        { value: { provider: () => new Map(), dedupingInterval: 0 } },
        createElement(GroupCurrenciesSection, {
          groupId: GROUP,
          groupName: 'Lisbon & Tokyo',
          viewerId: isAdmin ? ALEX : SAM,
          isAdmin,
          adminNames: isAdmin ? [] : ['Alex'],
          onNotify: (message: string) => notices.push(message),
        }),
      ),
      { createNodeMock: () => ({ focus() {}, addEventListener() {}, removeEventListener() {} }) },
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
const dialog = () =>
  renderer.root.findAll((node) => node.type === 'div' && node.props.role === 'dialog')[0] ?? null;
function buttonIn(scope: ReactTestInstance, name: string) {
  const found = scope
    .findAll((node) => node.type === 'button')
    .find((node) => node.props['aria-label'] === name || textOf(node) === name);
  if (!found) throw new Error(`Missing button ${name}`);
  return found;
}
async function press(scope: ReactTestInstance, name: string) {
  await act(async () => {
    buttonIn(scope, name).props.onClick();
  });
}
const rowCodes = () =>
  renderer.root
    .findAll((node) => node.type === 'li')
    .map((row) => textOf(row).split(' ')[0])
    .filter((code) => /^[A-Z]{3}$/.test(code));

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  requests.length = 0;
  answers.clear();
  notices.length = 0;
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

describe('removing an extra currency (#721)', () => {
  it('explains one still in use, without asking the server, and lists its Expenses', async () => {
    await mount(true);

    await press(renderer.root, 'Remove JPY');

    expect(textOf(dialog())).toContain('JPY can’t be removed yet');
    expect(textOf(dialog())).toContain(
      'Lisbon & Tokyo still uses JPY. Change these to another currency, or delete them, then remove it.',
    );
    expect(textOf(dialog())).toContain('2 Expenses Ramen at Ichiran and Taxi to Haneda');
    expect(textOf(dialog())).toContain(
      '2 items in members’ To review Only their owners can see them. They need to save, change or delete them.',
    );
    expect(textOf(dialog())).toContain(
      'Removing GBP works now, because nothing uses it. Removing asks you to confirm, and Activity shows who removed it.',
    );
    expect(requests.filter(({ method }) => method !== 'GET')).toEqual([]);

    await press(dialog()!, 'Show them');
    expect(
      dialog()!
        .findAll((node) => node.type === 'a')
        .map((link) => link.props.href),
    ).toEqual([
      `/groups/${GROUP}/expenses?expense=e00000000000000000000001`,
      `/groups/${GROUP}/expenses?expense=e00000000000000000000002`,
    ]);
    await press(dialog()!, 'OK');
    expect(dialog()).toBeNull();
  });

  it('asks before removing one nothing uses, then shows the list without it', async () => {
    await mount(true);
    answers.set(`DELETE ${PATH}/GBP`, {
      status: 200,
      body: { data: { ...lisbonAndTokyo, extraCurrencies: [lisbonAndTokyo.extraCurrencies[0]] } },
    });

    await press(renderer.root, 'Remove GBP');
    expect(textOf(dialog())).toContain('Remove GBP?');
    await press(dialog()!, 'Cancel');
    expect(requests.filter(({ method }) => method === 'DELETE')).toEqual([]);
    await press(renderer.root, 'Remove GBP');
    await press(dialog()!, 'Remove GBP');

    expect(requests.filter(({ method }) => method === 'DELETE')).toEqual([
      { method: 'DELETE', path: `${PATH}/GBP`, body: undefined },
    ]);
    expect(dialog()).toBeNull();
    expect(rowCodes()).toEqual(['JPY']);
    expect(notices).toEqual(['GBP removed.']);
  });

  it('explains the server’s refusal when something started using it meanwhile', async () => {
    await mount(true);
    answers.set(`DELETE ${PATH}/GBP`, {
      status: 409,
      body: {
        error: 'GBP can’t be removed while Lisbon & Tokyo uses it.',
        code: 'CURRENCY_IN_USE',
        use: { ...unused, settlements: 1 },
      },
    });

    await press(renderer.root, 'Remove GBP');
    await press(dialog()!, 'Remove GBP');

    expect(textOf(dialog())).toContain('GBP can’t be removed yet');
    expect(textOf(dialog())).toContain(
      '1 Settlement A recorded payment can’t be changed or deleted, so GBP stays on the list.',
    );
  });
});

describe('a member adding a currency (#721)', () => {
  const search = async (query: string) =>
    act(async () => {
      dialog()!
        .findAll((node) => node.type === 'input')[0]
        .props.onChange({ target: { value: query } });
    });
  const options = () =>
    dialog()!
      .findAll((node) => node.props.role === 'option' && typeof node.type === 'string')
      .map((option) => textOf(option));

  it('finds one by name and adds it', async () => {
    await mount(false);
    answers.set(`POST ${PATH}`, {
      status: 201,
      body: {
        data: {
          ...lisbonAndTokyo,
          extraCurrencies: [
            ...lisbonAndTokyo.extraCurrencies,
            { code: 'CHF', use: unused, added: by(SAM, 'Sam') },
          ],
        },
      },
    });

    await press(renderer.root, 'Add');

    expect(textOf(dialog())).toContain('Add a currency');
    expect(textOf(dialog())).toContain('Lisbon & Tokyo · 2 of 4 extra currencies');
    expect(textOf(dialog())).toContain(
      'INR, JPY and GBP are already on the list, so they aren’t shown. Codes outside the 30 Splitbook supports can’t be added.',
    );
    expect(options()).toHaveLength(27);
    await search('franc');
    expect(options()).toEqual(['CHF Swiss Franc']);
    await act(async () => {
      dialog()!
        .findAll((node) => node.props.role === 'option' && typeof node.type === 'string')[0]
        .props.onClick();
    });
    await press(dialog()!, 'Add CHF');

    expect(requests.filter(({ method }) => method === 'POST')).toEqual([
      { method: 'POST', path: PATH, body: { currency: 'CHF' } },
    ]);
    expect(dialog()).toBeNull();
    expect(rowCodes()).toEqual(['JPY', 'GBP', 'CHF']);
    expect(notices).toEqual(['CHF added.']);
  });

  it('keeps the dialog open with the server’s reason when the add is refused', async () => {
    await mount(false);
    answers.set(`POST ${PATH}`, {
      status: 422,
      body: {
        error: 'A Group can have at most 4 extra currencies.',
        code: 'INVALID_GROUP_CURRENCIES',
      },
    });

    await press(renderer.root, 'Add');
    await search('CHF');
    await act(async () => {
      dialog()!
        .findAll((node) => node.props.role === 'option' && typeof node.type === 'string')[0]
        .props.onClick();
    });
    await press(dialog()!, 'Add CHF');

    expect(textOf(dialog())).toContain('A Group can have at most 4 extra currencies.');
    expect(notices).toEqual([]);
  });
});
