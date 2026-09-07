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
