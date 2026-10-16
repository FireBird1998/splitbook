import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import TagManager from './TagManager';
import type { TagCommand } from '@splitbook/shared/tag-management';
import { forgetBrowserGroupTagActions, forgetBrowserTagActions } from '@/lib/tag-actions';
import useSWR, { SWRConfig } from 'swr';
import { expensePageKey } from '@splitbook/shared/query-keys';
import { WEB_QUERY_ACCOUNT } from '@/lib/web-query-keys';
import { fetchWebRead } from '@/lib/web-read';

const ACCOUNT = 'a00000000000000000000001';
const GROUP = 'a00000000000000000000010';
const GENERAL = 'b00000000000000000000001';
const FOOD = 'b00000000000000000000002';
const VILLA = 'b00000000000000000000003';
const values = new Map<string, string>();
const storage = {
  get length() {
    return values.size;
  },
  key: (i: number) => [...values.keys()][i] ?? null,
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    values.set(key, value);
  },
  removeItem: (key: string) => {
    values.delete(key);
  },
};
const initialTags = () => [
  { id: GENERAL, name: 'General', revision: 0, isArchived: false, isDeleted: false },
  { id: FOOD, name: 'Food', revision: 0, isArchived: false, isDeleted: false },
];
let renderer: ReactTestRenderer;
const reply = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status });
function button(name: string) {
  return (
    renderer.root
      .findAllByType('button')
      .find(
        (node) =>
          node.props['aria-label'] === name ||
          node.findAllByType('span').some((n) => n.children.join('') === name) ||
          node.children.join('') === name,
      ) ??
    (() => {
      throw new Error(`Missing button ${name}`);
    })()
  );
}
async function click(name: string) {
  await act(async () => {
    button(name).props.onClick();
  });
}
async function typeName(name: string) {
  await act(async () => {
    renderer.root.findByType('input').props.onChange({ target: { value: name } });
  });
}
function content() {
  return JSON.stringify(renderer.toJSON());
}
async function mount() {
  await act(async () => {
    renderer = create(createElement(TagManager, { groupId: GROUP, accountId: ACCOUNT }));
  });
  await click('Manage Tags');
}
beforeEach(() => {
  values.clear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', {
    localStorage: storage,
    location: { origin: 'https://fixture.test', reload: vi.fn() },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('navigator', { onLine: true });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

it('creates a named Tag only after retaining the exact request, then shows the saved identity', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return reply({ canManage: true, tags: initialTags() });
      const command = JSON.parse(String(init.body));
      expect([...values.values()]).toContain(String(init.body));
      expect(command.intent).toEqual({ action: 'create', name: 'Villa' });
      return reply({
        state: 'applied',
        requestId: command.requestId,
        receipt: { intent: command.intent, tagId: VILLA, appliedAt: '2026-10-13T00:00:00.000Z' },
        snapshot: {
          canManage: true,
          tags: [
            ...initialTags(),
            { id: VILLA, name: 'Villa', revision: 0, isArchived: false, isDeleted: false },
          ],
        },
      });
    }),
  );
  await mount();
  await click('Create Tag');
  await typeName(' Villa ');
  await click('Apply change');
  expect(content()).toContain('Create confirmed');
  expect(button('Rename Villa')).toBeDefined();
  expect(values.size).toBe(0);
});

