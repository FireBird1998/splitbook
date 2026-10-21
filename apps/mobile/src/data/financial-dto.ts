import { getCurrency } from '@splitbook/shared/currency';
import {
  assertStoredExpenseMoney,
  parseAmountMinor,
  readStoredAmountMinor,
  readUnsupportedAmountMinor,
  toMajorAmount,
  unsupportedMajorAmount,
} from '@splitbook/shared/exact-money';
import {
  parseExpensePageResponse,
  type ExpenseAllocationRead,
  type ExpensePageRead,
} from '@splitbook/shared/expense-page-read';
import {
  GroupBalancesReadError,
  parseGroupBalancesResponse,
} from '@splitbook/shared/group-balances-read';
import {
  HomeBalancesReadError,
  parseHomeBalancesResponse,
} from '@splitbook/shared/home-balances-read';
import type { FinancialPersonRead } from '@splitbook/shared/wire-fields';
import type {
  GroupCurrencyBalance,
  HomeCurrencyBalance,
  HomeGroupBalance,
  MobileExpense,
  FinancialPerson,
} from './types';

// The shared decoders check each response's fields (#211). Android adds what it asks for and
// what it can show: today's currencies only, 20-row pages, exact amounts and stored money.
const PAGE_SIZE = 20;
/**
 * A currency outside today's list fails the read the way a malformed response does: settling
 * up shows this message, so it stays the decoder's sentence.
 */
function assertCurrencies(codes: string[], Failure: new () => Error) {
  if (codes.some((code) => getCurrency(code) === undefined)) throw new Failure();
}
const exact = (value: number, code: string) => toMajorAmount(parseAmountMinor(value, code), code);

function personData(value: FinancialPersonRead): FinancialPerson {
  if (value === null) return { id: null, name: 'Former member', image: null };
  if (typeof value === 'string') return { id: value, name: 'Former member', image: null };
  return { id: value._id, name: value.name?.trim() || 'Former member', image: value.image ?? null };
}

export function parseGroupBalances(value: unknown): GroupCurrencyBalance[] {
  const body = parseGroupBalancesResponse(value);
  assertCurrencies(
    body.byCurrency.map((row) => row.currency),
    GroupBalancesReadError,
  );
  return body.byCurrency.map((row) => {
    const debts = (list: typeof row.debts) =>
      list.map((item) => ({
        from: personData(item.from),
        to: personData(item.to),
        amount: exact(item.amount, row.currency),
      }));
    return {
      currency: row.currency,
      balances: row.balances.map((item) => ({
        user: personData(item.user),
        balance: exact(item.balance, row.currency),
      })),
      debts: debts(row.debts),
      // Missing in an older reply or Saved copy, which is not the same as none (#612).
      ...(row.debtsBeforeSimplifying
        ? { debtsBeforeSimplifying: debts(row.debtsBeforeSimplifying) }
        : {}),
    };
  });
}

/** An Expense in a currency Splitbook no longer supports, as stored (#810). */
function storedExpense(row: ExpensePageRead['expenses'][number]): MobileExpense {
  const allocation = (item: ExpenseAllocationRead) => ({
    user: personData(item.user),
    amountMinor: readUnsupportedAmountMinor({ ...item, moneyVersion: row.moneyVersion }),
    amount: item.amount,
  });
  return {
    id: row._id,
    groupId: row.group,
    description: row.description,
    currency: row.currency,
    amount: row.amount,
    amountMinor: readUnsupportedAmountMinor(row),
    date: new Date(row.date),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    category: row.category,
    tag: row.tag ?? '',
    ...(row.preparedBy ? { preparedBy: row.preparedBy } : {}),
    tagId: row.tagId ?? null,
    paidBy: row.paidBy.map(allocation),
    splitBetween: row.splitBetween.map(allocation),
    splitMethod: row.splitMethod,
  };
}

export function parseExpensePage(value: unknown, groupId: string, defaultCurrency: string) {
  const body = parseExpensePageResponse(value);
  // An Expense in a currency Splitbook no longer supports is read as stored, as Activity reads
  // such money since #779, and so is Spent's line for it, which the server sends last (#810).
  if (body.pagination.limit !== PAGE_SIZE) throw new Error('Unexpected Expense page size');
  if (body.summary.count !== body.pagination.total) throw new Error('Inconsistent expense count');
  const expenses: MobileExpense[] = body.expenses.map((row) => {
    if (row.group !== groupId) throw new Error('Unexpected Expense Group');
    if (!getCurrency(row.currency)) return storedExpense(row);
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
    const normalize = (item: ExpenseAllocationRead) => {
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
      date: new Date(row.date),
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
      category: row.category,
      tag: row.tag ?? '',
      ...(row.preparedBy ? { preparedBy: row.preparedBy } : {}),
      tagId: row.tagId ?? null,
      paidBy: row.paidBy.map(normalize),
      splitBetween: row.splitBetween.map(normalize),
      splitMethod: row.splitMethod,
    };
  });
  const { page, total, totalPages } = body.pagination;
  return {
    expenses,
    pagination: { page, limit: PAGE_SIZE, total, totalPages },
    summary: {
      currency: defaultCurrency,
      count: body.summary.count,
      totalsByCurrency: body.summary.totalsByCurrency.map((row) => ({
        currency: row.currency,
        totalAmount: getCurrency(row.currency)
          ? exact(row.totalAmount, row.currency)
          : unsupportedMajorAmount(readUnsupportedAmountMinor({ amount: row.totalAmount })),
      })),
      userOwes: exact(body.summary.userOwes, defaultCurrency),
      userGetsBack: exact(body.summary.userGetsBack, defaultCurrency),
      byMember: (body.summary.byMember ?? []).map((row) => ({
        user: personData(row.user),
        paid: exact(row.paid, defaultCurrency),
        share: exact(row.share, defaultCurrency),
        net: exact(row.net, defaultCurrency),
      })),
    },
  };
}

/** Home's totals by currency, and the member's balances in each Group they come from. */
export function parseHomeBalances(value: unknown): {
  buckets: HomeCurrencyBalance[];
  byGroup: Record<string, HomeGroupBalance[]>;
} {
  const body = parseHomeBalancesResponse(value);
  // Without Group balances, Home still shows its totals and leaves each Group's balance unknown.
  const groups = body.groups ?? [];
  assertCurrencies(
    [
      ...body.buckets.map((bucket) => bucket.currency),
      ...groups.flatMap((group) => group.balances.map((row) => row.currency)),
    ],
    HomeBalancesReadError,
  );
  return {
    buckets: body.buckets.map((bucket) => ({
      currency: bucket.currency,
      youOwe: exact(bucket.youOwe, bucket.currency),
      youAreOwed: exact(bucket.youAreOwed, bucket.currency),
    })),
    byGroup: Object.fromEntries(
      groups.map((group) => [
        group.groupId,
        group.balances.map((row) => ({
          currency: row.currency,
          balance: exact(row.balance, row.currency),
        })),
      ]),
    ),
  };
}
