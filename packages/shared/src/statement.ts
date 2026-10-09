/** Statement figures: window spending, dated payments, and current all-time ledger positions. */
import type { BackupGroupInput } from './export-backup';
import { calculateNetBalancesMinor, simplifyDebtsMinor } from './debt-simplifier';
import { sumMinorAmounts, toMajorAmount } from './exact-money';
import { memberPaidMinor, memberShareMinor } from './insights';
import { expenseDay, zonedDay } from './export-csv';
import { dayKeyInZone, type DayKey } from './zoned-calendar';

export interface StatementWindow {
  from?: string;
  to?: string;
  timeZone?: string;
  wholeTrip?: boolean;
}

/** Where a whole-trip statement's Expense or Payment falls relative to the Trip's days. */
export type OutsideTrip = 'before' | 'after';

/** A Trip's first and last days in a zone, read as the Trip summary (#316) reads them. */
function tripDays(group: BackupGroupInput, timeZone: string) {
  const start: DayKey | null = group.startDate ? dayKeyInZone(group.startDate, timeZone) : null;
  const end: DayKey | null = group.endDate ? dayKeyInZone(group.endDate, timeZone) : null;
  // A start stored after the end is read as one span, as the Trip summary reads it.
  return start && end && end < start ? { start: end, end: start } : { start, end };
}

/** Expenses outside a Trip's dates: what they spent and how many; null for none. */
function outsideTotal(rows: readonly { amountMinor: number }[]) {
  if (rows.length === 0) return null;
  return {
    spentMinor: sumMinorAmounts(rows.map((row) => row.amountMinor)),
    expenseCount: rows.length,
  };
}

export function buildStatement(group: BackupGroupInput, window: StatementWindow = {}) {
  const timeZone = window.timeZone ?? 'UTC';
  const within = (day: string) =>
    !window.from || !window.to || (day >= window.from && day <= window.to);
  const active = group.expenses.filter((row) => !row.deleted);
  const selected = active.filter((row) => window.wholeTrip || within(expenseDay(row.date)));
  // #316's rule for a whole trip: every Expense counts, and those dated before the Trip's first
  // day or after its last are named "Before the trip" and "After the trip". Days are read in the
  // statement's time zone, by instant, exactly as the Trip summary reads them, so a statement
  // opened from Share wrap-up names the same Expenses as the Insights tab it was opened from.
  const trip = window.wholeTrip ? tripDays(group, timeZone) : null;
  const outsideTrip = (date: Date | string): OutsideTrip | null => {
    if (!trip) return null;
    const day = dayKeyInZone(date, timeZone);
    if (trip.start && day < trip.start) return 'before';
    if (trip.end && day > trip.end) return 'after';
    return null;
  };
  const settlements = group.settlements.filter(
    (row) => window.wholeTrip || within(zonedDay(row.at, timeZone)),
  );
  const currencies = [
    ...new Set([
      group.currency,
      ...active.map((row) => row.currency),
      ...group.settlements.map((row) => row.currency),
    ]),
  ].sort();
  const name = (id: string) =>
    group.names[id] || group.members.find((row) => row.id === id)?.name || 'Former member';
  return {
    id: group.id,
    name: group.name,
    theme: group.theme,
    defaultCurrency: group.currency,
    timeZone,
    from: window.from ?? null,
    to: window.to ?? null,
    wholeTrip: Boolean(window.wholeTrip),
    currencies: currencies.map((currency) => {
      const expenses = selected
        .filter((row) => row.currency === currency)
        .sort(
          (a, b) =>
            new Date(a.date).getTime() - new Date(b.date).getTime() || a.id.localeCompare(b.id),
        );
      const payments = settlements
        .filter((row) => row.currency === currency)
        .sort(
          (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime() || a.id.localeCompare(b.id),
        );
      const ledgerExpenses = active
        .filter((row) => row.currency === currency)
        .map((row) => ({
          amount: toMajorAmount(row.amountMinor, currency),
          amountMinor: row.amountMinor,
          currency,
          moneyVersion: 1,
          paidBy: row.paidBy.map((person) => ({
            user: person.userId,
            amount: toMajorAmount(person.amountMinor, currency),
            amountMinor: person.amountMinor,
          })),
          splitBetween: row.splitBetween.map((person) => ({
            user: person.userId,
            amount: toMajorAmount(person.amountMinor, currency),
            amountMinor: person.amountMinor,
          })),
        }));
      const balances = calculateNetBalancesMinor(
        ledgerExpenses,
        group.settlements
          .filter((row) => row.currency === currency)
          .map((row) => ({
            paidBy: row.fromId,
            paidTo: row.toId,
            amount: toMajorAmount(row.amountMinor, currency),
            amountMinor: row.amountMinor,
            currency,
            moneyVersion: 1,
          })),
        currency,
      );
      const ids = [
        ...new Set([
          ...group.members.map((row) => row.id),
          ...balances.map((row) => row.userId),
          ...payments.map((row) => row.recordedById),
        ]),
      ].sort();
      const figures = expenses.map((row) => ({
        currency,
        moneyVersion: 1,
        paidBy: row.paidBy.map((person) => ({
          user: person.userId,
          amountMinor: person.amountMinor,
        })),
        splitBetween: row.splitBetween.map((person) => ({
          user: person.userId,
          amountMinor: person.amountMinor,
        })),
      }));
      return {
        currency,
        spentMinor: sumMinorAmounts(expenses.map((row) => row.amountMinor)),
        expenseCount: expenses.length,
        paymentTotalMinor: sumMinorAmounts(payments.map((row) => row.amountMinor)),
        people: ids.map((id) => {
          const paidMinor = sumMinorAmounts(figures.map((row) => memberPaidMinor(row, id)));
          const shareMinor = sumMinorAmounts(figures.map((row) => memberShareMinor(row, id)));
          return {
            id,
            name: name(id),
            paidMinor,
            shareMinor,
            netMinor: sumMinorAmounts([paidMinor, -shareMinor]),
            balanceMinor: balances.find((row) => row.userId === id)?.amountMinor ?? 0,
          };
        }),
        suggestedPayments: simplifyDebtsMinor(balances),
        // Already counted in Spent; null without any, and outside a whole-trip statement.
        beforeTrip: outsideTotal(expenses.filter((row) => outsideTrip(row.date) === 'before')),
        afterTrip: outsideTotal(expenses.filter((row) => outsideTrip(row.date) === 'after')),
        expenses: expenses.map((row) => ({
          ...row,
          date: expenseDay(row.date),
          outsideTrip: outsideTrip(row.date),
        })),
        payments: payments.map((row) => ({
          ...row,
          at: new Date(row.at).toISOString(),
          outsideTrip: outsideTrip(row.at),
        })),
      };
    }),
  };
}
export type Statement = ReturnType<typeof buildStatement>;
