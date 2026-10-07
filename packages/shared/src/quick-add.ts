/**
 * Quick add (#320): read a line such as "Dinner 2400 paid by me" into an Expense's parts, on
 * the member's device and before anything is sent. The web's Quick add field shows what was
 * read as chips and saves it through the full form's request, so the rules for money, Tags and
 * dates are the ones every other Expense follows.
 *
 * The grammar, read word by word and case-insensitively. Any order works; whatever no rule
 * takes is the description.
 *
 * - **Amount**: one number in the Group's currency, read in exact minor units: `2400`,
 *   `2,400`, `1,00,000`, `2400.50`, `₹2400`, `Rs 2400`, `INR 2400`, `2400 INR`, `2400/-`.
 *   Its decimals are checked against the currency (INR 2, JPY 0) and nothing is rounded.
 *   Zero, a minus sign, more than the largest Expense, another currency's code or symbol, and a
 *   comma used as a decimal point are refused. When several plain numbers appear ("Dinner for
 *   4 2400"), the one marked with the currency wins, otherwise the largest; the others stay in
 *   the description.
 * - **Paid by**: `paid by me`, `paid by <member>`, `I paid`, `<member> paid`. Without it, the
 *   member typing paid. A member is named by their full name, one of its words, or the start
 *   of one (two letters at least), among the Group's current members only. A name that fits
 *   more than one member is asked about, never guessed.
 * - **Split**: equally among every current member, unless `split with <members>` (the payer
 *   and those members) or `split between <members>` / `split among <members>` (exactly those
 *   members) names them, joined by commas, `and` or `&`.
 * - **Date**: `today`, `yesterday`, `2026-10-05`, `5 Oct`, `5th October 2026`, `Oct 5`, each
 *   optionally after `on`. A date without a year takes the year that puts it nearest today.
 *   Without one, the date is today in the viewer's own zone, which the caller passes in.
 *
 * Framework-free (ADR 0002): no Intl, no DOM, and dates are compared as `yyyy-MM-dd` strings,
 * so no time zone can move a day.
 */
import { CURRENCIES, formatCurrency, getCurrency, getCurrencyPrecision } from './currency';
import {
  MAX_EXPENSE_AMOUNT,
  MoneyValidationError,
  parseAmountMinor,
  toMajorAmount,
} from './exact-money';
import type { ExpenseDraftValues } from './expense-draft';

/** The longest description an Expense takes, as the create request counts it. */
export const QUICK_ADD_DESCRIPTION_MAX = 200;

export interface QuickAddMember {
  id: string;
  name: string;
}

export interface QuickAddContext {
  /** The Group's currency: its decimals, its symbol and its code. */
  currency: string;
  /** Today in the viewer's own zone, `yyyy-MM-dd`, as the full form's date picker starts. */
  today: string;
  /** The member typing, whom "me" and "I" name. */
  viewerId: string;
  /** The Group's current members, in the Group's order. */
  members: readonly QuickAddMember[];
}

export type QuickAddField = 'description' | 'amount' | 'payer' | 'split' | 'date';

export type QuickAddProblemCode =
  | 'amount-missing'
  | 'amount-decimals'
  | 'amount-zero'
  | 'amount-negative'
  | 'amount-too-large'
  | 'amount-format'
  | 'amount-currency'
  | 'amount-several'
  | 'description-missing'
  | 'description-too-long'
  | 'payer-missing'
  | 'payer-unknown'
  | 'payer-ambiguous'
  | 'payer-several'
  | 'split-missing'
  | 'split-unknown'
  | 'split-ambiguous'
  | 'date-invalid';

export interface QuickAddProblem {
  field: QuickAddField;
  code: QuickAddProblemCode;
  /** `needed`: not typed yet. `invalid`: typed, and refused. */
  kind: 'needed' | 'invalid';
  message: string;
}

export interface QuickAddPayer {
  /** Who paid, or null while a name is unknown, fits several members or is missing. */
  memberId: string | null;
  /** The words that named the payer, as typed ("Sam"), or null when nobody was named. */
  said: string | null;
  /** When a name fits several members: each of them, for the member to pick from. */
  candidates: string[];
}

export interface QuickAddSplit {
  /** `all`: every current member. `with`: the payer and `memberIds`. `between`: exactly them. */
  mode: 'all' | 'with' | 'between';
  /** The members named, in the Group's order; empty for `all`. */
  memberIds: string[];
}

export interface QuickAddRead {
  /** What it was for: the words no rule took, or '' when there are none. */
  description: string;
  /** The amount in exact minor units, or null while it is missing or refused. */
  amountMinor: number | null;
  /**
   * The amount as typed, without grouping commas or a currency mark ("2400.505"), so a refused
   * amount can still be corrected in the full form. Null when no number was typed.
   */
  amountText: string | null;
  payer: QuickAddPayer;
  split: QuickAddSplit;
  /** `yyyy-MM-dd`. */
  date: string;
  /** Where the date came from: unsaid (today), a word, or a written date. */
  dateSaid: 'default' | 'today' | 'yesterday' | 'date';
  /** Every reason the line can't be added yet, in the order a member would fix them. */
  problems: QuickAddProblem[];
}

