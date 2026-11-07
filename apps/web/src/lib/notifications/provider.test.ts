import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const credentials = vi.hoisted(() => ({ client: vi.fn(), vercelToken: vi.fn() }));
vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    getClient = credentials.client;
  },
  // A federated client does what google-auth-library's does on a token refresh: it asks the
  // subject-token supplier for the Vercel token first, then exchanges it (the exchange is faked).
  // Like the real client, it shares one pending refresh between concurrent and later callers.
  ExternalAccountClient: {
    fromJSON: (options: { subject_token_supplier: { getSubjectToken: () => Promise<string> } }) => {
      let pending: Promise<{ token: string }> | null = null;
      return {
        getAccessToken: () =>
          (pending ??= options.subject_token_supplier
            .getSubjectToken()
            .then(() => ({ token: 'fictional-auth-token' }))
            .finally(() => {
              pending = null;
            })),
      };
    },
  },
}));
vi.mock('@vercel/oidc', () => ({ getVercelOidcToken: credentials.vercelToken }));
import { sendFcm, type FcmRequest } from './provider';
const WIF_ENV = {
  GCP_PROJECT_NUMBER: '123456789012',
  GCP_WORKLOAD_IDENTITY_POOL_ID: 'fictional-pool',
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: 'fictional-provider',
  GCP_SERVICE_ACCOUNT_EMAIL: 'fcm-sender@fictional-project.iam.gserviceaccount.com',
};
beforeEach(() => {
  for (const name of Object.keys(WIF_ENV)) vi.stubEnv(name, undefined);
  vi.stubEnv('VERCEL', undefined);
});
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

/** Each credential path, with a way to make its Google credential lookup stall or take time. */
const paths = [
  {
    name: 'Application Default Credentials',
    configure: () => {},
    stall: () => credentials.client.mockImplementation(() => new Promise(() => {})),
    delay: (advance: () => void) =>
      credentials.client.mockImplementation(async () => {
        advance();
        return { getAccessToken: async () => ({ token: 'fictional-auth-token' }) };
      }),
  },
  {
    name: 'Vercel OIDC through Workload Identity Federation',
    configure: () => {
      for (const [name, value] of Object.entries(WIF_ENV)) vi.stubEnv(name, value);
    },
    stall: () => credentials.vercelToken.mockImplementation(() => new Promise(() => {})),
    delay: (advance: () => void) =>
      credentials.vercelToken.mockImplementation(async () => {
        advance();
        return 'fictional-vercel-oidc-token';
      }),
  },
];

describe.each(paths)('direct FCM credential and transport boundary ($name)', (path) => {
  it('bounds a stalled Google credential lookup by the invocation signal without starting a send', async () => {
    vi.stubEnv('FCM_PROJECT_ID', 'fictional-project');
    path.configure();
    path.stall();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await sendFcm(message, AbortSignal.timeout(20))).toBe('operational');
    expect(fetch).not.toHaveBeenCalled();
  }, 200);
  it('recomputes remaining TTL after delayed Google authorization without extending expiry', async () => {
    vi.stubEnv('FCM_PROJECT_ID', 'fictional-project');
    path.configure();
    const started = Date.now();
    let now = started;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    path.delay(() => {
      now += 10_000;
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
    expect(fetch.mock.calls[0][1].headers).toMatchObject({
      Authorization: 'Bearer fictional-auth-token',
    });
    // SDK 58 skips the foreground handler for data-only FCM messages.
    expect(sent.notification).toEqual({ title: 'Splitbook', body: 'An Expense was added.' });
    expect(sent.android.notification).toEqual({ channel_id: 'ledger-updates' });
  });
});

describe('a federated credential lookup abandoned at the deadline', () => {
  it('does not hold up the next send, which starts a fresh lookup', async () => {
    vi.stubEnv('FCM_PROJECT_ID', 'fictional-project');
    for (const [name, value] of Object.entries(WIF_ENV)) vi.stubEnv(name, value);
    credentials.vercelToken.mockImplementationOnce(() => new Promise(() => {}));
    credentials.vercelToken.mockResolvedValue('fictional-vercel-oidc-token');
    const fetch = vi.fn(async () => Response.json({ name: 'accepted' }));
    vi.stubGlobal('fetch', fetch);
    expect(await sendFcm(message, AbortSignal.timeout(20))).toBe('operational');
    const request = {
      ...message,
      data: {
        ...message.data,
        body: JSON.stringify({ expiresAt: new Date(Date.now() + 60_000).toISOString() }),
      },
    };
    expect(await sendFcm(request, AbortSignal.timeout(200))).toBe('accepted');
    expect(fetch).toHaveBeenCalledTimes(1);
  }, 1_000);
});

describe('an incomplete Workload Identity configuration', () => {
  it('sends nothing, uses no Application Default Credentials, and logs only the setting names', async () => {
    vi.stubEnv('FCM_PROJECT_ID', 'fictional-project');
    vi.stubEnv('GCP_PROJECT_NUMBER', WIF_ENV.GCP_PROJECT_NUMBER);
    vi.stubEnv('GCP_SERVICE_ACCOUNT_EMAIL', WIF_ENV.GCP_SERVICE_ACCOUNT_EMAIL);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await sendFcm(message, AbortSignal.timeout(1_000))).toBe('operational');
    expect(fetch).not.toHaveBeenCalled();
    expect(credentials.client).not.toHaveBeenCalled();
    expect(credentials.vercelToken).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    const logged = String(error.mock.calls[0][0]);
    expect(logged).toContain(
      'Missing: GCP_WORKLOAD_IDENTITY_POOL_ID, GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID.',
    );
    expect(logged).not.toContain('123456789012');
    expect(logged).not.toContain('fcm-sender@');
  });
});

describe('no Workload Identity settings on Vercel', () => {
  it('sends nothing, uses no Application Default Credentials, and logs the missing settings', async () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('FCM_PROJECT_ID', 'fictional-project');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await sendFcm(message, AbortSignal.timeout(1_000))).toBe('operational');
    expect(fetch).not.toHaveBeenCalled();
    expect(credentials.client).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain(
      'Firebase sender Workload Identity settings are missing on Vercel',
    );
  });
});
