/**
 * A Group's currency settings (#721, spec #710): the main currency and its lock, and each extra
 * currency with what uses it and who added it, as the settings section, the refused removal and
 * Activity say them. Framework-free, so the server and both clients share the words.
 */
import { format } from 'date-fns';
import { z } from 'zod';
import { CURRENCIES, CURRENCY_CODES, wholeUnit } from './currency';

const identity = z.string().regex(/^[a-f\d]{24}$/i);
const code = z.string().refine((value) => CURRENCY_CODES.includes(value));

const extraCurrencyUseSchema = z.object({
  /** The Expenses in the currency, deleted ones aside: their number, and the latest ones. */
  expenses: z.object({
    count: z.number().int().min(0),
    items: z.array(z.object({ _id: identity, description: z.string() })),
  }),
  settlements: z.number().int().min(0),
  /** To review items in the currency: the viewer's own, and other members' (only counted). */
  toReview: z.object({ yours: z.number().int().min(0), others: z.number().int().min(0) }),
});

const extraCurrencySettingSchema = z.object({
  code,
  use: extraCurrencyUseSchema,
  /** Who last added it and when, or null for an older Group that never recorded it. */
  added: z.object({ by: z.object({ _id: identity, name: z.string() }), at: z.string() }).nullable(),
});

/** The read the Group settings' Currencies section shows (GET /api/groups/[id]/currencies). */
export const groupCurrencySettingsSchema = z.object({
  mainCurrency: z.object({ code, locked: z.boolean() }),
  extraCurrencies: z.array(extraCurrencySettingSchema),
});

export type ExtraCurrencyUse = z.infer<typeof extraCurrencyUseSchema>;
export type ExtraCurrencySetting = z.infer<typeof extraCurrencySettingSchema>;
export type GroupCurrencySettings = z.infer<typeof groupCurrencySettingsSchema>;