// ─── Words ──────────────────────────────────────────────────────────────

interface Token {
  /** As typed. */
  raw: string;
  /** For comparing: lower case, Latin accents removed, punctuation at either end removed. */
  word: string;
  taken: boolean;
}

/** Lower case without Latin accents ("José" reads as "jose"); other scripts keep their marks. */
function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').toLowerCase();
}

const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

function wordOf(raw: string): string {
  return fold(raw).replace(EDGE, '');
}

function tokenize(text: string): Token[] {
  return text
    .split(/\s+/u)
    .filter(Boolean)
    .map((raw) => ({ raw, word: wordOf(raw), taken: false }));
}

// ─── Members ────────────────────────────────────────────────────────────

const ME = new Set(['me', 'myself', 'i']);

interface NameMatch {
  /** Who the words could be; one id when they name one member. */
  ids: string[];
  /** How many tokens the name took. */
  length: number;
}

/**
 * Which current member the tokens from `start` name: "me", a whole name, one word of a name,
 * or the start of one, in that order of preference. Null when none fits.
 */
function matchMember(
  tokens: Token[],
  start: number,
  context: QuickAddContext,
  names: Array<{ id: string; words: string[] }>,
): NameMatch | null {
  const first = tokens[start];
  if (!first || first.taken || first.word === '') return null;
  if (ME.has(first.word)) return { ids: [context.viewerId], length: 1 };

  // Words of a name in a row: "Sam Chen", "Chen", "Ann Lee" of "Mary Ann Lee". The longest run
  // wins, and a whole name beats part of another: "Sam" is the member called just Sam.
  let best: { ids: string[]; length: number; whole: boolean } | null = null;
  for (const { id, words } of names) {
    let run = 0;
    for (let from = 0; from < words.length; from += 1) {
      let length = 0;
      while (from + length < words.length) {
        const token = tokens[start + length];
        if (!token || token.taken || token.word !== words[from + length]) break;
        length += 1;
      }
      run = Math.max(run, length);
    }
    if (run === 0) continue;
    const whole = run === words.length;
    if (!best || run > best.length || (run === best.length && whole && !best.whole))
      best = { ids: [id], length: run, whole };
    else if (run === best.length && whole === best.whole) best.ids.push(id);
  }
  if (best) return { ids: best.ids, length: best.length };

  // The start of a word of a name, two letters at least: "pri" for Priya.
  if ([...first.word].length >= 2) {
    const byStart = names
      .filter(({ words }) => words.some((word) => word.startsWith(first.word)))
      .map(({ id }) => id);
    if (byStart.length) return { ids: byStart, length: 1 };
  }
  return null;
}

/** The same, for a name that ends just before `end` ("Sam Chen paid"). */
function matchMemberEndingAt(
  tokens: Token[],
  end: number,
  context: QuickAddContext,
  names: Array<{ id: string; words: string[] }>,
): (NameMatch & { start: number }) | null {
  let best: (NameMatch & { start: number }) | null = null;
  const longest = Math.max(1, ...names.map(({ words }) => words.length));
  for (let length = Math.min(longest, end); length >= 1; length -= 1) {
    const start = end - length;
    const match = matchMember(tokens, start, context, names);
    if (match && match.length === length) {
      best = { ...match, start };
      break;
    }
  }
  return best;
}

function said(tokens: Token[], start: number, length: number): string {
  return tokens
    .slice(start, start + length)
    .map((token) => token.raw.replace(EDGE, ''))
    .join(' ');
}

function take(tokens: Token[], start: number, length: number) {
  for (let index = start; index < start + length; index += 1) tokens[index].taken = true;
}

/** "Sam Chen or Sam Lee", "Ann, Ben or Cal". */
function oneOf(names: string[], last: 'or' | 'and'): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} ${last} ${names[names.length - 1]}`;
}

// ─── Dates ──────────────────────────────────────────────────────────────

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** January is 0. Full names, three-letter forms and "sept". */
function monthOf(word: string): number | null {
  if (word.length < 3) return null;
  const index = MONTHS.findIndex((month) => month === word || month.slice(0, 3) === word);
  if (index >= 0) return index;
  return word === 'sept' ? 8 : null;
}

const DAY = /^(\d{1,2})(?:st|nd|rd|th)?$/;

/** A day of the month as typed ("5", "05", "5th"), never a number with a currency mark. */
function dayOf(token: Token | undefined): number | null {
  if (!token || token.taken) return null;
  const match = DAY.exec(token.raw.replace(/[.,]+$/u, '').toLowerCase());
  return match ? Number(match[1]) : null;
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** Calendar days from `yyyy-MM-dd` parts, through UTC so no zone moves them. */
function dayNumber(year: number, month: number, day: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  return Math.floor(date.getTime() / 86_400_000);
}

function isRealDay(year: number, month: number, day: number): boolean {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day
  );
}

function calendarDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month + 1)}-${pad(day)}`;
}

