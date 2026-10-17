import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SWRConfig, unstable_serialize } from 'swr';
import { describe, expect, it, vi } from 'vitest';
import { recurringExpensesKey } from '@splitbook/shared/query-keys';
import type { IRecurringExpense } from '@splitbook/shared/types';
import { WEB_QUERY_ACCOUNT } from '@/lib/web-query-keys';
import { inTimeZone } from '@/lib/test-utils/time-zone';
import { text } from '@/lib/test-utils/markup';
import RecurringExpensesSection from './RecurringExpensesSection';

const ADMIN = 'b00000000000000000000001';
const MEMBER = 'b00000000000000000000002';
const GROUP = 'b00000000000000000000010';
const RENT = 'c00000000000000000000001';

/** The Group settings list of recurring Expenses, as the server renders it, for one template. */
function list(dates: Pick<IRecurringExpense, 'startsOn' | 'endsOn'>) {
  const template: IRecurringExpense = {
    _id: 'd00000000000000000000001',
    group: GROUP,
    description: 'Synthetic flat rent',
    amount: 24000,
    amountMinor: 2400000,
    currency: 'INR',
    moneyVersion: 1,
    category: 'housing',
    tag: 'Rent',
    tagId: RENT,
    paidBy: [{ user: ADMIN, amount: 24000 }],
    splitMethod: 'equal',
    splitBetween: [
      { user: ADMIN, amount: 12000 },
      { user: MEMBER, amount: 12000 },
    ],
    dayOfMonth: 1,
    ...dates,
    isPaused: false,
    createdBy: ADMIN,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  return text(
    renderToStaticMarkup(
      createElement(
        SWRConfig,
        {
          value: {
            fallback: {
              [unstable_serialize(recurringExpensesKey(WEB_QUERY_ACCOUNT, GROUP))]: {
                data: [template],
              },
            },
            provider: () => new Map(),
          },
        },
        createElement(RecurringExpensesSection, {
          groupId: GROUP,
          tags: [
            {
              _id: RENT,
              name: 'Rent',
              isArchived: false,
              isDeleted: false,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          members: [
            {
              user: { _id: ADMIN, name: 'Alex', email: 'alex@example.test', image: undefined },
              role: 'admin',
              joinedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              user: { _id: MEMBER, name: 'Sam', email: 'sam@example.test', image: undefined },
              role: 'member',
              joinedAt: '2026-01-02T00:00:00.000Z',
            },
          ],
          defaultCurrency: 'INR',
          onNotify: vi.fn(),
        }),
      ),
    ),
  );
}

describe('the recurring list’s start and end (#522)', () => {
  it.each(['Pacific/Pago_Pago', 'UTC', 'Pacific/Kiritimati'])(
    'are the calendar days the recurring Expense was given in %s',
    (zone) =>
      inTimeZone(zone, () => {
        expect(
          list({ startsOn: '2026-02-01T00:00:00.000Z', endsOn: '2026-10-01T00:00:00.000Z' }),
        ).toContain('since Feb 1, 2026 · until Oct 1, 2026');
        expect(list({ startsOn: '2026-10-01T00:00:00.000Z', endsOn: null })).toContain(
          'since Oct 1, 2026',
        );
      }),
  );
});
