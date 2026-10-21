import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { SWRConfig } from 'swr';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import ActivityView from './ActivityView';

const GROUP = 'c00000000000000000000001';
const VIEWER = 'a00000000000000000000001';
const event = (number: number) => ({
  _id: number.toString(16).padStart(24, '0'),
  group: GROUP,
  type: 'expense_added',
  actor: { _id: VIEWER, name: 'Alex Rivera' },
  createdAt: new Date(Date.UTC(2026, 9, 21, 12, 0, -number)).toISOString(),
  metadata: { description: `Expense ${number}`, amount: 10, currency: 'INR' },
});
const answer = (page: number, events: ReturnType<typeof event>[], total = 51) =>
  Response.json({
    status: 200,
    data: {
      activities: events,
      pagination: { page, limit: 50, total, totalPages: Math.ceil(total / 50) },
    },
  });
const api = vi.fn<typeof fetch>();
let renderer: ReactTestRenderer;
const textOf = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join(' ');
const button = (label: string) =>
  renderer.root.findAllByType('button').find((node) => textOf(node).trim() === label);
const alerts = () =>
  renderer.root.findAll((node) => typeof node.type === 'string' && node.props.role === 'alert');
const headlines = () =>
  renderer.root
    .findAllByType('span')
    .map((node) => textOf(node).trim())
    .filter((text) => /^You added “Expense \d+”$/.test(text));
async function render() {
  await act(async () => {
    renderer = create(
      createElement(
        SWRConfig,
        {
          value: {
            provider: () => new Map(),
            dedupingInterval: 0,
            refreshInterval: 0,
            revalidateOnFocus: false,
            shouldRetryOnError: false,
          },
        },
        createElement(
          ThemeProvider,
          { theme: createAppTheme('light') },
          createElement(ActivityView, { groupId: GROUP, viewerId: VIEWER }),
        ),
      ),
      { createNodeMock: () => ({ focus() {} }) },
    );
  });
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('document', { querySelector: () => null });
  vi.stubGlobal('fetch', api);
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  api.mockReset();
  vi.unstubAllGlobals();
});

it('offers Load older activity, appends the next 50-event page in order, and ends at the last page', async () => {
  api.mockResolvedValueOnce(
    answer(
      1,
      Array.from({ length: 50 }, (_, i) => event(i + 1)),
    ),
  );
  api.mockResolvedValueOnce(
    answer(
      1,
      Array.from({ length: 50 }, (_, i) => event(i + 1)),
    ),
  );
  let finish!: (response: Response) => void;
  api.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  expect(headlines()).toHaveLength(50);
  expect(button('Load older activity')).toBeDefined();
  await act(async () => {
    button('Load older activity')!.props.onClick();
  });
  expect(button('Loading older activity…')?.props.disabled).toBe(true);
  expect(headlines()).toHaveLength(50);
  await act(async () => {
    finish(answer(2, [event(51)]));
  });
  expect(headlines()).toEqual(Array.from({ length: 51 }, (_, i) => `You added “Expense ${i + 1}”`));
  expect(button('Load older activity')).toBeUndefined();
  expect(api.mock.calls.map(([path]) => path)).toEqual([
    `/api/groups/${GROUP}/activity?page=1&limit=50`,
    `/api/groups/${GROUP}/activity?page=1&limit=50`,
    `/api/groups/${GROUP}/activity?page=2&limit=50`,
  ]);
});