function parseToday(today: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!match || !isRealDay(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    throw new Error('Quick add needs today as yyyy-MM-dd');
  return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
}

/** The day before `today`, across months and years. */
function dayBefore(today: string): string {
  const { year, month, day } = parseToday(today);
  const date = new Date(0);
  date.setUTCFullYear(year, month, day - 1);
  return calendarDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

const MONTH_TITLES = MONTHS.map((month) => month[0].toUpperCase() + month.slice(1));

interface DateRead {
  date: string;
  said: QuickAddRead['dateSaid'];
  problem?: QuickAddProblem;
}

/** "5 Oct" or "Oct 5" without a year: the year that puts it nearest today. */
function nearestYear(month: number, day: number, today: string): number | null {
  const now = parseToday(today);
  const todayNumber = dayNumber(now.year, now.month, now.day);
  let best: { year: number; distance: number } | null = null;
  for (const year of [now.year - 1, now.year, now.year + 1]) {
    if (!isRealDay(year, month, day)) continue;
    const distance = Math.abs(dayNumber(year, month, day) - todayNumber);
    if (!best || distance < best.distance) best = { year, distance };
  }
  return best?.year ?? null;
}

function invalidDate(day: number, month: number, year: number | null): QuickAddProblem {
  return {
    field: 'date',
    code: 'date-invalid',
    kind: 'invalid',
    message: `There’s no ${day} ${MONTH_TITLES[month]}${year === null ? '' : ` ${year}`}.`,
  };
}

/** A written year counts only near today, so "5 Oct 2400" reads 2400 as the amount. */
function yearOf(token: Token | undefined, today: string): number | null {
  if (!token || token.taken || !/^\d{4}$/.test(token.word)) return null;
  const year = Number(token.word);
  const now = parseToday(today).year;
  return year >= now - 5 && year <= now + 1 ? year : null;
}

function readDate(tokens: Token[], today: string): DateRead {
  const settle = (start: number, length: number, read: DateRead): DateRead => {
    // "on 5 Oct": the "on" belongs to the date.
    const on = start > 0 && !tokens[start - 1].taken && tokens[start - 1].word === 'on';
    take(tokens, on ? start - 1 : start, length + (on ? 1 : 0));
    return read;
  };
  const written = (month: number, day: number, year: number | null): DateRead => {
    const chosen = year ?? nearestYear(month, day, today);
    if (chosen === null || !isRealDay(chosen, month, day))
      return { date: today, said: 'date', problem: invalidDate(day, month, year) };
    return { date: calendarDate(chosen, month, day), said: 'date' };
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.taken) continue;
    if (token.word === 'today') return settle(index, 1, { date: today, said: 'today' });
    if (token.word === 'yesterday')
      return settle(index, 1, { date: dayBefore(today), said: 'yesterday' });

    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(token.word);
    if (iso) {
      const [year, month, day] = [Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])];
      return settle(
        index,
        1,
        month >= 0 && month < 12 && isRealDay(year, month, day)
          ? { date: token.word, said: 'date' }
          : {
              date: today,
              said: 'date',
              problem: {
                field: 'date',
                code: 'date-invalid',
                kind: 'invalid',
                message: `There’s no ${token.word}.`,
              },
            },
      );
    }

    // "5 Oct [2026]"
    const dayFirst = dayOf(token);
    const next = tokens[index + 1];
    if (dayFirst !== null && next && !next.taken && monthOf(next.word) !== null) {
      const year = yearOf(tokens[index + 2], today);
      return settle(index, year === null ? 2 : 3, written(monthOf(next.word)!, dayFirst, year));
    }

    // "Oct 5[,] [2026]"
    const month = monthOf(token.word);
    const dayAfter = dayOf(next);
    if (month !== null && dayAfter !== null) {
      const year = yearOf(tokens[index + 2], today);
      return settle(index, year === null ? 2 : 3, written(month, dayAfter, year));
    }
  }
  return { date: today, said: 'default' };
}

// ─── Amounts ────────────────────────────────────────────────────────────

interface Marks {
  /** The Group's own code, symbol and common names, folded: "inr", "₹", "rs". */
  own: Set<string>;
  /** Other currencies' symbols that aren't letters, folded: "$", "€", "£". */
  otherSymbols: Set<string>;
  /** Other currencies' codes, in capitals: "USD". "rub" and "try" are words; "RUB" isn't. */
  otherCodes: Set<string>;
}

/** The marks that say a number is in the Group's currency, and those that say it isn't. */
function currencyMarks(currency: string): Marks {
  const own = new Set<string>([currency.toLowerCase()]);
  const symbol = getCurrency(currency)?.symbol;
  if (symbol) own.add(fold(symbol));
  // "$12" in a Group in Canadian, Australian or Singapore dollars.
  if (symbol?.endsWith('$')) own.add('$');
  if (currency === 'INR') ['rs', 'rs.', 'rupee', 'rupees'].forEach((mark) => own.add(mark));
  const otherSymbols = new Set<string>();
  const otherCodes = new Set<string>();
  for (const { code, symbol: theirs } of CURRENCIES) {
    if (code === currency) continue;
    otherCodes.add(code);
    // Letter symbols ("kr", "R", "RM") are words too often to refuse a line over.
    if (/[^\p{L}]/u.test(theirs) && !own.has(fold(theirs))) otherSymbols.add(fold(theirs));
  }
  return { own, otherSymbols, otherCodes };
}

