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
  it('replaces the next or every matching answer and records requests including unanswered ones', async () => {
    const server = fakeSplitbook();
    server.reply(
      'GET',
      '/probe',
      ({ headers }) => Response.json({ marker: headers.get('X-Probe') }),
      { once: true },
    );
    server.reply('POST', '/probe', ({ body }) => Response.json(body));
    const read = await server.fetch('http://local/probe?a=1', { headers: { 'X-Probe': 'next' } });
    expect(await read.json()).toEqual({ marker: 'next' });
    for (const value of [1, 2]) {
      const reply = await server.fetch('http://local/probe', {
        method: 'POST',
        body: JSON.stringify({ value }),
      });
      expect(await reply.json()).toEqual({ value });
    }
    expect((await server.fetch('http://local/probe', {})).status).toBe(404);
    expect(server.requests.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      { method: 'GET', path: '/probe?a=1', body: undefined },
      { method: 'POST', path: '/probe', body: { value: 1 } },
      { method: 'POST', path: '/probe', body: { value: 2 } },
      { method: 'GET', path: '/probe', body: undefined },
    ]);
    expect(server.unanswered).toEqual(['GET /probe']);
  });
});
