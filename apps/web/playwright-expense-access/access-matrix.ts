import type { APIRequestContext, APIResponse } from '@playwright/test';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import {
  test,
  expect,
  dataOf,
  expensePath,
  generatedExpense,
  joinGroup,
  observeLedger,
} from './fixtures';

type Operation = {
  name: string;
  request: (actor: APIRequestContext, path: string) => Promise<APIResponse>;
  restore?: boolean;
};

/** Shared HTTP contract, not mocks or tests of the expense implementation. */
export function accessMatrix(operation: Operation) {
  for (const origin of ['manual', 'recurring'] as const) {
    for (const scenario of [
      'disjoint',
      'overlapping',
      'outsider',
      'removed',
      'anonymous',
    ] as const) {
      test(`${operation.name}: ${origin} expense denies ${scenario} access without side effects`, async ({
        ledger,
      }) => {
        const expense = origin === 'recurring' ? await generatedExpense(ledger) : ledger.expenseB;
        const actualPath = expensePath(ledger.groupB, expense);
        if (operation.restore) await dataOf(await ledger.priya.delete(actualPath));

        let actor = ledger.alex;
        let requestedGroup = ledger.groupA;
        if (scenario === 'overlapping') {
          await joinGroup(ledger.alex, ledger.sam, ledger.groupA);
          actor = ledger.sam;
        } else if (scenario === 'outsider') {
          requestedGroup = ledger.groupB;
        } else if (scenario === 'removed') {
          // Establish access and then revoke it while keeping the same session.
          await dataOf(await ledger.sam.get(actualPath));
          await dataOf(
            await ledger.priya.delete(
              `/api/groups/${ledger.groupB}/members/${DEMO_PERSONA_IDS.sam}`,
            ),
          );
          expect((await (await ledger.sam.get('/api/auth/session')).json()).user.id).toBe(
            DEMO_PERSONA_IDS.sam,
          );
          requestedGroup = ledger.groupB;
          actor = ledger.sam;
        } else if (scenario === 'anonymous') {
          requestedGroup = ledger.groupB;
          actor = ledger.anonymous;
        }

        const before = await observeLedger(ledger, expense);
        const response = await operation.request(actor, expensePath(requestedGroup, expense));
        if (scenario === 'anonymous') {
          expect.soft(response.status()).toBe(307);
          expect.soft(new URL(response.headers().location, response.url()).pathname).toBe('/login');
        } else {
          const status = scenario === 'outsider' || scenario === 'removed' ? 403 : 404;
          expect.soft(response.status()).toBe(status);
          expect
            .soft(await response.json())
            .toEqual({ error: status === 403 ? 'Forbidden' : 'Expense not found', status });
          if (status === 404) {
            const absent = await operation.request(
              actor,
              expensePath(requestedGroup, 'f00000000000000000000000'),
            );
            expect.soft(absent.status()).toBe(404);
            expect.soft(await response.json()).toEqual(await absent.json());
          }
        }
        // This includes all fields, deletion metadata, edit history and both
        // groups' activity feeds, observed only through authorized requests.
        expect(await observeLedger(ledger, expense)).toEqual(before);
      });
    }
  }
}
