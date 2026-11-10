import { testPhone } from '../test-utils/test-phone';
import { fakeSplitbook } from '../test-utils/fake-splitbook';
import type { AccountGroupRecordStore } from './account-record-storage';
import { describe, expect, it } from 'vitest';
import { buildExpenseBody, type ExpenseDraft } from './expense-draft';
import type { MobileGroup } from './types';

// Leave Group from Members and Group details. Fictional people and Groups only.
const accountId = 'a00000000000000000000001',
  samId = 'a00000000000000000000002';
const groupId = 'b00000000000000000000001',
  tagId = 'c00000000000000000000001';
const iso = '2026-10-04T12:00:00.000Z',
  now = Date.parse(iso);
const alex = { id: accountId, name: 'Alex Rivera', email: 'alex@example.test', image: null };
const sam = { id: samId, name: 'Sam Chen', email: 'sam@example.test', image: null };
const group = {
  _id: groupId,
  name: 'Maple House',
  createdBy: accountId,
  category: 'home',
  defaultCurrency: 'INR',
  members: [
    { user: { ...alex, _id: accountId }, role: 'admin', joinedAt: iso },
    { user: { ...sam, _id: samId }, role: 'admin', joinedAt: iso },
  ],
  tags: [{ _id: tagId, name: 'Food', createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
};
const emptyPage = {
  status: 200,
  data: {
    expenses: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    summary: { count: 0, totalsByCurrency: [], userOwes: 0, userGetsBack: 0, byMember: [] },
  },
};
const left = (archived = false) =>
  Response.json({ data: { message: 'Left group', archived }, status: 200 });
const refusals = {
  OPEN_BALANCE: {
    error: 'Settle up before you leave: you owe ₹1,480.00 in this Group.',
    status: 409,
    code: 'OPEN_BALANCE',
    balances: [{ currency: 'INR', amount: -1480 }],
  },
  LAST_ADMIN: {
    error: 'Make someone else an admin before you leave.',
    status: 409,
    code: 'LAST_ADMIN',
  },
  LEAVE_CONFLICT: {
    error: 'This Group changed while you were leaving. Try again.',
    status: 409,
    code: 'LEAVE_CONFLICT',
  },
  RECURRING_EXPENSE_PROBLEM: {
    error: 'Rent (recurring) still includes you. Ask an admin to remove you from it, then leave.',
    status: 409,
    code: 'RECURRING_EXPENSE_PROBLEM',
    recurringExpenses: [{ id: 'e00000000000000000000001', description: 'Rent' }],
  },
} as const;

function fixture(memberCount = 2) {
  const currentGroup = { ...group, members: group.members.slice(0, memberCount) };
  let member = true,
    held: Promise<void> | null = null;
  let leave: () => Response | Promise<Response> = () => {
    member = false;
    return left();
  };
  const calls: string[] = [];
  const leaveBodies: unknown[] = [];
  const backend = fakeSplitbook();
  backend.world.people.alex = alex;
  backend.world.people.sam = sam;
  backend.world.groups = [currentGroup];
  Object.defineProperty(backend.world.groupsByAccount, accountId, {
    get: () => (member ? [currentGroup] : []),
  });
  Object.defineProperty(backend.world, 'home', {
    get: () => ({ buckets: [], groups: member ? [{ groupId, balances: [] }] : [] }),
  });
  backend.world.expenses[groupId] = emptyPage.data;
  backend.world.balances[groupId] = { byCurrency: [] };
  // Keep the original log’s reached requests only.
  backend.reply('POST', `/api/groups/${groupId}/leave`, async ({ init }) => {
    leaveBodies.push(init.body ? JSON.parse(String(init.body)) : null);
    await held;
    return leave();
  });
  backend.reply('*', '*', ({ path }) =>
    !member && path.startsWith(`/api/groups/${groupId}`) && !path.endsWith('/leave')
      ? Response.json({ error: 'Forbidden', status: 403 }, { status: 403 })
      : undefined,
  );
  backend.reply('*', '*', ({ method, url }) => {
    calls.push(`${method} ${url.pathname}`);
    return undefined;
  });
  const phone = testPhone(backend, {
    origin: 'http://localhost:4147',
    now,
    recordSeparator: ':',
    settlementSeparator: ':',
    parts: {
      pendingInvitation: undefined,
      draftRequests: undefined,
      tagRequests: undefined,
      groupCreations: undefined,
      netInfo: undefined,
      newSubmissionKey: undefined,
      accountLocal: {
        financialCleanup: undefined,
        untrustedCopies: undefined,
        signOutRecord: undefined,
        stores: [
          {
            clear: async (): Promise<void> => {
              phone.stores.savedQueries.records.clear();
              phone.stores.offlineIdentity.value = null;
              phone.stores.expenseDrafts.records.clear();
              phone.stores.settlementAttempts.records.clear();
            },
          },
        ],
      },
    },
  });
  phone.stores.owner.value = accountId;
  delete phone.stores.savedQueries.retainGroups;
  for (const store of [phone.stores.expenseDrafts, phone.stores.settlementAttempts])
    delete (store as AccountGroupRecordStore).keys;
  const cache = phone.stores.savedQueries.records,
    drafts = phone.stores.expenseDrafts.records,
    payments = phone.stores.settlementAttempts.records;
  const build = () => phone.open();
  let controller = build();
  return {
    get controller() {
      return controller;
    },
    restart: () => {
      controller.dispose();
      controller = build();
    },
    removeAccess: () => {
      member = false;
    },
    leaveBodies,
    cache,
    drafts,
    payments,
    /** Requests made since the last call, as "METHOD /path". */
    sent: () => calls.splice(0),
    /** What the next leave request answers. */
    answer: (respond: () => Response | Promise<Response>) => {
      leave = respond;
    },
    /** Holds leave requests until the returned release is called. */
    hold: () => {
      let release!: () => void;
      held = new Promise((resolve) => {
        release = resolve;
      });
      return () => {
        held = null;
        release();
      };
    },
    goOffline: () => {
      backend.online = false;
    },
    /** Stores this Group's draft record, as the Expense form would. */
    keep: (record: object) =>
      drafts.set(`${accountId}:${groupId}`, { version: 1, accountId, groupId, ...record }),
  };
}

/** Signed in, on Maple House's Members and Group details. */
async function onMembers(memberCount = 2) {
  const f = fixture(memberCount);
  await f.controller.signIn('alex');
  await f.controller.openGroup(groupId);
  f.controller.openMembers();
  f.sent();
  return f;
}

const draft = (description: string): ExpenseDraft => ({
  amount: '420',
  currency: 'INR',
  description,
  date: '2026-10-04',
  payerId: accountId,
  multiPayer: false,
  payers: [],
  splitMethod: 'equal',
  splitValues: {},
  participantIds: [accountId, samId],
  category: 'food',
  tagId,
  notes: '',
});
const context: MobileGroup = {
  id: groupId,
  name: 'Maple House',
  description: '',
  category: 'home',
  defaultCurrency: 'INR',
  alternateCurrencies: [],
  latestExpenseCurrency: null,
  members: [
    { user: alex, role: 'admin', joinedAt: new Date(iso) },
    { user: sam, role: 'admin', joinedAt: new Date(iso) },
  ],
  startDate: null,
  endDate: null,
  createdAt: new Date(iso),
  updatedAt: new Date(iso),
};
/** A new Expense whose save was sent without a confirmed result. */
const unconfirmedSave = () => ({
  draft: draft('Groceries'),
  attempt: {
    key: 'native-leave-test-0001',
    body: buildExpenseBody(draft('Groceries'), {
      group: context,
      tags: [{ id: tagId, name: 'Food', isArchived: false, isDeleted: false }],
    }),
  },
});
const leaveRequests = (sent: string[]) =>
  sent.filter((call) => call === `POST /api/groups/${groupId}/leave`);

describe('Leave Group', () => {
  it('leaves, forgets the Group on this device, and returns Home with a snackbar', async () => {
    const f = await onMembers();
    expect([...f.cache.keys()].some((key) => key.includes(groupId))).toBe(true);
    await f.controller.reviewLeaveGroup();
    expect(f.controller.getSnapshot().leave).toEqual({
      groupId,
      status: 'confirm',
      code: null,
      message: null,
      draft: false,
      check: null,
    });
    expect(f.sent()).toEqual([]);

    // Every state on the way Home: the page being left never reads as lost access.
    const seen: { screen: string; detail: string; message: string | null }[] = [];
    const stop = f.controller.subscribe(() => {
      const shown = f.controller.getSnapshot();
      seen.push({
        screen: shown.screen,
        detail: shown.detail.status,
        message: shown.detail.message,
      });
    });
    await f.controller.leaveGroup();
    stop();
    expect(seen.filter(({ detail }) => detail === 'denied')).toEqual([]);
    expect(seen.map(({ message }) => message).filter(Boolean)).toEqual([]);
    const sent = f.sent();
    expect(leaveRequests(sent)).toHaveLength(1);
    // Home is read again after leaving.
    expect(sent.slice(sent.indexOf(`POST /api/groups/${groupId}/leave`) + 1)).toEqual([
      'GET /api/groups',
      'GET /api/user/balances',
    ]);
    expect(f.controller.getSnapshot()).toMatchObject({
      screen: 'groups',
      detail: { id: null, data: null },
      leave: { status: 'closed', groupId: null },
      groups: { status: 'ready', data: [] },
      home: { status: 'ready' },
      homeSnackbar: { message: 'You left Maple House.' },
    });
    expect([...f.cache.keys()].some((key) => key.includes(groupId))).toBe(false);

    // The snackbar belongs to Home.
    f.controller.startCreate();
    expect(f.controller.getSnapshot().homeSnackbar).toBeNull();
  });

  it('says when leaving archived the Group because nobody else was in it', async () => {
    const f = await onMembers();
    f.answer(() => left(true));
    await f.controller.reviewLeaveGroup();
    await f.controller.leaveGroup();
    expect(f.controller.getSnapshot().homeSnackbar).toEqual({
      message: 'You left Maple House. It’s archived because nobody else was in it.',
    });
  });

  it.each([
    ['OPEN_BALANCE', 'balances'],
    ['LEAVE_CONFLICT', null],
    // #257: a recurring Expense in its problem state still includes the member.
    ['RECURRING_EXPENSE_PROBLEM', null],
  ] as const)('keeps the sheet open with the server’s words for %s', async (code, check) => {
    const f = await onMembers();
    f.answer(() => Response.json(refusals[code], { status: 409 }));
    await f.controller.reviewLeaveGroup();
    await f.controller.leaveGroup();
    expect(leaveRequests(f.sent())).toHaveLength(1);
    expect(f.controller.getSnapshot()).toMatchObject({
      screen: 'members',
      leave: { groupId, status: 'refused', code, message: refusals[code].error, check },
      groups: { data: [{ id: groupId }] },
      detail: { id: groupId, data: { id: groupId } },
      homeSnackbar: null,
    });
    // Cancel closes it; the member is still in the Group.
    f.controller.cancelLeaveGroup();
    expect(f.controller.getSnapshot()).toMatchObject({
      screen: 'members',
      leave: { status: 'closed' },
    });
  });

  it('says a recurring Expense still includes the member when the server doesn’t (#257)', async () => {
    const f = await onMembers();
    f.answer(() =>
      Response.json({ status: 409, code: 'RECURRING_EXPENSE_PROBLEM' }, { status: 409 }),
    );
    await f.controller.reviewLeaveGroup();
    await f.controller.leaveGroup();
    expect(f.controller.getSnapshot().leave).toMatchObject({
      status: 'refused',
      code: 'RECURRING_EXPENSE_PROBLEM',
      message:
        'A recurring Expense still includes you. Ask an admin to remove you from it, then leave.',
      check: null,
    });
  });

  // #877: Android can't change roles, as Members already says, so the last admin is told where.
  const lastAdmin =
    'Make someone else an admin before you leave. Changing roles is done on the web for now.';

  it.each([
    ['with the server’s words', refusals.LAST_ADMIN],
    ['when the server doesn’t explain', { status: 409, code: 'LAST_ADMIN' }],
  ])('tells the last admin that roles are changed on the web, %s (#877)', async (_, body) => {
    const f = await onMembers();
    f.answer(() => Response.json(body, { status: 409 }));
    await f.controller.reviewLeaveGroup();
    await f.controller.leaveGroup();
    expect(f.controller.getSnapshot().leave).toMatchObject({
      status: 'refused',
      code: 'LAST_ADMIN',
      message: lastAdmin,
      check: null,
    });
  });

  // #877: an admin is told to remove themselves from the recurring Expense, which Android can't
  // edit; the server's words still name it.
  it.each([
    [
      'Rent (recurring) still includes you. Remove yourself from it, then leave.',
      'Rent (recurring) still includes you. Remove yourself from it on the web, then leave.',
    ],
    [
      'Rent (recurring) and Wi-Fi (recurring) still include you. Remove yourself from them, then leave.',
      'Rent (recurring) and Wi-Fi (recurring) still include you. Remove yourself from them on the web, then leave.',
    ],
  ])('tells an admin a recurring Expense is changed on the web: %s', async (error, message) => {
    const f = await onMembers();
    f.answer(() =>
      Response.json({ ...refusals.RECURRING_EXPENSE_PROBLEM, error }, { status: 409 }),
    );
    await f.controller.reviewLeaveGroup();
    await f.controller.leaveGroup();
    expect(f.controller.getSnapshot().leave).toMatchObject({
      status: 'refused',
      code: 'RECURRING_EXPENSE_PROBLEM',
      message,
    });
  });

  it('goes to Balances from an open balance, reading them again', async () => {
    const f = await onMembers();
    f.answer(() => Response.json(refusals.OPEN_BALANCE, { status: 409 }));
    await f.controller.reviewLeaveGroup();
    await f.controller.leaveGroup();
    f.sent();
    await f.controller.showLeaveCheck();
    expect(f.controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'balances',
      detail: { id: groupId },
      leave: { status: 'closed' },
    });
    expect(f.sent()).toContain(`GET /api/groups/${groupId}/balances`);
  });

  it('tries again after a concurrent change', async () => {
    const f = await onMembers();
    f.answer(() => Response.json(refusals.LEAVE_CONFLICT, { status: 409 }));
    await f.controller.reviewLeaveGroup();
    await f.controller.leaveGroup();
    f.answer(() => left());
    await f.controller.leaveGroup();
    expect(leaveRequests(f.sent())).toHaveLength(2);
    expect(f.controller.getSnapshot()).toMatchObject({
      screen: 'groups',
      homeSnackbar: { message: 'You left Maple House.' },
    });
  });

  it('shows another failure on the sheet, to try again', async () => {
    const f = await onMembers();
    f.answer(() => Response.json({ error: 'Internal', status: 500 }, { status: 500 }));
    await f.controller.reviewLeaveGroup();
    await f.controller.leaveGroup();
    expect(f.controller.getSnapshot()).toMatchObject({
      screen: 'members',
      leave: {
        status: 'error',
        message: 'The server could not complete this request. Please try again.',
      },
    });
  });

  it('closes the sheet when the member no longer has access, as on any denial', async () => {
    const f = await onMembers();
    f.answer(() => Response.json({ error: 'Forbidden', status: 403 }, { status: 403 }));
    await f.controller.reviewLeaveGroup();
    await f.controller.leaveGroup();
    expect(f.controller.getSnapshot()).toMatchObject({
      screen: 'members',
      leave: { status: 'closed' },
      groups: { data: [] },
      detail: { status: 'denied', data: null, message: 'You no longer have access to this group.' },
    });
  });

  it('disables leaving while it is sent: Back and Cancel wait for the answer', async () => {
    const f = await onMembers();
    await f.controller.reviewLeaveGroup();
    const release = f.hold();
    const leaving = f.controller.leaveGroup();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.controller.getSnapshot().leave.status).toBe('leaving');
    f.controller.cancelLeaveGroup();
    await f.controller.back();
    await f.controller.leaveGroup();
    expect(f.controller.getSnapshot()).toMatchObject({
      screen: 'members',
      leave: { status: 'leaving' },
    });
    release();
    await leaving;
    expect(leaveRequests(f.sent())).toHaveLength(1);
    expect(f.controller.getSnapshot().screen).toBe('groups');
  });

  it('Back closes the sheet before leaving the page', async () => {
    const f = await onMembers();
    await f.controller.reviewLeaveGroup();
    await f.controller.back();
    expect(f.controller.getSnapshot()).toMatchObject({
      screen: 'members',
      leave: { status: 'closed' },
    });
    await f.controller.back();
    expect(f.controller.getSnapshot().screen).toBe('group');
  });

  it('needs a connection: offline, nothing opens or is sent', async () => {
    const f = await onMembers();
    await f.controller.reviewLeaveGroup();
    f.goOffline();
    await f.controller.refresh();
    expect(f.controller.getSnapshot().offline.active).toBe(true);
    await f.controller.leaveGroup();
    expect(f.controller.getSnapshot().leave.status).toBe('confirm');
    f.controller.cancelLeaveGroup();
    await f.controller.reviewLeaveGroup();
    expect(f.controller.getSnapshot().leave.status).toBe('closed');
    expect(leaveRequests(f.sent())).toEqual([]);
    expect(f.controller.getSnapshot().screen).toBe('members');
  });
});

