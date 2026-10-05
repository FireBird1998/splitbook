import { describe, expect, it, vi } from 'vitest';
import { decodeStoredSession } from './cookies';
import { createMobileController } from './mobile-controller';
import type { GoogleIdentityResult, MobileDependencies, MobileFetch } from './types';

const base = 'https://staging.splitbook.test';
const user = {
  id: 'a00000000000000000000001',
  name: 'Invited Tester',
  email: 'invited@example.com',
  image: null,
};
const cookie = '__Secure-better-auth.session_token=signed-session.signature';
const identity: GoogleIdentityResult = {
  status: 'success',
  idToken: 'google-token',
  nonce: 'fresh-nonce',
};
function response(body: unknown, status = 200, setCookie?: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(setCookie ? { 'Set-Cookie': setCookie } : {}),
    },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(
  options: {
    saved?: string;
    acquire?: () => Promise<GoogleIdentityResult>;
    intercept?: MobileFetch;
    dependencies?: Partial<MobileDependencies>;
    insecure?: boolean;
    bootstrap?: unknown;
  } = {},
) {
  let saved: string | null = options.saved ?? null;
  const credentials = {
    load: vi.fn(async () => saved),
    save: vi.fn(async (value: string) => {
      saved = value;
    }),
    clear: vi.fn(async () => {
      saved = null;
    }),
  };
  const acquire = vi.fn(options.acquire ?? (async () => identity));
  const transport = vi.fn<MobileFetch>(
    options.intercept ??
      (async (url, init) => {
        const path = new URL(url).pathname;
        if (path === '/api/auth/sign-in/social')
          return response(
            { user, token: 'raw-session-is-not-a-cookie' },
            200,
            `${cookie}; Path=/; HttpOnly; Secure; Max-Age=2592000`,
          );
        if (!new Headers(init.headers).get('Cookie')) return response({}, 401);
        if (path === '/api/auth/get-session')
          return response({
            user,
            session: { userId: user.id, expiresAt: '2030-01-01T00:00:00.000Z' },
          });
        if (path === '/api/groups') return response({ data: [], status: 200 });
        if (path === '/api/user/balances') return response({ data: { buckets: [] }, status: 200 });
        if (path === '/api/auth/sign-out') return response({ success: true });
        return response({}, 404);
      }),
  );
  const fetch = vi.fn<MobileFetch>(async (url, init) => {
    if (url.endsWith('/.well-known/splitbook-mobile.json')) {
      return response(
        options.bootstrap === undefined
          ? { environment: 'staging', googleWebClientId: '123-test.apps.googleusercontent.com' }
          : options.bootstrap,
      );
    }
    return transport(url, init);
  });
  const controller = createMobileController(
    {
      apiBaseUrl: options.insecure ? base.replace('https:', 'http:') : base,
      authOrigin: options.insecure ? base.replace('https:', 'http:') : base,
      developmentPersonaEnabled: false,
      googleWebClientId: '123-test.apps.googleusercontent.com',
    },
    { fetch, googleSignIn: acquire, credentials, ...options.dependencies },
  );
  return { controller, acquire, fetch, credentials, saved: () => saved };
}

