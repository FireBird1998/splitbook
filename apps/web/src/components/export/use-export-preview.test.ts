import { createElement, useLayoutEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useExportPreview } from './use-export-preview';

const api = vi.hoisted(() => vi.fn());
vi.mock('@/lib/utils/api-fetch', () => ({ apiFetch: api, signInAgain: vi.fn() }));
let renderer: ReactTestRenderer;
let result: ReturnType<typeof useExportPreview>;
const payload = (name: string) => ({
  format: 'csv',
  groupNames: [name],
  generatedAt: '2026-10-19T00:00:00.000Z',
  from: null,
  to: null,
  timeZone: 'UTC',
  empty: false,
  fileName: `${name}.csv`,
  files: [
    {
      name: `${name}.csv`,
      kind: 'expenses',
      header: ['Amount'],
      rows: [['10.01']],
      totalRows: 1,
      text: '\uFEFFAmount\r\n10.01\r\n',
    },
  ],
});
function Harness({ url }: { url: string | null }) {
  const next = useExportPreview('alice', url, 'Pick at least one Group.');
  useLayoutEffect(() => {
    result = next;
  });
  return null;
}
const view = (url: string | null) =>
  createElement(
    SWRConfig,
    { value: { provider: () => new Map(), dedupingInterval: 0 } },
    createElement(Harness, { url }),
  );
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  api.mockReset();
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
it('debounces changed choices and never displays a late response for a previous selection', async () => {
  let finishOld!: (response: Response) => void;
  api.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finishOld = resolve;
      }),
  );
  api.mockResolvedValueOnce(Response.json(payload('new')));
  await act(async () => {
    renderer = create(view('/api/export?old'));
  });
  await advance(299);
  expect(api).not.toHaveBeenCalled();
  await advance(1);
  expect(api).toHaveBeenCalledTimes(1);
  await act(async () => renderer.update(view('/api/export?new')));
  expect(result.state.status).toBe('loading');
  await advance(300);
  expect(result.state).toMatchObject({ status: 'ready', data: { groupNames: ['new'] } });
  await act(async () => finishOld(Response.json(payload('old'))));
  expect(result.state).toMatchObject({ status: 'ready', data: { groupNames: ['new'] } });
  await act(async () => renderer.update(view(null)));
  expect(result.state).toEqual({ status: 'idle', message: 'Pick at least one Group.' });
});
it('retries a failed preview and rejects malformed successful replies', async () => {
  api.mockResolvedValueOnce(Response.json({ diagnostic: 'private' }, { status: 500 }));
  await act(async () => {
    renderer = create(view('/api/export?retry'));
  });
  await advance(300);
  expect(result.state).toEqual({ status: 'error', message: 'The export couldn’t be prepared.' });
  api.mockResolvedValueOnce(Response.json(payload('recovered')));
  await act(async () => result.retry());
  expect(result.state).toMatchObject({ status: 'ready', data: { groupNames: ['recovered'] } });
  api.mockResolvedValueOnce(Response.json({ format: 'csv' }));
  await act(async () => result.retry());
  expect(result.state).toEqual({
    status: 'error',
    message: 'The export preview could not be read.',
  });
});

it('shows loading while Retry retains the previous SWR error', async () => {
  api.mockResolvedValueOnce(Response.json({}, { status: 500 }));
  await act(async () => {
    renderer = create(view('/api/export?pending-retry'));
  });
  await advance(300);
  expect(result.state.status).toBe('error');
  let finish!: (response: Response) => void;
  api.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => result.retry());
  expect(result.state.status).toBe('loading');
  await act(async () => finish(Response.json(payload('recovered'))));
  expect(result.state.status).toBe('ready');
});
