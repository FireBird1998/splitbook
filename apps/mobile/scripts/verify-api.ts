/**
 * Real HTTP smoke for the development-persona mobile slice.
 * Requires the isolated, synthetic development server and seeded Sam fixtures.
 * It never seeds/resets a database or prints session cookies or response bodies.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createMobileController,
  type CredentialStore,
  type MobileController,
  type MobileFetch,
} from '../src/data';
import { decodeStoredSession, readSessionCookie } from '../src/data/cookies';
import { localOrigin } from './verification-origin';
import { observe, reportVerifierFailure } from './verify-report';

const samId = 'a00000000000000000000002';
const tripId = 'a00000000000000000000010';
const householdId = 'a00000000000000000000020';
const alexOnlyId = 'a00000000000000000000030';
/** Better Auth's session lifetime and refresh age on the backend, in days (create-auth.ts). */
const sessionDays = 30,
  refreshDays = 1,
  day = 24 * 60 * 60 * 1000;

type Sessions = {
  updateOne(filter: object, update: object): Promise<{ matchedCount: number }>;
  findOne(filter: object): Promise<{ expiresAt: Date } | null>;
};

/**
 * #333: the app sends reads that don't depend on each other together, with one cookie. When the
 * backend refreshes a session it must keep the session's token: a new one would leave the reads
 * sent beside the refresh, with the old cookie, refused, and sign the member out. This ages the
 * session past the refresh age in this backend's own database, sends a session check and two
 * reads together, and checks that the session kept its token, that every cookie a reply sets is
 * the one sent, and that it still works. It needs the backend's SPLITBOOK_NATIVE_* variables,
 * which the gate passes, so it never ages a session in the shared database.
 */