describe('Google login within the native session boundary', () => {
  it('exchanges the native token and nonce, verifies the session, and stores only a signed cookie', async () => {
    const test = setup();
    await test.controller.signInWithGoogle();
    expect(test.controller.getSnapshot().auth).toMatchObject({ status: 'authenticated', user });
    const [url, request] = test.fetch.mock.calls[1];
    expect(url).toBe(`${base}/api/auth/sign-in/social`);
    expect(JSON.parse(String(request.body))).toEqual({
      provider: 'google',
      idToken: { token: identity.idToken, nonce: identity.nonce },
    });
    expect(new Headers(request.headers).get('Origin')).toBe(base);
    expect(request).toMatchObject({ credentials: 'omit', redirect: 'error' });
    // The signed cookie alone, then recorded for the account get-session confirmed (#200).
    expect(
      test.credentials.save.mock.calls.map(([value]) => decodeStoredSession(value, true)),
    ).toEqual([
      { cookie, accountId: null },
      { cookie, accountId: user.id },
    ]);
    expect(test.fetch.mock.calls[2][0]).toBe(`${base}/api/auth/get-session`);
    await test.controller.signIn('alex');
    expect(test.fetch.mock.calls.some(([url]) => url.includes('demo-persona'))).toBe(false);
  });
  it('restores a Google session after restart with demo personas disabled and without opening Google', async () => {
    const test = setup({ saved: cookie });
    await test.controller.restore();
    expect(test.controller.getSnapshot().auth).toMatchObject({ status: 'authenticated', user });
    expect(test.acquire).not.toHaveBeenCalled();
    expect(test.fetch.mock.calls[1][0]).toBe(`${base}/api/auth/get-session`);
  });
  it.each<GoogleIdentityResult>([
    { status: 'cancelled' },
    { status: 'error', message: 'Update Google Play services.' },
  ])(
    'keeps unsuccessful identity acquisition signed out without sending an auth request: $status',
    async (result) => {
      const test = setup({ acquire: async () => result });
      await test.controller.signInWithGoogle();
      expect(test.controller.getSnapshot().auth).toMatchObject({
        status: 'signed-out',
        user: null,
      });
      expect(test.fetch).toHaveBeenCalledTimes(1);
      expect(test.saved()).toBeNull();
    },
  );
  it('explains beta denial rather than treating it as a Group authorization failure', async () => {
    const test = setup({ intercept: async () => response({ code: 'email_not_allowed' }, 403) });
    await test.controller.signInWithGoogle();
    expect(test.controller.getSnapshot().auth.message).toContain('not invited');
    expect(test.saved()).toBeNull();
  });
  it('treats rejected identity tokens as login failures, not expired app sessions', async () => {
    const test = setup({ intercept: async () => response({ code: 'INVALID_ID_TOKEN' }, 401) });
    await test.controller.signInWithGoogle();
    expect(test.controller.getSnapshot().auth.message).toContain('sign-in was not accepted');
    expect(test.saved()).toBeNull();
  });
  it('never accepts a raw session token without the signed response cookie', async () => {
    const test = setup({ intercept: async () => response({ user, token: 'raw-session-token' }) });
    await test.controller.signInWithGoogle();
    expect(test.controller.getSnapshot().auth.status).toBe('signed-out');
    expect(test.fetch).toHaveBeenCalledTimes(2);
    expect(test.saved()).toBeNull();
  });
  it('ignores a chooser result after logout and prevents overlapping native prompts', async () => {
    const selection = deferred<GoogleIdentityResult>();
    const test = setup({ acquire: () => selection.promise });
    const signingIn = test.controller.signInWithGoogle();
    await vi.waitFor(() => expect(test.acquire).toHaveBeenCalledOnce());
    await test.controller.signInWithGoogle();
    expect(test.acquire).toHaveBeenCalledOnce();
    await test.controller.signOut();
    selection.resolve(identity);
    await signingIn;
    expect(test.fetch).toHaveBeenCalledTimes(1);
    expect(test.saved()).toBeNull();
    expect(test.controller.getSnapshot().auth.status).toBe('signed-out');
  });
  it('ignores a late server cookie after logout', async () => {
    const exchange = deferred<Response>();
    const test = setup({ intercept: () => exchange.promise });
    const signingIn = test.controller.signInWithGoogle();
    await vi.waitFor(() => expect(test.fetch).toHaveBeenCalledTimes(2));
    await test.controller.signOut();
    exchange.resolve(response({ user }, 200, `${cookie}; Secure; Path=/`));
    await signingIn;
    expect(test.credentials.save).not.toHaveBeenCalled();
    expect(test.controller.getSnapshot().auth.status).toBe('signed-out');
  });
  it('refuses a mismatched or non-staging backend before sending identity or session values', async () => {
    for (const bootstrap of [
      null,
      {},
      { environment: 'production', googleWebClientId: '123-test.apps.googleusercontent.com' },
      { environment: 'staging', googleWebClientId: '456-other.apps.googleusercontent.com' },
    ]) {
      const test = setup({ bootstrap, saved: cookie });
      await test.controller.restore();
      await test.controller.signInWithGoogle();
      expect(test.acquire).not.toHaveBeenCalled();
      expect(
        test.fetch.mock.calls.every(
          ([url, init]) =>
            url.endsWith('/.well-known/splitbook-mobile.json') &&
            !new Headers(init.headers).has('Cookie'),
        ),
      ).toBe(true);
      expect(test.controller.getSnapshot().auth.user).toBeNull();
    }
  });
  it('does not send a saved cookie to an unrecognized backend even when signing out', async () => {
    const test = setup({ saved: cookie, bootstrap: {} });
    await test.controller.restore();
    await test.controller.signOut();
    expect(test.saved()).toBeNull();
    expect(
      test.fetch.mock.calls.every(
        ([url, init]) =>
          url.endsWith('/.well-known/splitbook-mobile.json') &&
          !new Headers(init.headers).has('Cookie'),
      ),
    ).toBe(true);
  });
  it('never sends saved credentials through an invitation after staging verification fails', async () => {
    const test = setup({ saved: cookie, bootstrap: {} });
    await test.controller.restore();
    await test.controller.openInvitation(`${base}/join/abcdef12`);
    expect(test.controller.getSnapshot().invitation.status).toBe('error');
    expect(
      test.fetch.mock.calls.every(
        ([url, init]) =>
          url.endsWith('/.well-known/splitbook-mobile.json') &&
          !new Headers(init.headers).has('Cookie'),
      ),
    ).toBe(true);
  });
  it('refuses Google exchange over cleartext transport', async () => {
    const test = setup({ insecure: true });
    await test.controller.signInWithGoogle();
    expect(test.acquire).not.toHaveBeenCalled();
    expect(test.fetch).not.toHaveBeenCalled();
  });
  it('clears an expired saved Google session instead of showing protected content', async () => {
    const test = setup({ saved: cookie, intercept: async () => response(null) });
    await test.controller.restore();
    expect(test.controller.getSnapshot().auth.status).toBe('signed-out');
    expect(test.saved()).toBeNull();
  });
});