describe('Leave Group and what this device keeps', () => {
  it('blocks leaving while an Expense save may already be recorded, and offers Expenses', async () => {
    const f = await onMembers();
    f.keep(unconfirmedSave());
    await f.controller.reviewLeaveGroup();
    expect(f.controller.getSnapshot().leave).toMatchObject({
      status: 'blocked',
      draft: true,
      check: 'expenses',
      message:
        'An Expense save in this Group isn’t confirmed yet. Check it on Expenses first: it may already be recorded and change your balance.',
    });
    await f.controller.leaveGroup();
    expect(leaveRequests(f.sent())).toEqual([]);
    await f.controller.showLeaveCheck();
    expect(f.controller.getSnapshot()).toMatchObject({
      screen: 'group',
      destination: 'expenses',
      keptDraft: { groupId, unconfirmed: true },
    });
    expect(f.drafts.size).toBe(1);
  });

  it('checks again before sending, so a save that appeared meanwhile still blocks', async () => {
    const f = await onMembers();
    await f.controller.reviewLeaveGroup();
    expect(f.controller.getSnapshot().leave.status).toBe('confirm');
    f.keep(unconfirmedSave());
    await f.controller.leaveGroup();
    expect(leaveRequests(f.sent())).toEqual([]);
    expect(f.controller.getSnapshot().leave).toMatchObject({
      status: 'blocked',
      check: 'expenses',
    });
  });

  it('blocks leaving while a payment may already be recorded, and offers Balances', async () => {
    const f = await onMembers();
    f.payments.set(`${accountId}:${groupId}`, {
      version: 1,
      accountId,
      groupId,
      key: 'settlement-key-1',
      body: '{}',
    });
    await f.controller.reviewLeaveGroup();
    expect(f.controller.getSnapshot().leave).toMatchObject({
      status: 'blocked',
      draft: false,
      check: 'balances',
      message:
        'A payment in this Group isn’t confirmed yet. Check it on Balances first: it may already be recorded and change your balance.',
    });
    await f.controller.leaveGroup();
    expect(leaveRequests(f.sent())).toEqual([]);
  });

  it('counts a draft it can’t read as one that may hold a save', async () => {
    const f = await onMembers();
    f.drafts.set(`${accountId}:${groupId}`, { version: 1, draft: 'unreadable' });
    await f.controller.reviewLeaveGroup();
    expect(f.controller.getSnapshot().leave).toMatchObject({ status: 'blocked', draft: true });
  });

  it('says a draft will be discarded, and discards it on leaving', async () => {
    const f = await onMembers();
    f.keep({ draft: draft('Snacks') });
    await f.controller.reviewLeaveGroup();
    expect(f.controller.getSnapshot().leave).toMatchObject({ status: 'confirm', draft: true });
    await f.controller.leaveGroup();
    expect(f.drafts.size).toBe(0);
    expect(f.controller.getSnapshot()).toMatchObject({ screen: 'groups', drafts: [] });
  });

  it('keeps the draft when the server refuses', async () => {
    const f = await onMembers();
    f.keep({ draft: draft('Snacks') });
    f.answer(() => Response.json(refusals.OPEN_BALANCE, { status: 409 }));
    await f.controller.reviewLeaveGroup();
    await f.controller.leaveGroup();
    expect(f.drafts.size).toBe(1);
  });
});

