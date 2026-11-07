import { afterEach, describe, expect, it, vi } from 'vitest';
const credentials = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    getClient = credentials.client;
  },
}));
import { sendFcm, type FcmRequest } from './provider';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});
const message: FcmRequest = {
  token: 'fictional-private-token',
  data: {
    title: 'Splitbook',
    message: 'An Expense was added.',
    body: '{}',
    channelId: 'ledger-updates',
  },
  android: { ttl: '60s', priority: 'high', collapse_key: 'fictional-event' },
};
describe('direct FCM credential and transport boundary', () => {
  it('bounds a stalled Google credential lookup by the invocation signal without starting a send', async () => {
    vi.stubEnv('FCM_PROJECT_ID', 'fictional-project');
    credentials.client.mockImplementation(() => new Promise(() => {}));
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await sendFcm(message, AbortSignal.timeout(20))).toBe('operational');
    expect(fetch).not.toHaveBeenCalled();
  }, 200);
  it('recomputes remaining TTL after delayed Google authorization without extending expiry', async () => {
    vi.stubEnv('FCM_PROJECT_ID', 'fictional-project');
    const started = Date.now();
    let now = started;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    credentials.client.mockImplementation(async () => {
      now += 10_000;
      return { getAccessToken: async () => ({ token: 'fictional-auth-token' }) };
    });
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      void url;
      void init;
      return Response.json({ name: 'accepted' });
    });
    vi.stubGlobal('fetch', fetch);
    const request = {
      ...message,
      data: {
        ...message.data,
        body: JSON.stringify({ expiresAt: new Date(started + 12_000).toISOString() }),
      },
      android: { ...message.android, ttl: '12s' },
    };
    expect(await sendFcm(request, AbortSignal.timeout(1_000))).toBe('accepted');
    const sent = JSON.parse(fetch.mock.calls[0][1].body as string).message;
    expect(sent.android.ttl).toBe('2s');
    // SDK 58 skips the foreground handler for data-only FCM messages.
    expect(sent.notification).toEqual({ title: 'Splitbook', body: 'An Expense was added.' });
    expect(sent.android.notification).toEqual({ channel_id: 'ledger-updates' });
  });
});