type Mark = 'none' | 'own' | 'other';

function markOf(text: string, marks: Marks): Mark | null {
  const value = fold(text);
  if (value === '') return 'none';
  if (marks.own.has(value)) return 'own';
  if (marks.otherCodes.has(text) || marks.otherSymbols.has(value)) return 'other';
  return null;
}

interface AmountCandidate {
  start: number;
  length: number;
  /** Digits and a point, without grouping commas: "2400.50". Null when the commas are wrong. */
  number: string | null;
  mark: Mark;
  negative: boolean;
}

const NUMBER_TOKEN = /^([^\d]*?)([-−+]?)(\d(?:[\d.,]*\d)?)(.*)$/u;

/** Grouping commas only between thousands: 2,400 or 1,00,000. */
function ungroup(number: string): string | null {
  if (!number.includes(',')) return number;
  if (
    /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(number) ||
    /^\d{1,2}(?:,\d{2})*,\d{3}(?:\.\d+)?$/.test(number)
  )
    return number.replace(/,/g, '');
  return null;
}

/** A token as a number, with a currency mark joined to it ("₹2400", "2400/-", "rs.2400"). */
function numberIn(raw: string, marks: Marks) {
  const text = raw.replace(/^[("'[]+/u, '').replace(/[)"'\].,;:!?]+$/u, '');
  const match = NUMBER_TOKEN.exec(text);
  if (!match) return null;
  const [, before, sign, digits, after] = match;
  if ((digits.match(/\./g) ?? []).length > 1) return null;
  const suffix = after.replace(/\/-$/, '');
  const markBefore = markOf(before, marks);
  const markAfter = markOf(suffix, marks);
  // "6E2341", "2nd", "10kg" and "3pm" are words, not amounts.
  if (markBefore === null || markAfter === null) return null;
  if (markBefore !== 'none' && markAfter !== 'none') return null;
  const mark: Mark = markBefore !== 'none' ? markBefore : markAfter;
  return { number: ungroup(digits), mark, negative: sign === '-' || sign === '−' };
}

function amountCandidates(tokens: Token[], marks: Marks): AmountCandidate[] {
  const candidates: AmountCandidate[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].taken) continue;
    const read = numberIn(tokens[index].raw, marks);
    if (!read) continue;
    let start = index;
    let length = 1;
    let mark = read.mark;
    // A mark written apart: "₹ 2400", "Rs 2400", "2400 INR".
    if (mark === 'none') {
      const before = tokens[index - 1];
      const after = tokens[index + 1];
      const apart = (token: Token | undefined) =>
        token && !token.taken ? markOf(token.raw.replace(/[,;:]+$/u, ''), marks) : null;
      const markBefore = apart(before);
      const markAfter = apart(after);
      if (markBefore === 'own' || markBefore === 'other') {
        mark = markBefore;
        start = index - 1;
        length = 2;
      } else if (markAfter === 'own' || markAfter === 'other') {
        mark = markAfter;
        length = 2;
      }
    }
    candidates.push({ start, length, number: read.number, mark, negative: read.negative });
    index = start + length - 1;
  }
  return candidates;
}

function example(currency: string): string {
  return `${getCurrency(currency)?.symbol ?? `${currency} `}2400`;
}

interface AmountRead {
  amountMinor: number | null;
  amountText: string | null;
  problem?: QuickAddProblem;
}

function readAmount(tokens: Token[], currency: string): AmountRead {
  const candidates = amountCandidates(tokens, currencyMarks(currency));
  const invalid = (
    code: QuickAddProblemCode,
    message: string,
    amountText: string | null = null,
  ): AmountRead => ({
    amountMinor: null,
    amountText,
    problem: { field: 'amount', code, kind: 'invalid', message },
  });

  const foreign = candidates.find((candidate) => candidate.mark === 'other');
  if (foreign) {
    take(tokens, foreign.start, foreign.length);
    return invalid(
      'amount-currency',
      `This Group records ${currency}, so write the amount in ${currency}, like ${example(currency)}.`,
    );
  }
  const marked = candidates.filter((candidate) => candidate.mark === 'own');
  if (marked.length > 1) {
    for (const candidate of marked) take(tokens, candidate.start, candidate.length);
    return invalid('amount-several', `Keep one amount, like ${example(currency)}.`);
  }
  const misgrouped = candidates.find((candidate) => candidate.number === null);
  if (misgrouped) {
    take(tokens, misgrouped.start, misgrouped.length);
    return invalid(
      'amount-format',
      'Use a point for decimals, like 12.50, and commas only between thousands.',
    );
  }
  const chosen =
    marked[0] ??
    candidates.reduce<AmountCandidate | null>(
      (largest, candidate) =>
        !largest || Number(candidate.number) > Number(largest.number) ? candidate : largest,
      null,
    );
  if (!chosen) {
    return {
      amountMinor: null,
      amountText: null,
      problem: {
        field: 'amount',
        code: 'amount-missing',
        kind: 'needed',
        message: 'Add an amount, like 2400.',
      },
    };
  }
  take(tokens, chosen.start, chosen.length);
  const number = chosen.number!;
  if (chosen.negative)
    return invalid(
      'amount-negative',
      'An Expense is always more than zero. Enter the amount without a minus sign.',
      number,
    );
  let minor: number;
  try {
    minor = parseAmountMinor(number, currency);
  } catch (error) {
    if (error instanceof MoneyValidationError && error.code === 'INVALID_MONEY_PRECISION') {
      const places = getCurrencyPrecision(currency);
      return invalid(
        'amount-decimals',
        `${currency} amounts have ${places === 0 ? 'no decimal places' : `at most ${places} decimal places`}. Nothing is rounded for you.`,
        number,
      );
    }
    minor = Number.POSITIVE_INFINITY;
  }
  if (minor === 0) return invalid('amount-zero', 'Enter an amount above zero.', number);
  if (minor > parseAmountMinor(MAX_EXPENSE_AMOUNT, currency))
    return invalid(
      'amount-too-large',
      `One Expense can be at most ${formatCurrency(MAX_EXPENSE_AMOUNT, currency)}.`,
      number,
    );
  return { amountMinor: minor, amountText: number };
}

// ─── Paid by and split ──────────────────────────────────────────────────

function readPayer(
  tokens: Token[],
  context: QuickAddContext,
  names: Array<{ id: string; words: string[] }>,
  nameOf: (id: string) => string,
): { payer: QuickAddPayer; problem?: QuickAddProblem } {
  const unresolved = (word: string, ids: string[]) => {
    const payer: QuickAddPayer = { memberId: null, said: word, candidates: ids };
    return ids.length
      ? {
          payer,
          problem: {
            field: 'payer' as const,
            code: 'payer-ambiguous' as const,
            kind: 'invalid' as const,
            message: `More than one member is called “${word}”: ${oneOf(ids.map(nameOf), 'or')}? Pick who paid.`,
          },
        }
      : {
          payer,
          problem: {
            field: 'payer' as const,
            code: 'payer-unknown' as const,
            kind: 'invalid' as const,
            message: `No current member is called “${word}”. Pick who paid.`,
          },
        };
  };

  // "paid by Sam and Priya": Quick add takes one payer; the full form takes several.
  const several = (start: number, end: number) => {
    take(tokens, start, end - start);
    return {
      payer: { memberId: null, said: said(tokens, start, end - start), candidates: [] },
      problem: {
        field: 'payer' as const,
        code: 'payer-several' as const,
        kind: 'invalid' as const,
        message: 'Quick add takes one payer. Use More options when several people paid.',
      },
    };
  };
  const separatorAt = (at: number) =>
    !!tokens[at] && !tokens[at].taken && SEPARATORS.has(tokens[at].raw.toLowerCase());

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].taken || tokens[index].word !== 'paid') continue;
    const by = tokens[index + 1];
    if (by && !by.taken && by.word === 'by') {
      // "paid by <who>"
      const match = matchMember(tokens, index + 2, context, names);
      if (!match) {
        const next = tokens[index + 2];
        const missing = !next || next.taken;
        take(tokens, index, missing ? 2 : 3);
        if (missing)
          return {
            payer: { memberId: null, said: null, candidates: [] },
            problem: {
              field: 'payer',
              code: 'payer-missing',
              kind: 'needed',
              message: 'Who paid? Type a member’s name after “paid by”.',
            },
          };
        return unresolved(next.raw.replace(EDGE, ''), []);
      }
      let end = index + 2 + match.length;
      for (;;) {
        const next = /,$/.test(tokens[end - 1].raw) ? end : separatorAt(end) ? end + 1 : -1;
        const more = next < 0 ? null : matchMember(tokens, next, context, names);
        if (!more) break;
        end = next + more.length;
      }
      if (end > index + 2 + match.length) return several(index, end);
      const word = said(tokens, index + 2, match.length);
      take(tokens, index, 2 + match.length);
      if (match.ids.length > 1) return unresolved(word, match.ids);
      return { payer: { memberId: match.ids[0], said: word, candidates: [] } };
    }
    // "<who> paid"
    const before = matchMemberEndingAt(tokens, index, context, names);
    if (before) {
      let start = before.start;
      for (;;) {
        const end = separatorAt(start - 1)
          ? start - 1
          : start > 0 && !tokens[start - 1].taken && /,$/.test(tokens[start - 1].raw)
            ? start
            : -1;
        const more = end < 0 ? null : matchMemberEndingAt(tokens, end, context, names);
        if (!more || more.start === start) break;
        start = more.start;
      }
      if (start < before.start) return several(start, index + 1);
      const word = said(tokens, before.start, before.length);
      take(tokens, before.start, before.length + 1);
      if (before.ids.length > 1) return unresolved(word, before.ids);
      return { payer: { memberId: before.ids[0], said: word, candidates: [] } };
    }
  }
  return { payer: { memberId: context.viewerId, said: null, candidates: [] } };
}