describe('explicit last-member deletion and recovery', () => {
  it('Cancel and Back discard the destructive acknowledgement without sending a request', async () => {
    const f = await onMembers(1);
    await f.controller.reviewLeaveGroup();
    expect(f.controller.getSnapshot().leave).toMatchObject({
      status: 'confirm',
      deleteIfLastMember: true,
    });
    f.controller.cancelLeaveGroup();
    expect(f.controller.getSnapshot().leave).not.toHaveProperty('deleteIfLastMember');
    await f.controller.reviewLeaveGroup();
    await f.controller.back();
    expect(leaveRequests(f.sent())).toEqual([]);
  });

  it('shows fresh destructive consent for a stale ordinary leave and waits for another explicit tap', async () => {
    const f = await onMembers();
    f.keep({ draft: draft('Unsent snacks') });
    f.answer(() =>
      Response.json(
        {
          status: 409,
          code: 'GROUP_DELETION_CONFIRMATION_REQUIRED',
          error: 'Review permanent deletion before leaving.',
        },
        { status: 409 },
      ),
    );
    await f.controller.reviewLeaveGroup();
    await f.controller.leaveGroup();
    expect(f.leaveBodies).toEqual([null]);
    expect(f.controller.getSnapshot().leave).toMatchObject({
      status: 'refused',
      deleteIfLastMember: true,
    });
    expect(f.drafts.size).toBe(1);
    f.answer(() => {
      f.removeAccess();
      return Response.json({
        status: 200,
        data: { archived: true, deleted: true, deletionPending: false },
      });
    });
    await f.controller.leaveGroup();
    expect(f.leaveBodies).toEqual([null, { deleteIfLastMember: true }]);
    expect(f.drafts.size).toBe(0);
    expect(f.controller.getSnapshot().homeSnackbar?.message).toContain('permanently deleted');
  });

  it('allows a consented lost-response replay when access remains on screen, without automatic resubmission', async () => {
    const f = await onMembers(1);
    f.answer(() => {
      throw new Error('Lost the completed response');
    });
    await f.controller.reviewLeaveGroup();
    await f.controller.leaveGroup();
    expect(f.leaveBodies).toEqual([{ deleteIfLastMember: true }]);
    f.answer(() => {
      f.removeAccess();
      return Response.json({
        status: 200,
        data: { archived: true, deleted: true, deletionPending: false },
      });
    });
    await f.controller.leaveGroup();
    expect(f.leaveBodies).toEqual([{ deleteIfLastMember: true }, { deleteIfLastMember: true }]);
    expect(f.controller.getSnapshot().screen).toBe('groups');
  });

  it('forgets saved content and drafts after lost response plus access invalidation, including restart', async () => {
    const f = await onMembers(1);
    f.keep({ draft: draft('Unsent snacks') });
    f.answer(() => {
      f.removeAccess();
      throw new Error('Lost the completed response');
    });
    await f.controller.reviewLeaveGroup();
    await f.controller.leaveGroup();
    await f.controller.refresh();
    expect(f.leaveBodies).toEqual([{ deleteIfLastMember: true }]);
    expect([...f.cache.keys()].some((key) => key.includes(groupId))).toBe(false);
    expect(f.drafts.size).toBe(0);
    f.restart();
    await f.controller.restore();
    expect(f.controller.getSnapshot().groups.data).toEqual([]);
    expect(f.controller.getSnapshot().drafts).toEqual([]);
    expect(f.leaveBodies).toHaveLength(1);
  });

  it('distinguishes pending cleanup from completed deletion and removes the departed Group locally', async () => {
    const f = await onMembers(1);
    f.keep({ draft: draft('Unsent snacks') });
    f.answer(() => {
      f.removeAccess();
      return Response.json({
        status: 200,
        data: { archived: true, deleted: false, deletionPending: true },
      });
    });
    await f.controller.reviewLeaveGroup();
    await f.controller.leaveGroup();
    expect(f.controller.getSnapshot().homeSnackbar?.message).toContain('still finishing');
    expect(f.controller.getSnapshot().homeSnackbar?.message).not.toContain(
      'were permanently deleted',
    );
    expect(f.controller.getSnapshot().groups.data).toEqual([]);
    expect(f.drafts.size).toBe(0);
  });
});
