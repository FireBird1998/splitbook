import { getCurrencyPrecision } from './currency';
import type { ExpenseSplitMethod } from './split-calculation';

export const MONEY_VERSION = 1 as const;
export const MAX_EXPENSE_AMOUNT = 10_000_000;

export class MoneyValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MoneyValidationError';
  }
}

export function assertSafeMinorAmount(value: number): number {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyValidationError('UNSAFE_MONEY', 'Amount is outside the supported exact range');
  }
  return Object.is(value, -0) ? 0 : value;
}

export function sumMinorAmounts(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total = assertSafeMinorAmount(total + assertSafeMinorAmount(value));
  return total;
}

/** Decimal parsing, including JSON-number exponent notation, without float multiplication. */
export function parseDecimalUnits(value: string | number, digits: number): number {
  const text = String(value).trim();
  const match = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?$/i.exec(text);
  if (!match || text.length > 128 || !Number.isInteger(digits) || digits < 0 || digits > 6) {
    throw new MoneyValidationError('INVALID_MONEY', 'Enter a valid decimal amount');
  }
  const exponent = Number(match[3] ?? 0);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 1000) {
    throw new MoneyValidationError('UNSAFE_MONEY', 'Amount is outside the supported exact range');
  }
  const [whole, fraction = ''] = match[2].split('.');
  let units = BigInt((whole || '0') + fraction);
  const shift = digits + exponent - fraction.length;
  if (shift >= 0) {
    units *= BigInt(10) ** BigInt(shift);
  } else {
    const divisor = BigInt(10) ** BigInt(-shift);
    if (units % divisor !== BigInt(0)) {
      throw new MoneyValidationError(
        'INVALID_MONEY_PRECISION',
        `Amount supports at most ${digits} decimal places`,
      );
    }
    units /= divisor;
  }
  if (match[1] === '-') units = -units;
  return assertSafeMinorAmount(Number(units));
}

export function parseAmountMinor(value: string | number, currency: string): number {
  return parseDecimalUnits(value, getCurrencyPrecision(currency));
}

export function toMajorAmount(amountMinor: number, currency: string): number {
  const amount = assertSafeMinorAmount(amountMinor) / 10 ** getCurrencyPrecision(currency);
  if (parseAmountMinor(amount, currency) !== amountMinor) {
    throw new MoneyValidationError('UNSAFE_MONEY', 'Amount cannot be represented by this client');
  }
  return amount;
}

/** Only legacy reads tolerate the tiny binary tails produced by the old calculator. */
export function readLegacyAmountMinor(amount: number, currency: string): number {
  try {
    return parseAmountMinor(amount, currency);
  } catch (error) {
    if (
      !(error instanceof MoneyValidationError) ||
      error.code !== 'INVALID_MONEY_PRECISION' ||
      !Number.isFinite(amount)
    ) {
      throw error;
    }
    const nearest = Math.round(amount * 10 ** getCurrencyPrecision(currency));
    const restored = nearest / 10 ** getCurrencyPrecision(currency);
    if (
      nearest !== 0 &&
      Number.isSafeInteger(nearest) &&
      Math.abs(amount - restored) <= Number.EPSILON * Math.max(1, Math.abs(amount)) * 2
    ) {
      return nearest;
    }
    throw error;
  }
}

export interface CompatibleMoneyRecord {
  currency: string;
  amount?: number;
  amountMinor?: number;
  moneyVersion?: number;
}

/** Missing/partial canonical data never silently falls back to a legacy value. */
export function readStoredAmountMinor(record: CompatibleMoneyRecord): number {
  getCurrencyPrecision(record.currency);
  if (record.moneyVersion === MONEY_VERSION) {
    const amountMinor = assertSafeMinorAmount(record.amountMinor as number);
    if (
      record.amount !== undefined &&
      readLegacyAmountMinor(record.amount, record.currency) !== amountMinor
    ) {
      throw new MoneyValidationError('MONEY_REPRESENTATION_MISMATCH', 'Stored amounts disagree');
    }
    return amountMinor;
  }
  if (record.moneyVersion !== undefined || record.amountMinor !== undefined) {
    throw new MoneyValidationError('INVALID_MONEY_VERSION', 'Stored money version is invalid');
  }
  if (record.amount === undefined) {
    throw new MoneyValidationError('INVALID_MONEY', 'Stored amount is missing');
  }
  return readLegacyAmountMinor(record.amount, record.currency);
}

