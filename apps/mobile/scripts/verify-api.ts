/**
 * Real HTTP smoke for the development-persona mobile slice.
 * Requires the isolated, synthetic development server and seeded Sam fixtures.
 * It never seeds/resets a database or prints session cookies or response bodies.
 */
import assert from 'node:assert/strict';
import {
  createMobileController,
  type CredentialStore,
  type MobileController,
  type MobileFetch,
} from '../src/data';

const samId = 'a00000000000000000000002';
const tripId = 'a00000000000000000000010';
const householdId = 'a00000000000000000000020';
const alexOnlyId = 'a00000000000000000000030';

function localOrigin(): string {
  const url = new URL(process.env.MOBILE_VERIFY_URL ?? 'http://127.0.0.1:4138');
  assert.ok(
    url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      url.pathname === '/' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    'MOBILE_VERIFY_URL must be a plain HTTP loopback origin. Remote targets are refused.',
  );
  return url.origin;
}

async function verify() {
  const apiBaseUrl = localOrigin();
  let savedCookie: string | null = null;
  let requestCount = 0;
  let active: MobileController | undefined;
  const credentials: CredentialStore = {
    load: async () => savedCookie,
    save: async (cookie) => {
      savedCookie = cookie;
    },
    clear: async () => {
      savedCookie = null;
    },
  };
  const localFetch: MobileFetch = async (url, init) => {
    assert.ok(new URL(url).origin === apiBaseUrl, 'The controller attempted a nonlocal target.');
    requestCount += 1;
    return fetch(url, { ...init, redirect: 'error' });
  };
  const makeController = (developmentPersonaEnabled = true) =>
    createMobileController(
      { apiBaseUrl, authOrigin: apiBaseUrl, developmentPersonaEnabled },
      { fetch: localFetch, credentials },
    );
  const assertSamGroups = (controller: MobileController) => {
    const state = controller.getSnapshot();
    assert.ok(
      state.auth.status === 'authenticated' && state.auth.user?.id === samId,
      'Sam was not authenticated. Check demo mode and synthetic fixtures.',
    );
    assert.ok(state.groups.status === 'ready', 'The real Group list did not load.');
    assert.ok(state.groups.data.length === 2, 'Sam must have exactly the two synthetic Groups.');
    assert.ok(
      state.groups.data.some((group) => group.id === tripId),
      'The synthetic Trip is missing.',
    );
    assert.ok(
      state.groups.data.some((group) => group.id === householdId),
      'The synthetic Household is missing.',
    );
    assert.ok(
      state.groups.data.every(
        (group) => group.createdAt instanceof Date && Number.isFinite(group.createdAt.getTime()),
      ),
      'Group creation dates were not normalized.',
    );
  };

  try {
    active = makeController();
    await active.signIn('sam');
    assertSamGroups(active);
    assert.ok(savedCookie !== null, 'The signed session cookie was not persisted.');

    await active.openGroup(householdId);
    const household = active.getSnapshot().detail;
    assert.ok(
      household.status === 'ready' && household.data?.id === householdId,
      'The Household detail did not load.',
    );
    assert.ok(
      household.data.category === 'home' &&
        household.data.startDate === null &&
        household.data.endDate === null,
      'The Household shape does not match the real API contract.',
    );
    assert.ok(
      household.data.members.every(
        (member) => member.joinedAt instanceof Date && Number.isFinite(member.joinedAt.getTime()),
      ),
      'Member dates were not normalized.',
    );

    // Replace the entire controller, retaining only the injected credential store.
    // Group data is deliberately memory-only; this must revalidate and reread it.
    active.dispose();
    active = makeController();
    await active.restore();
    assertSamGroups(active);

    await active.openGroup(householdId);
    await active.openGroup(alexOnlyId);
    const denied = active.getSnapshot();
    assert.ok(
      denied.detail.status === 'denied' && denied.detail.data === null,
      'An unauthorized Group retained detail data.',
    );
    assert.ok(
      !denied.groups.data.some((group) => group.id === alexOnlyId),
      'An unauthorized Group appeared in the list.',
    );

    const revokedCookie = await credentials.load();
    assert.ok(revokedCookie, 'The session disappeared before sign-out.');
    await active.signOut();
    const signedOut = active.getSnapshot();
    assert.ok(
      signedOut.auth.status === 'signed-out' && signedOut.auth.user === null,
      'Sign-out retained a user.',
    );
    assert.ok(
      signedOut.groups.data.length === 0 && signedOut.detail.data === null,
      'Sign-out retained Group data.',
    );
    assert.ok((await credentials.load()) === null, 'Sign-out retained the saved credential.');

    const anonymous = await localFetch(`${apiBaseUrl}/api/groups`, {
      credentials: 'omit',
      signal: AbortSignal.timeout(20_000),
    });
    assert.ok(anonymous.status === 401, 'The real Group API did not reject an anonymous request.');
    const revoked = await localFetch(`${apiBaseUrl}/api/auth/get-session`, {
      headers: { Cookie: revokedCookie },
      credentials: 'omit',
      signal: AbortSignal.timeout(20_000),
    });
    assert.ok(
      revoked.status === 200 && (await revoked.json()) === null,
      'The server did not revoke the signed-out session.',
    );

    active.dispose();
    await credentials.save(revokedCookie);
    active = makeController(false);
    const beforeDisabled = requestCount;
    await active.restore();
    await active.signIn('sam');
    assert.ok(
      requestCount === beforeDisabled,
      'Disabled development authentication made a request.',
    );
    assert.ok(
      active.getSnapshot().auth.status === 'signed-out' &&
        active.getSnapshot().groups.data.length === 0,
      'Disabled development authentication exposed data.',
    );
    assert.ok(
      (await credentials.load()) === null,
      'Disabled development authentication retained a credential.',
    );

    console.log(
      'PASS: real persona sign-in, scoped Groups, Household dates, session restore, denied access, server sign-out, and disabled development auth.',
    );
  } finally {
    // Revoke a successfully created test session if a later assertion failed.
    if (active) {
      await active.signOut();
      active.dispose();
    }
  }
}

void verify().catch((error: unknown) => {
  // Assertion messages are fixed, and unexpected transport errors are summarized.
  // Never print a response, credential, supplied URL, or stack trace.
  console.error(
    error instanceof assert.AssertionError
      ? `FAIL: ${error.message}`
      : 'FAIL: the local mobile API smoke could not complete. Check the isolated development server.',
  );
  process.exitCode = 1;
});
