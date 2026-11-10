import { expect, it, vi } from 'vitest';
import { Refusal } from '@splitbook/shared/refusals';
import { forbidden, notFound, serverError, unauthorized } from './api-response';

vi.mock('next/headers', () => ({ headers: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }));

it.each([
  [unauthorized, 401, '{"error":"Unauthorized","status":401,"code":"UNAUTHORIZED"}'],
  [forbidden, 403, '{"error":"Forbidden","status":403,"code":"FORBIDDEN"}'],
  [() => notFound('Expense'), 404, '{"error":"Expense not found","status":404,"code":"NOT_FOUND"}'],
  [() => notFound(), 404, '{"error":"Resource not found","status":404,"code":"NOT_FOUND"}'],
  [
    () => serverError(new Refusal('LAST_ADMIN', { variant: 'demotion' })),
    409,
    '{"error":"Cannot demote the last admin. Promote another member first.","status":409,"code":"LAST_ADMIN"}',
  ],
  [
    () => serverError(new Refusal('LAST_ADMIN', { variant: 'removal' })),
    409,
    '{"error":"Cannot remove the last admin.","status":409,"code":"LAST_ADMIN"}',
  ],
  [
    () => serverError(new Refusal('SELF_REMOVE')),
    400,
    '{"error":"You cannot remove yourself. Use leave group instead.","status":400,"code":"SELF_REMOVE"}',
  ],
  [
    () => serverError(new Refusal('INVITATION_NOT_PENDING')),
    400,
    '{"error":"Invitation is no longer pending","status":400,"code":"INVITATION_NOT_PENDING"}',
  ],
  [
    () => serverError(new Refusal('INVITATION_EXPIRED')),
    410,
    '{"error":"Invitation has expired","status":410,"code":"INVITATION_EXPIRED"}',
  ],
  [
    () => serverError(new Refusal('ALREADY_INVITED')),
    409,
    '{"error":"This person has already been invited","status":409,"code":"ALREADY_INVITED"}',
  ],
] as const)(
  'answers the approved refusal with status %s and a code',
  async (answer, status, body) => {
    const response = answer();
    expect(response.status).toBe(status);
    expect(await response.text()).toBe(body);
  },
);
it.each([
  [
    'NOTIFICATIONS_UNAVAILABLE',
    503,
    '{"error":"Notifications are not available yet.","status":503,"code":"NOTIFICATIONS_UNAVAILABLE"}',
  ],
  [
    'NOTIFICATION_SETTINGS_CHANGED',
    409,
    '{"error":"Notification settings changed. Retry.","status":409,"code":"NOTIFICATION_SETTINGS_CHANGED"}',
  ],
  [
    'NOTIFICATION_TOKEN_REQUIRED',
    400,
    '{"error":"Notification registration needs a device token.","status":400,"code":"NOTIFICATION_TOKEN_REQUIRED"}',
  ],
] as const)('answers %s with its existing words and status', async (code, status, body) => {
  const response = serverError(new Refusal(code));
  expect(response.status).toBe(status);
  expect(await response.text()).toBe(body);
});
it('uses payment words for the default payer-or-recipient refusal', async () => {
  const response = serverError(new Refusal('FORBIDDEN_SETTLEMENT'));
  expect(response.status).toBe(422);
  expect(await response.text()).toBe(
    '{"error":"Only the payer or recipient can record this payment","status":422,"code":"FORBIDDEN_SETTLEMENT"}',
  );
});
it.each(['GROUP_DELETION_NOT_REQUESTED', 'GROUP_DELETION_CHANGED'] as const)(
  'answers %s as a Group conflict',
  async (code) => {
    const response = serverError(new Refusal(code));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'This Group changed. Reload and try again.',
      status: 409,
      code,
    });
  },
);
