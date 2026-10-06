/**
 * Ticket #52: public controller actions over real, isolated HTTP persistence.
 * Only uniquely named Groups created by this run may be archived during cleanup.
 * No database access, fixture resets, remote targets, or credential/link logging.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createMobileController, currentMonthKey, type MobileFetch } from '../src/data';
import { decodeStoredSession } from '../src/data/cookies';
import { localOrigin } from './verification-origin';

const alexId = 'a00000000000000000000001';
const samId = 'a00000000000000000000002';
const id = z.string().regex(/^[a-f\d]{24}$/i);
const groupList = z.object({
  status: z.literal(200),
  data: z.array(
    z.object({
      _id: id,
      name: z.string(),
      createdBy: id,
      members: z.array(z.object({ user: z.object({ _id: id }), role: z.string() })),
    }),
  ),
});

async function verify() {
  const apiBaseUrl = localOrigin();
  const runId = randomUUID();
  const householdName = `Mobile 52 household ${runId}`;
  const uncertainName = `Mobile 52 response loss ${runId}`;
  const resendName = `Mobile 52 transport resend ${runId}`;
  const restartName = `Mobile 203 restart while uncertain ${runId}`;
  const ownNames = new Set<string>();
  const checks: string[] = [];
  let archivedCount = 0;

  const makeActor = () => {
    let cookie: string | null = null;
    let pendingCode: string | null = null;
    // This device's account storage, kept across a restart like the app's own storage.
    let accountOwner: string | null = null;
    let cleanupPending = false;
    const groupCreations = new Map<string, unknown>();
    let requests = 0;
    // Every request the controller sends, as its method and path, in order.
    const sent: string[] = [];
    let createPosts = 0;
    let joinPosts = 0;
    let invitePosts = 0;
    let loseCreateResponse = false;
    let resendCreate = false;
    const createKeys: (string | null)[] = [];
    let loseInviteResponse = false;
    const transport: MobileFetch = async (url, init) => {
      requests += 1;
      const target = new URL(url);
      assert.ok(target.origin === apiBaseUrl, 'A request attempted to leave the local backend.');
      sent.push(`${init.method ?? 'GET'} ${target.pathname}`);
      const creating = init.method === 'POST' && target.pathname === '/api/groups';
      const joining = init.method === 'POST' && target.pathname.startsWith('/api/join/');
      const generating = init.method === 'POST' && target.pathname.endsWith('/invite-link');
      if (creating) createPosts += 1;
      if (creating) createKeys.push(new Headers(init.headers).get('Idempotency-Key'));
      if (joining) joinPosts += 1;
      if (generating) invitePosts += 1;
      if (creating && resendCreate) {
        // Android's OkHttp resends an identical request after a pooled connection
        // drops the response. The first request really commits before it is resent.
        resendCreate = false;
        const lost = await fetch(url, { ...init, redirect: 'error' });
        await lost.arrayBuffer();
        assert.ok(lost.status === 201, 'The first create before the resend did not commit.');
        createPosts += 1;
        createKeys.push(new Headers(init.headers).get('Idempotency-Key'));
      }
      const response = await fetch(url, { ...init, redirect: 'error' });
      if (response.ok && ((creating && loseCreateResponse) || (generating && loseInviteResponse))) {
        // The real server has committed and completed its response. Lose only
        // delivery to the controller; never substitute persistence with a mock.
        await response.arrayBuffer();
        if (creating) loseCreateResponse = false;
        if (generating) loseInviteResponse = false;
        throw new Error('Simulated response loss after successful server completion.');
      }
      return response;
    };
    const dependencies = {
      fetch: transport,
      credentials: {
        load: async () => cookie,
        save: async (value: string) => {
          cookie = value;
        },
        clear: async () => {
          cookie = null;
        },
      },
      pendingInvitation: {
        load: async () => pendingCode,
        save: async (value: string) => {
          pendingCode = value;
        },
        clear: async () => {
          pendingCode = null;
        },
      },
      groupCreations: {
        load: async (accountId: string) => structuredClone(groupCreations.get(accountId) ?? null),
        save: async (accountId: string, value: unknown) => {
          groupCreations.set(accountId, structuredClone(value));
        },
        remove: async (accountId: string) => {
          groupCreations.delete(accountId);
        },
        clear: async () => {
          groupCreations.clear();
        },
      },
      accountLocal: {
        owner: {
          load: async () => accountOwner,
          save: async (value: string) => {
            accountOwner = value;
          },
          clear: async () => {
            accountOwner = null;
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
        stores: [{ clear: async () => groupCreations.clear() }],
      },
    };
    const build = () =>
      createMobileController(
        {
          apiBaseUrl,
          authOrigin: apiBaseUrl,
          inviteOrigin: apiBaseUrl,
          developmentPersonaEnabled: true,
        },
        { ...dependencies, newSubmissionKey: randomUUID },
      );
    let controller = build();
    return {
      get controller() {
        return controller;
      },
      get requests() {
        return requests;
      },
      get sent() {
        return sent;
      },
      get createPosts() {
        return createPosts;
      },
      get createKeys() {
        return createKeys;
      },
      get joinPosts() {
        return joinPosts;
      },
      get invitePosts() {
        return invitePosts;
      },
      get pendingCode() {
        return pendingCode;
      },
      loseNextCreateResponse() {
        loseCreateResponse = true;
      },
      resendNextCreate() {
        resendCreate = true;
      },
      loseNextInviteResponse() {
        loseInviteResponse = true;
      },
      restart() {
        controller.dispose();
        controller = build();
      },
      async authorized(path: string, method = 'GET') {
        // The saved session is the cookie and, once verified, its account (#200).
        const session = cookie && decodeStoredSession(cookie, apiBaseUrl.startsWith('https:'));
        assert.ok(session, 'The authorized read or cleanup has no session.');
        assert.ok(path.startsWith('/api/'), 'Only local API requests are permitted.');
        return fetch(`${apiBaseUrl}${path}`, {
          method,
          headers: { Cookie: session.cookie, Origin: apiBaseUrl, Accept: 'application/json' },
          credentials: 'omit',
          redirect: 'error',
          signal: AbortSignal.timeout(20_000),
        });
      },
    };
  };

  const alex = makeActor();
  const sam = makeActor();
  const discoverOwnGroups = async () => {
    const response = await alex.authorized('/api/groups');
    assert.ok(response.status === 200, 'Could not read Groups for this run.');
    return groupList
      .parse(await response.json())
      .data.filter(
        (group) =>
          ownNames.has(group.name) &&
          group.createdBy === alexId &&
          group.members.some((member) => member.user._id === alexId && member.role === 'admin'),
      );
  };

  try {
    await alex.controller.signIn('alex');
    assert.ok(alex.controller.getSnapshot().auth.user?.id === alexId, 'Alex did not sign in.');
    ownNames.add(householdName);
    alex.controller.startCreate();
    alex.controller.updateCreation({
      name: householdName,
      description: 'Fictional native invitation verification.',
      category: 'home',
      defaultCurrency: 'INR',
      startDate: '',
      endDate: '',
    });
    const beforeCreate = alex.sent.length;
    await alex.controller.createGroup();
    const ownGroups = await discoverOwnGroups();
    const household = ownGroups.find((group) => group.name === householdName);
    assert.ok(household, 'The created Household was absent from an authorized read.');
    assert.ok(
      ownGroups.filter((group) => group.name === householdName).length === 1,
      'Creation saved more than one Household.',
    );
    // Nothing opens it again: a confirmed create opens the Group the way Home does (#189).
    const opened = alex.controller.getSnapshot();
    const created = opened.detail;
    assert.ok(
      opened.screen === 'group' && created.status === 'ready' && created.data?.id === household._id,
      'Created Group detail did not open.',
    );
    assert.ok(
      created.data.category === 'home' && created.data.defaultCurrency === 'INR',
      'Theme or currency did not persist.',
    );
    assert.ok(
      created.data.startDate === null && created.data.endDate === null,
      'Household unexpectedly acquired Trip dates.',
    );
    assert.ok(
      created.data.members.length === 1 &&
        created.data.members[0].user.id === alexId &&
        created.data.members[0].role === 'admin',
      'The creator was not the sole initial admin.',
    );
    checks.push('Household creation and authorized persisted read-back');
    const householdPath = `/api/groups/${household._id}`;
    assert.deepEqual(
      alex.sent.slice(beforeCreate),
      [
        'POST /api/groups',
        `GET ${householdPath}`,
        `GET ${householdPath}/expenses`,
        `GET ${householdPath}/balances`,
        // Then the Groups list, on purpose: the create made the saved list obsolete, so it is read
        // again once the Group has opened, as after a join, and an offline restart lists it (#283).
        'GET /api/groups',
      ],
      'The created Household was not read, then its Expenses, then its Balances, then the Groups list.',
    );
    const { financial } = opened;
    assert.ok(
      financial.groupId === household._id &&
        financial.month === currentMonthKey() &&
        financial.expenses.month === financial.month &&
        financial.expenses.status === 'ready' &&
        financial.expenses.data.length === 0 &&
        financial.balances.status === 'ready',
      'The created Household did not open on the current Month with its Expenses and Balances.',
    );
    checks.push(
      'A created Household opens on the current Month with its Expenses and Balances read, with no openGroup',
    );

    const invitationUrl = await alex.controller.loadInviteLink();
    assert.ok(invitationUrl, 'No invitation link was returned.');
    const invitation = new URL(invitationUrl);
    assert.ok(
      invitation.origin === apiBaseUrl && /^\/join\/[a-f\d]{8}$/.test(invitation.pathname),
      'The invitation was not a canonical local web link.',
    );
    const generations = alex.invitePosts;
    assert.ok(
      (await alex.controller.loadInviteLink()) === invitationUrl &&
        alex.invitePosts === generations,
      'Reading the current invite unexpectedly rotated it.',
    );
    checks.push('Canonical invite link and reuse without rotation');
    await alex.controller.signOut();

    await sam.controller.restore();
    await sam.controller.openInvitation(invitationUrl);
    assert.ok(
      sam.controller.getSnapshot().invitation.preview?.id === household._id,
      'Anonymous invitation preview did not load.',
    );
    assert.ok(
      sam.controller.getSnapshot().auth.status === 'signed-out' && sam.joinPosts === 0,
      'Opening a public preview changed membership or authentication.',
    );
    assert.ok(sam.pendingCode, 'The invitation destination was not retained.');
    sam.restart();
    await sam.controller.restore();
    assert.ok(
      sam.controller.getSnapshot().invitation.preview?.id === household._id,
      'The pending invitation did not survive a controller restart.',
    );
    await sam.controller.signIn('sam');
    assert.ok(sam.controller.getSnapshot().auth.user?.id === samId, 'Sam did not sign in.');
    assert.ok(
      sam.controller.getSnapshot().invitation.preview?.id === household._id,
      'Sign-in lost the pending invitation.',
    );
    assert.ok(sam.joinPosts === 0, 'Sign-in automatically joined the Group.');
    assert.ok(
      (await sam.authorized(`/api/groups/${household._id}`)).status === 403,
      'Preview or sign-in granted membership before explicit joining.',
    );
    await sam.controller.joinInvitation();
    await sam.controller.openGroup(household._id);
    const joined = sam.controller.getSnapshot().detail;
    assert.ok(
      joined.status === 'ready' &&
        joined.data !== null &&
        joined.data.members.some((member) => member.user.id === samId),
      'Explicit joining did not grant authorized Group access.',
    );
    assert.ok(joined.data.members.length === 2, 'Joining produced an unexpected member count.');
    checks.push('Public preview, restart/auth continuation, and explicit joining');

    await sam.controller.openInvitation(invitationUrl);
    await sam.controller.joinInvitation();
    await sam.controller.openGroup(household._id);
    assert.ok(
      sam.controller.getSnapshot().detail.data?.members.length === 2,
      'Reopening an invitation duplicated membership.',
    );
    await alex.controller.signIn('alex');
    await alex.controller.openGroup(household._id);
    assert.ok(
      alex.controller.getSnapshot().detail.data?.members.length === 2,
      'The creator could not read the joined member.',
    );
    checks.push('Existing-member reopening and both personas reading the same Group');

    const beforeRejectedLink = sam.requests;
    await sam.controller.openInvitation('https://unsupported.example.invalid/join/00000000');
    assert.ok(
      sam.requests === beforeRejectedLink,
      'An unsupported invite origin reached the transport.',
    );
    assert.ok(
      sam.controller.getSnapshot().invitation.status === 'invalid',
      'An unsupported invite origin was not rejected.',
    );
    let unavailableUrl: string | null = null;
    for (const code of ['00000000', 'ffffffff', '11111111']) {
      const response = await fetch(`${apiBaseUrl}/api/join/${code}`, {
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 404) {
        unavailableUrl = `${apiBaseUrl}/join/${code}`;
        break;
      }
    }
    assert.ok(unavailableUrl, 'The unavailable-link fixture candidates unexpectedly exist.');
    await sam.controller.openInvitation(unavailableUrl);
    assert.ok(
      sam.controller.getSnapshot().invitation.status === 'invalid',
      'An invalid or expired invitation did not show the unavailable state.',
    );
    checks.push('Unsupported origins rejected before fetch and unavailable invite recovery');

    ownNames.add(uncertainName);
    alex.controller.startCreate();
    alex.controller.updateCreation({
      name: uncertainName,
      description: 'Response lost after a real server commit.',
      category: 'home',
      defaultCurrency: 'INR',
      startDate: '',
      endDate: '',
    });
    const beforeUncertainCreate = alex.createPosts;
    alex.loseNextCreateResponse();
    await alex.controller.createGroup();
    const uncertain = alex.controller.getSnapshot().creation;
    assert.ok(
      uncertain.status === 'uncertain' && uncertain.draft.name === uncertainName,
      'A lost create response did not retain an uncertain form.',
    );
    await alex.controller.createGroup();
    assert.ok(
      alex.createPosts === beforeUncertainCreate + 1,
      'The unresolved Group create was submitted again.',
    );
    const afterResponseLoss = await discoverOwnGroups();
    const reconciled = afterResponseLoss.filter((group) => group.name === uncertainName);
    assert.ok(
      reconciled.length === 1,
      'Authorized Group reads did not find exactly one committed Group.',
    );
    checks.push(
      'Committed create response loss, retained input, blocked resubmit, and read reconciliation',
    );

    // After reviewing Groups, an explicit retry of unchanged details reuses the key.
    alex.controller.resumeCreationAfterCheck();
    await alex.controller.createGroup();
    const retried = alex.controller.getSnapshot();
    assert.ok(
      alex.createPosts === beforeUncertainCreate + 2 &&
        alex.createKeys.at(-1) === alex.createKeys.at(-2) &&
        retried.screen === 'group' &&
        retried.detail.data?.id === reconciled[0]._id,
      'An explicit retry did not return the Group its lost response created.',
    );
    assert.ok(
      (await discoverOwnGroups()).filter((group) => group.name === uncertainName).length === 1,
      'An explicit retry of a committed create saved a second Group.',
    );
    const listedOnce = () =>
      alex.controller.getSnapshot().groups.data.filter((group) => group.id === reconciled[0]._id)
        .length === 1;
    assert.ok(listedOnce(), 'An explicit retry listed the returned Group twice.');
    await alex.controller.back();
    assert.ok(listedOnce(), 'Returning to Groups listed the retried Group twice.');
    checks.push('Explicit retry of a committed create returns the same Group, listed once');

    ownNames.add(resendName);
    alex.controller.startCreate();
    alex.controller.updateCreation({
      name: resendName,
      description: 'An identical request resent after its response was lost.',
      category: 'home',
      defaultCurrency: 'INR',
      startDate: '',
      endDate: '',
    });
    const beforeResend = alex.createPosts;
    alex.resendNextCreate();
    await alex.controller.createGroup();
    const resent = await discoverOwnGroups();
    const resentGroups = resent.filter((group) => group.name === resendName);
    assert.ok(
      alex.createPosts === beforeResend + 2 &&
        alex.createKeys.at(-1) !== null &&
        alex.createKeys.at(-1) === alex.createKeys.at(-2),
      'The resent create did not carry the same Idempotency-Key twice.',
    );
    assert.ok(
      resentGroups.length === 1 &&
        alex.controller.getSnapshot().detail.data?.id === resentGroups[0]._id,
      'A transport-level resend of Group creation saved a second Group.',
    );
    checks.push('Transport-level resend of a committed create saves one Group');

    // The app restarts while a create is uncertain: it reopens uncertain, and resubmitting
    // the same details reuses the stored key.
    ownNames.add(restartName);
    alex.controller.startCreate();
    alex.controller.updateCreation({
      name: restartName,
      description: 'Response lost after a real server commit, then the app restarted.',
      category: 'home',
      defaultCurrency: 'INR',
      startDate: '',
      endDate: '',
    });
    const beforeRestart = alex.createPosts;
    alex.loseNextCreateResponse();
    await alex.controller.createGroup();
    alex.restart();
    await alex.controller.restore();
    const reopened = alex.controller.getSnapshot().creation;
    assert.ok(
      reopened.status === 'uncertain' && reopened.draft.name === restartName,
      'A restart lost the Group being created.',
    );
    assert.ok(alex.createPosts === beforeRestart + 1, 'Restoring sent the Group create again.');
    alex.controller.resumeCreationAfterCheck();
    await alex.controller.createGroup();
    const restartedGroups = (await discoverOwnGroups()).filter(
      (group) => group.name === restartName,
    );
    assert.ok(
      alex.createPosts === beforeRestart + 2 &&
        alex.createKeys.at(-1) !== null &&
        alex.createKeys.at(-1) === alex.createKeys.at(-2),
      'The resubmit after a restart did not reuse the stored Idempotency-Key.',
    );
    assert.ok(
      restartedGroups.length === 1 &&
        alex.controller.getSnapshot().detail.data?.id === restartedGroups[0]._id,
      'A resubmit after a restart saved a second Group.',
    );
    checks.push('A Group being created survives a restart, and its resubmit saves one Group');

    await alex.controller.openGroup(reconciled[0]._id);
    const beforeLostInvite = alex.invitePosts;
    alex.loseNextInviteResponse();
    await alex.controller.loadInviteLink();
    assert.ok(
      alex.invitePosts === beforeLostInvite + 1,
      'Invite generation was not attempted once.',
    );
    const recoveredUrl = await alex.controller.loadInviteLink();
    assert.ok(
      recoveredUrl && alex.invitePosts === beforeLostInvite + 1,
      'Lost invite generation was not recovered by reading the existing link.',
    );
    checks.push('Committed invite-generation response loss recovered without another generation');
  } finally {
    try {
      if (ownNames.size) {
        if (alex.controller.getSnapshot().auth.user?.id !== alexId)
          await alex.controller.signIn('alex');
        // Discover ids only via an authorized read. A matching unique run name,
        // creator id, and admin membership are all required before archiving.
        for (const group of await discoverOwnGroups()) {
          const response = await alex.authorized(`/api/groups/${group._id}`, 'DELETE');
          assert.ok(
            response.status === 200,
            'Cleanup could not archive a Group created by this run.',
          );
          archivedCount += 1;
        }
        assert.ok(
          (await discoverOwnGroups()).length === 0,
          'A Group created by this run remained in active Groups after cleanup.',
        );
      }
    } finally {
      await Promise.all([alex.controller.signOut(), sam.controller.signOut()]);
      alex.controller.dispose();
      sam.controller.dispose();
    }
  }
  console.log(
    `PASS: ${checks.length} real HTTP Group/invitation journey checks; ${archivedCount} run-owned Groups archived.`,
  );
  for (const check of checks) console.log(`- ${check}`);
}

void verify().catch((error: unknown) => {
  console.error(
    error instanceof assert.AssertionError
      ? `FAIL: ${error.message}`
      : 'FAIL: the local Group journey could not complete. Check the isolated backend and cleanup state.',
  );
  process.exitCode = 1;
});