it('announces an older-page failure above retry, keeps events, and clears the alert on success', async () => {
  api.mockResolvedValueOnce(answer(1, [event(1)]));
  api.mockResolvedValueOnce(answer(1, [event(1)]));
  api.mockResolvedValueOnce(Response.json({ error: 'Unavailable' }, { status: 503 }));
  api.mockResolvedValueOnce(answer(1, [event(1)]));
  api.mockResolvedValueOnce(answer(2, [event(2)]));
  await render();
  await act(async () => {
    button('Load older activity')!.props.onClick();
  });
  expect(headlines()).toEqual(['You added “Expense 1”']);
  expect(button('Try loading older activity')).toBeDefined();
  expect(alerts()).toHaveLength(1);
  expect(textOf(alerts()[0])).toBe(
    'Couldn’t load older activity. The events shown are still here.',
  );
  const controls = renderer.root.findAll(
    (node) =>
      typeof node.type === 'string' && (node.props.role === 'alert' || node.type === 'button'),
  );
  expect(controls.indexOf(alerts()[0])).toBeLessThan(
    controls.indexOf(button('Try loading older activity')!),
  );
  await act(async () => {
    button('Try loading older activity')!.props.onClick();
  });
  expect(headlines()).toEqual(['You added “Expense 1”', 'You added “Expense 2”']);
  expect(button('Try loading older activity')).toBeUndefined();
  expect(alerts()).toHaveLength(0);
  expect(button('Load older activity')).toBeUndefined();
  expect(api.mock.calls.at(-1)?.[0]).toBe(`/api/groups/${GROUP}/activity?page=2&limit=50`);
});

it('keeps the first copy when a newer event shifts an event onto two pages', async () => {
  api.mockResolvedValueOnce(answer(1, [event(1), event(2)]));
  api.mockResolvedValueOnce(answer(1, [event(1), event(2)]));
  api.mockResolvedValueOnce(
    answer(2, [
      { ...event(2), metadata: { ...event(2).metadata, description: 'Later copy' } },
      event(3),
    ]),
  );
  await render();
  await act(async () => {
    button('Load older activity')!.props.onClick();
  });
  expect(headlines()).toEqual([
    'You added “Expense 1”',
    'You added “Expense 2”',
    'You added “Expense 3”',
  ]);
  expect(textOf(renderer.root)).not.toContain('Later copy');
});

it('continues refreshing the newest events after adding paging', async () => {
  vi.useFakeTimers();
  try {
    api.mockResolvedValueOnce(answer(1, [event(2)], 1));
    api.mockResolvedValueOnce(answer(1, [event(1), event(2)], 2));
    await render();
    expect(headlines()).toEqual(['You added “Expense 2”']);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(headlines()).toEqual(['You added “Expense 1”', 'You added “Expense 2”']);
  } finally {
    vi.useRealTimers();
  }
});

it('refreshes loaded older pages too, so a page shift cannot hide a loaded event', async () => {
  vi.useFakeTimers();
  try {
    api.mockResolvedValueOnce(answer(1, [event(2), event(3)]));
    api.mockResolvedValueOnce(answer(1, [event(2), event(3)]));
    api.mockResolvedValueOnce(answer(2, [event(4)]));
    await render();
    await act(async () => {
      button('Load older activity')!.props.onClick();
    });
    api.mockResolvedValueOnce(answer(1, [event(1), event(2)]));
    api.mockResolvedValueOnce(answer(2, [event(3), event(4)]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(headlines()).toEqual([
      'You added “Expense 1”',
      'You added “Expense 2”',
      'You added “Expense 3”',
      'You added “Expense 4”',
    ]);
  } finally {
    vi.useRealTimers();
  }
});

it('says nothing when a refresh fails and nothing older exists, and keeps the events', async () => {
  vi.useFakeTimers();
  try {
    api.mockResolvedValueOnce(answer(1, [event(1)], 1));
    await render();
    api.mockResolvedValueOnce(Response.json({ error: 'Unavailable' }, { status: 500 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(api).toHaveBeenCalledTimes(2);
    expect(headlines()).toEqual(['You added “Expense 1”']);
    expect(alerts()).toHaveLength(0);
    expect(renderer.root.findAllByType('button').map((node) => textOf(node).trim())).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/older activity/)]),
    );
  } finally {
    vi.useRealTimers();
  }
});

it('keeps offering Load older activity, with no failure line, when only a refresh fails', async () => {
  vi.useFakeTimers();
  try {
    api.mockResolvedValueOnce(answer(1, [event(1)]));
    await render();
    api.mockResolvedValueOnce(Response.json({ error: 'Unavailable' }, { status: 500 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(api).toHaveBeenCalledTimes(2);
    expect(headlines()).toEqual(['You added “Expense 1”']);
    expect(alerts()).toHaveLength(0);
    expect(button('Load older activity')).toBeDefined();
    expect(button('Try loading older activity')).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});