const counted = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** "A, B and C", the way the settings say a short list. */
function spokenList(items: readonly string[]): string {
  return items.length < 2
    ? items.join('')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const toReviewCount = (use: ExtraCurrencyUse) => use.toReview.yours + use.toReview.others;

/** Whether anything still uses the currency, so removing it is refused. */
export function isCurrencyInUse(use: ExtraCurrencyUse): boolean {
  return use.expenses.count + use.settlements + toReviewCount(use) > 0;
}

/**
 * An extra currency's row in the settings: "11 Expenses · 1 Settlement · added by Sam, 1 Oct".
 * The viewer is "you"; a day in an earlier year keeps its year.
 */
export function extraCurrencyRow(
  setting: ExtraCurrencySetting,
  { viewerId, now = new Date() }: { viewerId: string; now?: Date },
): { inUse: boolean; line: string } {
  const { use, added } = setting;
  const inUse = isCurrencyInUse(use);
  const toReview = toReviewCount(use);
  const parts = inUse
    ? [
        use.expenses.count ? counted(use.expenses.count, 'Expense') : null,
        use.settlements ? counted(use.settlements, 'Settlement') : null,
        toReview ? `${counted(toReview, 'item')} in To review` : null,
      ]
    : ['Nothing uses it'];
  if (wholeUnit(setting.code)) parts.push('whole amounts only');
  if (added) {
    const at = new Date(added.at);
    const day = format(at, at.getFullYear() === now.getFullYear() ? 'd MMM' : 'd MMM yyyy');
    parts.push(`added by ${added.by._id === viewerId ? 'you' : added.by.name}, ${day}`);
  }
  return { inUse, line: parts.filter(Boolean).join(' · ') };
}

/** One thing a refused removal lists: what still uses the currency, and what to do about it. */
export interface CurrencyUseRow {
  kind: 'expenses' | 'settlements' | 'yours' | 'others';
  title: string;
  detail: string;
}

/**
 * What still uses a currency, as its refused removal lists it: the first two Expenses by name,
 * then how many more; Settlements, which can't change; the viewer's To review items; and other
 * members' To review items, counted only, since only their owners can see them.
 */
export function currencyUseRows(currencyCode: string, use: ExtraCurrencyUse): CurrencyUseRow[] {
  const rows: CurrencyUseRow[] = [];
  const { count, items } = use.expenses;
  if (count) {
    const named = items.slice(0, 2).map((item) => item.description);
    rows.push({
      kind: 'expenses',
      title: counted(count, 'Expense'),
      detail:
        count > named.length
          ? `${named.join(', ')} and ${count - named.length} more`
          : spokenList(named),
    });
  }
  if (use.settlements)
    rows.push({
      kind: 'settlements',
      title: counted(use.settlements, 'Settlement'),
      detail: `A recorded payment can’t be changed or deleted, so ${currencyCode} stays on the list.`,
    });
  const { yours, others } = use.toReview;
  if (yours)
    rows.push({
      kind: 'yours',
      title: `${counted(yours, 'item')} in your To review`,
      detail:
        yours === 1
          ? 'Save it, change its currency or delete it in To review.'
          : 'Save them, change their currency or delete them in To review.',
    });
  if (others)
    rows.push({
      kind: 'others',
      title: `${counted(others, 'item')} in members’ To review`,
      detail: 'Only their owners can see them. They need to save, change or delete them.',
    });
  return rows;
}

/** The supported currencies a Group doesn't list yet, by code, matching a search by code or name. */
export function addableCurrencies(
  listed: readonly string[],
  search: string,
): { code: string; name: string }[] {
  const query = search.trim().toLowerCase();
  return CURRENCIES.filter((currency) => !listed.includes(currency.code))
    .filter(
      (currency) =>
        !query ||
        currency.code.toLowerCase().includes(query) ||
        currency.name.toLowerCase().includes(query),
    )
    .map((currency) => ({ code: currency.code, name: currency.name }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Why the search leaves some currencies out: the Group already lists them. */
export function alreadyListedNote(listed: readonly string[]): string {
  const shown =
    listed.length === 1
      ? `${listed[0]} is already on the list, so it isn’t shown.`
      : `${spokenList(listed)} are already on the list, so they aren’t shown.`;
  return `${shown} Codes outside the ${CURRENCY_CODES.length} Splitbook supports can’t be added.`;
}

/** What a Group edit did to its extra currencies, from the change Activity recorded. */
export interface ExtraCurrencyChange {
  added: string[];
  removed: string[];
}

const codes = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** The currencies a recorded Group edit added and removed, or null when it changed none. */
export function extraCurrencyChange(changes: unknown): ExtraCurrencyChange | null {
  if (typeof changes !== 'object' || changes === null) return null;
  const change = (changes as Record<string, unknown>).alternateCurrencies;
  if (typeof change !== 'object' || change === null) return null;
  const before = codes((change as { old?: unknown }).old);
  const after = codes((change as { new?: unknown }).new);
  const added = after.filter((item) => !before.includes(item));
  const removed = before.filter((item) => !after.includes(item));
  return added.length || removed.length ? { added, removed } : null;
}

/** The change in Activity's words: "added JPY to the Group’s currencies". */
export function extraCurrencyChangeWords({ added, removed }: ExtraCurrencyChange): string {
  if (added.length && removed.length) return 'changed the Group’s currencies';
  return added.length
    ? `added ${spokenList(added)} to the Group’s currencies`
    : `removed ${spokenList(removed)} from the Group’s currencies`;
}

/** What Activity keeps with a change to the list: the Group's name and what the list became. */
export interface ExtraCurrencyChangeRecord {
  groupName?: unknown;
  currencies?: unknown;
}

/**
 * The line under the change: a removal left nothing unused ("Nothing used it", since removing
 * one in use is refused), and otherwise the list as it was recorded with the change ("Lisbon &
 * Tokyo now uses INR, EUR and JPY"), never today's, so a later change never rewrites it. An
 * entry recorded without its list says nothing more.
 */
export function extraCurrencyChangeDetail(
  change: ExtraCurrencyChange,
  record: ExtraCurrencyChangeRecord,
): string | null {
  if (!change.added.length) return 'Nothing used it';
  const listed = codes(record.currencies);
  const named = typeof record.groupName === 'string' && record.groupName.trim();
  return named && listed.length ? `${named} now uses ${spokenList(listed)}` : null;
}
