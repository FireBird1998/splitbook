import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGroupRead, readWebGroupListResponse, readWebGroupResponse } from './group-read';

const actor = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const group = {
  _id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  name: 'Household',
  createdBy: actor,
  defaultCurrency: 'INR',
  category: 'home',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  members: [
    {
      user: { _id: actor, name: 'Alex', email: 'alex@example.test' },
      role: 'admin',
      joinedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

describe('web Group read boundary', () => {
  it('adopts a valid complete list with documented defaults', () => {
    const result = readWebGroupListResponse({ data: [group], status: 200 }, actor);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      _id: group._id,
      description: '',
      tags: [],
      alternateCurrencies: [],
    });
  });
  it('fails the whole list when one Group is malformed, without disclosing its payload', () => {
    expect(() =>
      readWebGroupListResponse(
        { data: [group, { ...group, name: { private: 'secret' } }], status: 200 },
        actor,
      ),
    ).toThrow('Groups could not be loaded. Please retry.');
  });
  it('rejects a response belonging to another account', () => {
    expect(() =>
      readWebGroupListResponse({ data: [group], status: 200 }, 'cccccccccccccccccccccccc'),
    ).toThrow('Groups could not be loaded. Please retry.');
  });
  it('rejects a detail response for a different requested Group', () => {
    expect(() =>
      readWebGroupResponse({ data: group, status: 200 }, actor, 'cccccccccccccccccccccccc'),
    ).toThrow('Group could not be loaded. Please retry.');
  });
});

describe('Group read transport recovery', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([401, 403, 404])(
    'replaces prior verified data on HTTP %s with a denial',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ error: 'private payload' }), { status }),
          ),
      );
      expect(
        await fetchGroupRead('/api/groups', (payload) => readWebGroupListResponse(payload, actor)),
      ).toEqual({ denied: true });
    },
  );

  it('clears revoked Group data even when the denial response body is null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('null', { status: 403 })));
    await expect(
      fetchGroupRead('/api/groups', (payload) => readWebGroupListResponse(payload, actor)),
    ).resolves.toEqual({ denied: true });
  });

  it('leaves recoverable failures rejected so SWR retains its previous verified result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    await expect(
      fetchGroupRead('/api/groups', (payload) => readWebGroupListResponse(payload, actor)),
    ).rejects.toThrow();
  });

  it('returns complete validated detail fields without losing historical tags or producer extras', async () => {
    const detail = {
      ...group,
      tags: [
        {
          _id: 'dddddddddddddddddddddddd',
          name: 'Historical',
          isArchived: true,
          isDeleted: true,
          createdAt: group.createdAt,
        },
      ],
      alternateCurrencies: ['XYZ'],
      currencyLocked: true,
      futureField: 'kept',
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: detail, status: 200 }), { status: 200 }),
        ),
    );
    const result = await fetchGroupRead(`/api/groups/${group._id}`, (payload) =>
      readWebGroupResponse(payload, actor, group._id),
    );
    expect(result.data).toMatchObject(detail);
  });
});