it('recovers a lost create reply after remount through a read-only Check and distinguishes the later name', async () => {
  let request: { requestId: string; intent: { action: 'create'; name: string } };
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      request = JSON.parse(String(init.body));
      throw new TypeError('Reply lost');
    }
    if (url.endsWith('/tag-actions')) return reply({ canManage: true, tags: initialTags() });
    return reply({
      state: 'applied',
      requestId: request.requestId,
      receipt: { intent: request.intent, tagId: VILLA, appliedAt: '2026-10-13T00:00:00.000Z' },
      snapshot: {
        canManage: true,
        tags: [
          ...initialTags(),
          { id: VILLA, name: 'Lodge', revision: 1, isArchived: false, isDeleted: false },
        ],
      },
    });
  });
  vi.stubGlobal('fetch', fetch);
  await mount();
  await click('Create Tag');
  await typeName('Villa');
  await click('Apply change');
  expect(content()).toContain('Unconfirmed Tag action');
  await act(async () => renderer.unmount());
  await mount();
  expect(content()).toContain('Unconfirmed Tag action');
  await click('Check action');
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  expect(content()).toContain('Create confirmed');
  expect(content()).toContain('Villa');
  expect(content()).toContain('Current Tag: Lodge');
  expect(values.size).toBe(0);
});

it('keeps a stale rename typed until the admin explicitly reviews the newer saved Tag', async () => {
  const commands: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return reply({ canManage: true, tags: initialTags() });
      const command = JSON.parse(String(init.body));
      commands.push(command.intent);
      if (commands.length === 1)
        return new Response(
          JSON.stringify({
            code: 'TAG_CHANGED',
            error: 'The Tag changed. Review its current state.',
            snapshot: {
              canManage: true,
              tags: initialTags().map((tag) =>
                tag.id === FOOD ? { ...tag, name: 'Meals', revision: 1 } : tag,
              ),
            },
          }),
          { status: 409 },
        );
      return reply({
        state: 'applied',
        requestId: command.requestId,
        receipt: { intent: command.intent, tagId: FOOD, appliedAt: '2026-10-13T00:00:00.000Z' },
        snapshot: {
          canManage: true,
          tags: initialTags().map((tag) =>
            tag.id === FOOD ? { ...tag, name: 'Dining', revision: 2 } : tag,
          ),
        },
      });
    }),
  );
  await mount();
  await click('Rename Food');
  await typeName('Dining');
  await click('Apply change');
  expect(renderer.root.findByType('input').props.value).toBe('Dining');
  expect(content()).toContain('Current Tag: Meals');
  expect(button('Apply change').props.disabled).toBe(true);
  await click('Review current Tag');
  await click('Apply change');
  expect(commands).toEqual([
    { action: 'rename', tagId: FOOD, expectedRevision: 0, name: 'Dining' },
    { action: 'rename', tagId: FOOD, expectedRevision: 1, name: 'Dining' },
  ]);
});

it.each(['rename', 'archive', 'restore', 'delete'] as const)(
  'retains the original %s action across closing and retries without changing its key or revision',
  async (action) => {
    let first: string | null = null;
    const bodies: string[] = [];
    const tags = initialTags().map((tag) =>
      tag.id === FOOD ? { ...tag, isArchived: action === 'restore' } : tag,
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== 'POST') return reply({ canManage: true, tags });
        const body = String(init.body);
        const command: TagCommand = JSON.parse(body);
        bodies.push(body);
        if (!first) {
          first = body;
          throw new TypeError('Lost reply');
        }
        return reply({
          state: 'applied',
          requestId: command.requestId,
          receipt: { intent: command.intent, tagId: FOOD, appliedAt: '2026-10-13T00:00:00.000Z' },
          snapshot: {
            canManage: true,
            tags: tags.map((tag) =>
              tag.id === FOOD
                ? { ...tag, name: 'Later name', revision: 3, isDeleted: action === 'delete' }
                : tag,
            ),
          },
        });
      }),
    );
    await mount();
    await click(`${action[0].toUpperCase()}${action.slice(1)} Food`);
    if (action === 'rename') await typeName('Dining');
    if (action === 'archive') expect(content()).toContain('Unfinished Drafts need an active Tag');
    await click(
      action === 'archive'
        ? 'Confirm archive'
        : action === 'delete'
          ? 'Confirm delete'
          : 'Apply change',
    );
    await click('Close Tags');
    await click('Manage Tags');
    await click('Retry original action');
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(content()).toContain(`${action[0].toUpperCase()}${action.slice(1)} confirmed`);
    expect(values.size).toBe(0);
  },
);