export function moneyParticipantId(user: unknown): string {
  if (user === null || user === undefined) return '';
  if (typeof user === 'object' && '_id' in user) return String(user._id);
  return String(user);
}

export function assertUniqueMoneyParticipants(participants: Array<{ user: unknown }>): void {
  const ids = participants.map((participant) => moneyParticipantId(participant.user));
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new MoneyValidationError('DUPLICATE_PARTICIPANTS', 'Each person can appear only once');
  }
}

/** Validate stored allocations without recomputing or repairing their historical distribution. */
export function assertStoredExpenseMoney(
  record: CompatibleMoneyRecord & {
    paidBy: Array<{ user: unknown; amount?: number; amountMinor?: number }>;
    splitBetween: Array<{ user: unknown; amount?: number; amountMinor?: number }>;
  },
): void {
  const total = readStoredAmountMinor(record);
  if (total <= 0)
    throw new MoneyValidationError('INVALID_MONEY_RANGE', 'Stored amount must be positive');
  for (const participants of [record.paidBy, record.splitBetween]) {
    if (!Array.isArray(participants) || participants.length === 0) {
      throw new MoneyValidationError('EMPTY_PARTICIPANTS', 'Stored participants are missing');
    }
    assertUniqueMoneyParticipants(participants);
    const sum = sumMinorAmounts(
      participants.map((participant) => {
        const minor = readStoredAmountMinor({
          ...participant,
          currency: record.currency,
          moneyVersion: record.moneyVersion,
        });
        if (minor < 0)
          throw new MoneyValidationError('INVALID_SPLIT', 'Stored allocations cannot be negative');
        return minor;
      }),
    );
    if (sum !== total) {
      throw new MoneyValidationError(
        'UNBALANCED_LEDGER',
        'Stored allocations do not equal the Expense amount',
      );
    }
  }
}

export interface MoneyPayerInput {
  user: unknown;
  amount: string | number;
}

export interface MoneySplitInput {
  user: unknown;
  amount?: string | number;
  percentage?: number;
  shares?: number;
}

export interface MinorSplitInput {
  user: unknown;
  amountMinor?: number;
  percentage?: number;
  shares?: number;
}

