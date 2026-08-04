import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BalanceService } from './balance.service';
import Expense from '@/lib/models/Expense';
import Settlement from '@/lib/models/Settlement';
import Group from '@/lib/models/Group';

vi.mock('@/lib/db', () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/models/Expense', () => ({
  default: {
    find: vi.fn(),
  },
}));

vi.mock('@/lib/models/Settlement', () => ({
  default: {
    find: vi.fn(),
  },
}));

vi.mock('@/lib/models/Group', () => ({
  default: {
    findById: vi.fn(),
  },
}));

vi.mock('@/lib/models/User', () => ({
  default: {},
}));

const objectId = (value: string) => ({ toString: () => value });

describe('BalanceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flags balances that include expenses or settlements outside the group default currency', async () => {
    vi.mocked(Expense.find).mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        {
          currency: 'EUR',
          paidBy: [{ user: objectId('user-1'), amount: 20 }],
          splitBetween: [{ user: objectId('user-2'), amount: 20 }],
        },
      ]),
    } as unknown as ReturnType<typeof Expense.find>);

    vi.mocked(Settlement.find).mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        {
          currency: 'USD',
          paidBy: objectId('user-2'),
          paidTo: objectId('user-1'),
          amount: 5,
        },
      ]),
    } as unknown as ReturnType<typeof Settlement.find>);

    vi.mocked(Group.findById).mockReturnValue({
      populate: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({
        defaultCurrency: 'USD',
        members: [
          { user: { _id: objectId('user-1'), name: 'A', email: 'a@example.com' } },
          { user: { _id: objectId('user-2'), name: 'B', email: 'b@example.com' } },
        ],
      }),
    } as unknown as ReturnType<typeof Group.findById>);

    await expect(new BalanceService().getGroupBalances('group-1')).resolves.toMatchObject({
      currency: 'USD',
      hasMixedCurrencies: true,
    });
  });
});