it('offers the reserved archived identity for explicit Restore after a case-variant create', async () => {
  const tags = [
    ...initialTags(),
    { id: VILLA, name: 'Villa', revision: 4, isArchived: true, isDeleted: false },
  ];
  const intents: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return reply({ canManage: true, tags });
      const command = JSON.parse(String(init.body));
      intents.push(command.intent);
      if (intents.length === 1)
        return new Response(
          JSON.stringify({
            code: 'TAG_EXISTS',
            error: 'This Tag name is reserved.',
            snapshot: { canManage: true, tags },
          }),
          { status: 409 },
        );
      return reply({
        state: 'applied',
        requestId: command.requestId,
        receipt: { intent: command.intent, tagId: VILLA, appliedAt: '2026-10-13T00:00:00.000Z' },
        snapshot: { canManage: true, tags: tags.map((tag) => ({ ...tag, isArchived: false })) },
      });
    }),
  );
  await mount();
  await click('Create Tag');
  await typeName('villa');
  await click('Apply change');
  expect(renderer.root.findByType('input').props.value).toBe('villa');
  await click('Restore existing Villa');
  expect(intents).toHaveLength(1);
  await click('Apply change');
  expect(intents[1]).toEqual({ action: 'restore', tagId: VILLA, expectedRevision: 4 });
});

it('asks before discarding a changed unsubmitted name, but never discards a submitted action on close', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => reply({ canManage: true, tags: initialTags() })),
  );
  await mount();
  await click('Create Tag');
  await typeName('Villa');
  await click('Close Tags');
  expect(content()).toContain('Discard this name');
  await click('Keep editing');
  expect(renderer.root.findByType('input').props.value).toBe('Villa');
  await click('Cancel edit');
  await click('Discard text');
  expect(renderer.root.findAllByType('input')).toHaveLength(0);
  await click('Close Tags');
  expect(button('Manage Tags')).toBeDefined();
});

it('sends nothing when recovery storage fails or the device is offline', async () => {
  const fetch = vi.fn(async () => reply({ canManage: true, tags: initialTags() }));
  vi.stubGlobal('fetch', fetch);
  await mount();
  await click('Create Tag');
  await typeName('Villa');
  const setItem = vi.spyOn(storage, 'setItem').mockImplementation(() => {
    throw new Error('Full');
  });
  await click('Apply change');
  expect(content()).toContain('No change was sent');
  expect(fetch).toHaveBeenCalledTimes(1);
  setItem.mockRestore();
  vi.stubGlobal('navigator', { onLine: false });
  await click('Apply change');
  expect(content()).toContain('Connect to change Tags');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('keeps a demoted admin’s readable Tags and allows only a read-only check of an unconfirmed action', async () => {
  let command: TagCommand;
  let posts = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        command = JSON.parse(String(init.body));
        posts += 1;
        if (posts === 1) throw new TypeError('Lost reply');
        return new Response(
          JSON.stringify({ code: 'TAG_ADMIN_REQUIRED', error: 'Admin required' }),
          { status: 403 },
        );
      }
      if (url.endsWith('/tag-actions')) return reply({ canManage: true, tags: initialTags() });
      return reply({
        state: 'not-applied',
        requestId: command.requestId,
        snapshot: { canManage: false, tags: initialTags() },
      });
    }),
  );
  await mount();
  await click('Create Tag');
  await typeName('Villa');
  await click('Apply change');
  await click('Retry original action');
  expect(content()).toContain('Food');
  expect(button('Retry original action').props.disabled).toBe(true);
  expect(button('Check action').props.disabled).toBeFalsy();
  await click('Check action');
  expect(content()).toContain('has not been applied');
  expect(values.size).toBe(1);
  expect(button('Apply change').props.disabled).toBe(true);
});

