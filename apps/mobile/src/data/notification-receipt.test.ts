import { describe, expect, it, vi } from 'vitest';
import { checkNotificationWithoutApp, type NotificationAccess } from './notification-receipt';

// Fictional identities only.
const alex = 'a00000000000000000000001';
const sam = 'a00000000000000000000002';
const alexBinding = '00000000-0000-4000-8000-000000000001';
const samBinding = '00000000-0000-4000-8000-000000000003';
const activation = '00000000-0000-4000-8000-000000000002';
const time = Date.parse('2026-11-08T10:00:00.000Z');
const envelope = (extra = {}) => ({
  version: 2,
  kind: 'expense_added',
  eventId: 'd00000000000000000000001',
  groupId: 'b00000000000000000000001',
  recordId: 'c00000000000000000000001',
  accountId: alex,
  environment: 'staging',
  binding: alexBinding,
  activation,
  occurredAt: new Date(time - 1_000).toISOString(),
  expiresAt: new Date(time - 1_000 + 86_400_000).toISOString(),
  ...extra,
});
// As the task receives it: Expo puts the FCM data map in `data`, the envelope in `body`.
const received = (extra = {}) => ({ body: JSON.stringify(envelope(extra)) });
const controls = (extra = {}) => ({
  data: {
    available: true,
    enabled: true,
    expenseUpdates: true,
    payments: true,
    revision: 1,
    activation,
    binding: alexBinding,
    expenseCutoff: new Date(0).toISOString(),
    paymentCutoff: new Date(0).toISOString(),
    ...extra,
  },
});
function phone(overrides: Partial<NotificationAccess> = {}) {
  const access = {
    environment: 'staging',
    leaving: vi.fn(async () => false),
    session: vi.fn(async () => ({
      cookie: 'better-auth.session_token=alex.signature',
      accountId: alex as string | null,
    })),
    installation: vi.fn(async () => ({
      id: '00000000-0000-4000-8000-000000000968',
      key: 'private-installation-proof-968968968',
    })),
    controls: vi.fn(async (): Promise<unknown> => controls()),
    ...overrides,
  };
  return access;
}
const check = (value: unknown, access: NotificationAccess, now = time) =>
  checkNotificationWithoutApp(value, access, () => now);

