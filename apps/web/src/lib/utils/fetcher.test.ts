import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetcher } from './fetcher';

describe('fetcher', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns JSON on success', async () => {
    const body = { data: { id: '1' } };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(body),
      }),
    );

    await expect(fetcher('/api/test')).resolves.toEqual(body);
    expect(fetch).toHaveBeenCalledWith('/api/test');
  });

  it('throws with server error message when !res.ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Forbidden',
        json: () => Promise.resolve({ error: 'Not allowed' }),
      }),
    );

    await expect(fetcher('/api/test')).rejects.toThrow('Not allowed');
  });

  it('sends an expired session to /login with a callbackUrl on 401, then throws', async () => {
    const assign = vi.fn();
    vi.stubGlobal('window', {
      location: { pathname: '/groups/abc', search: '?tab=balances', assign },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({ error: 'Unauthorized', status: 401 }),
      }),
    );

    await expect(fetcher('/api/groups/abc')).rejects.toThrow('Unauthorized');
    expect(assign).toHaveBeenCalledWith('/login?callbackUrl=%2Fgroups%2Fabc%3Ftab%3Dbalances');
  });

  it('only throws on 401 when there is no window to redirect', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: () => Promise.resolve({ error: 'Unauthorized', status: 401 }),
      }),
    );

    await expect(fetcher('/api/groups/abc')).rejects.toThrow('Unauthorized');
  });

  it('falls back to statusText when error field is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({}),
      }),
    );

    await expect(fetcher('/api/test')).rejects.toThrow('Internal Server Error');
  });
});