it.each(['group', 'account'] as const)(
  'clears recovery and ignores a late reply after %s cleanup',
  async (kind) => {
    let release!: () => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== 'POST') return reply({ canManage: true, tags: initialTags() });
        const command = JSON.parse(String(init.body));
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return reply({
          state: 'applied',
          requestId: command.requestId,
          receipt: { intent: command.intent, tagId: VILLA, appliedAt: '2026-10-13T00:00:00.000Z' },
          snapshot: {
            canManage: true,
            tags: [
              ...initialTags(),
              {
                id: VILLA,
                name: 'Private Villa',
                revision: 0,
                isArchived: false,
                isDeleted: false,
              },
            ],
          },
        });
      }),
    );
    await mount();
    await click('Create Tag');
    await typeName('Private Villa');
    await click('Apply change');
    await act(async () => {
      if (kind === 'group') forgetBrowserGroupTagActions(ACCOUNT, GROUP);
      else forgetBrowserTagActions({ except: 'different-account' });
      release();
    });
    expect(values.size).toBe(0);
    expect(content()).not.toContain('Private Villa');
    expect(content()).not.toContain('Create confirmed');
    expect(content()).not.toContain('Food');
  },
);

it('blocks retiring the last active Tag and permits explicit repair of a zero-active Group', async () => {
  let tags = initialTags().slice(0, 1);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => reply({ canManage: true, tags })),
  );
  await mount();
  expect(button('Archive General').props.disabled).toBe(true);
  expect(button('Delete General').props.disabled).toBe(true);
  expect(button('Create Tag').props.disabled).toBeFalsy();
  await click('Close Tags');
  tags = tags.map((tag) => ({ ...tag, isArchived: true }));
  await click('Manage Tags');
  expect(content()).toContain('No active Tags');
  expect(button('Restore General').props.disabled).toBeFalsy();
  expect(button('Create Tag').props.disabled).toBeFalsy();
});

it('requires another active Tag after a concurrent last-active rejection', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return reply({ canManage: true, tags: initialTags() });
      return new Response(
        JSON.stringify({
          code: 'LAST_ACTIVE_TAG',
          error: 'Keep at least one active Tag.',
          snapshot: {
            canManage: true,
            tags: initialTags().map((tag) =>
              tag.id === GENERAL ? { ...tag, isArchived: true } : tag,
            ),
          },
        }),
        { status: 409 },
      );
    }),
  );
  await mount();
  await click('Archive Food');
  await click('Confirm archive');
  expect(button('Confirm archive').props.disabled).toBe(true);
  expect(values.size).toBe(0);
  await click('Cancel edit');
  expect(button('Create Tag').props.disabled).toBeFalsy();
});

it('keeps an unapplied command after Check, then requires review when its exact retry is stale', async () => {
  let original: TagCommand;
  let posts = 0;
  const tags = initialTags().map((tag) =>
    tag.id === FOOD ? { ...tag, name: 'Meals', revision: 1 } : tag,
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts += 1;
        if (posts === 1) {
          original = JSON.parse(String(init.body));
          throw new TypeError('Lost reply');
        }
        expect(JSON.parse(String(init.body))).toEqual(original);
        return new Response(
          JSON.stringify({
            code: 'TAG_CHANGED',
            error: 'Review the current Tag.',
            snapshot: { canManage: true, tags },
          }),
          { status: 409 },
        );
      }
      if (url.endsWith('/tag-actions')) return reply({ canManage: true, tags: initialTags() });
      return reply({
        state: 'not-applied',
        requestId: original.requestId,
        snapshot: { canManage: true, tags },
      });
    }),
  );
  await mount();
  await click('Rename Food');
  await typeName('Dining');
  await click('Apply change');
  await click('Check action');
  expect(values.size).toBe(1);
  expect(button('Apply change').props.disabled).toBe(true);
  await click('Retry original action');
  expect(values.size).toBe(0);
  expect(renderer.root.findByType('input').props.value).toBe('Dining');
  expect(button('Apply change').props.disabled).toBe(true);
  expect(button('Review current Tag')).toBeDefined();
});