describe('a data-only Expense alert with no app running (#968)', () => {
  it('passes for the signed-in account, its binding and activation, with Expense alerts on', async () => {
    const access = phone();
    expect(await check(received(), access)).toMatchObject({ accountId: alex });
    expect(access.controls).toHaveBeenCalledWith(
      { id: '00000000-0000-4000-8000-000000000968', key: 'private-installation-proof-968968968' },
      'better-auth.session_token=alex.signature',
    );
  });

  it("drops another account's envelope after a sign-out whose revoke failed and another sign-in", async () => {
    // Alex signed out offline: the revoke failed, so Alex's session and registration live on at
    // the server, and its messages still reach this phone. Sam then signed in here.
    const access = phone({
      session: async () => ({ cookie: 'better-auth.session_token=sam.signature', accountId: sam }),
      // The server answers for Sam's session: Alex's binding reads as off to another account.
      controls: vi.fn(async () => controls({ binding: samBinding, enabled: false })),
    });
    expect(await check(received(), access)).toBeNull();
    // Dropped on the account alone, before any read with Sam's session.
    expect(access.controls).not.toHaveBeenCalled();
  });

  it('drops everything while a sign-out is unconfirmed, even for the account it ends', async () => {
    const access = phone({ leaving: async () => true });
    expect(await check(received(), access)).toBeNull();
    expect(access.controls).not.toHaveBeenCalled();
  });

  it('drops an envelope past its expiry', async () => {
    const access = phone();
    expect(await check(received(), access, time + 86_400_000)).toBeNull();
    expect(
      await check(
        received({
          occurredAt: new Date(time - 86_400_001).toISOString(),
          expiresAt: new Date(time - 1).toISOString(),
        }),
        access,
      ),
    ).toBeNull();
    expect(access.controls).not.toHaveBeenCalled();
  });

  it('drops an envelope that expires while the controls are read', async () => {
    let now = time;
    const access = phone({
      controls: async () => {
        now = time + 86_400_000;
        return controls();
      },
    });
    expect(await checkNotificationWithoutApp(received(), access, () => now)).toBeNull();
  });

  it('drops an envelope for another environment', async () => {
    const access = phone();
    expect(await check(received({ environment: 'production' }), access)).toBeNull();
    expect(await check(received(), phone({ environment: 'production' }))).toBeNull();
    expect(access.controls).not.toHaveBeenCalled();
  });

  it.each([
    ['an unbound registration', { binding: null }],
    ['another binding', { binding: samBinding }],
    ['a registration turned off', { enabled: false }],
    ['Expense alerts off', { expenseUpdates: false }],
    ['a replaced activation', { activation: '00000000-0000-4000-8000-000000000099' }],
    [
      'a replaced Expense activation',
      { expenseActivation: '00000000-0000-4000-8000-000000000099' },
    ],
    ['no activation', { activation: null }],
  ])('drops it for %s', async (_case, extra) => {
    expect(await check(received(), phone({ controls: async () => controls(extra) }))).toBeNull();
  });

  it.each([
    ['no saved session', async () => null],
    [
      'an unverified saved cookie',
      async () => ({ cookie: 'better-auth.session_token=alex.signature', accountId: null }),
    ],
  ])('drops it with %s, before any read', async (_case, session) => {
    const access = phone({ session });
    expect(await check(received(), access)).toBeNull();
    expect(access.controls).not.toHaveBeenCalled();
  });

  it('drops it when the server refuses the session or cannot be reached', async () => {
    expect(
      await check(
        received(),
        phone({
          controls: async () => {
            throw new Error('401');
          },
        }),
      ),
    ).toBeNull();
    expect(
      await check(received(), phone({ controls: async () => ({ data: { enabled: true } }) })),
    ).toBeNull();
  });

  describe('the account checked again once the server answers', () => {
    // The server read is the slow step: a sign-out can start, or the saved session can change,
    // while it is pending. Nothing shows unless the phone is still signed in to the same account.
    function pending(overrides: Partial<NotificationAccess> = {}) {
      let answer!: (value: unknown) => void;
      const access = phone({
        controls: vi.fn(
          () =>
            new Promise<unknown>((resolve) => {
              answer = resolve;
            }),
        ),
        ...overrides,
      });
      const result = check(received(), access);
      return {
        access,
        result,
        answer: async () => {
          await vi.waitFor(() => expect(access.controls).toHaveBeenCalledOnce());
          answer(controls());
          return result;
        },
      };
    }

    it('drops it when a sign-out starts while the server read is pending', async () => {
      let leaving = false;
      const read = pending({ leaving: async () => leaving });
      await vi.waitFor(() => expect(read.access.controls).toHaveBeenCalledOnce());
      leaving = true;
      expect(await read.answer()).toBeNull();
    });

    it.each([
      ['the saved session is gone', null],
      [
        'the saved session is now another account’s',
        { cookie: 'better-auth.session_token=sam.signature', accountId: sam },
      ],
      [
        'the saved session is now unverified',
        { cookie: 'better-auth.session_token=alex.signature', accountId: null },
      ],
    ])('drops it when %s by the time the server answers', async (_case, later) => {
      let session: { cookie: string; accountId: string | null } | null = {
        cookie: 'better-auth.session_token=alex.signature',
        accountId: alex,
      };
      const read = pending({ session: async () => session });
      await vi.waitFor(() => expect(read.access.controls).toHaveBeenCalledOnce());
      session = later;
      expect(await read.answer()).toBeNull();
    });

    it('still passes when nothing changed while the server answered', async () => {
      const read = pending();
      expect(await read.answer()).toMatchObject({ accountId: alex });
    });
  });

  it('drops a malformed or unknown envelope without reading anything', async () => {
    const access = phone();
    for (const value of [null, {}, { body: '{' }, received({ version: 1 }), received({ x: 1 })])
      expect(await check(value, access)).toBeNull();
    expect(access.session).not.toHaveBeenCalled();
  });
});
