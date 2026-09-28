import { z } from 'zod';
import { getCurrency } from '@splitbook/shared/currency';
import {
  assertStoredExpenseMoney,
  parseAmountMinor,
  readStoredAmountMinor,
  toMajorAmount,
} from '@splitbook/shared/exact-money';
import { objectId } from './dto';
import type {
  GroupCurrencyBalance,
  HomeCurrencyBalance,
  MobileExpense,
  FinancialPerson,
} from './types';

const currency = z.string().refine((value) => getCurrency(value) !== undefined);
const amount = z.number().finite();
const exact = (value: number, code: string) => toMajorAmount(parseAmountMinor(value, code), code);
const timestamp = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const person = z.union([
  objectId,
  z.object({ _id: objectId, name: z.string().optional(), image: z.string().nullish() }),
  z.null(),
]);
function personData(value: z.infer<typeof person>): FinancialPerson {
  if (value === null) return { id: null, name: 'Former member', image: null };
  if (typeof value === 'string') return { id: value, name: 'Former member', image: null };
  return { id: value._id, name: value.name?.trim() || 'Former member', image: value.image ?? null };
}
const allocation = z.object({ user: person, amount, amountMinor: z.number().int().optional() });
const expense = z.object({
  _id: objectId,
  group: objectId,
  description: z.string(),
  currency,
  amount,
  amountMinor: z.number().int().optional(),
  moneyVersion: z.number().int().optional(),
  date: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
  category: z.string(),
  tag: z.string().optional().default(''),
  tagId: objectId.nullish(),
  paidBy: z.array(allocation),
  splitBetween: z.array(allocation),
  splitMethod: z.enum(['equal', 'unequal', 'exact', 'percentage', 'shares']),
});

export function parseGroupBalances(value: unknown): GroupCurrencyBalance[] {
  const bucket = z.object({
    currency,
    balances: z.array(z.object({ user: person, balance: amount })),
    debts: z.array(z.object({ from: person, to: person, amount: amount.positive() })),
  });
  const body = z
    .object({ data: z.object({ byCurrency: z.array(bucket) }), status: z.literal(200) })
    .parse(value);
  return body.data.byCurrency.map((row) => ({
    currency: row.currency,
    balances: row.balances.map((item) => ({
      user: personData(item.user),
      balance: exact(item.balance, row.currency),
    })),
    debts: row.debts.map((item) => ({
      from: personData(item.from),
      to: personData(item.to),
      amount: exact(item.amount, row.currency),
    })),
  }));
}

export function parseExpensePage(value: unknown, groupId: string, defaultCurrency: string) {
  const totals = z.object({ currency, totalAmount: amount.nonnegative() });
  const body = z
    .object({
      data: z.object({
        expenses: z.array(expense),
        pagination: z.object({
          page: z.number().int().positive(),
          limit: z.literal(20),
          total: z.number().int().nonnegative(),
          totalPages: z.number().int().nonnegative(),
        }),
        summary: z.object({
          count: z.number().int().nonnegative(),
          totalsByCurrency: z.array(totals),
          userOwes: amount.nonnegative(),
          userGetsBack: amount.nonnegative(),
          byMember: z
            .array(
              z.object({
                user: person,
                paid: amount.nonnegative(),
                share: amount.nonnegative(),
                net: amount,
              }),
            )
            .optional()
            .default([]),
        }),
      }),
      status: z.literal(200),
    })
    .parse(value).data;
  if (body.summary.count !== body.pagination.total) throw new Error('Inconsistent expense count');
  const expenses: MobileExpense[] = body.expenses.map((row) => {
    if (row.group !== groupId) throw new Error('Unexpected Expense Group');
    // Populated former members can be null. Validate allocation amounts with
    // unique placeholders while keeping their unavailable identities honest in UI.
    assertStoredExpenseMoney({
      ...row,
      paidBy: row.paidBy.map((item, index) => ({
        ...item,
        user: item.user ?? `former-payer-${index}`,
      })),
      splitBetween: row.splitBetween.map((item, index) => ({
        ...item,
        user: item.user ?? `former-participant-${index}`,
      })),
    });
    const minor = readStoredAmountMinor(row);
    const normalize = (item: z.infer<typeof allocation>) => {
      const amountMinor = readStoredAmountMinor({
        ...item,
        currency: row.currency,
        moneyVersion: row.moneyVersion,
      });
      return {
        user: personData(item.user),
        amountMinor,
        amount: toMajorAmount(amountMinor, row.currency),
      };
    };
    return {
      id: row._id,
      groupId: row.group,
      description: row.description,
      currency: row.currency,
      amount: toMajorAmount(minor, row.currency),
      amountMinor: minor,
      date: row.date,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      category: row.category,
      tag: row.tag,
      tagId: row.tagId ?? null,
      paidBy: row.paidBy.map(normalize),
      splitBetween: row.splitBetween.map(normalize),
      splitMethod: row.splitMethod,
    };
  });
  return {
    expenses,
    pagination: body.pagination,
    summary: {
      currency: defaultCurrency,
      count: body.summary.count,
      totalsByCurrency: body.summary.totalsByCurrency.map((row) => ({
        currency: row.currency,
        totalAmount: exact(row.totalAmount, row.currency),
      })),
      userOwes: exact(body.summary.userOwes, defaultCurrency),
      userGetsBack: exact(body.summary.userGetsBack, defaultCurrency),
      byMember: body.summary.byMember.map((row) => ({
        user: personData(row.user),
        paid: exact(row.paid, defaultCurrency),
        share: exact(row.share, defaultCurrency),
        net: exact(row.net, defaultCurrency),
      })),
    },
  };
}

export function parseHomeBalances(value: unknown): HomeCurrencyBalance[] {
  const body = z
    .object({
      data: z.object({
        buckets: z.array(
          z.object({ currency, youOwe: amount.nonnegative(), youAreOwed: amount.nonnegative() }),
        ),
      }),
      status: z.literal(200),
    })
    .parse(value);
  return body.data.buckets.map((bucket) => ({
    currency: bucket.currency,
    youOwe: exact(bucket.youOwe, bucket.currency),
    youAreOwed: exact(bucket.youAreOwed, bucket.currency),
  }));
}
