import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExternalAccountClient, gaxios } from 'google-auth-library';

const vercel = vi.hoisted(() => ({ token: vi.fn() }));
vi.mock('@vercel/oidc', () => ({ getVercelOidcToken: vercel.token }));

const WIF_ENV = {
  GCP_PROJECT_NUMBER: '123456789012',
  GCP_WORKLOAD_IDENTITY_POOL_ID: 'fictional-pool',
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: 'fictional-provider',
  GCP_SERVICE_ACCOUNT_EMAIL: 'fcm-sender@fictional-project.iam.gserviceaccount.com',
} as const;
const AUDIENCE =
  '//iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/' +
  'fictional-pool/providers/fictional-provider';
const IMPERSONATION_URL =
  'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' +
  'fcm-sender@fictional-project.iam.gserviceaccount.com:generateAccessToken';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

function stubWif(values: Partial<Record<keyof typeof WIF_ENV, string | undefined>> = WIF_ENV) {
  for (const name of Object.keys(WIF_ENV) as (keyof typeof WIF_ENV)[]) {
    vi.stubEnv(name, values[name]);
  }
}
async function load() {
  vi.resetModules();
  return import('./google-credentials');
}

// Every request google-auth-library makes, its STS client's included, goes to this fake. With no
// handler set, a request fails the test instead of reaching Google.
const network = vi.hoisted(() => ({
  fetch: vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(),
}));
const request = gaxios.Gaxios.prototype.request;
beforeEach(() => {
  stubWif({});
  network.fetch.mockRejectedValue(new Error('No network in unit tests'));
  vi.spyOn(gaxios.Gaxios.prototype, 'request').mockImplementation(function (
    this: gaxios.Gaxios,
    options = {},
  ) {
    return request.call(this, { ...options, fetchImplementation: network.fetch });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe('Firebase sender credential selection', () => {
  it('uses Application Default Credentials when no Workload Identity setting is present', async () => {
    const { googleCredentialConfig } = await load();
    expect(googleCredentialConfig()).toEqual({ kind: 'application-default' });
  });

  it('treats blank settings as unset', async () => {
    stubWif({ GCP_PROJECT_NUMBER: '', GCP_SERVICE_ACCOUNT_EMAIL: '  ' });
    const { googleCredentialConfig } = await load();
    expect(googleCredentialConfig()).toEqual({ kind: 'application-default' });
  });

  it('uses Workload Identity Federation when all four settings are present', async () => {
    stubWif();
    const { googleCredentialConfig } = await load();
    expect(googleCredentialConfig()).toEqual({
      kind: 'workload-identity',
      projectNumber: '123456789012',
      poolId: 'fictional-pool',
      providerId: 'fictional-provider',
      serviceAccountEmail: 'fcm-sender@fictional-project.iam.gserviceaccount.com',
    });
  });

  it.each(Object.keys(WIF_ENV) as (keyof typeof WIF_ENV)[])(
    'fails closed, naming the missing setting, when only %s is absent',
    async (missing) => {
      stubWif({ ...WIF_ENV, [missing]: undefined });
      const { googleCredentialConfig, GoogleCredentialConfigError } = await load();
      expect(() => googleCredentialConfig()).toThrow(GoogleCredentialConfigError);
      expect(() => googleCredentialConfig()).toThrow(new RegExp(`Missing: ${missing}\\.`));
    },
  );

  it('fails closed when a single setting is present, without echoing its value', async () => {
    stubWif({ GCP_SERVICE_ACCOUNT_EMAIL: WIF_ENV.GCP_SERVICE_ACCOUNT_EMAIL });
    const { googleCredentialConfig } = await load();
    let error: unknown;
    try {
      googleCredentialConfig();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    const text = (error as Error).message;
    expect(text).toContain(
      'Missing: GCP_PROJECT_NUMBER, GCP_WORKLOAD_IDENTITY_POOL_ID, GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID.',
    );
    expect(text).not.toContain('fcm-sender@');
  });

  it.each([
    ['GCP_PROJECT_NUMBER', 'fictional-project'],
    ['GCP_WORKLOAD_IDENTITY_POOL_ID', 'Pool/../x'],
    ['GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID', 'a'],
    ['GCP_SERVICE_ACCOUNT_EMAIL', 'sender@x/../evil:generateAccessToken'],
  ] as const)('fails closed when %s is malformed', async (name, value) => {
    stubWif({ ...WIF_ENV, [name]: value });
    const { googleCredentialConfig, GoogleCredentialConfigError } = await load();
    expect(() => googleCredentialConfig()).toThrow(GoogleCredentialConfigError);
    expect(() => googleCredentialConfig()).toThrow(new RegExp(`Malformed: ${name}\\.`));
  });

  it('never builds an ADC or federated client when the settings are incomplete', async () => {
    stubWif({ GCP_PROJECT_NUMBER: WIF_ENV.GCP_PROJECT_NUMBER });
    const fromJSON = vi.spyOn(ExternalAccountClient, 'fromJSON');
    const { fcmCredentialClient, GoogleCredentialConfigError } = await load();
    await expect(fcmCredentialClient()).rejects.toBeInstanceOf(GoogleCredentialConfigError);
    expect(fromJSON).not.toHaveBeenCalled();
  });
});

describe('Workload Identity Federation client', () => {
  it('is built with exactly the pool audience, STS and impersonation URLs, and the FCM scope', async () => {
    stubWif();
    const fromJSON = vi.spyOn(ExternalAccountClient, 'fromJSON');
    const { fcmCredentialClient } = await load();
    await fcmCredentialClient();
    expect(fromJSON).toHaveBeenCalledTimes(1);
    expect(fromJSON.mock.calls[0][0]).toEqual({
      type: 'external_account',
      audience: AUDIENCE,
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      token_url: 'https://sts.googleapis.com/v1/token',
      service_account_impersonation_url: IMPERSONATION_URL,
      scopes: [FCM_SCOPE],
      subject_token_supplier: { getSubjectToken: expect.any(Function) },
    });
  });

  it('reuses one client, and its cached access token, across sends', async () => {
    stubWif();
    const fromJSON = vi.spyOn(ExternalAccountClient, 'fromJSON');
    const { fcmCredentialClient } = await load();
    expect(await fcmCredentialClient()).toBe(await fcmCredentialClient());
    expect(fromJSON).toHaveBeenCalledTimes(1);
  });

  it('builds a fresh client after an abandoned lookup has discarded the kept one', async () => {
    stubWif();
    const fromJSON = vi.spyOn(ExternalAccountClient, 'fromJSON');
    const { fcmCredentialClient, forgetFcmCredentialClients } = await load();
    const first = await fcmCredentialClient();
    forgetFcmCredentialClients();
    expect(await fcmCredentialClient()).not.toBe(first);
    expect(fromJSON).toHaveBeenCalledTimes(2);
  });

  it('exchanges the Vercel token at STS, then impersonates the sender for the FCM scope only', async () => {
    stubWif();
    vercel.token.mockResolvedValue('fictional-vercel-oidc-token');
    const requests: { url: string; body: string; authorization: string | null }[] = [];
    network.fetch.mockImplementation(async (input, init) => {
      const url = String(input);
      requests.push({
        url,
        body: String(init?.body ?? ''),
        authorization: new Headers(init?.headers).get('authorization'),
      });
      if (url === 'https://sts.googleapis.com/v1/token') {
        return Response.json({
          access_token: 'fictional-federated-token',
          issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }
      return Response.json({
        accessToken: 'fictional-fcm-access-token',
        expireTime: new Date(Date.now() + 3_600_000).toISOString(),
      });
    });
    const { workloadIdentityClientOptions, googleCredentialConfig } = await load();
    const config = googleCredentialConfig();
    if (config.kind !== 'workload-identity') throw new Error('expected a federated config');
    const client = ExternalAccountClient.fromJSON(workloadIdentityClientOptions(config));
    expect((await client!.getAccessToken()).token).toBe('fictional-fcm-access-token');

    expect(requests.map((request) => request.url)).toEqual([
      'https://sts.googleapis.com/v1/token',
      IMPERSONATION_URL,
    ]);
    const sts = new URLSearchParams(requests[0].body);
    expect(sts.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(sts.get('audience')).toBe(AUDIENCE);
    expect(sts.get('subject_token_type')).toBe('urn:ietf:params:oauth:token-type:jwt');
    expect(sts.get('subject_token')).toBe('fictional-vercel-oidc-token');
    expect(requests[1].authorization).toBe('Bearer fictional-federated-token');
    expect(JSON.parse(requests[1].body).scope).toEqual([FCM_SCOPE]);
  });
});

describe('Vercel subject-token supplier', () => {
  it('returns the Vercel OIDC token as the subject token', async () => {
    vercel.token.mockResolvedValue('fictional-vercel-oidc-token');
    const { vercelSubjectToken } = await load();
    expect(await vercelSubjectToken()).toBe('fictional-vercel-oidc-token');
    expect(vercel.token).toHaveBeenCalledWith();
  });

  it('fails with a clear error, and no upstream detail, when the token is missing', async () => {
    vercel.token.mockRejectedValue(
      new Error("The 'x-vercel-oidc-token' header is missing from the request."),
    );
    const { vercelSubjectToken } = await load();
    await expect(vercelSubjectToken()).rejects.toThrow(
      /^Vercel OIDC token is unavailable: enable OIDC federation for this Vercel project\.$/,
    );
  });

  it('fails cleanly when the token comes back empty', async () => {
    vercel.token.mockResolvedValue('');
    const { vercelSubjectToken } = await load();
    await expect(vercelSubjectToken()).rejects.toThrow(/^Vercel OIDC token is unavailable/);
  });

  it('is the supplier the federated client calls', async () => {
    stubWif();
    vercel.token.mockResolvedValue('fictional-vercel-oidc-token');
    const fromJSON = vi.spyOn(ExternalAccountClient, 'fromJSON');
    const { fcmCredentialClient } = await load();
    await fcmCredentialClient();
    const options = fromJSON.mock.calls[0][0] as {
      subject_token_supplier: { getSubjectToken: (context: never) => Promise<string> };
    };
    expect(await options.subject_token_supplier.getSubjectToken({} as never)).toBe(
      'fictional-vercel-oidc-token',
    );
  });
});
