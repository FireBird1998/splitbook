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
    find: vi.fn(),
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
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([
        {
          currency: 'EUR',
          amount: 20,
          paidBy: [{ user: objectId('user-1'), amount: 20 }],
          splitBetween: [{ user: objectId('user-2'), amount: 20 }],
        },
      ]),
    } as unknown as ReturnType<typeof Expense.find>);

    vi.mocked(Settlement.find).mockReturnValue({
      select: vi.fn().mockReturnThis(),
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
      select: vi.fn().mockReturnThis(),
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

  it('keeps a user balance separated by transaction currency across groups', async () => {
    vi.mocked(Group.find).mockReturnValue({
      populate: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([
        {
          _id: objectId('group-1'),
          name: 'Mixed trip',
          category: 'trip',
          defaultCurrency: 'USD',
          updatedAt: new Date('2026-07-20T00:00:00.000Z'),
          members: [
            { user: { _id: objectId('user-1'), name: 'Alex' } },
            { user: { _id: objectId('user-2'), name: 'Sam' } },
          ],
        },
        {
          _id: objectId('group-2'),
          name: 'Quiet trip',
          category: 'trip',
          defaultCurrency: 'INR',
          updatedAt: new Date('2026-07-18T00:00:00.000Z'),
          members: [{ user: { _id: objectId('user-1'), name: 'Alex' } }],
        },
      ]),
    } as unknown as ReturnType<typeof Group.find>);

    vi.mocked(Expense.find).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([
        {
          group: objectId('group-1'),
          currency: 'EUR',
          amount: 30,
          paidBy: [{ user: objectId('user-1'), amount: 30 }],
          splitBetween: [{ user: objectId('user-2'), amount: 30 }],
        },
        {
          group: objectId('group-1'),
          currency: 'USD',
          amount: 10,
          paidBy: [{ user: objectId('user-2'), amount: 10 }],
          splitBetween: [{ user: objectId('user-1'), amount: 10 }],
        },
      ]),
    } as unknown as ReturnType<typeof Expense.find>);

    vi.mocked(Settlement.find).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof Settlement.find>);

    await expect(new BalanceService().getUserBalances('user-1')).resolves.toEqual({
      buckets: [
        { currency: 'EUR', youOwe: 0, youAreOwed: 30, net: 30 },
        { currency: 'USD', youOwe: 10, youAreOwed: 0, net: -10 },
      ],
      groups: [
        {
          groupId: 'group-1',
          name: 'Mixed trip',
          category: 'trip',
          updatedAt: '2026-07-20T00:00:00.000Z',
          hasMixedCurrencies: true,
          balances: [
            {
              currency: 'EUR',
              balance: 30,
              settlement: {
                counterpartyId: 'user-2',
                counterpartyName: 'Sam',
                amount: 30,
              },
            },
            {
              currency: 'USD',
              balance: -10,
              settlement: {
                counterpartyId: 'user-2',
                counterpartyName: 'Sam',
                amount: 10,
              },
            },
          ],
        },
        {
          groupId: 'group-2',
          name: 'Quiet trip',
          category: 'trip',
          updatedAt: '2026-07-18T00:00:00.000Z',
          hasMixedCurrencies: false,
          balances: [],
        },
      ],
      hasMixedCurrencies: true,
    });

    expect(Expense.find).toHaveBeenCalledTimes(1);
    expect(Settlement.find).toHaveBeenCalledTimes(1);
  });

  it('does not flag a single non-default currency as mixed', async () => {
    vi.mocked(Group.find).mockReturnValue({
      populate: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([
        {
          _id: objectId('group-1'),
          name: 'EUR only',
          category: 'trip',
          defaultCurrency: 'USD',
          updatedAt: new Date('2026-07-20T00:00:00.000Z'),
          members: [
            { user: { _id: objectId('user-1'), name: 'Alex' } },
            { user: { _id: objectId('user-2'), name: 'Sam' } },
          ],
        },
      ]),
    } as unknown as ReturnType<typeof Group.find>);

    vi.mocked(Expense.find).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([
        {
          group: objectId('group-1'),
          currency: 'EUR',
          amount: 12,
          paidBy: [{ user: objectId('user-1'), amount: 12 }],
          splitBetween: [{ user: objectId('user-2'), amount: 12 }],
        },
      ]),
    } as unknown as ReturnType<typeof Expense.find>);

    vi.mocked(Settlement.find).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    } as unknown as ReturnType<typeof Settlement.find>);

    await expect(new BalanceService().getUserBalances('user-1')).resolves.toMatchObject({
      hasMixedCurrencies: false,
      groups: [{ groupId: 'group-1', hasMixedCurrencies: false }],
    });
  });
});
