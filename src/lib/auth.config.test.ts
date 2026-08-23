import { afterEach, describe, expect, it, vi } from 'vitest';
import { authConfig } from '@/lib/auth.config';

interface ProviderLike {
  id: string;
  type: string;
  options?: { id?: string };
}

const providers = authConfig.providers as unknown as ProviderLike[];

describe('authConfig providers', () => {
  it('registers the Google OIDC provider for real authentication', () => {
    const google = providers.find((provider) => provider.id === 'google');
    expect(google).toBeDefined();
    expect(google?.type).toBe('oidc');
  });

  it('registers demo credentials under the demo provider id', () => {
    // NextAuth merges provider.options over the defaults at init time, so the
    // runtime provider id is 'demo' (see /api/auth/providers).
    const demo = providers.find((provider) => provider.options?.id === 'demo');
    expect(demo).toBeDefined();
    expect(demo?.type).toBe('credentials');
  });

  it('uses JWT sessions shared by both auth modes', () => {
    expect(authConfig.session?.strategy).toBe('jwt');
  });

  it('routes sign-in through the custom /login page', () => {
    expect(authConfig.pages?.signIn).toBe('/login');
  });

  it('routes authentication errors through the custom /login page', () => {
    expect(authConfig.pages?.error).toBe('/login');
  });
});

type SignIn = NonNullable<NonNullable<typeof authConfig.callbacks>['signIn']>;
type SignInParams = Parameters<SignIn>[0];

async function callSignIn(provider: string, email: string | null) {
  const signIn = authConfig.callbacks?.signIn as SignIn;
  return signIn({
    user: { id: 'user-1', email },
    account: { provider, type: provider === 'google' ? 'oidc' : 'credentials' },
  } as unknown as SignInParams);
}

describe('authConfig signIn callback', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts an allowlisted Google identity after normalizing case and whitespace', async () => {
    vi.stubEnv('AUTH_ALLOWED_EMAILS', ' owner@example.com, Invited@Example.COM ');

    await expect(callSignIn('google', 'invited@example.com')).resolves.toBe(true);
  });

  it('rejects a Google identity that is not allowlisted', async () => {
    vi.stubEnv('AUTH_ALLOWED_EMAILS', 'owner@example.com');

    await expect(callSignIn('google', 'stranger@example.com')).resolves.toBe(false);
  });

  it.each([undefined, '', ' , '])(
    'fails closed for Google sign-in when AUTH_ALLOWED_EMAILS is %s',
    async (allowedEmails) => {
      if (allowedEmails === undefined) {
        delete process.env.AUTH_ALLOWED_EMAILS;
      } else {
        vi.stubEnv('AUTH_ALLOWED_EMAILS', allowedEmails);
      }

      await expect(callSignIn('google', 'owner@example.com')).resolves.toBe(false);
    },
  );

  it('does not apply the Google allowlist to demo credentials', async () => {
    delete process.env.AUTH_ALLOWED_EMAILS;

    await expect(callSignIn('demo', 'alex.demo@splitbook.local')).resolves.toBe(true);
  });
});

type Authorized = NonNullable<NonNullable<typeof authConfig.callbacks>['authorized']>;
type AuthorizedParams = Parameters<Authorized>[0];

function callAuthorized(pathname: string, loggedIn: boolean, method = 'GET') {
  const authorized = authConfig.callbacks?.authorized as Authorized;
  const params = {
    auth: loggedIn ? { user: { id: 'user-1' } } : null,
    request: { nextUrl: new URL(`http://localhost:3100${pathname}`), method },
  } as unknown as AuthorizedParams;
  return authorized(params);
}

describe('authConfig authorized callback', () => {
  it('always allows Auth.js API routes (including the Google callback)', () => {
    expect(callAuthorized('/api/auth/callback/google', false)).toBe(true);
    expect(callAuthorized('/api/auth/session', true)).toBe(true);
  });

  it('redirects logged-in users away from /login to the dashboard', () => {
    const result = callAuthorized('/login', true);
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('http://localhost:3100/dashboard');
  });

  it('allows public pages for anonymous users', () => {
    expect(callAuthorized('/', false)).toBe(true);
    expect(callAuthorized('/join/ABC123', false)).toBe(true);
    expect(callAuthorized('/login', false)).toBe(true);
  });

  it('rejects anonymous API calls (returns false -> 401)', () => {
    expect(callAuthorized('/api/groups', false)).toBe(false);
  });

  it('allows anonymous GET invite previews so the join page can render', () => {
    expect(callAuthorized('/api/join/ABC123', false)).toBe(true);
  });

  it('rejects anonymous join POSTs (joining requires a session)', () => {
    expect(callAuthorized('/api/join/ABC123', false, 'POST')).toBe(false);
  });

  it('redirects anonymous page visits to /login with callbackUrl', () => {
    const result = callAuthorized('/dashboard', false);
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    const location = new URL(response.headers.get('location') as string);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('callbackUrl')).toBe('/dashboard');
  });

  it('allows logged-in users on pages and APIs', () => {
    expect(callAuthorized('/dashboard', true)).toBe(true);
    expect(callAuthorized('/api/groups', true)).toBe(true);
  });
});
