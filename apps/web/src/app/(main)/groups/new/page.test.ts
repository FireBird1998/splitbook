import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NewGroupPage from './page';

/*
 * #723: a new Trip offers its extra currencies while it is set up, as the board "Web · New Trip
 * offers extra currencies" shows them; a Household and the rest add them later in settings. The
 * server is a stand-in that keeps what the page sends.
 */

const router = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const requests = vi.hoisted(() => [] as { method: string; path: string; body: unknown }[]);
/** The member's saved currency, and when its read answers. */
const profile = vi.hoisted(() => ({ currency: 'INR', answered: Promise.resolve() }));
vi.mock('@/lib/utils/api-fetch', () => ({
  apiFetch: async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    requests.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === 'GET' && path === '/api/user/profile') {
      await profile.answered;
      return Response.json({ data: { preferredCurrency: profile.currency } });
    }
    if (method === 'POST' && path === '/api/groups')
      return Response.json({ data: { _id: 'b00000000000000000000010' } }, { status: 201 });
    return Response.json({ error: 'Unplanned' }, { status: 500 });
  },
}));

let renderer: ReactTestRenderer;

// The page without a browser: MUI's text area and select ask for a document and window, which
// here listen to, find and measure nothing. Stubbed after the imports, so styles stay server-side.
const browserWindow = {
  addEventListener() {},
  removeEventListener() {},
  getComputedStyle: () => ({ width: '0px' }),
};
const browserDocument = {
  addEventListener() {},
  removeEventListener() {},
  getElementById: () => null,
  defaultView: browserWindow,
};
const element = () => ({
  focus() {},
  addEventListener() {},
  removeEventListener() {},
  ownerDocument: browserDocument,
  style: {},
});