async function sessionKeepsItsToken(origin: string, cookie: string) {
  const { SPLITBOOK_NATIVE_DATABASE: database, SPLITBOOK_NATIVE_ORIGIN_PORT: port } = process.env;
  // Only a backend of its own: never the shared one, and only the one these requests reach.
  const refused = !database
    ? 'needs this backend’s SPLITBOOK_NATIVE_* variables (pnpm swarm up prints them)'
    : database === 'splitbook_mobile_50'
      ? 'never ages a session in the shared database, splitbook_mobile_50'
      : new URL(origin).port !== port
        ? 'needs SPLITBOOK_NATIVE_ORIGIN_PORT to be the port of MOBILE_VERIFY_URL'
        : null;
  if (refused) {
    console.log(`SKIP: the session refresh check ${refused}.`);
    return false;
  }
  const token = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)).split('.')[0];
  const control = resolve(process.cwd(), 'scripts/dev-backend/database.mjs');
  const { withIsolatedDatabase } = (await import(pathToFileURL(control).href)) as {
    withIsolatedDatabase: <T>(
      action: (database: { collection(name: 'sessions'): Sessions }) => Promise<T>,
    ) => Promise<T>;
  };
  const sessions = <T>(action: (collection: Sessions) => Promise<T>) =>
    withIsolatedDatabase((database) => action(database.collection('sessions')));
  // Due for a refresh: an hour past the refresh age.
  const aged = new Date(Date.now() + (sessionDays - refreshDays) * day - 60 * 60 * 1000);
  const changed = await sessions((collection) =>
    collection.updateOne({ token }, { $set: { expiresAt: aged } }),
  );
  observe(changed.matchedCount === 1, 'The session to age was not found.', {
    matched: changed.matchedCount,
  });

  const read = (path: string) =>
    fetch(`${origin}${path}`, {
      headers: { Cookie: cookie },
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
  const replies = await Promise.all(
    ['/api/auth/get-session', '/api/groups', '/api/user/balances'].map(read),
  );
  observe(
    replies.every((reply) => reply.status === 200),
    'A read sent beside a session refresh was refused.',
    { statuses: replies.map((reply) => reply.status) },
  );
  observe(
    replies.every((reply) => {
      const next = readSessionCookie(reply.headers, origin.startsWith('https:'), Date.now());
      return next === undefined || next === cookie;
    }),
    'A session refresh set another session cookie.',
    { statuses: replies.map((reply) => reply.status) },
  );
  const refreshed = await sessions((collection) => collection.findOne({ token }));
  observe(
    refreshed !== null && refreshed.expiresAt.getTime() > aged.getTime(),
    'The aged session was not refreshed under its own token.',
    { aged, refreshedUntil: refreshed?.expiresAt ?? null },
  );
  const after = await read('/api/auth/get-session');
  observe(
    after.status === 200 && (await after.json()) !== null,
    'The session cookie stopped working after a refresh.',
    { status: after.status },
  );
  return true;
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
    observe(new URL(url).origin === apiBaseUrl, 'The controller attempted a nonlocal target.', {
      origin: new URL(url).origin,
    });
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
    observe(
      state.auth.status === 'authenticated' && state.auth.user?.id === samId,
      'Sam was not authenticated. Check demo mode and synthetic fixtures.',
      { status: state.auth.status, user: state.auth.user?.id ?? null },
    );
    observe(state.groups.status === 'ready', 'The real Group list did not load.', {
      status: state.groups.status,
    });
    // The fictional database may also hold other test Groups, so the seed Groups are
    // checked by identity, and every listed Group must be one Sam belongs to.
    observe(
      state.groups.data.some((group) => group.id === tripId),
      'The synthetic Trip is missing.',
      { groups: state.groups.data.map((group) => group.id) },
    );
    observe(
      state.groups.data.some((group) => group.id === householdId),
      'The synthetic Household is missing.',
      { groups: state.groups.data.map((group) => group.id) },
    );
    observe(
      !state.groups.data.some((group) => group.id === alexOnlyId),
      'The Alex-only Group appeared in Sam’s list.',
      { groups: state.groups.data.map((group) => group.id) },
    );
    observe(
      state.groups.data.every((group) => group.members.some((member) => member.user.id === samId)),
      'The Group list included a Group Sam is not a member of.',
      {
        groups: state.groups.data.map((group) => ({
          id: group.id,
          members: group.members.map((member) => member.user.id),
        })),
      },
    );
    observe(
      state.groups.data.every(
        (group) => group.createdAt instanceof Date && Number.isFinite(group.createdAt.getTime()),
      ),
      'Group creation dates were not normalized.',
      { createdAt: state.groups.data.map((group) => group.createdAt) },
    );
  };

  try {
    active = makeController();
    await active.signIn('sam');
    assertSamGroups(active);
    observe(savedCookie !== null, 'The signed session cookie was not persisted.', {
      saved: savedCookie !== null,
    });

    await active.openGroup(householdId);
    const household = active.getSnapshot().detail;
    observe(
      household.status === 'ready' && household.data?.id === householdId,
      'The Household detail did not load.',
      { status: household.status, id: household.data?.id ?? null },
    );
    observe(
      household.data.category === 'home' &&
        household.data.startDate === null &&
        household.data.endDate === null,
      'The Household shape does not match the real API contract.',
      {
        category: household.data.category,
        startDate: household.data.startDate,
        endDate: household.data.endDate,
      },
    );
    observe(
      household.data.members.every(
        (member) => member.joinedAt instanceof Date && Number.isFinite(member.joinedAt.getTime()),
      ),
      'Member dates were not normalized.',
      { joinedAt: household.data.members.map((member) => member.joinedAt) },
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
    observe(
      denied.detail.status === 'denied' && denied.detail.data === null,
      'An unauthorized Group retained detail data.',
      { status: denied.detail.status, data: denied.detail.data?.id ?? null },
    );
    observe(
      !denied.groups.data.some((group) => group.id === alexOnlyId),
      'An unauthorized Group appeared in the list.',
      { groups: denied.groups.data.map((group) => group.id) },
    );

    const revokedSession = await credentials.load();
    observe(revokedSession, 'The session disappeared before sign-out.', {
      found: Boolean(revokedSession),
    });
    const revokedCookie = decodeStoredSession(revokedSession, apiBaseUrl.startsWith('https:'));
    observe(revokedCookie?.accountId === samId, 'The saved session was not recorded for Sam.', {
      accountId: revokedCookie?.accountId ?? null,
    });
    const refreshChecked = await sessionKeepsItsToken(apiBaseUrl, revokedCookie.cookie);
    await active.signOut();
    const signedOut = active.getSnapshot();
    observe(
      signedOut.auth.status === 'signed-out' && signedOut.auth.user === null,
      'Sign-out retained a user.',
      { status: signedOut.auth.status, user: signedOut.auth.user?.id ?? null },
    );
    observe(
      signedOut.groups.data.length === 0 && signedOut.detail.data === null,
      'Sign-out retained Group data.',
      { groups: signedOut.groups.data.length, detail: signedOut.detail.data?.id ?? null },
    );
    observe((await credentials.load()) === null, 'Sign-out retained the saved credential.', {
      credential: 'still saved',
    });

    const anonymous = await localFetch(`${apiBaseUrl}/api/groups`, {
      credentials: 'omit',
      signal: AbortSignal.timeout(20_000),
    });
    observe(anonymous.status === 401, 'The real Group API did not reject an anonymous request.', {
      status: anonymous.status,
    });
    const revoked = await localFetch(`${apiBaseUrl}/api/auth/get-session`, {
      headers: { Cookie: revokedCookie.cookie },
      credentials: 'omit',
      signal: AbortSignal.timeout(20_000),
    });
    observe(
      revoked.status === 200 && (await revoked.json()) === null,
      'The server did not revoke the signed-out session.',
      { status: revoked.status },
    );

    active.dispose();
    await credentials.save(revokedSession);
    active = makeController(false);
    const beforeDisabled = requestCount;
    await active.restore();
    await active.signIn('sam');
    observe(
      requestCount === beforeDisabled,
      'Disabled development authentication made a request.',
      { requests: requestCount - beforeDisabled },
    );
    observe(
      active.getSnapshot().auth.status === 'signed-out' &&
        active.getSnapshot().groups.data.length === 0,
      'Disabled development authentication exposed data.',
      { status: active.getSnapshot().auth.status, groups: active.getSnapshot().groups.data.length },
    );
    observe(
      (await credentials.load()) === null,
      'Disabled development authentication retained a credential.',
      { credential: 'still saved' },
    );

    console.log(
      `PASS: real persona sign-in, scoped Groups, Household dates, session restore, denied access, ${refreshChecked ? 'a session refresh that keeps its token, ' : ''}server sign-out, and disabled development auth.`,
    );
  } finally {
    // Revoke a successfully created test session if a later assertion failed.
    if (active) {
      await active.signOut();
      active.dispose();
    }
  }
}

void verify().catch((error: unknown) =>
  reportVerifierFailure(
    error,
    'the local mobile API smoke could not complete. Check the isolated development server.',
  ),
);
