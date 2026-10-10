import { afterEach, describe, expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import { createMobileController } from '../src/data/mobile-controller';
import { measurementWindows } from './measurement-harness';

function recorder() {
  const controller = createMobileController(
    {
      apiBaseUrl: 'http://localhost:4000',
      authOrigin: 'http://localhost:4000',
      developmentPersonaEnabled: true,
    },
    {
      fetch: async () => Response.json({}),
      credentials: { load: async () => null, save: async () => {}, clear: async () => {} },
    },
  );
  return measurementWindows(() => controller, 10);
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('measurement window semantics', () => {
  it('counts background requests but records Settled at action resolution; outside requests never move into the next row', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    let elapsed = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    const windows = recorder();
    windows.record('before');
    const first = windows.measure(
      'one',
      async () => {
        windows.record('action');
        await new Promise((done) => setTimeout(done, 7));
        elapsed = 7;
        setTimeout(() => windows.record('background'), 5);
      },
      () => true,
    );
    await vi.advanceTimersByTimeAsync(37);
    await first;
    windows.record('between');
    const second = windows.measure(
      'two',
      async () => {},
      () => true,
    );
    await vi.advanceTimersByTimeAsync(30);
    await second;
    expect(windows.rows).toEqual([
      {
        journey: 'one',
        count: 2,
        requests: '1× action, 1× background',
        contentMs: 0,
        settledMs: 7,
      },
      { journey: 'two', count: 0, requests: 'none', contentMs: 0, settledMs: 0 },
    ]);
    expect(windows.outside).toEqual(['before', 'between']);
  });
  it('keeps a failed journey’s requests and releases its window', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const windows = recorder();
    const failed = windows.measure(
      'failure',
      async () => {
        windows.record('sent');
        throw new Error('journey failed');
      },
      () => false,
    );
    const assertion = expect(failed).rejects.toThrow('journey failed');
    await vi.advanceTimersByTimeAsync(30);
    await assertion;
    windows.record('after failure');
    expect(windows.rows[0]).toMatchObject({
      journey: 'failure (failed)',
      count: 1,
      requests: '1× sent',
      settledMs: 0,
    });
    expect(windows.outside).toEqual(['after failure']);
  });
});