const SEPARATORS = new Set(['and', '&', ',']);

function readSplit(
  tokens: Token[],
  context: QuickAddContext,
  names: Array<{ id: string; words: string[] }>,
  nameOf: (id: string) => string,
): { split: QuickAddSplit; problem?: QuickAddProblem } {
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].taken || tokens[index].word !== 'split') continue;
    let at = index + 1;
    if (tokens[at] && !tokens[at].taken && tokens[at].word === 'equally') at += 1;
    const joiner = tokens[at];
    const mode = joiner && !joiner.taken ? joiner.word : '';
    if (mode !== 'with' && mode !== 'between' && mode !== 'among') {
      // "split" alone, or "split equally": equally among everyone, as without it.
      if (at > index + 1) take(tokens, index, at - index);
      continue;
    }
    at += 1;
    const chosen: string[] = [];
    let end = at;
    let problem: QuickAddProblem | undefined;
    for (;;) {
      const match = matchMember(tokens, end, context, names);
      if (!match) {
        if (chosen.length === 0) {
          const next = tokens[end];
          if (next && !next.taken) {
            const word = next.raw.replace(EDGE, '');
            end += 1;
            problem = {
              field: 'split',
              code: 'split-unknown',
              kind: 'invalid',
              message: `No current member is called “${word}”. Fix the name, or change the split in More options.`,
            };
          } else {
            problem = {
              field: 'split',
              code: 'split-missing',
              kind: 'needed',
              message: `Who is it split ${mode}? Type a member’s name after “split ${mode}”.`,
            };
          }
        }
        break;
      }
      const word = said(tokens, end, match.length);
      const commaAfter = /,$/.test(tokens[end + match.length - 1].raw);
      end += match.length;
      if (match.ids.length > 1) {
        problem ??= {
          field: 'split',
          code: 'split-ambiguous',
          kind: 'invalid',
          message: `More than one member is called “${word}”: ${oneOf(match.ids.map(nameOf), 'and')}. Type the full name, or change the split in More options.`,
        };
      } else {
        chosen.push(match.ids[0]);
      }
      if (commaAfter) continue;
      const separator = tokens[end];
      if (!separator || separator.taken || !SEPARATORS.has(separator.raw.toLowerCase())) break;
      // Only a separator followed by a name joins the list; "and drinks" stays in the words.
      if (!matchMember(tokens, end + 1, context, names)) break;
      end += 1;
    }
    take(tokens, index, end - index);
    const order = context.members.map(({ id }) => id);
    const memberIds = order.filter((id) => chosen.includes(id));
    return { split: { mode: mode === 'with' ? 'with' : 'between', memberIds }, problem };
  }
  return { split: { mode: 'all', memberIds: [] } };
}