async function mount() {
  await act(async () => {
    renderer = create(createElement(NewGroupPage), { createNodeMock: element });
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
const addCurrency = () =>
  renderer.root.find(
    (node) => node.type === 'select' && node.props['aria-label'] === 'Add a currency',
  );
const mainCurrency = () =>
  renderer.root.find((node) => node.type === 'select' && node.props.id === 'main-currency');
/** The currencies a select offers, by code. */
const offered = (select: ReactTestInstance) =>
  select
    .findAll((node) => node.type === 'option')
    .map((option) => String(option.props.value))
    .filter(Boolean);

async function choose(select: ReactTestInstance, value: string) {
  await act(async () => {
    select.props.onChange({ target: { value } });
  });
}
async function press(name: string) {
  const button = renderer.root
    .findAll((node) => node.type === 'button')
    .find((node) => node.props['aria-label'] === name || textOf(node) === name);
  if (!button) throw new Error(`Missing button ${name}`);
  await act(async () => {
    button.props.onClick();
  });
}
async function name(value: string) {
  const input = renderer.root.find(
    (node) => node.type === 'input' && node.props.placeholder === 'e.g. Goa Weekend',
  );
  await act(async () => {
    input.props.onChange({ target: { value } });
  });
}
/** Create, and what the page sent the server. */
async function submit() {
  const form = renderer.root.find((node) => node.type === 'form');
  await act(async () => {
    await form.props.onSubmit({ preventDefault() {} });
  });
  return requests.find((request) => request.method === 'POST' && request.path === '/api/groups')
    ?.body as Record<string, unknown> | undefined;
}

beforeEach(() => {
  profile.currency = 'INR';
  profile.answered = Promise.resolve();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', browserWindow);
  vi.stubGlobal('document', browserDocument);
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  requests.length = 0;
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

describe('a new Trip’s extra currencies (#723)', () => {
  it('are offered while it is set up, and sent when it is created', async () => {
    await mount();
    expect(shown()).toContain('Spending abroad?');
    expect(shown()).toContain('Optional');
    expect(shown()).toContain(
      'Add each currency you’ll pay in. Expenses keep the amount on the receipt; nothing is converted.',
    );
    expect(shown()).toContain('Anyone in the Group can add more later.');
    expect(shown()).toContain('0 of 4');
    // Never the main currency.
    expect(offered(addCurrency())).not.toContain('INR');

    await choose(addCurrency(), 'EUR');
    await choose(addCurrency(), 'JPY');
    expect(shown()).toContain('2 of 4');
    expect(offered(addCurrency())).not.toEqual(expect.arrayContaining(['EUR']));
    expect(offered(addCurrency())).not.toEqual(expect.arrayContaining(['JPY']));

    await name('Lisbon & Tokyo');
    expect(await submit()).toMatchObject({
      name: 'Lisbon & Tokyo',
      category: 'trip',
      defaultCurrency: 'INR',
      alternateCurrencies: ['EUR', 'JPY'],
    });
  });

  it('take one off with its Remove button', async () => {
    await mount();
    await choose(addCurrency(), 'EUR');
    await choose(addCurrency(), 'JPY');
    await press('Remove EUR');
    expect(shown()).toContain('1 of 4');
    await name('Lisbon & Tokyo');
    expect((await submit())?.alternateCurrencies).toEqual(['JPY']);
  });

  it('stop at 4, as a Group can have no more', async () => {
    await mount();
    for (const code of ['EUR', 'JPY', 'USD', 'GBP']) await choose(addCurrency(), code);
    expect(shown()).toContain('4 of 4');
    expect(addCurrency().props.disabled).toBe(true);
  });

  it('lose one that becomes the main currency', async () => {
    await mount();
    await choose(addCurrency(), 'EUR');
    await choose(addCurrency(), 'JPY');
    await choose(mainCurrency(), 'EUR');
    expect(shown()).toContain('1 of 4');
    await name('Lisbon & Tokyo');
    expect(await submit()).toMatchObject({ defaultCurrency: 'EUR', alternateCurrencies: ['JPY'] });
  });

  it('don’t come back when the main currency changes back', async () => {
    await mount();
    await choose(addCurrency(), 'EUR');
    await choose(mainCurrency(), 'EUR');
    await choose(mainCurrency(), 'INR');
    expect(shown()).toContain('0 of 4');
  });

  it('lose one the saved currency makes the main currency, read after they were chosen', async () => {
    let answer!: () => void;
    profile.currency = 'EUR';
    profile.answered = new Promise((resolve) => (answer = resolve));
    await mount();
    await choose(addCurrency(), 'EUR');
    await choose(addCurrency(), 'JPY');
    await act(async () => answer());
    expect(shown()).toContain('1 of 4');
    await name('Lisbon & Tokyo');
    expect(await submit()).toMatchObject({ defaultCurrency: 'EUR', alternateCurrencies: ['JPY'] });
  });

  it('aren’t offered for a Household, and none are sent, even ones chosen for a Trip', async () => {
    await mount();
    await choose(addCurrency(), 'EUR');
    const household = renderer.root.find(
      (node) =>
        node.type === 'button' && node.props.role === 'radio' && textOf(node).includes('Household'),
    );
    await act(async () => {
      household.props.onClick();
    });
    expect(shown()).not.toContain('Spending abroad?');
    const input = renderer.root.find(
      (node) => node.type === 'input' && node.props.placeholder === 'e.g. Flat 302',
    );
    await act(async () => {
      input.props.onChange({ target: { value: 'Maple House' } });
    });
    expect(await submit()).toMatchObject({ category: 'home', alternateCurrencies: [] });
  });
});

describe('the new-Group page’s currencies (#723)', () => {
  it('names the main currency as the boards do, and no longer offers the legacy picker', async () => {
    await mount();
    expect(shown()).toContain('Main currency');
    expect(shown()).toContain('Locked once money is recorded. Pick the one most of you settle in.');
    await press('Advanced settings');
    expect(shown()).not.toContain('Legacy option');
    expect(shown()).not.toContain('Alternate currencies');
  });

  it('creates a Trip, in the board’s words', async () => {
    await mount();
    expect(shown()).toContain('Create Trip');
  });
});
