/**
 * Ticket #58: Settings/session isolation through the real local HTTP backend.
 * Only authentication sessions are written. No ledger changes, DB access,
 * fixture resets, remote targets, or credential/response-body logging.
 * Opaque registered stores stand in for future account-local feature storage.
 */
import assert from 'node:assert/strict';
import {
  createMobileController,
  type CredentialStore,
  type MobileController,
  type MobileFetch,
} from '../src/data';
import { decodeStoredSession } from '../src/data/cookies';
import type { AccountLocalStorage } from '../src/data/types';
import { localOrigin } from './verification-origin';
import { observe, reportVerifierFailure } from './verify-report';

const alexId = 'a00000000000000000000001';
const samId = 'a00000000000000000000002';
const alexOnlyGroup = 'a00000000000000000000030';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function assertSignedOut(controller: MobileController) {
  const state = controller.getSnapshot();
  observe(
    state.auth.status === 'signed-out' && state.auth.user === null,
    'A signed-out controller retained or restored an account.',
    { status: state.auth.status, user: state.auth.user?.id ?? null },
  );
  observe(
    state.groups.data.length === 0 && state.detail.data === null,
    'A signed-out controller retained or restored Group data.',
    { groups: state.groups.data.length, detail: state.detail.data?.id ?? null },
  );
  observe(
    state.creation.draft.name === '' && state.invitation.code === null && state.share.url === null,
    'A signed-out controller retained a form, invitation, or share link.',
    {
      draftName: state.creation.draft.name,
      invitation: state.invitation.code,
      share: state.share.url,
    },
  );
}

