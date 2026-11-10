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
  ['NOTIFICATION_SETTINGS_CHANGED', 409, '{"error":"Notification settings changed. Retry.","status":409,"code":"NOTIFICATION_SETTINGS_CHANGED"}'],
  ['NOTIFICATION_TOKEN_REQUIRED', 400, '{"error":"Notification registration needs a device token.","status":400,"code":"NOTIFICATION_TOKEN_REQUIRED"}'],
] as const)('answers %s with its existing words and status', async (code, status, body) => {
  const response = serverError(new Refusal(code));
  expect(response.status).toBe(status);
  expect(await response.text()).toBe(body);
});