// ─── Description ────────────────────────────────────────────────────────

/** Words that only join the parts together: "2400 for dinner", "Dinner for 2400". */
const CONNECTORS = new Set([
  'for',
  'on',
  'of',
  'at',
  'by',
  'paid',
  'and',
  '&',
  '-',
  '–',
  '—',
  ':',
  ',',
]);

function readDescription(tokens: Token[]): string {
  const words = tokens.filter((token) => !token.taken).map((token) => token.raw);
  const connector = (raw: string) => CONNECTORS.has(raw.toLowerCase().replace(/[,:;]+$/u, ''));
  while (words.length && connector(words[0])) words.shift();
  while (words.length && connector(words[words.length - 1])) words.pop();
  const text = words
    .join(' ')
    .replace(/^[\s,;:\-–—]+|[\s,;:\-–—]+$/gu, '')
    .trim();
  if (text === '') return '';
  // "dinner" reads "Dinner"; "iPhone case" keeps its own capitals.
  const [first] = text.split(' ');
  if (first === first.toLowerCase()) {
    const [initial, ...rest] = [...text];
    return initial.toUpperCase() + rest.join('');
  }
  return text;
}

// ─── The whole line ─────────────────────────────────────────────────────

const ORDER: QuickAddField[] = ['amount', 'payer', 'split', 'date', 'description'];

/**
 * Read a Quick add line. Pure: the same line, Group and day always read the same, on any
 * device and in any zone.
 */