it('keeps a closed manager’s unresolved request when its late reply arrives', async () => {
  let release!: () => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'POST') return reply({ canManage: true, tags: initialTags() });
      const command = JSON.parse(String(init.body));
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return reply({
        state: 'applied',
        requestId: command.requestId,
        receipt: { intent: command.intent, tagId: VILLA, appliedAt: '2026-10-13T00:00:00.000Z' },
        snapshot: { canManage: true, tags: initialTags() },
      });
    }),
  );
  await mount();
  await click('Create Tag');
  await typeName('Villa');
  await click('Apply change');
  await click('Close Tags');
  await act(async () => release());
  expect(values.size).toBe(1);
  expect(content()).not.toContain('Create confirmed');
  await click('Manage Tags');
  expect(button('Check action')).toBeDefined();
});

it.each(['GET', 'POST'] as const)(
  'ignores a late %s reply when the rendered manager changes account and Group',
  async (method) => {
    let release!: () => void;
    let first = true;
    const nextGroup = 'a00000000000000000000099';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const old = url.includes(GROUP);
        if (old && (init?.method ?? 'GET') === method && first) {
          first = false;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          const snapshot = {
            canManage: true,
            tags: [
              {
                id: VILLA,
                name: 'Old private Tag',
                revision: 0,
                isArchived: false,
                isDeleted: false,
              },
            ],
          };
          if (method === 'GET') return reply(snapshot);
          const command = JSON.parse(String(init?.body));
          return reply({
            state: 'applied',
            requestId: command.requestId,
            receipt: {
              intent: command.intent,
              tagId: VILLA,
              appliedAt: '2026-10-13T00:00:00.000Z',
            },
            snapshot,
          });
        }
        return reply({ canManage: true, tags: initialTags() });
      }),
    );
    await mount();
    if (method === 'POST') {
      await click('Create Tag');
      await typeName('Old private Tag');
      await click('Apply change');
    }
    await act(async () => {
      renderer.update(
        createElement(TagManager, { groupId: nextGroup, accountId: 'another-account' }),
      );
    });
    await click('Manage Tags');
    await act(async () => release());
    expect(content()).not.toContain('Old private Tag');
    expect(content()).not.toContain('Unconfirmed Tag action');
    expect(content()).not.toContain('Create confirmed');
    expect(button('Rename Food')).toBeDefined();
  },
);

it.each(['arrives', 'is lost'] as const)(
  'refreshes the newly mounted Expense view when an unmounted manager’s write reply %s',
  async (replyOutcome) => {
    let release!: () => void;
    let savedName = 'Food';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/expenses')) return reply({ tagName: savedName });
        if (init?.method !== 'POST') return reply({ canManage: true, tags: initialTags() });
        const command = JSON.parse(String(init.body));
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        savedName = 'Dining';
        if (replyOutcome === 'is lost') throw new TypeError('Lost reply after commit');
        return reply({
          state: 'applied',
          requestId: command.requestId,
          receipt: { intent: command.intent, tagId: FOOD, appliedAt: '2026-10-13T00:00:00.000Z' },
          snapshot: {
            canManage: true,
            tags: initialTags().map((tag) =>
              tag.id === FOOD ? { ...tag, name: savedName, revision: 1 } : tag,
            ),
          },
        });
      }),
    );
    function Expenses() {
      const { data } = useSWR(expensePageKey(WEB_QUERY_ACCOUNT, GROUP), fetchWebRead);
      return createElement('p', null, `Expense Tag: ${data?.data.tagName ?? 'Loading'}`);
    }
    const cache = new Map();
    const config = { provider: () => cache, dedupingInterval: 0 };
    const page = (manage: boolean) =>
      createElement(
        SWRConfig,
        { value: config },
        manage
          ? createElement(TagManager, { groupId: GROUP, accountId: ACCOUNT })
          : createElement(Expenses),
      );
    await act(async () => {
      renderer = create(page(true));
    });
    await click('Manage Tags');
    await click('Rename Food');
    await typeName('Dining');
    await click('Apply change');
    await act(async () => {
      renderer.update(page(false));
    });
    expect(content()).toContain('Expense Tag: Food');
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(content()).toContain('Expense Tag: Dining');
  },
);

