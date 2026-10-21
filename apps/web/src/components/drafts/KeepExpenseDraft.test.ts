import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SWRConfig } from 'swr';
import { afterEach, expect, it, vi } from 'vitest';
import { ExpenseDraft } from '@splitbook/shared/expense-draft';
import { useKeepExpenseDraft } from './KeepExpenseDraft';

let renderer: ReactTestRenderer;
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

it('Finish later shows the amount refusal without sending or retaining an uncertain save (#773)', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const stored = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  });
  const request = vi.fn(async () => Response.json({ data: [], status: 200 }));
  vi.stubGlobal('fetch', request);
  const draft = ExpenseDraft.open({
    groupId: 'group',
    accountId: 'you',
    memberIds: ['you'],
    currency: 'INR',
    defaultTag: 'General',
    date: '2026-10-21',
  }).edit({ amount: '1,84,250' });
  let state: ReturnType<typeof useKeepExpenseDraft>;
  const onKept = vi.fn();
  function Form() {
    state = useKeepExpenseDraft({
      draft,
      groupId: 'group',
      accountId: 'you',
      onKept,
      enabled: true,
    });
    return null;
  }
  await act(async () => {
    renderer = create(
      createElement(SWRConfig, { value: { provider: () => new Map() } }, createElement(Form)),
    );
  });
  request.mockClear();
  await act(async () => state.keep());
  expect(state!.error).toBe('Enter an amount like 1,060.00.');
  expect(state!.pending).toBe(false);
  expect(state!.busy).toBe(false);
  expect(request).not.toHaveBeenCalled();
  expect(stored.size).toBe(0);
  expect(onKept).not.toHaveBeenCalled();
});
