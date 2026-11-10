import { describe, expect, it } from 'vitest';
import { parseGroup, parseGroups, parseSession, parseSignIn } from '../data/dto';
import { parseExpensePage, parseGroupBalances, parseHomeBalances } from '../data/financial-dto';
import { fakeSplitbook } from './fake-splitbook';

// HTTP is the seam: default responses must be readable by the actual app.
describe('fake Splitbook', () => {
  it('answers a persona session and the default world in the app readers’ wire shapes', async () => {
    const server = fakeSplitbook();
    const call = (path: string, init: RequestInit = {}) =>
      server.fetch('http://localhost:4138' + path, init);
    const signed = await call('/api/auth/demo-persona/sign-in', {
      method: 'POST',
      body: JSON.stringify({ personaId: 'alex' }),
    });
    expect(parseSignIn(await signed.json()).name).toBe('Alex Rivera');
    const cookie = signed.headers.get('Set-Cookie')!.split(';')[0];
    const read = async (path: string) => (await call(path, { headers: { Cookie: cookie } })).json();
    expect(parseSession(await read('/api/auth/get-session'))?.user.id).toBe(
      'a00000000000000000000001',
    );
    expect(parseGroups(await read('/api/groups'))).toHaveLength(1);
    const id = server.world.groups[0]!._id;
    expect(parseGroup(await read(`/api/groups/${id}`)).name).toBe('Maple House');
    expect(parseHomeBalances(await read('/api/user/balances')).buckets).toEqual([]);
    expect(parseGroupBalances(await read(`/api/groups/${id}/balances`))).toEqual([]);
    expect(
      parseExpensePage(await read(`/api/groups/${id}/expenses?page=1&limit=20`), id, 'INR')
        .expenses,
    ).toEqual([]);
    expect(server.unanswered).toEqual([]);
  });
});
