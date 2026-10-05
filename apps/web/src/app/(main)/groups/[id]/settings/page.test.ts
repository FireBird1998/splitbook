import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

// #289: the server reads the recurring Expenses switch and hands it to the settings view, so
// the browser never decides it.
vi.mock('@/lib/utils/api-response', () => ({
  getAuthUser: vi.fn(async () => ({ id: 'b00000000000000000000001' })),
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/components/groups/GroupSettingsView', () => ({ default: () => null }));

const { default: GroupSettingsPage } = await import('./page');

afterEach(() => vi.unstubAllEnvs());

async function viewProps() {
  const page = (await GroupSettingsPage({
    params: Promise.resolve({ id: 'b00000000000000000000010' }),
  })) as ReactElement<{ recurringExpensesEnabled: boolean }>;
  return page.props;
}

describe('the Group settings page', () => {
  it('hides recurring Expenses by default', async () => {
    vi.stubEnv('RECURRING_EXPENSES_ENABLED', undefined);
    expect(await viewProps()).toMatchObject({ recurringExpensesEnabled: false });
  });

  it('offers them once RECURRING_EXPENSES_ENABLED is true', async () => {
    vi.stubEnv('RECURRING_EXPENSES_ENABLED', 'true');
    expect(await viewProps()).toMatchObject({
      groupId: 'b00000000000000000000010',
      userId: 'b00000000000000000000001',
      recurringExpensesEnabled: true,
    });
  });
});
