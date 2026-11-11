import { expect, it, vi } from 'vitest';
import Expense from './models/Expense';
import { readFixture, readIds } from './test-utils/reads/fixture';
import { groupReads } from './test-utils/reads/catalog';
import { httpRead } from './test-utils/reads/http';

vi.mock('next/headers', async () => (await import('./test-utils/signed-in-route')).nextHeaders);
vi.mock('next/server', async (original) =>
  (await import('./test-utils/signed-in-route')).nextServer(original),
);
const fixture = readFixture('validation');

for (const [name, query, status, body] of [
  [
    'Activity',
    '?expenseId=garbage',
    200,
    {
      data: { activities: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } },
      status: 200,
    },
  ],
  ['Activity', '?page=-1', 500, { error: 'Internal server error', status: 500 }],
  ['Duplicate warning', '', 200, { data: { isDuplicate: false }, status: 200 }],
] as const)
  for (const state of ['member', 'outsider'] as const)
    it(`${name}${query} / ${state} keeps its answer without recording a Month`, async () => {
      const selected = groupReads.find((entry) => entry.name === name)!;
      const path = name === 'Activity' ? 'activity' : 'expenses/check-duplicate';
      const answer = await httpRead(fixture, selected, state, {
        path: `/api/groups/${readIds.group}/${path}${query}`,
      });
      expect(answer.status).toBe(state === 'outsider' ? 403 : status);
      expect(answer.body).toEqual(
        state === 'outsider' ? { error: 'Forbidden', status: 403, code: 'FORBIDDEN' } : body,
      );
      expect(await Expense.countDocuments({ recurringExpense: readIds.template })).toBe(0);
    });