export function readQuickAdd(text: string, context: QuickAddContext): QuickAddRead {
  parseToday(context.today);
  getCurrencyPrecision(context.currency);
  const tokens = tokenize(text);
  const names = context.members.map(({ id, name }) => ({
    id,
    words: fold(name)
      .split(/\s+/u)
      .map((word) => word.replace(EDGE, ''))
      .filter(Boolean),
  }));
  const nameOf = (id: string) => context.members.find((member) => member.id === id)?.name ?? '';

  const date = readDate(tokens, context.today);
  const payer = readPayer(tokens, context, names, nameOf);
  const split = readSplit(tokens, context, names, nameOf);
  const amount = readAmount(tokens, context.currency);
  const description = readDescription(tokens);

  const problems: QuickAddProblem[] = [];
  for (const problem of [amount.problem, payer.problem, split.problem, date.problem])
    if (problem) problems.push(problem);
  if (description === '')
    problems.push({
      field: 'description',
      code: 'description-missing',
      kind: 'needed',
      message: 'Add what it was for, like Dinner.',
    });
  else if (description.length > QUICK_ADD_DESCRIPTION_MAX)
    problems.push({
      field: 'description',
      code: 'description-too-long',
      kind: 'invalid',
      message: `Keep the description to ${QUICK_ADD_DESCRIPTION_MAX} characters.`,
    });
  // What was typed wrong comes before what is still to type.
  problems.sort(
    (a, b) =>
      Number(a.kind === 'needed') - Number(b.kind === 'needed') ||
      ORDER.indexOf(a.field) - ORDER.indexOf(b.field),
  );

  return {
    description,
    amountMinor: amount.amountMinor,
    amountText: amount.amountText,
    payer: payer.payer,
    split: split.split,
    date: date.date,
    dateSaid: date.said,
    problems,
  };
}

/**
 * Who shares the Expense: every current member, the payer and those named ("split with"), or
 * exactly those named ("split between"). In the Group's order.
 */
export function quickAddSplitMembers(
  read: Pick<QuickAddRead, 'split'>,
  payerId: string | null,
  members: readonly QuickAddMember[],
): string[] {
  const order = members.map(({ id }) => id);
  if (read.split.mode === 'all') return order;
  const chosen = new Set(read.split.memberIds);
  if (read.split.mode === 'with' && payerId) chosen.add(payerId);
  return order.filter((id) => chosen.has(id));
}

// ─── Tags ───────────────────────────────────────────────────────────────

export interface QuickAddTag {
  id: string;
  name: string;
  isArchived?: boolean;
  isDeleted?: boolean;
}

/** An earlier Expense of the Group: what it was for and its Tag. */
export interface QuickAddHistoryItem {
  description: string;
  tagId?: string | null;
}

export interface QuickAddTagSuggestion {
  tagId: string;
  name: string;
  /**
   * `named`: the description names the Tag ("Groceries"). `history`: the Group's most-used Tag
   * for Expenses with a word in common. `keyword`: a common word for that kind of spending.
   */
  reason: 'named' | 'history' | 'keyword';
}

/** Common words, and the Tag names they suggest, in order of preference. */
const KEYWORDS: Array<[string[], string[]]> = [
  [
    [
      'dinner',
      'lunch',
      'breakfast',
      'brunch',
      'meal',
      'meals',
      'snack',
      'snacks',
      'restaurant',
      'cafe',
      'coffee',
      'tea',
      'chai',
      'pizza',
      'burger',
      'biryani',
      'takeaway',
      'takeout',
      'drinks',
      'beer',
      'beers',
      'dessert',
    ],
    ['Food', 'Dining', 'Meals'],
  ],
  [
    [
      'grocery',
      'groceries',
      'supermarket',
      'milk',
      'bread',
      'eggs',
      'vegetables',
      'veggies',
      'fruit',
      'fruits',
    ],
    ['Groceries', 'Food'],
  ],
  [
    [
      'taxi',
      'cab',
      'uber',
      'ola',
      'lyft',
      'auto',
      'rickshaw',
      'bus',
      'train',
      'metro',
      'flight',
      'flights',
      'airfare',
      'fuel',
      'petrol',
      'diesel',
      'parking',
      'toll',
      'tolls',
      'ferry',
      'scooter',
    ],
    ['Transport', 'Travel'],
  ],
  [
    ['hotel', 'hostel', 'airbnb', 'villa', 'resort', 'homestay', 'lodge'],
    ['Stay', 'Travel'],
  ],
  [
    ['wifi', 'internet', 'broadband', 'fibre', 'fiber'],
    ['Internet', 'Utilities', 'Bills'],
  ],
  [
    ['electricity', 'electric', 'power', 'bill', 'cylinder', 'recharge'],
    ['Utilities', 'Bills'],
  ],
  [
    [
      'cleaning',
      'cleaner',
      'detergent',
      'plumber',
      'electrician',
      'repair',
      'repairs',
      'maid',
      'cook',
      'laundry',
    ],
    ['Household'],
  ],
  [['stationery', 'printer', 'paper', 'supplies'], ['Supplies']],
  [['movie', 'cinema', 'museum', 'tickets', 'tour', 'trek', 'snorkelling'], ['Activities']],
  [['gift', 'gifts', 'present', 'flowers'], ['Gifts']],
];

/** Words too common to say two Expenses are alike. */
const COMMON = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'our', 'your', 'new']);