async function verify() {
  const apiBaseUrl = localOrigin();
  let savedCookie: string | null = null;
  let storedOwner: string | null = null;
  let cleanupPending = false;
  let holdNextGroupRead = false;
  let active: MobileController | undefined;
  const ownedCookies = new Set<string>();
  const sessionCookie = (value: string) =>
    decodeStoredSession(value, apiBaseUrl.startsWith('https:'))?.cookie;
  const heldResponse = deferred<AbortSignal>();
  const releaseResponse = deferred<void>();
  const cache = new Map<string, string>();
  const draft = new Map<string, string>();
  const submission = new Map<string, string>();
  const featureStores = [cache, draft, submission];
  const credentials: CredentialStore = {
    load: async () => savedCookie,
    save: async (value) => {
      savedCookie = value;
      // The saved session is the cookie and, once verified, its account (#200).
      ownedCookies.add(sessionCookie(value) ?? value);
    },
    clear: async () => {
      savedCookie = null;
    },
  };
  const accountLocal: AccountLocalStorage = {
    owner: {
      load: async () => storedOwner,
      save: async (accountId) => {
        storedOwner = accountId;
      },
      clear: async () => {
        storedOwner = null;
      },
    },
    cleanupMarker: {
      load: async () => cleanupPending,
      mark: async () => {
        cleanupPending = true;
      },
      clear: async () => {
        cleanupPending = false;
      },
    },
    stores: featureStores.map((storage) => ({
      clear: async () => {
        storage.clear();
      },
    })),
  };
  const localFetch: MobileFetch = async (url, init) => {
    const target = new URL(url);
    observe(target.origin === apiBaseUrl, 'A request attempted to leave the local backend.', {
      origin: target.origin,
    });
    observe(
      !init.method ||
        init.method === 'GET' ||
        (init.method === 'POST' &&
          ['/api/auth/demo-persona/sign-in', '/api/auth/sign-out'].includes(target.pathname)),
      'The Settings smoke attempted a non-authentication write.',
      { method: init.method ?? 'GET', path: target.pathname },
    );
    const hold = holdNextGroupRead && target.pathname === '/api/groups';
    if (hold) holdNextGroupRead = false;
    const response = await fetch(url, { ...init, redirect: 'error' });
    if (!hold) return response;
    observe(response.ok, 'The held Group read did not succeed against the real backend.', {
      status: response.status,
    });
    observe(init.signal, 'The real Group read had no cancellation signal.', {
      cancellable: Boolean(init.signal),
    });
    // Consume the actual server response before holding delivery. Logout cannot
    // undo completed work, so the controller must reject this late result too.
    const body = await response.arrayBuffer();
    const delivered = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    heldResponse.resolve(init.signal);
    await releaseResponse.promise;
    return delivered;
  };
  const makeController = () =>
    createMobileController(
      { apiBaseUrl, authOrigin: apiBaseUrl, developmentPersonaEnabled: true },
      { fetch: localFetch, credentials, accountLocal },
    );
  const assertStoresEmpty = () => {
    observe(
      featureStores.every((storage) => storage.size === 0),
      'Registered account-local storage retained or recovered a value.',
      { sizes: featureStores.map((storage) => storage.size) },
    );
    observe(!cleanupPending, 'The successful cleanup left its restart marker pending.', {
      pending: cleanupPending,
    });
  };
  const assertRevoked = async (cookie: string) => {
    const response = await fetch(`${apiBaseUrl}/api/auth/get-session`, {
      headers: { Cookie: cookie, Origin: apiBaseUrl, Accept: 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
    observe(
      response.status === 200 && (await response.json()) === null,
      'The real backend retained a signed-out session.',
      { status: response.status },
    );
  };

  try {
    active = makeController();
    await active.signIn('alex');
    active.openSettings();
    const settings = active.getSnapshot();
    observe(
      settings.screen === 'settings' &&
        settings.auth.user?.id === alexId &&
        settings.auth.user.name === 'Alex Rivera' &&
        settings.auth.user.email === 'alex.demo@splitbook.local',
      'Settings did not expose the actual signed-in Alex identity.',
      {
        screen: settings.screen,
        user: settings.auth.user?.id ?? null,
        name: settings.auth.user?.name ?? null,
        emailMatches: settings.auth.user?.email === 'alex.demo@splitbook.local',
      },
    );
    await active.refresh();
    observe(active.getSnapshot().screen === 'settings', 'Session refresh left Settings.', {
      screen: active.getSnapshot().screen,
    });
    observe(
      active.getSnapshot().groups.data.some((group) => group.id === alexOnlyGroup),
      'Alex did not receive the synthetic private Group.',
      { groups: active.getSnapshot().groups.data.map((group) => group.id) },
    );
    const alexLease = active.accountStorage();
    observe(
      alexLease?.accountId === alexId,
      'Alex did not receive an account-bound storage lease.',
      { accountId: alexLease?.accountId ?? null },
    );
    await alexLease.write(async () => {
      cache.set(alexId, 'cached-view-marker');
      draft.set(alexId, 'draft-marker');
      submission.set(alexId, 'unresolved-attempt-marker');
    });
    active.startCreate();
    active.updateCreation({ name: 'Unsaved Settings verification form' });
    active.back();
    holdNextGroupRead = true;
    const refreshing = active.refresh();
    const signal = await Promise.race([
      heldResponse.promise,
      refreshing.then(() => {
        throw new Error('The real Group request finished before delivery could be held.');
      }),
    ]);
    active.openSettings();
    const revokedCookie = sessionCookie((await credentials.load()) ?? '');
    observe(revokedCookie, 'Alex had no saved session before logout.', {
      saved: Boolean(revokedCookie),
    });
    await active.signOut();
    observe(signal.aborted, 'Sign-out did not cancel the in-flight Group request.', {
      aborted: signal.aborted,
    });
    assertSignedOut(active);
    assertStoresEmpty();
    observe((await credentials.load()) === null, 'Sign-out retained the saved session cookie.', {
      credential: 'still saved',
    });
    observe((await accountLocal.owner.load()) === null, 'Sign-out retained the storage owner.', {
      owner: 'still saved',
    });
    await assertRevoked(revokedCookie);

    releaseResponse.resolve();
    await refreshing;
    assertSignedOut(active);
    assertStoresEmpty();
    await assert.rejects(
      alexLease.write(async () => {
        cache.set(alexId, 'late-cache-marker');
        draft.set(alexId, 'late-draft-marker');
        submission.set(alexId, 'late-attempt-marker');
      }),
      'A retired account lease allowed late storage writes.',
    );
    assertStoresEmpty();

    // Retain only the external storage objects, as a restarted application does.
    active.dispose();
    active = makeController();
    await active.restore();
    assertSignedOut(active);
    assertStoresEmpty();
    await active.signIn('sam');
    active.openSettings();
    const sam = active.getSnapshot();
    observe(
      sam.screen === 'settings' &&
        sam.auth.user?.id === samId &&
        sam.auth.user.name === 'Sam Chen' &&
        sam.auth.user.email === 'sam.demo@splitbook.local',
      'Settings did not reflect Sam after the account switch.',
      {
        screen: sam.screen,
        user: sam.auth.user?.id ?? null,
        name: sam.auth.user?.name ?? null,
        emailMatches: sam.auth.user?.email === 'sam.demo@splitbook.local',
      },
    );
    observe(
      sam.groups.status === 'ready' &&
        sam.groups.data.length > 0 &&
        sam.groups.data.every(
          (group) =>
            group.id !== alexOnlyGroup && group.members.some((member) => member.user.id === samId),
        ),
      'The account switch exposed Alex-only or unscoped Group data.',
      {
        status: sam.groups.status,
        groups: sam.groups.data.map((group) => ({
          id: group.id,
          members: group.members.map((member) => member.user.id),
        })),
      },
    );
    assertStoresEmpty();
    const samLease = active.accountStorage();
    observe(samLease?.accountId === samId, 'Sam did not receive his own storage lease.', {
      accountId: samLease?.accountId ?? null,
    });
    await samLease.write(async () => {
      cache.set(samId, 'sam-cache-marker');
    });
    await active.signOut();
    assertSignedOut(active);
    assertStoresEmpty();
  } finally {
    releaseResponse.resolve();
    if (active) {
      await active.signOut();
      active.dispose();
    }
    // Retry revocation for every session issued to this smoke, including an
    // interrupted sign-in. These values never leave memory or appear in output.
    for (const cookie of ownedCookies) {
      await fetch(`${apiBaseUrl}/api/auth/sign-out`, {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: apiBaseUrl,
          'Content-Type': 'application/json',
        },
        body: '{}',
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      });
      await assertRevoked(cookie);
    }
  }
  console.log(
    'PASS: real Settings identities, foreground validation, logout cancellation and server revocation, late-response isolation, registered storage purge, retired lease rejection, restart, and account switch.',
  );
}

void verify().catch((error: unknown) =>
  reportVerifierFailure(
    error,
    'the local Settings smoke could not complete. Check the isolated development backend.',
  ),
);