it.each(['account', 'group'] as const)(
  'does not refresh the replacement view after %s cleanup while the write’s manager is unmounted',
  async (cleanup) => {
    let release!: () => void;
    let expenseReads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/expenses')) {
          expenseReads += 1;
          return reply({ tagName: 'Replacement view' });
        }
        if (init?.method !== 'POST') return reply({ canManage: true, tags: initialTags() });
        const command = JSON.parse(String(init.body));
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return reply({
          state: 'applied',
          requestId: command.requestId,
          receipt: { intent: command.intent, tagId: FOOD, appliedAt: '2026-10-13T00:00:00.000Z' },
          snapshot: { canManage: true, tags: initialTags() },
        });
      }),
    );
    function Expenses() {
      const { data } = useSWR(expensePageKey(WEB_QUERY_ACCOUNT, GROUP), fetchWebRead);
      return createElement('p', null, data?.data.tagName ?? 'Loading');
    }
    const cache = new Map();
    const config = { provider: () => cache, dedupingInterval: 0 };
    const page = (manage: boolean) =>
      createElement(
        SWRConfig,
        { value: config },
        manage
          ? createElement(TagManager, { groupId: GROUP, accountId: ACCOUNT })
          : createElement(Expenses),
      );
    await act(async () => {
      renderer = create(page(true));
    });
    await click('Manage Tags');
    await click('Rename Food');
    await typeName('Dining');
    await click('Apply change');
    await act(async () => {
      renderer.update(page(false));
    });
    expect(expenseReads).toBe(1);
    await act(async () => {
      if (cleanup === 'account') forgetBrowserTagActions({ except: 'another-account' });
      else forgetBrowserGroupTagActions(ACCOUNT, GROUP);
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(expenseReads).toBe(1);
    expect(content()).toContain('Replacement view');
    expect(values.size).toBe(0);
  },
);

it.each([
  { status: 503, code: 'TAG_TRANSACTIONS_REQUIRED' },
  { status: 400, code: 'INVALID_TAG_COMMAND' },
])(
  'retains an earlier unconfirmed action after retry rejection $code until Check confirms it',
  async ({ status, code }) => {
    let command!: TagCommand;
    let posts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          posts += 1;
          if (posts === 1) {
            command = JSON.parse(String(init.body));
            throw new TypeError('Lost reply after commit');
          }
          return new Response(
            JSON.stringify({ code, error: 'Retry refused before receipt lookup.' }),
            { status },
          );
        }
        if (url.endsWith('/tag-actions')) return reply({ canManage: true, tags: initialTags() });
        return reply({
          state: 'applied',
          requestId: command.requestId,
          receipt: { intent: command.intent, tagId: FOOD, appliedAt: '2026-10-13T00:00:00.000Z' },
          snapshot: {
            canManage: true,
            tags: initialTags().map((tag) =>
              tag.id === FOOD ? { ...tag, name: 'Dining', revision: 1 } : tag,
            ),
          },
        });
      }),
    );
    await mount();
    await click('Rename Food');
    await typeName('Dining');
    await click('Apply change');
    await click('Retry original action');
    expect(values.size).toBe(1);
    expect(button('Apply change').props.disabled).toBe(true);
    await click('Check action');
    expect(content()).toContain('Rename confirmed');
    expect(values.size).toBe(0);
  },
);