/** Largest remainder allocation with a stable person-ID tie break. */
export function calculateSplitAmountsMinor<T extends MinorSplitInput>(
  method: ExpenseSplitMethod,
  amountMinor: number,
  participants: T[],
): Array<T & { amountMinor: number }> {
  assertSafeMinorAmount(amountMinor);
  if (amountMinor < 0 || participants.length === 0) {
    throw new MoneyValidationError(
      'INVALID_SPLIT',
      'A nonnegative amount and participants are required',
    );
  }
  assertUniqueMoneyParticipants(participants);
  if (method === 'exact' || method === 'unequal') {
    const result = participants.map((participant) => {
      const minor = assertSafeMinorAmount(participant.amountMinor as number);
      if (minor < 0)
        throw new MoneyValidationError('INVALID_SPLIT', 'Split amounts cannot be negative');
      return { ...participant, amountMinor: minor };
    });
    if (sumMinorAmounts(result.map((participant) => participant.amountMinor)) !== amountMinor) {
      throw new MoneyValidationError(
        'SPLIT_TOTAL_MISMATCH',
        'Split amounts must add up to the expense amount',
      );
    }
    return result;
  }
  if (method !== 'equal' && method !== 'shares' && method !== 'percentage') {
    throw new MoneyValidationError('INVALID_SPLIT', 'Choose a valid split method');
  }
  const weights = participants.map((participant) => {
    if (method === 'equal') return 1;
    if (method === 'percentage') {
      const percentage = parseDecimalUnits(participant.percentage ?? 0, 2);
      if (percentage < 0 || percentage > 10000) {
        throw new MoneyValidationError(
          'INVALID_PERCENTAGE',
          'Percentages must be between 0 and 100',
        );
      }
      return percentage;
    }
    const shares = assertSafeMinorAmount(participant.shares ?? 0);
    if (shares < 0) throw new MoneyValidationError('INVALID_SHARES', 'Shares cannot be negative');
    return shares;
  });
  const totalWeight = sumMinorAmounts(weights);
  if (totalWeight === 0) {
    throw new MoneyValidationError('INVALID_SHARES', 'Total split weight must be positive');
  }
  if (method === 'percentage' && totalWeight !== 10000) {
    throw new MoneyValidationError('PERCENTAGE_TOTAL_MISMATCH', 'Percentages must add up to 100');
  }
  const denominator = BigInt(totalWeight);
  const allocations = weights.map((weight, index) => {
    const numerator = BigInt(amountMinor) * BigInt(weight);
    return {
      index,
      id: moneyParticipantId(participants[index].user),
      amountMinor: Number(numerator / denominator),
      remainder: numerator % denominator,
    };
  });
  const remaining =
    amountMinor - sumMinorAmounts(allocations.map((allocation) => allocation.amountMinor));
  const ranked = [...allocations].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  for (let index = 0; index < remaining; index += 1) ranked[index].amountMinor += 1;
  return participants.map((participant, index) => ({
    ...participant,
    amountMinor: allocations[index].amountMinor,
  }));
}

/** Validate a complete merged command, never a PATCH fragment. */
export function normalizeExpenseMoney<P extends MoneyPayerInput, S extends MoneySplitInput>(input: {
  amount: string | number;
  currency: string;
  paidBy: P[];
  splitMethod: ExpenseSplitMethod;
  splitBetween: S[];
}) {
  const { currency } = input;
  const amountMinor = parseAmountMinor(input.amount, currency);
  if (amountMinor <= 0 || amountMinor > parseAmountMinor(MAX_EXPENSE_AMOUNT, currency)) {
    throw new MoneyValidationError(
      'INVALID_MONEY_RANGE',
      'Amount must be positive and at most 10,000,000',
    );
  }
  if (input.paidBy.length === 0 || input.splitBetween.length === 0) {
    throw new MoneyValidationError(
      'EMPTY_PARTICIPANTS',
      'At least one payer and participant are required',
    );
  }
  assertUniqueMoneyParticipants(input.paidBy);
  assertUniqueMoneyParticipants(input.splitBetween);
  const paidBy = input.paidBy.map((payer) => {
    const minor = parseAmountMinor(payer.amount, currency);
    if (minor < 0)
      throw new MoneyValidationError('INVALID_PAYER_AMOUNT', 'Payer amounts cannot be negative');
    return { ...payer, amount: toMajorAmount(minor, currency), amountMinor: minor };
  });
  if (sumMinorAmounts(paidBy.map((payer) => payer.amountMinor)) !== amountMinor) {
    throw new MoneyValidationError(
      'PAYER_TOTAL_MISMATCH',
      'Payer amounts must add up to the expense amount',
    );
  }
  const splitInput = input.splitBetween.map((participant) => ({
    ...participant,
    amountMinor:
      input.splitMethod === 'exact' || input.splitMethod === 'unequal'
        ? participant.amount === undefined
          ? undefined
          : parseAmountMinor(participant.amount, currency)
        : undefined,
  }));
  const splitBetween = calculateSplitAmountsMinor(input.splitMethod, amountMinor, splitInput).map(
    (participant) => ({
      ...participant,
      amount: toMajorAmount(participant.amountMinor, currency),
    }),
  );
  return {
    moneyVersion: MONEY_VERSION,
    currency,
    amount: toMajorAmount(amountMinor, currency),
    amountMinor,
    paidBy,
    splitBetween,
  };
}
