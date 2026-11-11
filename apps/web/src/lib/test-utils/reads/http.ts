import { unzipSync, strFromU8 } from 'fflate';
import { expect, it } from 'vitest';
import { callRoute } from '../signed-in-route';
import { readCases, readIds, type ReadCase, type readFixture } from './fixture';
import { acrossCases, type HttpRead } from './catalog';
type Fixture = ReturnType<typeof readFixture>;
export async function httpRead(
  fixture: Fixture,
  read: HttpRead,
  state: ReadCase,
  overrides: Partial<{ path: string; expenseId: string; requestId: string; cookie: string }> = {},
) {
  const access = await fixture.arrange(state);
  const module = await read.load();
  const handler = read.method === 'POST' ? module.POST : module.GET;
  if (!handler) throw new Error(`Missing ${read.method ?? 'GET'} handler for ${read.name}`);
  let headers: Record<string, string> = {};
  const answer = await callRoute(
    async (req, context) => {
      const response = await handler(req, context);
      for (const name of [
        'content-type',
        'content-disposition',
        'cache-control',
        'x-content-type-options',
      ]) {
        const value = response.headers.get(name);
        if (value !== null) headers[name] = value;
      }
      const type = response.headers.get('content-type') ?? '';
      if (type.includes('application/zip')) {
        const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
        return Response.json(
          {
            files: Object.fromEntries(
              Object.entries(files).map(([name, bytes]) => [name, strFromU8(bytes)]),
            ),
          },
          { status: response.status },
        );
      }
      if (type.includes('csv'))
        return Response.json({ text: await response.text() }, { status: response.status });
      return response;
    },
    {
      method: read.method ?? 'GET',
      ...(read.body ? { body: read.body(state) } : {}),
      path: overrides.path ?? read.path(access.groupId),
      params: {
        ...(read.scope === 'group' ? { id: access.groupId } : {}),
        ...(read.file.includes('[expenseId]')
          ? { expenseId: overrides.expenseId ?? readIds.expense }
          : {}),
        ...(read.file.includes('[requestId]')
          ? { requestId: overrides.requestId ?? readIds.receipt }
          : {}),
      },
      cookie: overrides.cookie ?? access.cookie,
    },
  );
  return { ...answer, headers };
}
export function httpReadCases(fixture: Fixture, reads: readonly HttpRead[]) {
  for (const read of reads)
    for (const state of read.scope === 'across' ? acrossCases : readCases)
      it(`${read.name} / ${state}`, async () => {
        const record = await fixture.capture(() => httpRead(fixture, read, state));
        if (state === 'member' || state === 'admin') {
          expect(record.addedDueExpense).toBe(read.addsDue);
          const status =
            read.name === 'Assistant reach' && state === 'admin' ? 200 : (read.memberStatus ?? 200);
          expect(record.answer.status).toBe(status);
        }
        if (read.scope === 'group' && (state === 'left' || state === 'outsider'))
          expect(record.answer.status).toBe(403);
      });
}