/** Each word of a description, with its inner punctuation also removed ("wi-fi" → "wifi"). */
function wordsOf(description: string): string[] {
  const words: string[] = [];
  for (const raw of fold(description).split(/\s+/u)) {
    const joined = raw.replace(/[^\p{L}\p{N}]+/gu, '');
    if (joined) words.push(joined);
    for (const part of raw.split(/[^\p{L}\p{N}]+/u)) if (part && part !== joined) words.push(part);
  }
  return words;
}

/** "groceries" and "grocery", "buses" and "bus", "tickets" and "ticket" read as one word. */
function sameWord(a: string, b: string): boolean {
  const plural = (one: string, many: string) =>
    many === `${one}s` ||
    many === `${one}es` ||
    (one.endsWith('y') && many === `${one.slice(0, -1)}ies`);
  return a === b || plural(a, b) || plural(b, a);
}

/**
 * Suggest a Tag for a description, from the Group's active Tags only: a Tag the description
 * names, else the Tag the Group used most for Expenses sharing a word with it (ties go to the
 * latest; `history` is newest first), else one a common word points to. Null when none fits:
 * the member then picks one, since every Expense needs exactly one Tag.
 */
export function suggestQuickAddTag(
  description: string,
  tags: readonly QuickAddTag[],
  history: readonly QuickAddHistoryItem[] = [],
): QuickAddTagSuggestion | null {
  const active = tags.filter((tag) => !tag.isArchived && !tag.isDeleted);
  const words = wordsOf(description);
  if (words.length === 0 || active.length === 0) return null;

  // The description names a Tag: "Groceries at DMart", "House rent". The earliest wins.
  let named: { tag: QuickAddTag; at: number } | null = null;
  for (const tag of active) {
    const parts = fold(tag.name)
      .split(/\s+/u)
      .map((word) => word.replace(/[^\p{L}\p{N}]+/gu, ''))
      .filter(Boolean);
    if (parts.length === 0) continue;
    for (let at = 0; at + parts.length <= words.length; at += 1) {
      if (!parts.every((part, offset) => sameWord(words[at + offset], part))) continue;
      if (!named || at < named.at) named = { tag, at };
      break;
    }
  }
  if (named) return { tagId: named.tag.id, name: named.tag.name, reason: 'named' };

  // The Group's habit: its most-used Tag for Expenses sharing a word.
  const significant = new Set(words.filter((word) => [...word].length >= 3 && !COMMON.has(word)));
  if (significant.size) {
    const counts = new Map<string, { count: number; first: number }>();
    history.forEach((item, index) => {
      const tag = active.find((candidate) => candidate.id === item.tagId);
      if (!tag) return;
      const shares = wordsOf(item.description).some((word) =>
        [...significant].some((mine) => sameWord(mine, word)),
      );
      if (!shares) return;
      const seen = counts.get(tag.id);
      counts.set(tag.id, { count: (seen?.count ?? 0) + 1, first: seen?.first ?? index });
    });
    const best = [...counts].sort(([, a], [, b]) => b.count - a.count || a.first - b.first)[0];
    if (best) {
      const tag = active.find((candidate) => candidate.id === best[0])!;
      return { tagId: tag.id, name: tag.name, reason: 'history' };
    }
  }

  // A common word: "dinner" suggests Food (or Dining, or Meals, whichever the Group has).
  for (const word of words) {
    for (const [keywords, tagNames] of KEYWORDS) {
      if (!keywords.some((keyword) => sameWord(word, keyword))) continue;
      for (const tagName of tagNames) {
        const tag = active.find((candidate) => fold(candidate.name) === fold(tagName));
        if (tag) return { tagId: tag.id, name: tag.name, reason: 'keyword' };
      }
    }
  }
  return null;
}

// ─── Into the full form's draft ─────────────────────────────────────────

export interface QuickAddChoices {
  /** Who paid, as read or as the member picked; the viewer when neither says. */
  payerId: string | null;
  /** The Tag suggested or picked, or '' when there is none yet. */
  tagId: string;
}

/**
 * The full form's values for what was read: what Quick add saves, and what "More options"
 * opens the form with. A refused amount is kept as typed, so the form shows it to correct;
 * the Category stays the form's own default.
 */
export function quickAddDraftValues(
  read: QuickAddRead,
  choices: QuickAddChoices,
  context: Pick<QuickAddContext, 'currency' | 'viewerId' | 'members'>,
): Partial<ExpenseDraftValues> {
  const payerId = choices.payerId ?? context.viewerId;
  return {
    description: read.description,
    amount:
      read.amountMinor !== null
        ? String(toMajorAmount(read.amountMinor, context.currency))
        : (read.amountText ?? ''),
    date: read.date,
    tag: choices.tagId,
    splitMethod: 'equal',
    selectedMembers: quickAddSplitMembers(read, payerId, context.members),
    payers: [{ user: payerId, amount: '' }],
    multiPayerMode: false,
    customAmounts: {},
    customPercentages: {},
    customShares: {},
  };
}
