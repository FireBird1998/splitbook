import { describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({ headers: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }));

const { serverError } = await import('./api-response');

describe('serverError', () => {
  it('uses the same typed conflict for an optimistic database revision race', async () => {
    const cause = new Error('Revision race');
    cause.name = 'VersionError';
    const response = serverError(cause);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'STALE_REVISION', status: 409 });
  });

  it('answers a service access denial as 403 rather than a server failure', async () => {
    const response = serverError(new Error('FORBIDDEN'));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden', code: 'FORBIDDEN', status: 403 });
  });

  it('keeps unknown failures as a generic 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = serverError(new Error('Something unexpected'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error', status: 500 });
  });
});
